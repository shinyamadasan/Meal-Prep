# Changelog

> **Codex writes; Claude reads.** Append-only. One entry per completed task.
> Archive entries older than the current milestone to `docs/history/changelog-archive.md`.

---

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

## TASK-025 — done (branch: task-025)
changed:
  - app.js (`parseRecipeText()` stops instruction capture at standalone Nutrition/Notes headers and returns parsed `nutritionPerServing` from pipe-delimited or newline nutrition blocks, 39 loc)
tests: `node --check app.js`; deterministic `parseRecipeText()` harness (4 cases, all pass); `npx playwright test tests/smoke.spec.js tests/button-smoke.spec.js --reporter=list` (2 passed); `npm test` (21 passed)
blockers: none
deviations: none
→ status set to `review` in TASKS.md

<!-- Entries go here, newest first. -->
