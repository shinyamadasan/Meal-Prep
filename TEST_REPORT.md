# Test Report

> **Codex writes; Claude reads.** Append-only. One entry per task run.
> Tests use Playwright: `npm test` (all), `npm run test:smoke`, `npm run test:functional`.

---

## TASK-061 / D-077 landing + TASK-060 release gate · 2026-09-26
suite: on fast-forwarded `main` f58bfe5 before pushing, `npm test`, `node --check` (config, server, new
  spec), `git diff --check 207d262 HEAD`, `Verify-Decisions.ps1`. After pushing, the push-triggered
  GitHub Actions and Pages runs, plus a check of served files against Git blobs.
result:
  - pre-push: `npm test` 679/679 (includes local-harness-origin and suite-classification). node --check OK;
    diff-check clean; Verify-Decisions 74/74.
  - CI "Button tests" run 36236203757 (SHA f58bfe5), ubuntu, 2 workers. Local branch gate: 679 passed /
    0 failed; the log has zero `waitForRestored` / test-timeout lines. The production-smoke step RAN
    (not skipped): 147 passed / 0 failed / 4 skipped. The 4 are the pre-existing conditional
    notification-permission skips, the same 4 as before.
  - Pages run 36236203463: success. Served app.js, index.html, style.css, sw.js and manifest.json
    blob hashes match `HEAD` exactly.
not run: CI reruns (none needed; none attempted).

---

## TASK-061 / D-077 CI restore reliability · 2026-09-26
suite: local Windows machine (12 cores), Playwright 1.61 Chromium. Probes were throwaway specs
  outside the repo.
result:
  - CI evidence: run 36205338469 timed out at `waitForRestored` line 69 (the predicate), after
    `waitForAppReady` passed. Across 12 local-gate failed runs since 2026-08-25, the same shape
    appeared in 8 distinct specs. `seed-isolation` got 40 re-seeded recipes after verifying that its empty
    list was saved.
  - root-cause probe (fresh context, real app, Firebase aborted, `saveData()`, then immediate
    `page.reload()`, 16 workers):
    - `file://` single-shot: 2/400, 3/800 and 3/1000 lost the whole localStorage. Every loss
      showed `sawBoot:false`; the diagnostic run showed sessionStorage intact and no recovery on a
      second reload.
    - http://127.0.0.1 single-shot: 0/800 and 0/1500.
    - `file://` warm-context cycles: 0/1200.
    - Renderer PID identical across reload for both origins and for page.reload,
      location.reload and goto.
  - new spec alone plus suite-classification: 10/10.
  - guard negative proof: the check applied to HEAD 207d262 flags 41/41 local specs.
  - stress: 9 historically failing specs plus the new spec, ×10 at `--workers=16`: 1670/1670.
  - `npm test` (full local suite): 679 passed / 0 failed (675 existing + 4 new).
  - full local suite ×3 at `--workers=16`: 2037/2037.
  - `prod` project: listed only (151 tests, unchanged); not run, because it tests the deployed
    site, which this branch does not change.
  - `node --check` passes on the config, server and new spec. `git diff --check` is clean.
    `tools/Verify-Decisions.ps1` passes 74/74 pointers; `Check-DocsConsistency.ps1` 31 items (= `main` baseline).
not run: CI (not pushed); a pre-fix whole-suite stress baseline, because about 45 reloads ×3 at a
  0.36% loss rate predicts less than one failure, so it cannot discriminate.

---

## TASK-060 / D-076 production release verification + smoke follow-up · 2026-09-25
suite: post-push checks on deployed e6f7650; then `npm run test:prod` against the live site before and
  after the test-only follow-up on `wave/meal-prep-first-prod-smokes`.
