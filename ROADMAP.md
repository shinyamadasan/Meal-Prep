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

**Password reset** — users who forget their password are permanently locked out.

Implementation:
- Find the sign-in modal in `index.html`
- Add a "Forgot password?" link below the sign-in button
- In `app.js`, add a `sendPasswordReset()` function that calls Firebase Auth `sendPasswordResetEmail(auth, email)`
- Show a success message: "Password reset email sent — check your inbox"
- Show an error if the email field is empty

Success Criteria:
1. "Forgot password?" link is visible on the sign-in modal
2. Clicking it prompts for email (can reuse the existing email field)
3. Submitting calls `sendPasswordResetEmail()` — verified by code inspection
4. Success message shown after submission
5. No crash if email is empty — validate before calling Firebase

---

## Task Queue (in order — Claude works top to bottom)

### 1. Auto-add low staples to grocery list

**Why this matters:** The staple-level system (staple / running low / none) and `minStockQty` in INGREDIENT_DB currently drive zero action. Pantry items can be "running low" forever and nothing happens. This closes the restock loop.

Implementation:
- Find where staple level is toggled in `app.js`
- When an item is set to "running low" OR its quantity drops to or below `minStockQty`, check if it's already on the grocery list
- If not: add it automatically with a note "Low stock"
- Also run this check inside `deductIngredientsForRecipe()` — after deducting, if qty hits minStockQty, auto-add to grocery list
- Call `renderGroceryList()` after adding

Success Criteria:
1. Mark a pantry item as "running low" → it appears on the grocery list automatically
2. Cook a recipe that drops an ingredient to minStockQty → it appears on the grocery list
3. If the item is already on the grocery list, no duplicate is added
4. Grocery list shows "Low stock" label on auto-added items

### 2. Expiry-based recipe suggestions on the dashboard

**Why this matters:** The dashboard already shows expiring items (≤2 days) but does nothing with that information. Users see "Eggs expiring tomorrow" but have no idea what to cook. Connecting expiring ingredients to cookable recipes turns a warning into an action.

Implementation:
- Find `renderDashboard()` in `app.js`
- Below the expiry alert, add a "Use before they expire" section
- Loop through expiring pantry items (≤3 days)
- Find recipes in `AppState.recipes` that contain any of those ingredients
- Show up to 3 recipe suggestions with a "Plan it" button that adds to today's planner slot

Success Criteria:
1. When pantry has items expiring within 3 days, recipe suggestions appear on the dashboard
2. Each suggestion shows the recipe name and which expiring ingredient it uses
3. "Plan it" button adds the recipe to today's dinner slot in the weekly planner
4. If no recipes match expiring ingredients, section is hidden

### 3. Paste recipe parser improvement

**Why this matters:** This is the primary way users grow their recipe library. If it fails silently, users give up. More recipes = better weekly planning = more app value.

Implementation:
- Find `parseAndImportRecipe()` in `app.js`
- After parsing, check if key fields were extracted (name + at least 2 ingredients)
- If parse succeeded: pre-fill the form and show "Imported — review and save"
- If parse failed: show "Couldn't read this format. Try pasting just the ingredients list" with the raw text still in the box
- Add a confidence indicator: how many fields were detected

Success Criteria:
1. Successful parse: form pre-fills with a clear "Review before saving" message
2. Failed parse: user sees a helpful message, not a blank form
3. Partial parse (name found but no ingredients): user sees what was found and what wasn't

### 4. Filipino ingredients in LOCAL_NUTRITION_DB

**Why this matters:** The app is Filipino-first but the nutrition DB is mostly Western ingredients. Tracking macros for Adobo, Sinigang, Champorado is unreliable because key ingredients are missing.

Implementation:
- Find `LOCAL_NUTRITION_DB` in `app.js`
- Add entries for common Filipino ingredients not yet present:
  Kangkong, Pechay, Ampalaya, Kamote, Gabi, Malunggay, Talong, Sitaw, Okra,
  Bangus, Tilapia, Galunggong, Squid, Tahong (mussels),
  Bagoong, Patis, Toyo, Coconut milk, Gata,
  White rice (cooked), Jasmine rice, Brown rice,
  Mung beans (Monggo), Black beans
- Each entry needs: name, calories, protein, carbs, fat, fiber, sodium (per 100g)
- Use standard nutritional values (USDA or Philippine food composition tables)

Success Criteria:
1. Searching "kangkong" in the nutrition lookup returns a result
2. Searching "bangus" returns a result
3. At least 20 new Filipino ingredients added
4. No existing entries overwritten

### 5. Grocery list refresh on serving-size change

**Why this matters:** Changing servings in the planner makes the grocery list wrong. Users can't trust the quantities.

Implementation:
- Find where serving size changes are saved in `app.js`
- Add a call to `renderGroceryList()` after any serving size change in the planner

Success Criteria:
1. Change a recipe's servings in the Plan tab
2. Switch to the Shop tab — quantities reflect the updated servings immediately

### 6. Mung Beans in INGREDIENT_DB

**Why this matters:** Ginisang Monggo is one of the 15 built-in sample recipes but its main ingredient doesn't exist in INGREDIENT_DB. Pantry matching silently fails.

Implementation:
- Find `INGREDIENT_DB` in `app.js`
- Add Mung Beans entry: unit (g), category (Legume), price estimate, store (palengke/supermarket), fridgeDays, freezerDays, trackExpiry: false, priceValue, minStockQty

Success Criteria:
1. "Mung Beans" appears in pantry autocomplete suggestions
2. Ginisang Monggo cook suggestions match correctly when mung beans are in pantry

---

## Do Not Work On

- Dark mode toggle (more problems than value)
- Community feed or family sharing features
- Service worker or PWA changes
- UI redesign beyond what tasks specify
- New sample recipes
- USDA API changes
- Family sharing or community features

---

## Done

### ✅ Grocery → Pantry auto-transfer (2026-06-22)
Checked grocery items are automatically transferred to pantry with undo support.

### ✅ Phase C — Pantry auto-deduction on cook (2026-06-22)
`markRecipeCooked()` now deducts used ingredients from `AppState.pantry`.
Depleted items are removed. `renderPantry()` called immediately after.
Merged via PR #1.
