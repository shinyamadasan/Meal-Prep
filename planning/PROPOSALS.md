# Proposal Queue — pending product judgment

> **Triage writes here. Nothing here is built.** Each capture becomes a *proposal*, enriched with
> evidence and scored against the **Current Objective** in [ROADMAP.md](ROADMAP.md), then waits for
> **your approval**. Approve → it moves to `ROADMAP.md` (the approved backlog). Park/Reject is recorded
> and dropped.
>
> **Every proposal leads with `▶ Decision`** — the AI's recommended next action
> (**Approve · Park · Reject · Clarify**) with a one-line why, so you can act from the digest on your
> phone without figuring out what to do. The rest of the fields are the evidence behind that call.
>
> Single responsibility: **Triage routes + enriches — it never schedules or builds.**
>
> **This file is a stage contract.** The format under "Proposal contract" below is the structured output
> triage produces and the *approval* + *sprint* stages consume — so any of those agents can be improved
> or replaced as long as it reads/writes this shape.
>
> Flow: `captures/inbox → Triage(+enrich) → PROPOSALS.md (here) → you approve → ROADMAP.md`

## Pending

### PROP-001 — Job #5 "cheapest": descope vs build store-compare
- **▶ Decision: Approve (Option A — descope).** Reframe Price Book honestly as a price *reference* now (cheap, raises first-run trust); defer the Option B build until a user actually asks for store-compare.
- **type:** decision · **source captures:** alpha audit (×1)
- **goal alignment:** ⚠️ mixed vs the Current Objective (**Alpha stability**). **Option A (descope)**
  *supports* it — removes a promise the app doesn't keep, which raises first-run trust. **Option B (build)**
  *conflicts* — adds new surface during a stabilize phase. Serves North-star "save money," but not *now*.
- **expected user value:** Low for a first-timer — Price Book is a low-traffic "More"-menu job. Higher
  later if the objective shifts to growth/monetization.
- **evidence:** last external-testing blocker; Price Book implies "find cheapest" but only shows reference
  prices; **0** user captures requesting it (no demand signal yet).
- **effort:** A=S · B=M · **dependencies:** none · **confidence:** high · **ambiguity:** none
- **why now vs later:** decide the *direction* now to clear the go/no-go verdict — but the **build (B)
  should wait** until a user actually asks. **A (descope) now** is the stability-aligned move.
- **AI-recommended priority:** **P2** (raw priority was P1; **down-weighted** because building it doesn't
  serve the current objective)
- **status:** approved 2026-06-27 (via digest reply)

---

### PROP-002 — Dashboard: data doesn't load on first open (tab-switch workaround required)
- **▶ Decision: Approve.** P0 — broken first impression on every app open; belongs in the next build.
- **type:** bug · **source captures:** 20260626T1146Z-30 (×1) · *note: captured as /feature, reclassified bug*
- **goal alignment:** strongly supports — North-star #1 (core loop friction) + #3 (zero-friction start). The home screen is the first thing a user sees; showing stale/empty data is a broken first impression.
- **expected user value:** High — every user hits this on every app open; forces a meaningless tab-switch before the app feels alive.
- **evidence:** 1 capture from active use today. Symptom: dashboard renders empty/stale until navigating to Inventory tab and back. Likely initialization-order issue — `renderDashboard()` runs before data is available, or isn't triggered after `loadUserData()` resolves.
- **effort:** S–M · **dependencies:** none · **confidence:** high · **ambiguity:** root cause needs a quick code trace (could be a missing `await` or a missing render call in the init chain)
- **why now vs later:** P0 — home screen is broken on load. Fix before any other UX work.
- **AI-recommended priority:** **P0**
- **status:** approved 2026-06-27 (via digest reply)

---

### PROP-003 — Recipe JSON import fails
- **▶ Decision: Approve.** P0 — recipe import is fully broken; fix before alpha user testing.
- **type:** bug · **source captures:** 20260626T1152Z-32 (×1) · *note: captured as /feature, reclassified bug*
- **goal alignment:** supports — North-star #1 (core loop). Recipe import is a primary way to populate the app; a silent failure blocks a real user from using it.
- **expected user value:** High — feature is non-functional. User tried importing `cpb-diet-import.json` (file visible in repo as untracked) and it failed.
- **evidence:** 1 capture from active use. The `cpb-diet-import.json` file in the working tree is likely the test file used. Root cause unknown — could be schema mismatch, parse error, or a missing field handler.
- **effort:** S–M · **dependencies:** none · **confidence:** high · **ambiguity:** root cause needs a code trace of the import handler + comparison against the actual JSON file structure
- **why now vs later:** P0 — can't import recipes at all. Fix before alpha user testing.
- **AI-recommended priority:** **P0**
- **status:** approved 2026-06-27 (via digest reply)

