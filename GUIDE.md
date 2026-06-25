# 📱 Capture Cheat Sheet

How to feed the autonomous dev system from your phone. Text these to the **Meal Prep Tasks** bot.

## Commands
- **`/feature`** `<what>` — something to build → queued, **built automatically** on a run
- **`/bug`** `<what>` — something broken → logged
- **`/todo`** `<what>` — small chore → queued
- **`/idea`** `<what>` — a maybe → **parked** (NOT built until you promote it)
- **`/research`** `<what>` — to look into → parked

Send it → bot replies **✅ Captured** → forget it.

## What happens next
1. Your message becomes a file in `captures/inbox/`.
2. The next scheduled run (when your PC is awake) **triages** it — scores it against the project goals, dedupes, writes acceptance criteria, guesses the files.
3. `/feature` & `/todo` get **built automatically**. `/idea` & `/research` wait for you.

## Write good captures
- **One idea per message.**
- Say the **outcome**, not the code: *"Add a dark-mode toggle"*, *"History duplicates after sync"*.
- Rough is fine — triage refines it. Don't overthink it.

## Steer it (when at a computer)
- `planning/ROADMAP.md` — reorder the queue (**top = built next**); promote an Idea when you're ready.
- `planning/DONE.md` — what shipped.
- `STATUS.md` — where things stand right now.

## Remember
- ⚠️ Runs only fire when your **PC is awake** (9PM / 2AM) — overnight captures build at the next run, not instantly.
- 🅸 **Ideas & Research never auto-build** — promote them yourself.
- 🔑 The GitHub token **expires 2026-09-23** — captures silently stop if it's not renewed.
