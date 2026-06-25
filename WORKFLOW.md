# Development Workflow — Task-Driven Lifecycle

> The repository's development protocol. **Replaces the old session-based model.**
> There is **no "session end."** Work is organized around **tasks** and explicit **events**, never
> around when a conversation or a scheduled process happens to stop. A run/agent that stops simply
> performs a **Checkpoint** first. This file is the source of truth for *when* docs are read/updated.

## Principles
- One unit of work = one **task**, held in `planning/TASK.md`.
- Docs change at specific **events**, not on a timer or at a vague "end".
- **Code and docs commit together** — the doc update rides in the same commit as the code, so they
  can never drift. This is the enforcement mechanism that replaces "remember at session end".
- The agent **executes** tasks; the human **prioritizes** them. Selection is mechanical FIFO.
- **Capture is dumb; triage is smart.** Mobile captures land in `captures/inbox/` (one immutable file
  each, written by n8n). All judgment happens later, in the Triage event, where the agent has the
  whole repo as context.

## File map
```
root/        CLAUDE.md (router) · STATUS.md (working memory) · WORKFLOW.md · PROMPTS.md
planning/    ROADMAP.md (priority) · TASK.md (active task) · DONE.md (completed log)
captures/    inbox/ (new captures) · processed/YYYY/MM/ (triaged archive)
docs/        PROJECT.md · ARCHITECTURE.md · DATA_MODEL.md · FEATURES.md · DECISIONS.md
```

## Lifecycle
```mermaid
stateDiagram-v2
    [*] --> Triage: run starts (captures/inbox not empty)
    Triage --> NoActiveTask: route + archive captures
    [*] --> NoActiveTask: inbox empty
    NoActiveTask --> Execution: Planning / Next Task Selection (promote top of queue)
    Execution --> Execution: progress (update Current Step)
    Execution --> Checkpoint: pause / budget hit / compaction
    Checkpoint --> Execution: resume (same run)
    Checkpoint --> [*]: stop (resume later from Current Step)
    Execution --> TaskCompletion: all success criteria pass
    TaskCompletion --> Commit
    Commit --> NextTaskSelection
    NextTaskSelection --> Execution: promote top of queue
    NextTaskSelection --> NoActiveTask: queue empty
```

---

## The events

### 0. Triage (Intake)  ← runs first, every run
- **Trigger:** start of a run when `captures/inbox/` has any `*.md`. (Captures arrive from the Telegram
  bot via n8n — see `captures/README.md`.)
- **Who:** the agent. This is the one place mobile captures become real tasks.
- **Reads:** `captures/inbox/*.md`, `docs/PROJECT.md` (**North-star goals**), `planning/ROADMAP.md`,
  `planning/DONE.md`, and the codebase (for dedupe + file hints).
- **Does**, for each capture (skip any whose `id` already appears in ROADMAP/DONE/processed — idempotency):
  1. **Categorize** — use the `/command`; infer the type if the capture had none.
  2. **Dedupe** — search ROADMAP + DONE for the same idea; if dup, merge/drop, don't re-add.
  3. **Goal-alignment score** — rate the item against the **North-star goals in `docs/PROJECT.md`**
     (e.g. *strong / some / weak* alignment). This is the **primary** input to priority: an item that
     directly serves a top goal outranks a cosmetic one regardless of how fun it sounds.
  4. **Priority** = goal-alignment first, then complexity as tiebreaker (quick high-alignment wins
     bubble up). **Complexity** = S/M/L. Add **tags**.
  5. **Acceptance criteria** for `/feature` and `/bug` (verifiable, code-inspection-checkable).
  6. **Likely files** — grep the repo by function name / DOM id; list candidates.
  7. **Route:** `/feature`,`/todo` → ROADMAP **Task Queue** (ranked by score); `/bug` → **Known Issues**
     (or Queue if breaking); `/idea` → **Ideas** (parked); `/research` → **Research** (parked).
     *Ideas/Research are never auto-built — they wait for a human to promote them.*
- **Writes:** `planning/ROADMAP.md` (routed, enriched entries); **archive** each processed capture to
  `captures/processed/YYYY/MM/<id>.md` (provenance — *why* a task exists); a one-line triage summary
  to `STATUS.md`.
- **Exit:** `captures/inbox/` is empty → continue to Next Task Selection / Execution.

### 1. Planning
- **Trigger:** `TASK.md` is `NO ACTIVE TASK` and a task is needed, or a human has a new idea.
- **Who:** Human (interactive), via `PROMPTS.md` P1. **Autonomous runs never plan** — they don't choose priority or invent work.
- **Reads:** `planning/ROADMAP.md` (queue), `docs/PROJECT.md` (scope), area docs (`docs/FEATURES.md` / `docs/ARCHITECTURE.md` / `docs/DATA_MODEL.md`).
- **Writes:** `planning/TASK.md` (Objective / Current Step / Success Criteria / Definition of Done) and/or the ROADMAP Task Queue.
- **Exit:** `TASK.md` holds exactly one active task whose criteria are verifiable by code inspection.

### 2. Execution
- **Trigger:** `TASK.md` has an active task.
- **Reads:** `TASK.md` + only the docs `CLAUDE.md` routes to for this task type.
- **Does:** Implement. Keep `TASK.md` → **Current Step** updated as a live progress marker — the resume point.
- **Writes (lightweight):** `TASK.md` Current Step only. No reference docs yet.
- **Exit:** criteria pass → **Task Completion**; or work pauses → **Checkpoint**.

