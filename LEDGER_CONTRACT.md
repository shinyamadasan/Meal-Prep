# Life Ledger contract — read this before changing cookedMeal / mealConsumption / deletions

This app feeds a Life Ledger integration in the ChronaSense repo (`meal-life-ledger-adapter.js`).
The authoritative contract document is **`MEAL_LEDGER_SOURCE_CONTRACT_V1.md`** in that repo's
`contracts/` directory — it enumerates exactly which fields and behaviors of `cookedMeals`,
`mealConsumptions`, and `deletions.cookedMeals` are load-bearing.

**You do not need to read that document for most changes.** Pantry, recipes, grocery list,
flavors, protein-identity inference, freshness alerts, UI, and photo storage are all explicitly
out of scope for the contract — normal feature work there is safe by default.

**You DO need to check the contract before changing:**
- `cookedMeal.id`, `.name`, `.cookedDate`, `.initialPortions`, `.recipeId`, `.source`
- The mealConsumption schema (`id`, `cookedMealId`, `recipeId`, `mealName`, `portionsConsumed`,
  `consumedAt`) — it is currently a **closed six-field schema** (`canonicalizeMealConsumption`
  rejects anything else)
- `recordMealConsumption`, `useCookedPortion`, `generateMealConsumptionId`
- `mergeMealConsumptions`, `reconcileMealConsumptions`, conflict evidence handling
- `writeTombstone`, `recordLocalDeletions`, `deletions.cookedMeals`, `MASS_DELETE_GUARD`,
  `saveToFirestore`'s call to `recordLocalDeletions()`

## The gate

```
npm run test:ledger-contract
```

Runs `tests/ledger-source-contract.spec.js` (the compatibility gate — real functions, chaos and
benign-change proof) and `tests/cross-repo-life-ledger-fixture.spec.js` (real captured shapes,
also used by the ChronaSense adapter's cross-repo test). Both are already part of the normal
`npm test` local suite; this script is the fast, targeted way to run just the contract-relevant
part before a merge.

If you change a real cooked-meal/consumption/deletion behavior and this gate starts failing, that
is the signal working as intended — read the failure message (it names the broken contract
clause), decide whether the break is intentional, and if so see `CONTRACT_VERSIONING.md` in the
ChronaSense repo's `contracts/` directory for how to move the contract forward. If it's not
intentional, you likely just found a real bug before it reached production Life Ledger data.

## Updating the cross-repo fixture

`tests/fixtures/cross-repo-life-ledger-fixture.json` is checked in and only refreshed by:

```
npm run fixture:update
```

Never hand-edit it — it is real captured output from `normalizeCookedMeals()` /
`useCookedPortion()` running in a real browser page (see the spec for why).