---

### PROP-004 — Bulk add parser: unit treated as ingredient name when comma is missing
- **▶ Decision: Approve.** P1 — silently corrupts pantry data right now during alpha use.
- **type:** bug · **source captures:** 20260626T1009Z-12 (×1)
- **goal alignment:** supports — North-star #1 (reduce friction in core loop). Bulk add is a key pantry entry shortcut; a parser that silently corrupts data on format variations erodes trust.
- **expected user value:** High — user is hitting this right now during alpha. Corrupted pantry entries require manual cleanup.
- **evidence:** 1 capture from active use. Symptom: omitting the comma separator causes the unit (e.g. "ml") to be captured as part of the ingredient name. The parser likely splits on comma first; without it, the whole string becomes the name.
- **effort:** S · **dependencies:** none · **confidence:** high · **ambiguity:** need to confirm exact format the parser expects and edge cases (e.g. "Coconut cream 200ml" vs "Coconut cream, 200 ml")
- **why now vs later:** P1 — active data corruption. Fix this in the next sprint.
- **AI-recommended priority:** **P1**
- **status:** approved 2026-06-27 (via digest reply)

---

### PROP-005 — Duplicate pantry name: ask user instead of silent skip
- **▶ Decision: Approve.** P1 — confirm the duplicate-add dialog copy at build time.
- **type:** bug/feature · **source captures:** 20260626T1044Z-28 (×1)
- **goal alignment:** supports — North-star #1 (friction) + #2 (never lose user data). Silently skipping a duplicate pantry add is wrong when the user legitimately has two of the same item (two oyster sauce jars with different expiry dates, different purchase dates, etc.).
- **expected user value:** High — pantry becomes inaccurate. User can't log a second jar of the same item at all right now.
- **evidence:** 1 capture from active use; user gave a concrete real-world example (two oyster sauces).
- **effort:** S · **dependencies:** none · **confidence:** high · **ambiguity:** decide the confirmation copy ("You already have X in your kitchen — add another?" + confirm/cancel)
- **why now vs later:** P1 — data accuracy issue; alpha users are adding real pantries now and hitting this.
- **AI-recommended priority:** **P1**
- **status:** approved 2026-06-27 (via digest reply)

---

### PROP-006 — Pantry card: switching date field closes the card (should not close)
- **▶ Decision: Approve.** P1 — friction in the core stock-tracking flow.
- **type:** bug/UX · **source captures:** 20260626T1020Z-18 (×1, part A)
- **goal alignment:** supports — North-star #1 (reduce friction in buy→stock flow). The collapse trigger fires on a field blur/switch, forcing the user to reopen the card just to fill in expiry date.
- **expected user value:** High — hits anyone adding new pantry items and wanting to set expiry date right away (which is the post-bulk-add workflow).
- **evidence:** 1 capture from active use today.
- **effort:** S · **dependencies:** none · **confidence:** high · **ambiguity:** identify exactly which event (blur? click-outside?) triggers the collapse and whether suppressing it has side effects
- **why now vs later:** P1 — active friction in the core stock-tracking flow.
- **AI-recommended priority:** **P1**
- **status:** approved 2026-06-27 (via digest reply)

---

### PROP-007 — Storage guide: don't show (or flag) guidance for unrecognized ingredients
- **▶ Decision: Approve.** P2 — schedule after the P0/P1s; pick the fallback UX at build.
- **type:** UX/trust · **source captures:** 20260626T1012Z-14 (×1)
- **goal alignment:** supports — North-star #1 and alpha trust. Showing a generic or clearly wrong storage guide for items the app doesn't recognize damages trust in the guide for items it *does* know.
- **expected user value:** Medium — prevents "this guide is wrong" perception during alpha testing.
- **evidence:** 1 capture. Note: the `#storage` tab is orphaned (no nav button per ROADMAP Known Issues), but per-item storage guidance likely still appears on pantry cards via `renderStorageGuide()` or similar.
- **effort:** S · **dependencies:** none · **confidence:** med (need to confirm where storage guide surfaces for pantry items) · **ambiguity:** decide the fallback UX: hide the section entirely, show "No storage guide for this item", or show a generic disclaimer
- **why now vs later:** P2 — trust issue but not blocking the core loop. Fix after P0/P1 bugs.
- **AI-recommended priority:** **P2**
- **status:** approved 2026-06-27 (via digest reply)

