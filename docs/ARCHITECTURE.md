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

Nav order follows the meal-prep flow (D-076): Home · Plan · Shop · Prep · Fridge · Recipes · More.
At phone width (≤768px, D-079) the primary row shows only the five meal-prep tabs plus "More" —
Recipes is `display:none`-d there and reachable through a second, `data-tab`-less entry inside the
More menu (`.tab-more-recipes-link`) instead, so the row never needs its own horizontal scroll.
Desktop is unchanged.

| Tab | Section id | Entry render fn |
|---|---|---|
| Home / Dashboard | `#dashboard` | `renderDashboard()` → `renderMealPrepFlowCard()` first; the "what to cook/eat" cards sit in the collapsed `#dash-ideas` |
| Plan / Weekly Planner | `#planner` | `renderWeeklyPlanner()` (ends with `renderPlannedBatches()`); the "By day" scheduler is a collapsed `<details>`; `renderBatchPickerResults()` fills the "+ Add meals" picker modal |
| Shop / Grocery | `#grocery` | `renderGroceryList()` → `renderNoPlanGrocery()` for the open `#no-plan-grocery` card |
| Prep | `#prep` | `renderPrepTab()` |
| Fridge (was "Inventory") | `#fridge` | `renderPantry()`, `renderCookedMeals()`, `renderPreparedFlavors()` (mirrors the Flavor Library's prepared-stock cards — D-075) |
| Recipes (was "Cook") | `#recipes` | `renderRecipes()` |
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
- **Adding a top-level SCALAR field (not a collection) is a much shorter list — the
  `nutritionGoals` template.** No `TOMBSTONE_KEYS` entry (nothing to per-record delete), no
  `mergeCloudConflict()` edit (a scalar not named in its list-union loop simply survives via its
  `Object.assign({}, local)` base), and no sign-in-union edit (the freshly-loaded cloud copy wins,
  same as `nutritionGoals` already does). Only nine sites: `AppState` default,
  `saveToLocalStorage()`, `loadFromLocalStorage()`, `snapshotData()`, `restoreBackup()`,
  `exportData()`, `buildFirestorePayload()`, `loadFromFirestore()`, `setupRealtimeListeners()`. See
  D-075 (`AppState.inventoryVerifiedAt`).
- **Write guard — never write before read:** `saveToFirestore()` no-ops until `AppState.cloudReady`
  is true (set only after the cloud doc is read, or on sign-up). This stops a load-window save (the
  30s auto-save, the `online` event, a render) from overwriting good cloud data with an un-loaded
  default `AppState` — the deploy/reload data-loss bug (D-010).

`restoreBackup()` is the bounded exception to offline operation (D-084): `canRestoreBackup()`
requires an online, signed-in account with `cloudReady`, rechecked for the same uid immediately
before preparation/commit. The local snapshot has no account binding, so this avoids changing
sign-in scalar precedence. Restoration still uses `saveData()` and reports success only after its
cloud result; an unconfirmed save leaves the backup available for explicit retry. This does not
provide general concurrent/offline multi-device reconciliation.

## Photos
Recipe photos are compressed (max 1000px JPEG ~0.7) and stored in a Firestore **subcollection**
`users/{uid}/photos/{recipeId}` (one doc each) to stay under Firestore's 1 MiB doc limit (D-006).
Legacy inline photos are auto-migrated on load. In-memory `recipePhotoCache` attaches them at render.

## The "cook now" engine
`getCookableRecipes()` matches available pantry lots against the required lines in a recipe's
`baseIngredients`. A required line is covered when any of its alternatives matches, including
water as an alternative. Missing optional and serving lines appear in `optionalMissing`.
Water-only lines are skipped. Recipes need at least two required lines, at least one match,
and up to two missing required lines. Home and Recipes show Can cook now, Cook with a swap, and
Missing 1 or 2 ingredients. The eat picker names the pantry ingredient to use when a recipe needs
a swap. A same-head variety swap covers a required line separately from exact availability.
Swaps exclude condiments, spices, and identity-changing varieties. Canola and olive oil can swap
with each other. Home cards missing one ingredient expose `buyMissingIngredient()`.

`getCookableRecipes()`, `getExpirySuggestions()`, and `pantryMatchesForShop()` share
`ingredientNamesMatch()` and `pantryLotAvailable()` (D-086). Matching uses normalized names,
whole-word subsets with the same final word, or direct `INGREDIENT_DB` aliases. A subset match
rejects added identity modifiers such as evaporated in evaporated milk. Generic descriptors
such as white, steamed, and short-grain are ignored for names headed by rice. Empty lots are
unavailable. Non-empty staples count as available. For non-staples, a finite quantity of zero or
less or a valid printed use-by date (`dateMode: 'expiry'`) before today makes the lot unavailable.
Lots past an estimated shelf-life window or a printed best-before date still count as available.
`getExpirySuggestions()` limits its source lots to today through three days out. The cooking
write path uses its own `findPantryMatch()` rules under D-086.

## No-plan grocery

`noPlanGaps(state)` applies `NO_PLAN_TEMPLATE` and `noPlanRole()` to available pantry names
and unchecked grocery rows. It counts matching names once per role and excludes all existing
grocery rows and available lots from the options using D-086. Options that fill an unmet
rule come first, followed by `ingredientVersatility()` and convenience. Recipe versatility
counts recipe usage, distinct equipment, and quick uses. A named variety gets recipe credit
for its own use and direct aliases.

`renderNoPlanGrocery()` derives results for the open Shop List card independently of the plan.
Rendering is read-only. A chip calls `buyMissingIngredient()` for a single custom grocery row.

## Fridge stock health (D-087)

`renderStockHealth()` fills the open `#stock-health` panel from
`stockHealthReport(AppState, todayISO())`. `STOCK_CLASS_RULES` classifies raw lots with storage,
ingredient names, direct database aliases, and categories. Cooked batches come from
`AppState.cookedMeals`. `STOCK_REVIEW_POLICY` sets the record-age checks at 7 days for perishables,
90 for frozen stock, 180 for pantry staples, 365 for condiments, and 4 fridge / 90 freezer for
cooked meals. Record age uses `updatedAt` with purchase or cook date as the fallback.

Printed dates, age-based safety estimates, and record staleness are independent. Freezer quality
guidance uses the ingredient's existing freezer estimate or the cooked batch policy. The
consistency check reuses `pantryLotAvailable()` for empty staples, `ingredientNamesMatch()` for
matching lots, and `portionCountOrNull()` for depleted cooked batches. The renderer and clipboard
action read from the report without persisting inventory data.

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
tab, above the flavor list itself, using `preparedFlavorCardHtml()` — and, since D-075, ALSO calls
`renderFridgePreparedFlavors()`, a second render into a "Prepared Flavors" block on the My Fridge tab
(`#fridge-prepared-flavors-list`) that draws from the exact same `AppState.preparedFlavors` array via
the exact same `preparedFlavorCardHtml()` — no new state, no second Used-1 handler. Only the sort
differs: the Flavor Library orders by flavor name; the Fridge mirror orders fridge-before-freezer,
then earlier truthful `expiresAt` first (nulls last), then flavor name.

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

## Last full inventory check — `AppState.inventoryVerifiedAt` (D-075)

A manual confidence stamp, not an audit and not household collaboration: `verifyInventoryChecked()`
sets `AppState.inventoryVerifiedAt = new Date().toISOString()` and re-renders the status line shown
in the My Fridge tab (`renderInventoryVerifiedStatus()` — "Inventory checked N days ago" or
"Inventory not yet verified"). It does not read or write any pantry, cooked-meal, or prepared-flavor
record, schedule anything, or score confidence. Persists via the `nutritionGoals`-style nine-site
scalar-field template (see the Save/load/sync pipeline section above) — deliberately NOT a new
`TOMBSTONE_KEYS` entry, since there is nothing here to per-record delete.

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
5. A purchase lands in `AppState.pantry` (raw ingredients) ONLY. It never creates a `cookedMeals`
   record — that happens only through prep (see "Meal-prep flow" below). D-076.
6. **Correcting a stale "In stock"** — `pantryMatchesForShop()` names the kitchen records behind a
   row's claim using D-086 availability and ingredient matching rules. The
   row's **Not anymore?** button opens `openNotInKitchenDialog()`, which lists each matched record;
   `correctKitchenStock()` acts on the ONE record tapped: a staple is set `stockLevel: 'empty'`,
   anything else is removed with an explicit `writeTombstone('pantry', …)`. Any grocery row whose
   `stocked` receipt pointed at that record is reset to unbought. Tapping the row itself keeps its
   D-069 meaning ("bought more"). D-076.

## Meal-prep flow: Plan -> Shop -> Prep -> Fridge (D-076)
- **Plan** — `AppState.plannedBatches` holds "N servings of recipe X this week" with no day.
  `addPlannedBatch()`, `changePlannedBatchServings()`, `removePlannedBatch()` all end in
  `afterPlannedBatchesChange()` (save, regenerate Shop, re-render). Low-effort discovery is
  `getBatchSearchResults()`, ordered by the existing `recipeEffortScore()` /
  `recipeActiveMinutes()` signals. Day slots in `weeklyPlan` remain, optional.
- **Shop** — `generateGroceryList()` adds each batch through `addRecipeIngredients(…, servings)`,
  scaled by `batchScaledQuantity()` (same null-means-unresolved contract as
  `calculateScaledQuantity()`). A rebuild carries `checked` / `userSet` / `stocked` over from
  the previous row with the same exact category + name, so a batch +/- never un-buys anything.
- **Prep** — `completePlannedBatch()` → `completePlannedBatchNow()` calls the existing
  `_doMarkCooked()` (which creates the `cookedMeals` record with `initialPortions` =
  servings and deducts raw ingredients), then drops the batch from the plan. This is the only
  way a planned batch reaches the Fridge. `getPlannedRecipeUsage()` includes batches, so the
  existing Prep Mode checklist covers them.
- **AI Prep Brief** — three pure steps, no model call: `getPrepSessionEntries()` (batches, then
  day-plan meals Monday → Sunday, one entry per recipe) → `buildPrepBriefModel()` (normalized
  facts; a missing value is `null`, never 0) → `formatPrepBrief()` (deterministic text).
  `copyPrepBrief()` copies it via `copyTextToClipboard()` and mirrors it into `#prep-brief-text`.
  Times use `statedMinutes()`, NOT `recipePrepMinutes()` (which returns 0 for "missing").

## Attention loop
`collectAttentionItems()` scans pantry lots via `pantryDateSignal()` and cooked batches via
`cookedDateSignal()`. It returns `{ expired, check, useSoon, low }` for Home. Expired covers a
passed printed use-by date or a cooked batch past its fridge window. Check covers a passed
perishable estimate, a passed printed best-before date, or a cooked batch past its freezer
quality window. Aged frozen pantry lots, pantry staples and condiments keep their estimate
context in Fridge and Stock Health. Record staleness belongs to Stock Health (D-087).

`#dash-attention` is compact by default, unconditionally (D-079) — an expired item no longer forces
it open. It opens only through an explicit action: the card's own `.dash-attn-review-btn` ("Review",
force-opens rather than toggling), or `openAttentionView()`, which is also the notification/deep-link
entry point and the target of the global banner's own View action via `viewFreshnessDetails()`.
`viewFreshnessDetails()` is deliberately separate from `goToFreshnessTab()` — the latter is what the
Ready-to-eat and What-should-we-eat cards' row buttons still use to jump straight to the Fridge tab
for a specific item, an unrelated call site `viewFreshnessDetails()` must not disturb.

