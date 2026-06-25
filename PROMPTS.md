# Prompts — reusable session prompts

> A library of named, parameterized prompts for the recurring kinds of work on this project.
> Copy one, fill the `<…>` placeholders, and paste it into Claude Code — or use **P1** to turn an
> idea into a `TASK.md` entry for an autonomous run.
>
> Each prompt **references** the conventions in `CLAUDE.md` instead of restating them, so this file
> can't drift from the rules. Not auto-read every session — it's a tool you reach for to start work.

## How to use
- **Interactive:** paste a prompt into a Claude Code session and fill the placeholders.
- **Autonomous:** run **P1** to produce a clean `TASK.md` entry, then let the scheduled agent execute it.
- Keep them short — project context comes from `CLAUDE.md` and the docs it routes to, not from here.

---

## P1 — Draft a task (idea → TASK.md)
*Use when you have a rough idea and want an agent-executable task.*
```
Read CLAUDE.md and the docs it routes to for this area. Turn the idea below into a TASK.md entry
using its exact template (Objective / Current Step / Success Criteria / Definition of Done).
Make every success criterion verifiable by code inspection. Reference stable anchors (function
names, DOM ids, AppState keys) — never line numbers. Do NOT implement yet; just write the task
into TASK.md (or append it to the ROADMAP Task Queue if I say so).

Idea: <one or two sentences>
```

## P2 — Implement a feature
*Use when TASK.md (or you) defines a feature to build.*
```
Implement the active task in TASK.md. Follow CLAUDE.md's hard rules (quote recipe ids; persist via
saveData(); patchMissingNutrition() after loading recipes; no second :root; match the no-framework,
single-file style). Read only the docs CLAUDE.md routes you to. When done: verify each success
criterion by tracing the code, then update FEATURES.md status + STATUS.md. (Autonomous: promote the
next ROADMAP queue item into TASK.md.)
```

## P3 — Fix a bug
*Use when something is broken.*
```
Bug: <what's wrong + how to observe it>
Find the root cause before changing anything — state it in one sentence. Make the smallest fix that
addresses the cause, not the symptom. Verify by tracing the code path. Update STATUS.md, and if the
bug was listed under ROADMAP "Known Issues & Debt", remove it there.
```

## P4 — Refactor (behavior-preserving)
*Use when cleaning up without changing behavior.*
```
Refactor: <what and why>
Behavior must not change. List the externally-visible behaviors before you start and confirm each is
preserved after. Touch only what the refactor requires — do not "improve" adjacent code. If you
change a subsystem's shape, update ARCHITECTURE.md. Record any non-obvious choice in DECISIONS.md.
```

## P5 — Audit / re-verify
*Use when checking that docs or a feature match the code.*
```
Audit <FEATURES.md | a specific feature | DATA_MODEL.md> against the current code. Verify each claim
by searching app.js / index.html by function name or DOM id (never line numbers). Report each as
confirmed, wrong, or missing, then fix the doc to match the code — code wins on behavior. Do not
change app logic.
```

## P6 — Record a decision (→ DECISIONS.md)
*Use when you made a non-obvious architectural or tech choice.*
```
Add a DECISIONS.md entry for: <the choice>. Use the next D-0NN id and the file's format (Context /
Decision / Why / Trade-off / Supersedes). Keep it to the rationale and the "don't undo this"
boundary. If it reverses an existing decision, mark the old one "Superseded by D-0NN".
```

## P7 — Session wrap-up
*Use at the end of any session.*
```
Run CLAUDE.md's update protocol: update STATUS.md (last shipped, next action, blockers); update
FEATURES / DATA_MODEL / ARCHITECTURE / DECISIONS as applicable; if a task finished, tick TASK.md and
promote the next ROADMAP queue item into TASK.md (or set it to NO ACTIVE TASK). Then propose a
commit message — do not push unless I ask.
```

---

## Adding your own
Keep each prompt: a name, a one-line "use when", and a short body that defers to `CLAUDE.md` for
rules. If a prompt starts restating conventions, move the convention into `CLAUDE.md` and reference it.
