# Changelog

> **Codex writes; Claude reads.** Append-only. One entry per completed task.
> Archive entries older than the current milestone to `docs/history/changelog-archive.md`.

---

## TASK-039 — approved, held for /merge (branch: task-039)
changed:
  - app.js (`openPrepMode()` now passes `recipe.name`, `ing.name`, `qty`, `ing.unit`, and `step`
    through the existing `escapeHtml()` before interpolating into the `.innerHTML` template, 5 loc)
tests: `node --check app.js` (pass); `npx playwright test tests/smoke.spec.js
  tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=60000` (2 passed, 467 buttons
  discovered, 200 clicked, 0 broken); deterministic payload check (`<img src=x onerror=alert(1)>`
  escapes to `&lt;img src=x onerror=alert(1)&gt;`, no raw `<img` survives)
blockers: none
deviations: none — a confirmed security-guardian finding from TASK-027's own review (see
  `REVIEW.md`) that was never actually acted on because TASK-028 never completed a real review;
  the vulnerability has been live on `main` since TASK-027/028 merged
→ status set to `approved` in TASKS.md (security fix, red-zone, held for human /merge per D-032)

## TASK-036 — done (branch: task-036)
changed:
  - app.js (`restoreBackup()`, `clearLocalStorage()`, `deleteRecipe()`, `clearDay()`, `clearWeeklyPlan()`, `clearGroceryList()`, `deleteIngredient()`, `deleteHack()`, `loadWeekTemplate()`, and `deleteUserIngredient()` now use `showConfirmDialog()` callbacks instead of native `confirm()` guards, 64 loc net)
tests: `node --check app.js` (pass); `rg -n "confirm\\(" app.js` (zero matches); `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=60000` (2 passed; 467 buttons discovered, 200 clicked, 0 broken); `npm test` (21 passed)
blockers: none
deviations: none
→ status set to `review` in TASKS.md

## TASK-028 — done (branch: task-027)
changed:
  - app.js (`AppState.prepModeSession` now persists the active Prep Mode checklist through localStorage and Firestore; `openPrepMode()`, `togglePrepCheck()`, `closePrepMode()`, and startup restore paths maintain it, 49 loc)
tests: `node --check app.js` (pass); `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js` (2 passed; 467 buttons discovered, 200 clicked, 0 broken); `npm test` (21 passed)
blockers: none
deviations: no new localStorage key was added, but a new saved field inside `mealPrepAppData` / Firestore payload should be documented in `docs/DATA_MODEL.md` during Claude review; live close/reopen Prep Mode behavior remains human verification
→ status set to `review` in TASKS.md

## TASK-027 — done (branch: task-027)
changed:
  - app.js (`startVoiceInput()` appends each final bulk-add voice result as a trimmed line with a trailing newline, preserving manual textarea edits, 4 loc)
tests: `node --check app.js` (pass); `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js` (2 passed; 467 buttons discovered, 200 clicked, 0 broken); `npm test` (21 passed)
blockers: none
deviations: voice recognition behavior was verified by code trace and regression tests; live microphone/browser dictation remains human verification
→ status set to `review` in TASKS.md

## TASK-026 — done (branch: task-026)
changed:
  - index.html (`#pantry-clear-expired` button added near pantry Select/search controls, hidden by default, 1 loc)
  - app.js (`getExpiredPantryItems()` derives expired pantry rows, `renderPantryClearExpiredButton()` toggles visibility, `clearExpiredPantryItems()` confirms and writes explicit deletion tombstones before one `saveData()`, 46 loc)
tests: `node --check app.js` (pass); `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list` (2 passed, 467 buttons discovered, 200 clicked, 0 broken); `npm test -- --reporter=list` (21 passed)
blockers: none
deviations: bulk-delete 6+ expired items and real-device rendering remain human-verifiable; code trace confirms explicit tombstones are written before the single `saveData()` call
→ status set to `review` in TASKS.md

## TASK-034 — approved, held for /merge (branch: task-034)
changed:
  - tools/Run-Codex-Build.ps1 (new `Get-TaskBlockText`/`Get-TaskDeclaredFiles` helpers; after the
    existing deny-list guard, computes changed files not declared by any tracked task and not a
    standard evidence file; writes a task-ID-tagged note to gitignored `.scope-note.txt` on
    mismatch, soft — never blocks the build)
  - tools/Run-Claude-Review.ps1 (reads `.scope-note.txt`, uses it only if it names the task
    currently under review, always deletes it after reading; folds it into the Claude reviewer
    prompt as an explicit item to address in REVIEW.md)
  - .gitignore (added `.scope-note.txt`, same transient-handoff-file convention as
    `.last-phase-result.txt`)
