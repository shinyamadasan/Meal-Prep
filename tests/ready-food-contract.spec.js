const { test, expect } = require('@playwright/test');

test('manual ready-food entry reads source and freshness defaults from the shared contract', async ({ page }) => {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mealPrepHelpSeen', '1');
    localStorage.setItem('mealPrepStartDone', '1');
    localStorage.setItem('pantryOnboardingDone', '1');
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof AppState !== 'undefined' && typeof saveData === 'function');

  await page.evaluate(() => openManualCookedModal());
  const contract = await page.evaluate(() => ({
    shared: MealPrepReadyFoodContract,
    options: Array.from(document.querySelector('#manual-cooked-source').options, (option) => ({ value: option.value, label: option.textContent })),
    source: document.querySelector('#manual-cooked-source').value,
    fridge: document.querySelector('#manual-cooked-fridge-life').value,
    freezer: document.querySelector('#manual-cooked-freezer-life').value
  }));
  expect(contract.shared.sources).toEqual(['leftovers', 'takeout']);
  expect(contract.options).toEqual([
    { value: 'leftovers', label: 'Leftovers' },
    { value: 'takeout', label: 'Takeout' }
  ]);
  expect(contract.source).toBe('leftovers');
  expect(contract.fridge).toBe('3');
  expect(contract.freezer).toBe('90');

  await page.locator('#manual-cooked-name').fill('Pizza');
  await page.locator('#manual-cooked-source').selectOption('takeout');
  await page.locator('#manual-cooked-modal .btn--primary').click();
  const saved = await page.evaluate(() => {
    const meal = AppState.cookedMeals[AppState.cookedMeals.length - 1];
    return { source: meal.source, fridgeLife: meal.fridgeLife, freezerLife: meal.freezerLife };
  });
  expect(saved).toEqual({ source: 'takeout', fridgeLife: 3, freezerLife: 90 });
});
