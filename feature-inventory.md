# Meal Prep Planner — Feature Inventory
**Generated:** 2026-06-20  
**Codebase:** `app.js` (~7,700 lines), `index.html`, `style.css`  
**Stack:** Plain HTML/CSS/JS SPA, Firebase (Auth + Firestore), Chart.js, Lucide SVG icons  
**Live at:** https://shinyamadasan.github.io/Meal-Prep/

---

## User Features

### 1. Dashboard (Home Tab)
**Description:** Three-level prioritized home screen rendered dynamically on every visit.  
**User Value:** Tells you what to act on right now without digging through tabs.  
**Location:** `#dashboard`, `renderDashboard()` app.js:2578  
**Status:** Working  
**Priority:** Core

Sub-features:
- **Level 1 — Attention card:** Expiring pantry items (<=2 days) + low-staple alerts. Only shown when there's something to flag.
- **Level 2 — Action split:** Left pane = cook suggestions from pantry (3 tiers); right pane = buy suggestions (low staples + grocery count).
- **Level 3 — Planning strip:** 7-day dot row showing which days have meals planned, link buttons to Planner/Nutrition.
- Personalized greeting ("Good morning, [name]") using display name or email prefix.

---

### 2. Cook Tab (My Recipes)
**Description:** Full recipe management hub — browse, add, edit, delete, scale.  
**Location:** `#recipes`, `renderRecipes()` app.js:1989  
**Status:** Working  
**Priority:** Core

Sub-features:

#### 2a. Recipe Card Grid
- Photo or category-colored placeholder icon
- Serving size stepper (+/-1) and quick-serve buttons [1, 2, 4, 6, 8]
- Scaled prep/cook times displayed live
- Nutrition grid per serving (cal, protein, carbs, fat, fiber, sodium)
- Fridge/freezer shelf life badges
- Estimated total cost + cost per serving (if priced ingredients)
- Collapsible ingredients + instructions section
- Click card body to edit, explicit Edit/Delete buttons

#### 2b. Recipe Search & Filter
- Text search (name + instructions)
- Category filter (Breakfast, Main Dish, Snack, Dessert)
- Prep time filter (under 15/30/45/60 min, 60+ min)
- **Status:** Working

#### 2c. Add / Edit Recipe Form (Modal)
- Fields: name, category, prep time, cook time, servings, fridge life, freezer life, estimated cost, nutrition (cal/protein/carbs/fat), storage notes, photo, ingredients list, instructions
- Ingredient rows with autocomplete from INGREDIENT_DB (name, unit, category, price, store)
- USDA Nutrition DB search (local first, USDA API fallback)
- Photo upload with client-side compression (max 1000px, JPEG 0.7)
- **Status:** Working

#### 2d. Cook Suggestions Strip
- Shows recipes you can cook based on current pantry inventory
- Three tiers: "Can cook now" / "Missing 1" / "Missing 2"
- Clicking a card filters the recipe search to that recipe name
- **Status:** Working

#### 2e. Getting Started Card
- First-time onboarding checklist (2 steps: plan a meal -> view grocery list)
- Auto-dismisses when user generates grocery list or manually dismisses
- **Status:** Working

#### 2f. Paste Recipe Import
- Modal accepts free-form text copied from any recipe site
- Parses and pre-fills the recipe form fields via `parseAndImportRecipe()` app.js:5896
- **Status:** Partial — parsing is regex/heuristic; quality varies by source site

#### 2g. CSV Import
- Upload a CSV file -> preview modal -> confirm import
- Downloadable CSV template
- **Status:** Working

#### 2h. JSON Export / Import
- Export: full app data as `meal-prep-data-YYYY-MM-DD.json`
- Import: merges (union by ID) — never overwrites existing data
- **Status:** Working

---

### 3. Inventory Tab (My Fridge)
**Description:** Tracks everything in your kitchen — cooked meals and raw pantry ingredients.  
**Location:** `#fridge`, `renderPantry()` app.js:6082, `renderCookedMeals()` app.js:6472  
**Status:** Working  
**Priority:** Core

Sub-features:

