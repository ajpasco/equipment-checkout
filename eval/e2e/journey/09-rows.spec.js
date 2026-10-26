/**
 * REQ-002, the name and the status on every row, on the running stack.
 *
 * Read-only to every builder. Added with the journey pairs (eval plan 1.6).
 *
 * Rows: T-002-P3, T-002-N4.
 *
 * The component rows read these from a fake server. Here the names and statuses
 * are the ones the real API keeps, so a status the server and the client spell
 * differently, or a name the server hands back that the client renders as markup,
 * shows up as what a person would see.
 */

import { test, expect } from '@playwright/test';
import { createItem, lendTo, takeOutOfService } from '../support/api.js';
import { iconIn, openAndPick, rowNamed, statusOf } from '../support/app.js';
import { uniqueName } from '../support/names.js';
import { AVAILABLE, MIA, OUT_OF_SERVICE, SAM, onLoanTo } from '../support/strings.js';

test('T-002-P3 REQ-002.1 REQ-002.2 REQ-002.3 every row shows its name and the one status the stack keeps', async ({
  page,
  request,
}) => {
  const available = await createItem(request, uniqueName('Lens'));
  const lentToMia = await createItem(request, uniqueName('Filter'));
  await lendTo(request, lentToMia.id, MIA.id);
  const lentToSam = await createItem(request, uniqueName('Mount'));
  await lendTo(request, lentToSam.id, SAM.id);
  const outOfService = await createItem(request, uniqueName('Gimbal'));
  await takeOutOfService(request, outOfService.id);

  await openAndPick(page, MIA.id);

  const expected = [
    [available, AVAILABLE],
    [lentToMia, onLoanTo(MIA.name)],
    [lentToSam, onLoanTo(SAM.name)],
    [outOfService, OUT_OF_SERVICE],
  ];
  for (const [item, status] of expected) {
    const row = rowNamed(page, item.name);
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('row-name')).toHaveText(item.name);
    // Exactly one status on the row, and it is the one the stack keeps, naming
    // the borrower for a loan.
    await expect(row.getByTestId('row-status')).toHaveCount(1);
    await expect(statusOf(page, item.name)).toHaveText(status);
    // And nothing else on the row reads as text: its name and that one status.
    expect((await row.textContent()).replace(/\s+/g, '')).toBe(`${item.name}${status}`.replace(/\s+/g, ''));
  }
});

test('T-002-N4 REQ-002.1 REQ-002.4 REQ-002.5 a name that looks like markup is shown as text, and no row opens anything', async ({
  page,
  request,
}) => {
  // Kept by the real server and handed back by it: this is the name the client
  // receives, not one the test put into the page.
  const odd = await createItem(
    request,
    uniqueName('<img src=x onerror=alert(1)><button>Delete</button>'),
  );
  const plain = await createItem(request, uniqueName('Tarp'));
  const lent = await createItem(request, uniqueName('Cooler'));
  await lendTo(request, lent.id, MIA.id);

  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs += 1;
    await dialog.dismiss();
  });

  await openAndPick(page, MIA.id);

  // First the rows, with their names and statuses; the odd one reads exactly the
  // text it was given.
  const oddRow = rowNamed(page, odd.name);
  const plainRow = rowNamed(page, plain.name);
  await expect(oddRow.getByTestId('row-name')).toHaveText(odd.name);
  await expect(statusOf(page, odd.name)).toHaveText(AVAILABLE);
  await expect(statusOf(page, plain.name)).toHaveText(AVAILABLE);
  await expect(statusOf(page, lent.name)).toHaveText(onLoanTo(MIA.name));

  // Nothing in the name became an element: no image, and the odd row has the
  // same buttons as an ordinary Available row.
  await expect(oddRow.locator('img')).toHaveCount(0);
  await expect(iconIn(plainRow, 'btn-borrow')).toBeVisible();
  const buttonsOf = async (row) =>
    row.locator('button').evaluateAll((all) => all.map((b) => b.getAttribute('data-testid')));
  expect(await buttonsOf(oddRow)).toEqual(await buttonsOf(plainRow));

  // No row, and no row's name, opens anything: no dialog, no panel, no other view.
  // What the page holds is noted first (its test ids, its text and its dialogs,
  // outside the one row acted on below), then every row's name and status is
  // clicked and double-clicked.
  const structure = () =>
    page.evaluate((acted) => {
      const body = globalThis.document.body.cloneNode(true);
      // The row the real action below changes is left out; every other row is
      // kept whole, so a panel opened inside a row counts as a change.
      for (const row of body.querySelectorAll('[data-testid="row"]')) {
        if ((row.textContent ?? '').includes(acted)) row.remove();
      }
      return {
        testIds: Array.from(body.querySelectorAll('[data-testid]')).map((e) =>
          e.getAttribute('data-testid'),
        ),
        text: (body.textContent ?? '').replace(/\s+/g, ' '),
        dialogs: body.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog').length,
      };
    }, plain.name);
  const url = page.url();
  const history = await page.evaluate(() => globalThis.history.length);
  const before = await structure();
  const allRows = page.getByTestId('row');
  const count = await allRows.count();
  for (let index = 0; index < count; index += 1) {
    const row = allRows.nth(index);
    await row.getByTestId('row-name').click();
    await row.getByTestId('row-status').click();
    await row.getByTestId('row-name').dblclick();
  }
  // Then one real action, so that anything a click set off over the network has
  // had its answer before the page is read again.
  await iconIn(plainRow, 'btn-borrow').click();
  await expect(statusOf(page, plain.name)).toHaveText(onLoanTo(MIA.name));
  await expect(page.locator('[role="alertdialog"], [role="dialog"]')).toHaveCount(0);
  expect(await structure()).toEqual(before);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => globalThis.history.length)).toBe(history);
  await expect(page.locator('[data-testid="row"] a, [data-testid="row"][href]')).toHaveCount(0);

  // No "Borrowed" header: the loan reads as its status, and no element anywhere
  // carries the word (no item of this run is named with it).
  await expect(page.getByText(/borrowed/i)).toHaveCount(0);

  expect(dialogs).toBe(0);
});
