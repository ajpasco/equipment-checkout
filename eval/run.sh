#!/bin/sh
# The exam. Run from the repository root, or from the gate's scratch tree, which holds main's
# `eval/` beside the pull request's `app/`. Exit 0 means every step ran and every expected row
# passed.
#
# First the plan check (eval/check_plan.py), which is not a row: every automated row of
# docs/eval-plan.md section 3 must be listed in exactly one group's rows.txt, so that no row is left
# out of the exam unnoticed. Then the conventions step (eval/conventions.sh), which is not a row
# either: pinned linters and a secret scan over app/, failing the exam when one of them fails. Then
# six groups of rows, in this order, each run whatever happened to the one before:
#   unit rows (mechanism U)     eval/unit, the rules layer of app/api imported by pytest inside a
#                               Python container with no network and no database setting
#   API rows (mechanism I)      eval/api, against app/api in its own container (eval/compose.yml)
#   database row (mechanism D)  eval/db, app/api's own app.db writing to the API stack's database,
#                               by pytest inside a Python container on that stack's network, before
#                               the stack is taken down
#   component rows (mechanism C) eval/component, the client's src/App.jsx rendered in jsdom by
#                               Vitest inside a Node container with no network
#   browser rows (mechanism B)  eval/web, against the production build of app/web served by the
#                               exam's stack (eval/stack/compose.yml), every /api call faked
#   journey rows (mechanism J)  eval/e2e, against the application's own stack, app/compose.yml,
#                               with the real API and database; the production rows among them stop
#                               and start it. Before it starts, eval/check_compose.py refuses a
#                               compose file that asks for more of this machine than the stack needs
# Then the row check (eval/check_rows.py) reads each report and fails unless every id listed in the
# six groups' rows.txt has a passing case, or is deferred by the founder in eval/deferred.txt. A
# runner's own exit code is not trusted to say that: a skipped case does not fail pytest, and
# Playwright reports the production rows as skipped when a journey row fails.
#
# Nothing the builder wrote runs on this machine outside a container. The application and the web
# client are built and run inside containers, and the builder's compose file may give them nothing
# of this machine's but published ports (eval/check_compose.py). The API, browser and journey rows
# run here, with tools installed only from the exam's own pinned lists: the Python tools from
# eval/api/requirements-eval.txt by hash into a fresh virtual environment, and Playwright from
# eval/web's and eval/e2e's own lockfiles. The unit, database and component rows import the
# builder's code into the test process, so they run inside containers instead (the in-process
# groups below): app/ and the tests are mounted read-only, the builder's own packages are installed
# in there and nowhere else, and only the JUnit report comes back out.
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
RUN="equipment-eval-$$"
API_PROJECT="$RUN-api"
STACK_PROJECT="$RUN-stack"
STACK_FILE="$ROOT/eval/stack/compose.yml"
APP_PROJECT="$RUN-app"
APP_FILE="$ROOT/app/compose.yml"
ENV_FILE="$ROOT/eval/e2e/eval.env"
WEB_PORT=$(sed -n 's/^WEB_PORT=//p' "$ENV_FILE")
REPORTS="$ROOT/eval/reports"

api() { docker compose -p "$API_PROJECT" -f "$ROOT/eval/compose.yml" "$@"; }
stack() { docker compose -p "$STACK_PROJECT" -f "$STACK_FILE" --env-file "$ENV_FILE" "$@"; }
app_stack() { docker compose -p "$APP_PROJECT" -f "$APP_FILE" --env-file "$ENV_FILE" "$@"; }
app_allowed=0

