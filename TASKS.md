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

<!-- ═══════════════════════════════════════════════════════
     BQ-018 · Bulk add: default storage location selector
     ═══════════════════════════════════════════════════════ -->

### TASK-006 · Add default storage selector to #bulk-add-modal
status: done
owner: codex
source: BQ-018
priority: P2
depends-on: none
files: index.html, app.js

context:
  Bulk add currently infers storage per-item via `inferStorage(name, category)` in
  `confirmBulkAdd()` (app.js:7612). PROP-024 asks for an optional default-storage override at
  the top of the modal so bulk-adding "everything I just put on the counter" doesn't require a
  per-card storage edit afterward. The app's storage model is three values: `counter | fridge |
  freezer` (see `inferStorage()` at app.js:115-142; there is no `pantry` storage — PROP-024's
  "counter/fridge/pantry" wording is a misspoke, treat as counter/fridge/freezer).

  Insertion point in HTML: `#bulk-add-modal .modal-body` (index.html:1130-1142). Place the new
  selector row directly above the existing `.bulk-voice-row` (index.html:1132) so it reads as
  a bulk-add-wide setting before the input surface. Use `class="form-label"` + `<select
  class="form-control">` to match the existing `.bulk-expiry-row` pattern (index.html:1137-1140).

acceptance:
  - [ ] index.html: a new row is inserted inside `#bulk-add-modal .modal-body`, immediately
        before the existing `<div class="bulk-voice-row">` (line ~1132), containing:
        - a `<label class="form-label">Storage <span style="font-weight:400;color:var(--text-secondary)">(optional — applies to all items)</span></label>`
        - a `<select id="bulk-add-default-storage" class="form-control" style="max-width:12rem">`
          with exactly these four options in this order:
          `<option value="">Auto (infer per item)</option>`
          `<option value="counter">Counter</option>`
          `<option value="fridge">Fridge</option>`
          `<option value="freezer">Freezer</option>`
  - [ ] app.js: `openBulkAddModal()` (near app.js:7550) resets the selector to `''` (Auto) each
        time the modal opens — same shape as the existing `bulk-add-expiry` reset at app.js:7557-7558.
  - [ ] app.js `confirmBulkAdd()` (app.js:7568): read the selector's value once at the top; when
        non-empty, use it as the item's `storage` field instead of calling `inferStorage(name,
        category)` — the existing `const storage = inferStorage(name, category);` at app.js:7612
        becomes `const storage = defaultStorage || inferStorage(name, category);` (where
        `defaultStorage` is the trimmed selector value).
  - [ ] No change to the existing bulk-add flow when the selector is left at "Auto" (empty
        string) — every item still calls `inferStorage()` per-item exactly as today.
  - [ ] No change to the existing shared-expiry field, textarea parsing, or warnings logic.

constraints:
  - Do not change `inferStorage()` itself
  - Do not add a per-line storage override in the textarea (that would be its own BQ)
  - Do not modify the `#custom-item-modal` where-selector or any other pantry-add path
  - Match existing style: global function, no framework, `document.getElementById(...)` reads
  - If any storage-option value in the app model is different from the three listed above,
    raise a blocker rather than adding new values

test steps:
  - [ ] Open the pantry, hit **Bulk Add**; confirm the new "Storage" row appears above the
        Speak/Textarea rows and defaults to "Auto (infer per item)"
  - [ ] Leave the selector at "Auto" and add 3 items (`Coconut cream 200ml`, `Chicken thigh 500g`,
        `Garlic`); confirm each lands in the storage `inferStorage()` would have picked (unchanged
        from before)
  - [ ] Set the selector to "Fridge" and add 3 counter-typical items (e.g. `Rice 1kg`,
        `Garlic 1 head`, `Sugar 500g`); confirm ALL three land in Fridge on the pantry view
  - [ ] Set the selector to "Freezer" and add 1 item; confirm it lands in Freezer
  - [ ] Close and reopen the modal; confirm the selector resets to "Auto (infer per item)"
  - [ ] Run `npx playwright test`; confirm no regressions (this task adds one field; existing
        tests should still pass without change)

---

<!-- ═══════════════════════════════════════════════════════
     BQ-021 · Cook confirmation: optional serving multiplier
     ═══════════════════════════════════════════════════════ -->

