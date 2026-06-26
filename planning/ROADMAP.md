# Meal Prep Planner — Roadmap

**Strategic** — for the human to set priority. Vision/scope: [../docs/PROJECT.md](../docs/PROJECT.md).
Active task: [TASK.md](TASK.md) · Completed log: [DONE.md](DONE.md) · Lifecycle: [../WORKFLOW.md](../WORKFLOW.md).

## How work flows in
Two ways items land here:
1. **You order the queue** — priority is yours; the agent never picks.
2. **Triage** — each run processes `captures/inbox/` (from the Telegram bot), scores items against the
   North-star goals in PROJECT.md, and routes them: actionable → **Task Queue** / **Known Issues**;
   low-commitment → **Ideas** / **Research** (parked, never auto-built). See [../WORKFLOW.md](../WORKFLOW.md).

At **Next Task Selection** the agent moves the finished task to [DONE.md](DONE.md) and promotes the
**top of the Task Queue** into `TASK.md` (FIFO). A **blocked** task is parked in **Blocked**.

---

## Product Direction (Sprints)
The **AI Dev OS is locked at v1.0** (see [../AI-DEV-OS.md](../AI-DEV-OS.md)) — stop refining the
workflow; build the product. North star for the next month: **10 real users > more features.**
- **Sprint 1 — Polish:** ✅ light-only fix · design-system pass · UI polish (per the UX audit).
- **Sprint 2 — User testing:** get **5–10 real users**; record where they stick / ignore / delight / confuse.
- **Sprint 3 — Fix what users found.**
- **Sprint 4 — Product intelligence:** smarter "what can I cook?", pantry, suggestions.
- **Sprint 5 — Public beta.**
Track progress with evidence, not intuition → [METRICS.md](../METRICS.md).

---

## Task Queue (Now / Next / Later)

Prioritized; top item is promoted next. Each entry: outcome + priority/complexity + success criteria.

> **⏳ Decision pending (do NOT auto-build) — Job #5 "cheapest":** descope (reframe Price Book as a
> price *reference*) vs build a minimal basket-per-store compare. The **human** decides; the autonomous
> run must SKIP this. Last external-testing blocker. *(Preserved — do not delete.)*

- [x] ~~**Alpha P1: one onboarding modal on first run**~~ ✅ (2026-06-25)

> **Dependency chain (drain test, 2026-06-25).** Build in order — each builds on the previous via a
> `suggested` flag on grocery items. EXTEND existing code, don't duplicate: low-stock auto-add already
> lives in `checkAndReplenishLowStock()` / `syncStapleToGrocery()`; grocery rendering in
> `renderGroceryList()`; state in `AppState.groceryList` (items) and `AppState.pantry`.

- [x] ~~**1. Flag auto-suggested low-stock grocery items**~~ ✅ (2026-06-25)
- [ ] **2. "Suggested" badge in the grocery list** · P2 · complexity:S
  - Depends on Task 1's `suggested` flag.
  - acceptance:
    - [ ] grocery items with `suggested === true` render a small "Suggested" badge (with the reason as a title/tooltip)
    - [ ] non-suggested items render unchanged
  - likely files: `app.js` (`renderGroceryList`), `style.css` (badge), `index.html` if a class is needed
- [ ] **3. Dismiss a suggested grocery item** · P2 · complexity:M
  - Depends on Tasks 1 + 2.
  - acceptance:
    - [ ] a dismiss control on suggested grocery items removes the item from `AppState.groceryList`
    - [ ] the corresponding `AppState.pantry` item is **untouched** (only the grocery entry goes)
    - [ ] dismissed items are **not re-added** by the next `checkAndReplenishLowStock()` run while still below min (track the dismissal — e.g. a flag on the pantry item or a dismissed set)
    - [ ] persists through `saveData()`
  - likely files: `app.js` (`renderGroceryList`, `checkAndReplenishLowStock`)

---

## Ideas (parked — never auto-built)

Low-commitment thoughts from `/idea` captures. Promote into the Task Queue when you want one built.

*(none)*

---

## Research (parked — investigate before building)

`/research` captures — open questions to explore, not yet actionable.

- **Immediate run on new capture (online), scheduled as fallback.** Trigger a Claude run as soon as a
  file lands in `captures/inbox/`, with the cron runs as backup when the PC is offline.
  Approach: self-hosted GitHub Actions runner on the PC, `on: push` to `captures/inbox/**` (offline →
  run queues until the runner reconnects); add a lockfile so it can't overlap a scheduled run.
  Simpler alt: Task Scheduler poller every ~5 min that `git pull`s and runs only if inbox is non-empty.
