# Tasks

> **Handoff document.** Claude writes tasks; Codex checks them off.
> Tasks must come from an approved item in `planning/BUILD_QUEUE.md`.
> One task = one atomic, independently testable unit.

## Status legend

`todo` → `codex` → `in-progress` → `review` → `approved` / `rework` → `done`
`blocked` = Codex hit an ambiguity; Claude must resolve before work continues.

---

<!-- ═══════════════════════════════════════════════════════
     BQ-016 · Modal mobile-footer-stacking fix
     ═══════════════════════════════════════════════════════ -->

### TASK-001 · Add CSS modal size modifier classes
status: codex
owner: codex
source: BQ-016
depends-on: none
files: style.css

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
status: codex
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
status: codex
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