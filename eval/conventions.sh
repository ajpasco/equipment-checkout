#!/bin/sh
# The conventions step (docs/TECH-SPEC.md, section 14). eval/run.sh calls it first. It is not a
# row: it asserts no business outcome, traces to no requirement, and has no id and no trace. It runs
# pinned tools from eval/ against app/ and fails when one of them fails. Its tools and their
# configuration live under eval/conventions/, so a builder can change them no more than it can
# change a test, and every tool is passed its configuration explicitly so that nothing a builder
# puts under app/ is read as configuration.
#
# Two rules this file keeps. An empty app/ has nothing to check and passes: the rows, not this step,
# fail by absence. And a tool joins the step only once it runs clean on the trunk's app/ as it
# stands, so that the next story is never blocked for a reason it did not cause.
#
#   secret scan  gitleaks 8.30.1, in its own container, over all of app/
#   Python lint  ruff 0.15.9 check, over every Python file in app/
#   Python security lint  bandit 1.8.3, over every Python file in app/
#   JavaScript lint  ESLint 9.39.5 with the React plugins, over every .js and .jsx file in app/
#
# Each tool runs whatever happened to the one before, and the step fails if any of them failed.
# Nothing under app/ is installed or executed: the Python tools come from
# eval/conventions/requirements.txt by hash, into a fresh virtual environment outside the tree, and
# the JavaScript tools from eval/conventions' own lockfile with install scripts switched off.
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
CONV="$ROOT/eval/conventions"
GITLEAKS="zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"

# What a builder's machine may hold that the gate's copy never does: installed packages, virtual
# environments and a local production build. None of it is the builder's code.
not_code() {
  find app \( -name node_modules -o -name .venv -o -name venv -o -name dist -o -name __pycache__ \) -prune \
    -o -type f "$@" -print
}

if [ ! -d app ] || [ -z "$(not_code | head -1)" ]; then
  echo "[conventions] app/ is empty; nothing to check"
  exit 0
fi

failed=""
fail() { failed="$failed
  $1"; echo "[conventions] failed: $1" >&2; }

VENV=$(mktemp -d "${TMPDIR:-/tmp}/eval-conventions.XXXXXX")
trap 'rm -rf "$VENV"' EXIT
trap 'exit 130' INT TERM

# ---------------------------------------------------------------- secret scan
# gitleaks reads files, not git history, so the gate's copied tree is enough. app/ is mounted one
# level below the folder it scans, because gitleaks also reads a .gitleaks.toml and a .gitleaksignore
# from that folder; mounted this way, the only configuration it reads is the one passed with
# --config. --redact keeps a found secret out of the log.
echo "[conventions] secret scan: gitleaks over app/"
docker run --rm \
  -v "$ROOT/app:/tree/app:ro" -v "$CONV/gitleaks.toml:/eval/gitleaks.toml:ro" \
  "$GITLEAKS" detect --no-git --source /tree --config /eval/gitleaks.toml --redact --no-banner --verbose \
  || fail "secret scan: gitleaks found a secret in app/, or could not run"

# ---------------------------------------------------------------- Python
if [ -n "$(not_code -name '*.py' | head -1)" ]; then
  echo "[conventions] Python: the step's tools, pinned by hash"
  PY=$(command -v python3.12 || command -v python3)
  if "$PY" -m venv "$VENV/py" \
    && "$VENV/py/bin/python" -m pip install --quiet --disable-pip-version-check --require-hashes \
      -r "$CONV/requirements.txt"; then
    echo "[conventions] Python lint: ruff check"
    "$VENV/py/bin/ruff" check --config "$CONV/ruff.toml" --no-cache app \
      || fail "Python lint: ruff check reported problems"
    echo "[conventions] Python security lint: bandit"
    "$VENV/py/bin/bandit" --ini "$CONV/bandit.ini" -q -r app \
      || fail "Python security lint: bandit reported problems"
  else
    fail "Python: the step's tools could not be installed"
  fi
else
  echo "[conventions] Python: no Python file in app/; nothing to check"
fi

# ---------------------------------------------------------------- JavaScript
if [ -n "$(not_code \( -name '*.js' -o -name '*.jsx' \) | head -1)" ]; then
  echo "[conventions] JavaScript: the step's tools, from eval/conventions' lockfile"
  if npm ci --prefix "$CONV" --ignore-scripts --no-audit --no-fund --loglevel=error; then
    echo "[conventions] JavaScript lint: ESLint"
    "$CONV/node_modules/.bin/eslint" --config "$CONV/eslint.config.js" --max-warnings 0 app \
      || fail "JavaScript lint: ESLint reported problems"
  else
    fail "JavaScript: the step's tools could not be installed"
  fi
else
  echo "[conventions] JavaScript: no JavaScript file in app/; nothing to check"
fi

if [ -n "$failed" ]; then
  echo "[conventions] FAIL:$failed"
  exit 1
fi
echo "[conventions] clean"
