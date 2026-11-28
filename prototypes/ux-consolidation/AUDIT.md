# UX Consolidation — Mobile Audit, IA Proposal, Prototype

> Research and prototype only. Nothing here changes `app.js`, `index.html` or `style.css`.
> The production redesign needs owner approval, and the application feature scope is currently
> frozen (D-090), so any build would be a new, owner-approved proposal.

- **Prototype:** [`index.html`](index.html). One self-contained file with no network requests, generic
  in-memory sample data (reset on reload), light and dark mode.
- **Evidence:** screenshots in [`audit/`](audit/) (390×844 PNG), raw current-app measurements in
  [`audit-metrics.json`](audit-metrics.json), and the prototype self-test ([`selftest.js`](selftest.js))
  with its results in [`selftest-results.json`](selftest-results.json) (see §8).
- **Method:** `origin/main` @ `4ccc930`, served over local http and walked by a Playwright script
  (Chromium, 390×844, mobile and touch, service workers blocked, all off-origin requests aborted,
  so no sign-in). First run went through the app's own Kitchen Setup wizard ("Average household").
  The script then seeded generic data through app functions (`addPlannedBatch`, `toggleFavorite`,
  `addStarterFlavors`, `savePreparedFlavor`, `generateGroceryList`, `saveData`): 40 shipped sample
  recipes, 25 pantry items (one expired), 3 ready meals, 3 planned batches, 2 prepared sauces and a
  17-row list. "Screens" below means multiples of the 844px viewport height.

---

## 1. Top 10 findings

| # | Finding | Evidence |
|---|---|---|
| 1 | **Recipe cards are about 1.2 screens tall each.** A card is 1039px with 13 buttons and 49 text nodes. It shows two separate servings steppers, a 1/2/4/6/8 preset row, six nutrition tiles and the full ingredient list. With 40 recipes the Recipes tab is **54 screens** long and has 586 interactive elements. | `13-recipe-card.png`, `08b-tab-recipes-scrolled.png` |
| 2 | **No "I cooked this" outside a plan.** `markRecipeCooked()` is only reachable from By-day planner slots and the Prep tab. Tapping a recipe card opens the **edit** form (`handleRecipeCardClick` → `openEditRecipeModal`), not a view. "Cook something quick and log it" currently means planning it first. | `app.js` `handleRecipeCardClick`, `m-recipe-edit.png` |
| 3 | **Recipes and the Flavor Library are hidden on phones.** At 390px the primary nav shows Home · Plan · Shop · Prep · Fridge · More. Recipes is moved into More, alongside Nutrition, Price Book, Flavor Library, Cooking Hacks and Settings. That makes 11 destinations, and the cooking content sits two taps deep. | `14-more-menu.png`, metrics `navLabels` |
| 4 | **Plan and Prep are thin, overlapping tabs.** Plan is one screen (three batch rows plus a collapsed By-day grid) and Prep is one screen (the same three rows plus two buttons). Both list the same batches. Together with Shop and Fridge they make one meal-prep flow spread over four tabs, and Home's "This week's meal prep" card repeats it a fifth time. | `04-tab-planner.png`, `06-tab-prep.png`, `03-tab-dashboard.png` |
| 5 | **Fridge is 4.1 screens, with ingredient search 2.1 screens down.** The order is intro paragraph → "Inventory checked" → Stock health → Cooked & Stored → Prepared Flavors → Ingredients on hand. The add row (input plus Add, Browse, Bulk add, Select, then Qty, Unit, Printed date, date type) sits *above* the search box. | `07-tab-fridge.png`, `07b-…`, `20-fridge-pantry-list.png`; `outOfX.pantrySearchScreen = 2.11` |
| 6 | **Admin detail shows on everyday cards.** Every ready-food card shows a date picker, a fridge/freezer toggle and a protein `<select>` inline, plus "Set protein to see flavor ideas". Fridge opens with "Inventory not yet verified" and Stock health. Recipes opens with Import · Export (whole-app JSON backup) beside "Import Recipe". | `07-tab-fridge.png`, `08-tab-recipes.png` |
| 7 | **Shop lists what you already have before what you need.** In stock, 13 of 17 rows are pre-ticked and struck through, and they come first within each category. The same ingredient appears twice ("2 cups cooked White Rice" and "300 g White Rice", each flagged "also on your list"). The first row you need to buy is about half a screen down, and the list is 2 screens long for 4 purchases. | `05-tab-grocery.png`, `05b-…` |
| 8 | **"We're out of X" has no direct path.** It takes Fridge → scroll about 2 screens → search → open the item → change the staple level or delete → then Shop → Add Item → type. Roughly 7 taps across 2 tabs, with nothing linking "out" to "buy". | `20-fridge-pantry-list.png`, `05-tab-grocery.png` |
| 9 | **Prepared sauces live in two places and prepped ingredients in none.** Prepared Flavors render in both the Flavor Library (under More) and Fridge. Prepped ingredients (cooked rice, frozen minced garlic) have no UI; they are only planned as bridge-side lots (PROP-041 Phase 2, D-092). | `11-tab-flavors.png`, `07b-…`; `planning/PROP-041-PLAN.md` |
| 10 | **Header actions clip, and the alert banner adds a second persistent bar.** On Recipes the `Add New Recipe` button is cut off at the right edge, because the header row overflows inside its container even though the page does not scroll sideways. The freshness banner ("1 expiring soon · View") sits above every tab and duplicates Home's attention card and the Fridge badge. | `08-tab-recipes.png`, every `0x-tab-*.png` |