### TASK-007 · Add portion multiplier to cook confirmation + scale pantry deduction
status: blocked
blocker:
  - auto: build stopped -- TASK-007 build reached REVIEW (1 of 5 tracked task(s)) after 851s, pushed to task-007. -> auto-review: TASK-007 review FAILED: claude -p exited with code 1. See claude-session.log.
owner: codex
source: BQ-021
priority: P2
depends-on: none
files: app.js

context:
  `markRecipeCooked()` (app.js:7314) → `_doMarkCooked()` (app.js:7271) always deducts 1× the
  recipe's ingredient amounts via `deductIngredientsForRecipe(recipe)` (app.js:7203). Cook
  history stores `servings: recipe.currentServings` (app.js:7277). PROP-027 asks for a portion
  multiplier so cooking 2× a 4-serving recipe deducts 2× the base ingredients, and the cook-
  history entry reflects 8 servings, not 4.

  Add a single number-input prompt to the existing cook flow. It should appear BEFORE the
  missing-ingredients check so the check can also scale (otherwise cooking at 3× against a
  1× pantry passes the check silently and takes pantry qty negative).

  New signatures:
    - `deductIngredientsForRecipe(recipe, multiplier = 1)` — scale `scaledQty *= multiplier`
      inside the ingredient loop at app.js:7211
    - `checkMissingIngredients(recipe, multiplier = 1)` — same scale (app.js:7234)
    - `_doMarkCooked(recipe, btn, multiplier = 1)` — record `servings: recipe.currentServings *
      multiplier` in cookHistory (app.js:7277); pass `multiplier` through to `deductIngredients-
      ForRecipe`
    - `markRecipeCooked(recipeId, btn)` — before anything, open a portion-prompt dialog

  Portion-prompt UX (reuse `showConfirmDialog` at app.js:7252 — its `bodyHtml` allows arbitrary
  HTML including an input):
    - Title: "How many portions cooked?"
    - Body: recipe base servings hint + `<input id="cook-portion-multiplier" type="number"
      min="0.25" step="0.25" value="1" class="form-control" style="max-width:6rem">` + label
      "× the recipe" (so 1 = base recipe, 2 = double batch)
    - Confirm label: "Continue"
    - On confirm: read the input value; parse `var m = parseFloat(el.value)`; fall back to 1 if
      NaN, <=0, or missing; then run the existing missing-check-then-cook flow with `multiplier
      = m`

acceptance:
  - [ ] `markRecipeCooked()` first shows the portion-multiplier dialog described above; on
        confirm, reads the input; falls back to `1` on empty/NaN/<=0
  - [ ] The dialog's `bodyHtml` includes the input with `id="cook-portion-multiplier"`, the
        exact attribute set above, and a short hint line showing the recipe's current base:
        e.g. `<p style="margin:0 0 0.5rem">Base recipe: <strong>${recipe.currentServings}
        servings</strong></p>`
  - [ ] After the multiplier is captured, the existing missing-check runs with
        `checkMissingIngredients(recipe, multiplier)`; if `missing.length > 0`, the existing
        "Not enough ingredients?" confirm dialog appears exactly as today (no other UX change)
  - [ ] `_doMarkCooked(recipe, btn, multiplier)` records `servings: recipe.currentServings *
        multiplier` in cookHistory (round to 2 decimals if fractional)
  - [ ] `deductIngredientsForRecipe(recipe, multiplier)` scales `scaledQty` by `multiplier`
        before the `toGrams(scaledQty, ing.unit)` line at app.js:7213; NO other math changes
        (unit conversion, gramsPerPantryUnit, out-of-stock detection stay identical)
  - [ ] `checkMissingIngredients(recipe, multiplier)` applies the same scaling
  - [ ] Existing callers of these three functions that don't pass a multiplier get identical
        behavior (default parameter = 1)
  - [ ] The success toast at app.js:7305-7309 gains a "(×N)" suffix when `multiplier !== 1`,
        e.g. `Added "Adobo" (×2) to 🧊 My Fridge.` — otherwise unchanged
  - [ ] No change to `cookedMeals` (fridge/freezer entry stays 1 batch — multiplier only affects
        deduction accuracy and cook history counts)

