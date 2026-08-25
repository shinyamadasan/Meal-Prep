# Session Log

Newest entry at top. Append after every session — never edit past entries.
The top entry is the current **working memory** (where we are / next task / blockers).

---
## 2026-08-25 — Bulk Add partial-retry merged (TASK-052, D-068) — you cannot keep a row for correction and commit it too

`fix/bulk-add-partial-retry` → `main` (`dcd69a1`, `--no-ff`, unrebased). One commit, `73bee77`.
`wave1-portion-truth` remains parked at `88b5598`, untouched.

### The retry loop was unusable

Bulk Add persisted the valid lines, held the modal open because a sibling line warned, and left the
textarea **completely untouched**. Pressing Add Items again resubmitted everything that had already
succeeded, which then reported "already in pantry — skipped". The only warning the user could see
was about food already safely in the kitchen, and nothing said which items had actually landed.

### The characterisation that changed the task

The brief specified that ambiguous and invalid-date lines are actionable and should stay in the
textarea. Driving all eight cases through the real modal showed **those lines were already being
added** — neither warning path returned:

```
"Milk 2 L 8/8/2026"            -> warned, AND added as name="Milk 2 L 8/8/2026"
"Eggs, 12, pcs exp:2026-02-31" -> warned, AND added as "Eggs", shared expiry substituted
```

Keeping such a line for correction while its record exists produces, on retry, a junk record **plus**
a clean second copy (Milk — different names, so the duplicate guard never fires) or a confusing
bounce (Eggs). The brief's own acceptance behaviour was unreachable without changing this.

**So Bulk Add moved from `warn + add anyway` to `actionable warning = hold the line back for
correction`, because a retry-safe flow cannot commit a row that still needs editing.** Flagged at
hand-off as a behaviour change beyond control flow, and explicitly approved. Not to be restored.
D-067 parsing is untouched — the invalid date is still rejected, the ambiguous one never guessed.

### The contract now

| status | meaning | textarea |
|---|---|---|
| `added` | committed once | drops out |
| `skipped` | already in pantry; not fixable by editing | drops out, still reported |
| `attention` | not committed, user can fix | **stays**, original text and order |

Classified by explicit status, never by matching warning wording. Valid lines are still persisted
when a sibling needs work — tolerant, not transactional, which is the whole reason the textarea has
to be pruned. Shared Storage/Expiry survive a partial submit and still apply on the retry.
All-duplicate now closes instead of trapping the user in a retry that cannot progress.

### The lesson from my own mutation check

The first mutation run failed only 6 of 18 and **not** the central retry test — because my helper
overwrote the whole textarea instead of editing what was in it, and because the notes panel is
cleared when the modal closes. A test that cannot see the bug it exists to catch is worse than no
test. Fixed by correcting the date in place in the real post-submit contents and asserting the
**summary** text, which is the signal that actually distinguishes the two behaviours. 7 of 18 now
fail under the mutation.

### Where we are

Local suite 265 → **283**. Focused partial-retry + date-truth + inventory-expiry + Kitchen Truth +
Food Attention **107 passed**. `Verify-Decisions` 20/20. Red zone not entered: `app.js` and
`style.css` only, with `index.html`, `sw.js` and `manifest.json` byte-unchanged, no new `AppState`
key, and no sync/storage/auth/freshness/parser identifier added or removed.

Two shipped D-067 assertions that encoded the old warn-and-add behaviour were updated, with the
reason recorded inline in the spec. Changing an approved test is worth saying out loud.

### Carried forward, deliberately not fixed

- Slash dates remain unsupported; no year sanity range.
- Historical free-text pantry records are not migrated.
- Skipped-line detail is transient — once the modal closes only the toast summary carries the count.
- A typo'd but otherwise valid name is classified `added` and drops out. Correct: it is in inventory,
  and the Inventory card is where it gets edited. Bulk Add is an input surface, not an editor.
- The uncommitted automation edits to `STATUS.md`, `planning/CODEX_READY.md` and
  `planning/DIGEST.md` from the halted 2026-08-23 run were **again** not absorbed — third session
  running. `DIGEST.md` still carries mangled Unicode from the `Add-Content` gotcha.

---

## 2026-08-25 — Bulk Add date truth merged (TASK-051, D-067) — the same bug, through the other door

`fix/bulk-add-date-truth` → `main` (`d2abf03`, `--no-ff`, unrebased). One commit, `281c0b4`.
`wave1-portion-truth` remains parked at `88b5598`, untouched.

### D-066 fixed one entry point; the defect just moved to the other

Yesterday's TASK-050 gave the quick-add path structured quantity/unit/expiry fields. Bulk Add kept
its older text parser, so a production dogfooding session hit the identical failure:

```
input : eggs 12 pcs aug 8 2026
stored: name="eggs 12 pcs aug 8 2026", quantity=null, unit="", no expiry
shown : Best by Aug 28 · 3d left
```

The whole string became the `name`. `inferCategory()` loose-matched "eggs" → Protein, and
`categoryShelfLife('Protein')` supplied **3 days** from today. The Aug 8 was never read. Same
invented freshness, same north-star-goal-#2 exposure, different door.

**The lesson worth keeping: fixing a defect at one entry point is not fixing the defect.** The app
had two manual paths into inventory and only one of them was hardened.

### Characterisation found two more, one of them silent

Driving the real `confirmBulkAdd()` in a browser rather than reading the source:

- `eggs, 12, pcs, aug 8 2026` parsed name/qty/unit correctly and then **discarded the fourth comma
  field entirely, with no warning**. Worse than the reported case in one way — nothing on the card
  looks wrong, so the item just carries a category guess forever.
- `exp:2026-02-31` passed the old `!isNaN(new Date(...))` guard and stored a date the D-066 renderer
  displayed as **"Expires Mar 3"**. `new Date()` rolls over silently, so shape validation is not
  date validation.
- **Bulk Add had no parser test coverage at all.** Every pre-existing spec matching "bulk" tests
  bulk *cleanup*, an unrelated feature. This parser had shipped untested since it was written.

### What landed

`parseTrailingDate()` recognises exactly three shapes, trailing position only — `aug 8 2026`,
`8 aug 2026`, `2026-08-08`. On a match the date is stripped and the remainder goes through the
**existing** quantity/unit parser; the comma path and `NO_COMMA_RE` are byte-unchanged. On no match
the text is left completely alone.

It is deliberately not an NLP layer, and the reason is load-bearing: requiring a **month word (or
full ISO) plus a four-digit year** is the entire defence of `7 Up`, `Heinz 57 Sauce`,
`Formula 1 Protein`, `Vitamin B12`, `12 Grain Bread`, `Omega 3 6 9`, `Vitamin 2000` and
`Sauce 12 2026`. The obvious future "improvement" — accepting a bare trailing number — breaks all of
them at once. That warning is written into the code comment and D-067 on purpose.

`8/8/2026` is refused rather than parsed: day-first in half the world, month-first in the other, and
a wrong guess moves an expiry by up to eleven months into a food-safety signal. It is recognised
only so the user can be told it is ambiguous.

Precedence, strongest first: line `exp:` → recognised trailing date → shared field → bought-date +
shelf life. A trailing date is stripped **even when `exp:` also appears**, so a typed date can never
survive inside the name while still losing to the stronger source.

### Where we are

Local suite 244 → **265**. Focused bulk-add + inventory-expiry + Kitchen Truth + Food Attention
**89 passed**. `Verify-Decisions` 16/16. Mutation-checked at 14-of-21 failing against unmodified
`main`. Red zone not entered: `app.js` and `index.html` only, with `style.css`, `sw.js` and
`manifest.json` byte-unchanged, and a diff grep finding no sync/storage/auth/freshness identifier
added or removed. One expiry model still — records land in the existing `expiryDate`/`dateMode`
fields and render through the unchanged D-066 path.

### Carried forward, deliberately not fixed

- Warnings keep the Bulk Add modal open even when some items were added successfully; correcting the
  offending line and resubmitting then hits "already in pantry — skipped". Pre-existing behaviour for
  **all** warnings, not introduced here, but a new class of warning makes it easier to reach.
- Slash dates stay unsupported by design.
- No year sanity range — `aug 8 1801` is a real calendar date, accepted, and honestly rendered as
  long expired.
- Historical free-text pantry names are **not** migrated or back-parsed.
- A product name genuinely ending in a month and a year, typed with no quantity, is read as
  name + expiry. Adding a quantity moves the date out of trailing position.
