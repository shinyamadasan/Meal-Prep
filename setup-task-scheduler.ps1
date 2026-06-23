# Run this ONCE to register the overnight Claude session with Windows Task Scheduler
# After running, the task fires automatically at 2am every night
# To change the time: edit the -At parameter below and re-run this script

$scriptPath = "C:\Users\Admin\Desktop\Vibe code\Meal prep app\run-claude.ps1"
$taskName = "Meal Prep Claude Overnight"

# Remove existing task if it exists (so re-running this script is safe)
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$scriptPath`""

# Two daily runs — 2pm and 6pm
# 2pm: Claude works through task queue, PC stays on
# 6pm: Claude continues where it left off, PC shuts down after
$trigger1 = New-ScheduledTaskTrigger -Daily -At "2:00PM"
$trigger2 = New-ScheduledTaskTrigger -Daily -At "7:00PM"
$trigger = @($trigger1, $trigger2)

$settings = New-ScheduledTaskSettingsSet `
    -WakeToRun `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Runs Claude Code autonomously on the Meal Prep app. Reads ROADMAP.md and implements the current task." `
    -Force

Write-Host ""
Write-Host "Task registered: '$taskName'" -ForegroundColor Green
Write-Host "Runs at: 2:00 PM and 7:00 PM daily" -ForegroundColor Green
Write-Host "WakeToRun: ON (PC will wake from sleep to run)" -ForegroundColor Green
Write-Host ""
Write-Host "To verify: open Task Scheduler and look for '$taskName'"
Write-Host "To test now: Right-click the task > Run"
Write-Host "Output log: $((Split-Path $scriptPath))\claude-session.log"
