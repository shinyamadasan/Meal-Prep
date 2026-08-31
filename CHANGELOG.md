# Changelog

> **Codex writes; Claude reads.** Append-only. One entry per completed task.
> Archive entries older than the current milestone to `docs/history/changelog-archive.md`.

---

## TASK-059 / D-075 — landed (branch: wave/fridge-prepared-flavors-and-inventory-check)
merged: reviewed candidate `089d097` landed via `--no-ff` merge `2259a4b` (parents `4b44ed9`
  + `089d097`). Pre-landing local `main` and `origin/main` both pointed at `4b44ed9`; merge-base
  was `4b44ed9a7d1970a5d3318f291acb2dce2aa40feb`.
scope: reviewed product/docs/test files from `089d097` entered unchanged: `app.js`, `index.html`,
  `style.css`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`,
  `docs/FEATURES.md`, `tests/fridge-prepared-flavors.spec.js`,
  `tests/inventory-verification.spec.js`, `tests/kitchen-truth.spec.js`,
  `tests/meal-lego.spec.js`, `tests/prepared-flavors.spec.js`,
  `tests/ready-food-protein-hardening.spec.js`, and
  `tests/ready-food-protein-identity.spec.js`. `git diff 089d097 HEAD -- <reviewed files>` was
  empty immediately after the merge.
review: independent review PASS, no P0/P1/P2. D-032 was `approved`; owner later authorized landing.
  Accepted P3 remains deferred: in a genuine concurrent Firestore write collision,
  `inventoryVerifiedAt` follows the existing scalar-field local-wins merge behavior rather than a
  newer-timestamp comparison.
local gates before merge: focused D-075 specs 32/32; full local suite 606/606; `node --check app.js`
  OK; `Verify-Decisions.ps1` 61/61; `git diff --check` clean. `Check-DocsConsistency.ps1` reported
  the known 31-item baseline drift already present on `main`.
push/deploy: pushed product merge `2259a4b` to `origin/main`; local and remote matched immediately.
  Pages run `33365116743`, attempt 1, succeeded for SHA `2259a4b`.
first CI: Button tests run `33365117642`, attempt 1, SHA `2259a4b`, failed in
  `Run local suite (branch gate)`: 601 passed / 5 failed. Failures were unrelated
  `waitForRestored()` restore/seed-isolation paths; production-smoke steps were skipped by the
  workflow and the run was not re-run for green.
focused live smoke: isolated GitHub Pages profile passed D-075 checks against the deployed build:
  Prepared Flavors render in My Fridge from the same canonical `AppState.preparedFlavors` records,
  Fridge `Used 1` decrements the shared record and Flavor Library sees it, zero remaining writes the
  existing `preparedFlavors` tombstone, cooked-meal state is unchanged, `inventoryVerifiedAt` stores
  a valid ISO timestamp, persists through reload, replaces an older value, does not mutate inventory
  items, does not construct notifications, does not change flavor compatibility ranking, old data
  without the field loads as null, mobile controls remain visible, and no unexpected console/page
  errors occurred.
wave1-portion-truth: branch still contains `88b5598`; untouched.

## Owner-authorized landing - freezer chicken recipe repair
merged: reviewed candidate `df59336` from `data-repair/8-pasted-chicken-recipes` landed via
  `--no-ff` merge `1568cc7` (parents `71f4013` + `df59336`). Candidate branch HEAD was exactly
  `df59336`; `df59336..data-repair/8-pasted-chicken-recipes` was empty; `71f4013` was still both
  local `main` and `origin/main` before merge.
scope: only `app.js` and `tests/task-058-followup-8-recipe-repair.spec.js` entered `main`.
  Post-merge `git diff df59336 HEAD -- app.js tests/task-058-followup-8-recipe-repair.spec.js`
  was empty, proving the reviewed candidate landed unchanged.
review: reviewer PASS, owner-authorized landing released from hold; no P0/P1 findings; P1-A runtime
  derivation, P1-B general conflict protection, and P1-C null semantics confirmed closed.
local gates: `node --check app.js` OK; focused repair spec 18/18; paste-import metadata/range
  regression 12/12; `npm run test:local` 574/574; `npm test` 574/574; `Verify-Decisions.ps1`
  55/55; `git diff --check` clean. `Check-DocsConsistency.ps1` reported 31 pre-existing drift
  warnings; the same identifiers were already absent from the checked scopes at `71f4013`, so no
  new landing drift was introduced.
push/deploy: pushed `main` to `origin/main` at `1568cc7`; local and remote matched immediately
  after push. Pages run `33347783841` succeeded for SHA `1568cc7`; deployed `app.js`,
  `index.html`, `style.css`, `sw.js`, and `manifest.json` matched the Git `HEAD` blobs.
first CI: Button tests run `33347784678`, attempt 1, SHA `1568cc7`, failed only in
  `Run production smokes (post-deploy gate)`: 146 passed / 4 skipped / 1 failed. Local branch gate
  passed. Failure was `production-smoke-ready-food.spec.js` waiting for
  `#cooked-meals-list .cooked-use-one`; recorded as-is, not re-run for green.
