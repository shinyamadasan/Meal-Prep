# Conversational Control Bridge Worker

Single-account Cloudflare Worker that lets an authenticated external caller (eventually ChatGPT)
read and write the SAME canonical `pantry` (raw inventory) and `cookedMeals` (ready-to-eat food)
state the app itself uses — never a competing model, never raw Firestore CRUD. Full design
rationale: `docs/DECISIONS.md` D-082. Operation contract: `TASKS.md` TASK-065.

**Production status (TASK-066 checkpoint A, 2026-09-28): REST deployed and provisioned,
READ-ONLY verified only.** The Worker exists at the workers.dev URL below with its four REST
secrets installed. No bridge write has ever been performed through either the REST or MCP surface.
The write path (`update` permission sufficiency, first controlled write) remains checkpoint B and
needs a separate owner decision. See `TASKS.md` TASK-066 for the detailed checkpoint A evidence.

**Production status (TASK-068, closed `done` 2026-10-01): authenticated real-data MCP reads are
LIVE in production.** TASK-067's live ChatGPT feasibility check passed, so MCP is the selected
conversational adapter; OAuth/Access/`OAUTH_KV` are provisioned (see "Required secrets" and
`wrangler.jsonc`), and the owner completed the real ChatGPT OAuth link and confirmed both
`get_inventory` and `get_ready_food` succeeded against production (see `STATUS.md` 2026-10-01).
No write tool exists in deployed production code; that remains exactly the TASK-069 candidate
below, which is local-only.

**Local candidate status (TASK-069, Phase B2A): one authenticated MCP write tool
(`record_ready_food`) now exists in source only — NOT deployed.** This is the first real MCP write
candidate. Nothing in this phase has been deployed; `PRODUCTION_WRITE_COUNT` remains 0. The first
controlled production write requires a separate owner decision after an independent STRICT review
PASS of this local candidate.

## Architecture

```
REST client                         ChatGPT connector
Authorization: BRIDGE_API_TOKEN     OAuth 2.1 + PKCE S256, scoped per tool
        |                                      |
        +------------------+-------------------+
                           v
   src/index.js        — exact-path routing and separate REST/MCP auth domains
        |                       |
        |                       +-- src/oauth.js / src/mcpAuth.js
        |                           provider protocol + owner/scope/resource checks
        |                       +-- src/mcp.js
        |                           thin get_inventory/get_ready_food adapter
        |
   src/operations/*.js — pure domain functions: reimplement the exact invariants
        |                 correctKitchenStock() / _doMarkCooked() / useCookedPortion() /
        |                 finishCookedMeal() enforce client-side, against decoded Firestore
        |                 values instead of AppState.
        v
   src/firestore.js    — typed-value codec + a narrow REST client scoped to exactly one
        |                 document (users/{TARGET_UID}), one field mask at a time.
        v
   Firestore REST API  — PATCH with updateMask.fieldPaths + currentDocument.updateTime,
                          never a whole-document overwrite.
```

The authentication domains are deliberately separate:

1. REST caller -> Worker: `BRIDGE_API_TOKEN`, compared in constant time by `src/auth.js`.
2. MCP caller -> Worker: provider-issued OAuth bearer, validated by
   `@cloudflare/workers-oauth-provider`, then independently checked for the exact resource,
   expiry, an allow-listed `mealprep:read`/`mealprep:write`/combined scope, and configured owner
   subject by `src/mcpAuth.js`.
3. Browser owner -> `/authorize`: a Cloudflare Access application assertion, whose RS256
   signature, issuer, audience, `exp`, `nbf`, token type, and stable `sub` are validated by the
   Worker before consent can be completed.
4. Worker -> Firestore: the service account's JWT-bearer OAuth2 exchange, signed with Web Crypto.

