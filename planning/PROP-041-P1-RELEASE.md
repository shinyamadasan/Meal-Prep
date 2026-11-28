# PROP-041 Phase 1 — controlled release checklist

Status: **PREPARED 2026-11-27 — awaiting owner approval. Nothing merged, nothing deployed.**
Candidate: branch `prop041-p1` (TASK-091..095, all `approved` (held)). Owner accepted the reported
independent review and QA on 2026-11-27. Production inventory is not modified by any step here.

## 1. What ships (two deploys)

| Surface | How it deploys | What changes |
| --- | --- | --- |
| App (GitHub Pages) | Merging `prop041-p1` into `main` | TASK-091 only: the food-safety rules move to `shared/foodSafety.js` (loaded by `<script>`, precached by `sw.js`). No visible behaviour change; parity tests cover it. |
| Bridge Worker | `wrangler versions upload` + `versions deploy` (owner-run or owner-authorised) | TASK-092..095: safety verdicts in `get_inventory` / `get_ready_food`; required `requestId` + `users/{uid}/mcpRequests/{requestId}` record on every write; safe `add_stock`; new `undo_request`; new non-secret var `HOUSEHOLD_TIME_ZONE = "Asia/Manila"`. |

The Worker delta is exactly Phase 1: `main`'s bridge source equals the last recorded live version
(`4e0200cc-7e4d-4559-b9fe-00a2e2ef299f`, TASK-077, 2026-10-08). Confirm the live version is still that
one at step 4.2 before deploying.

## 2. Release-preparation findings (2026-11-27)

### 2.1 REST routes (`/v1/...`, `BRIDGE_API_TOKEN`) — not a blocker; one recommended owner step
- Routes: `GET /v1/inventory`, `GET /v1/ready-food`, `POST /v1/inventory/{set-quantity,
  mark-out-of-stock, mark-in-stock}`, `POST /v1/ready-food/{record, consume, finish}`. No REST route
  exists for `add_stock`, `consume_stock` or `undo_request`.
- What REST bypasses: P1-2 (its reads carry no `safety` verdict), P1-3 (no `requestId`, so a retried
  REST write can apply twice, and no request record), P1-5 (REST changes are not undoable). REST
  writes still use the same domain operations, `expectedRevision` and the Firestore `updateTime`
  precondition, so they cannot overwrite a newer document.
- Active integrations found: **none.** The app, ChronaSense (reads the ledger through the repo
  fixture, never the bridge), every local repo and automation script on this machine, and every
  n8n/automation file were searched: nothing calls `/v1/` or holds the bridge URL besides the docs.
  ChatGPT uses only `/mcp` (OAuth). The REST bearer token exists only as a Worker secret and with
  the owner. Cloudflare request logs could not be checked (no Cloudflare login in this session).
- **Recommendation (owner step 4.3):** retire REST access at deploy by replacing `BRIDGE_API_TOKEN`
  with a new random value that nobody stores (`npx wrangler secret put BRIDGE_API_TOKEN`, paste a
  generated value, do not save it). No code change; reversible by setting a known value again. If the
  owner knows of a REST client, keep the token and accept the three bypasses above (recorded follow-up:
  add `requestId` + safety to REST, or remove REST).

### 2.2 Clock-related undo / sync issue — not a release blocker
- Mechanism: an undo that removes a ready-food batch writes its tombstone with the **Worker** clock.
  The app keeps a record over a tombstone only when `updatedAt > deletedAt` (`applyTombstones`), and
  `updatedAt` comes from the **device** clock. If a device clock runs ahead by more than the time
  between that device stamping the batch and the undo, the device's stale copy can survive its next
  merge and bring the batch back.
- Why it is not a blocker: (1) it needs a device clock skewed by minutes; phones and PCs sync to
  network time, typically to well under a second; (2) the failure direction is a batch **reappearing**,
  never data loss, and never a safety change (the batch keeps its original `cookedDate`, so its
  safety verdict is unchanged); (3) the identical exposure already exists in production for
  `finish_ready_food` and for app-to-app deletes across devices; (4) pantry revivals are not affected:
  undo checks that the tombstone still holds the Worker-written value, and the revived record gets a
  later Worker time.
- Recorded follow-up (Phase 2, low): write the undo tombstone as `max(now, live updatedAt + 1 ms)`.
- Smoke check 6.3 covers it: after an undo, reload the app on each device and confirm the item stays
  gone/back.

### 2.3 Firestore permission — verified minimal
- Service account `meal-prep-bridge@meal-prep-f8907.iam.gserviceaccount.com` holds exactly one role,
  custom `projects/meal-prep-f8907/roles/mealPrepBridgeFirestore` = `datastore.entities.get` +
  `datastore.entities.update`. No other binding names it.
