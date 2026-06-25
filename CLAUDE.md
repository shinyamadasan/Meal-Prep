# Meal Prep Planner — Agent Router

Plain HTML/CSS/JS single-page app. No build step, no framework. Firebase Auth + Firestore with
localStorage offline fallback. Deployed on GitHub Pages (auto-deploys from `main`).
Files: `app.js` (all logic, ~8,800 lines), `index.html` (all tabs/modals inline), `style.css`.

This file is the **router**. Read it + `STATUS.md` first, then pull only the docs the task needs.

## Documentation map
| File | What's in it | Source of truth for |
|---|---|---|
| `STATUS.md` (root) | Current state, last shipped, blockers | Where we are right now |
| `TASK.md` (root) | The **single active task** (objective, step, success criteria, DoD) | What to do *right now* (tactical) |
| `ROADMAP.md` (root) | Task queue, Known Issues & Debt, Do Not Work On | Priority & open defects (strategic) |
| `WORKFLOW.md` (root) | Task-driven lifecycle: the 6 events, when each doc is read/updated | *When* to read/update docs (the protocol) |
| `PROMPTS.md` (root) | Reusable prompts (P1 idea→TASK, fix, audit, checkpoint, resume, …) | How to frame recurring work (not auto-read) |
| `docs/PROJECT.md` | What/why/who, non-goals | Product intent & scope |
| `docs/ARCHITECTURE.md` | Subsystems by named entry point, data flow, sync | System design & "where does X live" |
| `docs/DATA_MODEL.md` | AppState, Recipe, Firestore, localStorage, hardcoded DBs | Data shapes & storage keys |
| `docs/FEATURES.md` | Feature catalog by tab + status | Feature existence & status |
| `docs/DECISIONS.md` | Why the key choices were made (ADR-lite) | Rationale; "don't undo this" |

Code is the source of truth for *how things behave*; docs are the source of truth for *why & where*.
If a doc disagrees with the code about behavior, fix the doc.

## Lifecycle
Work is **task-driven**, not session-driven — there is no "session end". Read `WORKFLOW.md` for the
full event model (Planning · Execution · Checkpoint · Task Completion · Commit · Next Task Selection).
The essentials:
- **Always read first:** this file (auto) + `STATUS.md` + `TASK.md`. `TASK.md` is what you work on —
  don't pick from the roadmap; a human already promoted today's task.
- **Code + docs commit together.** Doc updates ride in the same commit as the code — never deferred.
- **`STATUS.md` updates only at Checkpoint and Task Completion.** **`ROADMAP.md` advances only at
  Next Task Selection** (promote top of queue, FIFO). **`DECISIONS.md`** gets a `D-0NN` entry only
  when a non-obvious choice is made/reversed.
- Stopping mid-task = perform a **Checkpoint** (persist `TASK.md` Current Step + `STATUS.md`), then stop.

## What to read (per task)
Pull **only** the docs the active task needs:
| Task type | Read |
|---|---|
| New feature / change | relevant `docs/FEATURES.md` section + `docs/ARCHITECTURE.md` |
| Bug fix | `ROADMAP.md` (Known Issues) + relevant `docs/ARCHITECTURE.md` section |
| Data / schema / storage | `docs/DATA_MODEL.md` |
| Refactor / "why is it like this?" | `docs/DECISIONS.md` + `docs/ARCHITECTURE.md` |

Don't load every doc; pull the row(s) for the task at hand.

## Hard rules (these cause bugs if violated)
1. **Quote recipe ids in handlers:** `onclick="openEditRecipeModal('${recipe.id}')"` — Firestore ids
   are strings; unquoted they render as bare identifiers and break.
2. **After loading recipes from storage, call `patchMissingNutrition(AppState.recipes)`** — old saved
   recipes are missing later-added fields (see DECISIONS D-005).
3. **Persist through `saveData()`** — it writes BOTH localStorage and Firestore. Don't call
   `saveToLocalStorage()` alone, or a signed-in user's next refresh reloads the old cloud copy.
4. **Never add a second `:root` block** in `style.css` — it overrides dark mode (already broke once).
5. **Reference stable anchors in docs** — function/object names, DOM ids, Firestore paths,
   localStorage keys. **Never line numbers** (DECISIONS D-008).
6. **Match existing style.** One file, global functions, imperative `render*()`. Don't introduce a
   framework, build step, or module system (DECISIONS D-001).

## Tooling gotchas
- PowerShell `Add-Content` mangles Unicode — use the Edit/Write tools for any file with emoji/special chars.
- Autonomous sessions run via `run-claude.ps1`; it reads `ROADMAP.md`, `STATUS.md`, `CLAUDE.md` first.

## Deploy
```
git add app.js style.css index.html
git commit -m "..."
git push origin main
```
GitHub Pages auto-deploys from `main` (~1 min to go live).
