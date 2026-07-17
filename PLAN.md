# Current Milestone

> Claude writes this. Codex reads it for context. Update when the milestone changes.

## Goal

Close four real user-reported gaps from alpha use (PROP-030/031/033/034), all auto-promoted
Low-risk P2 items via D-042. The previous milestone (TASK-014..016: automation gap fixes +
/audit redesign) is complete — all TASK-014..024 are `status: done` or `status: approved`
(the approved tasks are held at the `/merge` gate, not outstanding implementation work).

## Approach

- File order = build order: TASK-025 (P2) → TASK-026 (P2) → TASK-027 (P2) → TASK-028 (P2).
- All four are app-feature/bug tasks touching `app.js` and `index.html` only — no automation
  scripts, no Firestore/sync/auth paths (per D-042 auto-promote gate, Risk: Low). Reviews should
  land at `status: done` (auto-merge eligible) unless a specific diff unexpectedly touches a
  Hard Rule surface.
- Each task is independently testable; no cross-task dependencies.

## Scope

**In:**
- TASK-025 (P2) — BQ-023: recipe paste nutrition parse + stop instructions at Nutrition header
- TASK-026 (P2) — BQ-024: one-tap "Clear expired" pantry action with explicit tombstoning
- TASK-027 (P2) — BQ-025: voice bulk-add auto-newline per spoken ingredient (no manual Enter)
- TASK-028 (P2) — BQ-026: Prep Mode active session persisted to localStorage (survive close)

**Out:**
- PROP-032 (cloud sync failure, Risk: High) — awaiting human review before any BUILD_QUEUE entry
- BQ-013/014/015 — still deferred; no change to their status

## Source

- BQ-023..026: auto-promoted 2026-07-16 via D-042 (Decision: Approve + Risk: Low in PROPOSALS.md)
- No BUILD_QUEUE item existed for TASK-014..016; those were authored directly from live chat.

## Status

in-progress — TASK-025..028 authored 2026-07-17, all at `status: codex`, awaiting Codex
execution in file order. TASK-017/021/022/024 are `status: approved`, held at the `/merge` gate
— each needs `/merge TASK-NNN yes` to land on main.