- **Self-maintaining PAT expiry alert via n8n/Telegram** (replace the calendar reminder).
  Reactive: capture workflow's error branch → if GitHub node returns 401/403, Telegram-alert to
  regenerate the PAT. Proactive: monthly n8n Schedule does a no-op GitHub call; on failure → Telegram.
  (Current PAT expires 2026-09-23.)
- **Process / flow-metrics report** (weekly, markdown-native — no metrics DB).
  Compute from data we already keep: throughput (DONE.md / `git log --since`), avg cycle time
  (`captures/processed/**` `captured:` → commit date), queued + blocked (ROADMAP counts), rollback
  count (`git log` reverts). Ship as a `/report` prompt → `planning/METRICS.md`, optionally a Sunday
  scheduled run. **Review time + merge rate need the PR approval gate first** (see OPERATOR.md) — that
  gate unlocks those two metrics *and* a review-before-live step; decide it separately.
- **Extract the AI Dev OS into its own repo** (`ai-dev-os/`) so new apps clone it.
  *(Manifest done: `AI-DEV-OS.md` defines generic vs app-specific + the bootstrap. Remaining = the actual repo lift.)*
  The reusable "System 2" is the *protocol* layer, NOT this app's content. Separate them first:
  GENERIC (move to ai-dev-os as templates) = `WORKFLOW.md`, `PROMPTS.md`, `OPERATOR.md`, the doc-router
  pattern, `run-claude.ps1`, the n8n capture workflow, and empty `TASK/ROADMAP/DONE/STATUS` + `captures/`
  scaffolds. APP-SPECIFIC (stays per app) = `CLAUDE.md`'s project section + hard rules, and all of
  `docs/` (PROJECT/ARCHITECTURE/DATA_MODEL/FEATURES/DECISIONS). A new app = clone ai-dev-os, fill in
  CLAUDE.md's project block + docs/. Open question: keep it in sync across apps via a template repo,
  git submodule, or a copy-on-init script.
- **Failure-recovery test** (run after the multi-task drain proves out).
  Queue 3 tasks where the middle one is likely to block. Expected per current policy: Task 1 ✅ →
  Task 2 blocked → record blocker in TASK.md + STATUS.md → move it to ROADMAP **Blocked** → **promote
  the next queue item and continue** (the workflow already parks-and-continues, not stop-on-blocker;
  WORKFLOW.md autonomous table). Tests resilience, not just throughput.

---

## Blocked

Tasks parked by an autonomous run because they hit a blocker. Each: task + the blocker + what's
needed to unblock. Resolve, then re-add to the top of the Task Queue.

*(none)*

---

## Known Issues & Debt

Bugs, gaps, and dead code. Fixing one = delete it here (note it in the git commit).

### Bugs / broken
- **Family sharing acceptance flow** — invitations write to `familyInvitations` but there's no UI to
  accept; `status` stays `pending` forever. (Feature is Hidden anyway.)
- **Sentry inactive** — code loads only when `SENTRY_DSN` is set; it's empty.

### Gaps
- **Firestore save is a full-document overwrite** (`saveToFirestore` uses `tx.set`; merge only runs
  on a version conflict, and only unions 7 list fields). The D-010 write guard stops the deploy wipe,
  but this is still fragile — a new `AppState` field forgotten in `buildFirestorePayload` would be
  silently dropped on every save. Consider field-level merge on every write.
- **USDA `DEMO_KEY` rate limit** — ~1000/hr/IP, no retry or user-facing message (DECISIONS D-007).
- **Snack serving scaling** — snacks use the recipe's global `currentServings`; no per-slot override.
- **Prep Mode** — no batch-cook ingredient aggregation across the week's recipes.
- `LOCAL_NUTRITION_DB` still missing some common Filipino ingredients.

### Dead / orphaned code
- **`#storage` tab** — full UI + `renderStorageGuide()` but no nav button (superseded by Inventory).
- **Orphaned pantry reads** — `addToPantry()` still calls `getElementById` on the removed
  `#pantry-qty-input` / `#pantry-storage` (resolves null, no crash).
- **`colorScheme` localStorage key** — now fully unused (light-only release, D-013); harmless orphan in some users' storage.
- **`recipe.highlights`** — rendered as tag chips but no edit-form input to set it.
- **`printGroceryList()`** — defined, no button wired.
- Hidden features: Family Sharing modal, Community Feed / `sharedRecipes`.

---

## Do Not Work On

- Dark mode toggle (more problems than value — see DECISIONS "Do Not Work On" rationale).
- Community feed / family sharing features.
- PWA manifest or offline-mode changes (service worker is intentionally minimal).
- UI redesign beyond what a task specifies.
- New sample recipes.
- USDA API changes.
