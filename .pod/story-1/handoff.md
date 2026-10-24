# Story 1 handoff: the API routes and start-up

Builder's note for the pull request on `story/1`. Written 2026-10-24.

## What I built

Three files, the ones `eval/stories/1.txt` allows, and nothing else under `app/`:

- `app/api/app/config.py`: `Settings` (frozen dataclass, one field `database_url`),
  `load_settings(environ=None)`, `ConfigError`. `DATABASE_URL` must be present, non-empty and
  begin `postgresql+psycopg://` with something after it. The error message names the setting and
  never carries its value.
- `app/api/app/routes.py`: the eight routes of blueprint 12.3 on an `APIRouter` under `/api`, the
  JSON shapes of 12.2, and `answer_rule_error`, which maps the rules layer's outcomes to the
  ledger: `IdentityError` and `Forbidden` to 403 with an empty body, `NotFound` 404, `Conflict`
  409, `Invalid` 422. No other route. Every handler calls one operation of `app.rules` and adds
  no rule.
- `app/api/app/main.py`: the FastAPI `app` with docs, redoc and OpenAPI switched off; the
  lifespan in the pinned order (`load_settings`, `make_engine`, `initialise`, engine and session
  factory on `app.state`, `dispose` on shutdown; nothing read at import); `IdentityMiddleware`,
  a pure ASGI middleware added outermost, which reads the raw header list of the scope, calls
  `rules.resolve_actor` in the thread pool, refuses with 403 and a zero-length body before
  routing for every method and path, and otherwise puts the `Actor` on `request.state.actor`;
  and the access log, one INFO record per request on `app.access`, exactly
  `{METHOD} {PATH} {STATUS} user={ID}` with `user=-` when refused.

`app/api/app/db.py` and `app/api/app/rules.py` are untouched.

## What passes

`sh eval/run.sh` from the repository root, on Docker 28.1.1, Compose v2.35.1, Python 3.12.13:

```
55 passed in 73.34s (0:01:13)
[exam] report: eval/reports/api.xml
```

Exit status 0. The report holds 55 cases, zero failures, zero errors, zero skipped, and exactly
the 55 row ids the brief lists (T-001 P4 N3 N4 N7 through T-017 N7). Nothing I could not make
pass. No test I believe is wrong.

## What the exam does not observe, checked by hand

No row reads a status code, so I probed a throwaway copy of the exam stack (same compose file,
different project name, torn down afterwards) with `urllib` and two bare `docker run`s:

- 403 answers carry no body and no content type: a request with no identity on `/`, `/docs`,
  any route; a member's Add, Delete, Return of another's loan, Borrow naming anybody else.
- 404 for an item that is missing (`999999`) on borrow and delete; 409 for borrow of an on-loan
  item, mark of an on-loan item, delete of an on-loan item, return of an available item, restore
  of an available item; 422 for an `item_id` of `0`, `2147483648` or `abc`, a body that is not
  JSON or not an object, an Add body with an extra field or a non-string name, an admin's
  `borrowerId` that is `null`, a string, a bool, or an admin (`1`), and a body carrying an extra
  field. A member's `{"borrowerId": null}` is 422 as 12.2 says; a member naming `3` is 403.
- `/docs`, `/openapi.json`, `/redoc` and `/` answer 404 to a usable identity; `PUT` and
  `OPTIONS` on `/api/users` answer 405.
- Start-up with `DATABASE_URL` empty exits 3 with
  `ConfigError: DATABASE_URL is not set; it must be a postgresql+psycopg:// URL`. Start-up with
  `postgresql://equipment:SECRETVALUE42@db:5432/equipment` (wrong driver, fake password) exits 3
  with `DATABASE_URL is malformed; it must begin with postgresql+psycopg:// and name a database`,
  and the string `SECRETVALUE42` appears nowhere in the output.
- The access log, seen in the container's log during the exam: `GET /api/users 200 user=1` for
  the Compose probe, one line per request, nothing else on that logger.

One observation, not changed: `GET /api/equipment/nowhere-the-api-defines` with a usable identity
answers 405, not 404, because the path pattern of `DELETE /api/equipment/{item_id}` matches the
segment textually and the integer check runs after routing. SC-15 names this the framework's
default and no row reads it. Using Starlette's `{item_id:int}` converter would turn it into 404
but would also turn a non-integer `item_id` on a defined route into 404 instead of the 422 that
SC-14 pins, so I left the framework's default in place.

## Decisions worth knowing

- **Handlers are plain `def`, not `async def`.** FastAPI runs them in its thread pool, so the two
  requests a row releases together really contend at the `SELECT ... FOR UPDATE` of
  `rules._locked`. With `async def` and synchronous SQLAlchemy they would queue on the event loop
  and the lock would never be exercised. The identity lookup in the middleware runs in the thread
  pool for the same reason.
- **Pure ASGI middleware, not `BaseHTTPMiddleware`.** It reads `scope["headers"]` directly, so two
  `X-User-Id` header lines arrive as two entries and `parse_user_id` refuses them (T-001-N7's
  doubled case), and it runs before the router, so an undefined path and `OPTIONS` are refused the
  same way (T-001-N3).
- **Where the order of checks (5.3) sits.** Role, borrower rule, existence and state are the rules
  layer's and run in its order. Syntactic validation that the spec answers 422 (path `item_id`
  range, a body that is not JSON or not an object) is FastAPI's and runs before the handler; I
  read 5.3's "for syntactically valid requests" as allowing that. The one place the route itself
  judges a body's shape (an extra field, a non-integer `borrowerId`) comes after the role check
  for Add, where the handler calls `rules.require_admin` before looking at the body, so a member
  is refused whatever they sent; `rules.add_equipment` judges the role again, harmlessly.
- **Body shapes.** A Borrow with no body and with `{}` both pass `None` to `rules.borrow`, and the
  rules layer decides whether naming nobody is allowed for that actor. `null`, a string, a bool,
  a float and any extra field are 422 in the route, as 12.2 pins. For Add, the route only checks
  that there is a body and no field other than `name`; the value, absent or not, goes to
  `rules.normalise_name` as it came.
- **Error bodies.** 404, 409 and 422 answer `{"detail": "<the rules layer's message>"}`; those
  messages name no user and no value. 403 is `Response(status_code=403)`, a zero-length body.
- **Access log handler.** `app.access` gets its own `StreamHandler` to stderr with a bare
  `%(message)s` format and `propagate=False`, configured once at import (guarded against a second
  handler). uvicorn configures only its own loggers, so without this the INFO records would be
  dropped at the root logger. Reading a logger is not reading a setting.

## How to run it again

```
sh eval/run.sh
```

from the repository root. Needs Docker and Python 3.12 on PATH. It builds `app/api` into a
container, starts PostgreSQL 16, restarts the application once per row, and writes
`eval/reports/api.xml`. Roughly 75 seconds on this machine. The exam leaves its built image
behind (`equipment-eval-<pid>-api`); I removed the one from my run.
