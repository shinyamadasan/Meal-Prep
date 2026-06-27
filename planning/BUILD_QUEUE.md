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
### BQ-001 — Job #5 "cheapest": descope vs build store-compare
- source: PROP-001 · priority: P2 · approved: 2026-06-27 (digest reply)
- build: Reframe Price Book honestly as a price *reference* now (cheap, raises first-run trust); defer the Option B build until a user actually asks for store-compare.
- detail: see PROP-001 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-002 — Dashboard: data doesn't load on first open (tab-switch workaround required)
- source: PROP-002 · priority: P0 · approved: 2026-06-27 (digest reply)
- build: P0 — broken first impression on every app open; belongs in the next build.
- detail: see PROP-002 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-003 — Recipe JSON import fails
- source: PROP-003 · priority: P0 · approved: 2026-06-27 (digest reply)
- build: P0 — recipe import is fully broken; fix before alpha user testing.
- detail: see PROP-003 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-004 — Duplicate pantry name: ask user instead of silent skip
- source: PROP-005 · priority: P1 · approved: 2026-06-27 (digest reply)
- build: P1 — confirm the duplicate-add dialog copy at build time.
- detail: see PROP-005 in planning/PROPOSALS.md (evidence, ambiguity, likely files)
