// The configuration of the B rows (mechanism B). Owned by the exam; read-only to every builder.
//
// `eval/run.sh` runs it as
//   eval/web/node_modules/.bin/playwright test --config eval/web/playwright.config.js
// with the Playwright installed from eval/web's own lockfile, on the grader's machine.
//
// What changed from the earlier preparation, and why. There the configuration started its own
// web server: it ran the client's own Vite on the grader's machine (`vite build`, then
// `vite preview`). Here nothing from `app/` runs on the machine that holds the exam. The
// production build is made inside a container, by the `web` service of `eval/stack.yml`, and
// served there; `eval/run.sh` starts that stack before this runs and passes its address in
// BROWSER_BASE_URL. So there is no `webServer` block. The build is still the production build,
// made with `VITE_API_BASE_URL=/api`, and every `/api` request the page makes is still answered
// by `page.route` (tests/browser/_fake-api.js), so the real API behind the stack is never reached
// by these rows.
//
// `defineConfig` is imported through `./tests/browser/_pw.js` so that the configuration and
// the specs share one copy of the library.

import path from 'node:path';

import { defineConfig, devices } from './tests/browser/_pw.js';

const here = import.meta.dirname;
const reports = path.join(here, '..', 'reports');

if (!process.env.BROWSER_BASE_URL) {
  throw new Error(
    'BROWSER_BASE_URL is not set. The B rows run against the production build served by ' +
      'eval/stack.yml; run them through eval/run.sh, which starts it and sets the address.',
  );
}

export default defineConfig({
  testDir: path.join(here, 'tests', 'browser'),
  testMatch: '**/*.spec.js',
  // One worker, in order: these rows load a freshly built page and measure it, and one server
  // serves one build.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['junit', { outputFile: path.join(reports, 'browser.xml') }]],
  outputDir: path.join(reports, 'browser-artifacts'),
  use: {
    baseURL: process.env.BROWSER_BASE_URL,
    trace: 'on',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
