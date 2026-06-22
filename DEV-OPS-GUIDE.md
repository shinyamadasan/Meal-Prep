# Async Dev System — Daily Operations Guide

Quick reference for running the system day-to-day.
For initial setup, see ASYNC-DEV-SETUP.md.

---

## What We Built (2026-06-22)

### Level 1 — Source of Truth ✅
- `ROADMAP.md` — tells Claude what to build next. You edit this to steer the work.
- `STATUS.md` — Claude appends a summary after every session. Read this each morning.
- Session prompt — 6-line prompt you paste to start a manual Claude session.

### Level 2 — Git Workflow ✅
- Claude commits directly to `main` and pushes automatically.
- GitHub Actions runs 15 Playwright tests after every push. Green = safe.

### Level 3 — Automated Status Reports ✅
- Claude updates `STATUS.md` at the end of every session.
- `claude-session.log` stores full output from every overnight run.

### Level 4 — Task Queue ✅ Simplified
- Skipped Telegram/n8n (Docker overhead not worth it for this use case).
- To queue a new task: just tell Claude "change current task to X" and ROADMAP.md gets updated.
- Claude picks it up automatically that night at 2am.

### Level 5 — Overnight Autonomous Coding ✅
- `run-claude.ps1` — the overnight script. Uses your Claude Pro subscription (no API charges).
- Registered in Windows Task Scheduler — fires at 2am daily.
- PC wakes from sleep automatically (WakeToRun = ON).
- Power settings set to never sleep when plugged in.
- Tested and confirmed working on 2026-06-22.

---

## The Loop

```
Add tasks to ROADMAP.md Task Queue
↓
Claude codes overnight — works through queue top to bottom
↓
Pushes each task directly to main as it completes
↓
Stops when queue is empty or tokens run low
↓
Wake up → check STATUS.md to see what was done
↓
Open app and verify it works
↓
Add more tasks to the queue
↓
Repeat
```

---

## 1. Start a Manual Session (You're at the PC)

Open Claude Code and paste:

```
Read ROADMAP.md, STATUS.md, and CLAUDE.md first.

Implement the Current Task from ROADMAP.md only. Do not touch anything in "Do Not Work On."

Steps:
1. Create the branch named in ROADMAP.md
2. Implement the Current Task
3. Verify each Success Criterion by inspecting the code logic
4. Commit to the branch — do NOT push to main, do NOT merge
5. Update STATUS.md (append a new entry at top)
6. Report: what changed, what to manually verify in the browser, any risks
```

Wait 20-40 minutes. Claude will commit and update STATUS.md when done.

---

## 2. Check What Happened Overnight

**Option A — Read STATUS.md** (fastest):
Open `STATUS.md` — newest entry is at the top.

**Option B — Check the log** (full output):
Open `claude-session.log` in the project folder.

**Option C — GitHub on phone**:
Go to github.com/shinyamadasan/Meal-Prep → branches → look for a new branch.

---

## 3. Check the App After Overnight Run

Claude pushes directly to main — no PR needed.

1. Open your app: shinyamadasan.github.io/Meal-Prep
2. Check that it still loads and works normally
3. Go to github.com/shinyamadasan/Meal-Prep → Actions tab
4. Green check ✅ = all tests passed. Red X ❌ = check which test failed

---

## 4. After a Task is Done — Update the Roadmap

Open `ROADMAP.md` and:
1. Move the completed task to a "Done" note (or just delete it)
2. Promote the next item from **Backlog** into **Current Task**
3. Update the **Success Criteria** for the new task

The next overnight session (or manual session) will pick up the new task automatically.

---

## 5. Queue a New Task

Tell Claude what you want to build next:

```
Change the current task to: password reset — add forgot password link on sign-in modal
```

Claude updates ROADMAP.md. The overnight script picks it up at 2am automatically.

---

## 6. Overnight Schedule

- Runs at: **2:00 AM daily**
- PC wakes from sleep automatically (WakeToRun = ON)
- Output logged to: `claude-session.log`

**Pause overnight runs:**
```powershell
Disable-ScheduledTask -TaskName "Meal Prep Claude Overnight"
```

**Resume overnight runs:**
```powershell
Enable-ScheduledTask -TaskName "Meal Prep Claude Overnight"
```

**Change run time** (e.g. to 3am):
Edit `setup-task-scheduler.ps1` → change `-At "2:00AM"` → re-run the script as Admin.

**Test the script manually:**
```powershell
& "C:\Users\Admin\Desktop\Vibe code\Meal prep app\run-claude.ps1"
```

---

## 7. Troubleshooting

**Script runs but nothing happens / API error:**
→ Monthly Claude Pro quota hit. Check reset date in the error message. Wait or add API key.

**Claude works on the wrong thing:**
→ Check ROADMAP.md — "Current Task" was probably vague. Make it more specific.

**Branch already exists error:**
→ Claude tried to create a branch that already exists. Delete the old branch or rename it in ROADMAP.md.

**Tests fail after merge:**
→ Go to github.com/shinyamadasan/Meal-Prep → Actions tab → open the failed run → see which test broke.

**Claude got stuck or didn't finish:**
→ Read `claude-session.log` to see where it stopped. Check STATUS.md for any blockers Claude logged.

---

## Files at a Glance

| File | What it is |
|---|---|
| `ROADMAP.md` | What to build — edit this to steer Claude |
| `STATUS.md` | What happened each session — read this each morning |
| `DEV-OPS-GUIDE.md` | This file |
| `ASYNC-DEV-SETUP.md` | One-time setup instructions |
| `run-claude.ps1` | The overnight script — don't edit unless changing tools |
| `setup-task-scheduler.ps1` | Re-run as Admin if you need to change the schedule |
| `n8n-telegram-github.json` | Import into n8n for Telegram → GitHub Issues |
| `claude-session.log` | Full output from overnight runs |
