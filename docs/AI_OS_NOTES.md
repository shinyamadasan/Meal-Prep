# AI OS Notes

> Append-only friction log. One line per workflow awkwardness noticed while working.
> These are candidate improvements to the OS itself — not app bugs.

- 2026-07-16: `Dispatch-Commands.ps1`'s reply-writing step (per-command commit+push to `OUTBOX.md`)
  races with n8n's independent poll-and-clear step on the same file; the PC-side push loses silently
  (never checked) whenever they land close together, leaving an orphaned unpushed local commit that
  later surfaces as a spurious rebase conflict on an unrelated branch. Hit this five separate times
  in one session (each resolved by hand: confirm the orphaned commit's content was already delivered,
  then sync or skip). Not fixed at the root — candidate fix is retry-with-refetch on push failure,
  not yet built.
- 2026-07-16: `Start-ScheduledTask` on the Command Dispatcher task doesn't reliably trigger prompt
  execution when invoked programmatically (two manual triggers produced no dispatcher activity at
  all, confirmed via `claude-session.log` staying untouched) — running
  `tools/Dispatch-Commands.ps1` directly is the reliable way to force immediate processing instead of
  waiting for the next scheduled tick.
- 2026-07-16: when Claude implements a D-040 automation-surface task directly (Codex can't touch
  `tools/`), the task's `TASKS.md` entry and any `docs/DECISIONS.md` record must be committed
  directly to `main` in their own commit — never bundled into the task branch's own commit. `/merge`
  reads `TASKS.md` from whatever's currently on `main`; if the task entry only exists on the branch,
  `/merge TASK-X` fails with "TASK-X is not in TASKS.md" even though the branch is otherwise ready.
  Cost about 15 minutes to diagnose the first time it happened (TASK-019). See D-040.
- 2026-07-20: two compounding gaps let a real security fix silently not-happen while `/go`'s own
  reply text claimed it was self-healing (TASK-025). (1) A rework-strike retry can flip
  `TASKS.md` status forward (`codex` → `review`) without Codex actually changing the code — nothing
  diffs the retry's output against the pre-review version to confirm the must-fix items were
  applied before letting it proceed to re-review. (2) When the follow-up auto-review then crashed
  (`claude -p` exit 1, the same flaky-crash class as TASK-007/014), the resulting `blocked` note
  ("build stopped ... Left at status: review ...") doesn't match either pattern
  `Invoke-Autopilot`'s auto-release regex looks for (`waiting on merge of` / `strike N/3`), so a
  plain `/go` retry would NOT have picked it back up despite the note saying it would. Both were
  only caught because the human asked "are you sure it actually did it" and got the branch/commit
  diff checked by hand. Candidate fixes, not yet built: (a) before advancing a rework-retry past
  `codex`, diff the retry against the must-fix file list and refuse to advance if nothing changed;
  (b) widen the auto-release regex (or the crashed-review note format) so a crashed re-review after
  a real code push is retryable the same way a rework strike is.
