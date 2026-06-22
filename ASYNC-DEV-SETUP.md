# Async Dev System — Setup Guide

## What This Is

Phone → assign tasks → PC codes overnight → you review in the morning.

---

## Level 5 — Overnight Autonomous Coding

### Step 1: Keep PC awake overnight

Open Windows Settings → System → Power & Sleep → set Sleep to **Never** (or just on nights you want Claude to run).

### Step 2: Register the scheduled task

Open PowerShell as Administrator and run:

```powershell
& "C:\Users\Admin\Desktop\Vibe code\Meal prep app\setup-task-scheduler.ps1"
```

This registers a task that runs `run-claude.ps1` at 2am every night.
WakeToRun is ON — the PC wakes from sleep automatically.

### Step 3: Test it manually

Open Task Scheduler → find "Meal Prep Claude Overnight" → right-click → Run.

Check the output at: `Meal prep app\claude-session.log`

### Step 4: Review in the morning

Open GitHub on your phone → check for a new branch → review the diff → merge if good.
GitHub Actions runs the 15 Playwright tests automatically after merge.

### To change the run time

Edit `setup-task-scheduler.ps1`, change the `-At "2:00AM"` line, re-run it.

---

## Level 4 — Telegram Task Queue

Send a Telegram message → n8n creates a GitHub Issue → you see it queued.
The overnight Claude session picks up tasks from ROADMAP.md, not GitHub Issues directly.
Use GitHub Issues as your backlog — manually move priorities into ROADMAP.md.

### Step 1: Create a Telegram bot

1. Open Telegram → search for **@BotFather**
2. Send `/newbot`
3. Give it a name: `Meal Prep Tasks`
4. Give it a username: `mealpreptasks_bot` (must end in `_bot`)
5. BotFather sends you a token — copy it

### Step 2: Get your Telegram chat ID

1. Start a conversation with your new bot (send it any message)
2. Open this URL in a browser (replace YOUR_TOKEN):
   `https://api.telegram.org/botYOUR_TOKEN/getUpdates`
3. Find `"chat":{"id":XXXXXXX}` in the response — that number is your chat ID

### Step 3: Create a GitHub Personal Access Token

1. Go to github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Click "Generate new token"
3. Repository access: select only `Meal-Prep`
4. Permissions: Issues → Read and write
5. Generate and copy the token

### Step 4: Add credentials to n8n

In n8n:
1. Go to Credentials → New
2. Add **Telegram API** credential → paste your bot token
3. Add **GitHub API** credential → paste your GitHub PAT

### Step 5: Import the workflow

1. In n8n, click New Workflow → Import from file
2. Select `n8n-telegram-github.json` from this project folder
3. Update both nodes that say `REPLACE_WITH_YOUR_TELEGRAM_CREDENTIAL_ID`
   and `REPLACE_WITH_YOUR_GITHUB_CREDENTIAL_ID` with your actual credential IDs
4. Activate the workflow

### Step 6: Test it

Send a message to your Telegram bot: `Add password reset to the app`

You should get a reply with a GitHub Issue link within a few seconds.

---

## Daily Workflow

**From phone:**
1. Send tasks to Telegram bot → they queue as GitHub Issues
2. Periodically update ROADMAP.md to promote the next priority to Current Task

**Overnight:**
1. PC wakes at 2am
2. Claude reads ROADMAP.md and implements the Current Task
3. Commits to a feature branch, updates STATUS.md
4. PC goes back to sleep

**Morning:**
1. Check STATUS.md or GitHub Issues on phone
2. Review the branch diff on GitHub
3. Merge if good → tests run automatically
4. Update ROADMAP.md Current Task to the next item

---

## Files in This System

| File | Purpose |
|---|---|
| `ROADMAP.md` | Source of truth — what to build next |
| `STATUS.md` | Session log — what happened last night |
| `run-claude.ps1` | The overnight Claude session script |
| `setup-task-scheduler.ps1` | Run once to register the 2am task |
| `n8n-telegram-github.json` | Import into n8n for Telegram → GitHub Issues |
| `claude-session.log` | Output log from overnight runs |
