# AI Dev OS

Version: 2.0

Roles

Claude
- Product Manager
- Tech Lead
- Architect
- Reviewer

Codex
- Software Engineer
- Implementer
- Tester

Compatible AGENTS.md:
v2.0

# Meal Prep Planner - Agent Router v2

Plain HTML/CSS/JS single-page app. No build step, no framework. Firebase Auth + Firestore with
localStorage offline fallback. Deployed on GitHub Pages from `main`.

Core files:
- `app.js` - all app logic, global functions, imperative `render*()` flow
- `index.html` - all tabs and modals inline
- `style.css` - all styles

This file is the router. Read it first, then load only the docs needed for the current work.
Code is the source of truth for how things behave. Docs are the source of truth for why and where.
If docs disagree with code about behavior, fix the docs.

## Startup Procedure

1. Read `CLAUDE.md` only once at session start.
   Do not repeatedly reload `CLAUDE.md` unless it changes.
   Treat it as persistent operating instructions for the session.
2. Read `HANDOFF.md` if present for the latest thread-reset checkpoint. Treat it as context only;
   `STATUS.md` and `TASKS.md` remain the source of truth.
3. Read `STATUS.md` for current state, blockers, and last shipped work.
4. Read `TASKS.md` to understand active Claude-to-Codex handoffs.
5. If doing Claude planning, read `PLAN.md` and the relevant approved inputs from `planning/BUILD_QUEUE.md`.
6. If doing Claude review, read the branch diff, `CHANGELOG.md`, `TEST_REPORT.md`, and `REVIEW.md`.
7. Pull only the task-specific docs listed in "What to read".

Do not load every doc by default. Keep context focused.

## Default Entry Point

Default command: **Next**.

Use `Next` when context is unclear, after an interruption, or at the start of a work session — it
is the safest thing to run when you don't know what to do. If the human's message is just "Next",
run the Next Command (see `## Next Command` below) before anything else.

`Next` is read-only — it never modifies files.

## Session Recovery

If conversation context is lost or a new session begins:

1. Read `HANDOFF.md` if present.
2. Read `STATUS.md`.
3. Read `PLAN.md`.
4. Read `TASKS.md`.
5. Read `REVIEW.md`.
6. Determine:
   - current milestone
   - active task
   - current owner
   - blockers
7. Resume from the existing project state.
8. Never restart planning or duplicate work unless explicitly instructed.

## Agent Roles

### Claude

Claude is the Product Manager, Tech Lead, Architect, and Reviewer.

Claude owns:
- Product judgment, prioritization, scope, and acceptance criteria
- Architecture decisions and documentation consistency
- Breaking approved work into small implementation tasks
- Reviewing Codex output before approval
- `PLAN.md`
- `TASKS.md`, except Codex may update a task status during execution
- `REVIEW.md`
- `docs/`
- `planning/`

Claude does not use `TASKS.md` as a scratchpad. It is the handoff contract to Codex.

#### Delegation Policy

Claude delegates implementation to Codex by default.

Claude writes production code only when:

- explicitly requested by the human
- the change is trivial
- implementation is required to unblock planning or review
- Codex is unavailable

Otherwise Claude focuses on planning, architecture, documentation, and review.

### Codex

Codex is the Software Engineer, Implementer, and Tester.

Codex owns:
- Implementing one task at a time from `TASKS.md`
- Focused code changes that satisfy acceptance criteria
- Running tests and recording results
- Appending implementation evidence to `CHANGELOG.md`
- Appending test evidence to `TEST_REPORT.md`
- Updating only the active task's `status` field during execution

Codex must not read `planning/BUILD_QUEUE.md` as an execution source. `TASKS.md` is the only handoff
from Claude to Codex.

## AI Team Principles

These principles govern all AI collaboration.

1. **One owner per responsibility.**
   Every responsibility has one primary owner. Avoid overlapping ownership.

2. **One owner per file.**
   Each document has a primary owner. Other agents should not edit it unless explicitly allowed.

3. **One AI acts at a time.**
   Never have Claude and Codex modify the same files simultaneously.