The first and fourth hops predate TASK-068. Never give an MCP caller `BRIDGE_API_TOKEN` or any
Firestore credential. `src/auth.js` still owns these two unrelated REST/Firestore hops:
1. Caller -> Worker: a static bearer token (`BRIDGE_API_TOKEN`), compared in constant time.
2. Worker -> Firestore: the service account's own JWT-bearer OAuth2 exchange, signed with Web
   Crypto (no `firebase-admin` — it isn't Workers-compatible) and cached in module scope for the
   life of the isolate.

The Worker is hardcoded to exactly one Firestore document (`TARGET_UID`, a secret). No route
accepts a caller-supplied uid, collection name, or document path.

## TASK-068 authenticated MCP read layer (live in production)

`/mcp` retains the official `@modelcontextprotocol/server` v2 Web-standard Streamable HTTP
transport. The public TASK-067 probes have been removed from the model-visible surface. Exactly two
zero-input tools remain:

| Tool | Existing canonical mapping | Result |
|---|---|---|
| `get_inventory` | `getUserDocument()` -> `inventory.listInventory(doc.pantry)` | `{ ok, revision, items }`, including stable `ingredientId` values. |
| `get_ready_food` | `getUserDocument()` -> `readyFood.listReadyFood(doc.cookedMeals)` | `{ ok, revision, items }`, including stable `cookedMealId` values. |

Both declare OAuth `mealprep:read` security schemes and `readOnlyHint: true`,
`destructiveHint: false`, `openWorldHint: false`. Their strict empty input schemas reject alternate
UIDs, owners, collections, documents, and paths. The existing Firestore adapter still selects only
the server-side `TARGET_UID`. Neither MCP tool imports or invokes `patchUserDocument`, increments a
revision, creates a tombstone, or exposes a write operation.

### Selected OAuth design and evidence

The selected design is `@cloudflare/workers-oauth-provider` 1.2.1 in the same Worker, with
Cloudflare Access used only as the upstream owner sign-in gate on `/authorize`. Access Managed
OAuth was not selected as the MCP authorization server because its current contract did not
provide a clean project-controlled `mealprep:read` grant/resource model. No OAuth protocol,
cryptography, token persistence, PKCE validation, or client-registration protocol is implemented
by application code.

Source facts verified against current upstream contracts on 2026-10-01:

- OpenAI requires OAuth 2.1 authorization code + PKCE S256, RFC 9728 protected-resource metadata,
  authorization-server discovery, `resource` propagation/audience binding, per-tool
  `securitySchemes`, and runtime challenges. It prefers CIMD where supported:
  https://developers.openai.com/plugins/build/auth
- Cloudflare's provider publishes RFC 9728 metadata and Bearer challenges, persists grants/tokens
  in `OAUTH_KV`, binds tokens to the canonical resource, supports PKCE S256 and CIMD, and passes
  `ctx.auth`/`ctx.props` to the protected handler. Its `requiredScopes` option advertises rather
  than enforces scopes, so this Worker enforces the exact scope itself:
  https://github.com/cloudflare/workers-oauth-provider
- Cloudflare Access application tokens use RS256 and carry `iss`, `aud`, `sub`, `exp`, `nbf`, and
  `type`; Cloudflare says origins must validate the JWT signature and claims:
  https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
- Cloudflare supports hostname/path-specific Access on a `workers.dev` URL, so only `/authorize`
  needs to be behind Access; discovery, `/oauth/token`, and `/mcp` stay reachable by ChatGPT:
  https://developers.cloudflare.com/workers/configuration/cloudflare-access/

Project decisions:

- Canonical issuer: `https://meal-prep-conversational-bridge.shinyamadasan.workers.dev`.
- Canonical protected resource: the same origin plus `/mcp`; metadata is at
  `/.well-known/oauth-protected-resource/mcp` and authorization-server metadata is at
  `/.well-known/oauth-authorization-server`.
- Authorization requests must contain a scope set equal to exactly `{ mealprep:read }`,
  `{ mealprep:write }`, or `{ mealprep:read, mealprep:write }` (TASK-069) before a consent
  transaction is created and again before a grant is written. OAuth's ASCII-space delimiters are
  normalized and exact duplicate tokens are deduplicated; missing, empty, unknown, or any other
  combination is rejected rather than replaced with a supported set. The consent page names
  exactly the requested scope(s) and the authority they grant — a write-capable request is never
  described to the owner as read-only.
- Client registration is CIMD only; DCR is not enabled. The provider accepts the public-client
  `none` token-endpoint method with PKCE. Because the provider advertises RFC 9207 issuer
  identification, the expected current ChatGPT values are client id
  `https://chatgpt.com/oauth/client.json` and redirect URI
  `https://chatgpt.com/connector_platform_oauth_redirect`. At provisioning time, copy the exact
  client document and redirect URI shown in ChatGPT's management page; do not assume a stale value.
- The provider issues short-lived (15-minute) opaque access tokens and fixed-lifetime 14-day
  refresh grants. It validates token existence, expiry, and exact audience from KV before invoking
  MCP. The MCP handler then rechecks expiry, exact resource, an allow-listed scope set containing
  the scope the called tool requires, issuer/resource properties fixed at authorization, and both
  copies of the configured owner subject.
- The canonical `resource` is required explicitly on both authorization-code authorization and
  token/refresh requests; missing, alternate-host, and other-resource values fail closed.
- Owner sign-in is independently gated by a path-specific Access policy and by Worker validation
  of `Cf-Access-Jwt-Assertion`. Authorization uses only the exact configured stable Access `sub`;
  email, display fields, field order, and caller form values cannot select the owner.
- REST `/v1/*` remains on `BRIDGE_API_TOKEN`. OAuth bearer tokens do not authorize REST, and the
  REST bearer does not authorize MCP.

## TASK-070 authenticated MCP ready-food consumption (Phase B2B, local only — NOT deployed)

One new model-visible tool, `consume_ready_food`, bringing the surface to exactly four:
`get_inventory`, `get_ready_food`, `record_ready_food`, `consume_ready_food`. No `finish`, inventory
write, or generic mutation tool exists.

| Tool | Existing canonical mapping | Result |
|---|---|---|
| `consume_ready_food` | `readyFood.consumeReadyFood()` (TASK-071) -> the same `patchUserDocument()` path and `consumeWriteSpec()` field paths `POST /v1/ready-food/consume` uses | `{ ok, revision, item, removed }` |

- Input: exactly three required keys — `cookedMealId` (non-empty string), `servings` (a number),
  and `expectedRevision` (non-negative integer). The schema is a strict object, so a `uid`, path,
  collection, document, operation selector, or caller-supplied deletion map is rejected before any
  Firestore access, and a non-numeric `servings` or a malformed `expectedRevision` is rejected by
  the tool schema (an "input validation error") before any Firestore access.
- `servings` semantics come from `consumePortions()` and are unchanged: the value must be a finite
  number, the domain floors it first, and the floored value must be between 1 and 99 inclusive.
  So for positive input, 1 <= servings < 100 is accepted (2.9 consumes 2; 99.9 consumes 99), while
  anything below 1 or 100 and above is rejected with the domain validation error. `servings` is
  therefore advertised as a plain number, not an integer.
- Result: `item` is the resulting canonical ready-food item (including its stable `cookedMealId`)
  after a partial consume, and `null` when the final serving removed the record (`removed: true`).
- Auth: unchanged. Requires `mealprep:write` via `requireMcpWriteContext`; the OAuth layer was not
  touched.
- Partial consume: same `cookedMealId`, `portionsRemaining` reduced, `cookedMeals` and the new
  `mealConsumptions` fact written (TASK-071), `removed: false`, `item` is the updated record.
- Final serving: the record is removed from `cookedMeals` and `deletions.cookedMeals[<id>]` gets an
  ISO timestamp tombstone (plus the `mealConsumptions` fact, all in one write); `removed: true`, `item: null`. The id is
  retired — a later `get_ready_food` no longer lists it and a later consume returns `not_found`.
- Errors surface as tool errors with `isError: true`: `revision_conflict`, `insufficient_servings`
  (with the remaining count), `not_found`, and the domain validation message (including untracked
  batches). Anything else gets the tool-specific "could not be consumed" fallback.
- Annotations: `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`,
  `openWorldHint: false`. They are a separate constant from `record_ready_food`'s. **Replay is
  unsafe.** Re-sending a request with the same `expectedRevision` fails `revision_conflict` only
  because the first success advanced the revision; a replay with a freshly re-read revision
  consumes again. There is no automatic retry or reread-and-reapply inside the tool.

## TASK-071 consume parity with `mealConsumptions` (local only — NOT deployed)

Before TASK-071, `consume_ready_food` and `POST /v1/ready-food/consume` decremented / removed the
cooked meal but wrote no consumption fact, so those consumes never reached the Life Ledger. They now
match the app's "I ate / Used 1" path (`useCookedPortion()` + `recordMealConsumption()`).

- ONE canonical operation, `readyFood.consumeReadyFood()`, owns validation, the serving count, the
  pre-mutation snapshot, the fact, the decrement/removal and the tombstone. REST and MCP both call
  it and `consumeWriteSpec()`; there is no second path. No new MCP tool, no input/result change,
  no OAuth change (still `mealprep:write`).
- Fact: the app's closed six-field schema `{ id, cookedMealId, recipeId, mealName,
  portionsConsumed, consumedAt }` — no provenance field. `id` is `mc_<crypto.randomUUID()>`
  (collision-checked against existing ids, 10 attempts, then fails loud). `consumedAt` is one ISO
  instant generated once per command (the same instant is used for the tombstone).
  `cookedMealId`, `recipeId` and `mealName` come from the batch BEFORE removal.
- N servings in one command is ONE fact with `portionsConsumed = N` (the floored count: 2.9 -> 2),
  never N facts (MEAL_LEDGER_SOURCE_CONTRACT_V1 allows 1..99 per fact -> `portionCount`).
- Atomic write, one update-time-guarded PATCH and one revision +1. Partial: `cookedMeals`,
  `mealConsumptions`. Final serving: `cookedMeals`, `deletions.cookedMeals`, `mealConsumptions`.
  Any failure (conflict, validation, not found, insufficient servings, untracked batch, persistence)
  leaves zero change — no fact, no tombstone — and nothing is retried.
- Append-only: the bridge reads the whole `mealConsumptions` array (the read mask gained exactly
  `mealConsumptions`), passes every existing record through untouched (no canonicalising, deduping
  or reordering) and appends one. A present-but-non-array value is never overwritten; the consume
  fails instead. A batch without a string `name` cannot be described by the closed schema, so (like
  the app) it is refused rather than consumed without its fact.
- **Known gap, not backfilled:** the one pre-fix production consume, the disposable TASK-070
  acceptance record `cm_1791045734557_839`, has no matching fact. Current ready-food state is
  correct; no safe historical reconstruction was attempted. Repo evidence does not prove it was the
  only production consume.

## TASK-072 authenticated MCP pantry stock state (local only — NOT deployed)

Two model-visible tools expose the existing canonical pantry stock-state operations, bringing the
surface to exactly six: `get_inventory`, `get_ready_food`, `record_ready_food`,
`consume_ready_food`, `mark_out_of_stock`, and `mark_in_stock`.

| Tool | Existing canonical mapping | Result |
|---|---|---|
| `mark_out_of_stock` | `inventory.markOutOfStock()` -> the same guarded pantry / deletion-field write used by `POST /v1/inventory/mark-out-of-stock` | `{ ok, revision, item, unchanged, removed }` |
| `mark_in_stock` | `inventory.markInStock()` -> the same guarded pantry write used by `POST /v1/inventory/mark-in-stock` | `{ ok, revision, item, unchanged }` |

- Both accept exactly `ingredientId` (a non-empty string copied from `get_inventory`) and
  `expectedRevision` (a non-negative integer). Their strict schemas reject caller-selected uid,
  path, collection, document, staple flag, fields, operation, quantity, unit, and other extras
  before Firestore access.
- Both require the existing `mealprep:write` scope. That scope now covers cooked-meal writes and
  pantry stock-state writes; OAuth scope names, discovery, consent, and grant behavior are
  unchanged.
- `mark_out_of_stock` keeps a staple row and sets its stock state to empty. A non-staple row is
  permanently removed from the ChatGPT tool surface and receives a pantry tombstone; no MCP tool
  can recreate it. Staple or not is the app's own rule (TASK-097, see "Staple parity" below); a
  record that rule cannot read is refused as `invalid_record` without writing.
- `mark_in_stock` applies only to an existing staple and sets its stock state to full. It does not
  create items, restore removed non-staples, change quantities, or remove tombstones.
- Already-empty, already-tombstoned, and already-full requests preserve the canonical unchanged
  result: no patch and no revision bump. Mutations use one update-time-guarded patch and one
  revision increment; stale requests return `revision_conflict` and are never retried.
- The app's `correctKitchenStock()` also clears matching grocery purchase receipts and runs staple
  grocery reconciliation. MCP deliberately touches only the canonical pantry/deletion fields;
  `checkAndReplenishLowStock()` plus `saveData()` reconciles the grocery list when the app next
  opens. This eventual reconciliation is the accepted D-082 one-collection boundary.
- Both tools declare `idempotentHint: true`: replay with a freshly read revision converges to the
  canonical unchanged state; replay with the old revision conflicts. `mark_out_of_stock` is
  destructive because its non-staple path removes and tombstones the row; `mark_in_stock` is not.

## TASK-073 authenticated MCP absolute inventory count (local only — NOT deployed)

One more model-visible tool brings the surface to exactly seven: `get_inventory`,
`get_ready_food`, `record_ready_food`, `consume_ready_food`, `mark_out_of_stock`,
`mark_in_stock`, and `set_inventory_quantity`.

| Tool | Existing canonical mapping | Result |
|---|---|---|
| `set_inventory_quantity` | `inventory.setCountedQuantity()` -> `inventory.setQuantity()` -> the same guarded pantry-only write used by `POST /v1/inventory/set-quantity` | `{ ok, revision, item }` |

- Input is exactly `ingredientId` (non-empty string from `get_inventory`), `quantity` (finite number
  strictly > 0), `expectedUnit` (non-empty string) and `expectedRevision` (non-negative integer).
  There is NO replacement `unit` input; uid, path, collection, staple, delta, `unit` and any other
  extra key are rejected before Firestore access.
- `expectedUnit` is a PRECONDITION only: the model asserts the unit it read from `get_inventory`.
  It must equal the stored unit exactly (no trimming, case folding or conversion): `g` vs `kg`,
  `ml` vs `L`, `pieces` vs `cans` all fail with `unit_mismatch` and zero mutation. A row with a
  blank, null or missing stored unit also fails `unit_mismatch`. It is never forwarded to
  `setQuantity()`, never persisted and cannot relabel the row. "I have 0.65kg" against a stored
  `g` row must be resolved or clarified before the call, never sent as 0.65 with `g`.
- It is an ABSOLUTE count: "I have 7 eggs", "chicken is 650g", "only 2 cans left". It is not
  "bought 7" or "add 500g". For a supported "used 3" delta, use `consume_stock` instead.
- Zero and negative quantities are rejected with a pointer to `mark_out_of_stock`. The tool never
  translates zero into an out-of-stock call, and never creates a zero-quantity row.
- The row's stored unit is preserved and nothing is converted.
- Explicit staple rows are refused (staples are tracked by stock level: use `mark_in_stock` /
  `mark_out_of_stock`). Since TASK-097 staple-ness is the app's own rule, and a presence-only row
  (no usable quantity and unit) is refused as `presence_only` before the unit precondition. Unknown
  or tombstoned ids return `not_found`.
- A same-value set is NOT a no-op: canonical `setQuantity()` always stamps `updatedAt`, so it is a
  normal guarded write with one revision increment. Replay with the old revision conflicts.
  `destructiveHint: true` because the tool overwrites an existing quantity (false means additive
  updates only). `idempotentHint: true` by the MCP definition (same arguments, no additional
  effect): `expectedRevision` is one of the arguments, so an exact replay is a `revision_conflict`
  with zero mutation; a call with the new revision is a different call.
- One update-time-guarded pantry patch; stale `expectedRevision` returns `revision_conflict` with no
  mutation and is never retried. Requires the existing `mealprep:write` scope; OAuth is unchanged.

## TASK-076 authenticated MCP stock consumption (integrated and deployed)

`consume_stock` adds a semantic quantity delta for one existing pantry row; the current local MCP
surface at TASK-076 had exactly eight tools. That reviewed candidate was integrated and deployed;
TASK-077 later added one more tool.

- Input is exactly `ingredientId`, `quantity`, `expectedUnit`, and `expectedRevision` (TASK-093
  adds `requestId`, TASK-094 the optional `boughtDate`). The id must
  come from `get_inventory`; duplicate-name matches require asking which row. The amount is the
  delta used, never an absolute resulting quantity. Extra uid/path/collection fields fail before
  Firestore access.
- The pure `operations/quantity.js` helper accepts exact same-unit arithmetic and exact metric
  scaling only between `g`/`kg` and `ml`/`L`. It does not infer cups, density, aliases, or
  count-to-mass conversions. Unknown or blank stored units fail safely.
- Partial quantity consumption is limited to explicitly non-staple rows. Over-consume returns
  `insufficient_stock` and writes nothing. Exact-zero non-staple consumption uses the canonical
  removal plus pantry tombstone path. Partial staple consumption is unsupported; exact depletion
  uses `markOutOfStock()` to retain the staple id and set `stockLevel: 'empty'`. A presence-only
  row is refused as `presence_only` and an unreadable one as `invalid_record` (TASK-097), without a
  write.
- The tool uses `mealprep:write`, one observed revision, and one update-time-guarded patch. It never
  retries and is non-idempotent: replaying with a fresh revision consumes again. Its write boundary
  is pantry, `deletions.pantry` only for exact-zero non-staple removal, and the normal version field.
  Shopping, ready food, `mealConsumptions`, and recipe data are untouched.
- “All” is only an exact delta after reading the current quantity, unit, and revision. “Half an
  egg” is supported only when the row is explicitly in `pieces` or `pcs` and the user’s amount is
  exactly represented in that same unit; those spellings remain distinct and the Worker invents
  no conversion.

## TASK-077 authenticated MCP stock replenishment (integrated and deployed)

`add_stock` adds an exact purchase delta to one active existing pantry row. The MCP surface has
exactly nine tools. Reviewed candidate `9561f665` is deployed as Worker version
`4e0200cc-7e4d-4559-b9fe-00a2e2ef299f` (100%); the production pilot passed (see TEST_REPORT.md).
Shopping preservation is supported by code/review evidence only (the write mask is `pantry` plus
`version`); it was not verified live because no shopping read tool exists.

- Input is exactly `ingredientId`, `quantity`, `expectedUnit`, and `expectedRevision` (TASK-093
  adds `requestId`, TASK-094 the optional `boughtDate`). The stable id
  must come from `get_inventory`; duplicate-name matches require asking which row. Quantity is the
  amount bought, never an absolute total. The Worker adds it to the live stored quantity. Extra
  uid/path/collection, date, storage, or other metadata keys fail before Firestore access.
- `operations/quantity.js` is reused: exact same-unit arithmetic and only `g`/`kg` or `ml`/`L`
  metric scaling. No density, cups, pieces-to-mass, package/can conversion, alias, or fallback.
  `expectedUnit` asserts the unit used for the delta and is never persisted.
- The existing row id and purchase, expiry, storage, category, and other metadata are preserved;
  only quantity/update time change for a non-staple. Numeric staples add the delta and become
  `stockLevel: 'full'`. Stock-level-only staples are refused with a direction to `mark_in_stock`.
- Printed-expiry rows cannot merge, matching app purchase-merge behavior. It never resets purchase
  dates to make old stock look fresh. (Superseded by TASK-094: mergeability now comes only from the
  shared safety verdict for the household day, and fridge safety lots need `boughtDate`.)
- Absent and tombstoned ids are refused; `add_stock` never creates or resurrects a row. A removed
  non-staple must be re-added through the app.
- One `mealprep:write` authorization, one observed revision, one update-time-guarded pantry patch,
  and no retry. Overflow, precision loss, stale revisions, unsupported units, and unsafe metadata
  fail without mutation. The delta is non-idempotent and must not be replayed with a fresh revision.
- Shopping, ready food, meal-consumption history, recipes, and unrelated inventory remain untouched.
  The app may perform its existing grocery reconciliation on a later open; this Worker does not.

## TASK-092 truthful reads: a safety verdict on every item (PROP-041 P1-2, local only — NOT deployed)

Closes audit C1 (chat could call unsafe or unknown food available) and C3 (`record_ready_food`
description drift). Read tools and descriptions only: no write behaviour, tool, OAuth, route,
secret or Firestore change. Deploy is held for the owner (BQ-032).

- **Household calendar day.** `src/householdDay.js` turns the injected clock into a `YYYY-MM-DD`
  day in `HOUSEHOLD_TIME_ZONE` (`wrangler.jsonc` `vars`, `"Asia/Manila"`) with
  `Intl.DateTimeFormat`. One setting for the household, not per person. A missing or invalid zone
  throws `InfrastructureError` and the read fails before any Firestore access; the Worker never
  guesses a day. (TASK-094 replaced the UTC ±1-day guard inside `add_stock` with this day.)
- **`get_inventory`** items add `category`, `purchaseDate`, `expiryDate`, `dateMode`,
  `printedDateKind` (string or null) next to the existing fields, plus
  `safety: { status, reason, label, daysLeft, usable }` from `pantrySafety()` in
  `operations/inventory.js`. It uses only the shared rules (`shared/foodSafety.js`, D-091) on the
  default storage path (no `PANTRY_KNOWLEDGE`): a lot with no `storage` whose exact name has no
  INGREDIENT_DB storage is `unknown`.
  - `status` is `ok | use-soon | check | expired | unknown` from `pantryDateSignal()`.
  - `usable` is `pantryLotAvailable()`, except that `expired` or `unknown` is never usable (D-091:
    stricter than the app for a staple past its printed use-by).
  - `daysLeft` is the sooner of the app's date estimate and the fridge safety limit
    (`pantryFridgeSafety()`), so chat is never told "1d left" for raw chicken whose 2-day limit
    ends today. This can only turn `ok` into `use-soon`; it never changes `usable`.
  - A record the shared rules cannot read (for example a non-string `category`) is
    `unknown`/`unreadable-record` instead of failing the whole read.
- **`get_ready_food`** items add the same `safety` object from `readyFoodSafety()` in
  `operations/readyFood.js`: `cookedDateSignal()` plus `cookedMealAvailable()`, the app's own
  `getReadyFoodSuggestions()` rule (moved to `shared/foodSafety.js` with `portionCountOrNull()` and
  `cookedMealTracksPortions()`; app wrappers keep the old names). A missing or invalid
  `cookedDate`, or an unreadable fridge shelf life, is `unknown` (not usable). A frozen batch with
  a valid `cookedDate` and no freezer quality window is `ok` (freezing is a quality limit).
- **Descriptions.** Both read tools say: never suggest `usable:false`; `unknown` is not usable;
  `check` means look at it first; `expired` is never usable. `record_ready_food` now says that
  without a `source` the app still applies its 4-day fridge limit from `cookedDate`.
- **Schemas.** Read items use strict `inventoryReadItemSchema()` / `readyFoodReadItemSchema()`.
  Write results keep `inventoryItemSchema()` / `readyFoodItemSchema()` unchanged. REST `/v1/*`
  reads are unchanged.
- Tests: `test/household-day.node.js` (Manila midnight, month end, leap day, fail closed),
  `test/mcp-safety.node.js` (response verdict = shared verdict for every case in both parity
  fixtures and three `today`s, the boundary end to end, D-091, descriptions, schemas) and
  `test/ready-food-parity.node.js` (Node side of `tests/fixtures/ready-food-parity.json`).

## TASK-093 no duplicate writes: required `requestId` + atomic request record (PROP-041 P1-3, local only — NOT deployed)

A retried or replayed chat write can never apply twice. MCP write tools only; REST `/v1/*` routes
and the read tools are unchanged. Deploy is held for the owner (BQ-032).

- **Required `requestId`** on all seven MCP write tools (`record_ready_food`,
  `consume_ready_food`, `mark_out_of_stock`, `mark_in_stock`, `set_inventory_quantity`,
  `consume_stock`, `add_stock`): a string of 8-128 characters from `[A-Za-z0-9_-]`. The public
  schema enforces it and `requests.validateRequestId()` repeats the rule inside the adapter, so a
  missing or malformed id is a validation error before any Firestore access. Each description
  tells chat to generate a new id per change and to resend the SAME id when retrying that change.
- **One atomic commit.** `firestore.js` `commitRequestWrite()` sends ONE `documents:commit` with
  two writes: (a) the same guarded user-document update as before (same field paths plus
  `version`, version + 1, `currentDocument.updateTime` precondition, or `exists:false` for a
  not-yet-created document) and (b) a create-only `users/{uid}/mcpRequests/{requestId}` document
  (`currentDocument.exists:false`). Both apply or neither does. `patchUserDocument()` is now used
  by REST only.
- **The request record** (`operations/requests.js` `buildRequestRecord()`): `tool`, `argsHash`
  (SHA-256 hex of the canonical, key-sorted JSON of the arguments without `requestId` and
  `expectedRevision`), `actor` (the OAuth owner subject), `createdAt` and `expireAt` (Firestore
  timestamps; `expireAt` = `createdAt` + 30 days), `revisionBefore`, `revisionAfter`, `result`
  (the exact tool result), and `before`: a full copy of every pantry / cookedMeals record the write
  changed or removed, plus `before.deletions.{pantry|cookedMeals}[id]` = the prior tombstone value
  of every tombstone entry the write touched (`null` = there was none). A record the write only
  creates (`record_ready_food`) has no `before`. `added` = `{ pantry?, cookedMeals?,
  mealConsumptions? }`: full copies of the records the write added (a new id), e.g. the new batch
  from `record_ready_food` or the ledger fact `consume_ready_food` appends. `before` + `added` are
  TASK-095's undo input.
- **Replay.** The adapter reads the request record first (after auth and validation, before the
  user document). Same `requestId` + same tool + same `argsHash` returns the stored result with
  `replayed: true` and writes nothing, even if `expectedRevision` is now stale. Same `requestId`
  with different arguments or a different tool is `request_id_reused`, zero writes. If the commit
  fails its precondition and the request record now exists (a concurrent call with the same id
  won), the record is read back and answered the same way; otherwise it is `revision_conflict` as
  before. `replayed` is optional in every write output schema and present only on a replay.
- **No-ops spend their id.** `mark_out_of_stock` / `mark_in_stock` on an already-out / already-
  full item return `unchanged: true` and leave the user document (and `version`) untouched, but
  still commit the request record alone. A lost-response retry with the same id gets the same
  answer instead of applying a change nobody confirmed (e.g. after the item was restocked in the
  app); the id cannot be reused for a different change.
- **Safe id lookups.** Write lookups (`findPantryIndex()`, `findMealIndex()`) now use the reads'
  `readableId()` rule: a stored id that is not text or a finite number is skipped instead of being
  passed to `String()`, which can throw (TASK-092 review carry-over). REST uses the same lookups.
- Tests: `test/mcp-request-ids.node.js` (schema and validation on every tool, commit shape, record
  contents and 30-day `expireAt`, `before` snapshots, replay after success / stale revision /
  timeout that landed, concurrent identical and different requests, reuse, no-op, transport, the
  hostile-id lookups). Existing write-tool tests send a fresh `requestId` per call
  (`test/support/requestIds.js`); the fake Firestore models `documents:commit` and the
  `mcpRequests` subcollection.

**One-time owner steps before this can be deployed (NOT performed by TASK-093):**

1. **IAM.** The bridge's custom Firestore role holds only `datastore.entities.get` and
   `datastore.entities.update` (see "Production enablement checklist"). A request record is a NEW
   document, so the role also needs `datastore.entities.create`. Without it every MCP write fails
   closed (a permission error, nothing written). Grant it, then verify with one controlled write.
2. **TTL policy.** In the Firebase / Google Cloud console, add a Firestore TTL policy on
   collection group `mcpRequests`, field `expireAt`. Firestore then deletes each record some time
   after its `expireAt` (typically within a day or so; deletion is not instant). No code or
   pruning job depends on it; until it exists, records simply stay.

## TASK-094 safe purchase handling in `add_stock` (PROP-041 P1-4, local only — NOT deployed)

Closes audit C2: new food never inherits an older or unsafe lot's clock, and no bought date is
invented (owner decision 4). No new tool and no lot creation (Phase 2). Read tools and the other
write tools are unchanged; `requestId` / `expectedRevision` guards are unchanged.

- **One gate: the shared verdict.** `requireMergeableLot()` in `operations/inventory.js` decides
  with `pantrySafety()` (TASK-092, built on `shared/foodSafety.js`) for the household day
  (`HOUSEHOLD_TIME_ZONE`, same `householdDayFromEnv()` and injectable clock as the reads). The
  bridge-only `CATEGORY_SHELF_LIFE_DAYS` defaults and the UTC ±1-day skew window are removed.
- **Refused, zero writes, no request record** (validation error; the message says to "record the
  new purchase separately in the app"): a lot `get_inventory` would call `invalid-record`
  (`readableLot`), a lot whose stored `storage` is not exactly `fridge`, `freezer` or `counter`
  (`''`/null fall back to the shared inference; `'Fridge'` or `{}` would skip the fridge limits), a
  lot with a printed date (use-by or best-before, staple or not), or a lot whose verdict is
  `expired`, `unknown` or `check`. A lot whose only problem is
  being out of stock (`reason: out-of-stock`, e.g. an empty staple with in-date or no dates) can
  still be refilled: that is not a date problem.
- **Fridge safety lots** (shared `pantryFridgeSafety()` non-null: raw meat, poultry, seafood, ground
  and variety meat, sausage, cooked food) need the new optional input `boughtDate` (`YYYY-MM-DD`,
  the day the NEW stock was bought). Missing ⇒ `needs_bought_date: …` (chat asks the user; it may
  use today only if they said "today" or "just bought"). A different day than the lot's
  `purchaseDate` ⇒ refused as a separate lot. The same day ⇒ merge.
- `boughtDate` must be a real calendar day not after the household day; a malformed or future date
  (and an invalid `HOUSEHOLD_TIME_ZONE`) fails before any Firestore access. Other lots keep their
  stored dates; a supplied `boughtDate` EARLIER than the lot's bought date is refused (older stock
  must not take a newer clock), a later or equal one merges.
- `boughtDate` is a business argument, so it is in the request's `argsHash`: the same `requestId`
  with a different (or missing) `boughtDate` is `request_id_reused`.
- **Stated back.** The success result adds `lot: { boughtDate, storage, storageSource }`: the
  lot's stored `purchaseDate` when it is a real calendar day (else null), its storage, and
  `storageSource` = `recorded` (stored on the lot) or `inferred` (no storage recorded; guessed from
  the ingredient, and chat says so) or null.
- Tests: `test/operations-add-stock.node.js` (every refusal branch, each fridge safety class,
  the lot at its limit: "Use today" merges, the next day is refused; boughtDate validation;
  staple/non-safety merges and the stated-back lot) and `test/mcp-add-stock.node.js` (zero writes
  and no request record on refusal, the Manila/UTC household-day boundary both ways, schema
  and time-zone failures before Firestore, replay and `request_id_reused` on a changed
  `boughtDate`).

## TASK-095 recoverable chat changes: `undo_request` (PROP-041 P1-5, local only — NOT deployed)

One new write tool, `undo_request({ requestId, undoRequestId, expectedRevision })` (ten tools in
all). `requestId` names the earlier chat change to undo; `undoRequestId` is the undo's OWN id
(same 8-128 `[A-Za-z0-9_-]` rule), so the undo is itself recorded and replay-safe through the
shared TASK-093 adapter: the same `undoRequestId` + same `requestId` replays, a different
`requestId` is `request_id_reused`. Logic lives in `operations/requests.js`
(`checkUndoable()`, `planUndo()`, pure); `mcp.js` stays a thin adapter.

- **Input it needs.** Every new request record also stores `after` (the after-state of each
  record the write changed or added, and the value it left in each tombstone entry it touched).
  Records without it (none are deployed) are refused as `undo_record_incomplete`.
- **What it restores.** Changed records get their `before` copy back; removed records come back
  with the same id and their tombstone is deleted (the app's restore, D-083); every restored record
  gets `updatedAt` = the undo time. A ready-food batch the request created is removed again with a
  fresh tombstone (D-071). Other tombstone entries the request touched return to their prior value.
- **ONE commit, three writes:** the guarded user-document update, the undo's create-only record
  (with `undoes`), and `undoneBy` on the original record under that record's `updateTime`
  precondition — two undos of one request can never both apply.
- **Refused with zero writes** (reason is the text prefix): `request_not_found` (no record, or
  removed by the TTL policy), `undo_expired` (now >= `expireAt`, injected clock), `undo_of_undo`,
  `already_undone`, `nothing_to_undo` (a no-op original), `undo_not_supported`
  (`consume_ready_food`, see below), `undo_record_incomplete`, `changed_since` (an affected record
  or tombstone differs from the request's after-state, or the batch to remove was eaten from) and
  `id_in_use` (a removed id is back). `revision_conflict` as for every write. A refusal does NOT
  record the `undoRequestId`: it stays unspent and a retry re-evaluates.
- **Known limits (accepted).** Two chat changes to the same record: only the LATER one can be
  undone; after undoing it, the earlier one is still refused as `changed_since` (the record now
  holds the earlier change's `before`, not its `after`, and has a new `updatedAt`). A revived record
  is appended at the end of its array, not at its old position (order carries no meaning in the
  app). A batch `record_ready_food` added had no `updatedAt`; the app stamps one on load and saves
  it, so for an added record whose written copy had no `updatedAt`, a live `updatedAt` alone is not
  a change (every other field must still match).
- **Eaten food is never undone.** `mealConsumptions` facts are append-only with a closed schema and
  `portionsConsumed` 1..99 (ledger contract), so there is no way to delete or offset one. Undoing
  `consume_ready_food` is refused (`undo_not_supported`); the user corrects portions in the app.
  No undo ever writes `mealConsumptions`.
- **IAM:** marking `undoneBy` is an update of an `mcpRequests` document; the role's existing
  `datastore.entities.update` covers it (plus TASK-093's `create`).
- Tests: `test/mcp-undo.node.js` (undo of each write tool, stale-after-edit, removed id reused,
  tombstone changed, expired, missing, incomplete record, no-op original, double undo sequential and
  concurrent, the original-record precondition alone, undo-of-undo, replay, reused id).

## TASK-097 staple parity and `tracking` (PROP-041 P2-0a, local only — NOT deployed)

Before TASK-097 the bridge had no `INGREDIENT_DB`, so a pantry record with no `staple` flag and a
category other than `Pantry` was refused as `ambiguous` by every stock write (59 of 97 real lots).
The bridge now uses the app's own rule from the shared core.

- **Parity rule.** `classifyStaple()` / `isStapleRecord()` (`operations/inventory.js`) call
  `MealPrepFoodSafety.isStaple` (`shared/foodSafety.js`), the same function `app.js` uses: stored
  `staple === true` / `false` -> exact-name (case-insensitive, untrimmed) `INGREDIENT_DB.isStaple` ->
  category `Pantry` in any case -> otherwise non-staple. Aliases and near-miss names do not match.
  `test/mcp-staple-parity.node.js` checks the bridge against `isStaple` for every fixture.
- **Unreadable records are never guessed.** A record the shared rule throws on (not an object; a
  name or category that is a number, map or array where the rule reads it), or one the read gate
  (`readableLot`) rejects (a non-text unit/storage/name, a non-number quantity, an unknown
  `stockLevel`), is `invalid`: `get_inventory` flags it `safety.reason: 'invalid-record'`, `usable: false`, `tracking: null`, and
  every write tool refuses it as `invalid_record` with zero writes and no request record.
- **`tracking` on `get_inventory` items.** `level` = a staple (tracked by `stockLevel`; use
  `mark_in_stock` / `mark_out_of_stock`; `add_stock` / `consume_stock` also accept a staple with a
  recorded quantity, in its exact unit). `quantity` = a non-staple with a finite `quantity` (any
  sign; the app treats <= 0 as not available) and a non-blank `unit` (the quantity tools apply). `presence` = a non-staple without a
  usable quantity or unit: being listed means in stock, and no amount is known. `null` only for an
  invalid record. Write-result items keep their existing shape (no `tracking`).
- **Quantity tools refuse presence lots.** `set_inventory_quantity`, `consume_stock` and `add_stock`
  return a `presence_only` validation error telling chat to ask the user for the amount (never
  invent one): zero writes, no request record, so the `requestId` is not spent.
- **What changes in practice.** A formerly `ambiguous` lot now gets the app's answer: a counted
  non-staple works with the quantity tools (still behind the P1-4 `add_stock` safety refusals);
  `mark_out_of_stock` removes a non-staple with a tombstone (undoable, TASK-095) and keeps an
  `INGREDIENT_DB` staple such as `Garlic (Bawang)` as `stockLevel: 'empty'`. `requestId`,
  `expectedRevision`, undo and every other Phase 1 guard are unchanged. No stored record changes.
- The `ambiguous` error code is still mapped by the REST and MCP layers but is no longer produced
  for staple classification. Over REST, `mark-out-of-stock` and `mark-in-stock` refuse an
  unreadable record as `422 validation_failed` whose message starts `invalid_record:` (accepted,
  TASK-097 review S4). REST `set-quantity` is the raw absolute write (D-082/TASK-065) and is NOT
  classified: it still writes such records (pre-existing; REST has no known client and is slated
  for retirement or parity, release checklist 2.1).

## TASK-099 register and correct pantry items: `add_pantry_item`, `update_pantry_item` (PROP-041 P2-1 + P2-2, local only — NOT deployed)

Two MCP write tools, both through `requestWriteTool()` (required `requestId` + `expectedRevision`,
one atomic commit with the request record, undoable). Logic lives in `operations/pantryItems.js`
and uses only the shared rules (`MealPrepFoodSafety`) and `MealPrepReadyFoodContract`; no app-only
table (`PANTRY_KNOWLEDGE`) is copied. Every refusal below happens before the commit: zero writes, and
the `requestId` stays unspent (the same id can carry a corrected call).

"Safety lot" below = a lot with a fridge safety limit (`pantryFridgeSafety` on the lot as if in the
fridge: raw meat, poultry, seafood, ground, variety, sausage, cured or cooked food), or a meat or
fish name `INGREDIENT_DB` does not know (see `unrecognized_food`). Messages call it "raw meat,
poultry or fish, or a food the bridge cannot classify".

- **`add_pantry_item`** creates ONE lot shaped like the app's manual Add / grocery `buy_` path:
  `id` `buy_<ms>_<rand5>`; `name` (trimmed, used as given); `category` = the `INGREDIENT_DB` entry
  for the exact name, else for an exact alias (`stockIngredientEntry`, so "chicken fillet" is stored
  as Protein and the app's Kitchen card applies the poultry limit), else the app's loose
  `inferCategory()` substring match **only when it gives Protein to a name that already reads as raw
  meat, poultry or fish** — any name the name-only rules below match is stored as `Protein`
  (review SF2), so the shared fridge limits apply to it in the app and here — else `''`; `purchaseDate` = `boughtDate`, default the household day
  (`HOUSEHOLD_TIME_ZONE`), never in the future; `shelfLifeDays` = exact-name `INGREDIENT_DB` value,
  else `categoryShelfLife(category)` (the app's `ingredientShelfLife()`), and for a name-only
  meat or fish match never longer than its name-only limit ("Pork mince": 2 days, not the 3-day
  Protein default); `storage`; `quantity`
  (> 0, else `null`); `unit` (given, else the DB unit, else `''`); `staple` (given, else
  `!!INGREDIENT_DB.isStaple` when the name is in the DB, else left unset — the app's own rule);
  `stockLevel` for a stored staple (`level`, default `full`; `level` on a non-staple is refused);
  a printed date -> `expiryDate` + `dateMode: 'expiry'`, `printedDateKind` only for `best-before`;
  `updatedAt` now. Keys the app would leave `undefined` are omitted.
- **Storage (D3).** A given storage wins (`storageSource: 'given'`). Otherwise
  `defaultInferStorage(name)` (`storageSource: 'inferred'`, stated back). Refused with
  `needs_storage` when the shared rules give no storage or for a safety lot. Owner-facing spec
  note (review SF4): `defaultInferStorage` returns empty for most groceries (every name not in
  `INGREDIENT_DB`, and DB entries with no storage), so chat usually asks where an item is kept.
  That is the safe outcome, not a bug. Safety lots also need an explicit `boughtDate` (`needs_bought_date`; never assumed
  to be today) and are never stored on the counter (`unsafe_storage`). A fridge lot already past its
  fridge safety limit is refused (`past_safety_limit`). **Name-only rules** (only for a name
  `INGREDIENT_DB` does not know by name or alias): the shared raw poultry / seafood / whole-cut /
  variety / sausage words; the ground-meat words `giniling`, `hamburger`, `stew meat`, `mince`,
  `meatball(s)`, `patty` / `patties` / `burger patties` (not "minced", which also names prepared
  vegetables; ground is checked first, so "Pork mince" is 2-day ground, not 3-day whole cut); and
  words the shared regex does not list (review SF3): `bratwurst`, `kielbasa`, `ham` / `sliced ham`,
  and fish and shellfish such as cod, mackerel, trout, halibut, haddock, pollock, snapper, sea bass,
  catfish / hito, tanigue, lapu-lapu, maya-maya, milkfish, dalagang bukid, tulingan, swordfish,
  lobster, octopus. A match needs a stated storage and bought date, is never on the counter and is
  stored as `Protein`. With Protein the shared limits place most of them ("Chicken wings", "Steak",
  "Turkey", "Sausages", "Lamb chops", "Chicken liver", "Rib eye", "Spare ribs", "Scallops", "Fish
  fillet", "Pork mince", "Chicken sausage", "Sliced ham" are accepted in the fridge). A name the
  shared limits still cannot place (cod, mackerel, bratwurst, meatballs, venison...) is refused in
  the fridge as `unrecognized_food` (it can be recorded in the freezer) instead of getting the
  category default; the message does not suggest renaming the food. Names where the meat or fish
  word is part of a non-meat food are not matched: cheese, mushroom, sauce, lettuce, palm, mayo,
  balls, artichoke, dressing, paste, broth, stock, seasoning, chips, noodles, oil, buns, bread,
  milk, cream, veggie, vegan, vegetarian, plant-based, meatless and similar ("Goat cheese", "Lamb's
  lettuce", "Steak sauce", "Oyster mushrooms", "Tuna mayo", "Fish balls", "Hamburger buns",
  "Chicken stock", "Beef broth", "Veggie burger patties" are accepted).
- **Prepared ingredients (`prepared: true`).** `storage` fridge or freezer is required. In the
  freezer with no printed date, `shelfLifeDays` = `READY_FOOD_CONTRACT.defaultFreezerLife` (not
  capped at the raw fridge life; freezing is what makes it last). In the fridge, and whenever a
  printed date is given, `shelfLifeDays` = `min(READY_FOOD_CONTRACT default life for that storage,
  the raw shelf life above)`. Not stored on the record. Raw lots are NOT deducted (D2, TASK-100).
- **Duplicate guard.** An active (not tombstoned) lot with the same name (case-insensitive,
  trimmed), the same `purchaseDate` and the same storage (stored, else `defaultInferStorage`) is
  `ambiguous`, naming its `ingredientId`(s), unless both lots have a printed date and the two dates
  differ. A printed date missing on either side is unknown, not different (review SF1). With no
  printed date on either side the choices are `add_stock` to it or `confirmNewLot: true`; when
  either side has a printed date only `confirmNewLot: true` is offered (`add_stock` has no
  printed-date input). A different day or storage, or two different printed dates, is a new lot.
- **`update_pantry_item`** changes only `storage`, `purchaseDate` (`boughtDate`, or `thawedToday`
  = household day), `expiryDate` / `dateMode` (`printedDate`; `null` clears both and the kind),
  `printedDateKind` (a new printed date is use-by unless `best-before` is sent) and, when a lot
  leaves the freezer for the fridge, `shelfLifeDays` (capped, below). `thawedToday` is only valid
  with `storage: 'fridge'` on a lot recorded in the freezer. Unknown / tombstoned ids are
  `not_found`; lots `get_inventory` flags `invalid-record` are `invalid_record`. Values already as
  asked -> `unchanged: true`, no user document write (the request record is still kept, like
  `mark_in_stock`).
- **Edits never make a safety lot read safer than it is** (STRICT review fixes). Freezing does not
  make past-limit food safe again. Each refusal asks chat to have the user check the item in the app.
  - `unrecognized_food`: a move INTO the fridge (from the freezer, the counter or an unknown place)
    runs the same check as the add path, so an unknown protein name never enters the fridge without
    its limit, even with a thaw date.
  - `unsafe_storage`: a safety lot is never moved to, or edited while left on, the counter.
  - `past_safety_limit` / `unknown_bought_date`: a safety lot is not moved out of the fridge (or the
    counter) into the freezer while it is past its fridge limit, or when its bought date is unknown —
    checked on both the current and the corrected date. For a name the shared limits cannot place,
    the clock uses the rule its name matches.
  - `later_bought_date` / `unknown_bought_date`: a safety lot's `boughtDate` may only move EARLIER,
    and is not set at all when the stored date is unknown. The one exception is leaving the freezer
    for the fridge with `thawedToday` or an explicit thaw `boughtDate`, which restarts the fridge
    clock.
  - `needs_thaw_date`: a safety lot leaving the freezer for the fridge, or ANY lot leaving the
    freezer for the fridge whose `shelfLifeDays` is longer than its fridge life, needs `thawedToday`
    or a `boughtDate` (the thaw reminder). Its `shelfLifeDays` is then capped at the fridge life:
    for a bridge-prepared frozen lot (`shelfLifeDays` = the ready-food freezer life, longer than the
    raw life) `min(READY_FOOD_CONTRACT.defaultFridgeLife, raw life)`; otherwise the raw life (exact-
    name DB value, else the category default). A frozen lot whose `shelfLifeDays` equals
    `READY_FOOD_CONTRACT.defaultFreezerLife` (90) is read as prepared whatever its raw life (review
    MF2: prepared rice, pasta or peanut butter has a raw life above 90), so it too needs the thaw day
    and gets `min(defaultFridgeLife, raw life)`. Such a long-life frozen lot is not moved to the
    counter (`unsafe_storage`).
  - `frozen_printed_date`: a lot with a printed date (`dateMode: 'expiry'`) leaving the freezer for
    the fridge first needs the thaw day (`needs_thaw_date`), then is refused: the printed date no
    longer says how long it keeps once thawed, and the bridge never invents or silently clears it.
- **Results** state back `item` = the `get_inventory` item for the stored record (same `safety`
  computation) plus `shelfLifeDays`, and `storageSource`; `add_pantry_item` adds `prepared`,
  `update_pantry_item` adds `unchanged` and `thawed`.
- **Undo.** `undo_request` removes an added lot with a fresh tombstone and restores an edited lot's
  earlier values, `shelfLifeDays` included (TASK-095 planner, unchanged), refusing `changed_since`
  after a later edit. Undoing an `update_pantry_item` is itself a storage/date edit (review MF1):
  `unsafe_restore` (reason, under `undo_refused`) refuses it, with zero writes and both ids left
  unspent, when putting the lot back would make it read safer than it is — checked as the move from
  the current lot (the request's after-state, matched to the live record) to the restored one, on
  the household day fixed once per call: a safety lot past its fridge limit or with no known bought
  date going back into the freezer (a week-old thaw), a safety lot's bought date moving later, a
  safety lot going back onto the counter, a meat or fish name with no shared limit going back into
  the fridge, or a lot that is not usable, or carries a warning (expired, unknown, past its
  estimate), coming back usable or clean. Chat tells the user to check the item in the app. A
  same-day undo of a mistaken thaw still works. Undo of `add_pantry_item` (a removal) is unchanged.

### Known gaps (TASK-099)

- **Fish species and cured meats are missing from the shared regex.** `FRIDGE_SAFETY_LIMITS` in
  `shared/foodSafety.js` does not list many fish and shellfish names (cod, lobster, mackerel,
  sardine, anchovy, halibut, trout, octopus...) or cured meats (salami, prosciutto, pepperoni,
  tocino, tapa...). The bridge's name-only words now cover many fish and shellfish (cod, mackerel,
  trout, halibut, lobster, octopus...) and ham, so those need a stated storage and bought date, stay
  off the counter, and are refused in the fridge for want of a shared limit. Names using only words
  on neither list (sardine, anchovy, salami, prosciutto, pepperoni, tocino, tapa...) are still not
  caught and get the category default. Fixing it properly is a shared-rule change (app + bridge
  parity), outside this bridge-only task.
- **"Prepared" is not stored on the record** (no new pantry field). A frozen prepared lot is
  recognised on the way out of the freezer by its ready-food freezer `shelfLifeDays` (90), whatever
  the raw item's life; any lot whose shelf life is 90 for another reason is treated the same way
  (the fridge cap only shortens its life, the stricter outcome).
- **Name-only meat and fish words are a list, not a classifier.** The bridge's extra words (above)
  catch common names; a raw meat or fish name using none of them and not in the ingredient list is
  not asked about: it gets the inferred storage (usually none, so chat asks), may go on the counter,
  and with no stated bought date is assumed bought today. Cod, mackerel, bratwurst, meatballs and
  similar have no shared fridge limit, so they are recorded only in the freezer from chat.
- **A same-day freeze then thaw restarts the clock** (review SF5). No storage history is kept, so
  a fridge lot moved to the freezer and back to the fridge with `thawedToday` gets a fresh fridge
  clock from the thaw day, even if it spent most of its fridge time before freezing. Freezing is
  only allowed while the lot is within its fridge limit, which bounds the error.

## TASK-069 authenticated MCP write pilot (Phase B2A, local only)

Exactly one write tool exists, on top of the two TASK-068 read tools (three total; no other
write/delete/patch/execute tool exists anywhere in the diff):

| Tool | Existing canonical mapping | Result |
|---|---|---|
| `record_ready_food` | `readyFood.recordCookedFood()` -> the same `patchUserDocument()` path `POST /v1/ready-food/record` uses | `{ ok, revision, item }`, including the new stable `cookedMealId`. |

`record_ready_food` requires the new `mealprep:write` scope (a read-only grant is denied with
`insufficient_scope`, matching the existing missing-scope challenge shape). It declares OAuth
`mealprep:write` security schemes and `readOnlyHint: false`, `destructiveHint: false`,
`idempotentHint: false`, `openWorldHint: false`. `idempotentHint` is `false` because
`recordCookedFood()` mints a fresh random `cookedMealId` on every call — conflict-safety under
`expectedRevision` is not the same property as idempotence.

Optional `source` is restricted to the shared `leftovers` / `takeout` contract in
`shared/readyFoodContract.js`. Supplying it stores that source and the contract's fridge/freezer
freshness defaults; omitting it keeps the legacy unknown-source/unknown-freshness behavior. The
browser's manual leftovers/takeout form reads the same contract. `servings` means whole meal
portions: ask for a count when “half” or another amount is unclear. A per-record storage choice
means split fridge/freezer food needs separate records. Record only the food brought home; this
tool does not log restaurant meals or consumption. Throwing food away is not consumption and must
not call `consume_ready_food`.

The tool is a thin adapter, not a second implementation: it reuses `recordCookedFood()`'s existing
validation and record shape and the same read -> compare `expectedRevision` -> write path
`index.js`'s REST route already uses, including the exact `409`-equivalent `revision_conflict`
semantics (surfaced as a tool error, never silently retried) and the exact REST validation error
text for a malformed `name`/`servings`/`storage`/`cookedDate`. Its input schema is a strict
allow-list of exactly `name`, `servings`, `storage`, `cookedDate`, `recipeId` (optional), `source`
(optional enum), and `expectedRevision` — no UID, Firestore path, collection name, or existing record id of any kind is
accepted, so the tool cannot be used to reach `consume`, `finish`, or any inventory mutation.
`consume` and `finish` were considered and rejected for this pilot (see `TASKS.md` TASK-069):
both operate on an *existing* record and are strictly more destructive than a pure append.

`PRODUCTION_WRITE_COUNT` remains 0 through this candidate's entire lifecycle, including review.
Nothing here is deployed; see "Production enablement checklist" below.

## Public exposure (workers.dev)

`wrangler.jsonc` sets `workers_dev: true` and `preview_urls: false`, both explicitly rather than
relying on Wrangler defaults. Once deployed, the production workers.dev hostname is the ONLY public
hostname: `https://meal-prep-conversational-bridge.shinyamadasan.workers.dev` (the account's
existing workers.dev subdomain; the sibling `meal-prep-recipe-import` Worker lives on the same
subdomain). Version/Preview URLs (`<version>-<name>.shinyamadasan.workers.dev`) are explicitly
disabled. There is no custom domain, no route, and no DNS change. Being publicly reachable means
each surface must enforce its own gate: `/v1/*` rejects anything except the exact
`BRIDGE_API_TOKEN`; `/mcp` rejects anything except a provider-issued OAuth token bound to the owner,
resource, expiry, and the scope the called tool requires (`mealprep:read` or `mealprep:write`);
`/authorize` additionally requires the signed owner-only
Access assertion. `/mcp/` and `/mcp-evil` do not enter the protected MCP handler. The well-known
metadata and token endpoint must remain public so ChatGPT can discover and complete account
linking. This describes the current live TASK-068 configuration: reads only in production;
the TASK-069 write pilot below remains a local candidate, not deployed.

## Required secrets

Set with `wrangler secret put <NAME>` before any real deploy — never committed, never in
`wrangler.jsonc`'s `vars`:

| Secret | Purpose |
|---|---|
| `BRIDGE_API_TOKEN` | Static bearer token existing REST clients present; never used for MCP. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full service-account JSON (`client_email`, `private_key`, ...). |
| `FIRESTORE_PROJECT_ID` | The Firebase project id (same project the app already uses). |
| `TARGET_UID` | The single Firebase Auth uid this Worker is scoped to. |
| `ACCESS_TEAM_DOMAIN` | Exact HTTPS Access issuer origin, such as `https://<team>.cloudflareaccess.com`. |
| `ACCESS_POLICY_AUD` | Audience tag of the path-specific `/authorize` Access application. |
| `MCP_AUTHORIZED_OWNER_SUBJECT` | Exact stable Access `sub` for the one authorized owner. |

One non-secret setting lives in `wrangler.jsonc` `vars`: `HOUSEHOLD_TIME_ZONE` (`"Asia/Manila"`),
the IANA zone of the household calendar day used for food-safety verdicts (TASK-092). Missing or
invalid fails reads closed.

The OAuth provider also requires a KV namespace binding named `OAUTH_KV`. A KV binding is not a
secret; its namespace id is committed in `wrangler.jsonc` (TASK-068's independently reviewed,
separately authorized provisioning step) and the namespace is live in production.

## Local tests

From the repository root:

```powershell
node --test workers/conversational-bridge/test/mcp-auth.node.js workers/conversational-bridge/test/oauth-provider-integration.node.js workers/conversational-bridge/test/mcp.node.js
npm run test:bridge
```

Or directly:

```powershell
cd workers/conversational-bridge
npm test
```

Every test runs against in-memory fake Firestore/KV bindings and throwaway RSA test keys — no real
credential, production data, or production Firestore call. The provider integration suite loads
the installed `@cloudflare/workers-oauth-provider` implementation and exercises its real request
path for production-origin discovery/challenges, CIMD negotiation, redirect validation, exact
scope/resource policy, authorization-code + PKCE exchange, code replay, opaque bearer validation,
and complete `revokeGrant()` behavior, now including the TASK-069 write-scoped token round trip
against the real provider. The remaining TASK-068 coverage includes signed Access assertion edge
cases, owner/scope checks, per-tool metadata, canonical read results/revisions/stable ids,
zero-mutation assertions, REST/OAuth credential crossing, and exact/near-path routing.
`test/mcp-write.node.js` adds the focused TASK-069 coverage: the read/write/combined scope matrix
for `record_ready_food`, the full revision/conflict contract against the real in-memory fake
Firestore (success, stale revision, missing/malformed `expectedRevision`, a same-revision
race/retry producing exactly one record), the existing-field validation error shapes, and the
over-posting/adversarial cases. The existing bridge codec, domain, chaos/security, and
app<->bridge consistency suites still run unchanged.

Worker deployment dry run (does not require secrets to be set, since `--dry-run` doesn't execute):

```powershell
npx wrangler deploy --dry-run --config workers/conversational-bridge/wrangler.jsonc
```

## REST endpoint contract

Every `/v1/*` REST request requires `Authorization: Bearer <BRIDGE_API_TOKEN>`. Missing/wrong ->
`401`. The exact `/mcp` endpoint uses OAuth instead and never accepts the REST bearer.

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/inventory` | Returns `{ ok, revision, items }`. |
| GET | `/v1/ready-food` | Returns `{ ok, revision, items }`. |
| POST | `/v1/inventory/set-quantity` | `{ ingredientId, quantity, unit?, expectedRevision }` |
| POST | `/v1/inventory/mark-out-of-stock` | `{ ingredientId, expectedRevision }` |
| POST | `/v1/inventory/mark-in-stock` | `{ ingredientId, expectedRevision }` (staples only) |
| POST | `/v1/ready-food/record` | `{ name, recipeId?, servings, storage, cookedDate, expectedRevision }` |
| POST | `/v1/ready-food/consume` | `{ cookedMealId, servings, expectedRevision }` |
| POST | `/v1/ready-food/finish` | `{ cookedMealId, expectedRevision }` |

`expectedRevision` is required on every write, no exceptions. A mismatch (or a Firestore
`currentDocument.updateTime` race) returns `409 revision_conflict` with the current state
attached, and applies nothing. Full machine-readable contract: `openapi.yaml`.

An unlisted/extra field in any request body (an attempt to smuggle a `uid`, `path`, or
`collection`) is rejected as `422 validation_failed` — the schema is an allow-list, not a
best-effort shape check.

`cookedDate` on `ready-food/record` is **required** and must be an exact `YYYY-MM-DD` real
calendar date — the user's intended LOCAL date, matching app.js's `todayISO()`. A stateless
Worker has no timezone of its own, so it never derives "today" itself; the calling client (the
one resolving what "today"/"yesterday" meant) supplies it. Malformed shape, an impossible date
(e.g. `2026-02-30`), or a missing value are all `422 validation_failed`.

**Malformed JSON vs. invalid content.** A body that isn't even syntactically valid JSON (or is
empty) is `400`. A syntactically valid JSON body that fails a domain/schema rule (wrong type,
missing/extra field, out-of-range value) is `422 validation_failed`. The two are never conflated.

**The reserved `ambiguous` code** is no longer produced for staple classification (TASK-097): the
bridge uses the app's own `isStaple`. On `mark-out-of-stock` / `mark-in-stock`, a pantry record
that rule or the read gate cannot read is refused as `422 validation_failed` with an
`invalid_record:` message instead of being guessed; `set-quantity` is not classified (see above).

## Known, recorded judgment calls (not gaps — see CHANGELOG.md for the full reasoning)

- **Pantry staple classification (TASK-097 staple parity).** The bridge calls the app's own
  `MealPrepFoodSafety.isStaple` from `shared/foodSafety.js`: stored flag -> exact-name
  `INGREDIENT_DB.isStaple` -> category `Pantry` (any case) -> non-staple. Before TASK-097 it had no
  `INGREDIENT_DB` and refused every unflagged, non-`Pantry` record as `ambiguous`, because guessing
  "non-staple" could tombstone a real staple such as `Garlic (Bawang)` (category `Vegetable`). With
  the shared rule the bridge gives the app's exact answer, so that refusal is gone; only a record the
  rule cannot read is refused (`invalid_record`). Reads report `tracking` (`level` / `quantity` /
  `presence`); see the TASK-097 section above.
- **`cookedDate` is a required, caller-supplied field (corrected after independent review).** An
  earlier draft had the Worker stamp its own UTC "today," which could silently disagree with
  app.js's LOCAL-calendar-date `todayISO()` by a day near midnight. Since nothing is deployed yet
  and no client exists to have a compatibility obligation to, the contract was corrected outright
  instead of preserving the divergence — see "REST endpoint contract" above.
- **`consume`'s exact-remainder path and `finish` write an explicit `cookedMeals` tombstone
  directly**, rather than relying on `removeCookedMeal()`'s client-side behavior (which is
  actually just an array filter — the tombstone is written later by `recordLocalDeletions()`'s
  baseline diff, a mechanism that only exists across sequential client saves). The bridge has no
  such baseline, so it writes the tombstone itself at removal time, preserving D-071's real
  invariant (a removed record can't be resurrected by a stale synced copy).
- **`ready-food/record` never deducts pantry ingredients** the way `_doMarkCooked()` does
  client-side — D-082 forbids a single write from touching both `pantry` and `cookedMeals`.
  Recording cooked food through the bridge intentionally does not shrink pantry stock.
- **`record_ready_food`'s business-field input schema is deliberately untyped (`z.unknown()`),
  not `z.string()`/`z.number()` (TASK-069).** The object shape itself — exactly `name`,
  `servings`, `storage`, `cookedDate`, `recipeId`, `expectedRevision`, no more — is still a strict
  allow-list. But typing the *values* would make the MCP SDK reject a malformed one with a generic
  schema error before `recordCookedFood()` ever runs, producing a different error message than the
  REST route gives for the exact same mistake. Leaving them untyped lets every malformed value
  reach `recordCookedFood()`'s own validation, so MCP and REST fail identically. `expectedRevision`
  is checked the same way, by a small helper mirroring `index.js`'s own shape check, so both
  surfaces reject it with the same message before any Firestore read.

## Not in v1 (by design — see D-082)

No `create_inventory_item` (no authoritative id-minting authority exists outside the app's own
UI). No Plan/Shop/Prep tools. No recipe generation. There is no natural-language parsing inside
the Worker. TASK-076 added `consume_stock`; TASK-077 adds `add_stock`. Finish, create-item,
shopping, and generic inventory-mutation tools remain absent. No generic
"execute"/"patch"/"update document" tool exists or is planned; no caller-selected Firestore field
or path is accepted under any name.

## Operations: rotation, revocation, emergency stop

Names below are non-secret identifiers. GCP project `meal-prep-f8907`; service account
`meal-prep-bridge@meal-prep-f8907.iam.gserviceaccount.com`; custom role
`projects/meal-prep-f8907/roles/mealPrepBridgeFirestore` (exactly `datastore.entities.get` and
`datastore.entities.update`). Never paste a secret value into chat, docs or a command line: feed
it to `wrangler secret put` through stdin. `wrangler secret delete` and per-Worker Editor's
ability to run it were not exercised in checkpoint A (only `secret put` was).

- **Rotate `BRIDGE_API_TOKEN`:** generate a new random value from the OS CSPRNG, then
  `wrangler secret put BRIDGE_API_TOKEN --config workers/conversational-bridge/wrangler.jsonc`
  with the value on stdin. The old value stops working as soon as the new version is live. Update
  the caller's copy last.
- **Replace the service-account key:** create a new key, store it with
  `wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON` (stdin), confirm a GET works, THEN delete
  the old key: `gcloud iam service-accounts keys delete <KEY_ID> --iam-account=<service account>`.
  Delete any temporary key file the moment the secret is stored.
- **Remove a Worker secret:** `wrangler secret delete <NAME> --config ...` (untested here). A
  Worker missing `BRIDGE_API_TOKEN` rejects every `/v1/*` REST request with `401`; missing
  Firestore secrets produce a sanitized `infrastructure_error`, never data. Missing MCP owner
  configuration makes authorization and protected tool calls fail closed.
- **Disable or delete the Worker:** turning off its workers.dev route or deleting it needs a
  credential above per-Worker Editor (Editor cannot delete): use the Cloudflare dashboard as the
  account owner.
- **Revoke Firestore access:** `gcloud projects remove-iam-policy-binding meal-prep-f8907
  --member=serviceAccount:<service account> --role=projects/meal-prep-f8907/roles/mealPrepBridgeFirestore`,
  then, if retiring the bridge, delete the service account and the custom role.
- **Emergency stop (suspicious traffic), fastest first:** (1) delete the user-managed
  service-account key (the Worker can no longer reach Firestore at all); (2) rotate
  `BRIDGE_API_TOKEN` (the caller can no longer get past the door); (3) remove the IAM binding;
  (4) disable or delete the Worker in the dashboard; (5) review what the Worker's requests did.
  Step 1 needs GCP access (`gcloud`); step 2 needs only the per-Worker Editor token; step 4 needs
  the Cloudflare dashboard.
- **Revoke MCP access after TASK-068 is provisioned:** from a separately authorized, non-public
  operator path using the same `OAUTH_KV` binding, call the provider's
  `listUserGrants(configuredOwnerSubject)` (following pagination) and then
  `revokeGrant(grant.id, configuredOwnerSubject)` for every returned grant, using the same exact
  owner-subject value used when the grant was created. Do not manually delete a
  `grant:*` key: provider 1.2.1's supported operation first enumerates and deletes every associated
  `token:<user>:<grant>:*` access-token record, then deletes the grant record that contains the
  refresh-token identifiers/wrapped key. Local provider-path coverage proves the old access token
  then returns `invalid_token`, the old refresh token returns `invalid_grant`, and grant/token state
  is gone. No public admin/revocation endpoint exists or should be added for this operation. After
  provider revocation, remove or deny the Access policy and disconnect the ChatGPT app; deleting
  the dedicated namespace is an all-grants retirement option. Removing the owner subject secret
  makes authorization and protected tool calls fail closed. Do not treat 15-minute access-token
  expiry alone as incident response.

Accepted limits, stated plainly: the IAM role is not document-scoped, so a stolen service-account
key can get and update any existing Firestore document in this project, not only
`users/{TARGET_UID}`; the fixed `TARGET_UID` in the Worker is the application-level boundary.

## Production enablement checklist

Checkpoint A (REST, read-only) and TASK-068 (OAuth MCP reads) are both complete and live:

- [x] Worker deployed to the production workers.dev endpoint.
- [x] Production workers.dev endpoint is live; Version/Preview URLs are disabled.
- [x] All four REST Worker secrets are installed: `BRIDGE_API_TOKEN`,
  `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIRESTORE_PROJECT_ID`, and `TARGET_UID`.
- [x] A dedicated GCP service account and custom Firestore role were provisioned. The role contains
  only `datastore.entities.get` and `datastore.entities.update`; it is not Owner or Editor.
- [x] Authenticated read-only smoke completed against the real account's inventory and ready food
  (both REST and, after TASK-068, MCP).
- [x] Zero bridge production writes were performed.
- [x] TASK-067 live feasibility passed and MCP was selected as the preferred adapter.
- [x] TASK-068 is deployed; the Access application, `OAUTH_KV` namespace/binding, and the owner's
  real ChatGPT OAuth link all exist in production (see `STATUS.md` 2026-10-01 entries).
- [x] The owner connected the real ChatGPT account and confirmed `get_inventory` and
  `get_ready_food` both succeeded against production.
- [ ] Checkpoint B / any MCP write capability in production remains unapproved. The first
  controlled write, write-permission proof, and any write-scoped ChatGPT grant require a separate
  explicit owner decision.
- [ ] TASK-069 (Phase B2A) has not been deployed; `record_ready_food` and the `mealprep:write`
  scope exist in source only. `PRODUCTION_WRITE_COUNT` remains 0.
- [ ] The first real production write requires an independent STRICT review PASS of TASK-069
  followed by a separate owner decision — implementation review alone authorizes neither
  deployment nor a production write.

Firestore IAM has no per-document restriction: the service-account credential can reach every
document its role permits in the database. The fixed `TARGET_UID` is an application-level boundary,
not an IAM boundary. `TASKS.md` TASK-066 contains the detailed checkpoint A evidence.

## TASK-068 provisioning plan (completed; kept verbatim as the audit trail)

**Status: executed.** This was written as a forward plan before TASK-068 deployed; every step
below was independently reviewed and then actually carried out — see `STATUS.md` 2026-10-01
entries for the live, independently-verified evidence. Left unedited below so the plan and its
reasoning remain readable as history, not rewritten into a past-tense summary.

1. **Source fact — provider storage:** `@cloudflare/workers-oauth-provider` requires a Cloudflare KV
   namespace bound as `OAUTH_KV`. **Project decision:** create one namespace dedicated to this
   Worker's OAuth clients, grants, authorization codes, and opaque tokens; then add its id to
   `wrangler.jsonc`. Do not reuse an application-data namespace.
2. **Source fact — owner authentication:** a path-specific Access application can protect a
   `workers.dev` path and emits a signed application JWT. **Project decision:** create a
   self-hosted Access application for exactly
   `meal-prep-conversational-bridge.shinyamadasan.workers.dev/authorize`, with an owner-only Allow
   policy. Do not protect the whole Worker: ChatGPT must reach discovery, `/oauth/token`, and
   `/mcp`. Do not enable Access Managed OAuth for this application.
3. **Project decision — owner configuration:** after the owner signs into that Access application,
   validate its application token and obtain the stable `sub` without logging or committing the
   full token. Store the Access issuer origin, application AUD tag, and exact owner subject as
   Worker secrets `ACCESS_TEAM_DOMAIN`, `ACCESS_POLICY_AUD`, and
   `MCP_AUTHORIZED_OWNER_SUBJECT`. No email or display name is an authorization key.
4. **Source fact — OAuth endpoints/client:** deployment publishes the RFC 9728 document at
   `/.well-known/oauth-protected-resource/mcp`, RFC 8414 metadata at
   `/.well-known/oauth-authorization-server`, authorization at `/authorize`, and token/revocation
   at `/oauth/token`. CIMD needs the committed `global_fetch_strictly_public` compatibility flag.
   **Project decision:** use CIMD and public-client `none`; create no DCR endpoint, predefined
   client id, client secret, or separate OAuth application.
5. **Source fact — ChatGPT redirect:** an issuer-identifying server uses the stable current redirect
   `https://chatgpt.com/connector_platform_oauth_redirect` and stable CIMD client
   `https://chatgpt.com/oauth/client.json`; ChatGPT's management page is authoritative for the
   connection. **Project decision:** verify and record the exact values shown there before linking.
6. Deploy only the independently reviewed commit. Confirm both discovery documents advertise the
   exact production issuer/resource, only `mealprep:read`, PKCE `S256`, CIMD support, and a
   token-endpoint method intersecting ChatGPT's CIMD (`none`). Confirm an unauthenticated `/mcp`
   response has `WWW-Authenticate` with the production `resource_metadata` URL.
7. Connect the owner's ChatGPT account and perform only `get_inventory` and `get_ready_food`.
   Record the Firestore revision before and after and require it to remain unchanged. Do not expose
   or request a write scope/tool. The first production write remains a separate owner decision
   after this read-only live verification succeeds.