tests: `[System.Management.Automation.Language.Parser]::ParseFile` on both changed files (pass);
  fixture harness against the file/scope-parsing helpers, extracted via brace-matching (8/8
  assertions pass); second fixture harness against the note read/match/consume logic (6/6
  assertions pass)
blockers: none
deviations: no live end-to-end run (would require a real build that genuinely touches an
  undeclared file) — disclosed as unverified-live in TEST_REPORT.md rather than claimed
→ status set to `approved` in TASKS.md

## TASK-033 — approved, held for /merge (branch: task-033)
changed:
  - tools/Generate-Digest.ps1 (builds the digest incrementally, stops before a safe char threshold,
    appends a "+N more" note instead of truncating the raw string)
  - tools/Dispatch-Commands.ps1 (stale-lock check verifies the recorded PID is actually still
    running; lowered the still-running staleness wait from 2 hours to 45 min; sends a Telegram
    notice via the existing OUTBOX relay when it clears a stale lock; /status now reports lock age)
tests: `[System.Management.Automation.Language.Parser]::ParseFile` on both files (pass); digest fix
  run against this app's own real planning/PROPOSALS.md (530 chars, unaffected at this size);
  stale-lock/status logic confirmed byte-identical to ChronaSense's already fixture-tested version
blockers: none
deviations: ported from the sibling ChronaSense app (its TASK-002), which hit both bugs live first
  in the same session as this app's own TASK-032 port in the opposite direction
→ status set to `approved` in TASKS.md (red-zone automation surface, held for human /merge)

## TASK-032 — approved, held for /merge (branch: task-032)
changed:
  - tools/Run-Codex-Build.ps1 (before auto-chaining a status:-review build into review, requires the
    build touched CHANGELOG.md or TEST_REPORT.md; blocks as a no-op with a clear note otherwise, 23 loc)
  - tools/Dispatch-Commands.ps1 (factored build/review classification into a shared
    Resolve-ReviewOutcome; added crashed-review-retry and no-op-retry cases; fixed a HELD-vs-APPROVED
    false-positive; added a pending-review-resume step to Invoke-Autopilot so plain /go resumes a
    stuck review; RETRYING vs NEEDS YOU summary wording, 95 loc net)
tests: `[System.Management.Automation.Language.Parser]::ParseFile` on both files (pass, no syntax
  errors); isolated fixture harness against Resolve-ReviewOutcome (7 cases / 16 assertions, all pass);
  5-case check of the no-op $hasEvidence guard logic (all pass, including the exact TASK-025 repro)
blockers: none
deviations: full live end-to-end verification (a real crashed review, a real no-op retry) not
  attempted -- not safely reproducible without spawning real codex/claude CLI processes against a
  live branch; flagged for human verification on the next real occurrence
→ status set to `approved` in TASKS.md (red-zone automation surface, held per D-032/Hard Rule 10)

## TASK-025 — done (re-applied on main; original branch task-025 not merged)
changed:
  - app.js (`parseRecipeText()` stops instruction capture at standalone Nutrition/Notes headers and returns parsed `nutritionPerServing` from pipe-delimited or newline nutrition blocks, 41 loc including the security fixes below)
re-apply: Codex built this on branch `task-025` (`03b6b7c`); Claude review (`e3c227e`) found 2 CONFIRMED security-guardian findings (no explicit key whitelist before the nutrient-key dispatch; unclamped numeric values) and required specific fixes. The rework-retry commit (`a24cdbc`) flipped `TASKS.md` status to `review` without applying either fix (`app.js` was byte-identical to the pre-review version), and the automated `claude -p` re-review then crashed (exit 1) before catching that — same crashed-auto-review class as TASK-007/TASK-014. Claude applied both must-fix patches directly (`RECOGNIZED` key whitelist with early return; `Math.min(Math.max(value, 0), 99999)` clamp), committed them to `task-025` (`663478b`, pushed for the record), then re-applied the isolated `app.js` hunk onto current main via `git apply --3way` (clean; branch NOT merged — it was ~30+ commits stale behind main).
tests: `node --check` (pass); deterministic `parseRecipeText`/`parseNutritionLines` harness (9 cases: original 4 from the first build plus 5 new — clamps a 99999999 value to 99999, drops `__proto__`/`constructor` keys with no own-property or global `Object.prototype` pollution, still parses a recognized key listed after unrecognized ones, Notes-header stop without nutrition scan; all pass); Playwright `smoke` + `button-smoke` (2 passed; 467 buttons discovered, 200 clicked, 0 broken) — run once on the fixed `task-025` branch and again after the `git apply --3way` onto main.
blockers: none — the prior `blocked` state was Codex's no-op retry plus a crashed auto-review, now resolved.
→ status set to `done` in TASKS.md (reviewed + approved this cycle).

