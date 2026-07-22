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
- 2026-07-20: two compounding gaps let a real security fix silently not-happen while `/go`'s own
  reply text claimed it was self-healing (TASK-025). (1) A rework-strike retry can flip
  `TASKS.md` status forward (`codex` → `review`) without Codex actually changing the code — nothing
  diffs the retry's output against the pre-review version to confirm the must-fix items were
  applied before letting it proceed to re-review. (2) When the follow-up auto-review then crashed
  (`claude -p` exit 1, the same flaky-crash class as TASK-007/014), the resulting `blocked` note
  ("build stopped ... Left at status: review ...") doesn't match either pattern
  `Invoke-Autopilot`'s auto-release regex looks for (`waiting on merge of` / `strike N/3`), so a
  plain `/go` retry would NOT have picked it back up despite the note saying it would. Both were
  only caught because the human asked "are you sure it actually did it" and got the branch/commit
  diff checked by hand. Candidate fixes, not yet built: (a) before advancing a rework-retry past
  `codex`, diff the retry against the must-fix file list and refuse to advance if nothing changed;
  (b) widen the auto-release regex (or the crashed-review note format) so a crashed re-review after
  a real code push is retryable the same way a rework strike is.
- 2026-07-22: a Sprint Execution Mode chained group (TASK-026/027/028, all on shared branch
  `task-027`) left TASK-028 stuck at `status: review` forever after TASK-027's own review approved
  and merged the shared branch — TASK-028's status field was never flipped because nothing in the
  pipeline recognizes "this task's code landed on a DIFFERENT task's branch" as a case to handle.
  `Run-Claude-Review.ps1`'s task-lookup always derives the branch to check out mechanically from the
  task id (`task-<id>`), so every later `/review` (including auto-chains from unrelated builds
  reaching `status: review`) tried to check out a `task-028` branch that correctly never existed,
  aborted with "branch does not exist," and silently blocked whatever review should have run next
  instead (TASK-036's, in this case) — with no error surfaced anywhere that pointed at the real
  cause. Cost a full manual git-archaeology pass (searching all branches/reflog for the "lost" code
  before confirming it was actually already merged) to diagnose. Candidate fix, not yet built: when
  a chained group's task reaches `status: review`, record which branch it actually landed on
  (e.g. a `branch:` field alongside `status:`) so review/lookup doesn't have to assume
  `task-<id>` universally, and so a task whose branch already merged under a sibling's identity can
  be recognized and auto-resolved to `done` instead of retried forever.
