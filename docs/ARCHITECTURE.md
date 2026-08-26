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
| Flavor Library | `#flavors` | `renderFlavors()` |
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
- **Always after loading flavors:** call `normalizeFlavors()`. It fills absent fields, drops unknown
  slugs, and enforces the mandatory `flv-` id prefix. It must never set `updatedAt` — see D-070.
- **Adding a synced collection touches 17 sites.** `AppState` default, `saveToLocalStorage()`,
  `loadFromLocalStorage()`, `snapshotData()`, `restoreBackup()`, `exportData()`, `importData()` (x4),
  `TOMBSTONE_KEYS`, `buildFirestorePayload()`, `mergeCloudConflict()`, `loadFromFirestore()`,
  `loadUserData()` (x2), `setupRealtimeListeners()`. `clearLocalStorage()` and `collectSyncedIds()`
  need no edit — both iterate `TOMBSTONE_KEYS`. A partial implementation loses data: skip the
  sign-in union and local records are shadowed by the cloud copy; skip `TOMBSTONE_KEYS` and a
  deletion is resurrected by the next union. See D-070 for the worked example.
- **Write guard — never write before read:** `saveToFirestore()` no-ops until `AppState.cloudReady`
  is true (set only after the cloud doc is read, or on sign-up). This stops a load-window save (the
  30s auto-save, the `online` event, a render) from overwriting good cloud data with an un-loaded
  default `AppState` — the deploy/reload data-loss bug (D-010).

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

## Shop -> inventory loop
`toggleGroceryItem()` is the only inbound path from shopping, and it is one tap (D-057):
1. `stockPurchasedGroceryItem()` either MERGES into an existing pantry record or creates a new one.
   `findMergeableStock()` (exact name, never fuzzy) picks the first record that clears
   `canMergePurchaseInto()`, which refuses printed-expiry records, already-expired ones, and any
   purchase whose own expiry, unit or explicit storage would make the merge a lie. The fold itself
   is `applyPurchaseToStock()`, which edits IN PLACE and never rewrites `purchaseDate`, so the
   oldest portion still governs freshness. Same helpers back Bulk Add's duplicate policy — one
   merge boundary, not two. See DECISIONS D-069.
2. A staple purchase sets `stockLevel: 'full'` and lets `syncStapleToGrocery()` drop its auto row.
3. The transfer returns a receipt stored as `groceryItem.stocked`, so unchecking calls
   `unstockPurchasedGroceryItem()` and reverses exactly that change.
4. `checkAndReplenishLowStock()` + `saveData()` close the loop; `groceryItemChecked()` decides how
   the row renders (a user tap outranks the "already at home" auto-tick).

## Attention loop
`collectAttentionItems()` is the single classifier behind Home's "What needs attention?" card. It
scans `AppState.pantry` (via `pantryDaysLeft()`) and `AppState.cookedMeals` (via `cookedShelfLife()`)
in one pass and returns `{ expired, useSoon, low }`. The two record types keep separate shapes — this
unifies the attention experience, not the data model.

Actions: `keepAttentionItem()` writes `keptOn = todayISO()` (suppresses the record from attention
surfaces for the day; alters no dates), `removeAttentionItem()` removes one, `removeAllExpired()`
removes the whole `expired` bucket. Both removal paths write EXPLICIT tombstones into
`AppState.deletions` and call `snapshotIdBaseline()` before dropping records, because
`recordLocalDeletions()` deliberately ignores more than `MASS_DELETE_GUARD` simultaneous
disappearances. `getExpiredPantryItems()` and `getFreshnessAlerts()` honour `keptOn` too.

## Nutrition lookup
`calculateRecipeNutrition(recipe)` uses `nutritionPerServing` if present, else ingredient lookup.
`searchNutritionDB()` checks `LOCAL_NUTRITION_DB` first (instant/offline), falls back to the USDA
FoodData Central API with `DEMO_KEY` (D-007).

## Autocomplete
`attachIngredientAutocomplete(inputEl)` wires any text input (recipe form AND pantry input) to
`INGREDIENT_DB`, showing name, unit, category, price, and store.

## Safety / cross-cutting
- All user strings pass `escapeHtml()` before `innerHTML`.
- Global error handler: `window.addEventListener('error', …)` shows a dismissable banner.
- Firebase App Check (reCAPTCHA v3) protects Firestore/Auth.

## Data-flow diagram
```mermaid
flowchart LR
  Shop[toggleGroceryItem] -->|stockPurchasedGroceryItem| State
  UI[render*() functions] -->|mutate| State[AppState]
  State -->|saveData| LS[(localStorage)]
  State -->|saveData if online| FS[(Firestore users/uid)]
  FS -->|onSnapshot| State
  FS --- Photos[(photos subcollection)]
  State -->|read| UI
```
