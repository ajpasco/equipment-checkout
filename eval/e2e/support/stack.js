/**
 * Stopping and starting the Compose stack, for the three production rows.
 *
 * Frozen at the S4 freeze. Read-only to every builder, S4's own included.
 *
 * Eval plan 7.2, C11: the production rows T-016-P3, T-016-P4 and T-016-N3 "run
 * last, because they stop and recreate the stack with `docker compose down` and
 * `up` from the repository root and the same `--env-file`". The same file is
 * `eval/e2e/eval.env`, so the stack a restart row brings back is configured
 * identically to the one eval/run.sh started; a row that started it from a
 * developer's own `.env` would be testing a different stack.
 *
 * Which stack, in this repository. eval/run.sh starts it and tells these rows
 * where it is, in two settings: EVAL_STACK_FILE, the Compose file it started,
 * and EVAL_STACK_PROJECT, the Compose project name it gave the run. Every call
 * below passes both, with the same env file, so a restart acts on exactly the
 * stack the journey rows ran against and on nothing else on the machine. A row
 * run without them cannot know which stack is meant, and refuses rather than
 * guess.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect } from '@playwright/test';
import { readUsers } from './api.js';
import { SEEDED_USERS } from './strings.js';

const support = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(support, '../../..');
const envFile = path.join(projectRoot, 'eval', 'e2e', 'eval.env');

function theStack() {
  const file = process.env.EVAL_STACK_FILE;
  const project = process.env.EVAL_STACK_PROJECT;
  if (!file || !project) {
    throw new Error(
      'EVAL_STACK_FILE and EVAL_STACK_PROJECT are not set, so this row cannot tell which ' +
        'stack to stop and start. Run the exam through eval/run.sh, which sets both.',
    );
  }
  return ['-p', project, '-f', path.resolve(projectRoot, file)];
}

/**
 * One `docker compose` call. A non-zero exit throws, with the command and the
 * output in the message: a restart that did not happen must not leave a row
 * asserting against the stack it was trying to replace.
 *
 * It is awaited rather than run synchronously, and that is required rather than
 * stylistic. `docker compose up --build` can take minutes, and a synchronous
 * child would hold Node's event loop for all of it; the row's own browser is
 * connected over that loop, so the page it is about to reload would be sitting
 * behind a connection nothing was servicing. The three production rows are the
 * only rows that call this, and each has a browser page open while it does.
 */
export async function compose(...args) {
  const argv = ['compose', ...theStack(), '--env-file', envFile, ...args];
  const shown = `docker ${argv.join(' ')}`;
  const child = spawn('docker', argv, { cwd: projectRoot });
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    out += chunk;
  });
  child.stderr.on('data', (chunk) => {
    err += chunk;
  });
  const status = await new Promise((resolve, reject) => {
    child.on('error', (failure) =>
      reject(new Error(`${shown} could not start: ${failure.message}`)),
    );
    child.on('close', resolve);
  });
  if (status !== 0) {
    throw new Error(`${shown} exited ${status}\n${out}\n${err}`.trim());
  }
  return out;
}

/**
 * Wait until the stack answers again, without pausing for a fixed time.
 *
 * `docker compose up -d` returns as soon as the containers are created, which is
 * before PostgreSQL accepts connections and before the API has run its start-up,
 * so the rows that quote that command (T-016-P4, T-016-N3) need a condition to
 * wait on. The condition is the one thing every restart row needs to be true
 * anyway: the user list reads as the three seeded users. It is a readiness probe
 * and no row's assertion: each row reads the list again itself and says what it
 * found.
 */
export async function waitForTheStack(request) {
  await expect
    .poll(
      async () => {
        try {
          const users = await readUsers(request, SEEDED_USERS[0].id);
          return users.length;
        } catch {
          return 0;
        }
      },
      { timeout: 300_000, intervals: [500, 1000, 2000] },
    )
    .toBe(SEEDED_USERS.length);
}
