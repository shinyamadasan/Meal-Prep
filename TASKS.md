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
status: done
blocker:
  - RESOLVED 2026-07-08 — the block was a crashed auto-review (`claude -p` exit 1), not a code/design issue. Branch task-007 (d8acde3) went ~12 commits stale behind D-028/029/030; the isolated feature was re-applied onto current main via `git apply --3way` (branch NOT merged), reviewed → APPROVED. See REVIEW.md / CHANGELOG.md / TEST_REPORT.md.
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
status: done
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
status: done
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

### TASK-010 · Recipe card: show ingredients by default, instructions behind a toggle
status: done
owner: codex
source: BQ-020 (PROP-026)
priority: P3
depends-on: TASK-009

decision (human, 2026-07-08):
  Resolved the "always-expanded detail" ambiguity → interpretation C, "Open → Ingredients first":
  the recipe's Ingredients should be visible at a glance WITHOUT turning the grid into a wall of
  text. Concretely: show the Ingredients list expanded by default on each card; keep the longer
  Instructions collapsed behind a toggle. Interpretation A (auto-expand everything) was rejected;
  B (persisted expand state) was rejected.

files: app.js, style.css

context:
  In `renderRecipes()` (app.js ~2572) each card has ONE collapsible block:
    `<button class="recipe-details-toggle" onclick="toggleRecipeDetails(event)">Ingredients & steps ▾</button>`
    `<div class="recipe-details hidden">` [serving scaler] [.recipe-ingredients] [instructions <p>] `</div>`
  Ingredients already render before Instructions inside `.recipe-details`. There is no separate
  "detail view / modal tabs" — the edit modal (`openEditRecipeModal`) is a plain form, out of scope.

acceptance:
  - [ ] The serving scaler + `.recipe-ingredients` list render VISIBLE by default on every card
        (not inside a hidden container).
  - [ ] The Instructions (`<p><strong>Instructions:</strong> …</p>`) render COLLAPSED by default,
        behind a toggle button (e.g. "Instructions ▾") — reuse the `toggleRecipeDetails` pattern or a
        small variant; `aria-expanded` updates on toggle.
  - [ ] Tapping the instructions toggle expands/collapses only the instructions.
  - [ ] The serving +/- scaler still scales the shown ingredient quantities (`adjustDetailServings`).
  - [ ] With instructions collapsed a card is ≈ header + ingredient list only (no wall of text).
  - [ ] Only the recipe-card markup/CSS changes; other tabs unaffected.

constraints:
  - Minimal: reuse the existing toggle + CSS patterns; NO new AppState, NO persisted expand state.
  - Do not auto-expand instructions (interpretation A is rejected).
  - Match existing card style; light-only; no second `:root` block.

test steps:
  - [ ] `node --check app.js`; recipe grid shows ingredients inline, instructions collapsed.
  - [ ] Toggle instructions on a card → expands; scaler still adjusts ingredient amounts.
  - [ ] `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js` — 0 broken.

---

<!-- ═══════════════════════════════════════════════════════
     BQ-022 · Long-press to enter bulk multi-select mode
     ═══════════════════════════════════════════════════════ -->

### TASK-011 · Pantry bulk multi-select: Select mode → bulk delete + bulk move
status: done
owner: codex
source: BQ-022 (PROP-028)
priority: P3
depends-on: none

decision (human, 2026-07-08):
  Resolved PROP-028's three ambiguities → BUILD MINIMAL:
    (a) scope: PANTRY ONLY (skip the grocery list).
    (b) enter selection: a "Select" toggle button — NOT long-press — so it works on touch AND desktop.
    (c) bulk actions: bulk DELETE + bulk MOVE (storage picker: counter / fridge / freezer).

files: app.js, index.html, style.css

context:
  Pantry renders via `buildPantryItem()` inside `renderPantry()` (app.js ~6759). Each item is
  `.pi-item` > `.pi-row` (`onclick="togglePantryExpand(...)"`) + `.pi-expand`. Move uses
  `setPantryStorage(id, storage)` (already stamps `updatedAt`); storage options come from the `WHERE`
  array (counter/fridge/freezer). A per-item delete already exists in the item's expand controls —
  reuse its handler for the delete mechanics.

acceptance:
  - [ ] A "Select" toggle button in the pantry tab header (near the search / add controls) enters and
        exits selection mode.
  - [ ] In selection mode each `.pi-item` shows a checkbox; tapping a row toggles its checkbox and does
        NOT expand the item. Leaving selection mode restores normal tap-to-expand.
  - [ ] A bulk action bar shows the selected count + "Move to…" (storage picker: counter/fridge/freezer)
        + "Delete" + a way to cancel/exit. It is hidden when not in selection mode or nothing is selected.
  - [ ] Bulk MOVE sets storage on every selected item (reuse `setPantryStorage` per id), re-renders, exits.
  - [ ] Bulk DELETE removes every selected pantry item, re-renders, and exits selection mode.
  - [ ] Works with mouse (desktop) and touch — no long-press anywhere.
  - [ ] The grocery list is NOT touched (out of scope).

constraints:
  - CRITICAL: bulk DELETE must tombstone each removed id EXPLICITLY (`AppState.deletions[String(id)] =
    new Date().toISOString()`) BEFORE `saveData()`, exactly like `clearLocalStorage()` (app.js ~479).
    Reason: `recordLocalDeletions()`'s `MASS_DELETE_GUARD` (D-029) ignores a batch of >5 simultaneous
    disappearances, so a 6+ item bulk delete would otherwise NOT propagate to other devices. Do not
    rely on the baseline-diff to tombstone bulk deletions.
  - Selection state is transient: a mode flag + a Set of selected ids. NO persisted AppState, NO new
    saved fields.
  - Reuse existing helpers (`setPantryStorage`, the per-item delete path, `saveData`, `renderPantry`);
    match existing pantry CSS; light-only; no second `:root` block.
  - Do not change single-item tap-to-expand behavior outside selection mode.

test steps:
  - [ ] `node --check app.js`; enter Select mode → checkboxes appear, rows don't expand.
  - [ ] Select 3 → Move to Fridge → all three show fridge; Select 2 → Delete → both gone.
  - [ ] Bulk-delete 6+ items, then reload → they stay deleted (verifies the explicit-tombstone
        workaround for the D-029 guard). Flag human/emulator-verified if not automatable.
  - [ ] `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js` — 0 broken.

---

<!-- ═══════════════════════════════════════════════════════
     review-2026-07-08 · Data-integrity review follow-ups
     Risk: Medium · Execution: NOT chained (build + review each solo)
     ═══════════════════════════════════════════════════════ -->

### TASK-012 · Fix stale `reportError()` comment (Loader Script → SDK)
status: done
source: review-2026-07-08
depends-on: none
priority: P3
files: app.js