### 3. Checkpoint  *(replaces "session end")*
- **Trigger (any):** context about to compact; autonomous run hits token/time budget mid-task; human stops (`/wrap`); a natural break with the task unfinished.
- **Purpose:** Persist enough state to resume with **zero context loss**.
- **Reads:** `TASK.md`, `STATUS.md`.
- **Writes:**
  - `TASK.md` → **Current Step**: what's done, what's left, the precise next action.
  - `STATUS.md` → top entry: task, in-progress state, next concrete step, any blocker.
  - **Optional `wip:` commit** so code-in-progress is saved.
- **Does NOT:** mark Done, advance ROADMAP, or update reference docs.
- **Exit:** resume Execution (same run) **or** stop. A later run resumes from `TASK.md` Current Step.

### 4. Task Completion
- **Trigger:** **every** Success Criterion in `TASK.md` is verified (by code trace; autonomous also requires any test gate to pass).
- **Conditions for Done:** all criteria ticked **and** the Definition of Done is met. **Partial ≠ Done.**
- **Reads:** `TASK.md` (criteria) + the reference docs for whatever changed.
- **Writes — the doc-sync event:**
  - tick all criteria in `TASK.md`;
  - `docs/FEATURES.md` status (feature changed);
  - `docs/DATA_MODEL.md` (shape/key changed);
  - `docs/ARCHITECTURE.md` (subsystem changed);
  - `docs/DECISIONS.md` — new `D-0NN` if a non-obvious choice was made or reversed;
  - append a completion line to `planning/DONE.md`;
  - `STATUS.md` → "shipped" entry.
- **Exit:** → **Commit**.

### 5. Commit
- **Golden rule:** **code + updated docs go in the same commit.** No deferred doc updates.
- **Trigger:** after Task Completion (a *completion* commit) or after a Checkpoint (a *wip* commit).
- **Does:** stage code + docs; commit with a message tied to the task; **push** (autonomous) or **propose the message** (interactive — don't push unless asked).
- **Exit:** → **Next Task Selection** (continuing) or stop.

### 6. Next Task Selection
- **Trigger:** a task is Done + committed and work continues.
- **Who:** Mechanical FIFO — **promote the top of the ROADMAP Task Queue into `TASK.md`.** Priority was set by triage score + the human ordering the queue; the agent never re-chooses.
- **Writes:** the finished task is already logged in `planning/DONE.md` (at Task Completion); load the next into `TASK.md`. Queue empty → `TASK.md` = `NO ACTIVE TASK`.
- **Exit:** → Execution (next task) or stop.

---

## When each file changes
| File | Changes at |
|---|---|
| `captures/inbox/*` | created by **n8n** (capture); removed by **Triage** (archived) |
| `captures/processed/**` | **Triage** (archive of processed captures) |
| `planning/TASK.md` | Planning (created) · Execution (Current Step) · Checkpoint (resume point) · Task Completion (ticked) · Next Task Selection (replaced) |
| `STATUS.md` | **Triage** (summary), **Checkpoint**, **Task Completion** |
| `planning/ROADMAP.md` | **Triage** (route captures) · Planning (add tasks) · Next Task Selection (promote) · Blocked parking |
| `planning/DONE.md` | **Task Completion** (append) |
| `docs/DECISIONS.md` | When a non-obvious choice is made/reversed |
| `docs/FEATURES.md` / `DATA_MODEL.md` / `ARCHITECTURE.md` | Task Completion, for the area that changed |
| `docs/PROJECT.md` | Rarely (scope or North-star-goal change) |

**ROADMAP advances only at Next Task Selection. STATUS updates at Triage / Checkpoint / Task Completion. DONE.md appends only at Task Completion. DECISIONS updates only when a real decision is made.**

---

## Autonomous run behavior (scheduled every 5–6 h)
Each run reads `CLAUDE.md` → `STATUS.md` → `planning/TASK.md`, **then runs Triage** (process
`captures/inbox/`), then:

| Situation | Action |
|---|---|
| **Captures in inbox** | **Triage** them first (route + archive) before touching the active task. |
| **Task completed** | Task Completion → Commit → Next Task Selection. Keep going while budget allows; otherwise Checkpoint (clean, between tasks) and stop. |
| **Task partially done** (budget/token limit mid-task) | **Checkpoint**: write Current Step + STATUS in-progress, optional `wip:` commit, **stop**. Don't mark Done or advance ROADMAP. |
| **Task blocked** | Record the blocker in `TASK.md` + `STATUS.md`. Move the task to ROADMAP **Blocked**, promote the next queue item, continue. Queue empty → stop. |
| **No active task** | After triage, if the queue is empty write "No tasks remaining" to `STATUS.md` and stop. Don't plan or invent work. |

Promoting the next FIFO item is **order-following, not prioritizing** — allowed. Choosing *which* task
by judgment is not. (Triage *scores* incoming captures, which sets their queue order — that's intake
ranking against PROJECT.md goals, not the agent overriding the human's queue.)

## Interactive behavior
Identical events. You signal a **Checkpoint** explicitly with `/wrap` whenever you stop — the only
honest "done for now" signal. Nothing tries to detect an implicit end.

## Resuming unfinished work
Any run/session resumes by: read `STATUS.md` top entry → read `planning/TASK.md` **Current Step** →
continue Execution from that exact step. Checkpoint persisted both, so no context is lost between runs.
