# TASK-079 — Home Favorites and Air Fryer

Date: 2026-11-06 (America/Phoenix)
Branch: `task-079-home-favorites-air-fryer`
Base: `origin/main` at `e4971561db8455e320bfd24cbd9c26a1323e46b1`
Worktree: `C:/Users/Admin/AppData/Local/Temp/meal-prep-home-favorites-air-fryer`

## Implemented, exactly two features

1. **❤️ My Favorites on Home**: `renderHomeFavorites()` derives every recipe with strict
   `favorite === true`, with no cap and no dependency on recipe search/filters. Compact cards
   reuse existing picker/recipe styles, `openRecipeDetailsModal()` for read-only viewing,
   `toggleFavorite()` and `addPlannedBatch()`. Already-planned recipes show Added to Plan and
   cannot create a duplicate. Home refreshes on recipe renders (favorite, edit, delete, import)
   and existing dashboard refreshes. Empty-state guidance and a two-column desktop/single-column
   mobile grid are included. No separate favorite list or persistence field.
2. **Air Fryer method**: `air-fryer` is added to `RECIPE_EQUIPMENT` and a primary
   `RECIPE_QUICK_FILTERS` entry. Existing vocabulary-driven create/edit controls, normalization,
   pasted Equipment metadata, generic JSON imports/exports and saved recipes retain it. The chip
   matches explicit tags only and combines with search/favorites/category filters. Zero-match
   guidance follows the existing method pattern; an entirely empty library retains chip hiding.
   No oven recipe, sample or recommendation ranking is automatically changed.

Application delta: **app.js +30 lines, style.css +22 lines, zero deleted lines**. Only equipment,
quick-filter and Home render/style additions. Exact patch: application.patch. Source/test hashes
and Git blobs: CANDIDATE_SHA256.json. Existing inventory, shopping, sync and MCP implementations
are unchanged. Add to Plan still invokes its existing derived shopping refresh; none of that
logic was altered. No new framework, dependency, collection, storage key, schema or export version.

## Browser verification

Every fixture is synthetic and every new test blocks non-loopback requests. Full/related gates
use offline-playwright.config.cjs to prevent external browser requests, including telemetry.

| Gate | Result |
|---|---|
| Before, unchanged e497156 | New21: **1 pass / 20 fail** over before.json (16 failures) and review-before.json (1 existing empty-library compatibility pass, 4 failures) |
| New feature cases after | **21/21 pass**, included in focused-final.json |
| Features + existing cooking-method/metadata/discovery/recipe-edit/plan-picker suites | **109 pass / 0 fail / 0 skip / 0 flaky**, focused-final.json |
| Affected existing paste-import suite | **12/12 pass**, paste-final.json |
| Complete npm local regression | **834 pass / 0 fail / 0 skip / 0 flaky**, zero runner errors, 283.739 seconds; full-regression.json |
| Syntax / whitespace | `node --check` app/spec/config and `git diff --check` pass |
| Decision pointers | **118/118 pass**, decisions.txt |
| Documentation scanner | **55 historical warnings, zero new**; baseline/candidate outputs byte-identical |

Full command:
`npm test -- -- --config=feature-evidence/task-079/offline-playwright.config.cjs --workers=2`

Focused command:
`npx playwright test tests/home-favorites-air-fryer.spec.js tests/cook-method-discovery.spec.js tests/low-effort-metadata.spec.js tests/low-effort-discovery.spec.js tests/recipe-edit-preservation.spec.js tests/plan-persistence-and-picker.spec.js --project=local --config=feature-evidence/task-079/offline-playwright.config.cjs --workers=2 --reporter=json --output=test-results/task079-focused`

Coverage includes desktop 1280/mobile 390 layout, all 17 favorites independent of filters, strict
boolean membership, empty state, existing read-only details with no saved-data mutation, Add to
Plan/duplicate prevention/reload, remove/reload, Recipes and picker favorite changes, numeric and
malicious string ids, inert text, immediate edit/delete refresh, create/edit submit and reload,
explicit-only equipment, combined filters, empty-library policy, pasted metadata and JSON 1.1/1.6
import/export compatibility. Full suite includes existing Shop/Prep/Fridge and MCP-related browser
contracts. Worker code and live MCP were not changed or invoked.

The initial green run was 20/21: the new conjunction test tried clicking an existing hidden native
Favorites checkbox. It was corrected to use the existing visible label; application code was not
changed for this fixture. Initial output is retained as focused-initial.json, not reported as final.

The first full run was **833 pass / 1 fail**. Its only failure was the existing pasted-equipment
regression that explicitly classified Air fryer as unknown. The new requirement makes that
expectation obsolete. Its input is unchanged (Air fryer, Oven, Sous vide machine); the exact
expected array now includes air-fryer and oven, still rejecting Sous vide machine. Only that
expectation and its comment changed. The independent reviewer confirmed this requirement-driven
update; full-regression-initial.json/full-console-initial.txt retain the initial result. Affected
paste suite and complete gate are rerun before final handoff.

## Screenshots and visual inspection

All four screenshots show this local candidate with synthetic recipes. The implementer and
independent reviewer inspected them with view_image; Home has no horizontal overflow/overlap,
all favorite actions are visible, and the Air Fryer chip/results/method badge are readable.

| Feature | Desktop 1280 | Mobile 390 |
|---|---|---|
| Home Favorites | [Home desktop](home-1280.png) | [Home mobile](home-390.png) |
| Air Fryer | [Recipes desktop](air-fryer-1280.png) | [Recipes mobile](air-fryer-390.png) |

Existing Recipes mobile toolbar horizontal behavior, including the partly offscreen Add action,
was retained; no unrelated toolbar changes are included.

## Review and handoff

Separate reviewer `/root/release_hardening_review` appended a **Scoped PASS** for TASK-079
in REVIEW.md, with no remaining must-fix. It independently enumerated all 834 final local
results, verified focused 109/paste 12 evidence and all four candidate hashes, reviewed the
requirement-driven paste expectation update, and re-inspected all four final screenshots.
GO for owner review/integration. Merge/deployment still require explicit owner approval.
The reviewer changed REVIEW.md only; implementation, commit and publication remain separate.

SELF_REVIEW.md Code Health checklist passes: reuse of existing state/actions, no orphan/debug
code, no speculative abstractions, no module/build changes, minimal scoped selectors and normal
imperative rendering. Would ship this scoped candidate: yes, after owner integration approval.
AI-verifiable QA checks cover new handler/DOM resolution, safe string ids, preserved persistence
and cloudReady guards, compatibility, responsive viewport checks, scope and unchanged baseline
warnings. TASKS.md/journals carry active task evidence; legacy planning/DONE bookkeeping is not
used to mark this task done. Real-device checks remain a human gate.

Limits: all favorites are shown, so many favorites make Home longer. Air Fryer tags are explicit
and must be selected on existing recipes; older clients with the previous vocabulary cannot
recognize the slug until refreshed. Real iOS/Android devices and production sync/live MCP were
not tested. No production writes, migration, merge or deployment occurred; original checkout,
its screenshots, and previous evidence are untouched. Task remains review, not done.
