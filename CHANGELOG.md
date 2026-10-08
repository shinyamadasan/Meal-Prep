# Changelog

> **Codex writes; Claude reads.** Append-only. One entry per completed task.
> Archive entries older than the current milestone to `docs/history/changelog-archive.md`.

---

## TASK-075 — integrated / approved; Worker deployment pending (main: 0d1059e)
reviewed candidate: `0d1059e02483a3f059bdcb93d587ca521c897c28` (owner-relayed independent STRICT PASS)
integration: fast-forward on `main`; integration SHA equals reviewed candidate exactly.
contract: `shared/readyFoodContract.js` is consumed by browser app and Worker; source enum `leftovers | takeout`; fridge/freezer defaults `3/90`; ready-food servings require positive integers and fractional values reject before mutation.
tests: Worker operation/MCP/shared-contract suites 50/50; full bridge 211/211; shared-contract Playwright 1/1; syntax/diff checks clean; Wrangler 4.148.0 `versions upload --dry-run` passed.
blocker: Worker deployment/version capture and production acceptance pending. Wrangler remote inspection failed with invalid configured Cloudflare token (9109/10000; deployments list also rate limited 10429). No upload, deploy, or production MCP request was made.
state: TASK-075 `approved`, not `done`; TASK-076 not started because its start condition is TASK-075 `done`.

## TASK-074 — fix-first (branch: task-074; base: 85fcdda)
changed:
  - app.js (`setRecipeFormMode()` restores only controls it disabled for details mode and toggles the photo upload read-only class, 10 net loc)
  - tests/plan-persistence-and-picker.spec.js (Add/edit save restoration, retained business-disabled control, then-preview-again regressions, 59 loc)
tests: focused Plan/picker spec (28 passed); editor restoration (2 passed); recipe editor/modal specs (9 passed); `npm test` (724 passed)
blockers: none
deviations: no scope changes; TASKS.md remains `review`
deployment: none

## TASK-074 — done (branch: task-074)
changed:
  - app.js (`#recipe-modal`, `openRecipeDetailsModal()`, `renderBatchPickerResults()`,
    `plannedBatchRowHtml()`, and `setRecipeFormMode()` provide guarded read-only details from Plan,
    50 loc)
  - style.css (read-only controls remain legible; mutation controls and Save are hidden, 7 loc)
  - docs/FEATURES.md (documents title-button inspection from picker and Plan batches, 4 loc)
  - tests/plan-persistence-and-picker.spec.js (read-only, return state, action separation,
    keyboard, responsive and state-preservation coverage, 165 loc)
tests: focused Plan spec (26 cases, all pass); `npm test` (722 passed)
blockers: none
deviations: none
→ status set to `review` in TASKS.md

## TASK-073 — review (branch: task-073), fix-first round 1
fix (reviewer FIX FIRST, base 4c32dee, old candidate 1c4a9f3):
  - mcp.js + inventory.js setCountedQuantity(): mandatory expectedUnit precondition (non-empty string; exact equality with the stored unit; blank/null/non-string stored unit rejected; distinct unit_mismatch error; zero mutation). Never forwarded to setQuantity(), never persisted. No trimming, case folding or conversion helpers.
  - destructiveHint false -> true (overwrite is not additive). idempotentHint deliberately KEPT true: MCP defines it over identical arguments and expectedRevision is an argument, so an exact replay is a revision_conflict with zero mutation (asserted by test); owner/reviewer may overrule explicitly.
  - Tool description now states the 5-step flow and the g / 0.65kg example.
  - tests: +5 focused (exact-match matrix A-E + case/space + stale assumption H, blank/null F, I/J, schema G, idempotence replay); existing cases updated for the new required field.
original entry follows.

## TASK-073 — original round (branch: task-073)
changed:
  - workers/conversational-bridge/src/mcp.js (registered strict `set_inventory_quantity` tool: write-scope auth, revision guard, one guarded pantry write, sanitized errors via the shared stock-state mapper incl. `ambiguous`)
  - workers/conversational-bridge/src/operations/inventory.js (additive `setCountedQuantity()` wrapper: quantity > 0, existing row, non-staple only, no unit passed; delegates to the unchanged `setQuantity()`)
  - workers/conversational-bridge/test/mcp-set-quantity.node.js (17 focused auth, schema, over-posting, zero/staple/ambiguous, unit-preservation, revision, race, same-value, parity, persistence-failure and no-logic-in-mcp.js cases)
  - workers/conversational-bridge/test/mcp.node.js, test/mcp-stock-state.node.js, test/mcp-consume.node.js (tool-list assertions six -> seven only)
  - workers/conversational-bridge/README.md, docs/DECISIONS.md (D-082 absolute-count addendum)
decisions made here:
  - same-value set verified as a real write (updatedAt stamp + revision +1), so it is NOT collapsed into an unchanged no-op; this keeps REST parity.
  - annotations: readOnly false, destructive false (overwrite only; no delete/tombstone), idempotent true (absolute target converges; old-revision replay conflicts), openWorld false.
  - staple and ambiguous rows refused; zero refused (no silent translation to out-of-stock); no unit input.
not changed: setQuantity() body, REST routes, firestore.js, oauth.js, mcpAuth.js, scopes, app UI/CSS, dependencies, config, secrets.
not done by design: no merge, push, deploy, production access or production write.

## TASK-072 — done (branch: task-072)
changed:
  - workers/conversational-bridge/src/mcp.js (registered strict `mark_out_of_stock` and `mark_in_stock` tools; write-scope auth, revision guard, canonical operation delegation, guarded writes, no-op handling, sanitized errors, and explicit `ambiguous` mapping)
  - workers/conversational-bridge/test/mcp-stock-state.node.js (15 focused auth, schema, stock-state, tombstone, concurrency, replay, parity, isolation, and failure-sanitization cases)
  - workers/conversational-bridge/test/mcp.node.js and test/mcp-consume.node.js (exact six-tool surface assertions; four existing tools remain unchanged)
  - workers/conversational-bridge/README.md (six-tool contract, pantry-write scope, non-staple permanence, and next-open grocery reconciliation)
  - docs/DECISIONS.md D-082 (task-scoped scope addendum)
tests: workers/conversational-bridge/test/mcp-stock-state.node.js (15 cases, all pass); full bridge 184/184; root Playwright 711/711
blockers: none
deviations: none
deployment: none; production writes: 0
→ status set to `review` in TASKS.md

## TASK-071 — consume_ready_food mealConsumptions parity (branch: task-071, on top of d9fa050)
changed:
  - workers/conversational-bridge/src/operations/readyFood.js (new canonical `consumeReadyFood()` + `consumeWriteSpec()`; `consumePortions()` takes one shared instant and returns the consumed `amount`)
  - workers/conversational-bridge/src/firestore.js (read mask + `mealConsumptions` decode on read/patch/404 shell)
  - workers/conversational-bridge/src/index.js (REST consume route delegates to the canonical op)
  - workers/conversational-bridge/src/mcp.js (consume tool delegates to the canonical op; schema, annotations, scopes unchanged)
  - workers/conversational-bridge/test/consume-parity.node.js (new, 26 tests), test/firestore.node.js (+3)
  - workers/conversational-bridge/README.md (TASK-071 section)
