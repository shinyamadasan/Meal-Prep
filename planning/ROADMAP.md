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

## Task Queue (Now / Next / Later)

Prioritized; top item is promoted next. Each entry: outcome + priority/complexity + success criteria.

*(empty — add prioritized tasks here, or let triage fill it)*

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
- **`colorScheme` localStorage key** — read on load, never written (no dark-mode toggle exists).
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
