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

The tool is a thin adapter, not a second implementation: it reuses `recordCookedFood()`'s existing
validation and record shape and the same read -> compare `expectedRevision` -> write path
`index.js`'s REST route already uses, including the exact `409`-equivalent `revision_conflict`
semantics (surfaced as a tool error, never silently retried) and the exact REST validation error
text for a malformed `name`/`servings`/`storage`/`cookedDate`. Its input schema is a strict
allow-list of exactly `name`, `servings`, `storage`, `cookedDate`, `recipeId` (optional), and
`expectedRevision` — no UID, Firestore path, collection name, or existing record id of any kind is
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

**The reserved `ambiguous` code** is used by `mark-out-of-stock` when a pantry record has no
explicit `staple` flag and a category that doesn't resolve it either — see the classification
note below. It means "refused because the bridge cannot safely tell," not "malformed request."

## Known, recorded judgment calls (not gaps — see CHANGELOG.md for the full reasoning)

- **Pantry staple classification (corrected after independent review).** The bridge reproduces
  app.js's `isStaple()` as far as it can without `INGREDIENT_DB`: explicit `staple === true` /
  `staple === false` first, then the category-only fallback (`staple !== false && category ===
  'pantry'`). What it CANNOT reproduce is the middle step — an `INGREDIENT_DB` lookup by name that
  can mark a record staple regardless of category (real seed-data examples: `Garlic (Bawang)` and
  `Evaporated Milk` are `isStaple: true` with category `Vegetable`/`Dairy`, not `Pantry`; and at
  least two active pantry-creation call sites in `app.js` store `staple: undefined` outright for
  an unmatched custom ingredient — this is a live, common case, not rare legacy data). A record
  with no explicit flag and a non-`'pantry'` category is genuinely unprovable server-side, so
  `mark-out-of-stock` refuses it with `422 ambiguous` rather than guessing — guessing "non-staple"
  risks tombstoning a record the real app would only have marked empty, which is real data loss;
  refusing costs the caller a retry after the app-side record gets an explicit flag. Reads
  (`GET /v1/inventory`) still report a best-effort `staple`/`inStock` for display, treating the
  ambiguous case as non-staple, since a read can't destroy anything.
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

## Not in v1 (by design — see D-082) / not in Phase B2A (by design — see TASKS.md TASK-069)

No `create_inventory_item` (no authoritative id-minting authority exists outside the app's own
UI). No Plan/Shop/Prep tools. No recipe generation. There is no natural-language parsing inside
the Worker. Beyond the single TASK-069 `record_ready_food` pilot, no `consume`, `finish`, or
inventory write is exposed as an MCP tool, and no second write tool exists — one write tool only,
for this phase. No generic "execute"/"patch"/"update document" tool exists or is planned; no
caller-selected Firestore field or path is accepted under any name.

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
