# Current Milestone

> Claude writes this. Codex reads it for context. Update when the milestone changes.

## Goal

Fix mobile modal action buttons so they stack vertically on phone instead of cramping side by side.

## Approach

The root issue is structural: `#username-modal`'s button row is a raw `<div style="display:flex…">` that
bypasses `.modal-footer` — so the existing mobile stacking rule (`flex-direction:column; width:100%`)
never fires on it. Five other modals also carry inline `max-width` on `.modal-content` instead of a
reusable CSS class, making modal sizing fragile and harder to maintain.

Fix in three steps:
1. Add `.modal-content--sm/--md/--lg` CSS modifier classes so sizing lives in the stylesheet.
2. Fix `#username-modal` — convert its button row to `.modal-footer` (the real bug) and swap to `--sm`.
3. Sweep the 5 remaining inline `max-width` modals to use the new classes.

No visual changes on desktop. On mobile, `#username-modal` buttons will stack full-width.

## Scope

**In:**
- New CSS size modifier classes: `--sm` (420px), `--md` (480px), `--lg` (600px)
- `#username-modal`: button row → `.modal-footer`, inline max-width → class
- `#custom-item-modal`, `#user-ingredient-modal`, `#bulk-add-modal`, `#paste-recipe-modal`:
  inline max-width → class (already use `.modal-footer` — no behavior change)

**Out:**
- `#prep-mode-modal` — its inline style includes `display:flex;flex-direction:column` for a scrollable
  body layout; leave it as-is until a dedicated refactor is scoped
- Full badge/color/spacing sweeps (BQ-013, BQ-014, BQ-015 — remain deferred)

## Source

- BQ-016 (mobile-footer-stacking subset)

## Status

in-progress
