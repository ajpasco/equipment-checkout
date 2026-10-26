/**
 * REQ-006 and REQ-007 on the running stack: a member returns her own loan, sees
 * nothing to do on another member's, and is refused when the loan she sees as
 * hers has become someone else's.
 *
 * Read-only to every builder. Added with the journey pairs (eval plan 1.6).
 *
 * Rows: T-006-P8, T-006-N8, T-007-N10.
 */

import { test, expect } from '@playwright/test';
import { createItem, itemNamed, lendTo, readList, returnItem } from '../support/api.js';
import {
  accessDeniedModal,
  apiFailureModal,
  iconIn,
  openAndPick,
  rowNamed,
  statusOf,
} from '../support/app.js';
import { uniqueName } from '../support/names.js';
import { ACCESS_DENIED_BODY, AVAILABLE, MIA, SAM, onLoanTo } from '../support/strings.js';

test('T-006-P8 REQ-006.1 REQ-006.5 a member returns her own loan', async ({ page, request }) => {
  const item = await createItem(request, uniqueName('Satchel'));
  await lendTo(request, item.id, MIA.id);

  await openAndPick(page, MIA.id);
  const row = rowNamed(page, item.name);
  await expect(statusOf(page, item.name)).toHaveText(onLoanTo(MIA.name));
  await expect(iconIn(row, 'btn-return')).toBeVisible();
  await iconIn(row, 'btn-return').click();

  await expect(statusOf(page, item.name)).toHaveText(AVAILABLE);
  const kept = itemNamed(await readList(request), item.name);
  expect(kept?.status).toBe('available');
  expect(kept?.borrowerId).toBeNull();
});

test("T-006-N8 REQ-006.3 a member sees no action on another member's loan", async ({
  page,
  request,
}) => {
  const hers = await createItem(request, uniqueName('Thermos'));
  await lendTo(request, hers.id, MIA.id);
  const his = await createItem(request, uniqueName('Flask'));
  await lendTo(request, his.id, SAM.id);

  await openAndPick(page, MIA.id);

  // First her own loan, with its Return: the feature exists for the borrower.
  await expect(statusOf(page, hers.name)).toHaveText(onLoanTo(MIA.name));
  await expect(iconIn(rowNamed(page, hers.name), 'btn-return')).toBeVisible();

  // Then Sam's loan, found with its status, and no button of any kind on it.
  await expect(statusOf(page, his.name)).toHaveText(onLoanTo(SAM.name));
  await expect(rowNamed(page, his.name).locator('button')).toHaveCount(0);
});

test('T-007-N10 REQ-007.1 REQ-007.6 REQ-007.7 REQ-007.8 a member returning a loan that has become another member\'s is refused', async ({
  page,
  request,
}) => {
  const item = await createItem(request, uniqueName('Snorkel'));
  await lendTo(request, item.id, MIA.id);

  // Mia's page shows the loan as hers, with Return offered.
  await openAndPick(page, MIA.id);
  await expect(statusOf(page, item.name)).toHaveText(onLoanTo(MIA.name));
  await expect(iconIn(rowNamed(page, item.name), 'btn-return')).toBeVisible();

  // Meanwhile the admin takes it back and lends it to Sam. Mia's page is not
  // live (blueprint DD-17), so it still offers her the Return, and her Return is
  // now an attempt to return another member's loan.
  await returnItem(request, item.id);
  await lendTo(request, item.id, SAM.id);

  await iconIn(rowNamed(page, item.name), 'btn-return').click();

  // Refused, not rejected: the Access denied modal, its one OK, and no API
  // failure modal.
  const modal = accessDeniedModal(page);
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId('modal-body')).toHaveText(ACCESS_DENIED_BODY);
  await expect(modal.getByTestId('btn-ok')).toBeVisible();
  await expect(modal.locator('button')).toHaveCount(1);
  await expect(modal.getByTestId('btn-close')).toHaveCount(0);
  await expect(modal.getByTestId('btn-retry')).toHaveCount(0);
  await expect(apiFailureModal(page)).toHaveCount(0);

  // OK closes it and nothing changes: Sam still holds the item.
  await modal.getByTestId('btn-ok').click();
  await expect(accessDeniedModal(page)).toHaveCount(0);
  const kept = itemNamed(await readList(request), item.name);
  expect(kept?.status).toBe('on_loan');
  expect(kept?.borrowerId).toBe(SAM.id);
  await openAndPick(page, MIA.id);
  await expect(statusOf(page, item.name)).toHaveText(onLoanTo(SAM.name));
});