focused live smoke: isolated GitHub Pages profile loaded the deployed app, seeded only throwaway
  localStorage data, executed `oneTimeRepairEightPastedChickenRecipes()`, and confirmed all five
  target recipe cards rendered, instructions were clean, metadata remained usable, null quantities
  stayed null/rendered blank, and no unexpected page/app errors occurred.
carried forward, NOT fixed: intentional unresolved ingredients remain Lemon Chicken Salt/Black
  pepper; Buffalo Ranch Chicken Salt/Black pepper/Green onion; Honey Mustard Chicken Salt/Black
  pepper/Parsley or thyme; Pineapple Teriyaki Chicken Pineapple chunks/Green onion/Sesame seeds;
  Honey Garlic Chicken none. P2 follow-up remains: `calculateRecipeCost()` can still produce `NaN`
  for a legitimately priced ingredient with `baseQuantity: 0`. P3 observations preserved:
  grocery aggregation internally collapses unresolved null to 0 though current UI does not show a
  fabricated quantity, and unrelated-recipe protection uses Sinangag as the sole non-target
  control.
wave1-portion-truth: branch still contains `88b5598`; untouched.

## TASK-057 / D-071 — landed (branch: d-071-tombstone-namespace)
merged: `--no-ff` into `main` at `bd89d5d` (parents `6e28903` owner-authorization record +
  `f73ce3c` reviewed branch HEAD). Reviewed commits `1f443ac` and `f73ce3c` landed unrebased,
  unsquashed and unamended. Pushed to `origin/main`.
gate: D-032 RED ZONE → `approved` (HELD) → explicitly released by the owner; authorization recorded
  on `main` in its own commit `6e28903` BEFORE the merge, per the D-040 convention.
shape: `AppState.deletions` flat `{ [rawId]: deletedAtISO }` → collection-keyed
  `{ recipes, pantry, customIngredients, customHacks, flavors, cookedMeals, userIngredients }`.
post-merge local: `node --check app.js` OK; `npm test` 404/404; `npm run test:local` 404/404;
  focused deletion/sync specs 154/154; suite-classification green; `Verify-Decisions.ps1` 41/41;
  `git diff --check` clean.
first push CI: **failed**, run `33000618114` attempt 1 — local gate 401 passed / 3 failed, all
  `waitForRestored()` 30s timeouts (`bulk-add-partial-retry:416`, `flavor-library:328`,
  `inventory-quantity-truth:81`); production gate skipped. Recorded as-is, NOT re-run for green.
  Pre-existing D-065 reload-race class: `bulk-add-partial-retry:416` already failed on `main` at
  run `32899800754` before D-071 existed, two of three specs are byte-untouched by this work, and
  `normalizeDeletions()` measures 0.0004–0.004 ms against a 30,000 ms timeout.
deployment: Pages run `33000615788` succeeded; `app.js`, `index.html`, `style.css`, `sw.js`,
  `manifest.json` all match landed `main` after line-ending normalization; deployed bundle contains
  every D-071 helper and the aggregate guard, with zero old per-vanish-guard or raw-id writes.
production smoke: `npm run test:prod` 137 passed / 4 skipped / 0 failed; targeted serial re-run of
  two specs that stalled under parallel navigation load 26/26; ten additional live D-071
  isolation / guard / migration / LWW proofs against the deployed URL, all passing.
docs: D-071 closed as landed in `docs/DECISIONS.md`; `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`,
  `planning/ROADMAP.md`, `planning/DONE.md`, `STATUS.md`, `REVIEW.md` and `TASKS.md` updated.
carried forward, NOT fixed: >`MASS_DELETE_GUARD` genuine vanish-diff deletes can still be suppressed
  indefinitely (predates D-071); `restoreBackup()` still does not restore deletions and
  `exportData()` still omits them; old clients preserve but do not honor nested tombstones; the ten
  live proofs are not yet a committed production-smoke spec.