constraints:
  - Do not add a stepper widget or extra buttons — a single number input is the whole UX
  - Do not introduce new global state; multiplier is passed through function args
  - Do not change the `.slot-cooked-btn` markup at app.js:2637
  - Do not change how `checkAndReplenishLowStock()` runs — it doesn't take a recipe
  - If the reuse of `showConfirmDialog` for the portion prompt turns out to need a different
    return shape (e.g. can't hold a form input in `bodyHtml`), raise a blocker rather than
    inventing a new dialog primitive — verify by reading app.js:7252-7269 first

test steps:
  - [ ] Cook a recipe at default multiplier (1); confirm the toast reads exactly as today (no
        "×1" suffix) and pantry deductions match today's values
  - [ ] Cook the same recipe at 2×; confirm pantry deductions are exactly double, toast reads
        `(×2)`, and cookHistory records `servings = currentServings * 2`
  - [ ] Cook at 0.5×; confirm deductions halve, toast reads `(×0.5)`
  - [ ] Enter empty/invalid multiplier; confirm falls back to 1× silently (no error toast)
  - [ ] Cook a recipe when pantry lacks enough for 3× the ingredients; confirm the
        "Not enough ingredients?" dialog appears with a scaled missing list, and cooking anyway
        still works (existing behavior)
  - [ ] Run `npx playwright test`; confirm no regressions

---

<!-- ═══════════════════════════════════════════════════════
     BQ-019 · Bulk add: per-item expiry date in the line format
     ═══════════════════════════════════════════════════════ -->

### TASK-008 · Add inline `exp:YYYY-MM-DD` per-line expiry keyword to bulk-add parser
status: codex
owner: codex
source: BQ-019
priority: P2
depends-on: none
files: index.html, app.js

context:
  PROP-025 flags three format ambiguities: (A) append date to line, (B) separate column, (C)
  inline `exp:` keyword; and (D) shared vs per-line conflict rules. **Defended default for this
  task: inline `exp:YYYY-MM-DD` keyword, and per-line wins over the shared expiry field.**
  Rationale: keyword syntax doesn't collide with the existing two parser paths (`Name, Qty, Unit`
  and no-comma `Name qty unit` — see NO_COMMA_RE at app.js:7581), is discoverable from the
  placeholder, and doesn't require a new column that would break the current textarea format.

  Parser change is minimal: strip the `\bexp:(\d{4}-\d{2}-\d{2})\b` capture from each line
  BEFORE the current comma/no-comma parsing, remember the captured date, and use it as the
  item's `expiryDate` (with `dateMode: 'expiry'`) — falling back to the shared
  `bulkExpiry` if no per-line date matched.

  Currently the shared date is applied at app.js:7623-7624:
    `expiryDate: bulkExpiry || null,`
    `dateMode: bulkExpiry ? 'expiry' : undefined`
  Replace with `perLineExpiry || bulkExpiry` in both.

