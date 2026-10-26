/**
 * REQ-014, the application worked by the keyboard alone on the running stack:
 * a lend and a delete whose effects are real, and the two modals the real
 * server's refusal and a failed request open.
 *
 * Read-only to every builder. Added with the journey pairs (eval plan 1.6).
 *
 * Rows: T-014-P13, T-014-N2.
 *
 * The browser rows (T-014-P5, T-014-P6, T-014-P8) show that the keyboard
 * reaches and works every control against a faked server. These show that what
 * the keyboard sets off is the real thing: the lend and the delete are kept, and
 * the modals a person must dismiss by keyboard are the ones the real server's
 * answers open. The look of the icon buttons (REQ-014.1 to .3, .8 to .10) is not
 * claimed here; it keeps its component rows.
 */

import { test, expect } from '@playwright/test';
import { createItem, itemNamed, readList } from '../support/api.js';
import {
  accessDeniedModal,
  apiFailureModal,
  borrowerModal,
  confirmDeleteModal,
  focusNothing,
  keyboardTo,
  listOnScreen,
  openAndPick,
  rowNamed,
  statusOf,
} from '../support/app.js';
import { failNextRequest, rewriteIdentity, theActionRequest } from '../support/intercept.js';
import { uniqueName } from '../support/names.js';
import { ADA, AVAILABLE, MIA, onLoanTo } from '../support/strings.js';

/** Reach a control with the keyboard and say where the focus went if it could not. */
async function reach(page, target) {
  const { reached, passed } = await keyboardTo(page, target);
  const visited = [...new Set(passed)].join(', ');
  expect(reached, `${target.control} not reached; the focus only went to ${visited}`).toBe(true);
}

test('T-014-P13 REQ-014.5 REQ-014.6 REQ-014.7 by keyboard alone an admin lends an item and deletes another, and both are kept', async ({
  page,
  request,
}) => {
  const toLend = await createItem(request, uniqueName('Hacksaw'));
  const toDelete = await createItem(request, uniqueName('Bradawl'));

  await openAndPick(page, ADA.id);
  await expect(statusOf(page, toLend.name)).toHaveText(AVAILABLE);
  await expect(statusOf(page, toDelete.name)).toHaveText(AVAILABLE);

  // The row's Borrow, from the end of the page backwards; Enter opens the
  // borrower modal.
  await focusNothing(page);
  await reach(page, { control: 'btn-borrow', itemId: toLend.id, key: 'Shift+Tab' });
  await page.keyboard.press('Enter');
  await expect(borrowerModal(page)).toBeVisible();

  // Mia's member button, by Tab; Space starts the lend.
  await reach(page, { control: `member-button-${MIA.id}` });
  await page.keyboard.press('Space');
  await expect(statusOf(page, toLend.name)).toHaveText(onLoanTo(MIA.name));

  // The other row's Delete x by Shift+Tab and Enter; the modal's Confirm by Tab
  // and Enter.
  await focusNothing(page);
  await reach(page, { control: 'btn-delete', itemId: toDelete.id, key: 'Shift+Tab' });
  await page.keyboard.press('Enter');
  await expect(confirmDeleteModal(page)).toBeVisible();
  await reach(page, { control: 'btn-confirm' });
  await page.keyboard.press('Enter');
  await expect(rowNamed(page, toDelete.name)).toHaveCount(0);

  // What the stack kept.
  const kept = await readList(request);
  expect(itemNamed(kept, toLend.name)?.borrowerId).toBe(MIA.id);
  expect(itemNamed(kept, toDelete.name)).toBeUndefined();
});

test('T-014-N2 REQ-014.4 REQ-014.5 the modals of a real refusal and of a failed request are alert dialogs a person dismisses by keyboard, and nothing changes', async ({
  page,
  request,
}) => {
  const item = await createItem(request, uniqueName('Spokeshave'));

  await openAndPick(page, ADA.id);
  await expect(statusOf(page, item.name)).toHaveText(AVAILABLE);
  const before = await listOnScreen(page);

  // A Mark out of service, set off by keyboard, leaves the browser as Mia's: the
  // real server refuses it. The Access denied modal is an alert dialog, and its
  // OK is reached by Tab and worked by Enter.
  const undo = await rewriteIdentity(page, theActionRequest(item.id, 'out-of-service'), String(MIA.id));
  await focusNothing(page);
  await reach(page, { control: 'btn-out-of-service', itemId: item.id, key: 'Shift+Tab' });
  await page.keyboard.press('Enter');
  await expect(accessDeniedModal(page)).toBeVisible();
  await expect(accessDeniedModal(page)).toHaveAttribute('role', 'alertdialog');
  await reach(page, { control: 'btn-ok' });
  await page.keyboard.press('Enter');
  await expect(accessDeniedModal(page)).toHaveCount(0);
  await undo();

  // The same action never reaches the server: the API failure modal is an alert
  // dialog, and its Close is reached by Tab and worked by Space.
  await failNextRequest(page, theActionRequest(item.id, 'out-of-service'));
  await focusNothing(page);
  await reach(page, { control: 'btn-out-of-service', itemId: item.id, key: 'Shift+Tab' });
  await page.keyboard.press('Enter');
  await expect(apiFailureModal(page)).toBeVisible();
  await expect(apiFailureModal(page)).toHaveAttribute('role', 'alertdialog');
  await reach(page, { control: 'btn-close' });
  await page.keyboard.press('Space');
  await expect(apiFailureModal(page)).toHaveCount(0);

  // Nothing changed, on the page or in what the stack kept.
  expect(await listOnScreen(page)).toEqual(before);
  expect(itemNamed(await readList(request), item.name)?.status).toBe('available');
  await openAndPick(page, ADA.id);
  await expect(statusOf(page, item.name)).toHaveText(AVAILABLE);
});
