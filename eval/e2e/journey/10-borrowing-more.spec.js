/**
 * More of REQ-004, REQ-005 and REQ-008 on the running stack: the borrower
 * modal's Close, who the modal offers, and two members borrowing one item at once.
 *
 * Read-only to every builder. Added with the journey pairs (eval plan 1.6).
 *
 * Rows: T-004-N10, T-005-P2, T-008-P3.
 */

import { test, expect } from '@playwright/test';
import { createItem, itemNamed, readList } from '../support/api.js';
import {
  accessDeniedModal,
  apiFailureModal,
  borrowerModal,
  iconIn,
  openAndPick,
  rowNamed,
  rows,
  statusOf,
} from '../support/app.js';
import { BASE_URL } from '../support/base-url.js';
import { holdNextRequest, theActionRequest } from '../support/intercept.js';
import { uniqueName } from '../support/names.js';
import { ADA, AVAILABLE, MIA, OUT_OF_SERVICE, SAM, onLoanTo } from '../support/strings.js';

test('T-004-N10 REQ-004.4 closing the borrower modal lends nothing', async ({ page, request }) => {
  const item = await createItem(request, uniqueName('Hammock'));
  const other = await createItem(request, uniqueName('Awning'));

  await openAndPick(page, ADA.id);
  const row = rowNamed(page, item.name);
  await expect(statusOf(page, item.name)).toHaveText(AVAILABLE);
  await iconIn(row, 'btn-borrow').click();

  // The modal is open with its members, so Close is closing a real choice.
  await expect(borrowerModal(page)).toBeVisible();
  await expect(borrowerModal(page).getByTestId(`member-button-${MIA.id}`)).toBeVisible();
  await borrowerModal(page).getByTestId('btn-close').click();

  await expect(borrowerModal(page)).toHaveCount(0);
  await expect(row.getByTestId('row-loader')).toHaveCount(0);
  await expect(statusOf(page, item.name)).toHaveText(AVAILABLE);

  // Then a real action on another item and its confirmed answer, so that the
  // answer to anything Close had sent would have arrived too: no modal of any
  // kind has opened, and the item still reads Available.
  await iconIn(rowNamed(page, other.name), 'btn-out-of-service').click();
  await expect(statusOf(page, other.name)).toHaveText(OUT_OF_SERVICE);
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
  await expect(statusOf(page, item.name)).toHaveText(AVAILABLE);

  // A fresh look as Ada, and what the stack kept: still Available, nobody holds it.
  await openAndPick(page, ADA.id);
  await expect(statusOf(page, item.name)).toHaveText(AVAILABLE);
  const kept = itemNamed(await readList(request), item.name);
  expect(kept?.status).toBe('available');
  expect(kept?.borrowerId).toBeNull();
});

test('T-005-P2 REQ-005.1 REQ-005.2 the borrower modal offers the two members and never the admin, and a lend names the member', async ({
  page,
  request,
}) => {
  const item = await createItem(request, uniqueName('Kayak'));

  await openAndPick(page, ADA.id);
  await iconIn(rowNamed(page, item.name), 'btn-borrow').click();
  const modal = borrowerModal(page);
  await expect(modal).toBeVisible();

  // The members first, then the absence of the admin among them.
  await expect(modal.getByTestId(`member-button-${MIA.id}`)).toBeVisible();
  await expect(modal.getByTestId(`member-button-${SAM.id}`)).toBeVisible();
  await expect(modal.locator('[data-testid^="member-button-"]')).toHaveCount(2);
  await expect(modal.getByTestId(`member-button-${ADA.id}`)).toHaveCount(0);
  await expect(modal.getByText(ADA.name)).toHaveCount(0);

  await modal.getByTestId(`member-button-${SAM.id}`).click();
  await expect(statusOf(page, item.name)).toHaveText(onLoanTo(SAM.name));

  // The rows are found, and none is on loan to the admin.
  await expect(rows(page).first()).toBeVisible();
  await expect(rows(page).filter({ hasText: onLoanTo(ADA.name) })).toHaveCount(0);
  expect(itemNamed(await readList(request), item.name)?.borrowerId).toBe(SAM.id);
});

test('T-008-P3 REQ-008.1 REQ-008.4 REQ-008.8 two members borrow one item at the same moment and exactly one gets it', async ({
  page,
  browser,
  request,
}) => {
  const item = await createItem(request, uniqueName('Canoe'));

  // Mia in the test's own context, Sam in a second one; both list it Available.
  await openAndPick(page, MIA.id);
  const second = await browser.newContext({ baseURL: BASE_URL });
  const samPage = await second.newPage();
  await openAndPick(samPage, SAM.id);
  await expect(statusOf(page, item.name)).toHaveText(AVAILABLE);
  await expect(statusOf(samPage, item.name)).toHaveText(AVAILABLE);

  // Both Borrows are set off and each is held on its way to the server until
  // both have left their browsers; then both are let go together, so the server
  // receives them at the same moment. Which one it takes first is its business,
  // and the row accepts either. (The guarantee itself, over twenty barrier
  // rounds, is the API row T-008-N3; this row shows what each person is shown.)
  const miaHold = await holdNextRequest(page, theActionRequest(item.id, 'borrow'));
  const samHold = await holdNextRequest(samPage, theActionRequest(item.id, 'borrow'));
  await iconIn(rowNamed(page, item.name), 'btn-borrow').click();
  await iconIn(rowNamed(samPage, item.name), 'btn-borrow').click();
  await Promise.all([miaHold.held, samHold.held]);
  miaHold.release();
  samHold.release();

  /** What this person ends up shown: their own loan, or the API failure modal. */
  const outcome = async (who, view) => {
    const ownLoan = statusOf(view, item.name).filter({ hasText: onLoanTo(who.name) });
    await expect(apiFailureModal(view).or(ownLoan)).toBeVisible();
    return (await apiFailureModal(view).count()) > 0 ? 'rejected' : 'confirmed';
  };
  const mia = await outcome(MIA, page);
  const sam = await outcome(SAM, samPage);

  // One is confirmed and the other is shown the API failure modal, never the
  // Access denied modal: the loser was allowed to ask, the item was just gone.
  expect([mia, sam].sort()).toEqual(['confirmed', 'rejected']);
  const winner = mia === 'confirmed' ? MIA : SAM;
  const loserPage = mia === 'confirmed' ? samPage : page;
  await expect(statusOf(loserPage, item.name)).toHaveText(AVAILABLE);
  await expect(accessDeniedModal(page)).toHaveCount(0);
  await expect(accessDeniedModal(samPage)).toHaveCount(0);

  // What the stack kept, and a fresh look from both contexts: exactly one
  // borrower, the one whose request was confirmed.
  const kept = itemNamed(await readList(request), item.name);
  expect(kept?.status).toBe('on_loan');
  expect(kept?.borrowerId).toBe(winner.id);
  for (const [view, user] of [
    [page, MIA],
    [samPage, SAM],
  ]) {
    await openAndPick(view, user.id);
    await expect(rowNamed(view, item.name).getByTestId('row-status')).toHaveCount(1);
    await expect(statusOf(view, item.name)).toHaveText(onLoanTo(winner.name));
  }

  await second.close();
});
