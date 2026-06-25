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
You are running in autonomous overnight mode. No human is available to answer questions.

Read CLAUDE.md, STATUS.md, and TASK.md first. CLAUDE.md routes you to any other docs you need.
TASK.md is the single active task — it is what you work on. Do NOT pick tasks from ROADMAP.md
yourself; a human already promoted today's task into TASK.md.

If TASK.md status is "NO ACTIVE TASK", write "No tasks remaining" to STATUS.md and stop — do not
shut down the PC, do not invent work.

Rules - follow exactly:
- Work ONLY the task in TASK.md. Do not touch anything in the ROADMAP "Do Not Work On" section.
- If the task is ambiguous or you hit a blocker, log it in STATUS.md and stop.
- Do not delete any files.
- Keep going until TASK.md is NO ACTIVE TASK or you are close to your context limit.

Loop, for the active task in TASK.md:
1. Read TASK.md (objective, current step, success criteria). Read only the docs CLAUDE.md routes you to.
2. Make sure you are on main (git checkout main && git pull origin main).
3. Implement the task in app.js and/or index.html and/or style.css.
4. Verify each Success Criterion by inspecting the code logic; update TASK.md "Current Step" as you go.
5. Commit directly to main with a clear message, then push (git push origin main).
6. Update the relevant docs per CLAUDE.md's update protocol (FEATURES/DATA_MODEL/DECISIONS as applicable).
7. Append a new entry at the TOP of STATUS.md: date, task, what changed, files, next task.
8. Promote the next item from ROADMAP.md "Task Queue" into TASK.md (mechanical FIFO — top of queue).
   If the queue is empty, set TASK.md to NO ACTIVE TASK and stop.
9. Continue with the now-active task.
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
