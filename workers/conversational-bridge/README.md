# Conversational Control Bridge Worker

Single-account Cloudflare Worker that lets an authenticated external caller (eventually ChatGPT)
read and write the SAME canonical `pantry` (raw inventory) and `cookedMeals` (ready-to-eat food)
state the app itself uses — never a competing model, never raw Firestore CRUD. Full design
rationale: `docs/DECISIONS.md` D-082. Operation contract: `TASKS.md` TASK-065.

**Status: local candidate only. Not deployed. No production secrets exist yet.** See
"Production enablement checklist" below for exactly what must happen before this is real.

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

## Public exposure (workers.dev)

`wrangler.jsonc` sets `workers_dev: true`, so once deployed the Worker is reachable on the public
internet at `https://meal-prep-conversational-bridge.shinyamadasan.workers.dev` (the account's
existing workers.dev subdomain; the sibling `meal-prep-recipe-import` Worker lives on the same
subdomain). There is no custom domain, no route, and no DNS change. Being publicly reachable means
the bearer token is the ONLY gate on the URL: every request is rejected with `401` before any
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
UI). No Plan/Shop/Prep writes. No recipe generation. No MCP. No natural-language parsing inside
the Worker — it accepts resolved, typed operations only.

## Production enablement checklist

This candidate is built and locally tested. None of the following has happened, and none of it
happens automatically:

1. A human reviews this branch (see `REVIEW.md` once filed) and approves it per the AI Dev OS
   risk-gated merge process (D-032) — this is Hard-Rule-10 High-risk work, so it lands as
   `approved`, held for manual merge, never auto-merged.
2. A real Firebase service-account key is minted with the smallest practical Firestore IAM role
   (never Owner/Editor) and stored ONLY via `wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON` —
   never in this repo, never pasted into a chat, never in a Worker `vars` block. **Be precise about
   what this does and doesn't scope:** Firestore IAM has no per-document restriction, so the
   service-account credential itself can reach every document the granted role allows across the
   whole database — the fixed `TARGET_UID` in this Worker's code is an APPLICATION-level
   restriction, not an IAM one. Compromise of the service-account credential is therefore a
   materially bigger blast radius than compromise of the bearer token alone (which only reaches
   this Worker's fixed operations on one account); rotate and audit it accordingly.
3. A real `BRIDGE_API_TOKEN` is generated (a long random value, not a password) and stored via
   `wrangler secret put BRIDGE_API_TOKEN` — the SAME value is later given to ChatGPT's connector
   config, nowhere else.
4. `TARGET_UID` and `FIRESTORE_PROJECT_ID` secrets are set to the real account's values.
5. `npx wrangler deploy --config workers/conversational-bridge/wrangler.jsonc` is run deliberately
   by a human, not by any agent.
6. The deployed Worker is smoke-tested directly (curl/Postman) against the REAL account's data
   before anything else touches it — read-only operations first.
7. Only after step 6 passes is a ChatGPT connector/Action configured, pointed at the deployed
   Worker URL, using the OpenAPI contract in `openapi.yaml` and the bearer token from step 3.

Until all seven steps happen, "ChatGPT can update Meal Prep" is not true yet — this PR makes it
buildable, not live.
