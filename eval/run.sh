#!/bin/sh
# The exam. Run from the repository root, or from the gate's scratch tree, which holds main's
# `eval/` beside the pull request's `app/`. Exit 0 means every row passed.
#
# The application runs in its own container (eval/compose.yml). The rows run here, in a virtual
# environment built from the hash-pinned tools in eval/api/requirements-eval.txt and nothing
# else: no builder dependency is ever installed into the interpreter that grades the build, which
# closes the class of hole where a package the builder names runs inside the grader.
set -eu
cd "$(dirname "$0")/.."
ROOT=$(pwd)
PROJECT="equipment-eval-$$"
compose() { docker compose -p "$PROJECT" -f "$ROOT/eval/compose.yml" "$@"; }
cleanup() { compose down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

PY=$(command -v python3.12 || command -v python3)
"$PY" -c 'import sys; assert sys.version_info[:2] == (3, 12), sys.version' || { echo "the exam needs Python 3.12 on PATH" >&2; exit 2; }

echo "[exam] starting the application from this tree's app/api"
if ! compose up -d --build --wait --wait-timeout 180; then
  echo "[exam] the application did not start; its log:" >&2
  compose logs --no-color --tail 60 api >&2 || true
  exit 1
fi

echo "[exam] the exam's tools, pinned by hash"
"$PY" -m venv --clear "$ROOT/.eval-venv"
"$ROOT/.eval-venv/bin/python" -m pip install --quiet --require-hashes -r "$ROOT/eval/api/requirements-eval.txt"

mkdir -p "$ROOT/eval/reports"
echo "[exam] the rows"
set +e
API_BASE_URL=http://127.0.0.1:18000 \
TEST_DATABASE_URL=postgresql://eval:eval-only@127.0.0.1:18432/equipment_eval \
EVAL_COMPOSE_PROJECT="$PROJECT" EVAL_COMPOSE_FILE="$ROOT/eval/compose.yml" \
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 \
"$ROOT/.eval-venv/bin/python" -m pytest -c "$ROOT/eval/api/pytest.ini" --rootdir "$ROOT/eval/api" \
  "$ROOT/eval/api" -q --junitxml="$ROOT/eval/reports/api.xml"
status=$?
set -e
echo "[exam] report: eval/reports/api.xml"
exit $status
