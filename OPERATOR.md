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
- [ ] Clean `planning/ROADMAP.md` — reorder the queue, prune stale items.
- [ ] Promote any `/idea` / `/research` that's now worth building into the Task Queue.
- [ ] Skim `docs/DECISIONS.md` — still agree? Supersede anything that changed.
- [ ] Prune `planning/DONE.md` if it's long (git keeps the full history).

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
