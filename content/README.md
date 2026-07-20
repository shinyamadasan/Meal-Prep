# Content — build-in-public posting pipeline

Claude drafts → you approve → n8n posts. No copy-paste.

```
docs/CONTENT_LOG.md  →  Claude drafts a thread  →  content/queue/<id>.md (status: draft)
                                                        │  you reply "Approve <id>" on Telegram
                                                        ▼
                                              status: approved (queued)
                                                        │  n8n's scheduled poster picks the OLDEST
                                                        │  approved file, posts it to X, waits for
                                                        │  the next scheduled slot before posting another
                                                        ▼
                                          content/posted/YYYY/MM/<id>.md (status: posted, posted_at set)
```

## Flow
1. Whenever `docs/CONTENT_LOG.md` gets a new entry, Claude drafts a matching thread into
   `queue/<id>.md` with `status: draft`. You don't have to ask — it happens in the same pass.
2. You review pending drafts (surfaced in your Telegram digest, same idea as pending proposals) and
   reply `Approve <id>` when one's ready to go out. Editing before approving is just: ask Claude to
   revise it, or hand-edit the file directly.
3. An n8n scheduled workflow drains `status: approved` files at a fixed cadence (starts at one
   thread every 2 days — tune in the n8n workflow if you want faster/slower) — so you can approve a
   whole batch at once and it trickles out on its own. No manual posting step, ever.
4. Once posted, the file moves to `posted/YYYY/MM/<id>.md` with `status: posted` and `posted_at` set
   — permanent record of what went out and when.

## Queue file format
Filename: `content/queue/<id>.md`, e.g. `content/queue/content-001.md`

```markdown
---
id: content-001
source: docs/CONTENT_LOG.md#2026-06-26
platform: x
status: draft
created: 2026-07-20T18:00:00Z
---

Tweet 1 text (the hook)

---

Tweet 2 text

---

Tweet 3 text
```

Each `---`-delimited block in the body is one post in the thread, posted in order (tweet 2 replies
to tweet 1, tweet 3 replies to tweet 2, etc.) — same convention as this repo's own markdown docs
using `---` as a section break, repurposed here as a tweet break.

## Status values
`draft` → `approved` → `posted`. (`rejected` if you'd rather it never go out — leave it in `queue/`
with that status; Claude won't re-draft the same source entry.)

## Ownership
Claude owns drafting (writes to `queue/` only, never flips `draft` → `approved` itself — that's your
call, always). The n8n poster workflow owns `approved` → `posted` and the move into `posted/`. This
pipeline is independent of the app's own TASKS.md/REVIEW.md loop — a content posting mistake is
low-stakes and reversible (delete a tweet), so it doesn't need the same red-zone/hard-rule machinery
the app code does.
