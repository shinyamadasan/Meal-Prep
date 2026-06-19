const { test, expect } = require('@playwright/test');

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

/**
 * Functional button tests.
 *
 * Unlike button-smoke.spec.js (which only checks that clicking doesn't crash),
 * each test here asserts the BUTTON ACTUALLY DID ITS JOB — the modal opened, the
 * item appeared, the tab switched, the print document was built, etc. This is the
 * kind of test that catches "it ran but did nothing" bugs (like Print silently
 * failing because of a popup blocker).
 *
 * Tests run against the live site, each in a fresh isolated browser context, so
 * they never see each other's data.
 */

async function loadApp(page) {
  // Suppress the first-run Help modal so it doesn't cover the page.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mealPrepHelpSeen', '1');
    } catch (e) {}
  });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(2000); // let the SPA initialize
}

async function openTab(page, tab) {
  const inMore = ['ingredients', 'hacks'].includes(tab); // moved under the "More" menu
  if (inMore) await page.locator('.tab-more-btn').click();
  await page.locator(`${inMore ? '.tab-more-menu ' : ''}.tab-btn[data-tab="${tab}"]`).click();
  await expect(page.locator(`#${tab}`)).toHaveClass(/active/);
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Tab navigation', () => {
  const tabs = [
    ['planner', 'Weekly Planner'],
    ['grocery', 'Grocery List'],
    ['fridge', 'My Fridge'],
    ['hacks', 'Cooking Hacks'],
    ['nutrition', 'Nutrition'],
    ['ingredients', 'Ingredients'],
    ['recipes', 'My Recipes'],
  ];

  test('every nav tab button activates its panel', async ({ page }) => {
    await loadApp(page);
    for (const [id] of tabs) {
      await openTab(page, id);
      // The matching panel is visible and the others are not active.
      await expect(page.locator(`#${id}`)).toBeVisible();
      await expect(page.locator(`.tab-btn[data-tab="${id}"]`)).toHaveClass(/active/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Modals open and close', () => {
  test('Help: ? opens, "Got it" closes', async ({ page }) => {
    await loadApp(page);
    await page.locator('.help-btn').click();
    await expect(page.locator('#help-modal')).toBeVisible();
    await page.locator('#help-modal').getByRole('button', { name: 'Got it' }).click();
    await expect(page.locator('#help-modal')).toBeHidden();
  });

  test('Add New Recipe: opens the recipe form, close button dismisses', async ({ page }) => {
    await loadApp(page);
    await page.locator('#add-recipe-btn').click();
    await expect(page.locator('#recipe-modal')).toBeVisible();
    await expect(page.locator('#recipe-form')).toBeVisible();
    await page.locator('#recipe-modal .modal-close').click();
    await expect(page.locator('#recipe-modal')).toBeHidden();
  });

  test('Paste Recipe: opens and cancels', async ({ page }) => {
    await loadApp(page);
    await page.getByRole('button', { name: /Paste Recipe/ }).click();
    const modal = page.locator('.modal:not(.hidden)');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.modal:not(.hidden)')).toHaveCount(0);
  });

  test('Nutrition goals: opens and closes', async ({ page }) => {
    await loadApp(page);
    await openTab(page, 'nutrition');
    await page.getByRole('button', { name: /Goals/ }).first().click();
    await expect(page.locator('#nutrition-goals-modal')).toBeVisible();
    await page.locator('#nutrition-goals-modal .modal-close').click();
    await expect(page.locator('#nutrition-goals-modal')).toBeHidden();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Data menu', () => {
  test('⋯ Data toggles the menu panel', async ({ page }) => {
    await loadApp(page);
    await page.getByRole('button', { name: /Data/ }).first().click();
    await expect(page.locator('#data-menu-panel')).toBeVisible();
  });

  test('Export Data downloads a file', async ({ page }) => {
    await loadApp(page);
    await page.getByRole('button', { name: /Data/ }).first().click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#data-menu-panel').getByRole('button', { name: /Export Data/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Pantry (My Fridge)', () => {
  test('add an item into a chosen section', async ({ page }) => {
    await loadApp(page);
    await openTab(page, 'fridge');
    await page.locator('#pantry-input').fill('Test Ice Cream');
    await page.locator('#pantry-add-where').selectOption('freezer');
    await page.locator('#pantry-body').getByRole('button', { name: /Add/ }).first().click();

    // It shows up under the Freezer section.
    await expect(page.locator('.pt-name', { hasText: 'Test Ice Cream' })).toBeVisible();
    await expect(page.getByText('In the Freezer')).toBeVisible();
  });

  test('staple pill cycles Full/OK/Low', async ({ page }) => {
    await loadApp(page);
    await openTab(page, 'fridge');
    const pill = page.locator('.pt-level').first();
    await expect(pill).toBeVisible();
    const before = (await pill.textContent()).trim();
    await pill.click();
    await expect(pill).not.toHaveText(before); // label actually changed
  });

  test('Date mode toggles bought <-> expires', async ({ page }) => {
    await loadApp(page);
    await openTab(page, 'fridge');
    const toggle = page.locator('.pt-datemode').first();
    const before = (await toggle.textContent()).trim();
    await toggle.click();
    await expect(toggle).not.toHaveText(before);
  });

  test('setting a staple to Low adds it to the grocery list', async ({ page }) => {
    await loadApp(page);
    await openTab(page, 'fridge');

    // Find a known seeded staple row and set it Low (default OK -> one tap = Low).
    const saltRow = page.locator('tr', { has: page.locator('.pt-name', { hasText: 'Salt' }) });
    const pill = saltRow.locator('.pt-level');
    await expect(pill).toBeVisible();
    // Cycle until it reads "Low".
    for (let i = 0; i < 3 && (await pill.textContent()).trim() !== 'Low'; i++) {
      await pill.click();
    }
    await expect(pill).toHaveText('Low');

    await openTab(page, 'grocery');
    await expect(page.locator('#grocery-list')).toContainText('Salt');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Grocery list', () => {
  async function addCustomItem(page, name) {
    await openTab(page, 'grocery');
    await page.locator('#add-custom-item').click();
    await expect(page.locator('#custom-item-modal')).toBeVisible();
    await page.locator('#custom-item-name').fill(name);
    await page.locator('#custom-item-modal').getByRole('button', { name: /Add to List/ }).click();
    await expect(page.locator('#grocery-list')).toContainText(name);
  }

  test('Add Custom Item puts an item on the list', async ({ page }) => {
    await loadApp(page);
    await addCustomItem(page, 'Olive Oil Test');
  });

  test('grocery items show a price', async ({ page }) => {
    await loadApp(page);
    await openTab(page, 'grocery');
    await page.locator('#add-custom-item').click();
    await expect(page.locator('#custom-item-modal')).toBeVisible();
    // A name that exists in INGREDIENT_DB (priced "₱200/kg").
    await page.locator('#custom-item-name').fill('Chicken Breast');
    await page.locator('#custom-item-qty').fill('1');
    await page.locator('#custom-item-unit').fill('kg');
    await page.locator('#custom-item-modal').getByRole('button', { name: /Add to List/ }).click();
    // A peso price now appears for the item.
    await expect(page.locator('#grocery-list .ingredient-price')).toContainText('₱');
  });

  test('Print builds the printable grocery document', async ({ page }) => {
    await loadApp(page);
    await addCustomItem(page, 'Printable Test Item');

    await page.getByRole('button', { name: /Print/ }).click();

    // Print now uses the main window + a print-only #grocery-print-area (reliable
    // on mobile). Assert that area gets populated with the list.
    await expect(page.locator('#grocery-print-area')).toContainText('Printable Test Item');
    await expect(page.locator('#grocery-print-area')).toContainText('Grocery List');
  });

  test('Copy List copies without error', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await loadApp(page);
    await addCustomItem(page, 'Copyable Test Item');

    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.getByRole('button', { name: /Copy List/ }).click();
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('Clear All empties the list (after confirm)', async ({ page }) => {
    await loadApp(page);
    await addCustomItem(page, 'Clearable Test Item');

    page.once('dialog', (d) => d.accept()); // confirm the clear
    await page.locator('#clear-grocery').click();

    await expect(page.locator('#grocery-list')).not.toContainText('Clearable Test Item');
  });
});
