# Flexible Food System V1 — Existing Application Capability Audit

**Basis:** `main` @ `3c82258` (TASK-079 merged); `docs/FEATURES.md`, `docs/DATA_MODEL.md`, `app.js`
anchors, `LEDGER_CONTRACT.md`, and `audit-evidence/2026-11-06/MEAL-PREP-AUDIT.md`.
**Author:** Claude (Architect/Reviewer), 2026-11-25. Read-only: no code, data or docs were changed.

Rating key:
- ✅ covered
- 🟡 partly covered
- ❌ missing
- ⚠️ covered, but its correctness is undermined by a known defect

---

## 1. Capability-by-capability

### 1. Cook Now — fresh meals from available ingredients, time and appliances — 🟡⚠️

| Exists | Anchor |
|---|---|
| "What should we eat?" ranks Eat-this-first / Easiest / Something different, with shopping as a fallback tier | `getWhatShouldWeEatSuggestions` (D-059) |
| "What should I cook?" | `getCookSuggestions` (D-055) |
| "What can I do?" cookable tiers (inside "Need ideas?") | Home |
| Appliance filters: rice cooker, oven, air fryer, Instant Pot, no-cook, pan, rice+steamer | Recipes quick filters (D-060), `RECIPE_EQUIPMENT`, `recipeHasEquipment` |
| Time and effort scoring | `recipeActiveMinutes`, `recipeEffortScore` |
| Variety | `varietyPenalty` |

**Weakness:** the "available ingredients" signal comes from pantry matching. That matching has
audit defects:
- **F1:** 0 g or expired records count as in stock; Rice matches Rice Vinegar (`isInPantry`,
  `findPantryMatch`).
- **F2:** expired raw food is recommended (`getExpirySuggestions` uses `daysLeft <= 3` with no lower
  bound).

There is no "I have N minutes" input. Time is used for ranking only.

### 2. Meal Prep — batch cooking and freezer-friendly recipes — ✅ (prep stays optional)

| Exists | Anchor |
|---|---|
| Planned batches and Batch Picker | `plannedBatches` (D-076) |
| Prep tab, Prep Mode, Copy AI Prep Brief | Prep tab |
| Recipe `fridgeLife`, `freezerLife`, `storageNotes` | Recipe model |
| `batch-friendly` and `freezer-friendly` tags | `RECIPE_TAGS` |
| Cooked meals with portion tracking (ChronaSense-feeding) | `cookedMeals`, `useCookedPortion` |

Prep is already optional: Home works without a plan. **Known defects:**
- F8: Plan and saved Shop disagree after reload.
- F10: week controls ignore batches.

### 3. Quick Eat — ready-to-eat meals and low-effort combinations — 🟡

| Exists | Anchor |
|---|---|
| "Ready to eat" leftovers and ready food | `getReadyFoodSuggestions` (D-056) |
| Prepared Flavors | D-074 |
| Meal Lego "Try with" combinations | D-073 |
| Effort `assembly` / `very-low`, `no-cook` equipment | Recipe metadata |
| 14 low-effort starter recipes (opt-in pack) | ids 27–40, D-061/D-063, `starterPackCandidates`, `addStarterPackRecipes` |

**Missing:**
- No **Snack Pack** pairing (2-of-3 groups).
- No **"convenience food + add a vegetable/protein"** nudge (book F1/F7: frozen meal → pair it).

### 4. Grocery — no-plan framework, inventory-aware — ❌ (planned-list grocery exists)

| Exists | Anchor |
|---|---|
| Plan-driven grocery list | `generateGroceryList` |
| Pantry cross-off (book F4 step 5) | `pantryMatchesForShop`, `groceryItemChecked` |
| Check-to-stock | `stockPurchasedGroceryItem` (D-057/D-069) |
| Staple restock | `syncStapleToGrocery` |
| Price Book | `INGREDIENT_DB` (~175 items) |

**Missing:**
- No grocery path for a week **without a plan**.
- No role template (4 proteins / 4 veg / 3 starch / 3 fruit / 3 snack / 3 flavor / 1–2 drink).

`INGREDIENT_DB` already has `category` values of Protein, Vegetable, Grain, Fruit, Dairy and
Pantry. That is enough to map 4 of the 7 roles. Snacks, flavor enhancers and beverages need a small
keyword map.

**Defects:**
- F1 makes "already have" unreliable.
- F9: empty staples are not restocked (only `low` is handled).

### 5. Balanced Plate — nutrition across recommendations — 🟡

| Exists | Anchor |
|---|---|
| `nutritionPerServing` (calories, protein, carbs, fat, fiber, sodium) | Recipe model |
| Nutrition goals | Nutrition |
| `mealBalance {protein, vegetables, carb}` (informational) | Recipe metadata |

**Missing:**
- No **fat** role and no **½-plate produce** emphasis.
- Balance is not used in any recommendation surface. There is no "add a vegetable" or "add a
  protein" completion hint.
