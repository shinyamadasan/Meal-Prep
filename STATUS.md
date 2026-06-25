# Session Log

Newest entry at top. Append after every session — never edit past entries.
The top entry is the current **working memory** (where we are / next task / blockers).

---

## 2026-06-24 — PROMPTS.md: reusable session prompts

**Task:** Add a prompt library so task framing stays consistent across sessions.
**Completed:** New `PROMPTS.md` with P1–P7 (draft task → TASK.md, implement, fix, refactor, audit, record decision, wrap-up). Each defers to `CLAUDE.md` for rules so it can't drift. Registered in the CLAUDE.md doc map (not auto-read).
**Files changed:** `PROMPTS.md` (new), `CLAUDE.md`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Queue empty; promote a task into `TASK.md` to activate the next run.
**Blockers:** none.

---

## 2026-06-24 — TASK.md: single active-task handoff

**Task:** Split tactical (active task) from strategic (roadmap) so the autonomous agent never picks priorities.
**Completed:**
- New `TASK.md` — the single active task (Objective / Current Step / Success Criteria / Definition of Done); idle state = NO ACTIVE TASK.
- `CLAUDE.md` read protocol now: CLAUDE → STATUS → **TASK** → only-required docs. Update protocol: on task done, promote next ROADMAP queue item into TASK.md (mechanical FIFO).
- `ROADMAP.md` is now strategic only — removed "Current Task"; the agent works `TASK.md`, not the roadmap.
- `run-claude.ps1` rewritten to the new flow (reads TASK.md, stops on NO ACTIVE TASK).
- Noted for later: `PROMPTS.md` (deferred — not built).
**Files changed:** `TASK.md` (new), `CLAUDE.md`, `ROADMAP.md`, `run-claude.ps1`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Queue empty; promote a task into `TASK.md` to activate the next autonomous run.
**Blockers:** none.

---

## 2026-06-24 — AI-first documentation system

