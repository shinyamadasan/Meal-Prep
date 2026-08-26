# Data Model

> Exact shapes of all state and storage. The `AppState` object IS the spine of this app.
> Read for any task touching state, storage, sync, or the seeded databases.
> If this file is wrong, you get silent data bugs — keep it accurate.

## AppState (global runtime state)
```js
AppState.recipes            // [] recipe objects (includes sampleRecipes on first load)
AppState.weeklyPlan         // { Monday: { breakfast, lunch, dinner, snacks[] }, ... Sunday }
AppState.groceryList        // [] aggregated + custom grocery items
AppState.pantry             // [] pantry items (see shape below)
AppState.cookedMeals        // [] cooked batches with storage location + date (see "Cooked meal" below)
AppState.cookHistory        // [{ recipeId, recipeName, date, servings }] newest-first, max 100
AppState.nutritionGoals     // { calories, protein, carbs, fat, fiber, sodium }
AppState.customIngredients  // [] storage-guide items (feeds dead #storage tab)
AppState.customHacks        // [] user cooking hacks
AppState.flavors            // [] reusable finishing knowledge (see "Flavor object" below, D-070)
AppState.userIngredients    // [] user-created INGREDIENT_DB-style entries
AppState.ingredientPrices   // {} per-store price overrides
AppState.myStores           // [] stores the user shops at (filter)
AppState.customStores        // [] user-added stores
AppState.recentRecipes      // [] recently used recipe ids
AppState.currentUser        // Firebase user object or null
AppState.isOnline           // navigator.onLine (transient)
AppState.cloudReady         // transient: true once this account's cloud doc has been READ.
                            // Gates Firestore writes (saveToFirestore) so we never overwrite
                            // good cloud data with a not-yet-loaded local state. Not persisted.
AppState.dataVersion        // cloud-doc version last loaded (optimistic concurrency)
AppState.prepModeSession    // null, or { active, recipeUsage, checked } for an in-progress
                            // Prep Mode checklist. Persisted through saveData() (localStorage +
                            // Firestore) so a browser close/reopen restores it; cleared on
                            // closePrepMode(). openPrepMode() filters out any recipe id no longer
                            // in AppState.recipes, so a deleted recipe degrades gracefully instead
                            // of crashing the restore.
```

## Recipe object
```js
{
  id,                  // number for samples (1–26); string (Firestore id) for user-added.
                       // ALWAYS quote in onclick handlers — see CLAUDE.md rules.
  name,
  category,            // "Breakfast" | "Main Dish" | "Snack" | "Dessert" | ...
  baseServings,        // original serving count
  currentServings,     // scaled serving count
  basePrepTime,        // minutes
  baseCookTime,        // minutes
  baseIngredients: [{ name, baseQuantity, unit, category, pricePerUnit? }],
  nutritionPerServing: { calories, protein, carbs, fat, fiber, sodium },
  fridgeLife,          // days
  freezerLife,         // days
  storageNotes,
  instructions,
  favorite,            // boolean (♥ toggle)
  highlights,          // string[] tag chips — rendered but NO edit-form UI to set

  // ── Low-effort cooking metadata — ALL OPTIONAL, all additive ──
  // Every field below is filled in by normalizeRecipes() -> normalizeRecipeMeta()
  // on load. A recipe saved before these existed gets empty defaults and renders
  // exactly as it did; a valid value is never overwritten, an unknown one is dropped.
  equipment,           // string[] of slugs from RECIPE_EQUIPMENT:
                       //   'rice-cooker' | 'rice-cooker-steamer' | 'instant-pot' |
                       //   'pressure-cooker' | 'oven' | 'pan' | 'egg-boiler' |
                       //   'microwave' | 'no-cook'. Multiple values allowed.
  effort,              // 'assembly' | 'very-low' | 'low' | 'normal', or null
  activeTime,          // minutes you actually have to DO something, or null.
                       // null means NOT STATED — never 0. Different from cook time.
  mealBalance,         // { protein: bool, vegetables: bool, carb: bool }
                       // Informational only: renders "Protein ✓ · Veg ✓ · Carb ✓".
                       // No grams, no goals, no warnings.
  tags,                // string[] of slugs from RECIPE_TAGS: 'batch-friendly' |
                       //   'minimal-cleanup' | 'cook-fresh' | 'freezer-friendly' | 'shortcut'
}
```

Read the time and effort fields through the helpers, never directly — `baseCookTime ||
cookTime` turns a legitimate `0` into `undefined` and then `NaN`:

