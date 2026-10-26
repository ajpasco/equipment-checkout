/**
 * Who is offered which control, on the running stack: Mark out of service and
 * Restore (REQ-010), the confirm-delete modal's Cancel (REQ-011), and the whole
 * control inventory (REQ-017.18).
 *
 * Read-only to every builder. Added with the journey pairs (eval plan 1.6).
 *
 * Rows: T-010-N10, T-011-N10, T-017-P3.
 */

import { test, expect } from '@playwright/test';
import { createItem, itemNamed, lendTo, readList, takeOutOfService } from '../support/api.js';
import {
  borrowerModal,
  confirmDeleteModal,
  controlsOnThePage,
  iconIn,
  openAndPick,
  pickUser,
  expectListSettled,
  rowNamed,
  statusOf,
} from '../support/app.js';
import { uniqueName } from '../support/names.js';
import {
  ADA,
  AVAILABLE,
  MIA,
  OUT_OF_SERVICE,
  SAM,
  deleteTitle,
  onLoanTo,
} from '../support/strings.js';

/** Three items, one in each status, made through the API as Ada. */
async function oneOfEach(request) {
  const available = await createItem(request, uniqueName('Sling'));
  const onLoan = await createItem(request, uniqueName('Pulk'));
  await lendTo(request, onLoan.id, MIA.id);
  const outOfService = await createItem(request, uniqueName('Sledge'));
  await takeOutOfService(request, outOfService.id);
  return { available, onLoan, outOfService };
}

test('T-010-N10 REQ-010.2 REQ-010.5 REQ-010.7 Mark out of service and Restore are offered only where they apply, and never to a member', async ({
  page,
  request,
}) => {
  const { available, onLoan, outOfService } = await oneOfEach(request);

  await openAndPick(page, ADA.id);
  await expect(statusOf(page, available.name)).toHaveText(AVAILABLE);
  await expect(statusOf(page, onLoan.name)).toHaveText(onLoanTo(MIA.name));
  await expect(statusOf(page, outOfService.name)).toHaveText(OUT_OF_SERVICE);

  // First each feature where it belongs, then its absence where it does not.
  await expect(iconIn(rowNamed(page, available.name), 'btn-out-of-service')).toBeVisible();
  await expect(iconIn(rowNamed(page, outOfService.name), 'btn-restore')).toBeVisible();
  await expect(iconIn(rowNamed(page, onLoan.name), 'btn-out-of-service')).toHaveCount(0);
  await expect(iconIn(rowNamed(page, outOfService.name), 'btn-out-of-service')).toHaveCount(0);
  await expect(iconIn(rowNamed(page, available.name), 'btn-restore')).toHaveCount(0);
  await expect(iconIn(rowNamed(page, onLoan.name), 'btn-restore')).toHaveCount(0);

  // A member sees neither, on any row. Each is picked on a freshly loaded page,
  // so the list read is the member's own, and is first found as the member's:
  // the role badge reads "member" and the Available row offers the Borrow icon.
  for (const member of [MIA, SAM]) {
    await openAndPick(page, member.id);
    await expect(page.getByTestId('role-badge')).toHaveText(member.role);
    await expect(statusOf(page, onLoan.name)).toHaveText(onLoanTo(MIA.name));
    await expect(iconIn(rowNamed(page, available.name), 'btn-borrow')).toBeVisible();
    await expect(page.getByTestId('btn-out-of-service')).toHaveCount(0);
    await expect(page.getByTestId('btn-restore')).toHaveCount(0);
  }
});

test('T-011-N10 REQ-011.3 REQ-011.5 the confirm-delete modal names the item, and Cancel deletes nothing', async ({
  page,
  request,
}) => {
  const item = await createItem(request, uniqueName('Trestle'));

  await openAndPick(page, ADA.id);
  const row = rowNamed(page, item.name);
  await expect(iconIn(row, 'btn-delete')).toBeVisible();
  await iconIn(row, 'btn-delete').click();

  const modal = confirmDeleteModal(page);
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId('modal-title')).toHaveText(deleteTitle(item.name));
  await modal.getByTestId('btn-cancel').click();

  await expect(confirmDeleteModal(page)).toHaveCount(0);
  await expect(row.getByTestId('row-loader')).toHaveCount(0);
  await expect(statusOf(page, item.name)).toHaveText(AVAILABLE);

  // What the stack kept, and a fresh look: the item is still there, Available.
  expect(itemNamed(await readList(request), item.name)?.status).toBe('available');
  await openAndPick(page, ADA.id);
  await expect(statusOf(page, item.name)).toHaveText(AVAILABLE);
});