## TASK-014 — done (branch: task-014)
changed:
  - tools/Dispatch-Commands.ps1 (`Get-UntriagedCaptureCount` counts fresh inbox captures; `Invoke-Autopilot` plans when either unconverted BUILD_QUEUE work or untriaged captures exist; idle triage-only runs reply with the next approval action, 19 loc)
tests: PowerShell parser check for `tools/Dispatch-Commands.ps1` (pass); isolated `/go -DryRun` fixture with one `captures/inbox` `status: new` file and no build-ready tasks (reported `TRIAGED 1 new idea(s) into proposals`); repo inbox count check found 11 untriaged captures; `git diff --check -- tools/Dispatch-Commands.ps1` (pass with Git LF-to-CRLF warning only); `npm test` timed out after 124s without reporter output
blockers: none
deviations: full Playwright suite completion remains unverified because `npm test` timed out under the tool limit
→ status set to `review` in TASKS.md

## TASK-013 — done (branch: task-013)
changed:
  - app.js (`importData()` stamps every imported-id survivor across recipes, pantry, custom ingredients, hacks, user ingredients, cooked meals, and grocery list with one import-time `updatedAt` before `saveData()`, 11 loc)
tests: `node --check app.js` (pass); temporary Playwright TASK-013 import spec (1 passed; not committed); `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=60000` (2 passed, 466 buttons, 0 broken)
blockers: none
deviations: `npm test -- --reporter=list --workers=1` timed out after 304s without reporter output; live Firebase/emulator reload-after-2-min import verification remains human/emulator verification
→ status set to `review` in TASKS.md

## TASK-012 — done (branch: task-012)
changed:
  - app.js (`reportError()` comment now says the Sentry SDK bundle is loaded and initialized with the DSN in `index.html`, 2 loc)
tests: `node --check app.js` (pass); `rg -n "Loader Script" app.js` (no matches); `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=60000` (2 passed, 466 buttons, 0 broken)
blockers: none
deviations: `npm test -- --reporter=list --workers=1` timed out after 304s without reporter output
→ status set to `review` in TASKS.md

## TASK-011 — done (branch: task-011)
changed:
  - app.js (`renderPantry()` adds transient select mode rows with checkboxes, `renderPantryBulkActions()` shows selected-count/move/delete/cancel controls, bulk move reuses the pantry storage mutation path, and bulk delete explicitly writes tombstones before `saveData()`, 121 loc)
  - index.html (`#pantry-select-toggle` and `#pantry-bulk-actions` added near the pantry controls, 2 loc)
  - style.css (`.pi-select-checkbox`, selected row state, and `.pantry-bulk-actions` styling, 35 loc)
tests: `node --check app.js` (pass); temporary Playwright TASK-011 behavior spec (1 passed; not committed); `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=60000` (2 passed, 465 buttons, 0 broken); `npx playwright test tests/mobile-layout.spec.js --reporter=list --workers=1 --timeout=60000` (1 passed)
blockers: none
deviations: `npm test -- --reporter=list --workers=1` timed out after 304s without reporter output; real-device touch feel remains human verification
→ status set to `review` in TASKS.md

## TASK-010 — done (branch: task-010)
changed:
  - app.js (`renderRecipes()` keeps the detail scaler + `.recipe-ingredients` visible by default, moves recipe instructions into `.recipe-instructions hidden`, keeps `toggleRecipeDetails()` as the instructions toggle with `aria-expanded`, and updates `openRecipeFromHome()` so it no longer rewrites the instructions toggle, 32 loc)
  - style.css (`.recipe-instructions.hidden` shares the existing hidden detail rule and the recipe toggle comment now describes instructions-only collapse, 5 loc)
tests: `node --check app.js` (pass); `git diff --check -- app.js style.css` (pass); temporary Playwright TASK-010 behavior spec (1 passed; not committed); `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=60000` (2 passed, 465 buttons, 0 broken)
blockers: none
deviations: `npm test -- --reporter=list --workers=1` timed out after 304s without reporter output; real-device recipe-card visual polish remains human verification
→ status set to `review` in TASKS.md

## TASK-009 — done (branch: task-009)
changed:
  - style.css (`.recipe-card-header`, `.recipe-title`, and `.recipe-category` use the existing smaller spacing/type tokens for a tighter recipe card header, 4 loc)
tests: `git diff --check` (pass); `npx playwright test tests/mobile-layout.spec.js --reporter=list --workers=1 --timeout=60000` (1 passed)
blockers: none
deviations: `npm test -- --reporter=list --workers=1` timed out after 604s without a pass/fail result; real-device visual polish remains human verification
→ status set to `review` in TASKS.md

## TASK-007 — done (re-applied on main; original branch task-007 not merged)
changed:
  - app.js (`markRecipeCooked()` opens a portion-multiplier prompt before the missing-check; `deductIngredientsForRecipe()`, `checkMissingIngredients()`, `_doMarkCooked()` take an optional `multiplier = 1` and scale deduction / missing-check / cookHistory servings, plus a `(×N)` toast suffix, 53 loc)