| Helper | Returns |
|---|---|
| `recipePrepMinutes(recipe)` / `recipeCookMinutes(recipe)` | minutes; a real `0` stays `0` |
| `recipeTotalMinutes(recipe)` | prep + cook |
| `recipeActiveMinutes(recipe)` | `activeTime` if stated, else total time (conservative) |
| `recipeEffortScore(recipe)` | 0–3, lower = easier; inferred from active time when `effort` is unset |
| `recipeHasEquipment(recipe, ids)` / `recipeHasTag(recipe, tag)` | membership tests |
| `daysSinceCooked(id)` / `varietyPenalty(id)` | from `AppState.cookHistory`; penalty only re-orders suggestions |

See DECISIONS D-055.
Meal-planner slots store **recipe ids** (not objects): `breakfast/lunch/dinner` hold one id or
`null`; `snacks` is an array of ids.

## Cooked meal object
```js
{
  id,                  // 'cm_<timestamp>_<rand>'
  recipeId,            // string id of the source recipe, or null for manually added food
  source?,             // 'leftovers' | 'takeout' — manual adds only
  name,
  cookedDate,          // 'YYYY-MM-DD' (LOCAL calendar date — daysLeftFrom() parses it as local midnight)
  storage,             // 'fridge' | 'freezer' — drives which shelf life applies
  fridgeLife,          // days, or null = unknown
  freezerLife,         // days, or null = unknown
  updatedAt?,          // ISO string — set by stampUpdated() on manual adds and edits.
                       // NOTE: _doMarkCooked() does NOT set it (pre-existing gap, see D-056).

  // ── Ready-food portions — OPTIONAL and additive (D-056) ──
  initialPortions,     // whole meal portions the batch started with, or null
  portionsRemaining    // whole meal portions left, or null
                       // BOTH null = an untracked batch, which behaves exactly as it
                       // did before portions existed. Never grams, never per-person.
}
```

`normalizeCookedMeals()` runs at all six points `cookedMeals` is assigned from stored data
(localStorage load, backup restore, Firestore load, the live cloud listener, the import union,
the sign-in merge). It is idempotent and only repairs an incoherent pair — it never invents
portions for a batch that has none. Read portions through the helpers:

| Helper | Returns |
|---|---|
| `cookedMealTracksPortions(meal)` | whether this batch counts portions at all |
| `useCookedPortion(id)` | one-tap decrement; the last portion routes into `removeCookedMeal()` |
| `finishCookedMeal(id)` | finish now, via the same existing removal/tombstone path |
| `getReadyFoodSuggestions(limit)` | ranked ready food — expiring fridge, then fridge, then freezer. Excludes EXPIRED batches. |
| `readyFoodBucket(meal)` | 0 = fridge expiring soon, 1 = fridge, 2 = freezer |
| `readyFoodMetaLine(meal)` | "2 portions · fridge · use soon · 1d left" |
| `readyFoodBalanceHint(meal)` | "add veg + rice" from the source recipe's `mealBalance` (D-055), or '' |

## Flavor object (D-070)
Reusable finishing knowledge: how to make a protein you already cooked taste like a different meal.
Deliberately NOT a recipe (no servings, no nutrition, no cook time; never planned or shopped for)
and NOT a cooking hack (a hack is five prose fields).

```js
{
  id,                 // STRING, always prefixed 'flv-'. Never a bare number - see below.
  name,               // 'Soy-Calamansi'
  ingredients: [      // same row shape as recipe.baseIngredients, so INGREDIENT_DB lookups work
    { name, baseQuantity, unit, category }
  ],
  instructions,       // prose string, like recipe.instructions - not an array of steps
  activeTime,         // minutes, or null = 'not stated' (never 0 as a stand-in - D-055's rule)
  preparationStyle,   // 'make-fresh' | 'fridge-batch' | 'freezer-friendly', or null.
                      // A LABEL, not a state: 'freezer-friendly' means it freezes well,
                      // never that any is currently frozen.
  worksWith: [],      // slugs from FLAVOR_PROTEINS (chicken, pork, beef, fish, salmon, tuna,
                      // shrimp, egg, tofu, vegetables, rice)
  tags: [],           // slugs from FLAVOR_TAGS (= RECIPE_TAGS + spicy, sweet-savory, creamy,
                      // tangy, garlicky)
  updatedAt           // set ONLY by stampUpdated() on a real user edit - see below
}
```

