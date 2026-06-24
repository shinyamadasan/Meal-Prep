# Autonomous overnight Claude Code session
# Triggered by Windows Task Scheduler at 2am
# Claude reads ROADMAP.md, implements the current task, commits and pushes directly to main

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

Read ROADMAP.md, STATUS.md, and CLAUDE.md first.

Rules - follow exactly:
- Work through tasks one by one, top to bottom
- Do not touch anything in the "Do Not Work On" section
- If a task is ambiguous or you hit a blocker, log it in STATUS.md and skip to the next task
- Do not delete any files
- Keep going until the Task Queue is empty or you are close to your context limit.

If the Task Queue is empty and there is no Current Task, write "No tasks remaining" to STATUS.md and stop — do not shut down the PC.

For EACH task:
1. Read the Current Task and its Success Criteria from ROADMAP.md
2. Make sure you are on main branch (git checkout main && git pull origin main)
3. Implement the task in app.js and/or index.html
4. Verify each Success Criterion by inspecting the code logic
5. Commit directly to main with a clear message
6. Push to main (git push origin main)
7. Move the completed task to the Done section in ROADMAP.md
8. Pull the next item from the Task Queue into Current Task in ROADMAP.md
9. Append a new entry at the TOP of STATUS.md: date, task, what changed, files, next task
10. Continue to the next task
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
