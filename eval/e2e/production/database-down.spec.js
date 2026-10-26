/**
 * REQ-012 with the database stopped: the real server cannot carry out an action
 * and answers with an error, which is the server-error kind of rejection
 * (blueprint 12.3.1), made on the real stack and not by faking an answer.
 *
 * Read-only to every builder. Added with the journey pairs (eval plan 1.6).
 *
 * Row: T-012-N13 (kind `production`, eval plan 1.1).
 *
 * In the production project, because it stops and starts a service of the stack
 * (`docker compose stop db`, then `start db`). It stops only the database: the
 * page stays loaded and nginx and the API keep answering, so every request the
 * page makes reaches the real API, which cannot reach its data. Its order
 * against restart.spec.js does not matter: it creates its own items, and it
 * leaves the stack running with the database started again.
 */

import { test, expect } from '@playwright/test';
import { createItem, itemNamed, readList } from '../support/api.js';
import {
  accessDeniedModal,
  addCard,
  apiFailureModal,
  borrowerModal,
  iconIn,
  listOnScreen,
  openAndPick,
  rowNamed,
  statusOf,
  typeAndEnter,
} from '../support/app.js';
import { compose, waitForTheStack } from '../support/stack.js';
import { uniqueName } from '../support/names.js';
import { ADA, AVAILABLE, MIA } from '../support/strings.js';

test('T-012-N13 REQ-012.5 REQ-012.6 REQ-012.12 REQ-012.13 REQ-012.14 with the database down a Borrow, a Mark and an Add fail and change nothing, and Retry adds once it is back', async ({
  page,
  request,
}) => {
  test.setTimeout(420_000);

  const toLend = await createItem(request, uniqueName('Davit'));
  const toMark = await createItem(request, uniqueName('Capstan'));
  const added = uniqueName('Bollard');

  await openAndPick(page, ADA.id);
  await expect(statusOf(page, toLend.name)).toHaveText(AVAILABLE);
  await expect(statusOf(page, toMark.name)).toHaveText(AVAILABLE);
  await expect(addCard(page)).toBeVisible();
  const before = await listOnScreen(page);

  /**
   * The API failure modal with Close and Retry, not the Access denied modal,
   * and no loader of any kind while it shows (REQ-012.14).
   */
  const expectTheFailureModal = async (what) => {
    await expect(apiFailureModal(page), what).toBeVisible({ timeout: 30_000 });
    await expect(apiFailureModal(page).getByTestId('btn-close')).toBeVisible();
    await expect(apiFailureModal(page).getByTestId('btn-retry')).toBeVisible();
    await expect(accessDeniedModal(page)).toHaveCount(0);
    await expect(page.getByTestId('row-loader')).toHaveCount(0);
    await expect(page.getByTestId('add-loader')).toHaveCount(0);
  };

  await compose('stop', 'db');
  try {
    // An admin's Borrow for Mia.
    await iconIn(rowNamed(page, toLend.name), 'btn-borrow').click();
    await expect(borrowerModal(page)).toBeVisible();
    await borrowerModal(page).getByTestId(`member-button-${MIA.id}`).click();
    await expectTheFailureModal('a Borrow with the database down');
    await apiFailureModal(page).getByTestId('btn-close').click();
    await expect(apiFailureModal(page)).toHaveCount(0);

    // A Mark out of service.
    await iconIn(rowNamed(page, toMark.name), 'btn-out-of-service').click();
    await expectTheFailureModal('a Mark out of service with the database down');
    await apiFailureModal(page).getByTestId('btn-close').click();
    await expect(apiFailureModal(page)).toHaveCount(0);

    // Nothing changed on the page.
    expect(await listOnScreen(page)).toEqual(before);

    // An Add, whose failure modal is left open for the Retry below.
    await typeAndEnter(page, added);
    await expectTheFailureModal('an Add with the database down');
    await expect(rowNamed(page, added)).toHaveCount(0);
  } finally {
    await compose('start', 'db');
    await waitForTheStack(request);
  }

  // The database is back. Nothing any failed request asked for was kept.
  const kept = await readList(request);
  expect(itemNamed(kept, toLend.name)).toMatchObject({ status: 'available', borrowerId: null });
  expect(itemNamed(kept, toMark.name)).toMatchObject({ status: 'available', borrowerId: null });
  expect(itemNamed(kept, added)).toBeUndefined();

  // Retry in the Add's modal repeats the Add with the same name, and now it is
  // carried out.
  await apiFailureModal(page).getByTestId('btn-retry').click();
  await expect(statusOf(page, added)).toHaveText(AVAILABLE);
  expect(itemNamed(await readList(request), added)?.status).toBe('available');
});