# The in-process groups: pinned images, and one volume each for what is installed inside them.
PYTHON_IMAGE=python:3.12.15-slim
NODE_IMAGE=node:22.23.4-slim
PY_VOLUME="$RUN-pytest"
WEB_VOLUME="$RUN-component"
# The rows run as this machine's user, so the report they write into eval/reports is this user's.
HOST_ID="$(id -u):$(id -g)"
cleanup() {
  for box in pytest-tools unit db component-tools component; do docker rm -f "$RUN-$box" >/dev/null 2>&1 || true; done
  docker volume rm -f "$PY_VOLUME" "$WEB_VOLUME" >/dev/null 2>&1 || true
  api down -v --remove-orphans >/dev/null 2>&1 || true
  stack down -v --remove-orphans >/dev/null 2>&1 || true
  [ "$app_allowed" = 1 ] && { app_stack down -v --remove-orphans >/dev/null 2>&1 || true; }
}
trap cleanup EXIT
trap 'exit 130' INT TERM

failed=""
fail() { failed="$failed
  $1"; echo "[exam] step failed: $1" >&2; }

# Preconditions. Without these nothing can be graded, so the run stops here.
PY=$(command -v python3.12 || command -v python3)
"$PY" -c 'import sys; assert sys.version_info[:2] == (3, 12), sys.version' || { echo "the exam needs Python 3.12 on PATH" >&2; exit 2; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) === 22 ? 0 : 1)' 2>/dev/null || { echo "the exam needs Node.js 22 on PATH" >&2; exit 2; }
docker compose version >/dev/null 2>&1 || { echo "the exam needs Docker with Compose v2" >&2; exit 2; }

rm -rf "$REPORTS"
mkdir -p "$REPORTS"

# ---------------------------------------------------------------- the plan check
# Not a row: every automated row of the plan is in exactly one group's rows.txt, and every listed id
# is a row of the plan (eval/check_plan.py). Standard library only, run with -I.
echo "[exam] plan check: every automated row of docs/eval-plan.md is in exactly one group"
"$PY" -I eval/check_plan.py || fail "plan check: the groups' row lists do not match docs/eval-plan.md section 3 (see [plan] above)"

# ---------------------------------------------------------------- the conventions step
# Not a row: pinned formatters, linters and scanners over app/ (eval/conventions.sh). It runs first
# and, like every step, does not stop the ones after it.
echo "[exam] conventions: the pinned tools over app/"
sh "$ROOT/eval/conventions.sh" || fail "conventions: a pinned tool reported problems in app/ (see [conventions] above)"

# ------------------------------------------------- pytest inside a container, for the U and D rows
# The unit and database rows import app/api's own modules into the process that runs them, so that
# process runs in a container: python:3.12.15-slim, with app/api mounted read-only. A virtual
# environment is built once, on a volume, by a first container that has the network: the builder's
# app/api/requirements.txt first, then the exam's pytest by hash from eval/unit/requirements-eval.txt
# with --force-reinstall, so that a pytest the builder named is replaced by the verified one. The
# rows then run in second containers that mount that environment read-only and are given, by name,
# the only settings they get; nothing of this machine's environment is passed in.
pytools=untried
pytest_tools() {
  if [ "$pytools" = untried ]; then
    echo "[exam] in-process rows: the builder's Python packages and the exam's pytest, inside $PYTHON_IMAGE"
    if docker volume create "$PY_VOLUME" >/dev/null \
      && docker run --rm --name "$RUN-pytest-tools" \
        -e PIP_DISABLE_PIP_VERSION_CHECK=1 -e PIP_NO_CACHE_DIR=1 -e PIP_ROOT_USER_ACTION=ignore \
        -v "$ROOT/app/api:/src/api:ro" \
        -v "$ROOT/eval/unit/requirements-eval.txt:/exam/requirements-eval.txt:ro" \
        -v "$PY_VOLUME:/venv" \
        "$PYTHON_IMAGE" sh -ec '
          python -m venv /venv/env
          if [ -f /src/api/requirements.txt ]; then /venv/env/bin/python -m pip install --quiet -r /src/api/requirements.txt; fi
          /venv/env/bin/python -m pip install --quiet --require-hashes --force-reinstall -r /exam/requirements-eval.txt
          chown -R "$0" /venv' "$HOST_ID"; then
      pytools=ok
    else
      pytools=failed
      fail "unit and database rows: the builder's packages or the exam's pytest could not be installed in the container"
    fi
  fi
  [ "$pytools" = ok ]
}