→ TASK-057 `status: done`; D-071 CLOSED as landed and production-verified.

## TASK-057 repair — done (branch: d-071-tombstone-namespace)
changed:
  - app.js (`recordLocalDeletions()` restores the original aggregate `MASS_DELETE_GUARD` safety invariant before writing any collection-specific vanish-diff tombstones; `loadFromLocalStorage()` no longer applies/purges tombstones as a signed-out load side effect; conflict payload tombstones are normalized before assignment, 28 loc)
  - tests/tombstone-namespace.spec.js (adds the real multi-collection transient-empty regression, legitimate below-guard deletion proof, real source-patched namespace mutation, real source-patched aggregate-guard mutation, and rewrites the localStorage test to prove nested shape persistence without requiring signed-out tombstone application, 91 loc net)
tests: `node --check app.js` (pass); `npx playwright test tests/tombstone-namespace.spec.js --project=local --reporter=list` (22 passed); `npx playwright test tests/flavor-library.spec.js tests/cook-depletion-tombstones.spec.js tests/kitchen-truth.spec.js tests/starter-pack.spec.js tests/what-should-we-eat.spec.js --project=local --reporter=list` (126 passed); `npm run test:local` (initial sandboxed run failed before tests with `spawn EPERM`; escalated rerun passed 404/404); `npm test` (404/404); `npx playwright test tests/suite-classification.spec.js --project=local --reporter=list` (6/6); `powershell -ExecutionPolicy Bypass -File tools/Verify-Decisions.ps1` (38/38 pointers valid); `git diff --check` (pass, LF/CRLF warnings only)
review repair:
  - Independent review found a P0 aggregate-guard regression: the first implementation evaluated `MASS_DELETE_GUARD` inside each collection, allowing small collections to write phantom tombstones when many records disappeared across the whole synced state.
  - Fixed behavior now computes vanished ids per collection, totals them across all `TOMBSTONE_KEYS`, writes zero tombstones when the aggregate count exceeds `MASS_DELETE_GUARD`, and preserves `_idBaseline` unchanged so a transient empty can re-align when state repopulates.
  - Base safety semantics are restored while keeping nested collection-aware tombstones, collection-specific explicit writers, LWW, the 180-day horizon, `saveData()`, `cloudReady`, and Firestore architecture intact.
transient-empty regression: fixture with 40 recipes, 30 pantry, 14 customHacks, 8 customIngredients, 3 flavors, 2 cookedMeals and 1 userIngredient transiently emptied all collections; result was zero tombstones in every namespace, including the small `flavors`, `cookedMeals`, and `userIngredients` buckets.
below-guard deletion: three legitimate disappearances across recipes, flavors and userIngredients wrote exactly those three collection-specific tombstones.
explicit >5 deletion: existing cook-depletion proof remains green; six explicit pantry depletions still bypass the vanish-diff guard and write six pantry tombstones.
P1 removal: removed the `purgeOldTombstones()` / `applyTombstones()` calls added to `loadFromLocalStorage()`. The localStorage test now proves nested deletion shape serialization/deserialization only; signed-out local load behavior stays at the base contract.
mutation evidence: namespace mutation source-patches production `applyTombstones()` to union every deletion bucket and proves collateral recipe/hack/pantry deletion returns. Aggregate-guard mutation source-patches production `recordLocalDeletions()` to bypass the aggregate guard and proves phantom small-collection tombstones appear.
`AppState.deletions` access audit: unchanged from the prior handoff except the conflict retry now assigns `normalizeDeletions(AppState.deletions)` instead of the live object. Remaining app hits are normalized persistence, loaders, helper normalization, sign-in tombstone counts, realtime adoption, or comments.
final diff audit: nested collection-aware tombstones remain; ambiguous legacy tombstones remain dropped; explicit writers remain collection-specific; aggregate `MASS_DELETE_GUARD` now matches base safety semantics; `loadFromLocalStorage()` no longer applies tombstones as a new side effect; no unrelated persistence behavior was added.
remaining risks: old-client interoperability remains unresolved by design: old clients treat nested deletion buckets as inert, preserve/round-trip them, and do not honor new-client deletions. Backup/export tombstone asymmetry remains a product-contract follow-up, unchanged here.
blockers: none
deviations: `npm run test:local` needed one escalated rerun after the sandboxed process failed with `spawn EPERM` before tests started; no test failure was rerun without a code/environment cause. No push, merge or rebase.
→ status remains `review` in TASKS.md