---

### PROP-008 — Pantry list: show recently added items at the top
- **▶ Decision: Approve.** P2 — small win; batch with the other post-add flow fixes (PROP-006/009).
- **type:** feature · **source captures:** 20260626T1020Z-18 (×1, part B)
- **goal alignment:** supports — North-star #1. After a bulk add, users need to fill in expiry dates and quantities; currently they have to scroll to find new items in an alphabetical or unordered list.
- **expected user value:** Medium — reduces post-add friction, especially after bulk add.
- **evidence:** 1 capture. Relates to PROP-006 (card closes) and PROP-009 (bulk add expiry) — all three address the same post-add flow.
- **effort:** S · **dependencies:** none · **confidence:** high · **ambiguity:** "recently added" = added in the last N minutes, or just the newest item? Likely sort by `dateAdded` descending for a short window, then revert to normal sort.
- **why now vs later:** P2 — UX improvement, not blocking.
- **AI-recommended priority:** **P2**
- **status:** approved 2026-06-27 (via digest reply)

---

### PROP-009 — Bulk add: include expiry date field in the add flow
- **▶ Decision: Approve.** P2 — sequence after PROP-004 (same parser).
- **type:** feature · **source captures:** 20260626T1023Z-22 (×1)
- **goal alignment:** supports — North-star #1. Currently bulk add creates items without expiry; users then have to open each card individually to add the date. Relates to PROP-006 (card closes on date switch) and PROP-008 (recently added on top).
- **expected user value:** High if implemented cleanly — eliminates the post-bulk-add editing step for expiry. Medium if the format gets complicated.
- **evidence:** 1 capture. Related captures: #18 (PROP-006, PROP-008) address the same friction from a different angle.
- **effort:** M · **dependencies:** PROP-004 (bulk add parser) should land first — adds to the same parser · **confidence:** high · **ambiguity:** format question: append to existing line syntax (`Name, qty unit, expiry`) or a separate field in the modal? Separate field is safer UX.
- **why now vs later:** P2 — good UX gain but builds on fixing the parser (PROP-004) first.
- **AI-recommended priority:** **P2**
- **status:** approved 2026-06-27 (via digest reply)

---

### PROP-010 — Ingredient card unit input: allow typing + offer dropdown
- **▶ Decision: Approve.** P2 — quality-of-life; not urgent, batch with other P2s.
- **type:** feature · **source captures:** 20260626T1015Z-16 (×1)
- **goal alignment:** supports — North-star #1 (reduce friction in data entry). A hybrid input (free-type + common-unit dropdown) reduces unit typos and standardizes data.
- **expected user value:** Medium — better data quality; reduces "g" vs "grams" inconsistencies that can break conversions.
- **evidence:** 1 capture.
- **effort:** M · **dependencies:** none · **confidence:** high · **ambiguity:** define the dropdown list (g, kg, ml, L, pcs, cups, tbsp, tsp, etc.) and whether free-type is primary or secondary
- **why now vs later:** P2 — quality-of-life, not blocking.
- **AI-recommended priority:** **P2**
- **status:** approved 2026-06-27 (via digest reply)

---

### PROP-011 — Bulk add: autocomplete / search from existing pantry items
- **▶ Decision: Park.** P3 — high effort; revisit after stability. If approved, build only the safe sub-part (autocomplete from the ingredient DB, not the pantry).
- **type:** feature · **source captures:** 20260626T1036Z-24 (×1)
- **goal alignment:** supports — North-star #1 (reduce friction). Typing ingredient names from scratch is slow; autocomplete from the existing pantry or ingredient DB would help.
- **expected user value:** Medium — significant speed gain for restocking known items.
- **evidence:** 1 capture. User correctly identifies the risk: autocomplete from pantry could suggest items that shouldn't be re-added (wrong signal for restocking vs first-add scenarios).
- **effort:** L · **dependencies:** PROP-004 (parser fix) should land first · **confidence:** med · **ambiguity:** two separate problems — (a) autocomplete from ingredient DB (safe, no dedup concern), (b) from existing pantry (requires clear signal: restock vs new). Start with (a) only.
- **why now vs later:** P3 — high effort, valid but not urgent during alpha stability phase.
- **AI-recommended priority:** **P3**
- **status:** parked 2026-06-27 (via digest reply)

---

