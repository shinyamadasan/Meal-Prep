# AI OS Notes

> Append-only friction log. One line per workflow awkwardness noticed while working.
> These are candidate improvements to the OS itself — not app bugs.

- 2026-07-16: `Dispatch-Commands.ps1`'s reply-writing step (per-command commit+push to `OUTBOX.md`)
  races with n8n's independent poll-and-clear step on the same file; the PC-side push loses silently
  (never checked) whenever they land close together, leaving an orphaned unpushed local commit that
  later surfaces as a spurious rebase conflict on an unrelated branch. Hit this five separate times
  in one session (each resolved by hand: confirm the orphaned commit's content was already delivered,
  then sync or skip). Not fixed at the root — candidate fix is retry-with-refetch on push failure,
  not yet built.
- 2026-07-16: `Start-ScheduledTask` on the Command Dispatcher task doesn't reliably trigger prompt
  execution when invoked programmatically (two manual triggers produced no dispatcher activity at
  all, confirmed via `claude-session.log` staying untouched) — running
  `tools/Dispatch-Commands.ps1` directly is the reliable way to force immediate processing instead of
  waiting for the next scheduled tick.
- 2026-07-16: when Claude implements a D-040 automation-surface task directly (Codex can't touch
  `tools/`), the task's `TASKS.md` entry and any `docs/DECISIONS.md` record must be committed
  directly to `main` in their own commit — never bundled into the task branch's own commit. `/merge`
  reads `TASKS.md` from whatever's currently on `main`; if the task entry only exists on the branch,
  `/merge TASK-X` fails with "TASK-X is not in TASKS.md" even though the branch is otherwise ready.
  Cost about 15 minutes to diagnose the first time it happened (TASK-019). See D-040.
