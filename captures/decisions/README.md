# Decisions — the approval reply inbox

The **reply** half of the gated pipeline, mirroring `captures/inbox/` exactly:
**n8n only ever creates files here** (one immutable file per Telegram approval reply). It never edits
planning files. All logic happens later, in the deterministic applier `tools/Apply-Decisions.ps1`.

```
Telegram reply  →  n8n (dumb transport)  →  captures/decisions/<id>.md
                                                  │  Apply-Decisions.ps1 (code, no LLM)
                                                  ├─ mark PROPOSALS.md status (approved/parked/rejected)
                                                  └─ append Approved → planning/BUILD_QUEUE.md  →  Builder
```

n8n's job is messaging/transport only; parsing the reply and updating planning files is deterministic
code on the PC. (Separation of duties — same split as captures.)

## Decision file format (what n8n writes)
Filename: `captures/decisions/<UTC-timestamp>-<telegram_msg_id>-decide.md`

```markdown
---
id: 20260626T0701Z-45-decide
kind: decision
captured: 2026-06-26T07:01:00Z
via: telegram
msg_id: 45
status: new
---

Approve 2 3 4
Park 7
Reject 12
```

The body is the **raw reply text**. The applier scans it for the verbs `approve | park | reject |
clarify` followed by proposal numbers (e.g. `2 3 4`), in any order, across lines. Numbers map to
`PROP-00N`. Anything that isn't a verb+number (a question like "tell me more about 5") is ignored —
those are for a human/Claude to answer, not the gate.

## What the applier does per verb
| reply | PROPOSALS.md status | BUILD_QUEUE.md |
|---|---|---|
| `Approve N` | `approved <date>` | appends a `BQ-NNN` item (built next run) |
| `Park N`    | `parked <date>`   | — |
| `Reject N`  | `rejected <date>` | — |
| `Clarify N` | `clarify <date>`  | — (waits for your answer) |

`status: new` → `applied` once processed (idempotent; an n8n retry can't double-apply).
`processed/` keeps the permanent record of every decision.
