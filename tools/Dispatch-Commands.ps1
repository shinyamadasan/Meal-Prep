<#
.SYNOPSIS
  Remote-control dispatcher. Reads captures/commands/*.md (status: new), routes each to its phase
  runner, writes exactly one reply per command to captures/replies/.

.DESCRIPTION
  Recognizes: /status /next /go /run /build /review /stop /enable /disable
  /go is the everyday command: it does whatever /next recommends (run planning, build, or review).
  /run /build /review still work directly as manual overrides, to force a specific phase out of order.
  See captures/commands/README.md for the command-file contract and docs/09-automation.md for the
  full design.

  Lock-protected (automation.lock, gitignored) so this can never overlap itself, an interactively
  triggered phase runner, or the twice-daily run-claude.ps1 -- all three share the same lock file.
  A lock older than 2 hours (this repo's Task Scheduler execution-time limit) is treated as stale
  and cleared rather than blocking forever on a crashed run.

  Every command is idempotent: /build and /review check the current task status before acting;
  /enable, /disable, /stop just set a flag to a value; /status and /next are pure reads.

  Replies accumulate in captures/replies/OUTBOX.md (append-only, same idiom as DIGEST.md /
  CODEX_READY.md) rather than one file per command -- n8n's short-interval relay
  (n8n-telegram-replies.json) fetches it, sends it if it has real content, then clears it back to the
  placeholder via a GitHub PUT. This means a burst of several commands between poll cycles arrives as
  one combined Telegram message, not a flood of separate ones.

.EXAMPLE
  ./tools/Dispatch-Commands.ps1              # process all new commands for real
  ./tools/Dispatch-Commands.ps1 -DryRun      # show what each would do, mutate nothing
#>
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$root         = Split-Path $PSScriptRoot -Parent
$cmdDir       = Join-Path $root 'captures/commands'
$replyDir     = Join-Path $root 'captures/replies'
$outboxFile   = Join-Path $replyDir 'OUTBOX.md'
$lockFile     = Join-Path $root 'automation.lock'
$tasksFile    = Join-Path $root 'TASKS.md'
$runClaude    = Join-Path $root 'run-claude.ps1'
$utf8         = New-Object System.Text.UTF8Encoding($false)
$NO_REPLIES   = 'No pending replies.'

# Under $ErrorActionPreference = 'Stop', ANY stderr text from a native command -- even a benign
# warning like git's LF-will-be-replaced-by-CRLF notice, on a call that otherwise succeeds -- gets
# promoted to a terminating exception, regardless of whether stderr is redirected to $null. This
# showed up twice in live testing on different git calls (rev-parse --verify, then add), so every
# git invocation is routed through here rather than patched one call site at a time: EAP is lowered
# to 'Continue' only for the duration of the native call, which stops the promotion, while
# $LASTEXITCODE still reflects git's real exit code exactly as before.
function Invoke-Git {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & git @args 2>$null }
    finally { $ErrorActionPreference = $prevEAP }
}

function Write-Reply {
    param([string]$Id, [string]$Text)
    if ($DryRun) { Write-Host "[DRY RUN] would append to OUTBOX.md:`n$Text"; return }
    $existing = if (Test-Path $outboxFile) { (Get-Content $outboxFile -Raw -Encoding UTF8).Trim() } else { '' }
    $entry = "## $Id`n$(Get-Date -Format o)`n`n$Text"
    $newContent = if ($existing -eq '' -or $existing -eq $NO_REPLIES) { $entry } else { "$existing`n`n---`n`n$entry" }
    [System.IO.File]::WriteAllText($outboxFile, $newContent + "`n", $utf8)
}

function Get-Branch { (Invoke-Git -C $root branch --show-current) }
function Get-DirtyCount { @(Invoke-Git -C $root status --porcelain).Count }

# $AUTOMATION_ENABLED is the one master flag for everything that mutates the repo unattended OR
# on remote command -- /status, /next, /enable, /disable, and /stop always work regardless of it
# (you need to be able to inspect and flip the switch even while it's off), but /run, /build,
# /review, and /go all refuse to act while it's false, exactly like the scheduled run does. Without
# this check, /run would silently invoke run-claude.ps1, which would itself no-op on the flag with a
# less obvious message -- this makes the refusal explicit and immediate instead.
function Test-AutomationEnabled {
    $flagLine = Select-String -Path $runClaude -Pattern '\$AUTOMATION_ENABLED\s*=\s*\$(true|false)' | Select-Object -First 1
    [bool]($flagLine -and $flagLine.Matches[0].Groups[1].Value -eq 'true')
}

function Get-StatusReply {
    $enabled  = if (Test-AutomationEnabled) { 'enabled' } else { 'disabled' }
    $branch   = Get-Branch
    $dirty    = Get-DirtyCount
    $tree     = if ($dirty -eq 0) { 'clean' } else { "dirty ($dirty changes)" }
    $lastLine = Get-Content "$root\claude-session.log" -Tail 1 -ErrorAction SilentlyContinue
    $codexReady  = if (Test-Path $tasksFile) { @(Select-String -Path $tasksFile -Pattern '^status:\s*codex\s*$').Count } else { 0 }
    $reviewReady = if (Test-Path $tasksFile) { @(Select-String -Path $tasksFile -Pattern '^status:\s*review\s*$').Count } else { 0 }
    $lockState = if (Test-Path $lockFile) { 'BUSY (a run is in progress)' } else { 'idle' }
    @"
Automation: $enabled - Branch: $branch ($tree) - $lockState
Last log line: $lastLine
Codex-ready: $codexReady - Review-ready: $reviewReady
"@
}

# Single source of truth for both /next (report) and /go (report + act). Returns a structured
# recommendation: which task, whose turn, and which phase-runner action /go should take.
# 'blocked' and 'approved' map to action 'status' -- both need a human decision (unblock, or merge
# after review), not something /go can safely do on its own.
function Get-NextAction {
    if (-not (Test-Path $tasksFile)) { return @{ Action = 'status'; Message = 'No TASKS.md found.' } }
    $text = Get-Content $tasksFile -Raw -Encoding UTF8
    $body = ($text -split '<!-- TASK TEMPLATE')[0]
    $blocks = [regex]::Matches($body, '(?ms)^###\s+(?<id>TASK-\d+)\s*\p{Pd}?\s*[·•]?\s*(?<title>.+?)\r?\n(?<rest>.*?)(?=^###\s|\z)')
    $priority = @(
        @{ s = 'blocked';     owner = 'you (Claude)'; action = 'status'; note = 'blocked -- needs your decision, see the blocker note in TASKS.md' }
        @{ s = 'review';      owner = 'Claude';        action = 'review' }
        @{ s = 'approved';    owner = 'you';           action = 'status'; note = 'approved -- ready to merge into main yourself' }
        @{ s = 'codex';       owner = 'Codex';         action = 'build' }
        @{ s = 'in-progress'; owner = 'Codex';         action = 'build' }
        @{ s = 'todo';        owner = 'Claude';        action = 'run' }
    )
    foreach ($p in $priority) {
        foreach ($b in $blocks) {
            $m = [regex]::Match($b.Groups['rest'].Value, '(?m)^status:\s*(?<s>[\w-]+)')
            if ($m.Success -and $m.Groups['s'].Value -eq $p.s) {
                return @{ TaskId = $b.Groups['id'].Value; Title = $b.Groups['title'].Value.Trim(); Status = $p.s; Owner = $p.owner; Action = $p.action; Message = $p.note }
            }
        }
    }
    # Per-item check, not whole-file: BUILD_QUEUE.md routinely accumulates old deferred entries
    # alongside genuinely ready ones (confirmed live -- 4 unrelated "Deferred by Builder" notes
    # masked 6 real approved, non-deferred items including a P1 bug, making /go always conclude
    # "nothing approved waiting". A block only counts as deferred if ITS OWN note says so.
    $bqText = Get-Content (Join-Path $root 'planning/BUILD_QUEUE.md') -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    $bqBlocks = if ($bqText) { [regex]::Matches($bqText, '(?ms)^###\s+BQ-\d+.*?(?=^###\s+BQ-\d+|\z)') } else { @() }
    if ($bqBlocks | Where-Object { $_.Value -notmatch '(?i)\*\*Deferred' } | Select-Object -First 1) {
        return @{ Action = 'run'; Owner = 'Claude'; Message = 'An approved BUILD_QUEUE item is waiting to be converted.' }
    }
    return @{ Action = 'status'; Owner = 'you'; Message = 'No active task, nothing approved waiting.' }
}

function Get-NextReply {
    $n = Get-NextAction
    if ($n.TaskId) {
        $line = "task: $($n.TaskId) - $($n.Title) [$($n.Status)]`nowner: $($n.Owner)`nrun: $($n.Action)"
        if ($n.Message) { $line += "`nnote: $($n.Message)" }
        return $line
    }
    return "owner: $($n.Owner)`nrun: $($n.Action)`nnote: $($n.Message)"
}

# Shared by /build and /go's build-action so there's exactly one way a task actually gets built.
function Invoke-BuildPhase {
    $args = @(); if ($DryRun) { $args += '-DryRun' }
    & (Join-Path $root 'tools\Run-Codex-Build.ps1') @args
    $resultFile = Join-Path $root '.last-phase-result.txt'
    if (Test-Path $resultFile) { $r = Get-Content $resultFile -Raw; Remove-Item $resultFile -Force; $r }
    else { "Build phase runner exited with code $LASTEXITCODE and left no result -- check claude-session.log." }
}

# Shared by /review and /go's review-action.
function Invoke-ReviewPhase {
    $args = @(); if ($DryRun) { $args += '-DryRun' }
    & (Join-Path $root 'tools\Run-Claude-Review.ps1') @args
    $resultFile = Join-Path $root '.last-phase-result.txt'
    if (Test-Path $resultFile) { $r = Get-Content $resultFile -Raw; Remove-Item $resultFile -Force; $r }
    else { "Review phase runner exited with code $LASTEXITCODE and left no result -- check claude-session.log." }
}

# Shared by /run and /go's run-action.
function Invoke-RunPhase {
    if ($DryRun) { return "[DRY RUN] would run: $runClaude (no -Scheduled)" }
    & $runClaude
    switch ($LASTEXITCODE) {
        0 { "Planning run completed (exit 0). See claude-session.log for detail." }
        1 { "Planning run HALTED mid-run (exit 1) -- a safety guard caught something out of scope. See STATUS.md / claude-session.log." }
        2 { "Planning run ABORTED at Preflight (exit 2) -- an environment/repo-state problem. See claude-session.log." }
        default { "Planning run exited with unexpected code $LASTEXITCODE. See claude-session.log." }
    }
}

function Set-AutomationFlag {
    param([bool]$Enable)
    $newVal = if ($Enable) { '$true' } else { '$false' }
    if ($DryRun) { return "[DRY RUN] would set `$AUTOMATION_ENABLED = $newVal, commit, push" }
    $content = Get-Content $runClaude -Raw -Encoding UTF8
    $newContent = [regex]::Replace($content, '\$AUTOMATION_ENABLED\s*=\s*\$(true|false)\s*(#[^\r\n]*)?', "`$AUTOMATION_ENABLED = $newVal   # flip to `$true to re-enable overnight automation")
    [System.IO.File]::WriteAllText($runClaude, $newContent, $utf8)
    Invoke-Git -C $root add run-claude.ps1
    Invoke-Git -C $root diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
        Invoke-Git -C $root commit -m "automation: $(if ($Enable) {'enable'} else {'disable'}) via Telegram" | Out-Null
        Invoke-Git -C $root push origin main | Out-Null
    }
    return "Automation $(if ($Enable) {'enabled'} else {'disabled'})."
}

# --- Lock: shared with run-claude.ps1 and the phase runners, so nothing here ever overlaps a
#     twice-daily scheduled run or another dispatcher invocation. ---
if (Test-Path $lockFile) {
    $age = (Get-Date) - (Get-Item $lockFile).LastWriteTime
    if ($age.TotalHours -ge 2) {
        Remove-Item $lockFile -Force
    } else {
        Write-Host "Busy: another automation run is in progress (lock is $([int]$age.TotalMinutes) min old). Exiting without processing commands."
        exit 0
    }
}
if (-not $DryRun) { "$PID`n$(Get-Date -Format o)" | Out-File -FilePath $lockFile -Encoding ascii }

try {
    # n8n pushes new command files straight to origin/main -- this local clone never sees them until
    # something pulls. Without this, the scheduled task ran successfully every 2 minutes but always
    # found "no new commands" because the file only existed on GitHub, not on disk here (confirmed
    # live: a real /go sat unprocessed for 10+ minutes until a human manually ran `git pull`).
    # --ff-only is deliberate: if local ever diverges from origin (shouldn't happen given every phase
    # runner pushes immediately after each commit), fail loud rather than silently merge-committing.
    $pullOutput = Invoke-Git -C $root pull origin main --ff-only
    if ($LASTEXITCODE -ne 0) {
        Write-Host "WARNING: git pull --ff-only failed (exit $LASTEXITCODE): $pullOutput -- proceeding with possibly-stale local state."
    }

    if (-not (Test-Path $cmdDir)) { Write-Host "No captures/commands/ folder found."; return }
    $files = Get-ChildItem -Path $cmdDir -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' } | Sort-Object Name
    $new = @()
    foreach ($f in $files) {
        $raw = Get-Content $f.FullName -Raw -Encoding UTF8
        if ($raw -match '(?m)^status:\s*new\s*$') { $new += @{ File = $f; Raw = $raw } }
    }
    if (-not $new) { Write-Host "No new commands."; return }

    foreach ($entry in $new) {
        $f = $entry.File
        $raw = $entry.Raw
        $mId  = [regex]::Match($raw, '(?m)^id:\s*(?<v>\S+)')
        $mCmd = [regex]::Match($raw, '(?m)^command:\s*(?<v>\S+)')
        if (-not $mId.Success -or -not $mCmd.Success) {
            Write-Host "Skipping $($f.Name): missing id/command frontmatter."
            continue
        }
        $id  = $mId.Groups['v'].Value
        $cmd = $mCmd.Groups['v'].Value.ToLower()

        # Mark this command applied and commit it to main BEFORE dispatching to any phase runner.
        # This matters: run-claude.ps1 and Run-Codex-Build.ps1 both require a CLEAN main as their
        # first Preflight check. The incoming command file is itself an uncommitted change the moment
        # n8n writes it -- if we dispatched first and committed after (the original, buggy order),
        # every real /run or /build would abort at Preflight seeing its own not-yet-committed command
        # file as "dirty tree." Committing it first means Preflight sees a clean main, as intended.
        if (-not $DryRun) {
            $newRaw = $raw -replace '(?m)^status:\s*new\s*$', "status: applied`napplied: $(Get-Date -Format o)"
            [System.IO.File]::WriteAllText($f.FullName, $newRaw, $utf8)
            Invoke-Git -C $root add "captures/commands/$($f.Name)"
            Invoke-Git -C $root diff --cached --quiet
            if ($LASTEXITCODE -ne 0) {
                Invoke-Git -C $root commit -m "command: /$cmd ($id) received" | Out-Null
                Invoke-Git -C $root push origin main | Out-Null
            }
        }

        $reply = if ($cmd -in @('run', 'build', 'review', 'go') -and -not (Test-AutomationEnabled)) {
            "Automation is disabled (`$AUTOMATION_ENABLED = `$false) -- /$cmd refused to act. Send /enable first if you want this to run."
        } else {
            switch ($cmd) {
                'status'  { Get-StatusReply }
                'next'    { Get-NextReply }
                'enable'  { Set-AutomationFlag -Enable $true }
                'disable' { Set-AutomationFlag -Enable $false }
                'stop' {
                    $msg = Set-AutomationFlag -Enable $false
                    if (Test-Path $lockFile) {
                        $lockPid = (Get-Content $lockFile -First 1)
                        if ($lockPid -and $lockPid -ne "$PID") {
                            try { Stop-Process -Id $lockPid -Force -ErrorAction Stop; $msg += " In-progress run (PID $lockPid) stopped." }
                            catch { $msg += " Could not stop PID $lockPid (may have already finished)." }
                        }
                    }
                    $msg
                }
                'run'    { Invoke-RunPhase }
                'build'  { Invoke-BuildPhase }
                'review' { Invoke-ReviewPhase }
                'go' {
                    $n = Get-NextAction
                    switch ($n.Action) {
                        'run'    { "-> planning: " + (Invoke-RunPhase) }
                        'build'  { "-> build: " + (Invoke-BuildPhase) }
                        'review' { "-> review: " + (Invoke-ReviewPhase) }
                        'status' { "Nothing for /go to do. $($n.Message)`n`n" + (Get-StatusReply) }
                    }
                }
                default { "Unrecognized command: '$cmd'." }
            }
        }

        Write-Reply -Id $id -Text $reply

        if (-not $DryRun) {
            # Defensive: Run-Codex-Build.ps1 / Run-Claude-Review.ps1 return to main themselves on every
            # clean exit path (see their own comments), but a violation-halt or a claude -p failure
            # deliberately leaves a dirty task branch checked out for human inspection -- in that one
            # case, skip committing the reply to main rather than force a branch switch over dirty
            # files. The reply text itself already explains what happened; it'll be picked up (and the
            # OUTBOX.md entry pushed) on the next tick once a human has resolved that branch by hand.
            $curBranch = Invoke-Git -C $root branch --show-current
            if ($curBranch -eq 'main') {
                Invoke-Git -C $root add $outboxFile
                Invoke-Git -C $root diff --cached --quiet
                if ($LASTEXITCODE -ne 0) {
                    Invoke-Git -C $root commit -m "reply: /$cmd ($id)" | Out-Null
                    Invoke-Git -C $root push origin main | Out-Null
                }
            } else {
                Write-Host "Not on main (on '$curBranch') after /$cmd -- likely a halted build/review left for inspection. Reply written locally to OUTBOX.md but not committed/pushed this tick."
            }
        }
        Write-Host "Processed /$cmd ($id)."
    }
} finally {
    if (-not $DryRun) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }
}
