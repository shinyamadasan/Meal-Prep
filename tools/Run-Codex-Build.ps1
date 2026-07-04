<#
.SYNOPSIS
  /build phase runner: builds the first `status: codex` task(s) in TASKS.md on a dedicated branch by
  invoking Codex CLI unattended.

.DESCRIPTION
  Never touches main. Creates/checks out task-<id> from a clean main (named after the first
  status: codex task found), then invokes:
      codex exec -C <repo root> --sandbox workspace-write "Continue"
  This is a verified, real headless invocation -- confirmed to read AGENTS.md/TASKS.md, follow the AI
  Dev OS, and refuse to act when no status: codex task exists. There is no more "prepare branch and
  ask a human to open Codex" fallback (see docs/DECISIONS.md D-025, superseding D-024's fallback design).

  Before invoking, this script snapshots every TASK-<id> currently status: codex (the "tracked set" --
  plural, because Sprint Execution Mode/D-023 chaining means one invocation can legitimately advance
  more than one task on the same branch; the chaining logic itself lives in AGENTS.md, which Codex
  reads on its own -- this wrapper just checks the outcome across the whole tracked set afterward,
  never assumes exactly one task changed.

  A commit-scope guard (mirroring AGENTS.md's documented Codex ownership, unchanged from before) checks
  every changed file before anything is committed: app code, tests, CHANGELOG.md, TEST_REPORT.md, and
  TASKS.md are allowed; CLAUDE.md/AGENTS.md/docs//planning//captures//tools/ and this repo's own
  automation scripts are not. Any violation halts with no commit/push, same fail-fast contract as
  run-claude.ps1 -- this applies regardless of whether Codex's own exit code was 0 or not.

  If the tracked set reaches status: review, this script automatically invokes
  tools/Run-Claude-Review.ps1 (goal: no separate manual /review step needed after a clean build) and
  folds both results into one reply.

  Writes its final human-readable result to .last-phase-result.txt (gitignored) for
  Dispatch-Commands.ps1 to relay -- this script does not talk to Telegram itself.

.EXAMPLE
  ./tools/Run-Codex-Build.ps1
  ./tools/Run-Codex-Build.ps1 -DryRun
#>
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$root       = Split-Path $PSScriptRoot -Parent
$logFile    = Join-Path $root 'claude-session.log'
$resultFile = Join-Path $root '.last-phase-result.txt'
$tasksFile  = Join-Path $root 'TASKS.md'
$utf8       = New-Object System.Text.UTF8Encoding($false)

# DENY-list (not allow-list): Codex's legitimate surface (app code) is open-ended, so this blocks the
# specific planning/architecture/automation surfaces it must never touch, and allows everything else.
$deniedPatterns = @(
    '^CLAUDE\.md$', '^AGENTS\.md$', '^PLAN\.md$', '^REVIEW\.md$', '^WORKFLOW\.md$',
    '^SELF_REVIEW\.md$', '^QA\.md$', '^PROMPTS\.md$', '^OPERATOR\.md$', '^GUIDE\.md$',
    '^AI-DEV-OS\.md$', '^SYSTEM-OVERVIEW\.md$', '^STATUS\.md$',
    '^docs/', '^planning/', '^captures/', '^library/', '^config/', '^\.claude/',
    '^tools/', '^run-claude\.ps1$', '^setup-.*\.ps1$', '^n8n-.*\.json$'
)

function Write-Result {
    param([string]$Text)
    if (-not $DryRun) { [System.IO.File]::WriteAllText($resultFile, $Text, $utf8) }
    Add-Content -Path $logFile -Value "[Run-Codex-Build] $Text"
    Write-Host $Text
}

function Set-TaskStatus {
    param([string]$TaskId, [string]$NewStatus, [string]$BlockerNote)
    $text = Get-Content $tasksFile -Raw -Encoding UTF8
    $pattern = "(?ms)(^###\s+$TaskId\b.*?^status:)[^\r\n]*"
    $newText = [regex]::Replace($text, $pattern, "`${1} $NewStatus")
    if ($BlockerNote) {
        $newText = [regex]::Replace($newText, "(?ms)(^###\s+$TaskId\b.*?^status:\s*$NewStatus\s*\r?\n)", "`${1}blocker:`n  - $(Get-Date -Format 'yyyy-MM-dd'): $BlockerNote`n")
    }
    if (-not $DryRun) { [System.IO.File]::WriteAllText($tasksFile, $newText, $utf8) }
}

function Get-TaskStatusById {
    param([string]$TaskId)
    $text = Get-Content $tasksFile -Raw -Encoding UTF8
    $m = [regex]::Match($text, "(?ms)^###\s+$TaskId\b.*?^status:\s*(?<s>[\w-]+)")
    if ($m.Success) { $m.Groups['s'].Value } else { $null }
}

function Get-TrackedTasks {
    $text = Get-Content $tasksFile -Raw -Encoding UTF8
    $body = ($text -split '<!-- TASK TEMPLATE')[0]
    $blocks = [regex]::Matches($body, '(?ms)^###\s+(?<id>TASK-\d+)\s*\p{Pd}?\s*[·•]?\s*(?<title>.+?)\r?\n(?<rest>.*?)(?=^###\s|\z)')
    $tracked = @()
    foreach ($b in $blocks) {
        $m = [regex]::Match($b.Groups['rest'].Value, '(?m)^status:\s*(?<s>[\w-]+)')
        if ($m.Success -and $m.Groups['s'].Value -eq 'codex') {
            $tracked += [pscustomobject]@{ Id = $b.Groups['id'].Value; Title = $b.Groups['title'].Value.Trim() }
        }
    }
    $tracked
}

# --- Preflight: main must be clean before branching off it; codex must actually be invokable ---
$branch = git -C $root branch --show-current 2>$null
if ($branch -ne 'main') {
    Write-Result "ABORTED: expected to start from 'main', found '$branch'. Run 'git checkout main' and retry."
    exit 2
}
$dirty = @(git -C $root status --porcelain 2>$null)
if ($dirty.Count -gt 0) {
    Write-Result "ABORTED: main has $($dirty.Count) uncommitted change(s). Commit/stash/clean before building."
    exit 2
}
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    Write-Result "ABORTED: the 'codex' CLI is not available on PATH for this session. Install/authenticate Codex CLI or check the account running this task has it on PATH."
    exit 2
}

# --- Find the tracked set: every status: codex task right now (same FIFO rule Codex's own "Continue"
#     uses to pick where to start; a chained group may advance more than one during one invocation) ---
$tracked = @(Get-TrackedTasks)
if ($tracked.Count -eq 0) {
    Write-Result "Nothing to build -- no TASKS.md entry has status: codex right now."
    exit 0
}
$first = $tracked[0]
$branchName = ($first.Id -replace 'TASK-', 'task-').ToLower()

if ($DryRun) {
    Write-Result "[DRY RUN] would checkout/create $branchName from main and run 'codex exec -C $root --sandbox workspace-write `"Continue`"' to advance $($tracked.Count) tracked task(s) starting at $($first.Id) ($($first.Title))."
    exit 0
}

# --- Branch: create if new, checkout if it already exists (a retried /build after a prior attempt,
#     or a chained group already partway through on this branch) ---
git -C $root rev-parse --verify $branchName 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    git -C $root checkout $branchName | Out-Null
} else {
    git -C $root checkout -b $branchName | Out-Null
}

# --- Invoke Codex CLI, unattended. Captures stdout/stderr/exit code/duration for the log. ---
$stdoutFile = Join-Path $root '.codex-stdout.tmp'
$stderrFile = Join-Path $root '.codex-stderr.tmp'
$startTime = Get-Date
$proc = Start-Process -FilePath 'codex' `
    -ArgumentList @('exec', '-C', $root, '--sandbox', 'workspace-write', 'Continue') `
    -WorkingDirectory $root -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
$duration = (Get-Date) - $startTime
$codexExit = $proc.ExitCode
$stdout = Get-Content $stdoutFile -Raw -ErrorAction SilentlyContinue
$stderr = Get-Content $stderrFile -Raw -ErrorAction SilentlyContinue
Remove-Item $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue

Add-Content -Path $logFile -Value "[Run-Codex-Build] codex exec for $($first.Id) -- exit $codexExit, duration $([int]$duration.TotalSeconds)s"
Add-Content -Path $logFile -Value "[Run-Codex-Build] --- stdout ---`n$stdout"
if ($stderr) { Add-Content -Path $logFile -Value "[Run-Codex-Build] --- stderr ---`n$stderr" }

# --- Commit-scope guard: applies regardless of Codex's exit code -- whatever Codex touched, if it's
#     outside the allowed surface, this halts uncommitted for human inspection, same as always. ---
$changed = @(git -C $root status --porcelain | ForEach-Object { $_.Substring(3).Trim() } | Where-Object { $_ })
$violations = @($changed | Where-Object { $path = $_; ($deniedPatterns | Where-Object { $path -match $_ }) })

if ($violations.Count -gt 0) {
    Write-Result "$($first.Id) build HALTED: touched file(s) outside Codex's allowed surface: $($violations -join ', '). NOT committed/pushed -- inspect $branchName by hand."
    exit 1
}

# --- Failure: Codex CLI itself exited non-zero. Commit whatever safe partial progress exists, mark
#     every tracked task blocked so the next /build doesn't silently retry the same broken task. ---
if ($codexExit -ne 0) {
    if ($changed.Count -gt 0) { git -C $root add -- $changed; git -C $root commit -m "$($first.Id): partial progress before codex exec failure" | Out-Null }
    foreach ($t in $tracked) {
        if ((Get-TaskStatusById $t.Id) -eq 'codex') {
            Set-TaskStatus -TaskId $t.Id -NewStatus 'blocked' -BlockerNote "codex exec exited $codexExit after $([int]$duration.TotalSeconds)s. See claude-session.log for stdout/stderr."
        }
    }
    git -C $root add TASKS.md
    git -C $root diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { git -C $root commit -m "$($first.Id): codex exec failed (exit $codexExit), marked blocked" | Out-Null }
    git -C $root push origin $branchName | Out-Null
    Write-Result "$($first.Id) build FAILED: codex exec exited $codexExit after $([int]$duration.TotalSeconds)s. Marked blocked on $branchName. See claude-session.log."
    exit 1
}

# --- codex exec exited 0. Commit whatever it changed, then classify by re-checking the tracked set. ---
if ($changed.Count -gt 0) {
    git -C $root add -- $changed
    git -C $root commit -m "$($first.Id): codex exec build" | Out-Null
}
git -C $root push origin $branchName | Out-Null

$statuses = $tracked | ForEach-Object { [pscustomobject]@{ Id = $_.Id; Status = (Get-TaskStatusById $_.Id) } }
$anyBlocked = @($statuses | Where-Object { $_.Status -eq 'blocked' })
$anyReview  = @($statuses | Where-Object { $_.Status -eq 'review' })
$noChange   = @($statuses | Where-Object { $_.Status -eq 'codex' })

if ($anyBlocked.Count -gt 0) {
    Write-Result "$($first.Id) build reached BLOCKED ($($anyBlocked.Count) of $($tracked.Count) tracked task(s)) after $([int]$duration.TotalSeconds)s. See the blocker note(s) in TASKS.md on $branchName."
    exit 1
}

if ($anyReview.Count -gt 0) {
    $buildMsg = "$($first.Id) build reached REVIEW ($($anyReview.Count) of $($tracked.Count) tracked task(s)) after $([int]$duration.TotalSeconds)s, pushed to $branchName."
    Write-Result $buildMsg
    # Auto-chain: goal 6 -- no separate manual /review step needed after a clean build.
    Add-Content -Path $logFile -Value "[Run-Codex-Build] auto-chaining into Run-Claude-Review.ps1 for $branchName."
    & (Join-Path $root 'tools\Run-Claude-Review.ps1')
    $reviewResultFile = Join-Path $root '.last-phase-result.txt'
    $reviewMsg = if (Test-Path $reviewResultFile) { $r = Get-Content $reviewResultFile -Raw; Remove-Item $reviewResultFile -Force; $r } else { "Review phase runner exited $LASTEXITCODE with no result -- check claude-session.log." }
    Write-Result "$buildMsg`n`n-> auto-review: $reviewMsg"
    exit 0
}

# codex exec exited 0 but none of the tracked tasks moved off status: codex -- fail loud rather than
# silently reporting success for a run that made no verifiable progress.
foreach ($t in $noChange) {
    Set-TaskStatus -TaskId $t.Id -NewStatus 'blocked' -BlockerNote "codex exec exited 0 after $([int]$duration.TotalSeconds)s but made no tracked progress on this task. See claude-session.log."
}
git -C $root add TASKS.md
git -C $root diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git -C $root commit -m "$($first.Id): codex exec made no tracked progress, marked blocked" | Out-Null; git -C $root push origin $branchName | Out-Null }
Write-Result "$($first.Id) build FAILED: codex exec exited 0 after $([int]$duration.TotalSeconds)s but no tracked task changed status. Marked blocked on $branchName. See claude-session.log."
exit 1
