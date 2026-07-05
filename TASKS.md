# Tasks

> **Handoff document.** Claude writes tasks; Codex checks them off.
> Tasks must come from an approved item in `planning/BUILD_QUEUE.md`.
> One task = one atomic, independently testable unit.

## Status legend

`todo` → `codex` → `in-progress` → `review` → `approved` / `rework` → `done`
`blocked` = Codex hit an ambiguity; Claude must resolve before work continues. Under Sprint
Execution Mode (a group header marked `Risk: Low/Medium · Execution: Chained` — see
CLAUDE.md/AGENTS.md), a blocked task doesn't halt the whole group by default: Codex skips only
tasks that depend on it and keeps building independent ones, unless the blocker is architecture/
scope-level or file-overlapping. See DECISIONS D-023.

---

<!-- ═══════════════════════════════════════════════════════
     BQ-016 · Modal mobile-footer-stacking fix
     ═══════════════════════════════════════════════════════ -->

### TASK-001 · Add CSS modal size modifier classes
status: done
owner: codex
source: BQ-016
depends-on: none
files: style.css

blocker:
  - 2026-07-03: CSS change implemented, but required Playwright verification could not be completed. `npm test` failed in sandbox with `spawn EPERM`, then approved runs timed out after 124s and 304s. Diagnostic `npx playwright test tests/mobile-layout.spec.js --workers=1 --reporter=list --timeout=60000` failed before reaching the CSS overflow assertion because `#kitchen-setup-modal` intercepted the tab click.
  - 2026-07-03 (resolved by Claude review, see REVIEW.md): failure traced to a pre-existing gap in `tests/mobile-layout.spec.js` (missing `pantryOnboardingDone` seed / `closeAllModals()` call), unrelated to this task's CSS-only diff. CSS verified correct by direct code trace. Approved; split off TASK-004 to fix the test fixture.

acceptance:
  - [ ] Three new modifier classes exist in style.css immediately after the last `.modal-content` block (around line 3015): `.modal-content--sm`, `.modal-content--md`, `.modal-content--lg`
  - [ ] `.modal-content--sm  { max-width: 420px }` — used by username + custom-item modals
  - [ ] `.modal-content--md  { max-width: 480px }` — used by user-ingredient + bulk-add modals
  - [ ] `.modal-content--lg  { max-width: 600px }` — used by paste-recipe modal
  - [ ] No other CSS is changed
  - [ ] The small-screen override at line 5460 (`max-width: 100% !important`) still takes precedence over all three classes on narrow viewports (no change needed — just verify it applies)

constraints:
  - Do not alter the base `.modal-content` blocks (lines 1304 and 3007) — they set the 700px default
  - Do not add `!important` to the modifier classes — specificity from the class selector is enough
  - No JavaScript changes

test steps:
  - [ ] Open app in browser at desktop width (≥1024px): no modals visible yet — no regression
  - [ ] Open any modal that will receive a class in TASK-002/003; confirm it still renders at its correct width (visual check only — class not applied yet, so this is a baseline)

---

### TASK-002 · Fix #username-modal: convert button row to .modal-footer + apply size class
status: done
owner: codex
source: BQ-016
depends-on: TASK-001
files: index.html

context:
  The username modal (line ~833) is the only modal where action buttons don't stack on mobile.
  Its button row is a raw div with inline flex styles, bypassing the .modal-footer mobile rule.
  Current HTML (line ~842):
    <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1rem;">
      <button class="btn btn--outline" onclick="closeUsernameModal()">Cancel</button>
      <button class="btn btn--primary" onclick="saveUsername()">Save name</button>
    </div>
  Current .modal-content (line ~834):
    <div class="modal-content" style="max-width: 420px;">

acceptance:
  - [ ] `#username-modal .modal-content` has class `modal-content--sm` added; `style="max-width: 420px;"` attribute removed entirely
  - [ ] The button row `<div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1rem;">` is replaced with `<div class="modal-footer">` — no inline style attributes on it
  - [ ] Both buttons (Cancel + Save name) remain inside the new `.modal-footer` div with onclick handlers unchanged
  - [ ] No other HTML in `#username-modal` is changed

constraints:
  - Do not touch any other modal's HTML
  - Do not change button labels, onclick handlers, or IDs
  - No CSS or JavaScript changes

test steps:
  - [ ] Open app; trigger the username modal (Settings → change name, or first-run prompt)
  - [ ] At desktop width (≥768px): modal appears at ~420px wide, buttons are side by side on the right — same as before
  - [ ] At mobile width (≤480px or DevTools mobile emulation): Cancel and Save name buttons each take full width and stack vertically
  - [ ] Clicking Cancel closes the modal; clicking Save name with a name entered saves it

---

### TASK-003 · Sweep 4 remaining modals: inline max-width → CSS modifier class
status: done
owner: codex
source: BQ-016
depends-on: TASK-001
files: index.html

