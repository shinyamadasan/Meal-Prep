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
            ├── [$AUTOMATION_ENABLED gate — exits immediately if false]
            ├── Apply-Decisions.ps1       (deterministic: decisions → BUILD_QUEUE)
            ├── claude -p "..."            (AI: triage + BUILD_QUEUE → PLAN.md/TASKS.md — PLANNING ONLY,
            │                                never edits app.js/index.html/style.css, no commit/push tool)
            ├── [commit-scope guard]       (deterministic: only commits if the LLM stayed inside the
            │                                allowed planning-doc surface — see below)
            ├── Generate-Digest.ps1       (deterministic: proposals → DIGEST.md)
            └── Generate-Codex-Notice.ps1 (deterministic: TASKS.md → CODEX_READY.md)

n8n (always-on, cloud)
    ├── Workflow 1: Telegram → captures (every message, webhook trigger)
    └── Workflow 2: DIGEST.md + CODEX_READY.md → Telegram (daily at 07:00)

You (human)
    └── Run Codex locally, say "Continue" — the ONLY way TASKS.md work ever gets built.
        Nothing in this stack invokes Codex automatically.
```

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
The master safe-gate. Default `$false`. While disabled, the script logs one line and exits before
touching git, the repo, or calling Claude at all — no `Apply-Decisions.ps1`, no Claude session, no
digest generation. See [Enabling / disabling automation](#enabling--disabling-automation).

### Phase 0b: Setup (only reached if the gate is open)
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
  logs an `ALERT`, appends a warning block to the top of `STATUS.md`, and **stops without committing
  or pushing anything** — the working tree is left dirty for you to inspect. Nothing is auto-discarded.
- **Clean:** the script (not Claude) stages exactly the changed files, commits, and pushes.

This mirrors how `Apply-Decisions.ps1` and `Generate-Digest.ps1` already work: the deterministic
script owns every commit; the LLM only ever proposes file edits.

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
| Automation disabled (expected default) | No commits at all, log says "Automation disabled" | Check top of `run-claude.ps1` | Set `$AUTOMATION_ENABLED = $true` if you meant to run it |
| Commit-scope guard halted the run | `claude-session.log` has an `ALERT` line; `STATUS.md` has an "AUTOMATION HALTED" block; nothing committed | Read the `ALERT` message — it names the out-of-scope file(s) | Inspect the working tree by hand; either revert the stray edit or, if it's legitimate, decide manually whether to commit it (this should not happen — investigate why the LLM edited that file) |
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
   Verify: `claude-session.log` shows the "Automation disabled" line; `git status` shows zero changes;
   no commits, no pushes.
2. **Gate on, clean case:** flip to `$true`, run manually again. Verify:
   - `git diff --stat` against `HEAD~1` shows only allow-listed files changed (`PLAN.md`, `TASKS.md`,
     `STATUS.md`, `planning/*`, `captures/*`).
   - `app.js`, `index.html`, `style.css` are byte-identical to before (`git diff --stat` shows nothing
     for them).
   - New `TASKS.md` entries have `status: codex` and meet the Definition of Ready (objective, files,
     acceptance criteria, constraints, verification steps).
   - `planning/CODEX_READY.md` lists exactly those `status: codex` tasks.
3. **Gate on, violation case (simulated):** before running, hand-edit `style.css` (e.g. add a trailing
   comment) so the working tree is already dirty outside the allow-list, then run `run-claude.ps1`
   manually. Verify: the commit-scope guard logs an `ALERT`, appends a warning block to `STATUS.md`,
   and makes **no commit** — `git status` still shows your hand-edit uncommitted.
   Clean up afterward: `git checkout -- style.css`.
4. **Codex-ready notice, empty case:** with no `status: codex` tasks in `TASKS.md`, run
   `.\tools\Generate-Codex-Notice.ps1` directly. Verify `planning/CODEX_READY.md` contains exactly
   `No Codex-ready tasks right now.`.
5. **n8n:** in the n8n UI, manually execute the digest workflow twice — once with `CODEX_READY.md`
   populated, once with the placeholder. Verify the Codex-ready Telegram message sends only in the
   first case, and the regular digest sends in both.
6. **No stray Codex invocation:**
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