- one guarded PATCH now writes cookedMeals + mealConsumptions (+ deletions.cookedMeals on the final serving); revision +1 once
- N servings = ONE fact (portionsConsumed = floored N); snapshots taken before removal; mc_<UUID> id; closed six-field schema
- REST parity: changed (same canonical op). MCP tool surface: unchanged (four tools). OAuth: unchanged. Not deployed.
- pre-fix production consume `cm_1791045734557_839` is NOT backfilled (no safe reconstruction)
blockers: none
→ status set to `review` in TASKS.md

## TASK-070 — strict-review fix-first corrections (branch: task-070, on top of e035b00)
changed:
  - workers/conversational-bridge/src/mcp.js (consume input schema now typed and required: `cookedMealId` non-empty string, `servings` plain number (not integer, so fractional >= 1 stays valid), `expectedRevision` non-negative integer; result shape is exactly `{ ok, revision, item, removed }` (top-level `cookedMealId` removed); redundant hand-rolled input checks deleted because the schema now enforces them)
  - workers/conversational-bridge/test/mcp-consume.node.js (result-shape updates; schema advertisement test; non-numeric vs out-of-range servings split; 2 deterministic barrier-based concurrent same-revision tests, partial and final-serving; now 26 tests)
  - workers/conversational-bridge/README.md (servings language corrected to the real `consumePortions()` semantics; result shape)
unchanged by design: oauth.js, mcpAuth.js, index.js, readyFood.js, firestore.js, package metadata, wrangler config, app/UI, Firestore rules.
notes: malformed `servings` type / `expectedRevision` / `cookedMealId` now fail with the MCP input-validation error instead of the REST validation text (accepted per the fix-first brief). A servings value whose floor is outside 1..99 (below 1, or 100 and above) still gets the domain message; 99.9 floors to 99 and is accepted. Local only; PRODUCTION_WRITE_COUNT 0.
→ status remains `review` in TASKS.md

## TASK-070 — MCP `consume_ready_food` write tool (branch: task-070)
changed:
  - workers/conversational-bridge/src/mcp.js (new `consume_ready_food` tool + `consumeReadyFoodTool` handler, own `CONSUME_ANNOTATIONS`, strict input schema, `TOOL_SECURITY_SCHEMES` entry; error mapping adds `NotFoundError`/`InsufficientServingsError`, ~115 loc)
  - workers/conversational-bridge/test/mcp-consume.node.js (new, 22 focused tests)
  - workers/conversational-bridge/test/mcp.node.js (tools/list assertion: three -> four tools, plus consume annotations/schema checks)
  - workers/conversational-bridge/README.md (TASK-070 section)
unchanged by design: src/oauth.js, src/mcpAuth.js, src/index.js, src/operations/readyFood.js, src/firestore.js, app/UI files, Firestore rules, Cloudflare config, dependency metadata.
notes: `consume_ready_food` calls `readyFood.consumePortions()` unchanged and writes the same fieldPaths split as REST (`cookedMeals`; plus `deletions.cookedMeals` on final serving). Local only: not deployed, no Firestore access, PRODUCTION_WRITE_COUNT 0.
→ status set to `review` in TASKS.md

## TASK-069 — final fix-first correction (branch: task-069)
base: reviewed candidate `832b1dc48a21659bd13a039f1bc3ba122e6685db`; correction committed
  separately, not amended. Builder note: built by Claude under the AI Dev OS's "Codex unavailable"
  exception (Codex usage quota exhausted; this correction follows the external reviewer's bounded
  instructions directly).

A second independent targeted re-review of `832b1dc` confirmed `record_ready_food`'s architecture,
revision/conflict handling, owner auth, stored-scope validation, tool surface, Firestore mapping,
and REST/MCP isolation all sound (none reopened here), and returned FIX FIRST on exactly 1 bounded
blocker: the previous correction's `scopesSupported`/`requiredScopes` fix widened BOTH fields to
`[mealprep:read, mealprep:write]`, but the installed `@cloudflare/workers-oauth-provider@1.2.1`
gives them two distinct discovery roles, not one — `requiredScopes` should have stayed at the
resource's own read-only baseline, with `mealprep:write` discoverable only via `scopesSupported`
(the full catalogue) and the write tool's own step-up challenge.

changed:
  - workers/conversational-bridge/src/oauth.js (`requiredScopes` narrowed back from
    `[mealprep:read, mealprep:write]` to `[mealprep:read]`; `scopesSupported` unchanged at
    `[mealprep:read, mealprep:write]`; comment rewritten to document the three-way split —
    authorization-server catalogue vs. protected-resource baseline vs. per-tool step-up — instead
    of the previous, incorrect "both fields must name every scope" claim; 13 added / 6 removed loc)
  - workers/conversational-bridge/test/mcp-auth.node.js (`OAUTH_PROVIDER_CONFIG.requiredScopes`
    assertion corrected to `[MCP_SCOPE]`; test name and comment updated to state the split
    explicitly; 6 added / 2 removed loc)
  - workers/conversational-bridge/test/oauth-provider-integration.node.js (the discovery-metadata
    test's protected-resource expectation corrected to `scopes_supported: [MCP_SCOPE]` only and
    its default-challenge expectation corrected to `scope="mealprep:read"` only, since both are now
    driven by the corrected `requiredScopes`; the authorization-server expectation is unchanged
    (still both scopes — driven by `scopesSupported`, untouched); the test added by the PRIOR
    correction (which incorrectly asserted protected-resource `scopes_supported` must also include
    `mealprep:write`) is replaced by a new end-to-end test proving the three-way split is real: the
    authorization-server catalogue includes write, the protected-resource baseline does not, and a
    read-only-scoped token calling `record_ready_food` gets ITS OWN `insufficient_scope` step-up
    challenge naming exactly `mealprep:write`; `mcpRequest()`'s test helper gained an optional
    `toolName`/`toolArgs` parameter (defaulting to its exact prior `get_inventory`/`{}` behavior,
    verified unchanged at every other of its 11 existing call sites) so this new test could target
    `record_ready_food` without duplicating the helper; 34 added / 27 removed loc)
  - workers/conversational-bridge/README.md (the architecture diagram's `ChatGPT connector` line
    corrected from `OAuth 2.1 + PKCE S256, mealprep:read` to `OAuth 2.1 + PKCE S256, scoped per
    tool`, since a single hardcoded scope no longer describes the connector accurately; no other
    prose changed — the existing "`requiredScopes` option advertises rather than enforces scopes"
    sentence was already accurate and needed no edit; 1 loc)

