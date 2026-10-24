// The one place the B rows import Playwright from. Frozen with the B rows.
//
// In the earlier preparation `@playwright/test` lived in a separate harness folder that was not
// an ancestor of the rows, so this file held a relative path into it. Here the rows sit inside
// `eval/web/`, whose own package.json and lockfile install the library, and a bare import
// resolves to that copy. The file is kept so that every spec, and the configuration, still
// import from one place: Playwright needs the specs and the runner on the very same copy of the
// library, and two copies would register two separate test suites.

export * from '@playwright/test';
