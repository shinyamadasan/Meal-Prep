# Review

> **Claude writes; Codex reads.** One entry per review cycle.
> After writing: set the task status in TASKS.md to `approved` or back to `codex`.

---

## Review TASK-001 — APPROVED (code-trace verified; test failure unrelated)
branch: task-001
verdict: approved

### Findings

**1. CSS implementation — correct.** Diff (uncommitted, working tree on `task-001`) adds exactly:
```
.modal-content--sm { max-width: 420px; }
.modal-content--md { max-width: 480px; }
.modal-content--lg { max-width: 600px; }
```
at `style.css:3017-3027`, immediately after the second `.modal-content` block. Verified directly:
- Both base `.modal-content` blocks (1304-1311, 3007-3015) untouched — still 600px/700px defaults.
- No `!important` on the modifiers.
- Mobile override at `style.css:5472` (`@media (max-width:768px) { .modal-content { max-width: 100% !important; ... } }`) still wins on narrow viewports — `!important` beats class specificity regardless.
- `git status` shows only `style.css` (+ doc files) changed on this branch — no HTML/JS.
All 5 acceptance criteria met.

**2. Test failure — pre-existing test-fixture gap, not caused by this change.**
- `npm test` failed with `spawn EPERM` in the sandboxed run (harness permission issue, not app code); approved runs then timed out at 124s/304s (Playwright browser launch overhead in this environment).
- The isolated diagnostic run of `tests/mobile-layout.spec.js` got further but failed because `#kitchen-setup-modal` intercepted the click on `.tab-btn[data-tab="recipes"]`.
- Root cause: `seedPantryIfEmpty()` (app.js:6921) auto-opens `#kitchen-setup-modal` on any fresh profile with an empty pantry and no `pantryOnboardingDone` flag. `mobile-layout.spec.js` only seeds `mealPrepHelpSeen` (line 13) and never seeds `pantryOnboardingDone` or force-closes modals — unlike `button-smoke.spec.js` (and the other specs), which call a `closeAllModals()` helper right after page load specifically to survive this same onboarding wizard.
- TASK-001's new CSS classes aren't referenced by any HTML yet (TASK-002/003 apply them later), so they have zero rendering effect today — they cannot be the cause of a click-interception failure. The blocker is orthogonal to this diff.

**3. Disposition.**
- TASK-001: approve on code-trace verification; the test failure that produced `blocked` is not attributable to this change and re-doing the CSS would not fix it.
- Do not fold the test fix into TASK-001 (its `files:` scope is `style.css` only). Split off **TASK-004** (new, `tests/mobile-layout.spec.js`) to add the missing `pantryOnboardingDone` seed / `closeAllModals()` call, matching the existing pattern — this also unblocks verification for TASK-002/003, which *do* touch rendered HTML.
- The sandbox `spawn EPERM` + timeouts are a harness/infra concern, flagged in TASK-004 for a human call (pre-installed Playwright browsers / spawn permission) rather than something a task can fix in-repo.

→ TASK-001 status set to `done` in TASKS.md.
→ TASK-004 added to TASKS.md (`status: codex`).

## Review TASK-002 — APPROVED
branch: task-001 (see Nits — TASK-002 was not given its own branch)
verdict: approved

### Findings

**1. HTML change — correct, matches all 4 acceptance criteria.** Verified at `index.html:832-845`
(`#username-modal`):
- `.modal-content` is now `class="modal-content modal-content--sm"`; the old
  `style="max-width: 420px;"` attribute is gone.
- The button row is now `<div class="modal-footer">` — no inline flex styles.
- Cancel (`closeUsernameModal()`) and Save name (`saveUsername()`) remain inside it, onclick
  handlers and labels unchanged.
- Nothing else in `#username-modal` (header, close button, input) was touched.

**2. The fix actually works.** `.modal-footer` (style.css:1345) is `display:flex; justify-content:
flex-end` by default, and the existing `@media (max-width: 768px)` block (style.css:3252) flips it
to `flex-direction: column` + full-width buttons (style.css:3257). That mobile rule was already
proven — it's the same one TASK-003's four modals already rely on — so routing `#username-modal`'s
buttons through `.modal-footer` is sufficient on its own; no new CSS was needed or added.

