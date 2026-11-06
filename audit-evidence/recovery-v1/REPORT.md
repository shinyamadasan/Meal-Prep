# TASK-078 — Reliability Recovery V1, Phase 1

Date: 2026-11-06 (America/Phoenix)
Branch: `task-078-reliability-recovery-v1`
Base: `origin/main` at `144c7f5252b7c7a32bd6c48572fa13b8cbd10fa9`
Worktree: `C:/Users/Admin/AppData/Local/Temp/meal-prep-reliability-recovery-v1`
Durable baseline evidence/acceptance-plan commit: `31ef148`

## Outcome and scope

Repairs are limited to the audit's imported-grocery execution, partial import rejection,
incomplete internal backups, and tombstone/restore defects, plus directly reachable paths
through the same import/Shop boundary. No stock math, availability redesign, Phase 2,
production data repair, deployment, merge or push is included.

The original checkout remains on its existing task-072 branch with its pre-existing
untracked screenshots untouched. The app/HTML/CSS/service-worker source at the audit
baseline matched current GitHub main. The repair branch starts from that main source,
not from older local main. The audit's original 27 artifacts were copied unchanged to
`audit-evidence/2026-11-06`, with SHA-256/size manifest and per-directory binary Git
attributes to prevent line-ending conversion. All 27 hashes match.
Raw archived logs and the exact patch retain captured whitespace; their scoped Git attributes
exclude that archival whitespace from style checks. Application/test/document source retains
normal whitespace checking. This preserves the evidence instead of rewriting historical logs.

## Root causes and exact repair boundaries

| Finding | Root cause | Code change |
|---|---|---|
| Executable imported grocery category | `renderGroceryList` inserted category, name, unit and sources as raw HTML; related Print/Prices repeated unsafe interpolation; inline IDs could escape JS handlers, including Not anymore? | Escape grocery text at rendering, not storage. JSON-serialize then HTML-escape handler arguments in the row, price inputs and `openNotInKitchenDialog`. Use null-prototype category groups in Shop, Prices and Print. Numeric and string ids still work; unsupported inherited-property ids are rejected before mutation. |
| Rejected import partially mutates state | `importData` changed live arrays/deletion maps before encountering malformed nested plan data, then falsely reported unchanged data | `validateSnapshotData` checks known structures; `prepareSnapshotChange` uses detached records and the existing merge helpers. `commitSnapshotChange` replaces state only after preparation, saves through `saveData`, and restores runtime data on local storage failure. Preparation rejection does not touch primary storage, backup or tombstones. Post-commit render/cloud failures are not described as an atomic rejection. |
| Incomplete internal backup | `snapshotData` omitted fields already persisted locally; `createBackup` swallowed failures while Clear/Import proceeded | Add `cookHistory` and `prepModeSession` to internal snapshots and restore them. Return backup success and abort Clear/Import on failure. Validate backups before mutation. Fill partial legacy restored weeks into seven complete day shapes. |
| Restored records disappear again | `restoreBackup` retained deletion markers for restored ids; conflict transaction filtered every tombstoned record, unlike read-path updatedAt LWW | Explicit restore timestamps only restored mutable records and clears only matching collection/id markers. Preserve unrelated current/backup deletion evidence. Transaction conflict filtering uses the same updatedAt comparison as `applyTombstones`: stale markers lose; a later genuine deletion still wins. |

The application diff changes only `app.js`: 206 insertions and 142 deletions at final review.
Existing `mergeWeeklyPlan`, `mergePlannedBatches`, and `mergeDeletions` accept a detached
target for preparation; their default live-state behavior remains available to all other callers.
No new persisted field, library, framework, module system or cloud schema was introduced.
Scoped feature/data-model notes and D-083 document the repair policy.

## Compatibility and user-data implications

- Export format remains **1.6**. Valid partial recipe exports labeled 1.1 through 1.6 are covered.
  Missing optional legacy fields are allowed. New provided malformed structures are refused
  instead of partly applied. Historically unsupported Object.prototype-style ids/price/deletion
  keys are refused explicitly, avoiding silent drops or inherited-property confusion.
- Imports retain existing duplicate-id/local precedence, fill-only plans, optional recipe
  metadata, and unknown recipe properties. Existing nutrition-goal/exported-history semantics
  were not redesigned. JSON export still omits cooking history/prep state; this phase repairs
  the internal `mealPrepBackup`, not a new export version.
- A restore intentionally brings back records in its snapshot, keeping ids, recipe links,
  cookedDate, initial portions and other historical values. Only mutable `updatedAt` is refreshed.
  Only corresponding collection tombstones are cleared; an identical id in another collection
  and unrelated deletions are preserved. Supported legacy flat tombstone normalization remains.
- `mealConsumptions` and conflict evidence use the existing canonical unions, not replacement.
  Restore neither invents an ate event nor removes newer accepted facts. Life Ledger fields,
  ordinary cooked-food deletion paths and the aggregate MASS_DELETE_GUARD remain unchanged.
- Old backups without history/session restore them as `[]`/`null`; absent planned batches retain
  the older fallback. Present partial weekly plans become complete usable seven-day plans.
- Valid imports remain saved locally if cloud synchronization fails; the UI says cloud sync is
  pending. No test bypasses cloudReady: mock sign-in uses `loadUserData` and an actual fake read.

