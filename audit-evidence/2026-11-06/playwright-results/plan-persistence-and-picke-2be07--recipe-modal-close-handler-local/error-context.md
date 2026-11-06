# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan-persistence-and-picker.spec.js >> closing another modal does not run the recipe modal close handler
- Location: tests\plan-persistence-and-picker.spec.js:559:1

# Error details

```
Error: page.goto: Page crashed
Call log:
  - navigating to "http://127.0.0.1:47813/index.html", waiting until "domcontentloaded"

```

# Test source

```ts
  1   | const { test, expect } = require('@playwright/test');
  2   | const { waitForAppReady, waitForRestored } = require('./app-ready');
  3   | 
  4   | /**
  5   |  * TASK-064: two things reported from real production use.
  6   |  *
  7   |  *   1. weeklyPlan (the "By day" scheduler) resurrects after an explicit clear/remove,
  8   |  *      once the app is closed and reopened. Root cause: clearWeeklyPlan(), clearDay(),
  9   |  *      and removeRecipeFromSlot() mutated AppState.weeklyPlan and re-rendered, but never
  10  |  *      called saveData() — so the in-memory clear looked correct for the rest of that
  11  |  *      session, but localStorage/Firestore still held the pre-clear plan, and the next
  12  |  *      load restored it. plannedBatches (the "This week's batches" primary plan) was
  13  |  *      never affected — every batch mutator already called saveData() via
  14  |  *      afterPlannedBatchesChange(). The two stores are intentionally independent
  15  |  *      (D-076): this file proves the fix does not blur that line.
  16  |  *
  17  |  *   2. Plan recipe names open the shared recipe modal in read-only mode by stable recipeId —
  18  |  *      no competing viewer or display-name matching.
  19  |  *
  20  |  * Also covers the bounded Part 2 addendum: Add-meals picker spacing and the reused
  21  |  * favorite toggle.
  22  |  */
  23  | 
  24  | test.use({ viewport: { width: 1280, height: 1700 } });
  25  | 
  26  | async function loadLocalApp(page) {
  27  |   await page.route('**/firebasejs/**', (r) => r.abort());
  28  |   await page.addInitScript(() => {
  29  |     try {
  30  |       if (localStorage.getItem('__task064Bootstrapped')) return;
  31  |       localStorage.clear();
  32  |       localStorage.setItem('__task064Bootstrapped', '1');
  33  |       localStorage.setItem('mealPrepHelpSeen', '1');
  34  |       localStorage.setItem('mealPrepStartDone', '1');
  35  |       localStorage.setItem('pantryOnboardingDone', '1');
  36  |     } catch (e) {}
  37  |   });
> 38  |   await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
      |              ^ Error: page.goto: Page crashed
  39  |   await waitForAppReady(page);
  40  | }
  41  | 
  42  | // One recipe that expires before Wednesday (fridgeLife 1 < DAY_FRIDGE_INDEX.Wednesday
  43  | // === 3), one that never triggers the freshness warning, used across this file.
  44  | function seedPlanRecipes() {
  45  |   AppState.recipes.push({
  46  |     id: 'r_shortlife', name: 'Test Short Life Stew', category: 'Main Dish',
  47  |     baseServings: 4, currentServings: 4, basePrepTime: 10, baseCookTime: 20,
  48  |     fridgeLife: 1, freezerLife: 30,
  49  |     baseIngredients: [{ name: 'Test Broth', baseQuantity: 1, unit: 'L', category: 'Pantry' }],
  50  |     instructions: 'Simmer.',
  51  |     nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
  52  |   });
  53  |   AppState.recipes.push({
  54  |     id: 'r_longlife', name: 'Test Long Life Rice', category: 'Main Dish',
  55  |     baseServings: 2, currentServings: 2, basePrepTime: 5, baseCookTime: 15,
  56  |     fridgeLife: 30, freezerLife: 90,
  57  |     baseIngredients: [{ name: 'Test Rice', baseQuantity: 200, unit: 'g', category: 'Grain' }],
  58  |     instructions: 'Cook.',
  59  |     nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
  60  |   });
  61  |   AppState.plannedBatches = [];
  62  |   AppState.groceryList = [];
  63  |   AppState.cookedMeals = [];
  64  |   AppState.pantry = [];
  65  |   ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach((d) => {
  66  |     AppState.weeklyPlan[d] = { breakfast: null, lunch: null, dinner: null, snacks: [] };
  67  |   });
  68  | }
  69  | 
  70  | async function loadWithPlanRecipes(page) {
  71  |   await loadLocalApp(page);
  72  |   await page.evaluate(seedPlanRecipes);
  73  | }
  74  | 
  75  | async function confirmDialog(page) {
  76  |   await page.locator('.confirm-overlay .confirm-ok-btn').click();
  77  | }
  78  | 
  79  | // ── Persistence: clearDay() ──────────────────────────────────────────────────
  80  | 
  81  | test('clearDay() persists: the cleared day stays cleared after reload, and its stale freshness warning does not come back', async ({ page }) => {
  82  |   await loadWithPlanRecipes(page);
  83  |   await page.evaluate(() => {
  84  |     AppState.weeklyPlan.Wednesday.dinner = 'r_shortlife';
  85  |     saveData();
  86  |     showTab('planner');
  87  |     renderWeeklyPlanner(); // direct AppState mutation, unlike a real UI action, does not auto-render
  88  |   });
  89  | 
  90  |   await expect(page.locator('#storage-alerts .storage-alert-banner')).toContainText('Test Short Life Stew');
  91  | 
  92  |   await page.evaluate(() => clearDay('Wednesday'));
  93  |   await confirmDialog(page);
  94  | 
  95  |   const cleared = await page.evaluate(() => AppState.weeklyPlan.Wednesday);
  96  |   expect(cleared).toEqual({ breakfast: null, lunch: null, dinner: null, snacks: [] });
  97  |   await expect(page.locator('#storage-alerts .storage-alert-banner')).toHaveCount(0);
  98  | 
  99  |   // BUG (pre-fix): clearDay() never called saveData(), so this reload resurrected the
  100 |   // pre-clear plan and the warning came back.
  101 |   await page.reload({ waitUntil: 'domcontentloaded' });
  102 |   await waitForRestored(page, () => AppState.weeklyPlan.Wednesday.dinner === null);
  103 |   const afterReload = await page.evaluate(() => AppState.weeklyPlan.Wednesday);
  104 |   expect(afterReload).toEqual({ breakfast: null, lunch: null, dinner: null, snacks: [] });
  105 |   await page.evaluate(() => showTab('planner'));
  106 |   await expect(page.locator('#storage-alerts .storage-alert-banner')).toHaveCount(0);
  107 | });
  108 | 
  109 | // ── Persistence: clearWeeklyPlan() ───────────────────────────────────────────
  110 | 
  111 | test('clearWeeklyPlan() persists across reload and does not touch plannedBatches', async ({ page }) => {
  112 |   await loadWithPlanRecipes(page);
  113 |   await page.evaluate(() => {
  114 |     AppState.weeklyPlan.Monday.lunch = 'r_longlife';
  115 |     AppState.weeklyPlan.Wednesday.dinner = 'r_shortlife';
  116 |     addPlannedBatch('r_longlife'); // the primary plan — must survive a weeklyPlan clear
  117 |     saveData();
  118 |     showTab('planner');
  119 |   });
  120 | 
  121 |   await page.evaluate(() => clearWeeklyPlan());
  122 |   await confirmDialog(page);
  123 | 
  124 |   const immediate = await page.evaluate(() => ({
  125 |     days: Object.values(AppState.weeklyPlan).map((d) => d.breakfast || d.lunch || d.dinner || d.snacks.length),
  126 |     batches: AppState.plannedBatches.map((b) => b.recipeId)
  127 |   }));
  128 |   expect(immediate.days.every((v) => !v)).toBe(true);
  129 |   expect(immediate.batches).toEqual(['r_longlife']); // independent store (D-076), untouched
  130 | 
  131 |   await page.reload({ waitUntil: 'domcontentloaded' });
  132 |   await waitForRestored(page, () => AppState.weeklyPlan.Monday.lunch === null);
  133 |   const after = await page.evaluate(() => ({
  134 |     days: Object.values(AppState.weeklyPlan).map((d) => d.breakfast || d.lunch || d.dinner || d.snacks.length),
  135 |     batches: AppState.plannedBatches.map((b) => b.recipeId)
  136 |   }));
  137 |   expect(after.days.every((v) => !v)).toBe(true);
  138 |   expect(after.batches).toEqual(['r_longlife']);
```