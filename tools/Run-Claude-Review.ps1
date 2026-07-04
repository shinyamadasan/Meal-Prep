<#
.SYNOPSIS
  /review phase runner: runs Claude's review against the first `status: review` task's branch.

.DESCRIPTION
  Checks out task-<id>, invokes Claude non-interactively to do exactly what the interactive "Review"
  command already documents in CLAUDE.md (read the branch diff, CHANGELOG.md, TEST_REPORT.md,
  acceptance criteria; write REVIEW.md; set TASKS.md status to done or back to codex/rework) --
  never touching app code, never merging, never pushing main. A commit-scope guard (same fail-fast
  mechanism as run-claude.ps1's) allows only REVIEW.md and TASKS.md; anything else halts with no
  commit/push.

  Writes its final human-readable result to .last-phase-result.txt (gitignored) for
  Dispatch-Commands.ps1 to relay.

.EXAMPLE
  ./tools/Run-Claude-Review.ps1
  ./tools/Run-Claude-Review.ps1 -DryRun
#>
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$root       = Split-Path $PSScriptRoot -Parent
$logFile    = Join-Path $root 'claude-session.log'
$resultFile = Join-Path $root '.last-phase-result.txt'
$tasksFile  = Join-Path $root 'TASKS.md'
$utf8       = New-Object System.Text.UTF8Encoding($false)

function Write-Result {
    param([string]$Text)
    if (-not $DryRun) { [System.IO.File]::WriteAllText($resultFile, $Text, $utf8) }
    Add-Content -Path $logFile -Value "[Run-Claude-Review] $Text"
    Write-Host $Text
}

function Get-TaskStatus {
    param([string]$TaskId)
    $text = Get-Content $tasksFile -Raw -Encoding UTF8
    $m = [regex]::Match($text, "(?ms)^###\s+$TaskId\b.*?^status:\s*(?<s>[\w-]+)")
    if ($m.Success) { $m.Groups['s'].Value } else { $null }
}

# --- Find the first status: review task ---
$text = Get-Content $tasksFile -Raw -Encoding UTF8
$body = ($text -split '<!-- TASK TEMPLATE')[0]
$blocks = [regex]::Matches($body, '(?ms)^###\s+(?<id>TASK-\d+)\s*\p{Pd}?\s*[·•]?\s*(?<title>.+?)\r?\n(?<rest>.*?)(?=^###\s|\z)')
$target = $null
foreach ($b in $blocks) {
    $m = [regex]::Match($b.Groups['rest'].Value, '(?m)^status:\s*(?<s>[\w-]+)')
    if ($m.Success -and $m.Groups['s'].Value -eq 'review') { $target = $b; break }
}
if (-not $target) {
    Write-Result "Nothing to review -- no TASKS.md entry has status: review right now."
    exit 0
}
$taskId = $target.Groups['id'].Value
$title  = $target.Groups['title'].Value.Trim()
$branchName = ($taskId -replace 'TASK-', 'task-').ToLower()

if ($DryRun) {
    Write-Result "[DRY RUN] would checkout $branchName and review $taskId ($title)."
    exit 0
}

# --- Preflight: the task branch must exist and be clean before Claude reviews it ---
git -C $root rev-parse --verify $branchName 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Result "ABORTED: branch '$branchName' for $taskId does not exist. Nothing to review."
    exit 2
}
git -C $root checkout $branchName | Out-Null
$dirty = @(git -C $root status --porcelain 2>$null)
if ($dirty.Count -gt 0) {
    Write-Result "ABORTED: $branchName has $($dirty.Count) uncommitted change(s). Commit/stash/clean before reviewing."
    exit 2
}

$prompt = @"
You are running in autonomous mode. No human is available. Follow CLAUDE.md's Reviewer role exactly
as the interactive "Review" command already documents.

Review task $taskId ($title) on the current branch ($branchName). Read the branch diff against main,
CHANGELOG.md, TEST_REPORT.md, and $taskId's acceptance criteria in TASKS.md.

You may ONLY write to REVIEW.md and TASKS.md (only $taskId's status field) -- do not touch app.js,
index.html, style.css, tests, or any other file. Do not attempt git commit or git push (not
available to you this run).

Write a REVIEW.md entry: verdict (APPROVED or REWORK), must-fix items if any, nits if any. Then set
$taskId's status in TASKS.md: `done` if approved, back to `codex` if rework is needed. Never rubber-stamp.
"@

claude -p $prompt `
    --allowedTools "Read" "Glob" "Grep" "Edit" "Write" "Bash(git status)" "Bash(git diff *)" "Bash(git log *)" `
    | Tee-Object -FilePath $logFile -Append
if ($LASTEXITCODE -ne 0) {
    # Deliberately do NOT checkout main -- Claude's session may have left partial, uncommitted edits;
    # leave $branchName exactly as it is for inspection rather than risk carrying stray changes onto main.
    Write-Result "$taskId review FAILED: claude -p exited with code $LASTEXITCODE. See claude-session.log."
    exit 1
}

# --- Commit-scope guard: ONLY REVIEW.md and TASKS.md allowed ---
$allowedPatterns = @('^REVIEW\.md$', '^TASKS\.md$')
$changed = @(git -C $root status --porcelain | ForEach-Object { $_.Substring(3).Trim() } | Where-Object { $_ })
$violations = @($changed | Where-Object { $path = $_; -not ($allowedPatterns | Where-Object { $path -match $_ }) })

if ($violations.Count -gt 0) {
    # Same reasoning as above -- leave the dirty tree on $branchName for a human, never auto-switch.
    Write-Result "$taskId review HALTED: touched file(s) outside the review surface: $($violations -join ', '). NOT committed/pushed -- inspect $branchName by hand."
    exit 1
}
if ($changed.Count -eq 0) {
    # Nothing changed at all -- tree is clean, safe to return to main.
    git -C $root checkout main | Out-Null
    Write-Result "$taskId review produced no changes -- investigate; a real review should at least update REVIEW.md."
    exit 1
}

git -C $root add -- $changed
git -C $root commit -m "${taskId}: Claude review" | Out-Null
git -C $root push origin $branchName | Out-Null
git -C $root checkout main | Out-Null

$newStatus = Get-TaskStatus -TaskId $taskId
if ($newStatus -eq 'done') {
    Write-Result "$taskId APPROVED. Merge $branchName into main when you're ready."
} elseif ($newStatus -eq 'codex') {
    Write-Result "$taskId needs REWORK -- see REVIEW.md on $branchName for must-fix items."
} else {
    Write-Result "$taskId reviewed (status now '$newStatus') -- pushed to $branchName. Check REVIEW.md for detail."
}
exit 0