- 2026-07-22: a Sprint Execution Mode chained group (TASK-026/027/028, all on shared branch
  `task-027`) left TASK-028 stuck at `status: review` forever after TASK-027's own review approved
  and merged the shared branch — TASK-028's status field was never flipped because nothing in the
  pipeline recognizes "this task's code landed on a DIFFERENT task's branch" as a case to handle.
  `Run-Claude-Review.ps1`'s task-lookup always derives the branch to check out mechanically from the
  task id (`task-<id>`), so every later `/review` (including auto-chains from unrelated builds
  reaching `status: review`) tried to check out a `task-028` branch that correctly never existed,
  aborted with "branch does not exist," and silently blocked whatever review should have run next
  instead (TASK-036's, in this case) — with no error surfaced anywhere that pointed at the real
  cause. Cost a full manual git-archaeology pass (searching all branches/reflog for the "lost" code
  before confirming it was actually already merged) to diagnose. Candidate fix, not yet built: when
  a chained group's task reaches `status: review`, record which branch it actually landed on
  (e.g. a `branch:` field alongside `status:`) so review/lookup doesn't have to assume
  `task-<id>` universally, and so a task whose branch already merged under a sibling's identity can
  be recognized and auto-resolved to `done` instead of retried forever.
- 2026-08-22: headless Chromium **hard-denies** the Notifications permission regardless of
  Playwright's `context.grantPermissions(['notifications'])` — `Notification.permission` reads
  `denied` headless and `granted` headed, confirmed with an isolated probe. Any test asserting
  notification behaviour therefore passes *vacuously* under the default `npm test` unless it either
  forces `--headed` (which breaks CI on a display-less runner) or detects the denial and skips
  loudly. Cost a full smoke-suite debug cycle before the cause was spotted — the first four failures
  all looked like app bugs. Handled in `tests/production-smoke-attention-notifications.spec.js` by
  granting, re-reading the actual permission, and `test.skip(...)` with an explicit reason plus an
  `npm run test:smoke:notifications` (`--headed`) escape hatch. Candidate OS-level improvement, not
  yet built: a shared `tests/_helpers` module for "capability-gated" specs, so the next
  permission-dependent feature (camera, geolocation, clipboard) doesn't rediscover this by hand.
- 2026-08-22: repo files have **mixed line endings** (`core.autocrlf` checks out CRLF, but several
  tracked docs — `REVIEW.md`, `CONTENT_LOG.md` — are LF in the working tree while `TASKS.md`,
  `STATUS.md`, `app.js` are CRLF). Every scripted doc edit that hard-codes `\n` in an anchor string
  silently fails to match on the CRLF files, and every one that hard-codes `\r\n` fails on the LF
  ones — hit four times in one session, each costing a retry. Working rule that fixed it: detect per
  file with `const NL = s.includes('\r\n') ? '\r\n' : '\n'` and normalise the inserted block to it.
  Related trap: `md5sum` on a local checkout will never match the same file fetched from GitHub
  Pages, because Pages serves the LF blob — deployment verification must compare
  `git show main:<file>` against the fetched copy with `tr -d '\r'`, not the working-tree file.
  Candidate fix: a `.gitattributes` with explicit `text eol=` rules, or a small shared edit helper.
- 2026-08-22: the "Button tests" CI workflow fails intermittently with a single 30s
  `locator.click` timeout, a **different test each run** (`ready-food-portions.spec.js:307` on run
  32582675564, `production-smoke-ready-food.spec.js:212` on run 32586471466, then green on run
  32587435063), while the same specs pass locally every time. The suite runs 2 workers against the
  **live** GitHub Pages site, so several specs contend for the same remote origin under a short
  per-test timeout. Effect on the OS: a red CI badge that means nothing, which trains everyone to
  ignore it — and would hide a real regression. Not fixed (out of scope for the wave that noticed
  it); candidate fixes are raising the timeout for the `production-smoke-*` specs specifically,
  pinning them to a single worker, or splitting live-site smoke into its own workflow from the
  local-file suite.
- 2026-08-23: writing repo docs through `node -e "..."` from bash keeps losing content to the
  SHELL, not to node: backticks inside the double-quoted program are command-substituted before
  node ever sees them (a `` `done` `` in a DONE.md entry silently became an empty string, and the
  only symptom was a stray "syntax error near unexpected token" printed *alongside* a successful
  "ok"). A `"` inside a single-quoted JS string in the same position produces "Unterminated string
  constant" instead. Both hit this session, on top of the mixed-line-endings trap already logged
  2026-08-22. Working rule that holds: put any doc block in a scratchpad file and have node read it
  with `fs.readFileSync`, never inline it in the `-e` program; when a short inline edit is
  unavoidable, use `node -e '...'` with single quotes and build backticks via
  `String.fromCharCode(96)`. Candidate fix: a tiny `tools/doc-insert.js` taking (file, anchor,
  block-file) that also does the per-file `\r\n` vs `\n` detection, so every wave stops
  re-implementing both traps.
- 2026-08-23: a "nothing was persisted" regression test matched the TEST HARNESS's own
  `__wseProdBootstrapped` sentinel and reported it as an app state leak — a false positive that
  looks exactly like a real finding, in the one class of test where a false negative would be
  dangerous. Cost a live-smoke debug cycle. Fixed by excluding `__`-prefixed keys, which is already
  the de-facto convention for sentinels across these specs. Candidate improvement: standardise that
  prefix explicitly in the test docs, or have the shared bootstrap helper own the sentinel so
  individual specs never invent their own key.
- 2026-08-23: `requestStorageAccess: Permission denied.` fires on a PLAIN live page load of the
  deployed app in headless Chromium — the reCAPTCHA/App Check iframe asking for third-party storage
  — so any production smoke asserting "no console errors" fails on it unless it filters. Worth
  knowing before the next such test is written: the honest way to classify one of these is to probe
  a bare `page.goto` with zero app interaction and see whether the error still appears, rather than
  widening the filter until the test goes green.
- 2026-08-23: a whole wave's premise was "the filters don't exist"; they did, and had passing tests
  the entire time. The row was `display:none` because every chip matched zero recipes, because the
  SHIPPED seed data had no metadata — while every discovery test injected its own fully-tagged
  fixtures. The tests proved the code worked, not that the product did. Cheap rule worth adopting:
  any spec for a discovery/onboarding surface should have at least one case asserting against the
  data the app actually ships (`sampleRecipes`, defaults) rather than a fixture, because that is
  the only case that can catch "correct code, empty product".
- 2026-08-23: nine spec files in `tests/` hit the live GitHub Pages URL rather than the local
  `index.html`, and `npm test` runs them together with the local ones. Consequences seen repeatedly
  this wave: a branch's "full suite" result partly measures whatever is currently DEPLOYED (so it
  cannot validate the branch), and network latency produced intermittent failures that looked like
  regressions — one run took 5.0 min and failed, the same spec then passed 8/8 in 41s. Worth
  splitting into `npm run test:local` (the deterministic branch gate) and `npm run test:prod`
  (post-deploy verification) so the two questions stop being answered by one number.
