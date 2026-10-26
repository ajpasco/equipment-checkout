/**
 * REQ-012 on the running stack: the row loader while the real answer is on its
 * way, and two kinds of rejection the real server gives when the page's view is
 * stale (the item is no longer in the right state; the item is no longer there).
 *
 * Read-only to every builder. Added with the journey pairs (eval plan 1.6).
 *
 * Rows: T-012-P10, T-012-N11, T-012-N12.
 *
 * In the two rejection rows the page is the stale view and "another person" is
 * Ada acting through the API, which is how a row builds the state it needs
 * (eval plan 1.3). The page is not live (blueprint DD-17), so it keeps offering
 * the action the person saw, and the real server answers it.
 */

import { test, expect } from '@playwright/test';
import {
  createItem,
  deleteItem,
  itemNamed,
  lendTo,
  readList,
  restoreItem,
  returnItem,
  takeOutOfService,
} from '../support/api.js';
import {
  accessDeniedModal,
  apiFailureModal,
  borrowerModal,
  confirmDeleteModal,
  iconIn,
  listOnScreen,
  openAndPick,
  rowNamed,
  statusOf,
} from '../support/app.js';
import { holdNextRequest, theActionRequest } from '../support/intercept.js';
import { uniqueName } from '../support/names.js';
import { ADA, AVAILABLE, MIA, OUT_OF_SERVICE, SAM, onLoanTo } from '../support/strings.js';

test('T-012-P10 REQ-012.1 REQ-012.2 REQ-012.3 REQ-012.9 REQ-012.10 REQ-012.11 each action shows its row loader until the real answer arrives, and only then the new state', async ({
  page,
  request,
}) => {
  const toBorrow = await createItem(request, uniqueName('Sextant'));
  const toMark = await createItem(request, uniqueName('Barometer'));
  const toRestore = await createItem(request, uniqueName('Anemometer'));
  await takeOutOfService(request, toRestore.id);

  /**
   * One action with its request held on the way to the server: the row loader
   * on that row, and the list exactly as it was; then, once the request goes on
   * and the real answer arrives, the loader gone and the row's new state.
   */
  const heldAction = async (item, action, testId, before, after) => {
    const row = rowNamed(page, item.name);
    await expect(statusOf(page, item.name)).toHaveText(before);
    const listBefore = await listOnScreen(page);
    const hold = await holdNextRequest(page, theActionRequest(item.id, action));
    await iconIn(row, testId).click();
    await hold.held;

    await expect(row.getByTestId('row-loader')).toBeVisible();
    await expect(statusOf(page, item.name)).toHaveText(before);
    expect(await listOnScreen(page)).toEqual(listBefore);

    hold.release();
    await expect(statusOf(page, item.name)).toHaveText(after);
    await expect(row.getByTestId('row-loader')).toHaveCount(0);
  };

  // A member's Borrow.
  await openAndPick(page, MIA.id);
  await heldAction(toBorrow, 'borrow', 'btn-borrow', AVAILABLE, onLoanTo(MIA.name));

  // The admin's Mark out of service and Restore.
  await openAndPick(page, ADA.id);
  await heldAction(toMark, 'out-of-service', 'btn-out-of-service', AVAILABLE, OUT_OF_SERVICE);
  await heldAction(toRestore, 'restore', 'btn-restore', OUT_OF_SERVICE, AVAILABLE);

  // What the stack kept is the new state of each.
  const kept = await readList(request);
  expect(itemNamed(kept, toBorrow.name)?.borrowerId).toBe(MIA.id);
  expect(itemNamed(kept, toMark.name)?.status).toBe('out_of_service');
  expect(itemNamed(kept, toRestore.name)?.status).toBe('available');
});

/**
 * The API failure modal with its two icons and not the Access denied modal; the
 * row the person acted on still shows what it showed; Close closes the modal.
 */
async function expectRejected(page, item, shownStatus, what) {
  await expect(apiFailureModal(page), what).toBeVisible();
  await expect(apiFailureModal(page).getByTestId('btn-close')).toBeVisible();
  await expect(apiFailureModal(page).getByTestId('btn-retry')).toBeVisible();
  await expect(accessDeniedModal(page)).toHaveCount(0);
  await expect(rowNamed(page, item.name).getByTestId('row-loader')).toHaveCount(0);
  await expect(statusOf(page, item.name)).toHaveText(shownStatus);
  await apiFailureModal(page).getByTestId('btn-close').click();
  await expect(apiFailureModal(page)).toHaveCount(0);
}

