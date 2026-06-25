# Architecture

> How the system is built — the map from a task to the right part of the code.
> Read for feature work, refactors, and anything touching data flow or sync.
> References are **function/object/ID names** (stable), never line numbers.

## Shape
Three files, no build step, no framework:
- `index.html` — every tab and modal inline; loads Firebase SDK + `chart.min.js` + `app.js`.
- `app.js` — all logic (~8,800 lines, single file). Functions are global; UI handlers are exposed via `window.*`.
- `style.css` — all styles. CSS variables in `:root`; dark mode via `[data-color-scheme="dark"]`.

State lives in one global `AppState` object (see [DATA_MODEL.md](DATA_MODEL.md)). The UI is
re-rendered imperatively by `render*()` functions that read `AppState` and write `innerHTML`.

## Tabs and their render entry points
Each tab is a `<section class="tab-content">`; `showTab(name)` toggles visibility.

| Tab | Section id | Entry render fn |
|---|---|---|
| Home / Dashboard | `#dashboard` | `renderDashboard()` |
| Cook / My Recipes | `#recipes` | `renderRecipes()` |
| Inventory / My Fridge | `#fridge` | `renderPantry()`, `renderCookedMeals()` |
| Shop / Grocery | `#grocery` | `renderGroceryList()` |
| Plan / Weekly Planner | `#planner` | `renderWeeklyPlanner()` |
| Nutrition | `#nutrition` | `renderNutritionTab()` → `renderWeeklyNutritionTotals()`, `renderWeeklyNutritionChart()`, `renderDailyNutritionBreakdown()`, `filterRecipesByNutrition()` |
| Price Book | `#ingredients` | `renderIngredientsTab()` |
| Cooking Hacks | `#hacks` | `renderCookingHacks()` |
| Storage Guide | `#storage` | `renderStorageGuide()` — **dead UI, no nav button** |

## Save / load / sync pipeline
- **Write:** `saveData()` → `saveToLocalStorage()` **always** + `saveToFirestore()` when signed-in & online.
  This dual-write is the offline-first core — see [DECISIONS.md](DECISIONS.md) D-003.
- **Firestore write** uses `runTransaction` with an optimistic-concurrency `version` field; on
  conflict it **union-merges by ID** so no device loses data (D-004).
- **Read on load:** `loadFromLocalStorage()` first; `loadUserData()` pulls Firestore when signed in.
  Real-time `onSnapshot` listener applies remote changes live across devices/tabs.
- **Always after loading recipes:** call `patchMissingNutrition(AppState.recipes)` — old saved
  recipes are plain JSON missing fields added later (D-005).

## Photos
Recipe photos are compressed (max 1000px JPEG ~0.7) and stored in a Firestore **subcollection**
`users/{uid}/photos/{recipeId}` (one doc each) to stay under Firestore's 1 MiB doc limit (D-006).
Legacy inline photos are auto-migrated on load. In-memory `recipePhotoCache` attaches them at render.

## The "cook now" engine
Dashboard and Cook tab match `AppState.pantry` against each recipe's `baseIngredients` in 3 tiers
(can cook / missing 1 / missing 2). Missing-1 cards expose `buyMissingIngredient()`.

## Cook → inventory loop
`markRecipeCooked()`:
1. adds a cooked batch to the Inventory cooked-meals list (with shelf life),
2. calls `deductIngredientsForRecipe()` to subtract used ingredients from `AppState.pantry`
   (staples are never deducted; depleted items are removed),
3. prepends an entry to `AppState.cookHistory` (max 100, surfaced on the Dashboard).

## Nutrition lookup
`calculateRecipeNutrition(recipe)` uses `nutritionPerServing` if present, else ingredient lookup.
`searchNutritionDB()` checks `LOCAL_NUTRITION_DB` first (instant/offline), falls back to the USDA
FoodData Central API with `DEMO_KEY` (D-007).

## Autocomplete
`attachIngredientAutocomplete(inputEl)` wires any text input (recipe form AND pantry input) to
`INGREDIENT_DB`, showing name, unit, category, price, and store.

## Safety / cross-cutting
- All user strings pass `escapeHtml()` before `innerHTML`; shared content passes `stripTagsDeep()`.
- Global error handler: `window.addEventListener('error', …)` shows a dismissable banner.
- Firebase App Check (reCAPTCHA v3) protects Firestore/Auth.

## Data-flow diagram
```mermaid
flowchart LR
  UI[render*() functions] -->|mutate| State[AppState]
  State -->|saveData| LS[(localStorage)]
  State -->|saveData if online| FS[(Firestore users/uid)]
  FS -->|onSnapshot| State
  FS --- Photos[(photos subcollection)]
  State -->|read| UI
```
