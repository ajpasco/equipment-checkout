/**
 * The page, named in the plain-English words the rows use.
 *
 * Frozen at the S4 freeze. Read-only to every builder, S4's own included.
 *
 * Eval plan 1.4 fixes the mapping from a row's words to the blueprint's
 * `data-testid` (blueprint 12.8), and this file is that table in code, so a row
 * reads like its sentence. Eval plan 1.1: a locator is the instrument that
 * observes an outcome and never the thing verified, so no row here asserts that
 * a locator exists for its own sake; each one asserts what a person sees.
 */

import { expect } from '@playwright/test';
import { NO_EQUIPMENT_YET } from './strings.js';

/** Open the app. The stack is already running: C10 starts it, not this config. */
export async function openApp(page) {
  await page.goto('/');
}

export function switcher(page) {
  return page.getByTestId('switcher');
}

/** The switcher's three user entries, in document order, as a person reads them. */
export async function switcherEntries(page) {
  const options = page.locator('[data-testid^="switcher-option-"]');
  await expect(options.first()).toBeAttached();
  return options.allTextContents();
}

/**
 * Pick the acting user. This only picks: it does not wait for the list, because
 * a row whose list request is refused, rejected or aborted (T-013-P22, T-001-N8)
 * never gets one and must still be able to pick.
 */
export async function pickUser(page, userId) {
  await switcher(page).selectOption(String(userId));
}

/**
 * Wait until the list request the page made at the pick has settled and the page
 * shows the person either a list or the empty text.
 *
 * The two waits are in this order on purpose. Waiting for the list or the empty
 * text first is what proves the fetch finished; checking that the indicator is
 * gone first would pass before the fetch had even started, when no indicator has
 * yet been rendered. No fixed pause is used anywhere (eval plan 1.1, no sleeps).
 */
export async function expectListSettled(page) {
  await expect(
    page.getByTestId('equipment-list').or(page.getByTestId('empty-state')),
  ).toBeVisible();
  await expect(page.getByTestId('list-indicator')).toHaveCount(0);
}

export async function openAndPick(page, userId) {
  await openApp(page);
  await pickUser(page, userId);
  await expectListSettled(page);
}

export function rows(page) {
  return page.getByTestId('row');
}

/**
 * The row of one item. Item names are unique per run (support/names.js), so a
 * substring match cannot reach another row, and the row's own name is asserted
 * by `expectListHolds` where a row needs it stated.
 */
export function rowNamed(page, name) {
  return rows(page).filter({ hasText: name });
}

export function statusOf(page, name) {
  return rowNamed(page, name).getByTestId('row-status');
}

export function iconIn(row, testId) {
  return row.getByTestId(testId);
}

/**
 * What the person sees in the list: each row's name and status, in order. The
 * status text carries the borrower for an On loan row (blueprint 12.9), so this
 * is names, statuses and borrowers together, which is what T-013-N5 and the
 * restart rows compare.
 */
export async function listOnScreen(page) {
  await expect(page.getByTestId('equipment-list')).toBeVisible();
  const seen = [];
  for (const row of await rows(page).all()) {
    seen.push({
      name: (await row.getByTestId('row-name').textContent())?.trim() ?? '',
      status: (await row.getByTestId('row-status').textContent())?.trim() ?? '',
    });
  }
  return seen;
}

export function accessDeniedModal(page) {
  return page.getByTestId('modal-access-denied');
}

export function apiFailureModal(page) {
  return page.getByTestId('modal-api-failure');
}

export function borrowerModal(page) {
  return page.getByTestId('modal-borrower');
}

export function confirmDeleteModal(page) {
  return page.getByTestId('modal-confirm-delete');
}

export function emptyText(page) {
  return page.getByText(NO_EQUIPMENT_YET, { exact: true });
}

export function addField(page) {
  return page.getByTestId('add-input');
}

export function addCard(page) {
  return page.getByTestId('add-card');
}

/**
 * Add an item the way the PRD's journey does: type the name and press Enter.
 */
export async function typeAndEnter(page, name) {
  await addField(page).fill(name);
  await addField(page).press('Enter');
}

/**
 * Wait out the Show loading demo without sleeping: the list indicator appears
 * and then disappears (eval plan 1.1). Five seconds is a timeout, not a duration
 * any row asserts; the 900 ms of REQ-013.13 is never measured here.
 */
export async function waitOutTheLoadingDemo(page) {
  const indicator = page.getByTestId('list-indicator');
  await expect(indicator).toBeVisible({ timeout: 5000 });
  await expect(indicator).toHaveCount(0, { timeout: 5000 });
}

/**
 * Every piece of text, `title` and `aria-label` the page shows outside the top
 * bar, for the two rows that assert nothing names the admin who acted
 * (T-004-P7, T-006-P7; REQ-004.9, REQ-006.6).
 *
 * The top bar is excluded because it is where the acting user is *supposed* to
 * be named: it holds "Acting as", the switcher with "Ada Admin (admin)" in it
 * and the role badge (blueprint 12.8.1). Everything else is the interface those
 * criteria speak about. The exclusion is done by removing the top bar from a
 * clone of the body, so a build that renders no top bar does not quietly pass:
 * its switcher text would then be inside what is scanned and the row would fail.
 */
