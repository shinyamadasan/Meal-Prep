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
AppState.cookedMeals        // [] cooked batches with storage location + date
AppState.cookHistory        // [{ recipeId, recipeName, date, servings }] newest-first, max 100
AppState.nutritionGoals     // { calories, protein, carbs, fat, fiber, sodium }
AppState.customIngredients  // [] storage-guide items (feeds dead #storage tab)
AppState.customHacks        // [] user cooking hacks
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
}
```
Meal-planner slots store **recipe ids** (not objects): `breakfast/lunch/dinner` hold one id or
`null`; `snacks` is an array of ids.

## Pantry item
```js
{
  id, name,
  quantity?,          // number — tracked for non-staples vs minStockQty
  unit?,
  purchaseDate? | expiryDate?, shelfLifeDays?,
  storage?,           // 'fridge' | 'freezer' | 'counter' (inferred INGREDIENT_DB → PANTRY_KNOWLEDGE → category)
  staple?,            // boolean — staple cycles: none → staple → running low; staples not deducted on cook
  stockLevel?,        // 'full' | 'ok' | 'low' | 'empty' — for staples
  suggestDismissed?,  // boolean — user dismissed the auto-grocery suggestion; skip re-add until restocked
}
```

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

## Hardcoded databases (in app.js)
| Object | ~Size | Entry shape / purpose |
|---|---|---|
| `sampleRecipes` | ~26 | Built-in Filipino recipes with `nutritionPerServing` (ids 1–26); seeded on first load |
| `INGREDIENT_DB` | ~175 | `{ name, unit, category, price, store, aliases, fridgeDays, freezerDays, trackExpiry, priceValue, minStockQty }` — autocomplete, pricing, storage inference |
| `LOCAL_NUTRITION_DB` | ~120 | `{ name, calories, protein, carbs, fat, fiber, sodium }` per 100g — offline nutrition |
| `PANTRY_KNOWLEDGE` | 22 | Storage guidance prose (location, lasts, store, spoilage, freshness) |
| `defaultCookingHacks` | 6 | Seeded hacks |
| `defaultStorageData` | ~40 | Seeds `customIngredients` ONLY in the Firebase-unavailable fallback |

## Versioning
`version` on the Firestore doc is incremented every save and used to detect concurrent edits.
It is **not** a schema-migration system — backward-compat is handled by `patchMissingNutrition()`
and defensive `|| []` / `|| {}` defaults on load.
