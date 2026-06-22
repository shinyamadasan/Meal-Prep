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

**Password reset** — `sendPasswordResetEmail()` is missing entirely.

Implementation:
- Find the sign-in modal in `index.html`
- Add a "Forgot password?" link below the sign-in button
- In `app.js`, add a `sendPasswordReset()` function that calls Firebase Auth `sendPasswordResetEmail(auth, email)`
- Show a success message: "Password reset email sent — check your inbox"
- Show an error message if the email is not found

Success Criteria:
1. "Forgot password?" link is visible on the sign-in modal
2. Clicking it shows an email input (can reuse the existing email field)
3. Submitting calls `sendPasswordResetEmail()` — verify by code inspection
4. Success message shown after submission
5. No crash if email field is empty (validate before calling Firebase)

---

## Task Queue (in order — Claude works top to bottom)

### 1. Dark mode toggle
`updateThemeToggleIcon()` exists in `app.js` but `#theme-toggle` button is missing from `index.html`.

Implementation:
- Find the header in `index.html`
- Add a toggle button with id `theme-toggle` in the right place
- The JS already handles the click — just add the button

Success Criteria:
1. A dark/light mode toggle button is visible in the header
2. Clicking it switches between dark and light mode
3. Preference persists on page reload (already handled by existing JS)

### 2. Grocery list stale on serving-size change
Changing servings in the planner doesn't auto-refresh the grocery list.

Implementation:
- Find where serving size changes are saved in `app.js`
- Add a call to `renderGroceryList()` after any serving size change

Success Criteria:
1. Change a recipe's servings in the planner
2. Switch to the Grocery tab — list reflects the updated quantities immediately
3. No page refresh needed

### 3. Mung Beans missing from INGREDIENT_DB
Ginisang Monggo pantry match fails silently because "Mung Beans" is not in `INGREDIENT_DB`.

Implementation:
- Find `INGREDIENT_DB` in `app.js`
- Add an entry for Mung Beans with: name, unit (g), category (Legume), price, store, fridgeDays, freezerDays, trackExpiry, priceValue, minStockQty

Success Criteria:
1. "Mung Beans" appears in pantry autocomplete
2. Ginisang Monggo (sample recipe id:8) pantry match works

### 4. USDA DEMO_KEY rate limit message
When the USDA API rate limit is hit, it fails silently. Users get no feedback.

Implementation:
- Find `searchNutritionDB()` in `app.js`
- Check the API response status — if 429 or error, show a user-friendly message:
  "Nutrition lookup unavailable right now — try again in a minute"

Success Criteria:
1. Rate limit response is caught
2. User sees a friendly message instead of nothing happening

### 5. Paste recipe parser feedback
The paste recipe parser fails silently when it can't parse a recipe.

Implementation:
- Find `parseAndImportRecipe()` in `app.js`
- After parsing, check if key fields (name, ingredients) were successfully extracted
- If not, show a message: "Couldn't read this recipe format — try copying just the ingredients and instructions"

Success Criteria:
1. Successful parse: form fills normally
2. Failed parse: user sees a clear message explaining what went wrong

---

## Do Not Work On

- Community feed or family sharing features
- Service worker or PWA changes
- UI redesign beyond what tasks specify
- New sample recipes
- Any feature not listed in the Task Queue above

---

## Done

### ✅ Phase C — Pantry auto-deduction on cook (2026-06-22)
`markRecipeCooked()` now deducts used ingredients from `AppState.pantry`.
Depleted items are removed. `renderPantry()` called immediately after.
Merged via PR #1.