**3. Constraints held.** Only `#username-modal` touched; no other modal's HTML changed; no CSS/JS
diff beyond what TASK-001 already added (confirmed via `git diff -- style.css` — identical to the
already-approved TASK-001 diff, nothing new).

**4. Test evidence.** `TEST_REPORT.md`'s TASK-002 entry reports a targeted local check passing;
`mobile-layout.spec.js` still fails on the pre-existing `#kitchen-setup-modal` interception that
TASK-004 exists to fix (not yet done) — same orthogonal-blocker reasoning as TASK-001's review.
Acceptance criteria here are structural/HTML and fully verifiable by direct inspection, which I did.

### Nits (optional, Codex's call)
- Work landed on branch `task-001` instead of a dedicated `task-002` (disclosed honestly in
  `CHANGELOG.md` deviations — "workspace already had unrelated uncommitted work"). Not blocking;
  all of TASK-001/002/003/004 are currently sharing one branch's working tree. Worth a real branch
  split before merge, and worth a `docs/AI_OS_NOTES.md` entry if this keeps recurring.
- `index.html`'s diff also changes end-of-file from no-trailing-newline to a trailing newline —
  harmless (POSIX-standard EOF), but it wasn't mentioned in `CHANGELOG.md` deviations and doesn't
  trace to any acceptance criterion. No action needed.

→ TASK-002 status set to `done` in TASKS.md.

## Review TASK-003 — APPROVED
branch: task-001
verdict: approved

### Findings

**1. HTML change — correct, matches all 6 acceptance criteria.** Verified via `git diff -- index.html`:
- `#custom-item-modal`: `class="modal-content modal-content--sm"`, `style="max-width: 420px;"` gone.
- `#user-ingredient-modal`: `class="modal-content modal-content--md"`, `style="max-width:480px"` gone.
- `#bulk-add-modal`: `class="modal-content modal-content--md"`, `style="max-width:480px"` gone.
- `#paste-recipe-modal`: `class="modal-content modal-content--lg"`, `style="max-width: 600px;"` gone.
- `#prep-mode-modal` does not appear in the diff at all — untouched, as required.
- Each modal changed exactly one line (the `.modal-content` open tag); no `.modal-footer` contents,
  button labels, or onclick handlers touched. The only other change in the file is the pre-existing
  no-newline-at-EOF fix (already noted as harmless in the TASK-002 review).

**2. Constraints held.** Only the max-width inline style was removed per modal — no other inline
styles existed on these `.modal-content` tags to begin with, so nothing else could have been touched.

**3. Test evidence honestly reported.** `TEST_REPORT.md`'s TASK-003 entry: targeted local Playwright
modal check passed (desktop widths, mobile stacking, `#prep-mode-modal` unchanged); the full
`mobile-layout.spec.js` run was blocked by the pre-existing `#kitchen-setup-modal` interception
(TASK-004's job, not this task's); `npm test` timed out. All correctly disclosed as untested rather
than claimed passing — no fail-loud violation.

→ TASK-003 status set to `done` in TASKS.md.

## Review TASK-004 — APPROVED (with a new finding routed to Proposals)
branch: task-001
verdict: approved

### Findings

**1. Fixture fix — correct, matches acceptance criteria.** Verified via `git diff -- tests/mobile-layout.spec.js`:
- `pantryOnboardingDone` is now seeded alongside `mealPrepHelpSeen` in the same `addInitScript` block.
- A `page.evaluate()` immediately after load force-hides any open `.modal:not(.hidden)` and resets
  `document.body.style.overflow` — functionally equivalent to the `closeAllModals()` pattern used in
  `button-smoke.spec.js` (the criterion explicitly allows "or equivalent").
- No other spec file changed (`git status` confirms only this one test file plus unrelated in-flight work).
- `app.js` and `style.css` untouched — test-fixture-only, as constrained.