result:
  - push: `origin/main` e7c3777 -> e6f7650 (fast-forward, no force). Pages run 36153456540:
    success. The served app.js/index.html/style.css/sw.js/manifest.json blob hashes match Git.
  - CI "Button tests" 36153457263 (SHA e6f7650): local branch gate 674 passed / 1 failed —
    `tests/cook-depletion-tombstones.spec.js` (restore timeout after reload). The
    production-smoke step was SKIPPED. Locally the same test passed 15/15 under
    `--repeat-each=15`. Not modified. Not re-run.
  - live functional smoke (temporary, uncommitted spec; throwaway profile; no sign-in;
    Firebase/Google requests blocked): 2/2. Covered scroll no-reload (page top + modal), nav
    labels, the Home flow and Fridge wording, an unscheduled batch, batch ingredients in Shop,
    purchase != Fridge meal, checkmarks surviving a servings "+", "Not anymore?", brief copy, and
    Prep -> Fridge.
  - `npm run test:prod` on e6f7650 with the ORIGINAL specs: 143 passed / 4 failed / 4 skipped. All 4
    failures are stale Home-layout expectations.
  - after the follow-up: the 4 affected tests 4/4; full `npm run test:prod` 147 passed / 0 failed /
    4 skipped. The skips are the pre-existing conditional notification-permission `test.skip`s in
    production-smoke-attention-notifications.spec.js; the same 4 skipped before.
not run: a green CI run (requires another push); real-device testing.

---

## TASK-060 / D-076 local landing · 2026-09-25
suite: on merged local `main` 9ba4c25: full `npx playwright test --project=local`; `node --check
  app.js`; `Verify-Decisions.ps1`; `Check-DocsConsistency.ps1`; `git diff --check e7c3777 HEAD`.
result: 675/675 passed (1.7m); `node --check` OK; Verify-Decisions 70/70; docs drift 31 (= baseline);
  diff-check clean. Tree identical to approved candidate 288fd58.
not run: production specs, CI, Pages deploy, live smoke — nothing was pushed.

---

## TASK-060 / D-076 review fix 1 · 2026-09-24
suite: new regression cases in tests/meal-prep-first.spec.js, run against the reviewed candidate's
  product code (app.js/index.html byte-identical to e1c9f1c, only the spec changed) and again after
  the fix; targeted specs; full `npx playwright test --project=local`; `node --check app.js`;
  `Verify-Decisions.ps1`; `Check-DocsConsistency.ps1`; `git diff --check`.
result:
  - on e1c9f1c product code: 4 failed / 1 passed. Failed: both REGRESSION checkmark cases
    (`checked` false after a batch +/-), the exact-identity Rice case (checked Rice lost), and the
    Fridge empty-state label. Passed as designed: the ghost-row/new-row/custom-row guard (it
    protects against OVER-preserving). An earlier run had 3 harness errors
    (`seedPlanRecipe` not defined in page), fixed before this count.
  - after fix: targeted meal-prep-first + scroll-no-reload + kitchen-truth +
    inventory-quantity-truth 76/76; full local suite 675/675 (3.5m), started after the last code
    change.
  - `node --check app.js` OK; `Verify-Decisions.ps1` 70/70; `Check-DocsConsistency.ps1` 31 items
    (= `main` baseline); `git diff --check` clean.
not run: production specs, CI, real-device testing.

---

## TASK-060 / D-076 build · 2026-09-24
suite: `npx playwright test tests/scroll-no-reload.spec.js --project=local` (before and after fix);
  `npx playwright test tests/meal-prep-first.spec.js --project=local`; full `npx playwright test
  --project=local`; `node --check app.js`; `tools/Verify-Decisions.ps1`;
  `tools/Check-DocsConsistency.ps1` (branch vs stashed `main`); `git diff --check`.
result:
  - scroll-no-reload BEFORE the fix: 3 failed / 1 passed (reload reproduced: sentinel lost, typed
    input lost, including a drag inside an open modal). AFTER: 4/4.
  - meal-prep-first: 13/13.
  - full local suite, first run: 659 passed / 10 failed. All 10 were intended-change collisions:
    5 AppState/payload key allowlists + 1 regex-based payload mutation test (fixed in CODE by
    keeping `inventoryVerifiedAt` adjacent to `lastUpdated`), and 4 "What should we eat?"
    placement/visibility assertions. Updated per D-076; content assertions unchanged.
  - full local suite, final run: 670/670 passed (2.8m), started after the last code/CSS change;
    only docs/TASKS/CHANGELOG/TEST_REPORT changed afterwards.
  - `node --check app.js` OK; `Verify-Decisions.ps1` 68/68; `git diff --check` clean;
    `Check-DocsConsistency.ps1` 31 items = the known `main` baseline (one new item from D-076 was
    found and fixed).
not run: production (`--project=prod`) specs — they test the deployed site, not this unmerged
  branch. No CI run (nothing pushed). No real-device touch test.

---

