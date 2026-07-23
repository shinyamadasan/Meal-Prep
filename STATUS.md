# Session Log

Newest entry at top. Append after every session — never edit past entries.
The top entry is the current **working memory** (where we are / next task / blockers).

---

## 2026-07-22 — Autonomous triage + plan run: 2 new captures (both rejected); BUILD_QUEUE fully reflected in TASKS.md

**STEP A (Triage):** 2 new captures processed, both rejected as noise.
- `20260719T1657Z-516` — "sd" — two-character typo, no product substance. Rejected.
- `20260720T0856Z-527` — "/approve all" — unrecognized Telegram command, no product substance (same pattern as prior rejected commands). Rejected.

**STEP B (Plan conversion):** All non-deferred BUILD_QUEUE items (BQ-017 through BQ-026) already have corresponding tasks in TASKS.md — nothing to add. BQ-013/014/015/016 remain deferred. PROP-032 (Risk: High) remains pending — awaiting human approval before BUILD_QUEUE entry.

**Next:** Codex picks up TASK-035 (P1, first `status: codex` in file order). TASK-017/021/022/024/029/030/031/032/033/034 may still be at `status: approved`, each needs `/merge TASK-NNN yes` to land on main.

---

## 2026-07-19 — Autonomous triage + plan run: 0 new captures; BUILD_QUEUE fully reflected in TASKS.md

**STEP A (Triage):** All inbox captures already `status: triaged` — nothing to do.

**STEP B (Plan conversion):** All non-deferred BUILD_QUEUE items (BQ-017 through BQ-026) already have corresponding tasks in TASKS.md — nothing to add. BQ-013/014/015/016 remain deferred.

**Next:** Codex picks up TASK-025 (P2, first `status: codex` in file order). TASK-017/021/022/024/029/030/031 are `status: approved`, each needs `/merge TASK-NNN yes` to land on main.

---

## 2026-07-18 — Autonomous triage + plan run: 0 new captures; BUILD_QUEUE fully reflected in TASKS.md

**STEP A (Triage):** All inbox captures already `status: triaged` — nothing to do.

**STEP B (Plan conversion):** All non-deferred BUILD_QUEUE items (BQ-017 through BQ-026) already have corresponding tasks in TASKS.md — nothing to add. BQ-013/014/015/016 remain deferred.

**Next:** Codex picks up TASK-025 (P2, first `status: codex` in file order). TASK-017/021/022/024/029/030/031 are `status: approved`, each needs `/merge TASK-NNN yes` to land on main.

---

## 2026-07-17 — Autonomous triage + plan run: 0 new captures; 4 tasks converted from BUILD_QUEUE (BQ-023..026)

**STEP A (Triage):** All 33 inbox captures already `status: triaged` — nothing to do.

**STEP B (Plan conversion):** BQ-023..026 (auto-promoted 2026-07-16, all Risk: Low / P2) converted to TASK-025..028 in TASKS.md. PLAN.md updated to reflect the new milestone.

- **TASK-025** — BQ-023: recipe paste nutrition parse + stop instructions at Nutrition header
- **TASK-026** — BQ-024: "Clear expired" pantry button (bulk-delete expired items, explicit tombstone)
- **TASK-027** — BQ-025: voice bulk-add auto-newline per spoken ingredient (no manual Enter)
- **TASK-028** — BQ-026: Prep Mode session persisted to localStorage (survive browser close)

**Next:** Codex picks up TASK-025 (P2, first `status: codex` in file order). TASK-017/021/022/024 still `status: approved`, each needs `/merge TASK-NNN yes` to land.

---

## 2026-07-16 — Triage run: 13 inbox captures processed, 5 new proposals (PROP-030..034)

**Triage only. No tasks changed, no code touched.**

- **PROP-030** — Recipe paste: parse published nutrition block + stop instructions at Nutrition header. P2 feature+bug. Approve + Risk: Low → queued for D-042 auto-promote.
- **PROP-031** — Pantry: one-tap "Clear expired" action to remove all expired items. P2 feature. Approve + Risk: Low → queued for D-042 auto-promote.
- **PROP-032** — Cloud sync failure: Firestore save silently failing, data saving to local only. P1 bug. Approve + Risk: **High** → will NOT auto-promote; needs human review before merge.
- **PROP-033** — Bulk add voice: pressing Enter between each spoken ingredient is friction. P2 UX. Approve + Risk: Low → queued for D-042 auto-promote. (Expiry date complaint in same message may be pre-TASK-008 or voice-mode gap — investigate separately before creating new proposal.)
- **PROP-034** — Prep Mode: active session state lost when app is closed and reopened. P2 bug. Approve + Risk: Low → queued for D-042 auto-promote.
- **8 rejected as noise:** /continue, Continue, empty /feature, "routing test meal prep", "test", /merge TASK-014 (already executed), "s", and 1 single-char message.
- **STEP B (BUILD_QUEUE → TASKS conversion):** nothing to do — all non-deferred BUILD_QUEUE items (BQ-016..022) already have corresponding done tasks in TASKS.md; BQ-013/014/015 remain deferred.

**Next:** PROP-030/031/033/034 will auto-promote to BUILD_QUEUE via Invoke-AutoPromote.ps1 after this session commits. PROP-032 (High risk) awaits your explicit Approve/Park reply before moving to BUILD_QUEUE. TASK-017/021/022/024 are still `status: approved` — each needs `/merge TASK-NNN yes` to land on main.

---

## 2026-07-16 — TASK-014 and TASK-016 both landed; the /merge saga is closed

**Resolution.** After D-044 (auto-rebase) landed, its first live run crashed the dispatcher outright
(TASK-020: `Run-Merge.ps1`'s `Invoke-Git` had none of `Dispatch-Commands.ps1`'s EAP-lowering
protection, so `git rebase`'s routine stderr progress line became a terminating exception under
`$ErrorActionPreference = 'Stop'`). Fixed and landed directly to `main` (bootstrapping exception,
same as TASK-018 — `/merge` was again the thing broken). With both fixes in place:

- **TASK-014 landed fully automated** — no manual rebase, no intervention. First real proof the
  auto-rebase + crash-fix combination works end-to-end.
- **TASK-016 hit a genuine merge conflict** (not the self-inflicted staling bug) — its own changes
  and TASK-014's just-landed changes both touched the same `elseif` chain in
  `Invoke-Autopilot`'s summary section (one added a triage-report branch, the other an audit-report
  branch). The auto-rebase correctly detected this and safely refused to guess, exactly as D-044
  designed it to. Resolved by hand (kept both branches in the chain) and landed successfully on the
  next attempt.
- Also hit the OUTBOX.md race (documented in the previous entry) three more times along the way,
  each time resolved the same proven way: confirm the locally-orphaned commit's content was already
  delivered/superseded, then sync or skip accordingly.

**Both TASK-014 and TASK-016 are now `status: done` on `main`.** The multi-day `/merge` blocker
that started this whole investigation is closed. Remaining open item: the OUTBOX.md race between
the PC-side dispatcher and n8n's independent reply-clearing step is still not fixed at the root
(only worked around, repeatedly) — worth a proper fix (retry-with-refetch on push failure in
`Dispatch-Commands.ps1`) next time automation work is picked up.

**Next:** the three follow-up items from the "less babysitting" philosophy discussion are still
queued: a docs-vs-code consistency checker, a `DECISIONS.md` verify-pointer mechanism, and a
proactive pass for undocumented Claude/Codex operating constraints.

---

## 2026-07-16 — found and fixed the real reason /merge could never land anything (D-044, TASK-019)

**What happened:** after the e2e suite fix (below) unblocked `npm test`, `/merge TASK-014 yes` and
`/merge TASK-016 yes` still blocked, repeatedly, with "main is not an ancestor of task-X (it moved
on). Rebase the branch, then /merge again" — even seconds after rebasing each branch onto main by
hand and force-pushing. Rebased and retried three separate times; blocked the same way every time.

**Root cause (confirmed by reading `claude-session.log` and the literal commit sequence on `main`,
not guessed):** `Dispatch-Commands.ps1` commits an administrative "command received" marker to
`main` immediately before dispatching to any handler, including `/merge` itself — its own Preflight
needs a clean tree, and the just-arrived command file is an uncommitted change the moment n8n writes
it. That marker commit advances `main` by exactly one commit every single time, so by the moment
`Run-Merge.ps1` checked whether `main` was an ancestor of the branch, `main` had already moved past
whatever the branch was rebased onto instants earlier, in the very same run. This is structural, not
bad luck — no `/merge` could ever succeed through the normal Telegram dispatch path for this reason
alone, regardless of how current the branch actually was.

**Fix (TASK-019, held for `/merge`, D-044):** `Run-Merge.ps1` now auto-rebases the branch onto `main`
when the ancestor check fails, before running `npm test` — clean rebase force-pushes the branch
(never `main`) and continues; a real conflict still aborts and asks a human, unchanged. Verified both
new code paths (clean rebase, conflicting rebase) in an isolated scratch repo before landing, since a
bug in the merge gate itself is unusually expensive to discover live. Landed on branch `task-019`,
held at `status: approved` for human `/merge` — same as every other automation-surface task tonight.

**Also discovered along the way:** a separate, unrelated race — the PC-side dispatcher and n8n's own
"clear OUTBOX after send" step both write to `captures/replies/OUTBOX.md` independently, with no
coordination, so a local reply commit and n8n's clear-commit can fork from the same parent. Resolved
twice tonight by resetting local `main` to origin (the forked local commit's content was always
already-delivered and redundant) — not yet fixed at the root; worth a follow-up decision if it
recurs.

**Next:** human needs to `git rebase main` + force-push `task-019` one more time (the fix can't apply
to its own first landing), then send `/merge TASK-019` and `/merge TASK-019 yes` via Telegram. Once
that's in, retry `/merge TASK-014 yes` and `/merge TASK-016 yes` — they should land cleanly now.

---

## 2026-07-16 — e2e suite blocker cleared: stale tests fixed, real Print-button regression found and restored; TASK-014/TASK-016 unblocked for /merge

**Why this was urgent:** every `/merge` (TASK-014, then TASK-016) was failing with "npm test timed
out" regardless of what the branch touched — ~15 of `tests/buttons-functional.spec.js` and
`tests/recipe-actions.spec.js`'s tests had drifted from the current UI and were failing on `main`
itself, blocking the whole Telegram flow for two days. Root-caused each failure by reading the actual
current `index.html`/`app.js`, not guessing.

**Test drift found (all fixed):** `nutrition` tab moved under the More menu but `openTab()`'s helper
was never updated; Help is now reached via Settings → "How to use this app", not a standalone
`.help-btn`; "Add New Recipe"/"Paste Recipe" buttons live inside the Recipes tab-content (hidden
until that tab opens); the "⋯ Data" dropdown was replaced by direct rows inside the Settings modal;
`pantryOnboardingDone` (set by an earlier fix) suppresses the kitchen-setup wizard's seeding, so
pantry tests now add an item first; `#pantry-add-where` (manual storage picker) no longer exists,
storage is inferred automatically; `.pt-datemode` lives in the per-row expand panel; Copy button
label shortened to "Copy"; `recipe-actions.spec.js` never opened the Recipes tab before touching
`.recipe-card` (invisible on the default Dashboard tab).

**Also found and fixed a real product regression, not just a stale test:** the grocery list's Print
button had been silently dropped from `index.html` in the nav-restructure commit (`81b507a`) while
`printGroceryList()` stayed fully wired and its `@media print` CSS intact — restored the one-line
button rather than deleting the test, since the feature itself still worked end-to-end once wired
back up. Trivial, reversible, additive — committed directly to `main` per the Delegation Policy's
"trivial change" exception.

