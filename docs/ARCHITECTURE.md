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
- **Always after loading prepared flavors:** call `normalizePreparedFlavors()`. Same discipline as
  `normalizeFlavors()` — fills absent fields, repairs an incoherent portions pair, never sets
  `updatedAt`. See D-074.
- **Adding a synced collection touches 17 sites.** `AppState` default, `saveToLocalStorage()`,
  `loadFromLocalStorage()`, `snapshotData()`, `restoreBackup()`, `exportData()`, `importData()` (x4),
  `TOMBSTONE_KEYS`, `buildFirestorePayload()`, `mergeCloudConflict()`, `loadFromFirestore()`,
  `loadUserData()` (x2), `setupRealtimeListeners()`. `clearLocalStorage()` and `collectSyncedIds()`
  need no edit — both iterate `TOMBSTONE_KEYS`. A partial implementation loses data: skip the
  sign-in union and local records are shadowed by the cloud copy; skip `TOMBSTONE_KEYS` and a
  deletion is resurrected by the next union. See D-070 for the worked example; D-074 (Flavor Bomb v1,
  `AppState.preparedFlavors`) re-verified this exact list against current code rather than assuming
  it from the prior wave.
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

## Protein identity for cooked food (D-072)

Answers "what protein is this batch?" so Meal Lego can match cooked food to a flavor.
`flavorsForProteinType()` is the original D-072 groundwork join (exact `worksWith` only, unrendered).
Meal Lego v1 (D-073) consumes `getCookedMealProteinType()` through
`getCompatibleFlavorsForCookedMeal(meal)` — one derived, non-persisting helper that adds the one-way
fish supertype, the `mixed`/`none`/`unknown` non-answers, and deterministic ranking, and feeds the
Fridge "Try with" chip row plus one flavor line on Home's "Eat this first" pick.

**A cooked meal's name is never read.** Identity comes from an explicit user pin or from the source
recipe's structured ingredients, and from nowhere else — `unknown` is a first-class answer rather
than a failure to guess.

Entry points, in precedence order:
- `getCookedMealProteinType(meal)` — the answer. Explicit `meal.proteinType` → recipe-derived →
  `'unknown'`. **Consumed by Meal Lego v1 via `getCompatibleFlavorsForCookedMeal()` (D-073).**
- `derivedCookedProteinType(meal)` → `recipeProteinType(recipe)` — step 2 alone. Reads the recipe's
  `baseIngredients` by **exact case-insensitive name** against `PROTEIN_FAMILY_BY_INGREDIENT`
  (curated, never substring-matched — same discipline as `ingredientShelfLife()` over
  `INGREDIENT_DB`), yielding a family, `none`, `mixed`, or `unknown`.
- Derived identity is **read live, never copied onto the batch** — the same rule
  `readyFoodBalanceHint()` follows for `recipe.mealBalance`. A recipe edit therefore moves its
  batches; pinning is how a user opts out.

Correction happens in place on the Fridge card (`renderCookedMeals()` → `cookedProteinOptionsHtml()`
+ `cookedProteinAutoLabel()`), writing through `setCookedProteinType()` → `saveData()`. The blank
**Auto** option deletes `proteinType` rather than storing `'unknown'`. The add form's selector is
filled from code by `populateManualCookedProteinSelect()` so the vocabulary is written down once.