# One pytest run inside the container: in_process_pytest <name> <report> <docker run options...>
# The tests are mounted read-only under /exam/tests; the frozen pytest.ini is passed with -c, so
# nothing the builder writes configures the run, and plugin autoload is off.
in_process_pytest() {
  name=$1 report=$2; shift 2
  docker run --rm --name "$RUN-$name" --user "$HOST_ID" \
    -e PYTHONPATH=/src/api -e PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 -e PYTHONDONTWRITEBYTECODE=1 -e HOME=/tmp \
    -v "$PY_VOLUME:/venv:ro" -v "$ROOT/app/api:/src/api:ro" \
    -v "$ROOT/eval/api/pytest.ini:/exam/pytest.ini:ro" -v "$REPORTS:/reports" \
    -w /exam "$@" \
    "$PYTHON_IMAGE" /venv/env/bin/python -m pytest -c /exam/pytest.ini --rootdir /exam/tests \
      "/exam/tests/$name" -q --junitxml="/reports/$report"
}

# ---------------------------------------------------------------- the U rows
# The rules layer taken one decision at a time: no network, and no DATABASE_URL or
# TEST_DATABASE_URL in the environment at all (eval plan 7.2, C3).
if [ ! -d "$ROOT/app/api/app" ]; then
  echo "[exam] unit rows: there is no API in this tree (app/api/app is absent)," \
    "so every unit row fails by absence" >&2
  fail "unit rows: app/api/app is absent"
elif pytest_tools; then
  echo "[exam] unit rows: running inside $PYTHON_IMAGE, no network"
  in_process_pytest unit unit.xml --network none -v "$ROOT/eval/unit:/exam/tests/unit:ro" \
    || fail "unit rows: pytest reported failures"
fi

# ---------------------------------------------------------------- the API rows
echo "[exam] API rows: starting the application from this tree's app/api"
if api up -d --build --wait --wait-timeout 180; then
  echo "[exam] API rows: the exam's tools, pinned by hash"
  if "$PY" -m venv --clear "$ROOT/.eval-venv" \
    && "$ROOT/.eval-venv/bin/python" -m pip install --quiet --require-hashes -r "$ROOT/eval/api/requirements-eval.txt"; then
    echo "[exam] API rows: running"
    API_BASE_URL=http://127.0.0.1:18000 \
    TEST_DATABASE_URL=postgresql://eval:eval-only@127.0.0.1:18432/equipment_eval \
    EVAL_COMPOSE_PROJECT="$API_PROJECT" EVAL_COMPOSE_FILE="$ROOT/eval/compose.yml" \
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 \
    "$ROOT/.eval-venv/bin/python" -m pytest -c "$ROOT/eval/api/pytest.ini" --rootdir "$ROOT/eval/api" \
      "$ROOT/eval/api" -q --junitxml="$REPORTS/api.xml" || fail "API rows: pytest reported failures"
  else
    fail "API rows: the exam's Python tools could not be installed"
  fi
else
  echo "[exam] API rows: the application did not start; its log:" >&2
  api logs --no-color --tail 60 api >&2 || true
  fail "API rows: the application in app/api did not start"
fi

# ---------------------------------------------------------------- the D row
# The data store written to directly through app/api's own app.db, on the API stack's PostgreSQL 16
# before it is taken down. The row's fixture drops and rebuilds the tables, so it runs after the API
# rows and never beside them. The database service is (re)started on its own here, so that an API
# that failed to start does not take this row's verdict with it.
if [ ! -d "$ROOT/app/api/app" ]; then
  echo "[exam] database row: there is no API in this tree (app/api/app is absent)," \
    "so the database row fails by absence" >&2
  fail "database row: app/api/app is absent"
elif ! api up -d --wait --wait-timeout 120 db; then
  fail "database row: the API stack's database did not start"
