# Run this ONCE (as Administrator) to register the Telegram-command dispatcher with Windows Task
# Scheduler. After running, it fires every 2 minutes while the PC is on.
# To change the interval: edit -RepetitionInterval below and re-run this script.
#
# Deliberately NOT -WakeToRun, unlike "Meal Prep Claude Overnight": this task should only ever act
# when the PC is already awake. Waking the PC every 2 minutes overnight just to check for a Telegram
# command would defeat the point of letting it sleep -- the twice-daily "Meal Prep Claude Overnight"
# task (which DOES use -WakeToRun) remains the backup path for anything sent while the PC was asleep.

$scriptPath = "C:\Users\Admin\Desktop\Vibe code\Meal prep app\tools\Dispatch-Commands.ps1"
$taskName   = "Meal Prep Command Dispatcher"

# Remove existing task if it exists (so re-running this script is safe)
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$scriptPath`""

# A single "Once" trigger with a repetition interval is Task Scheduler's standard way to express
# "run every N minutes, indefinitely" -- StartBoundary is "now" so it begins immediately.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 2) `
    -RepetitionDuration ([TimeSpan]::MaxValue)

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Polls captures/commands/ for new Telegram control commands (/status /next /go /run /build /review /stop /enable /disable) every 2 minutes and dispatches them. See docs/09-automation.md." `
    -Force

Write-Host ""
Write-Host "Task registered: '$taskName'" -ForegroundColor Green
Write-Host "Runs every 2 minutes while the PC is on (no WakeToRun -- see the file header comment)" -ForegroundColor Green
Write-Host ""
Write-Host "To verify: open Task Scheduler and look for '$taskName'"
Write-Host "To test now: Right-click the task > Run"
Write-Host "Output log: $((Split-Path (Split-Path $scriptPath)))\claude-session.log (shared with run-claude.ps1)"
