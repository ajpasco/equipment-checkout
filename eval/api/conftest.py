"""Fixtures for the API rows: the application driven over the network, in its own container,
on a real PostgreSQL 16.

This file belongs to the eval and never to a builder. **Nothing here imports the application.**
It runs as the `api` service of `eval/compose.yml`, built from the tree's `app/api`, and these
rows reach it only as a client on the network would. That is the reason this file has the shape
it has: the earlier version entered the application in process through a test client, and
anything the application imported then ran inside the interpreter that graded it. Here the
grader's interpreter holds this file and the pinned tools of `requirements-eval.txt`, nothing
else.

What this file holds, and nothing else: a fixture that empties the database and starts the
application on it; a way to stop and start the application again on the same database, for the
rows that say "the application is stopped and started" (T-016); the seeded ids 1 to 3; the
barrier that releases two requests together; the dump reader, which discovers every table from
the database's own catalogue. It captures and reads no log.

**How a row knows whether an action was carried out.** Eval plan 1.1 forbids every row here to
assert a status code or to recognise an outcome by one. Two instruments are used instead:

1. *The read-back.* The equipment list, read again after the action: every item's id, name,
   status and borrower. This is what "it was carried out" and "nothing changed" are asserted
   against, in every row.
2. *Whether the answer delivered the item.* The contract (blueprint 12.2) has every carried-out
   action answer with the item it acted on. ``Answer`` reports that as ``carried_out``: it looks
   only at whether the payload is an item, never at a code.

Settings, all set by ``eval/run.sh``:
  API_BASE_URL          where the application answers, e.g. http://127.0.0.1:18000
  TEST_DATABASE_URL     the eval's own connection to the same database (psycopg form)
  EVAL_COMPOSE_PROJECT  the Compose project, so the application can be stopped and started
  EVAL_COMPOSE_FILE     the Compose file
"""

import json
import os
import subprocess
import threading
import time
from contextlib import contextmanager

import httpx
import psycopg
import pytest

#: The seeded users of blueprint 12.2, fixed (DD-03). Written here as literals, never read from
#: the application: a build that seeds the wrong people must fail the rows that name them.
ADA, MIA, SAM = 1, 2, 3
SEEDED_USERS = (
    (ADA, "Ada Admin", "admin"),
    (MIA, "Mia Member", "member"),
    (SAM, "Sam Member", "member"),
)

#: An id in range (blueprint 12.3) that no item ever has.
MISSING_ITEM_ID = 999999

#: The fields the contract gives an item (blueprint 12.2). Used only to recognise that an answer
#: delivered the item, never asserted as a shape.
_ITEM_FIELDS = ("id", "name", "status", "borrowerId", "borrowerName")

#: Sentinel: this request carries no body at all, as against a body that is an empty object.
NO_BODY = object()

_OMIT = object()

#: Long enough that a build which deadlocks instead of serialising two requests fails the round
#: rather than hanging the suite. Not a wait for anything to happen: the barrier releases both.
_BARRIER_TIMEOUT_SECONDS = 60.0

#: How long the application may take to answer after a start or restart.
_READY_TIMEOUT_SECONDS = 120.0

_REQUEST_TIMEOUT_SECONDS = 30.0


class Answer:
    """What the application answered, read without looking at any status code."""

    def __init__(self, body: bytes) -> None:
        self._body = body

    @property
    def answered_nothing(self) -> bool:
        """Nothing was returned to the caller: the answer carries no content."""
        return self._body == b""

    @property
    def payload(self):
        """The answer read as JSON, or None when it is not JSON."""
        if not self._body:
            return None
        try:
            return json.loads(self._body)
        except ValueError:
            return None

    @property
    def carried_out(self) -> bool:
        """The application answered with the item, so it carried the action out.

        A superset test, not an equality: a build that adds a field to the item would be
        answering a question no row here asks.
        """
        payload = self.payload
        return isinstance(payload, dict) and all(field in payload for field in _ITEM_FIELDS)

    @property
    def item(self) -> dict | None:
        """The item the answer delivered, or None when it delivered none."""
        return self.payload if self.carried_out else None

    @property
    def entries(self) -> list | None:
        """The list the answer delivered, or None when it delivered none."""
        payload = self.payload
        return payload if isinstance(payload, list) else None


class Record:
    """One row of one table of the dump, as its values and nothing else.

    A row asserts about the values in the dump, never about the names of tables or columns
    (eval plan 1.1), so a record carries no name. Position is kept, because "equal except for
    the item id" is a statement about which values differ.
    """

    def __init__(self, values: tuple) -> None:
        self.values = values

    def differences(self, other: "Record") -> list[tuple]:
        """The pairs of values at the positions where the two records differ."""
        if len(self.values) != len(other.values):
            return [(self.values, other.values)]
        return [(mine, theirs) for mine, theirs in zip(self.values, other.values) if mine != theirs]


