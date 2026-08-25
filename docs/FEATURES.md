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
- **Pantry grid** — Working · `renderPantry()` · grouped by storage; staple cycling; inline date/qty/storage edit; storage tips from `PANTRY_KNOWLEDGE`. Each card shows name, quantity/unit and the absolute date as three separate elements (`.pi-name` / `.pi-qty` / `.pi-date`) alongside the relative `.pantry-fresh-badge`. The date reads **Expires ‹date›** for a printed expiry the user entered and **Best by ‹date›** for one derived from bought-date + shelf life; both come from `pantryExpiryInfo()`, which reads `pantryDaysLeft()`'s own two branches so the date and the badge can never disagree. See DECISIONS D-066.
- **Pantry search** — Working · `#pantry-search` filters the pantry by name in real time (`renderPantry()`); preserves storage grouping; encouraging "No matches" empty state; hidden when the pantry is empty. *(Job: "did I already buy X?")*
- **Add to pantry row** — Working · `#pantry-input` + Add + Browse + Bulk add, plus an optional detail line of `#pantry-qty` / `#pantry-unit` / `#pantry-expiry`. Toast feedback on add ("Added …"). Duplicate name: `showConfirmDialog()` asks "add another?" instead of silent skip — supports same-name items with different expiry dates. Storage is still inferred, never asked. The row wraps on narrow viewports rather than squeezing the name field (`.pantry-add-row` `flex-wrap` + a scoped `min-width` on `.ing-name-wrap`), which previously collapsed `#pantry-input` to 26px at 390px. Every detail field is optional and blank stays unknown — no quantity leaves `quantity: null` and no date leaves the item in bought-date mode, so D-057's "never invent a number" rule holds. See DECISIONS D-066.
- **Ingredient Browser modal** — Working · `openIngredientBrowser()`, `#ingredient-browser-modal`.
- **Bulk add + voice** — Working · `openBulkAddModal()`, `confirmBulkAdd()`, `startVoiceInput()` (Web Speech API; Chrome/Edge only, text fallback elsewhere). Line formats: `Name, Qty, Unit`, `Name qty unit` (`NO_COMMA_RE`), or just `Name` — each with an optional **trailing date**. `parseTrailingDate()` accepts only `Aug 8 2026`, `8 Aug 2026` and `2026-08-08` — the two month-word shapes also taking a **two-digit year** (`Aug 8 26`, `8 Aug 26`), expanded by `expandYear()` on a fixed 00-99 → 2000-2099 map and then believed only inside `shortYearPlausible()`'s window of `[currentYear - 1, currentYear + 10]`; the ISO shape stays four-digit. A short year outside that window is **not** buried in the item name — `parseTrailingDate()` returns `{ shortYear }` and the line becomes a D-068 attention row ("year \"12\" is outside the expected food-expiry range") with its exact text kept for correction — **unless the line carries a valid `exp:`**, which keeps its place at the top of the precedence ladder: the line is accepted, the unrecognised short year stays in the name (it was never read as a date, so it is not stripped) and `exp:` supplies the expiry. Only `exp:` has that authority; the shared field and shelf-life inference never rescue such a line. The window gates the two-digit spelling only: `May 5 2012` still stores 2012, and there is no general expiry-age restriction. Anything else (notably `8/8/2026` and `8/8/26`, day-first in half the world) is left in the text and reported via `looksLikeAmbiguousDate()` rather than guessed. What keeps `7 Up`, `Heinz 57 Sauce`, `Vitamin B12`, `Formula 26` and `Sauce Aug 26` intact is the **complete grammar** — month word AND day AND year — not the year's width: a two-digit number is never a year on its own. `isRealCalendarDate()` validates after expansion, so `Feb 31 26` is rejected rather than rolled into March. Expiry precedence, strongest first: line `exp:YYYY-MM-DD` → recognised trailing date → shared `#bulk-add-expiry` field → bought-date + shelf life. Records land in the same `expiryDate`/`dateMode` fields the quick-add path uses and render through the D-066 model — there is no second expiry model. **Duplicate names top up stock** rather than being thrown away (D-069): a line whose name already exists merges into that record when `canMergePurchaseInto()` allows it and both quantities are known, is `skipped` when the line carries no quantity (nothing to add), and otherwise becomes its **own** record so the purchase is never lost. **Partial submits**: each line gets one of four statuses — `added`, `merged`, `skipped` or `attention` (not added, user can fix). Only `attention` lines stay in the textarea, in original text and order; finished lines — including merged ones — drop out so a correction pass never re-adds them. An actionable warning means the line is NOT committed — an item cannot both be kept for correction and already exist. Summary via `buildBulkAddSummary()` ("1 item added · 1 stock item updated · 1 already in pantry · 1 line needs attention.") — toast when the modal closes, inline above the notes when it stays open. Shared Storage/Expiry survive a partial submit; `openBulkAddModal()` remains the only reset. See DECISIONS D-067 (and its TASK-054 two-digit-year addendum) and D-068.
- **Freshness alert banner** — Working · top-of-app on load; dismissable per session. Items marked `Keep` today are excluded from the expired count (`getFreshnessAlerts()`).
- **Clear expired** — Working · `#pantry-clear-expired` / `clearExpiredPantryItems()` · pantry-scoped bulk removal. `getExpiredPantryItems()` classifies through `pantryDaysLeft()`, so it agrees with the badges for bought-date items too (D-057 fixed an expiryDate-only scan that matched almost nothing). Explicit tombstones per id.
- **Expired cleanup from Home** — Working · `removeAttentionItem()` (one tap, one item) and `removeAllExpired()` (bulk, confirmed, pantry + cooked meals). Only `daysLeft < 0` records qualify; "use soon" and `Keep`-marked records are structurally excluded. See DECISIONS D-057.
- **Mark recipe cooked** — Working · `markRecipeCooked()` → deducts pantry + logs cook history. The same dialog optionally captures how many meal portions the batch made (pre-filled from the recipe's servings, follows the batch multiplier until the user overrides it).
- **Portion tracking on stored food** — Working · `cookedMeal.initialPortions` / `portionsRemaining` · optional. A tracked batch shows a portion badge and a one-tap **Used 1**; the last portion finishes the batch through the existing removal path. Untracked batches render exactly as before. See DECISIONS D-056.

## Shop (Grocery)
- **Auto grocery list** — Working · `renderGroceryList()` · aggregated from plan, scaled, grouped by category (A→Z, "Other" last), per-item cost, in-stock badges, check-off, recipe source labels.
- Add custom item, Clear All, Copy to clipboard, Prices→Price Book, weekly cost summary.
- **Grocery → Inventory on check** — Working · `toggleGroceryItem()` → `stockPurchasedGroceryItem()` · checking a row transfers it to inventory with **no further input**: category, storage, shelf life and purchase date are all inferred. Buying more of something you already have updates the existing record (`findMergeableStock()` → `canMergePurchaseInto()` → `applyPurchaseToStock()`) rather than creating a duplicate; a printed-expiry, already-expired, or different-unit record stays separate (D-069 — quantities are added, never converted). Buying a low staple sets `stockLevel: 'full'` and clears its auto shopping row. Unchecking undoes the transfer exactly, via the `stocked` receipt. Check-off now persists (it previously never called `saveData()`). See DECISIONS D-057.

### Low-effort discovery
- **Cooking-method quick filters** — Working · `renderRecipeQuickFilters()` / `setRecipeQuickFilter()` → `#recipe-quick-filters` · `All | Lowest effort | Rice cooker | Oven | Instant Pot | No-cook | Pan`, plus `Rice + steamer` and `Batch-friendly` refinements. One chip at a time, ANDed on top of the existing search/category/time/favourites filters; `All` or tapping the active chip clears it. **A PRIMARY cooking-method chip never hides, even at zero** — it renders muted (`.is-empty`) and its empty state names the editor field that fills it; only the refinements hide when empty. That is the D-060 fix: a chip that disappears when it matches nothing is a capability nobody can discover. Transient view state — not persisted, not synced. See DECISIONS D-060.
- **Cooking method is a presentation grouping** — Working · `Rice cooker` matches `rice-cooker` AND `rice-cooker-steamer`; `Instant Pot` matches `instant-pot` AND `pressure-cooker`. There is no `cookingMethod` field and no migration — the grouping sits over the existing `recipe.equipment[]` slugs, which stay individually filterable through the refinement chips. See DECISIONS D-060.
- **Lowest effort ranks by work, not clock** — Working · uses `recipeEffortScore() <= 2`, the same honesty gate the Home "Easiest" pick uses, so the chip and the recommendation can never disagree about what counts as easy. Results are ordered easiest-first by the existing D-059 ranking helpers with raw hands-on minutes as the tie-break, so a 60-minute mostly-unattended recipe outranks a 45-minute hands-on one. See DECISIONS D-060.
- **Low-effort starter recipes** — Working · 14 seeded recipes (ids 27–40): 4 rice cooker, 4 oven, 3 Instant Pot, 3 no-cook. Each is written FOR its appliance — the instructions say how it is cooked in that device — and a test greps each recipe's own instructions to prove the claim. The 26 original Filipino recipes are all `pan` and were never retagged to populate a chip. See DECISIONS D-061.
- **Opt-in starter pack** — Working · `renderStarterPackPrompt()` / `starterPackCandidates()` / `addStarterPackRecipes()` → `#starter-pack-prompt` · a compact, non-blocking Cook prompt for installs that predate the starter recipes. `ensureStarterRecipes()` stays first-run-only — re-seeding a live install is how you overwrite someone's data — so delivery is one explicit tap that adds ONLY genuinely absent recipes. Presence on an id is a permanent skip (the user may have edited it), and `AppState.deletions` is honoured so a deleted starter recipe is never resurrected. Repeated taps and reloads are no-ops; the prompt retires itself when nothing is eligible. Zero new persisted state. See DECISIONS D-063.
- **Recipe metadata strip** — Working · `renderRecipeMetaStrip()` · hands-on time, effort, equipment, tags, and a "Protein ✓ · Veg ✓ · Carb ✓" line. Renders nothing at all for a recipe with no metadata.
- **Metadata editor** — Working · `renderRecipeMetaFields()` / `readRecipeMetaFromForm()` · compact "How you cook it" block in the recipe modal; all fields optional.
- **Seed isolation** — Working · `cloneSeedRecipes()` · every seed entry point hands `AppState` its OWN recipe objects. `[...sampleRecipes]` copied the array only, so a seeded session rewrote the `sampleRecipes` constant through ordinary in-place edits (`toggleFavorite`, `updateServingSize`, `normalizeRecipes`) — and the starter pack, which reads that constant, then handed out contaminated copies. See DECISIONS D-064.
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