## Regression evidence

All browser checks use fresh contexts and synthetic data. New tests route only loopback requests;
the complete `npm test` gate additionally uses `offline-playwright.config.cjs` to block external
browser requests, including telemetry, while retaining the same local project and test files.
Worker/bridge suites use their local fixtures. No production MCP reads or writes were invoked.

| Check | Before repair | Final repaired candidate |
|---|---|---|
| 40 new Phase 1 cases | **7 pass / 33 fail**, zero skips: 24 original cases in `before-corrected.json`, 11 review cases in `review-before.json`, 5 final cases in `final-before.json` | **40 pass / 0 fail**, included in focused gate |
| Focused recovery, deletion namespace, durable consumption, ledger and cross-repo fixture | Existing compatibility cases were not changed to hide failures | **98 pass / 0 fail / 0 skipped / 0 flaky**, `focused-final.json` |
| Complete local npm regression gate | November 6 audit: 733 pass, 3 transient timeouts; narrow rerun 5/5 passed | **776 pass / 0 fail / 0 skipped / 0 flaky** in 252.747 seconds, `full-regression.json` |
| Recipe-import Worker | Audit 9/9 | **9/9**, `worker-tests.txt` |
| Conversational bridge | Audit 254/254 | **254/254**, `bridge-tests.txt` |
| Syntax / whitespace | — | `node --check` app/spec and `git diff --check` pass |
| Decision pointers | — | **112/112 pass**, including new D-083 pointers |
| Documentation identifier scan | **55 warnings** on untouched baseline | **55 warnings, 0 new**; this global check is not clean |
| Original audit artifact integrity | 27 preserved artifacts | **27/27** sizes/hashes match |

Exact final full command:

```text
npm test -- -- --config=audit-evidence/recovery-v1/offline-playwright.config.cjs --workers=2
```

Focused final command:

```text
npx playwright test tests/reliability-recovery-v1.spec.js tests/tombstone-namespace.spec.js tests/meal-consumption-durability.spec.js tests/ledger-source-contract.spec.js tests/cross-repo-life-ledger-fixture.spec.js --project=local --workers=2 --reporter=json --output=test-results/recovery-focused
```

Reproduction coverage includes desktop/mobile inert category text, malicious string ids and
the Not anymore? action, price/print views, structural errors before and late in preparation,
failed backup/primary saves, all supported export labels, history/session completeness,
Clear → reload → Restore, actual mocked sign-in/transaction writes, stale-marker realtime
replay, and later genuine deletion. A signed-in Clear/Restore test verifies history/session
are published before cloud reload, not merely copied into a matching mock document.

Intermediate failures are retained, not presented as final results: the first mock readiness
helper called `loadFromFirestore` instead of `loadUserData`; this was corrected and the original
baseline was rerun in a detached checkout. An initial price-handler quote error was caught by
the added security regression and fixed. The bridge's first temp-worktree run lacked installed
packages; existing installed dependencies were copied without changing versions or downloading.
An earlier 771-case full run was deliberately stopped for final reviewer-found repairs. Only
the subsequent 776-case frozen-candidate run is the final complete gate.

## Self-review, independent review, and remaining limits

Code health: existing architecture and helpers retained, no new AppState persistence registry,
no unrelated refactor or cleanup, no direct new primary-local-only write path, no changes to
Firestore read-before-write guard, deletion namespaces or immutable source-fact schemas.
Applicable code/syntax/persistence/DOM/compatibility checks pass. The global documentation
scanner still reports its unchanged historical drift; those 55 warnings were not silently fixed.

Independent reviewer: separate agent `/root/phase1_independent_review`, read-only application
review; permitted to append its verdict to `REVIEW.md` only. It requested the additional
price/print/correction-dialog and malformed-data regressions, then confirmed the fixes.
Final independent verdict **PASS**, including the completed full-suite evidence. Reviewed app SHA-256:
`c722095e095d06710fece803b506b03d16f43ae1c7df801ff8d79bda4a840518`.

Material existing risks, deliberately outside this phase:

1. An **offline** restore followed later by sign-in to a stale cloud document can still lose
   scalar cooking history/prep-session state because general sign-in reconciliation gives those
   cloud fields precedence. The repaired online restore and internal backup round trips do not
   establish a general offline multi-device guarantee.
2. Other imported collections still have pre-existing raw HTML/inline-handler surfaces (recipes,
   storage-guide entries and hacks). The guarantee here is grocery category/row data through
   the repaired Shop views; this is **not** a full-app XSS clearance.
3. Single-slot local backup capacity, timestamp/clock-skew dependence and broader concurrent-edit
   loss remain. No production data was inspected or migrated to validate these risks.
4. Real iOS Safari/Android device testing and production sync/smoke testing were not performed.
   Desktop/mobile Chromium viewports and fake Firebase reconciliation are the evidence boundary.

Recommendation: **GO for owner review of the bounded Phase 1 candidate**: focused, complete
regression, worker and independent review gates passed. Task status is `review`, not `done`.
**NO-GO for production rollout in this session**:
approval is absent and the broader security/sync limitations require explicit triage.
Phase 2 remains unstarted.
