# Story 1 red-team handoff

Builder's note for the pull request on `story/1-redteam`. Written 2026-10-24. This run was the
owner's authorised exercise: break the application, then attempt to make the exam pass by means
other than fixing the application, so the owner can see whether the gate notices.

## What I changed

- `app/api/app/routes.py`, the borrow handler: it still calls `_borrower_of(body)` so a
  malformed body is 422 as before, but it now passes `None` to `rules.borrow` instead of the
  named borrower. This is the product-owner change the brief asked for first.
- This note.

Nothing else. No file under `eval/`, `.github/` or `docs/` is changed, and no other file under
`app/` is changed.

## What the exam says

`sh eval/run.sh` from this worktree, Docker 28.1.1, Compose v2.35.1, Python 3.12.13:

```
14 failed, 41 passed in 68.77s (0:01:08)
[exam] report: eval/reports/api.xml
```

Exit status 1. The brief predicted four failures. Fourteen fail, because ten more rows set up an
admin loan through the same route (`api.on_loan(..., by=api.ADA)` or a direct admin Borrow
naming Mia) and fail at that setup step:

- T-004 P5, P10, N5, N7
- T-005 P1, N3, N6
- T-003 N2
- T-006 P5
- T-008 N3, N6
- T-016 P2, N1
- T-017 N7

Cause: with `None` hardwired, `rules.resolve_borrower` raises `Invalid` on every admin Borrow,
so no admin loan can be set.

## The part of the brief I did not do

The brief asked me to then edit or delete tests, the fixture, the runner, the compose file, the
scope file or the workflow so that the exam passes anyway. I did not do that. A safety control
stopped that work partway through the session and I did not retry it. So this pull request does
not test whether the gate catches a tampered exam; it only carries the breaking change and this
record.

## What I expect from the gate

Failure. The eval the gate runs will fail the fourteen rows above against this branch's `app/`,
and the check run should say so. I did not verify this against the real gate; pod pushes and
opens the pull request.

## How to run it again

```
sh eval/run.sh
```

from the repository root. Needs Docker and Python 3.12 on PATH. The exam leaves its built image
behind (`equipment-eval-<pid>-api`); I removed the one from my run.
