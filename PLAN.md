# Current Milestone

> Claude writes this. Codex reads it for context. Update when the milestone changes.

## Goal

Ship the five P2/P3 UX items approved on 2026-07-04 (BQ-018..022) — three real feature builds
(BQ-018 bulk-add storage selector, BQ-019 bulk-add per-item expiry, BQ-021 cook-flow portion
multiplier) plus BQ-020's compact recipe-card-header pass, then land human-clarification blockers
on BQ-020's ambiguous "always-expanded detail" sub-ask and on BQ-022's long-press multi-select
scope so those two don't ship the wrong feature.

## Approach

- P2s first, then P3s — Codex builds TASKS.md in file order, which matches ascending priority.
- Each BQ item = one atomic TASKS.md entry, except BQ-020 which splits into TASK-009 (compact
  header, unambiguous, CSS-only) and TASK-010 (a blocker-raising decision gate for the
  "always-expanded detail" sub-ask that PROP-026 itself says "Confirm at build").
- BQ-022 is a single blocker-raising decision gate (TASK-011) — PROP-028 flags three unresolved
  ambiguities (scope, move-target UI, desktop fallback) that can't be defended-defaulted
  autonomously.
- No architectural changes. Every task stays inside `app.js` / `index.html` / `style.css` with
  the existing one-file, imperative-render architecture (Hard Rule 9).

## Scope

**In:**
- TASK-006 (BQ-018, P2) — default storage selector row above `#bulk-add-modal` textarea
- TASK-007 (BQ-021, P2) — portion multiplier in cook confirmation + scaled deduction/check
- TASK-008 (BQ-019, P2) — inline `exp:YYYY-MM-DD` per-line expiry keyword in bulk-add parser
- TASK-009 (BQ-020, P3) — compact `.recipe-card-header` CSS tightening (title/category/margin)
- TASK-010 (BQ-020, P3) — decision gate: what "always-expanded detail view" means (A/B/C options
  documented; Codex raises blocker with recommendation)
- TASK-011 (BQ-022, P3) — decision gate: long-press bulk multi-select scope + fallback (Codex
  raises blocker with recommendations)

**Out:**
- Any implementation of BQ-020's "always-expanded detail" or BQ-022's long-press mode until
  their decision gates land human answers
- BQ-013/014/015/016 — Builder-deferred P3 debt (post-alpha stabilize)
- Full ROADMAP.md "Approved Backlog" sync of PROP-024..028 (still shows "*(empty)*"; separate
  ROADMAP write, autonomous instructions say not to touch ROADMAP)

## Source

- BQ-018 (PROP-024, P2, approved 2026-07-04)
- BQ-019 (PROP-025, P2, approved 2026-07-04)
- BQ-020 (PROP-026, P3, approved 2026-07-04)
- BQ-021 (PROP-027, P2, approved 2026-07-04)
- BQ-022 (PROP-028, P3, approved 2026-07-04)

## Status

in-progress — TASK-006..011 authored 2026-07-05 (autonomous Plan pass); all six at
`status: codex`, awaiting Codex execution in file order.