- `mealBalance` is filled in only where recipes declare it, so seed coverage is partial.

### 6. Versatile Inventory — prioritize multi-use ingredients — ❌

- No score for how many recipes, methods or roles an ingredient supports.
- Staples exist (`staple`), but they are hand-picked by the user.
- Flavor Library (D-070) and Meal Lego are related, but they do not rank ingredients.

### 7. Recipe Knowledge — categorize cookbook recipes, preserve source refs — 🟡

**Exists:**
- Recipe `category`, `tags`, `equipment`, `effort`.
- Import (paste, CSV, JSON).
- Provenance is preserved on import by `saveRecipe`, but only for import metadata.

**Missing:**
- No **book/page source field**.
- No **original-vs-our-adaptation** distinction.
- No cookbook pack.

40 seed recipes exist: 26 Filipino pan dishes and 14 low-effort starters.

### 8. Cooking Efficiency — minimize hands-on time, supervision, prep and cleanup — ✅🟡

| Exists | Anchor |
|---|---|
| `effort`, `activeTime`, `minimal-cleanup` and `shortcut` tags | Recipe metadata |
| Appliance filters | Recipes quick filters |
| Cooking Hacks | Cooking Hacks |
| Prep Mode | Prep tab |

**Missing:**
- No explicit **supervision** signal: hands-off (oven, rice cooker, Instant Pot) vs stand-at-stove.
  The equipment field implies it, but ranking does not use it.
- The cleanup signal exists only as a tag.

---

## 2. Constraints check

| Constraint | Finding |
|---|---|
| Reuse app and infrastructure | All gaps can be closed inside `app.js`, `index.html` and `style.css` with the existing Firestore/localStorage model. No new service is needed. |
| Preserve ChronaSense | Contract surface is `cookedMeals` and `mealConsumption` (6 fields), merge/tombstones, and `MASS_DELETE_GUARD`. **Every V1 slice proposed avoids it.** Each task still runs `npm run test:ledger-contract`. |
| No extra manual tracking | The proposals derive everything from existing inventory, recipes and metadata. No new required inputs. |
| No UI redesign | Proposals add cards or sections to existing tabs (Home, Shop, Recipes). No new tabs, no navigation change. |
| Original vs adaptation | Needs a new optional recipe field. This is a Firestore-synced shape change, so the D-032 red zone applies and the merge is held. |

---

## 3. Inventory investigation: outdated records and inconsistent quantities (read-only)

**Scope honesty.** This investigation used code analysis and the 2026-11-06 audit evidence only.
**Production inventory was not read.**
- The Meal Prep MCP is not attached to this session.
- No Firestore credentials were used.
- **No record was read, deleted or modified.**

### 3a. How stale or inconsistent records arise (code paths)

| # | Symptom | Cause | Audit ref |
|---|---|---|---|
| I-1 | Item shows "in stock" at 0 g, 50 g or after expiry | Availability checks name match and existence, not quantity, expiry or `stockLevel` (`isInPantry`, `pantryMatchesForShop`) | F1 (High) |
| I-2 | Wrong ingredient satisfies a recipe (Rice ↔ Rice Vinegar) | Substring name matching in `findPantryMatch` | F1, F4 |
| I-3 | Quantities silently wrong (500 g + 1 kg = 501 g; null qty → 0 row) | Unit conversion falls through on incompatible or missing units when merging stock | F3 (High) |
| I-4 | Negative stock (12 pcs − 2 → −200) and wrong lot deducted | `deductIngredientsForRecipe` / `toGrams` deduct across mismatched units; multi-lot deduction order is wrong | F4 (High) |
| I-5 | Expired raw food keeps being suggested | `getExpirySuggestions` has no lower bound | F2 (High) |
| I-6 | `stockLevel: empty` staples never return to the list | `syncStapleToGrocery` handles `low` only | F9 |
| I-7 | External agents see wrong stock | MCP `get_inventory` omits expiry; `inStock` is true at quantity 0 | audit MCP note |
| I-8 | Records look current but aren't | `inventoryVerifiedAt` is a single scalar (D-075), not per item; `updatedAt` changes on any edit | design limit |

### 3b. What the owner's live data probably contains (to confirm)

1. Expired lots still marked `full` or `ok`.
2. Lots with `quantity: 0`, negative or `null` quantity.
3. Same-name lots in different units (g vs kg vs pcs).
4. Staples stuck at `empty`.
5. Items whose last `updatedAt` is many weeks old.

### 3c. Recommended read-only confirmation (needs owner action)

**Option A (no code).**
1. The owner runs the authenticated Meal Prep MCP `get_inventory`, or exports a JSON backup from
   More → Backup.
2. Claude classifies it offline against I-1 to I-8 and returns a report.
3. Nothing is written back.

**Option B (proposal FFS-0).** Add a **read-only "Stock health" report**: a list grouped by issue
type with counts. It has no edit or delete buttons and calls neither `saveData()` nor any write. It
gives a standing view without adding tracking work.