export async function textsOutsideTheTopBar(page) {
  await expect(page.getByTestId('top-bar')).toBeVisible();
  return page.evaluate(() => {
    const body = globalThis.document.body.cloneNode(true);
    const topBar = body.querySelector('[data-testid="top-bar"]');
    if (topBar !== null) {
      topBar.remove();
    }
    const found = [body.textContent ?? ''];
    for (const element of body.querySelectorAll('[title], [aria-label]')) {
      found.push(element.getAttribute('title') ?? '', element.getAttribute('aria-label') ?? '');
    }
    return found;
  });
}

export function addValidation(page) {
  return page.getByTestId('add-validation');
}

/**
 * The four checks of the inline message's placement (eval plan 1.1, blueprint
 * 12.8.1), all four, because a J row runs in Chromium, which lays the page out.
 * Returns the facts and leaves the asserting to the row, so a failure names the
 * check that failed.
 */
export function placementOfTheMessage(page) {
  return page.evaluate(() => {
    const card = globalThis.document.querySelector('[data-testid="add-card"]');
    const field = globalThis.document.querySelector('[data-testid="add-input"]');
    const message = globalThis.document.querySelector('[data-testid="add-validation"]');
    if (card === null || field === null || message === null) {
      return { found: false };
    }
    const cardBox = card.getBoundingClientRect();
    const fieldBox = field.getBoundingClientRect();
    const box = message.getBoundingClientRect();
    return {
      found: true,
      // (1) inside the Add card in the document.
      insideTheCard: card.contains(message),
      // (2) after the Add field in document order.
      afterTheField: (field.compareDocumentPosition(message) & 4) === 4,
      // (3) laid out below the field: its top not above the field's lower edge, and
      // the two boxes not overlapping.
      belowTheField:
        box.top >= fieldBox.bottom - 0.5 &&
        !(
          box.left < fieldBox.right &&
          box.right > fieldBox.left &&
          box.top < fieldBox.bottom &&
          box.bottom > fieldBox.top
        ),
      // (4) its whole box within the Add card's box.
      withinTheCard:
        box.left >= cardBox.left - 0.5 &&
        box.right <= cardBox.right + 0.5 &&
        box.top >= cardBox.top - 0.5 &&
        box.bottom <= cardBox.bottom + 0.5,
    };
  });
}

/**
 * What has the keyboard focus, as a person would name it: the control's
 * data-testid and, for a row's control, the id of the item its row shows.
 */
export function focused(page) {
  return page.evaluate(() => {
    const active = globalThis.document.activeElement;
    if (active === null || active === globalThis.document.body) {
      return { control: null, itemId: null };
    }
    const row = active.closest('[data-testid="row"]');
    return {
      control: active.getAttribute('data-testid') ?? active.tagName.toLowerCase(),
      itemId: row === null ? null : Number(row.getAttribute('data-item-id')),
    };
  });
}

/**
 * Move the focus with the keyboard alone until it is on `control` (and, when
 * `itemId` is given, on that item's row). `key` is 'Tab' or 'Shift+Tab'. Returns
 * whether it got there and where the focus went on the way, so a failure says
 * what the keyboard could reach instead.
 *
 * The stack's list is long (every earlier row's items are still in it) and the
 * item a row just created is the last row, so a row that wants a row's control
 * goes backwards with Shift+Tab, which is still the keyboard alone. Where the
 * browser starts the walk after the focus is taken away is its own business, so
 * the limit is long enough to go round the whole page rather than relying on it.
 */
export async function keyboardTo(page, { control, itemId = null, key = 'Tab', limit = 400 }) {
  const passed = [];
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press(key);
    const now = await focused(page);
    passed.push(now.itemId === null ? now.control : `${now.control}@${now.itemId}`);
    if (now.control === control && (itemId === null || now.itemId === itemId)) {
      return { reached: true, passed };
    }
  }
  return { reached: false, passed };
}

/** Take the focus off everything, so the next Shift+Tab starts from the end of the page. */
export async function focusNothing(page) {
  await page.evaluate(() => {
    const active = globalThis.document.activeElement;
    if (active !== null && typeof active.blur === 'function') {
      active.blur();
    }
  });
}

/**
 * Every control on the page, as REQ-017.18 counts them (blueprint 12.8.3): every
 * button, input, select, a and textarea, and every element with a tabindex or a
 * button role. Each is named by its data-testid, or by its tag when it has none,
 * which is itself a finding.
 */
export function controlsOnThePage(page) {
  return page.evaluate(() =>
    Array.from(
      globalThis.document.querySelectorAll(
        'button, input, select, a, textarea, [tabindex], [role="button"]',
      ),
    ).map((element) => element.getAttribute('data-testid') ?? `<${element.tagName.toLowerCase()}>`),
  );
}