Commits: `291378a` (fixes + Print restore), `16d1ced` (anchor Print regex after it collided with the
test's own "Printable Test Item" fixture name). Full `npm test` now passes 21/21.

**Next:** human needs to send `/merge TASK-014 yes` and `/merge TASK-016 yes` as two separate
Telegram messages (the multiline-anchored regex in `Invoke-MergePhase` only parses the first line of
a message) to land both held branches now that the test gate is green.

---

## 2026-07-16 — Less-babysitting redesign built: auto-promote (D-042) + /audit (D-043); /merge live-verified; TASK-016 landed on its own branch

**The ask, direct quote:** "I want less role as much as possible." Chaos-tested before building
anything (musing-vs-commitment risk, D-032's red-zone list not covering every category a human might
want a say in, audit token cost over a brain-fog week, audit summary drift) — all four named
explicitly; the human chose to accept them rather than have any resolved first. See D-042/D-043 for
the full reasoning.

**Built and landed on branch `task-016`** (commit `a8bbf60`), `status: approved`, held for
`/merge TASK-016`:
- **D-042 auto-promote** — every proposal now leads with `▶ Decision` AND `▶ Risk` (Low/High, D-032's
  own criteria, applied at idea time). `Approve` + `Risk: Low` → straight into `BUILD_QUEUE.md`, no
  human reply. Everything else unchanged. `tools/Invoke-AutoPromote.ps1` (new, deterministic, no
  LLM), wired into `run-claude.ps1` between Triage and the commit-scope guard.
- **D-043 `/audit` redesign** — on-demand only (human-sent, or `/go`'s idle fallback when genuinely
  nothing else is queued). Cost-gated by an actual `git diff` against the app since the last audit,
  not a time-based cooldown — no changes = zero-token reply, however many times pressed. Real changes
  → Claude reads only the diff + `planning/AUDIT_SUMMARY.md` (new), not the whole app, except one
  flat full re-scan every 30 days to correct drift. `tools/Run-Audit.ps1` (new) calls
  `Invoke-AutoPromote.ps1` itself, so a Low-risk finding is buildable in the same `/go` press that
  found it.
- **`TASK-015` (`/suggest`) retired, never built** — its job (recommend the best pending item)
  disappears once nothing routine sits pending.
- **`n8n-telegram-inbox.json`** updated to recognize `audit` as a control verb (+ its comment) —
  pre-emptive fix for the exact mis-routing bug `/merge` hit (see below).

**Also fixed a real doc bug found while appending D-042/043:** D-038's (macOS) closing trade-off
paragraph had been orphaned to the very end of the file when D-039 was added earlier — moved back to
its actual section.

**`/merge` live-verified working end-to-end for the first time tonight, after fixing why it wasn't:**
the live n8n workflow was running a version from before D-036 added `/merge` to its recognized-command
regex — re-imported/hand-edited by the human mid-session. Confirmed via a real `/merge TASK-014` →
`/merge TASK-014 yes` round trip over Telegram; the summary step returned the correct diff, and the
confirmed step correctly ran the full gate (`npm test` etc.) before reporting back.

**Outstanding for the human:**
- `/merge TASK-016` → `/merge TASK-016 yes` (this session's whole redesign)
- `/merge TASK-014`, `/merge TASK-017` — still held from the prior session; `TASK-014` specifically
  needs the ~15 pre-existing stale test failures (`buttons-functional.spec.js`/`recipe-actions.spec.js`,
  unrelated to any of tonight's changes) addressed before `npm test` can pass its merge gate. The
  onboarding-modal root cause is already fixed (`07b594e`, direct to `main`); what's left is
  feature-by-feature staleness in ~15 individual assertions.
- First live test of the new idle-`/go` → audit → auto-promote → build loop, once `TASK-016` lands.

**Next command output:**
```
NEXT
milestone : Less-babysitting redesign (auto-promote + /audit) [built, held for /merge]
task      : TASK-016 — auto-promote + /audit redesign [approved]
owner     : you
why       : TASK-016 is code-complete and held for /merge, same as TASK-014/017 from the prior
            session. All three are independent holds; land in any order.
run       : Review (merge TASK-016, and/or resolve TASK-014's test-suite gate, whenever ready)
```

**Blockers:** none — everything above is either landed, held for `/merge`, or a clearly-scoped
follow-up (the stale test suite).

---

## 2026-07-15 (cont.) — TASK-014 landed on `task-014`; TASK-017 (notification feature) + guard landed on `task-017`; TASK-015/016 re-flagged; D-039/D-040 recorded

**Discovered live:** `/build` ran TASK-014 for real — Codex correctly implemented and tested the fix
(isolated `/go -DryRun` fixture reproduced the exact TRIAGED-message scenario), but its own
commit-scope guard permanently blocked the commit ("touched file(s) outside Codex's allowed surface:
tools/Dispatch-Commands.ps1"). This is not transient: Codex can **never** land a change under
`tools/` — confirmed by design in `docs/09-automation.md`'s deny-list ("this repo's own automation
scripts").

**Resolved:**
- **TASK-014** — Claude verified the diff + evidence and completed the commit Codex's guard blocked
  (`37f58b9` on branch `task-014`, pushed). `status: approved`, held for `/merge TASK-014` — review
  note discloses this is a same-session build+review, not independent (see DECISIONS D-040).
- **TASK-017 (new)** — `Send-Notification`: overnight Preflight aborts / mid-run halts now push a
  Telegram notice via the existing `captures/replies/OUTBOX.md` → `n8n-telegram-replies.json` relay,
  instead of only logging locally. This is the actual root cause fix for "why didn't we know the
  digest was stale for 10 days" — the safety gates were working correctly the whole time, they just
  had no way to tell anyone. Landed on branch `task-017` (rebased onto this commit + a second commit
  adding the D-040 guard below), `status: approved`, held for `/merge TASK-017`.
- **TASK-015/016** — re-flagged `status: codex` → `status: blocked`: both touch `tools/`, hitting the
  identical wall TASK-014 did. Needs direct Claude implementation, not a Codex build.
- **New deterministic guard (Phase 2c in `run-claude.ps1`, on `task-017`)** — right after Plan
  Conversion writes `TASKS.md`, auto-flips any `status: codex` task whose `files:` touch the
  automation-surface deny-list to `status: blocked` with an explanatory note, before a build is ever
  attempted. Covers the unattended overnight path where no human/Claude session is present to catch
  this by hand. Verified in isolation against realistic fixtures (flags only the automation-surface
  task, ignores app-code tasks and done tasks).
- **DECISIONS.md D-039** (notify-on-failure) and **D-040** (automation-surface tasks are Claude's to
  build directly, never Codex's — codifies the routing rule the guard now enforces in code).

**Git housekeeping note:** `task-017` was rebased + force-pushed once (with explicit human
confirmation) after it fell behind `main` mid-session — nobody else was using that branch.

**Outstanding for the human:**
- `/merge TASK-014` → `/merge TASK-014 yes`
- `/merge TASK-017` → `/merge TASK-017 yes`
- TASK-015/016 still need direct Claude implementation (not yet built)
- 11 untriaged captures were reported sitting in `captures/inbox/` during TASK-014's test run — worth
  a `/run` or waiting for the next clean overnight pass now that Preflight can actually succeed

**Next command output:**
```
NEXT
milestone : Fix /go idle-triage gap + add /suggest & /audit [in-progress]
task      : TASK-014 — Fix `/go` idle-triage gap [approved]
owner     : you
why       : TASK-014 and TASK-017 are both approved and held for /merge (D-032 red-zone hold).
            TASK-015/016 are blocked pending direct Claude implementation.
run       : Review (merge TASK-014 and TASK-017 when ready)
```

**Blockers:** none — everything above is either done, held for `/merge`, or clearly queued.

---

## 2026-07-15 — TASK-015/016 authored: `/suggest` + `/audit` (proactive "what's next" without a prior capture); Preflight-blocking dirty tree fixed

**Human request, direct conversation:** wanted a command that suggests the next build even without
a capture/task already queued — modeled on how they've been using a separate Codex session ("what's
next" → it proposes → they approve → it executes). Landed on a two-command split so the expensive
part (scanning the app) doesn't have to happen on every check:

- **TASK-016 `/audit`** (new `tools/Run-Audit.ps1`, on-demand only, no schedule) — runs one Claude
  session combining `PROMPTS.md`'s PP1 (Internal Alpha Audit) + PP2 (UX Friction Audit) with P9's
  Triage output contract, writing real findings straight into `planning/PROPOSALS.md` (same
  `▶ Decision`/priority contract as a normal capture), deduped against ROADMAP/DONE, capped to 5 new
  findings per run. Modeled directly on `run-claude.ps1`'s existing Preflight/lock/commit-scope-guard
  shape rather than inventing a new one.
- **TASK-015 `/suggest`** (pure PowerShell, no LLM call, works even with `$AUTOMATION_ENABLED =
  $false`) — ranks whatever's already pending in `PROPOSALS.md` (from a capture or from `/audit`) by
  goal-adjusted priority and replies with the single best one to build next, no proposal number
  lookup required.

Both authored to `TASKS.md` (`status: codex`), automation/OS-surface (Hard Rule 10 / D-023: solo
build; D-032: held for `/merge`, never auto-merged).

**Also fixed in the same session — a real, live production issue, not hypothetical:** the overnight
"Meal Prep Claude Overnight" task had been aborting at Preflight ("working tree dirty") on at least
three consecutive runs (2026-07-14 02:00, 2026-07-14 21:00, 2026-07-15 02:00, confirmed in
`claude-session.log`), which is why `planning/DIGEST.md` had been stuck showing 2026-07-05 content
and why captures sent since then (including a real bug report about work-session tracking state)
were still sitting untriaged. Root cause: pre-existing untracked items (`.claude/`, `.codex/` — local
agent tool state; `avoid-ai-writing/` — an unrelated nested repo; `OPS_STATE.md` — an undocumented
auto-generated snapshot, not in `CLAUDE.md`'s doc map) plus this session's own doc edits, all sitting
uncommitted. Fixed: added the pre-existing items to `.gitignore` (none deleted), committed the doc
fixes, rebased onto origin (n8n had pushed 4 capture/command commits in the meantime — no file
overlap), pushed. Working tree is clean on `main` as of this entry; the next scheduled run should
pass Preflight and actually refresh the digest.

**Next command output:**
```
NEXT
milestone : Ship BQ-018..022 P2/P3 UX batch [done — all TASK-006..013 done]
task      : TASK-014 — Fix /go idle-triage gap [codex]
owner     : Codex
why       : Three human-approved automation-surface tasks now queued (TASK-014, 015, 016), all
            authored directly to TASKS.md (no BUILD_QUEUE trail — found/requested live in chat,
            not via the capture pipeline). File order = build order.
run       : Continue
```

**Blockers:** none. `GUIDE.md` intentionally NOT updated with `/suggest`/`/audit` yet — they don't
exist until TASK-015/016 are built; adding them to the phone cheat sheet now would be misleading.

---

## 2026-07-14 — TASK-014 authored: `/go` idle-triage gap found live (doesn't match D-035); 4 stale docs corrected

**Found via direct conversation, not the capture pipeline.** While explaining `/go`'s mechanics to
the human, reading `tools/Dispatch-Commands.ps1`'s `Invoke-Autopilot` turned up a real gap: the
"Plan once" trigger only checks `Get-UnconvertedBQCount -gt 0` — it never checks `captures/inbox/`
for untriaged captures. This contradicts DECISIONS.md D-035 ("An idle `/go` triages instead of
dead-ending"), which was written specifically to guarantee that. Net effect today: `/go` sent right
after a fresh capture, with nothing else build-ready, replies "Nothing to do" instead of triaging it
and reporting a PROP number — the exact dead-end D-035 exists to close.

**TASK-014 authored** (`status: codex`, priority P1, `depends-on: none`, `files:
tools/Dispatch-Commands.ps1`) — human approved live in chat. Marked automation/OS-surface: solo
execution only (Hard Rule 10 / D-023); review must land it `status: approved` (held for human
`/merge`), never auto-merged to `done` (D-032 red zone), regardless of diff size.

**Also corrected this session (docs-only, no code):**
- `captures/README.md` — routing table + diagram wrongly implied `/feature`/`/todo` auto-build
  without approval; now states every capture lands in `PROPOSALS.md` pending approval, tag only
  affects Triage's recommended verdict.
- `docs/09-automation.md`, `OPERATOR.md`, `SYSTEM-OVERVIEW.md` — all still said the Command
  Dispatcher polls "~2 min" in several places; D-033 (2026-07-11) actually changed this to ~30 min
  (`WakeToRun` enabled, interval relaxed for the sleep-by-default design). Three docs were never
  updated after that decision landed.
- `GUIDE.md` — was missing `/go /build /review /merge /status /next /log /stop /enable /disable`
  entirely (only listed the 5 capture tags); now a complete phone cheat sheet.

**Next command output:**
```
NEXT
milestone : Ship BQ-018..022 P2/P3 UX batch [done — all TASK-006..013 done]
task      : TASK-014 — Fix /go idle-triage gap [codex]
owner     : Codex
why       : Human-approved automation-surface fix, authored directly to TASKS.md (not via
            BUILD_QUEUE — no capture/triage/approve trail exists for this one, by design, since
            it was found and approved live in conversation).
run       : Continue
```

**Blockers:** none.

---

## 2026-07-05 — Autonomous run: Triage no-op; Plan converts BQ-018..022 → TASK-006..011

**Autonomous, planning-only role (Claude as PM/Tech Lead/Architect). Two-step scope: Step A
Triage, Step B Plan Conversion. Prompt was complete this run (previous run had truncation).
Zero code edits — app.js / index.html / style.css untouched.**

**Step A — Triage:** all 20 `captures/inbox/*.md` already carry `status: triaged` (nothing with
`status: new`). Per WORKFLOW.md Triage §0 idempotency, no PROPOSAL/archive writes performed.

**Step B — Plan Conversion:** five approved BUILD_QUEUE items had no `source: BQ-<id>` entry in
TASKS.md — BQ-018, BQ-019, BQ-020, BQ-021, BQ-022. None carry an explicit `**Deferred by
Builder**` marker (unlike BQ-013..016), so all five were converted. Authored six new tasks in
ascending priority order (file order = build order for `/go`):

| Task     | Source | Pri | Shape                                                    |
|----------|--------|-----|----------------------------------------------------------|
| TASK-006 | BQ-018 | P2  | Bulk-add default storage selector (index.html + app.js)  |
| TASK-007 | BQ-021 | P2  | Cook portion multiplier + scaled deduction (app.js)      |
| TASK-008 | BQ-019 | P2  | Inline `exp:YYYY-MM-DD` per-line expiry (index.html + app.js) |
| TASK-009 | BQ-020 | P3  | Compact `.recipe-card-header` CSS pass (style.css)       |
| TASK-010 | BQ-020 | P3  | Decision gate — "always-expanded detail" meaning (no code) |
| TASK-011 | BQ-022 | P3  | Decision gate — long-press bulk multi-select scope (no code) |

All six at `status: codex`. TASK-010 and TASK-011 are intentional blocker-raisers: PROP-026 and
PROP-028 flagged design ambiguities that couldn't be defended-defaulted autonomously
(auto-expand vs remember vs open-modal for BQ-020; pantry vs pantry+grocery + desktop fallback
for BQ-022). Codex is expected to read them, flip `status: blocked`, and write a one-line
question with its recommendation for Claude (interactive) to answer.

**Defended defaults in the real-build tasks:**
- **TASK-006** (BQ-018): storage vocab is `counter | fridge | freezer` — PROP-024's
  "counter/fridge/pantry" was a misspoke (there is no `pantry` storage in `inferStorage()`).
- **TASK-007** (BQ-021): reuses existing `showConfirmDialog` primitive with a `<input
  type="number">` in `bodyHtml`; multiplier scales both `deductIngredientsForRecipe(recipe,
  m)` and `checkMissingIngredients(recipe, m)` so cook-at-3× can't silently pass a 1× pantry
  check; cookHistory records `servings * multiplier`; cookedMeals unchanged (still 1 batch).
- **TASK-008** (BQ-019): inline `exp:YYYY-MM-DD` keyword (chosen over append-date or separate-
  column because it doesn't collide with the existing comma or no-comma parsers); per-line
  wins over shared date; malformed dates → warning + fall through to shared.

**PLAN.md updated:** goal/approach/scope/source rewritten around the BQ-018..022 milestone;
status set to `in-progress`.

**Files not touched:** ROADMAP.md, BUILD_QUEUE.md, PROPOSALS.md, app.js, index.html, style.css,
captures/**. Only TASKS.md, PLAN.md, and this STATUS.md were written.

**Next command output:**
```
NEXT
milestone : Ship BQ-018..022 P2/P3 UX batch [in-progress]
task      : TASK-006 — Add default storage selector to #bulk-add-modal [codex]
owner     : Codex
why       : TASK-006..011 authored and status: codex; TASK-006 is first in file order (P2,
            simplest of the batch). /go autopilot picks this up.
run       : Continue
```

**Blockers:** none — the two decision-gate tasks (TASK-010, TASK-011) are expected blockers,
not obstacles to this run.

---

## 2026-07-05 — Autonomous run: Triage no-op; state audit corrects prior STATUS entry

**Autonomous run, planning-only role (Claude as PM/Tech Lead/Architect). Prompt was truncated
mid-instruction ("Do not touch the ROADMAP Do…") so Step 2 of the two-step scope was not visible;
per CLAUDE.md Escalation Policy "prefer stopping over guessing" — completed only the unambiguous
Step 1 (Triage) and emitted Next without initiating Plan.**

**Triage (Step 1):**
All 20 captures in `captures/inbox/` already carry `status: triaged`. Zero with `status: new`
(WORKFLOW.md Triage §0 says "SKIP any already triaged — idempotency"). No PROPOSALS or archive
writes needed.

**State audit — corrects yesterday's STATUS entry:**
Yesterday's 2026-07-05 entry (triage of msg-67/msg-309) said "BUILD_QUEUE has no new approved
items." That was inaccurate: `planning/BUILD_QUEUE.md` currently holds **five approved sprint
items awaiting Plan** — BQ-018..022, all approved 2026-07-04 via digest reply, none deferred:

| BQ  | Priority | Title                                                            |
|-----|----------|------------------------------------------------------------------|
| 018 | P2       | Bulk add: default storage location selector (counter/fridge)     |
| 019 | P2       | Bulk add: per-item expiry date per line (supersedes BQ-005)      |
| 021 | P2       | Cook confirmation: optional serving multiplier                    |
| 020 | P3       | Recipe card: compact header + always-expanded detail              |
| 022 | P3       | Long-press bulk multi-select mode (move + delete)                 |

Recommended next sprint: **BQ-021** (P2, cook multiplier) — directly improves core pantry-
deduction accuracy at M effort per the prior recommendation in STATUS 2026-07-04. Alternative
starter: BQ-018 (P2, simplest of the batch — small UI addition to bulk-add modal, no parser
changes).

`ROADMAP.md`'s "Approved Backlog" section is still out-of-sync (says "*(empty)*") even though
these five were approved and landed in BUILD_QUEUE. Sync deferred (autonomous instructions
included "do not touch the ROADMAP").

**State on entry:**
- Milestone `Fix mobile modal action buttons + planner overflow` = `done` (TASK-001..005 all done).
- BQ-013/014/015/016 remain deferred P3 (post-alpha stabilize).
- BQ-017 built + shipped as TASK-005.
- No open blockers.

**Next command output:**
```
NEXT
milestone : Fix mobile modal action buttons + planner overflow [done]
task      : — (all done)
owner     : Claude
why       : Milestone complete. BQ-018..022 approved in BUILD_QUEUE.md and not yet converted
            to TASKS.md — next action is a Plan pass to pick one BQ item and author its tasks.
run       : Plan
```

**Recommended human actions (when next at the keyboard):**
- Run `Plan` to convert BQ-021 (or your pick from BQ-018..022) into `TASKS.md` entries.
- Optionally sync `ROADMAP.md`'s Approved Backlog section to reflect PROP-024..028 approvals
  (currently only mirrored in `BUILD_QUEUE.md`).

**Blockers:** none.

---

## 2026-07-05 — Triage: 2 captures (msg-67, msg-309) — both dropped as noise

**Triage complete (2 new captures):**

- **msg-67 (2026-07-04T17:56Z) — body `yes`:** stray Telegram reply with no command/context. Cross-references
  `planning/PROPOSALS.md`: PROP-024..028 all carry `status: approved 2026-07-04 (via digest reply)`, so this
  capture was the digest-reply that already flipped them to approved. Effect already applied upstream — no
  new PROPOSAL entry needed. Same drop-without-PROP treatment as msg-53 last batch. ▶ Dropped (already
  actioned).
- **msg-309 (2026-07-05T08:04Z) — body `status`:** bare "status" word, no `/command` prefix. Reads as a
  stray system-command word typed into the capture channel, not a product idea/bug/feature. No actionable
  signal. ▶ Dropped (noise).

**Files changed:** both inbox files flipped `status: new → triaged`; archives written to
`captures/processed/2026/07/`. PROPOSALS.md, ROADMAP.md, BUILD_QUEUE.md, PLAN.md, TASKS.md untouched (nothing
approved, nothing to schedule, no build work created).

**State on entry unchanged from 2026-07-04:**
- BQ-016/017 milestone `done` (TASK-001..005 all done).
- BUILD_QUEUE has no new approved items (BQ-013/014/015 remain deferred P3).
- PROP-024..028 already approved via digest; not yet reflected in `ROADMAP.md`'s Approved Backlog section
  (still says "*(empty — approve a proposal to populate this)*"). That sync is a follow-up ROADMAP write —
  out of scope this run (autonomous instructions said not to touch ROADMAP).

**Next command output:**
```
NEXT
milestone : Fix mobile modal action buttons + planner overflow [done]
task      : — (all done)
owner     : Claude
why       : No approved items in BUILD_QUEUE.md; PROP-024..028 approved but not yet promoted to ROADMAP
            Approved Backlog. Await human to promote next batch or run a Plan pass.
run       : Status
```

**Recommended human actions (when you're next at the keyboard):**
- Promote PROP-024..028 from `PROPOSALS.md` into `ROADMAP.md` "Approved Backlog" (approvals happened via
  digest reply 2026-07-04 but ROADMAP wasn't synced).
- Consider approving PROP-029 (Planner mobile overflow, P1) — auto-found by the mobile-layout test,
  reproducible; would be the next concrete build sprint.

**Blockers:** none.

---

## 2026-07-04 — Triage: 6 captures → PROP-024..028 confirmed; BQ-016/017 milestone closed

**Triage complete (6 captures, 2026-07-02 batch):**

All 6 inbox captures from 2026-07-02 already had proposals written by a prior run (PROP-024..028);
only the inbox `status` fields were still `new`. This run marks all 6 as `triaged`, writes archives
to `captures/processed/2026/07/`, and closes the milestone.

**Captures → Proposals (all parked, pending your judgment):**
- **msg-45 → PROP-024 (P2):** Bulk add: default storage location selector (counter/fridge). ▶ Park.
- **msg-47 → PROP-025 (P2):** Bulk add: per-item expiry date per line (supersedes shared-date from BQ-005). ▶ Park.
- **msg-49 → PROP-026 (P3):** Recipe card: compact header + always-expanded detail. ▶ Park.
- **msg-51 → PROP-027 (P2):** Cook confirmation: optional serving multiplier for accurate pantry deduction. ▶ Park.
- **msg-53 → dropped:** Duplicate of msg-55 (malformed `/also` prefix; unknown type).
- **msg-55 → PROP-028 (P3):** Long-press bulk multi-select mode (move + delete). ▶ Park.

**Milestone closed:** BQ-016 (modal mobile-footer-stacking) + BQ-017 (planner overflow) — all 5 tasks
done. PLAN.md updated to `done`. BUILD_QUEUE has no new approved items (BQ-013/014/015 remain deferred P3).

**Next command output:**
```
NEXT
milestone : Fix mobile modal action buttons + planner overflow [done]
task      : — (all done)
owner     : Claude
why       : No approved BUILD_QUEUE items; milestone complete. Await human to promote next batch.
run       : Status
```

**To activate the next run:** approve PROP-024..028 from your phone (digest), or promote a
different item from ROADMAP.md to BUILD_QUEUE.md. Recommend reviewing PROP-027 (cook multiplier,
P2) — it directly improves core pantry accuracy with M effort.

**Blockers:** none (awaiting product approval only).

---

## 2026-07-03 — diag(sync): root cause confirmed; diagnostic logs removed

**Root cause of "import not working" (from [SYNC-DIAG] diagnostic logs):**
The import code was working correctly the entire time. The user was testing with an exported backup of their own data (27 recipes: IDs 1–26 + 1782474814949), NOT `cpb-diet-import.json` (4 recipes: cpb-recipe-a through d). Since `unionById(AppState.recipes, importedData.recipes)` — existing items win on collision — importing the same IDs is a no-op. Nothing changed, nothing appeared to be "imported." The sync machinery (Firestore write, onSnapshot skip, no conflict path) all behaved correctly.

**Diagnostic logs:** All `[SYNC-DIAG]` console.log blocks removed from `app.js` (commit `c49f001` added them; this cleanup removes them). Root cause confirmed closed.

**Secondary finding:** Firestore `recipes` array at v1953 contained pantry item IDs mixed in (data corruption from a prior session). These were cleaned up by `loadUserData()` on the next load. No action needed.

**Status:** Import feature confirmed working. No open bugs in the import/sync path.

**Human check:** To verify import works with a genuinely new file, import `cpb-diet-import.json` (must have IDs NOT already in the account — cpb-recipe-a through d are the test IDs).

---

## 2026-07-02 — fix(import): tombstone-override + save-race fixes committed

**Root cause (proven by code trace):** Signed-in import data disappeared on every refresh because:
1. `clearLocalStorage()` tombstones all current IDs when "Clear All Data" runs.
2. On re-import, `buildFirestorePayload()` wrote the tombstones back to Firestore alongside the re-imported items.
3. On every signed-in refresh, `applyTombstones()` silently removed the re-imported items.
4. Signed-out path never calls `applyTombstones()`, which is why signed-out imports survived.

**Fix 1 (committed 4634c43):** `saveData()` returns the Firestore Promise; `importData()` awaits it before showing the success toast — correct for the signed-out race, but not the root cause of the signed-in failure.

**Fix 2 (this commit):** In `importData()`, before any `unionById()` call, delete `AppState.deletions` entries for every ID in the import file. Explicit re-import overrides prior deletion (D-019). One block, 8 lines, inserted after `createBackup()` and before the union operations.

**Self Review:** pass — minimum code, correct placement, consistent patterns.
**QA:** all AI checks pass. No CSS, no new DOM elements, no new AppState fields, no handler registrations. `createBackup()` still runs first (backup preserves pre-import tombstones for undo). `patchMissingNutrition()` and `saveData()` unchanged.

**Human checks (verify on phone after push):**
- [ ] Signed in: import `cpb-diet-import.json` → refresh immediately → 4 recipes still visible
- [ ] Signed in: import → wait for toast → refresh → 4 recipes still visible
- [ ] Signed out: import → refresh → recipes visible (regression check; was already working)
- [ ] Clear All Data after import → data clears (tombstones still created on clear, not on import)

**Branch:** `main` — commit pending (local only; push after device verification).

---

## 2026-07-02 — Checkpoint: no active task, awaiting human decision on BQ-013..016

**State on entry (confirmed):**
- All 12 inbox captures `status: triaged` — spot-checked oldest (20260625T2227Z-10) + newest (20260626T1152Z-32), both confirmed.
- Both decision files `status: applied` — no new decisions to process.
- BUILD_QUEUE has BQ-013–016, but ALL are marked **Deferred by Builder 2026-06-30** — each requires a human scope decision before building.
- TASK.md: NO ACTIVE TASK.
- No work done this run. State unchanged from last build run (2026-06-30).

**Deferred items awaiting human decision:**
- **BQ-013** (P3) — Hardcoded hex colors: build note says "defer past stabilize phase". Ready to build the quick-subset (point reds/ambers at semantic tokens) if approved.
- **BQ-014** (P3) — Badge/pill consolidation: full consolidation deferred; quick-win (`--radius-full` + `--font-size-xs` normalization) available if a slot opens.
- **BQ-015** (P3) — Spacing scale drift: deferred post-alpha, convert per-component.
- **BQ-016** (P3) — Modal sizing variance: needs human to specify which modals to fix (Prep Mode / Username / Custom-Ingredient) before building.

**To activate next run:** promote a batch from `planning/ROADMAP.md` to BUILD_QUEUE, or scope one of BQ-013..016 and remove the deferred note. Also consider approving PROP-024+ if any new captures have come in.

**Blockers:** none (awaiting product approval only).

---

## 2026-06-30 — BQ-007..012 sprint built (UX/a11y fixes)

**Built (6 items, all from approved BUILD_QUEUE):**

- **BQ-007 (P1) — Missing button variants added.** `.btn--ghost` (transparent + border, fills on hover),
  `.btn--danger` (error-red bg + white text + brightness hover), `.btn--success` (sage bg + dark text).
  All wired at the CSS level — no HTML/JS changes needed. "Browse", "Bulk add", "Skip", "Back", and
  "Delete Account" now have visible affordances.

- **BQ-008 (P1) — White-on-sage contrast fixed.** 13 elements that used `color: #fff` or `color: white`
  on sage/primary background now use `color: var(--color-btn-primary-text)` (= charcoal-700, dark text).
  Affected: `.day-action-paste`, `.success-message`, `.detail-scaler-btn`, `.ingcat-custom-badge`,
  `.ingcat-store-tag` + `.ingcat-store-remove`, `.cooked-storage-toggle button.active`,
  `.cooked-remove:hover`, `.storage-toggle button.active`, `.planner-day-chip.active`,
  `.slot-cooked-btn:hover`/`--done`, `.settings-row--primary`, `.email-verify-banner button`, `.gs-num`.

- **BQ-009 (P1) — 44px tap targets on mobile.** Added inside `@media (max-width: 768px)`:
  `min-height: 44px; min-width: 44px` for `.modal-close`, `.recipe-fav-btn`, `.pantry-remove`,
  `.cooked-remove`, `.day-action-btn`, `.detail-scaler-btn`. (`.btn`/`.tab-btn` already had 44px.)

- **BQ-010 (P1) — CSS variable aliases added.** Added 15 undefined-variable aliases to `:root`:
  `--color-text-primary`, `--color-text-muted`, `--color-bg`, `--surface`, `--border`,
  `--color-surface-2`, `--border-radius`, `--border-radius-sm`, `--color-danger`, `--color-danger-dark`,
  `--color-danger-light`, `--color-warning-light`, `--color-warning-dark`, `--color-success-light`,
  `--color-success-dark`. Fixes transparent `.member-status.pending`, `.warning-message` styling, and
  dozens of components using legacy token names. Duplicate-block deletion deferred (too risky without device test).

- **BQ-011 (P2) — Ingredient browser empty state.** `<p class="ib-empty">No ingredients found.</p>`
  → `emptyState('search', 'No ingredients found', 'Try a different search term.')` in `renderIngredientBrowser()`.
  `dash-l2-empty` dashboard mini-messages left as-is (compact inline messages with action buttons; converting
  to full icon+title+text would be wrong weight for the dashboard context).

- **BQ-012 (P2) — Focus outline restored on ingcat inputs.** `.ingcat-unit-select:focus,
  .ingcat-price-input:focus` had `outline: none` with only border-color as focus indicator (WCAG fail).
  Changed to `outline: var(--focus-outline)`. `.gpl-price-input:focus` already had a proper 2px outline.
  `.settings-name-input` uses `box-shadow: var(--focus-ring)` on focus — valid substitute, left alone.

**BQ-013–BQ-016 (P3) — Deferred per build notes.** All four P3 items have "defer past stabilize phase"
or "schedule post-alpha" in their build notes. Left in BUILD_QUEUE with deferred notes for next human review.

**Self Review:** pass — all changes minimal and targeted. Token aliases extend the existing alias pattern.
Button variants follow existing `.btn--primary`/`secondary`/`outline` shapes exactly. Contrast fixes are
mechanical token substitutions. Tap targets are additive mobile rules. No new abstractions.

**QA:** pass — hard rules 1–6 untouched; no second `:root` block added (edited existing Aliases section);
no `saveData()` bypass; no unescaped user strings in innerHTML; `--color-white` is defined (line 8 of :root);
`--color-charcoal-700` is defined; `emptyState()` takes safe string literals not user input.

**Human checks (log here after testing on device):**
- [ ] "Browse" and "Bulk add" on Inventory tab show as visible ghost buttons (border + transparent bg)
- [ ] "Delete Account" in Settings shows red danger styling
- [ ] Active day chip in Weekly Planner → dark text on sage (readable in daylight)
- [ ] Store tags in Price Book → dark text on sage
- [ ] Paste day action → dark text on sage
- [ ] Settings primary row → dark text on sage
- [ ] Success toast (e.g. add pantry item) → dark text on sage
- [ ] Tap modal close × on phone — not fiddly (44px target)
- [ ] Tap recipe ♥ on phone — not fiddly (44px target)
- [ ] Pantry item remove button tap — not fiddly
- [ ] member-status.pending badge has a visible background (not transparent)
- [ ] Ingredient browser search with no results → shows icon empty state
- [ ] Focus on Price Book unit/price inputs → visible outline

**Branch:** `main` — ready to commit. Push requires manual step.

**To deploy:**
```
git add app.js style.css planning/TASK.md planning/DONE.md planning/BUILD_QUEUE.md STATUS.md
git commit -m "fix(ux): button variants, sage contrast, 44px tap targets, CSS token aliases, focus outline, empty state"
git push origin main
```

**Next:** BQ-013–016 (P3) remain in BUILD_QUEUE; await human decision to approve/reject. Triage any new inbox captures.

---

## 2026-06-29 — Checkpoint: same state, no new captures, stopped

**State on entry (confirmed):**
- All 12 inbox captures `status: triaged` — spot-checked oldest (20260625T2227Z-10) + newest (20260626T1152Z-32), both confirmed.
- BUILD_QUEUE.md empty — nothing to build.
- TASK.md: NO ACTIVE TASK.
- No work done this run. State unchanged from prior checkpoints.

**Awaiting human approval before next run can build anything.**

---

## 2026-06-28 — Checkpoint (run 2): confirmed same state, no new captures, stopped

**State on entry (confirmed):**
- All 12 inbox captures `status: triaged` — spot-checked oldest + newest, both confirmed.
- BUILD_QUEUE.md empty — nothing to build.
- TASK.md: NO ACTIVE TASK.
- No work done this run. State unchanged from run 1 checkpoint below.

**Awaiting human approval before next run can build anything.**

---

## 2026-06-28 — Checkpoint: no active task, awaiting approval of PROP-014..019

**State on entry:**
- All 12 inbox captures already `status: triaged` — nothing new to process.
- BUILD_QUEUE.md empty — BQ-001..006 built and committed 2026-06-27.
- TASK.md: NO ACTIVE TASK.

**Pending human approval (Proposals → BUILD_QUEUE):**
- **PROP-014 (P1) — Invisible btn--ghost/danger/success variants** — approve to fix.
- **PROP-015 (P1) — White-on-sage contrast fail (WCAG)** — approve to fix.
- **PROP-016 (P1) — Sub-44px tap targets** — approve to fix.
- **PROP-017 (P1) — Undefined CSS variables + duplicated :root block** — approve to fix.
- **PROP-018 (P2) — Inconsistent empty states** — approve to fix.
- **PROP-019 (P2) — focus outline removed on some inputs (a11y)** — approve to fix.
- **PROP-020..023 (P3) — park recommendations** — no action needed unless you want to override.

**To activate the next build run:** approve from your phone (e.g. `Approve 14-19`) so
`Apply-Decisions.ps1` moves them to BUILD_QUEUE.md, or manually promote a batch.

**Blockers:** none (awaiting product approval only).

---

## 2026-06-27 — BQ-001..006 sprint built (bulk add + pantry card UX)

**Built (6 items, all from approved BUILD_QUEUE):**

- **BQ-001 (P1) — Bulk add parser: no-comma format now works.** Added `NO_COMMA_RE` regex that
  parses `"Coconut cream 200ml"` → name="Coconut cream", qty=200, unit="ml". Comma path unchanged.
  Updated placeholder to show the new format. `const → let` for name/qty/unit (required for
  reassignment in the no-comma path).

- **BQ-002 (P1) — Pantry card stays open on in-card edits.** Root cause: `renderPantry()` rebuilds
  all DOM, collapsing every expanded card. Added `renderPantryKeepOpen()` helper that saves
  `piexp-*` IDs before render and restores them after. Wired into all 7 in-card update functions:
  `updatePantryDate`, `updatePantryShelf`, `updatePantryQty`, `setPantryStorage`,
  `togglePantryStaple`, `togglePantryDateMode`, `cycleStapleLevel`. Delete + add paths keep
  `renderPantry()` (no card to restore).

- **BQ-003 (P2) — Storage guide hidden for unrecognized pantry items.** Changed
  `lookupPantryKnowledge(p.name) || genericStorageGuide(p)` to `lookupPantryKnowledge(p.name)`.
  `genericStorageGuide()` still used by `inferStorage()` for location logic — only the in-card
  "Storage guide" button is suppressed. Items in PANTRY_KNOWLEDGE still show it.

- **BQ-004 (P2) — Recently added items sort to top.** Pantry list within each storage group now
  sorts items added in the last 5 minutes to the top (newest first), then falls back to
  alphabetical. Uses `Number(p.id)` as a timestamp proxy (id = `Date.now() + Math.random()`).

- **BQ-005 (P2) — Bulk add expiry date field.** Added a date input to the bulk add modal below
  the textarea: "Expiry date (optional — applies to all items)". `confirmBulkAdd()` reads the
  value and sets `expiryDate` + `dateMode:'expiry'` on each pantry item. Input cleared on
  `openBulkAddModal()`. Built alongside BQ-001 (same parser, same function).

- **BQ-006 (P2) — Ingredient card unit input: native datalist.** Replaced the plain text input
  with `<input list="ingredient-unit-list">` + `<datalist>` of 20 common units (g, kg, ml, L,
  pcs, cup, tbsp, tsp, bunch, can, bottle, box, bag, pack, head, clove, stalk, slice, oz, lb).
  Free typing still works. No JS required.

**Self Review:** pass — all changes minimal, targeted, reuse existing patterns (`togglePantryExpand`
DOM pattern, existing `saveData()`, existing `showConfirmDialog`). No new abstractions beyond
`renderPantryKeepOpen` (which is exactly one pattern used in 7 places). No dead code.

**QA:** pass — hard rules 1–6 untouched; `saveData()` used throughout; no second `:root`; no
new innerHTML with unescaped user strings; `bulkExpiry` is a date-input value (YYYY-MM-DD format);
`NO_COMMA_RE` regex cannot capture arbitrary HTML.

**Human checks (log here after testing on device):**
- [ ] Type "Coconut cream 200ml" in bulk add → parses as name + qty + unit (no unit-as-name bug)
- [ ] Type "Garlic 3 cloves" → parses correctly; "Salt" alone → name only
- [ ] Edit qty/date on an open pantry card → card stays open after save
- [ ] Toggle "expires/bought" on a pantry card → card stays open
- [ ] Pantry item not in PANTRY_KNOWLEDGE → no "Storage guide" button on card
- [ ] Bulk add 2 items right now → they appear at top of their storage group for 5 min
- [ ] Set expiry date in bulk add modal → all added items show expiry date on card
- [ ] Unit input in ingredient modal shows dropdown suggestions (g, kg, ml, etc.)

**Branch:** `main` — ready to commit. Push requires manual step (autonomous mode).

**To deploy:**
```
git add app.js index.html planning/TASK.md planning/DONE.md planning/BUILD_QUEUE.md STATUS.md
git commit -m "feat(pantry): bulk-add no-comma parser, card-keep-open, storage guide fix, recent-at-top, expiry field, unit datalist"
git push origin main
```

**Next:** Build queue empty. UX proposals PROP-014..019 await your phone approval (still `status: pending`).

---

## 2026-06-27 — UX audit → 10 proposals (PROP-014..023) into the pipeline

Ran the `ux-ui-guardian` agent scoped to a **whole-app consistency audit** (constraints: vanilla
HTML/CSS/JS, no framework/build, light-only, single `:root`). 10 findings → enriched
proposals in `PROPOSALS.md`, **goal-adjusted vs "Alpha stability"**:
- **Approve (6):** PROP-014 invisible `btn--ghost/danger/success`; PROP-015 white-on-sage contrast fail (WCAG);
  PROP-016 sub-44px tap targets (mis-taps); PROP-017 undefined-var `:root` aliases + duplicated base block;
  PROP-018 empty-state consistency; PROP-019 restore removed focus outlines (a11y).
- **Park (4):** PROP-020 color-token consistency, PROP-021 badge consolidation, PROP-022 spacing-token
  migration, PROP-023 modal sizing — pure cosmetic polish, deferred past stabilize.

Also fixed: **digest now filters to `status: pending` only** (was showing already-decided 1–13).
These flow through the same gated loop — approve from the phone, e.g. `Approve 14-19`.

**Branch:** `main` — committed. **Next:** the 6 queued items (PROP-004,006-010) build tonight; UX
proposals await your phone approval.

---

## 2026-06-27 — 2026-06-27 sprint built: 2 P0 bugs + 1 P1 + 1 P2 (all from approved BUILD_QUEUE)

**Built (4 items, all from BQ-001–004):**

- **BQ-002 (P0) — Dashboard renders on first open.** Root cause: `renderDashboard()` was missing from
  all three init paths. Added to `initApp()` signed-out branch, `initApp()` Firebase-unavailable branch,
  and `loadUserData()`. No tab-switch workaround needed anymore.

- **BQ-003 (P0) — Recipe JSON import works on iOS PWA.** Root cause: `confirm()` inside a FileReader
  callback is silently blocked in iOS Safari standalone mode (returns false, no dialog, silent no-op).
  Replaced with existing `showConfirmDialog()` pattern. Shows recipe count in dialog body. Added an
  inner try-catch so import errors surface correctly rather than being swallowed.

- **BQ-004 (P1) — Duplicate pantry name asks instead of silently skipping.** `addToPantry()` now
  calls `showConfirmDialog()` when a same-name item exists: "You already have X in your kitchen. Add
  another one?" Accepts `forceAdd` param; recursive call with `true` bypasses the check. Supports
  real use case: two jars of oyster sauce with different expiry dates.

- **BQ-001 (P2) — Price Book subtitle reframed.** New copy: "Your personal price reference — record
  what ingredients cost at your go-to stores so you always know what to expect at checkout." Removes
  the implied promise of automatic cheapest-finding.

**Also updated:** `docs/FEATURES.md` (import was incorrectly documented as "replaces"; it's merge-by-id).

**Self Review:** pass — all changes minimal, targeted, reuse existing helpers (`showConfirmDialog`,
`escapeHtml`, `patchMissingNutrition`), no new abstractions.

**QA:** pass — `renderDashboard()` has its own null guard; `escapeHtml(name)` in dialog; `forceAdd`
falsy on normal `onclick="addToPantry()"` calls; hard rules 1–6 untouched.

**Human checks (log here after testing on device):**
- [ ] Dashboard shows real data on first open (no tab-switch needed)
- [ ] Import JSON → dialog appears on iOS → confirm → recipes added
- [ ] Add existing pantry item → "Add another?" dialog appears → confirm → second item added
- [ ] Price Book subtitle reads correctly

**Branch:** `main` — committed locally as `9a78700`. **Push blocked** — remote has diverged
(remote contains commits the local tree doesn't have yet; fetch requires approval in autonomous mode).

**To deploy manually:**
```
git pull --rebase origin main
git push origin main
```

**Next:** After pushing, build queue is empty. Await next sprint approval (remaining proposals:
PROP-004 bulk-add parser, PROP-006 pantry card collapse, PROP-007–013).

---

## 2026-06-26 — Phase 2 reply gate built (PC side); n8n messaging is the remaining wiring

**Architecture (D-017):** n8n owns all Telegram messaging; Claude/PC emits structured output only; the
reply parser is deterministic code (no LLM).

**Built + tested (PC side):**
- `tools/Generate-Digest.ps1` → writes `planning/DIGEST.md` (no `-Send`; n8n reads + sends).
- `tools/Apply-Decisions.ps1` → parses `captures/decisions/*.md` replies (`Approve/Park/Reject/Clarify N`),
  marks `PROPOSALS.md` status, appends Approved → `BUILD_QUEUE.md`. Verified by dry-run + a reverted real
  run; "tell me more about 5" is correctly ignored (numbers must immediately follow a verb).
- `run-claude.ps1` wired: apply decisions (+commit/push) **before** build; refresh `DIGEST.md` (+commit/push) **after**. Parses clean.

**Remaining (yours — needs the bot token + n8n; touches the live capture flow):** two n8n changes —
(1) **morning schedule:** GET `planning/DIGEST.md` from GitHub → Telegram send;
(2) **reply branch:** in the capture workflow, detect an `approve/park/reject` reply → write
`captures/decisions/<id>.md` instead of an inbox capture. I'll provide importable JSON next.

**⚠ Not mine:** an external `library-guardian` run modified `CLAUDE.md` and created `library/requirements/`
— left **uncommitted**; decide if you want it.

**Branch:** `main` — committed. **Next:** n8n JSON, then a real end-to-end reply test from your phone.

---

## 2026-06-26 — Phase 2 (start): digest generator built; reply-gate pending one decision

**Built:** `tools/Generate-Digest.ps1` — a **deterministic** morning digest from `PROPOSALS.md`
(parses each title + `▶ Decision`, groups by recommended action, optional `-Send` to Telegram via
`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`). Verified output by hand. Per the "code for deterministic
transforms" rule, formatting is code; the punchy text comes from each proposal's Decision line.

**Validation finding (the point of this exercise):** the auto-digest is *more verbose* than a
hand-written one because it uses full proposal **titles** + full Decision **reasons** (which include
build-sequencing notes like "sequence after PROP-004" — noise for a *decision*). If the digest must be
self-sufficient AND tight, the contract likely needs a short phone-friendly `digest:` one-liner, and
the Decision reason should hold only what's needed to decide (impact + effort), not build order.

**Reply gate NOT built** (Approve/Park reply → BUILD_QUEUE): needs the Telegram bot token + n8n routing,
and it touches the live capture pipeline. Proposed design (dumb capture / smart apply): n8n routes an
approval-style reply to `captures/decisions/`; a Claude run applies it (marks proposal `status`, moves
Approved → `BUILD_QUEUE.md`). **Awaiting:** your read on the digest + go-ahead + token / n8n access.

**Branch:** `main` — committed.

---

## 2026-06-26 — Phase 1.5: `▶ Decision` field; validate the contract by hand before automating

Added **▶ Decision** (Approve / Park / Reject / Clarify + one-line why) as the lead field on every
proposal and in the Proposal contract; triage prompts (run-claude STEP A, PROMPTS P9) + WORKFLOW Triage
event now emit it first. Recommendations this batch: PROP-001 **Approve (Option A)**, PROP-002..010
**Approve**, PROP-011/012/013 **Park**.

**Deliberately NOT automating yet.** Per the plan: use `PROPOSALS.md` from the phone for a day or two
and confirm the contract is enough to decide *without opening the PC* — then build the Telegram approval
flow (Phase 2) on a contract we've already validated, rather than discovering usability gaps after the
automation exists.

**Branch:** `main` — committed. **Next:** validate in practice → Phase 2 (approval digest + natural-reply gate).

---

## 2026-06-26 — Triage: 11 new captures → 12 proposals (PROP-002 through PROP-013)

**Triage complete.** BUILD_QUEUE was empty (nothing to build). Processed 11 new captures from today's
active alpha use session (msgs 12–32) plus cleaned up 1 stale already-triaged capture (msg 10).

**Key signals from this batch — all from real active use today:**
- **2 P0 bugs (critical, fix before alpha user testing):**
  - PROP-002: Dashboard shows stale/empty data on first open (tab-switch workaround). Broken first impression.
  - PROP-003: Recipe JSON import fails completely (`cpb-diet-import.json` in working tree = test file used).
- **3 P1 items (active friction in core pantry flow):**
  - PROP-004: Bulk add parser bug — omitting comma causes unit (e.g. "ml") to be captured as ingredient name.
  - PROP-005: Duplicate pantry name silently skips instead of asking — user can't add two oyster sauce jars.
  - PROP-006: Pantry card collapses when switching date fields — forces reopen just to fill expiry date.
- **4 P2 improvements (post-P1 UX):**
  - PROP-007: Storage guide shows for unrecognized items → trust damage (hide or flag).
  - PROP-008: Recently added pantry items should sort to top of list (easier to fill expiry/qty).
  - PROP-009: Bulk add needs an expiry date field (removes post-add editing step).
  - PROP-010: Ingredient card unit input — type + dropdown (reduces unit typos).
- **3 P3 items (park for now):**
  - PROP-011: Bulk add autocomplete from pantry/ingredient DB (high effort, dedup complexity).
  - PROP-012: Long press to delete pantry item (P3 shortcut; delete via card already works).
  - PROP-013: Same product, different packaging sizes — product direction decision (data model question).

**Inbox:** All 11 captures marked `status: triaged` + archives created in `captures/processed/2026/06/`.
Note: physical inbox cleanup blocked (no delete permission in autonomous mode) — inbox files are marked
triaged so they won't re-process. Manual cleanup: `git rm captures/inbox/2026062*.md` whenever convenient.

**Next:** Review `PROPOSALS.md` (PROP-002 through PROP-013 pending your judgment). Recommend starting
with the 2 P0 bugs — PROP-002 (dashboard load) + PROP-003 (JSON import) — before any alpha user testing.

**Branch:** `main` — committed as part of pipeline Phase 1 (goal-aware enrichment). Inbox files remain
as `status: triaged` stubs (autonomous mode can't delete); `git rm captures/inbox/2026062*.md` to tidy.

**Blockers:** none (triage only; build gate requires human approval).

---

## 2026-06-26 — Pipeline redesign Phase 0: firewall (capture ≠ build)

**Done (Phase 0 of the gated pipeline, DECISIONS D-015):** separated capture from build so nothing
ships without human approval. Three small commits:
1. New `planning/PROPOSALS.md` (triage output, pending approval) + `planning/BUILD_QUEUE.md` (approved-only — the **only** file the Builder reads). Job #5 migrated → PROP-001.
2. `planning/ROADMAP.md`: retired the auto-building **Task Queue** → now the **protected approved backlog** (only the approval gate writes it). `CLAUDE.md` hard rule 0 + doc map + lifecycle. `DECISIONS.md` D-015.
3. `run-claude.ps1` rewired: Triage **routes to PROPOSALS only** (never builds); Builder builds **only from BUILD_QUEUE** (empty → stops). Single responsibility per stage enforced.
**Effect:** auto-build is gone. The next scheduled run triages the 11 pending inbox captures into
`PROPOSALS.md` (pending your judgment) and **builds nothing** (BUILD_QUEUE is empty).
**Verification:** docs + automation only (no app code). Confirmed the Builder has no path to
inbox/roadmap/proposals for work; BUILD_QUEUE empty.
**Branch:** `main` — committed + pushed.
**Next (do NOT start until you verify Phase 0):** Phase 1 — triage enrichment + evidence-gathering.
**Blockers:** none.

---

## 2026-06-25 — P2 Task 3: Dismiss a suggested grocery item

**Built:**
- `dismissSuggestedGroceryItem(itemId)`: removes from `AppState.groceryList`, sets `pantryItem.suggestDismissed = true`, calls `saveData()` + re-renders.
- ✕ dismiss button on suggested items in `renderGroceryList()` (inside the name row, `event.stopPropagation()` prevents row-toggle).
- `syncStapleToGrocery()`: skips push when `p.suggestDismissed`; clears flag when `stockLevel` returns to `full`/`ok`.
- `checkAndReplenishLowStock()` (non-staple path): skips add when `p.suggestDismissed`; `delete p.suggestDismissed` on restock.
- `.grocery-dismiss-btn` CSS: unobtrusive (low-opacity ×), red on hover.
- DATA_MODEL.md updated with `suggestDismissed` pantry field and `stockLevel` clarification.
**Self Review:** pass (focused function, clear responsibility split, correct flag lifecycle). **QA:** pass (all 4 criteria met; XSS-safe; pantry data untouched; light-only safe).
**Files changed:** `app.js`, `style.css`, `docs/DATA_MODEL.md`, `planning/DONE.md`, `planning/ROADMAP.md`, `planning/TASK.md`, `STATUS.md`.
**Branch:** `main` — committing now.
**Next:** Queue empty. Waiting for human to promote next task or send capture.

---

## 2026-06-25 — P2 Task 2: "Suggested" badge on auto-added grocery items

**Built:** Added `grocery-suggested-badge` to the `grocery-item-name` div in `renderGroceryList()` — renders only when `item.suggested === true`, with `suggestedReason` as the `title` tooltip (XSS-safe via `escapeHtml`). CSS `.grocery-suggested-badge` mirrors `.pantry-badge` with amber colors (`#fef3c7` bg / `#92400e` text) — light-only safe, no dark-mode block.
**Self Review:** pass (reuses pantry-badge pattern exactly; `escapeHtml` on tooltip). **QA:** pass (non-suggested items unchanged; XSS-safe; no light-only invariant violation).
**Files changed:** `app.js`, `style.css`, `planning/DONE.md`, `planning/ROADMAP.md`, `planning/TASK.md`, `STATUS.md`.
**Next:** P2 Task 3 — Dismiss a suggested grocery item (dismiss control + re-add prevention).

---

## 2026-06-25 — P2 Task 1: `suggested` flag on auto-added grocery items

**Built:** Added `suggested: true` and `suggestedReason: 'low stock'` to the grocery item push in both auto-add sites — `syncStapleToGrocery()` (staple path) and `checkAndReplenishLowStock()` (non-staple below-minQty path). Additive only — no existing logic changed. Flag persists through `saveData()` as plain JSON. DATA_MODEL.md updated with grocery item shape and `mealPrepHelpSeen` localStorage entry.
**Self Review:** pass (minimal additive change; same field names in both sites). **QA:** pass (both auto-add paths flagged; manual-add paths untouched; JSON-serializable).
**Files changed:** `app.js`, `docs/DATA_MODEL.md`, `planning/DONE.md`, `planning/ROADMAP.md`, `planning/TASK.md`, `STATUS.md`.
**Next:** P2 Task 2 — "Suggested" badge in the grocery list rendering.

---

## 2026-06-25 — Alpha P1: one onboarding gate (no double-modal on first run)

**Problem:** On first run, `initApp()` scheduled `openHelpModal` after 600ms AND `seedPantryIfEmpty()` opened the Kitchen Setup Wizard synchronously — two modals stacked before the user reached the app.
**Fix (3-line gate):** In the `mealPrepHelpSeen` block, only schedule `openHelpModal` if `pantryOnboardingDone` is already set. When it's absent, the wizard is about to fire, so Help skips. Both flags are checked directly in `localStorage` — no AppState reads needed at that early point in `initApp()`.
**Behaviour after fix:** Brand-new user → wizard only. Returning user (both flags set) → neither auto-opens. Edge: user cleared only `mealPrepHelpSeen` but wizard already done → Help opens normally. All acceptance criteria met. `openHelpModal()` reachable via Settings unchanged.
**Triage:** One capture (`20260625T2227Z-10-feature`) in inbox — confirmed the same priority, archived, no new task created.
**Self Review:** pass (reuses existing `localStorage.getItem` pattern; minimum change; `mealPrepHelpSeen` still set on first run so it doesn't re-open). **QA:** pass.
**Files changed:** `app.js`, `docs/FEATURES.md`, `planning/DONE.md`, `planning/ROADMAP.md`, `planning/TASK.md`, `STATUS.md`, `captures/processed/2026/06/20260625T2227Z-10-feature.md`.
**Branch:** `main` — committing now.
**Next:** P2 drain chain — Task 1: flag auto-suggested low-stock grocery items.

---

## 2026-06-25 — Queued an alpha P1 ahead of tonight's drain; Job #5 preserved

**Queue (top → bottom) for tonight's run:**
1. **Alpha P1 — one onboarding modal on first run** (don't stack Help over the Kitchen Setup Wizard). Friction removal, first impression.
2–4. The P2 low-stock dependency chain (flag → badge → dismiss) — drain test.
**Job #5** ("cheapest") is recorded in ROADMAP as **⏳ decision-pending, do-NOT-auto-build** — preserved, the run must skip it (human decides: descope vs build).
**Tonight:** 9 PM run builds the alpha P1 first, then drains the P2 chain. First unattended run of the new pipeline + QA/Self-Review gates — review `DONE.md`/commits in the morning.
**Branch:** `main` — committed + pushed.
**Blockers:** none.

---

## 2026-06-25 — Alpha P1: "Sample" badge on seeded recipes (Job #3 clarity)

**Why highest-priority:** Job #1 done; Job #4's grocery empty state already guides; Job #5 is a product
decision reserved for the human. The top *implementable* P1 was the Cook tab showing 26 recipes a
first-timer never added ("are these mine?"). On the primary nav, unguided, undermines the differentiator.
**Built:** `isSampleRecipe()` (membership in `sampleRecipes` by id) + a "Sample" badge in the recipe
card header (`#recipe card`), styled with `.recipe-sample-badge` (tokens, mirrors `.recipe-category`).
Derived at render (no state, no data change), reuses card rendering, no redesign.
**Self Review:** pass. **QA:** pass (symbol pair intact, light-only clean, no secrets, XSS-safe static badge). **Verification:** code-trace; eyeball on device.
**Files changed:** `app.js`, `style.css`, `docs/FEATURES.md`, `planning/DONE.md`, `STATUS.md`.
**Branch:** `main` — committed (push pending).
**Next P1 (recommend, do NOT auto-implement):** the **Job #5 decision** — descope "cheapest" (reframe Price Book as a price *reference*) vs build a minimal basket-per-store compare. It's the last external-testing blocker and a product call. Lesser P1: verify cook-suggestion reliability with the wizard-seeded pantry.
**Blockers:** none.

---

## 2026-06-25 — Product prompts added to PROMPTS.md (PP1–PP7)

**Completed:** Split `PROMPTS.md` into **⚙️ Engineering (P1–P10)** and **🎯 Product (PP1–PP7)**.
The product prompts: PP1 Internal Alpha Audit · PP2 UX Friction Audit · PP3 First-Time User Audit ·
PP4 Feature Simplification · PP5 Release Readiness · PP6 User Research Analysis · PP7 Post-Test
Improvement Sprint. They produce **findings/decisions routed into ROADMAP**, not features — honoring
the no-new-features / prefer-simplify constraint and the QA honesty rule (flag human-verified, don't
claim it). Updated `AI-DEV-OS.md` (manifest) + `CLAUDE.md` (doc map). Part of the v1.0 template.
**Self Review:** pass (consistent format, reuse, defers to system docs). **QA:** pass (docs only).
**Files changed:** `PROMPTS.md`, `AI-DEV-OS.md`, `CLAUDE.md`, `STATUS.md`, `planning/DONE.md`.
**Branch:** `main` — pushed.
**Next task:** Remaining alpha quick wins (sample-recipe badge, one first-launch modal) + the Job #5 decision.
**Blockers:** none.

---

## 2026-06-25 — Alpha quick wins: pantry add-feedback + Price Book naming

**Built (2 trust/feedback fixes from the alpha audit):**
1. **Add-feedback toasts** — `addToPantry()` now confirms: `Added "X" to your kitchen`, or
   `"X" is already in your kitchen` (was a silent no-op). Reuses `showSuccessMessage` (textContent →
   XSS-safe). Answers Job #1 directly: type a name, get told if you already have it.
2. **Naming consistency** — the "Price Book" tab opened a screen titled "Ingredient Catalog"; heading
   renamed to **Price Book** to match the tab (trust).
**Self Review:** pass (smallest impl, reuse, did not touch the out-of-scope orphaned qty read).
**QA:** pass (toast textContent-safe; no theme/state change; no secrets). **Verification:** code-trace.
**Files changed:** `app.js`, `index.html`, `docs/FEATURES.md`, `planning/DONE.md`, `STATUS.md`.
**Branch:** `main` — pushed.
**Next task:** Remaining alpha quick wins — "Sample" badge on seeded recipes; collapse first-launch to one modal; then the Job #5 decision (descope vs minimal store-compare).
**Blockers:** none.

---

## 2026-06-25 — Pantry search (Internal Alpha: "did I already buy garlic?")

**Task:** Add real-time pantry search so a growing kitchen stays scannable (Job #1).
**Built:** `#pantry-search` field above the pantry list. Filters by name on input (wired
`addEventListener('input', renderPantry)` — matches the recipe-search pattern); `renderPantry()`
filters within each storage group (grouping preserved), shows an encouraging "No matches" empty state,
and hides the field when the pantry is empty. Reused `emptyState`, `.form-control`, existing tokens —
no redesign, no new state (transient view filter). Files: `index.html`, `app.js`, `style.css`.
**Self Review:** pass (smallest impl, reuse, no debt; search input is a sibling of `#pantry-list` so it
keeps focus while typing). **QA:** pass (ref pair intact, light-only invariant clean, no secrets, all 6
acceptance criteria traced). **Verification:** code-trace only — eyeball on device after deploy.
**Files changed:** `index.html`, `app.js`, `style.css`, `docs/FEATURES.md`, `planning/DONE.md`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Other alpha quick wins (add-feedback toast, Price Book naming, sample-recipe badge) — see the alpha audit.
**Blockers:** none.

---

## 2026-06-25 — METRICS.md + OS locked at v1.0; product direction set

**Completed:**
- New `METRICS.md` — weekly engineering metrics, each tagged Auto (git/files) vs Manual (honesty rule). Seeded an honest bootstrap baseline (1 user-facing feature, 3 fixes, 0 reverts, 4 captures, no autonomous builds yet — labeled as baseline, not steady-state).
- **AI Dev OS locked at v1.0** (`AI-DEV-OS.md`) — stop refining the workflow; build the product.
- Product direction (5 sprints) added to `planning/ROADMAP.md`: polish → user testing (5–10 real users) → fix → product intelligence → public beta. North star: **10 users > more features.**
- Registered `METRICS.md` in `CLAUDE.md`.
**Files changed:** `METRICS.md` (new), `AI-DEV-OS.md`, `CLAUDE.md`, `planning/ROADMAP.md`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next mission (human):** get **10 people using the app** — collect where they stick / ignore / delight / confuse. That feedback > more workflow refinement.
**Blockers:** none.

---

## 2026-06-25 — AI-DEV-OS.md template manifest (app-creation system)

**Task:** Make the AI Dev OS reusable — define the template so new apps inherit the full pipeline.
**Completed:** New `AI-DEV-OS.md` — manifest of **generic** OS files (clone as-is: WORKFLOW, SELF_REVIEW,
QA, PROMPTS, OPERATOR, GUIDE, CLAUDE router, run-claude.ps1, n8n workflow, captures/planning/STATUS
scaffolds) vs **app-specific** files (CLAUDE project block + hard rules, all of docs/, QA `[app]`
checks), plus a 7-step new-app bootstrap. Self Review + QA are now part of the template. Registered in
`CLAUDE.md`; ROADMAP "extract ai-dev-os" Research item updated (manifest done, repo lift remains).
Also pushed: the light-only fix (`7cb87f5`) — **now live, ready for the dark-mode phone test.**
**Files changed:** `AI-DEV-OS.md` (new), `CLAUDE.md`, `planning/ROADMAP.md`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Verify light-only on a dark-mode phone (live). 3-task drain chain still queued for tonight.
**Blockers:** none.

---

## 2026-06-25 — Self Review event + SELF_REVIEW.md (code health, "would I ship this?")

**Task:** Separate "is it *good code*?" (Self Review) from "does it *work*?" (QA) as distinct gates.
**Completed:** New `SELF_REVIEW.md` — Code Health checklist (duplication, magic numbers, complexity,
dead code, TODOs, reuse, naming, unnecessary state/DOM queries, extract-to-helper) + the one-question
gate **"Would I ship this?"** ("Almost" = not done). All items AI-verifiable by reading the diff;
honesty rule preserved (human-only aspects → `ship-pending-human-review`, never claimed verified).
Lifecycle: **Execution → Self Review → Task Completion → QA gate → Commit.** Wired into `WORKFLOW.md`
(new event 4, renumbered, diagram, file map), `CLAUDE.md` (doc map + lifecycle), `PROMPTS.md` (P10),
`run-claude.ps1` (COMPLETED branch). Recorded as DECISIONS **D-014**.
**Files changed:** `SELF_REVIEW.md` (new), `WORKFLOW.md`, `CLAUDE.md`, `PROMPTS.md`, `run-claude.ps1`, `docs/DECISIONS.md`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** 3-task dependency chain still queued for tonight's drain (now gated by Self Review + QA).
**Blockers:** none.

---

## 2026-06-25 — QA.md pre-commit quality gate added to the OS

**Task:** Add a mandatory, AI-runnable QA checklist before every production commit.
**Completed:** New `QA.md` — 6 sections (Functional / Visual & Responsive / Regression / Data
Integrity / Documentation / Git Hygiene), each item grep/trace-verifiable by an agent, grounded in
this repo's hard rules (`[app]`-tagged). Explicit **AI-verifiable vs Human-verifiable** split: AI
checks gate the commit (fail → Blocked); human checks (phone feel, polish, copy, real-device render)
are logged to STATUS, never block a run. Wired in: `WORKFLOW.md` Commit event + file map, `CLAUDE.md`
doc map + lifecycle, `run-claude.ps1` COMPLETED branch.
**Files changed:** `QA.md` (new), `WORKFLOW.md`, `CLAUDE.md`, `run-claude.ps1`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Queue still holds the 3-task dependency chain for tonight's drain (now gated by QA.md).
**Blockers:** none.

---

## 2026-06-25 — Light-only release: force light, remove dark mode (D-013)

**Why:** Dark-mode phones auto-applied a broken/inconsistent dark theme + darkened native controls, eroding trust. Product decision: ship one polished light theme.
**Cause (audit):** (1) inline JS set `data-color-scheme="dark"` from `prefers-color-scheme`; (2) two `@media (prefers-color-scheme: dark)` CSS blocks auto-swapped tokens; (3) no `color-scheme` declared → WebView darkened native form controls.
**Fix (web standards, no hacks):** `<meta name="color-scheme" content="light">` + `color-scheme: light` on `:root` + static `data-color-scheme="light"` on `<html>`. Removed the theme script, both `@media` dark blocks, the `[data-color-scheme="dark"]` token block, and all 12 `[data-color-scheme="dark"] .x` overrides. The `[data-color-scheme="light"]` block stays the single light theme → light appearance unchanged.
**Verification:** grep-confirmed zero `prefers-color-scheme` / `data-color-scheme="dark"` / JS theme logic remain; confirmed no light rule references a now-undefined token (`--color-border-secondary`/`--button-border-secondary` had zero uses). **Code-traced only — not yet tested in a real browser/phone.** Needs a live check on iOS Safari + Android Chrome in device dark mode.
**Files changed:** `index.html`, `style.css`, `docs/DECISIONS.md` (D-013), `docs/DATA_MODEL.md`, `planning/ROADMAP.md`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Deploy + verify on a dark-mode phone (the whole point); then the broader UX polish is parked.
**Blockers:** none.

---

## 2026-06-25 — Pipeline validation: first real feature through the full lifecycle

**Why:** Prove the *build* half end to end before trusting tonight's scheduled run (capture + triage
were already proven; build was not).
**Feature shipped:** Live recipe count on the Cook tab — `#recipe-count` shows how many recipes match
the active search/filter, updates in `renderRecipes()`. Files: `index.html` (count div), `app.js`
(set count from `filteredRecipes`), `style.css` (`.recipe-count`).
**Lifecycle exercised:** Triage (scored strong/goal #1, complexity S) → routed → promoted → Execution
→ Task Completion (FEATURES.md + DONE.md + this entry) → Commit. Capture archived to
`captures/processed/2026/06/20260625T1900Z-validation-feature.md`.
**Verification:** Code trace — count rides the existing filter render path; guarded against a missing
element; "1 recipe"/"N recipes"/"0 recipes" handled. **Not run in-browser here** — eyeball it on the
live site after deploy (Cook tab, type in search → count should change).
**Result:** Build half works end to end. Tonight's 9 PM scheduler run is now confirmation, not a first test.
**Next task:** Queue empty. Start real captures.
**Blockers:** none.

---

## 2026-06-25 — OPERATOR.md + GUIDE slimmed; triaged 2 noise captures

**Docs:** Added `OPERATOR.md` (human playbook: 7 operating principles + daily/weekly rhythm); slimmed
`GUIDE.md` to a muscle-memory capture card; registered both in `CLAUDE.md`.
**Triage:** 2 inbox captures dropped as noise — the GUIDE cheat-sheet text pasted into the bot chat,
and an empty message. Both archived to `captures/processed/2026/06/`. Inbox empty.
**Friction found:** the bot captures *everything* sent to it. Reference material (the cheat sheet)
belongs in Telegram **Saved Messages**, not the bot chat.
**Next task:** Queue empty. Start sending real `/feature`/`/bug` captures.
**Blockers:** none.

---

## 2026-06-25 — Capture pipeline live; first Triage

**Triage:** 1 capture in `captures/inbox/` (`20260625T1621Z-4-feature`, "test capture") → recognized as
a smoke-test, **dropped** (no task created), archived to `captures/processed/2026/06/`. Inbox empty.
**Pipeline status:** Telegram → n8n → `captures/inbox/` confirmed working end to end (real commit + reply).
**Next task:** Queue empty. Send a real `/feature`/`/bug` from Telegram, or promote a task into `planning/TASK.md`.
**Blockers:** none.

---

## 2026-06-25 — Mobile capture pipeline (Telegram → inbox → Triage) + repo reorg

**Task:** Build the Telegram capture system: dumb capture in n8n, smart Triage in Claude.
**Completed:**
- **Reorg:** `planning/` (ROADMAP, TASK, DONE) + `captures/` (inbox, processed). `STATUS.md`/`CLAUDE.md` stay at root.
- `planning/DONE.md` split out of ROADMAP; ROADMAP gained **Ideas** + **Research** parked buckets.
- `WORKFLOW.md`: new **Triage** event (runs first) — categorize, dedupe, **goal-score vs PROJECT.md**, route, archive to `captures/processed/YYYY/MM/`. Updated diagram, file-change table, autonomous behavior, all paths.
- `docs/PROJECT.md`: added ranked **North-star goals** for triage scoring.
- `captures/README.md`: pipeline contract + capture file format (`id` = idempotency key).
- `CLAUDE.md`, `PROMPTS.md` (P9 Triage), `run-claude.ps1` (Triage-first flow, planning/ paths, `git mv` allowed) updated.
- `n8n-telegram-inbox.json`: redesigned workflow — n8n only creates files in `captures/inbox/` (folder approach, no sha/merge race). Needs your bot token, PAT, and Telegram user id.
- DECISIONS **D-011** (capture pipeline + reorg) and **D-012** (goal-aligned triage scoring).
**Verification:** Docs/structure only — no app.js change. n8n JSON is best-effort (placeholders), **not import-tested**.
**Files changed:** `planning/*` (moved+new), `captures/*` (new), `WORKFLOW.md`, `CLAUDE.md`, `PROMPTS.md`, `run-claude.ps1`, `docs/PROJECT.md`, `docs/DECISIONS.md`, `n8n-telegram-inbox.json`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Wire n8n (token/PAT/user-id), send a test `/feature`, confirm a file lands in `captures/inbox/`, then let a run triage it. Old `n8n-telegram-github.json` can be deleted (superseded, D-011).
**Blockers:** none.

---

## 2026-06-25 — Fix: cloud data wiped on deploy/reload (signed-in users)

**Task:** Stop signed-in users' Firestore data being wiped after a push/deploy.
**Root cause:** Writes (30s auto-save, `online` event, renders) could fire before the cloud doc was
read — `loadUserData()` isn't awaited and `loadFromFirestore()` loads nothing if `navigator.onLine`
flickers false. `saveToFirestore()` uses `tx.set` (full overwrite), so a save with default/empty
`AppState` overwrote the whole cloud doc.
**Fix:** Added `AppState.cloudReady` write guard — `saveToFirestore()` no-ops until the cloud baseline
is read (`loaded`/`empty`, an `onSnapshot`, or sign-up seeding); resets on each sign-in; the `online`
handler now loads (not pushes) when not ready. Also fixed `loadFromFirestore()` omitting `cookHistory`.
**Verification:** By code trace only — no runtime/automated test harness for this path. Traced deploy
+ flaky-connection, normal load, sign-up, offline, and online-recovery scenarios; cloud is never
overwritten with un-loaded state. **Recommend a real signed-in deploy test before trusting it fully.**
**Files changed:** `app.js`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`,
`docs/DECISIONS.md` (D-010), `ROADMAP.md` (residual `tx.set` debt), `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Manually verify on the live site signed in; then consider the field-level-merge debt (ROADMAP).
**Blockers:** none.

---

## 2026-06-25 — No tasks remaining

**Task:** None — ROADMAP.md Task Queue is empty and TASK.md is NO ACTIVE TASK.
**Action:** Autonomous run stopped per WORKFLOW.md (no-active-task behavior). No work invented.
**Next task:** Add prioritized tasks to `ROADMAP.md` Task Queue, then promote the top item into `TASK.md` to activate the next run.
**Blockers:** none.

---

## 2026-06-24 — Task-driven lifecycle (WORKFLOW.md), replaces "session end"

**Task:** Redesign the dev workflow around task completion + explicit events instead of unreliable "session end".
**Completed:**
- New `WORKFLOW.md` — source of truth for the lifecycle: 6 events (Planning, Execution, Checkpoint, Task Completion, Commit, Next Task Selection), per-file change timing, and autonomous behavior for completed/partial/blocked/no-task.
- `CLAUDE.md` — replaced "Read/Update protocol (session)" with a Lifecycle pointer to WORKFLOW.md + kept the per-task read-routing table; added WORKFLOW.md to the doc map.
- `TASK.md` — added Blocker field; Current Step marked as the resume point; Done conditions reference WORKFLOW.md.
- `ROADMAP.md` — added a **Blocked** section; flow description now defers to WORKFLOW.md.
- `PROMPTS.md` — P7 reframed "Session wrap-up" → **Checkpoint**; added **P8 — Resume**.
- `run-claude.ps1` — autonomous prompt rewritten to the event model (resume → execute → completed/partial/blocked outcomes, Checkpoint on stop).
- `DECISIONS.md` — added **D-009** (task-driven lifecycle; no session end).
**Files changed:** `WORKFLOW.md` (new), `CLAUDE.md`, `TASK.md`, `ROADMAP.md`, `PROMPTS.md`, `run-claude.ps1`, `docs/DECISIONS.md`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Queue empty; promote a task into `TASK.md` to activate the next run.
**Blockers:** none.

---

## 2026-06-24 — PROMPTS.md: reusable session prompts

**Task:** Add a prompt library so task framing stays consistent across sessions.
**Completed:** New `PROMPTS.md` with P1–P7 (draft task → TASK.md, implement, fix, refactor, audit, record decision, wrap-up). Each defers to `CLAUDE.md` for rules so it can't drift. Registered in the CLAUDE.md doc map (not auto-read).
**Files changed:** `PROMPTS.md` (new), `CLAUDE.md`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Queue empty; promote a task into `TASK.md` to activate the next run.
**Blockers:** none.

---

## 2026-06-24 — TASK.md: single active-task handoff

**Task:** Split tactical (active task) from strategic (roadmap) so the autonomous agent never picks priorities.
**Completed:**
- New `TASK.md` — the single active task (Objective / Current Step / Success Criteria / Definition of Done); idle state = NO ACTIVE TASK.
- `CLAUDE.md` read protocol now: CLAUDE → STATUS → **TASK** → only-required docs. Update protocol: on task done, promote next ROADMAP queue item into TASK.md (mechanical FIFO).
- `ROADMAP.md` is now strategic only — removed "Current Task"; the agent works `TASK.md`, not the roadmap.
- `run-claude.ps1` rewritten to the new flow (reads TASK.md, stops on NO ACTIVE TASK).
- Noted for later: `PROMPTS.md` (deferred — not built).
**Files changed:** `TASK.md` (new), `CLAUDE.md`, `ROADMAP.md`, `run-claude.ps1`, `STATUS.md`.
**Branch:** `main` — on disk, not yet committed.
**Next task:** Queue empty; promote a task into `TASK.md` to activate the next autonomous run.
**Blockers:** none.

---

## 2026-06-24 — AI-first documentation system

**Task:** Redesign project docs for AI-assisted development; retire the monolithic `feature-inventory.md`.
**Completed:**
- New router `CLAUDE.md` (read/update protocol + hard rules + gotchas, folded in).
- New `docs/`: `PROJECT.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `FEATURES.md`, `DECISIONS.md` (D-001…D-008 seeded).
- `ROADMAP.md` restructured: kept the autonomous Current Task / Queue / Done sections, added **Known Issues & Debt** (merged from KNOWN_ISSUES), kept **Do Not Work On**.
- `feature-inventory.md` content split across the above, **line numbers stripped** (stable anchors only), then deleted.
- `ROADMAP.md` + `STATUS.md` kept at **repo root** (not `/docs`) because `run-claude.ps1` reads them there by name.
**Files changed:** `CLAUDE.md`, `ROADMAP.md`, `STATUS.md`, `docs/*` (new), `feature-inventory.md` (deleted).
**Branch:** `main` — on disk, not yet committed.
**Next task:** Queue is empty — add tasks to `ROADMAP.md` before the next session. Optionally commit the doc migration.
**Blockers:** none.

---

## 2026-06-24 — Autonomous overnight session — queue empty, devops housekeeping

**Tasks completed:**
1. Committed pending devops schedule changes (9PM/2AM triggers) — `DEV-OPS-GUIDE.md`, `run-claude.ps1`, `setup-task-scheduler.ps1`
2. Added `claude-session.log` to `.gitignore` to prevent it appearing as untracked every run

**Files changed:** `DEV-OPS-GUIDE.md`, `run-claude.ps1`, `setup-task-scheduler.ps1`, `.gitignore`, `STATUS.md`
**Branch:** `main` — committed and pushed.
**Next task:** No tasks in queue — add new tasks to ROADMAP.md before the next session.
**Blockers:** none

---

## 2026-06-23 — Autonomous overnight session — full ROADMAP queue completed

**Tasks completed (in order):**
1. Weekly nutrition totals in the Plan tab — `renderWeeklyNutritionTotals()` called from `renderWeeklyPlanner()`, renders into `#weekly-nutrition-totals` div
2. Grocery list alphabetical sort — `renderGroceryList()` sorts category keys A→Z with "Other" last; fallback to "Other" for missing category
3. Recipe serving scaler on recipe detail — `buildDetailIngList()` + `adjustDetailServings()` + stepper UI in collapsed detail section; resets on close
4. Pantry bulk-add mode — "Bulk add" button + `#bulk-add-modal` + `confirmBulkAdd()` with warning list for bad lines
5. Cook history log — `AppState.cookHistory` persisted to localStorage + Firestore; dashboard shows last 10 entries newest-first

**Files changed:** `app.js`, `style.css`, `index.html`, `ROADMAP.md`, `STATUS.md`
**Branch:** `main` — all changes on disk, NOT yet committed or pushed.
**Next task:** `git add app.js style.css index.html ROADMAP.md STATUS.md && git commit -m "feat: weekly nutrition totals, grocery sort, recipe scaler, bulk pantry add, cook history" && git push origin main`
**Blockers:** none (code is done)

---

## 2026-06-22 — Autonomous session — commit pending work from last session

**Task:** Commit and push all pending changes from the previous overnight session.
**Completed:** Verified all diffs against ROADMAP Done entries. All changes correct. Committed and pushed to main.
**Files changed:** `app.js`, `style.css`, `index.html`, `ROADMAP.md`, `STATUS.md`, `DEV-OPS-GUIDE.md`, `run-claude.ps1`, `setup-task-scheduler.ps1`
**Branch:** `main` — committed and pushed.
**Tests:** Code inspection; no regression risk (all additive changes).
**Next task:** No tasks remaining — queue is empty.
**Blockers:** none

---

## 2026-06-22 — Autonomous overnight session — full ROADMAP queue completed

**Tasks completed (in order):**
1. Mung Beans in INGREDIENT_DB — added to `app.js` with aliases, priceValue, minStockQty
2. Silent JS errors — `updateGrocerySummary()` null check added; other two bugs already fixed
3. Service worker — `sw.js` verified working; no code changes needed
4. Dead code removal — skipped (Storage Guide and `customIngredients` are actively used at 15+ call sites; removal would break the app)
5. Global error handler — `window.addEventListener('error', ...)` at end of `app.js`; `.global-error-banner` CSS in `style.css`
6. Text search in Ingredient Catalog — already implemented; added `#ingcat-no-results` element
7. "Buy it" button on cook suggestions — `buyMissingIngredient()` + button on "Missing 1" tier cards
8. Recipe favorites — `toggleFavorite()` + heart button on each card + "♥ Favorites" checkbox filter
9. Plus carried over from previous session: Password reset, Expiry suggestions, Grocery→Pantry transfer, Paste parser improvement, Filipino ingredients in LOCAL_NUTRITION_DB, Grocery list refresh on serving size change

**Files changed:** `app.js`, `style.css`, `index.html`, `ROADMAP.md`, `STATUS.md`
**Branch:** `main` — all changes on disk, NOT yet committed or pushed.
**Next task:** `git add app.js style.css index.html ROADMAP.md STATUS.md && git commit -m "feat: recipe favorites, buy-it button, global error handler, mung beans, and bug fixes" && git push origin main`
**Blockers:** none (code is done)

---

## 2026-06-22 — Phase C: Pantry Auto-Deduct (Session 2 — commit done)

**Task:** Commit and push the feature/pantry-auto-deduct branch
**Completed:** Verified code from previous session. Created branch `feature/pantry-auto-deduct`, committed `app.js` + `STATUS.md` (commit `8bfc950`). Push blocked by sandbox — requires manual step.
**Files changed:** `app.js` (6 lines changed), `STATUS.md` (new file committed).
**Branch:** `feature/pantry-auto-deduct` — committed locally, NOT yet pushed.
**Tests:** Criteria 1–5 verified by code inspection. Criterion 6 (Playwright) requires GitHub Actions after push.
**Next task:** Run `git push -u origin feature/pantry-auto-deduct` manually, then open a PR to main.
**Blockers:** `git push` blocked by sandbox in autonomous mode. Manual push required.

---

## 2026-06-22 — Phase C: Pantry Auto-Deduct

**Task:** Implement pantry auto-deduction in `markRecipeCooked()` per ROADMAP.md Phase C
**Completed:** Fixed `deductIngredientsForRecipe()` in `app.js` (lines 6432–6459). The function already existed and handled subtraction + unit conversion, but was missing the removal step when qty <= 0. Added `depleted` array to track IDs, then filter `AppState.pantry` after the loop.
**Files changed:** `app.js` — 6 lines added (~line 6432). STATUS.md — this entry.
**Branch:** Changes saved to disk but NOT committed. Session was not launched via run-claude.ps1, so git write operations were blocked (not in allowedTools). Action required: run `git checkout -b feature/pantry-auto-deduct && git add app.js STATUS.md && git commit -m "Fix: remove depleted pantry items after cooking a recipe"` manually.
**Tests:** Criteria 1–5 verified by code inspection (see ROADMAP.md). Criterion 6 (Playwright) requires GitHub Actions after push.
**Next task:** 1. Commit + push the branch. 2. Open PR to main. 3. Verify Playwright passes. 4. Merge.
**Blockers:** none (code is done, only commit step pending)

---

## 2026-06-22 — System Setup

**Task:** Set up async development workflow
**Completed:** Created ROADMAP.md and STATUS.md. Phase C defined.
**Files changed:** ROADMAP.md (new), STATUS.md (new)
**Branch:** none (no code changes)
**Tests:** not run
**Next task:** Implement pantry auto-deduction in `markRecipeCooked()` per ROADMAP.md Phase C
**Blockers:** none

## 2026-07-05 21:00 -- AUTOMATION HALTED: claude -p exited with code 1
Investigate before the next scheduled run. Nothing further was committed, pushed, or notified this run.
