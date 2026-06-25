# AI Dev OS — Template & App-Creation System

> The reusable operating system this app runs on. Everything listed as **generic** is product-agnostic:
> clone it to start a new app, fill in the app-specific files, and you inherit the whole pipeline:
>
> **Capture → Plan → Build → Self Review → QA → Document → Commit → Deploy → Human Review.**
>
> Two checklists gate every commit — **Self Review** (`SELF_REVIEW.md`, "is it good code?") and
> **QA** (`QA.md`, "does it work?"). AI-verifiable checks block commits; human-only checks are logged,
> never faked. (DECISIONS D-009, D-011, D-012, D-014.)

**Version: v1.0 — locked 2026-06-25.** The OS is good enough to build products on. Further changes
should be *deliberate* (a real friction surfaced during use), not reflexive. The success test isn't
how many docs it has — it's whether, months from now, a brand-new app is productive on **day one**
because the whole engineering workflow comes with it.

## Generic — the OS (clone as-is into a new app)
| File / folder | Role | Per-app change |
|---|---|---|
| `CLAUDE.md` | Router: doc map + read/update protocol + hard rules | Replace the project summary + hard rules |
| `WORKFLOW.md` | Task-driven lifecycle (Triage + 7 events) | none |
| `SELF_REVIEW.md` | Code-health gate ("would I ship this?") | tweak the "existing patterns" line |
| `QA.md` | Correctness gate | swap the `[app]`-tagged checks |
| `PROMPTS.md` | P1–P10 reusable prompts | none |
| `OPERATOR.md` | Human playbook (principles + rhythm) | none |
| `GUIDE.md` | Phone capture card | none |
| `run-claude.ps1` · `setup-task-scheduler.ps1` | Scheduled autonomous runs | set project path |
| `n8n-telegram-inbox.json` | Mobile capture workflow | set repo, bot token, user id |
| `captures/` (inbox · processed · README) | Capture pipeline scaffold | start empty |
| `planning/` (ROADMAP · TASK · DONE) | Strategy/tactics scaffold | start empty |
| `STATUS.md` | Working-memory scaffold | start empty |
| `docs/DECISIONS.md` | ADR-lite scaffold | keep D-001 (no-framework) if it applies |

## App-specific — fill in per app
| File | What you write |
|---|---|
| `CLAUDE.md` project block + hard rules | Stack, the 3 files, and the bug-causing rules |
| `docs/PROJECT.md` | What/why/who + **North-star goals** (triage scores against these — write them first) |
| `docs/ARCHITECTURE.md` | Subsystems by named entry point, data flow |
| `docs/DATA_MODEL.md` | State shapes, storage keys, hardcoded DBs |
| `docs/FEATURES.md` | Feature catalog by area + status |
| `QA.md` `[app]` items | The app's hard-rule greps |

## Bootstrap a new app
1. **Copy** the generic file set into the new repo.
2. **Empty** the instance files: `planning/*`, `STATUS.md`, `captures/inbox/*`; clear `docs/PROJECT|ARCHITECTURE|DATA_MODEL|FEATURES`. Keep `docs/DECISIONS.md` as a starting log.
3. **Write `docs/PROJECT.md` first** — especially the North-star goals; triage ranking depends on them.
4. **Fill `CLAUDE.md`'s** project summary + hard rules.
5. **Swap the `[app]` checks** in `QA.md` for the new app's hard-rule greps.
6. **Wire capture:** import `n8n-telegram-inbox.json` (new repo + bot token + your Telegram id); register `run-claude.ps1` in Task Scheduler.
7. **Seed work:** write the first task into `planning/TASK.md` (or the `ROADMAP.md` queue) and go.

## What "generic vs app-specific" buys you
The boundary is the whole point: the **protocol** (how work flows, how quality is gated) is identical
across products, while the **content** (what the app is, its rules) is per-app. New apps start with a
mature pipeline on day one instead of re-inventing process.

## Not yet done — true extraction (parked)
Today the OS and this app share one repo. To make cloning real, lift the generic set into its own
`ai-dev-os/` repo and consume it via template-repo / submodule / copy-on-init. See ROADMAP → Research.
This file is the manifest that extraction will follow.
