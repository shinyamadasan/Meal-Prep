# Features

> Catalog of what exists and its status. Read only the relevant tab's section for a task.
> Status: **Working** · **Partial** · **Broken** · **Hidden** (built, no nav entry).
> Anchors are function names + DOM ids (stable). No line numbers.

## Dashboard (Home)
- **3-level prioritized home** — Status: Working · `renderDashboard()`
  - L1 Attention: **Expired** (pantry + cooked food, each with one-tap `Keep` / `Remove`, plus a bulk **Remove expired (N)**), **Use soon** (≤2d, informational only — never bulk-removable), low-staple alerts, and **"Use soon"** recipe suggestions. Sourced from `collectAttentionItems()`. See DECISIONS D-057.
  - L2 Action split: cook suggestions (3 tiers) with **"Buy [ingredient]"** (`buyMissingIngredient()`); buy suggestions.
  - L3 Planning strip: 7-day dot row + links to Planner/Nutrition.
- **Cook History card** — Working · last 10 of `AppState.cookHistory`, hidden when empty.
- Personalized greeting (display name / email prefix).
- **"What should we eat?"** — Working · `getWhatShouldWeEatSuggestions()` / `renderWhatShouldWeEatCard()` · up to 3 picks answering the whole question in one card: **Eat this first** (ready cooked food, straight from `getReadyFoodSuggestions()`), **Easiest** (lowest-cost cookable recipe, only when genuinely low-effort), **Something different** (only when there is a `cookHistory` to differ from). Deterministic additive cost, lower = better; shopping is a **tier**, not a weight, so anything cookable now outranks anything needing a trip. Reasons are shown as chips, never a number. Completion hints ("Add rice + steamed veg") are deterministic sentences off the existing `mealBalance`, not composed meals. Zero new persisted state; displaying a pick consumes nothing. Rendered ABOVE the existing Ready-to-eat and What-should-I-cook cards, both unchanged. See DECISIONS D-059.
- **"Ready to eat"** — Working · `getReadyFoodSuggestions()` / `renderReadyFoodCard()` · up to 3 stored cooked meals, ranked expiring-fridge → fridge → freezer, each with a one-tap **Use 1**. Rendered ABOVE the cook suggestions so the priority is ready food → easiest cook → everything else. Expired batches are excluded. See DECISIONS D-056.
- **"What should I cook?"** — Working · `getCookSuggestions()` / `renderCookSuggestionCard()` · up to 3 deterministic options: ⚡ Easiest (lowest effort score), 🥬 Use soon (`getExpirySuggestions()`, shared with the existing attention card), 🍽️ Something different (least-recently cooked, from `cookHistory`). A category with no supporting data is OMITTED, never guessed. No model calls, no server. See DECISIONS D-055.

## Cook (My Recipes)
- **Recipe card grid** — Working · `renderRecipes()` · photo, nutrition, cost, shelf-life badges.
- **Sample badge** — Working · `isSampleRecipe()` tags the 26 seeded recipes "Sample" so a first-time user knows they didn't add them. *(Job: "what can I cook" — clarity/trust.)*
- **Favorites** — Working · `toggleFavorite()`, `recipe.favorite`, `#favorites-filter`.
- **Serving scaler** — Working · stepper + `adjustDetailServings()` / `buildDetailIngList()`.
- **Search & filter** — Working · name/instructions, category, prep-time, favorites-only.
- **Recipe count** — Working · `#recipe-count` shows how many recipes match the active search/filter (updates live in `renderRecipes()`).
- **Add/Edit recipe modal** — Working · `openEditRecipeModal()`; autocomplete from `INGREDIENT_DB`; USDA lookup; photo upload w/ compression.
- **Cook suggestions strip** — Working · 3 tiers from pantry.
- **Getting Started card** — Working · 2-step onboarding, auto-dismiss.
- **Paste recipe import** — Partial · `parseAndImportRecipe()`; heuristic, quality varies; shows confidence/warning.
- **CSV import** — Working · file → preview → confirm; template download.
- **JSON export/import** — Working · `exportData()` / `importData()`. Import **merges** by id (`unionById`) — existing items win on collision, re-importing a backup is a no-op. Confirmation via `showConfirmDialog()` (works on iOS PWA; `confirm()` is silently blocked in standalone mode). Snapshots `mealPrepBackup` first.

