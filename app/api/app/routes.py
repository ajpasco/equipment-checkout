"""The eight routes of blueprint 12.3, and nothing else.

Every handler here does the same three things and no more. It takes the acting
``Actor`` that the identity middleware of ``app.main`` has already resolved and
placed on ``request.state`` (blueprint 5.1). It turns the request's path and
body into the arguments the rules layer takes, judging only the shapes of
blueprint 12.2 and nothing about who may do what. And it answers with the item
or the list the rules layer returned, in the JSON of 12.2. Who may do what, and
which transitions are legal, is decided in ``app.rules`` and nowhere here.

A ``RuleError`` the rules layer raises is answered by ``answer_rule_error`` with
the status the ledger gives it (12.3.1, 12.5): 403 with an empty body for
``IdentityError`` and ``Forbidden``, 404 for ``NotFound``, 409 for ``Conflict``,
422 for ``Invalid``. ``app.main`` registers it on the application. A path or
body that is not even of the right shape is answered 422 by FastAPI itself
(SC-14), before any handler runs.

The handlers are plain ``def`` and not ``async def`` on purpose. FastAPI runs a
plain function in its thread pool, so two requests on one item really do meet
at the row lock of blueprint section 8, instead of taking turns on the event
loop and never contending at all.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Body, Path, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session

from app import rules

router = APIRouter(prefix="/api")

#: Blueprint 12.3: ``item_id`` is valid when it is an integer from 1 to
#: 2147483647, the range of the ``integer`` column it names. Anything else is
#: 422 (SC-14), answered by FastAPI before the handler runs.
ItemId = Annotated[int, Path(ge=1, le=2_147_483_647)]

#: A JSON body as the two routes that take one receive it: the object it held,
#: or None when the request carried no body. FastAPI answers 422 (SC-14) itself
#: when the body is not valid JSON or is JSON that is not an object.
JsonBody = Annotated[dict[str, Any] | None, Body()]


# --------------------------------------------------------------------------- #
# The JSON of blueprint 12.2
# --------------------------------------------------------------------------- #


def _user_json(actor: rules.Actor) -> dict[str, Any]:
    return {"id": actor.id, "name": actor.name, "role": actor.role}


def _item_json(item: rules.Item) -> dict[str, Any]:
    return {
        "id": item.id,
        "name": item.name,
        "status": item.status,
        "borrowerId": item.borrower_id,
        "borrowerName": item.borrower_name,
    }


# --------------------------------------------------------------------------- #
# What a handler reads from the request
# --------------------------------------------------------------------------- #


def _actor(request: Request) -> rules.Actor:
    """The acting identity the middleware resolved (blueprint 5.1)."""
    return request.state.actor


def _session(request: Request) -> Session:
    """A session on the engine that start-up kept on ``app.state`` (blueprint 12.4)."""
    return request.app.state.session_factory()


def _name_of(body: dict[str, Any] | None) -> object:
    """The raw ``name`` of an Add body: ``{"name": <string>}``, one field, required.

    Only the shape is judged here (12.2: a body may contain no field not listed).
    The value goes to ``rules.normalise_name`` as it came -- None when the field
    is absent -- and that is what decides that a missing, non-string, empty,
    whitespace-only or over-long name is ``Invalid`` (SC-05, SC-13).
    """
    if body is None:
        raise rules.Invalid("a JSON body with name is required")
    if set(body) - {"name"}:
        raise rules.Invalid("the body may carry name and no other field")
    return body.get("name")


def _borrower_of(body: dict[str, Any] | None) -> int | None:
    """The ``borrowerId`` a Borrow body names, or None when it names nobody.

    No body and an empty object both name nobody (12.2: a member sends either).
    Otherwise the object carries ``borrowerId`` and nothing else, and its value
    is an integer: ``null``, a string, a bool or any other field is 422 (SC-12,
    SC-14). Whether naming nobody, or that person, is allowed for this actor is
    ``rules.resolve_borrower``'s to decide, inside ``rules.borrow``.
    """
    if not body:
        return None
    if set(body) != {"borrowerId"}:
        raise rules.Invalid("the body may carry borrowerId and no other field")
    value = body["borrowerId"]
    if isinstance(value, bool) or not isinstance(value, int):
        raise rules.Invalid("borrowerId must be an integer")
    return value


# --------------------------------------------------------------------------- #
# The routes, in the order of the table of blueprint 12.3
# --------------------------------------------------------------------------- #


@router.get("/users")
def list_users(request: Request) -> Response:
    """Row 1: every user, by id ascending."""
    with _session(request) as session:
        users = rules.list_users(session)
    return JSONResponse([_user_json(user) for user in users])


@router.get("/equipment")
def list_equipment(request: Request) -> Response:
    """Row 2: every item, by id ascending (DD-18)."""
    with _session(request) as session:
        items = rules.list_equipment(session)
    return JSONResponse([_item_json(item) for item in items])


@router.post("/equipment")
def add_equipment(request: Request, body: JsonBody = None) -> Response:
    """Row 3: an admin adds an Available item (REQ-009)."""
    actor = _actor(request)
    # Blueprint 5.3: the role is judged before the body is looked at, so a
    # member is refused whatever they sent. ``rules.add_equipment`` judges it
    # again on its own; the second look costs nothing and changes nothing.
    rules.require_admin(actor)
    raw_name = _name_of(body)
    with _session(request) as session:
        item = rules.add_equipment(session, actor, raw_name)
    return JSONResponse(_item_json(item))


@router.post("/equipment/{item_id}/borrow")
def borrow(request: Request, item_id: ItemId, body: JsonBody = None) -> Response:
    """Row 4: a member borrows for themselves; an admin lends to a named member."""
    named_borrower_id = _borrower_of(body)
    with _session(request) as session:
        item = rules.borrow(session, _actor(request), item_id, named_borrower_id)
    return JSONResponse(_item_json(item))


@router.post("/equipment/{item_id}/return")
def return_item(request: Request, item_id: ItemId) -> Response:
    """Row 5: a loan comes back. A body, if sent, is ignored (12.2)."""
    with _session(request) as session:
        item = rules.return_item(session, _actor(request), item_id)
    return JSONResponse(_item_json(item))


@router.post("/equipment/{item_id}/out-of-service")
def mark_out_of_service(request: Request, item_id: ItemId) -> Response:
    """Row 6: an admin takes an Available item out of service."""
    with _session(request) as session:
        item = rules.mark_out_of_service(session, _actor(request), item_id)
    return JSONResponse(_item_json(item))


@router.post("/equipment/{item_id}/restore")
def restore(request: Request, item_id: ItemId) -> Response:
    """Row 7: an admin brings an Out of service item back to Available."""
    with _session(request) as session:
        item = rules.restore_item(session, _actor(request), item_id)
    return JSONResponse(_item_json(item))


@router.delete("/equipment/{item_id}")
def delete_equipment(request: Request, item_id: ItemId) -> Response:
    """Row 8: an admin deletes an item that is not on loan; answers it as it was."""
    with _session(request) as session:
        item = rules.delete_equipment(session, _actor(request), item_id)
    return JSONResponse(_item_json(item))


# --------------------------------------------------------------------------- #
# The outcomes of the rules layer, as the ledger answers them
# --------------------------------------------------------------------------- #

#: Blueprint 12.5 and the ledger 12.3.1: the status each kind of outcome answers.
_STATUS_OF_ERROR: tuple[tuple[type[rules.RuleError], int], ...] = (
    (rules.IdentityError, 403),
    (rules.Forbidden, 403),
    (rules.NotFound, 404),
    (rules.Conflict, 409),
    (rules.Invalid, 422),
)


def answer_rule_error(request: Request, error: Exception) -> Response:
    """The HTTP answer to a ``RuleError``, for ``app.add_exception_handler``.

    A refusal (403) carries a zero-length body (SC-01, SC-06, SC-08, SC-09).
    The bodies of 404, 409 and 422 are not pinned (12.2); they carry the rules
    layer's own message, which names no user and no value.
    """
    for kind, status in _STATUS_OF_ERROR:
        if isinstance(error, kind):
            break
    else:  # a RuleError of a kind the ledger does not know: not ours to guess at
        raise error
    if status == 403:
        return Response(status_code=403)
    return JSONResponse({"detail": str(error)}, status_code=status)