#### 3a. Cooked Meals Section
- Cards for meals marked "Cooked" from the Cook/Plan tab
- Shows recipe name, cook date, storage location (fridge/freezer/counter), days remaining
- Inline date update, storage location toggle, remove button
- Expired meals highlighted

#### 3b. Pantry / Ingredients Section
- Collapsible card grid grouped by storage location (fridge / freezer / counter)
- Per-item: name, quantity, purchase date OR expiry date, shelf-life, days-remaining badge, staple level toggle
- Storage location inferred from INGREDIENT_DB -> PANTRY_KNOWLEDGE -> category fallback
- Staple flag cycling (none -> staple -> running low)
- In-line date edit, quantity edit, storage type override
- Storage tips modal (book icon) pulls from PANTRY_KNOWLEDGE data
- Pantry expandable/collapsible cards

#### 3c. Add to Pantry Row
- Text input with INGREDIENT_DB autocomplete
- Optional quantity input (#pantry-qty-input)
- Storage location selector (Auto / Fridge / Freezer / Counter)
- **Status:** Working

#### 3d. Freshness Alert Banner
- Shown at top of app on load when any pantry item is expiring/expired
- Lists up to 3 items by urgency; "View Inventory" CTA
- Dismissable per session
- **Status:** Working

#### 3e. Mark Recipe as Cooked
- Available from Cook tab cards and Planner slots
- Moves cooked batch to Inventory cooked-meals section with date/shelf life
- **Status:** Working

---

### 4. Shop Tab (Grocery List)
**Description:** Auto-generated shopping list from the weekly plan.  
**Location:** `#grocery`, `renderGroceryList()` app.js:2838  
**Status:** Working  
**Priority:** Core

Sub-features:
- Ingredients aggregated from all planned recipes, grouped by category (Protein, Vegetable, etc.)
- Scaled quantities match current serving sizes
- Per-item cost (calculated or market-reference price from INGREDIENT_DB)
- Category subtotals
- In-stock badge when ingredient is in pantry (items sorted: need-to-buy first)
- Checkboxes to mark items as bought
- Recipe source label ("From: Adobo (4 servings) x2")
- "Already in your kitchen" summary bar
- **Add Custom Item** modal — name, qty, unit, category
- **Clear All** button (confirmation required)
- **Copy** grocery list as plain text to clipboard
- **Prices** button navigates to Price Book tab
- Weekly cost summary card (total estimated spend from plan)

---

### 5. Plan Tab (Weekly Planner)
**Description:** 7-day meal planning grid with breakfast, lunch, dinner, and snacks slots per day.  
**Location:** `#planner`, `renderWeeklyPlanner()` app.js:2197  
**Status:** Working  
**Priority:** Core

Sub-features:
- Click any meal slot -> recipe selection modal (search + grid)
- Multi-day assignment: "Add to" day chips let you assign one recipe to multiple days at once
- Expiry warning on slots where the recipe would go bad before that day (fridge life check)
- Storage alerts panel for recipes that may not last
- Week stats bar: total prep time, total cook time, total meals planned
- **Mobile day navigator:** prev/next arrow switches visible day column

#### 5a. Save / Load Week Template
- Save current week as a template (localStorage)
- Load saved week fills only empty slots (never overwrites)
- **Status:** Working

#### 5b. Day Copy / Paste / Clear
- Copy a day's meals, paste into another day
- Clear individual day
- **Status:** Working

#### 5c. Clear Week
- Wipes all 7 days (confirmation required)
- **Status:** Working

#### 5d. Prep Mode (Cook Day Checklist)
- Modal showing all this week's recipes as checkable ingredient + step cards
- Progress bar tracking "N / M done"
- Usage count badge per recipe (e.g. "x3 this week")
- **Status:** Working
- **Location:** `openPrepMode()` app.js:5595

---

### 6. Nutrition Tab
**Description:** Weekly nutrition tracking against personal goals, with recipe filtering.  
**Location:** `#nutrition`  
**Status:** Working  
**Priority:** Important

Sub-features:

#### 6a. Nutrition Goals
- Set daily targets: calories, protein, carbs, fat, fiber, sodium
- Displayed as goal cards at top of tab
- **Status:** Working

#### 6b. Weekly Nutrition Chart
- Bar/line chart (Chart.js) showing daily totals vs goals for the planned week
- **Status:** Working (requires chart.min.js to be present)

#### 6c. Daily Breakdown
- Expandable per-day nutrition totals, meal-by-meal breakdown
- **Status:** Working

#### 6d. Recipe Filter by Nutrition
- Filter recipes by: High Protein (>25g), Low Carb (<15g), Low Calorie (<300 cal), High Fiber (>5g)
- Shows recipe cards with "Add to Plan" quick-plan picker
- **Status:** Working

#### 6e. USDA Nutrition DB Lookup (in Recipe Form)
- Search field in recipe add/edit modal
- Searches LOCAL_NUTRITION_DB first (90+ entries, offline)
- Falls back to USDA FoodData Central API (DEMO_KEY) if not found locally
- Click result to auto-fill nutrition fields
- **Status:** Working (USDA API may rate-limit DEMO_KEY)

---

### 7. Price Book Tab (Ingredient Catalog)
**Description:** Browse and manage ingredient prices per store.  
**Location:** `#ingredients`, `renderIngredientsTab()` app.js:6744  
**Status:** Working  
**Priority:** Important

Sub-features:
- 130+ ingredients in INGREDIENT_DB with name, unit, category, price, and store
- Each entry shows: storage location, shelf life, price, store, category icon
- Per-store price customization (user can add stores, override prices)
- "My Stores" quick-filter to see only stores you shop at
- Add custom ingredient with full nutrition data (user-created entries)
- "Add to Pantry" button on each catalog card
- Search and category filter
- Custom stores management (add/remove)

---

### 8. Cooking Hacks Tab
**Description:** Curated tips for batch cooking, storage, budgeting, etc.  
**Location:** `#hacks`, `renderCookingHacks()` app.js:3092  
**Status:** Working  
**Priority:** Nice to Have

Sub-features:
- 6 built-in Filipino-context hacks (batch rice, egg prep, bone-in cuts, seasonal veg, 2-hour rule, one-pan method)
- User can add/edit/delete custom hacks
- Fields: title, category, description, time saved, cost savings
- Category filter (Batch Cooking, Storage, Budget, Equipment, Time-Saving, Safety)

---

### 9. Settings Modal
**Description:** Accessed via More > Settings.  
**Location:** `openSettingsModal()` app.js:4243  
**Status:** Working  
**Priority:** Core

Sub-features:
- Display name edit (saved to localStorage)
- Account section: signed-in email display + Sign Out, or Sign In / Create Account links
- How-to guide (opens help modal)
- Export Data (JSON)
- Import Data (JSON, merges)
- Import CSV
- Restore Backup
- Clear All Data (destructive, requires confirmation, auto-snapshots first)

---

### 10. Help / How-to Modal
**Description:** 6-step illustrated guide walking through the core loop.  
**Location:** `#help-modal`  
**Status:** Working  
**Priority:** Important

---

## Admin Features

None. This is a single-user application. The Firebase project has no admin console or back-office UI.

---

## Automation Features

### A1. Auto-generate Grocery List
**Trigger:** Adding/changing a recipe in the weekly planner.  
**Logic:** Aggregates ingredients from all planned meals, scales by serving size, merges duplicates, preserves manually-added custom items.  
**Status:** Working

### A2. Real-time Cloud Sync (Firestore onSnapshot)
**Trigger:** Any change to the Firestore user document from another device/tab.  
**Logic:** Compares `version` field; if cloud version > local version, applies remote data and re-renders all views.  
**Status:** Working (app.js:4726)

### A3. Auto-save on Every State Change
**Trigger:** Any call to `saveData()`.  
**Logic:** Simultaneously writes to localStorage + Firestore (if signed in and online). Offline: localStorage only, queues sync on reconnect.  
**Status:** Working

### A4. Freshness Expiry Check on Load
**Trigger:** App initialization.  
**Logic:** Scans pantry items and cooked meals for items expiring within 2 days. Shows banner if any found.  
**Status:** Working

### A5. Online / Offline Detection
**Trigger:** Browser `online` / `offline` events.  
**Logic:** Shows sync status indicator in header. On reconnect, triggers Firestore save.  
**Status:** Working (app.js:5252)

### A6. Backup Snapshot Before Destructive Actions
**Trigger:** "Clear All Data" or "Import Data."  
**Logic:** Snapshots full AppState to `mealPrepBackup` localStorage key before wiping or replacing.  
**Status:** Working

### A7. Nutrition Patch on Data Load
**Trigger:** Loading data from localStorage or Firestore.  
**Logic:** `patchMissingNutrition()` fills in `nutritionPerServing` from `sampleRecipes` for any recipe with `calories === 0` (backward compatibility).  
**Status:** Working

### A8. Photo Migration (Legacy -> Subcollection)
**Trigger:** Load from Firestore when legacy inline photos detected.  
**Logic:** Moves inline photos from the main user doc to `users/{uid}/photos/{recipeId}` subcollection to stay under Firestore's 1 MiB doc limit.  
**Status:** Working (app.js:4578)

### A9. Service Worker (PWA Offline Shell)
**Trigger:** App load.  
**Logic:** Registers `sw.js` for offline caching of the app shell.  
**Status:** Partial — `sw.js` registered in HTML but file contents unknown; effectiveness depends on its implementation.

### A10. Pull-to-Refresh (Mobile)
**Trigger:** Pull down from top of page on mobile.  
**Logic:** Detects 100px downward touch swipe at scroll-top -> calls `location.reload()`.  
**Status:** Working (blunt — full page reload, not a smart data refresh)

---

## Authentication & Security

### Sign In (Email/Password)
- Firebase Auth `signInWithEmailAndPassword`
- On success: loads Firestore data, renders all views
- **Status:** Working

### Sign Up (Email/Password)
- Firebase Auth `createUserWithEmailAndPassword`
- Sends email verification on account creation
- Initializes Firestore user document with current local data
- **Status:** Working

### Email Verification
- Required to enable recipe sharing (not to use the app)
- Banner shown for unverified users with "Resend email" and "I've verified" buttons
- **Status:** Working

### Sign Out
- Clears `AppState.currentUser`, loads back from localStorage
- **Status:** Working

### Password Reset
- **No "Forgot password" flow anywhere in the app**
- Users who forget their password cannot recover their account
- **Status:** MISSING

### Session Handling
- Firebase Auth persists session via indexedDB (SDK default)
- `onAuthStateChanged` re-loads Firestore data on session restore
- **Status:** Working

### Permissions / Roles
- No role system — single user per account
- Sharing is open to any signed-in user with verified email
- **Status:** Working (no multi-role needed)

### Firebase App Check
- reCAPTCHA v3 registered and configured (site key in index.html)
- Protects Firestore and Auth endpoints from quota drain
- **Status:** Working (configured)

### Sentry Error Monitoring
- Conditionally loaded from CDN when `window.SENTRY_DSN` is set
- Currently empty string — monitoring is inactive
- **Status:** Partial (code ready, DSN not set)

### XSS Defense
- All user-facing strings pass through `escapeHtml()` before innerHTML
- Shared recipes from community feed pass through `stripTagsDeep()` before storage
- **Status:** Working

### Optimistic Concurrency (Firestore)
- `saveToFirestore()` uses a Firestore transaction to detect concurrent edits from other devices
- On conflict: merges both changesets (union by ID), no data lost
- **Status:** Working (app.js:4503)

---

## Data & Storage

### localStorage (Primary Offline Store)
- Key: `mealPrepAppData`
- Stores: recipes (with inline photos for legacy), weeklyPlan, groceryList, nutritionGoals, pantry, cookedMeals, customIngredients, customHacks, userIngredients, ingredientPrices, myStores, customStores, recentRecipes, version
- Backup key: `mealPrepBackup`
- Theme preference key: `colorScheme`
- Display name key: `mealPrepDisplayName`
- First-run flags: `pantryOnboardingDone`, `mealPrepStartDone`

### Firebase Firestore (Cloud Sync)
- Collection: `users/{uid}` — main user data doc (no inline photos)
- Subcollection: `users/{uid}/photos/{recipeId}` — one doc per recipe photo (data URL)
- Collection: `sharedRecipes` — public community recipe feed
- Collection: `familyInvitations` — invitation records (status: pending/accepted)
- Optimistic concurrency via `version` field on user doc
- Real-time listener (`onSnapshot`) syncs across devices/tabs

### Photo Storage
- Photos uploaded -> compressed (max 1000px JPEG 0.7) -> stored in Firestore subcollection
- In-memory cache (`recipePhotoCache`) attached to `AppState.recipes` at render time
- Legacy inline photos (in main doc) auto-migrated to subcollection on first load

### Hardcoded Databases in app.js

| DB | Size | Purpose |
|---|---|---|
| `INGREDIENT_DB` | 130+ entries | Autocomplete, pricing, storage inference |
| `LOCAL_NUTRITION_DB` | 90+ entries | Offline nutrition lookup per 100g |
| `PANTRY_KNOWLEDGE` | 22 entries | Storage tips prose |
| `sampleRecipes` | 15 Filipino recipes | Seeded on first load for new users |
| `defaultCookingHacks` | 6 tips | Seeded on first load |
| `defaultStorageData` | ~40 entries | Storage Guide (legacy, never seeded) |

### Data Versioning
- `AppState.dataVersion` tracks the Firestore document version
- Incremented on every save; used to detect concurrent edits
- Not a schema migration system — no version-gated migrations

---

## Analytics & Reporting

### Weekly Nutrition Chart
- Chart.js bar chart: daily calorie/macro totals vs goals for the planned week
- **Status:** Working

### Daily Nutrition Breakdown
- Meal-by-meal macro summary for each day of the planned week
- **Status:** Working

### Week Summary Stats (Planner Footer)
- Total prep time, total cook time, total meals planned across the week
- **Status:** Working

### Weekly Cost Summary (Grocery Tab)
- Total estimated grocery spend calculated from ingredient prices x quantities
- Per-category subtotals
- **Status:** Working (accuracy depends on prices being set in ingredient catalog)

### No External Analytics
- No Google Analytics, Mixpanel, PostHog, or similar tools integrated
- No usage tracking of any kind

---

## Hidden Features

### Storage Guide Tab (#storage)
- Full ingredient storage card UI exists in HTML with full render logic (`renderStorageGuide()`)
- **No navigation button** points to it — completely unreachable from the UI
- Was an early concept, superseded by the Inventory tab
- `defaultStorageData` array (40 entries) is never seeded into `AppState.customIngredients`
- **Status:** Dead UI

### Dark Mode Manual Toggle
- Dark mode works and persists via CSS `[data-color-scheme="dark"]`
- The toggle button (`#theme-toggle`) is referenced in JS (`updateThemeToggleIcon()` app.js:5482) but **does not exist in index.html**
- Dark mode IS auto-applied from system preference on load; manual toggle is inaccessible
- **Status:** Broken (function exists, button missing)

### Family Sharing Modal
- Modal (`#family-sharing-modal`) exists and sends email invitations to Firestore
- No nav entry point — buttons were removed in the header redesign
- Callable only via `openFamilySharingModal()` in the browser console
- **Status:** Orphaned / Hidden

### Community Feed (Shared Recipes)
- Modal (`#shared-recipes-modal`) connects to Firestore `sharedRecipes` collection
- No nav entry point — buttons were removed in the header redesign
- Requires verified email to share; all signed-in users can browse
- **Status:** Orphaned / Hidden

### Username / Display Name Modal
- Modal (`#username-modal`) prompts for a display name before community posting
- Only surfaces when attempting to share via the hidden community modal
- **Status:** Working but unreachable

### Quick Plan Picker (Nutrition Tab)
- "Add to Plan" from nutrition recipe filter opens a floating day/meal picker
- Not documented in help text; easy to miss
- **Status:** Working

### Day Copy/Paste (Planner)
- Copy a day's meals, paste into another day
- No visual callout; easily missed on first use
- **Status:** Working

### `exportAllData()` (Second Export Function)
- Separate from `exportData()` — adds `user.email` and `user.uid` metadata
- Triggered only from the hidden Family Sharing modal
- **Status:** Working but unreachable

### Recipe Highlights Tags
- `recipe.highlights[]` array is rendered on recipe cards as tag chips (app.js:2122)
- No edit-form input to set this field — only reachable via JSON import
- **Status:** Working but no UI to set

---

## Incomplete Features

### Paste Recipe Parser
- Accepts any text copied from a recipe website
- Parsing is regex-based heuristic — works well for structured sites, fails on messy copy-paste
- No confidence score shown; no user feedback on whether parse succeeded
- **Status:** Partial

### Dark Mode Manual Toggle
- Toggle function exists but the button is absent from index.html
- Users can set dark mode via system preference only
- **Status:** Broken

### Password Reset
- No `sendPasswordResetEmail()` call anywhere in the codebase
- **Status:** Missing

### Family Sharing Acceptance Flow
- Sending an invitation writes to Firestore — works
- No UI for the recipient to view or accept their invitation — `status` stays "pending" forever
- **Status:** Broken (send works; accept missing)

### Pantry Not Auto-Deducted on Cook
- `markRecipeCooked()` adds the batch to the cooked-meals section
- It does NOT remove used ingredients from the pantry
- User must manually remove pantry items after cooking
- **Status:** Missing logic

### Service Worker
- `sw.js` is registered in index.html
- File not confirmed to exist in the repository; if absent, registration silently fails
- **Status:** Untested

### USDA API Rate Limit
- `searchNutritionDB()` uses `DEMO_KEY` for USDA FoodData Central
- DEMO_KEY is rate-limited (1,000 requests/hour per IP, 1 req/sec)
- No retry logic, no user-visible rate-limit message
- **Status:** Partial

### Snack Serving Scaling
- Snacks in the weekly plan use the recipe's global `currentServings`
- No per-day, per-slot serving override for snacks
- **Status:** Partial

---

## Dead Code & Unused Features

| Item | Location | Notes |
|---|---|---|
| `defaultStorageData` array (40 entries) | app.js:532 | Never seeded into AppState; customIngredients always starts empty |
| `#storage` tab | index.html:344 | No nav button; full HTML + JS + CSS present but unreachable |
| `#theme-toggle` button | Referenced app.js:5482 | Does not exist in index.html |
| `exportAllData()` | app.js:5107 | Reachable only from hidden Family Sharing modal; near-duplicate of exportData() |
| `recipe.highlights` field | Rendered app.js:2122 | No edit-form input to set it |
| `#shared-recipes-btn` / `#family-sharing-btn` | Referenced in updateAuthUI() app.js:4364 | Elements removed from HTML; code silently no-ops |
| `printGroceryList()` | Exported app.js:4058 | No print button in current UI |
| `#add-ingredient-storage` / `#import-from-recipes` | index.html:349-350 | Inside the unreachable #storage tab |
| `updateGrocerySummary()` | app.js:2976 | References `#selected-meals-count` which does not exist in index.html |
| `Mung Beans` in Ginisang Monggo | sampleRecipes id:8 | Not in INGREDIENT_DB — cook engine pantry match will fail for this ingredient |

---

## User Journey Mapping

### New User (First Load)
1. App loads -> `seedPantryIfEmpty()` fires
2. Kitchen Setup Wizard appears (3-type preset modal)
3. Step 2: review/uncheck items -> "Add to my pantry"
4. Pantry pre-filled with chosen items
5. 15 Filipino sample recipes seeded into Cook tab
6. Getting Started card shown on Cook tab ("plan a meal -> grocery list")
7. User navigates to Plan tab -> assigns recipes to days
8. Grocery list auto-builds
9. Getting Started card dismissed permanently

### Signed-Out Returning User
1. App loads -> localStorage data applied
2. Freshness banner shown if anything is expiring
3. Dashboard shows expiring items, what to cook from pantry, weekly plan status
4. All features work locally; sync badge hidden

### Signed-In Returning User
1. App loads -> `onAuthStateChanged` fires -> `loadUserData()` loads from Firestore
2. Real-time listener active — changes from other devices appear immediately
3. Every save writes to both localStorage and Firestore
4. Sync status badge: Saving -> Synced

### Weekly Meal Prep Loop
1. **Cook tab:** Find a recipe (or browse cook suggestions)
2. **Plan tab:** Assign to days via recipe selection modal
3. **Shop tab:** Grocery list auto-built; check off items while shopping
4. **Cook tab / Plan tab:** Mark recipe as "Cooked"
5. **Inventory tab:** Cooked batch appears with expiry countdown
6. **Dashboard:** Expiry alerts appear as batch approaches end of life

### Edge Case: Data Conflict (Two Devices)
1. Device A and Device B both make changes offline
2. Device A saves -> Firestore at version N+1
3. Device B saves -> transaction detects version mismatch -> merges changesets -> saves at N+2
4. Neither device's changes are lost

---

## Feature Gaps

### Critical Gaps
1. **Password reset** — No "Forgot password." Users permanently locked out.
2. **Manual dark mode toggle** — Button missing from UI.
3. **Pantry not deducted on cook** — Core loop broken; users must manually track ingredient usage.

### Significant Gaps
4. **Family sharing acceptance** — Invitations sent but recipients cannot accept.
5. **Community/shared recipes inaccessible** — Built but no nav entry.
6. **Grocery list stale after serving-size change** — Changing servings doesn't auto-refresh the list.
7. **Mung Beans missing from INGREDIENT_DB** — Ginisang Monggo pantry matching broken.
8. **Paste recipe reliability** — Heuristic parser fails often with no feedback.
9. **USDA DEMO_KEY rate limits** — Production users may hit 1,000/hour cap.

### Nice-to-Have Gaps
10. No recipe notes, tags, or favorites
11. No nutritional label per planner slot (only weekly totals)
12. No batch-cook ingredient aggregation in Prep Mode
13. No meal time scheduling (only slot names: breakfast/lunch/dinner)
14. No history of past weeks or cooking streaks
15. Photos not visible in community shared recipe cards
16. LOCAL_NUTRITION_DB missing many common Filipino ingredients
17. No text search in the Ingredient Catalog

---

## Executive Summary

### Total Features
- **8 primary tabs** (Home, Inventory, Shop, Plan, Cook, Nutrition, Price Book, Cooking Hacks)
- **3 dead/hidden features** (Community Feed, Family Sharing, Storage Guide)
- **~50 distinct user-facing sub-features**

### Core Product Capabilities
1. Recipe management with nutrition, cost, photos, and serving scaling
2. 7-day weekly meal planning (breakfast / lunch / dinner / snacks)
3. Auto-generated, categorized, priced grocery list from the plan
4. Inventory and freshness tracking for pantry and cooked meals
5. Nutrition tracking — weekly chart and daily breakdown vs personal goals
6. Real-time Firebase cloud sync across devices
7. Filipino-first content: 15 sample recipes, Philippine market pricing, local ingredient names

### Biggest Strengths
- **Offline-first** — Works fully without an account or internet connection
- **Filipino-localized** — Prices in pesos, wet market store references, Filipino recipe and ingredient names
- **Cook engine intelligence** — Matches pantry to recipes in 3 tiers; actionable from the Dashboard
- **Clean, fast SPA** — No build step, no framework overhead; instant tab switching
- **Conflict-safe cloud sync** — Optimistic concurrency prevents data loss on multi-device use
- **Kitchen Setup Wizard** — New user has a pre-filled pantry and 15 sample recipes in under 60 seconds, no account required

### Biggest Weaknesses
- **Missing password reset** — Major security/UX gap; users can be permanently locked out
- **Dark mode toggle missing** — Working JS, missing button in HTML
- **Dead features in the bundle** — Community feed, family sharing, storage guide add dead weight with no user benefit
- **Pantry not auto-deducted on cook** — The core loop breaks at the "cook -> inventory" step
- **Paste recipe parser is fragile** — A core import path that produces unreliable results

### What Makes This Product Unique
- **Kitchen OS philosophy** — Treats the full pantry lifecycle (buy -> cook -> store -> use -> restock) as one system, not just a recipe box
- **"What can I cook right now?" engine** — 3-tier cook suggestion from pantry inventory is a meaningful differentiator vs most recipe apps
- **Filipino-first from the database up** — INGREDIENT_DB, pricing, sample recipes, and storage tips are localized to Philippine wet market context, not generic western assumptions
- **Zero-friction start** — Kitchen Setup Wizard + 15 sample recipes = working plan within 60 seconds, no account required
