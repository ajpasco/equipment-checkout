# Story 2 handoff: the whole web client

Builder's note for the pull request on `story/2`. Written 2026-10-24.

## What I built

Only files under `app/web/` that `eval/stories/2.txt` allows, plus this note. No Dockerfile,
nginx configuration or `.dockerignore` (story 3's).

- `package.json`, `package-lock.json`: React 18.3.1, react-dom 18.3.1, Vite 5.4.21,
  `@vitejs/plugin-react` 4.7.0 (blueprint 12.10 lines). JavaScript, no TypeScript. Every
  `resolved` URL in the lockfile is `registry.npmjs.org`, so `npm ci` in the container needs
  nothing private.
- `index.html` with `<div id="root">`; `vite.config.js` (the React plugin only).
- `src/main.jsx` mounts `src/App.jsx`, whose default export `App` takes no props.
- `src/api.js`: the only HTTP path. It calls `globalThis.fetch` at the moment of each call with
  `fetch(url, { method, headers })`, `headers` a plain object holding `X-User-Id`, plus
  `Content-Type` and a JSON `body` only when there is a body. The base is
  `import.meta.env.VITE_API_BASE_URL` or `/api`. An answer settles to one of four outcomes:
  200 confirmed, 403 refused, 422 invalid, and everything else, including a rejected `fetch` or a
  200 whose body is not JSON, failed.
- `src/names.js`: the name check of 12.7 and DD-21. It trims with Python's `str.isspace` set and
  counts code points. I checked it in Node against every BMP code point: the trim matches the
  server's set with no mismatches, and 100 emoji count as 100.
- `src/App.jsx`: the switcher (a client constant, DD-07; the placeholder exists only before a pick),
  the role badge, the state demos, the list, the rows and their icon buttons, the Add panel with its
  inline message and `add-loader`, and the four modals. Every `data-testid`, `title`, `aria-label`
  and string is taken from 12.8 and 12.9.
- `src/icons.jsx`: the mockup's SVG paths. `src/styles.css`: the mockup's values.

Behaviour worth knowing when reviewing:

- **Outcome by class (12.3.1, 12.7).** 403 opens Access denied; 422 on an Add shows the inline
  message (over-length if the client's own count is over 100, otherwise "Name is required."); every
  other non-200 opens the API failure modal. The list fetch follows the same rule. Retry repeats the
  very same request: the same item, the same route, the same body, so the same chosen member and the
  same trimmed name.
- **The list changes only from a confirmed answer (DD-17).** The client replaces the item with the
  one returned, or removes it after a Delete. It reads the list only on a pick and on the Retry of a
  failed list fetch.
- **Sessions.** Each pick starts a new session. An answer to a request from an earlier session is
  dropped, so a slow answer cannot change the list another user is looking at.
- **Demos (D-21, DD-22).** Show loading shows the indicator for 900 ms using the global
  `setTimeout`, then the real list. Show empty list holds until a pick, Show loading, or a confirmed
  Add, which appends the returned item and ends the view (D-26, DD-25). The demo failure modal's
  Retry only closes it. No demo calls the API.
- **Modals (DD-19).** On open, focus moves to the modal's first button. Escape does nothing. While
  a modal is open, the page behind it carries `inert`, so Tab stays in the modal. React 18 does not
  know `inert`; it renders it as a plain attribute with the value `""`. I took that from
  react-dom's source and did not see it in a live page. T-014-P5 passes with or without it.
- **GAP-1 (12.11, unpinned).** After a failed or refused list fetch I remove the indicator and show
  nothing behind the modal or after Close. This is my choice where the PRD is silent; no row
  asserts it.

## What passes

`sh eval/run.sh` from the repository root, on Docker Compose v2.35.1, Node 22.23.2 and Python
3.12.13, exits 0:

```
[rows] api: pass, 55 of 55 expected rows passed
[rows] browser: pass, 22 of 22 expected rows passed
[rows] journey: pass, 30 of 30 expected rows passed
[exam] PASS: every step ran and every expected row passed
```

The journey count includes the three production rows (T-016-P3, P4, N3). Nothing failed, and
nothing is reported as passing that I did not see pass.

The first run failed before any browser row ran. Vite's esbuild wrote the ` ` and ` `
escapes inside the trimming regex literal back out as raw line separators, which end a JavaScript
regex literal. The pattern is now built with `new RegExp` from a string of escapes; the comment in
`names.js` says why.

## Points for the reviewer

1. **The blueprint has no Conventions section.** The brief says `docs/TECH-SPEC.md` has one that
   names the formatter, linter and type checker the exam runs. It does not: there is no such
   heading, and `eval/run.sh` runs no formatter, linter or type checker on `app/web`. With nothing
   to follow I followed the existing JavaScript in `eval/`: ES modules, two-space indent, single
   quotes, semicolons, trailing commas, about 100 columns. I introduced no tooling of my own. One
   line in `names.js`, the character class, runs to about 102 columns.
2. **Role badge text.** 12.9 pins the badge text as "admin" and "member". The mockup's `.role`
   also sets `text-transform: capitalize`, which would display "Admin". I left out the capitalise,
   so the screen shows exactly the pinned string. If the mockup's look should win here, it is a
   one-line change to `.role` in `styles.css`. The R1 review may want to judge it.
3. **"Equipment" heading over the empty text.** 12.8.1 puts the "Equipment" heading inside
   `equipment-list`, which exists only when there are items. Like the mockup, I also show the
   heading above "No equipment yet". It is not one of the strings the rows assert.
4. **No test I believe is wrong.** I found no row that disagrees with the PRD.

## Not verified by any row

- The C rows (component, Vitest) of story S3 in the blueprint are not in this repository's exam,
  so criteria verified only by C are untested here. I built to them by reading the criteria: for
  example REQ-013.13's fake clock, REQ-009.14's double Enter while an Add is held, and REQ-012.14's
  no loader beside a modal.
- REQ-015.4 to .6 (translucency, rounding, shadows) and the REQ-017 walk-through are the user's
  review rows, R1 and R2.