Keep and Still good call `keepAttentionItem()` to record `keptOn = todayISO()`. Home and the
freshness alerts suppress the flagged record for that day. Cook Now displays a check note
when every available lot matching a recipe line needs checking. Choosing Still good lets that
lot satisfy the line without the check note for the rest of the day.

Remove and Toss call `removeAttentionItem()` for one named record. `removeAllExpired()` and
`clearExpiredPantryItems()` list every eligible record and date before asking for confirmation.
Confirmation revalidates the named records and takes a local backup before deletion. These
actions write explicit tombstones to each record's collection (D-071), remove the confirmed
records, then call `snapshotIdBaseline()` and `saveData()`. The explicit tombstones preserve
legitimate bulk removals across the aggregate `MASS_DELETE_GUARD`.

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

## Conversational Control Bridge (`workers/conversational-bridge/`, TASK-065, D-082)
A second, independently-scoped Cloudflare Worker (the app's static-hosting/recipe-import platform
already established) that lets an authenticated external caller — a bearer token, never a Firebase
user session — read and write the same canonical `pantry`/`cookedMeals` Firestore fields the app
itself uses, via a fixed set of domain operations (never raw Firestore CRUD, never a caller-chosen
document path or uid). It reimplements the concurrency guard (`version` + `currentDocument.
updateTime`) and the invariants `correctKitchenStock()` / `_doMarkCooked()` / `useCookedPortion()`
/ `finishCookedMeal()` enforce client-side, against a Firestore REST client instead of `AppState`.
Local build/test only as of this entry — see `workers/conversational-bridge/README.md`'s
"Production enablement checklist" for what must happen before it is reachable by anything real.

