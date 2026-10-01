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

**Local candidate status (TASK-067): an MCP feasibility endpoint now exists in source only.** It
has not been deployed and ChatGPT has not been configured. The deployed checkpoint-A Worker does
not include this candidate until a separate review and deployment approval occur.

## Architecture

```
External client (ChatGPT connector)
        |  Authorization: Bearer <BRIDGE_API_TOKEN>
        v
   src/index.js        — HTTP routing, auth, request validation (allow-listed fields only)
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

`src/auth.js` owns two unrelated auth hops — never conflate them:
1. Caller -> Worker: a static bearer token (`BRIDGE_API_TOKEN`), compared in constant time.
2. Worker -> Firestore: the service account's own JWT-bearer OAuth2 exchange, signed with Web
   Crypto (no `firebase-admin` — it isn't Workers-compatible) and cached in module scope for the
   life of the isolate.

The Worker is hardcoded to exactly one Firestore document (`TARGET_UID`, a secret). No route
accepts a caller-supplied uid, collection name, or document path.

## TASK-067 MCP feasibility spike (local only)

`/mcp` is a thin, stateless protocol surface in the existing Worker, implemented with the official
`@modelcontextprotocol/server` v2 Web-standard Streamable HTTP handler and `zod` schemas. It does
not add another server, process, Durable Object, storage binding, or framework. The handler creates
a fresh MCP server per request and keeps legacy stateless initialize compatibility for clients that
still use that handshake.

The endpoint exposes exactly two tools:

| Tool | Classification | Behavior |
|---|---|---|
| `probe_read` | `readOnlyHint: true`, non-destructive, closed-world | Returns static `{ "ok": true, "probe": "read" }`. |
| `probe_write` | `readOnlyHint: false`, non-destructive, idempotent, closed-world | Returns static `{ "ok": true, "probe": "write-classified-noop" }`. |

Both schemas accept no inputs. Both implementations are pure no-ops: `src/mcp.js` imports no bridge
domain or Firestore module, receives no Worker environment, reads no secret, calls no network, and
creates no durable state. `/mcp` is therefore intentionally unauthenticated for this bounded probe.
That exception does not extend to product data or actions. Every existing `/v1/*` route still takes
the unchanged REST path through `BRIDGE_API_TOKEN` validation before token exchange, Firestore, or
domain work. No real inventory, ready-food, planning, shopping, prep, recipe, or natural-language
MCP tool exists in this spike.

This is an MCP **feasibility spike**, not Phase B implementation. The later live decision remains:

- **PASS:** after independent review and separate deployment authorization, the owner's real
  ChatGPT Create MCP App surface connects to the reviewed endpoint and invokes both `probe_read`
  and `probe_write`. MCP then becomes the preferred thin ChatGPT adapter in front of the existing
  deterministic bridge/domain layer.
- **FAIL:** the write-classified tool cannot be invoked, or the required connection/auth model adds
  disproportionate complexity. Stop MCP work and use the existing deterministic REST bridge.

No PASS or FAIL result is claimed here; TASK-067 performs local implementation and verification
only. Deployment and ChatGPT configuration remain separately gated.

## Public exposure (workers.dev)

`wrangler.jsonc` sets `workers_dev: true` and `preview_urls: false`, both explicitly rather than
relying on Wrangler defaults. Once deployed, the production workers.dev hostname is the ONLY public
hostname: `https://meal-prep-conversational-bridge.shinyamadasan.workers.dev` (the account's
existing workers.dev subdomain; the sibling `meal-prep-recipe-import` Worker lives on the same
subdomain). Version/Preview URLs (`<version>-<name>.shinyamadasan.workers.dev`) are explicitly
disabled. There is no custom domain, no route, and no DNS change. Being publicly reachable means
the bearer token is the ONLY gate on the URL, and bearer authentication stays mandatory on it: every request is rejected with `401` before any
routing, body parsing, or Firestore access unless it carries the exact `BRIDGE_API_TOKEN`. An
deployed Worker with no `BRIDGE_API_TOKEN` configured also fails closed (covered by a test). (Before this setting was
approved the config had `workers_dev: false`, which would have produced no URL at all.)

## Required secrets

Set with `wrangler secret put <NAME>` before any real deploy — never committed, never in
`wrangler.jsonc`'s `vars`:

| Secret | Purpose |
|---|---|
| `BRIDGE_API_TOKEN` | Static bearer token the caller (ChatGPT) presents. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full service-account JSON (`client_email`, `private_key`, ...). |
| `FIRESTORE_PROJECT_ID` | The Firebase project id (same project the app already uses). |
| `TARGET_UID` | The single Firebase Auth uid this Worker is scoped to. |

## Local tests

From the repository root:

```powershell
node --test workers/conversational-bridge/test/mcp.node.js
npm run test:bridge
```

Or directly:

```powershell
cd workers/conversational-bridge
npm test
```

Every test runs against an in-memory fake Firestore (`test/support/fakeFirestore.js`) and a
throwaway RSA test keypair (`test/support/fixtures.js`) — no network call, no real credential, no
production data, ever. Coverage: typed-value codec round-trips, the auth boundary (bearer +
service-account JWT signing), every domain operation's validation/idempotency rules, the full
chaos/security matrix from TASK-065, and an app<->bridge consistency suite proving there is one
shared canonical store.

Worker deployment dry run (does not require secrets to be set, since `--dry-run` doesn't execute):

```powershell
npx wrangler deploy --dry-run --config workers/conversational-bridge/wrangler.jsonc
```

## Endpoint contract

Every request requires `Authorization: Bearer <BRIDGE_API_TOKEN>`. Missing/wrong -> `401`.

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
  instead of preserving the divergence — see "Endpoint contract" above.
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
UI). No Plan/Shop/Prep writes. No recipe generation. No real meal-prep MCP tools. TASK-067 adds
only the two static, no-op feasibility probes documented above; it does not expose these domain
operations over MCP. No natural-language parsing inside the Worker — its REST surface accepts
resolved, typed operations only.

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
  Worker missing `BRIDGE_API_TOKEN` rejects every request with `401`; missing Firestore secrets
  produce a sanitized `infrastructure_error`, never data.
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
- [ ] ChatGPT is not configured or connected.
- [ ] Checkpoint B remains unapproved. The first controlled write, write-permission proof, and
  ChatGPT connection require a separate explicit owner decision.

Firestore IAM has no per-document restriction: the service-account credential can reach every
document its role permits in the database. The fixed `TARGET_UID` is an application-level boundary,
not an IAM boundary. `TASKS.md` TASK-066 contains the detailed checkpoint A evidence.
