<#
.SYNOPSIS
  /build phase runner: builds the first `status: codex` task in TASKS.md on its own branch.

.DESCRIPTION
  Never touches main. Creates/checks out task-<id> from a clean main, then either:
    - invokes Codex headlessly, IF $env:CODEX_CLI_COMMAND is explicitly configured (this script never
      guesses at a codex CLI's flags -- it only runs a command you have explicitly set yourself), or
    - falls back to "prepared, notify" mode: stages the branch, marks the task in-progress, pushes the
      branch, and tells you to run Codex yourself. This is the only mode available today -- there is
      no codex CLI on this machine's PATH and no confirmed headless invocation syntax (see the
      Telegram-control design in docs/09-automation.md for why).

  Either way, a commit-scope guard (mirroring AGENTS.md's documented Codex ownership) checks every
  changed file before anything is committed: app code, tests, CHANGELOG.md, TEST_REPORT.md, and
  TASKS.md are allowed; CLAUDE.md/AGENTS.md/docs//planning//captures//tools/ and this repo's own
  automation scripts are not. Any violation halts with no commit/push, same fail-fast contract as
  run-claude.ps1.

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
    $replacement = "`${1} $NewStatus"
    $newText = [regex]::Replace($text, $pattern, $replacement)
    if ($BlockerNote) {
        $newText = [regex]::Replace($newText, "(?ms)(^###\s+$TaskId\b.*?^status:\s*$NewStatus\s*\r?\n)", "`${1}blocker:`n  - $(Get-Date -Format 'yyyy-MM-dd'): $BlockerNote`n")
    }
    if (-not $DryRun) { [System.IO.File]::WriteAllText($tasksFile, $newText, $utf8) }
}

# --- Preflight: main must be clean before branching off it ---
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

# --- Find the first status: codex task (same FIFO rule Codex's own "Continue" uses) ---
$text = Get-Content $tasksFile -Raw -Encoding UTF8
$body = ($text -split '<!-- TASK TEMPLATE')[0]
$blocks = [regex]::Matches($body, '(?ms)^###\s+(?<id>TASK-\d+)\s*\p{Pd}?\s*[·•]?\s*(?<title>.+?)\r?\n(?<rest>.*?)(?=^###\s|\z)')
$target = $null
foreach ($b in $blocks) {
    $m = [regex]::Match($b.Groups['rest'].Value, '(?m)^status:\s*(?<s>[\w-]+)')
    if ($m.Success -and $m.Groups['s'].Value -eq 'codex') { $target = $b; break }
}
if (-not $target) {
    Write-Result "Nothing to build -- no TASKS.md entry has status: codex right now."
    exit 0
}
$taskId = $target.Groups['id'].Value
$title  = $target.Groups['title'].Value.Trim()
$branchName = ($taskId -replace 'TASK-', 'task-').ToLower()

if ($DryRun) {
    Write-Result "[DRY RUN] would checkout/create $branchName from main and attempt to build $taskId ($title)."
    exit 0
}

# --- Branch: create if new, checkout if it already exists (a retried /build after a prior attempt) ---
git -C $root rev-parse --verify $branchName 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    git -C $root checkout $branchName | Out-Null
} else {
    git -C $root checkout -b $branchName | Out-Null
}

# --- Headless Codex, only if explicitly configured -- never guessed at ---
$codexCmd = $env:CODEX_CLI_COMMAND
# DENY-list (not allow-list): Codex's legitimate surface (app code) is open-ended, so this blocks the
# specific planning/architecture/automation surfaces it must never touch, and allows everything else.
$deniedPatterns = @(
    '^CLAUDE\.md$', '^AGENTS\.md$', '^PLAN\.md$', '^REVIEW\.md$', '^WORKFLOW\.md$',
    '^SELF_REVIEW\.md$', '^QA\.md$', '^PROMPTS\.md$', '^OPERATOR\.md$', '^GUIDE\.md$',
    '^AI-DEV-OS\.md$', '^SYSTEM-OVERVIEW\.md$', '^STATUS\.md$',
    '^docs/', '^planning/', '^captures/', '^library/', '^config/', '^\.claude/',
    '^tools/', '^run-claude\.ps1$', '^setup-.*\.ps1$', '^n8n-.*\.json$'
)

if ($codexCmd) {
    Add-Content -Path $logFile -Value "[Run-Codex-Build] Invoking configured CODEX_CLI_COMMAND for $taskId."
    try { Invoke-Expression $codexCmd 2>&1 | Tee-Object -FilePath $logFile -Append | Out-Null; $codexExit = $LASTEXITCODE }
    catch { $codexExit = 1; Add-Content -Path $logFile -Value "[Run-Codex-Build] CODEX_CLI_COMMAND threw: $_" }

    $changed = @(git -C $root status --porcelain | ForEach-Object { $_.Substring(3).Trim() } | Where-Object { $_ })
    $violations = @($changed | Where-Object { $path = $_; ($deniedPatterns | Where-Object { $path -match $_ }) })

    if ($codexExit -ne 0) {
        Set-TaskStatus -TaskId $taskId -NewStatus 'blocked' -BlockerNote "Headless Codex invocation exited $codexExit. See claude-session.log."
        git -C $root add TASKS.md; git -C $root commit -m "${taskId}: headless build failed, marked blocked" | Out-Null
        git -C $root push origin $branchName | Out-Null
        Write-Result "$taskId build FAILED (headless Codex exited $codexExit). Marked blocked on $branchName. See claude-session.log."
        exit 1
    }
    if ($violations.Count -gt 0) {
        Write-Result "$taskId build HALTED: touched file(s) outside Codex's allowed surface: $($violations -join ', '). NOT committed/pushed -- inspect $branchName by hand."
        exit 1
    }
    if ($changed.Count -gt 0) {
        git -C $root add -- $changed
        git -C $root commit -m "${taskId}: headless Codex build" | Out-Null
    }
    Set-TaskStatus -TaskId $taskId -NewStatus 'review'
    git -C $root add TASKS.md
    git -C $root diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { git -C $root commit -m "${taskId}: status -> review" | Out-Null }
    git -C $root push origin $branchName | Out-Null
    Write-Result "$taskId built and pushed to $branchName. Awaiting /review."
    exit 0
}

# --- Fallback: no headless Codex configured. Stage the branch, mark in-progress, notify. ---
Set-TaskStatus -TaskId $taskId -NewStatus 'in-progress'
git -C $root add TASKS.md
git -C $root diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git -C $root commit -m "${taskId}: status -> in-progress (branch staged via /build)" | Out-Null }
git -C $root push origin $branchName | Out-Null
Write-Result "$taskId branch '$branchName' prepared and pushed. Codex has no headless mode configured on this machine -- open Codex yourself and say `"Continue`" when you're back at the PC."
exit 0