- The uncommitted automation edits to `STATUS.md`, `planning/CODEX_READY.md` and
  `planning/DIGEST.md` from the halted 2026-08-23 run were again **not absorbed**. `DIGEST.md` still
  carries mangled Unicode from the `Add-Content` gotcha and needs the automation to regenerate it.

---

## 2026-08-24 — Inventory expiry truth merged (TASK-050, D-066) — the badge was not ambiguous, it was wrong

`fix/inventory-expiry-date-truth` → `main` (`142ec35`, `--no-ff`, unrebased). Two commits:
`8b133e3` structured manual pantry add + explicit/derived expiry rendering, `e8ad4fb` mobile
pantry-add wrapping. `wave1-portion-truth` remains parked at `88b5598`, untouched.

### Characterise before fixing — it changed what the defect was

A dogfooding screenshot: an item added as `eggs 12pcs august 10 2026` rendered that whole string as
the item name, next to `3d left`. The reported problem was that the date looked embedded in the
name and only the relative freshness was exposed.

Replaying the exact input against the shipped code showed the display ambiguity was the **smaller
half**. `addToPantry()` read `#pantry-input` verbatim into `name`, so the string *was* the name —
`quantity` stayed `null`, `unit` stayed `''`, `expiryDate` was never set. `inferCategory()` still
loose-matched "eggs" inside the string and returned `Protein`; the exact-name shelf-life lookup then
failed and fell back to `categoryShelfLife('Protein')` — **3 days**, counted from today.

**That, not the user's typed date, produced `3d left`.** The same item entered with its real date is
`Expired 14d ago`. So the badge was not ambiguous — it was **wrong**, claiming three days of life
for food whose printed date had passed a fortnight earlier. Invented freshness is worse than absent
freshness, and it lands on north-star goal #2. A polish item turned out to be a correctness fix.

The schema needed no change. `name`, `quantity`, `unit`, `expiryDate`, `dateMode`, `purchaseDate`
and `shelfLifeDays` all already existed, and the bulk-add path already populated them correctly.
The quick-add form was collecting one of seven.

### What landed

Optional `#pantry-qty` / `#pantry-unit` / `#pantry-expiry` on the add row, stored in their own
fields, producing the same record shape `confirmBulkAdd()` already produced — so the two manual
entry points stop disagreeing about what an inventory record looks like. Blank still means unknown,
so D-057's "never invent a number" rule holds and storage is still inferred, never asked.

`pantryExpiryInfo()` branches on `dateMode` in the same two cases `pantryDaysLeft()` does, rather
than computing an expiry boundary of its own — a second freshness model is exactly the drift D-057
spent effort eliminating. Cards render `.pi-name`, `.pi-qty` and `.pi-date` separately; a printed
expiry reads **Expires ‹date›**, a derived one **Best by ‹date›** in a quieter style, because
labelling an estimate an expiry claims a certainty this app does not have.

### The scope call I got wrong, then corrected

The 26px name-input squeeze was found during the first commit, verified pre-existing on unmodified
`main`, and left alone under the surgical-changes rule. That was wrong: structured fields are worth
nothing if the row carrying them cannot be typed into on the phone this app is dogfooded on. Fixed
in `e8ad4fb` with two properties — `flex-wrap: wrap` plus a `min-width` floor **scoped** to
`.pantry-add-row` because the same `.ing-name-wrap` is reused by the custom-item modal.

`#pantry-input` width before → after: 320px **26→188**, 390px **26→179**, 414px **45→203**;
768px and 1280px byte-identical, desktop still one line, no horizontal overflow at any width.

### Where we are

Local suite 238 → **244**. Focused inventory-expiry + Kitchen Truth + Food Attention **68 passed**.
`Verify-Decisions` 12/12. Red zone not entered — no Firestore, `saveData()`, `cloudReady`,
tombstone, merge/deletion or auth code touched; `dateMode: undefined` cannot reach Firestore because
both write sites pass through `JSON.parse(JSON.stringify(payload))`.

### Carried forward, deliberately not fixed

- Pantry records created before this task keep their free-text names. **Not auto-parsed, not
  migrated** — the app cannot trustworthily split `eggs 12pcs august 10 2026` back into fields, and
  guessing would re-introduce the exact defect this closed.
- The structured add form is taller on narrow phones (four wrapped lines at 390px). Fitting
  Qty/Unit/Expires on one 390px line needs a date input narrower than is workable.
- No parser/NLP layer. The quick-add box still does not accept the bulk parser's `Name, Qty, Unit`
  grammar; the two entry points now agree on the *record*, which was the real inconsistency.
- The uncommitted automation edits to `STATUS.md`, `planning/CODEX_READY.md` and
  `planning/DIGEST.md` from the halted 2026-08-23 run were **not absorbed** into this work and
  remain in the working tree. `DIGEST.md` still carries mangled Unicode from the `Add-Content`
  gotcha and needs the automation to regenerate it.

---

## 2026-08-24 — Test-infrastructure trust merged (TASK-049, D-065) — the wave where the brief's root cause was wrong

`wave-test-infra-trust` → `main` (`a067b8c`, `--no-ff`, unrebased). Infrastructure only: the diff
against `a292206` for `app.js`, `index.html`, `style.css`, `sw.js` and `manifest.json` is **empty**.
`wave1-portion-truth` remains parked at `88b5598`.

### Check the premise first

The brief stated the overnight automation halted because it invoked `Check-DocsConsistency.ps1`
instead of `.\tools\Check-DocsConsistency.ps1`. It did not, and never had. `run-claude.ps1` uses a
full path, the line is byte-identical to the halting commit, and it runs correctly under both
Windows PowerShell 5.1 — which is what the scheduled task actually invokes — and pwsh 7.

The error message was then *attributed* rather than assumed: only a bare-name call produces
`'Check-DocsConsistency.ps1'`; an empty variable produces `'\tools\…'`; a missing file produces the
full path. No bare-name call exists anywhere in the repo. **The halt is not reproducible from HEAD
and its trigger is still unknown** — logged as an open item, not quietly "fixed".

Ten minutes of checking prevented editing correct code, and pointed at the real defect one line
below: the block's own comment promised *"Non-fatal … it never halts automation"* and then ended in
`catch { Halt-Automation … }`. **A docs-drift report took down the entire overnight run.** A check
that cannot fail safely is worse than no check.

Phase 3b now resolves the path once, tests existence explicitly, and warns-and-continues on both
failure paths. Proven under the scheduler's own PS 5.1 invocation across four cases — checker
present, checker absent, checker throws, and a **reproduction of the exact 2026-08-23 bare-name
error**. All four reach downstream work, none halts, and the failures surface a WARN in both
`claude-session.log` and `DIGEST.md`.

### One number was answering two questions

`npm test` ran 31 spec files together: 21 load `index.html` from the checkout, 10 fetch the deployed
site. A branch's "full suite" therefore partly measured whatever was already **deployed**, and
network latency read as regressions — three CI investigations during the previous wave were spent on
that noise.

Now two Playwright projects: `npm test` == `test:local` is the deterministic offline branch gate
(230 tests, ~58s); `test:prod` is the post-deploy gate (81). CI runs local **first**, so a real
regression surfaces in about a minute instead of after a 90s Pages sleep, then keeps the sleep and
runs prod. Nothing stopped being verified.

The prod set is an explicit list, because three live-site specs predate the `production-smoke-*`
convention. An explicit list rots, so `tests/suite-classification.spec.js` fails the local suite if
any spec is filed in the wrong gate. A classification that isn't enforced is a comment.

### The wait audit was an audit

All 16 remaining `waitForTimeout(2500)` calls were classified before anything was edited. Every one
sat after a `goto` or `reload` — initialisation. None waited on network (local specs abort
`**/firebasejs/**`), none was intentional UX timing. There was no category to preserve, so nothing
was preserved; that is a finding, not a shortcut. Replaced by one shared readiness condition —
`AppState.recipes` present, `saveData` defined, `#dashboard` rendered — deliberately **not**
`recipes.length > 0`, because several specs boot a zero-recipe document on purpose.

Diff across those 9 specs: exactly 16 wait replacements plus 9 requires. No assertion touched. Local
suite ~2.4 min → ~59s.

### The near-miss worth remembering

The first attempt to prove the automation fix wrote the extracted block to a file **without a UTF-8
BOM**. PowerShell 5.1 then misdecoded the em-dash and emoji, the block failed to parse — and the
harness still printed "downstream reached", because a parse error in a dot-sourced file is
non-fatal. Three runs of green nonsense. Caught only by noticing no WARN had reached the log despite
the branch supposedly executing. **A test that cannot fail is not evidence**; when a proof passes
first try, check that its failure mode actually fails.

