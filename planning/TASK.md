# Current Task

> The **single active task** — what's being worked on now. Read right after `../STATUS.md`.
> Priority is set in `ROADMAP.md` by a human; the agent executes what's here, it never picks.
> Lifecycle and Done conditions are defined in `../WORKFLOW.md`.
>
> **Current Step is the resume point** — keep it precise enough that a fresh run can continue with
> zero context. On Task Completion: tick all criteria, then Next Task Selection promotes the next
> `ROADMAP.md` queue item here (FIFO). Queue empty → set NO ACTIVE TASK.

## Objective
Add a dismiss control to suggested grocery items: removes the item from AppState.groceryList, leaves pantry untouched, and prevents re-addition by checkAndReplenishLowStock() while still below min.

## Current Step
COMPLETE — Task 2 committed. Starting Task 3 implementation.

## Success Criteria
- [ ] a dismiss control on suggested grocery items removes the item from AppState.groceryList
- [ ] the corresponding pantry item is untouched
- [ ] dismissed items are not re-added by the next checkAndReplenishLowStock() run while still below min
- [ ] persists through saveData()

## Blocker
none

## Definition of Done
All Success Criteria verified. Reference docs updated. STATUS.md updated. Code + docs committed together. Then Next Task Selection.