**2. Extra change beyond the literal criteria, but justified and disclosed.** The diff also adds
`'nutrition'` to the `inMore` array (`['nutrition', 'ingredients', 'hacks']`). Checked against
`index.html:55-57`: `data-tab="nutrition"` really does live inside `.tab-more-menu`, so the test was
previously mis-clicking (or failing to find) that tab regardless of the modal-interception bug. This
is a legitimate test correctness fix, stays inside the allowed file, and is disclosed in `CHANGELOG.md`
("routes `nutrition` through the More menu"). Approved as in-scope.

**3. Acceptance criterion "reaches the overflow assertion for every tab" — met.** The loop doesn't
break on a bad reading; it pushes to `bad[]` and keeps going, then asserts once at the end. `TEST_REPORT.md`
confirms the spec now runs past onboarding/nav fixtures for all 7 tabs and fails only on a genuine
overflow reading (`planner (+23px)`), not a click-interception error. The full `npm test` timeout is
disclosed as unverified, per the constraint that environment failures be recorded separately rather
than treated as a code defect.

**4. New finding, not a regression from this task.** The fixture now works well enough to catch a real
bug: the **Planner tab overflows horizontally by 23px on a 390px-wide mobile viewport** — exactly the
"looks broken on mobile" class of bug this test exists to catch. This is outside TASK-004's test-fixture-only
scope (app.js/style.css are off-limits here) and isn't yet triaged or approved for a build, so it does not
block this task's approval. Filed as **PROP-029** in `planning/PROPOSALS.md` for your decision, rather than
silently left for someone to notice later.

→ TASK-004 status set to `done` in TASKS.md.

## Review TASK-005 — APPROVED
branch: task-001
verdict: approved

### Findings

**1. CSS change — correct, matches all 4 acceptance criteria.** Verified at `style.css:5483-5492`
(the `@media (max-width: 768px)` block commented "compact scrollable pill row"):
- `.planner-controls` gains exactly `width: 100%;` and `max-width: 100%;`, inserted after `gap: 6px;`
  and before `overflow-x: auto;` — alongside the existing declarations, as required.
- No other property in that block changed; the other two `.planner-controls` blocks (`style.css:3316`,
  `style.css:3715`) are untouched — neither sets `width`/`max-width`, confirming the constraint's
  claim that ordinary cascade/source-order (this block loads last) is sufficient without `!important`.
- `git diff --stat` for `index.html`/`tests/mobile-layout.spec.js` matches exactly what TASK-002/003/004
  already had reviewed and approved — nothing new leaked in from this task. No `app.js` diff exists.