### Numbers

`test:local` 230 passed · `test:prod` 77 passed / 4 skipped · `npm test` 230 passed ·
suite-classification 6/6 · `Verify-Decisions.ps1` 7/7 · spec files 31 → 32, none deleted.

### Next

Nothing queued. Open items are recorded in TASKS.md and REVIEW.md rather than scheduled: the
historical bare-name trigger is still unexplained; `Check-DocsConsistency` emits 16 mostly-noise
findings and wants a precision pass; production tests inherently cannot validate an unmerged branch;
shorter mid-test waits (500/600ms) were out of the audited class; and the three D-064-hardened specs
keep their own condition helper.

---
## 2026-08-23 (later) — Autonomous triage + plan run: 0 new captures, 0 unconverted BUILD_QUEUE items; PLAN.md un-staled

Planning-only run. No app code touched, nothing built, nothing committed by this session.

**STEP A (Triage):** nothing to do. All **35** files in `captures/inbox/` are already
`status: triaged` — zero at `status: new`. No proposal written, no capture archived.

**STEP B (Plan conversion):** nothing to add. Every BUILD_QUEUE item already has a matching
`source: BQ-<id>` task: BQ-016→TASK-001/002/003, BQ-017→TASK-005, BQ-018→TASK-006, BQ-019→TASK-008,
BQ-020→TASK-009/010, BQ-021→TASK-007, BQ-022→TASK-011, BQ-023→TASK-025, BQ-024/025/026→
TASK-026/027/028. BQ-013/014/015 stay deferred by their own build notes (human decision, not mine).
No task-block reordering was needed — **there are no `status: codex` tasks at all** (the one
`status: todo → codex` line near the end of `TASKS.md` is inside the commented-out template).

**One doc fixed:** `PLAN.md` still described TASK-025..028 as `status: codex` awaiting execution
when all four are `done`, and still listed TASK-017/021/022/024 as held at the `/merge` gate when
they have since landed. Status section corrected and the milestone marked complete; Goal/Approach/
Scope left intact as the historical record of that milestone. Per CLAUDE.md, `Next` reports such a
milestone complete but only a real `Plan` run edits `PLAN.md` — this was that run.

**Where we actually are** (detail in the entry below): cooking-method discovery is merged, deployed
and smoke-tested at `8e847c6`; local suite 224/224 on `main`. The honest next step is still
**dogfooding** the Cook filters and the Home `Easiest` pick before tuning either — `Lowest effort`
is deliberately broad at `<= 2` (26 of 40 recipes) and should be judged from real use.

**Not outstanding implementation work, but still open:** TASK-035 and TASK-038 sit at
`status: approved` awaiting `/merge`; TASK-037 is `blocked` on `task-037` (`7c4785d`) with a stale
blocker (fixed by TASK-040) and needs a rebase + re-run. `wave1-portion-truth` (`88b5598`) remains
parked, still claiming D-054. The Android real-device notification check owed since TASK-046 is
still not done.

**Nothing was queued for Codex by this run.** With an empty build queue and no untriaged captures,
the next move needs a human: approve a new BUILD_QUEUE batch, hand over an operator brief, or
dogfood first and let that decide.

---
## 2026-08-23 — Cooking-method discovery merged and deployed (TASK-048, D-060..D-064) — the wave where the tests were green and the product was broken

`wave-cook-method-discovery` → `main` (`8e847c6`, `--no-ff`, unrebased). Deployed and smoke-tested.
`wave1-portion-truth` remains parked and untouched at `88b5598`.

### The finding worth remembering

The owner opened production Cook and could not find low-effort cooking, rice cooker recipes, or oven
recipes. The obvious conclusion — the filters were never built — was wrong. `RECIPE_QUICK_FILTERS`
had working matchers since D-055, and D-059 shipped a test exercising every chip. Both green.

What was actually true on `main @ 52f33ce`, verified in a throwaway worktree rather than reasoned
about: **`#recipe-quick-filters` rendered as `display: none`, `innerHTML: ""`, zero chips.**
`renderRecipeQuickFilters()` hides any chip that matches no recipes, and **all 26 seeded recipes
carried no `equipment` / `effort` / `activeTime` / `mealBalance` / `tags` whatsoever**. D-059 even
recorded that gap in writing and designed neutral ranking fallbacks *around* it instead of closing
it.

Every discovery test passed the whole time because **each one injected its own fully-tagged fixture
recipes**. That is the lesson to carry: a feature test that supplies its own data proves the code
works, not that the product does. The four new specs assert against the shipped `sampleRecipes`, and
a new production smoke asserts against the deployed bundle.

### What shipped, in four commits

**`9956a3e` — discovery UX.** A primary cooking-method chip never hides now, even at zero: it renders
muted and its empty state names the editor field that fills it. The row is
`All | Lowest effort | Rice cooker | Oven | Instant Pot | No-cook | Pan`, plus `Rice + steamer` and
`Batch-friendly` as refinements that still hide when empty. `Rice cooker` matches both
`rice-cooker` and `rice-cooker-steamer`; `Instant Pot` matches both `instant-pot` and
`pressure-cooker` — a presentation grouping over the existing `equipment[]` slugs, no new field and
no migration. `Lowest effort` was `<= 1` while Home's "Easiest" gate was `<= 2`, so a recipe could
be Easiest on Home and excluded from Lowest effort on Cook; aligned to `<= 2`, with a test asserting
the two agree. The chip also sorts by hands-on work rather than clock time. All 26 originals were
backfilled with truthful `pan` metadata.

**`cf736ba` — 14 low-effort starter recipes (ids 27–40).** 4 rice cooker, 4 oven, 3 Instant Pot,
3 no-cook. Each is written *for* its appliance, and a test greps each recipe's own instructions to
prove it: an `oven` recipe must say oven/bake/roast, a rice-cooker one must say "rice cooker", a
`no-cook` one must not tell you to fry or simmer. The 26 originals are byte-identical — pure
addition, zero deletions — and a test asserts ids 1–26 still carry exactly `['pan']` so nothing can
be quietly relabelled later to make a chip look busier.

**`555efef` — opt-in delivery.** `ensureStarterRecipes()` seeds first-run installs only, and that
gate is correct: re-seeding a live install is how you overwrite someone's data. It was not touched.
Instead a compact, non-blocking Cook prompt adds only what is genuinely absent. Presence on an id is
a permanent skip (the user may have edited it), and `AppState.deletions` is honoured. The tombstone
check is not cosmetic — `applyTombstones()` is last-write-wins, so re-adding with a fresh
`updatedAt` would *beat* the tombstone and resurrect a deleted recipe on every device. Also fixed:
`instant-pot` and `pressure-cooker` are one appliance family and no longer pay the two-appliance
juggling penalty.

**`5f3c342` — seed object isolation.** `[...sampleRecipes]` copied the array only, leaving every
recipe object shared with the module constant — and `toggleFavorite()`, `updateServingSize()` and
`normalizeRecipes()` all mutate in place. This was flagged as *suspicious* in the previous report and
checked before being changed, because "shallow copy looks wrong" is not a reason to touch production
code. It was reachable, and the exploit was reproduced end to end: scale recipe 27 to 8 servings and
favourite it, let a sign-in merge replace `AppState.recipes` with a set lacking 27–40, then use the
starter pack — it added recipe 27 **pre-scaled to 8 servings and already favourited**, then
persisted it. Both seed entry points now deep-copy.

### Two defects the tests caught, not inspection

`patchMissingNutrition()` run over the whole recipe list stamped empty metadata defaults onto the
user's *own* recipes during a starter-pack add. Scoped to the new copies only — adding a starter
pack has no business rewriting anything the user made.

Two Playwright harnesses cleared `localStorage` inside `addInitScript`, which re-runs on every
navigation **including `page.reload()`**. Their reload assertions were starting from a blank slate;
the starter-pack "survives a reload" test had been passing only because a fresh re-seed also yields
40 recipes. Both now guard the clear.

### Test-suite geography, recorded because it caused repeated confusion

**Nine spec files hit the live GitHub Pages site**, not local files. They validate whatever is
deployed, cannot validate a branch, and are network-dependent — every intermittent failure seen
during this wave came from that set (one ready-food smoke run took 5.0 min and failed, then passed
8/8 in 41s). The deterministic branch gate is the 224-test local suite. Worth splitting into
`npm run test:local` / `npm run test:prod` in a future OS pass.