elif pytest_tools; then
  echo "[exam] database row: running inside $PYTHON_IMAGE, on the API stack's network"
  # The unit tree's conftest.py is the shared one (it ties each case to its row); the db tree's own
  # conftest.py holds the fixture.
  in_process_pytest db db.xml --network "${API_PROJECT}_default" \
    -e TEST_DATABASE_URL=postgresql+psycopg://eval:eval-only@db:5432/equipment_eval \
    -v "$ROOT/eval/unit/conftest.py:/exam/tests/conftest.py:ro" -v "$ROOT/eval/db:/exam/tests/db:ro" \
    || fail "database row: pytest reported failures"
fi
api down -v --remove-orphans >/dev/null 2>&1 || true
docker volume rm -f "$PY_VOLUME" >/dev/null 2>&1 || true

# ---------------------------------------------------------------- the C rows
# The client's src/App.jsx rendered in jsdom by Vitest, global fetch replaced by the exam's fake
# server. Inside node:22.23.4-slim, in two containers sharing one volume. The first has the network:
# it copies app/web (read-only) without node_modules, dist or tests and runs the client's own npm ci,
# whose install scripts may run there and nowhere else; then, so that nothing those scripts left can
# stand in for the exam, it puts the exam's tests where the client's tests/component would be and
# installs the exam's tools from eval/component's own lockfile with install scripts off. The second
# runs the rows with no network, given nothing of this machine's environment, and writes
# eval/reports/component.xml.
if [ ! -f "$ROOT/app/web/src/App.jsx" ]; then
  echo "[exam] component rows: there is no web client in this tree (app/web/src/App.jsx is absent)," \
    "so every component row fails by absence" >&2
  fail "component rows: app/web/src/App.jsx is absent"