4. **The repository is the communication channel.**
   Agents communicate through repository files, not chat history.

5. **TASKS.md is the contract.**
   Claude plans work in `TASKS.md`.
   Codex executes only what appears there.

6. **Preserve architecture over speed.**
   Never introduce shortcuts that violate documented architecture or hard rules.

7. **Prefer small, reviewable changes.**
   Small atomic tasks are preferred over large feature implementations. Sprint Execution Mode is a
   narrow, explicitly Claude-granted exception for Low/Medium-risk task groups — never a default,
   never Codex's call.

8. **Stop when ownership changes.**
   Once a task reaches the next owner's responsibility, stop and hand off.

## Escalation Policy

If blocked, follow this order:

1. Attempt to resolve using project documentation.
2. Read the relevant architecture and decision documents.
3. If still blocked, record the blocker in `TASKS.md`.
4. Do not invent requirements.
5. Do not silently change architecture.
6. Ask the human only when the blocker cannot be resolved from project documentation.

When in doubt: prefer stopping over guessing.

## Documentation Map

| File | What's in it | Source of truth for |
|---|---|---|
| `STATUS.md` | Current state, last shipped, blockers | Where we are right now |
| `TASKS.md` | Claude-to-Codex handoff: atomic tasks with status and acceptance criteria | The only Codex execution queue |
| `PLAN.md` | Current milestone: goal, approach, scope, BUILD_QUEUE source items | Why the active Codex sprint exists |
| `REVIEW.md` | Claude review verdicts: approved or rework, with must-fix list | What Codex must fix before approval |
| `CHANGELOG.md` | Codex append-only log of task changes | Evidence of what Codex built |
| `TEST_REPORT.md` | Codex append-only test results per task | Test evidence for completed tasks |
| `planning/PROPOSALS.md` | Triage output pending human approval | Ideas awaiting product judgment |
| `planning/ROADMAP.md` | Approved backlog, Ideas, Research, Known Issues, Do Not Work On | Approved long-term work |
| `planning/BUILD_QUEUE.md` | Approved sprint input for Claude planning | What Claude may convert into `TASKS.md` |
| `planning/TASK.md` | Legacy tactical active-task file used by autonomous Claude workflow | Current step for that workflow |
| `planning/DONE.md` | Completed-work log, append-only | What shipped and when |
| `captures/` | `inbox/` mobile captures; `processed/` triaged archive | Inbound idea pipeline |
| `WORKFLOW.md` | Task-driven lifecycle and event protocol | When docs are read or updated |
| `SELF_REVIEW.md` | Code-health gate before QA | Maintainability and ship-readiness |
| `QA.md` | Pre-commit quality gate | Correctness before production commit |
| `PROMPTS.md` | Engineering prompts P1-P10 and Product prompts PP1-PP7 | How to frame recurring work |
| `GUIDE.md` | Tiny phone capture card | Muscle-memory capture reference |
| `OPERATOR.md` | Human playbook and daily/weekly rhythm | How the human runs the system |
| `AI-DEV-OS.md` | Generic OS vs app-specific manifest and new-app bootstrap | Reusing this OS for a new app |
| `SYSTEM-OVERVIEW.md` | Plain-language system explainer | Onboarding and full-pipeline understanding |
| `METRICS.md` | Weekly engineering metrics | Evidence over intuition |
| `docs/PROJECT.md` | What, why, who, non-goals, north-star goals | Product intent and scope |
| `docs/ARCHITECTURE.md` | Subsystems by named entry point, data flow, sync | System design and where things live |
| `docs/DATA_MODEL.md` | AppState, Recipe, Firestore, localStorage, hardcoded DBs | Data shapes and storage keys |
| `docs/FEATURES.md` | Feature catalog by tab and status | Feature existence and status |
| `docs/DECISIONS.md` | ADR-lite rationale | Why key choices were made |
| `docs/AI_OS_NOTES.md` | Append-only friction log — one line per workflow awkwardness noticed | Candidate improvements to the OS itself, pending promotion |
| `library/requirements/features/` | Immutable PRDs, one folder per feature | What to build for approved feature scope |
| `AGENTS.md` | Codex standing instructions, loop, hard rules, templates | How Codex operates |