- Phase 1 code (`src/firestore.js`) issues only: GET of the user document and of one request record;
  `documents:commit` with an `updateTime`-guarded update of the user document, a create-only
  (`exists:false`) request record, and (undo only) an `updateTime`-guarded update of one request
  record. No delete, list, query, index or admin call.
- Required addition: **`datastore.entities.create` only** (for the create-only request record).
  Not needed and not to be added: `datastore.entities.delete`, `.list`, `datastore.databases.*`,
  `datastore.indexes.*`, any predefined role.
- Limit of IAM: Firestore IAM cannot scope a permission to a collection; the role applies to the whole
  database. The application-level guard is unchanged: the Worker can address only
  `users/{TARGET_UID}` and `users/{TARGET_UID}/mcpRequests/{requestId}` (fixed paths, ids validated to
  8-128 `[A-Za-z0-9_-]`).

### 2.4 30-day TTL policy — RESOLVED 2026-11-27: no TTL (owner keeps Spark; D-092)
Logical expiry in code (undo refused after `expireAt`; old ids keep replaying, never re-apply);
records are kept, never auto-deleted. The original finding follows for the record.
- Attempted 2026-11-27 with the owner's Firebase CLI login: Firestore refused, "Project meal-prep-f8907
  has billing disabled". TTL policies need a billing-enabled (Blaze) project. Nothing was changed.
- Without TTL, Phase 1 still behaves as specified: undo is refused after 30 days by code
  (`undo_expired`); records stay stored (about 1-3 KB per chat write) until a TTL policy exists.
- Options: (a) enable Blaze with a low budget alert, then Claude enables the policy
  (`collectionGroups/mcpRequests/fields/expireAt`, `ttlConfig`); deletes at this volume stay within the
  free daily quota; (b) deploy now without TTL and add it later — records are not physically removed
  after 30 days until then. Either is safe for release.

### 2.5 Wrangler dry run — PASS
`npx wrangler deploy --dry-run` (Wrangler 4.169.0) on `4b09ecd`: bundle 1692.88 KiB / gzip 310.26 KiB;
bindings `OAUTH_KV` (KV) and `HOUSEHOLD_TIME_ZONE` ("Asia/Manila"); the bundle contains the shared
safety core and `undo_request`. Secrets are not shown by a dry run; they are carried over by
`versions upload`.

### 2.6 Final gates on the release candidate `03bb2c6`
`03bb2c6` = `4b09ecd` + one test file (`test/mcp-logical-expiry.node.js`, D-092) + docs; the Worker
bundle is unchanged from the 2.5 dry run. `test:bridge` 363/363 (re-run 2026-11-27 on `03bb2c6`);
`test:ledger-contract` 13/13; `git diff --check` clean. Full local suite 911/912: the one failure,
`tombstone-namespace.spec.js` "Firestore payload and load round-trip", is calendar-dependent and
fails identically on `main` (a fixed 2026-06-01 fixture tombstone passed the app's 180-day purge
window on 2026-11-28 UTC). It is not caused by Phase 1. Test-only fix: TASK-102 on branch
`task-102-tombstone-fixture-date` (from `main`, separately reviewable); merge it before or with this
release so step 4's gate reads 912/912.

## 3. Owner decisions needed before step 4
1. Approve this checklist (merge + both deploys).
2. ~~TTL~~ — resolved: no TTL on Spark (D-092).
3. REST: retire `BRIDGE_API_TOKEN` (recommended) or keep — 2.1.
4. Cloudflare access for steps 4.2/4.5/4.6: run them yourself, or run `npx wrangler login` on this
   machine so Claude can (no token is ever shared in chat).
5. TASK-102 (test-only, 2.6): approve its merge to `main` so the release gate is green.

### Owner-only actions (the complete list — everything else is done or Claude-runnable)
| # | Action | Why only the owner | Est. |
| --- | --- | --- | --- |
| O1 | Approve this checklist (and TASK-102). | Merge/deploy approval. | 2 min |
| O2 | Before retiring `BRIDGE_API_TOKEN`: Cloudflare dashboard → Workers → `meal-prep-conversational-bridge` → Logs (or `npx wrangler tail` for a day) — confirm no requests to `/v1/` paths. If any appear, keep the token and tell Claude. | No Cloudflare login in this session (2.1). | 5 min |
| O3 | IAM: add `datastore.entities.create` to custom role `mealPrepBridgeFirestore` (Google Cloud console → IAM → Roles) — nothing else. | Permission expansion needs the owner (2.3). | 3 min |
| O4 | Cloudflare: `npx wrangler login` on this machine, or run 4.2 / 4.5 / 4.6 yourself. | Account access. | 2 min |
| O5 | ChatGPT smoke 6.3 + 6.4 in your own ChatGPT session. | Owner's OAuth grant. | 10 min |