class Dump:
    """Everything the application's database holds, read without naming a table."""

    def __init__(self, records: tuple[Record, ...]) -> None:
        self.records = records

    @property
    def values(self) -> list:
        """Every value the database holds, flattened, with no name attached."""
        return [value for record in self.records for value in record.values]

    def occurrences_of(self, value) -> int:
        """How many values in the whole dump are equal to this one."""
        return sum(1 for held in self.values if held == value)

    def records_holding(self, value) -> list[Record]:
        """Every record one of whose values is this one."""
        return [record for record in self.records if value in record.values]

    def as_compared(self) -> list:
        """A form two dumps can be compared by, independent of row order."""
        return sorted(repr(record.values) for record in self.records)


_TABLES_QUERY = (
    "SELECT n.nspname, c.relname"
    " FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
    " WHERE c.relkind = 'r'"
    "   AND n.nspname NOT IN ('pg_catalog', 'information_schema')"
    " ORDER BY n.nspname, c.relname"
)


class Api:
    """The HTTP API, driven as one of the seeded users, over the network.

    Every method answers with an ``Answer``. The read-back is ``listing``, and the setup helpers
    (``available``, ``on_loan``, ``out_of_service``) bring the store to a starting state through
    the API itself, as an admin, so that no row depends on a direct write.
    """

    ADA, MIA, SAM = ADA, MIA, SAM
    SEEDED_USERS = SEEDED_USERS
    MISSING_ITEM_ID = MISSING_ITEM_ID
    NO_BODY = NO_BODY

    def __init__(self, client: httpx.Client, database_url: str) -> None:
        self._client = client
        self._database_url = database_url

    # ----------------------------------------------------------------- #
    # Requests
    # ----------------------------------------------------------------- #

    def send(self, method: str, path: str, *, identity, body=NO_BODY) -> Answer:
        """One request. ``identity`` is an id, a raw header value, or None for none."""
        headers = {} if identity is None else {"X-User-Id": str(identity)}
        if body is NO_BODY:
            response = self._client.request(method, path, headers=headers)
        else:
            response = self._client.request(method, path, headers=headers, json=body)
        return Answer(response.content)

    def send_with_headers(self, method: str, path: str, headers, body: bytes = b"") -> Answer:
        """One request whose headers are given verbatim, as (name, value) pairs, as many as a
        row wants: this is how a row delivers two ``X-User-Id`` headers at once. uvicorn hands
        both to the application as two entries, which is the case blueprint 5.1.1 describes.
        """
        pairs = list(headers)
        if body:
            pairs.append(("content-type", "application/json"))
        response = self._client.request(
            method, path, headers=httpx.Headers(pairs), content=body if body else None
        )
        return Answer(response.content)

    def users(self, identity) -> Answer:
        return self.send("GET", "/api/users", identity=identity)

    def equipment(self, identity) -> Answer:
        return self.send("GET", "/api/equipment", identity=identity)

    def add(self, identity, name) -> Answer:
        return self.send("POST", "/api/equipment", identity=identity, body={"name": name})

    def add_body(self, identity, body) -> Answer:
        """An Add whose body is given verbatim, for the shapes ``add`` cannot send."""
        return self.send("POST", "/api/equipment", identity=identity, body=body)

    def borrow(self, identity, item_id, borrower=_OMIT, body=_OMIT) -> Answer:
        """A Borrow. With no ``borrower`` and no ``body`` it carries no body at all."""
        if body is _OMIT:
            body = NO_BODY if borrower is _OMIT else {"borrowerId": borrower}
        return self.send("POST", f"/api/equipment/{item_id}/borrow", identity=identity, body=body)

    def return_item(self, identity, item_id) -> Answer:
        return self.send("POST", f"/api/equipment/{item_id}/return", identity=identity)

    def mark_out_of_service(self, identity, item_id) -> Answer:
        return self.send("POST", f"/api/equipment/{item_id}/out-of-service", identity=identity)

    def restore(self, identity, item_id) -> Answer:
        return self.send("POST", f"/api/equipment/{item_id}/restore", identity=identity)

    def delete(self, identity, item_id) -> Answer:
        return self.send("DELETE", f"/api/equipment/{item_id}", identity=identity)

    # ----------------------------------------------------------------- #
    # The operations as data, for the rows that sweep all of them
    # ----------------------------------------------------------------- #

    def every_operation(self, item_id: int) -> list[tuple[str, str, object]]:
        """Every operation the API offers, as (method, path, body): the eight of blueprint 12.3."""
        return [
            ("GET", "/api/users", NO_BODY),
            ("GET", "/api/equipment", NO_BODY),
            ("POST", "/api/equipment", {"name": "Swept probe"}),
            ("POST", f"/api/equipment/{item_id}/borrow", {"borrowerId": MIA}),
            ("POST", f"/api/equipment/{item_id}/return", NO_BODY),
            ("POST", f"/api/equipment/{item_id}/out-of-service", NO_BODY),
            ("POST", f"/api/equipment/{item_id}/restore", NO_BODY),
            ("DELETE", f"/api/equipment/{item_id}", NO_BODY),
        ]

    #: A path the application does not define (blueprint 12.3: the eight routes are the only ones).
    UNDEFINED_PATH = "/api/equipment/nowhere-the-api-defines"

    # ----------------------------------------------------------------- #
    # Read-back and starting states
    # ----------------------------------------------------------------- #

    def listing(self, identity=ADA) -> list[dict]:
        """The equipment list read back: every item's id, name, status, borrower."""
        entries = self.equipment(identity).entries
        assert entries is not None, "the equipment list could not be read back"
        return entries

    def read(self, item_id: int, identity=ADA) -> dict | None:
        """One item as the list shows it, or None when the list has no such item."""
        for entry in self.listing(identity):
            if entry["id"] == item_id:
                return entry
        return None

    def user_list(self, identity=ADA) -> list[dict]:
        """The user list read back."""
        entries = self.users(identity).entries
        assert entries is not None, "the user list could not be read back"
        return entries

    def available(self, name: str) -> dict:
        """An Available item, created through the API as the admin."""
        item = self.add(ADA, name).item
        assert item is not None, f"the setup Add of {name!r} was not carried out"
        return item

    def on_loan(self, name: str, borrower: int = MIA, *, by: int = ADA) -> dict:
        """An item On loan, lent through the API."""
        item = self.available(name)
        if by == borrower:
            answer = self.borrow(borrower, item["id"])
        else:
            answer = self.borrow(by, item["id"], borrower=borrower)
        lent = answer.item
        assert lent is not None, f"the setup Borrow of {name!r} was not carried out"
        return lent

    def out_of_service(self, name: str) -> dict:
        """An item Out of service, marked through the API as the admin."""
        item = self.available(name)
        marked = self.mark_out_of_service(ADA, item["id"]).item
        assert marked is not None, f"the setup Mark of {name!r} was not carried out"
        return marked

    # ----------------------------------------------------------------- #
    # The dump
    # ----------------------------------------------------------------- #

    def dump(self) -> Dump:
        """Everything the database holds, discovered from its own catalogue.

        No table and no column is named here: the catalogue is asked which ordinary tables
        exist, and every row of each is read as values. A build that keeps something extra in a
        third table is read by this as surely as one that keeps it in a column of the two.
        """
        records: list[Record] = []
        with psycopg.connect(self._database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(_TABLES_QUERY)
                tables = cursor.fetchall()
                for schema, table in tables:
                    cursor.execute(f'SELECT * FROM "{schema}"."{table}"')
                    records.extend(Record(tuple(row)) for row in cursor.fetchall())
        return Dump(tuple(records))

    # ----------------------------------------------------------------- #
    # Two requests released together
    # ----------------------------------------------------------------- #

    @staticmethod
    def release_together(first, second):
        """Run two requests in two threads, released at the same moment.

        A ``threading.Barrier`` releases them, so neither waits for a clock and no row sleeps.
        Whichever then takes the row lock first decides the pair, which is exactly what
        blueprint section 8 guarantees about.
        """
        barrier = threading.Barrier(2, timeout=_BARRIER_TIMEOUT_SECONDS)
        outcomes: dict[int, object] = {}

        def run(slot: int, work) -> None:
            try:
                barrier.wait()
                outcomes[slot] = work()
            except BaseException as failure:  # re-raised in the calling thread
                outcomes[slot] = failure

        threads = [
            threading.Thread(target=run, args=(0, first), daemon=True),
            threading.Thread(target=run, args=(1, second), daemon=True),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        for slot in (0, 1):
            outcome = outcomes.get(slot)
            if isinstance(outcome, BaseException):
                raise outcome
        return outcomes[0], outcomes[1]


class Settings:
    """Where the application answers and how to stop and start it, from the environment."""

    def __init__(self) -> None:
        missing = [
            name
            for name in ("API_BASE_URL", "TEST_DATABASE_URL", "EVAL_COMPOSE_PROJECT", "EVAL_COMPOSE_FILE")
            if not os.environ.get(name)
        ]
        if missing:
            raise RuntimeError(f"eval/run.sh sets these and they are missing: {', '.join(missing)}")
        self.base_url = os.environ["API_BASE_URL"]
        self.database_url = os.environ["TEST_DATABASE_URL"]
        self.compose = [
            "docker", "compose", "-p", os.environ["EVAL_COMPOSE_PROJECT"], "-f", os.environ["EVAL_COMPOSE_FILE"],
        ]


def _restart_application(settings: Settings) -> None:
    """Stop the application's container and start it again: its shutdown, then its start-up,
    on the same database. What "the application is stopped and started again" means here."""
    subprocess.run([*settings.compose, "restart", "api"], check=True, capture_output=True, text=True)


def _wait_until_answering(settings: Settings) -> None:
    """Until the user list reads back as a list, or the timeout: a readiness probe, no row's
    assertion. On timeout the application's own log is in the error, so a build that fails to
    start says why."""
    deadline = time.monotonic() + _READY_TIMEOUT_SECONDS
    with httpx.Client(base_url=settings.base_url, timeout=5.0) as client:
        while True:
            try:
                answer = Answer(client.get("/api/users", headers={"X-User-Id": str(ADA)}).content)
                if answer.entries is not None:
                    return
            except httpx.HTTPError:
                pass
            if time.monotonic() > deadline:
                log = subprocess.run(
                    [*settings.compose, "logs", "--no-color", "--tail", "40", "api"],
                    capture_output=True, text=True,
                ).stdout
                raise RuntimeError(f"the application did not answer within {_READY_TIMEOUT_SECONDS:.0f}s; its log:\n{log}")
            time.sleep(0.5)


def _drop_every_table(database_url: str) -> None:
    """Drop every ordinary table the database holds, whatever it is called.

    Discovered from the catalogue rather than named, for the same reason the dump is: a build
    that keeps a third table would otherwise leave it standing between rows.
    """
    with psycopg.connect(database_url, autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute(_TABLES_QUERY)
            for schema, table in cursor.fetchall():
                cursor.execute(f'DROP TABLE IF EXISTS "{schema}"."{table}" CASCADE')


class Application:
    """A fresh database, and the application started on it as often as a row needs.

    Most rows want one running application and take the ``api`` fixture. The rows that stop and
    start it (T-016) enter ``running()`` more than once on the same database; the tables are not
    dropped in between.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @contextmanager
    def running(self):
        """Stop and start the application, wait until it answers, and hand over the API."""
        _restart_application(self._settings)
        _wait_until_answering(self._settings)
        with httpx.Client(base_url=self._settings.base_url, timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            yield Api(client, self._settings.database_url)


@pytest.fixture(scope="session")
def _settings() -> Settings:
    return Settings()


@pytest.fixture()
def application(_settings: Settings):
    """A fresh database and the means to start the application on it."""
    _drop_every_table(_settings.database_url)
    yield Application(_settings)


@pytest.fixture()
def api(application: Application):
    """A fresh database with the application running on it: one start, one stop."""
    with application.running() as running_api:
        yield running_api


# --------------------------------------------------------------------- #
# The convention that ties a case to its eval-plan row
# --------------------------------------------------------------------- #

import re

#: A case's name carries its eval-plan row and then the labels of the criteria that row checks
#: (DD-24), in the underscore spelling a Python identifier allows:
#: ``test_T_008_N4_REQ_008_2_REQ_008_3_an_on_loan_item``. The hyphenated forms the eval plan uses
#: are recovered below and written into the JUnit report as properties, so the report can be read
#: by row and by criterion without anyone transliterating a function name.
TITLE = re.compile(
    r"^test_T_(?P<req>\d{3})_(?P<sense>[PN])(?P<index>\d+)"
    r"(?P<labels>(?:_REQ_\d{3}_\d+)*)"
    r"(?:_|$)"
)
LABEL = re.compile(r"_REQ_(\d{3})_(\d+)")


def row_id_of(test_name: str) -> str | None:
    """The canonical row id a test function name carries, or None."""
    found = TITLE.match(test_name)
    if found is None:
        return None
    return f"T-{found['req']}-{found['sense']}{found['index']}"


def criteria_of(test_name: str) -> list[str]:
    """The canonical criterion labels a test function name carries."""
    found = TITLE.match(test_name)
    if found is None:
        return []
    return [f"REQ-{req}.{m}" for req, m in LABEL.findall(found["labels"])]


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Refuse a suite holding a case that names no eval-plan row, and record each case's row
    and criteria as JUnit properties. A case whose name carries no row id can never satisfy a
    row and would be invisible when the report is read, so its presence is a fault in the suite.
    """
    untitled = [item.nodeid for item in items if row_id_of(item.name) is None]
    if untitled:
        listed = "\n  ".join(untitled)
        raise pytest.UsageError(
            "every case must be titled with its eval-plan row id, which must open the name "
            f"(test_T_000_P0_...). These are not:\n  {listed}"
        )
    for item in items:
        item.user_properties.append(("row", row_id_of(item.name)))
        for label in criteria_of(item.name):
            item.user_properties.append(("criterion", label))