else
  echo "[exam] component rows: the client's packages and the exam's tools, inside $NODE_IMAGE"
  if docker volume create "$WEB_VOLUME" >/dev/null \
    && docker run --rm --name "$RUN-component-tools" \
      -e npm_config_update_notifier=false -e npm_config_fund=false -e npm_config_audit=false \
      -v "$ROOT/app/web:/src/web:ro" -v "$ROOT/eval/component:/src/exam:ro" -v "$WEB_VOLUME:/work" \
      "$NODE_IMAGE" sh -ec '
        mkdir -p /work/web
        cd /src/web
        tar -cf - --exclude=./node_modules --exclude=./dist --exclude=./tests . | tar -xf - -C /work/web
        cd /work/web
        npm ci --loglevel=error
        rm -rf /work/web/tests /work/harness
        mkdir -p /work/web/tests/component /work/harness/web
        cp /src/exam/_*.js /src/exam/*.test.js /work/web/tests/component/
        cp /src/exam/package.json /src/exam/package-lock.json /src/exam/vitest.config.js /work/harness/web/
        cd /work/harness/web
        npm ci --ignore-scripts --loglevel=error
        chown -R "$0" /work' "$HOST_ID"; then
    echo "[exam] component rows: running inside $NODE_IMAGE, no network"
    docker run --rm --name "$RUN-component" --network none --user "$HOST_ID" -e HOME=/tmp \
      -v "$WEB_VOLUME:/work" -v "$REPORTS:/reports" -w /work \
      "$NODE_IMAGE" node /work/harness/web/node_modules/vitest/vitest.mjs run \
        --root /work/web --config /work/harness/web/vitest.config.js \
        --outputFile.junit=/reports/component.xml \
      || fail "component rows: Vitest reported failures"
  else
    fail "component rows: the client's packages or the exam's tools could not be installed in the container"
  fi
  docker volume rm -f "$WEB_VOLUME" >/dev/null 2>&1 || true
fi

# ------------------------------------------------- Playwright, for the B and J rows
# Installed once, the first time a group of rows has something to run against.
tools=untried
playwright_tools() {
  if [ "$tools" = untried ]; then
    echo "[exam] Playwright and Chromium, from the exam's own lockfiles"
    if npm ci --prefix "$ROOT/eval/web" --ignore-scripts --no-audit --no-fund --loglevel=error \
      && npm ci --prefix "$ROOT/eval/e2e" --ignore-scripts --no-audit --no-fund --loglevel=error \
      && "$ROOT/eval/web/node_modules/.bin/playwright" install chromium; then
      tools=ok
    else
      tools=failed
      fail "browser and journey rows: Playwright could not be installed"
    fi
  fi
  [ "$tools" = ok ]
}

# ------------------------------------------------- the B rows, on the exam's own stack
if [ ! -f "$ROOT/app/web/package.json" ]; then
  echo "[exam] browser rows: there is no web client in this tree (app/web/package.json is absent)," \
    "so every browser row fails by absence" >&2
  fail "browser rows: app/web/package.json is absent"
else
  echo "[exam] browser rows: building app/web for production inside a container and starting the exam's stack"
  if stack up -d --build --wait --wait-timeout 300; then
    if playwright_tools; then
      echo "[exam] browser rows: running"
      BROWSER_BASE_URL="http://127.0.0.1:$WEB_PORT" \
        "$ROOT/eval/web/node_modules/.bin/playwright" test --config "$ROOT/eval/web/playwright.config.js" \
        || fail "browser rows: Playwright reported failures"
    fi
  else
    echo "[exam] browser rows: the exam's stack did not start; its log:" >&2
    stack logs --no-color --tail 60 >&2 || true
    fail "browser rows: eval/stack/compose.yml did not start with this tree's app/"
  fi
fi
stack down -v --remove-orphans >/dev/null 2>&1 || true

# ------------------------------------------------- the J rows, on the application's own stack
if [ ! -f "$APP_FILE" ]; then
  echo "[exam] journey rows: there is no stack in this tree (app/compose.yml is absent)," \
    "so every journey row fails by absence" >&2
  fail "journey rows: app/compose.yml is absent"
elif ! "$PY" -I eval/check_compose.py app/compose.yml "$APP_PROJECT" "$ENV_FILE" app; then
  fail "journey rows: app/compose.yml asks for something the exam does not start (see [compose] above)"
else
  app_allowed=1
  echo "[exam] journey rows: starting app/compose.yml with eval/e2e/eval.env"
  if app_stack up -d --build --wait --wait-timeout 300; then
    if playwright_tools; then
      echo "[exam] journey rows: running"
      E2E_BASE_URL="http://localhost:$WEB_PORT" \
      EVAL_STACK_FILE="$APP_FILE" EVAL_STACK_PROJECT="$APP_PROJECT" \
        "$ROOT/eval/e2e/node_modules/.bin/playwright" test --config "$ROOT/eval/e2e/playwright.config.js" \
        || fail "journey rows: Playwright reported failures"
    fi
  else
    echo "[exam] journey rows: app/compose.yml did not start; its log:" >&2
    app_stack logs --no-color --tail 60 >&2 || true
    fail "journey rows: app/compose.yml did not start with eval/e2e/eval.env"
  fi
  app_stack down -v --remove-orphans >/dev/null 2>&1 || true
fi

# ------------------------------------------------------------------ the row check
echo "[exam] the row check: every expected row id needs a passing case in its report"
rows_failed=""
for group in "unit unit.xml eval/unit/rows.txt" "api api.xml eval/api/rows.txt" "database db.xml eval/db/rows.txt" \
  "component component.xml eval/component/rows.txt" "browser browser.xml eval/web/rows.txt" "journey journey.xml eval/e2e/rows.txt"; do
  set -- $group
  "$PY" -I eval/check_rows.py "$1" "eval/reports/$2" "$3" || rows_failed="$rows_failed $1"
done

echo "[exam] reports: eval/reports/unit.xml, api.xml, db.xml, component.xml, browser.xml, journey.xml"
if [ -z "$failed" ] && [ -z "$rows_failed" ]; then
  echo "[exam] PASS: every step ran and every expected row passed"
  exit 0
fi
[ -n "$failed" ] && echo "[exam] steps that failed:$failed"
[ -n "$rows_failed" ] && echo "[exam] row lists not satisfied:$rows_failed"
echo "[exam] FAIL"
exit 1
