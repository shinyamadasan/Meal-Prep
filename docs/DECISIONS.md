# Decisions (ADR-lite)

> Why the important architectural choices were made — so they don't get silently reversed.
> Append-only. Never rewrite an entry; to reverse one, add a new entry and mark the old
> `Status: Superseded by D-0NN`. Read before replacing any existing approach.
>
> Optional `Verify:` line(s) on any entry are a machine-checkable pointer (D-046):
> `Verify: <file> contains "<literal text>"` or `Verify: <file> does not contain "<literal text>"`.
> Run `tools/Verify-Decisions.ps1` to check every one against the current code. Add one when a
> decision's correctness depends on something specific enough to name (a guard clause, a call site) —
> not every entry needs one.

---

## D-001 — Plain HTML/CSS/JS, no framework, no build step
Date: (pre-2026) · Status: Active
Context: Solo dev, GitHub Pages hosting, wants to edit and ship instantly.
Decision: Three static files (`index.html`, `app.js`, `style.css`). No React/bundler/transpile.
Why: Zero build means push-to-deploy in ~1 min; no toolchain rot; trivial to host on Pages.
Trade-off: One large `app.js`; global functions; manual imperative re-render. Accepted.
Supersedes: —

## D-002 — Single global `AppState` + imperative `render*()` re-render
Date: (pre-2026) · Status: Active
Context: No framework means no reactive data binding.
Decision: All state in one `AppState` object; each tab has a `render*()` that reads state and writes `innerHTML`.
Why: Simple, predictable, debuggable without tooling; matches the no-framework choice (D-001).
Trade-off: Manual "mutate state → call the right render fn → saveData()". Forget a step = stale UI.
Supersedes: —

## D-003 — Offline-first dual-write (localStorage + Firestore)
Date: (pre-2026) · Status: Active
Context: App must work with no account and offline (flaky mobile); cloud sync is a bonus, not a requirement.
Decision: `saveData()` always writes `localStorage`; also writes Firestore when signed-in + online.
Why: localStorage is the always-available source of truth; cloud is additive.
Trade-off: Two write paths and a reconciliation problem — solved by D-004.
Verify: app.js contains "saveToLocalStorage()"
Verify: app.js contains "saveToFirestore()"
Supersedes: —

## D-004 — Optimistic concurrency with union-merge on conflict
Date: (pre-2026) · Status: Active
Context: Same account on two devices can edit offline and sync later.
Decision: Firestore writes go through `runTransaction` with a `version` field; on version mismatch, merge both changesets by union-of-id rather than last-write-wins.
Why: No device silently loses data.
Trade-off: Merge is union-by-id, not field-level; simultaneous edits to the same recipe favor one side.
Supersedes: —

## D-005 — Backward-compat via `patchMissingNutrition()` instead of schema migrations
Date: (pre-2026) · Status: Active
Context: Recipes saved before a field existed load as plain JSON missing that field.
Decision: After loading recipes, call `patchMissingNutrition(AppState.recipes)`; use `|| []` / `|| {}` defaults elsewhere. No versioned migration system.
Why: Cheap, good enough for a single-file app; avoids a migration framework.
Trade-off: Every new recipe field needs a defensive default or a patch step. Easy to forget.
Verify: app.js contains "patchMissingNutrition("
Supersedes: —

## D-006 — Recipe photos in a Firestore subcollection
Date: (pre-2026) · Status: Active
Context: Firestore documents are capped at 1 MiB; base64 photos blow past that quickly.
Decision: Store each photo as its own doc at `users/{uid}/photos/{recipeId}`; compress to max 1000px JPEG ~0.7; cache in `recipePhotoCache` at render. Auto-migrate legacy inline photos on load.
Why: Keeps the main user doc small and under the limit.
Trade-off: Extra reads/writes and a migration path. Accepted.
Supersedes: —

## D-007 — USDA `DEMO_KEY` with local-DB-first nutrition lookup
Date: (pre-2026) · Status: Active
Context: Need nutrition data offline and without managing API-key secrets in a static site.
Decision: `searchNutritionDB()` checks `LOCAL_NUTRITION_DB` first; only falls back to USDA FoodData Central with the public `DEMO_KEY`.
Why: Most lookups resolve instantly/offline; no secret to store in a public repo.
Trade-off: `DEMO_KEY` is rate-limited (~1000/hr/IP); no retry/limit messaging. Accepted for now.
Supersedes: —

## D-008 — AI-first docs: stable anchors only, no line numbers
Date: 2026-06-24 · Status: Active
Context: `app.js` is one ~8,800-line file under active development; line-number refs in docs drifted constantly (caught during the feature-inventory audit).
Decision: Docs reference function/object names, DOM ids, Firestore paths, localStorage keys — never line numbers. `feature-inventory.md` was split into `/docs` (PROJECT, ARCHITECTURE, DATA_MODEL, FEATURES, DECISIONS) + root ROADMAP/STATUS; CLAUDE.md is the router.
Why: A reference that needs re-grepping after every commit is worse than none.
Trade-off: Slightly less precise navigation (search by name vs jump to line). Worth it.
Supersedes: the monolithic `feature-inventory.md`.

## D-009 — Task-driven lifecycle; no "session end"
Date: 2026-06-24 · Status: Active
Context: Interactive AI sessions have no reliable end event (you stop typing, context compacts, the tab closes). Anchoring doc updates to "session end" meant they happened inconsistently. Autonomous runs also stop mid-task on token/time budget.
Decision: Replace the session-based workflow with a task-driven lifecycle of six explicit events (Planning, Execution, Checkpoint, Task Completion, Commit, Next Task Selection), documented in `WORKFLOW.md`. Stopping mid-work = a **Checkpoint** (persist `TASK.md` Current Step + `STATUS.md`). Code and docs commit together. STATUS updates only at Checkpoint/Task Completion; ROADMAP advances only at Next Task Selection.
Why: Tasks have clean, observable boundaries; sessions don't. Checkpoints make unfinished work resumable with zero context loss across scheduled runs.
Trade-off: More explicit ceremony per task; the agent must judge completed-vs-partial-vs-blocked. Accepted — it's what makes 5–6h autonomous runs safe.
Supersedes: the session-based update protocol previously in `CLAUDE.md`.

## D-010 — Firestore write guard: never write before reading the cloud
Date: 2026-06-25 · Status: Active
Context: Signed-in users lost ALL cloud data around deploys/reloads. Root cause: `loadUserData()` is not awaited, `loadFromFirestore()` loads nothing if `navigator.onLine` flickers false, and writes (30s auto-save, the `online` event, renders) fire during that window. `saveToFirestore()` uses `tx.set` (full-document overwrite), so a save with a default/empty `AppState` wiped the cloud doc.
Decision: Add `AppState.cloudReady` (transient). `saveToFirestore()` refuses to write while it's false. It flips true only once the cloud baseline is known — `loadFromFirestore()` returned `loaded`/`empty`, an `onSnapshot` arrived, or a new account is being seeded (`initializeUserData`). It resets to false on each sign-in. The `online` handler loads (not pushes) when not ready.
Why: Makes overwriting un-read cloud data structurally impossible. localStorage still saves, so nothing is lost locally — the cloud write just waits until it's safe.
Trade-off: A cloud write can be briefly deferred until the baseline loads (seconds). Worth it to never wipe cloud data. Does NOT fix the deeper `tx.set` full-overwrite design (still merge-only-on-version-conflict) — left as debt in ROADMAP.
Verify: app.js contains "AppState.cloudReady"
Supersedes: —

## D-011 — Mobile capture pipeline: Telegram → n8n → captures/inbox → Triage
Date: 2026-06-25 · Status: Active
Context: Want to capture ideas from a phone while away and have the autonomous pipeline act on them, without GitHub Issues and without n8n needing to understand the planning files.
Decision: n8n (dumb capture) writes **one immutable markdown file per Telegram message** to `captures/inbox/` via the GitHub Contents API — no AI, no parsing of planning files. A Claude run's **Triage** event (new, runs first) categorizes, dedupes, enriches, routes into `planning/ROADMAP.md`, and **archives** the processed capture to `captures/processed/YYYY/MM/` for provenance. Repo reorganized: `planning/` holds ROADMAP/TASK/DONE; `captures/` holds inbox/processed; `STATUS.md` + `CLAUDE.md` stay at root (auto-loaded / automation-appended). `DONE.md` split out of ROADMAP.
Why: Capture must be reliable and dumb; judgment (dedupe, file hints, scoring) needs full repo context, which only the Claude run has. One-file-per-capture avoids the append/merge race of a single INBOX.md and gives an immutable event log.
Trade-off: A folder of capture files + an archive tree to keep tidy; `run-claude.ps1` and all doc paths updated to the new layout. Accepted.
Supersedes: the unused root `n8n-telegram-github.json` (GitHub-Issue approach).

## D-012 — Triage scores captures against PROJECT.md North-star goals
Date: 2026-06-25 · Status: Active
Context: Captures arrive unprioritized; a cosmetic idea shouldn't outrank a friction-reducing one just because it was sent later.
Decision: At Triage, score each item's alignment with the ranked **North-star goals** in `docs/PROJECT.md` (strong/some/weak). Priority = goal-alignment first, complexity (S/M/L) as tiebreaker. This sets the item's order in the Task Queue. `/idea` and `/research` are parked (never auto-built) regardless of score.
Why: Keeps the autonomous queue pointed at what actually moves the product, not at whatever was captured most recently. Scoring stays a documented heuristic (LLM judgment), not a rigid formula.
Trade-off: Triage ranking influences queue order, which is normally the human's lever — but it's intake ranking against goals the human defined, not the agent overriding an explicit human ordering. Accepted.
Supersedes: —

## D-013 — Light-only release: force light, remove dark mode
Date: 2026-06-25 · Status: Active
Context: Phones in dark mode auto-applied the app's dark theme (and the browser/WebView darkened native controls), making the UI look broken and eroding trust. Dark mode had been patched component-by-component, so it was inconsistent. Product decision: ship one polished light theme this release.
Decision: Force light regardless of the device setting, via web standards only — `<meta name="color-scheme" content="light">`, `color-scheme: light` on `:root`, and a static `data-color-scheme="light"` on `<html>`. Removed the theme-applying inline script, both `@media (prefers-color-scheme: dark)` blocks, the `[data-color-scheme="dark"]` token block, and every `[data-color-scheme="dark"] .x` component override. The existing `[data-color-scheme="light"]` block remains the single light theme, so the light appearance is byte-for-byte unchanged.
Why: Consistency and trust matter now; a quality dark theme is a redesign, not a quick fix. Forcing light is a few lines of standards — no hacks, no duplicate CSS.
Trade-off: No dark mode this release. Unused dark *primitive* tokens (`--color-dark-bg`, `--color-dark-surface`, `--select-caret-dark`, etc.) remain inert in `:root` — optional to delete. A future warm dark theme would be a deliberate design-system project (see the UX audit notes).
Supersedes: the previous auto/system dark mode behavior.

## D-014 — Self Review (code health) as a distinct gate before QA (correctness)
Date: 2026-06-25 · Status: Active
Context: `QA.md` verifies "does it work?" but not "is it good code?". An agent can pass QA while shipping overengineered, duplicated, or debt-laden code. Senior engineers self-review and simplify before verifying.
Decision: Add a distinct **Self Review** event between Execution and Task Completion (WORKFLOW.md), driven by `SELF_REVIEW.md` — a Code Health checklist (duplication, magic numbers, complexity, dead code, TODOs, reuse, naming, unnecessary state/DOM queries, extract-to-helper) plus the one-question gate **"Would I ship this?"**. Self Review = quality; QA = correctness; Self Review runs first so QA verifies the cleaned-up version. Wired into CLAUDE.md, PROMPTS.md (P10), and run-claude.ps1.
Why: Separating quality from correctness catches debt before it ships and keeps the codebase maintainable for long-term solo dev. Code-health checks are AI-verifiable (read the diff), so they fit autonomous runs.
Trade-off: One more gate per task. The honesty rule is preserved — if a "would I ship this?" hesitation is a human-verified aspect (feel/polish/device), the agent marks it `ship-pending-human-review`, never claims verification.
Supersedes: —

## D-015 — Gated pipeline: capture ≠ build; human approves, AI executes
Date: 2026-06-26 · Status: Active (migrating incrementally; Phase 0 done)
Context: Captures were auto-triaged straight into the build queue and built unattended to live — a stray `/feature` became a production change with no human decision. Capture (cheap, noisy, low-commitment) must not auto-convert into a shipped commitment.
Decision: Insert human gates and separate the stages, each with ONE responsibility:
`captures/inbox → Triage → PROPOSALS.md (pending) → [human approval] → ROADMAP.md (protected approved backlog) → AI Sprint Planner → [human sprint approval] → BUILD_QUEUE.md → Builder → staging → [human validation] → prod`.
The Builder reads **only** `BUILD_QUEUE.md`. `ROADMAP.md` is written only by the approval gate (the Sprint Planner reads it, never edits; the Builder never touches it). Phone = product management (approve via natural-language replies to digests — no new commands); PC = engineering + validation.
Why: Puts scarce human judgment on the two decisions that matter (what to build, whether to ship), removes the human from mechanical work, and stops unreviewed auto-builds from reaching real users. Single-responsibility per stage keeps each simple and debuggable.
Trade-off: Two extra approval gates (more deliberate, less "instant") — accepted; this optimizes for leverage, not automation. Migrated incrementally: **Phase 0 = the firewall** (Builder reads only BUILD_QUEUE; triage → Proposals; Task Queue retired). Later phases add enrichment/evidence, the approval digest, the optimizing Sprint Planner, and staging.
Supersedes: the D-009-era auto-promote-from-Task-Queue-and-build flow; the ROADMAP "Task Queue" is retired.

## D-016 — Goal-driven enrichment + modular stage contracts
Date: 2026-06-26 · Status: Active (extends D-015)
Context: Priority alone is context-free — the same proposal is worth building, or not, depending on the product's current phase. And a multi-stage pipeline (triage → approval → planner → builder) is brittle if stages share implicit assumptions instead of a defined interface.
Decision: (1) A single **Current Objective** lives in `ROADMAP.md` (e.g. "alpha stability"); every proposal is scored for **goal alignment** against it, plus **expected user value** and **why-now-vs-later**, and its AI-recommended priority is goal-*adjusted*, not raw. Changing that one line re-points the whole pipeline — the same idea can rank differently. (2) Every stage reads/writes a **documented structured contract** co-located with its artifact (`PROPOSALS.md` = the proposal contract; `BUILD_QUEUE.md` = the sprint/task contract; …), so any single agent can be improved or replaced without redesigning the others.
Why: Optimizes the batch for the current phase of the product, not just the loudest ticket; keeps the pipeline modular and debuggable (swap the Sprint Planner without touching triage). Makes human approval *evidence-based* rather than a guess.
Trade-off: Triage does more work per capture (richer proposals), and contracts must be kept in sync with the agents that read them. Accepted — the enrichment is what makes approval defensible, and the contracts are what keep the system maintainable.
Supersedes: — (extends D-015)

## D-017 — Messaging lives in n8n; Claude/PC emits structured output; reply gate is deterministic code
Date: 2026-06-26 · Status: Active (Phase 2; extends D-015/D-016)
Context: Phase 2 adds two-way Telegram — digest out, approval reply in. An earlier `Generate-Digest -Send` put message-sending on the PC, splitting messaging across two systems and duplicating what n8n already does.
Decision: **n8n owns all Telegram messaging** (it already manages the bot). **Claude/PC produces only structured output:** `tools/Generate-Digest.ps1` writes `planning/DIGEST.md`; n8n reads it from GitHub on a morning schedule and sends it. For replies, n8n drops the raw reply as `captures/decisions/<id>.md` (dumb transport, mirroring `captures/inbox/`); the deterministic `tools/Apply-Decisions.ps1` (no LLM) parses it and updates `PROPOSALS.md` status + appends approved items to `BUILD_QUEUE.md`. Both scripts are wired into `run-claude.ps1` (apply before build; refresh digest after). **Approve goes straight to BUILD_QUEUE**, collapsing D-015's two approval gates (roadmap-approve, then sprint-approve) into the single digest reply for now; Sprint-Planner batching becomes an optional later refinement.
Why: One system per concern — n8n = messaging, code = deterministic transforms, LLM = judgment only. The reply parser is a deterministic transform, so it is code, not the LLM (global rule). Validating the full read+write loop in real use beats simulating the read-only half.
Trade-off: The single-gate shortcut means an approved proposal skips a separate sprint-batching review — acceptable while the backlog is small; revisit if batches grow. `DIGEST.md` is a generated artifact committed to the repo so n8n can fetch it.
Supersedes: the `Generate-Digest -Send` (PC-side messaging) approach from earlier in Phase 2.

## D-020 — Last-Write-Wins tombstone resolution via per-item `updatedAt`
Date: 2026-07-03 · Status: Active
Context: `loadUserData()` merges localStorage tombstones into AppState via `mergeDeletions()`. When a second device signs in after having previously run Clear All Data, its localStorage contains tombstones for every recipe ID. Those stale tombstones wiped all Firestore data — the reconciliation `saveData()` wrote the tombstoned state back, and the PC's `onSnapshot` picked it up, deleting everything. An earlier workaround (D-020 v1) dropped `mergeDeletions()` entirely, which fixed the data-loss bug but meant offline deletions never propagated. That trade-off is unnecessary.
Decision: Implement Last-Write-Wins (LWW) tombstone resolution. Every item carries an `updatedAt` ISO timestamp. `applyTombstones()` removes an item only if its tombstone is **newer** than the item's `updatedAt`. Items without `updatedAt` (legacy) fall back to old behaviour (tombstone wins). Migration: `loadFromFirestore()` stamps legacy items with `data.lastSaved` (the document's last-save time) so stale tombstones from before that save lose. Local-only items are stamped with `localNow` before the union so fresh local additions survive any pre-existing stale tombstones. `mergeDeletions(local.deletions)` is restored — safe because LWW prevents stale tombstones from winning.
Why: LWW is the correct CRDT approach. A stale tombstone (created before the item was last confirmed in Firestore) loses because its timestamp predates the item's `updatedAt`. A legitimate offline deletion (created after the item was last saved) wins because its timestamp is newer. No trade-off needed.
Invariant: Whenever an item is created or modified, set `updatedAt = new Date().toISOString()` on it. Items that pass through `buildFirestorePayload()` pick up `firestoreSavedAt` on the next load if they somehow still lack it.

## D-019 — Explicit import overrides tombstone (import intent wins over prior deletion)
Date: 2026-07-02 · Status: Active
Context: `applyTombstones()` runs on every signed-in load and removes any item whose ID is in `AppState.deletions`. If a user imports a file containing IDs that were previously tombstoned (e.g. via Clear All Data), `buildFirestorePayload()` writes those tombstones back to Firestore alongside the re-imported items. On the next signed-in refresh, `applyTombstones()` silently removes the re-imported items — the user sees empty data after what appeared to be a successful import. The signed-out path never calls `applyTombstones()`, so the same import survives on a signed-out device, hiding the bug.
Decision: In `importData()`, before any `unionById()` call, delete `AppState.deletions` entries for every ID present in the import file. The rule: **explicit re-import overrides a prior deletion**. The alternative — requiring the user to manually clear tombstones or use a fresh ID — is invisible and unrecoverable, making it a data-loss bug, not a feature.
Why: An import is an explicit user intent to restore or add data. Silently discarding it because of a tombstone from a previous Clear All Data violates that intent. The cost is minimal: a deliberate re-import that wins over a prior deletion is correct behaviour.
Trade-off: If the user deleted an item intentionally, then imports a file that includes that same ID, the item reappears. This is the correct trade-off — a file-based import is a stronger signal than a prior interactive deletion. Tombstone semantics (delete propagates across devices) are unchanged for all other operations.

## D-018 — Delete-aware sync via tombstones (removes the union "resurrection" trade-off)
Date: 2026-06-29 · Status: Active
Context: Whole-document sync makes a *missing* item ambiguous — deleted, or not-yet-synced? An earlier fix (union local into cloud on sign-in) stopped data loss but could **resurrect** a deleted item, and a near-empty session could still clobber a populated cloud. A user (dogfooding) rightly pushed back: real apps don't have this trade-off.
Decision: Record deletions **explicitly** as tombstones — `AppState.deletions` = `{ id: deletedAtISO }` — synced as a normal payload field and honoured in **every** merge (sign-in union, concurrent-conflict merge, realtime listener). Deletions are detected by **diffing the curated lists against a per-session baseline** refreshed after each load/merge (`recordLocalDeletions`), so **no delete handler is instrumented** (avoids missing a call-site). `applyTombstones()` drops tombstoned ids after every union; a re-add gets a fresh id so it isn't suppressed. `groceryList` is excluded (it regenerates from the plan). Tombstones >180 days are purged to bound growth. Tombstoned keys: recipes, pantry, customIngredients, customHacks, cookedMeals, userIngredients.
Why: Removes the trade-off entirely — deletes propagate and **stick**, data is never lost, and a near-empty session adopts the cloud instead of overwriting it. Baseline-diff keeps the change contained to the sync functions.
Trade-off: the deletions map grows (bounded by the 180-day purge); a re-add after delete creates a new id (acceptable). Verified in isolation (delete propagates · no resurrection · re-add works · union never loses data) but **not** against live Firestore — needs real multi-device verification.
Supersedes: the union-on-sign-in resurrection trade-off from the prior sync fix.

## D-021 — `Next` command: read-only state recommendation as the default entry point
Date: 2026-07-03 · Status: Active
Context: The human had to manually inspect `PLAN.md`/`TASKS.md`/`REVIEW.md` and decide whether Claude should Plan/Review or Codex should Continue every time a session started, after an interruption, or when a task went `blocked`/`review`. That decision is mechanical — the task's `status` field already determines whose turn it is — so making a human recompute it every time was pure overhead.
Decision: Add a single read-only command, `Next`, callable from either a Claude or a Codex session. It reads `STATUS.md`, `PLAN.md`, `TASKS.md`, `REVIEW.md`, and `planning/BUILD_QUEUE.md`, applies a fixed status-priority table (`blocked` > `review` > `approved` > `codex` > `in-progress` > `todo`, falling through to `BUILD_QUEUE.md` when nothing is active) to find the single current task, and outputs a 5-line report ending in exactly one recommended command: `Continue`, `Plan`, `Review`, or `Status`. `Next` is now the documented default entry point in both `CLAUDE.md` and `AGENTS.md` — the thing to type when context is unclear, after an interruption, or at the start of a session.
Why: `Next` is read-only for Claude because Claude's roles (Plan/Review/Architect) require judgment calls (scope, acceptance criteria, architecture fit) that must not happen implicitly as a side effect of "just checking state" — a diagnostic command that quietly started planning or approving work would blur Hard Rule 1 (nothing builds without human approval) and the Reviewer's "never rubber-stamp" discipline. Codex may act (proceed as `Continue`) only when `Next` resolves to `Codex → Continue`, because that is the one case where "whose turn is it" and "what should happen" are the same fact — the task is already `status: codex`/`in-progress` and Definition-of-Ready-complete, so proceeding just resumes an already-approved decision rather than making a new one. In every other case (`blocked`, `review`, `todo`, or nothing active) the right action requires Claude's judgment, so Codex reports and stops rather than guessing or escalating on Claude's behalf.
Trade-off: One more command to document in two files; `Next` duplicates (rather than replaces) `Status`/`Plan`/`Review`/`Continue` — accepted, since it's a router in front of existing commands, not a new capability, and staying strictly read-only means it can never itself introduce the class of bug it was built to prevent (an unreviewed build).
Supersedes: —

## D-022 — Overnight automation gated behind `$AUTOMATION_ENABLED`; commit-scope guard replaces Claude-builds-directly
Date: 2026-07-03 · Status: Active
Context: `run-claude.ps1` (Windows Task Scheduler, 9PM/2AM) still had Claude read `planning/TASK.md`, implement directly in `app.js`/`index.html`/`style.css`, and commit + push to `main` unattended — a behavior that predates D-021's Claude/Codex split and directly contradicts it (only Codex should ever touch app code; see `CLAUDE.md`'s Delegation Policy). The scheduled task was found still enabled and would have fired under the old behavior. Separately, converting an approved `planning/BUILD_QUEUE.md` item into `PLAN.md`/`TASKS.md` was interactive-only (the "Plan" command) — there was no automated link from an approved item to a Codex-ready task, and no notification when one existed.
Decision: (1) `run-claude.ps1` gains a master flag, `$AUTOMATION_ENABLED` (default `$false`) — while false, the script logs one line and exits before touching git or calling Claude. (2) The Claude session's job is now Triage + converting `planning/BUILD_QUEUE.md` items into `PLAN.md`/`TASKS.md` entries (`status: codex`) — never building. Its `--allowedTools` excludes `Bash(git commit *)`/`Bash(git push *)` entirely; it cannot ship anything itself. (3) After the session returns, the script (not the LLM) checks every changed file against an explicit allow-list of planning/doc paths; anything outside it (e.g. `app.js`) halts the run with no commit/push and a loud `STATUS.md` alert, rather than auto-discarding the change. (4) A new deterministic script, `tools/Generate-Codex-Notice.ps1`, reads `TASKS.md` for `status: codex` entries and writes `planning/CODEX_READY.md`; `n8n-telegram-digest.json` fetches it alongside `DIGEST.md` each morning and sends it only when it isn't the empty placeholder.
Why: The commit boundary is a deterministic transform (which files changed), not a judgment call — so code should enforce it, not a prompt. This makes "Claude never builds unattended" structurally true (two independent enforcement points: no commit tool, then a path-scope guard) rather than a hope. Codex remains something a human always triggers by hand ("Continue"); nothing in this pipeline invokes it.
Trade-off: Two extra moving parts (the flag, the guard) to reason about, and the overnight run is inert by default until manually re-enabled — accepted, since the alternative (an old unattended-build script now contradicting the new role split) was actively unsafe.
Supersedes: the "Claude builds directly overnight" behavior described in the pre-this-decision `run-claude.ps1` and `docs/09-automation.md`.

## D-023 — Sprint Execution Mode: risk-gated chaining with semantic checkpoints
Date: 2026-07-03 · Status: Active
Context: `Continue` builds exactly one `TASKS.md` task per invocation, and Review happens once per task — correct for anything risky, but pure overhead for a run of already-vetted, mechanical tasks sharing one `source:` (e.g. a multi-modal CSS sweep), where the human says "Continue" and Claude opens a review for each near-identical change. An earlier draft of this design used a separate `BATCH-xxx` entity (its own header, id-space, lifecycle) and a numeric task-count cap; both were rejected during review — a cap is arbitrary (a 20-task mechanical sweep is safer than a 2-task Firestore change), and `PLAN.md`/`TASKS.md`'s existing `source:`-grouping already represents "the sprint"; a parallel entity would just duplicate it.
Decision: Extend the existing `TASKS.md` group-divider comment (already grouping tasks by `source:`) with `Risk: Low|Medium|High` and `Execution: Chained|Solo`. Risk is classified by the group's single highest-risk task: **Low** = mechanical/repetitive/single-concern; **Medium** = real logic change but no Hard Rule surface touched; **High** = any task touches a Hard Rule surface (Firestore guard, `saveData()`, recipe-id handlers, `:root` block) or touches architecture/auth/security/database/the AI Dev OS itself. High is never eligible for `Execution: Chained`, full stop, re-verified fresh at every task boundary (Hard Rule 10). No task-count cap exists at any risk tier. Within a Chained group, tasks may carry a `checkpoint:` label — a short semantic name for a real engineering boundary ("Modal CSS migration complete"), never a count or a timer. Codex chains through same-`source:`, same-`checkpoint:` ready tasks and hands off for Review once a checkpoint's tasks are exhausted, even if later checkpoints in the group still have work queued. If a task inside a chained group fails, Codex marks it `blocked`, records the blocker, always appends `TEST_REPORT.md` regardless of outcome, and — instead of halting the whole group — skips only tasks that depend on the blocked one (leaving them `status: codex`, noting the skip in `CHANGELOG.md`), continuing to implement genuinely independent ready tasks. Codex halts the entire group only if the blocked task gates most/all of what's left, the blocker looks architecture/scope-level, a test failure could invalidate later assumptions, or the next task overlaps the blocked task's files/regions. Claude's review of a checkpoint is bucketed — Approved / Blocked / Rework / Skipped (dependency) — never a single bulk stamp; Rework tasks permanently exit chained execution (no re-entry).
Why: Reuses `PLAN.md`/`TASKS.md`'s existing sprint concept instead of inventing a parallel `BATCH-xxx` lifecycle — the smallest change that gets the behavior. Risk-gating instead of a count cap means a large low-risk sweep isn't artificially throttled while a small high-risk change still gets full individual scrutiny — size was never the right proxy for danger. Semantic checkpoints (vs. a numeric window) put the review boundary where an engineer would actually want to look, not at an arbitrary interval. Not halting the group on every blocker keeps one unrelated ambiguity from stalling work that doesn't depend on it, while the halt conditions stay conservative enough that a real cross-task risk still stops everything.
Trade-off: `TASKS.md`'s group header now carries more state (`Risk`/`Execution`/optional per-task `checkpoint:`) than a plain divider comment; Claude must classify risk correctly since it's the only real gate — a Low-risk group later found to touch a Hard Rule surface would need correcting (or splitting) rather than being caught by a structural check. Accepted: the header is still a plain comment/field, not a new file or id-space, and correctness is already Claude's job everywhere else in this system.
Supersedes: —

