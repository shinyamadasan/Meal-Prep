# Current Task

> The **single active task** — what's being worked on now. Read right after `../STATUS.md`.
> Priority is set in `ROADMAP.md` by a human; the agent executes what's here, it never picks.
> Lifecycle and Done conditions are defined in `../WORKFLOW.md`.
>
> **Current Step is the resume point** — keep it precise enough that a fresh run can continue with
> zero context. On Task Completion: tick all criteria, then Next Task Selection promotes the next
> `ROADMAP.md` queue item here (FIFO). Queue empty → set NO ACTIVE TASK.

## Objective
On a brand-new first run, only the Kitchen Setup Wizard auto-appears — the Help modal must NOT auto-open on top of it.

## Current Step
COMPLETE — fix implemented, Self Review passed, QA passed. Updating docs.

## Success Criteria
- [x] on a brand-new first run, only the Kitchen Setup Wizard auto-appears (Help does NOT auto-open)
- [x] Help stays reachable via Settings → How-to (unchanged)
- [x] returning users get no surprise Help popups; Help still doesn't auto-open on every load

## Blocker
none

## Definition of Done
All Success Criteria verified. Reference docs updated (FEATURES/DATA_MODEL/ARCHITECTURE/DECISIONS as
applicable). STATUS.md updated. Code + docs committed together. Then Next Task Selection.