why this is correct (verified against the installed provider source, same method as the prior
correction — read `dist/oauth-provider.js` directly, not assumed): `options.scopesSupported` feeds
`scopes_supported` on `/.well-known/oauth-authorization-server` (the AS's full grant catalogue).
`options.requiredScopes` is resolved by `withRequiredScopes()`/`resolveRequiredScopes()` into the
resource's OWN `resourceMetadata.scopes_supported`, which becomes BOTH the
`/.well-known/oauth-protected-resource/mcp` `scopes_supported` field AND (via
`createBearerChallenge()`) the default `WWW-Authenticate` challenge scope for a request carrying
no token at all. Since `get_inventory`/`get_ready_food` never need write, the resource's genuine
baseline requirement is read-only; advertising write there as well would have told a client it
needs write just to reach `/mcp` at all, which is false and could prompt an unnecessarily broad
consent request. `mealprep:write` remains fully discoverable — via the authorization-server
catalogue for clients that read it up front, and via `record_ready_food`'s own `securitySchemes`
and real-time `insufficient_scope` step-up challenge for any client that doesn't. Neither field
gates token validation or `apiHandler` invocation in this provider (confirmed again, unchanged
from the prior correction's finding); all actual enforcement remains
`requireMcpScopeContext()`'s allow-list, untouched by either correction.

tests: full bridge suite 113/113 pass (same count as before this correction — one
  provider-integration test replaced by another, net 0 change; 0 regressions); provider suite
  10/10 pass (incl. both the corrected discovery-metadata test and the new step-up test); write-tool
  suite 15/15 pass, unaffected; `node --check` on all 3 changed JavaScript files passes; `git diff
  --check` clean; manual secret-pattern scan clean. Per the reviewer's explicit instruction, the
  already-passed Playwright 711/711, `npm audit`, `wrangler dry-run`, `Verify-Decisions`, and
  `Check-DocsConsistency` baseline evidence from the prior correction are not re-run for this
  single-field, test-and-comment-only change — none of those surfaces were touched.
blockers: none
deviations:
  - No new `docs/DECISIONS.md` entry: this corrects a metadata-semantics mistake made in the prior
    correction, not a new design decision.
  - SELF_REVIEW.md / QA.md gates completed by code-trace, same basis as the prior correction's
    entry: no duplicated logic, no magic numbers, no dead code, naming consistent, every changed
    line traces to the reviewer's single blocker; QA's `[app]` items not applicable (backend-only).
  - `PRODUCTION_WRITE_COUNT` remains 0; nothing deployed, merged, or written to production.
→ status remains `review` in TASKS.md for one final targeted re-review (reviewer asked for this
  scope only)

---

## TASK-069 — fix-first correction (branch: task-069)
base: reviewed candidate `4bfdc34891056cbce5c8c3a189647981a2bf06a4`; correction committed
  separately, not amended. Builder note: built by Claude under the AI Dev OS's "Codex unavailable"
  exception (Codex usage quota exhausted; owner-confirmed before this correction started).

An independent external STRICT review of `4bfdc348` confirmed the architecture, scope model,
revision/conflict contract, and tool surface sound, and returned FIX FIRST on 3 bounded blockers
(plus one optional cleanup). All 4 addressed here; nothing else touched.

changed:
  - workers/conversational-bridge/src/oauth.js (`OAUTH_PROVIDER_CONFIG.scopesSupported` and
    `.requiredScopes` widened from `[mealprep:read]` to `[mealprep:read, mealprep:write]`;
    `resourceMetadata.resource_name` corrected from "Meal Prep Planner private reads" to
    "Meal Prep Planner private data" now that the resource advertises write capability too;
    8 added / 2 removed loc)
  - workers/conversational-bridge/src/mcp.js (`recordReadyFoodTool()` now projects only the five
    canonical business fields `recordCookedFood()` destructures — `name`, `servings`, `storage`,
    `cookedDate`, `recipeId` — instead of passing the whole validated `args` object, so
    `expectedRevision` (already consumed above, not a business field) can never reach the domain
    function even incidentally; 7 added / 1 removed loc, no behavior change)
  - workers/conversational-bridge/test/mcp-auth.node.js (the TASK-068-era config-pinning test
    updated to the new scope/resource_name values, and its `doesNotMatch(/mealprep:write/)`
    assertion removed — that assertion encoded the OLD, now-corrected behavior; 8 added /
    4 removed loc)
  - workers/conversational-bridge/test/oauth-provider-integration.node.js (the discovery-metadata
    test updated to the new scope/resource_name values and the new combined WWW-Authenticate
    challenge scope string; one new test asserting both the protected-resource and
    authorization-server metadata's `scopes_supported` include `mealprep:write`, so a real OAuth
    client can actually discover it as requestable; 29 added / 6 removed loc)
  - workers/conversational-bridge/README.md (corrected TASK-068 live-state drift across 5
    locations: "Production status" now states TASK-068 is closed `done` and live — OAuth/Access/
    `OAUTH_KV` provisioned, owner-verified ChatGPT reads passed in production — rather than
    "source only"/"not connected"; the TASK-068 section header, "Public exposure" closing note,
    "Required secrets" `OAUTH_KV` note, and "Production enablement checklist" all updated to match;
    the "Future TASK-068 provisioning plan" section is relabeled "completed; kept verbatim as the
    audit trail" rather than rewritten, since the plan's own reasoning remains valid history;
    TASK-069 itself is unaffected — still explicitly local-only/not-deployed throughout; ~45 loc
    net)

why `scopesSupported`/`requiredScopes` were safe to widen (verified, not assumed): read the
installed `@cloudflare/workers-oauth-provider@1.2.1` source directly (`dist/oauth-provider.js`).
Neither field gates `validateAccessToken()` (it only checks audience/expiry/returns the token's
actual granted scope) nor `approveConsent()` (which only consults its `supportedScopes` parameter
when the caller passes an explicit `options.scope` override — this Worker's `finishAuthorization()`
never does, preserving TASK-068's `fe49a3b`/`b585569` no-silent-narrowing-or-widening fix exactly).
Both fields are pure discovery-metadata advertisement: `scopesSupported` feeds the authorization-
server metadata's `scopes_supported`; `requiredScopes` (via `withRequiredScopes()`/
`resolveRequiredScopes()`) feeds the protected-resource metadata's `scopes_supported` and the
default `WWW-Authenticate` challenge scope list for a request with no token at all. Leaving them at
`[mealprep:read]` after adding a write tool meant a real OAuth client reading discovery metadata
could never learn `mealprep:write` was requestable — a real functional gap, not cosmetic. All
actual enforcement remains exactly `requireMcpScopeContext()`'s allow-list, unchanged by this fix.

tests: full bridge suite 113/113 pass (was 112/112 before this correction; +1 new metadata test,
  0 regressions); root Playwright suite 711/711 pass (run directly this time — not sandbox-blocked);
  `node --check` on all 4 changed JavaScript files passes; `git diff --check` clean; manual
  secret-pattern scan clean; `npm audit --omit=dev` (bridge) 0 vulnerabilities; `wrangler deploy
  --dry-run` validates cleanly; `Verify-Decisions.ps1` 110/110; `Check-DocsConsistency.ps1` 51
  drift items, independently confirmed identical and pre-existing on `BASE_SHA` (unrelated to this
  task); complete evidence in TEST_REPORT.md.
blockers: none
deviations:
  - No new `docs/DECISIONS.md` entry: this corrects discovery-metadata to match an already-decided
    architecture (TASK-069's own write-scope decision), not a new design decision or convention.
  - SELF_REVIEW.md / QA.md gates completed by code-trace against this diff (both are generic
    process checklists, not per-task logs): no duplicated logic, no magic numbers, no unnecessary
    complexity/state, no dead code/TODOs, naming consistent with surrounding code, every changed
    line traces to one of the 3 reviewer blockers or the 1 optional cleanup. QA's `[app]` items
    (recipe-id handlers, `:root`, colors, AppState fields) are not applicable — this diff touches
    only the Worker's own backend code, never app.js/index.html/style.css. Git hygiene: code + docs
    committed together, conventional message, no secrets in the diff (verified above).
  - `PRODUCTION_WRITE_COUNT` remains 0 throughout; nothing deployed, merged, or written to
    production Firestore during this correction.
→ status remains `review` in TASKS.md for targeted re-review (reviewer asked for this scope only)

---

## TASK-069 — review (branch: task-069)
changed:
  - workers/conversational-bridge/src/mcpAuth.js (`MCP_WRITE_SCOPE`; TASK-068's single-scope
    `requireMcpReadContext()` generalized into a shared `requireMcpScopeContext()` plus a new
    `requireMcpWriteContext()`, both checked against a deliberate read/write/combined allow-list
    via the new exported `isSupportedMcpScopeSet()`; `mcpAuthChallenge()` takes the required scope
    instead of hardcoding `mealprep:read`; 36 added / 9 removed loc)
  - workers/conversational-bridge/src/oauth.js (`requireExactAuthorizationScope()` generalized to
    the same allow-list, returning the normalized requested set instead of always `[mealprep:read]`;
    the consent page now names exactly the requested scope(s) and the authority they grant instead
    of a hardcoded read-only claim; 25 added / 6 removed loc)
  - workers/conversational-bridge/src/mcp.js (new `record_ready_food` tool — the first real MCP
    write tool — registered alongside the two TASK-068 read tools; its handler mirrors `index.js`'s
    `POST /v1/ready-food/record` flow exactly: `requireMcpWriteContext()` -> an `expectedRevision`
    shape check mirroring `index.js`'s own -> `getUserDocument()` -> compare `expectedRevision` ->
    the existing `readyFood.recordCookedFood()` -> `patchUserDocument()`; no persistence or
    business validation reimplemented; `tools/list`'s security-scheme decorator generalized from a
    two-tool if-check to a name->scheme map; 121 added loc)
  - workers/conversational-bridge/README.md (new "TASK-069 authenticated MCP write pilot" section;
    corrected the now-stale TASK-068 exact-read-only scope/consent/"Not in v1" claims; a new judgment
    call entry on the input schema's deliberate `z.unknown()` typing; 104 loc net)
  - workers/conversational-bridge/test/mcp-auth.node.js (scope-normalization unit test updated to
    the allow-list contract; the stored-unsupported-scope regression test's example scope swapped
    from `mealprep:write` — now supported — to a genuinely unsupported one; two new tests: consent
    page names write/combined authority accurately, and `requireMcpWriteContext()`'s own
    fail-closed config check; 68 added loc)
  - workers/conversational-bridge/test/oauth-provider-integration.node.js (the real-provider exact-
    scope test extended to accept and display write/combined grants, with its unsupported-scope
    list keeping only genuinely-unsupported examples; the stale-stored-consent regression test's
    two `mealprep:write`-based examples swapped to genuinely-unsupported ones for the same reason;
    one new end-to-end test issuing a real write-scoped token and proving it authorizes
    `record_ready_food` but not the two read tools, and that a combined token authorizes both;
    84 added loc)
  - workers/conversational-bridge/test/mcp.node.js (the `tools/list` test updated for three tools
    total with per-tool scheme/annotation assertions, and its "no probe/write-scope leak" assertion
    narrowed to tool names only, since the write tool's own `mealprep:write` scheme and prose
    description's word "removes" are now legitimately present; 26 loc net)
  - workers/conversational-bridge/test/mcp-write.node.js (new; 15 focused tests: the read/write/
    combined auth matrix, the full revision/conflict contract against the real in-memory fake
    Firestore — success, stale revision, missing/malformed `expectedRevision`, a same-revision
    race/retry producing exactly one record, the resulting `cookedMealId` reusable by
    `get_ready_food` — the existing-validation-error-shape cases, and the over-posting/adversarial
    cases; 296 loc)
tests: full bridge suite (`npm run test:bridge` / `node --test test/*.node.js`) 112/112 pass (was
  95/95 immediately before this task; +2 tests added to existing files, +15 in the new
  test/mcp-write.node.js, 0 regressions); `node --check` on all 7 changed/new JavaScript files
  passes; `git diff --check` clean; manual secret-pattern scan over the full diff clean; complete
  evidence in TEST_REPORT.md
blockers: none
deviations:
  - `OAUTH_PROVIDER_CONFIG.scopesSupported`/`requiredScopes` in oauth.js were deliberately left
    unchanged (still advertise only `mealprep:read`). Per the installed `@cloudflare/
    workers-oauth-provider` 1.2.1's own typings, these fields are "advertised only in authorization
    server metadata" and are not used to validate or filter the scope this Worker's own
    `approveConsent(request, handle)` call (no scope override, preserving TASK-068's `fe49a3b` /
    `b585569` fix) actually grants — verified by reading `parseAuthRequest()`/`approveConsent()` in
    the installed provider source, not assumed. Enforcement is entirely this Worker's own
    `requireExactAuthorizationScope()`/`requireMcpScopeContext()` allow-list, exactly as TASK-068's
    own README already documented ("its `requiredScopes` option advertises rather than enforces
    scopes, so this Worker enforces the exact scope itself"). This also keeps the existing
    "OAuth provider configuration is read-only, resource-bound, and CIMD-first" regression test
    (which explicitly pins `mealprep:write` absent from that object) accurate without weakening it.
  - Could not run in this sandbox (autonomous session, no interactive approval available for any
    `npm`/`npx`/`.ps1` process spawn — confirmed categorically blocked, not specific to any one
    command): `npx wrangler deploy --dry-run`, `npm audit` (the bridge's own dependency audit — no
    new dependency was added; `zod`/`jose`/`@modelcontextprotocol/server`/
    `@cloudflare/workers-oauth-provider` are all already-installed, already-reviewed TASK-068
    dependencies, unchanged in `package.json`), `tools/Verify-Decisions.ps1`,
    `tools/Check-DocsConsistency.ps1`, and the root `npm test` (Playwright) suite. `git status`/
    `git diff` confirm no file under `app.js`, `index.html`, `style.css`, or `tests/` changed, which
    is the specific property the Playwright run would have confirmed. These are flagged here, not
    silently skipped, for the reviewer to run.
→ status set to `review` in TASKS.md

---

## TASK-068 — second fix-first correction (branch: task-068)
base: reviewed candidate `b585569c67fff81978c1a4fa1a2040d365d26e38`; correction committed
  separately, not amended
changed:
  - workers/conversational-bridge/src/oauth.js (`finishAuthorization()` resolves the stored consent
    request without a provider scope override, validates its original scope with the existing exact
    policy, and passes only normalized `[mealprep:read]` into grant creation; 6 added / 4 removed loc)
  - workers/conversational-bridge/test/oauth-provider-integration.node.js (real provider v1.2.1
    regression creates stored write-only and mixed-scope consent transactions through supported
    APIs, proves both reject without a code/grant/token, and proves exact read still succeeds;
    38 added / 2 removed loc)
  - workers/conversational-bridge/test/mcp-auth.node.js (asserts no scope override reaches
    `approveConsent()` and the completed request is normalized to exact read; 2 added / 1 removed loc)
tests: focused OAuth/provider 17/17 pass; explicit REST/auth/provider 24/24 pass; full bridge 95/95
  pass; full local Playwright 711/711 pass; 3 changed JavaScript syntax checks pass; Wrangler
  4.146.0 dry-run bundles successfully; npm audit reports 0 vulnerabilities; Verify-Decisions
  110/110; complete evidence in TEST_REPORT.md
blockers: none
deviations: none in implementation scope. README wording was not changed because its existing
  exact-scope/reject-not-replace description remains accurate. TASK-068 remains local-only: no
  deployment, live OAuth / Access / KV resource, private ChatGPT connection, production Firestore
  access, or production write occurred. Check-DocsConsistency retains the same 51 pre-existing
  candidates from unchanged app/docs inputs.
→ TASK-068 remains `review` in TASKS.md for targeted re-review

---

## TASK-068 — fix-first correction (branch: task-068)
base: reviewed candidate `4253d0a8775e517ff36f39598ce9bf10f621d77d`; correction committed separately, not amended
changed:
  - workers/conversational-bridge/src/oauth.js (exact deduplicated `mealprep:read` authorization
    policy before consent and grant creation, exact consent display, explicit canonical resource on
    authorization/token requests, and a real-provider construction seam; 78 added / 7 removed loc)
  - workers/conversational-bridge/test/oauth-provider-integration.node.js (actual installed-provider
    request-path coverage with fake local KV/CIMD/keys for scopes, client negotiation, PKCE/replay,
    resource binding, bearer denial, production discovery/challenge, and complete revocation;
    515 loc)
  - workers/conversational-bridge/test/mcp-auth.node.js (wrong-kid, missing-owner configuration,
    exact scope normalization, exact consent display, and stale unsupported-consent defense;
    76 added / 6 removed loc)
  - workers/conversational-bridge/README.md (exact scope/resource rules, production-faithful test
    coverage, and provider-supported `listUserGrants()` + `revokeGrant()` runbook; 33 added /
    15 removed loc)
tests: focused OAuth/provider 16/16 pass; full bridge 94/94 pass; REST auth 7/7 pass; full local
  Playwright 711/711 pass; 3 changed/new JavaScript syntax checks pass; Wrangler 4.145.0 dry-run
  bundles successfully; npm audit reports 0 vulnerabilities; Verify-Decisions 110/110; complete
  evidence in TEST_REPORT.md
blockers: none
deviations: none in implementation scope. TASK-068 remains local-only: no deployment, live OAuth /
  Access / KV resource, private ChatGPT connection, production Firestore access, or production
  write occurred. Check-DocsConsistency retains the same 51 pre-existing candidates from unchanged
  app/docs inputs.
→ TASK-068 remains `review` in TASKS.md for targeted re-review

---

## TASK-068 — done (branch: task-068)
changed:
  - workers/conversational-bridge/src/oauth.js (Cloudflare Workers OAuth Provider integration,
    CIMD-only read-scope configuration, Access-gated owner consent, and fixed owner/resource grant
    properties; 142 loc)
  - workers/conversational-bridge/src/mcpAuth.js (RS256 Access assertion validation plus exact
    issuer/audience/time/scope/resource/owner checks and sanitized MCP challenges; 117 loc)
  - workers/conversational-bridge/src/mcp.js (replaces feasibility probes with exactly
    `get_inventory` and `get_ready_food`, delegates to `getUserDocument()` plus the existing
    canonical list functions, declares read-only OAuth metadata, and contains no mutation path;
    141 added / 35 removed loc)
  - workers/conversational-bridge/src/index.js (keeps REST bearer routing separate from the exact
    OAuth-protected `/mcp` route and fails near paths closed; 14 added / 5 removed loc)
  - workers/conversational-bridge/test/mcp-auth.node.js and test/mcp.node.js (16 focused provider,
    assertion, owner, challenge, tool contract, zero-mutation, credential-crossing, and routing
    tests; 404 current loc)
  - workers/conversational-bridge/test/support/fixtures.js (fake Access issuer/audience/owner values
    only; 4 added / 1 removed loc)
  - workers/conversational-bridge/package.json and package-lock.json (pins only
    `@cloudflare/workers-oauth-provider@1.2.1` and `jose@6.2.12`; 19 added loc)
  - workers/conversational-bridge/wrangler.jsonc (enables CIMD's SSRF-safe
    `global_fetch_strictly_public` flag and records that `OAUTH_KV` is a later provisioning binding;
    4 added / 4 removed loc)
  - workers/conversational-bridge/README.md (provider/source evidence, OAuth/resource/redirect
    contract, deterministic owner mapping, credential separation, rollback, and exact future
    Access/KV/secrets/ChatGPT provisioning plan; 167 added / 64 removed loc)
tests: focused OAuth/MCP 16/16 pass; full bridge 84/84 pass; full local Playwright 711/711 pass;
  7 changed/new JavaScript syntax checks pass; Wrangler 4.145.0 dry-run bundles successfully;
  npm audit reports 0 vulnerabilities; Verify-Decisions 110/110; git diff and delta secret scan
  clean; complete evidence in TEST_REPORT.md
blockers: none
deviations: TASK-067 live feasibility passed and MCP is selected, but TASK-068 remains local-only:
  no production deployment, Access application, OAuth KV namespace/binding, private ChatGPT
  connection, production Firestore access, or production write occurred. The first production
  write and `mealprep:write` remain unapproved. Check-DocsConsistency still reports the same 51
  pre-existing candidates from unchanged app/docs inputs; TASK-068 introduces zero scanned-file
  drift.
→ status set to `review` in TASKS.md

---

## TASK-067 — done (branch: task-067)
changed:
  - workers/conversational-bridge/src/mcp.js (new stateless `/mcp` adapter using the official
    `@modelcontextprotocol/server` v2 Web-standard Streamable HTTP handler; exactly
    `probe_read` and `probe_write`, strict zero-input schemas, exact annotations, static results,
    and Host/Origin validation; 85 loc)
  - workers/conversational-bridge/src/index.js (`routeRequest()` dispatches only exact `/mcp`
    requests to the isolated adapter before the unchanged REST handler; 8 added / 1 changed loc)
  - workers/conversational-bridge/test/mcp.node.js (11 focused protocol, annotation, invocation,
    isolation, failure, Host/Origin, and REST-auth regression cases; 194 loc)
  - workers/conversational-bridge/package.json and package-lock.json (pin the only two direct
    runtime dependencies: `@modelcontextprotocol/server@2.2.0` for the official stateless
    Streamable HTTP/server implementation and `zod@4.6.5` for strict input/output schemas;
    transitive `@modelcontextprotocol/core@2.2.0` only; 52 added loc)
  - workers/conversational-bridge/README.md (local-only feasibility architecture, zero-mutation
    boundary, exact tool contract, dependency/transport choice, and the later live PASS/FAIL rule
    without claiming a result; 46 added / 3 changed loc)
tests: focused MCP 11/11 pass; full bridge 79/79 pass; explicit REST missing/wrong-bearer
  regression 1/1 pass; full local Playwright 711/711 pass; changed-JS syntax checks pass;
  Wrangler 4.145.0 deploy dry-run bundles successfully and exits without deployment; npm audit
  reports 0 vulnerabilities; Verify-Decisions 110/110; git/delta secret/QA checks recorded in
  TEST_REPORT.md
blockers: none
deviations: live deployment and the owner's actual ChatGPT Create MCP App invocation are
  deliberately untested and unclaimed; those are separately authorized only after independent
  review. `Check-DocsConsistency.ps1` still reports the 51 pre-existing drift candidates from
  unchanged docs/app inputs; TASK-067 adds zero scanned-file drift.
→ status set to `review` in TASKS.md

---

## TASK-065 / D-082 — Conversational Control Bridge v1: fixes from independent STRICT review (branch: task-065)
base: candidate `9961521` (previous entry below), NOT amended — this is a new commit on top.
Builder note unchanged: built by Claude under the AI Dev OS's "Codex unavailable" exception.

An independent STRICT review of `9961521` confirmed the architecture, auth model, concurrency
model, Firestore adapter, and every other mechanism sound, and returned FIX FIRST on 5 bounded
findings (2 must-fix, 3 low). All 5 fixed here; nothing else touched.

changes:
  - workers/conversational-bridge/src/operations/inventory.js: `isStapleRecord()` replaced by
    `classifyStaple()`, a three-way call (`staple` / `non-staple` / `ambiguous`) — explicit flag
    first, then the client's own category-only fallback (`staple !== false && category ===
    'pantry'`), matching app.js's `isStaple()` as far as possible without `INGREDIENT_DB`.
    `markOutOfStock()` now throws the new `AmbiguousError` for the residual `ambiguous` case
    (no explicit flag, non-`'pantry'` category — confirmed against live seed data: `Garlic
    (Bawang)`/`Evaporated Milk` are `isStaple: true` with category `Vegetable`/`Dairy`, and two
    active `app.js` pantry-creation call sites store `staple: undefined` for unmatched custom
    ingredients, so this is a real, common case) instead of guessing non-staple and risking a
    destructive tombstone on what might actually be a staple.
  - workers/conversational-bridge/src/errors.js: added `AmbiguousError` (uses the contract's
    already-reserved `ambiguous` code) and `MalformedBodyError` (distinct from `ValidationError`
    so malformed JSON can map to its own HTTP status).
  - workers/conversational-bridge/src/operations/readyFood.js: `recordCookedFood()` now requires
    an explicit `cookedDate` (`YYYY-MM-DD`, the caller's LOCAL calendar date) via a new
    `validateCookedDate()` — rejects wrong shape, free-form text, and impossible calendar dates
    (e.g. `2026-02-30`, which a regex alone would accept) by round-tripping through `Date.UTC()`
    and checking every component. The Worker's own `new Date().toISOString().slice(0,10)` UTC
    fallback is gone entirely — no silent guessing, since nothing is deployed yet and there is no
    client compatibility obligation to preserve it for.
  - workers/conversational-bridge/src/index.js: `readyFood.record`'s `BODY_SCHEMAS` entry now
    requires `cookedDate`. `readJsonBody()` throws the new `MalformedBodyError` on a JSON.parse
    failure (or empty body) instead of `ValidationError`, and `errorFromException()` maps
    `MalformedBodyError` -> `400` and `AmbiguousError` -> `422 ambiguous`, keeping "syntactically
    invalid JSON" (400) and "well-formed JSON, invalid domain value" (422) distinct per TASK-065's
    contract (the first candidate had conflated them at 422).
  - workers/conversational-bridge/openapi.yaml: `ready-food/record` requires `cookedDate`
    (pattern + format + description of the local-date contract); a `MalformedBody` (400) response
    added to all 6 POST endpoints; `mark-out-of-stock` gained a documented `422 ambiguous`
    response; `ReadyFoodItem.cookedDate` description clarified as caller-supplied, never derived.
  - workers/conversational-bridge/README.md: rewrote the two corrected judgment-call entries
    (staple classification, cookedDate) with the live-data evidence and the new contract; added
    explicit "malformed JSON vs. invalid content" and "`ambiguous` code" notes to the endpoint
    contract section; strengthened the production-checklist service-account step per the review's
    explicit instruction — Firestore IAM has no per-document restriction, so `TARGET_UID` is an
    application-level scope, not an IAM one, and a compromised service-account credential has a
    materially bigger blast radius than a compromised bearer token. Never claims the IAM role
    itself is confined to one document.
  - docs/DECISIONS.md: D-082 Status line updated (STRICT review verdict + fix summary); the
    Implementation-addendum's items #1 and #4 rewritten to the corrected behavior; new
    "Corrections after independent review" subsection explaining what changed and why, with 4 new
    `Verify:` pointers added alongside the original 7 (110 total across the file now, up from 106
    before this fix cycle — confirmed by `Verify-Decisions.ps1`'s own count, not hand arithmetic).
  - TASKS.md: TASK-065 status note updated with the review verdict and fix summary; still
    `status: review` (targeted re-review needed, not `done`).
  - test/operations.node.js: added 3 pantry-classification tests (undecorated `category:'pantry'`
    retains + empties, no tombstone; undecorated off-category `AmbiguousError` with nothing
    mutated; an off-category record with an explicit `staple:true` still resolves normally) and 1
    cookedDate test (missing/wrong-shape/free-form/impossible all rejected; a valid caller date is
    preserved verbatim). Fixed the 3 existing `recordCookedFood(...)` call sites across
    operations.node.js/security.node.js/consistency.node.js to pass `cookedDate` now that it's
    required.
  - test/security.node.js: added an HTTP-level `ambiguous` test (mark-out-of-stock on Garlic-like
    fixture -> 422, store untouched) and its undecorated-but-safe `category:'pantry'` counterpart;
    an HTTP-level cookedDate contract test (missing/impossible -> 422, valid preserved exactly,
    store untouched by rejected attempts); rewrote the malformed-JSON test to assert 400 and added
    an explicit companion assertion that a well-formed-but-invalid body is still 422 in the same
    test, so the distinction is proven, not just each half in isolation; added 2 new tests for
    Finding 5 (a genuinely oversized `Content-Length` request, and a chunked/streamed request with
    no declared `Content-Length` exercising the bounded-reader path directly) — both assert zero
    Firestore calls happened and the store is untouched, not just the HTTP status.
tests: `npm run test:bridge` — 68/68 pass (exact runner counts, corrected per finding 3: 8
  firestore.node.js, 7 auth.node.js, 20 operations.node.js, 28 security.node.js, 5
  consistency.node.js). `npm run test:worker` — 9/9 pass, unaffected. `./tools/Verify-Decisions.ps1`
  — 110/110 pointers hold. `./tools/Check-DocsConsistency.ps1` — output byte-identical to a clean
  `main` baseline (zero new drift). `git diff --check` (staged) — clean. `node --check` on every
  `.js` file under `workers/conversational-bridge/` — clean.
blockers: none.
deviations/gates not run (reported as SKIP, not PASS — same reasoning as the first candidate,
  unchanged by this fix cycle): the full local Playwright suite (`npm test`) — this worktree still
  has no `node_modules` installed, and this fix touches zero `app.js`/`index.html`/`style.css`
  lines. Worker lint/type/build tooling — still none exists in this repo for any Worker. A real
  `wrangler` deploy/dry-run — `wrangler` is still not an installed dependency here, and TASK-065
  forbids deployment regardless; a dry run was allowed per the re-review brief but was skipped for
  the same "not an installed dependency, would require a fresh network install" reason as the
  first candidate, and it would exercise nothing this fix cycle actually changed.
→ status remains `review` in `TASKS.md` (targeted re-review, not full re-review, since only the 5
  bounded findings changed).

---

## TASK-065 / D-082 — Conversational Control Bridge v1 candidate, built and locally tested (branch: task-065)
base: `main` @ `d550de0`. Builder note: `owner: codex` in `TASKS.md`, but Codex was unavailable
this cycle — built directly by Claude under the AI Dev OS's documented exception ("Codex is
unavailable"), confirmed explicitly by the human before any code was written. Not deployed; no
production secrets exist; not merged.
changes:
  - workers/conversational-bridge/src/index.js (new, 217 loc): HTTP routing, bearer-token gate
    (checked before anything else), an allow-listed request-body schema per route (rejects any
    unexpected field — the over-posting defense), and dispatch into the domain layer. A write's
    `expectedRevision` is checked against the live document BEFORE any Firestore call, so a stale
    request never even attempts a network write.
  - workers/conversational-bridge/src/auth.js (new, 138 loc): `requireBearerToken()` (constant-time
    compare) and `getFirestoreAccessToken()` — the service-account JWT-bearer OAuth2 exchange,
    signed with Web Crypto, cached in module scope and reused across requests in the isolate.
  - workers/conversational-bridge/src/firestore.js (new, 183 loc): typed-value codec (plain JS <->
    Firestore REST's wrapped value shapes) and a client scoped to exactly one document
    (`users/{TARGET_UID}`), read via a fixed field mask and written via `updateMask.fieldPaths`
    (supports dotted nested paths, e.g. `deletions.pantry`) plus a `currentDocument.updateTime`
    precondition — never a whole-document overwrite. A precondition failure
    (`FAILED_PRECONDITION`/`ABORTED`) re-reads and surfaces fresh state as a `RevisionConflictError`;
    any other failure is a sanitized `InfrastructureError`, never conflated with a conflict.
  - workers/conversational-bridge/src/operations/inventory.js (new, 112 loc) and
    src/operations/readyFood.js (new, 137 loc): pure domain functions reimplementing
    `correctKitchenStock()`, `_doMarkCooked()`'s record shape, `useCookedPortion()`/
    `removeCookedMeal()`'s exact-remainder removal, and `finishCookedMeal()` against decoded
    Firestore values. Four judgment calls recorded in `docs/DECISIONS.md` D-082's addendum: (1)
    `isStaple()` narrowed to the explicit `staple===true` flag (no `INGREDIENT_DB` access
    server-side); (2) `consume`/`finish` write the `cookedMeals` tombstone explicitly and
    immediately rather than relying on the client's baseline-diff mechanism, which has no bridge
    equivalent; (3) `ready-food/record` never deducts pantry (D-082 forbids one write touching two
    collections); (4) a bridge-created `cookedDate` uses the Worker's own UTC date, not a
    caller-local date the server has no way to know.
  - workers/conversational-bridge/src/errors.js (new, 26 loc): `NotFoundError`, `ValidationError`,
    `InsufficientServingsError` — the three response codes not already owned by auth.js/firestore.js.
  - workers/conversational-bridge/{package.json,wrangler.jsonc} (new): no `vars` block (unlike
    recipe-import) — every configuration value this Worker needs is a secret.
  - workers/conversational-bridge/openapi.yaml (new): full machine-readable contract for a future
    ChatGPT connector — not configured in this task.
  - workers/conversational-bridge/README.md (new): architecture, required secrets, the four
    judgment calls, and a 7-step "production enablement checklist" (service-account + bearer-token
    minting, real deploy, smoke test, THEN a ChatGPT connector — none of which happened here).
  - workers/conversational-bridge/test/*.node.js + test/support/{fakeFirestore,fixtures}.js (new,
    59 tests): an in-memory fake Firestore (honors field-mask + updateTime precondition semantics)
    and a throwaway RSA-2048 test keypair (never a real credential) stand in for every dependency —
    no network call anywhere in the suite. Covers the typed-value codec, the auth boundary, every
    domain operation's validation/idempotency rules, the full TASK-065 chaos/security matrix
    (auth, malformed JSON, wrong method/content-type, over-posting, stale revisions, insufficient
    servings, sanitized infra errors, no-partial-success), and an app<->bridge consistency suite
    proving bridge writes and simulated app-side writes share one canonical store.
  - package.json: added `test:bridge` script.
  - docs/ARCHITECTURE.md: new "Conversational Control Bridge" section.
  - docs/DECISIONS.md: D-082 status updated to "candidate built"; implementation addendum with the
    four judgment calls above and 7 new `Verify:` pointers.
tests: `npm run test:bridge` (59/59 pass); `npm run test:worker` (9/9 pass, unaffected);
  `./tools/Verify-Decisions.ps1` (106/106 pointers hold, including the 7 new ones);
  `./tools/Check-DocsConsistency.ps1` (51 pre-existing findings, byte-identical to a clean
  `main` baseline — this change introduced zero new drift); `git diff --check` (clean);
  `node --check` on all 13 new `.js` files (clean).
blockers: none for this candidate.
deviations/gates not run: Worker lint/type/build tooling — none exists in this repo for
  `workers/recipe-import` either, so there is nothing to run (not a gap introduced here). The
  full local Playwright suite (`npm test`) was **not** run: this worktree has no `node_modules`
  installed (a fresh `git worktree add`, not `npm install`ed), and the change touches zero
  `app.js`/`index.html`/`style.css` lines, so installing ~100+ packages and a browser download
  purely to re-verify an unrelated surface was judged not worth the time/network cost — reported
  here as SKIP, not PASS. A reviewer running from a checkout with dependencies already installed
  should run it before approving.
→ status set to `review` in `TASKS.md`.

---

## TASK-061 / D-077 + TASK-060 / D-076 — landed and released (main f58bfe5)
- Integration: `main` 207d262 -> f58bfe5 by `--ff-only`. The reviewed commit itself is `main`; tree
  identical, product files unchanged. Pushed normally (no force).
- Bookkeeping only (this entry): TASKS.md (TASK-060 and TASK-061 -> done; TASK-060's stale "awaiting
  push" wording corrected), STATUS.md, TEST_REPORT.md, REVIEW.md (relayed TASK-061 verdict),
  planning/DONE.md, docs/DECISIONS.md (D-077 landed line).

---

## TASK-061 / D-077 — local suite served over http; CI restore flake removed (branch: task-061-ci-restore-reliability)
base: `main` @ 207d262. Test harness and config only; no product file changed.
changes:
  - playwright.config.js: `webServer` runs `node tests/static-server.js` on 127.0.0.1:47813 with
    `reuseExistingServer: false`. The `local` project gets `baseURL` and `serviceWorkers: 'block'`.
    The header comment is updated to say why.
  - tests/static-server.js (new): a dependency-free static server for the repo root, with
    `Cache-Control: no-store` and paths outside the root refused.
  - 41 local specs: `pathToFileURL(path.resolve('index.html')).href` changed to `'/index.html'`
    (45 sites). The `url`/`path` imports that this orphaned are removed. Two comments that
    credited `file://` with blocking Firebase now credit the route abort, which is what does it.
  - tests/app-ready.js: header comment only.
  - tests/local-harness-origin.spec.js (new): 4 tests (see TASKS.md TASK-061).
  - docs/DECISIONS.md: D-077. TASKS.md: TASK-061 (review). STATUS.md: new top entry.

---

## TASK-060 / D-076 — follow-up: production smokes aligned with the meal-prep Home (branch: wave/meal-prep-first-prod-smokes)
base: deployed `main` @ e6f7650 (= `origin/main`). Test-only follow-up; no product file changed.
changes:
  - tests/production-smoke-cook-method.spec.js: "Home produces a meaningful Easiest
    recommendation…" opens "Need ideas?" (clicks `#dash-ideas > summary`) before asserting the
    Easiest row is visible. All chip/effort/"no competing card" assertions are unchanged.
  - tests/production-smoke-what-should-we-eat.spec.js:
    - "Used 1 still works…" opens "Need ideas?" first; the portions and chip assertions are unchanged.
    - "…surfaces remain intact…": `eatBeforeReady` replaced by `readyBeforeEat` +
      `eatInsideIdeas`, mirroring the reviewed local what-should-we-eat spec. The other 7
      assertions are unchanged.
    - "mobile Home has no horizontal overflow and no console errors" opens "Need ideas?" first, so
      its width, tap-size and console-error checks now actually run.
  - TASKS.md: TASK-060 corrected from a premature `done` to `review`, with a release checklist.

---

## TASK-060 / D-076 — landed locally, NOT pushed (branch: wave/meal-prep-first)
merged: owner-approved candidate 288fd58 landed via `--no-ff` merge 9ba4c25 into LOCAL `main`
  (parents e7c3777 + 288fd58). Pre-merge local `main` = `origin/main` = e7c3777; main was an
  ancestor of the candidate. `git diff 288fd58 9ba4c25` is empty.
procedure: followed the TASK-059 manual-landing precedent. Did NOT use `tools/Run-Merge.ps1`,
  because it pushes and pushing `main` deploys (not authorized).
push/deploy: NONE. `origin/main` still e7c3777.

---

## TASK-060 / D-076 — review fix 1 (branch: wave/meal-prep-first, on top of e1c9f1c)
review: FIX FIRST on candidate e1c9f1c (preserved; this is a new commit, not an amend).
changes:
  - `generateGroceryList()`: before rebuilding, index the previous non-custom rows by the
    generator's own identity (exact category + exact name) and carry over `checked`, `userSet`,
    and the `stocked` receipt. No fuzzy or positional matching; removed ingredients leave no row;
    new ingredients start unchecked; custom rows unchanged.
  - Home "What can I do?" empty state: "Add items to Inventory" -> "Add items to Fridge".
  - Built-in cooking hack #14 text: "add it under Inventory" -> "add it under Fridge" (seed
    constant only; users' already-stored copies are not rewritten).
  - docs: D-076 addendum (removes the now-false "resets checked state" limitation), ARCHITECTURE.
  - tests: 5 new cases in tests/meal-prep-first.spec.js.

---

## TASK-060 / D-076 — implemented, held for review (branch: wave/meal-prep-first)
base: `main` @ e7c3777 (= `origin/main`, 0/0 divergence at start). Uncommitted working tree on the
  branch at time of writing; implemented directly by Claude from an owner brief, not via Codex.
scope: `app.js`, `index.html`, `style.css`; docs `ARCHITECTURE.md`, `DATA_MODEL.md`, `FEATURES.md`,
  `DECISIONS.md` (D-076); `TASKS.md` (TASK-060, status review); new specs
  `tests/scroll-no-reload.spec.js`, `tests/meal-prep-first.spec.js`; allowlist/placement updates in
  seven existing specs (intended behavior changes only; see D-076 Consequences).
changes:
  - removed the custom pull-to-refresh in `setupMobileEnhancements()` (root cause of scroll reloads)
  - Shop: `pantryMatchesForShop()`, "Not anymore?" (`openNotInKitchenDialog()` /
    `correctKitchenStock()` / `fixNotInKitchen()`); empty staples no longer count as In stock;
    tapped rows no longer show the In-stock badge
  - `AppState.plannedBatches` (+ normalizer/merge) at every persistence site; export `1.6`
  - Plan: `#batch-plan` search + Low effort chip + batch list; Shop reads batches
  - Prep tab `#prep`: Prepped → Fridge (`completePlannedBatch()`), Prep checklist, Copy AI Prep Brief
    (`buildPrepBriefModel()` / `formatPrepBrief()` / `copyPrepBrief()`)
  - Home: `renderMealPrepFlowCard()` first; ideas cards in collapsed `#dash-ideas`; nav reordered,
    Inventory → Fridge, Cook → Recipes
reverted during build: making a tap on an auto-ticked row mean "don't have it" — it broke the
  D-057/D-069 top-up contract (6 tests); replaced by the explicit button.

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

## TASK-075 — ready for review (branch: task-075)
changed:
  - shared/readyFoodContract.js (8 loc): shared source enum and default freshness
  - app.js, index.html (20 loc): app modal reads source and defaults from the shared contract
  - workers/conversational-bridge/src/operations/readyFood.js, src/mcp.js (19 loc): optional source validation/persistence and nullable read output
  - docs/ARCHITECTURE.md, docs/DATA_MODEL.md, docs/DECISIONS.md, workers/conversational-bridge/README.md (27 loc): document the shared contract and conversational limits
  - workers/conversational-bridge/test/*, tests/ready-food-contract.spec.js (114 loc): source, freshness, schema, revision/race, and app coverage
tests: `npm run test:bridge` (210 passed); `npm test` (725 passed); changed-JS `node --check`; Wrangler dry-run; `npm audit --omit=dev` (0 vulnerabilities); Verify-Decisions (110 pointers); delta secret scan; `git diff --check`. Docs-consistency reports 51 items, identical to the origin/main baseline.
blockers: none
deviations: no deployment or production access, as required for this task handoff
→ status set to `review` in TASKS.md

## TASK-075 — fix-first (branch: task-075; base: 259fcdc)
changed:
  - workers/conversational-bridge/src/operations/readyFood.js (record path now requires positive integer servings; consume path flooring unchanged)
  - workers/conversational-bridge/src/mcp.js (record_ready_food schema advertises integer servings, 1–99)
  - workers/conversational-bridge/test/operations.node.js, test/mcp-write.node.js, test/mcp.node.js (fractional rejection, zero mutation, schema and integer regressions)
tests: focused Worker tests (50 passed); full bridge suite (211 passed); Wrangler dry-run unavailable (Wrangler not installed/cached in this Builder environment); changed-JS `node --check`; `git diff --check`.
blockers: none
deviations: no deployment; fractional input is rejected before Firestore access by the MCP schema and by server-side domain validation; consume_ready_food semantics remain unchanged
→ status remains `review` in TASKS.md

<!-- Entries go here, newest first. -->