- 2026-08-23: Playwright `addInitScript` re-runs on EVERY navigation including `page.reload()`, so a
  harness that calls `localStorage.clear()` there silently defeats any reload assertion — the page
  comes back to a blank slate instead of restoring saved state. Two specs in this repo had that bug,
  and one "survives a reload" test had been passing only because a fresh re-seed happened to produce
  the same recipe count it expected. Guard the clear behind a one-time sentinel key; and if the
  spec also asserts "no unexpected localStorage keys", pick a sentinel name the assertion's own
  filter will not match.
- 2026-08-23: a production-smoke spec asserting a behaviour the current wave CHANGES cannot fail
  before the merge — it runs against the deployed build, which is still the old code. TASK-048
  updated `Lowest effort` and updated its local spec, and the pre-merge suite went green with the
  production-smoke twin still asserting the old contract; CI went red the moment main deployed.
  Rule worth adopting: when a wave changes behaviour, grep `tests/production-smoke-*` for the same
  assertion BEFORE merging and update it in the same commit, accepting that it will fail until the
  deploy lands. Otherwise every behaviour change ships a guaranteed red CI run.
- 2026-08-23: the repo's own overnight automation commits and pushes to `main` while a session is
  working. A push during this wave was rejected because `plan:`/`notify:`/`replies:` commits had
  landed in between. Harmless here (they touch PLAN.md/STATUS.md/OUTBOX.md only) and resolved with
  a plain merge, but worth knowing before assuming a rejected push means someone else is editing
  code — and worth checking `git log origin/main` rather than reflexively rebasing.
- 2026-08-23: `await page.waitForTimeout(2500)` after `page.goto`/`page.reload` is the single
  most common flake source in this repo's specs, and it fails in a way that looks like a
  product bug rather than a harness bug. A CI runner slower than the laptop fires the wait
  mid-init; the test mutates state that init then overwrites; nothing persists; and the
  following reload assertion reports "your data was lost". Diagnostic tell: the count is
  right but the edit is missing — that is a re-seed, not a failed restore. Wait on a
  condition (`AppState.recipes.length > 0 && typeof saveData === 'function'`), and before any
  reload assertion, first wait for the expected bytes to be IN localStorage. Doing this made
  three specs deterministic AND cut them from ~4 min to 55s.