**The `flv-` id prefix is part of the wire shape.** `normalizeFlavorId()` re-prefixes any inbound
id that lacks it, idempotently. It originally existed because `AppState.deletions` was a single FLAT
`id -> deletedAt` map shared by every key in `TOMBSTONE_KEYS`, so a bare numeric flavor id could be
matched by a tombstone written for a recipe, hack or pantry item sharing the number. **D-071 fixed
that for every collection** (see `deletions` below), so the prefix is now id hygiene and old-data
migration rather than the only thing protecting flavors.

## `AppState.deletions` — collection-keyed tombstones (D-071)

Deletions sync as tombstones so a union merge cannot resurrect a deleted record. Since D-071 the map
is **namespaced by collection**, one bucket per key in `TOMBSTONE_KEYS`:

```js
AppState.deletions = {
  recipes:           { "5": "2026-06-01T00:00:00.000Z" },
  pantry:            { "buy_17...": "..." },
  customIngredients: { ... },
  customHacks:       { ... },
  flavors:           { "flv-x": "..." },
  cookedMeals:       { "cm_...": "..." },
  userIngredients:   { "ui_...": "..." }
}
```

The invariant: **a tombstone may affect records only inside the collection that created it.** Before
D-071 the map was flat (`{ [rawId]: deletedAtISO }`) and consulted against every collection, so
deleting recipe `5` also destroyed hack `5`, pantry item `5`, custom ingredient `5`, cooked meal `5`
and user ingredient `5` — seeded recipe ids `1-40` and default-hack ids `1-14` overlap completely.

Access goes through helpers, never a raw index: `normalizeDeletions()` (accepts a missing key, a
legacy flat map, or an already-namespaced map; idempotent), `ensureDeletions()`, `deletionBucket()`,
`writeTombstone(collection, id, when)`, `readTombstone()`, `clearTombstone()`, `tombstoneCount()`.
Every persistence path normalizes on the way in and out — `saveToLocalStorage()`,
`loadFromLocalStorage()`, `buildFirestorePayload()`, `loadFromFirestore()`, the `saveToFirestore()`
conflict retry, `setupRealtimeListeners()`, `snapshotData()`.

**Legacy migration is knowingly lossy.** Collection-exclusive prefixes migrate (`flv-` to `flavors`,
`cm_` to `cookedMeals`, `ui_` to `userIngredients`, `buy_`/`ib_`/`staple_` to `pantry`). Ambiguous
keys — bare numerics, timestamps, imported ids — are **dropped**, counted, and `console.warn`ed once.
There is no `_legacy` bucket and no global fallback. The accepted consequence: some historical
ambiguous deletes may resurrect from stale remote copies. See D-071.

**LWW is unchanged:** `applyTombstones()` removes an item only when the tombstone is newer than the
item's `updatedAt`; an item with no `updatedAt` loses. `purgeOldTombstones()` drops markers older
than 180 days, per bucket.

**`normalizeFlavor()` never sets `updatedAt`.** Stamping one during normalization would let a
normalize pass hand a flavor a fresh timestamp that beats its own tombstone under
`applyTombstones()`' LWW rule, resurrecting a deleted flavor on every device.

`normalizeFlavors()` runs at every point `flavors` is assigned from stored data:
`loadFromLocalStorage()`, `loadFromFirestore()`, `restoreBackup()`, `importData()`,
`setupRealtimeListeners()`, and after the `loadUserData()` sign-in union.

Explicitly NOT in v1, and each would create a recurring logging job: `prepared`,
`portionsRemaining`, `batchSize`, freezer quantity, expiry, thaw state, nutrition.

## Pantry item
```js
{
  id, name,
  quantity?,          // number — tracked for non-staples vs minStockQty
  unit?,
  purchaseDate? | expiryDate?, shelfLifeDays?,
  dateMode?,          // 'expiry' -> count down to the printed expiryDate;
                      //   anything else (incl. absent) -> purchaseDate + shelfLifeDays.
                      //   pantryDaysLeft() and pantryExpiryInfo() both branch on this.
  storage?,           // 'fridge' | 'freezer' | 'counter' (inferred INGREDIENT_DB → PANTRY_KNOWLEDGE → category)
  staple?,            // boolean — staple cycles: none → staple → running low; staples not deducted on cook
  stockLevel?,        // 'full' | 'ok' | 'low' | 'empty' — for staples
  suggestDismissed?,  // boolean — user dismissed the auto-grocery suggestion; skip re-add until restocked
  keptOn?,            // 'YYYY-MM-DD' — user tapped Keep on an expired item; suppresses it from the
                      //   attention surfaces for that day only. Never alters dates. (D-057)
  updatedAt?,         // ISO — set by stampUpdated(); tombstone last-write-wins
}
```
`keptOn` also exists on **cooked meal** objects, with identical meaning.

