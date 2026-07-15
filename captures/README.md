# Captures — mobile capture pipeline

Telegram → n8n → here. **n8n only ever creates files in `inbox/`** (one immutable file per capture).
It never edits planning files. All judgment happens later, in the Claude run's **Triage** event.

```
Telegram  →  n8n (dumb capture)  →  captures/inbox/<id>.md
                                          │  Claude run: Triage
                                          ├─ route + enrich → planning/PROPOSALS.md (pending your approval)
                                          └─ archive → captures/processed/YYYY/MM/<id>.md
```

## Flow
1. **n8n** writes one file per Telegram message to `inbox/` (see format below). No AI, no parsing of
   planning files — just create the file. The slash command *is* the category.
2. **Claude**, at the start of each run (Triage event in `../WORKFLOW.md`), processes every
   `inbox/*.md`: categorize, **dedupe** against PROPOSALS/ROADMAP/DONE, **score against the North-star
   goals in `../docs/PROJECT.md`**, estimate priority + complexity, write acceptance criteria and
   likely-affected files, then writes an **enriched proposal** — led by a recommended `▶ Decision`
   (Approve / Park / Reject / Clarify) — into `../planning/PROPOSALS.md`. Nothing is scheduled or
   built here; that only happens after you approve it (Hard Rule 1, DECISIONS D-015).
3. Claude then **archives** the processed capture to `processed/YYYY/MM/<id>.md` (immutable history of
   *why* something became a proposal) and appends a one-line triage summary to `../STATUS.md`.

`inbox/` should be empty between runs. `processed/` is the permanent provenance log.

## Capture file format (what n8n writes)
Filename: `captures/inbox/<UTC-timestamp>-<telegram_msg_id>-<command>.md`
e.g. `captures/inbox/20260625T1430Z-7842-feature.md`

```markdown
---
id: 20260625T1430Z-7842-feature
command: /feature
type: feature
captured: 2026-06-25T14:30:11Z
via: telegram
msg_id: 7842
status: new
---

Add dark mode.
```

The `id` (timestamp + Telegram `msg_id`) is the **idempotency key**: if the same `id` already appears
in ROADMAP/DONE/processed, Triage skips it (an n8n retry can't create a duplicate task).

## Routing by command
Every capture — whatever its tag — lands in `planning/PROPOSALS.md` pending your approval. **No tag
skips that gate** (Hard Rule 1); the tag only feeds Triage's categorization and its recommended
`▶ Decision`, which shifts by type:

| command | type | Triage's typical recommendation |
|---|---|---|
| `/feature`, `/todo` | feature / chore | usually Approve |
| `/bug` | bug | Approve if it blocks use, else Park |
| `/idea` | idea | usually Park |
| `/research` | research | usually Park |
| *(no command)* | unknown | Claude infers the type, then recommends normally |

The recommendation is only a suggestion in the proposal — you still have to reply `Approve N` (or
`Accept` to take every recommended verdict at once) before anything reaches `BUILD_QUEUE.md`.
