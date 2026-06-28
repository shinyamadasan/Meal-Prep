🌅 *Meal Prep — Morning Digest*
Sun 28 Jun · 10 proposals waiting · 🎯 Objective: *Alpha stability*

✅ *RECOMMEND APPROVE (6)*
*14* · Missing button variants render as invisible/unstyled (btn--ghost, btn--danger, btn--success)
   → P1 — core-screen buttons have no visible affordance and the Delete-Account button has no danger styling; a real usability + trust blocker.
*15* · White text on sage-green surfaces fails contrast (unreadable active states)
   → P1 — WCAG-failing ~1.9:1 white-on-sage on Plan/Price Book active chips; hard to read on a phone in daylight.
*16* · Small tap targets below 44px cause mis-taps on phone (steppers, ×-remove, fav, day actions)
   → P1 — sub-44px controls on a phone cause fiddly taps and accidental deletes; `.btn`/`.tab-btn` already get 44px, the most-tapped small controls don't.
*17* · Undefined CSS variables + a duplicated base block (silent fallbacks / time-bomb)
   → P1 for the `:root` alias fix (cheap, fixes transparent badges + many components at once); the duplicate-block deletion is riskier — confirm scope at build.
*18* · Empty states styled three different ways across tabs
   → P2 — the first-run app is mostly empty states; route them all through the existing `emptyState()` helper for a consistent first impression.
*19* · Some inputs remove the focus outline (outline:none) — accessibility regression
   → P2 — Price Book / quantity inputs set `outline:none` with no replacement, so keyboard/switch users lose their place (WCAG 2.4.7). Restore the global focus outline.

💤 *RECOMMEND PARK (4)*
*20* · Hardcoded hex colors bypass the token system (amber/red appear as 4+ shades)
   → Valid consistency debt, but pure cosmetic — defer past the stabilize phase. (Quick subset: point status reds/ambers at the existing semantic tokens.)
*21* · Badge/pill system fragmented (~13 treatments for one concept)
   → Defer the full consolidation; optionally do the S quick-win (normalize all badges to `--radius-full` + `--font-size-xs`) if a spare slot opens.
*22* · Spacing scale bypassed by ad-hoc rem/px in newer components
   → Vertical-rhythm drift between tabs; real but incremental — schedule post-alpha, convert per-component.
*23* · Modal sizing/structure varies; some hand-roll inline layout
   → Mostly polish — but the mobile-footer-stacking subset (action buttons cramped side-by-side on phone) is worth pulling forward.

—
*Reply naturally:* `Approve 1-10` · `Approve 2 3` · `Park 7` · `Reject 12`
Approved → built next run. Silence → nothing happens.
