const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// TASK-092 (PROP-041 P1-2, D-091): the ready-food portion helpers and the
// getReadyFoodSuggestions() availability filter moved from app.js to shared/foodSafety.js so the
// conversational Worker's get_ready_food `usable` uses the app's own rule. The fixture's
// `expected` verdicts were generated from the app BEFORE the move, so this spec proves (a) the
// app still gives exactly those verdicts and (b) the shared module gives them in the browser, as
// the Worker's Node test (workers/conversational-bridge/test/ready-food-parity.node.js) does in Node.

const ROOT = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ready-food-parity.json'), 'utf8'));

async function openApp(page) {
  await page.route('**/firebasejs/**', (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('mealPrepHelpSeen', '1');
    localStorage.setItem('mealPrepStartDone', '1');
    localStorage.setItem('pantryOnboardingDone', '1');
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof AppState !== 'undefined' && typeof saveData === 'function');
  await page.addScriptTag({ path: path.join(__dirname, 'fixtures/food-safety-parity-eval.js') });
}

test('the app gives the pre-move ready-food verdicts for every fixture case', async ({ page }) => {
  await openApp(page);
  for (const today of fixture.todays) {
    await page.clock.setFixedTime(new Date(today + 'T12:00:00'));
    const results = await page.evaluate(({ cases, today }) => {
      if (todayISO() !== today) throw new Error('clock not fixed: ' + todayISO());
      const saved = AppState.cookedMeals;
      // The app's availability verdict is whether getReadyFoodSuggestions() returns the batch.
      const appApi = { cookedMealTracksPortions, portionCountOrNull, cookedDateSignal,
        cookedMealAvailable: (meal) => {
          AppState.cookedMeals = [meal];
          return getReadyFoodSuggestions().length === 1;
        } };
      try {
        return cases.map((testCase) => FoodSafetyParity.evaluateCase(appApi, testCase, today));
      } finally {
        AppState.cookedMeals = saved;
      }
    }, { cases: fixture.cases, today });
    fixture.cases.forEach((testCase, i) => {
      expect(results[i], `${testCase.id} @ ${today}`).toEqual(testCase.expected[today]);
    });
  }
});

test('the shared module gives the same ready-food verdicts in the browser as in the Worker', async ({ page }) => {
  await openApp(page);
  for (const today of fixture.todays) {
    const results = await page.evaluate(({ cases, today }) => cases.map((testCase) =>
      FoodSafetyParity.evaluateCase(MealPrepFoodSafety, testCase, today)), { cases: fixture.cases, today });
    fixture.cases.forEach((testCase, i) => {
      expect(results[i], `${testCase.id} @ ${today}`).toEqual(testCase.expected[today]);
    });
  }
});

test('the app binds the shared portion rules instead of defining its own copy', async ({ page }) => {
  await openApp(page);
  const bound = await page.evaluate(() => ({
    max: PORTION_COUNT_MAX === MealPrepFoodSafety.PORTION_COUNT_MAX,
    wrappers: ['portionCountOrNull', 'cookedMealTracksPortions'].filter((name) =>
      typeof window[name] === 'function' && window[name] !== MealPrepFoodSafety[name] &&
      String(window[name]).includes('MealPrepFoodSafety.' + name + '('))
  }));
  expect(bound.max).toBe(true);
  expect(bound.wrappers).toEqual(['portionCountOrNull', 'cookedMealTracksPortions']);

  const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  for (const name of ['portionCountOrNull', 'cookedMealTracksPortions']) {
    const body = appSource.match(new RegExp('function ' + name + '\\([^)]*\\) \\{\\r?\\n([\\s\\S]*?)\\r?\\n\\}'));
    expect(body, name).not.toBeNull();
    expect(body[1].trim(), name).toMatch(new RegExp('^return MealPrepFoodSafety\\.' + name + '\\([^;]*\\);$'));
  }
  expect(appSource).toMatch(/var PORTION_COUNT_MAX = MealPrepFoodSafety\.PORTION_COUNT_MAX;/);
  expect(appSource).toMatch(/MealPrepFoodSafety\.cookedMealAvailable\(m, todayISO\(\)\)/);
});
