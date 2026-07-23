# Test Report

> **Codex writes; Claude reads.** Append-only. One entry per task run.
> Tests use Playwright: `npm test` (all), `npm run test:smoke`, `npm run test:functional`.

---

## TASK-038 · 2026-07-23
suite: `node --check app.js`; deterministic fill-empty-only state check for `loadWeekTemplate()` logic; `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=60000`; `npm test`
result: syntax check passed. Deterministic state check passed: filled breakfast/lunch/dinner/snacks from `mealPrepWeekTemplate` only where the current `AppState.weeklyPlan` slot was empty; existing populated meal slots and populated snacks stayed unchanged. Smoke + button-smoke passed (2/2; 468 buttons discovered, 200 clicked, 0 broken). Full `npm test` ran and reported 20 passed, 1 failed: `buttons-functional.spec.js` Clear All still waits for a native browser dialog, but `clearGroceryList()` now uses `showConfirmDialog()` from TASK-036, so the custom confirm button is never clicked and the item remains.
untested: live browser template-load flow remains human verification; Playwright subset verifies app load/button health but does not drive this saved-template confirmation path directly.

## TASK-039 · 2026-07-22
suite: `node --check app.js`; `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js
  --reporter=list --workers=1 --timeout=60000`; deterministic `escapeHtml()` payload check
result: syntax check passed. Smoke + button-smoke passed (2/2; 467 buttons discovered, 200
  clicked, 0 broken) — confirms the added `escapeHtml()` calls don't break Prep Mode rendering for
  normal (non-malicious) recipe data. Deterministic check: `escapeHtml('<img src=x
  onerror=alert(1)>')` produces `&lt;img src=x onerror=alert(1)&gt;` — the payload's `<img` tag no
  longer survives as raw HTML.
untested: live verification that a recipe with a crafted name, opened in Prep Mode (manually or
  via auto-restore on login), renders as inert text rather than executing script — remains human
  verification, same as every other DOM-rendering claim in this app's test suite.

## TASK-036 · 2026-07-22
suite: node --check app.js; git diff --check; rg -n "confirm\\(" app.js; npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=60000; npm test; acceptance code-trace
result: `node --check` passed. `git diff --check` passed with only Git LF-to-CRLF working-copy warnings. `rg -n "confirm\\(" app.js` returned zero matches. Smoke + button-smoke passed (2/2; 467 buttons discovered, 200 clicked, 0 broken). Full Playwright suite passed (21/21). Code-trace verified Cancel only closes `showConfirmDialog()` and Confirm runs the original destructive logic for restore backup, Clear All Data, delete recipe, clear day, clear weekly plan, clear grocery list, delete ingredient, delete cooking hack, load week template, and delete custom ingredient.
untested: installed iOS PWA behavior remains human verification; Playwright verifies the browser dialog flow but not standalone-mode WebKit.

## TASK-028 · 2026-07-22
suite: node --check app.js; git diff --check; npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js; npm test; acceptance code-trace
result: `node --check` passed. `git diff --check` passed with only Git LF-to-CRLF working-copy warnings. Smoke + button-smoke passed (2/2; 467 buttons discovered, 200 clicked, 0 broken). Full Playwright suite passed (21/21). Code-trace verified `prepModeSession` is saved/loaded through localStorage, included in `buildFirestorePayload()`, read from Firestore and realtime snapshots, restored on startup, cleared by `closePrepMode()` and Clear All Data, and filters deleted recipe references before rendering.
untested: live browser close/reopen Prep Mode session restoration remains human verification; Playwright does not exercise that modal workflow directly.

## TASK-027 · 2026-07-22
suite: node --check app.js; npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js; npm test; acceptance code-trace
result: `node --check` passed. Smoke + button-smoke passed (2/2; 467 buttons discovered, 200 clicked, 0 broken). Full Playwright suite passed (21/21). Code-trace verified `startVoiceInput()` keeps `interimResults = false`, trims the parsed final line, inserts a separator only when existing textarea content does not already end in a newline, and leaves a trailing newline after each final result.
untested: live microphone dictation remains human verification; Playwright does not drive the browser SpeechRecognition API.