acceptance:
  - [ ] `confirmBulkAdd()` (app.js:7568): for each line, before the existing `parts.split(',')`
        at app.js:7584, extract any inline `exp:YYYY-MM-DD` token via regex
        `/\bexp:(\d{4}-\d{2}-\d{2})\b/i` — capture the date into `perLineExpiry`, then strip the
        matched substring (and any adjacent extra whitespace) from `line` before further parsing
  - [ ] Regex is strict about the date shape: only ISO-8601 `YYYY-MM-DD`; malformed dates
        (e.g. `exp:2026-13-45`) are validated with the standard `!isNaN(new Date(dateStr +
        'T00:00:00').getTime())` check — invalid dates push a warning `Line N: "..." — invalid
        exp date, ignored` and fall through to `bulkExpiry`
  - [ ] The item written to `AppState.pantry` uses `perLineExpiry || bulkExpiry` as
        `expiryDate` and sets `dateMode: (perLineExpiry || bulkExpiry) ? 'expiry' : undefined`
  - [ ] The placeholder in `#bulk-add-textarea` (index.html:1136) gains one example showing
        the inline syntax, e.g. `Chicken Thigh 500g exp:2026-07-20` — insert it as the third
        line of the placeholder string
  - [ ] The hint line above the textarea (index.html:1131) gains one short trailing sentence
        after "or just `Garlic`":
        `<br>Add <code>exp:YYYY-MM-DD</code> anywhere in a line to set that item's expiry
        (overrides the shared date below).`
  - [ ] Existing lines with no `exp:` token behave identically to today (fall back to shared
        `bulkExpiry`); existing shared-date-only flows produce identical pantry writes
  - [ ] No change to warnings surface, closeBulkAddModal behavior, or storage inference (that
        is TASK-006's scope)

constraints:
  - Regex must be word-bounded — `\bexp:` — so it can appear at the start, middle, or end of a
    line without breaking multi-token names (e.g. `Chicken exp: 2026-07-20` with a space after
    the colon MUST be treated as no match — force the date to abut the colon)
  - Do not add a new date-parsing library
  - Do not change the comma/no-comma parser structure — only pre-process the line to strip
    `exp:DATE` before it hits the existing `parts` split
  - Do not accept alternate keyword forms (`expires:`, `exp=`, etc.) — the token is exactly
    `exp:YYYY-MM-DD`, case-insensitive on the `exp` prefix
  - If Codex, on reading the current parser, judges the inline-keyword approach hurts the
    current no-comma pattern (e.g. `NO_COMMA_RE`'s greedy name capture can accidentally include
    the keyword), raise a blocker before shipping rather than introducing a fragile fix

test steps:
  - [ ] Bulk-add three lines with no `exp:` token and no shared date: pantry entries have
        `expiryDate: null`, `dateMode: undefined` (unchanged)
  - [ ] Bulk-add with shared date = `2026-08-01`, all three lines lacking `exp:`: all three
        get `expiryDate: '2026-08-01'`, `dateMode: 'expiry'` (unchanged)
  - [ ] Bulk-add with shared date = `2026-08-01`, one line = `Milk 1L exp:2026-07-15`: that
        line gets `2026-07-15`, the others get `2026-08-01`
  - [ ] Bulk-add with `Chicken thigh 500g exp:2026-13-45` (invalid date): warning surfaces
        `Line 1: "..." — invalid exp date, ignored`; item still added with `expiryDate` = shared
        date (or null)
  - [ ] Bulk-add with `Chicken exp: 2026-07-20` (space after colon): the `exp:` is NOT parsed
        as a date (name captured as `Chicken exp: 2026-07-20` unchanged)
  - [ ] Run `npx playwright test`; confirm no regressions

---

<!-- ═══════════════════════════════════════════════════════
     BQ-020 · Recipe card: compact header + always-expanded detail
     ═══════════════════════════════════════════════════════ -->

### TASK-009 · Compact recipe-card-header CSS pass
status: codex
owner: codex
source: BQ-020
priority: P3
depends-on: none
files: style.css

context:
  PROP-026 has two sub-asks: (A) compact header, (B) "always-expanded detail". (B) is
  ambiguous in the proposal itself ("Confirm interpretation at build") and is TASK-010's
  scope. This task ships (A) only — a pure CSS tightening of the `.recipe-card-header`
  block (style.css:1185-1205), its title, and its category chip. No HTML/JS changes.

  Current header footprint (style.css:1185-1205):
    - `.recipe-card-header` → margin-bottom: `var(--space-12)` (12px)
    - `.recipe-title`        → `var(--font-size-xl)` (~20px), `--font-weight-semibold`
    - `.recipe-category`     → padding `var(--space-4) var(--space-8)`, `--font-size-xs`

acceptance:
  - [ ] `.recipe-card-header` `margin-bottom` reduced from `var(--space-12)` to
        `var(--space-8)` (12→8px)
  - [ ] `.recipe-title` `font-size` reduced from `var(--font-size-xl)` to
        `var(--font-size-lg)` (one step down in the type scale); `line-height: 1.25` added
  - [ ] `.recipe-category` `padding` reduced from `var(--space-4) var(--space-8)` to
        `var(--space-2) var(--space-6)` (or the nearest existing token) to shrink the chip
        vertically without losing readability
  - [ ] No other rule in `.recipe-card-header` block is changed; no HTML changes; no JS changes;
        no changes outside style.css:1185-1205
  - [ ] All existing tokens used above (`--space-8`, `--space-6`, `--space-2`, `--font-size-lg`)
        already exist in style.css — verify by grep before editing; if any is missing, raise a
        blocker rather than defining new tokens (that would be a design-system decision)

constraints:
  - Do not touch the `.recipe-photo`, `.serving-controls`, or `.prep-time-info` blocks below
    the header — those are TASK-010's scope if the "always-expanded detail" interpretation
    lands
  - Do not add media queries — the compact treatment applies at all breakpoints
  - Do not modify `.recipe-fav-btn` (visually anchors the header; changes here risk misalignment)

test steps:
  - [ ] Open the Recipes tab; visually compare the header row on 3-4 cards before/after —
        the title should read one step smaller, the category chip one step slimmer, and the
        gap under the header row visibly tighter, without truncation or clipping
  - [ ] Confirm the ♥ favorite button remains flush-right and centered against the tightened
        title/category row
  - [ ] Confirm both photo and photo-placeholder cards render correctly (no reflow overlap)
  - [ ] Run `npx playwright test`; confirm no regressions

---

### TASK-010 · Design clarification: what does "always-expanded detail view" mean?
status: codex
owner: codex
source: BQ-020
priority: P3
depends-on: TASK-009
files: (none — this task produces a written spec, not code)

context:
  PROP-026 explicitly flags: `"always open" = expand on list render, or just default to
  expanded when tapping? If the former, the entire recipe list would be a wall of text —
  almost certainly not what the user means.` The proposal itself asks to "Confirm
  interpretation at build."

  Three plausible interpretations, each shipping to a different codebase surface:

  1. **Auto-expand `.recipe-details` inline on card render** — flip `.recipe-details hidden`
     off in `renderRecipes()` at app.js:2538. **Cost:** ingredient/step blocks always show →
     recipe grid becomes multi-screen-tall wall of text. **Almost certainly not what the user
     wants** per PROP-026 itself.

  2. **Persist per-recipe expanded state** — remember which cards a user has expanded across
     sessions (localStorage `expandedRecipes: string[]`), re-expand them on load. **Cost:**
     new AppState key, save/load path, low-value polish.

  3. **When the edit modal opens, land on the ingredients section by default** — the recipe
     card's `onclick` opens the edit modal (app.js:2437); change the modal's default tab/scroll
     state to show ingredients first. **Cost:** a `renderRecipeModal()` tweak. **Most likely
     what the user means** given the "detail view" phrasing.

acceptance:
  - [ ] This task is opened by Codex, who reads the three interpretations above, picks the one
        that matches its reading of PROP-026's captures/context, and sets `status: blocked` with
        a single-line question written under `blocker:` for Claude to answer:
        `blocker: Need human pick from A/B/C above before implementing; Codex recommends: <A|B|C>
        because <one-line why>.` NO CODE is written.
  - [ ] TASK-010 does not change any file. Its output is the recorded blocker line.

constraints:
  - Do not implement any of the three options — this task is a decision gate, not a build
  - Do not delete or rewrite this task; only append the `blocker:` line

test steps:
  - [ ] (none — no code)

---

<!-- ═══════════════════════════════════════════════════════
     BQ-022 · Long-press to enter bulk multi-select mode
     ═══════════════════════════════════════════════════════ -->

### TASK-011 · Design clarification: long-press bulk multi-select scope + desktop fallback
status: codex
owner: codex
source: BQ-022
priority: P3
depends-on: none
files: (none — this task produces a written spec, not code)

context:
  PROP-028 flags three ambiguities that must be resolved before build:
    1. Scope — pantry only, or grocery list too? (The proposal says the user asked for both.)
    2. Move-target UI — a storage-location picker (counter/fridge/freezer) or a full location
       modal? Grocery-list "move" doesn't have an equivalent destination.
    3. Desktop fallback — long-press is touch-only; desktop needs multi-click or a "select"
       toggle button.

  This is a P3 power-user feature; the safest autonomous act is to record the ambiguity and
  block on human clarification rather than pick a default that could ship the wrong feature.

acceptance:
  - [ ] Codex reads this task, then sets `status: blocked` with a single-line question written
        under `blocker:` for Claude to answer:
        `blocker: Need human pick on (a) scope (pantry only | pantry+grocery), (b) move-target
        UI for pantry (dropdown | modal), (c) desktop fallback (multi-click | select-mode
        button); Codex recommends: <one-line default per question>.` NO CODE is written.
  - [ ] TASK-011 does not change any file. Its output is the recorded blocker line.

constraints:
  - Do not implement any part of the feature — this is a decision gate
  - Do not delete or rewrite this task; only append the `blocker:` line

test steps:
  - [ ] (none — no code)

---

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
