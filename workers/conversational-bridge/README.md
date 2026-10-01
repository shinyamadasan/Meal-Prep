# Conversational Control Bridge Worker

Single-account Cloudflare Worker that lets an authenticated external caller (eventually ChatGPT)
read and write the SAME canonical `pantry` (raw inventory) and `cookedMeals` (ready-to-eat food)
state the app itself uses — never a competing model, never raw Firestore CRUD. Full design
rationale: `docs/DECISIONS.md` D-082. Operation contract: `TASKS.md` TASK-065.

**Production status (TASK-066 checkpoint A, 2026-09-28): deployed and provisioned, READ-ONLY
verified only.**
The Worker exists at the workers.dev URL below with its four secrets installed. Only authenticated
GET requests have been made against production; no bridge write has ever been performed and
ChatGPT is not connected. The write path (`update` permission sufficiency, first controlled write)
and the ChatGPT connection are checkpoint B and need a separate owner decision. The "Production
enablement checklist" below records the current checkpoint status; see `TASKS.md` TASK-066 for the
detailed evidence.

**Local candidate status (TASK-068): authenticated real-data MCP reads now exist in source only.**
TASK-067's live ChatGPT feasibility check passed, so MCP is the selected conversational adapter.
This candidate has not been deployed, no OAuth/Access/KV resource has been created, and ChatGPT has
not been connected to private tools. Production writes and the `mealprep:write` scope remain
unapproved.

## Architecture

```
REST client                         ChatGPT connector
Authorization: BRIDGE_API_TOKEN     OAuth 2.1 + PKCE S256, mealprep:read
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
   expiry, `mealprep:read`, and configured owner subject by `src/mcpAuth.js`.
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

## TASK-068 authenticated MCP read candidate (local only)

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
- Authorization requests must contain a scope set equal to exactly `{ mealprep:read }` before a
  consent transaction is created and again before a grant is written. OAuth's ASCII-space
  delimiters are normalized and exact duplicate `mealprep:read` tokens are deduplicated; missing, empty, unknown,
  write, or mixed scope sets are rejected rather than replaced with read access. The consent page
  displays the exact `mealprep:read` scope. `mealprep:write` is neither configured nor accepted as
  a substitute.
- Client registration is CIMD only; DCR is not enabled. The provider accepts the public-client
  `none` token-endpoint method with PKCE. Because the provider advertises RFC 9207 issuer
  identification, the expected current ChatGPT values are client id
  `https://chatgpt.com/oauth/client.json` and redirect URI
  `https://chatgpt.com/connector_platform_oauth_redirect`. At provisioning time, copy the exact
  client document and redirect URI shown in ChatGPT's management page; do not assume a stale value.
- The provider issues short-lived (15-minute) opaque access tokens and fixed-lifetime 14-day
  refresh grants. It validates token existence, expiry, and exact audience from KV before invoking
  MCP. The MCP handler then rechecks expiry, exact resource, exact one-scope set, issuer/resource
  properties fixed at authorization, and both copies of the configured owner subject.
- The canonical `resource` is required explicitly on both authorization-code authorization and
  token/refresh requests; missing, alternate-host, and other-resource values fail closed.
- Owner sign-in is independently gated by a path-specific Access policy and by Worker validation
  of `Cf-Access-Jwt-Assertion`. Authorization uses only the exact configured stable Access `sub`;
  email, display fields, field order, and caller form values cannot select the owner.
- REST `/v1/*` remains on `BRIDGE_API_TOKEN`. OAuth bearer tokens do not authorize REST, and the
  REST bearer does not authorize MCP.

## Public exposure (workers.dev)

`wrangler.jsonc` sets `workers_dev: true` and `preview_urls: false`, both explicitly rather than
relying on Wrangler defaults. Once deployed, the production workers.dev hostname is the ONLY public
hostname: `https://meal-prep-conversational-bridge.shinyamadasan.workers.dev` (the account's
existing workers.dev subdomain; the sibling `meal-prep-recipe-import` Worker lives on the same
subdomain). Version/Preview URLs (`<version>-<name>.shinyamadasan.workers.dev`) are explicitly
disabled. There is no custom domain, no route, and no DNS change. Being publicly reachable means
each surface must enforce its own gate: `/v1/*` rejects anything except the exact
`BRIDGE_API_TOKEN`; `/mcp` rejects anything except a provider-issued OAuth token bound to the owner,
resource, expiry, and `mealprep:read`; `/authorize` additionally requires the signed owner-only
Access assertion. `/mcp/` and `/mcp-evil` do not enter the protected MCP handler. The well-known
metadata and token endpoint must remain public so ChatGPT can discover and complete account
linking. This describes the reviewed candidate configuration, not a deployed TASK-068 state.

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
secret, but its namespace id must not be added until the separately authorized provisioning step.
TASK-068 deliberately leaves it out of `wrangler.jsonc`; no live namespace exists yet.

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
and complete `revokeGrant()` behavior. The remaining TASK-068 coverage includes signed Access
assertion edge cases, owner/scope checks, per-tool metadata, canonical read results/revisions/stable
ids, zero-mutation assertions, REST/OAuth credential crossing, and exact/near-path routing. The
existing bridge codec, domain, chaos/security, and app<->bridge consistency suites still run
unchanged.

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

## Not in v1 (by design — see D-082)

No `create_inventory_item` (no authoritative id-minting authority exists outside the app's own
UI). No Plan/Shop/Prep tools. No recipe generation. No MCP write tool and no `mealprep:write`
scope. The two TASK-068 MCP tools are read-only adapters over existing deterministic operations;
there is no natural-language parsing inside the Worker.

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

Checkpoint A is complete and read-only production access is live:

- [x] Worker deployed to the production workers.dev endpoint.
- [x] Production workers.dev endpoint is live; Version/Preview URLs are disabled.
- [x] All four Worker secrets are installed: `BRIDGE_API_TOKEN`,
  `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIRESTORE_PROJECT_ID`, and `TARGET_UID`.
- [x] A dedicated GCP service account and custom Firestore role were provisioned. The role contains
  only `datastore.entities.get` and `datastore.entities.update`; it is not Owner or Editor.
- [x] Authenticated read-only smoke completed against the real account's inventory and ready food.
- [x] Zero bridge production writes were performed.
- [x] TASK-067 live feasibility passed and MCP was selected as the preferred adapter.
- [ ] TASK-068 has not been deployed; ChatGPT is not configured for private tools.
- [ ] No live Access application, OAuth KV namespace/binding, or private OAuth grant exists yet.
- [ ] Checkpoint B remains unapproved. The first controlled write, write-permission proof, and
  ChatGPT connection require a separate explicit owner decision.

Firestore IAM has no per-document restriction: the service-account credential can reach every
document its role permits in the database. The fixed `TARGET_UID` is an application-level boundary,
not an IAM boundary. `TASKS.md` TASK-066 contains the detailed checkpoint A evidence.

## Future TASK-068 provisioning plan (create nothing before independent review PASS)

The following is an exact plan, not evidence that any resource exists.

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
