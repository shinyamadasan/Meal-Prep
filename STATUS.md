# Session Log

Newest entry at top. Append after every session — never edit past entries.
The top entry is the current **working memory** (where we are / next task / blockers).

---

## 2026-06-25 — OPERATOR.md + GUIDE slimmed; triaged 2 noise captures

**Docs:** Added `OPERATOR.md` (human playbook: 7 operating principles + daily/weekly rhythm); slimmed
`GUIDE.md` to a muscle-memory capture card; registered both in `CLAUDE.md`.
**Triage:** 2 inbox captures dropped as noise — the GUIDE cheat-sheet text pasted into the bot chat,
and an empty message. Both archived to `captures/processed/2026/06/`. Inbox empty.
**Friction found:** the bot captures *everything* sent to it. Reference material (the cheat sheet)
belongs in Telegram **Saved Messages**, not the bot chat.
**Next task:** Queue empty. Start sending real `/feature`/`/bug` captures.
**Blockers:** none.

---

## 2026-06-25 — Capture pipeline live; first Triage

**Triage:** 1 capture in `captures/inbox/` (`20260625T1621Z-4-feature`, "test capture") → recognized as
a smoke-test, **dropped** (no task created), archived to `captures/processed/2026/06/`. Inbox empty.
**Pipeline status:** Telegram → n8n → `captures/inbox/` confirmed working end to end (real commit + reply).
**Next task:** Queue empty. Send a real `/feature`/`/bug` from Telegram, or promote a task into `planning/TASK.md`.
**Blockers:** none.

---

## 2026-06-25 — Mobile capture pipeline (Telegram → inbox → Triage) + repo reorg

**Task:** Build the Telegram capture system: dumb capture in n8n, smart Triage in Claude.
**Completed:**
- **Reorg:** `planning/` (ROADMAP, TASK, DONE) + `captures/` (inbox, processed). `STATUS.md`/`CLAUDE.md` stay at root.
- `planning/DONE.md` split out of ROADMAP; ROADMAP gained **Ideas** + **Research** parked buckets.
- `WORKFLOW.md`: new **Triage** event (runs first) — categorize, dedupe, **goal-score vs PROJECT.md**, route, archive to `captures/processed/YYYY/MM/`. Updated diagram, file-change table, autonomous behavior, all paths.
- `docs/PROJECT.md`: added ranked **North-star goals** for triage scoring.
- `captures/README.md`: pipeline contract + capture file format (`id` = idempotency key).
- `CLAUDE.md`, `PROMPTS.md` (P9 Triage), `run-claude.ps1` (Triage-first flow, planning/ paths, `git mv` allowed) updated.
- `n8n-telegram-inbox.json`: redesigned workflow — n8n only creates files in `captures/inbox/` (folder approach, no sha/merge race). Needs your bot token, PAT, and Telegram user id.
- DECISIONS **D-011** (capture pipeline + reorg) and **D-012** (goal-aligned triage scoring).
**Verification:** Docs/structure only — no app.js change. n8n JSON is best-effort (placeholders), **not import-tested**.
**Files changed:** `planning/*` (moved+new), `captures/*` (new), `WORKFLOW.md`, `CLAUDE.md`, `PROMPTS.md`, `run-claude.ps1`, `docs/PROJECT.md`, `docs/DECISIONS.md`, `n8n-telegram-inbox.json`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Wire n8n (token/PAT/user-id), send a test `/feature`, confirm a file lands in `captures/inbox/`, then let a run triage it. Old `n8n-telegram-github.json` can be deleted (superseded, D-011).
**Blockers:** none.

---

## 2026-06-25 — Fix: cloud data wiped on deploy/reload (signed-in users)

**Task:** Stop signed-in users' Firestore data being wiped after a push/deploy.
**Root cause:** Writes (30s auto-save, `online` event, renders) could fire before the cloud doc was
read — `loadUserData()` isn't awaited and `loadFromFirestore()` loads nothing if `navigator.onLine`
flickers false. `saveToFirestore()` uses `tx.set` (full overwrite), so a save with default/empty
`AppState` overwrote the whole cloud doc.
**Fix:** Added `AppState.cloudReady` write guard — `saveToFirestore()` no-ops until the cloud baseline
is read (`loaded`/`empty`, an `onSnapshot`, or sign-up seeding); resets on each sign-in; the `online`
handler now loads (not pushes) when not ready. Also fixed `loadFromFirestore()` omitting `cookHistory`.
**Verification:** By code trace only — no runtime/automated test harness for this path. Traced deploy
+ flaky-connection, normal load, sign-up, offline, and online-recovery scenarios; cloud is never
overwritten with un-loaded state. **Recommend a real signed-in deploy test before trusting it fully.**
**Files changed:** `app.js`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`,
`docs/DECISIONS.md` (D-010), `ROADMAP.md` (residual `tx.set` debt), `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Manually verify on the live site signed in; then consider the field-level-merge debt (ROADMAP).
**Blockers:** none.

---

## 2026-06-25 — No tasks remaining

**Task:** None — ROADMAP.md Task Queue is empty and TASK.md is NO ACTIVE TASK.
**Action:** Autonomous run stopped per WORKFLOW.md (no-active-task behavior). No work invented.
**Next task:** Add prioritized tasks to `ROADMAP.md` Task Queue, then promote the top item into `TASK.md` to activate the next run.
**Blockers:** none.

---

## 2026-06-24 — Task-driven lifecycle (WORKFLOW.md), replaces "session end"

**Task:** Redesign the dev workflow around task completion + explicit events instead of unreliable "session end".
**Completed:**
- New `WORKFLOW.md` — source of truth for the lifecycle: 6 events (Planning, Execution, Checkpoint, Task Completion, Commit, Next Task Selection), per-file change timing, and autonomous behavior for completed/partial/blocked/no-task.
- `CLAUDE.md` — replaced "Read/Update protocol (session)" with a Lifecycle pointer to WORKFLOW.md + kept the per-task read-routing table; added WORKFLOW.md to the doc map.
- `TASK.md` — added Blocker field; Current Step marked as the resume point; Done conditions reference WORKFLOW.md.
- `ROADMAP.md` — added a **Blocked** section; flow description now defers to WORKFLOW.md.
- `PROMPTS.md` — P7 reframed "Session wrap-up" → **Checkpoint**; added **P8 — Resume**.
- `run-claude.ps1` — autonomous prompt rewritten to the event model (resume → execute → completed/partial/blocked outcomes, Checkpoint on stop).
- `DECISIONS.md` — added **D-009** (task-driven lifecycle; no session end).
**Files changed:** `WORKFLOW.md` (new), `CLAUDE.md`, `TASK.md`, `ROADMAP.md`, `PROMPTS.md`, `run-claude.ps1`, `docs/DECISIONS.md`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Queue empty; promote a task into `TASK.md` to activate the next run.
**Blockers:** none.

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