/** The controls REQ-017.18 lists, as blueprint 12.8.3 names them. Nothing else may exist. */
const INVENTORY = new Set([
  'switcher',
  'add-input',
  'btn-add',
  'btn-borrow',
  'btn-return',
  'btn-out-of-service',
  'btn-restore',
  'btn-delete',
  'btn-close',
  'btn-retry',
  'btn-ok',
  'btn-cancel',
  'btn-confirm',
  `member-button-${MIA.id}`,
  `member-button-${SAM.id}`,
  'demo-loading',
  'demo-empty',
  'demo-api-failure',
  'demo-access-denied',
]);

/**
 * The tooltip (`title`) each listed button carries, blueprint 12.8.2, so that a
 * control is recognised by what a person is told it does and not by its test id
 * alone. The accessible label is the same except for the four state demos.
 */
const PINNED_TITLE = {
  'btn-add': 'Add equipment',
  'btn-borrow': 'Borrow',
  'btn-return': 'Return',
  'btn-out-of-service': 'Mark out of service',
  'btn-restore': 'Restore',
  'btn-delete': 'Delete',
  'btn-close': 'Close',
  'btn-retry': 'Retry',
  'btn-ok': 'OK',
  'btn-cancel': 'Cancel',
  'btn-confirm': 'Confirm delete',
  [`member-button-${MIA.id}`]: `Borrow for ${MIA.name}`,
  [`member-button-${SAM.id}`]: `Borrow for ${SAM.name}`,
  'demo-loading': 'Loading',
  'demo-empty': 'Empty list',
  'demo-api-failure': 'API failure',
  'demo-access-denied': 'Access denied',
};
const DEMO_LABEL = {
  'demo-loading': 'Show loading',
  'demo-empty': 'Show empty list',
  'demo-api-failure': 'Show API failure',
  'demo-access-denied': 'Show access denied',
};

test('T-017-P3 REQ-017.18 on the real stack the page offers the listed controls and no other', async ({
  page,
  request,
}) => {
  const { available, onLoan, outOfService } = await oneOfEach(request);

  /** First the controls this view must have, then nothing outside the list. */
  const expectOnlyListedControls = async (expected, what) => {
    const found = await controlsOnThePage(page);
    for (const control of expected) {
      expect(found, `${what}: ${control} is offered`).toContain(control);
    }
    expect(
      found.filter((control) => !INVENTORY.has(control)),
      `${what}: controls outside REQ-017.18`,
    ).toEqual([]);
    // Every button found says what it is: its tooltip and its accessible label
    // are the ones its control is pinned to.
    const told = await page.evaluate(() =>
      Array.from(globalThis.document.querySelectorAll('button')).map((button) => ({
        id: button.getAttribute('data-testid'),
        title: button.getAttribute('title'),
        label: button.getAttribute('aria-label'),
      })),
    );
    for (const { id, title, label } of told) {
      expect(title, `${what}: the tooltip of ${id}`).toBe(PINNED_TITLE[id]);
      expect(label, `${what}: the label of ${id}`).toBe(DEMO_LABEL[id] ?? PINNED_TITLE[id]);
    }
  };

  // Ada, on the list.
  await openAndPick(page, ADA.id);
  await expect(statusOf(page, outOfService.name)).toHaveText(OUT_OF_SERVICE);
  const demos = ['demo-loading', 'demo-empty', 'demo-api-failure', 'demo-access-denied'];
  await expectOnlyListedControls(
    [
      'switcher',
      'add-input',
      'btn-add',
      'btn-borrow',
      'btn-return',
      'btn-out-of-service',
      'btn-restore',
      'btn-delete',
      ...demos,
    ],
    'Ada, the list',
  );

  // Ada, with the borrower modal open, then the confirm-delete modal.
  await iconIn(rowNamed(page, available.name), 'btn-borrow').click();
  await expect(borrowerModal(page)).toBeVisible();
  await expectOnlyListedControls(
    [`member-button-${MIA.id}`, `member-button-${SAM.id}`, 'btn-close'],
    'Ada, the borrower modal',
  );
  await borrowerModal(page).getByTestId('btn-close').click();
  await iconIn(rowNamed(page, available.name), 'btn-delete').click();
  await expect(confirmDeleteModal(page)).toBeVisible();
  await expectOnlyListedControls(['btn-cancel', 'btn-confirm'], 'Ada, the confirm-delete modal');
  await confirmDeleteModal(page).getByTestId('btn-cancel').click();

  // Mia, on the list: her Borrow and her own Return, and no admin control.
  await pickUser(page, MIA.id);
  await expectListSettled(page);
  await expect(statusOf(page, onLoan.name)).toHaveText(onLoanTo(MIA.name));
  await expectOnlyListedControls(['switcher', 'btn-borrow', 'btn-return', ...demos], 'Mia, the list');
  const mia = await controlsOnThePage(page);
  for (const adminOnly of ['add-input', 'btn-add', 'btn-out-of-service', 'btn-restore', 'btn-delete']) {
    expect(mia, `Mia is not offered ${adminOnly}`).not.toContain(adminOnly);
  }
});