Other observations:

- The first run opens the Kitchen Setup sheet over a dashboard that says "Nothing yet / Empty" four times (`01-first-run.png`). That is fine, but the dashboard behind it teaches nothing.
- Price Book is 44 screens with 826 interactive elements (`10-tab-ingredients.png`), and it overlaps Shop's own "Price List" sub-tab.
- Nutrition is 10 screens, mostly a second copy of the recipe list (`09-tab-nutrition.png`).
- Cooking Hacks is 4.4 screens of static tips (`12-tab-hacks.png`).
- The recipe details modal is 4 screens, and the edit form is 4.3 screens with 56 fields (`m-recipe-details.png`, `m-recipe-edit.png`).
- The Batch Picker has 121 buttons and the Ingredient Browser has 213 (`m-batch-picker.png`, `m-ingredient-browser.png`).
- Positives worth keeping: "Ready to eat" already sits high on Home (first **Use 1** at 0.59 screens), "No plan? Fill the gaps" works, and there is no horizontal page scroll at 360px on any tab.

## 2. Everyday jobs: current app vs prototype

Taps exclude typing. "Before" is measured or traced on `origin/main`. "After" is the prototype
self-test (Playwright clicks by visible label, as a first-time user). All 19 scripted jobs (the 8 below,
plus Flavor authoring, Favorites, method chips and filters, undo isolation, the serving scaler, Cook
history, Remove expired, "Not anymore?", Keep, D-086 matching and the new homes) pass at 390×844 and
360×780, in light and dark. Each run had 0 console errors, 0 network requests and no horizontal scroll.
Full numbers are in §8; the data-semantics fixes from the second review are in §9.

| Job | Current app (before) | Prototype (after) |
|---|---|---|
| What can I eat now | Home → **Use 1** (1 tap; first button 0.59 screens down, under the meal-prep flow card and banner) | Home → **Eat 1** (**1 tap**; first card, about 0.25 screens) |
| Cook something quick | More → Recipes → scroll about 1 screen → Lowest effort → scroll 1.2-screen cards → no cook action. Logging it needs Plan → + Add meals → pick → close → Prep → Prepped → Fridge → confirm (**about 10 taps, 3+ screens**) | Cook (opens on Quick cook, can-make-now first) → recipe → **I cooked this** → Save (**4 taps, no scroll**). The sheet shows what it will take out of the kitchen, `markRecipeCooked()`-style: "Canned tuna: use 1 can · 1 can left". Staples are never deducted, and an untracked amount is never removed unless you tick it (§9) |
| Plan a meal-prep batch | Plan → + Add meals → pick → close (4), then Prep tab → **Prepped → Fridge** per batch (+2 each, 3 tabs total) | Home's **Meal prep** card → + Add → pick → Done (**4**; 5 if you start from the Cook tab). The picker lists every recipe, with optional search, a **Low effort only** chip and **View** on each row (D-078). Then Start prep day → **Done: N portions to Kitchen** (+2). All on one screen, with a 1-2-3-4 progress strip, a live "N of M steps done" count and a "N to buy → Open Shop" link |
| I just shopped | Shop → scroll past struck-through in-stock rows → tick each (1 + n). Unlisted purchases: Fridge → scroll 1.9 screens → Bulk add → type → Add (4) | Shop → tick each (**1 + n**; only items to buy are shown, with amounts and Price book costs). Unlisted: **Bought something else?**, which sits right under the add box at the top of Shop → type → Add to Kitchen (**3**). A tick can be undone from the toast, or later from the collapsed **Bought today** section, which reverses exactly what the tick did (D-057 receipt) |
| We're out of X | Fridge → scroll → search → open → level/delete → Shop → Add Item → type → save (**about 7**, 2 tabs) | Kitchen (or Home) → **We're out of…** → type → tap item (**3**). Results rank whole-word matches first, then starts-with, then contains, so "egg" lists **Eggs** before Eggplant. It is marked out and added to Shop in one step (checkbox on by default), with Undo |
| Make a sauce / prepped ingredient | More → Flavor Library → scroll → I made this → save (**4**). Prepped ingredients are **not possible** | Cook → Sauces & prep → **Made it** → Save to Kitchen (**4**). The same path works for prep-aheads (cooked rice, minced garlic, boiled eggs), which a **Prep-aheads ↓** link at the top of the screen jumps to. "Use by" is optional and typed by you; with no date, no "days left" chip is shown (D-074) |
| Find a flavor | More → Flavor Library → search/filter (**3**) | Cook → type in the one search box, which searches recipes, sauces and ingredients (**1 + typing**), or tap a sauce chip on a ready-food row or recipe ("Goes well with") |
| Shop without a plan | Shop → open "No plan? Fill the gaps" → tap a chip (**3**) | Shop → tap a chip (**2**; quick picks open automatically while the list is short, and no item appears in two roles). "Running low: Vinegar, Oats → Add" is a one-tap restock |
| Add / edit / delete a flavor | More → Flavor Library → Add flavor → fill → Save (**4**) | Cook → Sauces & prep → **+ Add your own flavor** → fill → Save flavor (**4**). Edit and Delete sit in each flavor's sheet. Delete asks first, then gives Undo |
| Show my favorites | Home → scroll to ❤️ My Favorites (about 1 screen), or Recipes → ♥ Favorites checkbox | Cook → **♥ Favorites** (**2**). The chip shows a live count and combines with the method chips and Filters. A hearted recipe is never silently missing: in Quick cook the list says "1 more favorite over 30 min: Chicken Adobo" with **Show all 4 favorites** |
| Find rice-cooker / oven / low-effort recipes | More → Recipes → scroll to the quick-filter row → tap (**3**) | Cook → Quick cook or All recipes → tap the method chip (**2**). The chips are always visible (D-060; see §3). Switching mode resets the chip to All, so a chip picked in one mode never silently narrows another |