### PROP-012 — Long press to delete pantry item
- **▶ Decision: Park.** P3 — nice-to-have; delete already works via the card edit.
- **type:** feature · **source captures:** 20260626T1023Z-20 (×1)
- **goal alignment:** neutral — a power-user shortcut; item deletion via card edit already exists.
- **expected user value:** Low–Medium — faster for frequent deletions, but delete is not a high-frequency action.
- **evidence:** 1 capture.
- **effort:** M · **dependencies:** none · **confidence:** med · **ambiguity:** long press on mobile is tricky (needs 500ms timeout, visual feedback, accidental-trigger risk); needs a confirmation step to prevent accidental deletes. Desktop has no long press.
- **why now vs later:** P3 — nice-to-have, address after P0/P1/P2 backlog.
- **AI-recommended priority:** **P3**
- **status:** parked 2026-06-27 (via digest reply)

---

### PROP-013 — Same product, different packaging sizes (data model decision)
- **▶ Decision: Park.** Revisit as a product-direction decision once there's more user data — the data-model change is too big to make on a single example.
- **type:** decision · **source captures:** 20260626T1037Z-26 (×1)
- **goal alignment:** neutral — real product question but no urgency during alpha stability.
- **expected user value:** unclear — depends on direction. Current model treats "Coconut Cream 200ml" and "Coconut Cream 400ml" as separate pantry items (correct short-term, but messy long-term).
- **evidence:** 1 capture with a concrete real-world example. No demand signal beyond this.
- **effort:** L — any solution that merges/relates variants touches the data model (AppState, Firestore schema) · **confidence:** low · **ambiguity:** three options: (A) keep as separate items (status quo, user names them distinctly), (B) sub-items under a parent ingredient, (C) a "variant" field on each pantry item. All have trade-offs.
- **why now vs later:** P3 — park. Get more user data before deciding; the data model change is significant.
- **AI-recommended priority:** **P3**
- **status:** parked 2026-06-27 (via digest reply)

---