**Task:** Redesign project docs for AI-assisted development; retire the monolithic `feature-inventory.md`.
**Completed:**
- New router `CLAUDE.md` (read/update protocol + hard rules + gotchas, folded in).
- New `docs/`: `PROJECT.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `FEATURES.md`, `DECISIONS.md` (D-001…D-008 seeded).
- `ROADMAP.md` restructured: kept the autonomous Current Task / Queue / Done sections, added **Known Issues & Debt** (merged from KNOWN_ISSUES), kept **Do Not Work On**.
- `feature-inventory.md` content split across the above, **line numbers stripped** (stable anchors only), then deleted.
- `ROADMAP.md` + `STATUS.md` kept at **repo root** (not `/docs`) because `run-claude.ps1` reads them there by name.
**Files changed:** `CLAUDE.md`, `ROADMAP.md`, `STATUS.md`, `docs/*` (new), `feature-inventory.md` (deleted).
**Branch:** `main` — on disk, not yet committed.
**Next task:** Queue is empty — add tasks to `ROADMAP.md` before the next session. Optionally commit the doc migration.
**Blockers:** none.

---

## 2026-06-24 — Autonomous overnight session — queue empty, devops housekeeping

**Tasks completed:**
1. Committed pending devops schedule changes (9PM/2AM triggers) — `DEV-OPS-GUIDE.md`, `run-claude.ps1`, `setup-task-scheduler.ps1`
2. Added `claude-session.log` to `.gitignore` to prevent it appearing as untracked every run

**Files changed:** `DEV-OPS-GUIDE.md`, `run-claude.ps1`, `setup-task-scheduler.ps1`, `.gitignore`, `STATUS.md`
**Branch:** `main` — committed and pushed.
**Next task:** No tasks in queue — add new tasks to ROADMAP.md before the next session.
**Blockers:** none

---

## 2026-06-23 — Autonomous overnight session — full ROADMAP queue completed

**Tasks completed (in order):**
1. Weekly nutrition totals in the Plan tab — `renderWeeklyNutritionTotals()` called from `renderWeeklyPlanner()`, renders into `#weekly-nutrition-totals` div
2. Grocery list alphabetical sort — `renderGroceryList()` sorts category keys A→Z with "Other" last; fallback to "Other" for missing category
3. Recipe serving scaler on recipe detail — `buildDetailIngList()` + `adjustDetailServings()` + stepper UI in collapsed detail section; resets on close
4. Pantry bulk-add mode — "Bulk add" button + `#bulk-add-modal` + `confirmBulkAdd()` with warning list for bad lines
5. Cook history log — `AppState.cookHistory` persisted to localStorage + Firestore; dashboard shows last 10 entries newest-first

**Files changed:** `app.js`, `style.css`, `index.html`, `ROADMAP.md`, `STATUS.md`
**Branch:** `main` — all changes on disk, NOT yet committed or pushed.
**Next task:** `git add app.js style.css index.html ROADMAP.md STATUS.md && git commit -m "feat: weekly nutrition totals, grocery sort, recipe scaler, bulk pantry add, cook history" && git push origin main`
**Blockers:** none (code is done)

---

## 2026-06-22 — Autonomous session — commit pending work from last session

**Task:** Commit and push all pending changes from the previous overnight session.
**Completed:** Verified all diffs against ROADMAP Done entries. All changes correct. Committed and pushed to main.
**Files changed:** `app.js`, `style.css`, `index.html`, `ROADMAP.md`, `STATUS.md`, `DEV-OPS-GUIDE.md`, `run-claude.ps1`, `setup-task-scheduler.ps1`
**Branch:** `main` — committed and pushed.
**Tests:** Code inspection; no regression risk (all additive changes).
**Next task:** No tasks remaining — queue is empty.
**Blockers:** none

---

## 2026-06-22 — Autonomous overnight session — full ROADMAP queue completed

**Tasks completed (in order):**
1. Mung Beans in INGREDIENT_DB — added to `app.js` with aliases, priceValue, minStockQty
2. Silent JS errors — `updateGrocerySummary()` null check added; other two bugs already fixed
3. Service worker — `sw.js` verified working; no code changes needed
4. Dead code removal — skipped (Storage Guide and `customIngredients` are actively used at 15+ call sites; removal would break the app)
5. Global error handler — `window.addEventListener('error', ...)` at end of `app.js`; `.global-error-banner` CSS in `style.css`
6. Text search in Ingredient Catalog — already implemented; added `#ingcat-no-results` element
7. "Buy it" button on cook suggestions — `buyMissingIngredient()` + button on "Missing 1" tier cards
8. Recipe favorites — `toggleFavorite()` + heart button on each card + "♥ Favorites" checkbox filter
9. Plus carried over from previous session: Password reset, Expiry suggestions, Grocery→Pantry transfer, Paste parser improvement, Filipino ingredients in LOCAL_NUTRITION_DB, Grocery list refresh on serving size change

**Files changed:** `app.js`, `style.css`, `index.html`, `ROADMAP.md`, `STATUS.md`
**Branch:** `main` — all changes on disk, NOT yet committed or pushed.
**Next task:** `git add app.js style.css index.html ROADMAP.md STATUS.md && git commit -m "feat: recipe favorites, buy-it button, global error handler, mung beans, and bug fixes" && git push origin main`
**Blockers:** none (code is done)

---

## 2026-06-22 — Phase C: Pantry Auto-Deduct (Session 2 — commit done)

**Task:** Commit and push the feature/pantry-auto-deduct branch
**Completed:** Verified code from previous session. Created branch `feature/pantry-auto-deduct`, committed `app.js` + `STATUS.md` (commit `8bfc950`). Push blocked by sandbox — requires manual step.
**Files changed:** `app.js` (6 lines changed), `STATUS.md` (new file committed).
**Branch:** `feature/pantry-auto-deduct` — committed locally, NOT yet pushed.
**Tests:** Criteria 1–5 verified by code inspection. Criterion 6 (Playwright) requires GitHub Actions after push.
**Next task:** Run `git push -u origin feature/pantry-auto-deduct` manually, then open a PR to main.
**Blockers:** `git push` blocked by sandbox in autonomous mode. Manual push required.

---

## 2026-06-22 — Phase C: Pantry Auto-Deduct

**Task:** Implement pantry auto-deduction in `markRecipeCooked()` per ROADMAP.md Phase C
**Completed:** Fixed `deductIngredientsForRecipe()` in `app.js` (lines 6432–6459). The function already existed and handled subtraction + unit conversion, but was missing the removal step when qty <= 0. Added `depleted` array to track IDs, then filter `AppState.pantry` after the loop.
**Files changed:** `app.js` — 6 lines added (~line 6432). STATUS.md — this entry.
**Branch:** Changes saved to disk but NOT committed. Session was not launched via run-claude.ps1, so git write operations were blocked (not in allowedTools). Action required: run `git checkout -b feature/pantry-auto-deduct && git add app.js STATUS.md && git commit -m "Fix: remove depleted pantry items after cooking a recipe"` manually.
**Tests:** Criteria 1–5 verified by code inspection (see ROADMAP.md). Criterion 6 (Playwright) requires GitHub Actions after push.
**Next task:** 1. Commit + push the branch. 2. Open PR to main. 3. Verify Playwright passes. 4. Merge.
**Blockers:** none (code is done, only commit step pending)

---

## 2026-06-22 — System Setup

**Task:** Set up async development workflow
**Completed:** Created ROADMAP.md and STATUS.md. Phase C defined.
**Files changed:** ROADMAP.md (new), STATUS.md (new)
**Branch:** none (no code changes)
**Tests:** not run
**Next task:** Implement pantry auto-deduction in `markRecipeCooked()` per ROADMAP.md Phase C
**Blockers:** none