## 3. Information architecture

### Current → proposed map

| Current tab / section | Goes to |
|---|---|
| Home: greeting, Ready to eat | **Home** · Ready to eat (first card) |
| Home: meal-prep flow card (Plan/Shop/Prep/Fridge) | **Home** · "Meal prep" mode card with a one-line status. The full flow lives in **Cook › Meal prep** |
| Home: What needs attention? | **Home** · "Use soon" (2 items). Expired rows offer **Keep** or **Remove** (FEATURES, D-057); use-soon rows offer *Cook*. **Kitchen › Review** lists them all; use-soon rows there have **Still good**. Keep and Still good are the same-day `keptOn` acknowledgement (D-088): the item is hidden from alerts until tomorrow and its date is never rewritten. Kitchen keeps showing "Expired · Kept today" on the item itself |
| Home: Record leftovers/takeout | **Home** quick action, plus **Kitchen** › Ready |
| Home: My Favorites (`#home-favorites`) | Hearts on every recipe row, plus a **♥ Favorites** chip in **Cook** (Quick cook and All recipes). It shows only hearted recipes, with a count, and is ANDed with the method chip and Filters. Recipes' `#favorites-filter` checkbox maps to the same chip |
| Home: Need ideas? (What should we eat / cook / can I do) | **Home** · "Or make something" (Instant / Quick / Meal prep, plus "You can make right now") |
| Need ideas: **Something different** (`getCookSuggestions()` / D-055, D-059) | **Home** · "Or make something" › **Something different**: one recipe not in your recent cook history, can-make-now first. Shown only when there is a cook history to differ from, same rule as today |
| Home: Cook History (`#dash-history`) | **Settings › Cook history**, a working list of the last 10 cooks (tap one to open the recipe). Each recipe sheet also shows "Last cooked N days ago". *I cooked this* and prep-day *Done* both add to it, and Undo removes the entry |
| Home: Getting Started card (2-step onboarding) | **Home**, first run only, above Ready to eat. Unchanged: two steps (set up kitchen, then add a recipe or batch) and auto-dismiss. The prototype's sample kitchen is past first run, so the card is not drawn |
| Plan: This week's batches, Batch Picker (`openBatchPickerModal()`, D-078) | **Cook › Meal prep**. The **+ Add** picker keeps D-078: every recipe with no query, keep-well first, an optional search box (name or ingredient), an optional **Low effort only** chip (off by default) and **View** on each row, which opens the recipe sheet with a "‹ Back to the list" button |
| Plan: By day grid, Save/Load week, Clear week | **Cook › Meal prep › More planning tools** (collapsed, kept intact) |
| Prep: Prepped → Fridge, Prep checklist | **Cook › Meal prep › Start prep day** (one checklist, done per batch) |
| Prep: Copy AI Prep Brief | **Cook › Meal prep › More planning tools** |
| Fridge: Cooked & Stored | **Kitchen › Ready** |
| Fridge: Prepared Flavors | **Kitchen › Prepped** (sauces + prepped ingredients, single home) |
| Fridge: Ingredients on hand, add row, Bulk add, Browse | **Kitchen › Ingredients** + "+ Add" sheet (one textarea, optional qty/date) |
| Fridge: Inventory checked, Stock health, Select | **Kitchen ⋯** menu (and Settings › Stock health) |
| Fridge: bulk **Remove expired (N)** | **Kitchen ⋯ › Remove expired (N)**, working. It lists what will go, removes all expired ingredients, ready food and prepped items in one step, and the toast's Undo restores exactly those items |
| Fridge: Bulk add + voice (`startVoiceInput()`) | **Kitchen › + Add** and **Shop › Bought something else?** use the same one-item-per-line box, with a **Say it instead** button that fills it (stub for the existing Web Speech path, Chrome/Edge only) |
| Fridge: freshness banner / badge | **Kitchen** tab badge + one "N to check · N use soon → Review" bar inside Kitchen. No global banner |
| Recipes: list, search | **Cook** (Instant / Quick cook / All recipes + global search) |
| Recipes: cooking-method quick filters (`#recipe-quick-filters`, D-060) | **Cook › Quick cook** and **Cook › All recipes**: an always-visible, wrapping **Cooking method** chip row: All · Lowest effort · Rice cooker · Oven · Air Fryer · Instant Pot · No-cook · Pan, plus the Batch-friendly refinement. D-060 is kept as is. A primary method chip **never hides**: at zero it renders dashed with its count (for example "Rice cooker 0" in Quick cook), and tapping it shows "No rice cooker recipes under 30 min yet — open a recipe, tick Rice cooker under Cooking method, and it will show up here". Only refinements (Batch-friendly, Rice + steamer) hide when empty. One chip at a time; tapping the active chip clears it |
| Recipes: category, prep-time and favorites filters (`#category-filter`, `#preptime-filter`, `#favorites-filter`) | **Cook › Filters** sheet (Category: Breakfast / Main dish / Snack / Dessert; Prep time: under 15 / 30 / 45 min, under 1 hour, 1 hour+, the same buckets as today), with live counts and a "Show N recipes" button. Active filters show as removable chips next to Filters. Favorites is the ♥ chip, not part of the sheet |
| Nutrition: Find Recipes by Nutrition (`#nutrition-filter-type`) | The same **Cook › Filters** sheet, Nutrition group: High protein (>25 g), Low carb (<15 g), Low calorie (<300), High fiber (>5 g). It is ANDed with the other filters instead of being a separate list on another tab |
| Recipes: serving scaler (`adjustDetailServings()` / `buildDetailIngList()`) | **Recipe sheet › Ingredients**: a Servings stepper that rescales amounts in place (1 kg → 1¼ kg; "to taste" left alone) with an "As written / Scaled from N" note. *I cooked this* pre-fills leftovers from the scaled servings |
| Recipes: Sample badge (`isSampleRecipe()`) | A **Sample** chip on rows in **Cook › All recipes** and in the recipe sheet's facts. Quick cook stays uncluttered |
| Recipes: opt-in starter pack (`#starter-pack-prompt`, D-063) | **Cook › All recipes**, a compact "Low-effort starter recipes → Add starter recipes" card below the list (stub). Same rules as today: adds only absent ids and never re-adds deleted ones |
| Recipes: Add / Import recipe / CSV | **Cook › All recipes** footer |
| Recipes: Import / Export (JSON backup) | **Settings › Backup & restore** |
| Recipes: "Based on what's in your kitchen" strip | Folded into every recipe row ("✓ Have everything" / "Need 1: …"), sorted can-make-first. The counts use D-086 matching (see §5 risk 7) |
| Recipes: metadata strip balance line ("Protein ✓ · Veg ✓ · Carb ✓", `renderRecipeMetaStrip()`) | **Recipe sheet**, directly under the facts chips: "Protein ✓ · Veg ✓ · Carb —" |
| Shop: list, Add item, check-off → inventory | **Shop** (to-buy only; ticking moves it to Kitchen, with Undo). Each row shows its amount (recipe lines scaled by batch servings and summed when units agree) and its cost when the Price book has the item; the header gives the total for priced items |
| Shop: untick a checked item (`unstockPurchasedGroceryItem()`, D-057) | **Shop › Bought today (N)**, collapsed. Each ticked row stays there with its receipt ("New in Kitchen", "Vinegar set to Full (was Low)", "Added to your Eggs"). **Untick** reverses exactly that receipt and puts the row back on the list, long after the toast has gone |
| Shop: in-stock rows | **Shop** · collapsed "Already in your kitchen (N)" |
| Shop: **Not anymore?** (`openNotInKitchenDialog()` / `correctKitchenStock()`) | **Shop › Already in your kitchen**, a **Not anymore?** button on each row, working. The row shows which kitchen record matched. The confirm sheet names that one record, and *It's gone · add to list* corrects only it (staple → out, otherwise removed) and adds the item to the list, with Undo |
| Shop: No plan? Fill the gaps | **Shop** · "No plan? Quick picks" (role-based, always reachable) |
| Shop: Print / Copy / Clear / Price List | **Shop ⋯** menu |
| More › Recipes | **Cook** (primary tab) |
| More › Flavor Library | **Cook › Sauces & prep** (knowledge) + **Kitchen › Prepped** (stock) + "try with" chips on ready food |
| Flavor Library: add your own flavor | **Cook › Sauces & prep › Flavor Library › + Add your own flavor** (card header), working. The form has name (required, with an inline error), how it's made, hands-on minutes, goes-with chips, ingredients and steps. Saved flavors get a "Yours" chip |
| Flavor Library: edit / delete | **Flavor sheet › Edit / Delete**, working. Edit reuses the same form. Delete asks first, says any stock in Kitchen › Prepped stays, and the toast's Undo brings the flavor back |
| Flavor Library: search, preparation-style filter, protein filter (`getFilteredFlavors()`) | The global **Cook search** covers flavors. In the Flavor Library card, **How it's made** (Any · Make fresh · Fridge batch · Freezer-friendly) and **Goes with** (Any · Chicken · Pork · Fish · Tofu · Egg) chip rows are ANDed, sorted by name, with a "Clear filters" empty state |
| Flavor Library: opt-in starter flavors (`flavorStarterCandidates()` / `addStarterFlavors()`) | **Cook › Sauces & prep**, a "Starter flavors" card above the library, working: "N starter flavors you don't have yet: … → Add them / Not now". It follows D-063: a flavor already present is skipped, and a deleted starter is never offered again. The card retires itself when nothing is eligible |
| More › Nutrition | **Settings › Nutrition**, plus per-recipe facts in the recipe sheet |
| More › Price Book | **Settings › Price book** and **Shop ⋯ › Prices** |
| More › Cooking Hacks | **Settings › Cooking tips** (later: contextual tips in Meal prep) |
| More › Settings (account, sync, alerts, backup, clear all) | **⚙ in the header**, everywhere. Sync status shows only inside Settings (or as a header dot on error). **Clear all data** is the last real row in Settings, in red, with its existing double confirmation (stub) |
| Help modal, Kitchen Setup wizard | Unchanged; Help sits in Settings |