## TASK-059 / D-075 landing · 2026-08-31
suite: pre-landing Git integrity checks; `npx playwright test
  tests/fridge-prepared-flavors.spec.js tests/inventory-verification.spec.js --project=local`;
  `npx playwright test --project=local`; `node --check app.js`; `tools/Verify-Decisions.ps1`;
  `tools/Check-DocsConsistency.ps1`; `git diff --check`; first push-triggered GitHub Actions run;
  Pages deploy; focused isolated live smoke against GitHub Pages.
result: candidate `089d097` was exactly the head of
  `wave/fridge-prepared-flavors-and-inventory-check`, descended from merge-base
  `4b44ed9a7d1970a5d3318f291acb2dce2aa40feb`, with local `main` and `origin/main` both at
  `4b44ed9` before merge. Merged `--no-ff` at `2259a4b`; `089d097` was an ancestor of merged
  `main`; `git diff 089d097 HEAD -- <reviewed files>` was empty after merge.
  Local gates on the reviewed candidate passed: focused D-075 specs 32/32; full local suite
  606/606; `node --check app.js` passed; `Verify-Decisions.ps1` passed 61/61; `git diff --check`
  was clean. `Check-DocsConsistency.ps1` exited 1 with 31 known drift items already present on
  `main`, so no new landing drift was introduced.
  Push advanced `origin/main` to `2259a4b`, matching local `main`. Pages deployment run
  `33365116743`, attempt 1, succeeded for SHA `2259a4b`. First CI run `33365117642`, attempt 1,
  workflow `Button tests`, SHA `2259a4b`, failed in `Run local suite (branch gate)` with 601 passed
  / 5 failed: `tests/flavor-library.spec.js` activeTime restore timeout,
  `tests/inventory-quantity-truth.spec.js` eggs merge restore timeout, `tests/kitchen-truth.spec.js`
  grocery transfer restore timeout, and two `tests/seed-isolation.spec.js` restore/empty-install
  failures. Production-smoke workflow steps were skipped because the local gate failed first; no CI
  re-run was started.
  Focused live D-075 smoke against GitHub Pages passed in an isolated browser profile. It verified
  deployed bundle helpers, Prepared Flavors in My Fridge, shared canonical `preparedFlavors` state,
  Fridge `Used 1` decrement visible from Flavor Library, zero-portion tombstone removal, cooked-meal
  state unaffected, `inventoryVerifiedAt` valid ISO persistence/reload/replacement, no pantry/cooked
  mutation, no notification construction, no flavor-compatibility ranking change, old-data null
  compatibility, mobile visibility, and zero unexpected console/page errors.
untested: the built-in CI production-smoke suite did not run on the first Button tests attempt
  because the local gate failed first. The focused live smoke used throwaway localStorage only and
  did not touch a real signed-in user's Firestore data. The accepted P3 concurrent scalar
  merge-order nuance remains deferred by owner-approved D-032 landing.

## Owner-authorized freezer chicken repair landing · 2026-08-31
suite: pre-landing Git integrity checks; `node --check app.js`; focused repair spec; paste-import
  regression; `npm run test:local`; `npm test`; `Verify-Decisions.ps1`;
  `Check-DocsConsistency.ps1`; `git diff --check`; first push-triggered GitHub Actions run; Pages
  deploy/served-blob comparison; focused isolated live smoke against GitHub Pages.
result: candidate `df59336` was exactly the head of `data-repair/8-pasted-chicken-recipes`, still
  descended from reviewed base `71f4013`, and changed only `app.js` plus
  `tests/task-058-followup-8-recipe-repair.spec.js`. Merged `--no-ff` at `1568cc7` with parents
  `71f4013` and `df59336`; `git merge-base --is-ancestor df59336 HEAD` passed; `git diff df59336
  HEAD -- app.js tests/task-058-followup-8-recipe-repair.spec.js` was empty.
  Local gates on merged `main`: `node --check app.js` passed; repair spec 18/18; paste-import
  metadata/range regression 12/12; `npm run test:local` 574/574; `npm test` 574/574;
  `Verify-Decisions.ps1` 55/55; `git diff --check` clean.
  `Check-DocsConsistency.ps1` exited 1 with 31 potential drift warnings; all reported identifiers
  were already missing from the checked code scopes at `71f4013`, so this was recorded as
  pre-existing docs drift, not landing fallout.
  Push advanced `origin/main` to `1568cc7`, matching local `main`. First CI run `33347784678`,
  attempt 1, workflow `Button tests`, SHA `1568cc7`: local gate passed; production-smoke gate
  failed with 146 passed / 4 skipped / 1 failed. The single failure was
  `production-smoke-ready-food.spec.js` waiting for `#cooked-meals-list .cooked-use-one`; no CI
  re-run was started. Pages deployment run `33347783841` succeeded for SHA `1568cc7`; served
  `app.js`, `index.html`, `style.css`, `sw.js`, and `manifest.json` matched Git `HEAD` blob hashes.
  Focused live smoke against GitHub Pages passed in an isolated browser profile: five target recipe
  cards rendered, `oneTimeRepairEightPastedChickenRecipes()` repaired all five with no skips or
  conflicts, instructions no longer contained metadata headings, metadata fields populated, null
  ingredients stayed null and rendered blank rather than as `0`, and no unexpected page/app errors
  were observed.
