# Overnight automation launcher.
# Triggered by Windows Task Scheduler ("Meal Prep Claude Overnight", 9PM / 2AM).
# Gated behind $AUTOMATION_ENABLED below -- disabled by default.
#
# Claude's job here is PLANNING ONLY: Triage (captures/inbox -> PROPOSALS.md) and converting approved
# planning/BUILD_QUEUE.md items into PLAN.md + TASKS.md (status: codex). It NEVER touches
# app.js / index.html / style.css and NEVER invokes Codex -- that split is enforced two ways:
#   1. The Claude session's --allowedTools has no git commit/push -- it literally cannot ship anything.
#   2. This script commits Claude's output itself, but only after checking every changed path against
#      an explicit allow-list (Phase 2b below). Anything outside that list halts the run uncommitted.
# See docs/09-automation.md for the full design, enable/disable instructions, and rollback plan.

$AUTOMATION_ENABLED = $false   # flip to $true to re-enable overnight automation

$projectPath = "C:\Users\Admin\Desktop\Vibe code\Meal prep app"
$logFile = "$projectPath\claude-session.log"

Set-Location $projectPath

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $logFile -Value ""
Add-Content -Path $logFile -Value "=== Session started: $timestamp ==="

if (-not $AUTOMATION_ENABLED) {
    Add-Content -Path $logFile -Value "Automation disabled (`$AUTOMATION_ENABLED = `$false in run-claude.ps1) -- exiting without touching the repo."
    Add-Content -Path $logFile -Value "=== Session ended: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') (disabled) ==="
    exit 0
}

# Use Claude Pro subscription instead of API key (temporary -- only affects this session)
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue

$prompt = @'
You are running in autonomous mode. No human is available. Follow WORKFLOW.md for the Triage event.
This run is scoped to two bounded steps below -- you should not need a Checkpoint, but if you must
stop mid-step, write the precise resume point to STATUS.md first.

Read CLAUDE.md, STATUS.md, PLAN.md, and TASKS.md first.

YOUR ROLE THIS RUN IS PLANNING ONLY -- you are acting as Claude (PM / Tech Lead / Architect), never as
Codex (the Implementer). You must NEVER edit app.js, index.html, or style.css in this session, and you
must NEVER invoke Codex or any other build agent. Committing and pushing is handled by the calling
script, not by you -- do not attempt `git commit` or `git push` (that tool is not available to you this
run). Do not touch the ROADMAP "Do Not Work On" section. Do not delete files (archiving captures is a
git mv).