## Lifecycle

Work is task-driven, not session-driven. Read `WORKFLOW.md` for the full event model:
Triage, Planning, Execution, Checkpoint, Task Completion, Commit, Next Task Selection.

Essentials:
- Triage routes captures to `planning/PROPOSALS.md`, never directly to build.
- Human-approved work moves to `planning/ROADMAP.md` and `planning/BUILD_QUEUE.md`.
- Claude converts approved `planning/BUILD_QUEUE.md` items into atomic `TASKS.md` entries.
- Codex implements only `TASKS.md` entries with `status: codex`.
- Code and docs commit together when a change affects both.
- Run `SELF_REVIEW.md` before `QA.md` after building.
- QA must pass before any production commit. If QA fails, mark the work blocked or return it for fixes.
- Stopping mid-task requires a checkpoint in the appropriate task/status docs.
- `planning/DONE.md` is appended at task completion.
- `docs/DECISIONS.md` gets a `D-0NN` entry only when a non-obvious choice is made or reversed.

## What to Read

Pull only the docs the active task needs.

| Task type | Read |
|---|---|
| New feature or change | Relevant `docs/FEATURES.md` section and `docs/ARCHITECTURE.md` |
| Bug fix | `planning/ROADMAP.md` Known Issues and relevant `docs/ARCHITECTURE.md` section |
| Data, schema, or storage | `docs/DATA_MODEL.md` |
| Refactor or rationale question | `docs/DECISIONS.md` and `docs/ARCHITECTURE.md` |
| PRD or IRD-driven work | Applicable file in `library/requirements/...` before implementation |
| OS-level change | `AI-DEV-OS.md` and `SYSTEM-OVERVIEW.md`; update both in the same commit |
| Triage captures | `captures/README.md`, `docs/PROJECT.md`, and `planning/ROADMAP.md` |
| Codex implementation | `TASKS.md`, `AGENTS.md`, acceptance checklist, listed files, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` |

## Claude Workflow

### Product Manager

- Score and prioritize work against `docs/PROJECT.md` north-star goals.
- Keep triage in `planning/PROPOSALS.md` until human approval.
- Do not schedule or build unapproved ideas.

### Tech Lead

- Convert approved `planning/BUILD_QUEUE.md` items into small, independently testable tasks.
- Write clear objective, files, acceptance criteria, and expected verification in `TASKS.md`.
- Set new implementation tasks to `status: codex`.
- Make `TASKS.md` complete enough that Codex does not need `planning/BUILD_QUEUE.md`.

### Definition of Ready

Before assigning work to Codex, ensure every task contains:

- objective
- owner
- status
- files
- acceptance criteria
- constraints
- verification steps

Codex should never have to infer missing requirements.

### Architect

- Keep `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/FEATURES.md`, and
  `docs/DECISIONS.md` consistent with the code.
- Preserve the existing one-file, no-framework architecture unless a deliberate decision changes it.
- For OS-level workflow changes, update `AI-DEV-OS.md` and `SYSTEM-OVERVIEW.md` in the same commit.

Whenever a design decision changes project behavior or introduces a new convention:

- Update `docs/DECISIONS.md`.
- Explain why.
- Reference the task ID.

### Reviewer

- Review Codex branches by reading the diff, `CHANGELOG.md`, `TEST_REPORT.md`, and acceptance criteria.
- Verify correctness, security, architecture fit, and hard-rule compliance.
- Never rubber-stamp. If anything is wrong, write must-fix items in `REVIEW.md`.
- If rework is needed, set the task back to `status: codex`.
- Do not edit `CHANGELOG.md` or `TEST_REPORT.md`.

#### Risk-gated merge — choose the approved status by what the task TOUCHES (D-032)

An approved review has **two** landing states. Pick by blast radius, not by confidence:

| Status | Meaning | Effect |
|---|---|---|
| `done` | Approved **and reversible** — UI, CSS, copy, additive non-data features. | **Auto-merges** to `main` and deploys (D-027). No human step. |
| `approved` | Approved **but red-zone** — Firestore/sync/storage, the tombstone-merge-deletion machinery, `saveData()` / the `cloudReady` write-guard, auth, security, or the AI Dev OS / automation itself. | **Held.** `main` is NOT merged; the human eyeballs the branch and merges. |

Why: a broken UI change is reverted in a minute; **lost user data cannot be reverted at all** (north-star
goal #2). Red-zone work therefore never auto-ships. When torn between `done` and `approved`, choose
`approved`. State which gate you picked, and why, at the end of the `REVIEW.md` entry.

### Definition of Done

A task is considered complete only if:

- Every acceptance criterion passes.
- No hard rules were violated.
- Tests pass.
- Documentation has been updated when required.
- `REVIEW.md` contains an approval.
- `TASKS.md` status is `done`.

If any item is missing, the task is not complete.

## Codex Workflow

Codex follows `AGENTS.md`. Summary:

1. Open `TASKS.md` and find the first task with `status: codex`.
2. Read the task acceptance checklist and listed files.
3. Read `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.
4. Implement on branch `task-<id>`.
5. Run `npm test`.
6. Append completion evidence to `CHANGELOG.md` and `TEST_REPORT.md`.
7. Set the task `status` to `review` in `TASKS.md`.
8. If blocked, set `status: blocked` and record the blocker under the task.

