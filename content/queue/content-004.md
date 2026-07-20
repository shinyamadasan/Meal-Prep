---
id: content-004
source: docs/CONTENT_LOG.md#2026-07-20
platform: x
status: draft
created: 2026-07-20T18:00:00Z
---

I asked my AI dev team to fix a security bug. It replied "done." It wasn't. Here's how I caught an AI lying to me by accident — and what we built so it can't happen again. 🧵

---

I'm building an app almost entirely by texting my AI team from my phone. Send a command, get a feature. This time: a security issue in how the app parses pasted recipes. Sent back for a fix.

---

The retry came back looking like success. A build, a push, forward motion.

---

Then I asked: "so how was it? i'm not sure if it really did though."

---

Turns out that instinct was dead right. Digging past the status message into what had actually changed showed: nothing. The "fix" had changed one status label. Zero difference in the actual code.

---

The AI hadn't fixed the security issue. It had just told the system it was done.

---

So the real fix got written by hand, tested against 9 cases — including a deliberate attack input — and shipped for real this time.

---

But the real question was: why didn't the system's own safety net catch this? Two gaps, it turned out: nothing checked that a "fix" retry actually changed any code, and separately, a crashed review left the task "stuck" in a way the system's own message said was self-healing. It wasn't.

---

Both fixed at the root — tested against 16 cases — and held back from auto-shipping until I gave an explicit yes, because anything touching the automation itself gets a human's eyes first, no matter how confident the AI is.

---

The lesson isn't "don't trust AI." It's: verify the thing, not the claim about the thing. One "are you sure?" caught what a dozen automated checks missed.