context:
  Four modals already use .modal-footer correctly (no behavior change needed) but carry inline
  max-width on .modal-content. Replace each with the matching size class from TASK-001.
  Prep Mode modal (#prep-mode-modal, line ~881) is explicitly out of scope — its inline style
  bundles a flex layout for scrollable body; leave it untouched.

  Modals to fix:
    #custom-item-modal   line ~905  style="max-width: 420px;"  → modal-content--sm
    #user-ingredient-modal line ~985 style="max-width:480px"   → modal-content--md
    #bulk-add-modal       line ~1124 style="max-width:480px"   → modal-content--md
    #paste-recipe-modal   line ~963  style="max-width: 600px;" → modal-content--lg

acceptance:
  - [ ] `#custom-item-modal .modal-content`: class `modal-content--sm` added, `style="max-width: 420px;"` removed
  - [ ] `#user-ingredient-modal .modal-content`: class `modal-content--md` added, `style="max-width:480px"` removed
  - [ ] `#bulk-add-modal .modal-content`: class `modal-content--md` added, `style="max-width:480px"` removed
  - [ ] `#paste-recipe-modal .modal-content`: class `modal-content--lg` added, `style="max-width: 600px;"` removed
  - [ ] `#prep-mode-modal` is untouched
  - [ ] No other HTML, CSS, or JS is changed

constraints:
  - Only remove the max-width inline style — do not touch any other inline styles on .modal-content
  - Do not change .modal-footer contents, button labels, or onclick handlers in any of these modals

test steps:
  - [ ] Open each of the 4 modals at desktop width; confirm they render at the same width as before (420 / 480 / 480 / 600px) — visual check
  - [ ] Open each at mobile width (DevTools); confirm buttons still stack vertically (they already used .modal-footer, so this should pass without change)
  - [ ] Confirm #prep-mode-modal is unchanged: open Prep Mode, confirm layout is identical to before

### TASK-004 · Fix mobile-layout.spec.js onboarding-modal interception
status: done
owner: codex
source: TASK-001 review (see REVIEW.md)
depends-on: none
files: tests/mobile-layout.spec.js

context:
  On a fresh Playwright profile, `seedPantryIfEmpty()` (app.js:6921) auto-opens
  `#kitchen-setup-modal` because the pantry is empty and `pantryOnboardingDone` is unset.
  `mobile-layout.spec.js` only seeds `mealPrepHelpSeen` and never seeds `pantryOnboardingDone`
  or force-closes modals, so the wizard intercepts the first tab-button click. Every other spec
  in this suite (e.g. `button-smoke.spec.js`) survives the same condition via a `closeAllModals()`
  helper called right after page load — `mobile-layout.spec.js` is the one file missing it.

acceptance:
  - [ ] `mobile-layout.spec.js`'s `addInitScript` also seeds `localStorage.setItem('pantryOnboardingDone', '1')` (or equivalent), matching the pattern in the other specs
  - [ ] Add a `closeAllModals()`-style call (or reuse the one in `button-smoke.spec.js`) immediately after `page.goto` / initial wait, before the tab loop
  - [ ] `npx playwright test tests/mobile-layout.spec.js` runs past the onboarding modal and reaches the overflow assertion for every tab
  - [ ] No other spec files changed

constraints:
  - Do not change app.js or style.css — this is a test-fixture-only fix
  - If `npm test` / sandboxed runs still fail with `spawn EPERM` or time out, record that separately as an environment blocker rather than treating it as a code defect

test steps:
  - [ ] Run `npx playwright test tests/mobile-layout.spec.js --reporter=list`; confirm it completes (pass or a real overflow finding) instead of failing on modal interception
  - [ ] Run the full `npm test` suite once the environment allows it; confirm no regressions in the other specs

<!-- ═══════════════════════════════════════════════════════
     BQ-017 · Planner tab mobile horizontal overflow
     ═══════════════════════════════════════════════════════ -->

### TASK-005 · Constrain .planner-controls width so it stops overflowing the viewport on mobile
status: done
owner: codex
source: BQ-017
depends-on: none
files: style.css

context:
  `.planner-controls` (the Clear Week / Save Week / Load Saved Week / Prep Mode button row on the
  Planner tab) is targeted by three separate `@media (max-width: 768px)` blocks in `style.css`
  (~3316, ~3715, ~5483) — pre-existing duplicate-CSS debt (same shape as BQ-014/BQ-015, not in scope
  to consolidate here). Two of them correctly force a horizontally-scrolling nowrap row, but none
  constrain the box's own width, so it renders at its full intrinsic content width (397px) instead of
  clipping to the 358px available inside `.section-header`, dragging the whole `#planner` section
  23px past a 390px viewport (confirmed live via Playwright at 390×844: `document.documentElement.scrollWidth
  - window.innerWidth === 23` on the planner tab only; all other 6 tabs measure 0).

  Root cause + fix already verified live (not just code-traced): adding `width: 100%; max-width: 100%;`
  to the `.planner-controls` rule in the block at ~line 5483 (already commented "compact scrollable
  pill row") drops the overflow to 0px, while the row still scrolls internally
  (`el.scrollWidth (397) > el.clientWidth (358)`), all 4 buttons stay present/clickable, and the other
  6 tabs remain unaffected.

  Current block (style.css ~line 5481-5498):
    @media (max-width: 768px) {
      /* Planner action buttons: compact scrollable pill row */
      .planner-controls {
        display: flex;
        flex-wrap: nowrap;
        gap: 6px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 2px;
      }
      .planner-controls::-webkit-scrollbar { display: none; }
      .planner-controls .btn {
        flex: 0 0 auto;
        font-size: 0.8rem;
        padding: 0.3rem 0.7rem;
        white-space: nowrap;
      }
    }

acceptance:
  - [ ] `.planner-controls` inside the `@media (max-width: 768px)` block at ~line 5483 gains two new
        declarations: `width: 100%;` and `max-width: 100%;` (any order, alongside the existing ones)
  - [ ] No other property in that block, and no other `.planner-controls` block (~3316, ~3715), is changed
  - [ ] `npx playwright test tests/mobile-layout.spec.js --reporter=list` passes with zero failures
        (this is currently the one real failure the suite reports — `planner (+23px)` — and should
        become clean once this fix lands)
  - [ ] No other CSS, HTML, or JS is changed

constraints:
  - Do not touch or consolidate the other two `.planner-controls` media blocks (~3316, ~3715) — that
    is separate, already-tracked debt (BQ-014/BQ-015), not this task
  - Do not add `!important` — the two-line addition alone is sufficient (verified live) because
    neither of the other two blocks sets `width`/`max-width` on `.planner-controls`, so ordinary
    cascade/source-order already lets this block's value win
  - No JavaScript changes

test steps:
  - [ ] Run `npx playwright test tests/mobile-layout.spec.js --reporter=list`; confirm 0 failures
        (was: 1 failure, `planner (+23px)`)
  - [ ] At desktop width (≥1024px): Planner tab's button row renders unchanged (visual check — this
        media query only applies ≤768px)
  - [ ] At mobile width (390px, DevTools or the Playwright viewport): Planner tab no longer scrolls
        sideways; the Clear Week / Save Week / Load Saved Week / Prep Mode buttons still all appear,
        scrolling horizontally within their own row (not off the edge of the page)
  - [ ] Tap/click each of the 4 buttons on the Planner tab at mobile width; confirm they still work
        (Clear Week clears, Save Week / Load Saved Week / Prep Mode open their respective flows)

### TASK-006 · TEMPORARY — autopilot end-to-end verification (revert immediately after test)
status: codex
owner: codex
source: manual-autopilot-verification
priority: P1
depends-on: none
files: tests/autopilot-verification.spec.js

context:
  TEMPORARY throwaway task to verify the /go mission autopilot end-to-end (plan-skip -> build ->
  auto-review -> mark done on main -> summary). Reverted immediately after, regardless of outcome.
  Do exactly what is described and nothing more.

acceptance:
  - [ ] Create a new file `tests/autopilot-verification.spec.js` with exactly one trivial always-passing
        Playwright test, and a top-of-file comment noting it is a temporary artifact safe to delete:
          const { test, expect } = require('@playwright/test');
          test('autopilot verification placeholder', async () => { expect(true).toBe(true); });
  - [ ] Follow your normal handoff workflow: set this task's `status` to `review` in TASKS.md and
        append your standard completion evidence to CHANGELOG.md and TEST_REPORT.md.

constraints:
  - Do not modify app.js, index.html, or style.css.
  - Do not modify any existing test file.
  - Keep the new file under 15 lines.
  - The only files you may touch are: tests/autopilot-verification.spec.js, TASKS.md (this task's
    status field only), CHANGELOG.md, and TEST_REPORT.md. Do not touch CLAUDE.md, AGENTS.md, docs/,
    planning/, captures/, tools/, or any automation script.

test steps:
  - [ ] The new file exists at tests/autopilot-verification.spec.js.
  - [ ] Running `npx playwright test tests/autopilot-verification.spec.js` passes.

<!-- Paste new tasks above this line. Oldest/done tasks sink to the bottom. -->

<!-- TASK TEMPLATE — copy and fill:

### TASK-001 · <short title>
status: todo → codex
source: BQ-<id>
depends-on: none
files: path/to/file.js, path/to/other.js
acceptance:
  - [ ] criterion 1
  - [ ] criterion 2
constraints: <any hard limits — deps to use/avoid, perf, backward compat>
notes: see ADR or PRD reference if applicable

-->
