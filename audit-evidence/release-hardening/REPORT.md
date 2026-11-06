# TASK-078 — Phase 1 release hardening

Date: 2026-11-06 (America/Phoenix)
Branch: `task-078-reliability-recovery-v1`
Worktree: `C:/Users/Admin/AppData/Local/Temp/meal-prep-reliability-recovery-v1`
Preserved Phase 1 checkpoint: `6f035312e9253c729f5a26f0da0a81b69c576c76`
Release base: `origin/main` at `144c7f5252b7c7a32bd6c48572fa13b8cbd10fa9`

## Scope and preservation

Continued the existing implementation. All 47 prior audit/recovery files retain identical bytes,
sizes and SHA-256 hashes, including the original 27 audit artifacts and prior REPORT.md/results.
The earlier independent review is preserved; release-hardening review is appended separately.
The original task-072 checkout remains at 3b1a7db with its pre-existing untracked screenshots.
A detached checkout of 6f03531 was used only for synthetic before-repair verification.
No Phase 2, merge, deployment, migration, production data access/write or live MCP invocation.

## Confirmed defects and exact repairs

| Severity | Root cause / affected functions | Repair and regression evidence |
|---|---|---|
| High | Imported recipe ids/servings/text were interpolated into HTML and inline handlers in renderRecipes, recipeSelectionCard, renderWeeklyPlanner, renderStorageAlerts, filterRecipesByNutrition, addRecipeToPlanFromNutrition, openPrepMode, renderBatchPickerResults, plannedBatchRowHtml, renderPrepTab and Home recipe actions. escJ protected JavaScript quotes but not the containing HTML attribute. | Added escJAttr for JS-then-HTML escaping including CR/LF/U+2028/U+2029; kept the CSS-selector escJ use unchanged. Escaped displayed fields and DOM identifiers, preserved line endings via HTML character references, and converted the serving-plus operand to Number before interpolation. Entity-encoded, literal-quote, multiline and backslash payloads remain literal arguments, and actions still find the intended record. |
| High | Imported recipe ingredient name/quantity broke addIngredientField input value attributes; renderCookSuggestions failed to escape backslashes; openCSVPreviewModal rendered raw name/category/servings. | Escape form/preview output and use escJAttr for suggestion search assignment. Stored strings are retained; only rendering changes. Tests exercise editing, suggestion clicks and preview markup. |
| High | renderStorageGuide used raw name, unit, price, nutrition, freshness and storage notes, plus executable unquoted id arguments. | Escape displayed values, including numeric-looking imported strings. JSON-serialize then HTML-escape handler literals, preserving strict numeric/string CRUD ids. Both legacy numeric and malicious string ids edit the correct record. |
| High | renderCookingHacks used raw category/title/description/benefits and executable id arguments; inherited category names collided with its plain object. | Escape output and JSON+HTML id literals; group in Object.create(null) and use own-property icon lookup. constructor/__proto__ categories remain usable without prototype collisions. |
| High | restoreBackup allowed offline/accountless recovery; loadUserData subsequently applies cloud scalar history/session without a safe account-bound restore policy. Restore also ignored saveData's false cloud result. | Use the bounded restriction authorized by the owner: canRestoreBackup requires online + signed-in + cloudReady + transaction capability, before opening and again for the same uid at confirmation. Refusals leave runtime, primary data and backup untouched. Failed cloud confirmation reports local-only recovery, retains backup and directs retry before sign-out/reload. Successful guarded retry persists history/session through reload and mocked sign-in. |

Application hardening delta from 6f03531: **100 insertions / 84 deletions**, app.js only.
The exact patch is application.patch. Raw JSON/text/patch evidence preserves captured Windows
line endings through scoped binary/archival Git attributes; source, tests and Markdown retain
normal whitespace checks. The first staged check flagged those archival CRLF bytes and the
scoped attributes were corrected without rewriting any evidence. Helpers remain global, imperative and in the existing file.
The original 40 recovery tests retain their assertions; three mockCloud setup lines establish an
eligible account for successful restores. No new dependency, persisted field, export version,
cloud schema, ledger fact, stock math, sync merge policy or infrastructure was introduced.

## Reproducible evidence and acceptance

All data is synthetic. New browser tests abort non-loopback requests. The complete local gate
uses offline-playwright.config.cjs to block external browser requests, including telemetry.
Mocks establish cloudReady through loadUserData and an actual fake read; no guard is bypassed.

| Gate | Result |
|---|---|
| New 37 hardening cases on preserved 6f03531 | **2 pass / 35 fail**, zero skips/flaky; before-final.json |
| New 37 after repair | **37 pass / 0 fail**, included in focused-final.json |
| Focused hardening + original recovery + tombstone + durability + ledger | **135 pass / 0 fail / 0 skipped / 0 flaky**, focused-final.json |
| Complete npm local regression gate | **813 pass / 0 fail / 0 skipped / 0 flaky**, 268.836 seconds; full-regression.json |
| Recipe-import Worker | **9/9 pass**, worker-tests.txt |
| Conversational MCP bridge | **254/254 pass**, bridge-tests.txt |
| Decision pointers | **115/115 pass**, decisions.txt |
| Documentation consistency | **55 existing warnings, 0 new**; baseline and candidate output byte-identical |
| Evidence preservation | **47/47** prior files match sizes/hashes; includes original **27/27** audit artifacts |
| Syntax / whitespace / added credential signatures | pass; no changed secrets/config files; see validation and secret-scan evidence |