### Challenge: four tabs, three, or five?

- **Three tabs (Home+Kitchen merged as "Eat", Cook, Shop):** rejected. The Fridge content alone is
  4.1 screens today. Merging it into Home recreates the long, mixed scroll this audit is trying to
  fix, and "I just shopped" / "we're out of X" need a stable place to manage stock that is not a
  feed.
- **Five tabs (keep Plan separate):** rejected. Plan and Prep are each one screen of the same batch
  rows (finding 4), and the owner wants planning to be **optional**. A primary tab called "Plan"
  says the opposite. Meal prep is one of three ways to cook, so it belongs beside the other two.
- **Recommendation: keep the four destinations — Home · Cook · Kitchen · Shop — with five changes
  to the proposal:**
  1. **Bottom tab bar** (thumb reach, always visible) instead of a top row. Settings, sync, backups
     and data tools move to a **⚙ header button**, which removes the More menu entirely.
  2. **Cook has five modes in one control:** Instant · Quick cook · Meal prep · Sauces & prep · All
     recipes. A **single search** spans recipes, sauces and prep-aheads. It opens on *Quick cook*,
     the most common fresh-cooking job. Instant also covers "heat & eat" ready food.
  3. **Flavor Library is split by purpose, not duplicated.** Knowledge (how to make it, what it goes
     with) lives in Cook. Physical stock (portions on hand) lives in Kitchen › Prepped. The two are
     joined by "In kitchen: N" chips and "try with …" hints on ready food.
  4. **Prepared ingredients get a first-class home** next to sauces (Kitchen › Prepped). They are
     created from Cook › Sauces & prep › *Made it* and consumed by recipes ("✓ Cooked rice").
  5. **Home is a decision page, not a dashboard.** It has three blocks (Ready to eat → Or make
     something → Use soon) and three quick actions (We're out of… · I just shopped · Leftovers). The
     meal-prep flow card, Favorites, Need ideas and Cook History move off it (to Cook › Meal prep, the
     Cook ♥ Favorites chip, can-make-now sorting and Settings › Cook history).

### Recipe cards: key facts first

A recipe row is 86–109px (average 88px at 390px wide, vs 1039px): initial, name, *time · effort · equipment*, one status chip
("✓ Have everything" / "Need 1: pechay") and a heart. Tapping opens a **sheet** with these facts:
time, hands-on time, effort, equipment, serves, keeps well, what you have or need, plus *Add them to
Shop*. Sticky actions are **I cooked this** and **Add to meal prep**. Ingredients are open by
default. Steps, nutrition/cost/storage, pairings and edit/delete are each one tap away. Viewing is
never editing.

## 4. What moves where (summary)

- **Removed from primary navigation:** Plan, Prep, Fridge, Recipes, More (Nutrition, Price Book,
  Flavor Library, Cooking Hacks).
- **Added:** Cook, Kitchen, the ⚙ header button and bottom navigation.
- **Merged:** Plan + Prep + the Home flow card → Cook › Meal prep. "Based on your kitchen" strip +
  quick filters + Need ideas → can-make-now sorting in Cook and Home. Freshness banner + attention
  card → Kitchen badge + Review bar + Home "Use soon". Prepared Flavors (two places) → Kitchen ›
  Prepped.
- **Demoted behind one tap:** By-day grid, week templates, AI Prep Brief, Stock health,
  Inventory-checked stamp, select mode, ingredient browser, print/copy/clear, prices, JSON
  import/export, nutrition, price book, tips, cook history.
- **New interactions (all reuse existing data):** "We're out of…" (out + add to Shop in one write),
  "I cooked this" from any recipe, "Bought something else?", prep-ahead *Made it*, and Undo on every
  destructive or stock-moving action. Each toast's Undo reverses only that action's own writes; see §8.

## 5. Risks

1. **Scope freeze and approval.** D-090 freezes application feature scope. This needs a new owner-approved proposal (PROP) before any task is written.
2. **Data integrity (red zone).** "We're out of…", "I cooked this", prepped ingredients and Undo all touch `pantry` / `cookedMeals` / `preparedFlavors` and the tombstone machinery. They must reuse `correctKitchenStock()`, `markRecipeCooked()`/`_doMarkCooked()`, `savePreparedFlavor()` and `saveData()`, never new write paths. Undo must restore through the same paths, or deletions can resurrect. These tasks land `approved` (held), not auto-merged.
3. **Prepared-ingredient model.** No production model exists yet. PROP-041 Phase 2 (D2/D3, TASK-100) defines it as a pantry lot. The UI must follow that decision, not invent a second collection.
4. **Muscle memory and deep links.** `showTab('fridge'|'planner'|'prep'|'recipes')`, the notification click (`show-attention` → `openAttentionView()`), and tests that select `.tab-btn[data-tab=…]` all assume today's ids. Keep the `data-tab` ids as internal section ids and remap the nav only, so existing specs and the service-worker route keep working.
5. **Dark mode.** The released app is deliberately **light-only** (`color-scheme: light`; ROADMAP "Do Not Work On" lists a manual toggle). The prototype honours `prefers-color-scheme` as asked. Shipping that is a separate product decision, and Hard Rule 7 (single `:root`) still applies.
6. **Discoverability of demoted tools.** People who use Nutrition, the Price Book or the By-day grid daily lose one tap. Mitigation: Settings rows plus contextual links (recipe sheet → nutrition, Shop ⋯ → prices, Meal prep → By day).
7. **Matching quality.** "✓ Have everything" is only as good as ingredient matching. The prototype now follows D-086 `ingredientNamesMatch()`: names match when they are equal, or when every word of the shorter name is in the longer one **and** both share the head noun (last word), with the identity-modifier guard, the rice-family rule and "A or B" alternatives. So *Eggs* does not satisfy *Egg noodles*, *Rice* does not satisfy *Rice vinegar*, and *Egg* never matches *Eggplant*. (The first prototype used a plain word-subset test, which let Eggs satisfy Egg noodles and under-counted "Need N".) Two read-path rules from D-086 also apply: an Out staple, an empty lot or a lot past its printed date is not stock, and an untracked amount still counts as "have some". Prepped stock matches only by exact name, so a cooked-rice tub is used for "Cooked rice" lines and never stands in for raw "Rice". Production must keep these read paths on `ingredientNamesMatch()` / `pantryLotAvailable()`. The write path (`findPantryMatch()` in `deductIngredientsForRecipe()`) is still substring-based and is the deferred red-zone task D-086 records; the prototype's "I cooked this" assumes that alignment has happened.
8. **Size of `app.js`.** Navigation is woven through about 17k lines of imperative `render*()`. A big-bang change is high risk, hence the phased plan below.

## 6. Phased production plan (smallest first)

Each phase is independently shippable and reversible, and follows D-001 (no framework or build step).

| Phase | Change | Risk / gate |
|---|---|---|
| **0 — Smallest first step** | **Recipe view-not-edit + compact card.** Recipe card tap opens the read-only `openRecipeDetailsModal()` (already exists) instead of the editor. The grid card collapses to name · time · effort · equipment · have/need chip · heart, with steppers, nutrition and ingredients moving into the details view. No data change and no nav change. Fixes findings 1–2 for the 54-screen list on its own. | Low · UI only · `done` |
| 1 | **Add "I cooked this" to the recipe details view**, reusing `markRecipeCooked()` unchanged. Enables quick cook without a plan. | Medium · touches the cook path but reuses it · `approved` |
| 2 | **Settings to the header (⚙), JSON Import/Export out of Recipes, freshness banner folded into the Fridge badge + Home attention card.** | Low · `done` |
| 3 | **Shop: to-buy first, in-stock rows collapsed, ⋯ menu for print/copy/clear/prices, quick picks inline when the list is short.** Reuses `groceryItemChecked()` and the existing check-off. | Low–Medium · `done` |
| 4 | **"We're out of…" sheet** in Fridge/Home over `correctKitchenStock()` + the existing add-to-grocery path. | High (stock + tombstones) · solo · `approved` |
| 5 | **Navigation: bottom bar Home · Cook · Kitchen · Shop.** Cook hosts Recipes + Plan/Prep (as Meal prep) + Flavor Library sections. Kitchen = Fridge reordered (Ready · Prepped · Ingredients, search first, admin in ⋯). Internal `data-tab` ids are kept, More is removed, and Nutrition, Price Book and Hacks move to Settings. | Medium · large UI diff, split per tab · Playwright nav specs updated |
| 6 | **Prepared ingredients in Kitchen › Prepped and Cook › Sauces & prep**, after PROP-041 Phase 2 lands its lot model (TASK-099/100). | High · data model · `approved` |
| 7 | **Undo** for eat / toss / out / bought, implemented as inverse operations through existing functions (the check-off already has an exact inverse via the `stocked` receipt). | High · `approved` |

## 7. Screenshot index

**Current app** (`audit/`): `01-first-run`, `02-kitchen-setup-review`, `03-tab-dashboard`(+`b`),
`04-tab-planner`, `05-tab-grocery`(+`b`), `06-tab-prep`, `07-tab-fridge`(+`b`), `08-tab-recipes`(+`b`),
`09-tab-nutrition`, `10-tab-ingredients`, `11-tab-flavors`, `12-tab-hacks`, `13-recipe-card`,
`14-more-menu`, `20-fridge-pantry-list`, `21-shop-no-plan-open`. Modals: `m-recipe-details`,
`m-recipe-edit`, `m-add-recipe`, `m-batch-picker`, `m-prep-mode`, `m-manual-cooked`, `m-bulk-add`,
`m-settings`, `m-help`, `m-ingredient-browser`.

**Prototype** (`audit/`, regenerated by `selftest.js`): `proto-01-home`, `proto-02-cook-quick`
(method chips + Favorites), `proto-03-recipe-sheet`, `proto-04-meal-prep`, `proto-05-prep-day`,
`proto-06-shop`, `proto-07-kitchen` (Prepped), `proto-08-out-of` ("egg" → Eggs first),
`proto-09-flavors` (starter prompt, + Add your own flavor, style filter), `proto-10-search`,
`proto-11-settings`, `proto-12-home-360-light`, `proto-12-home-360-dark`, `proto-13-kitchen-dark`,
`proto-15-flavor-editor`, `proto-16-favorites` (with the "1 more favorite over 30 min" note),
`proto-17-method-empty` (D-060 empty chip), `proto-18-filters`, `proto-19-cooked-deduct` (what
"I cooked this" takes out), `proto-20-picker` (search + Low effort), `proto-21-bought-today`,
`proto-22-made-use-by` (optional use-by).

Note: some prototype screenshots show the toast from the previous step, because the self-test
captures them mid-flow.

## 8. Self-test and accessibility (re-run after review)

Method: [`selftest.js`](selftest.js) runs Playwright 1.65 (Chromium) against the file directly with
`isMobile` + `hasTouch`. Every non-`file:` request is logged and aborted. It clicks only visible labels
and accessible names (`getByRole('button', { name })`, `getByLabel`). It runs four configurations:
390×844 light, 390×844 dark, 360×780 light and 360×780 dark (`colorScheme`). After each step it
measures every visible element across about 30 screens, sheets and toasts. Raw output:
[`selftest-results.json`](selftest-results.json). Re-run after the second review on 2026-11-27.

| Config | Jobs | Console errors | Network requests | Horizontal scroll |
|---|---|---|---|---|
| 390×844 light | 19/19 pass | 0 | 0 | none |
| 390×844 dark | 19/19 pass | 0 | 0 | none |
| 360×780 light | 19/19 pass | 0 | 0 | none |
| 360×780 dark | 19/19 pass | 0 | 0 | none |

The jobs are the 8 everyday jobs in §2, plus: (9) Flavor authoring (empty-name error, add, edit,
delete, Undo, Freezer-friendly filter, starter prompt that never re-offers a deleted starter and
retires after "Add them"); (10) Favorites (heart a recipe, then ♥ Favorites lists exactly the hearted
ones); (11) all eight method chips visible in Quick cook, the empty "Rice cooker 0" D-060 message,
"Rice cooker 1" in All recipes, and Filters (Breakfast + High fiber → "Show 1 recipe"); (12) undo
isolation; (13) serving scaler (Chicken Adobo 4 → 5 servings: 1 kg → 1¼ kg); (14) Settings › Cook
history; (15) Kitchen ⋯ Remove expired (1) + Undo; (16) Shop "Not anymore?"; (17) Keep an expired
item (hidden from Review today, still "Expired · Kept today" in Kitchen) + Undo; (18) D-086 matching
(Stir-Fried Noodles shows "Need 3: Egg noodles, Cabbage…" although Eggs are at home); (19) the new homes
(Home "Something different", the recipe-sheet balance line, Settings › Clear all data).

Jobs 2, 3, 4, 6, 10 and 11 also gained checks for the second-review fixes: the cook sheet's deductions
(tuna 2 → 1 can, cooked rice 3 → 2 cups, untracked Cucumber unticked and still in Kitchen afterwards,
Soy sauce listed as a staple that is not deducted); picker search, Low effort and View; the live prep-day
step count; Shop amounts and costs; unticking Milk from **Bought today** after the toast has gone (Milk
is back on the list and no longer in Kitchen); a sauce saved with no use-by shows no date chip while
boiled eggs with a use-by 4 days out show "4d left"; the "1 more favorite over 30 min" note; and the
method chip resetting to All on a mode switch.

**Contrast** (WCAG relative luminance; alpha backgrounds composited up the DOM; every text node is
held to 4.5:1, with no large-text allowance):

| Config | Text samples | Lowest text ratio | Text < 4.5 |
|---|---|---|---|
| 390×844 light | 1,966 | 4.65 (primary button text) | 0 |
| 390×844 dark | 1,966 | 4.80 (recipe initial tile) | 0 |
| 360×780 light | 1,940 | 4.65 | 0 |
| 360×780 dark | 1,940 | 4.80 | 0 |

**Non-text UI contrast** (WCAG 1.4.11, held to 3:1). The self-test now measures five kinds of element.
The **focus ring** is the `--focus` outline that sits 2px outside every visible button, input, select,
textarea and summary, measured against the surface it lands on; `--focus` is read per element, so the
inverted toast's own ring colour is used there. **Selected chip** is the fill of every `aria-pressed="true"`
control against what surrounds it. **Control border** is every input, select, textarea and stepper
border, against both the outside and the control's own fill, taking the lower of the two. **Checkbox**
and **badge** are as before.

| Kind | Samples (390 light) | Lowest, light | Lowest, dark | Before this round (light / dark) |
|---|---|---|---|---|
| Focus ring | 1,025 | 6.88 | 5.07 | 1.48 / 2.01 (45% alpha green) |
| Selected chip fill | 33 | 6.89 | 6.31 | 2.56 / 6.31 |
| Control border | 40 | 3.88 (search box) | 3.76 (search box) | 1.36 / 1.94 (20% / 22% alpha) |
| Checkbox | 11 | 6.67 | 6.92 | unchanged |
| Nav badge | 56 | 6.61 | 5.30 | unchanged |

0 UI samples are below 3:1 in any of the four configs (1,165 / 1,165 / 1,148 / 1,148 samples). The
360px runs give the same lowest values.

Token changes behind this (prototype only; production `style.css` is untouched):

- **Orange text:** a new `--warn-text` is used for chip text, the Review and Running-low bars, sauce
  tiles and "need" bullets. It is rgb(150,70,14) in light (was the fill orange, about 3:1) and
  rgb(250,190,140) in dark. The orange fill `--warn` is now only a non-text accent.
- **Nav badges:** `--badge-bg`/`--badge-fg` (dark orange with white text in light, light orange with
  near-black text in dark) and `--badge2-*` for Shop. Dark mode previously put white text on light
  green.
- **Grey text:** dark `--text-2` is raised to rgb(204,206,208), which fixes the dark grey chips and the
  Settings subtext. Light `--text-2` is rgb(98,91,86). Light `--primary-strong` is darkened to
  rgb(58,94,62) so "✓ Have everything" chips pass. Dark `--danger` is raised to rgb(255,160,164).
- **Toast Undo:** its own `--toast-link` in each mode. Placeholder text uses `--text-2` at full opacity.
- **Focus ring:** `--focus` is a solid colour, rgb(46,92,52) in light and rgb(171,214,175) in dark, and
  the toast redefines it as `--toast-link`.
- **Selected chips:** a new `--sel-bg`/`--sel-fg` pair (rgb(58,94,62) with white text in light; the
  light green with near-black text in dark). Primary buttons keep `--primary`.
- **Control borders:** a new solid `--control-border`, rgb(133,123,111) in light and rgb(146,152,162)
  in dark, on inputs, the search boxes, selects, textareas, steppers, the mode, method and filter chips, and the goes-with picks.
  Card borders stay subtle; they are not controls.

**Tap targets** (bounding box of every visible button, input, select, textarea, summary and
checkbox label):

| Config | Targets measured | Smallest | Below 44 px |
|---|---|---|---|
| 390×844 light | 1,025 | 44×44 (icon buttons) | 0 |
| 390×844 dark | 1,025 | 44×44 | 0 |
| 360×780 light | 1,010 | 44×44 | 0 |
| 360×780 dark | 1,010 | 44×44 | 0 |

`.btn.sm`, mode, method and flavor-filter chips, the stock-level chip (`.lvl`, min 60×44), steppers,
hearts and ✕ buttons, the Shop checkbox (a 44×44 `.check-btn` around the 26px box) and toast Undo
(min 64×44) are all at least 44px. The Review and Running-low bars are at least 52px tall.

**Undo, as built:** each action records the inverse of only its own writes (`push`/`del`/`set` into a
per-action journal). The toast's Undo replays that journal newest-first against the live state, then
recomputes the plan-derived Shop rows. Job 12 proves the isolation: remove the Mung Bean Stew batch,
then raise the Rice Cooker batch from 4 to 5 servings, then tap Undo. The batch comes back and the
servings stay at 5. Non-destructive view changes (servings steppers, picker ticks, hearts, filters)
are not undoable, by design. Production must still implement each inverse through the existing write
paths (§5 risk 2).

## 9. Second review: data semantics and should-fixes (2026-11-27)

The independent re-review passed the prototype but asked that it show the app's real data semantics,
so the production proposal is not built on behaviour the app does not have. Each item below is checked
by the self-test (§8).

| # | Review item | What the prototype does now | App behaviour it models |
|---|---|---|---|
| 1 | "I cooked this" deleted whole records | The sheet lists what it will **take out**, scaled by the servings made: "Canned tuna: use 1 can · 1 can left", "Cooked rice: use 1 cup · 2 cups left". A lot is removed only when it reaches zero ("that uses it up, so it is removed"). Staples are listed as "never deducted". A matched lot with **no tracked amount**, or with a unit that does not convert, goes under "Amount not tracked", **unticked**, and stays in the kitchen unless you tick "Used it all up?". Undo restores every amount | `markRecipeCooked()` → `deductIngredientsForRecipe()`: skips staples, skips null-quantity lots, converts units, subtracts, and tombstones only lots that hit zero (D-057 addendum). The explicit "used it all up" tick is a prototype addition; in production it would route through the existing single-item removal, never a new delete path |
| 2 | Matching too loose | D-086 head-noun matching (§5 risk 7). "Need N" counts changed accordingly, e.g. Stir-Fried Noodles is now "Need 3: Egg noodles, Cabbage…" although Eggs are at home | `ingredientNamesMatch()`, `pantryLotAvailable()` |
| 3a | "Still good" rewrote the date | **Keep** / **Still good** set a same-day `kept` flag. The item leaves Home "Use soon", Kitchen Review, the Kitchen badge and **Remove expired** for today; its date is untouched and Kitchen still shows "Expired · Kept today" | D-057 / D-088 `keptOn`, `isKeptToday()` |
| 3b | Expired rows offered only Toss | Expired rows (Home and Kitchen Review) offer **Keep** or **Remove**, and say "past its printed use-by" | FEATURES Home attention: Keep / Remove per row, bulk Remove expired |
| 3c | "Made it" inferred a sauce expiry | **Use by (optional)** date field. Blank means no date and no "Nd left" chip ("no use-by date" in Kitchen › Prepped). A new batch of the same flavor replaces the record in place (same id) | D-074: `preparedFlavors` has no inferred shelf life; one active batch per `flavorId` |
| 4 | A tick could only be reversed while the toast showed | Ticked rows move to a collapsed **Bought today (N)** section with their receipt. **Untick** reverses exactly that receipt (new lot removed, staple level restored, merged amount restored) and puts the row back on the list | D-057 `stockPurchasedGroceryItem()` / `unstockPurchasedGroceryItem()` receipts: created / staple / merged |
| 5 | Favorites hid hearted recipes over 30 min | Quick cook's ♥ Favorites view adds "1 more favorite over 30 min: Chicken Adobo" and **Show all N favorites** (also counts any hidden by a method chip or Filters) | — |
| 6a | Meal-prep picker was a bare list | Search, **Low effort only** (off by default) and **View** per row, with a way back | D-078 batch picker |
| 6b | Shop rows had no amounts | Amounts on every plan row (scaled by batch servings, summed when units agree), per-row cost when the Price book has the item, and a total for priced items | `generateGroceryList()` amounts, Price book / Price List |
| 6c | Homes missing | "Something different" on Home; Clear all data in Settings; the balance line in the recipe sheet (all in the §3 map) | D-055 / D-059, Settings, `renderRecipeMetaStrip()` |
| 7 | UI contrast | Focus ring, selected-chip fill and control borders all at least 3:1 in light and dark (§8 table) | — |
| 8a | Prep-day count was static | "N of M steps done" updates live and is announced (`aria-live`) | — |
| 8b | Prep-aheads "Made it" below the fold | **Prep-aheads ↓** jump link at the top of Sauces & prep; it scrolls and moves focus | — |
| 8c | Method chip carried across modes | Switching between Quick cook and All recipes resets the chip to **All** | — |

Still out of scope for the prototype, and noted for the proposal: the D-088 **Check** tier (an
estimated date that has passed) would reuse the same row with Still good / Toss, and is never
bulk-removed. The prototype's only past-date sample, Pechay, has a printed use-by, so it is Expired.
