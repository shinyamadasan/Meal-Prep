# 09 — Automation

## Overview

The system is self-operating during off-hours. No human needs to be present for development to happen. This document explains every automated component: what runs, when, in what order, and what controls each piece.

---

## Automation stack

> **Gated by default.** `run-claude.ps1` starts with `$AUTOMATION_ENABLED = $false`. While that's
> false, the whole stack below is inert — the script logs one line and exits. See
> [Enabling / disabling automation](#enabling--disabling-automation).

```
Windows Task Scheduler
    └── fires run-claude.ps1 (9PM and 2AM)
            ├── [$AUTOMATION_ENABLED gate — exits 0 immediately if false, before anything else]
            ├── Phase 0: Preflight        (deterministic: repo/branch/tree/git/scripts/claude CLI —
            │                                any failure aborts with exit 2, nothing below runs)
            ├── Apply-Decisions.ps1       (deterministic: decisions → BUILD_QUEUE)
            ├── claude -p "..."            (AI: triage + BUILD_QUEUE → PLAN.md/TASKS.md — PLANNING ONLY,
            │                                never edits app.js/index.html/style.css, no commit/push tool)
            ├── [commit-scope guard]       (deterministic: only commits if the LLM stayed inside the
            │                                allowed planning-doc surface — any violation halts with
            │                                exit 1, nothing below runs)
            ├── Generate-Digest.ps1       (deterministic: proposals → DIGEST.md)
            └── Generate-Codex-Notice.ps1 (deterministic: TASKS.md → CODEX_READY.md)

n8n (always-on, cloud)
    ├── Workflow 1: Telegram → captures (every message, webhook trigger)
    └── Workflow 2: DIGEST.md + CODEX_READY.md → Telegram (daily at 07:00)

You (human)
    └── Run Codex locally, say "Continue" — the default way TASKS.md work gets built.
        See "Telegram remote control" below for the /build command, which can trigger this
        remotely — but still only when YOU send /build or /go, never on a schedule alone.
```

Everything above is the twice-daily, planning-only pipeline. See
[Telegram remote control](#telegram-remote-control) below for the on-demand layer built on top of it
(`/status /next /go /run /build /review /stop /enable /disable`).

**Fail-fast, pipeline-wide:** every phase boundary above is a hard stop. A Preflight failure, a halted
guard, a failed `git commit`/`git push`, or an errored deterministic script all immediately end the run
— no later phase (digest generation, Codex-ready notice, further commits, further pushes) executes
once one has failed. Exit codes: `0` = disabled (expected steady state) or a clean completed/idle run,
`1` = mid-run halt (something failed after real work started), `2` = preflight abort (an environment
or repo-state problem — nothing was attempted).

---

## Windows Task Scheduler

### The scheduled task

**Task name:** "Meal Prep Claude Overnight"
**Defined in:** `setup-task-scheduler.ps1`
**Triggers:**
- 9:00 PM daily
- 2:00 AM daily

**Settings:**
- `WakeToRun = $true` — the PC wakes from sleep to run this task. The PC must be plugged in.
- `MultipleInstances = IgnoreNew` — if a run is still going when the next trigger fires, the second trigger is silently dropped.
- `ExecutionTimeLimit = 2 hours` — the task is killed after 2 hours if still running.

**Run as:** The logged-in user (`$env:USERNAME`). The task uses the current user's credentials so Claude Code can access the Claude Pro subscription session.

**How to check task status:**
```powershell
Get-ScheduledTask -TaskName "Meal Prep Claude Overnight" | Get-ScheduledTaskInfo
```

**How to run immediately (without waiting for trigger):**
```powershell
Start-ScheduledTask -TaskName "Meal Prep Claude Overnight"
```

**How to re-register after changing the schedule:**
```powershell
# Run as Administrator
.\setup-task-scheduler.ps1
```

---

## run-claude.ps1 — the session launcher

**Location:** Project root
**Executed by:** Windows Task Scheduler

> **v2.0 change:** Claude no longer builds anything in this script. It used to read
> `planning/TASK.md` and implement directly in `app.js`/`index.html`/`style.css`, commit, and push to
> `main` — that behavior predates the Claude/Codex role split (`CLAUDE.md`/`AGENTS.md` v2.0) and has
> been removed. Claude's job here is now Triage + converting approved `planning/BUILD_QUEUE.md` items
> into `PLAN.md`/`TASKS.md`. Only Codex (run manually, locally, by you) ever touches app code.

### Phase 0: The automation gate
```powershell
$AUTOMATION_ENABLED = $false   # flip to $true to re-enable overnight automation
...
if (-not $AUTOMATION_ENABLED) {
    Add-Content -Path $logFile -Value "Automation disabled ... -- exiting without touching the repo."
    exit 0
}
```
The master safe-gate. Default `$false`. Checked *first*, ahead of every other Preflight check below —
if it's off, the script logs one line and exits (code `0`) before touching git, the repo, or calling
Claude at all. This ordering is deliberate: `$AUTOMATION_ENABLED = $false` is the normal, expected
state every single night until you deliberately turn it on, so it exits calmly and quietly rather than
running the rest of Preflight and risking a noisy "ABORTED: working tree is dirty" every night the
repo happens to have uncommitted work sitting around (which, realistically, is most nights). See
[Enabling / disabling automation](#enabling--disabling-automation).

### Phase 0: Preflight (only reached if the gate above is open)

Six checks, each of which **aborts the entire run** (exit code `2`, nothing below runs) on failure:

| Check | What it verifies | Typical failure |
|---|---|---|
| Repository exists | `$projectPath` exists and contains a `.git` folder | Path in the script is wrong, or the checkout was deleted |
| Git available | `git` resolves on `PATH` | A Scheduled Task's environment can have a stripped-down `PATH` compared to an interactive shell |
| Correct branch | `git branch --show-current` equals `main` | Someone (you, Codex, a prior session) left a `task-<id>` branch checked out |
| Working tree clean | `git status --porcelain` is empty | Uncommitted work — yours, Codex's, or a prior run's — is sitting in the repo |
| Required scripts exist | `tools\Apply-Decisions.ps1`, `tools\Generate-Digest.ps1`, `tools\Generate-Codex-Notice.ps1` all present | One was deleted, renamed, or never restored after a clone |
| Required environment variables exist | `claude` resolves on `PATH` | Same "Scheduled Task PATH is smaller than yours" problem as `git` above |

Each failure writes this exact shape to `claude-session.log` and exits immediately:

```
AUTOMATION ABORTED

Reason:
Working tree is dirty.

Required action:
Commit, stash, or clean the repository before enabling automation.

Phase 0 -- Preflight
[x] Repository exists
[x] Git available
[x] Correct branch
[ ] Working tree clean  <-- failed here
```

**Why abort instead of auto-fixing (e.g., auto-`git checkout main`, auto-stash):** this is exactly the
class of "silently do something reasonable-sounding" behavior that caused a real incident during
development — an earlier version of this script had no branch check at all, so a test run's commits
silently landed on whatever branch happened to be checked out (`task-001`) instead of `main`, and were
never pushed to `origin/main` as intended. Requiring a human to put the repo in a known-good state
before automation touches it is the safer default; auto-remediation would just move the same class of
bug one level deeper.

### Phase 0b: Setup (only reached once Preflight passes)
```powershell
$projectPath = "C:\Users\Admin\Desktop\Vibe code\Meal prep app"
Set-Location $projectPath
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
```
Removes `ANTHROPIC_API_KEY` to force use of the Claude Pro browser subscription, not API billing.

### Phase 1: Apply-Decisions.ps1
```powershell
& "$projectPath\tools\Apply-Decisions.ps1"
```
Runs before Claude Code. Parses any decision files in `captures/decisions/` (status: new), updates PROPOSALS.md statuses, appends approved items to BUILD_QUEUE.md. Commits any changes. Claude Code then sees an already-updated BUILD_QUEUE.

### Phase 2: Claude Code autonomous run — PLANNING ONLY
```powershell
$logFile = "$projectPath\claude-session.log"
claude -p $prompt `
    --allowedTools "Read" "Glob" "Grep" "Edit" "Write" "Bash(git status)" "Bash(git diff *)" "Bash(git log *)" `
    | Tee-Object -FilePath $logFile -Append
```
The prompt scopes Claude to exactly two steps:
- **STEP A — Triage:** `captures/inbox/*.md` (status: new) → enriched proposals in `planning/PROPOSALS.md`. Unchanged from before.
- **STEP B — Plan conversion (new):** for each `planning/BUILD_QUEUE.md` item not yet reflected in `TASKS.md`, break it into atomic Codex-ready tasks (`status: codex`) meeting the Definition of Ready, and update `PLAN.md`. This is the automated equivalent of the interactive "Plan" command.

Note what's **not** in `--allowedTools`: no `Bash(git commit *)`, no `Bash(git push *)`. Claude cannot
commit or push anything in this session, by construction — not just by prompt instruction.

### Phase 2b: Commit-scope guard (deterministic, no LLM)
```powershell
$allowedPatterns = @('^PLAN\.md$', '^TASKS\.md$', '^STATUS\.md$', '^planning/BUILD_QUEUE\.md$',
    '^planning/PROPOSALS\.md$', '^planning/DIGEST\.md$', '^planning/CODEX_READY\.md$', '^captures/')
$changed = @(git status --porcelain | ForEach-Object { $_.Substring(3).Trim() } | Where-Object { $_ })
$violations = @($changed | Where-Object { $path = $_; -not ($allowedPatterns | Where-Object { $path -match $_ }) })
```
This is the real safety boundary, not the prompt. After the Claude session returns, the script itself
checks every changed file against an explicit allow-list of planning/doc surfaces.
- **Any violation** (e.g. `app.js`, `index.html`, `style.css`, `CLAUDE.md`, `AGENTS.md` changed):
  logs an `ALERT`, appends a warning block to the top of `STATUS.md`, and **halts the entire run —
  fail-fast, exit code `1`.** Phase 3 (digest refresh, Codex-ready notice) never runs, nothing further
  is committed or pushed or sent to Telegram. The working tree is left dirty for you to inspect —
  nothing is auto-discarded.
- **Clean:** the script (not Claude) stages exactly the changed files, commits, and pushes.

This mirrors how `Apply-Decisions.ps1` and `Generate-Digest.ps1` already work: the deterministic
script owns every commit; the LLM only ever proposes file edits. Every `git commit`/`git push` in this
script — across all phases, not just this one — checks its own exit code and halts the same way on
failure; a failed push (e.g. remote diverged) stops the run exactly like an out-of-scope file would.

### Phase 3: Generate-Digest.ps1 + Generate-Codex-Notice.ps1
```powershell
& "$projectPath\tools\Generate-Digest.ps1"
& "$projectPath\tools\Generate-Codex-Notice.ps1"
```
Runs after the guard. `Generate-Digest.ps1` reads pending proposals from PROPOSALS.md and writes
`planning/DIGEST.md` in Telegram-markdown format (unchanged). `Generate-Codex-Notice.ps1` (new) reads
`status: codex` entries from `TASKS.md` and writes `planning/CODEX_READY.md` — see
[Generate-Codex-Notice.ps1 — Codex-ready notice generator](#generate-codex-noticeps1--codex-ready-notice-generator)
below. Both are committed together if either changed.

### Phase 4: Optional shutdown
```powershell
$hour = (Get-Date).Hour
if ($hour -lt 6 -and $violations.Count -eq 0 -and $changed.Count -gt 0) {
    shutdown /s /t 60
}
```
If it's before 6AM (i.e., the 2AM trigger), the commit-scope guard didn't halt the run, and there was
actual planning work to commit, shuts down the PC in 60 seconds. The 9PM trigger does NOT trigger a
shutdown (the human may still be using the PC). An idle run (nothing in the inbox, nothing new in
`BUILD_QUEUE.md`) also skips the shutdown — there's no reason to force one when nothing happened.

---

## Apply-Decisions.ps1 — decision processor

**Location:** `tools/Apply-Decisions.ps1`
**Language:** PowerShell (pure; no Claude, no network)
**Input:** `captures/decisions/*.md` where `status: new`
**Output:** Updated PROPOSALS.md, updated BUILD_QUEUE.md, decisions marked `status: applied`

### What it does

1. Finds all decision files with `status: new`
2. Reads the body of each file (the human's approval text from Telegram)
3. Parses for decision clauses:
   - `Approve 5` → approve PROP-005
   - `Approve 14-19` → approve PROP-014 through PROP-019
   - `Approve 2,3 5-7` → approve PROP-002, PROP-003, PROP-005, PROP-006, PROP-007
   - `Park 7` → park PROP-007
   - `Reject 12` → reject PROP-012
   - `Clarify 3` → mark PROP-003 as needs clarification
   - `Accept` → apply each proposal's recommended verdict (`▶ Decision` field in PROPOSALS.md)
   - `Approve all` → approve every pending proposal
4. Updates each affected PROPOSALS.md entry's `**status:**` line to `approved`/`parked`/`rejected`/`clarify`
5. For approved proposals: appends a `BQ-NNN — <title>` block to BUILD_QUEUE.md
6. Marks each decision file `status: applied`

### Idempotency
If the script runs twice on the same decision file, the second run finds `status: applied` and skips it. BUILD_QUEUE entries are only appended once.

### When it runs
- Every time `run-claude.ps1` fires (9PM, 2AM)
- Can be run manually: `.\tools\Apply-Decisions.ps1`

---

## Generate-Digest.ps1 — digest generator

**Location:** `tools/Generate-Digest.ps1`
**Language:** PowerShell (pure; no Claude, no network)
**Input:** `planning/PROPOSALS.md` (pending entries only), `planning/ROADMAP.md` (Current Objective)
**Output:** `planning/DIGEST.md`

### What it does

1. Reads `planning/ROADMAP.md`, extracts the Current Objective string
2. Reads `planning/PROPOSALS.md`, filters for entries where `**status:** pending`
3. Groups entries by the AI-recommended verdict in the `▶ Decision` field:
   - Approve
   - Clarify
   - Park
   - Reject
4. Writes `planning/DIGEST.md` using Telegram-markdown formatting (bold, backtick code)

### When it runs
After every Claude Code session (even if no proposals changed). If DIGEST.md is unchanged, no commit is made.

### Output format
```
📋 *Pending Proposals Digest*
Current Objective: Alpha stability

🟢 *Recommend Approve* (3)
PROP-007 — Add batch cooking timer
...

🔵 *Recommend Clarify* (1)
PROP-009 — Nutritional API integration
...
```

---

## Generate-Codex-Notice.ps1 — Codex-ready notice generator

**Location:** `tools/Generate-Codex-Notice.ps1`
**Language:** PowerShell (pure; no Claude, no network)
**Input:** `TASKS.md`
**Output:** `planning/CODEX_READY.md`

### What it does

1. Reads `TASKS.md`, finds every `### TASK-<id> · <title>` block whose `status:` line is exactly `codex`
2. If there's at least one: writes a Telegram-ready list of those tasks to `planning/CODEX_READY.md`
3. If there are none: writes the literal placeholder line `No Codex-ready tasks right now.` — n8n's
   IF node checks for this exact string to decide whether to send a Telegram message at all

### Output format
```
🤖 *Codex-Ready Tasks (2)*
Run Codex locally and say "Continue" to pick these up.

*TASK-002* · Fix #username-modal: convert button row to .modal-footer + apply size class
*TASK-003* · Sweep 4 remaining modals: inline max-width → CSS modifier class
```

### When it runs
After `Generate-Digest.ps1`, every time `run-claude.ps1` runs with automation enabled. If
CODEX_READY.md is unchanged, no commit is made (same idiom as DIGEST.md).

### Why this exists, not an automatic Codex invocation
Codex is never triggered by this pipeline — this file is a **notification only**. You still run
Codex locally and type "Continue" yourself (`AGENTS.md`'s "Continue" command). This just tells you
there's something waiting, the same way the digest tells you there are proposals waiting.

---

## n8n — always-on cloud relay

n8n runs continuously (cloud-hosted). It does not depend on the PC being on or the Task Scheduler running.

### Workflow 1: Telegram → captures

Trigger: Any Telegram message to the bot (webhook, not polling)

```
Telegram message → n8n → Authorized? → Build file → GitHub PUT → Reply ok
```

- Runs instantly on message receipt
- Writes to `captures/inbox/` or `captures/decisions/` depending on message content
- The next scheduled `run-claude.ps1` will process the file

**There is no automatic trigger between a capture arriving and Claude processing it.** The human sends a capture at any time; Claude Code processes it at the next 9PM or 2AM run.

### Workflow 2: DIGEST.md + CODEX_READY.md → Telegram

Trigger: Schedule, `0 7 * * *` (7AM n8n server time)

```
                    ┌→ GitHub GET DIGEST.md ──────→ Telegram send (always)
Schedule ───────────┤
                    └→ GitHub GET CODEX_READY.md → IF has Codex-ready tasks → Telegram send (only if true)
```

- Delivers the pre-generated DIGEST.md to Telegram every morning
- If there are no pending proposals, DIGEST.md will reflect that
- **Also** fetches `planning/CODEX_READY.md` in parallel and sends it as a second message, but **only**
  when it doesn't contain the placeholder string `No Codex-ready tasks right now.` — so you're not
  pinged every morning when there's nothing for Codex to build

---

## Full daily automation sequence

```
[Any time during the day]
Human sends Telegram message
    → n8n immediately writes to captures/inbox/ or captures/decisions/

[7:00 AM]
n8n sends current DIGEST.md to Telegram
Human reads digest, sends approval reply (e.g., "Approve 14 15")
    → n8n writes captures/decisions/<timestamp>-decide.md

[9:00 PM]
Task Scheduler wakes PC (if sleeping)
run-claude.ps1 starts

  0. $AUTOMATION_ENABLED check
     → false: log one line, exit. Nothing below runs. (default state)
     → true: continue

  1. Apply-Decisions.ps1
     → Reads captures/decisions/ (status: new)
     → Updates PROPOSALS.md statuses
     → Appends to BUILD_QUEUE.md
     → Marks decisions status: applied
     → Git commit (if changes)

  2. claude -p "..." (autonomous session — PLANNING ONLY, no commit/push tool)
     → Reads CLAUDE.md, STATUS.md, PLAN.md, TASKS.md
     → STEP A Triage: processes captures/inbox/ (status: new) → PROPOSALS.md
     → STEP B Plan conversion: BUILD_QUEUE.md items not yet in TASKS.md → new TASKS.md entries
       (status: codex) + PLAN.md update
     → Never touches app.js / index.html / style.css; never invokes Codex

  2b. Commit-scope guard (deterministic)
     → Changed files outside the planning-doc allow-list? → ALERT, halt, no commit/push
     → Otherwise → script stages + commits + pushes exactly what changed

  3. Generate-Digest.ps1 + Generate-Codex-Notice.ps1
     → Reads PROPOSALS.md (pending) → writes planning/DIGEST.md
     → Reads TASKS.md (status: codex) → writes planning/CODEX_READY.md
     → Git commit (if either changed)

  [if before 6AM, guard didn't halt, and there was work: shutdown]

[2:00 AM — second run]
Same sequence as 9PM (handles overflow or new captures from evening)

[7:00 AM next day]
n8n delivers updated DIGEST.md, and CODEX_READY.md if it has any tasks

[Whenever you're ready]
You run Codex locally, say "Continue" — Codex reads TASKS.md, picks up the first `status: codex`
entry, and implements it. This step is always manual; nothing above triggers it.
```

---

## Monitoring the automation

### Check if last night's run completed

```powershell
# View last 50 lines of the session log
Get-Content ".\claude-session.log" -Tail 50

# View Task Scheduler last run result
Get-ScheduledTaskInfo "Meal Prep Claude Overnight" | Select LastRunTime, LastTaskResult
# LastTaskResult = 0 means success; non-zero = failure
```

### Check what Claude did

```powershell
# Last 10 commits
git log --oneline -10

# What changed in the last commit
git show --stat HEAD
```

### Check if decisions were applied

Open `planning/BUILD_QUEUE.md` — approved items will appear as `BQ-NNN` entries.
Open `captures/decisions/` — processed files will have `status: applied`.

### Check the digest

Open `planning/DIGEST.md` or wait for the 7AM Telegram message.

---

## Failure modes

| Failure | Symptom | Diagnosis | Fix |
|---|---|---|---|
| Automation disabled (expected default) | No commits at all, log says "Automation disabled"; exit code `0` | Check top of `run-claude.ps1` | Set `$AUTOMATION_ENABLED = $true` if you meant to run it |
| Preflight aborted | Log has an "AUTOMATION ABORTED" block naming a failed check; exit code `2`; nothing was attempted | Read the "Reason" line — it names exactly which of the 6 checks failed | Take the "Required action" line literally (e.g. `git checkout main`, commit/stash the tree) — Preflight never auto-fixes anything, it only tells you what to fix |
| Commit-scope guard halted the run | `claude-session.log` has an `ALERT` line; `STATUS.md` has an "AUTOMATION HALTED" block; exit code `1`; nothing committed, no digest/Codex-ready refresh happened either (fail-fast) | Read the `ALERT` message — it names the out-of-scope file(s) | Inspect the working tree by hand; either revert the stray edit or, if it's legitimate, decide manually whether to commit it (this should not happen — investigate why the LLM edited that file) |
| PC didn't wake | No commits after 9PM (with automation enabled) | Task Scheduler: `LastTaskResult = 267011` | Re-enable "Wake to run"; check power settings |
| Claude Pro quota exhausted | `claude-session.log` contains "rate limit" or "quota exceeded" | Check log | Wait for monthly reset; or set `ANTHROPIC_API_KEY` |
| Claude logged out | `claude-session.log` contains "not authenticated" | Check log | Run `claude login` manually |
| Apply-Decisions.ps1 error | No BUILD_QUEUE update despite decision file | Check log; check decision file format | Fix the decision file format or re-send from Telegram |
| Git push rejected | `claude-session.log` contains "rejected" | Remote has diverged | `git pull --rebase origin main` then push |
| n8n offline | No reply after Telegram message; no morning digest | n8n execution log shows errors | Restart n8n instance; check webhook URL |
| PAT expired | n8n execution: 401 error | n8n execution history shows 401 | Generate new PAT, update n8n node |
| Codex-ready notice missing | 7AM message has digest but no Codex-ready notice, even though TASKS.md has `status: codex` entries | Check `planning/CODEX_READY.md` content on GitHub; check the IF node's string against `$NONE_PLACEHOLDER` in `Generate-Codex-Notice.ps1` | Keep the placeholder string byte-for-byte identical in both places |

---

## Changing the automation schedule

1. Edit `setup-task-scheduler.ps1`:
   ```powershell
   $trigger1 = New-ScheduledTaskTrigger -Daily -At "9:00PM"
   $trigger2 = New-ScheduledTaskTrigger -Daily -At "2:00AM"
   ```
2. Re-run as Administrator:
   ```powershell
   .\setup-task-scheduler.ps1
   ```
3. Verify:
   ```powershell
   Get-ScheduledTask "Meal Prep Claude Overnight" | Get-ScheduledTaskInfo
   ```

The digest delivery time is controlled separately in n8n (Workflow 2 trigger cron expression).

---

## Enabling / disabling automation

There are **two independent switches**. Both must be in the state you want — one gates the code path,
the other gates the physical trigger.

### 1. `$AUTOMATION_ENABLED` (the code gate — start here)

Edit the top of `run-claude.ps1`:

```powershell
$AUTOMATION_ENABLED = $true    # was $false
```

This is the one to flip once you've reviewed the change and are ready to let the overnight run plan
(triage + BUILD_QUEUE → TASKS.md) unattended. It does **not** let anything build app code or invoke
Codex — that boundary is structural (§ Phase 2 / 2b above), not something this flag controls.

To go back to fully inert at any time, set it back to `$false` and commit. No other change needed.

### 2. The Windows Scheduled Task (the physical trigger)

```powershell
# Disable overnight runs entirely (the task won't fire at all)
Disable-ScheduledTask -TaskName "Meal Prep Claude Overnight"

# Re-enable
Enable-ScheduledTask -TaskName "Meal Prep Claude Overnight"

# Check current state
Get-ScheduledTask -TaskName "Meal Prep Claude Overnight" | Select-Object TaskName, State
```

Both `Disable-ScheduledTask`/`Enable-ScheduledTask` require an elevated (Administrator) PowerShell —
running them from a normal session fails with "Access is denied."

n8n workflows (capture + digest) can be paused/activated individually via the n8n UI, independent of
both switches above — capture is always safe to leave running (D-015: capture ≠ build).

### Recommended state while validating this change

`$AUTOMATION_ENABLED = $false` **and** the Scheduled Task disabled, until you've run through the
[Testing protocol](#testing-protocol) below at least once manually.

---

## Testing protocol

Run these in order after any change to `run-claude.ps1`, `tools/Generate-Codex-Notice.ps1`, or
`n8n-telegram-digest.json`.

1. **Gate off (default state):** with `$AUTOMATION_ENABLED = $false`, run `run-claude.ps1` manually
   (`.\run-claude.ps1` from the project root) with an approved item sitting in `BUILD_QUEUE.md`.
   Verify: `claude-session.log` shows the "Automation disabled" line; exit code `0`; `git status` shows
   zero changes; no commits, no pushes.
2. **Preflight abort cases:** with `$AUTOMATION_ENABLED = $true`, deliberately trigger each check and
   confirm the run aborts before Phase 1 ever starts (exit code `2`, "AUTOMATION ABORTED" block in the
   log naming the right check and the right "Required action"):
   - On a `task-<id>` branch instead of `main` → "Correct branch" fails.
   - With any uncommitted change present (even an unrelated one) → "Working tree clean" fails.
   - With `tools/Generate-Codex-Notice.ps1` temporarily renamed → "Required scripts exist" fails.
   Confirm in each case that `git status` is unchanged afterward — Preflight only ever reads state.
3. **Gate on, clean case:** on `main`, with a clean working tree, flip to `$true` and run. Verify:
   - Exit code `0`.
   - `git diff --stat` against `HEAD~1` shows only allow-listed files changed (`PLAN.md`, `TASKS.md`,
     `STATUS.md`, `planning/*`, `captures/*`).
   - `app.js`, `index.html`, `style.css` are byte-identical to before (`git diff --stat` shows nothing
     for them).
   - New `TASKS.md` entries have `status: codex` and meet the Definition of Ready (objective, files,
     acceptance criteria, constraints, verification steps).
   - `planning/CODEX_READY.md` lists exactly those `status: codex` tasks.
4. **Fail-fast, violation case (simulated):** on `main` with a clean tree, let Preflight pass, then —
   before Phase 2b's guard runs — get `style.css` dirty (e.g. via a throwaway edit made mid-run isn't
   practical to script; the realistic version of this test is: confirm via code reading that if the
   guard *would* fire, everything after it — Phase 3's digest refresh, its commits, its pushes, the
   shutdown logic — is structurally unreachable, since `Halt-Automation` calls `exit 1` unconditionally).
   If you do reproduce a real violation (e.g. from a stray concurrent edit), verify: `claude-session.log`
   has an `ALERT` + exit code `1`; `STATUS.md` has an "AUTOMATION HALTED" block; **no** commit for
   `DIGEST.md`/`CODEX_READY.md` happened this run (check `git log` timestamps); the working tree still
   shows the offending file uncommitted.
5. **Codex-ready notice, empty case:** with no `status: codex` tasks in `TASKS.md`, run
   `.\tools\Generate-Codex-Notice.ps1` directly. Verify `planning/CODEX_READY.md` contains exactly
   `No Codex-ready tasks right now.`.
6. **n8n:** in the n8n UI, manually execute the digest workflow twice — once with `CODEX_READY.md`
   populated, once with the placeholder. Verify the Codex-ready Telegram message sends only in the
   first case, and the regular digest sends in both.
7. **No stray Codex invocation:**
   ```powershell
   Select-String -Path run-claude.ps1, n8n-telegram-*.json, tools\*.ps1 -Pattern "codex " -SimpleMatch -CaseSensitive:$false
   ```
   should return no executable invocation — only doc/comment mentions, if any.

---

## Rollback plan

- **Instant, no-git rollback:** set (or leave) `$AUTOMATION_ENABLED = $false` in `run-claude.ps1` and
  commit. The entire pipeline described in this document goes inert immediately — same behavior as
  before this change existed.
- **Full revert:** `git revert` the commit(s) that touched `run-claude.ps1`,
  `tools/Generate-Codex-Notice.ps1`, and `n8n-telegram-digest.json`. In the n8n UI, re-import the
  reverted `n8n-telegram-digest.json` (or simply deactivate/reactivate the workflow) to clear the two
  added nodes.
- **Scheduled Task kill-switch:** `Disable-ScheduledTask -TaskName "Meal Prep Claude Overnight"` (as
  Administrator) stops the physical trigger regardless of any code state — use this if you need to be
  certain nothing fires while you investigate, independent of the `$AUTOMATION_ENABLED` flag.

---

## Telegram remote control

Everything above runs twice a day, on a schedule, and only ever plans. This layer adds an on-demand
control panel: approve ideas, trigger planning, trigger a Codex build, trigger Claude's review, and
get results, from Telegram — without touching the PC. See DECISIONS D-024 for the full rationale.

### Why there's a delay, and why that's a deliberate trade-off

n8n (cloud-hosted) has **no way to execute anything on your PC directly** — it only reads/writes
files via the GitHub API. So a Telegram command can't instantly *cause* anything; your PC has to
independently notice a new command file and act on it. This design polls every **~2 minutes** (a new
Scheduled Task, not tied to the twice-daily one) rather than opening an inbound path to your PC for
true instant push — that would mean a listener process on your PC reachable from the internet (via a
tunnel like Cloudflare Tunnel/ngrok), its own auth, and its own monitoring. This system has had zero
inbound network exposure this entire session; a couple of minutes of latency was judged worth keeping
it that way. If the PC is asleep, commands wait until it wakes — either on its own, or at the next
9PM/2AM run of "Meal Prep Claude Overnight" (which still has `-WakeToRun`).

### The commands

| Command | What it does | Branch | Mutates? |
|---|---|---|---|
| `/status` | Automation on/off, current branch + tree state, last log line, Codex-ready + review-ready counts | none | no |
| `/next` | Reports whose turn it is (same priority table as the `Next` command, D-021) | none | no |
| `/go` | **Mission autopilot (the everyday command, D-026).** One `/go` = one mission: plan if needed → build the single highest-priority dependency-satisfied task → auto-review → report. Marks the built task `done` on `main` (= ready to merge) so the next `/go` advances. Rework auto-blocks with a strike (retries until 3/3, then stays blocked); a task whose dependency isn't merged is parked "waiting on merge". Returns an aggregate summary, detail only on failure. | `main` (plus the `task-<id>` its build runs on) | `TASKS.md` status/notes on `main`; app code etc. on the `task-<id>` branch |
| `/log` | Tails the last 40 lines of `claude-session.log` (power-user/debug) | none | no |
| `/run` | Manual override: runs planning right now (Triage + BUILD_QUEUE→TASKS.md), same as `run-claude.ps1` without `-Scheduled` | `main` | same allow-list as the scheduled run |
| `/build` | Builds the first `status: codex` task on its own `task-<id>` branch by running Codex CLI unattended (`codex exec ... "Continue"`) — auto-chains into `/review` if it reaches `status: review` | `task-<id>` (never `main`) | app code + tests + `CHANGELOG.md`/`TEST_REPORT.md` + `TASKS.md` status |
| `/review` | Reviews the first `status: review` task's branch — runs automatically after a successful `/build`, or on its own as a manual override | that `task-<id>` (never `main`) | `REVIEW.md` + `TASKS.md` status only |
| `/stop` | Kill switch: disables automation, tries to stop an in-progress run | `main` | flag line only |
| `/enable` | Enables automation | `main` | flag line only |
| `/disable` | Disables automation (does not interrupt anything already running) | `main` | flag line only |

No command ever merges a `task-<id>` branch into `main`. That's always a manual step you do yourself,
the same way every task branch in this repo has been merged so far.

### Architecture

```
Telegram (/status /next /go /run /build /review /stop /enable /disable)
    → n8n (n8n-telegram-inbox.json — extended to recognize these, alongside existing
      captures/decisions verbs and captures/inbox capture types)
    → captures/commands/<id>.md (status: new)

"Meal Prep Command Dispatcher" Scheduled Task, every ~2 min, NO -WakeToRun
    → tools/Dispatch-Commands.ps1
        lock-protected (automation.lock, shared with run-claude.ps1 and the phase runners below)
        routes each new command to:
            /run              → run-claude.ps1 (no -Scheduled)
            /build             → tools/Run-Codex-Build.ps1 (runs `codex exec` for real;
                                  auto-chains into Run-Claude-Review.ps1 if a task reaches status: review)
            /review            → tools/Run-Claude-Review.ps1
            /go                → Invoke-Autopilot: one mission (plan-if-needed → build one
                                  dependency-satisfied task → auto-review → reflect outcome onto main)
            /status /next      → computed directly, read-only
            /stop /enable /disable → flips $AUTOMATION_ENABLED, commits + pushes main
        marks the command status: applied
        appends the result to captures/replies/OUTBOX.md

n8n-telegram-replies.json, every ~2 min
    → fetches OUTBOX.md, sends it to Telegram if it's not just the placeholder,
      clears it back to the placeholder via a GitHub PUT
```

### `/build`: real unattended Codex execution

`tools/Run-Codex-Build.ps1` invokes Codex CLI for real:
```
codex exec -C <repo root> --sandbox workspace-write "Continue"
```
Verified (see DECISIONS D-025) to read `AGENTS.md`/`TASKS.md`, follow the AI Dev OS, and refuse to act
when no `status: codex` task exists — the same contract as a human typing "Continue" interactively.
There is no more "prepare branch and ask a human to open Codex" fallback; that design (D-024) is
superseded now that headless execution is confirmed working.

Before invoking, the script snapshots every `TASK-<id>` currently `status: codex` (the "tracked set" —
plural, because a Sprint Execution Mode / D-023 chained group can legitimately advance more than one
task in a single invocation; the chaining logic itself lives in `AGENTS.md`, which Codex reads on its
own — this wrapper only checks outcomes afterward, never assumes exactly one task changed). stdout,
stderr, exit code, and duration are all captured and logged to `claude-session.log`.

After the run, results are classified against the tracked set:

| Outcome | Condition | What happens |
|---|---|---|
| **no codex work available** | tracked set was empty before invoking | exits 0, Codex is never actually invoked |
| **success → review** | exit 0, at least one tracked task now `status: review` | commits/pushes the branch, then **automatically invokes `tools/Run-Claude-Review.ps1`** (no separate manual `/review` needed), folds both results into one reply |
| **blocked** | exit 0, at least one tracked task now `status: blocked` | commits/pushes whatever's safe (Codex wrote its own blocker note per `AGENTS.md`), reports it, no auto-chain |
| **failure (Codex exited non-zero)** | `codex exec` itself exited non-zero | commits any safe partial progress, marks every still-`codex` tracked task `blocked` with the exit code, reports the failure |
| **failure (no progress)** | exit 0 but no tracked task changed status at all | marks the task(s) `blocked` with a "no tracked progress" note rather than silently reporting success |

The commit-scope guard (unchanged deny-list — see Safety gates below) runs **regardless of exit
code**, before any of the above commits happen — a violation halts everything uncommitted, exactly
like the planning guard.

### Safety gates (all reused/extended from the planning pipeline, none invented fresh)

- **Preflight**, per phase: `/run` reuses today's exact Preflight (must be on `main`, clean). `/build`
  requires `main` clean before branching; `/review` requires the target `task-<id>` branch to exist
  and be clean.
- **Never on a dirty tree / never on the wrong branch** — same `AUTOMATION ABORTED` format, reused verbatim.
- **Never auto-merge** — structurally impossible: no command's logic ever checks out or pushes `main`
  except the flag-only commands, and none of them touch a `task-<id>` branch.
- **Claude never writes app code** — `/review`'s `claude -p` call uses the same restricted
  `--allowedTools` pattern as the planning session, plus its own commit-scope guard whose allow-list
  is only `REVIEW.md`/`TASKS.md`.
- **Codex never touches planning/architecture docs** — `/build`'s commit-scope guard is a deny-list
  (Codex's legitimate surface, app code, is open-ended) blocking `CLAUDE.md`/`AGENTS.md`/`docs/`/
  `planning/`/`captures/`/`library/`/`config/`/`.claude/`/`tools/` and this repo's own automation
  scripts. Any violation halts with no commit/push, exactly like the planning guard.
- **Codex only builds `status: codex` items** — `/build` picks the first one, same FIFO rule as
  Codex's own documented "Continue" behavior.
- **Claude reviews before anything is "done"** — only `/review` can set a task to `status: done`.
  `/build` reaching `status: review` auto-chains into `/review`, but the review step itself is never
  skipped, and only `/review`'s own commit-scope guard (`REVIEW.md`/`TASKS.md` only) governs it.
- **Notify after every phase** — every command appends exactly one entry to `OUTBOX.md`.
- **Repeat-safety** — `/build`/`/review` check the current task status before acting (already
  building/reviewed/done → reply and no-op); `/enable`/`/disable`/`/stop` just set a flag;
  `/status`/`/next` are pure reads.
- **Concurrency** — the shared `automation.lock` (PID + timestamp, stale after 2 hours) means a
  command arriving while another run is active gets "busy" instead of overlapping.

### Setting it up

1. **Re-import `n8n-telegram-inbox.json`** into its existing workflow — it now also recognizes the 9
   control commands (routes them to `captures/commands/`, alongside its existing capture/decision behavior).
2. **Import `n8n-telegram-replies.json`** as a new workflow. Fill the 3 `REPLACE_WITH_*` placeholders
   (GitHub PAT, your Telegram user id, Telegram credential id) and activate it.
3. **Register the dispatcher task** (as Administrator):
   ```powershell
   .\setup-command-dispatcher-scheduler.ps1
   ```
4. Verify, the same way you'd verify "Meal Prep Claude Overnight":
   ```powershell
   Get-ScheduledTask -TaskName "Meal Prep Command Dispatcher" | Select-Object TaskName, State
   (Get-ScheduledTask -TaskName "Meal Prep Command Dispatcher").Actions | Select-Object Execute, Arguments
   ```
   Confirm `State: Ready` and the action points at `tools\Dispatch-Commands.ps1` with no `-Scheduled`
   flag (that flag is specific to `run-claude.ps1`; the dispatcher doesn't take it). The task's
   `ExecutionTimeLimit` is 2 hours (matching "Meal Prep Claude Overnight") — a real Codex build can
   legitimately take a while.
5. **Confirm `codex` is installed, authenticated, and on `PATH`** for the account/session Task
   Scheduler runs under — `Run-Codex-Build.ps1`'s Preflight checks this the same way `run-claude.ps1`
   checks for `claude`, and aborts (exit 2) with a clear message if it's missing.

### Testing

1. **Dry-run everything first:** `.\tools\Dispatch-Commands.ps1 -DryRun`,
   `.\tools\Run-Codex-Build.ps1 -DryRun`, `.\tools\Run-Claude-Review.ps1 -DryRun` — confirm routing
   and safety gates without any real mutation.
2. **Synthetic command test:** hand-craft a `captures/commands/<id>.md` file (see
   `captures/commands/README.md` for the exact format) with `command: status`, run
   `.\tools\Dispatch-Commands.ps1 -DryRun`, confirm the reply looks right, delete the test file.
3. **Live `/status`/`/next`** — read-only, verify accuracy against real repo state.
4. **Live `/go`/`/run`/`/build`/`/review`** — one at a time, watching `claude-session.log` and
   `OUTBOX.md`, confirming branch discipline (never `main` for build/review) and the commit-scope
   guards (simulate a violation the same way `run-claude.ps1`'s guard was verified, if you want to be thorough).
5. **Repeat-safety:** send the same command twice; confirm the second is a safe no-op.
6. **Concurrency:** trigger two commands back-to-back; confirm the second gets "busy."
7. **Kill switch:** `/stop` mid-run; confirm it actually halts and the flag is off afterward.
8. **Codex invocation is exactly the verified command, nowhere else:**
   ```powershell
   Select-String -Path run-claude.ps1, n8n-telegram-*.json, tools\*.ps1 -Pattern "codex " -SimpleMatch -CaseSensitive:$false
   ```
   should show `codex exec ...` used **only** inside `tools/Run-Codex-Build.ps1`, and nowhere else in
   the automation surface — confirms `run-claude.ps1` (the twice-daily planning run) still never
   invokes Codex, and no other script has grown a second, uncontrolled invocation path.
9. **Result classification:** craft `TASKS.md` states to exercise each outcome in the classification
   table above (no codex-ready task, a task that reaches `review`, one Codex marks `blocked` itself,
   and — if you can force it — a non-zero `codex exec` exit) and confirm each produces the right
   `OUTBOX.md` message and TASKS.md state, and that reaching `review` actually triggers `/review`
   automatically without you sending it.

### Rollback

Additive on top of an already-additive design — none of it touches `run-claude.ps1`'s own logic
(only reuses it for `/run`). To fully roll back: `Unregister-ScheduledTask -TaskName "Meal Prep
Command Dispatcher"`, deactivate `n8n-telegram-replies.json`, revert `n8n-telegram-inbox.json` to
before this change (or just stop sending the 9 new commands — unrecognized text still falls through
to the existing capture behavior unchanged). The twice-daily planning pipeline and everything in
DECISIONS D-022 keeps working exactly as before, regardless of this feature's state.
