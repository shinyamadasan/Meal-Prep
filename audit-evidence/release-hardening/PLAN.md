# TASK-078 Phase 1 release hardening

Preserved candidate: 6f035312e9253c729f5a26f0da0a81b69c576c76, existing branch
`task-078-reliability-recovery-v1`. Clean worktree before this assignment. Original checkout,
audit artifacts, recovery implementation and prior review remain intact.

1. Reproduce imported recipe/storage/hack output execution and unsafe handler arguments using
   synthetic JSON, desktop/mobile contexts, edit forms and related Plan/Prep/Nutrition views.
   Imported text must remain text after reload. Preserve stored values and id types.
2. Escape text/attributes at output. Quote recipe handler ids with both JavaScript and HTML
   escaping. Use JSON literals for strict-type legacy storage/hack ids. No sanitizer/schema change.
3. Prevent offline/signed-out Restore until an online account has read cloud data; recheck the
   same account at confirmation. Accountless local backups cannot safely arbitrate cloud scalar
   history/session ownership. Retain backup and explicitly disclose unconfirmed cloud restoration.
4. Run red/green regressions, full local npm suite with external browser requests blocked,
   worker/bridge and ledger compatibility, syntax, whitespace, original evidence integrity and
   documentation warning delta. Independent reviewer inspects the frozen candidate and evidence.
5. Commit to this existing branch, prepare PR and deployment/rollback instructions; no main push,
   merge, deployment, production writes, migrations, new dependencies, or Phase 2.

Acceptance: zero active markup or injected handler execution in the scoped imported fields;
all supported number/string ids retain actions; refused Restore leaves runtime/primary/backup
unchanged; eligible restore persists history/session through reload and fake cloud sign-in;
unconfirmed cloud save is never reported as successful cloud recovery; all regression gates pass.
