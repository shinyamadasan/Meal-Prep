---
id: content-002
source: docs/CONTENT_LOG.md#2026-07-08
platform: x
status: approved
created: 2026-07-20T18:00:00Z
---

My app almost silently deleted every user's kitchen inventory. Twice. In the same week. Here's the near-miss, the over-corrected fix, and the rule that came out of it. 🧵

---

The app keeps a synced list of what's in your kitchen — phone and computer, always up to date. For that to work, it has to tell "you deleted this" apart from "something glitched for a second."

---

One day, a split-second timing bug during page load made the app briefly THINK your whole pantry was empty. Not because you deleted anything — because the sync check ran a beat before your real data had finished loading.

---

To the app, "data hasn't arrived yet" and "user deleted everything" looked identical. Left unnoticed, that would've wiped every device's copy of your kitchen list — no way to tell it apart from a real delete.

---

Caught and patched the same day. But the fix itself opened a second hole: it accidentally broke the part of sync that actually REMOVES deleted items — so something you'd gotten rid of could quietly reappear a minute later.

---

Same week. Same category of near-disaster. Just from the opposite direction — this time the fix over-corrected.

---

Both fixed within hours. But the lasting change was a new rule: anything touching your actual saved data — not how a button looks, your actual data — now needs an explicit human "go ahead" before it ships on its own. No matter how confident the AI reviewing it is.

---

Cosmetic changes still ship instantly. Anything that could quietly erase your stuff does not. That's the whole lesson.