Full command:
`npm test -- -- --config=audit-evidence/release-hardening/offline-playwright.config.cjs --workers=2`

Focused command:
`npx playwright test tests/release-hardening.spec.js tests/reliability-recovery-v1.spec.js tests/tombstone-namespace.spec.js tests/meal-consumption-durability.spec.js tests/ledger-source-contract.spec.js tests/cross-repo-life-ledger-fixture.spec.js --project=local --workers=2 --reporter=json --output=test-results/hardening-focused`

Tests include desktop 1280px/mobile 390px inert imported output and reload, strict numeric/string
editing, prototype category names, card/Plan/picker/Nutrition/quick-plan/Prep/batch/Home handlers,
Home missing-ingredient Buy, storage alerts, What should we eat actions, expiry Plan it, nested
forms, CSV preview, all three Restore eligibility failures, eligibility/account changes while
confirmation is open, cloud failure with retained backup, stale-cloud sign-in and successful retry.
The full suite also covers existing Shop/Prep/Fridge and frontend MCP contracts; the bridge gate
covers its local authenticated/revision-guarded fixtures. Real production MCP behavior was not tested.

Intermediate results are retained: before-initial-fixture.json had incorrect modal ids and a
suggestion fixture with no eligible recipe. before.json predates final imported-order selector
corrections; review-before.json adds entity/multiline/composed actions (CSV matched the grep too).
focused-initial.json was 69/77 because selectors chose an existing record and normalization
legitimately changed updatedAt. These are not final results. Corrected final tests were rerun
against the detached preserved commit before the green gate; no application regression was
hidden by changing the original recovery assertions.

## Self-review and QA

Code Health checklist: pass. Existing helpers/styles retained; no new state or module system,
no unrelated cleanup, orphan/debug code, CSS or dependency changes. New helpers have callers.
Recipe handler ids stay quoted; strict-type storage/hack handlers use safe serialized literals.
Both local and cloud persistence still flow through saveData; read-before-write cloudReady,
patchMissingNutrition, tombstone namespaces, immutable ledger facts and deletion guards remain.
Would I ship the bounded candidate? Yes, subject to owner release approval and the limits below.

AI-verifiable QA: scoped acceptance, handler resolution, syntax, DOM references, storage/backward
compatibility, full regression, secret-signature delta and Git scope checked. Legacy QA references
to planning/TASK.md/DONE.md do not override TASKS.md or authorize marking this reviewed task done;
its execution contract and journals are updated instead. Existing 55 scanner warnings are reported
as baseline debt, not described as a clean global check. No rebase was needed: remote main was
verified unchanged at the base. Device-only checks remain pending in STATUS.md and the checklist.

## Independent review and release recommendation

Separate reviewer `/root/release_hardening_review` appended a **scoped PASS** to REVIEW.md,
with no remaining must-fix. It independently parsed all 813 actual local results, verified the
135 focused cases and corrected red37 baseline, recomputed all three candidate source hashes,
and checked all 47 preserved evidence entries, documentation warning equivalence and checklist.
Reviewed application SHA-256:
`c71e93cb54cc1f0a8f30ef11c358f4aef1ae2df3dee92b01165ce310aa5ec5f3`.
Git blob: `b2ff4ec6a6bdb540724bb07914eec16ec650f1a3`.
The reviewer changed REVIEW.md only; it did not implement, commit, publish or change task status.

Remaining limits:

1. Guest/offline Restore now requires sign-in/reconnection. The snapshot has no owner binding;
   this is a safe restriction, not general account isolation or automatic multi-device recovery.
2. Connectivity/account state can change after the guard and a transaction can fail. Local-only
   recovery remains subject to later cloud scalar precedence; keep the retained backup and retry
   before sign-out/reload. Do not describe this as an atomic cloud/local transaction guarantee.
3. Output hardening is scoped to the assigned recipe/storage/hack boundaries and related views,
   plus the earlier grocery repair. Other collections' existing raw-handler surfaces are outside
   this review; this is not a full-application XSS clearance.
4. Single backup slot/capacity, timestamp clock skew, broader concurrent-edit loss and cloud
   availability remain existing constraints. No production records were inspected or migrated.
5. Real iOS/Android devices, service-worker-upgrade behavior on actual devices and real cloud
   smoke checks were not run. sw.js is unchanged/network-first; offline clients can retain old code.

Final candidate must remain status review, never done. GO for owner review/integration of the
bounded Phase 1 candidate: the complete gate and independent verdict passed. NO-GO for merge,
deployment or production writes in this session: explicit owner approval has not been given.
RELEASE_CHECKLIST.md contains the unexecuted deployment and rollback procedure. Phase 2 is unstarted.