## D-024 — Telegram remote control: git-as-message-bus command dispatch, no inbound network path
Date: 2026-07-04 · Status: Active
Context: The gated overnight automation (D-022) only ever runs Claude's planning step, twice daily; Codex still requires physically sitting at the PC and typing "Continue." The goal was to let Telegram approve ideas, trigger planning, trigger a Codex build, trigger Claude's review, and report results, all remotely — while preserving every existing safety property (Preflight, fail-fast, no unattended app-code writes by Claude, no unattended merges). Two blocking facts shaped the design: (1) there is no confirmed headless/scriptable Codex CLI on this machine — `AGENTS.md` documents Codex as strictly interactive; (2) n8n (cloud-hosted) has no path to execute anything on the PC directly — it can only read/write files via the GitHub API. True instant push (a webhook hitting a local listener) was considered and explicitly rejected for this iteration: it would open the PC's first-ever inbound network path, needing its own auth and monitoring, to shave a couple of minutes off a poll-based design that has no attack surface at all.
Decision: Extend the existing capture/decision file-drop pattern with two new folders: `captures/commands/` (n8n writes one file per recognized Telegram command: `/status /next /go /run /build /review /stop /enable /disable`) and `captures/replies/OUTBOX.md` (an append-only outbox, same idiom as `DIGEST.md`/`CODEX_READY.md`, that `tools/Dispatch-Commands.ps1` writes to and a new short-interval n8n workflow — `n8n-telegram-replies.json`, ~2 min — reads, sends, and clears via a GitHub PUT). A new Scheduled Task ("Meal Prep Command Dispatcher," ~2 min, deliberately **no** `-WakeToRun`) runs `tools/Dispatch-Commands.ps1`, which routes each command to a phase runner: `/run` reuses `run-claude.ps1` unmodified (invoked without `-Scheduled`, so it never shuts the PC down); `/build` (new `tools/Run-Codex-Build.ps1`) creates/checks out a `task-<id>` branch from a clean `main` and either invokes Codex headlessly — only if `$env:CODEX_CLI_COMMAND` is explicitly set by the operator, never guessed at — or falls back to staging the branch and notifying the human to run Codex themselves; `/review` (new `tools/Run-Claude-Review.ps1`) checks out that branch and runs a restricted `claude -p` session. `/go` is a convenience command that computes the same priority table as `/next` (the `D-021` logic) and dispatches to whichever of run/build/review it recommends — `/run`/`/build`/`/review` remain available as manual overrides. Every phase runner keeps its own commit-scope guard mirroring its documented ownership exactly (planning: `PLAN.md`/`TASKS.md`/`STATUS.md`/`planning/`/`captures/`; build: everything except the named process docs + `docs/`/`planning/`/`captures/`/`library/`/`config/`/`.claude/`/`tools/`; review: only `REVIEW.md`/`TASKS.md`). D-027 later extends `/review` so an approved review can fast-forward and push `main` after test/merge gates pass; other phase runners still do not merge task branches. A single `automation.lock` file (gitignored, PID + timestamp, stale after 2 hours) is shared by the dispatcher, the phase runners, and `run-claude.ps1` so nothing here can ever overlap the twice-daily scheduled run or another dispatcher tick.
Why: Reuses every pattern already proven safe this session (allow/deny-list commit-scope guards, fail-fast halting, append-only outboxes, the branch-per-task convention already used interactively) instead of inventing new mechanisms — the only genuinely new pieces are the command/reply folders and the phase-runner routing. Not guessing at a Codex CLI invocation avoids the far worse failure mode of a wrong flag doing something unintended to a real repository. Rejecting the inbound-webhook option keeps the system's total attack surface at zero inbound paths, which was true before this feature and stays true after it — a couple of minutes of poll latency is judged worth that.
Trade-off: Command latency is bounded by the poll interval (~2 min typical, worse if the PC is asleep — the existing twice-daily `-WakeToRun` task is the backup path for anything sent while asleep), not instant. `/build`'s "prepared, notify" fallback mode (today's actual live behavior, since no headless Codex is configured) still requires physically running Codex — it stages the branch and shortens the trip, but doesn't remove the human step. A rare race exists where the reply-relay's clear-PUT can lose a same-moment new append (mitigated by GitHub rejecting the stale-sha PUT with a 409, so the content merely survives uncleared until the next poll rather than being silently lost).
Supersedes: — (extends D-022's gated-automation model to the build/review phases)

## D-025 — Codex CLI headless execution confirmed; `/build` runs `codex exec` unattended, superseding D-024's manual fallback
Date: 2026-07-04 · Status: Active
Context: D-024 built `/build` around the (then-true) assumption that Codex had no headless invocation — `AGENTS.md` documented it as strictly interactive, and nothing on the machine's `PATH` proved otherwise, so the design deliberately never guessed at flags and fell back to staging a branch and asking a human to open Codex themselves. That assumption is now verified false: `codex exec -C . --sandbox workspace-write "Continue"` runs unattended, correctly reads `AGENTS.md`/`TASKS.md`, follows the AI Dev OS, and refuses to act when no `status: codex` task exists — the same contract a human typing "Continue" gets.
Decision: `tools/Run-Codex-Build.ps1` now invokes `codex exec -C <repo root> --sandbox workspace-write "Continue"` directly (via `Start-Process` with redirected stdout/stderr, timed for duration) instead of the `$env:CODEX_CLI_COMMAND`-gated fallback. A new Preflight check confirms `codex` resolves on `PATH` before anything else, mirroring `run-claude.ps1`'s existing `claude`-CLI check. Before invoking, the script snapshots every `TASK-<id>` currently `status: codex` (the "tracked set" — plural, because a Sprint Execution Mode/D-023 chained group can legitimately advance more than one task in one invocation; the chaining logic itself lives in `AGENTS.md`, which Codex reads on its own — the wrapper only classifies outcomes across the tracked set afterward). Results classify into: no codex work available (tracked set empty, Codex never invoked), success→review (commits/pushes, then **automatically invokes `tools/Run-Claude-Review.ps1`** and folds both results into one reply — no separate manual `/review` step needed after a clean build), blocked (Codex's own blocker note is committed/pushed, no auto-chain), or failure (either `codex exec` exited non-zero, or exited 0 but advanced no tracked task) — either failure mode marks the affected task(s) `blocked` with the specific reason rather than leaving them silently re-triable. The existing deny-list commit-scope guard runs unchanged, applying regardless of `codex exec`'s exit code, before any commit happens. The "Meal Prep Command Dispatcher" Scheduled Task's `ExecutionTimeLimit` is raised from 10 minutes to 2 hours (matching "Meal Prep Claude Overnight") since a real Codex build can legitimately take longer than a quick poll cycle.
Why: The whole point of D-024's fallback was refusing to guess at an unverified invocation; now that the invocation is verified, keeping the fallback would just be manual toil the system no longer needs. Reusing the existing deny-list guard, Preflight pattern, and fail-fast contract means this is exactly what it was framed as — one implementation detail replaced, not an architecture change. Auto-chaining into Review (rather than requiring a separate `/build` then `/review` round-trip) collapses the two remaining manual steps in the loop into one Telegram interaction while still never skipping the review gate itself.
Trade-off: A real Codex build can take meaningfully longer than the dispatcher's normal ~2-minute cadence, hence the timeout bump — during that time the shared `automation.lock` blocks any other phase from running, which is intentional (no overlapping builds) but means `/status`/`/next` while a build is in progress will report "busy" rather than fresh state. Whether `--sandbox workspace-write` permits Codex to `git commit` on its own is unconfirmed either way — doesn't matter, since the wrapper's own post-invocation commit step picks up whatever Codex left in the working tree regardless.
Supersedes: D-024's `/build` fallback design (the rest of D-024 — the command set, the file-drop dispatch, the polling architecture, the outbox — is unaffected and remains active).

## D-026 — `/go` is a mission-based autopilot: one command drives plan→build→review to a verdict
Date: 2026-07-05 · Status: Active
Context: After D-025 the loop still exposed its internals to the Telegram user — `/go` executed exactly one `Get-NextAction` result (one of plan/build/review) and stopped, so shipping one feature meant several `/go` round-trips (plan, then build+review, then merge) and the user had to track "whose turn is it" between presses. The goal: one Telegram command = one unit of user-meaningful progress, with the Claude/Codex split kept fully intact internally but invisible from Telegram. Framed as *missions* (drive one approved item through review; D-027 later extends that to merge) rather than *phases*; ownership flips (Claude plan → Codex build → Claude review) are internal mechanics and must never, by themselves, stop the run — only a real external condition (needs human input, safety, or budget) does.
Decision: `/go` now runs `Invoke-Autopilot` in `tools/Dispatch-Commands.ps1`, a thin orchestration layer over the phase runners (`run-claude.ps1`, `Run-Codex-Build.ps1`, `Run-Claude-Review.ps1`) — so every preflight, fail-fast halt, and commit-scope guard is preserved by construction, since those live inside the runners the loop only sequences. One `/go` = **one mission**: (1) release autopilot's own retryable auto-blocks; (2) run planning once if approved work exists but nothing is build-ready; (3) build exactly one dependency-satisfied task; (4) auto-review it; (5) D-027 auto-merges it if approved; (6) report an aggregate summary. Key mechanisms: **Priority** is enforced by planning keeping pending `status: codex` tasks in P1→P2→P3 file order (Codex self-selects the first `status: codex` task per AGENTS.md, so file order == build order — no change to the build runner). **Outcome reflection** is now defensive only for approved tasks because D-027 carries the reviewed branch's `done` status onto main during the fast-forward. **Skip-and-continue / rework / dependencies** all share ONE mechanism: autopilot sets a task `blocked` with an `auto:`-prefixed note to pull it out of Codex's candidate set, and at the start of each `/go` re-evaluates only its own `auto:` blocks (retry rework strikes < 3; release merge-waiters once the dependency branch is merged) — human-set blocks are never touched, and the note itself carries persistent state (strike count, merge-wait reason), so no separate state file is needed. A rework escalates a strike (1/3, 2/3, 3/3) across separate `/go`s and auto-blocks permanently at 3. A dependency is satisfied only if its task branch is already merged into main (`git branch --merged`), never merely `done`-on-a-branch. Budget: 30 minutes OR 10 AI actions (plan/build/review each = 1), whichever trips first — a safety cap a single mission rarely approaches. Standalone `/status /next /run /build /review /stop /enable /disable` are unchanged for power-user/debug use; a `/log` command tails the session log.
Why: One command producing a real, reviewed, merged result — with a scannable summary and detail only on failure — is the friction reduction the remote-control feature was for, without weakening any guard (they remain inside the phase runners). "One mission per `/go`" (rather than draining the whole queue in one press) keeps each press bounded and idempotent. Encoding strike/merge-wait state in the task's own `auto:` blocker note (vs a side file) makes it committed, reboot-durable, and human-visible in TASKS.md.
Trade-off: Superseded in part by D-027. Originally, `done` on main meant "approved, ready to merge — code still on its branch" for the window between build and the human's merge. D-027 removes that stop point by auto-merging approved reviews after test and fast-forward gates pass. The remaining D-026 trade-off is priority ordering: priority is only as deterministic as planning's file ordering; the planning prompt is instructed to keep pending codex tasks in priority order and to reorder only pending codex blocks (never done/review/blocked).
Supersedes: nothing — extends D-024/D-025 (`/go` was previously the one-shot dispatcher; the command set, dispatch, guards, and `/build`'s own auto-chain into review are all reused unchanged).

## D-027 — Approved review auto-merges with test and fast-forward gates
Date: 2026-07-06 · Status: Active
Context: D-026 intentionally stopped at "approved, ready to merge" because merge-to-main was still treated as a human shipping decision. In practice, Claude review already is the approval gate for a `TASKS.md` task, and the remaining manual merge step became pure friction: the user had to come back to the PC just to run the same deterministic fast-forward after every passed review. That friction also weakened the automation loop because dependency checks key off actual merge state, so a task could be approved but still block its dependents until the user performed a mechanical merge.
Decision: `tools/Run-Claude-Review.ps1` now owns the post-review merge. After Claude writes `REVIEW.md`, updates only the reviewed task's `TASKS.md` status, and the review commit is pushed to the `task-<id>` branch, the runner checks the final status. If and only if the status is `done`, it runs `npm test` on the reviewed branch with a 10-minute timeout, verifies `main` is an ancestor of the task branch (`git merge-base --is-ancestor main task-<id>`), checks out `main`, fast-forwards with `git merge --ff-only task-<id>`, and pushes `origin/main`. If review returns `codex`, if tests fail or time out, if the branch is dirty, or if `main` cannot fast-forward, the runner reports the blocker and leaves `main` unchanged. `/build` and `/go` inherit this through their existing auto-review chain; no extra Telegram command is required. `-NoAutoMerge` and `-NoPush` remain available for manual/debug runs.
Why: This keeps the human judgment boundary exactly where it already was — Claude's review verdict — while removing the mechanical merge step after that verdict. Testing before the fast-forward gives the same tree confidence without moving `main` first. Fast-forward-only avoids merge commits, conflict resolution, or hidden reconciliation logic. Dependency gating becomes simpler and truer: a successful mission ends with the task branch actually merged, so later tasks can build from the reviewed code.
Trade-off: A passed review now pushes `main`, so GitHub Pages can deploy without a separate human action. That is intentional for the automation path, but it raises the importance of Claude's review and the branch test gate. If a user wants to inspect a passed review before shipping, they can run `tools/Run-Claude-Review.ps1 -NoAutoMerge` or `-NoPush` and merge manually.
Supersedes: D-026's "ready to merge" stop point. D-026's mission structure, retry/blocker state, and phase-runner reuse remain active.

## D-028 — Sign-in merge resolves a duplicate by last-write-wins, not cloud-always-wins
Date: 2026-07-08 · Status: Active
Context: The sign-in / reload merge in `loadUserData()` unions this device's `localStorage` into the freshly-read cloud copy so data built while signed out is never shadowed (the union added by D-018's neighbours). But it resolved a true duplicate id by *cloud always wins* (`unionById` argument order). That silently discarded a **local edit to an existing item** whenever that edit reached `localStorage` but not the cloud — e.g. an inventory storage-location change (`setPantryStorage`) made while signed out, offline, or during the post-load window when `saveToFirestore()` is gated by `!cloudReady` (Hard Rule 6 / D-010). On the next reload the older cloud copy overwrote the edit, so a pantry item moved to "counter" reverted to its inferred default ("fridge" via `inferStorage`). Additions survived (they are not duplicates); edits did not. A per-item timestamp already existed (`updatedAt`, added for tombstone LWW in D-020) but nothing bumped it on edit, and the union ignored it.
Decision: Two coordinated changes. (1) New `unionByIdLWW(cloudArr, localArr, stats)` resolves a duplicate id by newer `updatedAt`; a tie or a missing timestamp keeps the **cloud** copy — the pre-existing default — so a stale local session still never clobbers good cloud data. The load-merge now unions with it *before* the fallback stamp that fills untimestamped items with load-time `now`, so that synthetic stamp can no longer masquerade as a fresh edit and win. `stats.localWins` forces the merged-superset re-sync (`saveData()`) even when list lengths are unchanged. (2) New `stampUpdated(item)` sets `item.updatedAt` to now; it is called in every in-place mutator of a synced inventory item — the pantry editors (`setPantryStorage`, `togglePantryStaple`, `cycleStapleLevel`, `updatePantryDate`, `togglePantryDateMode`, `updatePantryShelf`, `updatePantryQty`, `updateBrowserItemQty`, `setBrowserItemLevel`, `dismissSuggestedGroceryItem`) and the cooked-meal editors (`setCookedStorage`, `updateCookedDate`) — right before `saveData()`.
Why: A local-only edit that never synced and an older cloud copy can only be ordered by a reliable per-item timestamp; document-level `version` cannot detect it (a gated save never bumps the version). Stamping only the item actually edited — never blanket-stamping on save — is essential: a coarse "stamp everything now" would make an offline device's untouched items look freshly edited and clobber another device's real edits. Cloud-wins-on-tie means keys whose edits are *not* stamped (recipes, custom ingredients/hacks, user ingredients, grocery list) keep byte-for-byte identical behaviour, so the change is scoped to the inventory surface that reported the bug.
Trade-off: Only the inventory mutators are stamped, so the same edit-loss class still exists latently for other entity types (recipes, etc.); extending `stampUpdated` to those is a clean follow-up. Verified with a merge-logic unit test covering the offline-edit case, the stale-local-vs-newer-cloud regression guard, tie→cloud, local-only additions, and cloud-only survival.
Supersedes: nothing. Extends D-018's union and D-020's `updatedAt` LWW; the D-010 write guard and Hard Rules 5–6 are unchanged.

## D-029 — Delete-sync ignores a mass simultaneous vanish as a load-race artifact
Date: 2026-07-08 · Status: Active
Context: The tombstone delete-sync (D-018/D-020) infers a deletion in `recordLocalDeletions()`: any id present in `_idBaseline` (the id set snapshotted right after the last load/merge) but absent from `collectSyncedIds()` at save time is tombstoned with `now`. This assumes anything that vanished was deliberately removed by the user. But during a startup/sync race, `AppState.pantry` (or any synced list) can be momentarily empty while `_idBaseline` still holds every item — e.g. a default/empty `AppState` between page load and the awaited `loadFromFirestore()`/merge, or the concurrent `onSnapshot` path in `setupRealtimeListeners()`. A single `saveToFirestore()` in that window tombstoned the entire pantry, and the delete-sync then propagated that phantom wipe to every device (`mergeDeletions` → `applyTombstones`), leaving only the inventory empty because that was the list mid-edit. Reported after a deploy: edit pantry on PC → reload into the new build → PC pantry empties → the empty syncs across devices.
Decision: `recordLocalDeletions()` now refuses to record a *mass* simultaneous disappearance. It computes the vanished-id set and, if it is larger than `MASS_DELETE_GUARD` (5), logs a warning and returns **without** tombstoning and **without** advancing `_idBaseline` — so a genuine delete is still caught once the state settles. Real deletes are incremental (every edit calls `saveData()`), so 1–2 ids vanish per call; a whole category vanishing at once is a load-race signature, never a real user action. The intentional "Clear All Data" (`clearLocalStorage()`) is unaffected because it tombstones every id **explicitly** before emptying the arrays, so it never relied on this inference.
Why: The exact race is timing/data-dependent and not reliably reproducible in static analysis, so the guard is defence-in-depth at the correct layer — the delete-*inference* logic — making the catastrophic "whole list wiped and propagated" outcome impossible regardless of which race triggered the transient empty. An empty list written to the cloud *without* tombstones is self-healing (the D-028 union-merge restores it from `localStorage`/another device on the next load); the tombstone is the only un-healable part, so guarding its creation is the high-value fix.
Trade-off: A legitimate bulk delete of more than five items in a single sync interval (e.g. many items deleted while offline, then reconnecting) is ignored, so those items reappear on other devices and must be re-deleted — an annoyance, not data loss, and far preferable to a phantom mass-wipe. Does not retroactively clear phantom tombstones already in a user's cloud doc; those are cleared by an explicit Export → Import (D-019 import-overrides-tombstone). Verified with `node --check`, a five-case unit test (single/small-batch delete still tombstone, whole-pantry vanish does not, post-recovery real delete works, Clear All still wipes), and Playwright smoke.
Supersedes: nothing. Hardens D-018's `recordLocalDeletions` and complements D-028's union-merge (which heals a tombstone-free empty write).

## D-030 — Field-level Firestore merge replaces the full-document overwrite
Date: 2026-07-08 · Status: Superseded by D-031
Context: `saveToFirestore()`'s transaction wrote the whole document with `tx.set(ref, payload)` — a full-document overwrite where `buildFirestorePayload()` is the single source of what's written. Any `AppState` field omitted from that payload (a new field a developer forgot to add) was therefore silently dropped from the cloud on every save, and the write replaced rather than merged the cloud doc. The non-transaction fallback path already used `setDoc(ref, payload, { merge: true })`, so the two write paths were inconsistent. Flagged as debt in D-010's trade-off ("does NOT fix the deeper `tx.set` full-overwrite design") and in ROADMAP Known Issues. Serves north-star goal #2 (never lose user data).
Decision: The transaction write now uses `tx.set(ref, payload, { merge: true })`, matching the fallback. Firestore merges top-level fields — those present in the payload are written (arrays still replaced wholesale, as before), those absent are preserved instead of wiped. The version-conflict union (`mergeCloudConflict`) and tombstone handling are unchanged. Separately, a `reportError()` helper forwards handled failures at the three data-integrity catches (failed save, failed load, sign-in merge) to Sentry, which was activated via the Loader Script in `index.html` (public-key URL, safe to commit).
Why: `merge:true` is a strict safety improvement — it can only ever preserve more, never wipe an unlisted field — so it removes the silent forgotten-field data-loss class at near-zero complexity by reusing the already-working fallback pattern. Error signals matter because both recent data-loss bugs (D-028, D-029) were found reactively; with real users arriving, a swallowed sync failure must surface instead of dying in a console line.
Trade-off: `merge:true` does not deep-merge arrays (a version conflict still resolves element-level via the union path) and does not stop a transiently-empty array from overwriting a populated cloud array — that residual is self-healing via D-028's union-merge on the next load and was deliberately deferred (the "don't shrink a cloud list to empty" write guard). Real Firestore write behaviour can't be unit-tested locally; confidence rests on mirroring the fallback path already running in production, plus `node --check` and Playwright smoke.
Supersedes: resolves the "full-document overwrite" gap in ROADMAP Known Issues and D-010's deferred trade-off. Hard Rules 5–6 and the D-010 `cloudReady` write guard are unchanged.

