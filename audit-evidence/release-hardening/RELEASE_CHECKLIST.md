# TASK-078 Phase 1 release and rollback checklist

Prepared only. Nothing in this checklist has been executed against production.

## Before integration (owner approval required)

- [ ] Review the complete task branch against main, the independent verdict in REVIEW.md,
  REPORT.md, red/green evidence and the final commit linked from the PR.
- [ ] Accept the deliberate restriction: Restore requires an online signed-in account with its
  cloud data loaded. Accountless/offline recovery is refused, and failed cloud confirmation must
  be retried from the retained backup before sign-out/reload.
- [ ] Confirm main is still the reviewed base `144c7f5252b7c7a32bd6c48572fa13b8cbd10fa9`.
  If main changes, inspect conflicts and rerun affected/full gates before approving integration.
- [ ] Verify code/source hashes match CANDIDATE_SHA256.json and all acceptance evidence is green.
  Existing documentation scanner debt is 55 identical baseline warnings, not a clean global gate.
- [ ] Perform remaining human checks on isolated synthetic data: iOS Safari/Android Chrome,
  editing/deleting imported string and numeric ids, visible inert text, mobile Plan/Prep/Fridge,
  and Restore restriction/error copy. Never use a household's live records as test fixtures.
- [ ] Explicitly approve merge and the existing GitHub Pages release process. A draft PR or a
  PASS review does not authorize either operation. No MCP Worker/Firestore deployment is needed.

## Deployment after explicit approval

- [ ] Record the approved merge/release SHA and previous deployed SHA before changing main.
  The inspected prior main is `144c7f5252b7c7a32bd6c48572fa13b8cbd10fa9`; verify it is actually
  the deployed release at execution time instead of assuming it from this checklist.
- [ ] Use the existing repository release mechanism; do not alter workflows, secrets, schemas,
  Worker versions or production documents for this app-only repair.
- [ ] Fetch deployed app.js as a static asset and verify its reviewed source hash/content.
  sw.js is unchanged and uses network-first app-shell fetches; offline clients can retain older
  cached code until they reconnect. Confirm refreshed code without clearing user storage.
- [ ] Run approved smoke checks in an isolated synthetic account/origin. Any live sign-in,
  autosave, Clear, Import or Restore can write cloud data: obtain specific authorization for
  those checks before running them. Check Plan -> Shop -> Prep -> Fridge, safe imported text,
  backup completeness, tombstone revival, and cloud-confirmed Restore/reload.
- [ ] Stop rollout on executable content, missing history/prep progress after confirmed restore,
  unexpected data loss, or regression of ordinary household flows. Preserve evidence and backups.

## Rollback after explicit approval

- [ ] Preserve the failing browser's mealPrepBackup and primary local data before any reload or
  replacement; never clear localStorage or migrate records as part of a code rollback.
- [ ] Revert the approved release commit(s) through a reviewed PR to the verified previous
  deployed source, using the existing Pages process. Do not force-push/reset main or deploy a
  Worker rollback for this frontend-only candidate.
- [ ] Verify the served app asset and refresh the app shell after reconnecting. Confirm the
  deployed revision with a static asset fetch before opening a signed-in household session.
- [ ] No data migration is required: storage keys, export 1.6, snapshot shape, ids and immutable
  ledger facts are compatible. Mutable restore timestamps retain the existing LWW semantics.
- [ ] Record that rollback reintroduces prior security/recovery defects. Suspend untrusted file
  imports and backup restoration until a corrected release is approved; do not treat rollback
  as a security fix. Keep the retained backup for a later guarded recovery.

## Boundaries

No merge, deployment, production data/service write, migration or live MCP invocation occurred
in this work. Phase 2 is unstarted. Device and real cloud behavior remain human/release checks;
Chromium desktop/mobile viewports and fake Firebase reads/transactions are the automated boundary.
