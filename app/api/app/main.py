"""The ASGI application of blueprint 12.4: ``app``, its start-up, the identity check.

Run as ``uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log``.
Nothing here reads a setting at import time: ``DATABASE_URL`` is read in the
lifespan, when the server starts the application, so a test may set it first.

Three things live here and nowhere else:

- **Start-up and shutdown**, in the order 12.4 pins: ``config.load_settings``,
  ``db.make_engine``, ``db.initialise`` (the two tables and the three users,
  safe to run again), then the engine and its session factory on ``app.state``.
  Shutdown disposes the engine.
- **The identity check**, ``IdentityMiddleware``, outermost (blueprint 5.1): it
  runs before routing, body parsing and validation, for every method and every
  path, and refuses a request with no usable ``X-User-Id`` with 403 and an
  empty body. Routes never see such a request.
- **The access log** of blueprint 5.4 (D-23): one INFO record per request on
  the logger ``app.access``, exactly ``{METHOD} {PATH} {STATUS} user={ID}``,
  with ``user=-`` when the request carried no usable identity. uvicorn's own
  access log is switched off on the command line, so this is the only one.
  No test reads it.

Not here, on purpose: interactive documentation, the OpenAPI route, CORS, a
health route (the Compose probe calls ``GET /api/users`` as user 1). The eight
routes of ``app.routes`` are the only routes.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable, MutableMapping
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from sqlalchemy.orm import Session, sessionmaker
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response

from app import config, db, routes, rules

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

#: The header that carries the acting identity (blueprint 5.1), as the ASGI
#: scope spells header names: lowercased bytes.
_IDENTITY_HEADER = b"x-user-id"

#: Blueprint 5.4: the one request log.
access_log = logging.getLogger("app.access")


# --------------------------------------------------------------------------- #
# The access log (blueprint 5.4, D-23)
# --------------------------------------------------------------------------- #


def _configure_access_log() -> None:
    """Give ``app.access`` a handler of its own, once, so INFO records reach stderr.

    uvicorn configures only its own loggers; a record on ``app.access`` would
    otherwise propagate to a root logger with no handler and be dropped below
    WARNING. The line is the record's message and nothing else, so it reads
    exactly as 5.4 states it. Idempotent: a second import or a second start
    adds no second handler.
    """
    if not access_log.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        access_log.addHandler(handler)
    access_log.setLevel(logging.INFO)
    access_log.propagate = False


def _log_access(scope: Scope, status: int, user_id: int | None) -> None:
    """One line: ``{METHOD} {PATH} {STATUS} user={ACTING_USER_ID}``.

    ``scope["path"]`` carries no query string. No body, no name, no setting.
    """
    access_log.info(
        "%s %s %s user=%s",
        scope["method"],
        scope["path"],
        status,
        "-" if user_id is None else user_id,
    )


# --------------------------------------------------------------------------- #
# The identity check (blueprint 5.1), outermost
# --------------------------------------------------------------------------- #


def _resolve_actor(session_factory: sessionmaker[Session], raw_values: list[str]) -> rules.Actor:
    """``rules.resolve_actor`` in a session of its own; runs in the thread pool."""
    with session_factory() as session:
        return rules.resolve_actor(session, raw_values)


class IdentityMiddleware:
    """Blueprint 5.1: the acting identity, checked once, before anything else.

    A pure ASGI middleware rather than a ``BaseHTTPMiddleware``, so that it
    reads the raw header list of the scope -- two ``X-User-Id`` headers arrive
    as two entries, which is the doubled case of 5.1.1 -- and so that it runs
    before the router for every method and every path, defined or not,
    ``OPTIONS`` included. ``rules.resolve_actor`` decides: ``parse_user_id`` on
    the raw values, then the user's row and role from the store on every
    request. Nothing the client says about its role is ever trusted.

    Refused: 403 with a zero-length body (SC-01), and the request goes no
    further. Accepted: the ``Actor`` is placed on ``request.state.actor`` for
    the routes to read. Either way the access log line is written here, the one
    place that sees every request and knows both the identity and the status.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        raw_values = [
            value.decode("latin-1")
            for name, value in scope["headers"]
            if name == _IDENTITY_HEADER
        ]
        session_factory = scope["app"].state.session_factory
        try:
            actor = await run_in_threadpool(_resolve_actor, session_factory, raw_values)
        except rules.IdentityError:
            _log_access(scope, 403, None)
            await Response(status_code=403)(scope, receive, send)
            return

        scope.setdefault("state", {})["actor"] = actor
        answered = {"status": 500}  # what stands if the application never answers

        async def send_noting_status(message: Message) -> None:
            if message["type"] == "http.response.start":
                answered["status"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_noting_status)
        finally:
            _log_access(scope, answered["status"], actor.id)


# --------------------------------------------------------------------------- #
# Start-up, shutdown and the application (blueprint 12.4)
# --------------------------------------------------------------------------- #


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Settings, engine, schema and seed, in that order; dispose on shutdown.

    A ``ConfigError`` or an unreachable database raises out of here, and uvicorn
    then reports the failed start-up and exits non-zero (blueprint section 6).
    The message of a ``ConfigError`` names the setting and never its value.
    """
    settings = config.load_settings()
    engine = db.make_engine(settings.database_url)
    try:
        db.initialise(engine)
        app.state.engine = engine
        app.state.session_factory = db.make_session_factory(engine)
        yield
    finally:
        engine.dispose()


app = FastAPI(
    title="Shared Equipment Checkout",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.include_router(routes.router)
app.add_exception_handler(rules.RuleError, routes.answer_rule_error)
app.add_middleware(IdentityMiddleware)
_configure_access_log()
