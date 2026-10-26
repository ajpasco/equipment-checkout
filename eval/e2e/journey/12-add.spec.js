/**
 * REQ-009, Adds that are not carried out, on the running stack: an empty or
 * whitespace-only name, a name the real server rejects for its length, and a
 * second Enter while an Add is still in progress.
 *
 * Read-only to every builder. Added with the journey pairs (eval plan 1.6).
 *
 * Rows: T-009-N16, T-009-N17, T-009-N18.
 *
 * "No item was created" is read from the stack: the number of items it lists is
 * the same before and after, and no item carries the names the row tried. One
 * worker runs the rows (playwright.config.js), so nothing else adds meanwhile.
 */

import { test, expect } from '@playwright/test';
import { itemNamed, readList } from '../support/api.js';
import {
  addCard,
  addField,
  addValidation,
  apiFailureModal,
  openAndPick,
  placementOfTheMessage,
  rowNamed,
  statusOf,
  typeAndEnter,
} from '../support/app.js';
import { holdNextRequest, rewriteBody, theAddRequest } from '../support/intercept.js';
import { uniqueName } from '../support/names.js';
import { ADA, AVAILABLE, NAME_REQUIRED, NAME_TOO_LONG } from '../support/strings.js';

/** The message is shown, reads `text` when given, and passes all four placement checks. */
async function expectTheInlineMessage(page, text) {
  await expect(addValidation(page)).toBeVisible();
  if (text !== undefined) {
    await expect(addValidation(page)).toHaveText(text);
  } else {
    await expect(addValidation(page)).not.toBeEmpty();
  }
  expect(await placementOfTheMessage(page)).toEqual({
    found: true,
    insideTheCard: true,
    afterTheField: true,
    belowTheField: true,
    withinTheCard: true,
  });
  // On the page, not in a modal.
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
}

test('T-009-N16 REQ-009.4 REQ-009.5 REQ-009.6 REQ-009.8 an empty or blank name is not added and the message shows in the Add card', async ({
  page,
  request,
}) => {
  await openAndPick(page, ADA.id);
  await expect(addCard(page)).toBeVisible();
  await expect(addField(page)).toBeVisible();
  const before = (await readList(request)).length;

  // Enter with the field empty.
  await addField(page).fill('');
  await addField(page).press('Enter');
  await expectTheInlineMessage(page, NAME_REQUIRED);

  // The Add icon with the field empty, on a freshly loaded page.
  await openAndPick(page, ADA.id);
  await addField(page).fill('');
  await addCard(page).getByTestId('btn-add').click();
  await expectTheInlineMessage(page, NAME_REQUIRED);

  // Only spaces and Enter; then only a tab and the Add icon.
  await openAndPick(page, ADA.id);
  await typeAndEnter(page, '   ');
  await expectTheInlineMessage(page, NAME_REQUIRED);
  await openAndPick(page, ADA.id);
  await addField(page).fill('\t');
  await addCard(page).getByTestId('btn-add').click();
  await expectTheInlineMessage(page, NAME_REQUIRED);

  // Nothing was created.
  await openAndPick(page, ADA.id);
  expect((await readList(request)).length).toBe(before);
});

test('T-009-N17 REQ-009.10 REQ-009.11 REQ-009.15 a name over 100 characters is not added, and the server\'s rejection shows the inline message', async ({
  page,
  request,
}) => {
  await openAndPick(page, ADA.id);
  await expect(addCard(page)).toBeVisible();
  const before = (await readList(request)).length;

  // Typed in the field: 101 characters after trimming, with spaces around them.
  const typed = uniqueName('Overlong').padEnd(101, 'x');
  expect(Array.from(typed).length).toBe(101);
  await typeAndEnter(page, `  ${typed}  `);
  await expectTheInlineMessage(page, NAME_TOO_LONG);
  await expect(apiFailureModal(page)).toHaveCount(0);

  // The same rule kept by the server: a short name typed, and the request that
  // leaves the browser rewritten to carry 101 characters. What reaches the page
  // is the real server's answer, so this is the server rejecting the name, and
  // the person is shown the inline message, not the API failure modal.
  await openAndPick(page, ADA.id);
  const short = uniqueName('Short');
  const long = uniqueName('Rewritten').padEnd(101, 'y');
  await rewriteBody(page, theAddRequest, { name: long });
  await typeAndEnter(page, short);
  await expectTheInlineMessage(page);
  await expect(apiFailureModal(page)).toHaveCount(0);

  // Nothing was created under any of the three names.
  const kept = await readList(request);
  expect(kept.length).toBe(before);
  for (const name of [typed, short, long]) {
    expect(itemNamed(kept, name)).toBeUndefined();
  }
  await openAndPick(page, ADA.id);
  await expect(rowNamed(page, short)).toHaveCount(0);
});

test('T-009-N18 REQ-009.13 REQ-009.14 while an Add is in progress its loader replaces the Add icon and Enter adds nothing more', async ({
  page,
  request,
}) => {
  await openAndPick(page, ADA.id);
  await expect(addCard(page).getByTestId('btn-add')).toBeVisible();

  const name = uniqueName('Pallet');
  const hold = await holdNextRequest(page, theAddRequest);
  await typeAndEnter(page, name);
  await hold.held;

  // In progress: the Add loader in the Add card, no Add icon to activate, and
  // the item not yet in the list.
  await expect(addCard(page).getByTestId('add-loader')).toBeVisible();
  await expect(addCard(page).getByTestId('btn-add')).toHaveCount(0);
  await expect(rowNamed(page, name)).toHaveCount(0);

  // Enter again, twice, in the Add field: nothing more happens, no message and
  // no modal. The field is not refilled first, because whether it can be edited
  // while the loader shows is not pinned.
  await addField(page).press('Enter');
  await addField(page).press('Enter');
  await expect(addValidation(page)).toHaveCount(0);
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);

  hold.release();
  await expect(statusOf(page, name)).toHaveText(AVAILABLE);
  await expect(addCard(page).getByTestId('add-loader')).toHaveCount(0);

  // Exactly one item of that name, on the page and in what the stack kept.
  await expect(rowNamed(page, name)).toHaveCount(1);
  expect((await readList(request)).filter((item) => item.name === name)).toHaveLength(1);
});
