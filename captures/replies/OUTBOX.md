## overnight-20260822T020002Z
2026-08-22T02:00:02.4627740-07:00

AUTOMATION ABORTED (Preflight -- Correct branch)
Automation only runs from a clean main branch -- repository is on 'wave-kitchen-truth'.

Action needed: git checkout main / git status

---

## session-20260822T1730Z-notifications
2026-08-22T17:36:15.828Z

✅ Food Attention Notifications shipped — main @ da10ab6, live on Pages.

Opening the app now tells you when food expired or needs using soon. One grouped
alert, never one per ingredient, and it never tells you to eat expired food — it
sends you to the Needs Attention card where Keep / Remove already live. Unchanged
food never nags you twice.

What I did NOT build: real push. A static GitHub Pages app cannot notify you while
it is closed without a whole backend (push server + per-device subscriptions +
a scheduler reading your inventory). I hit your decision gate and stopped there.
The Settings row says so in plain words rather than implying alerts you would never
get. Installed-PWA app-icon badge is the one away-from-app signal that works.

Tests: 183 passed, 4 skipped, 0 failed. CI green. Production smoke 9/9 headed
against the live site. Deployed bytes byte-compared to the commit, not assumed.

⚠ STILL OWED — needs your phone (no Android device reachable from the PC):
install the PWA, enable alerts, tap the notification, check the launcher badge.

FYI the 02:00 alert above is stale — that branch is long merged; repo is on clean main.