### Numbers

Recipes 26 → 40. Live production chip counts: `All 40 · Lowest effort 26 · Rice cooker 4 · Oven 4 ·
Instant Pot 3 · No-cook 3 · Pan 26 · Rice + steamer 2 · Batch-friendly 23`. Home "Easiest" went from
rendering `Corned Beef Guisado` with an **empty reasons array** to `Tuna Vegetable Rice Bowl ·
No cook · 8 min active · Balanced · Minimal cleanup` — same engine, same weights, only the data
underneath changed.

Local suite 224 passed / 0 failed on the branch and on merged `main`. Full suite 286 passed /
4 skipped / 0 failed. Production smoke against `8e847c6`: 15/15.

### Next

Dogfood the filters and the `Easiest` pick before touching either. `Lowest effort` is deliberately
broad at `<= 2` (26 of 40) — ordering puts assembly and very-low first, so judge the breadth after
real use rather than narrowing it now.

Carried forward, not fixed: the 180-day tombstone horizon means a starter recipe deleted longer ago
than that becomes offerable again; the Firebase multi-device path is untested in the local harness
(Firebase is stubbed in every local spec); `defaultStorageData` and `defaultCookingHacks` may share
the same shallow-copy pattern and need their own audit.

---
## 2026-08-22 — "What should we eat?" merged and deployed (TASK-047, D-059) — a reversible D-032 `done`, not a red-zone hold

The first wave in a while that changed no data path at all. `wave1-portion-truth` remains parked and
untouched at `88b5598`.

### What shipped — `wave-what-should-we-eat` → `main` (`ff35f1e`, `--no-ff`)

Home already knew everything needed to answer "what should we eat?" — it just never combined it.
`getReadyFoodSuggestions()` ranked cooked food (D-056), `getCookableRecipes()` knew what the pantry
could support, `getExpirySuggestions()` knew what was about to spoil, `recipeEffortScore()` /
`recipeActiveMinutes()` / `varietyPenalty()` knew effort and repetition (D-055), and
`normalizeMealBalance()` knew protein/veg/carb. The user still had two overlapping cards and forty
recipes, and still had to do the deciding.

One helper now composes all of it — `getWhatShouldWeEatSuggestions()` — into at most three picks:
**Eat this first** / **Easiest** / **Something different**, with reasons as chips and never a number.
No parallel recommendation system, no AI, no learned ranking, and **no freshness boundary recomputed
anywhere**. A test proves that structurally by stubbing `collectAttentionItems()`-adjacent inputs and
asserting the expiry signal comes from the shared `getExpirySuggestions()` scan.

### The finding that shaped the ranking

Two weights were wrong on the first cut, and **tests caught both — not eyeballing the card**. That is
the argument for keeping ranking in a pure function with no DOM access.

**Shopping was priced as a weight, and it recommended a shopping trip over dinner.** At 2 points per
missing ingredient, a no-cook, assembly-effort, minimal-cleanup recipe missing two items scored 5
against 12 for an ordinary pan recipe you could actually cook. The framing was wrong: needing to shop
is not a slightly-worse kind of effort, it happens *before* you can start and often means not eating
tonight. Availability became a **tier** — anything cookable now beats anything that isn't, and the
score only breaks ties inside a tier. It is also the more explainable shape, because "you have
everything for this one" is the first reason a person actually wants to hear.

**The expiry bonus at −3 lost to an easier rival's effort-plus-appliance edge**, contradicting the
briefed priority order that puts expiry second only to availability. Raised to −8 and locked by a
competing-reasons test.

### Ranking, stated plainly
Tier on availability, then an additive cost (lower better): expiry −8 · balance 0/2/4 · effort
0/2/4/6 · hands-on time 0–4 · minimal-cleanup −2 · appliance 0–4 (+1 for juggling two devices) ·
variety −1/0/+1/+2 as the tie-breaker. Effort reads **hands-on** minutes, not total: a 40-minute
pressure-cooker recipe you walk away from beats a 20-minute pan recipe you stand over, with a test
asserting that exact inversion.

### Honesty by omission
Each rule has its own test. No ready food → no "Eat this first". Nothing with `recipeEffortScore()
<= 2` → no "Easiest", because mislabelling a normal cook is a lie the user notices once. Empty
`cookHistory` → no "Something different", because with no history everything is equally new and the
reason would be fabricated. One or two picks is a valid answer; zero hides the card entirely.

A material Phase-1 finding shaped every default: **none of the 26 seeded recipes carry any D-055
metadata**. Undeclared appliance scores the neutral middle, undeclared balance is neither rewarded
nor condemned, and a test loads a pre-D-055 save to prove a legacy recipe ranks sensibly instead of
being buried — and gets no completion hint invented from balance data it doesn't have.

### Why this was NOT red zone
The wave writes nothing. The diff against `main` greps clean for `saveData(`, `saveToFirestore`,
`cloudReady`, `AppState.deletions`, `snapshotIdBaseline`, `tombstone`, `onAuthStateChanged`,
`serviceWorker`, `showNotification` and `FOOD_ALERTS_KEY`, and adds no `AppState.<key> =` assignment.
Zero new persisted state — no `AppState` key, no localStorage key, nothing in `mealPrepAppData`.
Under D-032 that is the reversible `done` gate: a broken ranking is a bad suggestion the user ignores
and a one-commit revert, not lost data. Landed on the operator's explicit approval.

A test hammers the read path — rank, build candidates, render the card, render the dashboard twice —
and asserts pantry, cooked meals, grocery list, deletions, cook history and the D-058
`mealPrepFoodAlerts` ledger are byte-identical afterwards. **Displaying a recommendation consumes
nothing.**

### Merge-time finding, checked rather than assumed
`origin/main` had advanced one commit since the branch was cut: `b488750 replies: cleared after send`
— the n8n reply-relay clearing `captures/replies/OUTBOX.md` after sending the notifications-wave
Telegram summary, exactly as `captures/replies/README.md` documents. Verified docs-only with **zero
file overlap** against the wave's diff before proceeding. Local `main` was fast-forwarded; the branch
was merged `--no-ff` **unrebased**, and `git diff wave-what-should-we-eat main` over the wave's files
is empty — the approved commits landed byte-for-byte as reviewed.

### Deployment verified, not assumed
Pages deployment succeeded for `ff35f1ed923af55b9915d81c40ad0597b57d9546` = final `main` at merge
time. All five served assets were fetched and compared against the committed blobs (LF-normalised,
since the local checkout is CRLF): `app.js`, `style.css`, `index.html`, `sw.js`, `manifest.json` all
**MATCH**, and the deployed `app.js` carries every new symbol.

### Test evidence
- `tests/what-should-we-eat.spec.js` — 26 passed
- `tests/production-smoke-what-should-we-eat.spec.js` — **10/10 against the live deployment**
- Full suite on final `main` — **219 passed, 4 skipped, 0 failed**

Two production-smoke failures on the first live run were **test artifacts, diagnosed rather than
waved away**: the "no persisted state" check was matching the spec's own `__wseProdBootstrapped`
sentinel, and `requestStorageAccess: Permission denied.` was proven environmental by probing a plain
live page load with zero wave interaction (it is the reCAPTCHA/App Check iframe asking for
third-party storage in headless). Both filters were narrowed precisely rather than broadened to hide
real errors.

### Pre-existing live-smoke flake — flagged again, still not absorbed
A single live-site production smoke fails per full-suite run, a **different test each time**, and
passes in isolation. This session: `production-smoke-ready-food.spec.js:212` on one run,
`production-smoke-kitchen-truth.spec.js:386` on another — the latter then passing **11/11** on its
own — and neither recurring on the final run. These specs hit the *deployed* site, so they can never
be evidence about a branch under review. Already logged in `docs/AI_OS_NOTES.md` with candidate
fixes. Deliberately left alone rather than folded into an unrelated wave.

### Known follow-up — recorded, deliberately NOT fixed
**Home now carries three suggestion surfaces**: the new decision card plus the two older cards it
summarises. That is real redundancy and the one place this wave arguably works against its own UX
goal. It was kept on purpose — the existing cards' tests assert their presence *and* relative order,
and the brief said not to redesign Home. **Dogfood the new card first.** If it proves sufficient, a
later UX wave should consolidate or remove the redundant surfaces; that is a UI decision with its own
test churn and belongs in its own wave.

