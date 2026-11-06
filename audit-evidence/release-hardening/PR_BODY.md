Importing a backup could execute grocery/recipe/storage-guide/hack markup or partly change data before rejecting it. Internal backups omitted cooking history/prep state, and retained tombstones could delete restored records again. This bounded Phase 1 repair stages imports before mutation, renders the scoped imported content inertly, restores complete internal snapshots and explicitly revives restored collection ids without discarding unrelated deletion evidence or ledger facts.

Restore now requires an online signed-in account after its cloud read and rechecks the same account at confirmation. Local backups have no account owner, so automatic offline scalar precedence would be unsafe. Failed cloud confirmation retains the backup and warns to retry before sign-out/reload. JSON export stays 1.6; legacy imports and numeric/string ids remain compatible. No schema, dependency, Worker or infrastructure change.

Validation:
- Original recovery: 40 regression cases, then 37 additional hardening cases; all pass. New hardening baseline at 6f03531: 2 pass/35 fail.
- Focused recovery/deletion/durability/ledger: 135 pass. Complete local npm suite: 813 pass, zero failures/skips/flaky results.
- Recipe-import Worker: 9 pass; conversational MCP bridge: 254 pass; decision pointers: 115 pass.
- All 47 earlier evidence files retain their hashes. Docs scanner retains 55 identical historical warnings, zero new.
- Separate independent review and source hashes: REVIEW.md and audit-evidence/release-hardening/CANDIDATE_SHA256.json.

Review the deliberate guest/offline Restore restriction and remaining network/device limits in audit-evidence/release-hardening/REPORT.md. This is scoped output hardening, not full-app XSS clearance or general offline multi-device reconciliation. Real device and production smoke checks remain unperformed.

Draft for owner review only. Do not merge, deploy, migrate or run production writes without explicit approval. Deployment/rollback procedure is prepared in audit-evidence/release-hardening/RELEASE_CHECKLIST.md; no step has been executed. Phase 2 is unstarted.