STEP A -- TRIAGE (route + enrich only; never build, schedule, or prioritize-for-build): for each
captures/inbox/*.md with `status: new` (SKIP any already `status: triaged`), process per WORKFLOW.md
"Triage": categorize, dedupe vs PROPOSALS/ROADMAP/DONE, then ENRICH into the proposal contract in
planning/PROPOSALS.md (status: pending) -- fill EVERY field. LEAD with **> Decision** (the recommended
next action: Approve | Park | Reject | Clarify + a one-line why) so it's actionable from a phone digest.
Then: goal alignment vs the **Current Objective** in ROADMAP.md (supports/conflicts/mixed + which
North-star goal), expected user value, evidence (recurring friction, dup count, demand signal), effort
+ dependencies + confidence + ambiguity, why now vs later, and a **goal-adjusted** AI-recommended
priority (P0..P3 -- not raw priority; down-weight work that doesn't serve the Current Objective).
Archive each capture to captures/processed/YYYY/MM/<id>.md, mark the inbox file `status: triaged`, and
append a one-line triage summary to STATUS.md. Do NOT write to ROADMAP.md or BUILD_QUEUE.md.

STEP B -- PLAN CONVERSION (approved work only, into TASKS.md -- never build it): for each item in
planning/BUILD_QUEUE.md that does NOT yet have a corresponding `source: BQ-<id>` entry in TASKS.md,
convert it into one or more atomic, independently testable tasks exactly as the interactive "Plan"
command does (see CLAUDE.md's Tech Lead section and Definition of Ready): each new TASKS.md entry needs
objective, owner: codex, status: codex, files, acceptance criteria, constraints, and verification/test
steps -- Codex must never have to infer missing requirements. Update PLAN.md's Goal/Approach/Scope/
Source/Status to describe the current milestone if this batch changes it. Skip any BUILD_QUEUE item
already reflected in TASKS.md (do not create duplicates), and skip any item whose build note says
deferred (leave those for a human decision). Do not change the `status` field of any EXISTING TASKS.md
entry -- in this step you only ever add new entries. If BUILD_QUEUE.md is empty or everything in it is
already reflected in TASKS.md, do nothing for this step.

Stop after STEP A and STEP B -- there is no STEP C. You are done for this run once both steps are
addressed (either acted on, or confirmed there was nothing to do).
'@

# --- Phase 1 (deterministic, pre-plan): apply approval replies into BUILD_QUEUE, if any ---
try { & "$projectPath\tools\Apply-Decisions.ps1" | Tee-Object -FilePath $logFile -Append }
catch { Add-Content -Path $logFile -Value "Apply-Decisions error: $_" }
git add planning/PROPOSALS.md planning/BUILD_QUEUE.md captures/decisions
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m "decisions: apply approval replies -> BUILD_QUEUE" | Out-Null
    git push origin main | Out-Null
}

# --- Phase 2: Claude session -- TRIAGE + PLAN CONVERSION ONLY. No commit/push tool available to it. ---
claude -p $prompt `
    --allowedTools "Read" "Glob" "Grep" "Edit" "Write" "Bash(git status)" "Bash(git diff *)" "Bash(git log *)" `
    | Tee-Object -FilePath $logFile -Append

# --- Phase 2b (deterministic): commit-scope guard. The Claude session above cannot commit or push
#     itself; this script is the only thing that ever commits its output, and only after checking
#     every changed path against the allow-list below. Anything outside it halts uncommitted. ---
$allowedPatterns = @(
    '^PLAN\.md$', '^TASKS\.md$', '^STATUS\.md$',
    '^planning/BUILD_QUEUE\.md$', '^planning/PROPOSALS\.md$', '^planning/DIGEST\.md$', '^planning/CODEX_READY\.md$',
    '^captures/'
)
$changed = @(git status --porcelain | ForEach-Object { $_.Substring(3).Trim() } | Where-Object { $_ })
$violations = @($changed | Where-Object { $path = $_; -not ($allowedPatterns | Where-Object { $path -match $_ }) })

if ($violations.Count -gt 0) {
    $msg = "ALERT: Claude session touched file(s) outside the allowed planning surface: $($violations -join ', '). NOT committing or pushing -- working tree left as-is for human review."
    Add-Content -Path $logFile -Value $msg
    $statusEntry = @"

## $(Get-Date -Format 'yyyy-MM-dd HH:mm') -- AUTOMATION HALTED: out-of-scope file change detected
$msg
Investigate before the next scheduled run. Nothing was committed or pushed.
"@
    Add-Content -Path "$projectPath\STATUS.md" -Value $statusEntry
} elseif ($changed.Count -gt 0) {
    git add -- $changed
    git commit -m "plan: triage + BUILD_QUEUE -> PLAN/TASKS (automated)" | Out-Null
    git push origin main | Out-Null
} else {
    Add-Content -Path $logFile -Value "No planning changes this run."
}

# --- Phase 3 (deterministic, post-run): refresh the proposals digest + Codex-ready notice for n8n's
#     next morning send ---
try { & "$projectPath\tools\Generate-Digest.ps1" | Out-Null } catch { Add-Content -Path $logFile -Value "Generate-Digest error: $_" }
try { & "$projectPath\tools\Generate-Codex-Notice.ps1" | Out-Null } catch { Add-Content -Path $logFile -Value "Generate-Codex-Notice error: $_" }
git add planning/DIGEST.md planning/CODEX_READY.md
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m "digest: refresh proposals digest + codex-ready notice" | Out-Null
    git push origin main | Out-Null
}

$endTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $logFile -Value "=== Session ended: $endTime ==="

# Only shut down after the 2AM run, only if the guard didn't halt the run, and only if there was
# actually planning work to commit (an idle run -- nothing in inbox, nothing new in BUILD_QUEUE --
# leaves $changed empty, so there's no reason to force a shutdown).
$hour = (Get-Date).Hour
if ($hour -lt 6 -and $violations.Count -eq 0 -and $changed.Count -gt 0) {
    Add-Content -Path $logFile -Value "=== Shutting down PC in 60 seconds ==="
    shutdown /s /t 60
}
