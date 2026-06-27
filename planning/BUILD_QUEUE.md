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

_From your "Approve 2-10" reply (2026-06-27). PROP-002/003/005 already built in the prior sprint._

### BQ-001 — Bulk add parser: unit treated as ingredient name when comma is missing
- source: PROP-004 · priority: P1 · approved: 2026-06-27 (digest reply)
- build: P1 — silently corrupts pantry data right now during alpha use.
- detail: see PROP-004 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-002 — Pantry card: switching date field closes the card (should not close)
- source: PROP-006 · priority: P1 · approved: 2026-06-27 (digest reply)
- build: P1 — friction in the core stock-tracking flow.
- detail: see PROP-006 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-003 — Storage guide: don't show (or flag) guidance for unrecognized ingredients
- source: PROP-007 · priority: P2 · approved: 2026-06-27 (digest reply)
- build: P2 — schedule after the P0/P1s; pick the fallback UX at build.
- detail: see PROP-007 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-004 — Pantry list: show recently added items at the top
- source: PROP-008 · priority: P2 · approved: 2026-06-27 (digest reply)
- build: P2 — small win; batch with the other post-add flow fixes (PROP-006/009).
- detail: see PROP-008 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-005 — Bulk add: include expiry date field in the add flow
- source: PROP-009 · priority: P2 · approved: 2026-06-27 (digest reply)
- build: P2 — sequence after PROP-004 (same parser).
- detail: see PROP-009 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-006 — Ingredient card unit input: allow typing + offer dropdown
- source: PROP-010 · priority: P2 · approved: 2026-06-27 (digest reply)
- build: P2 — quality-of-life; not urgent, batch with other P2s.
- detail: see PROP-010 in planning/PROPOSALS.md (evidence, ambiguity, likely files)
