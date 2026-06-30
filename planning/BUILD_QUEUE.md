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
