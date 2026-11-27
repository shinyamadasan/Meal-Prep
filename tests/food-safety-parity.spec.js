const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// TASK-091 (PROP-041 P1-1, D-090): the food-safety rules moved from app.js to
// shared/foodSafety.js. The fixture's `expected` verdicts were generated from the app BEFORE
// the move, so this spec proves (a) the app's old global names still give exactly those
// verdicts and (b) the shared module gives the same verdicts in the browser as the Worker's
// Node test (workers/conversational-bridge/test/food-safety-parity.node.js) gives in Node.

const ROOT = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/food-safety-parity.json'), 'utf8'));

const SHARED_FUNCTIONS = ['categoryShelfLife', 'stockIngredientEntry', 'stockFoodClass', 'stockCalendarDay',
  'daysLeftFrom', 'pantryDaysLeft', 'pantryFridgeSafety', 'pantryDateSignal', 'pantryLotAvailable',
  'isStaple', 'cookedShelfLife', 'cookedDateSignal'];
const SHARED_DATA = ['INGREDIENT_DB', 'STOCK_CLASS_RULES', 'FRIDGE_SAFETY_LIMITS', 'COOKED_FRIDGE_LIMIT',
  'FRIDGE_SAFETY_EXCLUSIONS', 'FRESHNESS_WARN_DAYS'];

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

test('the app\'s old global names give the pre-move verdicts for every fixture case', async ({ page }) => {
  await openApp(page);
  for (const today of fixture.todays) {
    await page.clock.setFixedTime(new Date(today + 'T12:00:00'));
    const results = await page.evaluate(({ cases, today }) => {
      if (todayISO() !== today) throw new Error('clock not fixed: ' + todayISO());
      const appApi = { stockFoodClass, isStaple, pantryDaysLeft, pantryFridgeSafety, pantryDateSignal,
        pantryLotAvailable, cookedShelfLife, cookedDateSignal, stockCalendarDay, categoryShelfLife, daysLeftFrom };
      return cases.map((testCase) => FoodSafetyParity.evaluateCase(appApi, testCase, today));
    }, { cases: fixture.cases, today });
    fixture.cases.forEach((testCase, i) => {
      expect(results[i], `${testCase.id} @ ${today}`).toEqual(testCase.expected[today]);
    });
  }
});

test('the shared module gives the same verdicts in the browser as in the Worker', async ({ page }) => {
  await openApp(page);
  for (const today of fixture.todays) {
    const results = await page.evaluate(({ cases, today }) => cases.map((testCase) => ({
      // The app's own storage inference: what the app wrappers pass.
      app: FoodSafetyParity.evaluateCase(MealPrepFoodSafety, testCase, today, inferStorage),
      // No hook: the Worker's default storage path.
      shared: FoodSafetyParity.evaluateCase(MealPrepFoodSafety, testCase, today)
    })), { cases: fixture.cases, today });
    fixture.cases.forEach((testCase, i) => {
      expect(results[i].app, `${testCase.id} @ ${today} (app storage)`).toEqual(testCase.expected[today]);
      expect(results[i].shared, `${testCase.id} @ ${today} (default storage)`)
        .toEqual((testCase.expectedDefault || testCase.expected)[today]);
    });
  }
});

test('the app binds the shared rules instead of defining its own copy', async ({ page }) => {
  await openApp(page);
  const bound = await page.evaluate((names) => ({
    frozen: Object.isFrozen(MealPrepFoodSafety),
    same: {
      INGREDIENT_DB: INGREDIENT_DB === MealPrepFoodSafety.INGREDIENT_DB,
      STOCK_CLASS_RULES: STOCK_CLASS_RULES === MealPrepFoodSafety.STOCK_CLASS_RULES,
      FRIDGE_SAFETY_LIMITS: FRIDGE_SAFETY_LIMITS === MealPrepFoodSafety.FRIDGE_SAFETY_LIMITS,
      COOKED_FRIDGE_LIMIT: COOKED_FRIDGE_LIMIT === MealPrepFoodSafety.COOKED_FRIDGE_LIMIT,
      FRIDGE_SAFETY_EXCLUSIONS: FRIDGE_SAFETY_EXCLUSIONS === MealPrepFoodSafety.FRIDGE_SAFETY_EXCLUSIONS,
      FRESHNESS_WARN_DAYS: FRESHNESS_WARN_DAYS === MealPrepFoodSafety.FRESHNESS_WARN_DAYS
    },
    wrappers: names.filter((name) => typeof window[name] === 'function' &&
      window[name] !== MealPrepFoodSafety[name] &&
      String(window[name]).includes('MealPrepFoodSafety.' + name + '('))
  }), SHARED_FUNCTIONS);
  expect(bound.frozen).toBe(true);
  expect(Object.values(bound.same).every(Boolean), JSON.stringify(bound.same)).toBe(true);
  expect(bound.wrappers).toEqual(SHARED_FUNCTIONS);

  // One definition of each rule: app.js keeps only the one-line wrappers and bindings.
  const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  for (const name of SHARED_FUNCTIONS) {
    const body = appSource.match(new RegExp('function ' + name + '\\([^)]*\\) \\{\\r?\\n([\\s\\S]*?)\\r?\\n\\}'));
    expect(body, name).not.toBeNull();
    expect(body[1].trim(), name).toMatch(new RegExp('^return MealPrepFoodSafety\\.' + name + '\\([^;]*\\);$'));
  }
  for (const name of SHARED_DATA) {
    expect(appSource, name).toMatch(new RegExp('(?:const|var) ' + name + ' = MealPrepFoodSafety\\.' + name + ';'));
  }
});

test('index.html loads the shared rules before app.js and the offline cache includes them', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const shared = html.indexOf('<script src="shared/foodSafety.js"></script>');
  const app = html.indexOf('<script src="app.js"></script>');
  expect(shared).toBeGreaterThan(-1);
  expect(shared).toBeLessThan(app);

  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const staticList = sw.match(/const STATIC = (\[[^\]]*\]);/);
  expect(staticList).not.toBeNull();
  const files = JSON.parse(staticList[1].replace(/'/g, '"'));
  expect(files).toEqual(expect.arrayContaining(['./shared/readyFoodContract.js', './shared/foodSafety.js', './app.js']));
});