## TASK-057 — done (branch: d-071-tombstone-namespace)
changed:
  - app.js (`AppState.deletions` now normalizes to `{ collection: { id: deletedAtISO } }`; added `normalizeDeletions()`, `deletionBucket()`, `writeTombstone()`, `readTombstone()`, `clearTombstone()`, and `tombstoneCount()`; made baseline diff, apply, merge, purge, storage, Firestore, sign-in, realtime and import paths collection-aware; preserved `saveData()`, `cloudReady`, `MASS_DELETE_GUARD`, 180-day purge and LWW semantics, 232 loc net)
  - tests/tombstone-namespace.spec.js (new D-071 reproduction, namespace isolation, legacy migration, persistence/sync paths, import, backup/export asymmetry and mutation-check coverage, 19 cases)
  - tests/flavor-library.spec.js (kept the two D-071-pinned test names verbatim, inverted their assertions from known-bug flat collision to namespace isolation, and updated flavor tombstone checks to the nested shape, 28 loc)
  - tests/cook-depletion-tombstones.spec.js, tests/kitchen-truth.spec.js, tests/starter-pack.spec.js (updated existing local assertions/setup from flat tombstones to the relevant collection bucket, 41 loc)
  - tests/production-smoke-cook-method.spec.js, tests/production-smoke-cook-tombstones.spec.js, tests/production-smoke-kitchen-truth.spec.js (production-smoke audit found flat-shape assertions that would break after deploy; updated them to the nested shape, 19 loc; not run because production cannot pass until this branch is deployed)
tests: `npx playwright test tests/tombstone-namespace.spec.js --project=local --reporter=list` (19 passed); `npx playwright test tests/flavor-library.spec.js --project=local --reporter=list` (47 passed); `npx playwright test tests/kitchen-truth.spec.js tests/cook-depletion-tombstones.spec.js tests/starter-pack.spec.js tests/what-should-we-eat.spec.js --project=local --reporter=list` (79 passed); focused final run across all six touched local specs (145 passed); `npm test` (401 passed); `node --check app.js` (pass)
prefix validation:
  - Proven exclusive by repository inspection before implementation: `flv-` is minted only by Flavor Library/default flavors; `cm_` only by cooked-meal ids; `ui_` only by user ingredients; `buy_`, `ib_`, and `staple_` only by pantry/inventory purchase/staple flows.
  - Additional discovered product-created ids are bare numeric, timestamp-shaped, `p_` test-only, user/import supplied, or otherwise not collection-identifiable; they are ambiguous and are not inferred.
old deletion shape: flat `{ [rawId]: deletedAtISO }`, applied against every `TOMBSTONE_KEYS` collection.
new deletion shape: nested `{ recipes, pantry, customIngredients, customHacks, flavors, cookedMeals, userIngredients }`, each mapping its own ids to `deletedAtISO`.
legacy migration: no-key, legacy flat and already-namespaced payloads normalize safely and idempotently. Only exclusive-prefix legacy keys migrate (`flv-` → `flavors`, `cm_` → `cookedMeals`, `ui_` → `userIngredients`, `buy_`/`ib_`/`staple_` → `pantry`).
ambiguous tombstones: ambiguous legacy keys are dropped and counted with a one-time `console.warn`; no `_legacy` bucket is persisted, and numeric tombstones no longer apply globally. Some ambiguous historical deletes may become capable of resurrection from stale remote data after this migration, because their original collection identity was already lost before the migration ran. That is preferable to continuing deterministic cross-collection data loss.
explicit writers changed: `clearLocalStorage()`; `deleteSelectedPantryItems()`; `clearExpiredPantryItems()`; `unstockPurchasedGroceryItem()`; `deductIngredientsForRecipe()`; `removeAttentionItem(kind, id)`; `removeAllExpired()`.
generic vanish-diff: `collectSyncedIds()`, `snapshotIdBaseline()` and `recordLocalDeletions()` now preserve collection identity end to end; `MASS_DELETE_GUARD` still applies per collection and keeps the skipped baseline when a collection looks transiently empty.
apply/merge/purge: `mergeDeletions()` merges per collection with later timestamp winning; `applyTombstones()` filters each list only by its own bucket while preserving LWW; `purgeOldTombstones()` keeps the 180-day horizon per bucket.
`AppState.deletions` access accounting:
  - `saveToLocalStorage()` and `snapshotData()` write normalized nested maps.
  - `loadFromLocalStorage()`, `loadFromFirestore()` and the realtime listener normalize incoming maps before applying tombstones.
  - `buildFirestorePayload()` writes the normalized nested map.
  - `saveToFirestore()` conflict retry carries merged nested tombstones and filters payload records via `readTombstone(collection, id)`.
  - `loadUserData()` compares tombstone totals through `tombstoneCount()` during sign-in local/cloud reconciliation.
  - `ensureDeletions()` is the only direct normalizing assignment helper; all direct writers route through `writeTombstone()` and all collection reads route through `deletionBucket()` / `readTombstone()`.
  - Remaining mentions are comments documenting the nested shape and starter/flavor tombstone behavior.