The browser app and conversational Worker consume the same ready-food source/freshness contract at
shared/readyFoodContract.js: index.html loads it as a classic script and the Worker imports it for
record_ready_food. This keeps the app's existing leftovers/takeout values and freshness defaults
canonical without adding a build step.

### Shared food-safety rules (`shared/foodSafety.js`, TASK-091, D-090)
The pure "safe to eat" rules live in one classic script exposed as the frozen
`globalThis.MealPrepFoodSafety`: the data `INGREDIENT_DB`, `STOCK_CLASS_RULES`,
`FRIDGE_SAFETY_LIMITS`, `COOKED_FRIDGE_LIMIT`, `FRIDGE_SAFETY_EXCLUSIONS`, `FRESHNESS_WARN_DAYS`
and the functions `categoryShelfLife`, `stockIngredientEntry`, `stockFoodClass`, `stockCalendarDay`,
`daysLeftFrom`, `pantryDaysLeft`, `pantryFridgeSafety`, `pantryDateSignal`, `pantryLotAvailable`,
`isStaple`, `cookedShelfLife`, `cookedDateSignal`. `index.html` loads it before `app.js` (and `sw.js`
`STATIC` caches it); the Worker imports it by side effect from `src/operations/inventory.js`.
No shared function reads the clock: each takes `today` (`YYYY-MM-DD`, household calendar day) and
throws on a missing or malformed one. Storage comes from the lot, else an optional
`inferStorage(name, category)` hook. `app.js` keeps every old global name as a one-line wrapper
that passes `todayISO()` and the app's own `inferStorage()` (INGREDIENT_DB → PANTRY_KNOWLEDGE →
category), which always answers, so app verdicts are unchanged. Without a hook (the Worker) the
default is INGREDIENT_DB's explicit storage, else none, and no storage makes
`pantryDateSignal()` return `kind: 'unknown'`, `safety: 'unknown-storage'` (never usable).
`tests/fixtures/food-safety-parity.json` holds the pre-move verdicts; the browser spec
(`tests/food-safety-parity.spec.js`) and the Worker test (`test/food-safety-parity.node.js`) must
both reproduce them. The ready-food suggestion filter in `getReadyFoodSuggestions()` stays in
`app.js` (an inline predicate over `AppState`); its freshness part is the shared
`daysLeftFrom()` + `cookedShelfLife()`.

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