## 4. Deployment steps (only after approval)
1. **Backup.** Fresh export of `users/{uid}` (app Settings export, or a read-only Firestore read with
   the owner's CLI login) saved to the private folder; confirm it parses and has the expected pantry
   and cookedMeals counts. Nothing is written.
2. **Record the rollback target.** `npx wrangler deployments list` → note the version at 100%
   (`ROLLBACK_VERSION`, expected `4e0200cc-...`). Stop if it differs and re-check the delta.
3. **Permissions.** Add `datastore.entities.create` to `mealPrepBridgeFirestore` (nothing else);
   re-read the role. If chosen: retire `BRIDGE_API_TOKEN` (2.1). No TTL (D-092).
4. **App.** Open a PR `prop041-p1` → `main`, merge with a merge commit; wait for the Pages build;
   confirm live `app.js`, `index.html`, `sw.js`, `shared/foodSafety.js` are byte-identical to `main`;
   run `npm run test:prod` (signed out, no account writes).
5. **Worker.** From `workers/conversational-bridge` on the merged `main`:
   `npx wrangler versions upload` → `NEW_VERSION`; confirm its bindings match `ROLLBACK_VERSION`
   (same 7 secrets by name, `OAUTH_KV`) plus `HOUSEHOLD_TIME_ZONE`; then
   `npx wrangler versions deploy NEW_VERSION@100`; re-list deployments and confirm 100%.
6. **Smoke** (section 6). Any failure → rollback (section 5).
7. **Close-out.** STATUS entry, TASK-091..095 → `done`, DONE.md, rollback target recorded.

## 5. Rollback
| What | How | Data effect |
| --- | --- | --- |
| Worker | `npx wrangler versions deploy ROLLBACK_VERSION@100` (or `npx wrangler rollback ROLLBACK_VERSION`); re-list to confirm. | None. The old Worker ignores `mcpRequests`; records written by Phase 1 use the same user-document fields the old Worker reads. ChatGPT re-reads the tool list (no `requestId`). |
| App | `git revert --no-edit -m 1 <merge sha>` on `main`, push; Pages redeploys in about 1 minute; reload clients once (service worker). Use `-X ours` only if later doc commits conflict. | None. TASK-091 is a code move with no stored-data change. |
| Permission | Remove `datastore.entities.create` from the role. | None. (With the new Worker still live, every chat write then fails closed — roll the Worker back first.) |
| TTL / token | Disable the TTL policy; set `BRIDGE_API_TOKEN` to a known value again. | None. |
| Data | Only if data itself is wrong, and only on owner decision: restore from the step 4.1 export. Prefer `undo_request` for individual chat changes. | Owner-approved restore only. Never automatic. |

Rollback triggers: any smoke failure in section 6; any chat write that changes something it should
not; `get_inventory` failing or calling an expired item usable; an app tab failing to render.

## 6. Production smoke (no inventory change)
Run in order; stop and roll back on the first failure.

**6.1 Non-mutating HTTP (Claude can run, no credentials):** tokenless `/mcp` → 401 with the
`WWW-Authenticate` challenge; `/mcp/` and `/mcp-evil` → 401; unauthenticated `/v1/inventory` → 401;
`/authorize` without Access → 302 into Access; OAuth metadata scopes unchanged
(`mealprep:read`, `mealprep:write`).

**6.2 App (Claude):** `npm run test:prod` passes; the live site loads `shared/foodSafety.js`; the
signed-in owner opens Kitchen once and sees the same Expired / Check counts as before the deploy.

**6.3 ChatGPT, read-only (owner):**
1. "Show my inventory with safety." Every item has `safety` (`status`, `label`, `usable`); expired
   items say not usable; counts match the app's Kitchen view for today (Asia/Manila).
2. "What ready food can we eat?" Only items the app shows as usable are offered.

**6.4 ChatGPT, write path with zero inventory change (owner).** Uses only no-op and refused
requests; the user document and `version` stay unchanged:
1. Pick a staple that `get_inventory` shows with stock level `full`. Ask chat to mark it in stock
   with a new `requestId`. Expected: `unchanged: true`, the revision does not change. This proves
   the create-only request record (and the new permission).
2. Repeat the exact same call with the same `requestId`. Expected: `replayed: true`, same answer.
3. Same `requestId`, different item. Expected: refused `request_id_reused`.
4. `undo_request` for that `requestId`. Expected: refused `nothing_to_undo`, nothing changes.
5. `add_stock` on an item `get_inventory` shows as expired or check. Expected: refused ("record the
   new purchase separately in the app"), nothing changes.
6. Confirm in the app that inventory is unchanged.

A full undo round trip (a real change, then `undo_request`) changes production data and is **not**
part of this smoke; it happens only through ordinary use, at the owner's discretion.

## 7. After release
- Watch chat writes for a week through ordinary use; any surprise → `undo_request`, then report.
- Follow-ups: REST parity or removal (2.1); undo tombstone time (2.2); TTL if deferred (2.4);
  `consumeReadyFood` `String()` on stored ids; placeholder-id collision; non-staple `empty` stock
  level after a merge.
