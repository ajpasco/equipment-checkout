#!/usr/bin/env bash
# pod-gate: judges one pull request and writes the `pod-gate` check run on its head commit.
# Runs from main's copy of this repository (the enforcer); the pull request's tree is data.
#   gate.sh <pr number> <enforcer checkout> <subject checkout>
set -euo pipefail
PR="$1"; ENFORCER="$2"; SUBJECT="$3"; REPO="$GITHUB_REPOSITORY"

HEAD_SHA=$(git -C "$SUBJECT" rev-parse HEAD)
HEAD_REF=$(gh pr view "$PR" --repo "$REPO" --json headRefName -q .headRefName)
BASE=$(git -C "$SUBJECT" merge-base origin/main HEAD)
mapfile -t CHANGED < <(git -C "$SUBJECT" diff --name-only "$BASE" HEAD)
lines=(); fail=0

is_protected() { case "$1" in eval/*|.github/*|docs/*|package.json) return 0;; *) return 1;; esac; }

# 1. Scope. A story pull request (branch story/<n>) may change only what eval/stories/<n>.txt on
#    main allows, plus .pod/story-<n>/ for its builder's handoff note. Any other pull request may
#    change only protected paths.
story=$(sed -n 's#^story/\([0-9][0-9]*\).*#\1#p' <<<"$HEAD_REF")
if [ -n "$story" ]; then
  scope_file="$ENFORCER/eval/stories/$story.txt"
  if [ ! -f "$scope_file" ]; then
    lines+=("scope: story $story has no scope file on main"); fail=1
  else
    mapfile -t GLOBS < "$scope_file"; GLOBS+=(".pod/story-$story/*"); bad=0
    for p in "${CHANGED[@]}"; do
      ok=0; for g in "${GLOBS[@]}"; do [ -z "$g" ] && continue; case "$p" in $g) ok=1;; esac; done
      [ $ok = 1 ] || { lines+=("scope: $p is outside story $story's scope (${GLOBS[*]})"); bad=1; }
    done
    if [ $bad = 1 ]; then fail=1; else lines+=("scope: all ${#CHANGED[@]} changed files are inside story $story's scope"); fi
  fi
else
  bad=0
  for p in "${CHANGED[@]}"; do is_protected "$p" || { lines+=("scope: $p changed by a pull request that is not a story; only eval/, .github/ and docs/ may change here"); bad=1; }; done
  if [ $bad = 1 ]; then fail=1; else lines+=("scope: a non-story pull request touching protected paths only"); fi
fi

# 2. Protected paths need the founder's approval on this exact commit: a commit status
#    pod/approval = success. A new push is a new commit with no status, so nothing stays approved
#    after it changes.
needs=0; for p in "${CHANGED[@]}"; do is_protected "$p" && needs=1; done
if [ $needs = 1 ]; then
  state=$(gh api "repos/$REPO/commits/$HEAD_SHA/status" -q '[.statuses[] | select(.context=="pod/approval")][0].state // empty' || true)
  if [ "$state" = "success" ]; then
    lines+=("approval: pod/approval is success on $HEAD_SHA")
  else
    lines+=("approval: waiting for the founder. This pull request changes a protected path and commit $HEAD_SHA carries no pod/approval status. The founder runs: pod approve $PR"); fail=1
  fi
fi

# 3. The eval, from main's copy, against the pull request's app/. The pull request's code runs
#    with no token in its environment, so it cannot write a check run for itself.
WORK=$(mktemp -d)
cp -R "$ENFORCER/eval" "$WORK/eval"
# The eval plan, from main, which eval/check_plan.py checks the exam's row lists against.
mkdir -p "$WORK/docs"; cp "$ENFORCER/docs/eval-plan.md" "$WORK/docs/eval-plan.md"
for f in package.json package-lock.json; do [ -f "$ENFORCER/$f" ] && cp "$ENFORCER/$f" "$WORK/"; done
if [ -d "$SUBJECT/app" ]; then cp -R "$SUBJECT/app" "$WORK/app"; else mkdir -p "$WORK/app"; fi
if (cd "$WORK" && env -u GH_TOKEN -u GITHUB_TOKEN sh eval/run.sh) > "$WORK/eval.log" 2>&1; then
  lines+=("eval: main's eval passes against this pull request's app/")
else
  lines+=("eval: main's eval FAILS against this pull request's app/"); fail=1
fi
echo "--- eval log (tail)"; tail -n 25 "$WORK/eval.log"; echo "---"

# 4. The verdict, as a check run on the head commit, written by the Actions app.
if [ $fail = 0 ]; then conclusion=success; else conclusion=failure; fi
summary=$(printf '%s\n' "${lines[@]}")
gh api "repos/$REPO/check-runs" --method POST \
  -f name=pod-gate -f head_sha="$HEAD_SHA" -f status=completed -f conclusion="$conclusion" \
  -f "output[title]=pod-gate: $conclusion" -f "output[summary]=$summary" > /dev/null
echo "pod-gate: $conclusion for #$PR at $HEAD_SHA (${GITHUB_EVENT_NAME})"; printf '  %s\n' "${lines[@]}"
[ $fail = 0 ]