untested: no mutation was performed against real user recipe data; the one-time repair was exercised
  only in an isolated localStorage fixture. The broader first CI production-smoke suite remains red
  from the recorded ready-food timeout and was not re-run.

## TASK-057 / D-071 landing · 2026-08-26
suite: post-merge deterministic local suite on merged `main`; focused deletion/sync specs; decision
  pointer verification; first push-triggered GitHub Actions run; GitHub Pages deploy and
  served-asset comparison; production smoke against the deployed build; live D-071 proofs.
result: Merged `--no-ff` at `bd89d5d`. Local on merged main — `node --check app.js` OK;
  `npm test` 404/404; `npm run test:local` 404/404; focused specs (tombstone-namespace,
  flavor-library, cook-depletion-tombstones, kitchen-truth, starter-pack, what-should-we-eat,
  suite-classification) 154/154; `Verify-Decisions.ps1` 41/41; `git diff --check` clean.
  FIRST push-triggered CI FAILED and is recorded exactly as it happened, with no re-run: run
  `33000618114`, attempt 1, workflow `Button tests`, SHA `bd89d5d` — local gate 401 passed and 3
  failed, all `page.waitForFunction` 30s timeouts on `waitForRestored()` predicates
  (`bulk-add-partial-retry.spec.js:416`, `flavor-library.spec.js:328`,
  `inventory-quantity-truth.spec.js:81`); Pages-wait and production-smoke steps skipped because the
  local gate runs first. Classified as the pre-existing D-065 reload-race harness class, not a
  product regression: the same test at the same line already failed on `main` at run `32899800754`
  before D-071 existed; two of the three specs are byte-untouched by D-071 and the third's failing
  test is untouched; none of the predicates read `AppState.deletions`; and `normalizeDeletions()`
  measures 0.0004–0.004 ms per call against a 30,000 ms timeout.
  Pages deployment succeeded separately in run `33000615788`; served `app.js`, `index.html`,
  `style.css`, `sw.js` and `manifest.json` all match landed `main` after line-ending normalization,
  and the deployed bundle carries every D-071 helper plus `totalVanished > MASS_DELETE_GUARD` with
  zero old per-vanish-guard or raw-id tombstone writes.
  Production smoke against the deployed build: `npm run test:prod` 137 passed / 4 skipped / 0
  failed. An isolated re-run of three specs then hit two 7.1-minute navigation stalls against
  GitHub Pages — an environment/rate-limit symptom well outside the 30s test timeout, not a test
  failure — and a targeted serial re-run passed 26/26, including `kitchen-truth:259` (live bulk
  cleanup crossing MASS_DELETE_GUARD) and `cook-method:267` (tombstoned starter recipe not
  re-added). Ten further live proofs against the deployed URL all passed: cross-collection
  isolation both directions, flavor isolation, exclusive-prefix normalization, ambiguous-numeric
  drop with no global fallback, the aggregate transient-empty guard writing zero phantoms, a
  below-guard delete, LWW three ways, and no page/console errors.
untested: the ten live D-071 proofs are a landing verification artifact and are NOT committed as a
  production-smoke spec — pinning them is recommended follow-up. The pre-existing D-065 reload-race
  CI flake remains open and is not addressed here.