**2. The fix is verified live, not just code-traced — and I can confirm the result.**
`TEST_REPORT.md`'s TASK-005 entry reports `npx playwright test tests/mobile-layout.spec.js` now
**passes (1 passed)** — this is the same spec TASK-004 got running, and it was failing on exactly
`planner (+23px)` before this fix (per TASK-004's own TEST_REPORT entry). Going from "1 failure:
planner overflow" to "1 passed" is direct evidence the fix works across all 7 tabs, not just the
planner tab in isolation.

**3. Constraints held.** Two-line addition only; no `!important` added; no JS changes; the two
other duplicate `.planner-controls` blocks were deliberately left alone (tracked debt, per PLAN.md
Scope — Out).

**4. Test evidence honestly reported.** `npm test` (full suite) timing out at 304s is disclosed as
unverified rather than silently skipped or claimed passing — consistent with the pattern across
TASK-001–004; this is a known sandbox/environment limitation (see TASK-001's review), not something
this task introduced or could fix.

→ TASK-005 status set to `done` in TASKS.md.

BQ-017 is now fully built — `PLAN.md`'s milestone can be marked complete at the next `Plan`/`Next` pass.

## Review TASK-006 — APPROVED
branch: task-006
verdict: approved

### Findings

**1. HTML change — correct, all listed sub-criteria met.** Verified at `index.html:1132-1140`:
- New row inserted inside `#bulk-add-modal .modal-body`, immediately before the existing
  `.bulk-voice-row` at line 1141, as required.
- Label matches the AC verbatim: `<label class="form-label">Storage <span
  style="font-weight:400;color:var(--text-secondary)">(optional — applies to all items)</span></label>`.
- `<select id="bulk-add-default-storage" class="form-control" style="max-width:12rem">` with the
  four options in the exact required order: `""` (Auto), `counter`, `fridge`, `freezer`. Option
  labels match the AC ("Auto (infer per item)", "Counter", "Fridge", "Freezer").
- `#custom-item-modal` (index.html:904) is untouched — no drift outside the target modal.

**2. `openBulkAddModal()` reset — correct.** At `app.js:7559-7560`:
```
const storage = document.getElementById('bulk-add-default-storage');
if (storage) storage.value = '';
```
Same shape as the existing `bulk-add-expiry` reset two lines above (7557-7558), as the AC
explicitly requested.

**3. `confirmBulkAdd()` selector wiring — correct.** Read once at the top (`app.js:7577-7578`):
```
const defaultStorageInput = document.getElementById('bulk-add-default-storage');
const defaultStorage = defaultStorageInput ? defaultStorageInput.value.trim() : '';
```
Applied at `app.js:7616`:
```
const storage = defaultStorage || inferStorage(name, category);
```
This matches the AC's specified substitution shape. When the selector is empty (`""`), the
`||` short-circuits to the existing per-item `inferStorage()` call — the "Auto" path is
byte-identical to today's behavior. When non-empty, every item's pantry `storage` field is
set to the chosen value.

**4. Constraints held.**
- `inferStorage()` at `app.js:115-142` is untouched (verified by direct read).
- No per-line storage keyword added in the textarea parser (that would collide with TASK-008's
  scope).
- No `#custom-item-modal` where-selector or any other pantry-add path touched.
- Style matches existing app conventions: global function, `document.getElementById(...)`, no
  framework primitives, no new state.
- Storage values `counter | fridge | freezer` line up with `inferStorage()`'s three-value model
  (verified against its category-fallback returns at app.js:140-141 and its explicit-check keys
  at 128-131). No blocker needed.

**5. Behavior when Auto is left in place — preserved.** `defaultStorage` is `''` (falsy), so
line 7616 falls through to `inferStorage(name, category)` identically to the pre-change code
path at (formerly) that same line. Shared-expiry field, textarea parsing, `NO_COMMA_RE`, warning
surface, and duplicate-name skip logic are all untouched.

**6. Test evidence honestly disclosed.** `TEST_REPORT.md` reports targeted
`tests/mobile-layout.spec.js` passing (1/1); a full single-worker run got past `button-smoke.spec.js`
but stalled in `buttons-functional.spec.js` because `#kitchen-setup-modal` still intercepts nav
clicks in that spec's fixture (same class of pre-existing test-fixture debt that TASK-004
addressed only for `mobile-layout.spec.js`). Direct selector browser check could not run because
sandboxed `chromium.launch` hit `spawn EPERM` — recorded as environment-blocked, not silently
skipped. Consistent fail-loud discipline with prior tasks' reviews.

### Nits (optional, Codex's call)
- The row is wrapped in `<div class="bulk-storage-row" style="margin-bottom:0.75rem">`. The AC
  says "a new row … containing" the label and select without naming a wrapper class; this class
  is a reasonable, non-behavioral addition that mirrors the sibling `.bulk-voice-row` /
  `.bulk-expiry-row` structural pattern. Fine to keep as-is; no CSS rule is (or needs to be)
  added for it.
- `buttons-functional.spec.js` failing on `#kitchen-setup-modal` interception looks like the
  same category of fixture debt TASK-004 fixed for `mobile-layout.spec.js` only. Worth filing
  as a proposal (analogous to PROP-029) so the pattern gets applied across all specs — outside
  this task's scope.

→ TASK-006 status set to `done` in TASKS.md.

## Review TASK-008 — APPROVED
branch: task-008
verdict: approved

### Findings

**1. Parser preprocessing — correct, all 7 acceptance criteria met.** Verified at `app.js:7587-7599` inside `confirmBulkAdd()`:
- `originalLine = line;` captured before any mutation, so the warning shows the raw user input.
- `perLineExpiry = ''` initialized per line (no leakage across iterations).
- Regex is exactly the required shape: `line.match(/\bexp:(\d{4}-\d{2}-\d{2})\b/i)` — ISO-only, case-insensitive on `exp`, word-bounded at both ends.
- Validation uses the specified `!isNaN(new Date(dateStr + 'T00:00:00').getTime())` check; on success `perLineExpiry = dateStr`; on failure the warning is pushed verbatim as `Line ${idx + 1}: "${originalLine}" — invalid exp date, ignored`, matching AC wording exactly.
- The strip `line = line.replace(/\s*\bexp:\d{4}-\d{2}-\d{2}\b\s*/i, ' ').trim();` runs regardless of validity — so an invalid `exp:` token is removed from the name before the comma/no-comma parser sees it (reasonable choice: the warning already tells the user it was "ignored", and this prevents the token from corrupting the name field). Occurs **before** the existing `parts.split(',')` at 7600, as required.
- The `NO_COMMA_RE` at 7585 is untouched; parser structure unchanged.

**2. Per-line-wins precedence — correct.** At `app.js:7629`:
```
const itemExpiry = perLineExpiry || bulkExpiry;
```
And at 7640-7641:
```
expiryDate: itemExpiry || null,
dateMode: itemExpiry ? 'expiry' : undefined
```
This is byte-identical to the AC's specified substitution shape. Fall-through paths verified by trace:
- No `exp:` token, no shared date → `itemExpiry === ''` → `expiryDate: null, dateMode: undefined` (unchanged from today).
- No `exp:` token, shared date `2026-08-01` → `itemExpiry === '2026-08-01'` → `expiryDate: '2026-08-01', dateMode: 'expiry'` (unchanged from today).
- Per-line `exp:2026-07-15`, shared `2026-08-01` → per-line wins.
- Invalid `exp:2026-13-45`, shared `2026-08-01` → warning pushed, `perLineExpiry` stays `''`, item still gets `2026-08-01`.

**3. Constraint discipline — held.**
- Regex requires `(\d{4}...)` to abut the `:` directly (no `\s*` between them), so `Chicken exp: 2026-07-20` with a space after the colon does not match. Traced: at that point the regex tries `exp:`+digit, sees `exp:`+space, backs off; no other `exp:` in the string; no match; `line` passes through untouched to the parser and `NO_COMMA_RE` fails on `20` (not a unit), so `name` captures the full `Chicken exp: 2026-07-20` string — exactly the AC-required behavior.
- Alternate keyword forms rejected: `expires:2026-07-20` fails because the regex demands `:` directly after `exp` (next char is `i`); `exp=2026-07-20` fails because `=` isn't `:`.
- Word boundary at the start rejects intra-word matches (`Bexp:...`, `1exp:...`).
- No new date library; `NO_COMMA_RE` untouched; only preprocessing added to the parser pipeline.

**4. HTML surfaces — correct.** Verified at `index.html:1131` and `index.html:1145`:
- Hint gains the exact sentence `<br>Add <code>exp:YYYY-MM-DD</code> anywhere in a line to set that item's expiry (overrides the shared date below).` verbatim, appended after `or just <code>Garlic</code>`.
- Placeholder third line is `Chicken Thigh 500g exp:2026-07-20`, correctly wedged between `Coconut cream 200ml` and `Garlic` via `&#10;`.
- No other changes to `#bulk-add-modal` markup; TASK-006's storage selector at 1132-1140 is preserved unchanged.

**5. Non-scope surfaces preserved.** `#bulk-add-warnings` render path (7646-7650), `closeBulkAddModal()` (7564-7568), `openBulkAddModal()` reset (7552-7563), `inferStorage()` and its call at 7628 (TASK-006's turf), duplicate-name skip (7618-7621), and success toast (7656) are all untouched by the diff.

**6. Test evidence — honestly reported.** `TEST_REPORT.md`'s TASK-008 entry:
- Deterministic parser check (5 cases: no token / shared expiry / per-line override / invalid matching date fallback warning / spaced `exp:` no-match) — all pass. These map 1:1 to the AC test steps.
- Targeted `mobile-layout.spec.js`, `smoke.spec.js`, `button-smoke.spec.js` — 1/1 each.
- Full `npm test` and single-worker Playwright timed out under sandbox limits; split runs surfaced pre-existing `recipe-actions.spec.js` fixture failures (recipe-card controls hidden — same class of pre-existing test-fixture debt TASK-004 addressed only for `mobile-layout.spec.js`, and TASK-006's review already flagged for a follow-up proposal). None trace to TASK-008 changes. Disclosed as unverified rather than claimed passing — fail-loud discipline held.

### Nits (optional, Codex's call)
- The strip regex omits the `g` flag, so if a single line contains two `exp:YYYY-MM-DD` tokens only the first is stripped (and used); the second is left in the name string. AC only specifies single-token behavior; not a must-fix. If a follow-up wants belt-and-braces behavior, adding `g` on the `.replace` line (only) would strip any stragglers without altering which date wins.
- `recipe-actions.spec.js` and `buttons-functional.spec.js` continue to fail under the same `#kitchen-setup-modal` interception pattern TASK-004 already fixed for `mobile-layout.spec.js`. Worth carrying forward as a fixture-hygiene proposal (analogous to PROP-029) so the pattern gets applied across all specs — outside this task's scope.

→ TASK-008 status set to `done` in TASKS.md.

## Review TASK-007 — APPROVED (re-applied onto main; code-trace + smoke verified)
branch: task-007 (feature re-applied to main, not merged)
verdict: approved

### Context
The original `task-007` build (`d8acde3`) was correct but never reviewed — the automated `claude -p` review crashed (exit 1), and the branch went ~12 commits stale behind the D-028/029/030 data-integrity work. Per the human directive, the isolated `app.js` feature hunks were re-applied onto current `main` via `git apply --3way` (clean, no conflicts) rather than merging the stale branch.

### Findings
**1. Implementation — correct.** All four functions take `multiplier = 1`, so every existing caller is byte-identical. `deductIngredientsForRecipe` (app.js:7280) and `checkMissingIngredients` (7312) scale `scaledQty *= multiplier` before `toGrams()`; no other math changed. `_doMarkCooked` (7350) records `servings: parseFloat((currentServings * multiplier).toFixed(2))` and adds a `(×N)` toast suffix only when `multiplier !== 1`. `cookedMeals` unchanged (still 1 batch).
**2. Dialog reuse — correct and non-trivial.** `showConfirmDialog` closes the overlay BEFORE invoking `onConfirm` (app.js:7344). The multiplier input is therefore captured by reference up-front (`multiplierInput = document.getElementById(...)` after the synchronous append, app.js:7428); a detached input keeps its typed `.value`. Reading via `getElementById` inside the callback would return null — the captured-reference pattern is required, not incidental, and is preserved intact.
**3. Input validation — correct.** `parseFloat`; falls back to `1` on NaN or `<= 0`.
**4. Constraints held.** Single number input (no stepper), no new global state (multiplier passed by arg), `.slot-cooked-btn` markup untouched, `app.js`-only for the feature.

### Verdict
Approved → TASKS.md `blocked → done`. Runtime multiplier deductions (2× / 0.5× / invalid) and device rendering are flagged for human verification — the smoke suite does not drive the cook dialog.

<!-- Entries go here, newest first. -->

<!-- REVIEW TEMPLATE — copy and fill:

## Review TASK-<id> — <APPROVED | REWORK>
branch: task-<id>-<slug>
verdict: approved OR changes requested

### Must-fix (Codex must address before approval)
- [ ] item

### Nits (optional, Codex's call)
- item

→ task status set to `approved` / `codex` in TASKS.md

-->