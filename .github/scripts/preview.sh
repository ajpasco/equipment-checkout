#!/usr/bin/env bash
# pod-preview: runs one pull request's own acceptance tests against main's app/, as information
# for the founder before approving. Runs from main's copy of this repository (the enforcer); the
# pull request's tree is data, and its code runs with no token in its environment, as in the gate.
# It writes nothing to GitHub: its exit code is the result.
#   preview.sh <pr number> <enforcer checkout> <subject checkout>
# In a packet that lands a new row before its story, a fail is expected: the founder reads the
# tail to see that the new rows failed for the stated reason and the old ones passed.
set -euo pipefail
PR="$1"; ENFORCER="$2"; SUBJECT="$3"; REPO="$GITHUB_REPOSITORY"

HEAD_SHA=$(git -C "$SUBJECT" rev-parse HEAD)
MAIN_SHA=$(git -C "$ENFORCER" rev-parse HEAD)
HEAD_REF=$(gh pr view "$PR" --repo "$REPO" --json headRefName -q .headRefName)
echo "pod-preview: eval/ from #$PR ($HEAD_REF) at $HEAD_SHA, app/ from main at $MAIN_SHA"

# The scratch tree, the gate's shape with the sides swapped: the pull request's eval/ and the
# files it travels with, main's app/. A packet changes docs/eval-plan.md together with its rows,
# and a project's eval/run.sh may read it, so the pull request's docs/ goes with its eval/.
WORK=$(mktemp -d)
cp -R "$SUBJECT/eval" "$WORK/eval"
for f in package.json package-lock.json; do [ -f "$SUBJECT/$f" ] && cp "$SUBJECT/$f" "$WORK/"; done
[ -d "$SUBJECT/docs" ] && cp -R "$SUBJECT/docs" "$WORK/docs"
if [ -d "$ENFORCER/app" ]; then cp -R "$ENFORCER/app" "$WORK/app"; else mkdir -p "$WORK/app"; fi
if (cd "$WORK" && env -u GH_TOKEN -u GITHUB_TOKEN sh eval/run.sh) > "$WORK/eval.log" 2>&1; then pass=1; else pass=0; fi
echo "--- eval log (tail)"; tail -n 60 "$WORK/eval.log"; echo "---"

if [ $pass = 1 ]; then
  echo "pod-preview: pass for #$PR at $HEAD_SHA: this pull request's acceptance tests pass against main's app/"
else
  echo "pod-preview: fail for #$PR at $HEAD_SHA: this pull request's acceptance tests FAIL against main's app/"
fi
[ $pass = 1 ]
