# Decisions (ADR-lite)

> Why the important architectural choices were made — so they don't get silently reversed.
> Append-only. Never rewrite an entry; to reverse one, add a new entry and mark the old
> `Status: Superseded by D-0NN`. Read before replacing any existing approach.

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
