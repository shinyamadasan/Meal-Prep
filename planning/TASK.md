# Current Task

> The **single active task** — what's being worked on now. Read right after `../STATUS.md`.
> Priority is set in `ROADMAP.md` by a human; the agent executes what's here, it never picks.
> Lifecycle and Done conditions are defined in `../WORKFLOW.md`.
>
> **Current Step is the resume point** — keep it precise enough that a fresh run can continue with
> zero context. On Task Completion: tick all criteria, then Next Task Selection promotes the next
> `ROADMAP.md` queue item here (FIFO). Queue empty → set NO ACTIVE TASK.

## Objective
Add a `suggested: true` flag (+ `suggestedReason`) to grocery items auto-added by `checkAndReplenishLowStock()` / `syncStapleToGrocery()`, so later tasks can distinguish them from manually-added items.

## Current Step
Implementing — finding `checkAndReplenishLowStock` and `syncStapleToGrocery` in app.js to add the flag at the point items are created/pushed.

## Success Criteria
- [ ] items auto-added by `checkAndReplenishLowStock()` get `suggested: true` + `suggestedReason: "low stock"`
- [ ] manually-added grocery items are NOT flagged
- [ ] flag persists through `saveData()` and survives reload

## Blocker
none

## Definition of Done
All Success Criteria verified. Reference docs updated. STATUS.md updated. Code + docs committed together. Then Next Task Selection.
