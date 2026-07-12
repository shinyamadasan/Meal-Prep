# OPERATOR — How You Run the System

> This is the document **you** follow — not Claude, not the automation. You operate an AI engineering
> team now. Your job isn't to write code; it's to keep work flowing: capture inputs, set priority,
> review outputs. Claude executes. You steer.

## Operating Principles
Habits, not commands.

1. **Capture immediately.** The moment an idea or bug appears, send it. An uncaptured thought is a lost one.
2. **Never solve while capturing.** Don't design in the message — that's triage's job. Just name it.
3. **One message = one task.** Two ideas → two messages.
4. **Tasks before ideas.** Draw the queue down before promoting new ideas in.
5. **Ideas stay parked.** `/idea` and `/research` don't build until you promote them. That's the safety valve.
6. **Never interrupt deep work** to "just fix one thing." Capture it, stay in flow.
7. **Review, don't micromanage.** Judge the outcome against the task; don't re-engineer how it was done.

## Daily

**Morning (~2 min)**
- [ ] Read `STATUS.md` (top entry) — what ran overnight, where it stands.
- [ ] Read `planning/TASK.md` — what's active now.
- [ ] Skim the overnight commits (GitHub, or `git log`). Sane? If not → revert (below).

**Throughout the day**
- Idea / bug appears → text the bot → keep going. **Capture and continue.**

**Evening (~2 min)**
- [ ] Look at what shipped today (`planning/DONE.md` + the live site).
- [ ] Good → leave it. Wrong → revert the commit.
- [ ] Make sure the **top of `planning/ROADMAP.md`** is what you want built tonight.

## Weekly (~10 min)
- [ ] **Export your data** (app → Settings → Export Data). Keep the last few `.json` files.
      This is the **only real undo for data loss** — `git revert` restores code, never deleted data.
      It's what saved the pantry during the 2026-07 sync incidents. Do it before you dogfood
      anything risky. (Set a recurring phone reminder; see D-032.)
- [ ] Merge any **held** red-zone branches: an approved-but-`approved`-status task (data/sync/auth/OS)
      waits for your glance. Check `TASKS.md` for `status: approved`, skim the diff, then
      `git checkout main && git merge --ff-only task-<id> && git push origin main`.
- [ ] Clean `planning/ROADMAP.md` — reorder the queue, prune stale items.
- [ ] Promote any `/idea` / `/research` that's now worth building into the Task Queue.
- [ ] Skim `docs/DECISIONS.md` — still agree? Supersede anything that changed.
- [ ] Prune `planning/DONE.md` if it's long (git keeps the full history).

## At the keyboard (PC cheat sheet)

Telegram works from the PC too (it just polls every ~2 min). These run the **same phase runners**
instantly. All are lock-protected (`automation.lock`) so they can never overlap each other or the
scheduled run, and **every one takes `-DryRun`** — show what it would do, change nothing.

Open PowerShell and copy-paste a block:

**Plan / triage** — captures → proposals, approved queue → tasks *(Telegram: `/run`)*
```powershell
cd "C:\Users\Admin\Desktop\Vibe code\Meal prep app"
.\run-claude.ps1
```

**Build the next `status: codex` task** — auto-chains into review *(Telegram: `/build`; closest thing to `/go` at the PC)*
```powershell
cd "C:\Users\Admin\Desktop\Vibe code\Meal prep app"
.\tools\Run-Codex-Build.ps1
```

**Review the pending `status: review` task** — applies the D-032 risk gate *(Telegram: `/review`)*
```powershell
cd "C:\Users\Admin\Desktop\Vibe code\Meal prep app"
.\tools\Run-Claude-Review.ps1
```

**Merge a held red-zone branch** — a task the reviewer left at `status: approved` (D-032). Replace `<id>`:
```powershell
cd "C:\Users\Admin\Desktop\Vibe code\Meal prep app"
git checkout main
git merge --ff-only task-<id>
git push origin main
```

**Process queued Telegram command files** (rarely needed by hand)
```powershell
cd "C:\Users\Admin\Desktop\Vibe code\Meal prep app"
.\tools\Dispatch-Commands.ps1
```

**Options:** all runners take `-DryRun`. The review runner also takes `-NoAutoMerge` (review but never
touch `main` — inspect first) and `-NoPush` (merge locally, don't push).

> ⚠ **Never run `.\run-claude.ps1 -Scheduled` by hand.** `-Scheduled` is the Task Scheduler's signal to
> **shut the PC down** when the run ends. Plain `.\run-claude.ps1` is safe and will not power off.

## Can I sleep the PC? (verified against Task Scheduler)

| Scheduled task | Wakes the PC? | What it runs |
|---|---|---|
| **Meal Prep Command Dispatcher** (~2 min poll) | **No** — `WakeToRun = False`, deliberately | Picks up Telegram commands |
| **Meal Prep Claude Overnight** (9 PM + 2 AM) | **Yes** — `WakeToRun = True` | Planning/triage only (`run-claude.ps1`) |

- **Yes, you can sleep the PC.** Telegram commands sent while it's asleep are **not lost** — n8n writes
  them into the repo via GitHub, so they queue up and get picked up once the PC is awake
  (`StartWhenAvailable = True` means the dispatcher runs shortly after wake).
- **The dispatcher will NOT wake the PC.** That's on purpose — waking the machine every 2 minutes
  would be absurd. So **a build or review only runs while the PC is awake.** Sleep is fine; work waits.
- **The overnight task DOES wake the PC** (9 PM / 2 AM) — but it only does *planning*, never builds or
  reviews, and with `-Scheduled` it powers the machine back down afterwards.

### The dispatcher must be ENABLED for Telegram to work at all
```powershell
Enable-ScheduledTask  -TaskName "Meal Prep Command Dispatcher"    # turn Telegram polling on
Disable-ScheduledTask -TaskName "Meal Prep Command Dispatcher"    # turn it off
Get-ScheduledTask -TaskName "Meal Prep Command Dispatcher" | Select-Object State   # check
```

## The mindset
> Old: *"How do I code this?"* → New: *"How do I keep the system flowing?"*

Inputs in (capture) → priority set (roadmap) → outputs reviewed (morning/evening). Everything between
runs itself. The three things you actually touch: **GUIDE** (how to capture), this file (how you work),
**ROADMAP** (what matters). Nothing else needs to be on your phone.

## How to "review" and revert (current reality)
Right now autonomous runs commit **straight to `main`**, which auto-deploys live — there is **no PR to
approve**. So "review" = check the morning's commits and undo anything wrong:
- Inspect: `git log --oneline -5` or open the repo on GitHub.
- Undo one bad commit (keeps history): `git revert <hash>` → push. The site redeploys clean.

If you'd rather have a **real approval gate** — runs push to a branch and open a PR you merge, so
nothing goes live until you click merge — say the word and we'll switch the runner to that. It's the
natural next step for the operator model, but it's a change to the automation, so it's parked until you
want it.
