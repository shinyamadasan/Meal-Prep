# Current Milestone

> Claude writes this. Codex reads it for context. Update when the milestone changes.

## Goal

Fix a real automation gap found live (`/go` not triaging idle captures per DECISIONS.md D-035) and
add two new proactive commands the human explicitly requested: `/suggest` (a cheap "what's next"
recommendation, no LLM call) and `/audit` (an occasional deep app scan that refills the proposal
backlog). All three are automation/OS-surface work, not app features — the previous milestone
(BQ-018..022) is complete.

## Approach

- Same file-order = build-order rule: TASK-014 (P1) before TASK-015 (P2) before TASK-016 (P2).
- All three are Hard Rule 10 / D-023 High risk (touch `tools/Dispatch-Commands.ps1` and, for
  TASK-016, a new `tools/Run-Audit.ps1`) — solo build, never chained.
- D-032 red zone ("the AI Dev OS / automation itself") — review must land each at `status:
  approved` (held for a human `/merge`), never auto-merged, regardless of diff size.
- TASK-016 explicitly models its Preflight/lock/commit-scope-guard on `run-claude.ps1`'s existing
  code shape rather than inventing a new safety pattern.

## Scope

**In:**
- TASK-014 (P1) — fix `Invoke-Autopilot`'s "Plan once" trigger to also fire on untriaged
  `captures/inbox/` items, matching D-035's documented (but unimplemented) behavior
- TASK-015 (P2) — `/suggest`: pure-PowerShell, no-LLM recommendation of the single best pending
  proposal, ranked by goal-adjusted priority
- TASK-016 (P2) — `/audit`: on-demand Claude session (PP1 + PP2 analysis + P9's output contract)
  that writes new, deduped proposals into `planning/PROPOSALS.md`

**Out:**
- Any change to `/run`, `/build`, `/review`, `/merge`, `/status`, `/next`, `/stop`, `/enable`,
  `/disable` behavior
- Any new scheduled task, cron, or polling mechanism for `/audit` — on-demand only, human-triggered
- Updating `GUIDE.md` with `/suggest`/`/audit` before they actually exist

## Source

- TASK-014/015/016 authored directly to `TASKS.md` from a live conversation (2026-07-14/15) — no
  `BUILD_QUEUE.md`/`PROPOSALS.md` trail exists for these; the human found/requested them in chat,
  not via the capture pipeline.

## Status

in-progress — TASK-014/015/016 authored 2026-07-15, all at `status: codex`, awaiting Codex
execution in file order. The prior milestone (BQ-018..022 P2/P3 UX batch) is **complete** — all of
TASK-006..013 are `status: done`.
