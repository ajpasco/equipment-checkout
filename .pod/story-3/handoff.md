# Story 3 handoff: the Compose stack and the journey

Builder's note for the pull request on `story/3`. Written 2026-10-25.

## What I built

Only the seven files `eval/stories/3.txt` allows, plus this note. Nothing in `app/api/app`,
`app/web/src`, `eval/`, `docs/` or `.github/` changed; the stack needed no change to the API or the
client.

- `app/compose.yml`: three services, `db`, `api`, `web`, and the named volume `pgdata`
  (blueprint section 7's name).
  - `db`: `postgres:16.13`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` by interpolation
    with `:?` so a missing value stops Compose; data on `pgdata`; health check `pg_isready`. Not
    published.
  - `api`: built from `./api`; `DATABASE_URL` by interpolation (required); `expose: 8000`, not
    published; waits for `db` healthy; health check `GET /api/users` with `X-User-Id: 1`
    (5.1, DD-04), the same probe the exam's own stacks use.
  - `web`: built from `./web` with the build argument `VITE_API_BASE_URL` (default `/api`);
    published as `127.0.0.1:${WEB_PORT:-8080}:8080`, the loopback only (13.1 Transport says the
    application runs locally on 127.0.0.1); waits for `api` healthy; health check `wget /`.
  - No `env_file`, `container_name`, bind mount or anything else outside the check's list.
    `eval/check_compose.py` accepts it.
- `app/.env.example`: the six settings of section 6 with the section's own placeholders
  (`equipment`, `CHANGE_ME`) and a comment per setting.
- `app/api/Dockerfile`: `python:3.12.15-slim`, `pip install -r requirements.txt` (the lockfile
  first, for layer caching), only `app/` copied, a system user `api` (uid 10001),
  `CMD uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log` (12.4). No setting baked in.
- `app/web/Dockerfile`: build stage `node:22.23.4-slim`, `npm ci`, `vite build`; serving stage
  `nginx:1.27.5-alpine` with my `nginx.conf` as `/etc/nginx/nginx.conf`, run as the image's own
  `nginx` user (uid 101).
- `app/web/nginx.conf`: a whole nginx configuration rather than a `conf.d` server block, because a
  non-root nginx needs its pid file and temporary paths in `/tmp` and a port above 1024 (8080).
  `/api/` is passed, path unchanged, to `http://api:8000`; everything else falls back to
  `index.html`. nginx's access log is off so `app.access` is the only request log (5.4); errors go
  to stderr. No security headers beyond nginx's defaults (13.1 default).
- `app/api/.dockerignore`, `app/web/.dockerignore`: exclude version control, `.env` and `.env.*`,
  tests, caches, `node_modules`, `dist` and local virtual environments (13.1).

Base images are pinned to exact tags inside the 12.10 lines, as the 13.1 default asks; I checked
each tag exists on Docker Hub. The versions are postgres 16.13, Python 3.12.15, Node 22.23.4 and
nginx 1.27.5. I added no dependencies.

## What passes

`sh eval/run.sh` from the repository root exits 0 (Docker 28.1.1, Compose v2.35.1, Node 22.23.2,
Python 3.12.13, macOS arm64):

```
[conventions] clean
[rows] api: pass, 55 of 55 expected rows passed
[rows] browser: pass, 22 of 22 expected rows passed
[rows] journey: pass, 30 of 30 expected rows passed
[exam] PASS: every step ran and every expected row passed
```

The three production rows (T-016-P3, P4, N3) pass, which covers `down -v` as a first start,
`down`/`up -d` keeping committed changes, and no second seeding. I also checked by hand that the
`api` container runs as `uid=10001(api)` and `web` as `uid=101(nginx)`, and that the API log holds
only `app.access` lines (`GET /api/users 200 user=1`).

## Notes for the reviewer

- The `nginx:1.27-alpine` entrypoint prints `can not modify /etc/nginx/conf.d/default.conf`. This
  is harmless: as the non-root user, its IPv6 helper script skips that file. The image's
  `default.conf` is still in place but unused, because my `nginx.conf` does not include `conf.d`.
- No check is turned off anywhere: no `# noqa`, `# nosec`, `eslint-disable` or `gitleaks:allow`.
- I found nothing wrong in the exam's tests and have no convention to dispute.
- The run used Docker Desktop on macOS; I have not run it on the gate's Linux host.
