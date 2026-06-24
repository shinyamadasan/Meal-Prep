# Meal Prep Planner — Development Roadmap

## Vision

A Kitchen Operating System that manages the full pantry lifecycle:
buy → cook → store → use → restock.

---

## How Claude Works Through This File

1. Complete the Current Task
2. Mark it as ✅ Done (move it to the Done section at the bottom)
3. Pull the next item from the Task Queue into Current Task
4. Repeat until the queue is empty or token limit is reached
5. Update STATUS.md after each completed task

---

## Current Task

**Queue empty — all tasks done as of 2026-06-23.**

No pending tasks. Next session: add new tasks here before starting.

---

## Do Not Work On

- Dark mode toggle (more problems than value)
- Community feed or family sharing features
- PWA manifest or offline-mode changes (service worker is handled in Task 3 only)
- UI redesign beyond what tasks specify
- New sample recipes
- USDA API changes
- Family sharing or community features

---

## Done

### ✅ Recipe favorites (2026-06-22)
`toggleFavorite()` toggles `recipe.favorite` boolean and calls `saveData()`. Heart button (♥) added to every recipe card header — grey when off, red when on. "♥ Favorites" checkbox filter added to the recipe search bar; when checked, only favorited recipes show. State persists via `saveData()`.

### ✅ "Buy it" button on cook suggestions (2026-06-22)
`buyMissingIngredient()` adds the missing ingredient to `AppState.groceryList` without duplication and calls `renderGroceryList()`. "Buy it" button appears on every "Missing 1" cook suggestion card.

### ✅ Text search in Ingredient Catalog (2026-06-22)
`#ingcat-search` input and `filterIngredientCatalog()` were already implemented. Added `#ingcat-no-results` element so the "No ingredients found" message appears correctly when nothing matches.

### ✅ Global error handler (2026-06-22)
`window.addEventListener('error', ...)` added at end of `app.js`. Uncaught errors show a dismissable red banner at the top of the page. Error still logged to console. CSS for `.global-error-banner` added to `style.css`.

### ✅ Service worker — verified working (2026-06-22)
`sw.js` exists, caches `index.html`, `app.js`, `style.css`, `chart.min.js`, `icon.svg`, `manifest.json`. Registration in `index.html` uses `.catch(() => {})` to suppress errors. No code changes needed.

### ✅ Fix silent JS errors on every page load (2026-06-22)
`updateGrocerySummary()` wrapped `#selected-meals-count` access in null check. `updateAuthUI()` and `updateThemeToggleIcon()` references were already gone from the codebase — those bugs were previously fixed.

### ✅ Mung Beans in INGREDIENT_DB (2026-06-22)
Added Mung Beans entry with aliases `['mung beans', 'monggo', 'green mung beans', 'munggo', 'mung dal']`, unit `g`, category `Grain`, `priceValue: 80`, `minStockQty: 200`. Pantry autocomplete and Ginisang Monggo cook suggestions now work correctly.

### ✅ Grocery list refresh on serving-size change (2026-06-22)
`renderGroceryList()` is now called whenever a recipe's serving count changes in the planner.

### ✅ Paste recipe parser improvement (2026-06-22)
`parseAndImportRecipe()` now evaluates confidence (name + ingredient count). Failed parse stays in modal with error. Partial parse shows warning. Success shows toast with what was detected.

### ✅ Filipino ingredients in LOCAL_NUTRITION_DB (2026-06-22)
Added 24 new entries: Gabi, Mung Beans, Monggo, Black Beans, Jasmine Rice, Ube, Sayote, Labanos, Calamansi, Siling Haba, Saging na Saba, Achuete, Bagoong Alamang, Tocino, Balut, Kesong Puti, plus Filipino-name aliases (Kamote, Talong, Gata, Patis, Toyo, Tahong).

### ✅ Password reset (2026-06-22)
"Forgot password?" link added to sign-in modal. `sendPasswordReset()` reads the email field, calls `sendPasswordResetEmail()`, and shows a success/error message.

### ✅ Auto-add low staples to grocery list (2026-06-22)
Already implemented: `syncStapleToGrocery()`, `checkAndReplenishLowStock()`, and `cycleStapleLevel()` all handle this. Called after cooking and on page load.

### ✅ Expiry-based recipe suggestions on the dashboard (2026-06-22)
Dashboard now shows a "Use before they expire" section when pantry items expire within 3 days and matching recipes exist. "Plan it" button adds the recipe to tonight's dinner slot via `planRecipeForToday()`.

### ✅ Grocery → Pantry auto-transfer (2026-06-22)
Checked grocery items are automatically transferred to pantry with undo support.

### ✅ Phase C — Pantry auto-deduction on cook (2026-06-22)
`markRecipeCooked()` now deducts used ingredients from `AppState.pantry`.
Depleted items are removed. `renderPantry()` called immediately after.
Merged via PR #1.

### ✅ Weekly nutrition totals in the Plan tab (2026-06-23)
`renderWeeklyNutritionTotals()` added, called at the end of `renderWeeklyPlanner()`. Sums calories/protein/carbs/fat across all planned recipes using `calculateRecipeNutrition()`. Shows "—" if any recipe has missing nutrition data. Renders into `#weekly-nutrition-totals` div added to `index.html` after the meal grid.

### ✅ Grocery list alphabetical sort (2026-06-23)
`renderGroceryList()` now sorts category keys alphabetically before rendering, with "Other" always last. Items missing a category fall back to "Other". Existing grouping and check/uncheck logic unchanged.

### ✅ Recipe serving scaler on recipe detail (2026-06-23)
`buildDetailIngList(recipe, servings)` helper renders ingredient `<li>` items at any serving count. `adjustDetailServings(event, recipeId, delta)` updates the count display and re-renders the ingredient list in real time. Serving stepper (− / count / +) added at the top of the collapsible detail section. `toggleRecipeDetails()` resets the count and ingredient list when the section is closed. `data-recipe-id` added to each recipe card.

### ✅ Pantry bulk-add mode (2026-06-23)
"Bulk add" button added to Pantry tab. Opens `#bulk-add-modal` with a textarea (one item per line, `Name, Qty, Unit` format). `confirmBulkAdd()` parses all lines, matches to `INGREDIENT_DB` for defaults, adds valid items to `AppState.pantry` in one pass, and lists malformed/duplicate lines as warnings without silently skipping them.

### ✅ Cook history log (2026-06-23)
`AppState.cookHistory` array added. `markRecipeCooked()` prepends `{ recipeId, recipeName, date, servings }` entries (newest-first, max 100). Persisted via `saveToLocalStorage()`, `buildFirestorePayload()`, `loadFromLocalStorage()`, and the Firestore real-time listener. Dashboard shows a "Cook History" card with the last 10 entries (hidden when empty).