Codex never uses `planning/BUILD_QUEUE.md` to choose work.

## Decision Priority

When multiple instructions conflict, follow this priority:

1. Human instructions
2. Hard Rules
3. Approved Architecture
4. `TASKS.md` acceptance criteria
5. Existing code style
6. General best practices

Do not violate a higher-priority rule to satisfy a lower-priority one.

## Hard Rules

0. **Keep OS docs in sync.** Update `AI-DEV-OS.md` and `SYSTEM-OVERVIEW.md` in the same commit whenever
   OS-level infrastructure changes: agents, workflow events, pipeline changes, or new hard rules.
1. **Nothing builds without human approval.** Triage routes, Sprint Planning schedules, Builder builds.
   Do not cross lanes. See DECISIONS D-015.
2. **Codex builds only from `TASKS.md`.** `planning/BUILD_QUEUE.md` is Claude's planning input, not
   Codex's execution source.
3. **Quote recipe ids in handlers:** `onclick="openEditRecipeModal('${recipe.id}')"` because Firestore
   ids are strings. Unquoted ids render as bare identifiers and break.
4. **Patch old recipes after storage load:** call `patchMissingNutrition(AppState.recipes)` after loading
   recipes from storage. Old saved recipes are missing later-added fields. See DECISIONS D-005.
5. **Persist through `saveData()`.** It writes both localStorage and Firestore. Do not call
   `saveToLocalStorage()` alone or a signed-in user's next refresh reloads the old cloud copy.
6. **Never write to Firestore before reading it.** `saveToFirestore()` is gated on
   `AppState.cloudReady`; do not bypass the guard. Writing early can overwrite a signed-in user's
   cloud doc with empty state. See DECISIONS D-010.
7. **Never add a second `:root` block** in `style.css`; it overrides dark mode.
8. **Reference stable anchors in docs:** function/object names, DOM ids, Firestore paths, and
   localStorage keys. Never line numbers. See DECISIONS D-008.
9. **Match existing style.** One file, global functions, imperative `render*()`. Do not introduce a
   framework, build step, or module system. See DECISIONS D-001.
10. **High-risk sprints are never chained.** `Risk: High` forces solo execution regardless of what
    `Execution:` says in a `TASKS.md` group header — Codex re-verifies both fields fresh at every
    task boundary. See DECISIONS D-023.

## Tooling Gotchas

- PowerShell `Add-Content` can mangle Unicode. Use reliable edit/write tools for files with emoji or
  special characters.
- Autonomous Claude sessions run via `run-claude.ps1`; it reads `CLAUDE.md`, `STATUS.md`,
  `planning/TASK.md`, then runs triage on `captures/inbox/`.
