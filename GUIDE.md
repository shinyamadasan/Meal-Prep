# 📱 AI Dev System

**CAPTURE anytime** — just text the bot. A tag is optional (untagged = Claude infers type at triage):
- `/feature` or `/todo` → build queue
- `/bug` → known issues
- `/idea` / `/research` → parked (never auto-builds)

**APPROVE anytime** — no need to wait for the morning digest, no need to look up a number:
- `Accept` → applies each pending proposal's own recommended verdict, no number needed — **default to this**
- `Approve all` → approves literally everything pending, ignoring recommendations
- `Approve 3` · `Park 5` · `Reject 2` → target one specific proposal number (from the digest or a `/go` reply)

**THE FAST LOOP** — capture → shipped, no digest-waiting:
```
capture  →  /go (triages, tells you it's done)  →  Accept  →  /go (builds + reviews + merges)
```
⚠ Until TASK-014 ships: the first `/go` won't triage a brand-new idle capture yet (known gap, already
queued for Codex) — use `/run` instead for that first step only. Once TASK-014 merges, `/go` covers
all three presses and this note goes away.

**BUILD** — `/go` = plan (if needed) → build → review → merge → deploy. One task, one press. Press again for the next.

**AT THE PC — skip the ~30 min wait** — every command above still works from the computer, it just
waits for the Command Dispatcher's next tick (~30 min, D-033). To make it instant instead:
```powershell
cd "C:/Users/Admin/Desktop/Vibe code/Meal prep app"
Start-ScheduledTask -TaskName "Meal Prep Command Dispatcher"
```
Run this once after each phone message (capture, `/go`, `Accept`, `/go`) to drain the queue right
now instead of waiting for the timer. Doesn't change the standing 30 min interval — just fires this
one check immediately.

**OTHER COMMANDS**
- read-only: `/status` `/next` `/log`
- manual step: `/run` `/build` `/review`
- held red-zone task: `/merge TASK-014` (shows what it touches) → `/merge TASK-014 yes` (merges)
- kill switch: `/stop` `/enable` `/disable`

**STEER** — `ROADMAP.md` top = next build · promote ideas when ready

> **Capture. Don't think.**

_Full playbook → `OPERATOR.md`._
