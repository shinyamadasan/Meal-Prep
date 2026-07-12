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

Telegram works fine from the PC too (it just polls every ~2 min). These run the **same phase runners**
instantly. All are lock-protected (`automation.lock`) so they can never overlap each other or the
scheduled run, and **every one takes `-DryRun`** — show what it would do, change nothing.

| Want to… | Run (from the repo root) | Telegram equivalent |
|---|---|---|
| Plan / triage — captures → proposals, approved queue → tasks | `.\run-claude.ps1` | `/run` |
| Build the next `status: codex` task (**auto-chains into review**) | `.\tools\Run-Codex-Build.ps1` | `/build` |
| Review the pending `status: review` task | `.\tools\Run-Claude-Review.ps1` | `/review` |
| Process any queued Telegram command files | `.\tools\Dispatch-Commands.ps1` | — |

**Closest thing to `/go` at the PC:** `.\tools\Run-Codex-Build.ps1` — it builds the next task *and*
auto-runs the review, which auto-merges if the D-032 gate lands on `done`.

> ⚠ **Never run `.\run-claude.ps1 -Scheduled` by hand.** `-Scheduled` is the Task Scheduler's signal to
> **shut the PC down** when the run ends. Plain `.\run-claude.ps1` is safe and will not power off.

**Merge a held red-zone branch** (D-032 — a task the reviewer left at `status: approved`):
```
git checkout main
git merge --ff-only task-<id>
git push origin main
```

**Review runner options:** `-NoAutoMerge` (review, but never touch `main` — inspect first) ·
`-NoPush` (merge locally, don't push) · `-DryRun`.

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
