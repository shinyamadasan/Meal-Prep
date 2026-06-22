const { test, expect } = require('@playwright/test');

test('Meal Prep app loads', async ({ page }) => {
  await page.goto('https://shinyamadasan.github.io/Meal-Prep/');

  await expect(page).toHaveURL(/Meal-Prep/);

  const buttons = await page.locator('button').count();
  console.log(`Found ${buttons} buttons`);
});