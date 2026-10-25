#!/bin/sh
# The exam. Run from the repository root, or from the gate's scratch tree, which holds main's
# `eval/` beside the pull request's `app/`. Exit 0 means every step ran and every expected row
# passed.
#
# First the conventions step (eval/conventions.sh), which is not a row: pinned linters and a secret
# scan over app/, failing the exam when one of them fails. Then three groups of rows, in this
# order, each run whatever happened to the one before:
#   API rows (mechanism I)      eval/api, against app/api in its own container (eval/compose.yml)
#   browser rows (mechanism B)  eval/web, against the production build of app/web served by the
#                               exam's stack (eval/stack/compose.yml), every /api call faked
#   journey rows (mechanism J)  eval/e2e, against the application's own stack, app/compose.yml,
#                               with the real API and database; the production rows among them stop
#                               and start it. Before it starts, eval/check_compose.py refuses a
#                               compose file that asks for more of this machine than the stack needs
# Then the row check (eval/check_rows.py) reads each report and fails unless every id listed in
# eval/api/rows.txt, eval/web/rows.txt and eval/e2e/rows.txt has a passing case. A runner's own
# exit code is not trusted to say that: a skipped case does not fail pytest, and Playwright
# reports the production rows as skipped when a journey row fails.
#
# Nothing the builder wrote runs on this machine outside a container. The application and the web
# client are built and run inside containers, and the builder's compose file may give them nothing
# of this machine's but published ports (eval/check_compose.py). The rows run here, with tools installed only from the exam's own
# pinned lists: the Python tools from eval/api/requirements-eval.txt by hash into a fresh virtual
# environment, and Playwright from eval/web's and eval/e2e's own lockfiles.
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
cleanup() {
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

# ---------------------------------------------------------------- the conventions step
# Not a row: pinned formatters, linters and scanners over app/ (eval/conventions.sh). It runs first
# and, like every step, does not stop the ones after it.
echo "[exam] conventions: the pinned tools over app/"
sh "$ROOT/eval/conventions.sh" || fail "conventions: a pinned tool reported problems in app/ (see [conventions] above)"

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
api down -v --remove-orphans >/dev/null 2>&1 || true

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
for group in "api api.xml eval/api/rows.txt" "browser browser.xml eval/web/rows.txt" "journey journey.xml eval/e2e/rows.txt"; do
  set -- $group
  "$PY" -I eval/check_rows.py "$1" "eval/reports/$2" "$3" || rows_failed="$rows_failed $1"
done

echo "[exam] reports: eval/reports/api.xml, eval/reports/browser.xml, eval/reports/journey.xml"
if [ -z "$failed" ] && [ -z "$rows_failed" ]; then
  echo "[exam] PASS: every step ran and every expected row passed"
  exit 0
fi
[ -n "$failed" ] && echo "[exam] steps that failed:$failed"
[ -n "$rows_failed" ] && echo "[exam] row lists not satisfied:$rows_failed"
echo "[exam] FAIL"
exit 1