## TASK-057 repair · 2026-08-26
suite: `node --check app.js`; focused D-071 Playwright specs; full local suite; suite-classification; `tools/Verify-Decisions.ps1`; `git diff --check`
result: `node --check app.js` passed. `npx playwright test tests/tombstone-namespace.spec.js --project=local --reporter=list` passed 22/22, including the new multi-collection transient-empty aggregate guard regression, below-guard legitimate deletion proof, real namespace mutation, and real aggregate-guard mutation. `npx playwright test tests/flavor-library.spec.js tests/cook-depletion-tombstones.spec.js tests/kitchen-truth.spec.js tests/starter-pack.spec.js tests/what-should-we-eat.spec.js --project=local --reporter=list` passed 126/126. `npm run test:local` first failed before tests with sandbox `spawn EPERM`; escalated rerun passed 404/404. `npm test` passed 404/404. `npx playwright test tests/suite-classification.spec.js --project=local --reporter=list` passed 6/6. `powershell -ExecutionPolicy Bypass -File tools/Verify-Decisions.ps1` passed with all 38 pointers valid. `git diff --check` passed with LF/CRLF warnings only.
untested: deployed production-smoke verification after this branch is deployed; old-client interop remains a documented migration limitation, not solved in this patch.

## TASK-057 · 2026-08-26
suite: base-behavior reproduction; prefix-validation audit; `node --check app.js`; focused Playwright D-071 suites; full deterministic local suite `npm test`; production-smoke deletion-reference audit
result: Prefix validation passed for exclusive legacy prefixes: `flv-` → flavors, `cm_` → cookedMeals, `ui_` → userIngredients, and `buy_`/`ib_`/`staple_` → pantry. Before app changes, a temporary base reproduction in `tests/tombstone-namespace.spec.js` passed against the old flat behavior, proving one raw `5` tombstone deleted recipe/hack/pantry/customIngredient/cookedMeal/userIngredient `5`. Final checks passed: `node --check app.js`; `npx playwright test tests/tombstone-namespace.spec.js --project=local --reporter=list` 19/19; `npx playwright test tests/flavor-library.spec.js --project=local --reporter=list` 47/47; `npx playwright test tests/kitchen-truth.spec.js tests/cook-depletion-tombstones.spec.js tests/starter-pack.spec.js tests/what-should-we-eat.spec.js --project=local --reporter=list` 79/79; final focused run across all six touched local specs 145/145; `npm test` 401/401. Production-smoke audit updated the three deployed-site specs whose deletion assertions would otherwise expect the old flat shape; those production specs were not run because the deployed site does not contain this branch yet.
untested: live deployed production-smoke verification after deployment; human/owner review for whether backup restore should ever restore tombstones or export should ever include them as a separate product-contract change.

## D-070 landing · 2026-08-26
suite: pre-merge local review checks; first push-triggered GitHub Actions run; GitHub Pages deploy
  and served-asset comparison
result: pre-merge local checks passed: `npx playwright test tests/flavor-library.spec.js --project=local --reporter=list`
  47/47, `npm run test:local` 382/382, `npm test` 382/382, suite-classification 6/6, and
  `tools/Verify-Decisions.ps1` passed. First push-triggered run `32983219373` (`Button tests`,
  event `push`, SHA `b219e202eb8b5a1e6208aa1638b3ec59e58ce911`) failed: local suite reported
  381 passed and one timeout in `tests/inventory-quantity-truth.spec.js` at `waitForRestored()`;
  Pages-wait and production-smoke workflow steps were skipped. GitHub Pages deployment run
  `32983147959` succeeded for the same SHA. Served `index.html`, `app.js`, and `style.css` from
  `https://shinyamadasan.github.io/Meal-Prep/` match landed `main` after line-ending normalization.
untested: `workflow_dispatch` verification was not run because the first push-triggered run did not
  succeed; D-071, Ready Food → "Try with", Meal Lego, and free-text protein inference remain
  deliberately deferred.

## TASK-040 · 2026-07-23
suite: `npx playwright test tests/buttons-functional.spec.js -g "Clear All empties" --reporter=list
  --workers=1 --timeout=60000`; full suite `npx playwright test --reporter=list --workers=1
  --timeout=60000 --global-timeout=300000`
result: targeted test passed (was failing before the fix — confirmed by reproducing the original
  failure first: `.confirm-overlay` was left un-clicked, `#grocery-list` still contained the test
  item). Full suite: 21/21 passed, confirming the fix doesn't affect any other test.
untested: none — this is a test-only change and the test itself is the verification.

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