### Inherited / deferred, carried forward unchanged
- Pantry ingredient matching remains substring-based (`"Rice"` matches `"Rice Vinegar"`) — pre-existing.
- No shopping/grocery-planning expansion.
- No portion-aware serving maths.
- `wave1-portion-truth` remains parked at `88b5598`.
- No persisted recommendation state; results are derived fresh every render.

### Where we are
The decision card is live. The next honest step is **using it for a week** — the redundancy question
and any weight tuning should both be answered by dogfooding, not by another round of reasoning. The
Android real-device check owed from TASK-046 (install the PWA, enable alerts, tap the notification,
check the launcher badge) is still outstanding.

---
## 2026-08-22 — Food attention notifications merged and deployed (TASK-046, D-058) — third owner-authorised D-032 red-zone merge

A small feature wave that started by proving what the platform **cannot** do, and then built only
what it can. `wave1-portion-truth` remains parked and untouched at `88b5598`.

### What shipped — `wave-food-attention-notifications` → `main` (`8fbf89d`, `--no-ff`)

The app already tells the truth about food: `collectAttentionItems()` (D-057) produces Expired /
Use soon over both pantry items and cooked meals, and Keep / Remove live on that Home card. The gap
was that you had to **open the app** to find out.

### Phase 1 came back negative, and that shaped everything

Before any code: **this app cannot deliver a notification while it is closed, and nothing short of
new backend infrastructure would change that.**

- Hosting is static GitHub Pages — no server-side compute. The only backend is
  `workers/recipe-import`, a stateless Worker with no scheduler and no state.
- `sw.js` was cache-only — no `push`, no `notificationclick`, no `periodicsync`.
- Firebase is Auth + Firestore. No FCM registration, no VAPID key, no messaging SDK. Web Push would
  need a VAPID keypair, a per-device subscription store, and a scheduled service reading every
  user's inventory — a much larger security and privacy surface than this app has.
- Periodic Background Sync: Chromium-only, installed-PWA-only, engagement-gated, and free to never
  fire. Absent on Safari/iOS and Firefox.
- The Notification Triggers API — the one thing that would have given local scheduling with no
  server — never shipped past origin trial.

The operator's decision gate ("if reliable background notifications need significant backend push
infrastructure, stop and report") was hit, reported, and honoured. **No push stack was built.**

### What was built instead

`maybeNotifyAttention()` runs at app open (all three load paths) and on `visibilitychange` →
visible. It **consumes** `collectAttentionItems()` and defines no expiry boundary of its own —
proven structurally by a test that stubs `collectAttentionItems()` and asserts the notification
follows the stub, so a second freshness model can never be introduced silently.

One grouped notification per pass, `tag: 'meal-prep-attention'` so a later alert replaces rather
than stacks. Three copy shapes; every expired body says **"Open Meal Prep to review"**, never eat /
use / cook. Dedup ledger `"<kind>:<id>" → state`, rewritten from the current world each pass:
unchanged food is silent forever, use-soon → expired announces once more, removed food drops out so
a re-add can announce again. Keep suppression (D-057) is **inherited, not re-implemented** — there
is no `keptOn` reference anywhere in the new code.

Permission is requested from exactly one function, reachable only from Settings → Notifications.
Nothing on page load asks. Denial, and a browser with no `Notification` object at all, both leave
the app fully working.

`updateAppAttentionBadge()` sets the PWA app-icon badge from the existing expired+expiring count —
the only "while you're away" signal this architecture can honestly provide. The in-app Inventory
tab badge is unchanged.

### No new synced state

The ledger lives in the device-local `localStorage` key `mealPrepFoodAlerts`, alongside
`mealPrepHelpSeen` / `pantryOnboardingDone` / `mealPrepWeekTemplate`. A test asserts that neither
`AppState` nor the persisted `mealPrepAppData` payload grows an alert field. **Sync, tombstones,
`saveData()`, the `cloudReady` write-guard and auth are untouched.**

### Why this was red zone, and how it was released

Not because of data: the wave writes nothing to `AppState` or Firestore. Because of **`sw.js`** —
the offline-cache surface every user loads through, where a broken worker can wedge a cached app on
a device that then never fetches the fix. Under D-032 that is `approved`, not `done`. Claude
recommended held, returned the branch unmerged and unpushed, and did not merge on its own judgement.
The operator then gave explicit written authorisation naming the SHA (`31bf98d`). **This was not an
automatic merge.** Recorded in REVIEW.md TASK-046 and in the merge commit.

The `sw.js` change is additive: one `notificationclick` listener plus `CACHE` v4 → v5. The
`install` / `activate` / `fetch` handlers are unchanged, so the network-first app-shell strategy
that makes deploys go live immediately is intact.

### Deployment verified, not assumed

Pages deployment `github-pages` succeeded for SHA `8fbf89d5edf685f45f590b6bc674ca8642c7efa3` —
matching final `main`. The deployed bytes were then fetched and checked directly: `sw.js` contains
the `notificationclick` handler and **no** `push` / `periodicsync` / `pushManager`; `app.js` carries
all six new functions; `index.html` carries the Settings row and **no** `firebase-messaging` /
`getMessaging` / `vapid`.

### Real-device verification could NOT be performed — owner/manual item

`adb` is installed (platform-tools 37.0.0) but reports **zero devices attached and zero configured
AVDs**, and the session is non-interactive. Recorded rather than skipped or claimed.

The substitute that WAS run: production smoke against the deployed HTTPS site in Chromium with a
live registered service worker and a **browser-granted** notification permission — the same Blink
service-worker path Android Chrome uses. It proves the SW `showNotification()` path is the one
taken (constructor path asserted unused), one grouped notification for five items, no repeat on
unchanged food across passes and a reload, and no push subscription ever created.

Still outstanding for a phone: PWA install from the Chrome menu, the real OS permission prompt, an
actual thumb-tap on the tray notification, `setAppBadge` on the launcher icon, and a real
close/reopen cycle. Listed in REVIEW.md TASK-046.

One thing worth knowing for future waves: **headless Chromium hard-denies the Notifications
permission** regardless of `grantPermissions()`. The smoke therefore skips its four
permission-dependent cases with an explicit reason under headless, and `npm run
test:smoke:notifications` runs them headed for real coverage. Silent vacuous passes were the
alternative and were rejected.

### Test evidence
- `tests/food-attention-notifications.spec.js` — 27 passed
- `tests/production-smoke-attention-notifications.spec.js` — **9 passed headed**; 5 passed / 4
  skipped headless
- Full suite on final `main` — see the run recorded in REVIEW.md TASK-046
- Baseline on `main@4de1512` before the wave was 151 passed

### Pre-existing CI condition, NOT introduced here
The "Button tests" workflow reports 1 failure per run, and has done so since **before** this wave:
the TASK-045 docs commit (`32582675564`) failed on `ready-food-portions.spec.js:307`, and this
wave's merge (`32586471466`) failed on `production-smoke-ready-food.spec.js:212`. Different test
each time, neither touched by this wave, both passing locally. That is a flaky-CI signal (30s
timeout, 2 workers, tests hitting the live site), not a regression. Left alone deliberately rather
than absorbed into this wave; worth a dedicated look.

### Where we are
Notifications are done to the honest limit of this architecture. Real push remains **not
recommended** unless dogfooding shows multi-day gaps between app opens — that is the only condition
under which the foreground alert actually fails the user. If it is ever wanted, it is its own wave
with its own security review, not an extension of this one.

Next: the real-device pass on a phone, then whatever the operator points at. `wave1-portion-truth`
still parked.

---
## 2026-08-22 — Cook-path depletion tombstones merged and deployed (TASK-045, D-057 addendum) — second owner-authorised D-032 red-zone merge

A small red-zone safety patch, not a feature wave. `wave1-portion-truth` remains parked and
untouched at `88b5598`.

### What shipped — `fix/cook-depletion-tombstones` → `main` (`0ccd121`, `--no-ff`)

This closes the follow-up the kitchen-truth wave recorded rather than silently absorbing:
**cooking could delete pantry items in a way that never synced.**

`deductIngredientsForRecipe()` drops a pantry record once cooking empties it, and wrote no
tombstone — the delete rode entirely on the generic vanish-diff in `recordLocalDeletions()`,
which returns early and records **nothing** when more than `MASS_DELETE_GUARD` (5) ids disappear at
once. So a cook that emptied six or more tracked items removed them locally with nothing to sync,
and the next merge from another device brought the food back. Same class of bug D-057 fixed for
bulk expired cleanup; the cook path was the one remaining consumer that had never been given the
pattern.

