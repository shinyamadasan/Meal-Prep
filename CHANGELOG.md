# Changelog

> **Codex writes; Claude reads.** Append-only. One entry per completed task.
> Archive entries older than the current milestone to `docs/history/changelog-archive.md`.

---

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