### Merge rules for a purchase (D-057)
`stockPurchasedGroceryItem()` folds a checked-off grocery item into an existing
pantry record only when `findPantryByExactName()` matches AND `canMergePurchase()`
holds. A purchase stays a **separate record** when the existing one uses
`dateMode: 'expiry'` or is already expired — merging either would make old food
look fresh. On a merge, `purchaseDate` is deliberately **not** touched (the oldest
portion governs freshness), and `quantity` only sums when both sides are known —
otherwise it becomes `null` (unknown) rather than an invented number.

## Grocery item
```js
{
  id,               // Date.now() + Math.random()
  name,
  category,
  quantity,         // number or null
  unit,
  sources,          // string[] — e.g. ['Running low'], ['Monday lunch']
  checked,          // boolean
  custom,           // boolean — user-added or auto-added (not from weekly plan)
  fromStaple?,      // boolean — auto-added by checkAndReplenishLowStock / syncStapleToGrocery
  suggested?,       // boolean — true on auto-suggested items (fromStaple items only)
  suggestedReason?, // string — why it was suggested (e.g. 'low stock')
  userSet?,         // boolean — the user actually tapped this row. When true, `checked` is
                    //   authoritative; when absent, an untouched row still auto-ticks if the
                    //   item is already in the pantry (groceryItemChecked()). (D-057)
  stocked?,         // receipt of the inventory transfer, so unchecking undoes exactly what
                    //   checking did: { mode: 'created'|'merge'|'staple', pantryId,
                    //   prevQty?, prevLevel? }. (D-057)
}
```

## Firestore layout
- `users/{uid}` — main user-data doc (no inline photos). Carries the `version` concurrency field.
- `users/{uid}/photos/{recipeId}` — one doc per recipe photo (data URL).
- `sharedRecipes` — public community feed (orphaned feature).
- `familyInvitations` — invitation records, `status: pending | accepted` (accept flow incomplete).

## localStorage keys
| Key | Holds |
|---|---|
| `mealPrepAppData` | full AppState snapshot (primary offline store) |
| `mealPrepBackup` | pre-destructive-action snapshot (Restore Backup / Import) |
| `colorScheme` | **unused** — light-only release; no longer read or written (theme script removed, D-013) |
| `mealPrepDisplayName` | display name |
| `mealPrepHelpSeen` | first-run flag — set on first load; gates Help modal auto-open (only opens if wizard already done) |
| `pantryOnboardingDone`, `mealPrepStartDone` | first-run flags — `pantryOnboardingDone` set by wizard skip or confirm; gates Kitchen Setup Wizard auto-open and Help modal auto-open |
| `mealPrepFoodAlerts` | `{ enabled, announced }` — food-expiry notification opt-in plus the per-record dedup ledger (`"<kind>:<id>" -> "expired" | "use-soon"`). **Device-local by design and never synced** — see D-058 |
| `mealPrepWeekTemplate` | saved weekly-plan template (device-local) |

## Hardcoded databases (in app.js)
| Object | ~Size | Entry shape / purpose |
|---|---|---|
| `sampleRecipes` | ~26 | Built-in Filipino recipes with `nutritionPerServing` (ids 1–26); seeded on first load |
| `INGREDIENT_DB` | ~175 | `{ name, unit, category, price, store, aliases, fridgeDays, freezerDays, trackExpiry, priceValue, minStockQty }` — autocomplete, pricing, storage inference |
| `LOCAL_NUTRITION_DB` | ~120 | `{ name, calories, protein, carbs, fat, fiber, sodium }` per 100g — offline nutrition |
| `PANTRY_KNOWLEDGE` | 22 | Storage guidance prose (location, lasts, store, spoilage, freshness) |
| `defaultCookingHacks` | 14 | Seeded hacks (ids 1-14) |
| `defaultFlavors` | 10 | Starter Flavor Library, ids `flv-*`; offered opt-in via `flavorStarterCandidates()`, never auto-seeded (D-070) |
| `defaultStorageData` | ~40 | Seeds `customIngredients` ONLY in the Firebase-unavailable fallback |

## Versioning
`version` on the Firestore doc is incremented every save and used to detect concurrent edits.
It is **not** a schema-migration system — backward-compat is handled by `patchMissingNutrition()`
and defensive `|| []` / `|| {}` defaults on load.

The export payload carries its own `version` string: `1.1` predates the Flavor Library, `1.2`
adds `flavors`. `importData()` accepts both - a `1.1` file simply has no `flavors` key.