## TASK-026 · 2026-07-22
suite: node --check app.js; git diff --check; static QA greps for `#pantry-clear-expired`, `clearExpiredPantryItems`, `patchMissingNutrition`, `AppState.cloudReady`, dark-mode selectors, and `:root`; npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list; npm test -- --reporter=list
result: `node --check app.js` passed. `git diff --check` passed with only Git LF-to-CRLF warnings. Static QA passed: the new inline handler has a matching global export, `saveData()` remains the persistence path in the new destructive action, load-path `patchMissingNutrition()` and Firestore `AppState.cloudReady` guard remain present, app source has zero dark-mode selector matches, and `style.css` has exactly one `:root`. Targeted Playwright smoke + button-smoke passed (2/2; 467 buttons discovered, 200 clicked, 0 broken). Full `npm test -- --reporter=list` passed (21/21).
untested: the task's bulk-delete 6+ expired item reload scenario was verified by code trace rather than a dedicated committed spec; real-device rendering remains human verification

## TASK-034 · 2026-07-21
suite: [System.Management.Automation.Language.Parser]::ParseFile on tools/Run-Codex-Build.ps1 and
  tools/Run-Claude-Review.ps1; isolated fixture harness against `Get-TaskBlockText`/
  `Get-TaskDeclaredFiles` (extracted from the real file via brace-matching); second isolated
  fixture harness against the note read/match/consume logic replicated from Run-Claude-Review.ps1
result: both files parse clean. First harness: 8/8 assertions pass (single-line files field,
  multi-line continuation with `(new)` annotations stripped, missing field returns `@()`, correct
  isolation of one task among several with no bleed into neighbors, unknown task ID handled
  without crash, out-of-scope diff logic correct for both an in-scope build and one with an extra
  undeclared file). Second harness: 6/6 assertions pass (matching task ID uses the note, ID among
  several covered IDs uses the note, an unrelated stale ID is ignored, the file is always deleted
  after read regardless of match, a missing file returns empty without crashing).
untested: no live end-to-end run — reproducing a real build that touches a file its task never
  declared, and confirming the note actually reaches a real REVIEW.md entry, isn't safely
  reproducible without running the real headless build/review pipeline against a live branch.
  Honestly disclosed as unverified-live here rather than claimed.

## TASK-033 · 2026-07-21
suite: [System.Management.Automation.Language.Parser]::ParseFile on tools/Generate-Digest.ps1 and
  tools/Dispatch-Commands.ps1; tools/Generate-Digest.ps1 executed against this app's own real
  planning/PROPOSALS.md with -OutFile pointed at a scratch file; direct diff of the ported
  stale-lock/status logic against ChronaSense's already fixture-tested task-002 branch
result: both files parse clean, no syntax errors. Digest run against real data: 530 chars (limit
  4096), matching pre-fix output exactly since this app's current proposal count is well under the
  new truncation threshold — confirms the fix is a no-op at normal digest sizes, only engaging once
  content actually approaches the limit. Stale-lock/status logic: byte-for-byte identical (via
  `diff`) to ChronaSense's task-002 branch, which itself passed a 4-case fixture test of the exact
  decision branching (dead PID clears regardless of age; live PID + fresh timestamp stays busy; live
  PID + 46-min timestamp clears; live PID + 44-min timestamp stays busy, no boundary false-positive).
