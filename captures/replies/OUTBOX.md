## 20260721T1742Z-546-command
2026-07-21T11:12:44.0669671-07:00

HELD (red-zone): TASK-033 - Port ChronaSense's digest-length + stale-lock fixes back here

Touches 2 file(s):
  tools/Dispatch-Commands.ps1
  tools/Generate-Digest.ps1

2 files changed, 76 insertions(+), 7 deletions(-)

Why it was held:
**3. `/status` lock-age addition â€” small, correct, directly closes the "how do I know what's happening" gap.** Previously `/status` reported only "BUSY" with no duration; a human checking mid-hang would have seen the same output as checking during a completely normal run. Now reports elapsed minutes using the same `LastWriteTime` check the stale-lock fix itself relies on.
Gate picked: `approved` (red-zone: touches `tools/Generate-Digest.ps1` and `tools/Dispatch-Commands.ps1` directly â€” the AI Dev OS itself). Same disclosed same-session caveat as TASK-014/016/031/032 (Claude both built and reviewed this diff) â€” mitigated by testing against this app's own real data plus a direct diff against an independently fixture-tested source, rather than a second read of the same code.
â†’ TASK-033 status set to `approved` in TASKS.md. Land with `/merge TASK-033` then `/merge TASK-033 yes`.

Read the diff before you answer:
  https://github.com/shinyamadasan/Meal-Prep/compare/main...task-033

To land it:  /merge TASK-033 yes
Nothing has been merged. main is untouched.
