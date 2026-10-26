/**
 * REQ-013, a list fetch that fails again on Retry, and Close, on the running
 * stack.
 *
 * Read-only to every builder. Added with the journey pairs (eval plan 1.6).
 *
 * Row: T-013-N16.
 *
 * Like the rows of 06-failure-and-retry.spec.js, nothing here asserts what the
 * page shows behind the modal, or whether the list indicator is removed when the
 * modal appears (GAP-1, eval plan 9.3). It asserts the modal, the indicator
 * while the repeat is held, and that Close does not bring the indicator back.
 */

import { test, expect } from '@playwright/test';
import { createItem } from '../support/api.js';
import { accessDeniedModal, apiFailureModal, openApp, pickUser } from '../support/app.js';
import { failNextRequest, holdNextRequest, theListRequest } from '../support/intercept.js';
import { uniqueName } from '../support/names.js';
import { ADA } from '../support/strings.js';

test('T-013-N16 REQ-013.24 REQ-013.26 a repeated list fetch that fails again shows the modal again, and Close does not fetch', async ({
  page,
  request,
}) => {
  await createItem(request, uniqueName('Hydrant'));

  await openApp(page);
  await failNextRequest(page, theListRequest);
  await pickUser(page, ADA.id);
  await expect(apiFailureModal(page)).toBeVisible();

  // Retry, with the repeat held on its way to the server: the modal has gone and
  // the list indicator shows while the repeat is in progress.
  const repeat = await holdNextRequest(page, theListRequest);
  await apiFailureModal(page).getByTestId('btn-retry').click();
  await repeat.held;
  await expect(apiFailureModal(page)).toHaveCount(0);
  await expect(page.getByTestId('list-indicator')).toBeVisible();

  // The repeat fails too: the modal again, with Close and Retry, and not the
  // Access denied modal.
  repeat.fail();
  await expect(apiFailureModal(page)).toBeVisible();
  await expect(apiFailureModal(page).getByTestId('btn-close')).toBeVisible();
  await expect(apiFailureModal(page).getByTestId('btn-retry')).toBeVisible();
  await expect(accessDeniedModal(page)).toHaveCount(0);

  // Close. Any further list request would be held, so a fetch started by Close
  // would keep the list indicator on screen. The person then clicks the top bar,
  // which is always shown and does nothing, so the page has had a further turn
  // in which to have started one, and the indicator is still not shown. The
  // state demos are not used for this: whether they show behind a failed fetch
  // is part of what GAP-1 leaves open.
  await holdNextRequest(page, theListRequest);
  await apiFailureModal(page).getByTestId('btn-close').click();
  await expect(apiFailureModal(page)).toHaveCount(0);
  await expect(page.getByTestId('list-indicator')).toHaveCount(0);
  await page.getByTestId('top-bar').click({ position: { x: 4, y: 4 } });
  await expect(page.getByTestId('top-bar')).toBeVisible();
  await expect(page.getByTestId('list-indicator')).toHaveCount(0);
});