The fix is 15 lines inside the existing `if (depleted.length)` block of that one function:
tombstone every depleted id → remove the records → `snapshotIdBaseline()`, all before the caller's
existing `saveData()`. Byte-for-byte the sequence `removeAllExpired()` and
`unstockPurchasedGroceryItem()` already use. **No second deletion mechanism, and no change to
tombstone architecture, `MASS_DELETE_GUARD`, `cloudReady`, `saveData()` semantics or the Firestore
merge/conflict code** — verified by grepping the diff for every one of those symbols. Partially
depleted items are untouched: only a record the cook actually empties is tombstoned.

One incidental change worth naming: the pantry filter now keys on `String(p.id)` against a lookup
object instead of `depleted.indexOf(p.id)` identity, so the set of records removed and the set of
ids tombstoned cannot diverge on a numeric-vs-string id.

### Blast radius was checked, not assumed
`deductIngredientsForRecipe()` has a single call site (`_doMarkCooked()`), and
`checkAndReplenishLowStock()` — the only thing running between the deduction and `saveData()` —
mutates `groceryList` only. No other cook-path helper removes pantry records.

### The tests are provably not vacuous
`tests/cook-depletion-tombstones.spec.js` (9 tests) covers 1-, 6- and 8-item depletion, partial
depletion, the ×2 multiplier path, unknown-quantity items, the insufficient-inventory dialog, batch
creation, local reload and the Firestore payload. Two things make it worth trusting:

- **A control arm.** The 6-item test first removes the same six ids naively and calls
  `recordLocalDeletions()` → zero tombstones. That proves both that the guard really does swallow a
  delete this size, and that the fix does not depend on the vanish-diff.
- **A mutation check.** Reverting `app.js` to `main`'s version fails **all nine**, the end-to-end
  resurrection case with `Expected: 0, Received: 6` — the production bug reproduced exactly. Fix
  restored and re-verified.

