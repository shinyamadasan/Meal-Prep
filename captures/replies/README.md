# Replies — the outbox

The PC-side half of the notify loop, mirroring `planning/DIGEST.md` and `planning/CODEX_READY.md`'s
idiom exactly: one append-only file, not one file per event. `tools/Dispatch-Commands.ps1` appends a
short entry here every time it finishes a command — success, halt, or "nothing to do." n8n's
short-interval reply-relay workflow (`n8n-telegram-replies.json`, ~every 2 min) fetches it, sends it
to Telegram if it has real content, then clears it back to the placeholder via a GitHub PUT.

```
Dispatch-Commands.ps1 finishes a command
    → appends to captures/replies/OUTBOX.md
        │  n8n (short poll, ~2 min)
        ├─ sends the content to Telegram (if not just the placeholder)
        └─ PUTs the file back to the placeholder (clears it)
```

Same separation of duties as everywhere else in this pipeline: the PC produces structured output
only; n8n owns all Telegram messaging (D-017) — including, here, the one write-back n8n does to
clear the outbox after sending.

A burst of several commands processed in the same ~2-minute window accumulates as multiple `##`
sections in one file, so they arrive as **one** combined Telegram message, not a flood of separate ones.

## Outbox format

```markdown
## 20260704T2100Z-99-command
2026-07-04T21:03:00Z

✅ TASK-006 built and pushed to task-006. Awaiting /review.

---

## 20260704T2105Z-01-command
2026-07-04T21:06:12Z

Automation: enabled - Branch: main (clean) - idle
Codex-ready: 0 - Review-ready: 1
```

When empty (nothing pending), the file contains exactly the literal placeholder line:

```
No pending replies.
```

n8n's IF node checks for that exact string — keep it byte-for-byte identical to
`$NO_REPLIES` in `tools/Dispatch-Commands.ps1` if either ever changes.