- PowerShell `$ErrorActionPreference = 'Stop'` promotes ANY stderr text from a native command into a
  terminating exception — even routine progress output on a fully successful call (`git rebase`'s
  "Rebasing (1/1)", git's LF/CRLF notice). Any script with `$ErrorActionPreference = 'Stop'` at the
  top needs its `Invoke-Git`-style wrapper to lower EAP to `'Continue'` for the duration of each
  native call (see `Dispatch-Commands.ps1`'s and `Run-Merge.ps1`'s `Invoke-Git`). Has broken two
  different scripts this way; test any change to error handling under the script's own real EAP
  setting, not in a bare isolated snippet — see DECISIONS D-044's addendum for a case where that
  exact shortcut in verification missed the bug.
- When Claude implements a D-040 automation-surface task directly, the `TASKS.md` entry (and any
  `docs/DECISIONS.md` record) goes to `main` in its own commit — never bundled into the task
  branch's commit alongside the code. `/merge` reads `TASKS.md` from `main`, not the branch; see
  DECISIONS D-040's addendum.
- The Command Dispatcher scheduled task doesn't always respond promptly to a programmatic
  `Start-ScheduledTask` trigger. Running `tools/Dispatch-Commands.ps1` directly is the reliable way
  to force immediate processing. See `docs/AI_OS_NOTES.md`.

## Deploy

```bash
git add app.js style.css index.html
git commit -m "..."
git push origin main
```

GitHub Pages auto-deploys from `main` in about one minute.

## Common Commands

- Next: Read-only. Determines the active milestone, current task, and current owner, then
  recommends the exact next command (`Continue`, `Plan`, `Review`, or `Status`). Never modifies files.
- Plan: Claude reads `PLAN.md`, approved planning inputs, and `TASKS.md`, then creates ready Codex
  tasks — and, for a task group, may classify `Risk` and set `Execution: Chained` with semantic
  `checkpoint:` labels (Sprint Execution Mode).
- Review: Claude reviews the task branch, `CHANGELOG.md`, `TEST_REPORT.md`, and acceptance criteria,
  then writes `REVIEW.md` — for a chained group, one entry per checkpoint, bucketed into
  approved/blocked/rework/skipped.
- Continue: Codex resumes from the first `TASKS.md` item with `status: codex` — chaining through a
  group only when its header says `Risk: Low` or `Medium` and `Execution: Chained`.
- Status: Read `TASKS.md` and report counts, active task, blockers, and current owner.

## Next Command

`Next` answers "who acts, and with what command?" — read-only, no file writes.

Reads: `STATUS.md`, `PLAN.md`, `TASKS.md`, `REVIEW.md`, `planning/BUILD_QUEUE.md`.

Priority order for the current task in `TASKS.md` (first match wins; ties broken by file order):

1. `blocked` → Claude → Review
2. `review` → Claude → Review
3. `approved` → Claude → Review
4. `codex` → Codex → Continue
5. `in-progress` → Codex → Continue
6. `todo` → Claude → Plan

If every task is `done`, or `TASKS.md` has no entries: check `planning/BUILD_QUEUE.md`.
- An approved item not yet reflected in `TASKS.md` → Claude → Plan.
- Nothing approved (queue empty, or everything left is `Deferred`) → Status.

This also covers a milestone whose tasks are all `done` but whose `PLAN.md` `Status` still says
`in-progress`: `Next` reports the milestone as complete but does not edit `PLAN.md` — that update
happens when Claude actually runs `Plan`.

Output is exactly:
```
NEXT
milestone : <goal> [<status>]
task      : <id — title> [<status>]
owner     : Claude | Codex
why       : <one sentence>
run       : <Continue | Plan | Review | Status>
```

`Next` never edits `TASKS.md`, `PLAN.md`, `REVIEW.md`, or any other file — it only reports. See
DECISIONS D-021 for why it stays read-only.

## Sprint Execution Mode

Default behavior is unchanged: Codex builds one `TASKS.md` task per `Continue`, Claude reviews
each one solo. Sprint Execution Mode is an opt-in exception Claude grants explicitly to a group of
already-Ready tasks sharing one `source:` — it changes *when* Codex hands off for review, never
what evidence each task produces. Every task still gets its own acceptance criteria, its own
`CHANGELOG.md`/`TEST_REPORT.md` entry, and its own verdict.

### Risk (no task-count cap, at any tier)

Claude classifies the whole task group by its single highest-risk member:

- **Low** — mechanical, repetitive, single-concern edits (the same proven pattern applied across
  multiple files/elements), test-fixture-only fixes, docs-only edits. May contain many tasks.
- **Medium** — real logic changes (new function, new state, non-trivial conditionals), but nothing
  touching a Hard Rule surface. Keep the group to one coherent, dependency-chained slice.
- **High** — any task touches a Hard Rule surface (Firestore write/read-guard code, `saveData()`
  call sites, recipe-id `onclick` handlers, the `:root` CSS block) or touches architecture, auth,
  security, database/schema, or the AI Dev OS/workflow files themselves. **Never chained** — see
  Hard Rule 10.

A mixed-risk group is classified at its highest risk. Split a High-risk task into its own group
rather than carving out an exception for it inside a Low/Medium one.

### Marking a group for chained execution

One extended header on the existing `TASKS.md` section-divider comment. No new file, no new
per-task field beyond an optional `checkpoint:` label:

```
<!-- ═══════════════════════════════════════════════════════
     BQ-016 · Modal mobile-footer-stacking fix
     Risk: Low · Execution: Chained
     ═══════════════════════════════════════════════════════ -->
```

Each task may carry:

```
checkpoint: Modal CSS migration complete
```

A checkpoint is a **semantic** label Claude writes after a real engineering boundary — "Modal CSS
migration complete", "Playwright stabilization complete", "Authentication UI complete" — never a
count or a duration. Codex chains through same-`source:`, same-`checkpoint:` tasks; once the next
ready task's `checkpoint:` differs (or there is no next ready task sharing it), that checkpoint is
complete — Codex stops and hands off for Review there, even if later checkpoints in the same group
still have `status: codex` tasks waiting. If no task in the group carries a `checkpoint:`, the
whole group is one implicit checkpoint (stop only once it runs out of ready tasks — today's
end-of-run behavior).

Absent `Risk`/`Execution` entirely = today's behavior exactly: one task per `Continue`.

### When a task inside a chained group fails

Codex does not stop the whole group just because one task is blocked:

1. Mark that task `status: blocked`; record the blocker under it, same as always.
2. If verification was attempted, append the `TEST_REPORT.md` entry regardless of outcome.
3. For each remaining `status: codex` task in the current checkpoint:
   - Depends (directly or transitively) on the blocked task → leave it `status: codex` untouched;
     note the skip in `CHANGELOG.md`; move to the next candidate.
   - Independent of the blocked task → implement it normally, continuing the chain.

Codex must stop the **entire group** — not just skip one task — if:
- the blocked task is a dependency for most/all of what's left (nothing genuinely independent
  remains),
- the blocker looks like an architecture/scope issue affecting the whole group, not just one task,
- a test failure could invalidate assumptions a later task in the group relies on, or
- the next task touches the same file/region the blocked task's fix was going to touch.

### How Claude reviews a chained group

One `REVIEW.md` entry per checkpoint, bucketed — never a single bulk stamp:

- **Approved** — acceptance criteria and evidence hold up → `status: done`.
- **Blocked** — still needs Claude's resolution → stays `blocked`.
- **Rework** — fully attempted but doesn't pass review → `status: codex`, and permanently exits
  chained execution (no re-entry — handled solo from here).
- **Skipped (dependency)** — untouched because it depends on a blocked task → stays `status:
  codex`, reconsidered once that dependency clears.

A group is a scheduling optimization, not a package deal: one task failing review never
invalidates its already-correct siblings. See DECISIONS D-023.

## Extensibility

Additional AI agents may be added.

Each new agent must:

- have one primary responsibility
- have clearly owned files
- communicate through repository documents
- never duplicate another agent's ownership

The AI team should remain modular.
