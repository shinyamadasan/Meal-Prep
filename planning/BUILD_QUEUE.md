# Approved Build Queue

> **The ONLY file the autonomous Builder reads.** It holds **only human-approved sprint items**.
>
> - Triage **never** writes here (it writes Proposals).
> - The Sprint Planner proposes a batch from `ROADMAP.md`; **you approve the batch**; only then does it land here.
> - The Builder builds what's here — it **never** triages, **never** prioritizes, and **never** reads
>   `captures/inbox/`, `PROPOSALS.md`, or `ROADMAP.md` for work. (Single responsibility.)
>
> Flow: `ROADMAP.md → AI Sprint Planner → (you approve the batch) → BUILD_QUEUE.md (here) → Builder`

## Approved sprint

### BQ-017 — Planner tab overflows horizontally on mobile (+23px at 390px width)
- source: PROP-029 · priority: P1 · approved: 2026-07-03 (chat)
- build: Real, reproducible bug caught by `tests/mobile-layout.spec.js` after its TASK-004 fixture fix — Planner is the only tab (of 7) with nonzero horizontal overflow at a 390px viewport. Root cause not yet traced; likely a fixed-width element in the planner day-grid/table that doesn't shrink/wrap below a breakpoint. Start with a code trace of the planner tab markup/CSS before proposing a fix.
- detail: see PROP-029 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-013 — Hardcoded hex colors bypass the token system (amber/red appear as 4+ shades)
- source: PROP-020 · priority: P3 · approved: 2026-06-30 (digest reply)
- build: Valid consistency debt, but pure cosmetic — defer past the stabilize phase. (Quick subset: point status reds/ambers at the existing semantic tokens.)
- note: **Deferred by Builder 2026-06-30** — build note says defer; revisit after alpha stabilize.
- detail: see PROP-020 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-014 — Badge/pill system fragmented (~13 treatments for one concept)
- source: PROP-021 · priority: P3 · approved: 2026-06-30 (digest reply)
- build: Defer the full consolidation; optionally do the S quick-win (normalize all badges to `--radius-full` + `--font-size-xs`) if a spare slot opens.
- note: **Deferred by Builder 2026-06-30** — build note says defer; revisit after alpha stabilize.
- detail: see PROP-021 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-015 — Spacing scale bypassed by ad-hoc rem/px in newer components
- source: PROP-022 · priority: P3 · approved: 2026-06-30 (digest reply)
- build: Vertical-rhythm drift between tabs; real but incremental — schedule post-alpha, convert per-component.
- note: **Deferred by Builder 2026-06-30** — build note says defer post-alpha.
- detail: see PROP-022 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-016 — Modal sizing/structure varies; some hand-roll inline layout
- source: PROP-023 · priority: P3 · approved: 2026-06-30 (digest reply)
- build: Mostly polish — but the mobile-footer-stacking subset (action buttons cramped side-by-side on phone) is worth pulling forward.
- note: **Deferred by Builder 2026-06-30** — needs human scope decision on which modals to fix (Prep Mode / Username / Custom-Ingredient). Revisit after alpha stabilize.
- detail: see PROP-023 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

Promote a new batch from `planning/ROADMAP.md` to activate the next run.

### BQ-018 — Bulk add: default storage location selector (counter / fridge / pantry)
- source: PROP-024 · priority: P2 · approved: 2026-07-04 (digest reply)
- build: P2 — valid UX gain, but not a blocker during stabilize phase. Approve when P3 queue clears.
- detail: see PROP-024 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-019 — Bulk add: per-item expiry date in the line format (vs single shared date)
- source: PROP-025 · priority: P2 · approved: 2026-07-04 (digest reply)
- build: Valid design evolution of BQ-005, but redesigning the parser + UI is M–L effort. Revisit when alpha feedback is clearer.
- detail: see PROP-025 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-020 — Recipe card: compact header, always-expanded detail view
- source: PROP-026 · priority: P3 · approved: 2026-07-04 (digest reply)
- build: P3 — UX exploration; current expand-on-click is functional and avoids cognitive overload on a long recipe list.
- detail: see PROP-026 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-021 — Cook confirmation: optional serving multiplier for accurate pantry deduction
- source: PROP-027 · priority: P2 · approved: 2026-07-04 (digest reply)
- build: P2 — meaningful accuracy enhancement to the core cook-and-deduct flow. Promote when cook loop is stable.
- detail: see PROP-027 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-022 — Long-press to enter bulk multi-select mode (bulk move + bulk delete) on pantry/grocery items
- source: PROP-028 · priority: P3 · approved: 2026-07-04 (digest reply)
- build: P3 — power-user shortcut; extends PROP-012. Revisit after alpha stabilize.
- detail: see PROP-028 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-023 — Recipe paste: parse published nutrition block + stop instructions at Nutrition header
- source: PROP-030 · priority: P2 · approved: 2026-07-16 (auto-promoted, Risk: Low)
- build: Low-risk bug fix + accuracy improvement — pasted recipe pages already contain per-serving macros the app silently discards; the instruction parser swallows the whole Nutrition block as text, corrupting stored instructions.
- detail: see PROP-030 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-024 — Pantry: one-tap "Clear expired" action to remove all expired items
- source: PROP-031 · priority: P2 · approved: 2026-07-16 (auto-promoted, Risk: Low)
- build: Closes the expiry-tracking lifecycle — users can mark items with expiry dates but have no fast path to purge them when they expire; individual delete via card edit is too slow for a pantry of expired items.
- detail: see PROP-031 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-025 — Bulk add voice: pressing Enter between each spoken ingredient is friction
- source: PROP-033 · priority: P2 · approved: 2026-07-16 (auto-promoted, Risk: Low)
- build: Clear voice-UX gap — each spoken ingredient requires a manual Enter/newline before the next, breaking the hands-free pantry-scan flow.
- detail: see PROP-033 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-026 — Prep Mode: active session state lost when app is closed and reopened
- source: PROP-034 · priority: P2 · approved: 2026-07-16 (auto-promoted, Risk: Low)
- build: Session-continuity regression — a work session started in Prep Mode should survive a browser close/tab refresh; reverting to "Start Work" loses track of the user's place mid-cook.
- detail: see PROP-034 in planning/PROPOSALS.md (evidence, ambiguity, likely files)