### PROP-014 — Missing button variants render as invisible/unstyled (btn--ghost, btn--danger, btn--success)
- **▶ Decision: Approve.** P1 — core-screen buttons have no visible affordance and the Delete-Account button has no danger styling; a real usability + trust blocker.
- **type:** bug · **source captures:** UX audit 2026-06-27 (whole-app consistency, finding #1)
- **goal alignment:** strongly supports **Alpha stability** — North-star #1 (complete core jobs). `.btn--ghost` ("Browse", "Bulk add" on Inventory) falls back to bare `.btn` = transparent, no border → looks like floating text, not a button. `.btn--danger` (`#delete-account-btn`) renders default-styled, so the most destructive action looks benign.
- **expected user value:** High — first-run users on the Inventory screen can't tell those are tappable; destructive action lacks a danger cue.
- **evidence:** classes used in `index.html`/`app.js` but absent from `style.css` (only `--primary/--secondary/--outline` exist).
- **effort:** S · **dependencies:** none · **confidence:** high · **ambiguity:** none
- **why now vs later:** now — invisible primary controls on a core alpha screen.
- **AI-recommended priority:** **P1**
- **status:** approved 2026-06-30 (via digest reply)

---

### PROP-015 — White text on sage-green surfaces fails contrast (unreadable active states)
- **▶ Decision: Approve.** P1 — WCAG-failing ~1.9:1 white-on-sage on Plan/Price Book active chips; hard to read on a phone in daylight.
- **type:** bug · **source captures:** UX audit 2026-06-27 (finding #7)
- **goal alignment:** strongly supports — accessibility + readability on the core Plan flow. Same green surface shows dark text in some places and unreadable white in others (`.planner-day-chip.active`, `.ingcat-store-tag`, `.day-action-paste`, `.settings-row--primary`, etc.).
- **expected user value:** High — active day chip and store tags are currently hard to read.
- **evidence:** `color:#fff` on `--color-primary`/`--color-success` fills ≈1.9:1 (fails AA); the rest of the app uses dark `--color-btn-primary-text` on the same green.
- **effort:** S · **dependencies:** none · **confidence:** high · **ambiguity:** none — standardize on dark text on light-sage.
- **why now vs later:** now — readability blocker.
- **AI-recommended priority:** **P1**
- **status:** approved 2026-06-30 (via digest reply)

---

### PROP-016 — Small tap targets below 44px cause mis-taps on phone (steppers, ×-remove, fav, day actions)
- **▶ Decision: Approve.** P1 — sub-44px controls on a phone cause fiddly taps and accidental deletes; `.btn`/`.tab-btn` already get 44px, the most-tapped small controls don't.
- **type:** bug/UX · **source captures:** UX audit 2026-06-27 (finding #4)
- **goal alignment:** supports — North-star #1 (friction) + #2 (don't lose data: accidental pantry deletes). Phone-first.
- **expected user value:** High — serving +/- (28px), `.recipe-fav-btn`, `.pantry-remove`/`.cooked-remove`/`.modal-close`, `.day-action-btn` are all below comfortable/again some below the 24px WCAG floor.
- **evidence:** mobile `@media` block sets `min-height:44px` only on `.btn`/`.tab-btn`.
- **effort:** M · **dependencies:** none · **confidence:** high · **ambiguity:** keep glyphs visually small but pad the hit area.
- **why now vs later:** now — directly causes mis-taps incl. accidental deletes.
- **AI-recommended priority:** **P1**
- **status:** approved 2026-06-30 (via digest reply)

---

### PROP-017 — Undefined CSS variables + a duplicated base block (silent fallbacks / time-bomb)
- **▶ Decision: Approve.** P1 for the `:root` alias fix (cheap, fixes transparent badges + many components at once); the duplicate-block deletion is riskier — confirm scope at build.
- **type:** chore/bug · **source captures:** UX audit 2026-06-27 (finding #9)
- **goal alignment:** supports — partly user-visible (e.g. `.member-status.pending` → transparent badge; Shop sub-tabs styled by an undefined token) and partly dev-health (a duplicated base block means a future fix to one copy silently won't take effect — will burn time during alpha).
- **expected user value:** Medium now (a few transparent/incorrect surfaces) + high leverage (one alias map fixes dozens of components).
- **evidence:** rules reference `--color-warning-light/--color-danger/--color-text-muted/--color-bg/--surface/--border` etc. not in `:root`; base block (`html,*,h1–h6,.btn*,.form-control,.card`) + `@font-face` defined 2–3×.
- **effort:** M · **dependencies:** none · **confidence:** high (aliases) / med (safe deletion of the duplicate block) · **ambiguity:** which copy of the duplicated block to keep — verify they're identical first.
- **why now vs later:** aliases now (low-risk, high-leverage); duplicate-block deletion now-ish with care.
- **AI-recommended priority:** **P1**
- **status:** approved 2026-06-30 (via digest reply)

---

### PROP-018 — Empty states styled three different ways across tabs
- **▶ Decision: Approve.** P2 — the first-run app is mostly empty states; route them all through the existing `emptyState()` helper for a consistent first impression.
- **type:** UX · **source captures:** UX audit 2026-06-27 (finding #2)
- **goal alignment:** supports — North-star #3 (zero-friction start). New users see empty states on every tab; some are friendly icon+title+hint, others a bare grey sentence → reads unfinished.
- **expected user value:** Medium — consistency exactly where first impressions form.
- **evidence:** `emptyState()` helper vs inline `<p style=…>` (nutrition filter), `.dash-l2-empty`, `.pantry-empty`/`.ib-empty` one-liners.
- **effort:** M · **dependencies:** none · **confidence:** high · **ambiguity:** none — reuse `.empty-state*`, delete orphaned inline styles.
- **why now vs later:** now-ish — first-run polish, no new CSS.
- **AI-recommended priority:** **P2**
- **status:** approved 2026-06-30 (via digest reply)

---

### PROP-019 — Some inputs remove the focus outline (outline:none) — accessibility regression
- **▶ Decision: Approve.** P2 — Price Book / quantity inputs set `outline:none` with no replacement, so keyboard/switch users lose their place (WCAG 2.4.7). Restore the global focus outline.
- **type:** bug (a11y) · **source captures:** UX audit 2026-06-27 (finding #5, focus subset)
- **goal alignment:** supports — accessibility. (Full input-family unification is a separate, larger polish task — parked; see PROP-021/spacing.)
- **expected user value:** Medium — affects keyboard/switch-access users; low effort.
- **evidence:** `.ingcat-*:focus`, `.gpl-price-input:focus` use `outline:none`; the app otherwise has a global `:focus-visible { outline: var(--focus-outline) }`.
- **effort:** S · **dependencies:** none · **confidence:** high · **ambiguity:** none — replace `outline:none` with `var(--focus-outline)`.
- **why now vs later:** now — small a11y fix. (Unifying all bespoke inputs to `.form-control` = later.)
- **AI-recommended priority:** **P2**
- **status:** approved 2026-06-30 (via digest reply)

---

### PROP-020 — Hardcoded hex colors bypass the token system (amber/red appear as 4+ shades)
- **▶ Decision: Park.** Valid consistency debt, but pure cosmetic — defer past the stabilize phase. (Quick subset: point status reds/ambers at the existing semantic tokens.)
- **type:** chore · **source captures:** UX audit 2026-06-27 (finding #3)
- **goal alignment:** neutral-to-supports — improves the "amber = expiring" mental model, but doesn't block completing jobs. Down-weighted during alpha-stability.
- **expected user value:** Low–Medium — consistency only.
- **evidence:** warning appears as `#f59e0b/#fef3c7/#fffbeb` + token `#D67630`; error as `#e74c3c/#ef4444/#dc2626` + token `#C0152F`; tokens `--color-error/-warning/-success(+-rgb)` already exist.
- **effort:** M · **dependencies:** overlaps PROP-017 (token aliases) · **confidence:** med · **ambiguity:** none.
- **why now vs later:** later — cosmetic; revisit after the alpha usability fixes.
- **AI-recommended priority:** **P3**
- **status:** approved 2026-06-30 (via digest reply)

---

### PROP-021 — Badge/pill system fragmented (~13 treatments for one concept)
- **▶ Decision: Park.** Defer the full consolidation; optionally do the S quick-win (normalize all badges to `--radius-full` + `--font-size-xs`) if a spare slot opens.
- **type:** chore · **source captures:** UX audit 2026-06-27 (finding #6)
- **goal alignment:** neutral — badges encode category/"in pantry"/"expiring"/cost; ~13 visual treatments add noise, but not a job blocker. Polish.
- **expected user value:** Low–Medium.
- **evidence:** `.status` (canonical) vs `.recipe-category/.pantry-badge/.grocery-suggested-badge/.tab-badge/.dash-*-tag` etc., each own font-size/padding/radius.
- **effort:** L (full) / S (just normalize radius+size) · **dependencies:** none · **confidence:** med · **ambiguity:** scope.
- **why now vs later:** later — incremental polish.
- **AI-recommended priority:** **P3**
- **status:** approved 2026-06-30 (via digest reply)

---

### PROP-022 — Spacing scale bypassed by ad-hoc rem/px in newer components
- **▶ Decision: Park.** Vertical-rhythm drift between tabs; real but incremental — schedule post-alpha, convert per-component.
- **type:** chore · **source captures:** UX audit 2026-06-27 (finding #8)
- **goal alignment:** neutral — "connective tissue of polished," not a blocker. Down-weighted during stabilize.
- **expected user value:** Low.
- **evidence:** newer components (Pantry/Price Book/Prep/Dashboard/Settings) use literal `0.75rem/0.6rem/1rem` + `px` radii instead of `--space-*`/`--radius-*` (scale already covers them).
- **effort:** L · **dependencies:** none · **confidence:** high · **ambiguity:** none — mechanical token mapping.
- **why now vs later:** later — large surgical diff; not blocking alpha.
- **AI-recommended priority:** **P3**
- **status:** approved 2026-06-30 (via digest reply)

---

### PROP-023 — Modal sizing/structure varies; some hand-roll inline layout
- **▶ Decision: Park.** Mostly polish — but the mobile-footer-stacking subset (action buttons cramped side-by-side on phone) is worth pulling forward.
- **type:** UX · **source captures:** UX audit 2026-06-27 (finding #10)
- **goal alignment:** supports (mobile footer subset) / neutral (rest) — modals host the core jobs (Add Recipe, Set Goals, Add Item); inline `max-width` + non-`.modal-footer` action rows mean buttons don't get the mobile stacking rule.
- **expected user value:** Low–Medium (Medium for the phone footer subset).
- **evidence:** inline `style="max-width:…"` overrides; Prep Mode / Username / Custom-Ingredient modals bypass `.modal-header/body/footer`.
- **effort:** M · **dependencies:** none · **confidence:** med · **ambiguity:** none — add `.modal-content--sm/--md`, ensure action rows use `.modal-footer`.
- **why now vs later:** mobile-footer subset now-ish; full modal refactor later.
- **AI-recommended priority:** **P3**
- **status:** approved 2026-06-30 (via digest reply)

---

### PROP-024 — Bulk add: default storage location selector (counter / fridge / pantry)
- **▶ Decision: Park.** P2 — valid UX gain, but not a blocker during stabilize phase. Approve when P3 queue clears.
- **type:** feature · **source captures:** 20260702T1815Z-45 (×1)
- **goal alignment:** supports — North-star #1 (reduce post-add friction). After bulk-adding items from one place (e.g. checking the counter), users must set storage individually per card. A single default-location picker at the top of the bulk-add modal would let "all from counter" flow in one step.
- **expected user value:** Medium — removes 1 extra edit per item in typical restocking. Most valuable when bulk-adding 5+ items from the same location.
- **evidence:** 1 capture from active alpha use; user describes the exact workflow friction (counter check → bulk add → per-card storage edit).
- **effort:** S · **dependencies:** none · **confidence:** high · **ambiguity:** UI placement: dropdown above the textarea in `#bulk-add-modal`; default = "Auto (infer)"; overrides `inferStorage()` in `confirmBulkAdd()` when set.
- **why now vs later:** Park — post-stabilize. BQ-016 modal work is more pressing.
- **AI-recommended priority:** **P2**
- **status:** pending

---

### PROP-025 — Bulk add: per-item expiry date in the line format (vs single shared date)
- **▶ Decision: Park.** Valid design evolution of BQ-005, but redesigning the parser + UI is M–L effort. Revisit when alpha feedback is clearer.
- **type:** feature/UX · **source captures:** 20260702T1816Z-47 (×1)
- **goal alignment:** supports — North-star #1 (accurate stock tracking) + #2 (data integrity). Current BQ-005 ships one shared expiry for all items in a bulk add; user correctly identifies that items bought in the same trip often have different expiry dates (especially fresh produce + fridge items). Proposed format: `Name qty unit exp-date` per line.
- **expected user value:** High when implemented — removes the post-bulk-add per-card expiry edit. But the current single-date field is still useful for same-batch restocking (e.g. all cans from the same shop run).
- **evidence:** 1 capture from active use immediately after BQ-005 shipped — earliest live feedback on that feature.
- **effort:** M–L · **dependencies:** PROP-024 (storage selector, same modal) if combined · **confidence:** high (the desire) / med (the parser approach) · **ambiguity:** format: append to line (`Coconut cream 200ml 2026-07-20`) vs separate column vs inline date keyword (`exp:2026-07-20`). Also: what happens when the shared date field AND a per-line date are both set?
- **why now vs later:** Park — redesigning the parser and UX mid-stabilize adds risk. Collect more user feedback first; if the per-item friction keeps appearing, promote to Approve.
- **AI-recommended priority:** **P2**
- **status:** pending

---

### PROP-026 — Recipe card: compact header, always-expanded detail view
- **▶ Decision: Park.** P3 — UX exploration; current expand-on-click is functional and avoids cognitive overload on a long recipe list.
- **type:** feature/UX · **source captures:** 20260702T1817Z-49 (×1)
- **goal alignment:** supports (partially) — North-star #1 (reduce taps to access recipe detail). User wants cards to feel tighter visually but show ingredients/instructions by default. These goals conflict: always-expanded detail on every card would make the recipe list very tall and hard to scan.
- **expected user value:** Low–Medium — current design lets users scan recipes quickly; always-expanded detail would help if users routinely open the same recipe every session.
- **evidence:** 1 capture. Likely means: (A) header row should be more compact / less whitespace, and (B) opening the detail view should default to the Ingredients tab rather than a blank state. Confirm interpretation at build.
- **effort:** M (compact header is S; always-open detail is M with a "remember last tab" state) · **dependencies:** none · **confidence:** med · **ambiguity:** "always open" = expand on list render, or just default to expanded when tapping? If the former, the entire recipe list would be a wall of text — almost certainly not what the user means.
- **why now vs later:** Park — low urgency, needs design clarity before building.
- **AI-recommended priority:** **P3**
- **status:** pending

---

### PROP-027 — Cook confirmation: optional serving multiplier for accurate pantry deduction
- **▶ Decision: Park.** P2 — meaningful accuracy enhancement to the core cook-and-deduct flow. Promote when cook loop is stable.
- **type:** feature · **source captures:** 20260702T1820Z-51 (×1)
- **goal alignment:** supports — North-star #1 (accurate core loop) + #2 (data integrity). Currently `markRecipeCooked()` always deducts 1× the recipe's ingredient amounts. If a user cooks double portions, pantry quantities become inaccurate. User also notes that the cook flow is a good moment to surface low staple warnings.
- **expected user value:** High for accuracy-conscious users; Medium for most — many cook exact recipe portions. Also surfaces a place to check staple depletion (staples aren't deducted automatically).
- **evidence:** 1 capture from active use. Connects to the existing `deductIngredientsForRecipe()` function which already has a per-ingredient unit conversion system — the multiplier would be trivial to thread in.
- **effort:** M (add a "How many portions?" step/input to the cook confirmation dialog; pass multiplier to `deductIngredientsForRecipe()`) · **dependencies:** none · **confidence:** high · **ambiguity:** UX: inline in the existing cook-confirm dialog, or a new step? Default to 1× with a stepper. Low-staple warning can be a follow-up.
- **why now vs later:** Park — not a blocker; promote after alpha stabilize shows cook-loop usage.
- **AI-recommended priority:** **P2**
- **status:** pending

---

### PROP-028 — Long-press to enter bulk multi-select mode (bulk move + bulk delete) on pantry/grocery items
- **▶ Decision: Park.** P3 — power-user shortcut; extends PROP-012. Revisit after alpha stabilize.
- **type:** feature · **source captures:** 20260702T1827Z-55 (×1), 20260702T1827Z-53 (duplicate, dropped)
- **goal alignment:** supports — North-star #1 (bulk management friction). User wants to select multiple pantry or grocery items via long-press, then bulk-move them to a different storage location OR bulk-delete them.
- **expected user value:** Medium — useful for power users doing a big pantry reorg; not needed for daily use. Individual delete via card edit already works.
- **evidence:** 2 captures (msg-55 + msg-53 which was a duplicate with a malformed "/also" prefix). Related to PROP-012 (long-press to delete, parked 2026-06-27) — this extends that to full multi-select with move support.
- **effort:** M–L (long-press gesture with 500ms debounce + visual enter-selection-mode state + checkbox UI + bulk action bar + delete + move-to-location modal) · **dependencies:** none · **confidence:** med · **ambiguity:** scope: pantry only, or grocery list too? Move target: storage location picker? Desktop has no long-press — needs a fallback (multi-click?).
- **why now vs later:** Park — builds on PROP-012 which was P3. Address after stabilize phase.
- **AI-recommended priority:** **P3**
- **status:** pending

---

### PROP-029 — Planner tab overflows horizontally on mobile (+23px at 390px width)
- **▶ Decision: Approve.** P1 — exactly the "looks broken on mobile" bug class the mobile-layout test exists to catch; the test itself now works reliably.
- **type:** bug · **source:** automated finding (TASK-004 review, `tests/mobile-layout.spec.js` after its fixture fix), not a phone capture
- **goal alignment:** strongly supports — North-star #1 (core loop friction) + alpha stability. Horizontal scroll on a core tab reads as visibly broken to a first-time phone user.
- **expected user value:** High — every phone user hits the Planner tab; sideways scroll is an immediate trust hit.
- **evidence:** `npx playwright test tests/mobile-layout.spec.js` at 390×844 viewport reports `document.documentElement.scrollWidth - window.innerWidth = 23` on the `planner` tab only; all other 6 tabs (recipes, grocery, fridge, hacks, nutrition, ingredients) pass with 0 overflow. Reproducible.
- **effort:** S–M · **dependencies:** none · **confidence:** high (evidence) / med (root cause — needs a code trace of the planner grid/table markup for a fixed-width element, likely a day-column or table that doesn't wrap/shrink at 390px) · **ambiguity:** exact element responsible not yet identified
- **why now vs later:** P1 — real, reproducible, affects every mobile user on a core tab. Fix in the next sprint.
- **AI-recommended priority:** **P1**
- **status:** approved 2026-07-03 (chat)

---

## Proposal contract
*(the structured shape triage produces — keep this shape so downstream stages stay swappable)*
```
### PROP-NNN — <title>
- ▶ Decision: Approve | Park | Reject | Clarify — <one-line why; the recommended next action, stated first>
- type:        feature | bug | chore | decision
- source captures: <ids> (×N duplicates)
- goal alignment:  supports | conflicts | mixed | neutral  — vs the Current Objective (name it; add which North-star goal)
- expected user value: <who benefits, how much, in the current phase>
- evidence:    <recurring friction · dup count · roadmap/similar-past alignment · demand signal>
- effort:      S | M | L
- dependencies: <none | …>
- confidence:  high | med | low
- ambiguity:   <none | what's unclear>
- why now vs later: <why it belongs in the next sprint, or why it should wait>
- AI-recommended priority: P0..P3   (goal-adjusted, not raw priority)
- status:      pending
```
*`▶ Decision` is the recommended action; `status` is your recorded outcome. They differ on purpose —
the AI recommends, you decide.* **Approve** = build it (→ ROADMAP). **Park** = valid, not now. **Reject**
= drop it. **Clarify** = AI can't recommend confidently; it needs an answer from you first.