localStorage result: save/load round-trip writes and reloads nested tombstones; recipe id `5` tombstone removes only recipe `5`.
Firestore result: `buildFirestorePayload()` and `loadFromFirestore()` round-trip nested tombstones; same-id records in other collections survive.
sign-in merge result: local recipe tombstone unions into cloud data without deleting same-id hack.
concurrent/cloud merge result: conflict retry merges remote tombstones and filters only the tombstoned collection.
realtime result: remote deletion adoption applies only the remote tombstone's collection.
import behavior: import clears tombstones only for ids imported into that same collection; `groceryList` is not tombstone-cleared because it is not in `TOMBSTONE_KEYS`.
backup/export asymmetry: `snapshotData()` still captures normalized deletions, but `restoreBackup()` intentionally still does not restore them; changing that would expand the restore product contract beyond D-071. `exportData()` still omits deletions while `importData()` clears tombstones for imported records; adding export tombstone support would also expand the product contract, so it remains unchanged and should be a Claude/owner follow-up if desired.
mutation-check: `tests/tombstone-namespace.spec.js` includes a mutant that collapses namespaces back to a flat map and confirms the collateral-damage signature returns: recipe id `5` deletion also removes pantry/customHacks/customIngredients/cookedMeals/userIngredients id `5`.
blockers: none
deviations: production-smoke specs with flat-shape assertions were updated under TASK-057 §G even though they were not listed in the initial `files:` list; they were not run because they target the deployed site and cannot pass until this branch is deployed. Pre-existing dirty `planning/CODEX_READY.md` and `planning/DIGEST.md` were not edited or staged.
→ status set to `review` in TASKS.md

## D-070 — landed (branch: wave-flavor-library)
changed:
  - app.js (Flavor Library model, CRUD, persistence registration, starter prompt, and UI render
    flow)
  - index.html (Flavor Library tab, controls, list mount, and edit modal)
  - style.css (Flavor Library tab/list/modal styling)
  - docs/ARCHITECTURE.md; docs/DATA_MODEL.md; docs/DECISIONS.md; docs/FEATURES.md;
    planning/ROADMAP.md (Flavor Library and D-071 records)
  - tests/flavor-library.spec.js; tests/kitchen-truth.spec.js (Flavor Library coverage and suite
    inventory)
tests: pre-merge local verification passed: `tests/flavor-library.spec.js` 47/47,
  `npm run test:local` 382/382, `npm test` 382/382, suite-classification 6/6,
  `tools/Verify-Decisions.ps1` passed
blockers: first push-triggered CI run `32983219373` failed as recorded: local suite 381 passed,
  one timeout in `tests/inventory-quantity-truth.spec.js` at `waitForRestored()`;
  `workflow_dispatch` skipped because the push-triggered run did not succeed
deviations: no TASKS.md status change; D-071 remains open; Ready Food → "Try with" and Meal Lego
  remain deferred; `wave1-portion-truth` remains untouched at `88b5598`
→ merged `--no-ff` to `main` at `b219e20` and pushed to `origin/main`

## TASK-040 — approved, held for /merge (branch: task-040)
changed:
  - tests/buttons-functional.spec.js (the "Clear All empties the list" test now clicks
    `.confirm-ok-btn` on the custom `showConfirmDialog` overlay instead of listening for a native
    browser `dialog` event that no longer fires since TASK-036, 2 loc)
tests: `npx playwright test tests/buttons-functional.spec.js -g "Clear All empties"` (1 passed,
  previously failing); full suite `npx playwright test --reporter=list --workers=1
  --timeout=60000 --global-timeout=300000` (21/21 passed)
blockers: none
deviations: none — discovered while investigating TASK-037's auto-merge gate failure; the
  regression was already flagged as a known gap in TASK-035's review nits
→ status set to `approved` in TASKS.md (held for human /merge, though test-fixture-only)

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