re-apply: Codex built this on branch `task-007` (`d8acde3`), but the auto-review crashed (`claude -p` exit 1) and the branch went ~12 commits stale after D-028/029/030. Re-applied the isolated app.js hunks onto current main via `git apply --3way` (clean); the stale branch was NOT merged.
tests: `node --check` (pass); Playwright `smoke` + `button-smoke` (2 passed; 460 buttons, 0 broken); 8/8 acceptance criteria code-traced (see TEST_REPORT / REVIEW).
blockers: none — the prior `blocked` state was the crashed auto-review, now resolved.
→ status set to `done` in TASKS.md (reviewed + approved this cycle).

## TASK-008 — done (branch: task-008)
changed:
  - index.html (`#bulk-add-modal` hint and `#bulk-add-textarea` placeholder document inline `exp:YYYY-MM-DD`, 2 loc)
  - app.js (`confirmBulkAdd()` strips exact inline expiry tokens, warns on invalid matching dates, and applies `perLineExpiry || bulkExpiry`, 17 loc)
tests: deterministic parser check (5 cases, all pass); `npx playwright test tests/mobile-layout.spec.js --reporter=list --workers=1 --timeout=30000` (1 passed); `npx playwright test tests/smoke.spec.js --reporter=list --workers=1 --timeout=30000` (1 passed); `npx playwright test tests/button-smoke.spec.js --reporter=list --workers=1 --timeout=240000` (1 passed)
blockers: none for TASK-008
deviations: `npm test` and full-suite Playwright runs timed out under tool limits; split runs show unrelated `tests/recipe-actions.spec.js` fixture failures where recipe-card controls are hidden, and `tests/buttons-functional.spec.js` timed out without reporter output
→ status set to `review` in TASKS.md

## TASK-006 — done (branch: task-006)
changed:
  - index.html (`#bulk-add-modal` adds the default storage selector above `.bulk-voice-row`, 9 loc)
  - app.js (`openBulkAddModal()` resets `#bulk-add-default-storage`; `confirmBulkAdd()` applies the non-empty selector as pantry `storage`, 5 loc)
tests: `npx playwright test tests/mobile-layout.spec.js --reporter=list --workers=1 --timeout=60000` (1 passed); `npx playwright test --reporter=list --workers=1 --timeout=60000 --global-timeout=300000` (button-smoke passed, then `buttons-functional.spec.js` hit unrelated fixture failures); `npm test -- --reporter=list` timed out after 244s without reporter output
blockers: none for TASK-006
deviations: full suite did not complete because `buttons-functional.spec.js` opens against fixture state where `#kitchen-setup-modal` intercepts nav clicks and `#add-recipe-btn` is hidden; focused selector behavior was verified by code trace because direct `chromium.launch` hit `spawn EPERM` and a temporary-spec command was sandbox-blocked
→ status set to `review` in TASKS.md

## TASK-004 — done (branch: task-001)
changed:
  - tests/mobile-layout.spec.js (seeds `pantryOnboardingDone`, closes open modals after load, and routes `nutrition` through the More menu, 6 loc)
tests: `npx playwright test tests/mobile-layout.spec.js --reporter=list` reaches overflow assertion and reports real `planner` overflow; `npm test -- --reporter=list` timed out
blockers: none for TASK-004
deviations: `mobile-layout.spec.js` now surfaces a real app overflow on `planner`; app fix is outside this task's test-fixture-only scope
→ status set to `review` in TASKS.md

## TASK-003 — done (branch: task-001)
changed:
  - index.html (`#custom-item-modal`, `#user-ingredient-modal`, `#bulk-add-modal`, and `#paste-recipe-modal` now use modal size classes, 4 loc)
tests: targeted local Playwright modal check (desktop widths, mobile stacking, and `#prep-mode-modal` unchanged, pass); `npx playwright test tests/mobile-layout.spec.js --reporter=list` blocked by TASK-004 fixture; `npm test -- --reporter=list` timed out
blockers: none for TASK-003
deviations: branch remained `task-001` because the workspace already had unrelated uncommitted work; no branch switch attempted
→ status set to `review` in TASKS.md

## TASK-002 — done (branch: task-001)
changed:
  - index.html (`#username-modal` uses `modal-content--sm`; button row uses `.modal-footer`, 2 loc)
tests: targeted local Playwright modal check (desktop/mobile computed layout and handlers, pass); `npx playwright test tests/mobile-layout.spec.js --reporter=list` blocked by TASK-004 fixture; `npm test -- --reporter=list` timed out
blockers: none for TASK-002
deviations: branch remained `task-001` because the workspace already had unrelated uncommitted work; no branch switch attempted
→ status set to `review` in TASKS.md

<!-- Entries go here, newest first. -->
