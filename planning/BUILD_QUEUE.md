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

### BQ-007 — Missing button variants render as invisible/unstyled (btn--ghost, btn--danger, btn--success)
- source: PROP-014 · priority: P1 · approved: 2026-06-30 (digest reply)
- build: P1 — core-screen buttons have no visible affordance and the Delete-Account button has no danger styling; a real usability + trust blocker.
- detail: see PROP-014 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-008 — White text on sage-green surfaces fails contrast (unreadable active states)
- source: PROP-015 · priority: P1 · approved: 2026-06-30 (digest reply)
- build: P1 — WCAG-failing ~1.9:1 white-on-sage on Plan/Price Book active chips; hard to read on a phone in daylight.
- detail: see PROP-015 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-009 — Small tap targets below 44px cause mis-taps on phone (steppers, ×-remove, fav, day actions)
- source: PROP-016 · priority: P1 · approved: 2026-06-30 (digest reply)
- build: P1 — sub-44px controls on a phone cause fiddly taps and accidental deletes; `.btn`/`.tab-btn` already get 44px, the most-tapped small controls don't.
- detail: see PROP-016 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-010 — Undefined CSS variables + a duplicated base block (silent fallbacks / time-bomb)
- source: PROP-017 · priority: P1 · approved: 2026-06-30 (digest reply)
- build: P1 for the `:root` alias fix (cheap, fixes transparent badges + many components at once); the duplicate-block deletion is riskier — confirm scope at build.
- detail: see PROP-017 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-011 — Empty states styled three different ways across tabs
- source: PROP-018 · priority: P2 · approved: 2026-06-30 (digest reply)
- build: P2 — the first-run app is mostly empty states; route them all through the existing `emptyState()` helper for a consistent first impression.
- detail: see PROP-018 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-012 — Some inputs remove the focus outline (outline:none) — accessibility regression
- source: PROP-019 · priority: P2 · approved: 2026-06-30 (digest reply)
- build: P2 — Price Book / quantity inputs set `outline:none` with no replacement, so keyboard/switch users lose their place (WCAG 2.4.7). Restore the global focus outline.
- detail: see PROP-019 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-013 — Hardcoded hex colors bypass the token system (amber/red appear as 4+ shades)
- source: PROP-020 · priority: P3 · approved: 2026-06-30 (digest reply)
- build: Valid consistency debt, but pure cosmetic — defer past the stabilize phase. (Quick subset: point status reds/ambers at the existing semantic tokens.)
- detail: see PROP-020 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-014 — Badge/pill system fragmented (~13 treatments for one concept)
- source: PROP-021 · priority: P3 · approved: 2026-06-30 (digest reply)
- build: Defer the full consolidation; optionally do the S quick-win (normalize all badges to `--radius-full` + `--font-size-xs`) if a spare slot opens.
- detail: see PROP-021 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-015 — Spacing scale bypassed by ad-hoc rem/px in newer components
- source: PROP-022 · priority: P3 · approved: 2026-06-30 (digest reply)
- build: Vertical-rhythm drift between tabs; real but incremental — schedule post-alpha, convert per-component.
- detail: see PROP-022 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

### BQ-016 — Modal sizing/structure varies; some hand-roll inline layout
- source: PROP-023 · priority: P3 · approved: 2026-06-30 (digest reply)
- build: Mostly polish — but the mobile-footer-stacking subset (action buttons cramped side-by-side on phone) is worth pulling forward.
- detail: see PROP-023 in planning/PROPOSALS.md (evidence, ambiguity, likely files)

Promote a new batch from `planning/ROADMAP.md` to activate the next run.