## Inventory (My Fridge)
- **Cooked meals** — Working · `renderCookedMeals()` · location, days-remaining, expired highlight.
- **Pantry grid** — Working · `renderPantry()` · grouped by storage; staple cycling; inline date/qty/storage edit; storage tips from `PANTRY_KNOWLEDGE`.
- **Pantry search** — Working · `#pantry-search` filters the pantry by name in real time (`renderPantry()`); preserves storage grouping; encouraging "No matches" empty state; hidden when the pantry is empty. *(Job: "did I already buy X?")*
- **Add to pantry row** — Working · `#pantry-input` + Add + Browse + Bulk add. Toast feedback on add ("Added …"). Duplicate name: `showConfirmDialog()` asks "add another?" instead of silent skip — supports same-name items with different expiry dates. (The removed `#pantry-qty-input` / `#pantry-add-where` reads were deleted in D-057; `addToPantry()` now infers storage and leaves quantity unknown.)
- **Ingredient Browser modal** — Working · `openIngredientBrowser()`, `#ingredient-browser-modal`.
- **Bulk add + voice** — Working · `openBulkAddModal()`, `confirmBulkAdd()`, `startVoiceInput()` (Web Speech API; Chrome/Edge only, text fallback elsewhere).
- **Freshness alert banner** — Working · top-of-app on load; dismissable per session. Items marked `Keep` today are excluded from the expired count (`getFreshnessAlerts()`).
- **Clear expired** — Working · `#pantry-clear-expired` / `clearExpiredPantryItems()` · pantry-scoped bulk removal. `getExpiredPantryItems()` classifies through `pantryDaysLeft()`, so it agrees with the badges for bought-date items too (D-057 fixed an expiryDate-only scan that matched almost nothing). Explicit tombstones per id.
- **Expired cleanup from Home** — Working · `removeAttentionItem()` (one tap, one item) and `removeAllExpired()` (bulk, confirmed, pantry + cooked meals). Only `daysLeft < 0` records qualify; "use soon" and `Keep`-marked records are structurally excluded. See DECISIONS D-057.
- **Mark recipe cooked** — Working · `markRecipeCooked()` → deducts pantry + logs cook history. The same dialog optionally captures how many meal portions the batch made (pre-filled from the recipe's servings, follows the batch multiplier until the user overrides it).
- **Portion tracking on stored food** — Working · `cookedMeal.initialPortions` / `portionsRemaining` · optional. A tracked batch shows a portion badge and a one-tap **Used 1**; the last portion finishes the batch through the existing removal path. Untracked batches render exactly as before. See DECISIONS D-056.

## Shop (Grocery)
- **Auto grocery list** — Working · `renderGroceryList()` · aggregated from plan, scaled, grouped by category (A→Z, "Other" last), per-item cost, in-stock badges, check-off, recipe source labels.
- Add custom item, Clear All, Copy to clipboard, Prices→Price Book, weekly cost summary.
- **Grocery → Inventory on check** — Working · `toggleGroceryItem()` → `stockPurchasedGroceryItem()` · checking a row transfers it to inventory with **no further input**: category, storage, shelf life and purchase date are all inferred. Buying more of something you already have updates the existing record (`findPantryByExactName()` + `canMergePurchase()`) rather than creating a duplicate; a printed-expiry or already-expired record stays separate. Buying a low staple sets `stockLevel: 'full'` and clears its auto shopping row. Unchecking undoes the transfer exactly, via the `stocked` receipt. Check-off now persists (it previously never called `saveData()`). See DECISIONS D-057.

### Low-effort discovery
- **Quick filter chips** — Working · `renderRecipeQuickFilters()` / `setRecipeQuickFilter()` → `#recipe-quick-filters` · lowest effort, rice cooker, rice + steamer, Instant Pot, oven, pan, no-cook, batch-friendly. One chip at a time, ANDed on top of the existing search/category/time/favourites filters. A chip matching nothing is hidden; tapping the active chip clears it. Transient view state — not persisted, not synced.
- **Recipe metadata strip** — Working · `renderRecipeMetaStrip()` · hands-on time, effort, equipment, tags, and a "Protein ✓ · Veg ✓ · Carb ✓" line. Renders nothing at all for a recipe with no metadata.
- **Metadata editor** — Working · `renderRecipeMetaFields()` / `readRecipeMetaFromForm()` · compact "How you cook it" block in the recipe modal; all fields optional.
- **Edit preserves unowned properties** — Working · `saveRecipe()` starts an edit from the existing recipe and overlays only form-owned fields, so `favorite`, `highlights`, import provenance, `updatedAt`, and the input-less `fiber`/`sodium` nutrition values survive an unrelated edit. The form stays authoritative for what it does own. See DECISIONS D-055.

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

## Price Book
- ~175 `INGREDIENT_DB` entries — Working · `renderIngredientsTab()` · per-store pricing, My Stores filter, add custom ingredient, Add to Pantry, text search (`#ingcat-search`), category filter.

## Cooking Hacks
- 6 built-in Filipino hacks + user add/edit/delete — Working · `renderCookingHacks()`.

## Settings & Help
- Settings modal — Working · `openSettingsModal()` · display name, account/sign-out, **Food expiry alerts** opt-in, export/import, restore backup, clear all (snapshots first).
- Help modal — Working · `#help-modal` · 6-step guide · reachable via Settings; does NOT auto-open on first run when the Kitchen Setup Wizard will also fire (`pantryOnboardingDone` gate in `initApp()`).
- **Kitchen Setup Wizard** — Working · `openKitchenSetupModal()` / `seedPantryIfEmpty()` · auto-opens on first run only (when pantry is empty and `pantryOnboardingDone` not set); only onboarding gate on brand-new first run.

## Notifications
- **Food expiry alerts** — Working · `maybeNotifyAttention()` / `buildAttentionNotification()` / `toggleFoodAlerts()` · **foreground-only**: one grouped notification is raised when the app is opened or brought back to the foreground and Kitchen Truth reports newly expired or newly use-soon food. Consumes `collectAttentionItems()` — there is no second freshness model. Opt-in from Settings only; `Notification.requestPermission()` is never called on page load. Deduplicated by the `mealPrepFoodAlerts` ledger, so unchanged food never repeats. Tapping the notification opens the Home **Needs Attention** card (`openAttentionView()`), where Keep / Remove / Use already live. Expired food is only ever offered for review, never for eating. See DECISIONS D-058.
- **App-icon badge** — Working · `updateAppAttentionBadge()` · `navigator.setAppBadge()` with the outstanding expired+expiring count on an installed PWA; silently absent where unsupported. The in-app Inventory tab badge (`updateFreshnessBadges()`) is unchanged.
- **Notification click routing** — Working · `sw.js` `notificationclick` → focus an existing window and `postMessage({ type: 'show-attention' })`, else `openWindow(scope)`. The service worker schedules and sends nothing; it only routes the tap.
- **NOT built, and not achievable on this architecture**: notifications while the app is closed. That requires a push server, and this app is static GitHub Pages. See DECISIONS D-058.

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