## D-031 — Revert to full-document Firestore write; `merge:true` broke tombstone clearing (reverses D-030)
Date: 2026-07-08 · Status: Active
Context: D-030 switched `saveToFirestore()`'s transaction write to `tx.set(ref, payload, { merge: true })` to stop a forgotten `buildFirestorePayload()` field being wiped. But Firestore's `merge:true` deep-merges MAP fields and never removes keys absent from the payload. The `deletions` tombstone map is a map field, so clearing a tombstone (`delete AppState.deletions[id]`, which import does per D-019) stopped propagating to the cloud — the stale key survived the write. On the next sync/reload, `applyTombstones()` read that surviving tombstone and re-deleted the freshly-imported item. Symptom: "imported data disappears after ~a minute" (a realtime-sync tick, or another device's auto-save, re-reading the un-cleared cloud `deletions`). D-030's premise that `merge:true` "only ever preserves more, never wipes" was wrong for map key-removal.
Decision: Revert both write paths (the transaction `tx.set` and the non-transaction `setDoc` fallback) to a full-document write (no `merge:true`), which REPLACES the whole document — so the `deletions` map is replaced and a cleared tombstone is actually removed. Restores the pre-D-030 behaviour under which import was durable (D-019, verified 2026-07-02). The `profiles/{uid}` displayName write keeps `merge:true` (a different doc with no `deletions` map — correct there). D-030's Sentry / `reportError()` half is unaffected and stays.
Why: The bug is active data loss (re-imported items vanish); D-030's benefit was a theoretical forgotten-field wipe that has never actually occurred. Correctness of tombstone clearing outweighs speculative forgotten-field protection. Keeping `merge:true` but force-replacing `deletions` via `FieldValue.delete()` per removed key was rejected as unjustified complexity for a non-problem.
Trade-off: The forgotten-field gap D-030 addressed is back — a field omitted from `buildFirestorePayload()` won't sync to the cloud (it still persists in localStorage). Accepted as a minor, developer-visible risk; a build-time assertion that the payload covers all synced `AppState` keys is the right guard if it ever matters, not a runtime merge. Real Firestore write behaviour isn't unit-testable locally; confidence rests on this being the known-good pre-D-030 behaviour plus `node --check` and Playwright smoke.
Supersedes: D-030. Re-frames the ROADMAP "full-document overwrite" note as an accepted design choice rather than a gap to close.

## D-032 — Risk-gated auto-merge: reversible work auto-ships, red-zone work is held for a human
Date: 2026-07-11 · Status: Active
Context: D-027 made an approved review auto-merge and deploy, which is the right default — hand-reviewing every CSS tweak is pure friction, and the human wants continuous, low-friction shipping ("revert if something breaks"). But "just revert it" is only true for **code**. This week proved the exception the hard way: the `merge:true` change (D-030) passed a careful review, auto-shipped, and silently made imported data vanish. Reverting the code (D-031) fixed *future* imports — it could not un-delete data already lost. The same week, a load-race tombstoned an entire pantry (D-029). Data loss is the one failure class that a revert cannot undo, and "never lose user data" is north-star goal #2. Meanwhile the automated reviewer is the same reviewer (Claude) either way, so "we already have review" does not make the data surface safe to auto-ship unwatched.
Decision: Split the approved verdict into two landing states, chosen by **blast radius, not confidence**. `done` = approved AND reversible (UI, CSS, copy, additive non-data features) → auto-merges and deploys, exactly as D-027 does today. `approved` = approved BUT red-zone (Firestore / sync / storage, the tombstone-merge-deletion machinery, `saveData()` / the `cloudReady` write-guard, auth, security, or the AI Dev OS / automation itself) → **held**: `main` is not merged, the branch is reported, and the human merges after a glance. Rework stays `codex`. When torn, choose `approved`. The reviewer states which gate it picked, and why, in `REVIEW.md`.
Why: This needs almost no new machinery — `Run-Claude-Review.ps1` already gates auto-merge on exactly one condition (`if ($newStatus -eq 'done')`), and `approved` was already an unused state in the status legend. So the gate is a reviewer *rule*, not new pipeline: the only code change is the review prompt (teach it which status to pick) plus an explicit `approved` branch that reports "HELD for your merge" instead of falling through to a generic message. Keeps ~80% of work auto-shipping at zero friction while putting a 30-second human glance on the ~20% that can cause irreversible harm.
Trade-off: Red-zone tasks no longer ship hands-off — they wait on the human, so a walk-away `/go` can end with an un-merged branch. That is the point. Mis-classification is possible (the reviewer decides), which is why the tie-break is biased to `approved`. Enforcement lives in the review prompt, so a reviewer that ignores the rule can still set `done` on a data change; the guard is a convention, not a hard interlock.
Supersedes: nothing. Refines D-027 (auto-merge stays, but only for `done`) and complements D-023's risk tiers. Pairs with the operator habit of periodic data Export — the only real undo for the red zone.

## D-033 — Sleep by default, wake to work: the dispatcher wakes the PC instead of requiring it to stay on
Date: 2026-07-11 · Status: Active
Context: The remote-control design (D-024/D-026) quietly assumed *the PC is always on*: the Command Dispatcher polled every 2 minutes with `WakeToRun` deliberately **off**, and the overnight planning run ended in `shutdown /s`. Verifying the live machine config (rather than the docs) surfaced three faults that together made remote development **impossible whenever the machine slept**: (1) the Dispatcher scheduled task was **DISABLED** (last run 2026-07-08) — Telegram commands were not being polled at all; (2) even enabled it could not wake the machine (`WakeToRun = False`); (3) the AC power plan had sleep-after-idle set to **never** — the "always on" assumption baked into hardware settings — while the overnight run could power the PC **fully OFF (S5)**, a state no Task Scheduler wake timer can recover from. Net: the human could send `/go` from their phone and nothing would ever build.
Decision: Re-wire for **sleep by default, wake to work**. (a) Command Dispatcher: enabled, `WakeToRun = True`, repetition relaxed from 2 min to **30 min** — waking every 2 minutes would defeat sleeping entirely. (b) AC sleep-after-idle: **15 min** (was never). (c) `run-claude.ps1`: the overnight `-Scheduled` end-of-run now **sleeps** the PC (`SetSuspendState`) instead of `shutdown /s` — sleep (S3) and hibernate (S4) are wakeable, a full power-off (S5) is not. (d) `Dispatch-Commands.ps1`: asserts `ES_SYSTEM_REQUIRED | ES_CONTINUOUS` for the life of the process, so a 10–15 minute Codex build dispatched from a timer-wake cannot be suspended mid-flight by the unattended-sleep timer; Windows releases it on process exit, so the PC idles back to sleep on its own.
Why: This is the only configuration that delivers what the operator actually asked for — a PC that **sleeps** (power) **and** supports **remote continuous development** (send `/go` from anywhere; work lands without them). Nothing is lost while asleep: n8n writes commands into the repo via GitHub, and `StartWhenAvailable = True` drains the whole backlog on the next wake. Wake timers were already permitted in the power plan, so no BIOS/hardware change was needed.
Trade-off: Up to ~30 minutes of latency on a remote command (the wake interval) versus ~2 minutes on an always-on PC — judged irrelevant for autonomous work nobody is watching, and the interval is a one-line change. The PC now wakes ~48×/day even with an empty queue; each wake is seconds of work before it re-sleeps on the unattended timer. Changing a scheduled task requires an **elevated** shell, so the task half of this decision must be applied by the human (command documented in `OPERATOR.md`); the power-plan and script halves are already in place.
Supersedes: nothing. Corrects D-024's "deliberately no `-WakeToRun`" choice — right under its own assumption (the PC is on anyway), wrong the moment the operator wanted the machine to sleep.

## D-034 — The AI Dev OS is a separate installable repo, and installs are verified by execution

Task: OS extraction (`ai-dev-os`) · 2026-07-13

Decision: Lift the generic OS out of this app into its own **`ai-dev-os`** repo. Apps consume it via `Install-AiDevOs.ps1 -Config apps/<app>.json`, which renders four values (`appName`, `appSlug`, `repoSlug`, `localPath`) into every machine-readable file. Re-running the installer **is** the upgrade path: it overwrites the generic set and never touches what the app wrote. Ship a **`Doctor.ps1`** alongside it that verifies an install by *executing* against reality, and wire the **Guardian Gauntlet** (`security-guardian` + `quality-guardian`) into the review gate for real.

Why: Porting this OS to a second app (ChronaSense) produced **six bugs, none of which threw an error**. n8n workflows pointed at the wrong repo — GitHub returned **200 OK** and cheerfully wrote into *this* repo. Both apps shipped workflow files with identical names, so the wrong ones were imported invisibly. The digest's source files were missing — a 404 that surfaced days later on first fire. A commit landed on a feature branch while `git push origin main` reported **success**. The fine-grained PAT was not scoped to the new repo — a 403 that only appeared on the first *write*. And this app's name was left scattered through the new app's docs, where nothing complained because docs do not execute.

The common thread is that **every failure was silent**, and a checklist cannot catch a silent failure — only execution can. So the doctor resolves the git remote, parses the workflow JSON, calls the GitHub API, and performs a **real write with the real token**, then deletes it. Anything it cannot check is reported **SKIPPED, never passed**: a gate that claims "pass" without running is worse than no gate, because it launders unverified work as verified. Verified by re-introducing all seven failures into a scratch install — the doctor catches every one, and a clean install produces zero false positives.

## D-035 — An idle `/go` triages instead of dead-ending

Task: autopilot idle behavior · 2026-07-13

Decision: `/go`'s planning phase now fires when there is **either** approved work to convert **or** new captures to triage — previously only the former (`no codex tasks AND unconverted BUILD_QUEUE > 0`). Since the planning phase already does both jobs (STEP A triages `captures/inbox` → `planning/PROPOSALS.md`; STEP B converts approved BUILD_QUEUE items → tasks), widening the trigger costs one condition and no new machinery. The summary now reports `TRIAGED n new idea(s) into proposals` and points at the next real action (`reply Approve <n>, then /go`).

Why: The old condition made `/go` a **dead end exactly when it was most needed**. With the build queue empty and ideas sitting in the inbox, `/go` replied "nothing to do" and did nothing — the captures could only be triaged by the overnight run, so an idea sent in the morning was invisible until the next day's digest. Caught live: all 13 tasks `done`, **six captures untriaged**, and `/go` idle. For a phone-first operator the whole value of one command is that it always does the next useful thing; "nothing to do" while six of your ideas rot in a queue is a broken promise, not a safe default. Approval is still the human's (Hard Rule 1) — triage only produces *proposals*, it never queues or builds anything.

Extraction itself was overdue for a structural reason: while the OS lived only here, this repo was the de facto master and every other app held a *copy* that began rotting immediately. Not hypothetical — this app's own `setup-command-dispatcher-scheduler.ps1` had silently drifted from the live D-033 config and was sitting ready to undo it the moment anyone re-ran it.

The Guardian Gauntlet was the sharpest case of the same disease: `AI-DEV-OS.md` has advertised "Build → **Guardian Gauntlet** → Document" since v1.1, but `Task` was never in the reviewer's `--allowedTools`. The reviewer had no tool with which to spawn a guardian, so it reviewed alone — for months — while the documentation asserted otherwise. Documentation that describes machinery nobody built is not aspiration; it is a false claim that stops anyone from looking.

Trade-off: Two files the manifest called "generic — per-app change: none" (`SYSTEM-OVERVIEW.md`, `AI-DEV-OS.md`) turned out to carry real app state, so the installer protects them and warns about drift rather than overwriting; OS improvements to those two must be merged by hand. The installer also **preserves `$AUTOMATION_ENABLED`** across upgrades — writing the template's value blind would either switch a validated app's overnight automation off, or switch a brand-new app's on, both silently. (This is not theoretical: it happened to ChronaSense during this very change, and the doctor is what surfaced it.) Guardians add latency and tokens to every review; a confirmed security finding now blocks approval outright, which is the point.

Supersedes: `AI-DEV-OS.md` "Not yet done — true extraction (parked)".

## D-036 — Held red-zone branches can be merged from the phone, in two steps

Task: `/merge` command · 2026-07-14

Decision: Add a `/merge` Telegram command, implemented as a phase runner (`tools/Run-Merge.ps1`) in two deliberate steps. `/merge TASK-014` replies with what the branch **touches** — the file list, the diff stat, a GitHub compare link, and the reviewer's own recorded reason for holding it, quoted verbatim — and merges **nothing**. `/merge TASK-014 yes` then runs the gates and fast-forwards `main`.

Why: D-032 holds red-zone work (data/sync/storage, auth, security, the OS itself) because a human should see what it touches before something irreversible lands. But look closely at what that gate was actually enforcing: **"be at a PC."** That was never the safety property. The safety property is **"you looked."** Being at a keyboard was incidental — and the incidental part had a real cost: a held branch could sit unmerged for days simply because the operator was away, which is precisely the friction this whole system exists to remove.

A diff reads perfectly well on a phone. So `/merge` removes the desk and keeps the looking.

The genuine risk was never the phone — it is that typing `/merge` is so cheap it becomes a **reflex**, and red-zone work gets rubber-stamped from a bus stop. That would quietly destroy the one gate protecting against unrecoverable data loss. Hence the two-step: the summary step **cannot merge anything**, so seeing what a change touches is unavoidable, while ignoring it remains a deliberate act rather than a reflex. Showing the reviewer's *own* stated reason for holding it ("Reversible in code, NOT reversible in data") is the single most useful sentence at that moment, so it is surfaced rather than re-derived.

`/merge <id> yes` is held to **exactly** the auto-merge's standard — never a lower one just because it arrived by text message: the task must be `status: approved` (never `codex`/`review`/`done`), `main` and the branch must be clean, `npm test` must pass on the branch and leave the tree clean, and `main` must be a true ancestor (fast-forward only — never a merge commit nobody reviewed).

Trade-off: one more surface that can mutate `main`. Mitigated by making the destructive step opt-in, keeping the gates identical to the proven path, and verifying every refusal (not-held task, missing branch, garbage input, dirty `main`) as well as the success path.

Found while building it: two latent bugs the OS already had. `.last-phase-result.txt` and `automation.lock` were **not gitignored in one installed app** — untracked, they permanently dirty the tree, and every merge gate in the system would then refuse to act while blaming "uncommitted changes" on a file the OS itself created. The installer now guarantees those entries and the doctor asserts them.

## D-037 — The implementer is pluggable: `builder: "codex" | "claude"`

Task: Claude-only build path · 2026-07-14

Decision: Make the build step's engine a config value. `builder: "codex"` runs `codex exec` (the default, unchanged). `builder: "claude"` runs a headless `claude -p` implementer instead. Everything else in `Run-Codex-Build.ps1` — branch isolation, the clean-main preflight, the tracked-task snapshot, the commit-scope guard, the 20-minute timeout kill, the blocked-task classification, the auto-chain into review — is engine-agnostic and untouched. Only the process that gets started changes.

Why: Codex was the *only* thing in this OS that a Claude-only user could not run. Planning, triage, review, the Guardian Gauntlet, the dispatcher, `/merge`, the digest — all Claude or plain PowerShell. One invocation, in one file, was the entire barrier between this system and anyone who has Claude Code but not Codex.

And what that barrier costs is not a nice-to-have: without a headless implementer, `/build` and `/go` cannot run at all, which means no remote loop. The point of this system is that you can suggest an improvement on a commute, or while waiting for an order, and it is live before you get home. A pipeline that requires you to be at the keyboard to build is a different, much smaller product.

The honest trade, stated plainly: with `codex`, the model that **writes** the code is not the model that **reviews** it, so their blind spots do not line up. With `claude`, they do — if the builder misreads a task, the reviewer is more likely to misread it the same way. That is a real weakening of the review gate and it should not be hand-waved.

What survives is the part that carries most of the weight. The builder and reviewer are **separate processes**, with separate prompts and **zero shared context** — the reviewer never sees the builder's reasoning, only the diff, so it cannot inherit the builder's rationalisations for a shortcut. And crucially they have **different tool grants**: the builder gets *no git tools whatsoever*. It cannot commit, cannot push, cannot merge, and cannot set its own task to a status the reviewer never granted. The runner commits; the reviewer (which has no Edit/Write on app code) judges; two guardians audit; the D-032 risk gate still refuses to auto-merge anything irreversible. That is a far stronger gate than the realistic alternative for a Claude-only user, which is one session doing everything and grading its own homework.

Found while building it: `codex` is a real `.exe`, but `claude` is an npm shim (`claude.ps1`). `System.Diagnostics.Process` with `UseShellExecute = false` **cannot start a script by bare name** — it throws `Win32Exception`. A Claude-only user would have hit that on their very first `/go`, with a stack trace and no explanation. Launching via `cmd.exe /c` resolves the shim exactly as a human typing `claude` in a terminal does. The doctor now also asserts that the *configured* builder is on PATH, because installing a pipeline whose build step can never run is precisely the failure this OS keeps producing: capability that is documented, believed, and impossible.

Verified end-to-end: a headless Claude builder took a real failing task (a missing `shout()` export that `npm test` demanded), implemented it on an isolated `task-001` branch, made the tests pass, appended `CHANGELOG.md` and `TEST_REPORT.md` evidence, set `status: review`, and handed off — in 46 seconds, with no human present.

## D-038 — macOS support: launchd, and the Mac deliberately does NOT sleep

Task: macOS port · 2026-07-14

Decision: Run the OS on macOS via PowerShell 7 (`pwsh`) and **launchd**, and on macOS the machine **stays awake** rather than sleeping between runs.

Why the machine stays awake — this is the whole decision, and it is not a translation of the Windows behaviour: **macOS has no `WakeToRun`.** Windows sleeps deeply and is woken every 30 minutes by a Task Scheduler wake timer (D-033), which is what makes remote `/go` work while the PC is off. macOS offers only `pmset repeat wakeorpoweron`, which supports **exactly one repeating wake per day** — a 30-minute wake cadence is simply not expressible.

So a sleeping Mac would sit on a queued `/go` until somebody physically touched it. **Silently.** No error, no reply, the command just never runs — which is precisely the class of failure this OS exists to make impossible, and precisely why D-033 stopped using `shutdown /s`.

Given that, the Mac stays awake (`sudo pmset -a sleep 0 displaysleep 10`) and launchd's 30-minute `StartInterval` fires reliably. On a Mac mini — a desktop that sits there anyway, idling around 7W — that is the right trade: a few watts for a remote loop that actually works. The display still sleeps. The doctor **fails** if `pmset` reports a non-zero sleep timer, because a Mac configured to sleep has a dispatcher that will never fire and no way to know it.

What changed, and nothing more: `cmd.exe` → `/bin/sh` (3 sites), `taskkill /T` → `pkill -P` (1 site), `SetThreadExecutionState` → `caffeinate -i -w $PID` (which is tied to the process lifetime exactly as `ES_CONTINUOUS` is, so the Mac idles back on its own), `rundll32 powrprof` → no-op, and `Register-ScheduledTask` → launchd plists in `~/Library/LaunchAgents`. Every guard, gate, guardian and workflow is untouched — they never knew what OS they were on.

Platform detection is `$OnWindows = if ($null -eq $IsWindows) { $true } else { $IsWindows }`, and the null check is load-bearing: **Windows PowerShell 5.1 does not define `$IsWindows`**, so it is `$null`, which is *falsy*. A naive `if ($IsWindows)` would take the macOS branch on every existing 5.1 install and break all of them — a one-character bug that would have shipped silently.

Trade-off, stated honestly: **this is the first thing in this OS that has not been verified by execution.** There is no Mac on the machine it was written on. What *was* verified: every script parses, both generated plists are well-formed XML (a malformed plist does not error — launchd just silently declines to load the job), the detection expression returns `True` on PS 5.1, and both existing Windows apps still pass 24/24 with zero changes. What was **not** verified: that `launchctl bootstrap`, `pmset`, `caffeinate`, and `/bin/sh -c claude` actually behave as intended on real hardware. The doctor is the safety net — it is platform-aware and will fail loudly rather than let a Mac user believe a dead install is working. First Mac user reports back; we fix what breaks.

## D-039 — The overnight run notifies on failure instead of failing silently

Task: silent Preflight/halt failures · 2026-07-15

Context: Preflight aborts and mid-run halts in `run-claude.ps1` only ever wrote to `claude-session.log` (and, for halts, `STATUS.md`) — there was no Telegram notification path, since this script has no Telegram command/reply to attach one to. That silence let the overnight run abort on a dirty working tree for at least three consecutive runs (2026-07-14 02:00 and 21:00, 2026-07-15 02:00) before a human noticed — and it was only noticed because `planning/DIGEST.md`'s date was stuck on 2026-07-05, ten days stale.

Decision: Add `Send-Notification` to `run-claude.ps1` — on any Preflight abort or mid-run halt, append an entry to `captures/replies/OUTBOX.md` (the exact outbox `n8n-telegram-replies.json` already polls every ~2 min) and, only if already on a clean `main`, commit + push just that one file. Best-effort and wrapped so it can never itself fail the abort/halt path it's called from; deliberately does **not** try to fix a wrong-branch failure by switching branches — that would be the same auto-remediation Preflight already refuses to do everywhere else.

Why: A safety gate that fails silently is only half a safety gate. Preflight and the commit-scope guard were working exactly as designed the whole time — refusing to proceed rather than guessing — but "refuse and say nothing" let a real failure compound, unnoticed, for over a week.

Trade-off: None of the existing safety behavior changes; this only adds a notification on top of failures that already happen. Reuses the existing outbox/relay infrastructure rather than inventing a second delivery path.

Supersedes: nothing.

## D-040 — Automation-surface tasks are Claude's to build directly, never Codex's

Task: `tools/` deny-list vs. self-modifying tasks · 2026-07-15

Context: TASK-014 (a correctly-scoped fix to `tools/Dispatch-Commands.ps1`) was authored with `owner: codex`, built correctly by Codex, tested by Codex — and then permanently blocked from ever being committed, because Codex's own commit-scope guard (see `docs/09-automation.md`) explicitly deny-lists `tools/` and "this repo's own automation scripts" as outside Codex's legitimate write surface. This is not a transient failure: every future attempt at a `tools/`-touching task hits the identical wall, confirmed live while building TASK-014, 015, and 016 in the same session.

Decision: Any task whose `files:` touch `tools/`, `run-claude.ps1`, `.claude/`, `AGENTS.md`, `CLAUDE.md`, `docs/`, `planning/`, `captures/`, `library/`, or `config/` is never assigned `owner: codex` / `status: codex`. Claude implements it directly instead — still landing at `status: approved`, held for a human `/merge` (D-032), never auto-merged, same review discipline as any other red-zone change. Enforced two ways: (1) Claude's own task-authoring practice, documented here; (2) a deterministic check added to `run-claude.ps1` right after Phase 2 (Plan Conversion) that scans any newly-written `status: codex` task for a denied file path and automatically flips it to `status: blocked` with an explanatory note — covering the unattended overnight path, where no human or interactive Claude session is present to catch the mistake before it's made.

Why: The guard itself is correct and should not be loosened — letting an autonomous, unattended agent freely rewrite the safety code that constrains it is a real risk, not a hypothetical one. The actual gap was routing: nothing stopped a task like this from being written with `owner: codex` in the first place. A documented convention alone only protects the interactive path (a human/Claude conversation); the deterministic check also protects the autonomous overnight Plan-Conversion step, where the planning LLM session has no guarantee it applies this rule on its own — matching the "code for deterministic transforms, not LLM judgment" principle already used everywhere else in this pipeline.

Trade-off: When Claude implements one of these directly, the same session that writes the code also reviews it — the "different model builds vs. reviews" safety property (see D-037's own honest framing of the identical trade-off) does not hold for this class of change. Mitigated by still holding it at `approved` for a human `/merge` rather than auto-shipping, and by stating this explicitly in each task's own review note (see TASK-014, TASK-017).

Supersedes: nothing. Extends D-023 (risk tiers) and D-032 (red-zone hold) to a case neither anticipated: work that is both correctly-scoped red-zone material *and* structurally undoable by the normal Codex build path.

Addendum (TASK-019, found while landing it): when Claude implements one of these directly, the
task's `TASKS.md` entry (and any `docs/DECISIONS.md` record) must be committed to `main` directly, in
its own commit — never bundled into the task branch's own commit alongside the code. `/merge` reads
`TASKS.md` from whatever is currently on `main` at invocation time; if the task entry only exists on
the held branch, `/merge TASK-X` fails outright with "TASK-X is not in TASKS.md" even though the code
is fully ready. Cost ~15 minutes to diagnose the first time (TASK-019's own landing) before the
pattern was recognized and corrected. See docs/AI_OS_NOTES.md's 2026-07-16 entry.

## D-041 — Splat phase-runner args as a hashtable, never an array

Task: `/merge` crash + silent `-DryRun` failure · 2026-07-15

Context: `Dispatch-Commands.ps1`'s `Invoke-MergePhase`, `Invoke-BuildPhase`, and `Invoke-ReviewPhase` all built an array (e.g. `@('-TaskId', $taskId)`) and passed it to a phase-runner script via `@a` splatting, assuming this would bind named parameters the same way a hashtable splat does. It does not: PowerShell array splatting is purely positional, confirmed empirically across a plain function, a builtin cmdlet, and script files with both switch-only and mandatory-positional parameter sets. For `Invoke-MergePhase`, `'-TaskId'` itself got bound to `Run-Merge.ps1`'s mandatory `$TaskId` parameter, leaving the real task id nowhere to go — every `/merge` command crashed the entire dispatcher (confirmed live: `/merge` has never worked over Telegram since D-036 shipped it the day before). For `Invoke-BuildPhase`/`Invoke-ReviewPhase`, there was no competing mandatory parameter, so it didn't crash — it just silently never activated `-DryRun` at all, with no error.

Decision: All three now build a hashtable (`$a = @{ TaskId = $taskId }`, `if ($confirmed) { $a['Confirm'] = $true }`, etc.) and splat that instead. Verified directly against the real target scripts (not just isolated repros): `/merge TASK-014` (summary), `/merge TASK-014 yes` (Confirm, with a forced `-DryRun` for safety during verification), and `Run-Codex-Build.ps1 -DryRun` / `Run-Claude-Review.ps1 -DryRun` via the fixed pattern all bind correctly now.

Why: A crash is at least loud. The `-DryRun` case is the one that should worry more: a safety-preview flag that silently no-ops, with zero error, is exactly the kind of failure this whole system is built to avoid elsewhere (see D-039's identical "silent failure" framing for the overnight run). Nobody had hit it yet only because `-DryRun` had never been exercised through the live Telegram path before tonight — every prior test of it was a direct manual invocation, which bypasses this code entirely.

Trade-off: Same bootstrapping problem as `/merge` itself needing to exist before it can be used to land its own fix — this could not be held for `/merge` the way TASK-014/015/016/017 were, since `/merge` was the thing broken. Written directly by Claude for the same `tools/` reasoning as D-040, landed directly rather than held, with the reasoning disclosed in the commit and here rather than silently skipping the usual gate.

Supersedes: nothing. A general PowerShell-correctness fix; any future phase-runner call added to this file should use hashtable splatting from the start, not array splatting with embedded `-Name` strings.

## D-042 — Decision:Approve + Risk:Low auto-promotes with no human reply needed

Task: less-babysitting redesign · 2026-07-15/16

Context: Hard Rule 1 ("nothing builds without human approval") applied uniformly to every capture, regardless of how trivial or clearly-good Triage judged it. The human explicitly asked for less role in the loop, "as much as possible." Pushed on directly (chaos-tested): the real risk isn't that Triage's code-safety judgment is untrustworthy — the reviewer already re-checks the actual diff independently, before anything merges, regardless of this decision — it's that (a) a musing sent to "capture, don't think" could get built without the sender ever confirming they meant it, and (b) D-032's red-zone list (data/sync/storage/auth/security/the OS) was built for "is this safe to revert," not "is this something you'd want asked about" (pricing, tone, tracking, a new dependency are all reversible yet arguably worth a say). Both were named explicitly; the human chose to accept them as the cost of less friction rather than have either resolved first.

Decision: Every proposal now carries a second lead field, `▶ Risk` (Low | High), using the exact D-032 criteria, filled by Triage at idea time instead of only at merge time. `Decision: Approve` + `Risk: Low` auto-promotes straight into `BUILD_QUEUE.md` — `tools/Invoke-AutoPromote.ps1`, deterministic, no LLM judgment at the promotion step itself. Anything else (any other Decision, `Risk: High`, or a proposal with no Risk field — e.g. one written before this existed) is completely untouched and still needs a human Approve/Park/Reject/Clarify reply, exactly as before. The build → review → merge pipeline downstream is entirely unchanged: Codex still builds it, Claude still reviews the actual code, and D-027/D-032 still decide auto-merge vs. held-for-`/merge` purely on the reviewer's own read of the diff — auto-promotion only ever removes the idea-approval step, never the code-review step.

Why: The two Claude checkpoints (Triage judging the idea, Reviewer judging the code) are structurally identical whether or not a human also approves the idea in between — what changes is only whether the human is asked, and when. Given that, and given the human's explicit, informed preference for less role, extending D-027's already-accepted "Claude-judged non-risky → ship it, revert if wrong" logic one step earlier (from build→merge to capture→build) is a coherent extension of a principle already in production, not a new one.

Trade-off: Accepted knowingly, not resolved — (1) capturing something can no longer be trusted as risk-free from ever becoming a shipped feature; "just naming it" and "asking for it" are no longer reliably different acts for Low-risk ideas. (2) D-032's red-zone list, reused here, does not cover every category a human might want a say in beyond data-loss risk (pricing, branding, third-party tracking, new dependencies). (3) Auto-merged work landing more frequently, unattended, makes an evening "does this look right" review noisier to attribute if something feels off. All three were raised before this landed; none blocked it.

Supersedes: nothing. Extends D-027 (non-risky auto-merges after review) one stage earlier, using the identical risk criteria D-032 already established.

## D-043 — `/audit`: on-demand, cost-gated by diff not by time, feeds the same auto-promote gate

Task: less-babysitting redesign, "no idea" case · 2026-07-15/16

Context: The human wanted `/go` to do something useful even with nothing to suggest — not just reply "nothing to do." A naive design (scan the app on every idle `/go`) was rejected live: a week of brain fog with no ideas could mean dozens of full-app scans for zero new information. A time-based cooldown (once a day/week) was considered and also rejected — the human's own counter-proposal was better: gate by whether the app actually changed, not by a calendar.

Decision: `/audit` triggers two ways — a human sends it directly, or `/go`'s autopilot falls back to it automatically, but only when genuinely nothing else is queued (no `status: codex` task, nothing unconverted in `BUILD_QUEUE.md`). Before any LLM call, `tools/Run-Audit.ps1` runs a plain `git diff <last-audited-commit>..HEAD -- app.js index.html style.css`. Empty diff → reply "nothing changed" and exit, zero tokens spent, however many times `/go` is pressed. Non-empty diff → a real Claude session, but handed only the diff plus `planning/AUDIT_SUMMARY.md`'s persisted notes, never the whole app again — except one full re-scan every 30 days flat (a single rule, not a count-or-time combination), so the incrementally-maintained summary's drift can't compound forever uncorrected. Findings are written using the identical Proposal contract a human capture produces (`▶ Decision` + `▶ Risk`), so they flow through the exact same D-042 auto-promote gate — `Run-Audit.ps1` calls `Invoke-AutoPromote.ps1` itself immediately after writing findings, so a Low-risk finding is queue-ready in the same run, and `Invoke-Autopilot`'s idle path plans it into a real task right away too, so the same `/go` press that triggered the audit can also build it: find-and-build, not find-then-wait.

Why: Gating by actual change is a more honest answer than picking an arbitrary interval — cost tracks what there actually is to look at, not elapsed time or number of button presses. This is also why `TASK-015` (`/suggest`, a cheap "what's pending" recommender) was dropped entirely rather than built: once nothing routine sits pending waiting for approval, there's nothing left for it to recommend in the common case.

Trade-off: The 30-day full-refresh boundary is a judgment call, not a derived number — chosen for a predictable, low cost ceiling (at most one full-price scan a month) over a more complex adaptive rule. The `git diff`-based gate is a reasonable proxy for "anything worth looking at changed," not a precise one (e.g. a pure comment-only diff still triggers a real session).

Supersedes: nothing. Builds on D-042 (the auto-promote gate this feeds) and reuses `run-claude.ps1`'s Preflight/commit-scope-guard shapes rather than inventing new ones.

## D-044 — `/merge`'s fast-forward gate auto-rebases the branch instead of just refusing

Task: TASK-019, found while landing TASK-014/TASK-016 · 2026-07-16

Context: `/merge TASK-X yes` blocked repeatedly with "main is not an ancestor of task-X (it moved on). Rebase the branch, then /merge again" — even immediately after the branch had been freshly rebased onto main by hand. Root cause, confirmed live by reading `claude-session.log` and the exact commit sequence on `main`: `Dispatch-Commands.ps1` commits an administrative "command received" marker to `main` immediately before dispatching to any handler, including `/merge` — its own Preflight requires a clean tree, and the freshly-arrived command file is itself an uncommitted change the moment n8n writes it. That marker commit advances `main` by exactly one commit every single time, so by the moment `Run-Merge.ps1` checks whether `main` is an ancestor of the branch, `main` has already moved past whatever it was when the branch was last rebased — regardless of how current the branch actually was seconds earlier. This is structural, not incidental: no `/merge` could ever succeed through the normal dispatch path for this reason alone, independent of the branch's real content.

Decision: `Run-Merge.ps1` now auto-rebases the branch onto `main` when the ancestor check fails, before running `npm test`: checkout the branch (already done for the dirty-tree check), `git rebase main`, and on a clean result `git push --force-with-lease origin <branch>` and continue the merge as normal. A real conflict aborts the rebase, checks out `main`, and blocks with the same "resolve by hand" message as before — the auto-rebase only removes the self-inflicted, no-real-content-changed case; it does not weaken the gate for an actually-stale or actually-conflicting branch. The later ancestor check right before the real fast-forward (line ~224) is left in place as a final safety net for the rare case where something else lands on `main` during the `npm test` window.

Why: The fast-forward-only design's whole point is "never a merge commit main didn't earn cleanly" — but the dispatcher's own bookkeeping was defeating that design's only escape hatch (a human rebasing by hand) by re-breaking it before the human's fix could ever be observed as sufficient. Automating the rebase for the conflict-free case is exactly the "less babysitting" principle already applied to auto-promote (D-042) and `/audit` (D-043): a human should only be asked to look at a *real* conflict, never at bookkeeping noise the system created itself.

Trade-off: `git push --force-with-lease` to the task branch (never to `main`) is required for this to work — `main` itself is never rewritten, preserving the property every other decision here depends on (main is append-only, safe for any clone to pull). Verified the two new code paths (clean rebase, conflicting rebase) in an isolated scratch repo before landing, since this touches the merge gate itself and a bug here is unusually expensive to discover.

Supersedes: nothing. Tightens the mechanics of D-032/D-036's fast-forward-only gate; does not change what `/merge` requires or when it holds vs. auto-merges.

Addendum (TASK-020, same day): the auto-rebase step's first real run crashed the whole dispatcher. `Run-Merge.ps1` sets `$ErrorActionPreference = 'Stop'` at the top; under that setting, PowerShell promotes ANY stderr text from a native command into a terminating exception, even a fully-successful `git rebase` printing its ordinary "Rebasing (1/1)" progress line. `Run-Merge.ps1`'s own `Invoke-Git` was a bare `git @args` passthrough with none of the EAP-lowering protection `Dispatch-Commands.ps1`'s sibling helper already had — every other git call in the file had simply never happened to write to stderr, so the gap stayed invisible until `git rebase` (which always writes progress there) exercised it. Fixed by lowering `$ErrorActionPreference` to `'Continue'` for the duration of each git call, matching `Dispatch-Commands.ps1`'s pattern, without swallowing stderr at the source so the auto-rebase conflict message can still capture it via its own `2>&1`. Verified under the exact `$ErrorActionPreference = 'Stop'` context (the earlier isolated-repo test for D-044 itself had NOT reproduced this, since it ran outside that context — the gap in that first verification is itself worth remembering: match the real script's preference context, not just its commands, when testing PowerShell error-handling changes).

## D-045 — Docs-vs-code consistency checker: deterministic grep, not another LLM pass

Task: TASK-021, first of three "treat prose knowledge as infra" follow-ups · 2026-07-16

Context: Discussed as part of the same session's "less babysitting" push — prose-encoded knowledge (`CLAUDE.md`, `docs/DECISIONS.md`, architecture docs) has no self-checking mechanism analogous to lint or type-checking for code, so it silently rots exactly the way tribal knowledge used to. First real proof this isn't hypothetical: `docs/ARCHITECTURE.md`'s "Safety / cross-cutting" section still said "shared content passes `stripTagsDeep()`" — that function (and the entire "shared recipes" import feature it protected against stored XSS) was removed together in an earlier "remove dead code" commit. Not a live security hole (the vulnerable import path is gone too), but a doc confidently describing a safety mechanism that no longer exists is exactly the failure mode this whole discussion was about.

Decision: `tools/Check-DocsConsistency.ps1` — a plain, deterministic script, no LLM call (CLAUDE.md's own rule: "if code can answer, code answers"). It extracts backtick-quoted spans from `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, and `CLAUDE.md`, filters out wildcards/multi-word prose/file references/decision-and-task cross-references, and checks whether each remaining bare identifier still appears somewhere in the code files that doc actually describes. `docs/ARCHITECTURE.md`/`DATA_MODEL.md` check against `app.js`/`index.html`/`style.css` only; `docs/DECISIONS.md`/`CLAUDE.md` check against those PLUS `run-claude.ps1`, `AGENTS.md`, and every `tools/*.ps1`, since those two docs describe the automation layer as much as the app. Standalone script for now, not wired into `/audit` or any Telegram command — deliberately, to keep this addition's blast radius to zero until it's proven useful over a few real runs.

Why: A grep-based check can't judge whether documented BEHAVIOR still matches code (that needs real understanding), but it can cheaply catch the much narrower, much more common failure of a doc naming something that flatly no longer exists — which is exactly what caught `stripTagsDeep()`. Deliberately permissive (skip on any doubt) rather than a full parser: false negatives are acceptable, false positives train people to stop reading the output, the same lesson D-043 already learned about `/audit`'s diff-stat filtering.

Trade-off: First real run also surfaced ~8 items that are NOT drift — references to a separate `ai-dev-os` repo's config schema (`appName`, `appSlug`, `repoSlug`, `localPath`) and one illustrative example (`shout()`) inside `docs/DECISIONS.md` prose. Filtering those out reliably would need either cross-repo awareness or example-vs-real-code judgment — both are LLM territory, which defeats the "deterministic, free" point of building this at all. Left as-is: a human skimming ~9 lines once in a while to dismiss obvious non-issues is a fair trade against the alternative (an LLM call every run, or missing the real finding entirely).

Supersedes: nothing. New, standalone capability alongside `/audit` (D-043) and auto-promote (D-042), not a replacement for either.

## D-046 — `DECISIONS.md` gets an optional, non-executable `Verify:` pointer per entry

Task: TASK-022, second of three "treat prose knowledge as infra" follow-ups · 2026-07-16

Context: D-045's checker catches "this identifier doesn't exist anywhere anymore" for free, with no per-entry authoring — but that's a narrow net. Some decisions are wrong in a way pure existence-checking can't see: D-010's write guard is only actually honored if `saveToFirestore()` still checks `AppState.cloudReady` specifically, not just if the word appears somewhere in the file; D-003's dual-write is only real if `saveData()` still calls both `saveToLocalStorage()` and `saveToFirestore()`. A decision record that describes a guarantee should be able to say, in one line, how a machine would confirm that guarantee still holds — the same instinct as a test asserting a specific behavior, not just that a module imports without crashing.

Decision: Any `docs/DECISIONS.md` entry may carry one or more `Verify:` lines, in a small, deliberately non-executable DSL: `Verify: <file> contains "<literal text>"` or `Verify: <file> does not contain "<literal text>"`. No shell commands, no regex, no `eval` — a decision record is prose that people and models read and trust, and the check itself has to stay exactly as inspectable as the prose around it. `tools/Verify-Decisions.ps1` parses every `Verify:` line across the file, runs each one, and reports any that fail. Added three real pointers as the first working examples: D-003 (both write paths still present), D-005 (`patchMissingNutrition(` still exists), D-010 (`AppState.cloudReady` still referenced).

Why: This is optional and additive by design (CLAUDE.md's Simplicity First: "no features beyond what was asked, no configurability that wasn't requested") — retrofitting all ~45 existing entries would be a large, low-value effort for decisions unlikely to silently regress. A `Verify:` line earns its keep only on a decision whose correctness genuinely depends on something specific enough to name.

Trade-off: The DSL is deliberately weak (literal substring only, no regex, no "check this function's body does X") — it can confirm a guard clause's KEY PHRASE still exists, not that the guard's logic is still correct. That's the same trade D-045 made: a narrow, always-safe check beats a powerful one that needs an LLM (or worse, `eval`) to run.

Supersedes: nothing. Sibling to D-045, not a replacement — D-045 catches broad identifier drift automatically; this catches specific, human-flagged correctness claims.

## D-047 — Retry the OUTBOX/command-file push instead of silently dropping it on rejection

Task: TASK-024, fixing the recurring friction logged in `docs/AI_OS_NOTES.md` · 2026-07-16

Context: `Dispatch-Commands.ps1`'s two per-command commit+push sites — the "received" status marker on `captures/commands/*.md`, and the reply append to `captures/replies/OUTBOX.md` — never checked whether the push actually succeeded. n8n's independent reply-clearing step (`n8n-telegram-replies.json`) polls and pushes to the same `OUTBOX.md` on its own schedule, uncoordinated with this script. Whenever the two land close together, the dispatcher's push is rejected (non-fast-forward) and, since the result was never checked, the commit sits orphaned in the local clone — later surfacing as a confusing, unrelated-looking rebase conflict on whatever task branch happens to be rebased next. Hit five separate times in one session (see `docs/AI_OS_NOTES.md`'s 2026-07-16 entry), each time requiring a human/Claude to manually diagnose "is this orphaned commit's content already delivered, safe to discard?" before proceeding.

Decision: A shared `Invoke-CommitPushWithRetry` helper wraps both commit sites. On push rejection, it fetches origin, `git reset --hard origin/main` (discarding the just-created local commit), then re-runs a `Reapply` scriptblock that re-derives the SAME change from values already in scope (never from the stale pre-reset file) and retries — up to 5 attempts with a short increasing backoff. This is always safe because the discarded commit only ever touched a file this script alone owns the write path for, and was never seen or acted on by anyone else (it never reached origin).

Why: The two commits this touches only ever change a status field or append a reply — there is no meaningful content to reconcile, only a fast-forward race to win. Retrying with a fresh re-derivation is strictly better than either the old silent-drop behavior or a git-level conflict resolution (which nearly always hit an unresolvable content conflict, since one side's "append" and the other's "clear" touch the exact same lines).

Trade-off: Verified against a real simulated race (two git clones plus a bare "origin," one racing a conflicting push ahead of the other) rather than trusting the logic on inspection alone — D-044's own addendum (TASK-020) already showed that skipping this step misses real bugs. `MaxAttempts = 5` is a judgment call, not a derived number, chosen to comfortably exceed the race window actually observed (a few seconds) without risking a long hang if something is more persistently wrong.

Supersedes: nothing. Closes the gap the D-040 addendum and `docs/AI_OS_NOTES.md` both flagged as not-yet-fixed-at-the-root.

Addendum (TASK-030, 2026-07-17): this decision's own reset-based retry destroyed a real, already-completed merge the first time a `/merge` happened to race the same OUTBOX-clearing window it was built to survive. Sequence: `Run-Merge.ps1` fast-forwarded `main` to a held branch and committed the status-flip, but its own `git push origin main` (never retried — no `Invoke-CommitPushWithRetry`-equivalent existed there) was rejected by an unrelated commit landing first. `Run-Merge.ps1` reported the honest "MERGED into local main, but PUSH FAILED, push it yourself" message and exited. Control returned to `Dispatch-Commands.ps1`, which then wrote the Telegram reply via `Invoke-CommitPushWithRetry` — that push was *also* rejected (same race, still open), so its retry did `git reset --hard origin/main` per this decision's own design. That reset silently discarded the still-unpushed merge sitting underneath, because this decision's safety argument ("the discarded commit only ever touched a file this script alone owns... never seen by anyone else") holds for `Invoke-CommitPushWithRetry`'s own two commit sites, but was never true for `Run-Merge.ps1`'s separate, unprotected push — nothing here checked whether *other* real work was sitting unpushed on the branch before nuking it back to origin's tip.

Fix (in `Run-Merge.ps1`, not this file's own retry logic): give the final `push origin main` its own bounded retry loop (`MaxAttempts = 5`, matching this decision's convention) — but rebase onto the fresh `origin/main` tip on rejection, never reset. A rebase is safe here specifically because these two commits (the ff-only merge, the status-flip) are real, self-contained content, not a message this script can cheaply regenerate from live values the way `Invoke-CommitPushWithRetry`'s callers can — discarding them isn't an option, so preserving them via rebase-and-retry instead of reset-and-regenerate is the correct trade for this specific call site. Verified against a simulated version of the exact failure (a bare origin plus two clones; one pushes an unrelated commit first, the other holds the "merge" commit and runs the same retry-with-rebase loop): the retry correctly recovered on its second attempt, and BOTH commits — the racing one and the one this decision's original reset would have destroyed — survived to origin.

This addendum does not change `Invoke-CommitPushWithRetry` itself; its two existing call sites (the received-marker, the OUTBOX reply) are still correctly scoped to messages they can freely regenerate. The gap was specifically that `Run-Merge.ps1`'s push was the one commit site touching `main` with real, non-regenerable content and no retry of its own — closing that removes the window in which this decision's reset could ever find something else unpushed to destroy.

Addendum (TASK-031, 2026-07-17): `Run-Merge.ps1` was never the only site with this shape — it was just the one that happened to get hit first. A full audit of every `push origin main` call site across the automation surface (`grep -rn "push origin main" tools/*.ps1 run-claude.ps1`) turned up six more, all equally exposed, none yet caught live:

- `Run-Claude-Review.ps1`'s `Invoke-AutoMerge` — the auto-merge path for every reversible (`status: done`) task, the highest-traffic push-to-main site in the whole system, since it fires far more often than the red-zone `/merge` path `Run-Merge.ps1` guards.
- `Run-Audit.ps1` — every `/audit` run or idle `/go` fallback.
- `Dispatch-Commands.ps1`'s `Publish-TasksChange` and `Set-AutomationFlag` — the two most exposed of all, since both run earlier in the *same* `Dispatch-Commands.ps1` invocation that later calls `Invoke-CommitPushWithRetry` for the OUTBOX reply; an unretried failure here sat one push-race away from that later call's reset destroying it, exactly like `Run-Merge.ps1`'s merge was. `Set-AutomationFlag` had a second, independent bug found in the same pass: it unconditionally returned "Automation enabled/disabled" regardless of whether the push actually succeeded, so a lost push wasn't just unretried, it was reported as a success.
- `run-claude.ps1` — three sites (the Apply-Decisions commit, the plan-conversion commit, the digest/Codex-ready-notice refresh). Lower collision risk than the others (this script runs twice daily against n8n's ~2-minute OUTBOX poll, versus the dispatcher's much tighter windows), and a failure here at least halts loudly via `Halt-Automation` rather than vanishing silently — but still unretried, and still capable of leaving a real commit stranded on local main.

Fix: the identical rebase-based retry pattern from this decision's TASK-030 addendum, applied at all six sites — duplicated per file (matching this repo's existing convention for self-contained phase-runner scripts), except within `run-claude.ps1` itself, where its three sites share one local `Push-MainWithRetry` helper since they live in a single script rather than being spread across files. Every `push origin main` call site in the automation surface is now inside a retry loop; confirmed by re-running the same grep and checking each remaining hit resolves to either a retry loop's own internal call or a human-facing message string, not a bare unretried push.

## D-048 — Symmetric builder/reviewer engine fallback on quota exhaustion, always disclosed, never silently self-reviewed

Task: TASK-029, prompted by "if codex doesn't have enough tokens, then this workflow won't work?" · 2026-07-16/17

Context: The pipeline had exactly one engine wired into each role — `codex exec` as builder (D-037's pluggable `$BUILDER` existed, but nothing ever switched it automatically), Claude as reviewer (no pluggable path at all). Either engine running out of tokens/quota mid-pipeline, or being briefly unavailable, stalled that role until a human noticed and intervened — the opposite of the "less babysitting" direction D-042/D-043 already pushed. First design pass proposed forbidding Codex from ever reviewing its own build while implicitly allowing Claude to (since Claude already builds-and-reviews in Claude-only installs) — correctly challenged live ("so you are telling me claude can review and build its own, but codex can't do that?"): an inconsistent rule that treated an already-accepted trade-off (self-review) as forbidden for one engine and invisible for the other.

Decision: Both `tools/Run-Codex-Build.ps1` and `tools/Run-Claude-Review.ps1` now detect a quota/capacity signal (`rate limit`, `quota`, `429`, `usage limit`, `insufficient credits/quota/balance`, `too many requests`, `resource exhausted` — matched against captured stdout+stderr) or an outright-missing CLI, and — only in that case, never on a normal failure — retry the SAME task on the SAME branch with the other engine, discarding whatever partial state the failed attempt left first. Builder identity is recorded in the landing commit message (`"<id>: built via codex"` / `"built via claude (fallback after ...)"`) rather than a new `TASKS.md` field, so the reviewer can check it via `git log`. Codex-as-reviewer uses a new committed contract, `tools/CODEX_REVIEW_INSTRUCTIONS.md` (invoked via the short, parameterized `codex exec ... "Review TASK-<id>"`, mirroring the already-verified `"Continue"` contract rather than risking a large inline prompt argument the way `claude -p` originally needed stdin piping to avoid) — it has no `Task` tool, so it cannot run the Guardian Gauntlet, and must say so explicitly and never choose `done`, reusing the exact "gauntlet didn't run → `approved` at most" degradation clause Claude's own reviewer prompt already had, rather than inventing new verdict logic. After any reviewer run (fallback or not), the runner checks whether the same engine both built and reviewed the task and, if so, appends a plain disclosure to the result — self-review is never blocked, only disclosed; it is the same trade-off Claude-only installs already accept every task, just now named out loud whenever it occurs via fallback too.

Why: Symmetry was the load-bearing correction here, not an afterthought — either engine can fail either role, and the response is identical in shape both directions: retry once with the other engine, disclose what happened, never silently degrade coverage without saying so. Self-healing on the build side reuses the EXISTING blocked-task mechanism (a double-engine quota failure is just a normal build failure, tagged `auto:` so `Invoke-Autopilot`'s existing rework-strike auto-release logic — already capped at 3 attempts — retries it once quota clears, rather than inventing a second retry system). Self-healing on the review side needed nothing new at all: a bare review-process failure has always left the task at `status: review` rather than marking it blocked, which is already a valid "try again next `/review` or `/go`" state — deliberately left as-is rather than forcing artificial symmetry with the build side's `blocked`+`auto:` mechanism where the existing behavior already serves the same purpose.

Trade-off: The quota-signal regex is a heuristic, not a certainty — a real bug that happens to print a phrase like "rate limit" in an unrelated error would incorrectly trigger a fallback retry instead of surfacing as a blocked task. Judged acceptable: the phrases matched are specific enough that this is unlikely, and the cost of a wrong guess is bounded (one wasted retry with the other engine, still gated by every existing safety check — commit-scope guard, verdict rules, risk-gated merge — before anything lands). Codex-as-reviewer is a strictly weaker fallback than Claude's own review (no Guardian Gauntlet), which is why `$PREFERRED_REVIEWER` stays `'claude'` and Codex is only ever reached via detected failure, never a free peer choice. Verified: the quota-detection regex and the builder-identity extraction regex both tested in isolation against representative pass/fail strings (11/11 and 5/5 correct); both changed `.ps1` files parse clean.

Supersedes: nothing directly, but is the reason D-037's pluggable `$BUILDER` (previously configured once, never auto-switched) and Claude's previously-hardcoded reviewer path both became genuinely dynamic.

## D-049 — GitHub PAT n8n credential is now app-suffixed, same as the Telegram credential

Prompted by a live Telegram outage (no captures landing since ~2026-07-16) surfacing during a chaos-test audit of the AI Dev OS, run once this app started sharing one n8n account with a second app (ChronaSense).

Context: OPERATOR.md's own credential-setup table told users to name the Telegram credential per-app (`Telegram Bot - Meal Prep`) but the GitHub PAT credential generically (`GitHub PAT`), with no app suffix — in both this app's committed `n8n-telegram-*.json` workflow exports and the `ai-dev-os` template's `{{APP_NAME}}`-parameterized versions. OPERATOR.md's own trap warning ("n8n binds credentials by ID, not by name... on import, n8n silently attaches the first credential of the right type") already documented why this matters for the Telegram credential, but the same risk was left unaddressed for GitHub PAT — the moment a second app's workflow also wants a credential literally titled `GitHub PAT`, nothing in the credential picker distinguishes which app's repo-scoped token it is.

Decision: Renamed the credential reference to `GitHub PAT - Meal Prep` in all five occurrences across this app's three committed n8n workflow files, and to `GitHub PAT - {{APP_NAME}}` in the matching five occurrences in the `ai-dev-os` template. Updated OPERATOR.md's credential table and trap-warning prose in both repos to instruct the same app-suffixed naming for both credentials, not just Telegram.

Why: A generic shared name doesn't just look confusing — it's the same silent by-ID mis-binding OPERATOR.md already calls out for Telegram, just previously left unfixed for the credential most likely to write into the wrong app's repo entirely (GitHub answers `200 OK` either way, per OPERATOR.md's own "verify by routing, not by reading" guidance).

Trade-off: This is a naming-convention fix in the committed template/export files only — it does not, by itself, repair a credential binding already made incorrectly inside a live n8n instance. Existing installs (including this one) still need the credential's actual title changed by hand inside n8n, and per OPERATOR.md's documented webhook-theft behavior, a robbed bot's inbox workflow needs to be unpublished and re-published to re-register its webhook. The live Telegram outage that prompted this entry has NOT been independently confirmed fixed — it needs verification inside n8n itself (see STATUS.md).

Supersedes: nothing directly; extends D-032/multi-app guidance to a credential type it hadn't previously covered.

## D-050 — Two "make failures visible" fixes: n8n Error Workflow + Check-DocsConsistency wired into every automation cycle

Prompted directly by the D-049 outage's own lesson, from the same chaos-test audit: the 401 sat silent for 3 days not because nothing caught it (n8n's own execution log had it the whole time) but because nothing surfaced it anywhere a human would actually look.

Context: Two separate "silent gap" findings from the chaos-test audit shared the same root cause — real information already existed somewhere in the system but nothing pushed it into view. (1) n8n's per-node failures (bad credential, wrong repo) never reached Telegram; OPERATOR.md's own "verify by routing, not by reading" warning already named this, but nothing acted on it. (2) `tools/Check-DocsConsistency.ps1` (D-045) was fully built and correct, but standalone by design — it only ran if a human remembered to invoke it by hand.

Decision: Added a fourth n8n workflow, `n8n-telegram-error-alert.json` — an Error Trigger node feeding a plain-text (not Markdown — see trade-off) Telegram send, imported once and set as the **Error Workflow** (a per-workflow n8n Settings field) on Inbox, Digest, and Replies. It is not itself triggered by anything in this repo; it is a target other workflows point at. Also added a Phase 3b to `run-claude.ps1`, immediately after `Generate-Codex-Notice.ps1`: run `Check-DocsConsistency.ps1` every cycle, log its output unconditionally, and — only on a nonzero exit (drift found) — append a one-line warning to `planning/DIGEST.md` before it's committed. Both changes were mirrored into the `ai-dev-os` template (`OPERATOR.md`, `AI-DEV-OS.md`, `SYSTEM-OVERVIEW.md`, `run-claude.ps1`) so new installs get both by default rather than inheriting the same blind spot.

Why: Docs drift is a hygiene finding, not a safety issue, so it deliberately does not halt automation the way a commit-scope violation does (Hard Rule / Phase 2b) — it rides along in a channel that's *already* sent unconditionally every morning (`DIGEST.md`) rather than earning a new proactive-alert mechanism of its own. The n8n side chose n8n's native Error Workflow feature over a per-node retry-and-alert pattern inside each workflow, because it's a single setting per workflow rather than duplicated failure-handling logic in three separate JSON files that would each need to stay in sync.

Trade-off: The error-alert Telegram message is deliberately plain text, not Markdown — a raw stack trace or error message can contain `_`/`*`/`[` that breaks Telegram's Markdown parser, which would make the alert about a failure itself silently fail to send. Verified live: `Check-DocsConsistency.ps1` currently reports 11 findings against `docs/DECISIONS.md`, and a spot-check of one (`` `pwsh` ``) confirmed it's prose mentioning a tool name, not real code drift — so the very first digest after this ships carries a drift warning that is very likely noise, not a regression this change introduced. The false-positive rate itself is unchanged, pre-existing D-045 behavior; this decision only changes whether anyone sees the output, not its accuracy. The n8n error-alert workflow's own activation (import + pointing the other three at it) could not be verified from this environment — no n8n access — so it should be treated as shipped-but-unconfirmed until manually wired and tested with a deliberate failure.

Supersedes: nothing directly; closes the "Observability when something breaks" and "Docs-code consistency" gaps named in the chaos-test audit that produced D-049.

## D-051 — Rework retries must prove they changed something; a crashed review must resume as a review, not a rebuild

TASK-025 (2026-07-19/20) surfaced two compounding automation gaps in one incident: a rework retry that silently applied neither must-fix patch, and a crashed re-review that then left the task stuck in a state neither `/review` nor `/go` could actually pick back up — despite its own note claiming both would work.

Context: `/go`'s rework-strike release logic (D-023/D-026) sets a blocked task back to `status: codex` on the assumption that the next build attempt will genuinely retry the fix. `Run-Codex-Build.ps1` only checked whether `TASKS.md`'s `status:` field advanced off `codex` — not whether any actual evidence of work existed — so an attempt that flips the status without touching `app.js`, `CHANGELOG.md`, or `TEST_REPORT.md` looked identical to a real fix. Separately, when the auto-chained `Run-Claude-Review.ps1` crashes (the same flaky `claude -p` exit-1 class already known from TASK-007/014), it deliberately leaves the branch at `status: review` (a documented, intentional "try me again" state) — but `Invoke-Autopilot`'s classifier had no case for that signal, so it fell into the generic `else` branch and force-set `status: blocked` on `main` with a note ("build stopped -- ...") that matches neither of its own auto-release patterns (`waiting on merge of` / `strike N/3`). The task was, in effect, permanently stuck the moment the crash happened, with messaging that said otherwise.

Decision: Two independent fixes, landed together (TASK-032) because both were found investigating the same incident and both touch the same classification code path:
1. **`Run-Codex-Build.ps1`** now requires a build that reaches `status: review` to have touched `CHANGELOG.md` or `TEST_REPORT.md` — AGENTS.md's own mandated evidence steps — before it is allowed to auto-chain into review. A build that advances status without evidence is caught immediately and marked `blocked` as a "no-op", never reaching review at all.
2. **`Dispatch-Commands.ps1`**'s build-loop classification was factored into one shared `Resolve-ReviewOutcome` function (avoiding two independently-drifting copies), which gained two new cases: a crash-signal case that mirrors `status: review` onto `main` with no strike cap (transient engine flakiness is not a task defect, so it must not be bounded like a real failure is), and a no-op-signal case that reuses the existing `strike N/3` idiom REWORK already has (a no-op retry, unlike a crash, *can* be a genuinely stuck task, so it must be bounded). A third, previously-undetected bug was caught while consolidating this: the old inline classifier matched the bare word "APPROVED" against Run-Claude-Review.ps1's red-zone "APPROVED but HELD" message and would have marked that task `done` on `main` even though it was never merged — now checked and excluded first. Finally, `Invoke-Autopilot` gained a pending-review-resume step so a plain `/go` (not just an explicit `/review`) resumes a `status: review` task, since that was the actual gap: the crash note's own promise ("automatic retry on the next /review or /go") was only half-true before this.

Why: The user's framing of the fix request — "be my junior dev: investigate, build, verify, then give me a yes/no" — is itself worth recording as the operating mode for this class of finding going forward (see `feedback-junior-dev-mode` in Claude's cross-session memory): a gap found in the OS's own automation should be diagnosed and fixed proactively, not just logged and left for a future ask.

Trade-off: This task's own verification is a fixture harness (`Resolve-ReviewOutcome` run in isolation against 7 constructed cases, `Publish-TasksChange` stubbed to avoid touching git), not a live end-to-end run — reproducing a real `claude -p` crash or a real Codex no-op retry on demand isn't safely possible without spawning genuine CLI processes against a live branch. Honestly disclosed as unverified-live in TEST_REPORT.md and REVIEW.md rather than claimed. Same same-session build+review caveat as TASK-014/016/031 (Hard Rule 10 / D-032): held at `approved`, not auto-merged, for a human `/merge`.

## D-052 — Digest length capped; stale-lock wait cut from 2 hours to 45 minutes with a visible notice (ported from ChronaSense)

Found live on the sibling ChronaSense app (same developer, same AI Dev OS template) in the same session as D-051, then ported back here as TASK-033 since both apps share the identical `tools/Generate-Digest.ps1` / `tools/Dispatch-Commands.ps1` template.

Context: Two bugs, same root cause — an automation failure that was silent until a human happened to notice. (1) `Generate-Digest.ps1` had no cap on the digest's length; ChronaSense's digest hit ~5000 characters with 12 pending proposals and Telegram rejected the send outright ("Bad Request: message is too long") — total silence that morning, not even a partial digest. This app's own digest is currently small (530 chars, one proposal), so the bug hadn't fired here yet, but proposals accumulate over time and the same unbounded growth is latent. (2) `Dispatch-Commands.ps1`'s `automation.lock` staleness check waited a flat 2 hours — inherited from "this repo's Task Scheduler execution-time limit," a completely different constraint from "how long a legitimate run could plausibly take" — and cleared silently even then. On ChronaSense, a genuinely hung process (confirmed by hand: 0% CPU, no log output since before the run even started, no working child process) held the lock for 48+ minutes with two `/merge` commands queued uselessly behind it, discovered only because a human happened to open Task Manager.

Decision: Ported ChronaSense's fix directly. (1) `Generate-Digest.ps1` now builds the digest incrementally and stops adding proposal items once the message would approach Telegram's 4096-character limit, appending a "+N more waiting, see planning/PROPOSALS.md" note instead of letting the raw message grow unbounded — verified against this app's own real `PROPOSALS.md` to confirm it's a no-op at the current small size (530 chars, unchanged), not just a synthetic pass. (2) The stale-lock check now verifies whether the lock's recorded PID is actually still running (a crashed process clears immediately, no wait) and, for a PID still alive, waits 45 minutes instead of 2 hours — a number derived from this app's own documented ceilings (`Run-Codex-Build.ps1`'s 20-min build cap, `Run-Claude-Review.ps1`'s 10-min npm-test cap), not picked arbitrarily. Clearing a stale lock now sends a Telegram notice through the existing `Write-Reply`/`Invoke-CommitPushWithRetry` relay instead of clearing silently. `/status` was also extended to report the lock's age in minutes rather than just "BUSY", so a human checking by hand during a real hang sees the number that says something is wrong.

Why: Same rationale as D-051's own port in the opposite direction (see docs/AI_OS_NOTES.md and the user's explicit ask to keep both apps' AI Dev OS setups in parity) — a bug confirmed live in one sibling app is latent in the other by construction, since they share the exact file. Porting immediately closes the gap before this app independently hits the same incident.

Trade-off: Verification here leans on the fact that this is a straight, byte-identical port (confirmed via direct `diff` against ChronaSense's already-tested branch) rather than re-deriving a fresh fixture harness for logic that doesn't reference anything app-specific. Live end-to-end verification (a real oversized digest send, a real hung process actually self-clearing) remains outstanding in both apps, disclosed in both apps' TEST_REPORT.md rather than claimed. Deliberately does not auto-kill a lingering process in either app — `/stop` remains the explicit, human-triggered path for that.

Supersedes: nothing directly; closes a stuck-state gap that D-026 (mission-based `/go`)'s original design didn't anticipate — a build could reach review and then have the review step itself fail, as opposed to reach a real verdict.

## D-053 — Per-task scope note: soft-gate builds that touch files their own task never declared (ported to ChronaSense)

Prompted by comparing this OS against `github.com/cathrynlavery/codex-build`, a similar
Claude-orchestrates/Codex-builds skill, at the user's request.

Context: `Run-Codex-Build.ps1` already has `$deniedPatterns`, a repo-wide deny-list that blocks Codex/Claude from ever touching `tools/`, `docs/`, `CLAUDE.md`, and the rest of the OS surface, regardless of which task is running. `codex-build` does something narrower and complementary: `check_scope.py` mechanically fails a run if a task touches a file outside an allowlist declared for THAT specific task. This repo had no equivalent — a task declaring `files: app.js` that also edited `style.css` would pass the deny-list untouched (CSS is legitimate app-code surface), with nothing prompting the reviewer to notice the extra file was never requested. The reviewer sees the raw diff, but nothing cross-checks it against the task's own declared scope.

Decision: Added `Get-TaskBlockText`/`Get-TaskDeclaredFiles` to `Run-Codex-Build.ps1`, parsing a task's `files:` field (single-line and the multi-line-continuation form real entries in this file use) into a flat path list, stripping `(new)` annotations. After the existing deny-list guard passes, the script computes the union of declared files across every tracked task in the invocation (not just the first — Sprint Execution Mode can chain several) and flags any changed file that's neither declared nor a standard evidence file (`CHANGELOG.md`/`TEST_REPORT.md`/`TASKS.md`). Deliberately a **soft gate**: a mismatch never blocks the build, never marks anything blocked, never touches the exit code — it only writes a note to a new gitignored `.scope-note.txt`, prefixed with the covered task ID(s), when the tracked set reaches `status: review`. `Run-Claude-Review.ps1` reads that file, uses it only if the task currently under review is one of the named IDs (discarding — and always deleting — anything else, so a stale note from an unrelated run can never attach to the wrong task), and folds it into the Claude reviewer's prompt as an explicit item: state in `REVIEW.md` whether the extra file is a legitimate dependency or unrequested scope creep. Ported identically to the sibling ChronaSense app (its TASK-0XX/DECISIONS #XX), same reasoning as D-051/D-052's cross-app ports — both apps share the identical template file.

Why: The soft-gate choice was explicit and deliberate, not a compromise — the user, when asked, specifically flagged that a hard-block version of `codex-build`'s allowlist enforcer would "occasionally block a legitimate small necessary touch outside the declared scope... and trade silent scope creep for false-positive blocks that need you to intervene." That's the same class of problem this session already spent significant effort removing elsewhere (D-051's no-op-retry and crashed-review fixes both exist because automation was *silently* wrong, not because it was too permissive) — recreating it as a rigid hard gate here, on a purely heuristic signal, would have been a step backward dressed as a safety improvement. Matches CLAUDE.md's "if code can answer, code answers" for the *detection* half (a deterministic file-list diff) while deliberately leaving the *judgment* half (legitimate dependency vs. scope creep) to the model reviewer, exactly the same code/judgment split D-048's Guardian Gauntlet already uses.

Trade-off: Purely heuristic — a task with an out-of-date or incompletely-declared `files:` field will generate false-positive notes the reviewer has to dismiss, and a task with no `files:` field at all (or one that doesn't parse) skips the check entirely rather than defaulting to "flag everything," which means a genuinely undeclared task gets no scope signal at all. The Codex-as-reviewer fallback path (D-048) does not receive this signal — only the Claude reviewer's inline prompt was wired up, consistent with that path's existing documented degraded-capability status (no Guardian Gauntlet either). Verified via two isolated fixture harnesses (14 assertions total, all pass) covering the parsing, the union-across-chained-tasks logic, and the cross-task-ID leak prevention specifically; no live end-to-end run (a real build touching a real undeclared file, verified to surface in a real `REVIEW.md`) — disclosed as unverified-live in `TEST_REPORT.md` rather than claimed. Same same-session build+review caveat as TASK-014/016/031/032/033 (Hard Rule 10 / D-032): held at `approved`, not auto-merged, for a human `/merge`.

Supersedes: nothing directly; extends the existing deny-list scope guard (undated, predates this decision log) with a narrower, task-specific, advisory-only companion check.

## D-055 — Low-effort cooking metadata: optional recipe fields, deterministic Home suggestions, and the zero-minute fix

Context: The app could tell you what you *could* cook from your pantry, but nothing about what it would *cost you in effort*. Every recipe looked equally expensive to make, so "what should we cook tonight" stayed a decision the user had to make unaided — and the answer they actually wanted ("the rice cooker one", "the one where I just shred a bought chicken") wasn't representable at all. Separately, `recipe.baseCookTime || recipe.cookTime` (10 call sites) turned a legitimate `0` into `undefined`, so a genuinely no-cook recipe rendered "NaN min" on its card, in the planner slot, and in the week stats.

Decision: Five OPTIONAL, additive fields on the existing recipe object — `equipment[]`, `effort`, `activeTime`, `mealBalance{}`, `tags[]` — filled by `normalizeRecipes()` → `normalizeRecipeMeta()` on every load. **No new top-level `AppState` key was introduced**, so the sync registries (`saveToLocalStorage`, `buildFirestorePayload`, `snapshotData`, the import `KNOWN` list, the union-merge key lists) are untouched: recipes already round-trip generically, so the new fields sync for free. The one piece of new state, the active quick-filter chip, is a module-level `var` because it is view state that should not be persisted or synced.

On top of that data: a short row of quick-filter chips on the recipe list (lowest effort / rice cooker / rice + steamer / Instant Pot / oven / pan / no-cook / batch-friendly), a compact metadata strip on each recipe card, a compact "How you cook it" block in the recipe editor, and a Home card offering up to three deterministic suggestions — ⚡ Easiest, 🥬 Use soon, 🍽️ Something different — ranked from `recipeEffortScore()`, the existing pantry/freshness scan, and `AppState.cookHistory`. Seven new default cooking hacks were added to `defaultCookingHacks`, with `seedNewDefaultHacks()` backfilling them onto devices seeded before they existed.

The zero-minute bug is fixed at all 10 call sites through `recipePrepMinutes()` / `recipeCookMinutes()` / `recipeTotalMinutes()`, which fall back to the legacy `prepTime`/`cookTime` field only when the base field is genuinely ABSENT. A `0` now displays as `0m`, the smallest change consistent with the existing "Cook: 25m" format.

Why: The product goal for this wave was to reduce the friction around *what to cook, what to buy, and how to cook with least effort* — explicitly NOT to become a macro-tracking or logging app. Every design choice follows from the constraint "do not add daily chores": the metadata is entered ONCE per recipe and is optional; `mealBalance` is three checkboxes rather than grams, and is informational only — it never blocks, warns, or sets a target; the Home suggestions read data the app already collects rather than asking for new input; and the variety nudge reuses `cookHistory` instead of introducing an eaten-log. Effort is a four-value enum rather than a computed score because a user can answer "is this assembly or normal?" instantly, and a scoring formula would have been both harder to explain and easier to get wrong.

Two deliberate refusals to guess: a suggestion category with no supporting data is **omitted** rather than filled — "Something different" needs a cook history to be different from, and "Easiest" is dropped entirely when the easiest available recipe is still a normal-effort cook. And `activeTime` distinguishes "not stated" (null) from "zero", so an unlabelled recipe falls back to its total time and is never mistaken for an effortless one.

Trade-off: `recipeEffortScore()` infers a rank from active time when `effort` is unset, so a recipe nobody has labelled still sorts — but a long recipe with a short hands-on phase looks harder than it is until someone fills the field in. Accepted: the alternative was excluding unlabelled recipes from discovery entirely, which would make the feature useless until the whole book is annotated. `seedNewDefaultHacks()` writes to `customHacks`, an existing synced list — it is additive-by-id, never overwrites an edited copy, leaves a deliberately-emptied list alone, and runs before `applyTombstones()`/`snapshotIdBaseline()` so a deleted hack stays deleted and no phantom tombstone is recorded; the residual risk is that a hack deleted more than 180 days ago can reappear once its tombstone is purged. Suggestion *claim* order is use-soon → easiest → different while *display* order is fixed at easiest → use-soon → different: food about to spoil should win a contested recipe, but the card must not reshuffle itself between visits.

Explicitly deferred, not built: household/person entities, per-person portions, planned-vs-eaten logging, freezer portion tracking, thaw workflows, sauce composition, recipe-to-recipe composition, appliance timers, and any AI/model-driven recommendation. The weekly-plan slot shape is unchanged — slots still hold bare recipe ids.

Also in this wave, a narrow fix to an older bug the work surfaced: `saveRecipe()` rebuilt the whole recipe object from the edit form and copied across only `sourceUrl`/`sourceSite`/`importedAt`, so any property without a form input was silently destroyed by an unrelated edit — `favorite`, `highlights`, `updatedAt` (which the tombstone last-write-wins in `applyTombstones()` depends on), the `fiber` and `sodium` nutrition values that have no inputs, and every field this wave added. An edit now starts from the existing recipe and overlays only the fields the form owns, so preservation is the DEFAULT and a future field cannot be forgotten here again. Deliberately unchanged: the form is still authoritative for what it owns (clearing an input still clears the value), emptying all four nutrition inputs still clears the recipe's nutrition, and adding a new recipe inherits nothing. The recipe model itself was not refactored.

Supersedes: nothing. Numbering note: `main` ends at D-053 and the unmerged `wave1-portion-truth` branch claims D-054, so this branch takes D-055 to stay collision-free whichever lands first.

## D-056 — Ready-food first: portion counts on cookedMeals, one-tap consumption, and a Home card that offers cooked food before suggesting a cook

Context: The app could tell you what to cook, and after D-055 it could tell you what was *easiest* to cook — but it had no answer to the question people actually ask at 6pm: "do we already have something we can eat?" `cookedMeals[]` tracked that a batch existed and when it would spoil, but not how much of it was left, so a fridge holding six portions of roast chicken looked exactly like an empty one. The consequence is the specific waste this app exists to prevent: cooking something new while ready food quietly expires.

Decision: Two OPTIONAL additive fields on the EXISTING `cookedMeals[]` objects — `initialPortions` and `portionsRemaining`. **No new top-level `AppState` key**, so no sync registry was edited; `cookedMeals` already round-trips through localStorage, the Firestore payload, backup/restore, export/import and the union merge, so portions ride along for free. Both fields null means an untracked batch, which behaves exactly as it did before this existed.

`normalizeCookedMeal()` / `normalizeCookedMeals()` is the first normalizer this collection has ever had; it runs at all six points where `cookedMeals` is assigned from stored data (localStorage load, backup restore, Firestore load, the live cloud listener, the import union, and the sign-in merge). It is idempotent and only ever *repairs* an incoherent pair — it never invents portions for a batch that has none.

Consumption is one tap. `useCookedPortion()` decrements by one and re-renders; the last portion routes into the existing `removeCookedMeal()` so there is exactly one deletion path and one tombstone behaviour, not a second "archive" concept to keep in sync. A tap on an untracked batch finishes it, which is what the pre-existing "Done" button already meant for those. Nothing opens a modal.

`getReadyFoodSuggestions()` answers "what should we use first?" deterministically from data the app already holds: bucket 0 = fridge food inside the freshness warning window, bucket 1 = fridge food generally, bucket 2 = freezer food; then soonest-to-spoil, then the smallest remainder (so odd single portions clear out), then name. Home renders the top 3 in a "Ready to eat" card placed ABOVE the D-055 cook suggestions, making the priority explicit: ready food → easiest thing to cook → everything else. Both cards coexist; neither replaces the other.

Why: Every choice here is subordinate to one UX rule from the brief — *using stored food should usually require one tap*, and the feature must reduce decisions rather than create inventory chores. So portions are whole meals (never grams, never per-person), the count is optional everywhere, the recipe-cooked dialog pre-fills it from `recipe.currentServings` and follows the batch multiplier until the user types their own number, and consuming is a single button with no confirmation. Fractional inputs are floored deliberately: half a meal portion is not a concept this app has, and honouring it would invite exactly the weighing behaviour the wave is meant to avoid.

Two deliberate refusals. **Expired batches are excluded from ready-food suggestions entirely** — the freshness banner and the Home attention card already flag those for disposal, and recommending that someone eat food past its date would be actively harmful, not merely untidy. And `readyFoodBalanceHint()` reuses the D-055 `mealBalance` only as a short nudge ("add veg + rice") when a batch's source recipe declares protein without veg or carb; it does no composition, understands no assembled meal, and returns nothing for manually added food.

Trade-off: `portionsRemaining` counts meals, not mass, so two people eating one batch at different rates will drift from the number on the card — accepted, because the alternative is per-person servings, which is exactly what the parked `wave1-portion-truth` branch does and what this brief explicitly excluded. When remaining exceeds initial (a hand-edited record or a partial import), the normalizer *raises* `initialPortions` rather than clamping `portionsRemaining` down: clamping would silently delete food the user says they still have. `_doMarkCooked()` still does not call `stampUpdated()` on the batch it creates — a pre-existing gap that leaves recipe-cooked batches without an `updatedAt` for tombstone last-write-wins. It is unchanged here rather than quietly fixed, because touching tombstone LWW is sync-adjacent and this wave was scoped away from it; it is recorded as a follow-up instead.

Explicitly deferred, not built: household/person model, per-person servings, planned-vs-eaten diary, gram portions, raw-to-cooked yield, freezer bin/location management, thaw state and thaw reminders, sauce composition, meal-component architecture, AI recommendations, and the full "what should we eat?" engine. `getReadyFoodSuggestions()` is the deterministic groundwork for that engine, not the engine.

The Landers lechon manok workflow — buy two, eat some, portion the rest, store 6 in the fridge, use two, move the remainder to the freezer, and have Home offer it before suggesting another chicken recipe — works entirely through the general manual-cooked-food and portions flow. There is **no Landers-specific code**; a cooking hack explains the strategy. An end-to-end test asserts the final object's key set to prove nothing special-cased leaked into the data model.

Supersedes: nothing. Builds on D-055's `mealBalance` for the side-dish hint only.

## D-057 — Kitchen Truth: grocery check-off IS the inventory update, merges that never make old food look fresh, and one attention list over two data models

Context: The app had a grocery list and a pantry, and no connection between them. `toggleGroceryItem()` flipped `item.checked` and re-rendered — it did not write to `AppState.pantry`, and it did not even call `saveData()`, so the tick vanished on the next reload. Every route into inventory was manual (`addToPantry()`, `confirmBulkAdd()`, the ingredient browser, the kitchen-setup wizard), each with its own duplicate policy: warn-and-allow, skip, and replace respectively. The result is the failure mode the product cannot survive — inventory drifts away from reality, and the fix costs more effort than remembering the kitchen mentally.

Two smaller defects fell out of the same audit. `getExpiredPantryItems()` matched on `item.expiryDate` alone, but the badges and banners compute freshness through `pantryDaysLeft()`, which for most items derives from `purchaseDate + shelfLifeDays`. Items in the common bought-date mode therefore never matched, so the Inventory tab's "Clear expired" button stayed hidden while the banner right above it said "2 expired" — a bulk cleanup that existed but could not fire. And `addToPantry()` still read `#pantry-add-where` and `#pantry-qty-input`, two elements that no longer exist in `index.html`; both reads were null-guarded, so the effect was dead code rather than a crash.

Decision: **Bought ✓ is the whole interaction.** Checking a grocery item calls `stockPurchasedGroceryItem()`, which produces a useful inventory record from what the list already knows plus the same inference manual adds use — `inferCategory()`, `inferStorage()`, `ingredientShelfLife()`, `purchaseDate = todayISO()`. No modal, no quantity prompt, no date entry, no per-item confirmation. Unchecking calls `unstockPurchasedGroceryItem()` and reverses exactly what checking did, using a `stocked` receipt recorded on the grocery item; a mis-tap therefore costs one tap to correct instead of leaving a phantom record behind.

Merging is deliberately conservative. `findPantryByExactName()` is an exact case-insensitive match, **not** the fuzzy `findPantryMatch()` used for recipe deduction — buying "Chicken" must never fold into a "Chicken Breast" record the user maintains separately. `canMergePurchase()` then refuses two cases: a record in `dateMode: 'expiry'` (the printed date belongs to one pack) and a record that is already expired. On an accepted merge, `purchaseDate` is left alone so the **oldest** portion keeps governing freshness, and `quantity` sums only when both sides are known — otherwise it becomes `null`.

Fast states reuse `stockLevel`; no parallel status system was added. Buying a staple sets it to `'full'`, clears `suggestDismissed`, and lets the existing `syncStapleToGrocery()` drop the auto "Running low" row. The Have/Low/Gone cycle is the pre-existing `cycleStapleLevel()` tap-cycle, unchanged.

Home's "What needs attention?" card now reads from `collectAttentionItems()`, which scans pantry items and cooked meals in one pass and returns three buckets: **Expired**, **Use soon**, and **Low**. Expired is split out from Use soon (they were previously one "Expiring soon" list) because only Expired carries actions: per-row `Keep` / `Remove`, plus a bulk `Remove expired (N)`. The two record types keep their own shapes and their own shelf-life rules — this unifies the attention *experience*, not the data model.

Why: the wave's governing rule is that inventory maintenance must cost less effort than remembering the inventory mentally, so every decision resolves toward fewer taps and fewer invented facts. The two are in tension exactly once — when the app must choose between guessing a number and admitting it does not know one — and it consistently chooses to admit ignorance. An unknown purchase quantity stays `null` rather than becoming `1`; a merge where either side is untracked stays untracked rather than adopting the known half as the total. `deductIngredientsForRecipe()` already skips null-quantity items, so an approximate record degrades to "we have some of this, and here is when it goes bad" — still useful, never wrong.

The merge date rule is the sharpest instance of the same principle. Stamping today's date on a merged record is the obvious implementation and is quietly destructive: six-day-old chicken silently becomes fresh chicken the moment you buy more, and the freshness system stops being trustworthy. Keeping the older date under-claims freshness for the new stock, which is visible and self-correcting; over-claiming it is invisible. Refusing to merge into an already-expired record follows from the same reasoning taken one step further — there is no date to keep that would be honest.

`Keep` was the hardest thing to implement honestly. The brief permitted omitting it if it could not be built without asking for a new date, and it cannot: the app has no way to know the real remaining life of food a user has just eyeballed. So `Keep` does not touch dates at all — it writes `keptOn: todayISO()` and suppresses the record from the attention surfaces for the rest of that day. `getExpiredPantryItems()` and `getFreshnessAlerts()` honour it too, so "Keep" has one meaning everywhere: *stop offering to remove this today*. Nothing is hidden — the Inventory tab still shows the item's own "Expired 4d ago" badge, because that is where the food is actually listed and the truth belongs there.

Bulk removal was verified safe before it was built, not after. `removeAllExpired()` deletes only records `collectAttentionItems()` classified as expired — `daysLeft < 0` under the same `pantryDaysLeft()` / `cookedShelfLife()` rules the badges use — so "use soon" is structurally excluded rather than filtered out by a second, drift-prone predicate; an item with exactly 0 days left is "Use today", not expired. Every removed id gets an **explicit** tombstone in `AppState.deletions` before the record is dropped, then `snapshotIdBaseline()` is called. This matters because `recordLocalDeletions()` ignores more than `MASS_DELETE_GUARD` (5) simultaneous disappearances as a suspected load race; a nine-item cleanup relying on the vanish-diff would record no tombstones at all and another device would resurrect the food on the next merge. The existing `clearExpiredPantryItems()` and `deleteSelectedPantryItems()` already used this pattern; it was followed, not changed. **No tombstone-architecture, `cloudReady`, `saveData()`, Firestore-merge or conflict-resolution code was modified.**

No new top-level `AppState` collection was added. `keptOn` rides on existing pantry and cooked-meal objects, and `userSet` / `stocked` ride on existing grocery items, so all three flow through localStorage, `buildFirestorePayload()`, export/import and the union merges unchanged. Old saved data loads unmodified: absent `keptOn` reads as "not kept", and absent `userSet` preserves the pre-existing behaviour where an untouched row auto-ticks when the item is already at home.

Trade-off: a grocery item that has been transferred and then regenerated by `generateGroceryList()` loses its `stocked` receipt, so re-checking it adds stock a second time. That is treated as a genuine second shopping trip rather than a bug, and the alternative — persisting receipts across list regeneration — would need a purchase ledger, which is the lot-tracking architecture this wave excludes. Merged records are also still single records with a single date, so a genuinely mixed-age pile reads as the age of its oldest member; that is the deliberate cost of not building FIFO lots.

Explicitly deferred, not built: receipt/photo OCR, AI grocery extraction, barcode scanning, retailer integrations, lot/batch inventory, FIFO stock, thaw tracking, notifications, household/person model, gram-level requirements, and a "possibly stale" bucket — that last one was scoped in the brief only "if there is a reliable deterministic signal already available", and there is not: every signal the app holds is already expressed by `pantryDaysLeft()`, so a fourth bucket would have restated the first two with a vaguer label.

Follow-up recorded, deliberately not fixed here: `deductIngredientsForRecipe()` removes depleted pantry items **without** writing explicit tombstones, relying on the `recordLocalDeletions()` vanish-diff. Cooking a recipe that depletes more than five tracked items would therefore record no tombstones and let another device resurrect them. The fix is the same explicit-tombstone pattern used above, but it sits on the cook path rather than the inventory path and was left out of this wave rather than silently expanded into.

Supersedes: nothing. Builds on D-056's cooked-meal model for the attention list's second record type, and on the existing `stockLevel` staple states rather than replacing them.

Addendum (TASK-045, 2026-08-22): the follow-up recorded above is now closed. `deductIngredientsForRecipe()` writes an **explicit** tombstone for every pantry id it depletes, then removes the records, then calls `snapshotIdBaseline()` — the same explicit-tombstone → delete → re-baseline sequence this decision established for `removeAllExpired()`, and that `clearExpiredPantryItems()` / `deleteSelectedPantryItems()` already used. The cook path is therefore no longer dependent on the `recordLocalDeletions()` vanish-diff, which refuses to record more than `MASS_DELETE_GUARD` (5) simultaneous disappearances; a cook that empties six or more tracked items now syncs as six or more real deletions instead of vanishing locally and being resurrected by the next merge. The change is confined to the existing `if (depleted.length)` block inside that one function — the tombstone architecture, `MASS_DELETE_GUARD`, `cloudReady`, `saveData()` semantics and the Firestore merge/conflict code are all untouched, and no second deletion mechanism was introduced. Partially depleted items are unaffected: only a record the cook actually empties is tombstoned. Regression-locked by `tests/cook-depletion-tombstones.spec.js`, whose 6- and 8-item cases deliberately cross the guard and whose control arm proves the vanish-diff alone records nothing at that size; mutation-checked by reverting the tombstone write, which fails all nine tests — including an end-to-end case where a stale remote copy resurrects all six items. Landed as an owner-approved D-032 red-zone merge, not an auto-merge.


## D-058 — Food attention notifications are foreground-only, because this architecture cannot honestly deliver anything else

Date: 2026-08-22 · Task: Food Attention Notifications wave · Branch: `wave-food-attention-notifications`

Context: Home already tells the truth about food — `collectAttentionItems()` (D-057) produces Expired / Use soon / Low over both pantry items and cooked meals, and the Keep / Remove actions live on that card. But the user has to *open the app* to find out. The obvious next feature is "tell me when food goes off", and the obvious implementation is a push notification. Before writing any of it, the platform was characterised.

The finding: **this app cannot deliver a notification while it is closed, and nothing short of new backend infrastructure would change that.**

- Hosting is GitHub Pages — static files, no server-side compute of any kind. The only backend that exists is `workers/recipe-import`, a stateless request/response Cloudflare Worker with no scheduler and no state.
- `sw.js` was cache-only: `install` / `activate` / `fetch`. No `push`, no `notificationclick`, no `periodicsync`.
- The Firebase project is Auth + Firestore. There is no FCM registration, no VAPID key, no `firebase-messaging-sw.js`. Adding Web Push would mean a VAPID keypair, a per-device subscription store, and — the part that actually matters — **a server that wakes on a schedule and decides who to push**. On Firebase that is Cloud Functions + Cloud Scheduler on the Blaze plan; anywhere else it is a new always-on service. Either way it is a scheduled backend that reads every user's inventory, which is a materially larger security and privacy surface than the app has today.
- Periodic Background Sync (`periodicsync`) is not a way around this: Chromium-only, installed-PWA-only, gated on the browser's site-engagement score, and `minInterval` is a hint the browser is free to ignore indefinitely. Absent entirely on Safari/iOS and Firefox. A feature that "usually might fire, roughly, on one browser" is not a food-safety alert.
- The Notification Triggers API (`TimestampTrigger`), which would have allowed locally scheduled notifications with no server at all, never shipped past origin trial in any browser.
- On iOS Safari in a normal tab, `window.Notification` does not exist at all; it appears only for a home-screen-installed PWA (16.4+), and even there delivery still requires a push server.

Decision: **build the honest version and say plainly what it is.** Notifications are raised from the running page — at app open (all three load paths in `initApp()` / `loadUserData()`) and on `visibilitychange` → visible. Nothing fires while the app is closed, and the Settings row says so in as many words. No push server, no FCM, no VAPID, no periodic sync, no scheduler.

The notification layer **consumes** Kitchen Truth and defines no freshness of its own. `maybeNotifyAttention()` calls `collectAttentionItems()` and reads its Expired / Use soon buckets; `pantryDaysLeft()`, `cookedShelfLife()`, `daysLeftFrom()` and `FRESHNESS_WARN_DAYS` are untouched. A regression test proves this structurally by stubbing `collectAttentionItems()` to return a fabricated item and asserting the notification follows the stub — if a second expiry rule were ever introduced, that test fails. `isKeptToday()` suppression (D-057) is inherited for free, because Keep removes the record from the Expired bucket before the notification layer ever sees it.

Copy is grouped and conservative: one notification for the whole kitchen, never one per ingredient, with `tag: 'meal-prep-attention'` so a later alert replaces rather than stacks. Three shapes only — `"<name> expired"`, `"N foods expired"`, `"Food needs attention"` — and the body for any expired food says **"Open Meal Prep to review"**, never "use", "eat" or "cook". Expired food is never suggested for consumption; that is asserted by a test that scans the rendered copy for consumption verbs. Use-soon names are listed, capped at two plus "and N more".

Deduplication uses the smallest state that works: a ledger of `"<kind>:<id>" -> "expired" | "use-soon"`, rewritten from the current world on every pass. A record announces only when its state *changes*, so unchanged food is silent forever, food that crosses use-soon → expired announces once more (genuinely new information), and food that is removed drops out of the ledger so a later re-add can announce again. Keys are namespaced by kind so a pantry id can never mask a cooked-meal id.

That ledger lives in its **own device-local `localStorage` key, `mealPrepFoodAlerts`** — not in `AppState`. No new top-level synced state key was introduced, and a test asserts that neither `AppState` nor the persisted `mealPrepAppData` payload grows an alert/notification field. This is deliberate on two counts. Bookkeeping is per-device by nature: syncing "already told you" would let a phone silence a laptop. And `AppState` is the synced surface — every key added there flows through `buildFirestorePayload()`, the union merges and the tombstone machinery, which is the red-zone code this wave was scoped to stay out of. Precedent already exists: `mealPrepHelpSeen`, `pantryOnboardingDone`, `mealPrepStartDone`, `mealPrepDisplayName` and `mealPrepWeekTemplate` are all device-local keys of exactly this kind.

Permission is requested from exactly one place: `toggleFoodAlerts()`, reached only by tapping **Settings → Notifications → Food expiry alerts**. Nothing on page load calls `requestPermission()`, and a test asserts the request count is zero after a cold load. A denial sets nothing, disables the row, relabels it "Blocked in browser settings", and changes nothing else — the in-app banner, badge and Needs Attention card carry on exactly as before. A browser with no `Notification` object at all (iOS Safari in a tab) reads "Not supported on this browser" and is likewise inert.

Two smaller platform details drove implementation choices. Android Chrome **forbids** the page-side `new Notification()` constructor and throws — so notifications go through `registration.showNotification()` when a service-worker registration exists, falling back to the constructor only where there is none. That in turn required a `notificationclick` handler in `sw.js`, which focuses an existing window and posts `{ type: 'show-attention' }` back to the page. The worker schedules and sends nothing of its own; it only routes the tap. And the tap always lands on the Home Needs Attention card via `openAttentionView()` — a notification never acts on food, it only takes the user to where Keep / Remove / Use already are.

The outstanding-work indicator was mostly already built. `updateFreshnessBadges()` already puts a live count on the Inventory tab, so no second in-app badge was added. What was missing was any signal once the app is closed, so `updateAppAttentionBadge()` calls `navigator.setAppBadge()` with the same expired+expiring count — feature-detected, try/catch'd, and silently absent where unsupported. It needs no permission of its own on most platforms and no server, which makes it the only "while you're away" signal this architecture can honestly provide.

Why: the alternative was to build the push stack so the feature could be described as "real notifications". That would have added a scheduled backend reading every user's inventory, a device-subscription store, and a new failure mode where the app confidently promises alerts that a browser then silently declines to deliver — all to serve a use case where the user opens the app most days anyway and the freshness data is already correct when they do. A foreground alert plus an app-icon badge covers the actual need (find out about the food without hunting for it) at roughly two hundred lines and no new infrastructure. Claiming more than the platform delivers would be worse than claiming less: a user who trusts a notification that never arrives throws away food they would otherwise have eaten.

Explicitly not built, and out of scope by instruction: any reminder scheduler, user-created reminders, meal/calorie/protein/water/shopping reminders, recipe recommendations, grocery-sale alerts, SMS/email/Telegram delivery, AI, a household/person model, and any change to sync, tombstones, `saveData()`, the `cloudReady` write-guard or auth. `wave1-portion-truth` was not touched.

Trade-off, stated plainly: food that expires on Tuesday while the app is never opened is announced on Wednesday when it is. The alert is late by exactly the gap between openings. The app-icon badge narrows that gap on an installed PWA but does not close it. Closing it needs a push server — see the recommendation in the wave report, which argues this is worth revisiting only if usage shows multi-day gaps between opens.

Supersedes: nothing. Builds on D-057's `collectAttentionItems()` and its `keptOn` suppression, and on D-056's cooked-meal shelf-life model, without modifying either.

## D-059 — "What should we eat?": one deterministic ranking composed from the helpers that already existed, with shopping as a tier rather than a weight

Date: 2026-08-22 · Task: What-should-we-eat wave · Branch: `wave-what-should-we-eat`

Context: Home already knew everything needed to answer "what should we eat?" — `getReadyFoodSuggestions()` ranked cooked food (D-056), `getCookableRecipes()` knew what the pantry could support, `getExpirySuggestions()` knew what was about to spoil, `recipeEffortScore()` / `recipeActiveMinutes()` / `varietyPenalty()` knew how much work a recipe is and whether we just ate it (D-055), and `normalizeMealBalance()` knew whether a recipe is protein + veg + carb. What it did not do was **combine** them. The user had two overlapping cards ("Ready to eat", "What should I cook?") and 40 recipes, and still had to do the deciding.

Decision: add **one** helper, `getWhatShouldWeEatSuggestions()`, that composes the existing helpers into at most three picks — Eat this first / Easiest / Something different — plus `renderWhatShouldWeEatCard()` to draw them. **No parallel recommendation system was introduced.** Ready food is `getReadyFoodSuggestions(1)[0]` verbatim; pantry availability is `getCookableRecipes()`; expiry pressure is `getExpirySuggestions()`, the same scan the dashboard's own "Use before they expire" block runs. No freshness boundary is recomputed anywhere in this wave, and a regression test asserts the expiry signal comes from that shared scan rather than a private copy.

Ranking is a plain additive cost, **lower is better**, matching the existing `recipeEffortScore()` / `varietyPenalty()` convention. No model, no learning, no stored weights, no preference screen. Every term is a named field on `parts`, so a test can assert one signal at a time and a human can read why a recipe won.

**Shopping is a tier, not a weight.** This is the one structural decision worth recording. The first implementation made "missing ingredients" a cost of 2 per item, and it was wrong in a way that only showed up under test: a no-cook, assembly-effort, minimal-cleanup recipe missing two ingredients scored 5 while a perfectly ordinary pan recipe you could actually cook scored 12 — so the app recommended a shopping trip over dinner. Needing to shop is not a slightly-worse kind of effort; it is a different kind of cost, because it happens *before* you can start and often means not eating tonight. So candidates now sort on `missing` first and on score only within a tier. Anything cookable right now beats anything that isn't, regardless of how pleasant the alternative looks. It is also the more explainable shape: "you have everything for this one" is the first reason a person wants to hear.

The remaining weights follow the briefed priority order, and were tuned against tests rather than guessed: expiry −8 (strongest single signal — food about to be thrown away is the most time-sensitive reason to cook something), balance 0/2/4, effort ×2 giving 0/2/4/6, active-time buckets 0–4, minimal-cleanup −2, appliance 0–4 with +1 for juggling two devices, variety −1/0/+1/+2 last as a tie-breaker. The initial expiry weight of −3 was also too weak — it lost to an easier rival's effort-plus-appliance edge, contradicting the stated priority order — and was raised until a test proving the intended outcome passed.

Effort deliberately reads **hands-on** time, not total time. A 40-minute pressure-cooker recipe you walk away from after 5 minutes outranks a 20-minute pan recipe you stand over for all 20, and there is a test that asserts exactly that inversion (total 40 vs 20, active-time cost 0 vs 2). `recipeActiveMinutes()` already falls back to total time for recipes that never declared `activeTime`, which is the safe direction: an unlabelled recipe is never mistaken for an effortless one.

Appliance friction is a small ordered table — no-cook 0, microwave/egg-boiler 1, rice cooker / steamer / Instant Pot / pressure cooker 2, oven 3, pan 4 — with a +1 for two distinct appliances. A rice-cooker-steamer is one device doing two jobs and never counts as two. An undeclared appliance scores 2, the middle: not rewarded for being unknown, not condemned for it. That matters more than it sounds, because **none of the 26 seeded sample recipes carry any of the D-055 metadata** — no equipment, effort, activeTime, mealBalance or tags. Every default in this wave was chosen so that a pre-D-055 recipe ranks sensibly instead of being buried, and there is a test that loads a legacy save and asserts the neutral defaults land.

Honesty rules are enforced by omission, and each has a test. A category is dropped rather than filled with a guess: no ready food → no "Eat this first"; no genuinely low-effort candidate (`recipeEffortScore > 2`) → no "Easiest", because labelling a normal-effort cook "Easiest" is a lie the user will notice once; empty `cookHistory` → no "Something different", because with no history everything is equally new and the reason would be invented. Returning one or two picks is a valid answer, and returning zero hides the card entirely.

Completion hints are deterministic sentences, not a composition engine: protein with no veg and no carb → "Add rice + steamed veg"; protein and carb but no veg on a rice-cooker-steamer → "Steam veg above the rice" (otherwise "Add steamed veg"); protein and veg but no carb → "Add rice or bread". They read the same `normalizeMealBalance()` everything else reads, and — crucially — a hint is only offered when there **is** a declared protein to build around. A batch with no source recipe, or a legacy recipe with no balance data, gets no hint rather than a guessed one. Nothing is composed, saved, or asked to be confirmed.

**Zero new persisted state.** No new `AppState` key, no new localStorage key, nothing written to `mealPrepAppData`. The answer is derived fresh on every render and a test asserts that neither `AppState` nor the persisted payload grows a recommendation-shaped field. A separate test hammers the read path — rank, build candidates, render the card, render the dashboard twice — and asserts pantry, cooked meals, grocery list, deletions, cook history and the `mealPrepFoodAlerts` notification ledger are all byte-identical afterwards. **Displaying a recommendation consumes nothing**; only the existing `useCookedPortion()` / `finishCookedMeal()` / cook actions mutate anything, and those were not modified.

The card is additive, not a redesign. It renders above the existing "Ready to eat" and "What should I cook?" cards, both of which are untouched — their tests assert their presence, their contents and their relative order, and all still pass. The recipe quick-filters (rice cooker, rice + steamer, Instant Pot, oven, pan, no-cook, lowest effort, batch-friendly) are likewise untouched and covered by a new test that exercises every chip: recommendations shorten the path when you have no opinion, filters remain the escape hatch when you do.

Labels use the inline Lucide icons (`soup` / `timer` / `salad`) rather than the 🍱 ⚡ 🍽️ emoji the brief sketched. Not a style preference: 🍱 and 🍽️ rendered as tofu boxes in the review screenshots, and this repo already migrated off emoji for exactly that reason (see the `ICON_PATHS` comment). The card shows reasons as chips and never a number — `score` and `parts` ride on the returned object for tests and debugging only, and a test asserts no rendered chip looks like a score.

Why: the alternative was a preference screen — weights, dietary targets, appetite, a questionnaire — which is how recommendation features usually die. Every signal used here is something the app already collects as a side effect of being used, so the ranking works on day one with no configuration, and it degrades to "here are one or two things" rather than to nonsense when the data is thin. Keeping ranking in a pure function with no DOM access is what made the weights testable one at a time; two of the three weighting bugs above were found by a test rather than by looking at the card.

Trade-off, stated plainly: Home now carries three suggestion cards — the new answer plus the two detail cards it summarises. That is redundancy, and it is deliberate for this wave, because the existing cards' tests assert their presence and order and the brief said not to redesign Home. If the new card proves itself in use, the honest follow-up is to fold "Ready to eat" and "What should I cook?" into it and delete both, which is a UI decision with its own test churn and belongs in its own wave.

Also deferred, not built: any use of `missing === 1` recipes as a shopping nudge (the tier makes them last-resort only, and turning them into grocery planning was explicitly out of scope), portion-aware serving maths (`wave1-portion-truth`, untouched), and any notion of meals as composed objects.

Risk gate: **outside D-032 red zone.** This wave reads existing state and adds derived ranking plus one card. No change to sync, tombstones, `saveData()`, the `cloudReady` write-guard, auth, the service worker, or the notification machinery from D-058 — the ranking reads the same freshness state but writes none of it.

Supersedes: nothing. Composes D-055's recipe metadata and variety helpers, D-056's ready-food ranking, and D-057's `collectAttentionItems()` freshness model without modifying any of them.

## D-060 — Cooking-method discovery: the filters were never broken, the recipe book was empty

Task: `wave-cook-method-discovery`. Supersedes the discovery half of D-055 and the "quick filters are untouched and covered" claim in D-059.

The owner opened production Home and Cook and could not find low-effort cooking, rice-cooker recipes, or oven recipes. The instinct is to assume the filters were never built. They were — D-055 shipped `RECIPE_QUICK_FILTERS` with working `rice-cooker` / `oven` / `no-cook` / `lowest-effort` matchers, and D-059 added a test exercising every chip. Both were green the whole time.

What was actually true on `main @ 52f33ce`: **`#recipe-quick-filters` rendered as `display: none` with `innerHTML: ""` and zero chips.** `renderRecipeQuickFilters()` hid any chip matching no recipes, and every one of the eight chips matched zero, because **all 26 seeded sample recipes carried no `equipment`, `effort`, `activeTime`, `mealBalance` or `tags` at all**. D-059 recorded this fact in writing and designed neutral fallbacks *around* it instead of fixing it. The tests passed because every discovery test injected its own fully-tagged fixture recipes; nothing asserted anything about the data the app actually ships. That is the lesson worth keeping: **a feature test that supplies its own data proves the code works, not that the product does.**

Three changes, in the order they matter:

**1. Backfill the seeded recipes (the actual fix).** All 26 now declare `equipment`, `effort`, `activeTime`, `mealBalance` and `tags`, read off their own instructions. `activeTime` is hands-on minutes with unattended simmering excluded, so Laing (50 min total, 15 hands-on) is `low` while Pinakbet (35 total, 25 hands-on) is `normal`. Every value is verifiable against the recipe text, and a test asserts `activeTime <= prep + cook` for all 26.

**Nothing was invented, and this has a cost worth stating plainly: all 26 seeded recipes are stovetop Filipino dishes, so all 26 are `pan`. The book contains zero rice-cooker, oven, Instant Pot, or no-cook recipes.** Tortang Talong says "grill or roast" the eggplant and then pan-fries it; tagging it `oven` to populate a chip would be inventing a claim the recipe does not make, so it is `pan`. A guard test greps the instructions and fails if any recipe ever claims an oven without saying "oven/bake/roast", a rice cooker without saying "rice cooker", or `no-cook` while telling you to fry something. **The remaining gap is content, not code**: the Rice cooker and Oven chips work and are proven by tests against tagged fixtures, but they stay empty until rice-cooker and oven recipes exist.

**2. A primary cooking-method chip never hides.** Hiding zero-count chips is what made the capability invisible, and hiding it hardest exactly when the user most needs to know it exists. The row now always renders `All | Lowest effort | Rice cooker | Oven | Instant Pot | No-cook | Pan`, with empty primaries muted and dashed rather than absent. Tapping an empty one is not a dead end: it says "No rice cooker recipes yet — open a recipe, tick Rice cooker under Cooking method, and it will show up here", which is the on-ramp that populates it. Refinement chips (`Rice + steamer`, `Batch-friendly`) still hide when empty — they are narrower than a method and nobody goes hunting for them. The editor's `Equipment` label is renamed `Cooking method` so the chip and the field that fills it use one word; the `equipment[]` slugs are unchanged.

**Cooking method is presentation, not schema.** `Rice cooker` matches `rice-cooker` **and** `rice-cooker-steamer`; `Instant Pot` matches `instant-pot` **and** `pressure-cooker`. No `cookingMethod` field, no migration, no data touched — the user should never have to know the app distinguishes a rice cooker from a rice cooker with a steamer tray to find dinner. The finer slugs survive in the data and stay reachable through the refinement chip.

**3. One definition of "easy".** `Lowest effort` used `recipeEffortScore(r) <= 1` (assembly + very-low) while the Home "Easiest" pick used `<= 2`. Two thresholds for one word, which meant a recipe could be "Easiest" on Home and excluded from "Lowest effort" on Cook. The chip now uses `<= 2`, matching Home, and a test asserts the two agree rather than merely both existing.

The chip also **sorts**, not just filters — a "lowest effort" list is useless if the easiest thing is fifth. Ordering reuses the D-059 ranking helpers (`recipeEffortScore`, `activeTimeFriction`, `cleanupFriction`, `applianceFriction`) with raw `recipeActiveMinutes()` as a finer tie-break inside a friction bucket, because bucketing alone let the list fall to alphabetical and stop looking sorted. No second scoring system was introduced. The result is ordered by work, not clock: Nilaga (60 min total, 15 hands-on) outranks Chicken Adobo (45 min total, 18 hands-on), and a test asserts hands-on minutes never decrease down the list *while* total minutes do.

Mobile: the chip row scrolls on its own axis and is pinned with `min-width: 0` / `max-width: 100%` so a flex item cannot refuse to shrink and push the **page** into horizontal scroll. Chips were 23px tall on a phone — technically tappable, practically fiddly — and now have `min-height: 36px`. Tests assert no page-level overflow at 390px and a ≥32px tap target on every chip.

Home was **not** redesigned and no card was added, per the brief. The existing D-059 "What should we eat?" card simply got useful: before the backfill it rendered `Easiest → Corned Beef Guisado` with an **empty reasons array** — a recommendation that could not say why. It now renders `Easiest → Arroz Caldo · Pan · 15 min active · Minimal cleanup · Batch-friendly`. Same engine, same weights, same code path; only the data underneath changed. A test asserts the pick now carries at least one reason, names a cooking method, and states hands-on minutes.

Zero new persisted state. No new `AppState` key, no new localStorage key. `recipeQuickFilter` stays a module-scoped view variable that a reload forgets, and a test asserts the persisted payload's key set is byte-identical before and after filtering.

Two existing tests were updated rather than deleted, and both now assert the *new* contract at equal strictness: `low-effort-discovery.spec.js` asserted `Pan` was absent when nothing used one (now asserts it is present, muted, and reports 0) and `what-should-we-eat.spec.js` asserted `lowest-effort` counted 3 (now 5, under the aligned `<= 2` gate).

Risk gate: **outside D-032 red zone.** Recipe metadata, filtering, and presentation only. No change to sync, tombstones, `saveData()`, the `cloudReady` write-guard, auth, the service worker, or notifications.

## D-061 — A curated low-effort starter set, because D-060 proved the gap was content

Task: `wave-cook-method-discovery`, second commit. Closes the gap D-060 identified and could not honestly close on its own.

D-060 made the cooking-method filters visible and correct, then had to report that Rice cooker, Oven, Instant Pot and No-cook were all still empty: every one of the 26 seeded recipes is an explicitly stovetop Filipino dish, and tagging any of them `oven` to populate a chip would have been inventing a claim the recipe does not make. The filters worked; there was nothing to find.

Decision: add **14 new seeded recipes** (ids 27–40) written *for* the appliances the filters expose, rather than retag anything. Method counts went 0/0/0/0 → **Rice cooker 4** (2 `rice-cooker`, 2 `rice-cooker-steamer`), **Oven 4**, **Instant Pot 3** (2 `instant-pot`, 1 `pressure-cooker`), **No-cook 3**. Pan stays at 26. **All 26 original recipes are byte-identical** — the commit is a pure addition (+396 lines, zero deletions), and a test asserts ids 1–26 still carry exactly `['pan']` so no future edit can quietly relabel them to make a chip look busier.

**Written for the appliance, not merely compatible with it.** Every recipe's instructions describe how it is cooked in the appliance it declares: the rice-cooker recipes say what goes in the pot, when to press Cook, and what happens at Keep Warm; the two `rice-cooker-steamer` ones say what sits in the steamer basket and when. A test greps each recipe's own instructions and fails if an `oven` recipe never says oven/bake/roast, a rice-cooker recipe never says "rice cooker", an `instant-pot` one never says "Instant Pot", a `pressure-cooker` one never says "pressure cooker", or a `no-cook` one tells you to fry, boil, simmer or sauté. That guard is the thing standing between this set and padding.

**One appliance per recipe, deliberately.** `applianceFriction()` adds +1 for juggling two distinct appliances, so declaring `['instant-pot', 'pressure-cooker']` on a recipe that needs only one device would score it as *harder* than it is. Each recipe therefore names the single device it was written for; the chip's grouping (D-060) is what makes both slugs findable under one label. A test asserts no seeded recipe declares more than one appliance. Note the latent consequence, unfixed here because it affects nothing shipped: a **user** who ticks both Instant Pot and Pressure cooker on their own recipe in the editor still takes that spurious +1. The same class of bug is already exempted for `rice-cooker-steamer`; extending the exemption to the instant-pot/pressure-cooker pair is a one-line ranking change and was left out of this commit because the brief scoped it to content.

Low-friction is enforced, not just intended: no recipe in the set is `normal` effort (3 `assembly`, 4 `very-low`, 7 `low`), maximum hands-on time is 15 minutes, maximum ingredient count is 10, and 8 of the 14 are protein + vegetables + carb in one dish. A test asserts all of those bounds, plus that any `mealBalance` claim is backed by an ingredient of that category — a recipe cannot claim vegetables without listing one.

Effort ranking behaves correctly across tiers now that more than one tier exists in the shipped data: declared effort is the primary key, so an `assembly` bowl at 12 minutes hands-on outranks a `very-low` rice-cooker meal at 6. Two tests were tightened to assert the real contract — effort rank never decreases down the list, and hands-on minutes never decrease *within* a tier — rather than the global monotonicity that happened to hold when every low-effort recipe was `low`.

Home was not touched. Its existing "Easiest" pick now lands on **Tuna Vegetable Rice Bowl · No cook · 8 min active · Balanced · Minimal cleanup** on a fresh install, and on **Rice Cooker Chicken Mushroom Rice** once the pantry is stocked for it — the pantry-informed path reaching a new recipe through the normal cook-now tier, which a test asserts.

**Known limitation, stated because it decides how the owner actually gets these.** `ensureStarterRecipes()` is gated on `isFirstRun()` — sample recipes are injected into a brand-new install only, and never re-injected over an existing one (the R2 gate that exists so an empty recipe list stays the user's deliberate choice). **The owner's existing production install will not receive these 14 recipes automatically.** That gate is correct and was not weakened: re-injecting seeds into a live install is exactly the "write over the user's data" failure D-010 and the D-032 red zone exist to prevent. Getting the set onto an existing install needs a separate, additive, opt-in mechanism — an "add the starter low-effort recipes" action that merges by id and skips anything already present — which is its own decision and its own wave.

Judgement calls worth naming: potatoes are counted as the carb in Sheet-Pan Chicken & Vegetables and Pressure Cooker Nilagang Baka, so both claim `carb: true` without a grain; Overnight Oats is the one recipe in the set that is not protein-forward and honestly declares `protein: false`; and "Lechon Manok (Ready-Roasted)" is a free-typed ingredient with no INGREDIENT_DB entry, which is supported but means it contributes no price or pantry alias until one is added.

Risk gate: **outside D-032 red zone.** Seed content and tests only. No change to sync, tombstones, `saveData()`, the `cloudReady` write-guard, auth, the service worker, or notifications — and no change to any code path, only to the data `sampleRecipes` holds.

## D-062 — Appliance FAMILIES, not appliance labels, decide the juggling penalty

Task: `wave-cook-method-discovery`, third commit. Amends the `applianceFriction()` rule from D-059.

`applianceFriction()` adds +1 when a recipe uses two appliances, because two devices means two things to run and two things to wash. D-059 already knew one slug pair was not really two devices and special-cased it inline: `eq.filter(id => id !== 'rice-cooker-steamer')`, on the grounds that a rice cooker with a steamer tray is one machine doing two jobs.

The same is true of `instant-pot` and `pressure-cooker` — they are the same pot under two names — and that pair was never exempted. A user who ticks both in the editor (entirely reasonable: "either works") had their recipe scored as *harder* than one that ticked only one. No shipped recipe hits this, because the D-061 starter set deliberately declares a single appliance each, but every user recipe could.

Decision: replace the one-off label filter with an explicit family map.

```js
var APPLIANCE_FAMILY = {
  'rice-cooker-steamer': 'rice-cooker',
  'pressure-cooker': 'instant-pot'
};
```

The penalty now counts distinct *families*, not distinct slugs. Friction COST is untouched — a steamer combo still costs 2, an oven still costs 3 — only the "how many appliances is this really" question changed.

Why a map rather than extending the filter, which would have been the smaller diff: the filter approach drops a label out of the count entirely, and that is wrong in the other direction. Filtering out `pressure-cooker` would mean `['pressure-cooker', 'oven']` — a genuine two-appliance recipe — counts as one appliance and loses a penalty it should pay. The family map keeps that case at +1 while fixing the equivalent-label case, so it is the only version of this change that does not trade one wrong answer for another.

One case beyond the brief's ask changed as a consequence, and it is worth naming rather than burying: `['rice-cooker-steamer', 'oven']` previously escaped the penalty (the old filter removed the steamer slug, leaving a count of one) and now pays +1. That is a recipe using a rice cooker *and* an oven — genuinely two appliances — so the new answer is the correct one, but it is a ranking change nobody requested. No test asserted the old value; a test asserts the new one. Revert by dropping `'rice-cooker-steamer'` from the map if the old leniency was intentional.

A focused regression test pins all of it: both Instant Pot labels tie with one, both rice-cooker labels tie with one, and `pan`+`oven`, `pressure-cooker`+`oven`, `rice-cooker-steamer`+`oven` all still pay the juggling +1. A second test asserts the ranking-level consequence — two recipes identical except that one declares both Instant Pot labels now score the same `parts.appliance`.

Risk gate: **outside D-032 red zone.** Pure ranking arithmetic, no persisted state, no sync surface.


## D-063 — The starter pack is opt-in and additive, because the first-run gate is right

Task: `wave-cook-method-discovery`, third commit. Closes the delivery gap D-061 reported.

D-061 added 14 low-effort recipes to `sampleRecipes` and had to end with a limitation: `ensureStarterRecipes()` is gated on `isFirstRun()`, so only a brand-new install ever receives seed content. Every existing install — including the owner's — would keep four visible, correct, empty cooking-method filters forever.

The tempting fix is to loosen the gate: "only re-seed if the recipe is missing". That gate exists because an empty recipe list is a legitimate user choice, and re-injecting seeds over live data is the exact failure mode D-010 and the R2 rule were written to prevent. **The gate was not touched.** Instead, delivery became an explicit user action.

**The surface.** One compact card on Cook, rendered from `renderRecipes()` into `#starter-pack-prompt`, sitting directly above the quick-filter row — so the offer is adjacent to the four chips reading `0` that it fills. Title "Low-effort starter recipes", one line of subtext, one `Add recipes` button. Not a modal, not fixed-position, nothing auto-added, and a test asserts both of those. The subtext states the count when the install is only partly missing the set ("10 low-effort starter recipes available") and names the methods when it is missing all of it.

**What counts as missing.** `starterPackCandidates()` disqualifies an id for exactly two reasons, and the second is the one that matters:

- **Already present.** Presence is a permanent skip. No comparison, no merge, no "the seed is newer" — the user may have renamed, rescaled or rewritten that recipe, and their copy wins unconditionally. A test edits recipe 31 beyond recognition, adds the pack, and asserts every edited field survives and no duplicate appears.
- **Tombstoned.** `AppState.deletions` is the existing synced `id -> deletedAtISO` map and `recipes` is already one of the `TOMBSTONE_KEYS`, so deletion intent was fully detectable with **no change to sync or tombstone architecture** — which is what the brief asked to be verified before implementing. Re-offering a deleted recipe would undo a decision the user made; worse, adding it back with a fresh `updatedAt` would beat its tombstone under `applyTombstones()`' LWW comparison and resurrect it on *every* device. The pack reads that map and never writes it, and a test asserts the map is byte-identical after an add.

The honest limit: `purgeOldTombstones()` forgets markers older than 180 days, so a starter recipe deleted longer ago than that becomes offerable again. That bound is deliberate in the sync design — defeating it would need a new persisted field, which this feature does not justify.

**Duplicate protection is in the function, not the button.** `addStarterPackRecipes()` re-derives candidates on every call, so calling it three times in a row after a successful add is a no-op; a test drives the handler directly rather than clicking, because a guard that only exists in the UI is not a guard. Reload safety falls out of persistence: the added recipes are in storage, so they are present, so they are not candidates.

**Persistence uses the existing path and nothing else.** Added recipes are deep copies (`JSON.parse(JSON.stringify(...))`) so `AppState` never holds a reference into the `sampleRecipes` constant — a test mutates an added recipe and asserts the seed is unchanged. Each copy is stamped with `updatedAt`, which is what tombstone LWW and the local-vs-cloud merge both read. Then `saveData()` — Hard Rule 5, localStorage and Firestore through the one save path.

`patchMissingNutrition()` (Hard Rule 4) is called on **the new copies only**, not the whole list. Running it over `AppState.recipes` also stamps empty metadata defaults onto the user's own recipes, and a caught test failure is what surfaced that: adding a starter pack has no business rewriting anything the user made, even harmlessly.

**Zero new state.** No new `AppState` key, no new localStorage key, no "pack seen" or "dismissed" flag — there is nothing to remember, because the prompt's visibility is derived entirely from whether anything is eligible. It retires itself. A test snapshots `Object.keys(AppState)`, the persisted payload's key set, and every localStorage key before and after, and asserts all three are unchanged.

Deliberately not built, per the brief: no pack registry, no remote content, no downloadable packs, no versioning, no update/overwrite path, no automatic reseed. Adding a *second* pack later would need a real design; this is one list of ids and a presence check.

Risk gate: **outside D-032 red zone** — but closer to it than the previous two commits, so worth stating precisely why. The feature reads `AppState.deletions` and writes only to `AppState.recipes` via the normal `saveData()` path. It does not modify `ensureStarterRecipes()`, `isFirstRun()`, the tombstone functions, the `cloudReady` write-guard, or any merge code. The one genuinely dangerous version of this feature — re-seeding automatically — is the version that was not built.

## D-064 — Seeding hands AppState its own recipe objects, not the constant's

Task: `wave-cook-method-discovery`, fourth commit. Pre-merge data-isolation check.

Both seed entry points did `AppState.recipes = [...sampleRecipes]`. Spread copies the **array**; every recipe object inside stayed shared with the module constant. This was flagged as suspicious in the D-063 report and was checked before being changed, because "shallow copy looks wrong" is not by itself a reason to touch production code.

It was reachable, and proven so rather than argued:

- **All 40 objects shared.** `AppState.recipes[n] === sampleRecipes[n]` for every entry after a seeded boot.
- **Ordinary interactions rewrite the constant.** `toggleFavorite()` (`recipe.favorite = !recipe.favorite`), `updateServingSize()` (`recipe.currentServings = n`), and `normalizeRecipes()` (which reassigns `equipment`, `tags`, `mealBalance` to fresh objects) all mutate in place. A probe confirmed `sampleRecipes` entry 27 came out with `currentServings: 8` and `favorite: true` after nothing more than scaling and favouriting in the UI.
- **And it leaked into user data.** The exploit path: seeded session → user scales and favourites a starter recipe → something replaces `AppState.recipes` with a set lacking 27–40 (a sign-in merge from an older device does exactly this) → the D-063 starter pack sources those ids from `sampleRecipes` → the recipes are added **pre-scaled to 8 servings and already favourited**, then persisted and synced. Reproduced end to end before the fix.

The blast radius was one session, since the constant is re-evaluated on every page load — which is why this never showed up as a permanent corruption and why it survived this long.

Fix, using the deep-copy pattern `addStarterPackRecipes()` already established:

```js
function cloneSeedRecipes() { return JSON.parse(JSON.stringify(sampleRecipes)); }
```

Applied at both seed entry points (`ensureStarterRecipes()` and the Firebase-unavailable fallback). A third aliasing site was fixed in the same class: `patchMissingNutrition()` assigned `source.nutritionPerServing` — a reference **into** the constant — onto the recovered recipe, so a later nutrition edit would rewrite the seed. It now copies.

Explicitly NOT changed: `isFirstRun()`, the first-run gate itself, when seeding happens, tombstone logic, or ranking. Only *what objects* seeding hands over.

A correction to the D-063 report, which called the Firebase-unavailable fallback a latent bug for checking `hasLoadedData` instead of `isFirstRun()`: it is not a bug. `loadFromLocalStorage()` returns true whenever a saved record exists — including one whose `recipes` array is deliberately empty — so a saved empty list is never re-seeded over. A test now pins that behaviour.

Also fixed: two Playwright harnesses cleared `localStorage` from `addInitScript`, which re-runs on **every** navigation including `page.reload()`. Their reload assertions were therefore starting from a blank slate and proving nothing — the starter-pack "survives a reload" test passed only because a fresh re-seed also yields 40 recipes. Both now guard the clear behind a one-time flag, so reload exercises the real restore path. This is why the seed-isolation reload test failed on first run: it was the first test to actually reload into saved state.

Out of scope and left alone: `[...defaultStorageData]` and `[...defaultCookingHacks]` in the same fallback share objects the same way. No mutation path was audited for them and the brief scoped this to recipe objects; they are recorded here as known, unaudited, same-class candidates.

Risk gate: **outside D-032 red zone.** No sync, tombstone, save-path, auth or service-worker change. The three touched lines make copies where references were being handed out.

## D-065 — A hygiene check may not halt the run, and one test number may not answer two questions

Task: TASK-049. Test-infrastructure only; no product behaviour changed.

### The automation halt was not a bad path

The brief for this wave stated that the overnight run halted because it invoked
`Check-DocsConsistency.ps1` instead of `.\tools\Check-DocsConsistency.ps1`. **That is not what the
code does, and it is worth recording that the premise was checked rather than acted on.**
`run-claude.ps1` has always used a full path (`& "$projectPath\tools\Check-DocsConsistency.ps1"`),
the line is byte-identical to what was present at the halting commit, and it runs correctly under
both Windows PowerShell 5.1 — which is what the scheduled task actually uses — and pwsh 7. No
bare-name invocation exists anywhere in the repo.

The observed message (`The term 'Check-DocsConsistency.ps1' is not recognized…`) is only ever
produced by a bare-name call: with a path, PowerShell names the *whole path* in the error. That was
established experimentally rather than assumed — an empty `$projectPath` yields
`'\tools\Check-DocsConsistency.ps1'`, a missing file yields the full path, and only a bare name
yields the bare name. **The halt is therefore not reproducible from HEAD and its trigger remains
unexplained.** Nothing was "fixed" to make an unreproducible error go away.

What *is* certain, and is the real defect: Phase 3b's own comment promised
"Non-fatal: drift is a hygiene finding, not a safety issue, so it never halts automation" — and the
next lines read `} catch { Halt-Automation ... }`. Whatever made the checker throw that night, a
**docs-drift report killed the entire overnight run** and skipped every downstream phase. A check
that cannot fail safely is worse than no check, because it converts a cosmetic finding into an
outage.

Decision: Phase 3b now matches its documented contract. The script path is resolved once into
`$docsCheckScript` via `Join-Path`, its existence is tested explicitly (so a genuinely missing file
reports *that*, instead of a `CommandNotFoundException` whose message can only echo the string it
was handed — precisely why the original failure was hard to read), and both the missing-file and
throwing branches log a warning, append it to `DIGEST.md`, and **let the run continue**.
`Halt-Automation` is gone from the block. Verified under PowerShell 5.1: script-present, script-
missing, and script-throws all reach the end of the block without halting.

`tests/suite-classification.spec.js` pins it: one test asserts the Phase 3b window still contains
the `Test-Path` preflight and contains no `Halt-Automation`, and another asserts every `tools/*.ps1`
path referenced by `run-claude.ps1` resolves to a file that exists — which catches the whole class
of bad-invocation regressions, not just this one script.

### One number answering two questions

`npm test` ran every spec together, but the 31 spec files answer two unrelated questions. Twenty-one
load `index.html` from the checkout over `file://`; ten fetch
`https://shinyamadasan.github.io/Meal-Prep/`. Mixing them meant a branch's "full suite" result partly
measured whatever was already **deployed** — so it could not validate unmerged code — and network
latency produced failures that read as regressions. During the previous wave one production smoke
took 5.0 minutes and failed, then passed 8/8 in 41 seconds; three separate CI investigations were
spent on that class of noise.

Decision: two Playwright **projects** in a new `playwright.config.js`, and scripts to match:

| command | project | what it is for |
|---|---|---|
| `npm test` → `npm run test:local` | `local` | the deterministic pre-merge branch gate |
| `npm run test:prod` | `prod` | post-deploy verification of the live site |
| `npm run test:all` | both | escape hatch; not a gate |

`npm test` means the local gate because that is the question a developer and a pre-merge check are
actually asking. Nothing stops being verified: CI now runs `test:local` **first** (fast, offline, and
it reports a real regression in about a minute instead of after a 90-second Pages sleep), then keeps
the existing sleep and runs `test:prod`.

The prod set is an explicit list rather than a filename pattern, because three live-site specs
predate the `production-smoke-*` convention (`button-smoke`, `buttons-functional`, `smoke`) and
renaming them is not this wave's business. An explicit list can rot, so
`tests/suite-classification.spec.js` runs in the local project and fails if any spec containing the
deployed URL is missing from the list, if any listed spec no longer touches the network, or if a
listed file does not exist. Misclassification cannot be silent.

Everything else in the config is left at Playwright's defaults on purpose. Introducing a config file
must not quietly re-tune timeouts, retries, workers or reporters.

### Fixed waits: 16 replaced, 0 retained

All 16 fixed 2500 ms Playwright waits across the 9 remaining local specs were classified before any
edit. Every one sits immediately after a `page.goto` or `page.reload` — category **A**, waiting for
application initialisation. None waits on network or Firebase (every local spec aborts
`**/firebasejs/**`), and none is intentional user-visible timing. There was no category-C wait to
preserve, so none was preserved; had there been one it would have been left with a comment.

They are replaced by one shared readiness helper in `tests/app-ready.js` waiting on what
"initialised" actually means here: `AppState.recipes` present, `saveData` defined, and `#dashboard`
rendered — which `initApp()` does last via `showTab('dashboard')`. Deliberately **not**
`recipes.length > 0`: several specs boot a saved document with zero recipes on purpose and that is a
legitimate ready state. Verified against both a first-run boot (seeds 40) and a saved-doc-with-no-
recipes boot; both satisfy the condition in under ~100 ms.

The diff across those 9 files is exactly 16 wait replacements plus 9 `require` lines — no assertion
was touched, no tolerance widened. The local suite went from ~2.4 minutes to ~59 seconds and passed
230/230 on repeated runs.

Not converted, deliberately: the three specs hardened during D-064 already wait on conditions and
carry their own local helper; re-pointing them at the shared helper is churn with no behavioural
gain. The production smokes keep their own longer waits — they are waiting on a real network and a
CDN, which is category **B**, and no local readiness condition applies.

Risk gate: **outside D-032 red zone.** No product source file (`app.js`, `index.html`, `style.css`,
`sw.js`, `manifest.json`) is touched — verified by diff against `main`.

Addendum (TASK-055, 2026-08-25): **`waitForAppReady()` proves the app painted, not that a saved
document was restored** — and three CI failures came from tests reading it as the latter.

On 2026-08-25 the local branch gate went red twice on `56d8da7` with the product source
byte-identical to a run that had passed: `kitchen-truth` (`pantryHas: false`),
`low-effort-metadata` (recipe `undefined`), then `cook-depletion-tombstones` (`pantryIds: []`).
Different specs each run, all three asserting immediately after `page.reload()` +
`waitForAppReady()`, all three passing locally on repeat. A `workflow_dispatch` re-run of the
identical commit was green.

The mechanism is in this decision's own helper. `initApp()` ends with `showTab('dashboard')` →
`renderDashboard()` **unconditionally**, on whatever `AppState` holds at that moment. When
`window.firebase` is present the restore happens later, inside the async `onAuthStateChanged`
callback, so the dashboard can paint — and this decision's condition go true — against a
still-default `AppState`. Measured on this app: readiness at 346 ms, the saved pantry landing at
406 ms. The only thing covering that 60 ms gap was the helper's trailing `waitForTimeout(150)`:
**elapsed time standing in for a state check**, which is the very substitution this decision
replaced 2500 ms waits to avoid. It survived because 150 ms is plenty on a developer machine and
is not on a loaded two-worker runner.

Reproduced rather than assumed. Under 20× CPU throttling with 8-way parallelism the pantry read
back **empty** after reload — the exact CI symptom. An A/B harness running both strategies against
the same throttled page, ten times: the old pattern failed **2/10**, waiting for the state itself
failed **0/10**.

Honest limit on the diagnosis: that reproduction needed the async-init path. The three specs abort
Firebase, and in that path `initApp()` is fully synchronous, so readiness genuinely implies restore
— locally it never showed the gap even at 20×. **The failure class is reproduced; the specific
condition that opened the gap past 150 ms on the runner is inferred.** The fix does not depend on
which it was: if the state truly never arrives, the wait now times out naming that state instead of
producing an assertion diff against an empty `AppState`.

### The rule

> Never let elapsed time stand in as evidence that restoration finished when a state condition is
> available. After a reload, wait for the state the test is about to assert — the narrowest
> truthful one, not a convenient global.

`tests/app-ready.js` gains `waitForRestored(page, predicate)` — `waitForAppReady()` plus the
caller's own condition — applied at the three proven sites. `waitForAppReady()` itself is
**unchanged**: "booted and painted" is still the right contract for the ~300 tests that only need
that, and narrowing it to "a saved document is loaded" would break the specs that deliberately boot
an empty or seeded one.

Deliberately not done, and the residual risk (**the count here is corrected by Addendum 2 below,
which audited them: 16 reload sites across 13 specs, not eleven across ten**): **other
`page.reload()` sites still use the bare helper** (`bulk-add-date-truth` ×2, `inventory-quantity-truth` ×2,
`seed-isolation` ×2, `bulk-add-partial-retry`, `cook-method-discovery`,
`food-attention-notifications`, `inventory-expiry-display`, `ready-food-portions`,
`recipe-edit-preservation`, `starter-pack`). They carry the same latent exposure and were left
alone because none has yet been observed failing and the wave was scoped to the proven three; a
repo-wide migration is its own task. The short 200–400 ms interaction waits this decision
deliberately kept are likewise untouched — none was implicated.

No retries were added. The preferred state for a deterministic branch gate is `retries = 0` with
tests that do not depend on timing, and adding a retry here would have hidden the defect rather
than fixed it.

Landed as an operator-approved D-032 `done` merge: `--no-ff` at `1cee2d9` (parents `56d8da7` +
`4f1b9d9`), the reviewed commit unchanged. Recorded as TASK-055 — an addendum to this entry, not a
new decision, because it corrects this decision's own helper rather than establishing a new one.

The first push-triggered run after the merge went red on `bulk-add-partial-retry.spec.js:426` with
`AppState.pantry` reading back `[]` — the identical signature, in one of the eleven un-migrated
sites listed above; all three fixed specs passed, and `workflow_dispatch` on the same SHA was green
(local 335, production 137, no retries). Recorded rather than re-run for green. That is
corroboration, not falsification: the class is real, the fixed sites hold, and the next flake landed
exactly where this addendum said it would — which promotes the remaining-reload migration from a
theory to an evidenced follow-up task.

Addendum 2 (TASK-056, 2026-08-25): **the remaining reload sites, audited and migrated.** The
addendum above left them alone on the grounds that none had been observed failing. That held for
one CI run. The very next push-triggered gate went red on
`bulk-add-partial-retry.spec.js:426` — `Expected ["Chicken","Eggs","Milk"], Received []` — the
identical signature in one of the sites named as residual risk, so the migration stopped being
speculative cleanup.

**The inventory in that paragraph was wrong, and the corrected count is worth recording.** A recount
from source finds **16 `page.reload()` call sites across 13 local specs**, not eleven across ten:
three were the ones TASK-055 had already fixed, and two more (`ready-food-portions`,
`recipe-edit-preservation`) already carried correct inline restore-waits and had simply not been
recognised as such. Every site was classified before anything was edited:

| class | meaning | count |
|---|---|---|
| **A** | assertion depends on restored state → migrate | **14** (3 done in Addendum 1, **11 migrated here**) |
| **B** | reload tests boot/view behaviour only → keep `settled()` | **1** |
| **C** | harness defect: init setup re-runs on reload | **1** (the same site as the B one) |
| **D** | asserts ABSENCE; no positive predicate exists | **1** |

14 of the 16 sites now use `waitForRestored()`; two are deliberately retained (the B/C site and the
D site). No reload site anywhere in the local suite still reads persisted state after a bare
`waitForAppReady()`.

**Class B/C — `cook-method-discovery`.** Its reload asserts `recipeQuickFilter === ''`, i.e. that a
module-scoped variable is view state and not a preference. A reload clears JS variables
unconditionally, so no restored state is involved and `settled()` is the right wait; left unchanged.
But its `addInitScript` was the **only one of the thirteen with no bootstrap sentinel** —
`localStorage.clear()` ran on every navigation, reloads included. That is not currently a false
positive (the assertion holds either way, because the variable is not persisted anywhere), but it
primes the file: any future reload-persistence test added there would have passed from re-seeding
rather than from restoration. Guard added to match all twelve siblings. No assertion changed.

**Class D — `seed-isolation`'s "deliberately empty recipe list stays empty".** Its claim is that the
first-run gate does *not* re-seed, so the state to wait for is an absence, and no predicate can
prove it has arrived. It already documents this and waits on init completion plus a fixed 1500 ms.
That fixed wait is a genuine residual risk — if init were slow enough, the test could assert before
a re-seed would have happened and pass for the wrong reason — but closing it needs a signal the
product does not currently expose, and inventing one is a product change. Left as-is and recorded.

**Predicate discipline.** The default is to wait on the record's IDENTITY and let the assertions own
its fields: a pantry row or recipe restores atomically out of one `JSON.parse`, so "the row is back"
proves restoration, and keeping the field checks in `expect()` means a real persistence bug stays a
readable diff instead of becoming a timeout. Two sites are deliberate exceptions, because identity
alone cannot distinguish restored from re-seeded there — `seed-isolation`'s edited-recipe test (a
fresh seed also has ids 27 and 5, so the predicate has to name `favorite === true` and
`currentServings === 6`) and `starter-pack` (a fresh seed also yields 40 ids, so the predicate
requires every saved id to be back).

**Reproduced, not inferred, this time at the exact failing site.** An A/B harness replayed
`bulk-add-partial-retry`'s reload against the same 20×-throttled page, ten runs: bare
`waitForAppReady()` failed **4/10**, and what it read was `[]` — the CI symptom exactly.
`waitForRestored()` failed **0/10**. In the spec's own abort-Firebase mode both were 0/10, which
remains the honest control: the gap needs the async-init path, so the class is reproduced while the
specific runner condition stays inferred.

Negative-proofed as one sweep: sabotaging every restored collection makes **all eleven** migrated
waits time out naming their missing state, across every predicate shape used (pantry-by-name,
pantry-by-id, recipe-by-id, cookedMeal-by-id, alert ledger, edit-witness, id-set).

Still no retries, for the same reason as before. `waitForAppReady()` is still unchanged and still
means "booted and painted".

Landed as an operator-approved D-032 `done` merge: `--no-ff` at `92dbdea` (parents `8b13ddf` +
`ac64da8`), the reviewed commit unchanged. Recorded as TASK-056, an addendum to this entry rather
than a new decision, because it completes this decision's own testing rule instead of establishing
another.

The first push-triggered CI run after the merge was **green on attempt 1 with no retries** — local
gate 335 passed at 2 workers, production gate 137 passed, `bulk-add-partial-retry` passed, the three
TASK-055 specs passed, and the production gate followed the local gate normally for the first time
in three landings. One green run is not proof that an intermittent class is gone; the next several
ordinary push-triggered runs are the evidence, and no commits are being manufactured to produce
them.

### The finalized rule

> After `page.reload()`, a test that depends on persisted application state must wait for that
> specific restored state. `waitForAppReady()` proves only boot and render completion. A rendered
> application is not proof that anything was restored.


Verify: tests/app-ready.js contains "async function waitForRestored(page, predicate"

Verify: run-claude.ps1 contains "Test-Path -LiteralPath $docsCheckScript"
Verify: package.json contains "playwright test --project=local"
Verify: package.json contains "playwright test --project=prod"


## D-066 — The item name is not a notes field: quantity, unit and expiry get their own inputs, and the card shows the date it is counting to

Dogfooding find, 2026-08-24. UI + data-entry only; no storage, sync, tombstone, `saveData()`,
`cloudReady` or auth code was touched.

### What was actually wrong

A user with a carton of eggs typed everything they knew into the one field the Inventory add row
offered and got a card reading `eggs 12pcs august 10 2026` · `3d left`. The reported symptom was
that the date looked embedded in the name and only the relative freshness was exposed.

Characterising it before fixing it showed the symptom was the smaller half. `addToPantry()` took
`#pantry-input` verbatim as `name`, so the whole string **was** the name — `quantity` stayed `null`,
`unit` stayed `''`, and `expiryDate` was never set. `inferCategory()` still loose-matched "eggs"
inside the string and returned `Protein`, whose `categoryShelfLife()` default is **3 days**. That,
not the typed date, is where `3d left` came from. Replaying the exact input against the shipped code
confirms it: the same item entered with its real date is `Expired 14d ago`.

So the badge was not ambiguous, it was **wrong** — it asserted three days of remaining life for food
whose printed date had already passed. Invented freshness is worse than absent freshness, and it
lands directly on north-star goal #2. The screenshot was a data-entry defect wearing a rendering
defect's clothes.

### Decision

**Two fields the user can fill, one date the card can show.**

The add row keeps its single name box and gains an optional detail line — `#pantry-qty`,
`#pantry-unit`, `#pantry-expiry`. `addToPantry()` reads them into `quantity`, `unit`, `expiryDate`
and `dateMode`, producing the **same record shape `confirmBulkAdd()` already produced**, so the two
manual entry points stop disagreeing about what an inventory record looks like.

Cards render the three concepts as three elements: `.pi-name`, `.pi-qty`, and a new `.pi-date` line
beneath the name. The relative badge is untouched — it was never the problem.

`pantryExpiryInfo()` supplies the date and deliberately branches on `dateMode` **exactly as
`pantryDaysLeft()` does**, rather than computing an expiry boundary of its own. The date on a card
and the "3d left" beside it are therefore two renderings of one number and cannot drift apart. A
spec sweeps ±400 days across both modes asserting they always name the same day.

### Why "Best by" and "Expires" are different words

A printed date off a pack is the user's own fact; a bought-date-plus-shelf-life date is the app's
estimate from a coarse table. Labelling both "Expires" would launder an estimate into a claim the
app cannot support, which is the same failure the `3d left` badge was already committing. So a
`dateMode: 'expiry'` record says **Expires ‹date›** and everything else says **Best by ‹date›**, set
in a quieter style, with a `title` spelling out the derivation. `dateMode` already encoded this
distinction in the data; the UI simply stopped hiding it.

### Relationship to D-057 — checked, not assumed

D-057 removed `addToPantry()`'s reads of `#pantry-qty-input` / `#pantry-add-where`, and
`docs/FEATURES.md` recorded that `addToPantry()` "leaves quantity unknown". That reads at first
glance like this change reverses a decision, so the boundary is worth stating precisely.

D-057's "no modal, no quantity prompt, no date entry" is scoped to **grocery check-off** — Bought ✓
being the whole interaction — and that path is untouched here. The elements it stopped reading had
already been deleted from `index.html`; what D-057 removed was dead null-guarded code, not a
product capability.

What D-057 does assert globally is that the app admits ignorance rather than inventing a number.
That rule is preserved literally: every new field is optional, and blank means unknown. No quantity
still stores `quantity: null` rather than `1`, and no date still leaves the item in bought-date mode.
A user who ignores the detail line gets byte-identical behaviour to before. The change adds a place
to put a fact the user already has; it never asks for one they do not.

The stale half of the FEATURES line was corrected rather than left to disagree with the code.

### Deliberately not done

- **No natural-language date parsing.** "august 10 2026" is not parsed, and neither is
  "eggs 12pcs …". Guessing a date from prose is ambiguous across locales, and a mis-parse feeds the
  freshness system a wrong number silently — the exact failure mode this entry exists to close.
  An explicit `type="date"` input cannot be misread.
- **The quick-add box does not adopt the bulk parser's `Name, Qty, Unit` grammar.** The two entry
  points now agree on the record they produce, which was the real inconsistency; making the name box
  also swallow trailing numbers would break legitimately numeric ingredient names.
- **No warning when a name still looks like it contains a quantity or a date.** Speculative, and the
  fields now make the right place obvious.

### The pre-existing squeeze that made the new fields unusable on a phone

`.pantry-add-row` was `display: flex` with no `flex-wrap`. `.ing-name-wrap` carries a global
`min-width: 0` and its input is `width: 100%`, so the name field's min-content contribution was
**zero** and five buttons on one unwrapped line crushed `#pantry-input` to **26px** at both 320px
and 390px. Measured against unmodified `main`, so it predates this change.

It was found while shipping the fields above and was initially left alone under the surgical-changes
rule. That was the wrong call once the consequence was clear: the structured fields this entry adds
are worth nothing if the row carrying them cannot be typed into on the phone the app is dogfooded
on, so the defect is in scope after all and is fixed here.

Two properties, no redesign: `flex-wrap: wrap` on the row, and `min-width: 12rem` on
`.pantry-add-row .ing-name-wrap`. The floor stops the name field collapsing and the wrap sends the
surplus buttons to a second line instead of squeezing it. The override is **scoped to this row**
because the same `.ing-name-wrap` is reused by the custom-item modal, which must not change.

Measured `#pantry-input` width, before → after: 320px **26 → 188**, 390px **26 → 179**,
414px **45 → 203**. 768px (399) and 1280px (943) are byte-identical and the desktop row still
renders on one line, so compact desktop behaviour is preserved rather than traded away. No
horizontal page overflow at any of the five widths, before or after.

A free-text parser was again rejected as the alternative, for the reasons under "Deliberately not
done" — the problem was that the fields had no room, not that they were the wrong shape.

Supersedes: nothing. Corrects a stale behaviour description in `docs/FEATURES.md` left by D-057.
Regression-locked by `tests/inventory-expiry-display.spec.js` (14 cases, 6 of them mobile);
mutation-checked twice — the 8 data/display cases fail 7-of-8 against unmodified `main`, and the two
width cases fail against the pre-wrap CSS. The other four mobile cases (overflow, reachability,
persistence, not-one-column) pass both before and after by design: they guard adjacent failure modes
this particular bug did not exhibit.

Verify: app.js contains "function pantryExpiryInfo(p)"
Verify: app.js contains "Best by "
Verify: index.html contains "pantry-expiry"
Verify: style.css contains ".pi-date"
Verify: style.css contains "flex-wrap: wrap"

## D-067 — Bulk Add reads a trailing date, but only three shapes of one, and never guesses

Dogfooding find, 2026-08-25. Parsing and input copy only; the D-066 expiry model, its renderer
and every freshness boundary are untouched.

### The same defect, through the other door

D-066 gave the quick-add path structured quantity/unit/expiry inputs. Bulk Add kept its older text
parser, so the failure it fixed simply moved:

```
input : eggs 12 pcs aug 8 2026
stored: name="eggs 12 pcs aug 8 2026", quantity=null, unit="", no expiry
shown : Best by Aug 28 · 3d left
```

The whole string became the `name`. `inferCategory()` then loose-matched "eggs", returned `Protein`,
and `categoryShelfLife('Protein')` supplied **3 days** from today. The Aug 8 the user typed was never
read. Same invented freshness, same north-star-goal-#2 exposure, different entry point.

Characterisation found a second case that is arguably worse because it is silent in a different way:

```
input : eggs, 12, pcs, aug 8 2026
stored: name="eggs", quantity=12, unit="pcs", no expiry
```

Name, quantity and unit parsed correctly and the **fourth comma field was discarded entirely** — no
warning, no trace. The user typed a date and it evaporated.

Bulk Add had **no parser test coverage at all** before this. Every existing spec matching "bulk"
tests bulk *cleanup* (`removeAllExpired`), an unrelated feature.

### Decision

**Recognise a trailing date; never infer one.** `parseTrailingDate()` accepts exactly three shapes,
and only as a trailing segment preceded by whitespace or a comma:

| shape | example |
|---|---|
| `<month> <day> <year>` | `aug 8 2026`, `August 8th, 2026`, `Sept. 8 2026` |
| `<day> <month> <year>` | `8 aug 2026` |
| `<year>-<mm>-<dd>` | `2026-08-08` |

(The two month-word shapes also take a two-digit year — `aug 8 26` — mapped 00-99 to 2000-2099.
See the TASK-054 addendum at the end of this entry, which supersedes the "No two-digit years"
bullet below.)

On a match the date is removed and **the remaining text goes through the pre-existing quantity/unit
parser unchanged** — the comma path and `NO_COMMA_RE` are not touched, so `Eggs, 12, pcs` and
`Coconut cream 200ml` behave exactly as before. On no match the text is left completely alone.

This is not an NLP layer and must not become one. The whole safety argument rests on requiring a
**month word (or a full ISO date) plus a four-digit year**, which is why every name in the regression
list survives: `7 Up`, `Heinz 57 Sauce`, `Formula 1 Protein`, `Vitamin B12`, `12 Grain Bread`,
`Omega 3 6 9`, `Vitamin 2000`, `Sauce 12 2026`. None of them ends in a month followed by a year, so
none of them can be mistaken for one. Loosening that requirement — accepting a bare trailing number,
say — would break them all at once.

### Why 8/8/2026 is refused rather than parsed

It is day-first in half the world and month-first in the other half. Guessing wrong moves an expiry
by up to eleven months, which is precisely the invented-freshness failure this entry exists to close;
a silent wrong date is worse than an unparsed one. So an all-numeric separated trailing date is
recognised **only in order to say it is ambiguous**, and the line is added with its text intact plus
a warning naming the two unambiguous ways to write it. `looksLikeAmbiguousDate()` exists for that
message and for nothing else — it never produces a date.

The same reasoning drives the invalid-date rule: `feb 31 2026` is not nudged to March 3, it simply
is not a date, and the text is left alone.

### Expiry precedence

One rule, strongest first, with a weaker source never overwriting a stronger one:

1. explicit `exp:YYYY-MM-DD` on the line
2. a recognised trailing date on the line
3. the shared Bulk Add expiry field
4. otherwise `purchaseDate` + `shelfLifeDays` (bought-date mode)

A recognised trailing date is **always stripped even when `exp:` also appears**, so a date the user
typed can never survive inside the item name; it is stripped for hygiene and used only per the order
above. Existing `exp:` behaviour, including beating the shared field, is unchanged.

### A pre-existing date bug fixed in passing, deliberately

`exp:2026-02-31` used to pass the old `!isNaN(new Date(...))` check and store `2026-02-31`, which the
D-066 renderer then displayed as **"Expires Mar 3"** — a date the user never typed. `new Date()` rolls
over silently rather than erroring, so shape validation is not date validation. `isRealCalendarDate()`
round-trips through `Date` and is now used by **both** bulk-add date paths.

This is adjacent to the reported defect rather than part of it, and was fixed anyway because it is
the same class of error in the same function, and because leaving one date path able to invent a day
while hardening the other would have been incoherent.

### Deliberately not done

- **No migration of existing records.** A pantry item already named `eggs 12 pcs aug 8 2026` keeps
  that name. Back-parsing stored data would apply a guess to records the user has since edited or
  merged, and a wrong guess writes a wrong expiry into food safety. New submissions only.
- **No slash-date support**, per the ambiguity argument above.
- ~~**No two-digit years.** `aug 8 26` is refused; a century guess is a guess.~~ **Superseded by the TASK-054 addendum below** — two-digit years are accepted in the month-word shapes, under a fixed 2000-2099 map rather than a guess.
- **No change to the quantity/unit parser.** The date is removed and the existing parser runs on
  what is left — one parser, not two.
- **No second expiry model.** Everything lands in `expiryDate` / `dateMode` and renders through the
  D-066 path; `pantryDaysLeft()`, `pantryExpiryInfo()` and `FRESHNESS_WARN_DAYS` are unmodified.

### Known ambiguity, accepted

A product whose name genuinely ends in a month and a year — `Special Edition May 5 2026` typed with
no quantity — is read as `Special Edition` plus an expiry. Adding a quantity or unit after it
(`Special Edition May 5 2026, 1, box`) moves the date out of trailing position and the name survives
whole. Judged an acceptable trade for reading the date people actually type; the alternative is
ignoring every trailing date, which is the defect.

Supersedes: nothing. Extends D-066's model to the second manual entry point; corrects no earlier
decision.

Regression-locked by `tests/bulk-add-date-truth.spec.js` (21 cases, the first parser coverage Bulk
Add has ever had); mutation-checked against unmodified `main`, where **14 of 21 fail** — the 7 that
pass are the backward-compatibility guards, which are supposed to hold on both sides.

Verify: app.js contains "function parseTrailingDate(text)"
Verify: app.js contains "function isRealCalendarDate(y, m, d)"
Verify: app.js contains "looksLikeAmbiguousDate"
Verify: app.js contains "perLineExpiry || naturalExpiry || bulkExpiry"

Addendum (TASK-054, 2026-08-25): **the trailing month-word shapes now accept a two-digit year as
well as a four-digit one**, expanded `00`-`99` to `2000`-`2099` and then believed only inside a
food-inventory plausibility window of `[currentYear - 1, currentYear + 10]`. The "No two-digit years"
bullet above is superseded by this addendum; everything else in this decision stands unchanged.

Dogfooding produced the same complaint one door further along. `Eggs 12 pcs Aug 8 26` — how a carton
is actually printed and how a person actually types it — reproduced this entry's original symptom
exactly:

```
input : Eggs 12 pcs Aug 8 26
stored: name="Eggs 12 pcs Aug 8 26", quantity=null, unit="", no expiry
shown : Best by Aug 28 · 3d left        (inferCategory → Protein → 3-day category shelf life)
```

and the comma spelling reproduced the quieter one — `Eggs, 12, pcs, Aug 8 26` parsed name, quantity
and unit correctly and dropped the date field on the floor with no warning. The only thing separating
these from the already-fixed four-digit forms was the width of the year. Requiring `2026` every time
is a tax the user pays for the parser's convenience, and the tax was being collected in the currency
this entry exists to protect: an invented freshness date on real food.

**Expansion is deterministic; belief is bounded.** The expansion has no sliding window: `26` is
`2026`, `12` is `2012`, `99` is `2099`, never `1926`. A sliding century rule (nn < current+N ⇒ 20nn,
else 19nn) would be exactly the guess this entry refuses to make. What *is* bounded is whether the
result is believed at all: a two-digit year is accepted only inside a **food-inventory plausibility
window** of `[currentYear - 1, currentYear + 10]`, inclusive (`SHORT_YEAR_BACK = 1`,
`SHORT_YEAR_AHEAD = 10`, read through `shortYearPlausible()`).

Review caught why the window is needed. Under the first version of this addendum, which believed the
full `00`-`99` range:

```
input : Juice May 5 12
stored: name="Juice", expiryDate=2012-05-05
```

Juice that expired fourteen years ago is not a thing anyone types into a pantry. `May 5 12` is far
better explained as part of a product name, or as a typo, than as a date — and D-066's whole premise
is that a confidently wrong expiry is worse than no expiry. Standing in 2026 the window therefore
reads:

| short year | verdict |
|---|---|
| `25` (currentYear - 1) | ✅ last year's stock can still be in the freezer |
| `26` (currentYear) | ✅ |
| `30` | ✅ |
| `36` (currentYear + 10) | ✅ tinned goods and long-life staples, with room to spare |
| `24`, `12`, `99`, `00` | ✗ rejected as a short year |

The window is **relative to the clock, not a hard-coded range**: in 2030 the identical string
`Aug 8 26` stops parsing and `Aug 8 40` starts. That is asserted from one input across two pinned
clocks rather than assumed.

**The window gates the two-digit SPELLING only. It is not an expiry-age restriction.** A typed
four-digit year is a statement, not a shorthand, so `May 5 2012` is still stored honestly as
`2012-05-05`, and `May 5 1999` and `May 5 2099` likewise. Four-digit years remain governed solely by
`isRealCalendarDate()`, exactly as before this addendum. Nothing anywhere refuses to store an old
expiry — the app has to be able to describe food that has already gone off.

### A rejected short year is actionable, never silent

This is the half that matters more than the bound itself. When the grammar matched and the calendar
agreed but the year is outside the window, the date text is **not** swallowed back into the item
name — that would be the original D-067 defect wearing a new hat. `parseTrailingDate()` gained a
third verdict for exactly this:

| return | meaning |
|---|---|
| `{ iso, rest }` | a date, removed from the text |
| `{ shortYear: 'nn' }` | a real date whose short year is not plausible — hold the line back |
| `null` | not a date; leave the text completely alone |

On `{ shortYear }` the line becomes a D-068 **attention** row: not added to the pantry, exact
original text preserved in the textarea, modal stays open, and the note names both the problem and
the fix — *year "12" is outside the expected food-expiry range. Use a four-digit year if you mean
2012.* Correcting it to `May 5 2012` then succeeds and stores 2012. This is the same treatment an
ambiguous slash date already gets, for the same reason: an actionable line is never committed,
because a line cannot both be kept for correction and already exist.

### The one thing that outranks it: an explicit `exp:`

A short-year rejection is only actionable when the line offers **no other deliberate expiry**. A
valid `exp:YYYY-MM-DD` is the strongest and least ambiguous signal the format has, and this entry
already puts it at the top of the precedence ladder; a plausibility check on a *different* part of
the line must not quietly demote it. `exp:` is the documented escape hatch from parser ambiguity, and
an escape hatch that closes under the one condition you need it for is not an escape hatch.

So the rejection is raised only when `perLineExpiry` is empty:

| line | verdict |
|---|---|
| `Juice May 5 12` | **attention** — not added, exact text kept, asks for a four-digit year |
| `Juice May 5 12 exp:2026-08-08` | **added** — name stays `Juice May 5 12`, expiry `2026-08-08`, `dateMode: 'expiry'` |
| `Eggs 12 pcs Aug 8 26 exp:2026-09-01` | **added** — plausible date IS stripped, `exp:` still wins: `Eggs`, expiry `2026-09-01` |

Note what the middle row does *not* do: `May 5 12` is **not** stripped out of the name. It was never
accepted as a date, so removing it would be deleting text on the strength of a reading the parser
just refused. The record says exactly what the user typed plus the expiry they explicitly gave, and
nothing is invented in either field. The third row is unchanged from before this addendum — a
*recognised* date is still always stripped, and `exp:` still outranks it.

**Authority stops at `exp:`.** Neither the shared Bulk Add expiry field nor bought-date + shelf-life
inference rescues an implausible short-year line, and that asymmetry is the point. `exp:` is a date
the user typed *for this line*; the shared field and the shelf-life table are defaults that know
nothing about it. Letting either through would stamp a date unrelated to the one the user actually
wrote — invented freshness by a quieter door, and the exact class of failure D-066 and D-067 exist
to close. An **invalid** `exp:` rescues nothing either: it is rejected on its own terms first, and
the line stays actionable with the expiry error named, since that is the thing to fix.

Left deliberately unchanged: an ambiguous **slash** date is still held back even when the line
carries a valid `exp:`. That case differs in kind — `8/8/26` cannot be read at all, day-first and
month-first being equally defensible, whereas `May 5 12` is perfectly readable and merely
implausible. Extending the escape hatch there is a separate judgement call and was not made here.

**Order of judgement is deliberate.** Calendar validity is decided first: a day the calendar does not
have is not a date *at all*, whatever its year, so `Feb 31 12` keeps this entry's original
leave-the-text-alone behaviour rather than becoming an actionable short-year line. Only an
otherwise-valid date can be rejected for its year.

**What keeps product names intact was never the year's width — it is the complete grammar.**
Recognition still requires a month WORD *and* a day *and* a year, all in trailing position. That is
what the original regression list was really testing, and every name in it still survives untouched:
`7 Up`, `Heinz 57 Sauce`, `Formula 1 Protein`, `Vitamin B12`, `12 Grain Bread`, `Omega 3 6 9`,
`Vitamin 2000`, `Sauce 12 2026`, `Blend 2026`. The adversarial two-digit cases this addendum adds
survive for the same structural reason, not by luck:

| input | why it is not a date |
|---|---|
| `Formula 26` | no month word |
| `Protein 8 26` | two numbers, still no month word |
| `Sauce Aug 26` | month word, but only one number where the grammar needs day *and* year |
| `Vitamin May 26` | same, with the month word that is also an ordinary English word |
| `Eggs 8 26` | no month word |

**A two-digit number is never a year on its own** — only as the last token of a complete trailing
date, and only then if the window believes it. The expansion lives in one three-line helper,
`expandYear()`, and the bound in one more, `shortYearPlausible()`; both are called only from inside
`parseTrailingDate()`'s own `trailingDateVerdict()`, so nothing else in the app's text handling can
start reading years into numbers.

Everything else about this decision is deliberately untouched:

- **Numeric slash dates remain refused at every year width.** `8/8/26`, `08/08/26`, `8/8/2026` and
  `08/08/2026` all still go through `looksLikeAmbiguousDate()` to the D-068 attention flow with the
  original line preserved verbatim. Day-first-vs-month-first is not made less ambiguous by a shorter
  year, and a two-digit year would arguably make it worse. Supporting them was never a near-miss
  worth revisiting — it is a permanent refusal.
- **Calendar validation is unchanged and applies before nothing.** The year is expanded *first*, then
  `isRealCalendarDate()` round-trips it, so `Feb 31 26`, `31 Feb 26` and `Feb 29 26` (2026 is not a
  leap year) are rejected exactly as their four-digit twins are, and `Feb 29 28` parses exactly as
  `feb 29 2028` does. Nothing rolls over into March. The `exp:2026-02-31` fix recorded above is
  untouched.
- **Expiry precedence is unchanged**: `exp:` → recognised trailing date → shared field → bought-date
  + shelf life. A two-digit trailing date is stripped even when `exp:` also appears, same as a
  four-digit one — and, per the section above, a valid `exp:` also outranks a short-year rejection,
  which is what keeps that ladder intact rather than putting a new rung above its top.
- **The ISO shape keeps its four-digit year.** `2026-08-08` is the app's own storage format; a
  two-digit ISO year would be a new format rather than a spelling people already use.
- **D-068 and D-069 are untouched.** A two-digit-dated line is a resolved line (it leaves the
  textarea); a two-digit slash date is still actionable and keeps its exact original text. The
  parser's only job is turning text into the canonical `expiryDate` the merge path already reads, so
  `Eggs 12 pcs Aug 8 26` and `Eggs 12 pcs Aug 8 2026` produce byte-identical records and identical
  merge verdicts — proven by paired assertions in `tests/inventory-quantity-truth.spec.js` rather
  than asserted here.

Known ambiguity, widened slightly and accepted: a product name genuinely ending in a month, a day and
a two-digit number — `Trail Mix May 5 26` — is now read as `Trail Mix` plus an expiry. This is the
same trade already accepted above for the four-digit case, and the same escape applies: adding a
quantity or unit after the name moves the date out of trailing position.

Regression-locked by the extended `tests/bulk-add-date-truth.spec.js` (two-digit parsing, the
plausibility window at both bounds and one step past each, the window moving with the clock,
rejection UX, correction-to-four-digit, calendar rejection, slash refusal at both widths, precedence,
adversarial two-digit names, persistence, mobile, console-clean), plus paired D-068 and D-069 cases
in `tests/bulk-add-partial-retry.spec.js` and `tests/inventory-quantity-truth.spec.js`. Because the
expansion is now clock-relative, every case asserting a literal expanded year pins the clock with
`page.clock.setFixedTime()` (2026 for the era the literals are written in, 2030 to prove the window
moves) rather than inheriting whatever year the suite happens to run in; one case derives the bounds
from the app's own clock so it states the rule and cannot rot.

Mutation-checked nine ways, each caught: restoring the four-digit-only year requirement
(`(\d{4}|\d{2})` → `(\d{4})`) fails 12; removing the window (`shortYearPlausible` → `true`) fails 3;
moving either bound by one in either direction (`SHORT_YEAR_BACK` 1→0 or 1→2, `SHORT_YEAR_AHEAD`
10→9 or 10→11) fails 3 each; burying a rejected short year back in the item name
(`{ shortYear }` → `null`) fails 7; removing the `exp:` rescue (`if (!perLineExpiry)` → `if (true)`)
fails 4; extending the rescue to the shared expiry field fails 1; and stripping the implausible date
out of a rescued line's name fails 4. Every pre-existing case passes under all nine.

Landed as an operator-approved D-032 `done` merge: `--no-ff` at `7ce77cc` (parents `6692e2a` +
`f2aaca8`), the four reviewed commits unchanged, with the production-smoke follow-up at `88d6357`
written only after Pages had actually served `7ce77cc`. Final main `88d6357`; served `app.js`,
`index.html` and `style.css` verified SHA-256-identical to it. Recorded as TASK-054 — an extension
of this entry, not a new decision, because the expiry model, the precedence ladder, the refusal to
guess slash dates and the calendar validation are all the ones written above.

Verify: app.js contains "function expandYear(raw)"
Verify: app.js contains "function shortYearPlausible(y)"
Verify: app.js contains "return { shortYear: yearRaw }"

## D-068 — Bulk Add finishes what it can and keeps only what you can fix

Dogfooding find, 2026-08-25. Control flow and feedback inside `confirmBulkAdd()`. The D-067
parser is untouched; this decision begins after each line has been classified.

### The retry loop was unusable

Bulk Add already persisted valid lines and then held the modal open when any line warned — but it
left the textarea **completely untouched**. Pressing Add Items again resubmitted the lines that had
already succeeded, which then reported "already in pantry — skipped". Nothing told the user which
items had landed and which still needed fixing, and the only warning they could see was about items
that were already safely in the kitchen.

### The finding that forced a behaviour change, not just a UX one

Characterising all eight cases through the real modal turned up something the brief's model did not
allow for: **two warning paths warned and then added the item anyway.** Neither `return`ed.

```
"Milk 2 L 8/8/2026"            -> warned, AND added as name="Milk 2 L 8/8/2026",
                                  quantity null, with the shared expiry substituted
"Eggs, 12, pcs exp:2026-02-31" -> warned, AND added as "Eggs", with the shared expiry
                                  standing in for the date the user actually typed
```

Both are "actionable" — the user is supposed to correct the line and resubmit. But the record
already existed, so correcting and resubmitting produced either a junk record plus a clean second
copy (Milk, different names, duplicate guard never fires) or a confusing "already in pantry" bounce
(Eggs). **A line cannot both be kept for correction and already be committed.**

So an actionable warning now holds the line back entirely. This is the one change here beyond
control flow, it is deliberate, and it is what makes the retry pass sound. The parser's verdicts are
unchanged: the invalid date is still rejected and the ambiguous one is still never guessed.

### Decision

**Three states, decided by the code rather than by reading warning text.** One result per submitted
line, in submission order:

| status | meaning | textarea |
|---|---|---|
| `added` | a pantry record was created | drops out — finished |
| `skipped` | deliberately not added, and **not fixable by editing the line** (already in pantry) | drops out — finished |
| `attention` | not added, and the user can fix it | **stays**, original text, original order |

`skipped` exists as its own state precisely so a duplicate does not sit in the textarea generating
the same message forever. It is still reported — "1 already in pantry" in the summary and its own
note — just not offered back for a retry that cannot change anything.

Classification is by explicit `status`, never by matching message wording, so rephrasing a warning
can never silently move a line between "finished" and "keep".

### Partial success stays tolerant, not transactional

Valid lines are still persisted even when a sibling line needs work. That was the pre-existing
behaviour, it is the right one for a bulk paste, and it is the entire reason the textarea must be
pruned: the alternative is asking the user to remember which of their own lines already went in.

### Feedback

One line, built from the three counts, joined with `·`:

```
4 items added.
3 items added · 1 line needs attention.
2 items added · 1 already in pantry · 1 line needs attention.
3 already in pantry.
```

It goes to the existing toast when the modal closes, and inline above the per-line notes when the
modal stays open — a toast behind an open modal is the wrong surface for something the user has to
act on. No results screen, no second modal, no extra confirmation step.

Per-line notes dropped their `Line N:` prefix. Once the textarea is pruned, "Line 2" refers to text
that is no longer on screen; quoting the offending line instead stays true.

### What deliberately did not change

- Shared **Storage** and **Expiry** are left alone across a partial submit — the user almost
  certainly still wants them for the remaining line. The existing `openBulkAddModal()` reset remains
  the only thing that clears the form.
- All-valid still closes the modal and toasts, exactly as before.
- All-duplicate now **closes** rather than holding the user in a retry that cannot progress.
- The duplicate policy itself, quantity merging, storage inference, expiry precedence,
  `pantryDaysLeft()`, `pantryExpiryInfo()`, Kitchen Truth, grocery → pantry, tombstones,
  `saveData()`, Firestore merge, Food Attention and recommendations are all untouched. No new
  top-level `AppState` key — `results` is a local array.

### Tests changed rather than added, and why

Two assertions shipped under D-067 encoded the old warn-and-add-anyway behaviour
(`bulk-add-date-truth.spec.js` cases 9 and 9b). They are updated here, with the reason recorded
inline in the spec, because the behaviour they described is the behaviour this entry deliberately
changes. Their parser-level halves — the date is rejected, the ambiguous one is never guessed — are
asserted exactly as before.

`tests/production-smoke-bulk-add-dates.spec.js` still asserts the deployed behaviour and is
**knowingly left stale**: it measures what is live, and updating it before this deploys would make
the prod gate red for a reason that is not a defect. It must be updated in the same landing sequence
as the merge, the way TASK-050 and TASK-051 added their prod smokes after Pages finished.

### Known limitation, accepted

A line that produces no result at all cannot exist — every path now pushes exactly one result — but
a line whose *name* is junk for reasons the parser cannot see (a typo, say) is classified `added`
and drops out of the textarea. That is correct: it is in inventory and the Inventory card is where
it gets edited. Bulk Add is an input surface, not an editor.

Supersedes: nothing. Adjusts two behaviours introduced by D-067, recorded above.

Regression-locked by `tests/bulk-add-partial-retry.spec.js` (18 cases). Mutation-checked by
restoring the old "every submitted line stays" behaviour, which fails 7 of 18 including the central
retry case.

Verify: app.js contains "status: 'attention'"
Verify: app.js contains "function buildBulkAddSummary"
Verify: app.js contains "attentionRows.map"
Verify: style.css contains ".bulk-add-summary"

## D-069 — A purchase tops up stock when the sum is honest, and otherwise gets its own record

Dogfooding find, 2026-08-25. Two complaints that turn out to be the same idea from opposite
sides: quantity truth was being traded away for convenience.

### A. "Changing the quantity doesn't take effect"

Characterisation first, because the report named a symptom, not a cause. The pantry card's own
editor was driven through every gesture and record shape available — typed value then Tab, then
Enter, then a row tap, then a tab switch; touch and keyboard; float / `buy_` / `ib_` / `staple_`
ids; string, null and zero quantities; duplicate names; a twenty-item list scrolled to the middle;
390px and 1280px; and against the **deployed** site as well as this checkout. `updatePantryQty()`
persisted correctly every time, re-rendered the collapsed card immediately and survived reload.
It is not the bug.

The writer that actually lost data was `confirmAddIngredientToPantry()` — the Price Book's
"Add to pantry" button. It did this:

```
AppState.pantry = AppState.pantry.filter(p => p.name.toLowerCase() !== name.toLowerCase());
AppState.pantry.push({ id: Date.now() + Math.random(), name, quantity, unit, ... });
```

Setting a quantity **deleted every same-name record and rebuilt one from scratch**. On a record
reading "Eggs 6 pcs · Expires Aug 28" the result was a new id, no `expiryDate`, no `dateMode`,
no `staple`, no `stockLevel`, `purchaseDate` reset to today and `shelfLifeDays` recomputed from a
blank category (20 → 3). The printed expiry disappeared, freshness restarted, and with two
same-name rows both were destroyed. It now edits the record in place and `stampUpdated()`s it;
only the no-existing-record branch still creates one.

Decision: **a quantity edit changes the quantity.** No pantry writer may rebuild a record to
change one field.

### B. "Eggs already in pantry — skipped"

Buying twelve more eggs and bulk-adding them reported `"Eggs" already in pantry — skipped`, so
the twelve eggs were not in inventory in any form. The purchase was simply dropped.

Grocery check-off had already solved this in D-057, and its boundary is right: merge unless the
merge would lie. Bulk Add reuses that boundary instead of inventing a second policy.

`canMergePurchase(existing)` judges the existing record alone — it refuses a printed-expiry
record (that date belongs to one pack) and an already-expired one (merging would revive old
food). `canMergePurchaseInto(existing, purchase)` adds the three facts only the **incoming**
purchase knows, each of which would make a merge lie:

| The purchase carries | Why it blocks a merge |
|---|---|
| its own printed expiry | one record cannot hold two expiry dates, and picking either one is false |
| a different unit | this app cannot convert pantry quantities (see below) |
| an explicit different storage | a "put these in the freezer" bulk add must not relocate fridge stock |

`findMergeableStock()` then picks the copy a purchase can honestly join rather than whichever
sorts first, so a printed-expiry Eggs row sitting in front no longer pushes every future purchase
into yet another record. `applyPurchaseToStock()` folds the purchase in **in place** and
deliberately leaves `purchaseDate` alone, so the oldest portion still governs freshness — D-057's
rule, unchanged.

Bulk Add's duplicate branch is now three-way:

| The line | Outcome | Why |
|---|---|---|
| safely mergeable, **both** quantities known | top up existing stock → `merged` | the sum is honest |
| no quantity on the line | `skipped`, record untouched | nothing to add, and folding "unknown" into a known 6 would replace a real number with `null` |
| a real quantity that cannot fold in honestly | its **own** record → `added` | two honest rows beat one averaged row, and beat losing the purchase |

That third row is why Scenario C works: "Eggs 6 pcs · Expires Aug 28" plus a bulk line
"Eggs 12 pcs Sep 10 2026" stays two records with their own dates. It never becomes 18 pieces
under either date.

### Units are added, never converted

`unitsMergeable()` accepts the same unit, or a blank on either side. It does **not** convert.
This app has no canonical unit-conversion helper for pantry quantities: `unitConvertFactor()`
belongs to the price path and `getUnitConversion()` silently returns `1` for anything it does not
recognise. Guessing is exactly the failure mode this decision exists to stop, so `500 g + 1 kg`
stays two records rather than becoming `501`.

That gate also closes the same latent lie in grocery check-off, which previously added raw numbers
across units. This is the one behaviour change outside Bulk Add, and it is a bug fix.

### Reporting

`buildBulkAddSummary()` gains a `merged` count, reported as its own outcome — "1 stock item
updated", never folded into "added" and never called a skip. Calling a successful stock increment
"already in pantry — skipped" is what made the purchase look lost. A merged line is **resolved**,
so it drops out of the D-068 retry textarea exactly like an added one; only `attention` lines stay.

### Deliberately not done

- **No lot / FIFO architecture.** Separate records already hold two expiry dates truthfully. No
  `AppState` collection was added and the Firestore payload keys are unchanged.
- **No unit-conversion table.** See above.
- **`updateBrowserItemQty()` left as is.** It edits in place already; its only divergences from
  `updatePantryQty()` are that it treats an explicit `0` as unknown and matches names without
  trimming. Neither loses data, and neither is what was reported.
- **`toggleIngredientFromBrowser()` left as is.** It is a presence toggle, not an add — removing
  on second tap is its documented behaviour, not a duplicate policy.
- **No red-zone change.** Tombstones, `cloudReady`, `saveData()` semantics, the Firestore
  transaction/merge, auth and the service worker are all untouched.

### Known tradeoff

An existing record whose own quantity is untracked (what `confirmKitchenSetup()` and
`toggleIngredientFromBrowser()` create) cannot be topped up, so bulk-adding "Eggs 12 pcs" over it
produces a second row rather than one. That is deliberate: writing `12` would claim a total that
excludes the untracked stock, and writing `null` would throw away the one number in the
transaction. Two rows is the honest answer and the twelve eggs are visible, which is the whole
point. It does mean a kitchen seeded from the setup modal can accumulate paired rows.
`stockPurchasedGroceryItem()` keeps D-057's merge-to-unknown for the same case, because there the
*grocery row* is what lacks a number and there is nothing to preserve.

Verify: app.js contains "function canMergePurchaseInto"
Verify: app.js contains "function findMergeableStock"
Verify: app.js contains "function applyPurchaseToStock"
Verify: app.js contains "function unitsMergeable"
Verify: app.js contains "status: 'merged'"
Verify: app.js contains "stock item"

---

## D-070 — The Flavor Library is a real top-level collection, because the alternatives were worse

**Task:** Prep Leverage Wave 1 — Flavor Library (branch `wave-flavor-library`)

### Context

The app answers "which full recipe should we cook?". It does not answer "we already have cooked
chicken — how do we make it taste different tonight?". Expressing that today means creating a
separate Chicken Teriyaki, Chicken Soy-Calamansi and Chicken Spicy Mayo recipe, which is three
recipes for one protein and two tablespoons of sauce.

The app already *gives* this advice as prose. Three of the fourteen seeded Cooking Hacks say it
outright — #7 "a different sauce each time", #9 "Oven Chicken, Three Sauces", #13 "Make Sauces
Separately: the same batch becomes a different meal each day". There was simply no structure
behind the advice.

### Decision

A flavor is a new top-level synced collection, `AppState.flavors`, holding a small structured
object: `id, name, ingredients, instructions, activeTime, preparationStyle, worksWith, tags,
updatedAt`.

Three representations were characterised before coding. Two were rejected:

- **Flavors as recipes** (`kind: 'flavor'`) — zero registry changes, but it puts a permanent filter
  obligation on every consumer of `AppState.recipes`: What Should We Eat, cook suggestions, the
  planner, the recipe grid and quick filters, grocery generation, nutrition totals, cook history,
  the starter pack, `patchMissingNutrition()`. Dozens of call sites, and every one missed is a
  visible bug — spicy mayo offered as tonight's dinner, or mayonnaise on the grocery list. This
  trades 17 deliberate edits in one well-understood subsystem for an unbounded tax across the app.
  It is **higher** risk than the schema change it avoids, not lower.
- **Flavors inside `customHacks`** — also zero registry changes, and genuinely viable: `customHacks`
  is already a `TOMBSTONE_KEY`, already synced, already has CRUD, and only about six consumers would
  need a `kind` filter. Rejected because the sync layer stops noticing while the model starts lying.
  A hack is five prose fields; a flavor carries ingredients, instructions, a time, a preparation
  style and a compatibility list. The collection would hold two unrelated shapes forever, and a
  future Meal Lego would read flavors out of a collection named for something else.

The new collection was taken with explicit owner approval, and lands as `approved` (held) under
D-032 — never `done`, never auto-merged.

### Why the fields are these fields, and no others

`prepared`, `portionsRemaining`, `batchSize`, freezer quantity, expiry, thaw state and nutrition are
all deliberately absent. Every one of them turns the library into a daily logging job, and the
feature's whole value is that it is knowledge you read, not stock you maintain. Whether
prepared-flavor inventory deserves to exist is a question dogfooding answers, not one the schema
should pre-empt. All of them remain additive later, exactly as D-055 and D-056 were.

`preparationStyle` is a **label**, not a state: `freezer-friendly` says a flavor freezes well, never
that any is currently frozen. `activeTime` follows D-055's rule — blank means `null` ("not stated"),
never `0`, so a flavor nobody filled in does not claim to be instant. `normalizeFlavor()` never
invents `updatedAt`; stamping one there would let a normalize pass hand a flavor a fresh timestamp
that beats its own tombstone under `applyTombstones()`' LWW rule and resurrect it on every device.

### Every flavor id is string-prefixed `flv-`

`AppState.deletions` is a single **flat** `id -> deletedAt` map shared by every key in
`TOMBSTONE_KEYS`. A bare numeric flavor id would be matched by a tombstone written for a recipe, a
hack or a pantry item that happened to share the number. The prefix removes flavors from that shared
numeric space entirely. See D-071 for the underlying defect, which this wave does not fix.

Inbound data missing the prefix is **re-prefixed** rather than dropped: an unprefixed id is exactly
the hazard, and no legitimate tombstone can refer to an id that was never a valid flavor id. The
rewrite is idempotent, so normalizing twice can never rewrite a live id and orphan its tombstone.

### Persistence — all 17 sites, no partial implementation

`AppState` default, `saveToLocalStorage()`, `loadFromLocalStorage()`, `snapshotData()`,
`restoreBackup()`, `exportData()`, `importData()` (x4: `KNOWN`, tombstone-clear, union, re-stamp),
`TOMBSTONE_KEYS`, `buildFirestorePayload()`, `mergeCloudConflict()`, `loadFromFirestore()`,
`loadUserData()` (x2: `UKEYS` union, post-merge normalize), `setupRealtimeListeners()`.

`clearLocalStorage()` and `collectSyncedIds()` needed **no** edit: both iterate `TOMBSTONE_KEYS`, so
adding the key enrols flavors in Clear All Data and in local-deletion detection automatically.
`deleteFlavor()` writes no tombstone by hand for the same reason — `recordLocalDeletions()` diffs the
curated lists against the per-session baseline at save time, which is the one deletion concept the
whole app shares.

No existing persistence semantics changed. The export version moved `1.1` to `1.2`; import accepts
both, because a `1.1` file simply has no `flavors` key.

### Starter flavors use the D-063 opt-in pattern, never first-run auto-seeding

Ten flavors, offered by a prompt, added on tap. An id already present is a permanent skip (the user
may have edited it); an id in `AppState.deletions` is a permanent skip (deleting it was a decision).
Auto-seeding on load would give every flavor back to an account that deliberately deleted them all.
The pack is derived from `defaultFlavors` rather than a hand-listed id array — unlike
`STARTER_PACK_IDS` — because `defaultFlavors` *is* the pack, so a future addition should become
offerable through the same opt-in prompt.

### Ready Food "Try with" was cut to Wave 2

The bridge needs to know what protein a cooked batch is, and `cookedMeals` has no protein field.
Batches created by `_doMarkCooked()` carry a `recipeId` and could be resolved through the source
recipe's `baseIngredients`. Batches created by the manual add-cooked-meal path carry
`recipeId: null` and nothing but a free-text name — and those are the common case for exactly the
food this feature is about (takeout, leftovers). Matching those means guessing protein from an
arbitrary string. That is a separate subsystem with its own vocabulary bridge and its own tests, and
guessing would produce confident wrong answers, so it is deferred rather than half-built.

**Prerequisite for Wave 2:** a protein classifier for `cookedMeals` — either a real field captured at
cook/add time, or a resolver over `recipeId` to `baseIngredients` to a `FLAVOR_PROTEINS` slug, with
an explicit "unknown" result rather than a fallback guess.

Verify: app.js contains "var FLAVOR_ID_PREFIX = 'flv-'"
Verify: app.js contains "function normalizeFlavor("
Verify: app.js contains "function flavorStarterCandidates"
Verify: app.js contains "const defaultFlavors"
Verify: app.js contains "'customHacks', 'flavors', 'cookedMeals'"
Verify: tests/flavor-library.spec.js contains "MUTATION: removing flavors from TOMBSTONE_KEYS"

### Landing addendum — 2026-08-26

Reviewed independently at `wave-flavor-library` @ `54099ce` and landed by no-ff merge to
`main` @ `b219e20`, then pushed to `origin/main`. The review did not change the feature scope.

Landing evidence: pre-merge local verification passed (`tests/flavor-library.spec.js` 47/47,
local suite 382/382, full `npm test` 382/382, suite-classification 6/6, decision verification
passed). The first push-triggered CI run was recorded as-is and failed in the local branch gate
after 381 passed tests, with one timeout in `tests/inventory-quantity-truth.spec.js` at
`waitForRestored()`; therefore no `workflow_dispatch` verification was run. GitHub Pages deployed
the pushed SHA successfully, and served `index.html`, `app.js`, and `style.css` match landed `main`
after line-ending normalization.

D-071 remains open. Ready Food → "Try with", Meal Lego, and free-text protein inference remain
deferred.

---

## D-071 — `AppState.deletions` is now collection-keyed (was a flat cross-collection id map)

**Status:** **CLOSED — LANDED and verified in production, 2026-08-26** (TASK-057). Originally
recorded as an open red-zone bug during Prep Leverage Wave 1 characterization, where it was
**deliberately not fixed** because it is unrelated to flavors and is its own red-zone change.
Landed on `main` at merge `bd89d5d` (reviewed commits `1f443ac` + `f73ce3c`), owner-authorized
under D-032 after the authorization record in `6e28903`. The resolution is at the end of this
entry; the defect write-up below is kept verbatim as the historical record of what was wrong.

### The defect

`AppState.deletions` is one flat `id -> deletedAt` map. `applyTombstones()` walks **all** of
`TOMBSTONE_KEYS` — `recipes`, `pantry`, `customIngredients`, `customHacks`, `flavors`,
`cookedMeals`, `userIngredients` — against that single map. A tombstone is therefore matched by id
alone, with no idea which collection the id belonged to.

Any two collections that share an id space can destroy each other's records. The seeded data already
does: **recipe ids 1-40 and default cooking-hack ids 1-14 overlap completely on 1-14.**

### Reproduction (verified on `main @ c6ccc1e`, before this wave)

    AppState.recipes     = [{ id: 5, name: 'Recipe Five',  updatedAt: '2026-01-01...' }];
    AppState.customHacks = [{ id: 5, title: 'Hack Five',   updatedAt: '2026-01-01...' }];
    AppState.pantry      = [{ id: 5, name: 'Pantry Five',  updatedAt: '2026-01-01...' }];
    AppState.deletions   = { '5': '2026-06-01...' };   // only the RECIPE was deleted
    applyTombstones();
    // recipes: []   expected
    // hacks:   []   COLLATERAL
    // pantry:  []   COLLATERAL

`loadFromFirestore()` backfills `updatedAt` on untimestamped items with the document's save time,
and a tombstone written after that save is newer — so LWW does not save the bystanders.

### Why it is not fixed here

The fix is to namespace `deletions` by collection (`{ recipes: {...}, pantry: {...} }`) plus a
migration that reads the legacy flat map. That changes the tombstone wire format, the merge, the
sign-in union, the import tombstone-clear and the realtime apply — a red-zone sync migration with a
blast radius of its own, and nothing to do with the Flavor Library. Bundling it would have made a
feature wave unreviewable.

### What Wave 1 did instead

Kept flavors out of the shared numeric space entirely via the `flv-` id prefix (D-070). That
protects the new collection; it does **not** protect recipes, hacks, pantry, custom ingredients,
cooked meals or user ingredients from each other. `tests/flavor-library.spec.js` asserts the
collateral damage among those collections as current, known behaviour, so this record and the code
cannot silently drift apart.

### Follow-up scope when it is picked up

- Namespace `AppState.deletions` per collection, with a read-migration for the flat legacy map.
- Update `applyTombstones()`, `collectSyncedIds()`, `recordLocalDeletions()`, `mergeDeletions()`,
  `purgeOldTombstones()`, the `importData()` tombstone-clear, and `clearLocalStorage()`.
- Red zone, so `approved` (held) under D-032. Never chained (Hard Rule 10).

---

## The resolution (TASK-057, landed 2026-08-26)

### The shape change

OLD — one flat map consulted against every collection:

    deletions = {
      [rawId]: timestamp
    }

NEW — one namespace per tombstoned collection:

    deletions = {
      recipes:           {...},
      pantry:            {...},
      customIngredients: {...},
      customHacks:       {...},
      flavors:           {...},
      cookedMeals:       {...},
      userIngredients:   {...}
    }

The invariant this buys: **a tombstone may affect records only inside the collection that created
it.** Deleting recipe `5` no longer touches hack `5`, pantry item `5`, custom ingredient `5`,
cooked meal `5` or user ingredient `5`.

Access is centralized so a raw-id write cannot easily reappear: `normalizeDeletions()`,
`ensureDeletions()`, `deletionBucket()`, `writeTombstone()`, `readTombstone()`, `clearTombstone()`
and `tombstoneCount()`. Every writer routes through them; every persistence path normalizes.

### The legacy migration rule — knowingly lossy, deliberately so

A legacy flat key carries no collection identity, and nothing persisted can recover it
(`_idBaseline` is in-memory only). A fully lossless automatic migration is impossible, so:

- **Collection-exclusive prefixes migrate** to their collection: `flv-` to `flavors`, `cm_` to
  `cookedMeals`, `ui_` to `userIngredients`, `buy_` / `ib_` / `staple_` to `pantry`. Each prefix
  was re-proven exclusive by inspecting every id-minting site in `app.js`, not by pattern-matching
  the name.
- **Ambiguous flat keys are DROPPED** — bare numerics, timestamps, imported ids. Counted, and
  `console.warn`ed once at migration time so the loss is observable rather than silent.
- **No `_legacy` bucket.** Quarantining them would add a persisted shape every round-trip path
  must then carry, for no behavioural gain.
- **No global fallback.** An ambiguous tombstone is never applied across every collection — that
  is precisely the defect this record exists to end.

**The accepted tradeoff, stated plainly: some historical ambiguous deletes may resurrect from
stale remote copies.** A device still holding such a record can sync it back once its tombstone is
dropped. That is preferable to continuing deterministic cross-collection data loss — a resurrected
item is visible and user-correctable; the silent destruction of five unrelated records is neither.

### `MASS_DELETE_GUARD` stays AGGREGATE — the repair that review forced

The first implementation candidate (`1f443ac`) namespaced the tombstone map and, in doing so, also
split the mass-delete guard **per collection**. That reopened the phantom-mass-delete class the
guard exists to stop: in a transient-empty startup/sync race the large collections correctly
suppressed, while every collection holding `<= MASS_DELETE_GUARD` records fell through and was
tombstoned for real. Measured against `98cf393` on an otherwise identical fixture, the pre-repair
candidate wrote phantom tombstones for all three flavors, both cooked meals and the user
ingredient; base wrote none.

`f73ce3c` restores aggregate semantics: `recordLocalDeletions()` computes vanished ids per
collection, sums them into `totalVanished`, and compares that **single total** against
`MASS_DELETE_GUARD` before writing anything. On a trip it warns and returns with `_idBaseline`
wholly unchanged, exactly as the flat implementation did. The constant is still `5`.

One deliberate nuance: the aggregate is a **sum of per-collection counts**, so an id vanishing from
two collections counts twice where the old flat map counted one distinct id. That is *stricter*
than base — it suppresses marginally more, never less, which is the correct direction for a
data-loss guard.

Explicit writers are unaffected by the guard, by design — `clearLocalStorage()`,
`deleteSelectedPantryItems()`, `clearExpiredPantryItems()`, `unstockPurchasedGroceryItem()`,
`deductIngredientsForRecipe()`, `removeAttentionItem()` and `removeAllExpired()` all still
tombstone every id they remove, including well past 5.

### Residual limitation, carried forward and NOT fixed here

> **More than `MASS_DELETE_GUARD` genuine vanish-diff deletions can still be suppressed
> indefinitely.** A user deleting six or more items in one save window gets no tombstones, and
> because `_idBaseline` is deliberately left unchanged, every subsequent save re-trips the guard on
> the same set. Those deletes can therefore be resurrected from a remote copy.

This predates D-071 and is unchanged by it — the guard and its threshold were never in scope. It is
recorded here because D-071 is the moment the behaviour was re-derived and confirmed, not because
this work introduced it. Worth a future decision on its own terms.

### What was NOT changed

`snapshotData()` still captures deletions and `restoreBackup()` still does not restore them;
`exportData()` still omits them while `importData()` clears tombstones for imported records — now
only within the imported record's own collection. Both asymmetries were investigated and
deliberately left alone: correcting either would expand product behaviour beyond deletion identity.
`cloudReady`, `saveData()` semantics, the Firestore read-before-write guard, auth and `sw.js` are
untouched.

### Verification

Deterministic local suite 404/404 on merged `main`. Namespace isolation and the aggregate guard
were both negative-proofed by mutating **production** code, not by test simulation: collapsing
`applyTombstones()` to a flat map turns 11 tests red; reverting the guard to per-collection turns 3
red with the exact phantom signature. Verified live against the deployed build after landing —
cross-collection isolation in both directions, flavor isolation, prefix normalization, ambiguous
drop, the aggregate transient-empty guard, explicit >5 cook depletion and bulk expired cleanup, and
LWW.

Verify: app.js contains "var TOMBSTONE_KEYS ="
Verify: tests/flavor-library.spec.js contains "prefixed flavor ids survive a numeric tombstone"
Verify: app.js contains "totalVanished > MASS_DELETE_GUARD"
Verify: app.js contains "function legacyDeletionCollectionForId"
Verify: tests/tombstone-namespace.spec.js contains "MUTATION: bypassing the aggregate MASS_DELETE_GUARD writes phantom small-collection tombstones"

## D-072 — A cooked batch's protein identity is user-correctable, and clearing it DELETES the field

**Status:** **CLOSED — LANDED and verified in production, 2026-08-27.** Landed on `main` at merge
`9021a90` (reviewed commit `c742f17`), owner-authorized under D-032 after the authorization record in
`928943b`. Extends the identity contract shipped at `8711a9c`.

### Context

`8711a9c` gave a cooked batch a truthful protein identity with a fixed precedence — explicit
`cookedMeal.proteinType`, then deterministic recipe-derived identity, then `unknown` — and one hard
rule: **the meal's `name` is never read.** It shipped the selector on the manual-add form only.

That left three states unreachable. A batch saved as Unknown could never become Chicken. A mis-tap on
the add form could not be corrected. And a recipe-backed batch could not be frozen against a later
recipe edit, because derived identity is read live and never copied onto the record — editing a recipe
retroactively changes what last week's leftovers report. In all three cases the only remedy was delete
and recreate, which loses the `id`, the `cookedDate` and the portion counts.

### Decision

**1. Correction is an in-place edit of the existing record, on the card.** `setCookedProteinType(id,
value)` mutates `cookedMeal.proteinType` and nothing else, then `stampUpdated()` → `saveData()` →
`renderCookedMeals()` — the same path `setCookedStorage()` and `updateCookedDate()` already use. The
control is a compact `<select>` in the cooked card's meta row beside the date input and the storage
toggle. No modal, no new screen, no new AppState key.

Rejected: a dedicated edit modal. Protein correction is occasional setup, not a per-meal decision;
giving it a modal would imply it deserves one and invite the recurring-classification-chore UX this
feature exists to avoid. The control is **never prompted for** and Unknown stays an acceptable
resting state.

**2. Clearing the selection DELETES `proteinType`; it does not store `'unknown'`.**

Absence already *is* the representation of "we do not know" — that is what `8711a9c` established.
Storing the string would create a second representation of the same non-answer, and worse, would
**freeze a recipe-backed batch at a non-answer** instead of returning it to derivation. Deleting keeps
the precedence contract literal: an absent field means "ask the recipe."

A value that is neither a vocabulary id nor the blank option is **ignored outright**, not treated as a
clear — a rejected input must never silently wipe a pin the user made.

**3. The empty option is labelled with the derived answer, not left blank.** `cookedProteinAutoLabel()`
returns `Auto · Chicken`, `Auto · Mixed`, `Auto · No protein`, or plain `Unknown` when there is
genuinely nothing to derive. Calling a recipe-backed batch's empty option "Unknown" would be a lie, and
naming the derived answer is also what makes **pinning** discoverable: the user can see that
Chicken-by-derivation and Chicken-by-choice are two different selections.

**4. Recipe-edit temporal truth is left exactly as it was, and characterized by test.** An unpinned
recipe-backed batch still follows a later recipe edit. Nothing is auto-snapshotted.

Rejected: snapshotting derived identity at cook time, a `derivedAt` cache, or a recipe-version pointer.
Every one of them duplicates a truth that already exists and then lets the copy rot — the same reason
`readyFoodBalanceHint()` reads `recipe.mealBalance` live — or adds a migration for the batches already
on `main`. The pinning control is the remedy, and it is what precedence step 1 was for.

**5. The selector vocabulary lives in code only.** `index.html` had been a second, hand-written copy of
the nine ids **and** their labels. It now ships the selector empty and
`populateManualCookedProteinSelect()` fills it from `COOKED_PROTEIN_CHOICES` at boot, the way
`hydrateIcons()` fills static icons. `cookedProteinOptionsHtml()` is shared by the add form and the
card control, so the two surfaces cannot diverge.

The exact cooked id set is **additionally** pinned by test. The pre-existing subset invariant
(`COOKED_PROTEIN_IDS ⊆ FLAVOR_PROTEINS`) cannot catch a new id that is *already legal* Flavor Library
vocabulary — `vegetables` and `rice` are exactly that hazard, and answering "what protein is this?"
with "rice" is a category error. Mutating `COOKED_PROTEIN_IDS` to include `'rice'` fails only the new
exact pin; 67 other protein tests pass.

**6. A stored `proteinType` must be a primitive string in the vocabulary.** `isCookedProteinChoice()`
no longer coerces with `String()`. The old form accepted `['chicken']` and any object with a matching
`toString()`, because both stringify to a legal id — so a hand-edited record or a malformed import
could persist a non-string into the one field Meal Lego is going to trust.

**7. Ingredient CATEGORY is trimmed as well as lowercased.** An imported `' Protein '`, `'PROTEIN'` or
`'\tProtein\n'` now reads as the canonical category. Category text that merely resembles it —
`'Proteins'`, `'Protein-rich'` — does **not**, because that would be inference from category text.
Ingredient **names** are untouched and still matched by exact case-insensitive equality against
`PROTEIN_FAMILY_BY_INGREDIENT`; this decision changes nothing about what counts as a protein name.

### Consequences

- A user can correct or pin any batch without recreating it, from the card, in one interaction.
- A historical batch can be frozen against future recipe edits — but only if the user pins it
  **before** the edit. An unpinned batch still changes retroactively. That is a known, deliberate
  trade, not a defect.
- `unknown` and `mixed` are never persisted. `none` is persisted and is a real answer, but joins to no
  flavor.
- Adding a cooked protein id now requires a test change, by design.
- Fish hierarchy (`salmon`/`tuna` vs `fish`) and `mixed` matching remain **deferred to Meal Lego**.
  This wave only keeps identity stable.

### Blast radius — outside the D-032 red zone

One optional field on an existing `cookedMeals[]` record, which already round-trips through
localStorage, Firestore, the sign-in union, realtime and export/import. **No new top-level `AppState`
key. No `TOMBSTONE_KEYS` change.** Tombstone architecture, `mergeCloudConflict()`, `cloudReady` / the
write guard, `saveData()` semantics, auth and the service worker are all untouched. Held under D-032
and merged by hand anyway, at the owner's direction, because it is the foundation Meal Lego will build
on.

Verify: app.js contains "function setCookedProteinType(id, value)"
Verify: app.js contains "typeof value === 'string' && COOKED_PROTEIN_CHOICE_IDS.indexOf(value) >= 0"
Verify: app.js contains "else if (value === '') delete meal.proteinType;"
Verify: app.js contains ".trim().toLowerCase() === 'protein'"
Verify: index.html does not contain "<option value=\"chicken\">Chicken</option>"

### Open follow-ups (recorded at landing, NOT fixed here)

- **P2-1** — `cookedProteinAutoLabel()` ends in an unguarded `FLAVOR_PROTEIN_BY_ID[derived].label`.
  Safe only while the vocabulary invariant holds; if `PROTEIN_FAMILY_BY_INGREDIENT` ever gains a family
  that is not a `FLAVOR_PROTEINS` id, this throws inside `renderCookedMeals()` and blanks the Fridge
  list rather than showing a wrong label.
- **P2-2** — `docs/ARCHITECTURE.md` and `docs/DATA_MODEL.md` still say `cookedMeals` have no protein
  identity and that Ready Food "Try with" is blocked on a classifier that now exists. Neither
  `8711a9c` nor this wave wrote those records.
- **P3-1** — an externally-authored `proteinType: null` survives `normalizeCookedMeal()` untouched (the
  guard is `!= null`) and behaves correctly as "no pin", but leaves a null-valued key where every other
  path represents no-pin as an absent key.
- **P3-2** — no committed regression test for newer-local-**unpin** versus stale-cloud-**pin**.
- **P3-3** — the card protein `<select>` has no accessible name of its own and its tap target is below
  the 44px guideline at `font-size: 0.8rem`.