The cooked vocabulary is a strict subset of the Flavor Library's: `COOKED_PROTEIN_IDS ⊂
FLAVOR_PROTEINS`, with labels taken from `FLAVOR_PROTEIN_BY_ID`. No new synced collection, no
`TOMBSTONE_KEYS` change — `proteinType` is one optional field on an existing `cookedMeals` record.
See [DATA_MODEL.md](DATA_MODEL.md) for the shape, the full precedence table and the `none` / `mixed`
/ `unknown` semantics.

## Prepared Flavors — physical prepared-flavor stock (Flavor Bomb v1, D-074)

Answers "which Flavor Library flavors have I ACTUALLY made and still have on hand?" — a truth Meal
Lego v1 (D-073) deliberately does not model: `getCompatibleFlavorsForCookedMeal()` only knows what
*works with* a cooked protein, never what is *ready to use right now*. `AppState.preparedFlavors[]`
is a new, separate top-level collection recording physical stock, kept apart from both the Flavor
Library (knowledge — `AppState.flavors`) and `cookedMeals` (ready protein) on purpose; see DECISIONS
D-074 for why both alternatives (a field on `flavor`, an entry in `cookedMeals`) were rejected.

Entry points: `openPrepareFlavorDialog(flavorId)` (the Flavor Library card's "I made this" /
"Replace batch" action) → `savePreparedFlavor()`, which looks up any existing active record for that
`flavorId` via `findPreparedFlavorByFlavorId()` and REPLACES it in place — one active batch per
flavor in v1, no lot/FIFO tracking. `useOnePreparedFlavor(id)` is the one-tap decrement, mirroring
`useCookedPortion()` (D-056) exactly; the last portion routes into `removePreparedFlavor()`, which —
unlike `removeCookedMeal()` — writes an EXPLICIT tombstone before dropping the record, rather than
relying solely on the `recordLocalDeletions()` vanish-diff (an owner-directed requirement for this
collection specifically). `renderPreparedFlavors()` draws a compact card list on the Flavor Library
tab, above the flavor list itself.

Persistence follows the exact 17-site registry above, with `preparedFlavors` added to
`TOMBSTONE_KEYS`. A `flavorId` whose Flavor Library entry was later deleted is NOT cascade-deleted —
`deleteFlavor()` does not touch `preparedFlavors` — and renders as "Unknown flavor (deleted)" instead,
the same graceful-degradation precedent D-072 sets for a deleted recipe.

**Not yet built, deliberately:** Meal Lego does not rank prepared stock ahead of knowledge-only
flavors — `getCompatibleFlavorsForCookedMeal()` is untouched by this wave (verified both by
inspection and by test). That integration is the explicitly deferred next wave. Also deferred:
multi-batch/FIFO tracking, a dedicated Used-1 history log, and a fix for the inherited
whole-object-LWW concurrent-decrement risk (see DECISIONS D-074) — all accepted v1 limitations, not
oversights.

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
`AppState.deletions` — into the record's OWN collection bucket via `writeTombstone(collection, id)`,
`'cookedMeals'` or `'pantry'` depending on the record (D-071) — and call `snapshotIdBaseline()`
before dropping records, because `recordLocalDeletions()` deliberately ignores more than
`MASS_DELETE_GUARD` simultaneous disappearances **in aggregate across all collections**. Writing
explicitly is what keeps a legitimate bulk removal from being swallowed by that guard.
`getExpiredPantryItems()` and `getFreshnessAlerts()` honour `keptOn` too.

### Deletion identity and the mass-delete guard (D-071)

`AppState.deletions` is collection-keyed: `{ recipes: {...}, pantry: {...}, ... }`, one bucket per
`TOMBSTONE_KEYS` entry. A tombstone can only remove a record from the collection that wrote it —
see `docs/DATA_MODEL.md` for the shape, helpers and legacy-migration rule.

Deletions reach the map two ways. **Explicit writers** call `writeTombstone()` directly and are
never subject to the guard: `clearLocalStorage()`, `deleteSelectedPantryItems()`,
`clearExpiredPantryItems()`, `unstockPurchasedGroceryItem()`, `deductIngredientsForRecipe()`,
`removeAttentionItem()`, `removeAllExpired()`. **Every other delete rides the vanish-diff** in
`recordLocalDeletions()`, which diffs `collectSyncedIds()` against `_idBaseline` — both keyed by
collection — and tombstones what disappeared into its own namespace.

`recordLocalDeletions()` computes vanished ids per collection, then sums them into `totalVanished`
and compares that **single aggregate** against `MASS_DELETE_GUARD` (5). If it trips, it warns and
returns having written nothing, leaving `_idBaseline` unchanged so state re-aligns once a transient
empty resolves. The guard must stay aggregate: evaluating it per collection lets a small collection
fall through while the large ones correctly suppress a startup/sync race, which writes phantom
tombstones that propagate a real delete to every device. That regression was caught in review of
`1f443ac` and repaired in `f73ce3c`; `tests/tombstone-namespace.spec.js` pins it with a mutation
test that bypasses the aggregate check and asserts the phantoms reappear.

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