context:
  `reportError()`'s doc comment says the Sentry SDK is "loaded via the Sentry Loader Script in
  index.html". That was true briefly, but the hosted Loader Script no-op'd and was replaced with a
  direct DSN + SDK bundle (`Sentry.init({ dsn })`) in `index.html` (commit 14a7cbd, see DECISIONS
  D-030's Sentry half). The comment is now inaccurate. Comment-only fix.

acceptance:
  - [ ] The comment on `reportError()` no longer references "Loader Script".
  - [ ] It accurately states the SDK is loaded + initialized (DSN) in `index.html`.
  - [ ] NO behavior change — only the comment lines are touched.

constraints:
  - Comment-only. Do not touch `reportError()`'s body or any other code.

test steps:
  - [ ] `node --check app.js` passes.
  - [ ] `grep -n "Loader Script" app.js` returns nothing.

---

### TASK-013 · Stamp imported items with `updatedAt` so a surviving tombstone can't delete them
status: done
source: review-2026-07-08
depends-on: none
priority: P2
files: app.js

context:
  `importData()` (app.js — the `showConfirmDialog('Import data?'...)` confirm callback) unions the
  imported file into `AppState` and clears tombstones for imported ids (D-019). But imported JSON
  items usually have NO `updatedAt`. `applyTombstones()` does `if (!it.updatedAt) return false` — an
  item with no timestamp LOSES to any tombstone. So if a tombstone for an imported id survives (e.g.
  it still exists on another device that hasn't synced the clear yet), the freshly-imported item is
  deleted on the next merge. Stamping imported items with `updatedAt = now` makes them win the LWW
  (`it.updatedAt > tombAt`) against any older tombstone — the same durability `stampUpdated()` gives
  inventory edits (D-028). This is additive hardening on top of D-019's clear + D-031's full-overwrite
  write; it does NOT replace either. See DECISIONS D-019, D-020, D-028, D-031.

acceptance:
  - [ ] After the `unionById(...)` merges in the import confirm callback, every item whose id is
        present in the imported file has `updatedAt` set to the import time (one ISO string), across
        `recipes, pantry, customIngredients, customHacks, userIngredients, cookedMeals, groceryList`
        (the same key set D-019's tombstone-clear loop uses).
  - [ ] Items NOT in the import file keep their existing `updatedAt` unchanged.
  - [ ] The stamp is applied BEFORE `var savePromise = saveData();` so it persists to localStorage +
        Firestore in the same save.
  - [ ] Trace: a previously-deleted item (tombstone time T in the past) re-imported now has
        `updatedAt > T`, so `applyTombstones()` keeps it (does not fall into the `!it.updatedAt` or
        `updatedAt <= tombAt` delete branches).
  - [ ] Existing import behavior is otherwise unchanged (existing-wins-on-collision union, D-019
        tombstone-clear, backup, render calls, awaited save + success toast).

constraints:
  - Reuse the existing `stampUpdated(item)` helper (or an inline `new Date().toISOString()`); do not
    add a new helper.
  - Do NOT change `unionById` argument order (existing item wins a true duplicate — D-003 / import
    semantics stay intact).
  - Do NOT modify the D-019 tombstone-clear block or the write path; this task is purely additive.
  - app.js only. Data-integrity surface — build solo, do not chain.

test steps:
  - [ ] `node --check app.js` passes.
  - [ ] `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js` — 0 broken.
  - [ ] Manual/emulator (flag as human-verified if not automatable): import a file containing an id
        that currently carries a tombstone → item appears AND still there after a reload + ~2 min.

---

<!-- ═══════════════════════════════════════════════════════
     gap-2026-07-14 · /go idle-triage gap (found live, via chat)
     Risk: High · Execution: NOT chained (automation/OS surface — Hard Rule 10 / D-023)
     ═══════════════════════════════════════════════════════ -->

### TASK-014 · Fix `/go` idle-triage gap: Invoke-Autopilot never triggers Triage for untriaged captures
status: done
review: Codex correctly implemented and tested this fix on branch `task-014` (commit 37f58b9), but
  its own commit-scope guard permanently blocks it from committing anything under `tools/` (deny-
  listed as "this repo's own automation scripts") — so it could never land this itself. Claude
  verified the diff against every acceptance criterion, verified the CHANGELOG.md/TEST_REPORT.md
  evidence (isolated `/go -DryRun` fixture reproduced the exact TRIAGED-message scenario), and
  completed the commit. Held at `approved` rather than `done` per D-032 (automation/OS surface) —
  note this means the same session both completed and reviewed this change; there was no
  independent second set of eyes for this one. Land with `/merge TASK-014` then `/merge TASK-014
  yes` when ready.
source: human-reported gap (2026-07-14 conversation) — the intended behavior is already documented at DECISIONS.md D-035, code just doesn't implement it
priority: P1
depends-on: none
files: tools/Dispatch-Commands.ps1

context:
  DECISIONS.md D-035 ("An idle `/go` triages instead of dead-ending") says `/go`'s planning phase
  should fire when there is EITHER approved work to convert OR new captures to triage. The shipped
  `Invoke-Autopilot` only implements the first half:

    if (-not (Get-TaskTable | Where-Object { $_.Status -eq 'codex' }) -and (Get-UnconvertedBQCount) -gt 0) {

  There is no check for untriaged files in `captures/inbox/`. Today, sending `/go` with a fresh,
  untriaged capture and nothing else build-ready silently replies "Nothing to do -- no approved
  work is build-ready." instead of triaging it and reporting the resulting PROP number — exactly
  the dead-end D-035 was written to close. Confirmed live by reading the current script; D-035's
  own text warns about this exact failure mode elsewhere ("documentation that describes machinery
  nobody built is not aspiration; it is a false claim").

acceptance:
  - [ ] Add a way to detect untriaged captures — e.g. a `Get-UntriagedCaptureCount` helper counting
        `*.md` files in `captures/inbox/` with frontmatter `status: new` (mirror
        `Get-UnconvertedBQCount`'s shape and style).
  - [ ] Widen the "Plan once" trigger in `Invoke-Autopilot` to also fire when untriaged captures
        exist: `-not (codex-status task exists) -and ((Get-UnconvertedBQCount) -gt 0 -or
        (Get-UntriagedCaptureCount) -gt 0)`.
  - [ ] When planning ran ONLY because of untriaged captures (no unconverted BUILD_QUEUE items) and
        still leaves nothing build-ready, the summary must say so plainly and name the next action —
        e.g. "TRIAGED n new idea(s) into proposals. Reply Approve <n>, then /go." (matching D-035's
        own described summary text) — instead of falling into the generic "Nothing to do" branch.
  - [ ] No change to `/run`, `/build`, `/review`, `/merge`, `/status`, `/next`, `/stop`, `/enable`,
        `/disable` behavior.
  - [ ] No change to the "build exactly one task" loop, dependency handling, or auto-merge logic in
        `Invoke-Autopilot` — only the planning trigger condition and the idle-triage-only summary.

constraints:
  - Automation/OS-surface change (Hard Rule 10 / D-023): build solo, never chained, regardless of
    what any group header elsewhere says.
  - Red-zone surface (D-032: "the AI Dev OS / automation itself") — review should land this at
    `status: approved` (held for human merge via `/merge`), never auto-merge to `done`, no matter
    how clean the diff looks.
  - Do not touch `Apply-Decisions.ps1` or its ordering relative to Triage inside `run-claude.ps1` —
    that decisions-before-triage sequencing is intentional; this task only changes whether `/go`
    decides to invoke planning at all, not what planning does once invoked.
  - Do not add a new scheduled task, dispatcher, or polling mechanism — reuse the existing
    `Invoke-RunPhase` call already used for the BUILD_QUEUE case.

test steps:
  - [ ] `-DryRun`: with a fresh `captures/inbox/*.md` (status: new) and nothing else build-ready,
        confirm the dry-run path reports it would run planning instead of "nothing to do".
  - [ ] Live: with one fresh test capture and nothing else queued, send `/go`; confirm the reply
        shows a new PROP number was created and reads like the D-035 example, not "Nothing to do".
  - [ ] Regression: confirm today's only supported case (BUILD_QUEUE already has an unconverted
        approved item) still triggers planning and builds identically to before.
  - [ ] Confirm `/run`, `/build`, `/review` are byte-for-byte unchanged in behavior.

---

<!-- ═══════════════════════════════════════════════════════
     gap-2026-07-15/16 · less-babysitting redesign: auto-promote (D-042) + /audit (D-043)
     Risk: High · Execution: NOT chained (automation/OS surface — Hard Rule 10 / D-023)
     ═══════════════════════════════════════════════════════ -->

### TASK-016 · Auto-promote (D-042) + redesigned `/audit` (D-043) — supersedes TASK-015
status: done
review: Claude implemented directly (same `tools/` reasoning as TASK-014/017/018 — Codex cannot
  commit here). Held at `approved` for human `/merge`, not auto-merged, same disclosed same-session
  build+review caveat as every other automation-surface item tonight. Landed on branch `task-016`
  (commit a8bbf60), pushed. Land with `/merge TASK-016` then `/merge TASK-016 yes` when ready.
source: human request (2026-07-15/16 conversation) — "I want less role as much as possible," followed
  by a full redesign discussion (musing-vs-commitment risk, D-032 scope mismatch, audit token cost,
  summary drift) before landing on this shape. Supersedes the original **TASK-015 (`/suggest`)** plan
  entirely — `/suggest`'s whole job (recommend the best pending item) stops being needed once nothing
  routine sits pending waiting for a reply; TASK-015 is retired, not built.
priority: P1
depends-on: none
files: planning/PROPOSALS.md, PROMPTS.md, run-claude.ps1, tools/Invoke-AutoPromote.ps1 (new),
  planning/AUDIT_SUMMARY.md (new), tools/Run-Audit.ps1 (new), tools/Dispatch-Commands.ps1,
  n8n-telegram-inbox.json

context:
  **D-042 (auto-promote):** every proposal now leads with TWO fields, not one — the existing
  `▶ Decision` (Approve/Park/Reject/Clarify) plus a new `▶ Risk` (Low/High, the exact reversible-
  vs-red-zone criteria D-032 already uses at merge time, applied here at idea time instead).
  `Decision: Approve` + `Risk: Low` auto-promotes straight to `BUILD_QUEUE.md` — no human reply
  needed. Everything else (any other Decision, `Risk: High`, or no Risk field at all — e.g. an old
  proposal from before this existed) is completely untouched and still waits for a human reply,
  exactly as before. Deterministic, no LLM judgment at the promotion step itself — Triage only ever
  recommends; `tools/Invoke-AutoPromote.ps1` (mirroring `Apply-Decisions.ps1`'s own shape) is the
  mechanical act, run from `run-claude.ps1` between Phase 2 (Claude's Triage session) and Phase 2b
  (the commit-scope guard) so its edits land in the same allowed-surface check and commit.

  **D-043 (`/audit` redesign):** `/audit` is on-demand only — never scheduled, never polled. It
  triggers two ways: (1) a human sends `/audit` directly; (2) `/go`'s autopilot falls back to it
  automatically, but ONLY when genuinely nothing else is queued (no `status: codex` task, nothing
  unconverted in `BUILD_QUEUE.md`) — the same "no idea, just find something and build it" case the
  human described wanting. Cost-gated two ways: a cheap `git diff <last-audited-commit>..HEAD --
  app.js index.html style.css` runs BEFORE any LLM call — an empty diff means "nothing changed,
  nothing new to look for," reported and exited with ZERO tokens spent, however many times `/go` is
  pressed with nothing changing (the human's stated brain-fog-week worry). A non-empty diff (or a
  stale/missing summary) triggers a real Claude session, but handed only the diff + the persisted
  `planning/AUDIT_SUMMARY.md` notes, never the whole app again — except a full re-scan every 30 days
  flat (one rule, not a count-or-time combo), so the incrementally-maintained summary's drift can't
  compound indefinitely uncorrected. Findings flow through the exact same Proposal contract (and
  therefore the exact same D-042 auto-promote gate) as a human capture — `Run-Audit.ps1` calls
  `Invoke-AutoPromote.ps1` itself right after writing findings, so a Low-risk finding is immediately
  queue-ready, and the SAME `/go` press that triggered the audit can also plan-convert and build it —
  "find AND build," not "find, then wait for another press."

acceptance:
  - [x] `planning/PROPOSALS.md`'s Proposal contract gains the `▶ Risk` field; header explains the
        auto-promote behavior.
  - [x] `PROMPTS.md` P9 and `run-claude.ps1`'s STEP A prompt both require Risk on every proposal.
  - [x] `tools/Invoke-AutoPromote.ps1`: scans every `status: pending` proposal; auto-promotes only
        `Decision: Approve` + `Risk: Low`; leaves everything else (other Decision, Risk: High, no
        Risk field, already-decided) completely untouched. No LLM call.
  - [x] Wired into `run-claude.ps1` between Phase 2 and Phase 2b.
  - [x] `planning/AUDIT_SUMMARY.md` scaffold: `last-audited-commit` / `last-full-refresh` state lines
        (script-owned) + prose sections (Claude-owned).
  - [x] `tools/Run-Audit.ps1`: Preflight (repo/git/branch/clean-tree), git-diff gate before any LLM
        call, 30-day flat full-refresh rule, capped at 5 new findings, commit-scope guard (only
        `PROPOSALS.md`/`AUDIT_SUMMARY.md` from the LLM session), calls `Invoke-AutoPromote.ps1`
        itself afterward, self-contained commit + push (same style as `Run-Merge.ps1`).
  - [x] `/audit` wired into `Dispatch-Commands.ps1`'s switch, gated behind `$AUTOMATION_ENABLED`
        (mutates the repo, same treatment as `/run`/`/build`/`/review`/`/go`).
  - [x] `n8n-telegram-inbox.json`'s command regex + comment updated to recognize `audit` — learned
        from `/merge` silently mis-routing as an unrecognized capture for a full day after D-036
        shipped it; would have hit `/audit` too if left unfixed.
  - [x] `Invoke-Autopilot`'s idle path: triggers the audit only when truly nothing is queued; if the
        audit auto-promotes something, immediately runs Plan (`Invoke-RunPhase`) so the build loop
        below can still pick it up in the same `/go` press; summary reports the audit's own result
        when nothing else happened.

constraints:
  - Automation/OS-surface (Hard Rule 10 / D-023): solo, never chained.
  - `/audit` never edits `app.js`/`index.html`/`style.css` — read-only against the app, exactly like
    Triage is read-only against captures.
  - No new scheduled task, cron, or polling loop for `/audit` — on-demand only, per the human's
    explicit ask.
  - Auto-promote never applies to a proposal missing the Risk field (safe default: treat as needing
    a human reply, never guess risk retroactively for old proposals).

test steps:
  - [x] `Invoke-AutoPromote.ps1` verified in isolation against a 5-proposal fixture: Approve+Low
        promoted; Approve+High untouched; Approve+no-Risk-field untouched; Park+Low untouched;
        already-decided untouched. `build:`/`priority:` fields in the resulting `BUILD_QUEUE.md`
        block verified correct after fixing two regex mismatches found during this same testing.
  - [x] `Run-Audit.ps1`'s mode-decision logic (fresh scaffold / recently-refreshed / stale /
        exactly-at-the-30-day-boundary) verified in isolation against fixture summary text — all
        four cases resolved correctly.
  - [x] All changed `.ps1` files parse clean (`[System.Management.Automation.Language.Parser]::
        ParseFile`); `n8n-telegram-inbox.json` re-validated as well-formed JSON after the raw-text
        regex edit.
  - [ ] Live (human-verified, next real idle `/go` or manual `/audit`): confirm a real audit run
        produces a sensible finding, auto-promotes correctly, and the summary/state file updates as
        expected.

---

<!-- ═══════════════════════════════════════════════════════
     gap-2026-07-15 · overnight run notifies on failure instead of failing silently (D-039)
     Risk: High · Execution: NOT chained (automation/OS surface — Hard Rule 10 / D-023)
     ═══════════════════════════════════════════════════════ -->

### TASK-017 · Add Send-Notification: push a Telegram notice on any Preflight abort or mid-run halt
status: approved
review: Same reasoning as TASK-014 (D-040) — this touches `run-claude.ps1` directly, which Codex's
  commit-scope guard would also permanently block, so Claude wrote it directly rather than queuing
  a doomed Codex build. Verified in isolation (a scratch outbox file, no git/repo involved): empty
  outbox, second-entry accumulation with the `---` separator, and the `No pending replies.`
  placeholder all format correctly; the full script parser-checks clean. Held at `approved` rather
  than `done` per D-032 — same session wrote and reviewed this, no independent second set of eyes.
  Land with `/merge TASK-017` then `/merge TASK-017 yes` when ready.
source: human request (2026-07-15 conversation) — "how would we know that something is ongoing" /
        "why do we keep having problems" led to: failures should push a notification, not sit silent
priority: P1
depends-on: none
files: run-claude.ps1

context:
  `Abort-Preflight` and `Halt-Automation` in `run-claude.ps1` previously only wrote to
  `claude-session.log` (and, for halts, `STATUS.md`) — there was no Telegram notification path at
  all, since this scheduled-task script has no Telegram command/reply of its own to attach one to.
  That silence is exactly what let the overnight run abort on a dirty working tree for at least
  three consecutive runs (2026-07-14 02:00/21:00, 2026-07-15 02:00) before a human noticed — and it
  was only noticed because `planning/DIGEST.md` sat on 2026-07-05 content for ten days. See D-039.

acceptance:
  - [x] New `Send-Notification` function: appends an entry to `captures/replies/OUTBOX.md` using the
        exact same format `Dispatch-Commands.ps1`'s `Write-Reply` already uses (`## <id>` header,
        timestamp, blank line, text; `---`-separated when the outbox already has real content;
        correctly treats the `No pending replies.` placeholder as empty).
  - [x] Only attempts `git add`/`commit`/`push` of that one file when already on a clean `main`
        (checked via `git branch --show-current`) — never tries to switch branches to deliver a
        notification, matching Preflight's own no-auto-remediation stance.
  - [x] Wrapped in try/catch so notification delivery can never itself fail the abort/halt path.
  - [x] Called from both `Abort-Preflight` (exit 2) and `Halt-Automation` (exit 1), with a concise,
        actionable message (Reason + Required action, or Reason + "investigate before next run").
  - [x] `STATUS.md`'s halt-entry wording updated to stop claiming "nothing... was notified this run"
        now that it is.

constraints:
  - Automation/OS-surface change (Hard Rule 10 / D-023): build solo, never chained.
  - Red-zone surface (D-032) — held at `approved`, never auto-merged.
  - No new n8n workflow, no new scheduled task — reuses the existing `n8n-telegram-replies.json`
    relay (~2 min poll) and the existing `captures/replies/OUTBOX.md` outbox exactly as-is.

test steps:
  - [x] Isolated scratch-file test (no git): write to empty/nonexistent outbox, append a second entry
        (confirms `---` separator + accumulation), and confirm the placeholder is treated as empty —
        all three passed.
  - [x] `[System.Management.Automation.Language.Parser]::ParseFile` on the full script: no syntax
        errors.
  - [ ] Live (human-verified, next real Preflight abort or halt): confirm a Telegram message actually
        arrives via the existing relay.

---

<!-- ═══════════════════════════════════════════════════════
     gap-2026-07-15 · /merge crash + silent -DryRun failure (D-041)
     Risk: High · Execution: NOT chained (automation/OS surface — Hard Rule 10 / D-023)
     ═══════════════════════════════════════════════════════ -->

### TASK-018 · Fix array-splat parameter binding in Invoke-MergePhase/BuildPhase/ReviewPhase
status: done
review: Landed directly on `main` (bootstrapping exception, see below), not held at `approved` —
  this is the one case tonight that could NOT be held for `/merge`. `/merge` was the thing
  broken, so there was no way to use it to land its own fix. Verified directly against the real
  target scripts before landing: `/merge TASK-014` (summary) and `/merge TASK-014 yes` (Confirm,
  forced `-DryRun` for safety) both bound correctly and produced expected output; `Run-Codex-Build.ps1
  -DryRun` and `Run-Claude-Review.ps1 -DryRun` via the fixed pattern also bound correctly. Landed with
  explicit human authorization for this specific bootstrapping step (2026-07-15 conversation), not a
  general precedent for skipping the hold-for-`/merge` gate.
source: found live while testing `/merge TASK-014` for real (2026-07-15 conversation)
priority: P0
depends-on: none
files: tools/Dispatch-Commands.ps1

context:
  `Invoke-MergePhase`, `Invoke-BuildPhase`, and `Invoke-ReviewPhase` all built an array and splatted
  it (`$a = @('-TaskId', $taskId); ... @a`), assuming array splatting binds `-Name value` pairs the
  way hashtable splatting does. It doesn't — PowerShell array splatting is purely positional.
  Confirmed empirically (plain function, builtin cmdlet, script files, switch-only and mandatory-
  positional targets): every case silently or loudly mis-bound. For `/merge`: `'-TaskId'` itself got
  bound to `Run-Merge.ps1`'s mandatory `$TaskId`, leaving the real task id nowhere to go — crashed
  the whole dispatcher every time, so `/merge` has never worked over Telegram since D-036 shipped it
  the day before. For `/build`/`/review`: no crash, but `-DryRun` silently never activated at all.
  See DECISIONS.md D-041.

acceptance:
  - [x] `Invoke-MergePhase`: `$a` is now a hashtable (`@{ TaskId = $taskId }`, `Confirm`/`DryRun` keys
        added conditionally), splatted the same way.
  - [x] `Invoke-BuildPhase`/`Invoke-ReviewPhase`: same hashtable-splat conversion for `-DryRun`.
  - [x] No change to any other function or command's behavior.

constraints:
  - Automation/OS-surface change (Hard Rule 10 / D-023): solo, never chained.
  - Bootstrapping exception to D-032/D-040's hold-for-`/merge` pattern — see review note above. Not
    a precedent; every other automation-surface change still gets held.

test steps:
  - [x] `[System.Management.Automation.Language.Parser]::ParseFile`: no syntax errors.
  - [x] Real `Run-Merge.ps1` invocation via the fixed pattern, summary mode: correct output, exit 0.
  - [x] Real `Run-Merge.ps1` invocation via the fixed pattern, Confirm + forced `-DryRun`: correct
        "[DRY RUN] would run the auto-merge gates..." output, exit 0.
  - [x] Real `Run-Codex-Build.ps1 -DryRun` / `Run-Claude-Review.ps1 -DryRun` via the fixed pattern:
        both responded sensibly (no crash) — build correctly reported the actual dirty-tree state at
        the time, review correctly reported nothing pending.
  - [ ] Live (human-verified): a real `/merge TASK-014` from Telegram now returns the summary instead
        of crashing.

---

### TASK-019 · `/merge` auto-rebases the branch when its own dispatch commit stales it
status: done
review: Claude implemented directly (tools/, same D-040 reasoning as TASK-014/016/017/018 — Codex
  cannot commit here). Held at `approved` for human `/merge`, not auto-merged — this is the merge
  gate itself, squarely automation-surface/Hard-Rule territory. Verified the two new code paths
  (clean auto-rebase, conflicting auto-rebase) in an isolated scratch git repo before landing, since
  a bug in this exact file is unusually expensive to discover. The branch will need one manual
  `git rebase main` + force-push immediately before this specific `/merge` lands, same as any other
  held task caught by the bug this fixes — the fix cannot retroactively apply to its own first
  landing.
source: found live while repeatedly retrying `/merge TASK-014 yes` / `/merge TASK-016 yes`
  (2026-07-16 conversation)
priority: P0
depends-on: none
files: tools/Run-Merge.ps1

context:
  Both TASK-014 and TASK-016 blocked over and over with "MERGE BLOCKED: main is not an ancestor of
  task-X (it moved on). Rebase the branch, then /merge again" — even seconds after being freshly
  rebased onto main by hand. Root cause, confirmed by reading `claude-session.log` and the exact
  commit sequence on `main`: `Dispatch-Commands.ps1` commits an administrative "command received"
  marker to `main` immediately before dispatching to any handler (its own Preflight needs a clean
  tree, and the freshly-arrived command file is itself an uncommitted change). That marker commit
  advances `main` by exactly one commit every single time a `/merge` command is processed, so the
  ancestor check in `Run-Merge.ps1` was checking against a `main` that had *already* moved past
  whatever the branch was rebased onto, moments earlier, in the very same run. This is structural,
  not incidental — no `/merge` could ever succeed through the normal dispatch path for this reason
  alone, independent of the branch's real content. See DECISIONS.md D-044.

acceptance:
  - [x] `Run-Merge.ps1`: when the ancestor check fails, auto-rebase the branch onto `main`
        (`git rebase main`) before running `npm test`.
  - [x] Clean rebase: force-push the branch (`git push --force-with-lease origin <branch>`, never
        `main`) and continue the merge normally.
  - [x] Conflicting rebase: abort the rebase, check out `main`, block with a clear message asking a
        human to resolve it by hand — the auto-rebase only removes the self-inflicted case, it does
        not weaken the gate for a genuinely stale or conflicting branch.
  - [x] The pre-existing ancestor check right before the actual fast-forward is left in place as a
        final safety net (handles the rare case of something else landing on `main` during the
        `npm test` window).
  - [x] No change to any other gate (task must be `approved`, main/branch clean, npm test passes and
        leaves the tree clean, fast-forward only).

constraints:
  - Automation/OS-surface change (Hard Rule 10 / D-023): solo, never chained.
  - Never force-push `main` itself — only the task branch. This is the property every other
    decision in this file depends on (main is append-only, safe for any clone to pull).

test steps:
  - [x] `[System.Management.Automation.Language.Parser]::ParseFile`: no syntax errors.
  - [x] Isolated scratch repo, guaranteed-conflict scenario (both branches edit the same line):
        auto-rebase correctly detects the conflict (`$LASTEXITCODE -ne 0`), aborts, reports.
  - [x] Isolated scratch repo, conflict-free scenario (branches touch different files): auto-rebase
        completes cleanly (`$LASTEXITCODE -eq 0`), branch ends up correctly rebased onto main.
  - [x] Live (human-verified): landed (commit 6f7c471) after one more manual rebase (the fix cannot
        rescue its own first landing, as noted above) plus a human-authorized direct `Run-Merge.ps1
        -Confirm` invocation when a second self-inflicted staling recurred mid-Telegram-round-trip.

---

### TASK-020 · Fix Invoke-Git crashing on git's own stderr progress output in Run-Merge.ps1
status: done
owner: claude
source: found live the first real time TASK-019's auto-rebase step ran, processing `/merge TASK-014
  yes` (2026-07-16 conversation)
priority: P0
depends-on: TASK-019
files: tools/Run-Merge.ps1

context:
  The very first live run of D-044's auto-rebase step crashed the whole dispatcher instead of
  rebasing task-014. `Run-Merge.ps1` sets `$ErrorActionPreference = 'Stop'` at the top; under that
  setting, PowerShell promotes ANY stderr text from a native command into a terminating exception --
  even a fully successful `git rebase` printing its ordinary "Rebasing (1/1)" progress line, which
  git always writes to stderr by design. `Run-Merge.ps1`'s own `Invoke-Git` was a bare `git @args`
  passthrough with none of the EAP-lowering protection `Dispatch-Commands.ps1`'s sibling helper
  already had (see that file's own `Invoke-Git`, lines 86-91) -- every OTHER git call in this file
  had simply never happened to write anything to stderr, so the gap stayed invisible until `git
  rebase` (which always does) finally exercised it. Confirmed the actual `git rebase` had succeeded
  before the script died (`git merge-base --is-ancestor main task-014` was true afterward) -- this
  was purely a PowerShell error-handling bug, not a git or logic bug. See DECISIONS.md D-044 addendum.

acceptance:
  - [x] `Invoke-Git` lowers `$ErrorActionPreference` to `'Continue'` for the duration of each git
        call (restored in a `finally`), matching `Dispatch-Commands.ps1`'s pattern.
  - [x] Does not swallow stderr at the source -- callers that want it (the auto-rebase conflict
        message) can still capture it via their own `2>&1`.
  - [x] No change to any other gate or behavior.

constraints:
  - Automation/OS-surface change (Hard Rule 10 / D-023): solo, never chained.
  - Bootstrapping exception to D-032/D-040's hold-for-`/merge` pattern, same as TASK-018 -- `/merge`
    was the thing broken, so there was no way to use it to land its own fix. Not a precedent.

test steps:
  - [x] `[System.Management.Automation.Language.Parser]::ParseFile`: no syntax errors.
  - [x] Isolated scratch repo, reproducing the EXACT `$ErrorActionPreference = 'Stop'` context (the
        gap in D-044's own first verification, which had NOT reproduced this): conflict-free rebase
        now completes without crashing (`LASTEXITCODE -eq 0`, no exception).
  - [x] Same context, guaranteed-conflict scenario: still correctly detected (`LASTEXITCODE -ne 0`),
        no crash, conflict path reports as designed.
  - [x] Live: TASK-014's actual merge (the run that first crashed) completed successfully
        immediately after this fix landed (commit 976ad4d), fully automated, no manual rebase
        needed. TASK-016 landed the same way shortly after, confirming both fixes together.

---

### TASK-021 · Docs-vs-code consistency checker (tools/Check-DocsConsistency.ps1)
status: done
owner: claude
source: "ok lets do these" -- first of three follow-ups approved during the "less babysitting"
  philosophy discussion (2026-07-16 conversation), prioritized after the /merge blocker (TASK-019/020)
priority: P2
depends-on: none
files: tools/Check-DocsConsistency.ps1 (new), docs/ARCHITECTURE.md

context:
  Prose-encoded knowledge (CLAUDE.md, docs/DECISIONS.md, architecture docs) has no self-checking
  mechanism analogous to lint/type-checking for code, so it silently rots the same way tribal
  knowledge used to. First real run of this checker proved it isn't hypothetical: it found
  `docs/ARCHITECTURE.md` still describing `stripTagsDeep()` as an active safety measure, when that
  function (and the entire "shared recipes" import feature it protected) had been removed together
  in an earlier "remove dead code" commit. Not a live security hole -- the vulnerable import path is
  gone too -- but exactly the class of drift this tool exists to catch. See DECISIONS.md D-045.

acceptance:
  - [x] `tools/Check-DocsConsistency.ps1` extracts backtick-quoted identifiers from
        docs/ARCHITECTURE.md, docs/DATA_MODEL.md, docs/DECISIONS.md, and CLAUDE.md.
  - [x] Filters out wildcards, multi-word spans, file references, and D-NNN/TASK-NNN/BQ-NNN
        cross-references before checking.
  - [x] docs/ARCHITECTURE.md and docs/DATA_MODEL.md check against app.js/index.html/style.css only;
        docs/DECISIONS.md and CLAUDE.md additionally check against run-claude.ps1, AGENTS.md, and
        every tools/*.ps1, since those two docs cover the automation layer too.
  - [x] Reports each finding as `[doc] `span` -- 'identifier' not found in ...`; exits 1 if any found,
        0 if clean.
  - [x] The one real finding it surfaced (`stripTagsDeep()`) is fixed in docs/ARCHITECTURE.md.
  - [x] Standalone script only -- not wired into /audit or any Telegram command yet (D-045's
        deliberate scope limit).

constraints:
  - Automation/OS-surface change (Hard Rule 10 / D-023): solo, never chained.
  - No LLM call -- deterministic grep only, per CLAUDE.md's "if code can answer, code answers."
  - Held at `approved` for human `/merge`, not auto-merged, matching every other automation-surface
    task this session (D-040).

test steps:
  - [x] `[System.Management.Automation.Language.Parser]::ParseFile`: no syntax errors.
  - [x] Real run against the current repo: found 28 raw hits, reduced to 9 after the per-doc scope
        fix (the other ~19 were TASKS.md status vocabulary and automation-script identifiers now
        correctly resolved by the broadened scope). Manually reviewed all 9 remaining: 1 real
        (stripTagsDeep, fixed), rest are references to a separate ai-dev-os repo's config schema or
        one illustrative example in prose -- both acceptable per D-045's stated trade-off.
  - [ ] Live (human-verified): a real `/merge TASK-021 yes` lands it.

---

### TASK-022 · `DECISIONS.md` verify-pointer mechanism (tools/Verify-Decisions.ps1)
status: done
owner: claude
source: "ok lets do these" -- second of three follow-ups approved during the "less babysitting"
  philosophy discussion (2026-07-16 conversation)
priority: P2
depends-on: none
files: tools/Verify-Decisions.ps1 (new), docs/DECISIONS.md

context:
  D-045's docs-vs-code checker catches "this identifier doesn't exist anywhere anymore" for free, but
  some decisions are wrong in a way pure existence-checking can't see -- D-010's write guard is only
  actually honored if the guard clause is still in place, not just if the word `cloudReady` appears
  somewhere in the file. A decision record should be able to say, in one line, how a machine would
  confirm the guarantee it describes still holds. See DECISIONS.md D-046.

acceptance:
  - [x] `docs/DECISIONS.md` entries may carry `Verify: <file> contains "<text>"` or
        `Verify: <file> does not contain "<text>"` lines -- literal substring only, no regex, no
        shell execution, no `eval` (a decision record's check must stay as inspectable as its prose).
  - [x] `tools/Verify-Decisions.ps1` parses every `Verify:` line across the file, runs each one,
        reports any that fail, exits 1 if any fail / 0 if all pass or none exist.
  - [x] Three real pointers added as first working examples: D-003 (both write paths present),
        D-005 (`patchMissingNutrition(` exists), D-010 (`AppState.cloudReady` referenced).
  - [x] The file's own header documents the convention for future entries.
  - [x] Optional and additive -- not retrofitted onto all ~45 existing entries (Simplicity First).

constraints:
  - Automation/OS-surface change (Hard Rule 10 / D-023): solo, never chained.
  - No LLM call, no arbitrary code execution -- literal substring match only.
  - Held at `approved` for human `/merge`, not auto-merged, matching every other automation-surface
    task this session (D-040).

test steps:
  - [x] `[System.Management.Automation.Language.Parser]::ParseFile`: no syntax errors.
  - [x] Baseline (no Verify: lines): correctly reports "No Verify: pointers found."
  - [x] All 3 real pointers (4 total lines): correctly report pass.
  - [x] Temporarily broke one pointer (pointed at a nonexistent function name): correctly detected
        and reported the failure with the exact reason; restored and re-confirmed all pass.
  - [ ] Live (human-verified): a real `/merge TASK-022 yes` lands it.

---

### TASK-023 · Proactive pass: document undocumented Claude/Codex operating constraints
status: done
owner: claude
source: "ok lets do these" -- third of three follow-ups approved during the "less babysitting"
  philosophy discussion (2026-07-16 conversation)
priority: P3
depends-on: none
files: CLAUDE.md, docs/DECISIONS.md, docs/AI_OS_NOTES.md, planning/ROADMAP.md

context:
  A proactive review for constraints this session actually tripped over but that weren't recorded
  anywhere a future session would see them before hitting the same wall:
  - The TASKS.md-must-land-on-main-directly rule (D-040 addendum) cost ~15 minutes to diagnose the
    first time (TASK-019) because it was only implicit in how prior tasks happened to be committed,
    never stated as a rule.
  - The PowerShell EAP=Stop / native-stderr gotcha had already bitten Dispatch-Commands.ps1 once
    (fixed, with a good inline comment) and then bit Run-Merge.ps1 again (TASK-020) because the
    inline-comment fix was never promoted to CLAUDE.md's Tooling Gotchas, the one place a future
    session reads before touching either file.
  - The OUTBOX.md race between the PC dispatcher and n8n's reply-clearing step recurred five times
    this session with no stable record beyond a transient STATUS.md session-log entry.
  - `planning/ROADMAP.md`'s Known Issues still listed `printGroceryList()` as "defined, no button
    wired" -- stale since this session's earlier e2e-suite fix restored the button.

acceptance:
  - [x] CLAUDE.md's Tooling Gotchas gained three entries: the EAP/stderr promotion rule, the
        TASKS.md-goes-to-main rule, and the Start-ScheduledTask unreliability workaround.
  - [x] DECISIONS.md D-040 gained an addendum stating the commit-split rule explicitly.
  - [x] docs/AI_OS_NOTES.md (previously empty) gained three dated friction-log entries: the OUTBOX
        race, the Start-ScheduledTask unreliability, and the TASKS.md-to-main rule.
  - [x] planning/ROADMAP.md's stale `printGroceryList()` line removed.
  - [x] Pure documentation, no executable code touched -- committed directly to main, no branch/hold
        (unlike TASK-021/022, which ship actual tools/*.ps1 scripts with real execution risk).

constraints:
  - Docs-only; Claude's own ownership of CLAUDE.md/docs//planning/ per this file's own Claude
    Workflow section covers this directly, no /merge gate needed.

test steps:
  - [x] Re-read each edited file after writing to confirm no structural markdown breakage.
  - [x] Cross-checked the OUTBOX-race and TASKS-to-main claims against this session's actual git
        history before writing them down, rather than relying on memory of what happened.

---

### TASK-024 · Fix the OUTBOX.md / command-file push race at the root (retry, don't drop)
status: done
owner: claude
source: docs/AI_OS_NOTES.md's 2026-07-16 OUTBOX-race entry, fixed same-day at the user's request
  ("so why doont we fix it now")
priority: P1
depends-on: none
files: tools/Dispatch-Commands.ps1

context:
  Dispatch-Commands.ps1's two per-command commit+push sites (the "received" status marker on
  captures/commands/*.md, and the reply append to OUTBOX.md) never checked whether the push actually
  succeeded. n8n's independent reply-clearing step polls and pushes to the same OUTBOX.md on its own
  schedule, uncoordinated with this script -- when the two land close together, the dispatcher's push
  is silently rejected and the commit sits orphaned locally, later surfacing as a confusing rebase
  conflict on an unrelated branch. Hit five times in one session, each requiring manual diagnosis.
  See DECISIONS.md D-047.

acceptance:
  - [x] New shared `Invoke-CommitPushWithRetry` helper: on push rejection, fetch + reset --hard to
        origin's fresh tip, re-run a `Reapply` scriptblock that re-derives the change from in-scope
        values (never the stale file), retry -- up to 5 attempts with a short increasing backoff.
  - [x] Applied to both commit sites (the "received" marker and the OUTBOX.md reply).
  - [x] The reply site's pre-existing `Write-Reply` call (unconditional, before the DryRun-gated
        block) is NOT duplicated by the reapply block on the first attempt -- only re-invoked on an
        actual retry after a reset.
  - [x] No change to any other command's behavior.

constraints:
  - Automation/OS-surface change (Hard Rule 10 / D-023): solo, never chained.
  - The reset --hard is only ever applied to a commit this same script just created and never pushed
    -- never to a commit that reached origin or that any other actor could have seen.
  - Held at `approved` for human `/merge`, not auto-merged, matching every other automation-surface
    task this session (D-040).

test steps:
  - [x] `[System.Management.Automation.Language.Parser]::ParseFile`: no syntax errors.
  - [x] Real simulated race in an isolated sandbox: bare "origin" repo + two clones ("dispatcher" and
        "n8n"). Dispatcher stages a change against a stale base; n8n commits and pushes a conflicting
        change first; dispatcher's retry function correctly rejects on attempt 1, fetches/resets/
        reapplies, and succeeds on attempt 2 -- final origin content correct, no orphaned commits.
  - [ ] Live (human-verified): a real `/merge TASK-024 yes` lands it, and no further OUTBOX-race
        friction recurs across subsequent /merge cycles.

<!-- ═══════════════════════════════════════════════════════
     BQ-023 · Recipe paste: parse nutrition block + stop instructions at Nutrition header
     ═══════════════════════════════════════════════════════ -->

### TASK-025 · Recipe paste: parse nutrition block and stop instructions at Nutrition header
status: done
review: Codex's rework-retry (a24cdbc) flipped status to review without applying either must-fix
  security patch from the prior review (app.js was byte-identical); the follow-up auto-review then
  crashed (exit 1), leaving this stuck at blocked in a shape the auto-release logic doesn't match.
  Claude applied both patches directly (RECOGNIZED key whitelist + value clamp), verified with a
  9-case regression harness plus smoke/button-smoke, and re-applied the isolated app.js hunk onto
  main via `git apply --3way` (branch task-025 left unmerged, ~30+ commits stale). See REVIEW.md.
owner: codex
source: BQ-023
priority: P2
depends-on: none
files: app.js

context:
  `parseRecipeText()` (app.js) currently captures everything after the `Instructions:` section
  into the recipe's `instructions` field — it never stops at a `Nutrition` header, so the
  published nutrition block from structured recipe sites (panlasangpinoy, AllRecipes, etc.) is
  appended into `instructions` verbatim (pre-existing bug, confirmed PROP-030). The Recipe model
  already stores `nutritionPerServing` (calories, carbs, protein, fat, fiber, sodium) but the
  parser doesn't populate it — macros are estimated from `LOCAL_NUTRITION_DB` /
  `patchMissingNutrition()` instead, even when the pasted page supplies exact per-serving values.

  Typical nutrition line format (`|`-delimited, from PROP-030 example):
    Calories: 284kcal | Carbohydrates: 15g | Protein: 14g | Fat: 20g | Saturated Fat: 4g |
    Cholesterol: 31mg | Sodium: 793mg | Potassium: 1242mg | Fiber: 5g | Sugar: 6g | …
  Some sites use newline-separated `Key: value` lines instead — handle both.
  Extra micros (saturated fat, cholesterol, potassium, sugar, vitamins, calcium, iron) are
  silently dropped; the 6-field `nutritionPerServing` model is NOT extended.

acceptance:
  - [ ] `parseRecipeText()` stops appending to `instructions` when a line matches
        `/^(nutrition(al(\s+info(rmation)?)?)?|notes):?\s*$/i` (case-insensitive standalone
        header line) — no other change to how ingredients, servings, prep/cook time are parsed
  - [ ] After the Nutrition stop-point, the parser scans remaining lines for a nutrition block:
        (a) a single `|`-delimited `Key: value | Key: value …` line, or
        (b) consecutive `Key: value` lines (newline-per-nutrient format)
  - [ ] Parsed values mapped to `nutritionPerServing`: `Calories` → `calories` (strip `kcal`/`cal`),
        `Carbohydrates`/`Carbs` → `carbs` (strip `g`), `Protein` → `protein` (strip `g`),
        `Fat` (not Saturated Fat) → `fat` (strip `g`), `Fiber` → `fiber` (strip `g`),
        `Sodium` → `sodium` (strip `mg`). Keys are case-insensitive; a `Fat` match must not
        accidentally capture `Saturated Fat`.
  - [ ] When at least `calories` is parsed, set all six `nutritionPerServing` fields from the
        block (nutrients not found default to `0`).
  - [ ] When the pasted text has NO `Nutrition` header, the parser leaves `nutritionPerServing`
        unmodified — the existing `patchMissingNutrition()` estimation still runs as today.
  - [ ] No change to the paste-recipe modal UI, the post-parse save flow, or any code path
        other than `parseRecipeText()` itself.
  - [ ] `node --check app.js` passes.

constraints:
  - Do not add a parsing library — regex and string splits only.
  - Do not change the `nutritionPerServing` model shape or add new Recipe fields.
  - Do not modify `patchMissingNutrition()` or `LOCAL_NUTRITION_DB`.
  - If on reading `parseRecipeText()` the stop-point cannot be added cleanly, raise a blocker
    rather than restructuring the whole parser.

test steps:
  - [ ] Paste the PROP-030 example (Ginisang Pechay): confirm `instructions` contains none of
        `Calories / Carbohydrates / Protein / Sodium` and `nutritionPerServing` =
        `{calories:284, carbs:15, protein:14, fat:20, fiber:5, sodium:793}`
  - [ ] Paste a recipe with no `Nutrition` header: confirm `instructions` is unchanged from
        today and `nutritionPerServing` is still estimated (not zeroed out)
  - [ ] Paste a recipe with a newline-per-nutrient nutrition block: confirm parsing works
  - [ ] Run `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js` — 0 broken

---

<!-- ═══════════════════════════════════════════════════════
     BQ-024 · Pantry: one-tap "Clear expired" action
     ═══════════════════════════════════════════════════════ -->

### TASK-026 · Add "Clear expired" button to pantry header (bulk-delete all expired items)
status: codex
owner: codex
source: BQ-024
priority: P2
depends-on: none
files: app.js, index.html

context:
  Users can mark pantry items with `expiryDate` (card expand, or `exp:DATE` from TASK-008) but
  there is no fast path to remove all expired items at once — only one-by-one card delete.
  TASK-011 established the mandatory explicit-tombstone pattern for bulk deletes: set
  `AppState.deletions[String(id)] = new Date().toISOString()` for EVERY deleted id BEFORE
  calling `saveData()`, bypassing `recordLocalDeletions()`'s MASS_DELETE_GUARD (D-029, which
  ignores batches > 5 simultaneous disappearances). This task reuses that exact pattern.

  Expired = `item.expiryDate` is truthy AND `new Date(item.expiryDate) < todayMidnight`
  where `todayMidnight = new Date(new Date().toDateString())`.

acceptance:
  - [ ] A "Clear expired" button appears in the pantry section header near the existing
        Select/search controls — rendered ONLY when at least one item in `AppState.pantry`
        is expired (per the definition above); hidden otherwise
  - [ ] Clicking "Clear expired" opens a confirm dialog: "Remove N expired item(s) from your
        pantry?" where N = count of expired items. Use the existing `showConfirmDialog()`.
  - [ ] On confirm: for each expired item, set
        `AppState.deletions[String(item.id)] = new Date().toISOString()`, then remove it from
        `AppState.pantry`, then call `saveData()` once and `renderPantry()` — all tombstones
        set BEFORE the single save call.
  - [ ] Items with no `expiryDate` or `expiryDate >= today` are untouched.
  - [ ] After deletion, the button is hidden if no expired items remain.
  - [ ] TASK-011 "Select" mode state is unaffected (exits cleanly if "Clear expired" is used
        while Select is active).
  - [ ] `node --check app.js` passes.

constraints:
  - CRITICAL: explicit tombstone per item BEFORE `saveData()` — do NOT rely on
    `recordLocalDeletions()`'s diff to capture bulk deletes (D-029 guard blocks batches > 5).
  - Do not change the single-item delete path or the Select-mode bulk delete from TASK-011.
  - Match existing pantry header control style; minimize CSS additions.
  - If any Prep Mode recipe-step state references `AppState.pantry` items by id, raise a
    blocker rather than silently clearing them from under an active session.

test steps:
  - [ ] Add 3 pantry items: 1 expired (yesterday), 1 expiring tomorrow, 1 no expiry.
        Confirm "Clear expired" button is visible.
  - [ ] Click "Clear expired"; dialog shows "Remove 1 expired item(s)…"; confirm → only the
        yesterday item disappears; the other two remain.
  - [ ] Reload; confirm the deleted item is gone and the other two persist.
  - [ ] With only non-expiring items, confirm "Clear expired" is hidden.
  - [ ] Bulk-delete 6+ expired items; reload; confirm all stay deleted (tombstone test).
        Flag as human-verified if not automatable.
  - [ ] Run `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js` — 0 broken.

---

<!-- ═══════════════════════════════════════════════════════
     BQ-025 · Bulk add voice: auto-newline each recognized item
     ═══════════════════════════════════════════════════════ -->

### TASK-027 · Bulk add voice: auto-insert newline after each recognized item (no manual Enter)
status: codex
owner: codex
source: BQ-025
priority: P2
depends-on: none
files: app.js

context:
  PROP-033: current voice bulk-add requires the user to press Enter between each spoken
  ingredient, making the flow a tap-type hybrid instead of truly hands-free. The fix is to
  auto-append a newline after each FINAL speech recognition result so the next spoken item
  lands on its own line automatically.

  Before writing code: trace the voice-add flow. Find the `SpeechRecognition` handler
  (likely near `openBulkAddVoice()` / `#bulk-add-textarea`). Confirm whether each `result`
  event appends to the textarea or replaces it, and whether interim vs final results are
  handled separately. If the implementation cannot be extended cleanly, raise a blocker.

acceptance:
  - [ ] After each FINAL `SpeechRecognition` result is appended to `#bulk-add-textarea`,
        a newline (`\n`) is automatically inserted — the user does NOT need to press Enter
        or tap between items
  - [ ] Speaking two items in sequence ("Chicken thigh 500g" then pause then "Garlic 3 cloves")
        produces two separate lines in the textarea with no manual input
  - [ ] Each appended item is trimmed of leading/trailing whitespace before the newline is added
  - [ ] Interim (in-progress) recognition results are NOT auto-newlined; only the FINAL result
        for each utterance gets the trailing newline
  - [ ] Manual typing between voice entries still works; the textarea remains editable
  - [ ] The existing Speak button toggle, mic icon state, and stop-voice flow are unchanged
  - [ ] `node --check app.js` passes.

constraints:
  - Do not add silence-detection or pause-length logic — the newline after a final result is
    sufficient; do not change `SpeechRecognition` config (language, interimResults setting, etc.)
  - Do not change `confirmBulkAdd()` parsing — it already handles one item per line
  - No HTML or CSS changes
  - If interim results are currently appended (not just shown), only the final result gets the
    auto-newline; interim content is replaced by the final result as today

test steps:
  - [ ] Open Bulk Add, tap Speak, say "Chicken thigh 500g" then pause; confirm a line appears
        and the cursor is on the next line automatically (no manual Enter)
  - [ ] Say "Garlic 3 cloves" next; confirm it appears as a second separate line
  - [ ] Submit the textarea as-is; confirm both items parse correctly into the pantry
  - [ ] Run `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js` — 0 broken

---

<!-- ═══════════════════════════════════════════════════════
     BQ-026 · Prep Mode: persist active session across browser close
     ═══════════════════════════════════════════════════════ -->

### TASK-028 · Persist Prep Mode active session to localStorage (survive browser close/reopen)
status: codex
owner: codex
source: BQ-026
priority: P2
depends-on: none
files: app.js

context:
  PROP-034: starting a Prep Mode work session and closing the browser reverts to the "Start
  Work" prompt on reopen — the active session state is not persisted. The fix must identify
  whether the relevant Prep Mode state already lives in `AppState` (and therefore in the
  existing `saveData()` path) or only in memory, then fix accordingly.

  Before writing code: trace `renderPrepMode()` to understand the exact shape of an "active"
  Prep Mode session — which recipes, current step index or equivalent. Determine whether this
  state is already in `AppState` (fix: read it back correctly in `renderPrepMode()`) or
  transient (fix: add it to AppState so `saveData()` captures it). The two approaches differ:
    (A) Already in AppState → `renderPrepMode()` isn't restoring it; fix the read path only.
    (B) Transient → add to AppState; persist via the existing `saveData()` call.
  If the state includes non-JSON-serializable values, raise a blocker first.

acceptance:
  - [ ] Starting a Prep Mode work session persists the active state so it survives a browser
        close (via approach A or B above, whichever the code trace indicates)
  - [ ] On app load / `renderPrepMode()` run, the active session is restored and the user sees
        their in-progress session rather than the "Start Work" prompt
  - [ ] Ending the session (existing end/stop action) clears the persisted state so the next
        open shows "Start Work"
  - [ ] If the persisted session references recipes since deleted, the restore degrades
        gracefully: falls back to "Start Work" or filters missing recipes — no crash
  - [ ] No change to Prep Mode UX beyond the restore behavior; no new UI elements
  - [ ] `node --check app.js` passes.

constraints:
  - Prefer approach A (minimal fix) if available; use approach B (add to AppState) only if
    the session state is genuinely transient.
  - If approach B introduces a new localStorage key, add a note in `CHANGELOG.md` flagging
    it for Claude to document in `docs/DATA_MODEL.md` at review.
  - Do not change how Prep Mode calculates or displays recipe steps.
  - Hard Rule 5: any new persist call must go through `saveData()`, not `saveToLocalStorage()`
    alone, so the signed-in user's cloud copy stays in sync.

test steps:
  - [ ] Start a Prep Mode session with 1–2 recipes; close the browser tab completely.
  - [ ] Reopen the app; confirm Prep Mode shows the in-progress session (not "Start Work").
  - [ ] End the session; close and reopen; confirm "Start Work" is shown (session cleared).
  - [ ] Delete one recipe that was in the last session; reopen; confirm no crash.
  - [ ] Run `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js` — 0 broken.

---

<!-- ═══════════════════════════════════════════════════════
     gap-2026-07-16/17 · symmetric builder/reviewer engine fallback on quota exhaustion (D-048)
     Risk: High · Execution: NOT chained (automation/OS surface — Hard Rule 10 / D-023)
     ═══════════════════════════════════════════════════════ -->

### TASK-029 · Codex↔Claude builder/reviewer fallback on quota exhaustion + self-healing (D-048)
status: done
review: Claude implemented directly (tools/, same D-040 reasoning as TASK-014/016/017/018/019/020/021/
  022/024 — Codex cannot commit there). Held at `approved` for human `/merge`, not auto-merged — same
  disclosed same-session build+review caveat as every other automation-surface item this session.
  Quota-detection regex verified in isolation against 11 representative pass/fail strings (11/11
  correct); builder-identity extraction regex verified against 5 representative commit-message strings
  (5/5 correct); both changed `.ps1` files parse clean via
  `[System.Management.Automation.Language.Parser]::ParseFile`. Land with `/merge TASK-029` then
  `/merge TASK-029 yes` when ready.
source: human question "if codex doesnt have enough tokens, then this workflow wont work?" followed by
  "can we make the builder claude also if codex runs out of tokens? what about self healing" and then
  "I also want this vice versa, if claude cant review... codex can take over" (2026-07-16/17
  conversation) — corrected mid-design after "so you are telling me claude can review and build its
  own, but codex cant do that?" exposed an inconsistent first draft (see D-048's Context)
priority: P1
depends-on: none
files: tools/Run-Codex-Build.ps1, tools/Run-Claude-Review.ps1, tools/CODEX_REVIEW_INSTRUCTIONS.md (new),
  AGENTS.md, docs/DECISIONS.md

context:
  Every prior run had exactly one engine wired per role — `codex exec` builds, Claude reviews — with
  no automatic recovery if that engine ran out of quota or was briefly unavailable; the task would
  simply sit blocked (build side) or the review would just fail (review side) until a human noticed.
  See DECISIONS.md D-048 for the full design history, including the self-review-inconsistency
  correction.

acceptance:
  - [x] `Run-Codex-Build.ps1`: builder invocation extracted into `Invoke-BuilderEngine` (parameterized
        by engine); `Test-QuotaExhaustionSignal` added; on a quota signal or missing-CLI failure (never
        a normal build failure), automatically retries the SAME task on the SAME branch with the other
        engine, discarding the failed attempt's partial changes first (`git reset --hard` + `git clean
        -fd`).
  - [x] Landing commit records builder identity (`"<id>: built via codex"` / `"built via claude
        (fallback after ...)"`) instead of a new `TASKS.md` field.
  - [x] Double-engine build failure (both tried, both quota-signal): tracked tasks marked `blocked`
        with an `auto:`-prefixed note, reusing `Invoke-Autopilot`'s existing rework-strike auto-release
        logic (capped at 3) rather than inventing a second retry mechanism.
  - [x] `Run-Claude-Review.ps1`: reviewer invocation made pluggable (`Invoke-ReviewerEngine`, mirroring
        the builder's pattern); same quota-signal detection and single fallback retry, discarding
        partial state first.
  - [x] `tools/CODEX_REVIEW_INSTRUCTIONS.md` (new): the Codex-as-reviewer contract — no `Task` tool, no
        Guardian Gauntlet, must say so explicitly in `REVIEW.md`, must never choose `status: done`
        (reuses the existing "gauntlet didn't run → `approved` at most" clause, no new verdict logic).
        Invoked via the short, parameterized `codex exec ... "Review TASK-<id>"`, mirroring the
        already-verified `"Continue"` contract rather than risking a large inline prompt argument.
  - [x] `AGENTS.md` documents `Review TASK-<id>` as an exceptional, wrapper-only invocation — explicit
        that a human should never type it directly, and that Codex must not fall back to normal
        `Continue` behavior mid-review.
  - [x] After any review (fallback or not), the runner checks via `git log` on the branch whether the
        same engine both built and reviewed the task and, if so, appends a plain, non-blocking
        self-review disclosure to the result.
  - [x] No change to any existing gate: commit-scope guards (build deny-list, review allow-list),
        verdict rules, risk-gated merge status selection, and auto-merge gates are all unchanged and
        engine-agnostic.

constraints:
  - Automation/OS-surface change (Hard Rule 10 / D-023): solo, never chained.
  - Red-zone surface (D-032: "the AI Dev OS / automation itself") — held at `approved`, never
    auto-merged.
  - Fallback triggers ONLY on a detected quota/capacity signal or a missing CLI — never on a normal
    task/review failure (an unmet acceptance criterion, a real bug, a REWORK verdict are not failures
    of the engine and must never trigger a silent second attempt with a different engine).
  - Self-review is never blocked or prevented — only disclosed. Same trade-off already accepted for
    Claude-only installs; D-048 requires naming it out loud whenever a fallback causes it, not
    forbidding it.

test steps:
  - [x] `[System.Management.Automation.Language.Parser]::ParseFile` on both changed `.ps1` files: no
        syntax errors.
  - [x] `Test-QuotaExhaustionSignal` tested in isolation against 11 representative strings (rate-limit,
        quota, 429, insufficient-quota, resource-exhausted, usage-limit phrasing vs. unrelated errors
        and empty/null input): 11/11 correct.
  - [x] Builder-identity extraction regex tested in isolation against 5 representative commit-message
        strings (plain build, fallback build, partial-progress-only, unrelated commit, review commit):
        5/5 correct, including correctly resolving the fallback case to the actual builder (`claude`)
        even though the commit message also mentions `codex` in its parenthetical.
  - [ ] Live (human-verified): a real quota-exhaustion or forced-unavailable scenario for each engine,
        in each role, confirms the fallback actually fires, lands correctly, and discloses both the
        fallback and any resulting self-review in the Telegram-relayed result.

---

<!-- ═══════════════════════════════════════════════════════
     gap-2026-07-17 · /merge's final push race silently destroyed a real merge (D-047 addendum)
     Risk: High · Execution: NOT chained (automation/OS surface — Hard Rule 10 / D-023)
     ═══════════════════════════════════════════════════════ -->

### TASK-030 · Retry Run-Merge.ps1's final push-to-main with rebase, not reset (D-047 addendum)
status: done
review: Claude implemented directly (tools/, same D-040 reasoning as every other automation-surface
  item this session — Codex cannot commit there). Held at `approved` for human `/merge`, not
  auto-merged. Verified against a real simulated version of the exact failure (bare origin + two
  clones; one pushes an unrelated commit first, the other holds the merge commit and runs the same
  retry-with-rebase loop): recovered on attempt 2, both commits survived to origin. File parses clean.
  Land with `/merge TASK-030` then `/merge TASK-030 yes` when ready.
source: found live while landing TASK-029 (2026-07-17) — the operator's own confirmed `/merge TASK-029
  yes` silently lost its merge to exactly the race D-047 was built to survive, one script over
priority: P0
depends-on: none
files: tools/Run-Merge.ps1, docs/DECISIONS.md

context:
  `Run-Merge.ps1`'s final `git push origin main` (after the ff-only merge + status-flip commit) had
  no retry at all. When it lost the race against an unrelated commit landing on origin first (n8n's
  reply-clearing step, or — as happened live — the dispatcher's OWN later OUTBOX-reply commit), it
  correctly reported failure and exited, leaving the merge sitting locally, unpushed. Control then
  returned to `Dispatch-Commands.ps1`, which wrote its Telegram reply via `Invoke-CommitPushWithRetry`
  (D-047) — THAT push also lost the same still-open race, so its retry did `git reset --hard
  origin/main`, silently discarding the still-unpushed merge underneath it. The operator's real,
  already-approved `/merge TASK-029 yes` was destroyed, and the Telegram message they received ("MERGED
  into local main, but PUSH FAILED, push it yourself") was stale by the time they read it — there was
  nothing left to push. Recovered by hand this time (task-029's content was independently safe on its
  own origin branch); this task closes the hole so the next `/merge` doesn't need the same manual
  recovery. See docs/DECISIONS.md D-047's addendum for the full sequence.

acceptance:
  - [x] `Run-Merge.ps1`'s final `push origin main` retries up to 5 times (matching D-047's convention)
        on rejection.
  - [x] Each retry fetches origin and rebases (never resets) onto the fresh tip before retrying — the
        merge/status-flip commits are real content, not a message that can be safely discarded and
        regenerated the way `Invoke-CommitPushWithRetry`'s own two call sites can.
  - [x] A genuine rebase conflict (rare — would mean something else touched the same lines) aborts the
        rebase and reports clearly, asking a human to resolve by hand; does not loop forever.
  - [x] `Invoke-CommitPushWithRetry` (D-047) itself is unchanged — its two existing call sites are
        still correctly scoped to freely-regenerable messages; the gap was `Run-Merge.ps1`'s
        unprotected push, not that function.
  - [x] docs/DECISIONS.md D-047 gains an addendum describing the failure and the fix.

constraints:
  - Automation/OS-surface change (Hard Rule 10 / D-023): solo, never chained.
  - Red-zone surface (D-032: "the AI Dev OS / automation itself") — held at `approved`, never
    auto-merged.
  - Never reset/discard the merge commits on conflict — rebase-or-report-and-stop only.

test steps:
  - [x] `[System.Management.Automation.Language.Parser]::ParseFile`: no syntax errors.
  - [x] Real simulated race (bare "origin" + two clones, "runner" holding the merge commit and "racer"
        pushing an unrelated commit first): runner's first push correctly rejected, fetch+rebase
        applied cleanly, second push succeeded; final origin history contains BOTH commits — the
        racer's, and the one the old reset-based path would have destroyed.
  - [ ] Live (human-verified): a future `/merge ... yes` that happens to race an OUTBOX-clearing cycle
        recovers automatically instead of needing manual `git push origin main` recovery.

---

<!-- ═══════════════════════════════════════════════════════
     gap-2026-07-17/18 · full push-to-main retry audit, six more sites found (D-047 addendum)
     Risk: High · Execution: NOT chained (automation/OS surface — Hard Rule 10 / D-023)
     ═══════════════════════════════════════════════════════ -->

### TASK-031 · Retry every remaining unprotected push-to-main site (D-047 addendum)
status: done
review: Claude implemented directly (tools/ + run-claude.ps1, same D-040 reasoning as every other
  automation-surface item this session — Codex cannot commit there). Held at `approved` for human
  `/merge`, not auto-merged. All six sites use the same rebase-based retry pattern already verified
  live for TASK-030 (`Run-Merge.ps1`); no new mechanism, just the same fix applied everywhere it was
  missing. All changed files parse clean.
  Land with `/merge TASK-031` then `/merge TASK-031 yes` when ready.
source: user asked "should we move to this already?" after the Level 2→3 AI-adoption discussion
  identified "audit every other push-to-main site" as the direct next step from TASK-030 (2026-07-17/18
  conversation) — confirmed to go ahead with all six, one by one
priority: P1
depends-on: none
files: tools/Run-Claude-Review.ps1, tools/Run-Audit.ps1, tools/Dispatch-Commands.ps1, run-claude.ps1,
  docs/DECISIONS.md

context:
  `grep -rn "push origin main" tools/*.ps1 run-claude.ps1` after TASK-030 landed found six more
  unretried push-to-main sites with the exact same shape as `Run-Merge.ps1`'s. Full detail (which
  site, how often each is actually hit, and the two independent bugs found in `Set-AutomationFlag`)
  is in docs/DECISIONS.md D-047's TASK-031 addendum — not duplicated here.

acceptance:
  - [x] `Run-Claude-Review.ps1`'s `Invoke-AutoMerge` (highest-traffic site — every reversible task's
        auto-merge) retries with rebase on push rejection, same 5-attempt convention as TASK-030.
  - [x] `Run-Audit.ps1`'s push retries the same way.
  - [x] `Dispatch-Commands.ps1`'s `Publish-TasksChange` retries; on exhausted failure or conflict,
        logs a warning to claude-session.log rather than staying silent (it has no return value any
        of its 5 callers check, so this is the minimal honest fix rather than widening its contract).
  - [x] `Dispatch-Commands.ps1`'s `Set-AutomationFlag` retries; ALSO no longer unconditionally
        reports "Automation enabled/disabled" when the push actually failed — a second, independent
        bug found in the same pass.
  - [x] `run-claude.ps1`'s three sites (Apply-Decisions commit, plan-conversion commit, digest
        refresh) share one local `Push-MainWithRetry` helper (single file, unlike the other sites
        which duplicate per this repo's convention) and retry the same way, falling through to the
        existing `Halt-Automation` on exhausted failure or conflict.
  - [x] Re-ran the same grep after all six fixes: every remaining `push origin main` hit is either
        inside a retry loop's own call or a human-facing message string — none are bare/unretried.
  - [x] docs/DECISIONS.md D-047 gains a second addendum documenting all six sites and the fix.

constraints:
  - Automation/OS-surface change (Hard Rule 10 / D-023): solo, never chained.
  - Red-zone surface (D-032) — held at `approved`, never auto-merged.
  - Same rebase-not-reset rule as TASK-030: never discard the commit being pushed on conflict —
    rebase or report-and-stop only.
  - Duplicate the retry logic per file (matching this repo's existing convention), except within a
    single file's own multiple sites, where sharing one local helper is the more natural fit.

test steps:
  - [x] `[System.Management.Automation.Language.Parser]::ParseFile` on all four changed `.ps1` files:
        no syntax errors.
  - [x] `grep -rn "push origin main" tools/*.ps1 run-claude.ps1` re-run after the fixes: confirmed
        every hit resolves to a retry loop's internal call or a message string, not a bare push.
  - [ ] Live (human-verified): a future auto-merge, audit run, `/enable`/`/disable`, or scheduled
        planning run that happens to race an OUTBOX-clearing cycle recovers automatically instead of
        needing manual `git push origin main` recovery.

### TASK-032 · Fix silent no-op rework retry + stuck crashed-review state
status: approved
review: Claude implemented directly (tools/Dispatch-Commands.ps1, tools/Run-Codex-Build.ps1 — same
  D-040 reasoning as every other automation-surface item: Codex cannot commit under tools/). Held at
  `approved` for human `/merge`, not auto-merged, per D-032/Hard Rule 10. Same disclosed same-session
  caveat as TASK-014/016/031 — no independent second set of eyes on this specific diff. Verified with
  an isolated fixture harness (below), not a live end-to-end run. Both changed files parse clean.
  Land with `/merge TASK-032` then `/merge TASK-032 yes` when ready.
source: found live while investigating why TASK-025's `/go` reply ("done") turned out not to be true
  (2026-07-20 conversation) — user then asked to fix it, framing the request as "be my junior dev:
  investigate, build, verify, and just give me a yes/no" rather than a spec to build from
priority: P1
depends-on: none
files: tools/Run-Codex-Build.ps1, tools/Dispatch-Commands.ps1, docs/DECISIONS.md

context:
  TASK-025's rework-retry (commit a24cdbc) flipped `TASKS.md` status from `codex` to `review` while
  changing nothing else at all (`git diff 03b6b7c a24cdbc -- app.js` was empty) — neither must-fix
  security patch from the prior review was actually applied. The follow-up automated `claude -p`
  re-review then crashed (exit 1), and `Invoke-Autopilot`'s classifier had no case for "review engine
  crashed, not a verdict" — it fell into the generic `else` branch and got marked `blocked` with a
  note ("build stopped -- ...") that doesn't match either of `Invoke-Autopilot`'s own auto-release
  patterns (`waiting on merge of` / `strike N/3`). The task's own note claimed "automatic retry on the
  next /review or /go", but neither actually would have resumed it: `/review` found nothing because
  main's `TASKS.md` said `blocked`, not `review`, and a plain `/go` only ever searches for
  `status: codex`. Full detail: docs/DECISIONS.md D-051.

acceptance:
  - [x] `Run-Codex-Build.ps1`: before auto-chaining a build that reached `status: review` into review,
        verify the build touched at least `CHANGELOG.md` or `TEST_REPORT.md` (AGENTS.md's own
        mandated evidence steps). If not, mark it `blocked` with a clear "no-op" note and skip the
        review chain entirely, rather than let a no-op reach review.
  - [x] `Dispatch-Commands.ps1`: factor the build/review outcome classification into one shared
        `Resolve-ReviewOutcome` function used by both the build loop's auto-chained-review outcome
        and a new pending-review-resume step, so the two call sites cannot drift apart.
  - [x] Add a case recognizing Run-Claude-Review.ps1's crash signal ("Left at status: review for
        automatic retry") that sets `status: review` on main (not `blocked`), with no strike cap —
        transient engine flakiness, not a task-level defect.
  - [x] Add a case recognizing the new "build NO-OP" signal from Run-Codex-Build.ps1, reusing the
        existing `strike N/3` bounded-retry idiom REWORK already has.
  - [x] Fix a latent bug found while consolidating the classifier: a red-zone "APPROVED but HELD"
        review message contains the literal word APPROVED, so the old inline classifier would have
        matched it and marked the task `done` on main even though the branch was never actually
        merged. Now checked before the generic APPROVED match and routed to `status: approved`
        instead.
  - [x] Add a pending-review-resume step to `Invoke-Autopilot` so a plain `/go` (not just an explicit
        `/review`) resumes a task stuck at `status: review`, taking priority over starting a new build
        (it's further along) and counting as that mission's one action.
  - [x] The `/go` summary says `RETRYING:` (not `NEEDS YOU:`) for a self-healing crash retry, since no
        human action is actually needed there — distinguished via a new `.NeedsHuman` field on the
        classifier's return object.
  - [x] docs/DECISIONS.md gains a D-051 entry.

constraints:
  - Automation/OS-surface change (Hard Rule 10 / D-023): solo, never chained.
  - Red-zone surface (D-032) — held at `approved`, never auto-merged.
  - No strike cap on the pure engine-crash retry case (unlike REWORK and the new no-op case, which
    both must stay bounded at 3 — a genuinely broken task must not retry forever).
  - Do not change `/run`, `/build`, `/review`, `/merge`, `/status`, `/next`, `/stop`, `/enable`,
    `/disable` behavior beyond what's needed for the pending-review-resume step to reuse the existing
    `Invoke-ReviewPhase`.

test steps:
  - [x] `[System.Management.Automation.Language.Parser]::ParseFile` on both changed `.ps1` files: no
        syntax errors.
  - [x] Isolated fixture harness against `Resolve-ReviewOutcome` (extracted from the real file, its
        real `Split-TaskBlock`/`Set-TaskStatus`/`Set-TaskBlockedAuto` dependencies, `Publish-
        TasksChange` stubbed to avoid touching git): 7 cases / 16 assertions, all pass — real
        auto-merge → `done`; APPROVED-but-HELD → `approved` (not `done`); REWORK → `blocked` with
        strike incremented from a prior note; crash signal → `status: review`, no strike; no-op signal
        → `blocked` with strike incremented, including from a pre-existing strike count; unrecognized
        failure → generic `blocked`.
  - [x] 5-case check of the `$hasEvidence` no-op guard logic, including the exact TASK-025 repro
        (`$changed` containing only `TASKS.md`) correctly flagged as no evidence.
  - [ ] Live (human-verified): the next real crashed review or real no-op rework retry in production
        resolves itself on the next `/go` instead of getting stuck. Not safely reproducible without
        spawning real `codex`/`claude` CLI processes against a live branch.

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
