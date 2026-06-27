# Autonomous overnight Claude Code session
# Triggered by Windows Task Scheduler at 2am
# Claude reads TASK.md (the single active task), implements it, commits and pushes directly to main

$projectPath = "C:\Users\Admin\Desktop\Vibe code\Meal prep app"
$logFile = "$projectPath\claude-session.log"

Set-Location $projectPath

# Use Claude Pro subscription instead of API key (temporary — only affects this session)
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $logFile -Value ""
Add-Content -Path $logFile -Value "=== Session started: $timestamp ==="

$prompt = @'
You are running in autonomous mode. No human is available. Follow WORKFLOW.md. There is no "session
end": when you stop, perform a Checkpoint first.

Read CLAUDE.md, STATUS.md, and planning/TASK.md first. SINGLE RESPONSIBILITY — do not cross lanes:
Triage only routes; the Builder only builds. The Builder builds ONLY from planning/BUILD_QUEUE.md
(human-approved). NEVER build from captures/inbox/, planning/PROPOSALS.md, or planning/ROADMAP.md.
Never touch the ROADMAP "Do Not Work On" section. Do not delete files (archiving captures is a git mv).

STEP A — TRIAGE (route + enrich only; NEVER build, schedule, or prioritize-for-build): for each
captures/inbox/*.md with `status: new` (SKIP any already `status: triaged`), process per WORKFLOW.md
"Triage": categorize, dedupe vs PROPOSALS/ROADMAP/DONE, then ENRICH into the proposal contract in
planning/PROPOSALS.md (status: pending) — fill EVERY field. LEAD with **▶ Decision** (the recommended
next action: Approve | Park | Reject | Clarify + a one-line why) so it's actionable from a phone digest.
Then: goal alignment vs the **Current Objective** in ROADMAP.md (supports/conflicts/mixed + which
North-star goal), expected user value, evidence (recurring friction · dup count · demand signal), effort
+ dependencies + confidence + ambiguity, why now vs later, and a **goal-adjusted** AI-recommended
priority (P0..P3 — not raw priority; down-weight work that doesn't serve the Current Objective).
Archive each capture to captures/processed/YYYY/MM/<id>.md,
mark the inbox file `status: triaged`, and append a one-line triage summary to STATUS.md. Commit.
Do NOT write to ROADMAP.md or BUILD_QUEUE.md, and do NOT build.

STEP B — BUILD (approved work only): if planning/TASK.md is "NO ACTIVE TASK", promote the top item of
planning/BUILD_QUEUE.md into it. If BUILD_QUEUE.md is empty, write "No tasks remaining" to STATUS.md
and stop (do not shut down the PC; do not invent, plan, prioritize, or build unapproved work).

STEP C — loop over the active task:
1. RESUME: read planning/TASK.md "Current Step" and continue. Read only routed docs.
2. Ensure you are on main (git checkout main && git pull origin main).
3. EXECUTION: implement in app.js / index.html / style.css; keep "Current Step" current.
4. Decide the outcome:
   - COMPLETED (all Success Criteria verified): FIRST run SELF_REVIEW.md (code health + "would I ship
     this?") and fix/simplify; then tick criteria in TASK.md; update reference docs
     (docs/FEATURES|DATA_MODEL|ARCHITECTURE|DECISIONS as applicable); append to planning/DONE.md; update
     STATUS.md; RUN THE QA GATE in QA.md — every AI check must pass (any failure → BLOCKED: record it,
     do NOT commit); then COMMIT code+docs together and push; then remove the finished item from
     planning/BUILD_QUEUE.md and promote the next BUILD_QUEUE item into TASK.md. Continue.
   - PARTIAL (near context/token limit mid-task): CHECKPOINT — write the precise next action into
     TASK.md "Current Step" and an in-progress entry at the TOP of STATUS.md; make a `wip:` commit
     and push; then STOP. Do NOT mark Done.
   - BLOCKED (ambiguous / missing input / failing gate): record the blocker in TASK.md (Blocker) and
     STATUS.md; remove it from BUILD_QUEUE.md (note why); promote the next BUILD_QUEUE item; continue.
     Queue empty → STOP.
5. Stop when BUILD_QUEUE.md is empty / TASK.md is NO ACTIVE TASK, or you are near your context limit
   (Checkpoint first).
'@

claude -p $prompt `
    --allowedTools "Edit" "Write" "Read" "Glob" "Grep" "Bash(git checkout main)" "Bash(git add *)" "Bash(git mv *)" "Bash(git commit *)" "Bash(git push origin main)" "Bash(git status)" "Bash(git diff *)" "Bash(git log *)" `
    | Tee-Object -FilePath $logFile -Append

$endTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $logFile -Value "=== Session ended: $endTime ==="

# Only shut down after the 6pm run, and only if tasks were actually completed
# Claude writes "No tasks remaining" to the log if queue was empty — skip shutdown in that case
$hour = (Get-Date).Hour
$logContent = Get-Content -Path $logFile -Raw -ErrorAction SilentlyContinue
if ($hour -lt 6 -and $logContent -notlike "*No tasks remaining*") {
    Add-Content -Path $logFile -Value "=== Shutting down PC in 60 seconds ==="
    shutdown /s /t 60
}
