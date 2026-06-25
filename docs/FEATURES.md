# Features

> Catalog of what exists and its status. Read only the relevant tab's section for a task.
> Status: **Working** · **Partial** · **Broken** · **Hidden** (built, no nav entry).
> Anchors are function names + DOM ids (stable). No line numbers.

## Dashboard (Home)
- **3-level prioritized home** — Status: Working · `renderDashboard()`
  - L1 Attention: expiring items (≤2d), low-staple alerts, **"Use soon"** recipe suggestions.
  - L2 Action split: cook suggestions (3 tiers) with **"Buy [ingredient]"** (`buyMissingIngredient()`); buy suggestions.
  - L3 Planning strip: 7-day dot row + links to Planner/Nutrition.
- **Cook History card** — Working · last 10 of `AppState.cookHistory`, hidden when empty.
- Personalized greeting (display name / email prefix).

## Cook (My Recipes)
- **Recipe card grid** — Working · `renderRecipes()` · photo, nutrition, cost, shelf-life badges.
- **Favorites** — Working · `toggleFavorite()`, `recipe.favorite`, `#favorites-filter`.
- **Serving scaler** — Working · stepper + `adjustDetailServings()` / `buildDetailIngList()`.
- **Search & filter** — Working · name/instructions, category, prep-time, favorites-only.
- **Recipe count** — Working · `#recipe-count` shows how many recipes match the active search/filter (updates live in `renderRecipes()`).
- **Add/Edit recipe modal** — Working · `openEditRecipeModal()`; autocomplete from `INGREDIENT_DB`; USDA lookup; photo upload w/ compression.
- **Cook suggestions strip** — Working · 3 tiers from pantry.
- **Getting Started card** — Working · 2-step onboarding, auto-dismiss.
- **Paste recipe import** — Partial · `parseAndImportRecipe()`; heuristic, quality varies; shows confidence/warning.
- **CSV import** — Working · file → preview → confirm; template download.
- **JSON export/import** — Working · `exportData()` / `importData()`. Import **replaces** fields present in the file (recipes/weeklyPlan swapped wholesale), keeps absent fields, snapshots `mealPrepBackup` first. NOT a per-recipe merge.

## Inventory (My Fridge)
- **Cooked meals** — Working · `renderCookedMeals()` · location, days-remaining, expired highlight.
- **Pantry grid** — Working · `renderPantry()` · grouped by storage; staple cycling; inline date/qty/storage edit; storage tips from `PANTRY_KNOWLEDGE`.
- **Add to pantry row** — Working · `#pantry-input` + Add + Browse + Bulk add. (Qty input + storage selector were removed; `addToPantry()` still reads removed `#pantry-qty-input`/`#pantry-storage` — see ROADMAP Known Issues.)
- **Ingredient Browser modal** — Working · `openIngredientBrowser()`, `#ingredient-browser-modal`.
- **Bulk add + voice** — Working · `openBulkAddModal()`, `confirmBulkAdd()`, `startVoiceInput()` (Web Speech API; Chrome/Edge only, text fallback elsewhere).
- **Freshness alert banner** — Working · top-of-app on load; dismissable per session.
- **Mark recipe cooked** — Working · `markRecipeCooked()` → deducts pantry + logs cook history.

## Shop (Grocery)
- **Auto grocery list** — Working · `renderGroceryList()` · aggregated from plan, scaled, grouped by category (A→Z, "Other" last), per-item cost, in-stock badges, check-off, recipe source labels.
- Add custom item, Clear All, Copy to clipboard, Prices→Price Book, weekly cost summary.
- Grocery → Pantry auto-transfer on check (with undo).

## Plan (Weekly Planner)
- **7-day grid** — Working · `renderWeeklyPlanner()` · click slot → recipe selection modal; multi-day assign; expiry warnings; week stats; mobile day navigator.
- **Weekly nutrition totals** — Working · `renderWeeklyNutritionTotals()` → `#weekly-nutrition-totals`.
- Save/Load week template (fills empty slots only); Day copy/paste/clear; Clear week.
- **Prep Mode** — Working · `openPrepMode()` · checklist of week's recipes + progress bar.

## Nutrition
- Goals (cal/protein/carbs/fat/fiber/sodium) — Working.
- Weekly totals + averages — Working · `renderWeeklyNutritionTotals()`.
- Weekly chart (Chart.js) — Working · needs `chart.min.js`.
- Daily breakdown — Working.
- Recipe filter by nutrition (high protein / low carb / low cal / high fiber) — Working.
- USDA lookup in recipe form — Working · `searchNutritionDB()` (`DEMO_KEY` may rate-limit).

## Price Book (Ingredient Catalog)
- ~175 `INGREDIENT_DB` entries — Working · `renderIngredientsTab()` · per-store pricing, My Stores filter, add custom ingredient, Add to Pantry, text search (`#ingcat-search`), category filter.

## Cooking Hacks
- 6 built-in Filipino hacks + user add/edit/delete — Working · `renderCookingHacks()`.

## Settings & Help
- Settings modal — Working · `openSettingsModal()` · display name, account/sign-out, export/import, restore backup, clear all (snapshots first).
- Help modal — Working · `#help-modal` · 6-step guide.

## Auth & Security
- Email sign-in/sign-up, email verification (gates sharing), sign-out — Working.
- **Password reset** — Working · `sendPasswordReset()` + "Forgot password?" link.
- Session via Firebase `onAuthStateChanged` — Working.
- Firebase App Check (reCAPTCHA v3) — Working.
- XSS defense (`escapeHtml`, `stripTagsDeep`) — Working.
- Optimistic concurrency (`runTransaction`, union-merge) — Working.
- Sentry — Partial (code ready, `SENTRY_DSN` empty).

## Hidden / Orphaned (built, no nav entry)
- Family Sharing modal (`openFamilySharingModal`) — Hidden; accept flow incomplete.
- Community Feed / shared recipes (`#shared-recipes-modal`, `sharedRecipes`) — Hidden.
- Storage Guide tab (`#storage`, `renderStorageGuide()`) — Hidden/dead UI.
- `recipe.highlights` tag chips — rendered, no UI to set.