### Why this was red zone, and how it was released
Under D-032 anything writing into `AppState.deletions` is **`approved`, not `done`**, regardless of
diff size — a broken UI change is reverted in a minute; lost user data cannot be reverted at all
(north-star goal #2). Claude recommended `approved`, returned the branch **unmerged and unpushed**,
and did not merge on its own judgement. The operator then gave explicit written authorisation naming
the SHA (`163586a`). **This was not an automatic merge.** Recorded in REVIEW.md TASK-045 and in the
merge commit itself.

Audit trail deliberately split across three commits, matching the TASK-044 precedent:
- `7759670` — approval recorded on `main` **before** the merge (REVIEW.md, TASKS.md, D-057
  addendum), per the D-040 addendum in CLAUDE.md: the pipeline reads `TASKS.md` from `main`, not
  from the branch.
- `0ccd121` — the `--no-ff` merge itself. No history rewritten; `163586a` survives intact.
- this commit — written **after** the deploy, so it records what actually happened rather than what
  was intended.

### Deployment evidence
- Pages build `0ccd121` reached **built** in 44.3s (`created_at` 15:39:18Z → `updated_at`
  15:40:02Z).
- Deployed `app.js` re-fetched with cache-busting: SHA1 `9d0c05a1fa86d1663ff80828305aa007839455e6`,
  555,329 bytes — **byte-for-byte identical** to `git show main:app.js`. The fix is present in the
  shipped bundle at lines 9206 / 9222.

### Test results on final `main`
- **`npm test` — 151 passed, 0 failed** (147 before this patch + 4 new production smokes).
- **Production smokes against the deployed build — 15/15** run together: the new
  `production-smoke-cook-tombstones.spec.js` 4/4, and D-057's `production-smoke-kitchen-truth.spec.js`
  still 11/11. The new smoke asserts the **shipped** code: that six simultaneous depletions cross
  `MASS_DELETE_GUARD` and tombstone every id, that partial stock keeps its correct quantity, that
  the batch is still created, and that a stale remote copy merged back over the top is killed again
  by `applyTombstones()`.

### Docs corrected where they disagreed with code
`planning/ROADMAP.md` Known Issues listed the cook-path deletes as open, and D-057 recorded it as a
deliberate follow-up. Both are now false: the ROADMAP entry is removed and D-057 carries a narrowly
scoped addendum closing it.

### Blockers
None.

### Next
- `wave1-portion-truth` (`88b5598`) still parked, still claiming D-054. Untouched by this patch, as
  instructed.
- The second D-057 follow-up is still open: the grocery row is a ~33px tap target on phones
  (pre-existing `.grocery-item` padding under the narrow breakpoint). D-057 promoted that row to the
  primary inventory-write interaction, so it carries more weight than it used to. Still in ROADMAP
  Known Issues.
- Two waves in a row have now shipped a fix for something a previous wave's own audit found and
  deferred. That is the system working, but it is worth watching whether follow-ups are being
  deferred faster than they are being closed.

---
## 2026-08-22 — Kitchen-truth wave merged and deployed (D-057) — first owner-authorised D-032 red-zone merge

Third feature wave in three days. `wave1-portion-truth` remains parked and untouched at `88b5598`.

### What shipped — `wave-kitchen-truth` → `main` (`cb7fcd7`, `--no-ff`)

Goal: make it almost effortless for the app to know what food we actually have, what is running
out, and what should be removed — without a warehouse system, without weighing food, and without
adding a daily chore.

**Phase 1 found the headline defect: the highest-priority loop did not exist at all.**
`toggleGroceryItem()` flipped `item.checked`, re-rendered, and stopped. It never wrote to
`AppState.pantry`, and it never called `saveData()` — so the tick did not even survive a reload.
`docs/FEATURES.md` had listed "Grocery → Pantry auto-transfer on check (with undo)" as **Working**
the whole time. That is the second time in three waves that a doc claim outran the code; worth
watching.

- **Bought ✓ is the whole interaction.** Checking a grocery row calls `stockPurchasedGroceryItem()`,
  which infers category, storage, shelf life and purchase date exactly the way manual pantry adds
  do. No modal, no quantity prompt, no date entry — asserted (zero overlays opened). Unchecking
  calls `unstockPurchasedGroceryItem()` and reverses precisely that change via a `stocked` receipt,
  so a mis-tap costs one tap instead of leaving a phantom record.
- **Safe merge, not lot tracking.** `findPantryByExactName()` is exact and case-insensitive —
  deliberately NOT the fuzzy `findPantryMatch()`, so "Chicken" can never fold into a "Chicken
  Breast" record. `canMergePurchase()` refuses printed-expiry records and already-expired ones.
  **A merge does not rewrite `purchaseDate`** — the oldest portion keeps governing freshness.
  Stamping today is the obvious implementation and is quietly destructive: six-day-old chicken
  becomes fresh chicken the moment you buy more. Under-claiming freshness is visible and
  self-correcting; over-claiming is invisible. Quantity sums only when both sides are known,
  otherwise it stays `null` — the app does not invent numbers it cannot know.
- **Fast states reuse `stockLevel`.** Buying a low staple sets `'full'` and lets the existing
  `syncStapleToGrocery()` drop its auto shopping row. No parallel status system was added.
- **One attention experience over two data models.** `collectAttentionItems()` scans pantry items
  and cooked meals in one pass and returns Expired / Use soon / Low. The two record types keep
  their own shapes and their own shelf-life rules — unified *experience*, not unified schema.
- **`Keep` invents no date.** It writes `keptOn = todayISO()` and suppresses the record from the
  attention surfaces for that day only; `isKeptToday()` is a strict equality against `todayISO()`,
  so it lapses at midnight on its own. It is an acknowledgement, not a dismissal. The Inventory tab
  still shows "Expired 4d ago" throughout — truth stays where the food is listed.
- **Cleanup**: one tap per expired item, plus a bulk `Remove expired (N)`.

### Two further defects fixed on the way through
- `getExpiredPantryItems()` classified by `item.expiryDate` alone while every badge computes
  freshness through `pantryDaysLeft()`. Bought-date items — the common case — never matched, so the
  Inventory "Clear expired" button stayed permanently hidden while the banner directly above it read
  "2 expired". A bulk cleanup that existed and could not fire.
- The bulk **Remove expired** control inherited `.dash-l1-cta`, a `padding: 0` text link, and
  shipped at **12px tall** on a phone — a hairline tap target for the most destructive action in the
  wave. Caught by the mobile smoke during pre-merge verification, fixed, and regression-locked.
- Also removed two dead DOM reads in `addToPantry()` (`#pantry-add-where`, `#pantry-qty-input`),
  gone from `index.html` long ago. That resolves a ROADMAP dead-code entry.

### Why this was red zone, and how it was released
Under D-032 this wave is **`approved`, not `done`**: it adds a bulk-delete path and writes
tombstones. A broken UI change is reverted in a minute; lost user data cannot be reverted at all.
Claude recommended holding it and did **not** merge on its own judgement. The operator gave explicit
written authorisation, and the merge happened on that instruction — the first time this project has
run that gate deliberately rather than by default. The approval record was committed to `main`
(`54ae79a`) **before** the merge, per the D-040 addendum, so the audit trail reads in the right order.

**The tombstone mechanism was used, not changed.** Grepping the diff for `cloudReady`,
`saveToFirestore`, `saveData`, `mergeCloudConflict`, `unionByIdLWW`, `applyTombstones`,
`recordLocalDeletions` and `MASS_DELETE_GUARD` returns **zero hits**. The new cleanup writes
`AppState.deletions[id]` then calls `snapshotIdBaseline()` — exactly what `deleteSelectedPantryItems()`
(`app.js:8326`) and `clearExpiredPantryItems()` (`app.js:8352`) already did. This matters because
`recordLocalDeletions()` deliberately ignores more than `MASS_DELETE_GUARD` (5) simultaneous
disappearances as a suspected load race: a large cleanup relying on the vanish-diff would record
zero tombstones and another device would resurrect the food. Both the local and production tests
seed **six** expired items specifically to cross that threshold.

No new top-level `AppState` key. Three additive fields on existing objects: `pantry[].keptOn`,
`cookedMeals[].keptOn`, `groceryList[].userSet`, `groceryList[].stocked`.

### Verification
- **127/127 local** (100 pre-existing unchanged + 27 new in `tests/kitchen-truth.spec.js`), green on
  the merged `main` **before** pushing.
- **11/11 production smoke** (`tests/production-smoke-kitchen-truth.spec.js`) against the deployed
  build, including the merge-date rule, the MASS_DELETE_GUARD-crossing bulk cleanup, and the Keep
  day-N → day-N+1 lapse driven by a real `page.clock` advance.
- **Pages evidence**: build `cb7fcd7` status `built`, duration 38.5s; live `app.js` SHA1
  `9975f06a…` matches `git show main:app.js` byte-for-byte.
- **Mutation check**: replacing `isKeptToday()` with permanent suppression fails the two Keep
  lifecycle tests, proving that coverage is not vacuous.

### Follow-ups carried, not absorbed
Both logged in `planning/ROADMAP.md` Known Issues rather than silently expanded into:
1. **`deductIngredientsForRecipe()` removes depleted pantry items without explicit tombstones**,
   relying on the vanish-diff. Cooking something that depletes more than five tracked items records
   no tombstones and lets another device resurrect them. Same fix pattern as the cleanup path, but
   it sits on the *cook* path — deliberately out of this wave.
2. **The grocery row is a ~33px tap target on phones** (pre-existing `.grocery-item` padding under
   the narrow breakpoint). D-057 promoted that row to the primary inventory-write interaction, so it
   now carries more weight than it did.

next:
  - Neither follow-up is urgent, but #1 is the same class of silent-data-loss bug this wave existed
    to prevent, and it is the obvious next small task. It touches deletion, so it is red zone too.
  - No further inventory work is briefed. `wave1-portion-truth` (`88b5598`) still parked, still
    claiming D-054.

---

## 2026-08-22 — Ready-food-first wave merged and deployed (D-056); next direction re-pointed at inventory truth

Second feature wave in two days. `wave1-portion-truth` remains parked and untouched.

### What shipped — `wave-ready-food-first` → `main` (`352a799`)

Goal: make the app prefer food that is **already cooked and ready** before telling us to cook
something new — without becoming an inventory-management system.

- **Two optional additive fields on the existing `cookedMeals[]`**: `initialPortions` and
  `portionsRemaining`. Both null = an untracked batch, which behaves exactly as before.
  **No new top-level `AppState` key**, so no sync registry was edited — `cookedMeals` already
  round-trips through localStorage, Firestore, backup, export/import and the union merge.
- **`normalizeCookedMeal/s()`** — the first normalizer this collection has ever had. Wired at all
  **six** points `cookedMeals` is assigned from stored data (localStorage load, backup restore,
  Firestore load, the live cloud listener, the import union, the sign-in merge). Idempotent; only
  repairs an incoherent pair, never invents portions.
- **Portion capture**: the existing "How many portions cooked?" dialog gained a count pre-filled
  from `recipe.currentServings` that follows the batch multiplier until the user types their own.
  Manual takeout/leftovers gained an optional Portions field. Blank = untracked = pre-wave.
- **One tap**: `Used 1` decrements and re-renders. No modal, no fields, no per-person logging.
  The last portion routes into the existing `removeCookedMeal()`, so there is one deletion path
  and one tombstone behaviour — not a second archive concept. Portions cannot go negative.
- **Home "Ready to eat"**: top 3 from `getReadyFoodSuggestions()`, ranked expiring-fridge →
  fridge → freezer, then soonest-to-spoil, then smallest remainder. Rendered **above** the D-055
  cook suggestions. Expired batches are excluded — the freshness banner already flags those for
  disposal, and suggesting someone eat them would be harmful.
- The **Landers lechon manok** workflow works entirely through the general manual-cooked-food +
  portions flow. No Landers-specific code; a test asserts the stored object's exact key set.

### Automation blocker resolved
`recipe-request.json` — an untracked 53-byte curl payload in the repo root, created 2026-08-09
during the recipe-import build — had been failing the overnight automation's "working tree clean"
preflight. Commits `5f79c9f` (abort notice) and `3fdbd03` (notice cleared) are that loop.
Investigated: zero references anywhere in the repo, never tracked on any branch. **Ignored rather
than deleted** (`/recipe-request.json`, root-anchored) because the 2026-08-21 recovery sweep
audited every untracked file and deliberately left this one; ignoring unblocks the automation just
as well and is reversible. Working tree is now clean.

### Verification
- Playwright: **100/100 pass** (18 spec files), run on merged `main`.
- 18 new wave tests + 8 new production-facing checks.
- **Deployment verified, not assumed:** Pages build `352a799` = `built` (35.8s,
  2026-08-22T06:51:22Z); live `app.js` re-fetched and confirmed to contain `normalizeCookedMeal`,
  `useCookedPortion`, `getReadyFoodSuggestions`, `renderReadyFoodCard`, `readyFoodBucket`,
  `portionsRemaining`; live `index.html` contains `manual-cooked-portions`.
- **Production smoke against the deployed site** (`tests/production-smoke-ready-food.spec.js`,
  8/8): code present, pre-wave records still render, Home ranking + placement, expired excluded,
  one-tap decrement with zero overlays, Landers end to end, storage round-trip, no `NaN` anywhere.

### Merge hygiene
`--no-ff` merge commit `352a799`; no force-push, no history rewrite. Local `main` and
`origin/main` both at `352a799`. Local `main` was fast-forwarded to pick up the automation's two
OUTBOX commits before merging.

### Two test-hygiene fixes worth noting
Both of my own earlier tests froze a cooking-hack count at 13; adding a 14th hack broke them. Both
now read `defaultCookingHacks.length` instead of a literal, so a later wave adding a hack cannot
break them again. The ready-food production smoke also needed the bootstrap-once localStorage
guard so its reload test doesn't wipe the data it is checking.

### Next — direction changed by the operator
We are **not** proceeding to the full "What should we eat?" engine. The operator identified a more
fundamental friction: **keeping grocery/fridge inventory truthful with almost no maintenance.**
Everything built so far (low-effort discovery D-055, ready-food-first D-056) leans on inventory
being roughly accurate — `getCookableRecipes()`, the expiry scan, and the ready-food ranking all
degrade quietly when the pantry drifts from reality. That makes inventory truth the load-bearing
problem, and the recommendation engine premature until it is solved.

No design work has been done on this yet. It needs its own brief.

### Carried forward
- `wave1-portion-truth` (`88b5598`) still parked, still claiming D-054, still needing a
  merge/rework/abandon decision. Abandoning it leaves D-054 a permanent gap.
- `_doMarkCooked()` still does not call `stampUpdated()` on the batch it creates — pre-existing
  gap leaving recipe-cooked batches without `updatedAt` for tombstone LWW. Deliberately untouched
  (sync-adjacent); needs its own task.
- `recipeEffortScore()` still infers effort from active time when `effort` is unset.
- TASK-037 remains unmerged on `task-037` (`7c4785d`); its original blocker is stale.

---
## 2026-08-21 — Low-effort cooking wave built, reviewed, merged, deployed and verified live (D-055)

First feature session since the 2026-08-21 repository recovery. Two waves were worked; **one
shipped, one is parked unmerged.**

### What shipped — `wave-low-effort-cooking` → `main` (`944c8b0`)

Goal: reduce the friction around *what to cook, what to buy, how to cook with least effort*,
without turning the app into a macro-tracking or daily-logging tool.

- **Optional recipe metadata** (additive, no new top-level `AppState` key): `equipment[]`,
  `effort`, `activeTime`, `mealBalance{}`, `tags[]`. Filled by `normalizeRecipes()` →
  `normalizeRecipeMeta()`; valid values preserved, unknown slugs dropped, idempotent.
- **Quick-filter chips** on the recipe list (lowest effort / rice cooker / rice + steamer /
  Instant Pot / oven / pan / no-cook / batch-friendly), ANDed on top of the existing
  search / category / time / favourites filters. Chips matching nothing are hidden.
- **Home "What should I cook?"** — up to 3 deterministic suggestions (⚡ Easiest, 🥬 Use soon,
  🍽️ Something different) from effort, the existing pantry-expiry scan, and `cookHistory`.
  A category with no supporting data is omitted, never guessed. No model calls, no server.
- **7 new cooking hacks** + `seedNewDefaultHacks()` backfill for devices seeded before they existed.
- **`NaN min` bug fixed at all 10 call sites.** `baseCookTime || cookTime` turned a legitimate `0`
  into `undefined`; a no-cook recipe rendered "NaN min" on its card, in the planner slot and in the
  week stats. Times now read through `recipePrepMinutes()` / `recipeCookMinutes()`.
- **`saveRecipe()` edit-path data loss fixed.** An edit rebuilt the whole recipe object and copied
  across only `sourceUrl`/`sourceSite`/`importedAt`, so an unrelated rename silently destroyed
  `favorite`, `highlights`, `updatedAt` (which tombstone LWW depends on), the input-less
  `fiber`/`sodium` nutrition values, and every field this wave added. An edit now starts from the
  existing recipe and overlays only form-owned fields, so preservation is the default.

The weekly-plan slot shape is **unchanged** — slots still hold bare recipe ids.

### What is parked — `wave1-portion-truth` (`88b5598`), NOT merged

Per-person planned servings (household model, portion steppers, per-person nutrition, grocery =
sum of planned servings). Built and green, but deliberately held: it is red-zone (Firestore
payload, localStorage, import/sign-in merges) and it visibly changes grocery quantities for
existing plans. It claims decision number **D-054**; the shipped wave was renumbered to **D-055**
so the two stay collision-free. If portion-truth is ever abandoned, D-054 becomes a gap in the log.

### Verification
- Playwright: **74/74 pass** (15 spec files), run on merged `main`, not just on the branch.
  68 local + 6 new production-facing checks.
- New tests: 23 across `low-effort-metadata`, `low-effort-zero-time`, `low-effort-discovery`,
  `recipe-edit-preservation`, `production-smoke-low-effort`.
- The edit-preservation tests were proven to **fail (4 of 5) against the pre-fix `saveRecipe()`**
  and pass after it — they are not vacuous.
- **Deployment verified, not assumed:** Pages build `944c8b0` = `built` (37.7s, 2026-08-22T03:41Z);
  live `app.js` re-fetched and confirmed to contain `RECIPE_EQUIPMENT`,
  `renderRecipeQuickFilters`, `getCookSuggestions`, `recipeCookMinutes`, `seedNewDefaultHacks`
  and the new `saveRecipe()` merge.
- **Production smoke run against the deployed site** (`tests/production-smoke-low-effort.spec.js`,
  6/6): vocabularies live, filters narrow correctly, Home suggestions render in fixed order,
  all 13 cooking hacks present, edit preservation holds, and no `NaN` on any tab — checked both
  with the real seeded sample recipes and with a planted zero-cook-time recipe.

### Merge hygiene
`--no-ff` merge commit `944c8b0`; no force-push, no history rewrite. Local `main` and
`origin/main` both at `944c8b0`, confirmed by `git ls-remote`.

### Known caveats carried forward
- `recipeEffortScore()` infers effort from active time when `effort` is unset, so a long recipe
  with a short hands-on phase reads as harder than it is until someone fills the field in.
- `seedNewDefaultHacks()` writes to `customHacks` (a synced, tombstoned list). It is
  additive-by-id and tombstone-safe, but a hack deleted more than 180 days ago could reappear once
  its tombstone is purged.
- The two live-site suites (`button-smoke`, `buttons-functional`) test the deployed build, so they
  only became meaningful for this wave *after* the merge — before it they were validating the old
  `main`. The new production smoke closes that gap explicitly.

### Next
- Decide the fate of `wave1-portion-truth`: merge (accepting the grocery-quantity change and the
  red-zone surface), rework, or abandon.
- TASK-037 remains unmerged on `task-037` (`7c4785d`); its original blocker is stale.

---
## 2026-08-21 — Repository recovery: parked rebase cleared, out-of-band recipe-import work reconciled, verified, merged, deployed

**This was a recovery session, not a feature session.** No new meal-prep features were built.

### What was wrong
1. **A parked rebase had frozen the repo for a month.** The main working directory sat mid
   `git rebase` of `task-037` onto `main`, started 2026-07-23, stopped on a `REVIEW.md` conflict
   and never finished. HEAD was detached the whole time.
2. **That silently killed the overnight automation.** With no branch name resolvable, the nightly
   run aborted its "Correct branch" preflight *every night from 2026-07-23 to 2026-08-21* —
   ~50 consecutive aborted runs, all logged to `captures/replies/OUTBOX.md` and never read.
3. **A whole feature had bypassed the pipeline.** Recipe URL import (app UI + a Cloudflare Worker)
   was built by hand on 2026-08-09 in a second worktree and pushed straight to `main` (`9007d4e`).
   No capture, no BQ item, no task, no review — and live on GitHub Pages since 2026-08-09.
4. **Real work was sitting uncommitted.** The release worktree held unrecorded production-polish
   changes plus an entire uncommitted test file.

### What was done
- **Rebase:** inspected first, aborted second. Nothing lost — both `task-037` commits remain at
  `7c4785d` on the branch and on `origin/task-037`.
- **Reconciliation:** every untracked file in the main tree was proven byte-identical to
  `release/recipe-url-import-clean` before removal. The ~8 "extra" lines in `app.js` turned out to
  be TASK-037's own Cooked-button change, which the `-clean` branch deliberately excludes — so it
  was left on `task-037` rather than mixed into the release.
- **Committed the genuinely-new work:** `c01206a` (null-safe nutrition + ordered instruction
  steps) and `f0c0ffa` (red-zone test coverage, plus two suites updated to match shipped UI).
- **Red-zone review** performed against D-032 and all applicable Hard Rules → `REVIEW.md`.
- **Merged** to `main` as a fast-forward (`9007d4e` → `f0c0ffa`). No force-push, no rewrite.
- **Deployment verified, not assumed:** Pages build `f0c0ffa` = `built`; live `app.js` and
  `style.css` re-fetched and confirmed to contain the new code.

### Verification
- Playwright: **45/45 pass** (11 spec files; button smoke 471 in DOM, 199 clicked, 0 broken)
- Worker: **9/9 pass** (`node --test`)
- Both re-run on merged `main`, not just on the release branch. No test was weakened to get green.

### Correction to the record
An earlier read in this session reported that recipe import "was never merged and is not live."
That was wrong — it came from a stale remote-tracking ref. `origin/main` had carried the feature
since 2026-08-09; a `git fetch` revealed it. The local release commit `a6b42c1` and the pushed
`9007d4e` are content-identical duplicates (same tree `eff4c15`), so `main` was rebuilt on the
real `origin/main` and only the two genuinely-new commits were cherry-picked on top — avoiding a
duplicate feature commit in `main`'s history.

**Next:** TASK-037 is still unmerged on `task-037` (`7c4785d`, status `blocked`). Its blocker — the
TASK-036 test regression — was fixed by TASK-040 and is now on `main`, so the blocker is stale. It
needs a fresh rebase onto `main` and a re-run before it can land. The overnight automation should
resume now that the repo is on a real branch; worth confirming after the next scheduled run.

**Open risks:** the recipe-import Worker is an unmonitored production dependency; partial-nutrition
recipes now under-count silently in weekly totals rather than showing `NaN`; no end-to-end manual
import against a real URL has been run on-device.

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