untested: full live end-to-end verification — a real oversized digest send, and a real hung process
  actually getting auto-cleared with its Telegram notice arriving — was not attempted in this app
  specifically (ChronaSense's own TASK-002 carries the same disclosure).

## TASK-032 · 2026-07-20
suite: [System.Management.Automation.Language.Parser]::ParseFile on tools/Run-Codex-Build.ps1 and
  tools/Dispatch-Commands.ps1; isolated fixture harness against Resolve-ReviewOutcome (function
  extracted from the real file along with its real Split-TaskBlock/Set-TaskStatus/Set-TaskBlockedAuto
  dependencies, Publish-TasksChange stubbed to a no-op so the test never touches git); a 5-case check
  of the $hasEvidence no-op guard logic in isolation
result: both files parse clean, no syntax errors. Resolve-ReviewOutcome: 16/16 assertions pass across
  7 cases -- a real auto-merge message sets status: done with NeedsHuman false; an "APPROVED but HELD"
  red-zone message correctly sets status: approved (NOT done) rather than false-positive-matching the
  literal word APPROVED; a REWORK message increments an existing strike 1/3 note to 2/3 and sets
  status: blocked; a crashed-review-engine message ("Left at status: review for automatic retry") sets
  status: review with no strike; a "build NO-OP" message sets status: blocked with strike 1/3, and a
  repeat on a task that already carries strike 1/3 correctly increments to 2/3; an unrecognized failure
  message falls through to the generic blocked path. The $hasEvidence guard: the exact TASK-025 repro
  ($changed containing only TASKS.md) correctly flagged as no evidence; a real build touching
  app.js+CHANGELOG.md+TEST_REPORT.md+TASKS.md correctly passes; app.js changed with no evidence docs
  still correctly flagged (matches AGENTS.md's mandated evidence-before-review contract).
untested: full live end-to-end verification -- a real crashed claude/codex review process, and a real
  no-op rework retry -- was not attempted; not safely reproducible without spawning real codex/claude
  CLI processes against a live git branch. Flagged for human verification on the next real occurrence
  of either failure mode in production.

## TASK-025 · 2026-07-20 (re-applied on main)
suite: node --check app.js; deterministic parseRecipeText/parseNutritionLines harness (9 cases); npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=60000 (run twice: once on the fixed task-025 branch, once on main post-apply)
result: `node --check` passed both times. Deterministic harness passed 9/9: the original 4 cases (pipe-delimited nutrition with Saturated Fat correctly excluded, no-Nutrition-header leaves nutritionPerServing unset, newline-per-nutrient block, Notes header stops instructions without triggering a nutrition scan) plus 5 new security-regression cases added to verify the two must-fix patches — an absurd `Calories: 99999999` clamps to 99999; a line containing `__proto__: 5` and `constructor: 9` keys produces no own-property on the result object and does not pollute the global `Object.prototype` (`({}).polluted` stays `undefined`); a recognized key (`Sodium`) appearing after unrecognized keys on the same line still parses correctly. Playwright smoke + button-smoke passed both runs (2/2 each; 467 buttons discovered, 200 clicked, 0 broken).
untested: paste modal save flow intentionally unchanged by task constraint; direct browser paste of the PROP-030 text remains human-verifiable if desired; full `npm test` suite was not run in this session (smoke + button-smoke + the targeted deterministic harness were judged sufficient given the change is isolated to one function with no DOM/state-shape changes)

## TASK-014 · 2026-07-15
suite: PowerShell parser check for tools/Dispatch-Commands.ps1; isolated /go -DryRun fixture; inbox count check; git diff --check -- tools/Dispatch-Commands.ps1; npm test
result: PowerShell parser check passed. Isolated dry-run fixture with no build-ready tasks, empty BUILD_QUEUE, one `captures/inbox` file with `status: new`, and a `/go` command reported `TRIAGED 1 new idea(s) into proposals. Reply Approve <n>, then /go.` Repo inbox count check found 11 current untriaged captures. `git diff --check -- tools/Dispatch-Commands.ps1` passed with only Git LF-to-CRLF warning. `npm test` timed out after 124s without reporter output.
untested: full Playwright suite completion remains unverified because `npm test` timed out; live Telegram `/go` was not run because this task is on a red-zone automation branch awaiting review

## TASK-013 · 2026-07-11
suite: node --check app.js; git diff --check -- app.js; temporary Playwright TASK-013 import spec; npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=60000; npm test -- --reporter=list --workers=1
result: `node --check` passed. `git diff --check -- app.js` passed with only Git LF-to-CRLF warnings. Temporary import spec passed: imported IDs across all seven synced import lists received one shared `updatedAt` before `saveData()`, duplicate existing item fields still won, non-imported item `updatedAt` stayed unchanged, and imported tombstones were cleared. Smoke + button-smoke passed (2/2; 466 buttons discovered, 200 clicked, 0 broken). `npm test -- --reporter=list --workers=1` timed out after 304s without reporter output.
untested: full Playwright suite completion remains unverified because `npm test` timed out; live Firebase/emulator reload-after-2-min import verification remains human/emulator verification

## TASK-012 · 2026-07-11
suite: node --check app.js; rg -n "Loader Script" app.js; npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=60000; npm test -- --reporter=list --workers=1
result: `node --check` passed. `rg -n "Loader Script" app.js` returned no matches. Smoke + button-smoke passed (2/2; 466 buttons discovered, 200 clicked, 0 broken). `npm test -- --reporter=list --workers=1` timed out after 304s without reporter output.
untested: full Playwright suite completion remains unverified because `npm test` timed out; no human visual check needed for this comment-only change

## TASK-011 · 2026-07-10
suite: node --check app.js; git diff --check -- app.js index.html style.css; static greps for debug leftovers, raw CSS colors, light-only selectors, and `:root`; temporary Playwright TASK-011 behavior spec; npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=60000; npx playwright test tests/mobile-layout.spec.js --reporter=list --workers=1 --timeout=60000; npm test -- --reporter=list --workers=1
result: `node --check` passed; `git diff --check` passed with only Git LF-to-CRLF warnings; no new debug leftovers/raw CSS colors/dark-mode selectors found in the task diff; `style.css` has exactly one `:root`. Temporary behavior spec passed: Select mode shows checkboxes, row taps select without expanding, Move updates selected pantry storage, Delete removes 6 selected items, explicit `AppState.deletions` tombstones are present, and reload keeps them deleted. Smoke + button-smoke passed (2/2; 465 buttons discovered, 200 clicked, 0 broken). Mobile-layout passed (1/1). `npm test -- --reporter=list --workers=1` timed out after 304s without reporter output.
untested: full Playwright suite completion remains unverified because `npm test` timed out; real-device touch feel remains human verification

## TASK-010 · 2026-07-10
suite: node --check app.js; git diff --check -- app.js style.css; static greps for hidden recipe-details, instructions toggle, `:root`; temporary Playwright TASK-010 behavior spec; npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=60000; npm test -- --reporter=list --workers=1
result: `node --check` passed; `git diff --check` passed with only Git LF-to-CRLF warnings; `.recipe-details hidden` is gone from recipe-card markup; `.recipe-instructions hidden` + instructions toggle are present; `style.css` has exactly one `:root`; temporary behavior spec passed (ingredients visible by default, instructions collapsed then expandable with `aria-expanded`, detail scaler changes serving count); smoke + button-smoke passed (2/2; 465 buttons discovered, 200 clicked, 0 broken). `npm test -- --reporter=list --workers=1` timed out after 304s without reporter output.
untested: full Playwright suite completion remains unverified because `npm test` timed out; real-device recipe-card rendering remains human verification

## TASK-009 - 2026-07-10 branch refresh
suite: git diff --check main..HEAD; token grep for `--space-2`, `--space-6`, `--space-8`, `--font-size-lg`; CSS QA grep for app dark-mode selectors and `:root`; npx playwright test tests/mobile-layout.spec.js --reporter=list --workers=1 --timeout=60000; npm test -- --reporter=list --workers=1
result: `git diff --check` passed; required tokens exist; app source has zero `prefers-color-scheme` / `data-color-scheme="dark"` matches; `style.css` has exactly one `:root`; mobile-layout spec passed (1/1). `npm test -- --reporter=list --workers=1` timed out after 244s without reporter output.
untested: full Playwright suite completion remains unverified because `npm test` timed out; desktop recipe-card visual comparison and real-device rendering remain human verification

## TASK-009 · 2026-07-08
suite: token grep for `--space-2`, `--space-6`, `--space-8`, `--font-size-lg`; git diff --check; npm test -- --reporter=list --workers=1; npx playwright test tests/mobile-layout.spec.js --reporter=list --workers=1 --timeout=60000; CSS QA grep for app dark-mode selectors and `:root`
result: required tokens exist; `git diff --check` passed with only Git LF-to-CRLF warnings; app source has zero `prefers-color-scheme` / `data-color-scheme="dark"` matches; `style.css` has exactly one `:root`; mobile-layout spec passed (1/1). `npm test -- --reporter=list --workers=1` timed out after 604s without reporter output.
untested: full Playwright suite completion remains unverified because `npm test` timed out; desktop recipe-card visual comparison and real-device rendering remain human verification

## TASK-007 · 2026-07-08 (re-applied on main)
suite: node --check app.js; git apply --3way (feature hunks from d8acde3); npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=line; acceptance code-trace
result: `node --check` passed. Feature hunks applied cleanly onto current main (deduct at app.js:7280, check at 7312, `_doMarkCooked` at 7350, `markRecipeCooked` at 7395). `smoke.spec.js` + `button-smoke.spec.js` passed (2 passed; 460 buttons discovered, 200 clicked, 0 broken). Code-trace verified all 8 acceptance criteria: default-param backward-compat; `scaledQty *= multiplier` in deduct + check before `toGrams`; cookHistory `servings` rounded to 2 dp; `(×N)` toast only when `!== 1`; `cookedMeals` untouched; scaled missing-check runs before cook; captured-reference input read (correct for showConfirmDialog's close-before-onConfirm ordering); invalid/empty → 1× fallback.
untested: runtime multiplier deductions (2× / 0.5× / invalid) and real-device rendering remain human verification — the smoke suite does not drive the cook dialog. Pre-existing `buttons-functional.spec.js` / `recipe-actions.spec.js` fixture failures are unrelated (documented in prior TASK entries).

## TASK-008 · 2026-07-06
suite: deterministic parser check for `confirmBulkAdd()` inline expiry preprocessing; git diff --check; npm test; npx playwright test --reporter=list --workers=1 --timeout=30000; npx playwright test tests/mobile-layout.spec.js --reporter=list --workers=1 --timeout=30000; npx playwright test tests/smoke.spec.js --reporter=list --workers=1 --timeout=30000; npx playwright test tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=240000; npx playwright test tests/mobile-layout.spec.js tests/recipe-actions.spec.js --reporter=list --workers=1 --timeout=30000
result: deterministic parser check passed 5/5 cases (no token, shared expiry, per-line override, invalid matching date fallback warning, spaced `exp:` no-match). `git diff --check` passed with only Git LF-to-CRLF warnings. `mobile-layout.spec.js` passed 1/1; `smoke.spec.js` passed 1/1; `button-smoke.spec.js` passed 1/1. `npm test` timed out after 124s; full single-worker Playwright timed out after 184s; `buttons-functional.spec.js` timed out after 244s without reporter output. Split local run passed `mobile-layout.spec.js` and failed 2/2 `recipe-actions.spec.js` cases because recipe-card controls were hidden in that fixture; no failure traced to TASK-008 changes.
untested: full Playwright suite completion remains unverified because suite commands timed out; direct browser bulk-add check could not run because direct `chromium.launch` failed with `spawn EPERM`; real-device rendering remains human verification

## TASK-006 · 2026-07-05
suite: npm test -- --reporter=list; npx playwright test --reporter=list --workers=1 --timeout=60000 --global-timeout=300000; npx playwright test tests/mobile-layout.spec.js --reporter=list --workers=1 --timeout=60000; static QA/code trace for `#bulk-add-default-storage`
result: targeted mobile-layout spec passed (1/1). Full single-worker run passed `button-smoke.spec.js`, then failed/timeboxed in `buttons-functional.spec.js` (1 passed, 3 failed, 17 did not run) because `#kitchen-setup-modal` intercepted nav clicks and `#add-recipe-btn` was hidden. Initial npm test timed out after 244s without reporter output. No failure traced to TASK-006 changes.
untested: full Playwright suite completion remains unverified; direct selector browser check could not run because direct `chromium.launch` failed with `spawn EPERM` and a temporary-spec command was sandbox-blocked; real-device rendering remains human verification

## TASK-004 · 2026-07-03
suite: npx playwright test tests/mobile-layout.spec.js --reporter=list; npm test -- --reporter=list
result: mobile-layout spec ran past onboarding/nav fixture blockers and failed on a real overflow finding: `planner (+23px)`; full suite timed out after 304s
untested: full Playwright suite completion remains unverified because `npm test` timed out

## TASK-003 · 2026-07-03
suite: targeted local Playwright modal check; npx playwright test tests/mobile-layout.spec.js --reporter=list; npm test -- --reporter=list
result: targeted check passed; mobile-layout spec failed before relevant assertions because `#kitchen-setup-modal` intercepted `.tab-btn[data-tab="recipes"]`; full suite timed out after 304s
untested: full Playwright suite completion remains unverified because `npm test` timed out; real-device rendering remains human verification

## TASK-002 · 2026-07-03
suite: targeted local Playwright modal check; npx playwright test tests/mobile-layout.spec.js --reporter=list; npm test -- --reporter=list
result: targeted check passed; mobile-layout spec failed before relevant assertions because `#kitchen-setup-modal` intercepted `.tab-btn[data-tab="recipes"]`; full suite timed out after 304s
untested: full Playwright suite completion remains unverified because `npm test` timed out; real-device rendering remains human verification

## TASK-001 · 2026-07-03
suite: npm test
result: not completed — sandbox run failed with `spawn EPERM`; approved runs timed out after 124s and 304s
untested: visual browser baseline and full Playwright suite remain unverified. Diagnostic `npx playwright test tests/mobile-layout.spec.js --workers=1 --reporter=list --timeout=60000` failed before the CSS overflow assertion because `#kitchen-setup-modal` intercepted the `.tab-btn[data-tab="recipes"]` click.

<!-- Entries go here, newest first. -->
