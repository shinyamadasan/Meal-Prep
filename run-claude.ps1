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
You are running in autonomous mode. No human is available. Follow WORKFLOW.md — the task-driven
lifecycle. There is no "session end": when you stop, you perform a Checkpoint first.

Read CLAUDE.md, STATUS.md, and TASK.md first. CLAUDE.md routes you to any other docs. TASK.md is the
single active task — it is what you work on. Do NOT pick tasks from ROADMAP.md yourself; a human
already promoted today's task. Never touch the ROADMAP "Do Not Work On" section. Do not delete files.

If TASK.md is "NO ACTIVE TASK": write "No tasks remaining" to STATUS.md and stop (do not shut down
the PC, do not invent or plan work).

Otherwise loop over the active task:
1. RESUME: read TASK.md "Current Step" and continue from there (don't restart). Read only routed docs.
2. Ensure you are on main (git checkout main && git pull origin main).
3. EXECUTION: implement in app.js / index.html / style.css; keep TASK.md "Current Step" current.
4. Decide the outcome:
   - COMPLETED (all Success Criteria verified): tick criteria in TASK.md; update reference docs
     (FEATURES/DATA_MODEL/ARCHITECTURE/DECISIONS as applicable) AND STATUS.md; COMMIT code+docs
     together and push (git push origin main); then NEXT TASK SELECTION — promote the top ROADMAP
     Task Queue item into TASK.md (FIFO) and move the finished task to ROADMAP Done. Continue.
   - PARTIAL (near context/token limit mid-task): CHECKPOINT — write the precise next action into
     TASK.md "Current Step" and an in-progress entry at the TOP of STATUS.md; make a `wip:` commit
     and push; then STOP. Do NOT mark Done or advance ROADMAP.
   - BLOCKED (ambiguous / missing input / failing gate): record the blocker in TASK.md (Blocker) and
     STATUS.md; move the task to ROADMAP "Blocked"; promote the next queue item into TASK.md and
     continue. If the queue is empty, STOP.
5. Stop when TASK.md is NO ACTIVE TASK or you are near your context limit (Checkpoint first).
'@

claude -p $prompt `
    --allowedTools "Edit" "Write" "Read" "Glob" "Grep" "Bash(git checkout main)" "Bash(git add *)" "Bash(git commit *)" "Bash(git push origin main)" "Bash(git status)" "Bash(git diff *)" "Bash(git log *)" `
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
