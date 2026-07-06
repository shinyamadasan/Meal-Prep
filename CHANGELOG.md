# Changelog

> **Codex writes; Claude reads.** Append-only. One entry per completed task.
> Archive entries older than the current milestone to `docs/history/changelog-archive.md`.

---

## TASK-007 — done (branch: task-007)
changed:
  - app.js (`markRecipeCooked()` adds the portion prompt; `checkMissingIngredients()`, `deductIngredientsForRecipe()`, and `_doMarkCooked()` pass and apply the multiplier, 58 loc)
tests: `node --check app.js` (pass); cook multiplier function probe (prompt markup, 2x, 0.5x, invalid fallback, and scaled missing-check cases pass); `npx playwright test tests/mobile-layout.spec.js --reporter=list --workers=1 --timeout=60000` (1 passed); `npm test -- --reporter=list --workers=1 --timeout=60000 --global-timeout=300000` (button-smoke passed, then `buttons-functional.spec.js` hit unrelated fixture failures)
blockers: none for TASK-007
deviations: full suite did not complete because `buttons-functional.spec.js` still opens against fixture state where `#kitchen-setup-modal` intercepts nav clicks and `#add-recipe-btn` is hidden; direct browser probe could not run because `chromium.launch` failed with `spawn EPERM`, so multiplier-specific behavior was verified by executing the changed cook-flow functions with DOM/save/render stubs
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