test('T-012-N11 REQ-012.5 REQ-012.6 REQ-012.12 a Return, a Mark and a Restore on an item no longer in that state are rejected and change nothing', async ({
  page,
  request,
}) => {
  const returned = await createItem(request, uniqueName('Oilskin'));
  await lendTo(request, returned.id, MIA.id);
  const taken = await createItem(request, uniqueName('Lifejacket'));
  const restored = await createItem(request, uniqueName('Foghorn'));
  await takeOutOfService(request, restored.id);

  // The page lists the three as they are now, each with its action offered.
  await openAndPick(page, ADA.id);
  await expect(statusOf(page, returned.name)).toHaveText(onLoanTo(MIA.name));
  await expect(statusOf(page, taken.name)).toHaveText(AVAILABLE);
  await expect(statusOf(page, restored.name)).toHaveText(OUT_OF_SERVICE);

  // Then someone else changes each, and the page does not know.
  await returnItem(request, returned.id);
  await lendTo(request, taken.id, SAM.id);
  await restoreItem(request, restored.id);

  await iconIn(rowNamed(page, returned.name), 'btn-return').click();
  await expectRejected(page, returned, onLoanTo(MIA.name), 'a Return of an item already returned');

  await iconIn(rowNamed(page, taken.name), 'btn-out-of-service').click();
  await expectRejected(page, taken, AVAILABLE, 'a Mark out of service of an item just lent');

  await iconIn(rowNamed(page, restored.name), 'btn-restore').click();
  await expectRejected(page, restored, OUT_OF_SERVICE, 'a Restore of an item already restored');

  // Nothing the rejected requests asked for happened: each item is in the state
  // the other person left it in.
  const kept = await readList(request);
  expect(itemNamed(kept, returned.name)).toMatchObject({ status: 'available', borrowerId: null });
  expect(itemNamed(kept, taken.name)).toMatchObject({ status: 'on_loan', borrowerId: SAM.id });
  expect(itemNamed(kept, restored.name)).toMatchObject({ status: 'available', borrowerId: null });
  await openAndPick(page, ADA.id);
  await expect(statusOf(page, returned.name)).toHaveText(AVAILABLE);
  await expect(statusOf(page, taken.name)).toHaveText(onLoanTo(SAM.name));
  await expect(statusOf(page, restored.name)).toHaveText(AVAILABLE);
});

test('T-012-N12 REQ-012.16 a Borrow, a Return, a Delete and a Restore of an item someone has deleted are rejected and bring nothing back', async ({
  page,
  request,
}) => {
  const toBorrow = await createItem(request, uniqueName('Gaff'));
  const toReturn = await createItem(request, uniqueName('Boathook'));
  await lendTo(request, toReturn.id, MIA.id);
  const toDelete = await createItem(request, uniqueName('Fender'));
  const toRestore = await createItem(request, uniqueName('Bilge'));
  await takeOutOfService(request, toRestore.id);
  const all = [toBorrow, toReturn, toDelete, toRestore];

  await openAndPick(page, ADA.id);
  await expect(statusOf(page, toBorrow.name)).toHaveText(AVAILABLE);
  await expect(statusOf(page, toReturn.name)).toHaveText(onLoanTo(MIA.name));
  await expect(statusOf(page, toDelete.name)).toHaveText(AVAILABLE);
  await expect(statusOf(page, toRestore.name)).toHaveText(OUT_OF_SERVICE);

  // Someone else deletes all four (the loan is taken back first, since an item
  // on loan cannot be deleted). The page still lists them.
  await returnItem(request, toReturn.id);
  for (const item of all) {
    await deleteItem(request, item.id);
  }

  await iconIn(rowNamed(page, toBorrow.name), 'btn-borrow').click();
  await expect(borrowerModal(page)).toBeVisible();
  await borrowerModal(page).getByTestId(`member-button-${MIA.id}`).click();
  await expectRejected(page, toBorrow, AVAILABLE, 'a Borrow of a deleted item');

  await iconIn(rowNamed(page, toReturn.name), 'btn-return').click();
  await expectRejected(page, toReturn, onLoanTo(MIA.name), 'a Return of a deleted item');

  await iconIn(rowNamed(page, toDelete.name), 'btn-delete').click();
  await expect(confirmDeleteModal(page)).toBeVisible();
  await confirmDeleteModal(page).getByTestId('btn-confirm').click();
  await expectRejected(page, toDelete, AVAILABLE, 'a Delete of a deleted item');

  await iconIn(rowNamed(page, toRestore.name), 'btn-restore').click();
  await expectRejected(page, toRestore, OUT_OF_SERVICE, 'a Restore of a deleted item');

  // Nothing came back: none of the four is listed, by the stack or on a fresh look.
  const kept = await readList(request);
  for (const item of all) {
    expect(itemNamed(kept, item.name), item.name).toBeUndefined();
  }
  await openAndPick(page, ADA.id);
  for (const item of all) {
    await expect(rowNamed(page, item.name)).toHaveCount(0);
  }
});
