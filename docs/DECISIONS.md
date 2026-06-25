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
