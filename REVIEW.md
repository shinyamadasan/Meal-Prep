# Review

> **Claude writes; Codex reads.** One entry per review cycle.
> After writing: set the task status in TASKS.md to `approved` or back to `codex`.

---
## Review TASK-058 — Pasted-recipe metadata/range import repair — PASS -> D-032 `done`
branch: `fix/paste-import-metadata-and-ranges` @ `100d4b4` (base `main @ b34f8f9`)
verdict: **PASS** — no P0, no P1, no P2. One non-blocking P3 parsing-format ambiguity remains OPEN.
date: 2026-08-30

### Process note — this branch bypassed the normal task/review paper trail

This work began from a direct owner instruction after observing a real pasted-recipe import failure,
not from `planning/BUILD_QUEUE.md`. Implementation was done directly by Claude (not Codex) and the
branch was independently reviewed and reported PASS **before** any `TASKS.md`/`REVIEW.md` record
existed for it. `TASKS.md` TASK-058 and this entry are a truthful backfill, written after the fact,
matching the precedent set by TASK-041. Nothing here claims an earlier status or timestamp that never
existed.

### Verdict

Independent review of the paste-recipe importer repair. One commit reviewed: **`100d4b4`**, landing
**unrebased, unsquashed and unamended**.

`parseRecipeText()` (the deterministic paste importer) had no concept of the
`Equipment:`/`Effort:`/`Active Time:`/`Tags:`/`Meal Balance:` sections the recipe model already
supports, so those headings and their values fell into the Instructions list as bogus numbered
steps — reproduced live with a "Lemon Chicken" paste whose Instructions ended with `Equipment:`,
`Oven, Pan`, `Effort:`, `Very low`, `Tags:`, `Freezer-friendly, Batch-friendly, Minimal-cleanup` as
trailing "steps". Fixed: the five headings are now recognized case-insensitively (colon required, so
prose like "Effort is minimal" is never misclassified), terminate whatever section came before them,
and map onto the existing canonical vocab (`RECIPE_EQUIPMENT`/`RECIPE_EFFORTS`/`RECIPE_TAGS`) via the
existing `normalizeSlugList`/`normalizeEffort`/`normalizeActiveTime` normalizers. Unrecognized tokens
are dropped, never turned into a new enum value.

`parseIngredientLine()`'s final fallback fabricated `quantity: 1, unit: 'pieces'` for any ingredient
line without a clean leading number — including digit-leading ranges like `1-1.5 lb chicken` that
start with a digit but aren't a single parsed amount — reproduced the same way (`1-1.5 lb chicken`,
`Juice of 1-2 lemons`, `2-3 cloves garlic`, and bare `Salt`/`Black pepper` all became a confident
"1 piece"). Fixed: the fallback now returns `quantity: null, unit: ''` with the full raw line
preserved as `name`. This is the same function `normalizeImportedIngredient()` (the URL-import path)
calls, so the fix also hardens that path's existing `needsReview` safety net, which previously only
checked for *a* leading digit rather than a *valid single* amount — **URL-importer behavior is
improved, not regressed.**

### Verification

| Check | Result |
|---|---|
| targeted `tests/paste-import-metadata-and-ranges.spec.js` | **12/12** |
| full deterministic suite (`npx playwright test --project=local`) | **556/556** |
| `tools/Verify-Decisions.ps1` | **55/55** |
| `git diff --check` | clean |
| mutation A — metadata-heading recognition disabled | **7 tests correctly failed** (instructions polluted again, equipment/tags/effort empty), reverted |
| mutation B — fabricated 1-piece fallback restored | **4 tests correctly failed** (`1`/`'pieces'` instead of `null`/`''`), reverted |

### Blast radius

Diff is exactly two files: `app.js` (70 lines, inside `parseIngredientLine`, `parseRecipeText`, and
one added call in `proceedToRecipeForm`) and the new spec file. No new recipe/schema field, no
`AppState` top-level shape change, no sync/Firestore/tombstone/nutrition-architecture change, no auth,
no service worker. `wave1-portion-truth` untouched.

### P3 — one non-blocking parsing-format ambiguity (OPEN, deferred)

The independent review flagged one non-blocking P3: a parsing-format ambiguity in how metadata
sections are delimited (not itemized further by the reviewer beyond "non-blocking"). Recorded here as
open and deferred — not fixed in this landing.

### D-032 gate — `done`

Strictly on blast radius this is outside the red zone: no Firestore/sync/storage code, no
`saveData()` call-site change, no `cloudReady` guard, no tombstone machinery, no auth, no automation
surface — purely deterministic parsing into already-existing recipe fields, plus one UI wiring call
into an existing render function. Qualifies for `done` (auto-merge tier); landed by explicit owner
instruction in this same session.

### Gate

**Status: `done`.** Merge `--no-ff` into `main`, preserving `100d4b4` unchanged. No squash, no amend,
no rebase, no force push. `wave1-portion-truth` stays untouched.

---
## Review — Protein Identity **P2 Finalization** — PASS -> D-032 `approved` (HELD) -> AUTHORIZED FOR LANDING
branch: `fix/protein-identity-p2-finalization` @ `da75a7d` (base `main @ 8e2a541`)
verdict: **PASS** — no P0, no P1, **no P2 open**. Three P3 notes remain **OPEN and deferred**.
date: 2026-08-27

### Verdict

Independent review of the finalization patch closing the two P2 follow-ups left open by the
hardening landing at `9021a90`. One commit reviewed: **`da75a7d`**, landing **unrebased,
unsquashed and unamended**.

Nothing about the identity contract changed. The precedence — explicit `cookedMeal.proteinType`
-> deterministic recipe-derived identity -> `unknown` — is untouched, and so is the rule the
feature exists to protect: **a cooked meal's `name` is never read to infer its protein.**

### P2-1 — CLOSED. `cookedProteinAutoLabel()` can no longer crash `renderCookedMeals()`

The unguarded tail `FLAVOR_PROTEIN_BY_ID[derived].label` is gone. The characterization that
preceded the fix found the blast radius to be **worse than the original finding stated**, and the
review confirms it:

- `recipeProteinType()` returns raw values out of `PROTEIN_FAMILY_BY_INGREDIENT`. Those values are
  never filtered against `COOKED_PROTEIN_IDS` or `FLAVOR_PROTEINS`, so a future table entry naming
  a family with no `FLAVOR_PROTEINS` id reaches the lookup directly.
- The call site is inside `buildCookedCard()`, and `renderCookedMeals()` assigns `list.innerHTML`
  **last**. A mid-build throw therefore writes nothing and the Fridge list keeps its *previous*
  content — in the reproduction, the "No stored meals yet" empty state while real batches sit in
  `AppState`. Not one wrong label on one card.
- `showTab('fridge')` calls `renderCookedMeals()` directly, so the throw escapes the tab switch too.

The fix is the smallest fail-safe consistent with existing semantics: an
`Object.prototype.hasOwnProperty.call()` guard falling back to `'Unknown'` — the vocabulary's
existing non-answer. **No label is invented from the slug and the protein vocabulary is not
widened**; `COOKED_PROTEIN_CHOICE_IDS`, the rendered option list, `isCookedProteinChoice()` and
`flavorsForProteinType()` are all asserted unchanged by the new test. Derivation itself still
resolves the batch to the family — only the *label* degrades.

`hasOwnProperty` rather than truthiness is correct, not gold-plating: a truthiness check alone
still renders `'Auto · undefined'` for an id colliding with an `Object.prototype` key. It also
matches the idiom already used two functions away in `proteinFamilyForIngredientName()`.

**Mutation-proven, both directions.** Test 27 in `tests/ready-food-protein-hardening.spec.js`
manufactures the vocabulary mismatch a future `PROTEIN_FAMILY_BY_INGREDIENT` edit would introduce,
asserts the mismatch is genuinely present first (so it cannot silently stop testing anything), and
proves three cards still render with a working correction control:

| Mutation | Change | Result |
|---|---|---|
| A | original unguarded direct lookup restored | **FAILS** on `threw`: "Cannot read properties of undefined (reading 'label')" |
| B | truthiness-only guard, no `hasOwnProperty` | **FAILS** on `"Auto · undefined"` vs `"Unknown"` |

Both mutations reverted; the guarded form passes.

### P2-2 — CLOSED. Protein-identity documentation now matches the landed implementation

`docs/ARCHITECTURE.md` and `docs/DATA_MODEL.md` did not contain *stale* protein sentences — they
contained **none**, which is what made the claim "`cookedMeals` has no protein identity" the
operative statement. Both now describe: the optional `cookedMeals[].proteinType` field; the
explicit -> recipe-derived -> unknown precedence; derivation from structured Protein-category
ingredients by exact name rather than cooked-meal-name parsing; `none` / `mixed` / `unknown`
semantics; explicit pinning, correction and Auto/unpin (clearing DELETES the key); that derived
recipe identity is read live and never duplicated onto the batch; the shared-vocabulary
relationship `COOKED_PROTEIN_IDS` ⊂ `FLAVOR_PROTEINS`; and that this is Meal Lego **groundwork**
with flavor pairing and recommendation still separate, unstarted work.

`docs/FEATURES.md` was corrected in the same commit for the same reason — it asserted "Ready Food
-> Try with ... Requires a protein classifier for `cookedMeals`, which has no protein field",
which is the exact false claim P2-2 names. Two lines, correctly scoped. Accepted.

Verified: `Check-DocsConsistency.ps1` reports **31 items on this branch and 31 on clean `main`**,
byte-identical — every new doc anchor resolves in code, and no new drift was introduced. The 31
are pre-existing false positives (commit SHAs, PowerShell and Playwright identifiers).

### P3s — all three remain OPEN. None was fixed, incidentally or otherwise

- **P3-1 — OPEN / deferred.** An externally-authored `proteinType: null` survives
  `normalizeCookedMeal()` untouched (the guard is `!= null`) and behaves correctly as "no pin", but
  leaves a null-valued key where every other path represents no-pin as an absent key. Cosmetic
  normalization cleanup, no behavioural defect.
- **P3-2 — OPEN / deferred. Missing committed regression coverage, NOT a product bug.** The
  product logic was traced through the real `loadFromFirestore()` -> `unionByIdLWW()` path during
  this review and is **correct**: the whole-object last-write-wins invariant means a newer local
  record that has *deleted* `proteinType` beats a stale cloud record still carrying an explicit
  pin, because the newer object replaces the older one wholesale rather than being field-merged.
  What is missing is a **committed test pinning that invariant**. The union tests cover
  newer-local-pin and newer-cloud-pin; newer-local-**unpin** vs stale-cloud-**pin** is the case
  most likely to surprise a future edit, and it is the one Meal Lego will depend on once pins
  matter across devices. Recommended as the next task, before Meal Lego.
- **P3-3 — OPEN / deferred.** The card protein `<select>` has no accessible name of its own (the
  `title` sits on the wrapping `<label>`) and at `font-size: 0.8rem` its tap target is below the
  44px guideline.

### Verification

| Check | Result |
|---|---|
| deterministic suite | **473/473** (was 472; +1 new test) |
| `ready-food-protein-hardening.spec.js` | 37/37 |
| focused protein-identity / ready-food / flavor | 97/97 |
| mutations | A and B applied, both caught, both reverted |
| `Verify-Decisions.ps1` | 46/46 pointers hold |
| `Check-DocsConsistency.ps1` | 31 items, unchanged vs clean `main` (no new drift) |
| `git diff --check` | clean |
| `node --check` | `app.js` and the spec both clean |

### Blast radius

The `app.js` diff is **eleven lines inside one function body**. Grepping the diff for `saveData`,
`saveToFirestore`, `saveToLocalStorage`, `cloudReady`, `TOMBSTONE_KEYS`, `AppState.`, `localStorage`
and firestore identifiers returns **nothing**. No schema change, no new persisted field, no
normalizer change, no tombstone, no auth, no service worker, no new `AppState` key.

### D-032 gate — `approved` (HELD)

Strictly on blast radius this is outside the red zone: no Firestore/sync/storage code, no
`saveData()` call-site change, no `cloudReady` guard, no tombstone machinery, no auth, no
automation surface. It would qualify for `done`.

**Held anyway, and merged by hand**, for the same reason the hardening wave was: this is the
foundation Meal Lego is about to be built on, and it changes production rendering code on the
Fridge list — the surface whose failure mode is "the user's food list is empty". When torn between
`done` and `approved`, D-032 says choose `approved`.

**Foundation judgment: safe for Meal Lego after landing.** The identity contract Meal Lego consumes
is settled and now defended — stable precedence, a shared vocabulary that cannot drift into a
translation table, and no remaining path where reading it can crash a render. The three open P3s
all sit outside that contract. P3-2's coverage gap should close first.

---
## Review — Ready Food Protein Identity **Hardening** — PASS -> D-032 `approved` (HELD) -> OWNER-AUTHORIZED FOR LANDING
branch: `wave-ready-food-protein-hardening` @ `c742f17` (base `main @ 8711a9c`) — held, then released by the owner
verdict: **PASS** — no P0, no P1. Two P2 follow-ups and three P3 notes remain **OPEN**.
date: 2026-08-27

### Verdict
Independent review of the hardening wave that sits on top of the protein-identity groundwork landed
at `8711a9c`. One commit reviewed: **`c742f17`**, landing **unrebased, unsquashed and unamended**.

The wave makes protein identity **correctable, stable and safer for Meal Lego to depend on** without
redesigning it. The shipped precedence — explicit `cookedMeal.proteinType` -> deterministic
recipe-derived identity -> `unknown` — is unchanged, and so is the rule the whole feature exists to
protect: **a cooked meal's `name` is never read to infer its protein.** Fish hierarchy
(`salmon`/`tuna` vs `fish`) and `mixed` matching stay deferred to Meal Lego, as scoped.

Six things changed, all of them additive or restrictive:

1. **Correction / pinning on an existing batch.** The selector previously existed only on the manual
   add form, so a batch saved as Unknown, a mis-tap, or a batch whose recipe later changed could only
   be fixed by delete-and-recreate — which loses `id`, `cookedDate` and the portion counts.
   `setCookedProteinType(id, value)` now mutates the existing record in place through the same
   `stampUpdated()` -> `saveData()` -> `renderCookedMeals()` path `setCookedStorage()` and
   `updateCookedDate()` already use. The control is a compact `select` in the cooked card's meta
   row beside the date and storage toggle — no modal, no new screen, and **never prompted for**, so
   classification stays occasional setup rather than a recurring logging chore.
2. **Auto / Unknown semantics.** Clearing the selection **deletes** `proteinType` rather than
   persisting `'unknown'`. Absence already *is* the representation of "we do not know"; storing the
   string would create a second representation of the same non-answer and would freeze a
   recipe-backed batch at a non-answer instead of returning it to derivation. A rejected value is
   ignored outright rather than treated as a clear, so bad input cannot silently wipe a real pin.
3. **Recipe-edit temporal truth is unchanged and now characterized.** An **unpinned** recipe-backed
   batch still follows a later recipe edit; nothing is auto-snapshotted. Both halves are asserted, so
   a future silent snapshot fails a test rather than slipping through.
4. **Vocabulary drift closed at the source.** `index.html` was a second, hand-written copy of the
   nine ids **and** their labels. It now ships the selector empty and
   `populateManualCookedProteinSelect()` fills it from `COOKED_PROTEIN_CHOICES` at boot, the same way
   `hydrateIcons()` fills static icons. The exact cooked id set is **additionally** pinned by test,
   because the pre-existing subset invariant cannot catch a new id that is *already legal* Flavor
   Library vocabulary — `vegetables` and `rice` are exactly that hazard and remain excluded.
5. **Ingredient CATEGORY is trimmed as well as lowercased**, so an imported `' Protein '` reads as
   the canonical category. Ingredient **names** are untouched and still exact-match only. This is
   category normalization, not name inference: `'Proteins'` and `'Protein-rich'` are *not* accepted.
6. **Stored `proteinType` validation is strict on type.** `isCookedProteinChoice()` no longer coerces
   with `String()`, which had accepted `['chicken']` and an object with a matching `toString()` as
   valid on the one field Meal Lego is going to trust.

### Evidence
- **New spec** `tests/ready-food-protein-hardening.spec.js`, **36 cases**, covering all 27 required
  proofs plus five extras (`updatedAt` stamping, no-op on a missing id, the full auto-label matrix,
  both LWW directions, card-vs-form vocabulary equality).
- **Deterministic suite: 472/472**, no skips, no flakes.
- **Five mutations** applied to production code and each reverted:

  | Mutation | Result |
  |---|---|
  | Derived identity overrides explicit | **4 failed**, including one pre-existing test in the identity spec |
  | Restore `String()` coercion in validation | **3 failed** |
  | Add `rice` (a *legal* flavor id) to `COOKED_PROTEIN_IDS` | **1 failed** — the new exact pin; 67 others passed, confirming the old subset invariant alone would have missed it |
  | Remove `.trim()` from category | **1 failed** |
  | Persist `unknown` instead of deleting | **3 failed** |

### Persistence — verified, not assumed
One optional field on an existing `cookedMeals[]` record. localStorage reload (set **and** cleared),
Firestore payload plus the real `setDoc` write, a cloud load carrying an invalid value, the sign-in
union via the real `unionByIdLWW()` in **both** directions, and export/import are each covered by a
named test. **No new top-level `AppState` key and no `TOMBSTONE_KEYS` change** — both pinned.

### D-032 gate — `approved` (HELD), then owner-authorized
The change only edits an existing `cookedMeals[]` field, adds UI, and adds validation and tests. It
touches **none** of the red-zone surfaces: tombstone architecture, `mergeCloudConflict()`,
`cloudReady` / the write guard, `saveData()` semantics, auth, or the service worker — all verified
untouched in the diff. On blast radius alone this is the `done` (auto-merge) tier.

It is nonetheless recorded as **`approved` (HELD)** and merged by hand. Reason: it is the second
consecutive wave on the `cookedMeals` record and it is the foundation Meal Lego will build on, so the
owner chose to eyeball it rather than let it auto-ship. **Owner authorization for landing was granted
on 2026-08-27**; this record is committed to `main` *before* the merge, per the D-040 convention.

### P2 follow-ups — OPEN, deliberately NOT fixed in the landing commit
**P2-1 — `cookedProteinAutoLabel()` has an unguarded `FLAVOR_PROTEIN_BY_ID` lookup.** Its final
branch does `FLAVOR_PROTEIN_BY_ID[derived].label` with no existence check. Safe **today** only
because the vocabulary invariant guarantees every derived family is in `FLAVOR_PROTEINS`. If
`PROTEIN_FAMILY_BY_INGREDIENT` ever gains a family that is not a `FLAVOR_PROTEINS` id, this throws
inside `renderCookedMeals()` and takes the whole Fridge list down. The invariant test would catch the
drift, but the failure mode when it does slip through is a blank tab, not a wrong label.

**P2-2 — protein-identity documentation is stale / incomplete.** `docs/ARCHITECTURE.md` and
`docs/DATA_MODEL.md` still describe `cookedMeals` as having no protein identity, and still describe
Ready Food "Try with" as blocked on a classifier that now exists. Neither the groundwork wave
(`8711a9c`) nor this one wrote those records. Fixing them is its own docs pass and is **not** bundled
into this landing.

### P3 notes — recorded, not blocking
1. An externally-authored `proteinType: null` survives `normalizeCookedMeal()` untouched (the guard
   is `!= null`) and behaves correctly as "no pin", but leaves a null-valued key on the record where
   every other path represents no-pin as an **absent** key.
2. There is **no committed regression test** for the newer-local-**unpin** versus stale-cloud-**pin**
   direction. The union test covers newer-local-pin and newer-cloud-pin; a clear racing a stale pin
   is the case most likely to surprise.
3. The card protein `select` has no accessible name of its own (the `title` sits on the wrapping
   `label`, not the control), and at `font-size: 0.8rem` its tap target is below the 44px guideline.

### Gate
**Status: `approved` (HELD) -> owner-authorized -> landing.** Merge `--no-ff` into `main`, preserving
`c742f17` unchanged. No squash, no amend, no rebase, no force push. `wave1-portion-truth` stays
parked at `88b5598`.

---
## Review TASK-057 / D-071 — PASS → D-032 `approved` (HELD) → OWNER-AUTHORIZED FOR LANDING
branch: d-071-tombstone-namespace @ f73ce3c (base `main @ 98cf393`) — held, then released by the owner
verdict: **PASS** — no P0, P1 or P2 findings remaining
date: 2026-08-26

### Verdict
Independent review of collection-aware deletion tombstones. Two commits were reviewed:
- **`1f443ac`** — original implementation candidate ("fix: namespace deletion tombstones")
- **`f73ce3c`** — repair ("fix: restore aggregate tombstone guard"), the final branch HEAD

The first review pass did **not** pass. It found an **aggregate `MASS_DELETE_GUARD` regression**:
namespacing the tombstone map had also split the mass-delete safety check per collection, so a
small collection could fall through the guard while the larger collections were correctly
suppressing a transient-empty startup/sync race. That is exactly the phantom-mass-delete class the
guard exists to stop. It was repaired in `f73ce3c`, which restores aggregate semantics —
`recordLocalDeletions()` now sums vanished ids across every `TOMBSTONE_KEYS` collection into
`totalVanished` and compares that single total against `MASS_DELETE_GUARD` before writing any
tombstone. A **signed-out load side effect** introduced alongside the original candidate was also
removed. Both fixes are present at `f73ce3c` and re-reviewed clean.

The **collection-aware tombstone architecture passes**. `AppState.deletions` is now the nested
collection-keyed shape pinned by the task, not the flat global id map. A tombstone written for
recipe `5` can no longer reach cooking-hack `5`, pantry item `5`, custom ingredient `5`, cooked
meal `5` or user ingredient `5`. Every writer, reader, merge path and purge path named in the
Phase 1 characterization was checked and is collection-aware. The deterministic cross-collection
deletion bug that motivated D-071 is closed at the architectural level.

### The migration is knowingly lossy — accepted
Legacy flat tombstones carry no collection identity, and nothing persisted anywhere can recover
it (`_idBaseline` is in-memory only). **Ambiguous legacy tombstones are therefore deliberately
dropped** rather than fanned out across all collections — fanning out would reproduce the exact
data-loss bug D-071 exists to end.

The consequence is recorded and accepted: **some historical ambiguous deletes may become
resurrectable from a stale remote copy.** An old delete whose tombstone was dropped can come back
if a device still holding the record syncs in. **This is the accepted trade for ending
deterministic cross-collection deletion.** A resurrected item is a visible, user-correctable
annoyance; silent destruction of five unrelated records is neither. The task brief stated the
migration could not be lossless and forbade pretending otherwise; the implementation does not
pretend otherwise.

**Old clients preserve but do not honor nested tombstones.** A client running pre-D-071 code
round-trips the nested `deletions` object through localStorage and Firestore without discarding it,
but does not apply it — so deletions made on a new client will not take effect on an old one until
that client updates. Preservation without honoring is the correct failure mode here: the data
survives the round trip, so the deletion applies as soon as the old client upgrades.

### Residual P3 observations (recorded, not blocking)
1. The aggregate guard now sums **per-collection** disappearances. The same raw id vanishing from
   two collections counts twice, where the old flat map counted one distinct global id. This is
   **slightly stricter** than the previous behavior and **fails safer** — it suppresses marginally
   more, never less. Correct direction for a data-loss guard.
2. **More than 5 genuine vanish-diff deletes can still be suppressed indefinitely** by
   `MASS_DELETE_GUARD`. A user deleting six or more items in one save gets no tombstones and the
   baseline is intentionally left unchanged. This is **inherited base behavior, not introduced by
   D-071** — the guard predates this task and its threshold was not in scope. Worth a future
   decision; not a reason to hold this branch.
3. **Production-smoke changes cannot be validated until deployed.** The three
   `tests/production-smoke-*.spec.js` files were updated for the nested shape but exercise the
   live Pages deployment, so they prove nothing while the branch is unmerged. They are a
   post-landing verification step, not pre-landing evidence.

### The gate
D-032 **RED ZONE → `approved` (HELD)**. This is tombstone-merge-deletion machinery, a wire-format
change, and an admitted lossy migration — the precise surface CLAUDE.md's risk-gated merge policy
holds back. `TASKS.md` TASK-057 is set to **`approved`, not `done`**: no auto-merge, no deploy.

**Owner authorization is required before merge.** The branch is not merged, not pushed, and stays
at `f73ce3c`. `wave1-portion-truth` remains parked at `88b5598`, untouched.

### Not yet done at review time — deferred to landing (now complete)
At review time D-071 was **not** closed out: `docs/DECISIONS.md`, `docs/DATA_MODEL.md`,
`docs/ARCHITECTURE.md`, `planning/ROADMAP.md` Known Issues and `planning/DONE.md` were left
unchanged, because recording a decision as closed before it ships would make the docs lie about
production. All of them were updated after deployment verification succeeded — see the landing
addendum below.

### LANDED — 2026-08-26
Merged `--no-ff` into `main` at **`bd89d5d`**, parents `6e28903` (owner-authorization record) and
`f73ce3c` (reviewed branch HEAD). `1f443ac` and `f73ce3c` landed **unrebased, unsquashed and
unamended**; both remain ancestors of `main`. Pushed to `origin/main`. `wave1-portion-truth`
untouched at `88b5598`.

**Local, on merged `main`:** `node --check app.js` OK; `npm test` 404/404; `npm run test:local`
404/404; focused deletion/sync specs (tombstone-namespace, flavor-library, cook-depletion-tombstones,
kitchen-truth, starter-pack, what-should-we-eat, suite-classification) 154/154;
`Verify-Decisions.ps1` 41/41 — the three new D-071 pointers added by this landing all hold;
`git diff --check` clean.

**First push-triggered CI: FAILED, attempt 1, recorded as-is and NOT re-run for green.**
Run `33000618114`, workflow `Button tests`, event `push`, SHA `bd89d5d`. Local gate: 401 passed,
3 failed — `bulk-add-partial-retry.spec.js:416`, `flavor-library.spec.js:328`,
`inventory-quantity-truth.spec.js:81`, all `page.waitForFunction` 30s timeouts on `waitForRestored()`
post-reload predicates. Production gate **skipped**, because the local gate runs first.

Diagnosed as **pre-existing test-harness (D-065 reload-race), not a D-071 product regression**, on
evidence rather than assertion:
- `bulk-add-partial-retry.spec.js:416` — the same test at the same line — already failed on `main`
  at run `32899800754` (TASK-055 merge), before D-071 existed.
- Two of the three specs are byte-untouched by D-071; the third's failing test is untouched (only
  the tombstone tests changed in that file).
- None of the three predicates involve `AppState.deletions`.
- `normalizeDeletions()` measures 0.0004–0.004 ms per call; it cannot contribute to a 30,000 ms
  timeout.
- CI on `main` has been intermittently red with this class across several merges.
The most likely amplifier is the suite growing 381 → 404 tests, increasing runner contention — the
exact condition TASK-056 identified and left as an inferred runner condition. No `workflow_dispatch`
run was started.

**Pages deployment: SUCCEEDED** in run `33000615788` (separate workflow). All five served assets —
`app.js`, `index.html`, `style.css`, `sw.js`, `manifest.json` — match landed `main` byte-for-byte
after line-ending normalization. The deployed `app.js` contains every D-071 helper and the aggregate
guard (`totalVanished > MASS_DELETE_GUARD`), with **zero** occurrences of the old per-vanish guard or
raw-id tombstone writes.

**Production smoke against the deployed build:** `npm run test:prod` — **137 passed, 4 skipped, 0
failed**. A subsequent isolated re-run of three specs hit two 7.1-minute navigation stalls against
GitHub Pages (far beyond the 30s test timeout, consistent with rate limiting after 170+ live
navigations); a targeted serial re-run passed 26/26, including `kitchen-truth:259` (bulk cleanup
crossing `MASS_DELETE_GUARD` live) and `cook-method:267` (a tombstoned starter recipe not re-added).
Recorded as environmental, not relabelled.

**Ten further live proofs** were run against the deployed URL, using the committed production-smoke
conventions, covering what the committed specs do not yet pin: recipe-5 tombstone leaves hack 5 and
pantry 5 alone; reverse for `customHacks` and `pantry`; flavor isolation both directions; exclusive
prefix normalization; ambiguous-numeric drop with no global fallback; the aggregate transient-empty
guard writing zero phantoms; a below-guard delete still tombstoning its own collection only; LWW
three ways; no page or console errors. All 10 pass. These are **not committed** — pinning them as a
production-smoke spec is recommended follow-up rather than unreviewed scope added during a landing.

`TASKS.md` TASK-057 → `status: done`. D-071 closed as landed in `docs/DECISIONS.md`;
`docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `planning/ROADMAP.md`, `planning/DONE.md` and
`STATUS.md` updated.

→ `TASKS.md` TASK-057 set to `status: approved`. Held for owner.

### Owner authorization — GRANTED, 2026-08-26
The HELD gate above is **explicitly released by the owner.** Recorded on `main` in its own commit
**before** the merge, per the D-040 audit convention (`/merge` reads `TASKS.md` from `main`, not the
branch, so landing records never ride inside the reviewed branch's commits).

What the owner is authorizing, stated plainly:

- **TASK-057 review passed** — independent review, no P0, P1 or P2 findings remaining.
- **D-032 gate was `approved` (HELD)** — red zone: tombstone-merge-deletion machinery, a wire-format
  change, and a knowingly lossy migration. It did not auto-merge and was not pushed on any agent's
  judgement.
- **The owner has now explicitly authorized the merge and push.**
- **Reviewed implementation SHAs: `1f443ac` (original) and `f73ce3c` (repair).** `f73ce3c` is the
  final reviewed branch HEAD and the tree that lands. Neither commit is rebased, squashed or amended.
- **The migration deliberately DROPS ambiguous historical flat tombstones.** A legacy flat key with
  no collection-exclusive prefix (bare numerics, timestamps, imported ids) carries no recoverable
  collection identity, so it is discarded rather than applied to every collection.
- **Consequence, accepted with eyes open: some historical ambiguous deletes may become resurrectable
  from stale remote data.** A device still holding such a record can sync it back after its
  tombstone is dropped.
- **This is the accepted tradeoff for stopping deterministic cross-collection deletion.** A
  resurrected item is visible and user-correctable; the silent destruction of five unrelated records
  sharing an id is neither, and it was reproducible on `main @ 98cf393` before this work.

TASK-057 is **NOT** marked `done` by this record. It stays `approved` through the merge and is only
set to `done` after the push, the first CI run, GitHub Pages deployment verification and the
production-smoke suite all pass against the deployed build. D-071 likewise stays open in
`docs/DECISIONS.md` until production verification succeeds — recording a decision as closed before
it demonstrably ships would make the docs lie about production.

## Review D-070 — APPROVED AND LANDED (Flavor Library wave)
branch: wave-flavor-library @ 54099ce → main @ b219e20 (`--no-ff`, unrebased)
verdict: approved and landed after independent audit
date: 2026-08-26

### Findings
The Flavor Library implementation matches D-070's intended shape: `AppState.flavors` is a real
top-level synced collection, every inbound flavor id is normalized into the `flv-` namespace, old
local/cloud/import data without `flavors` loads as an empty collection, and normalization does not
invent `updatedAt` values that could beat tombstones.

Persistence coverage was complete across localStorage, backup/restore, import/export,
Firestore payloads, conflict merge, sign-in union, realtime snapshots, Clear All Data, and
local-deletion detection through `TOMBSTONE_KEYS`. Flavor deletion uses the existing `saveData()`
path and the shared deletion-detection flow rather than writing a one-off tombstone.

The deferred boundaries held. Ready Food has no "Try with" integration, Meal Lego is not present,
manual cooked-meal names are not protein-classified from free text, and no protein inference layer
was introduced. D-071 remains open exactly as recorded: the flat cross-collection tombstone bug was
characterized, not fixed.

### Verification
Pre-merge local verification passed: targeted Flavor Library Playwright spec 47/47, local suite
382/382, full `npm test` 382/382, suite-classification 6/6, and `tools/Verify-Decisions.ps1`
reported all decision pointers valid.

Landing verification recorded the first push-triggered CI result as-is. Run `32983219373`
(`Button tests`, event `push`, SHA `b219e202eb8b5a1e6208aa1638b3ec59e58ce911`) failed in the
local branch gate: `tests/inventory-quantity-truth.spec.js` timed out in `waitForRestored()` after
381 tests had passed. The workflow's Pages wait and production smoke steps were skipped by that
failure, and no `workflow_dispatch` verification was run.

GitHub Pages itself deployed the pushed SHA successfully in run `32983147959`
(`pages-build-deployment`, SHA `b219e202eb8b5a1e6208aa1638b3ec59e58ce911`). The served
`index.html`, `app.js`, and `style.css` from `https://shinyamadasan.github.io/Meal-Prep/` match the
landed files after line-ending normalization and include the Flavor Library anchors.

### Carried forward
- D-071 stays open: `AppState.deletions` is still a flat cross-collection id map.
- Ready Food → "Try with" and Meal Lego remain deferred.
- `wave1-portion-truth` remains parked at `88b5598`, untouched.

→ no TASKS.md status change; this was a landing/review wave, not a numbered Codex task.

## Review TASK-056 — APPROVED (reload-state harness audit, D-065 addendum 2) — D-032 `done`, operator-approved
branch: fix/reload-restore-audit @ ac64da8 → main @ 92dbdea (`--no-ff`, unrebased)
verdict: approved — test/harness infrastructure only; product source byte-unchanged
date: 2026-08-25

### The gate
D-032 **`done`**. Eleven files, all tests or docs. `git diff 8b13ddf -- app.js index.html style.css
sw.js manifest.json` is empty. `tests/app-ready.js` is untouched on this branch, so both helper
contracts survive exactly as reviewed.

### Why this task existed at all
TASK-055 named these sites as residual risk and left them, on the reasonable grounds that none had
been observed failing. That reasoning held for exactly one CI run. The next push-triggered gate went
red on `bulk-add-partial-retry.spec.js:426` — `Expected ["Chicken","Eggs","Milk"], Received []` —
the identical signature in one of the named sites. Worth recording plainly: the previous wave's
scope call was defensible and still turned out to be wrong within a day, which is the argument for
finishing an audit once its class is proven rather than deferring the tail.

### The census correction is the most valuable finding
The prior report said eleven reload sites across ten specs. A recount from source gives **16 across
13**. The gap was not sloppiness in one direction only: three were already fixed, and two more
(`ready-food-portions`, `recipe-edit-preservation`) already carried correct inline restore-waits and
had simply not been recognised as such. An audit that trusts its own earlier inventory is not an
audit, and this one didn't.

### Classification, and the discipline in it
| class | meaning | count | outcome |
|---|---|---|---|
| A | assertion depends on restored state | 14 | 3 done previously, **11 migrated here** |
| B | reload tests boot/view behaviour only | 1 | retained |
| C | harness defect: init re-runs on reload | 1 (same site as B) | fixed |
| D | asserts an ABSENCE | 1 | retained, risk recorded |

Post-change census: **14 of 16 on `waitForRestored()`, zero reading persisted state after a bare
`waitForAppReady()`.**

Two judgements are worth endorsing explicitly.

**Identity, not fields.** The default predicate waits for the record to exist and leaves the field
checks to `expect()`. A row restores atomically out of one `JSON.parse`, so identity is sufficient
proof of restoration — and it keeps a genuine persistence bug a readable diff instead of converting
it into an opaque timeout. That is the right trade and it was reasoned about rather than defaulted
into.

**The two exceptions are correct.** `seed-isolation`'s edited-seed case and `starter-pack`'s saved-id
case cannot use identity, because a fresh re-seed also produces ids 27/5 and also produces 40 ids
respectively. There the predicate has to witness the persisted *edit* or the *saved set*. Getting
this wrong would have produced two tests that pass whether or not restoration happened — exactly the
false-positive class this work exists to remove.

**Class B was not converted for consistency's sake.** `cook-method-discovery`'s reload asserts
`recipeQuickFilter === ''`, a module-scoped variable that a reload clears unconditionally. No
restored state is involved and `settled()` is the honest wait. Resisting a tidy-looking blanket
migration here is a point in the change's favour.

**Class C is preventive, and labelled as such.** That same spec was the only one of thirteen whose
`addInitScript` had no bootstrap sentinel, so `localStorage.clear()` ran on every navigation. The
report does not overclaim: it is *not* a false positive today, because the assertion holds either
way. It primed the file for one. Sentinel added; no assertion touched.

**Class D is left alone, correctly.** `seed-isolation:239` asserts that a deliberately empty recipe
list is not re-seeded. There is no predicate for "the thing that must not happen has finished not
happening", and manufacturing a completion signal would be a product change under a product freeze.
Stopping and recording it was the right call. It is the one remaining special-case risk on the
reload surface.

### Evidence
Reproduced **at the exact failing site**, which is stronger than TASK-055 managed: A/B against the
same 20×-throttled page, ten runs — bare `waitForAppReady()` failed **4/10** and what it read was
`[]`, the CI symptom verbatim; `waitForRestored()` failed **0/10**. Abort-Firebase control 0/10 for
both, so the honest position is unchanged: class reproduced, runner condition inferred.

Negative-proofed in one sweep across every predicate shape — sabotaging all restored collections
makes all eleven migrated waits time out naming their missing state. No new wait is decorative.

**No assertion added, removed or altered** anywhere, confirmed by grepping `expect(` over the whole
diff. Two `waitForTimeout(300)` removed, both trailing settles inside the inline restore-waits that
were folded onto the shared helper; none added; no unrelated interaction wait touched. That is
exactly the diff shape the brief asked for.

### The first push-triggered CI run
Green on **attempt 1**, no retries: local gate **335 passed** at 2 workers, production gate **137
passed**. Both formerly-red sites (`bulk-add-partial-retry` and the three TASK-055 specs) passed,
and the production gate followed the local gate normally for the first time in three landings.

One green run is not proof that an intermittent class is gone, and this review does not claim it is
— the observation window over the next several ordinary pushes is the actual evidence.

### Gate chosen, and why
**`done`**. No product surface; the worst case of a wrong test wait is a red gate, not lost data.
Operator directed the landing explicitly.

---
## Review TASK-055 — APPROVED (test gate determinism, D-065 addendum) — D-032 `done`, operator-approved
branch: fix/test-gate-determinism @ 4f1b9d9 → main @ 1cee2d9 (`--no-ff`, unrebased)
verdict: approved — test/harness infrastructure only; product source byte-unchanged
date: 2026-08-25

### The gate
D-032 **`done`**, and unusually easy to justify: the diff is five files and **none of them is
product code**. `git diff 56d8da7 -- app.js index.html style.css sw.js manifest.json` is empty.
`tests/app-ready.js` gains one helper; three specs each change one `require` line and one wait
call; `docs/DECISIONS.md` gains a D-065 addendum. No assertion was touched.

### What was actually wrong
Three CI failures on `56d8da7` with the product byte-identical to a passing run —
`kitchen-truth` (`pantryHas: false`), `low-effort-metadata` (recipe `undefined`),
`cook-depletion-tombstones` (`pantryIds: []`). The investigation's central finding is that these
are **one cause, not three**: `initApp()` ends with `showTab('dashboard')` → `renderDashboard()`
unconditionally, so the dashboard paints — and `waitForAppReady()`'s condition goes true — against
a still-default `AppState` whenever restore happens later in the async `onAuthStateChanged`
callback. Readiness measured at 346ms; the saved pantry landing at 406ms. The only thing covering
that gap was the helper's trailing `waitForTimeout(150)` — **elapsed time standing in for a state
check**, which is precisely what D-065 replaced 2500ms waits to avoid. It survived a year because
150ms is generous on a developer machine and is not on a loaded two-worker runner.

That is a genuinely good diagnosis: it explains all three symptoms, it explains why they are
intermittent, it explains why they only appear on CI, and it explains why they rotate between
specs.

### Evidence quality
Not asserted — **reproduced**. Under 20× CPU throttling with 8-way parallelism the pantry read back
empty after reload, the exact CI symptom. Then an A/B harness ran both strategies against the *same*
throttled page ten times: old pattern **2/10 failed**, waiting on the state itself **0/10**. That
is the right shape of proof, because it isolates the strategy rather than comparing two runs.

Negative-proofed three ways: sabotaging the restored state makes each of the three new waits time
out naming that state. This matters — the previous harness printed green without exercising the
condition, and that is exactly the failure mode being closed.

### Honesty check — the limit is stated, not buried
The reproduction needed the async-init path. The three specs abort Firebase, where `initApp()` is
fully synchronous and readiness genuinely implies restore, and the gap never appeared there even at
20×. So the **failure class is reproduced; the exact condition that opened the gap past 150ms on
the runner is inferred.** Alternatives were checked and ruled out rather than hand-waved: a
`saveData()` debounce (`saveToLocalStorage()` is synchronous), service workers (do not register
under `file://`), static `#dashboard` markup (the element is empty in `index.html`), and a
reseeding init script (all three bootstrap guards are correct). `cook-depletion-tombstones` asserts
`storedPantryIds` from localStorage *before* reloading and passes, which independently rules out
"the save never happened".

The fix does not depend on which condition it was. If the state truly never arrives, the wait now
times out naming that state instead of producing an assertion diff against an empty `AppState` —
strictly better diagnostics either way.

### Scope discipline
`waitForAppReady()` is deliberately **unchanged**. Narrowing it globally to "a saved document is
loaded" would have been the obvious move and would have broken the specs that intentionally boot an
empty or seeded document. Keeping the old contract and adding a narrower sibling in the same file
is the right call, and it avoids two helpers that mean almost the same thing.

Retries were **not** added, and the reasoning is correct: a retry would have made the gate print
green while the tests continued asserting against pre-restore state. `retries = 0` with
timing-independent tests is the right state for a branch gate.

### The first push-triggered run — read this before concluding anything
Run `32899800754`, attempt 1, **failed**, and it is worth being precise about what that means.

It failed on `bulk-add-partial-retry.spec.js:426` with `AppState.pantry` reading back `[]` after
reload — the **identical signature**, in one of the ELEVEN reload sites this task deliberately did
not migrate. All three fixed specs passed. The production gate was skipped because the local gate
runs first and failed, which is D-065's intended ordering, not a second defect.

A `workflow_dispatch` on the same SHA (`32900172249`) was green: local 335, production 137, no
retries.

So the landing is not falsified — it is corroborated. The class is real, the three fixed sites hold,
and the next flake landed exactly where this review predicted it would. That promotes the
remaining-reload migration from a theory to an evidenced follow-up. It was NOT absorbed here, per
operator instruction.

### The rule this establishes
> A rendered application is not proof that persisted state needed by a test has been restored.
> Tests that depend on restored state must wait on that specific state.

Recorded in the D-065 addendum and at the point of use in `tests/app-ready.js`, so the next person
who is tempted to "simplify" `waitForRestored` back to `waitForAppReady` reads why not.

### Gate chosen, and why
**`done`**. There is no product surface in this change at all, and the worst case of a wrong test
wait is a red gate, not lost user data. Operator directed the landing explicitly.

---
## Review TASK-054 — APPROVED (Bulk Add short years, D-067 extension) — D-032 `done`, operator-approved
branch: fix/bulk-add-two-digit-year @ f2aaca8 → main @ 7ce77cc (`--no-ff`, unrebased)
final main: 88d6357 (production smoke follow-up)
verdict: approved — text parsing plus one branch of Bulk Add control flow; outside the red zone
date: 2026-08-25

### The gate
D-032 **`done`**. The `app.js` diff is three hunks, all inside the date-parsing region and
`confirmBulkAdd()`'s trailing-date branch: two new helpers (`expandYear`, `shortYearPlausible`),
one extracted shared verdict (`trailingDateVerdict`, which both month-word branches now route
through so they cannot drift apart), a third return shape on `parseTrailingDate()`, and one
`if (!perLineExpiry)` guard. `index.html` is one sentence of Bulk Add help copy. `style.css`,
`sw.js` and `manifest.json` are byte-unchanged.

A red-zone grep across the entire branch diff returns **zero** lines touching `saveData`,
`saveToFirestore`, `saveToLocalStorage`, `cloudReady`, tombstones, `MASS_DELETE_GUARD`,
`recordLocalDeletions`, `snapshotIdBaseline`, `buildFirestorePayload`, `applyPurchaseToStock`,
`canMergePurchase*`, `findMergeableStock`, `pantryDaysLeft`, `pantryExpiryInfo`,
`FRESHNESS_WARN_DAYS`, `renderPantry`, `:root`, `serviceWorker` or auth. No new persisted state
and no persisted-shape change: the parser's only output is the same canonical `expiryDate` /
`dateMode` pair D-066 already stores.

### What was wrong, and what the four review rounds changed

Characterised on unmodified `main @ 6692e2a` before any edit. `Eggs 12 pcs Aug 8 26` stored the
whole line as `name`, `inferCategory()` matched "eggs" inside it, and `categoryShelfLife('Protein')`
supplied 3 days — the exact D-066/D-067 symptom, through a third door, purely because the year was
two digits. `Eggs, 12, pcs, Aug 8 26` failed differently and more quietly: name, quantity and unit
parsed correctly and the fourth field was dropped with no warning at all.

Round 1 accepted a two-digit year on a total 00-99 map. **Review caught that this was too
permissive**, and the catch was correct: `Juice May 5 12` became an expiry in 2012. Round 2 added
the plausibility window. **Review then caught that the window had put a new rung above the top of
the D-067 ladder** — `Juice May 5 12 exp:2026-08-08` was being held back even though the user had
already supplied an unambiguous expiry. Round 3 fixed that. Both catches were real defects that the
implementation had shipped past; neither was a preference call.

### Verdict per contract

| contract | verdict |
|---|---|
| `Aug 8 26` / `August 8 26` / `8 Aug 26` / comma form → Eggs / 12 / pcs / `2026-08-08` | ✅ |
| Deterministic expansion, no sliding century rule | ✅ 26→2026, never 1926 |
| Window `[currentYear - 1, currentYear + 10]` inclusive, clock-relative | ✅ proven from one input across pinned 2026 and 2030 clocks |
| Four-digit years never windowed; no general expiry-age rule | ✅ `May 5 2012`, `1999`, `2099`, ISO all store as typed |
| Implausible short year → D-068 attention, not persisted, exact text, four-digit guidance | ✅ |
| Date text never buried in the item name | ✅ third verdict `{ shortYear }` exists precisely for this |
| Valid `exp:` outranks the rejection; short year stays in the name | ✅ |
| Shared expiry / shelf-life inference do NOT rescue | ✅ |
| Invalid `exp:` fails on its own terms | ✅ rejected before the year is reached; note names the expiry |
| Plausible date + `exp:` → date stripped, `exp:` wins | ✅ unchanged from D-067 |
| Calendar validity judged before the year | ✅ `Feb 31 26` stays "not a date at all"; no March rollover |
| Slash dates refused at every width | ✅ unchanged, including with `exp:` present |
| Numeric-name safeguards | ✅ original list plus six new adversarial two-digit cases |
| D-068 retry | ✅ resolved lines leave, actionable stay byte-for-byte, no reprocessing |
| D-069 merge | ✅ short and four-digit produce byte-identical records and identical toasts |

### Evidence quality

Two things raise this above the usual bar. First, **the tests control the clock.** Because the
expansion is relative to the current year, any case asserting a literal expansion would have
started failing in 2037; `page.clock.setFixedTime` pins 2026 where the literals live and 2030 to
prove the window moves, and one case derives the bounds from the app's own clock so it states the
rule rather than a date. The production smokes do the same — short-year inputs there are built from
the *deployed* app's clock, so the post-deploy gate cannot rot either.

Second, **nine mutants, all caught**: four-digit-only (12 fail), window removed (3), each bound
moved one step in each direction (3 each), rejected year buried in the name (7), `exp:` rescue
removed (4), rescue extended to the shared field (1), rescued line's name stripped (4). Every
pre-existing case passes under all nine, which is the shape a safe extension should have.

Worth recording honestly: **three of the implementer's own draft assertions were wrong about D-069
and the app was right** — twice expecting a merge where a printed expiry correctly forces
separation, once expecting a second record where a quantity-less duplicate is correctly skipped.
Each was corrected to the real rule rather than the code being bent to the test. That the existing
D-069 machinery pushed back three times is itself evidence it is well specified.

### Not rubber-stamped

Two things were checked specifically because they are where this kind of change goes wrong, and
both held: the regex alternation `(\d{4}|\d{2})` does not mis-match a three-digit year (`aug 8 226`
and `aug 8 026` both fail cleanly rather than truncating), and `expandYear()` runs *before*
`isRealCalendarDate()` so a short year can never bypass calendar validation.

### Carried forward, deliberately not fixed
Slash date + `exp:` remains `attention` — the one place `exp:` is not the top of the ladder,
carried forward by explicit operator instruction. `Trail Mix May 5 26` remains the accepted
trailing-date tradeoff. Historical names are never re-parsed. Input-path consolidation,
two-tap pantry-card collapse and unknown-quantity paired rows all remain separate work.

### Gate chosen, and why
**`done`**, not `approved`. Text parsing and one control-flow branch; nothing in the red zone; the
change only ever widens or narrows what a *new* submission parses into fields that already exist,
and stored records are never re-read. Operator directed the landing explicitly.

---
## Review TASK-053 — APPROVED (inventory quantity truth, D-069) — D-032 `done`, operator-approved
branch: fix/inventory-quantity-truth @ 4b0d761 → main @ 0fe2a63 (`--no-ff`, unrebased)
final main: 006f779 (production smoke follow-up)
verdict: approved — pantry-record field logic and Bulk Add control flow; outside the red zone
date: 2026-08-25

### The gate
D-032 **`done`**. The code diff is `app.js` only: four new helpers (`unitsMergeable`,
`canMergePurchaseInto`, `findMergeableStock`, `applyPurchaseToStock`), the Bulk Add duplicate
branch, `buildBulkAddSummary()`'s fourth argument, and `confirmAddIngredientToPantry()`'s
edit-in-place. `index.html`, `style.css`, `sw.js` and `manifest.json` are byte-unchanged.

A grep of the whole branch diff for `cloudReady`, `AppState.deletions`, tombstone/`MASS_DELETE`,
`saveToFirestore`, `runTransaction`, `mergeCloudConflict`, `unionById`, `snapshotIdBaseline`,
`recordLocalDeletions`, `function saveData`, auth handlers and `serviceWorker` returns **nothing
added or removed**. No new `AppState` key; a test asserts `buildFirestorePayload()`'s keys are
unchanged and contain no `lots`/`stockLots`.

### Context — Claude-implemented, human-directed
Implemented directly by Claude from an operator dogfooding brief. Review of Claude's own work,
disclosed as in TASK-044 through TASK-052.

### The finding that changed the shape of the task
The brief reported "editing quantity does not reliably take effect" and explicitly said not to
assume which layer was at fault. Characterisation cleared the obvious suspect: the pantry card's
`updatePantryQty()` was driven through typed-then-Tab, Enter, row-tap-to-collapse, tab switch,
two consecutive edits, touch and keyboard, float / `buy_` / `ib_` / `staple_` ids, string / null /
zero quantities, duplicate names, a twenty-item list scrolled to the middle, 390px and 1280px —
**and against the deployed site**. It persisted, re-rendered and survived reload every time.

The writer that actually lost data was `confirmAddIngredientToPantry()`, which deleted every
same-name record and rebuilt one to change a single field. Measured on an `Eggs 6 pcs · Expires
Aug 28` record: new id, `expiryDate` gone, `dateMode` gone, `staple` gone, `stockLevel` gone,
`purchaseDate` reset to today, `shelfLifeDays` 20 → 3. That is the "I changed the quantity and the
expiry disappeared" report, and it is exactly what the brief's requirement 1 forbids.

### What was NOT accepted at face value
- **"Fix Bulk Add's duplicate policy" did not become "merge everything."** Merging a purchase that
  carries its own printed expiry into a bought-date record would discard the user's date; merging
  across units would invent 501 g; merging into an untracked quantity would either fabricate a
  total or destroy the one real number. Each of those stays a separate record instead.
- **No second merge policy.** `canMergePurchase()` is reused verbatim. The new predicate only adds
  the facts the incoming purchase knows.
- **No unit conversion.** `unitConvertFactor()` is the price path and `getUnitConversion()` returns
  `1` for anything unrecognised, so neither qualifies as "already tested for pantry quantities".

### Evidence
- Mutation checks, both confirmed: reverting the Price Book fix fails exactly the field-preservation
  test (21/22); restoring the duplicate-skip fails 12 merge tests (10/22).
- Local deterministic suite: **306 passed** on merged main, and again on CI's runner.
- Production smokes against the deployed bundle: **123 passed, 4 skipped** (the pre-existing
  notification specs that require `--headed`).
- Deployed `app.js`, `style.css`, `index.html`, `sw.js` verified SHA-256-identical to `006f779`.

### Landing defect found by CI, and fixed
The branch updated the LOCAL `bulk-add-partial-retry` spec to the new duplicate policy but not its
production mirror, which still asserted the pre-D-069 wording. CI's post-deploy gate caught it: the
deployed build correctly reported `2 items added · 1 stock item updated · 1 already in pantry`
while the smoke expected the old string. **The shipped behaviour was right; three assertions were
stale.** Fixed in `006f779` alongside the new D-069 production smoke. This is a real miss in the
reviewed branch — the two-gate CI design is what caught it, working as D-065 intended.

The first CI run also failed on `tests/recipe-edit-preservation.spec.js` (a 30s timeout). Verified
unrelated: zero recipe-touching lines in the diff, 3/3 passes locally, the same spec already flaked
on CI at run 32696176916 on 2026-08-24, and the rerun passed the local gate.

### Must-fix
None.

### Recorded, deliberately not fixed (operator instruction)
- **Two-tap pantry-card collapse.** `renderPantryKeepOpen()` replaces `#pantry-list.innerHTML` from
  the `change` handler, so the tap that triggered the blur never lands as a `click`. The value IS
  saved; the card just does not collapse until a second tap. Pre-existing. Flagged prominently
  because it can make a successful quantity edit appear broken — the report that started this task.
- **Unknown-quantity paired row.** See D-069's tradeoff section.

---
## Review TASK-052 — APPROVED (bulk-add partial-retry, D-068) — D-032 `done`, operator-approved
branch: fix/bulk-add-partial-retry @ 73bee77 → main @ dcd69a1 (`--no-ff`, unrebased)
verdict: approved — control flow and feedback inside `confirmBulkAdd()`; outside the red zone
date: 2026-08-25

### The gate
D-032 **`done`**. The diff is `app.js` (the result loop, the post-loop branch, and a new
`buildBulkAddSummary()`) plus a 12-line CSS block. `index.html`, `sw.js` and `manifest.json` are
byte-unchanged. A grep of the diff for `saveToFirestore`, `saveToLocalStorage`, `cloudReady`,
`AppState.deletions`, tombstone/`MASS_DELETE`, `buildFirestorePayload`, auth handlers,
`applyTombstones`, `snapshotIdBaseline`, `FRESHNESS_WARN_DAYS`, `pantryDaysLeft`,
`pantryExpiryInfo`, `canMergePurchase`, `stockPurchasedGroceryItem`, `collectAttentionItems`,
`maybeNotifyAttention` and the three D-067 parser functions returns **nothing added or removed**.
`results` is a local array — no new `AppState` key, no persisted-shape change.

### Context — Claude-implemented, human-directed
Implemented directly by Claude from an operator brief. Review of Claude's own work, disclosed as in
TASK-044 through TASK-051.

### The finding that changed the shape of the task
The brief described a retry-UX problem and specified that ambiguous and invalid-date lines are
"actionable" and should remain in the textarea. Driving all eight cases through the real modal showed
that **those lines were already being added.** Neither warning path returned:

```
"Milk 2 L 8/8/2026"            -> warned, AND added as name="Milk 2 L 8/8/2026",
                                  quantity null, shared expiry silently substituted
"Eggs, 12, pcs exp:2026-02-31" -> warned, AND added as "Eggs", shared expiry
                                  standing in for the rejected date
```

Keeping such a line for correction while its record exists produces, on retry, a junk record **plus**
a clean second copy (Milk — different names, so the duplicate guard never fires) or a confusing
bounce (Eggs). The brief's own acceptance behaviour is therefore unreachable without changing this:
**a line cannot both be kept for correction and already be committed.**

So Bulk Add moves from `warn + add anyway` to `actionable warning = hold the line back`. This was
flagged at hand-off as a behaviour change beyond control flow and explicitly approved. It is the
single most important thing in this task not to regress. The D-067 parser verdicts are untouched —
the invalid date is still rejected, the ambiguous one still never guessed.

### What I checked hardest
**That classification cannot drift with wording.** Every path pushes exactly one
`{ line, status, message }`, and the textarea is built from `status === 'attention'` alone. A test
asserts that a duplicate and a malformed-quantity line — both of which read as "skipped"-ish prose —
are separated correctly by status, not by text.

**That `skipped` deserves to be its own state.** A duplicate cannot be fixed by editing the line, so
leaving it in the textarea can only reproduce the same message forever. It is removed but still
reported in the summary and in its own note, which satisfies "do not silently hide that it was
skipped" without trapping the user. All-duplicate now closes rather than holding the modal open.

**That persistence stayed tolerant.** Valid lines are still committed when a sibling needs work. The
`saveData()` call site is unchanged. Making the batch transactional was never on the table and would
have been the wrong reading of the brief.

**That shared controls survive.** Storage and Expiry are untouched by a submit — verified not only
as values but by asserting they still apply to the corrected line on the retry pass.

### The mutation check I initially got wrong
Restoring the old "every submitted line stays" behaviour first failed only 6 of 18 — and **not** the
central retry test. Two reasons, both mine: the test helper overwrote the whole textarea instead of
editing what was actually in it, and the notes panel is cleared when the modal closes, so asserting
on notes could not see the difference. Both were fixed: the retry now corrects the date in place in
the real post-submit contents, and asserts the summary (`'1 item added.'` versus
`'1 item added · 2 already in pantry.'`), which is the signal that actually distinguishes them.
7 of 18 now fail under the mutation, including the retry case.

### Shipped assertions changed, and why that is disclosed rather than quiet
Two D-067 assertions (`bulk-add-date-truth.spec.js` cases 9 and 9b) encoded the old
warn-and-add-anyway behaviour. They are updated, with the reason recorded inline in the spec and in
D-068. Their parser-level halves — the date is rejected, the ambiguous one is never guessed — are
asserted exactly as before. Changing an approved test is worth calling out explicitly; it is
justified here only because the behaviour they described is the behaviour this task deliberately
changes.

### Evidence
- `tests/bulk-add-partial-retry.spec.js` — 18 passed, covering all 21 required proofs
- focused partial-retry + date-truth + inventory-expiry + kitchen-truth + food-attention — 107 passed
- `npm run test:local` — 283 passed (was 265)
- `tools/Verify-Decisions.ps1` — 20/20 pointers hold (4 new)

### Risk-gate
Low. One function's control flow plus a summary helper and a CSS block; reversible in a single
revert with no stored-data migration to unwind. The one thing a revert would also undo is the
approved hold-back behaviour, which is why it is stated at the top of D-068 rather than buried.

---
## Review TASK-051 — APPROVED (bulk-add date truth, D-067) — D-032 `done`, operator-approved
branch: fix/bulk-add-date-truth @ 281c0b4 → main @ d2abf03 (`--no-ff`, unrebased)
verdict: approved — input parsing and modal copy; outside the red zone
date: 2026-08-25

### The gate
D-032 **`done`**. The diff is `app.js` (a date helper block plus 16 lines inside `confirmBulkAdd()`)
and `index.html` (modal helper copy and placeholder). `style.css`, `sw.js` and `manifest.json` are
byte-unchanged. A grep of the whole diff for `saveToFirestore`, `cloudReady`, `AppState.deletions`,
tombstone/`MASS_DELETE`, `buildFirestorePayload`, `saveData`, auth handlers, `applyTombstones`,
`FRESHNESS_WARN_DAYS`, `pantryDaysLeft`, `pantryExpiryInfo`, `canMergePurchase`,
`stockPurchasedGroceryItem`, `collectAttentionItems` and `maybeNotifyAttention` returns **nothing
added or removed**. No new `AppState` key, no persisted-shape change — the fields already existed —
and no migration, so a revert restores prior behaviour exactly.

### Context — Claude-implemented, human-directed
Implemented directly by Claude from an operator brief carrying a production reproduction. Review of
Claude's own work, disclosed as in TASK-044 through TASK-050.

### What characterisation added to the brief
The brief named one defect. Driving the real `confirmBulkAdd()` in a browser — rather than reading
the source — surfaced two more, and one of them is worse than the reported one because it is
completely silent:

```
eggs, 12, pcs, aug 8 2026
  -> name="eggs", quantity=12, unit="pcs", NO expiry, no warning
```

Name, quantity and unit parsed correctly and the **fourth comma field was dropped on the floor**.
Nothing on the card looks wrong; the item simply carries a category-derived freshness forever.

```
Eggs, 12, pcs exp:2026-02-31
  -> stored "2026-02-31", rendered "Expires Mar 3"
```

`new Date()` rolls over silently rather than erroring, so the old `!isNaN(...)` guard was shape
validation masquerading as date validation — the D-066 renderer then displayed a day the user never
typed. Adjacent to the brief rather than part of it; fixed anyway, and flagged at hand-off as added
scope the operator could reject. Leaving one date path able to invent a day while hardening the
other would have been incoherent.

Third finding: **Bulk Add had no parser test coverage of any kind.** Every pre-existing spec matching
"bulk" tests bulk *cleanup* (`removeAllExpired`), a different feature. This parser had shipped
untested since it was written.

### What I checked hardest
**That the safety argument is load-bearing and stated.** The whole defence of the numeric-name list
is the requirement of a **month word (or full ISO) plus a four-digit year**. `7 Up`,
`Heinz 57 Sauce`, `Formula 1 Protein`, `Vitamin B12`, `12 Grain Bread`, `Omega 3 6 9`,
`Vitamin 2000`, `Sauce 12 2026` and `Blend 2026` survive for exactly one reason: none of them ends
in a month followed by a year. That is written into both the code comment and D-067, because the
obvious future "improvement" — accepting a bare trailing number — breaks all of them at once.

**That refusing 8/8/2026 is the right call, not laziness.** It is day-first in half the world and
month-first in the other. A wrong guess moves an expiry by up to eleven months and writes it into a
food-safety signal, which is the precise failure D-066 and D-067 both exist to close. So it is
recognised only in order to *say* it is ambiguous; `looksLikeAmbiguousDate()` never produces a date.

**That there is still exactly one expiry model.** The parser writes `expiryDate` / `dateMode` and
stops. `pantryDaysLeft()`, `pantryExpiryInfo()` and the D-066 renderer are untouched, and the spec
asserts the resulting card shows the absolute date and the relative badge from that one source.

**That the existing parser was reused, not duplicated.** The date is stripped and the remainder goes
through the pre-existing comma path and `NO_COMMA_RE`, both byte-unchanged. A regression case pins
`Coconut cream 200ml`, `Soy Sauce, 1, bottle` and bare `Garlic`.

**That precedence cannot let a weaker source win.** `perLineExpiry || naturalExpiry || bulkExpiry`,
with the trailing date stripped *even when* `exp:` also appears, so a typed date can never survive
inside the name while still losing to the stronger source.

### Evidence
- `tests/bulk-add-date-truth.spec.js` — 21 passed, covering all 16 required proofs
- focused bulk-add + inventory-expiry + kitchen-truth + food-attention — 89 passed
- `npm run test:local` — 265 passed (was 244)
- `tools/Verify-Decisions.ps1` — 16/16 pointers hold (4 new)
- Mutation-checked: **14 of 21 fail** against unmodified `main`. The 7 that pass are the
  backward-compatibility guards — they are supposed to hold on both sides, and it would be a
  problem if they did not.

### Risk-gate
Low. Input parsing only, reversible in one revert, with no stored-data migration to unwind. The
residual risks are all stated rather than hidden: a product name genuinely ending in a month and a
year is read as name + expiry; slash dates stay unsupported; there is no year sanity range; and the
pre-existing "warnings keep the modal open" behaviour is now easier to reach because a new class of
warning exists.

---
## Review TASK-050 — APPROVED (inventory expiry truth, D-066) — D-032 `done`, operator-approved
branch: fix/inventory-expiry-date-truth @ e8ad4fb → main @ 142ec35 (`--no-ff`, unrebased)
verdict: approved — UI, CSS and one manual-entry function; outside the red zone
date: 2026-08-24

### The gate
D-032 **`done`**. The diff is the add form, the pantry card renderer, two CSS blocks and a spec.
No Firestore, `saveData()`, `cloudReady`, tombstone, merge/deletion or auth code is touched. The
one storage-adjacent question — `dateMode: undefined` reaching Firestore — was checked rather than
assumed: both write sites already pass the payload through `JSON.parse(JSON.stringify(payload))`,
which strips undefined keys, and this is the same mechanism the pre-existing
`staple: dbEntry ? … : undefined` in the very same function already relied on.

I flagged at hand-off that `approved` was also defensible, because the first commit changes what
`addToPantry()` writes into inventory records. The operator approved explicitly at `e8ad4fb` and
directed the merge, so `done` is the landed gate — recorded here so the choice is not silent.

### Context — Claude-implemented, human-directed
Implemented directly by Claude from an operator brief with a screenshot. Review of Claude's own
work, disclosed as in TASK-044 through TASK-049.

### The finding that defines this task
The brief described a display problem: the expiry date looked embedded in the item name, and only
the derived "3d left" was exposed. **Characterising before fixing showed the display ambiguity was
the smaller half of the defect.**

`addToPantry()` read `#pantry-input` verbatim into `name`, so the whole typed string *was* the name.
`quantity` stayed null, `unit` stayed `''`, `expiryDate` was never set. `inferCategory()` still
loose-matched "eggs" inside the string and returned `Protein`; the exact-name shelf-life lookup then
failed (the name was a whole sentence) and fell back to `categoryShelfLife('Protein')` — **3 days**,
counted from today. That, not the user's typed date, is where `3d left` came from.

Replayed against the shipped code:

```
STORED: {"name":"eggs 12pcs august 10 2026","category":"Protein",
         "purchaseDate":"2026-08-24","shelfLifeDays":3,"quantity":null,"unit":""}
daysLeft: 3 → "3d left"

Same item with the date captured:  daysLeft: -14 → "Expired 14d ago"
```

So the badge was not ambiguous, it was **wrong**: three days of claimed life for food whose printed
date had passed a fortnight earlier. That lands on north-star goal #2, and it is why this was
treated as a correctness fix rather than a polish item.

### What I checked hardest
**The D-057 boundary.** `docs/FEATURES.md` recorded that D-057 removed quantity from this row and
that `addToPantry()` "leaves quantity unknown", which reads at first glance like this change
reverses an approved decision. Read in full, D-057's "no modal, no quantity prompt, no date entry"
is scoped to **grocery check-off** — Bought ✓ being the whole interaction — and that path is
untouched here. What D-057 removed from `addToPantry()` was two null-guarded reads of elements
already deleted from `index.html`: dead code, not a capability.

D-057's rule that *is* global — the app admits ignorance rather than inventing a number — is
preserved literally. Every new field is optional; blank means unknown. No quantity still stores
`null` rather than `1`, and no date still leaves bought-date mode. A user who ignores the detail
line gets byte-identical behaviour. The stale half of the FEATURES line was corrected rather than
left to disagree with the code.

**Date/badge agreement.** `pantryExpiryInfo()` could have recomputed an expiry boundary of its own;
that would have been a second freshness model, the exact drift D-057 spent effort eliminating. It
instead branches on `dateMode` in the same two cases `pantryDaysLeft()` does, so the chip and the
badge are two renderings of one number. A spec sweeps ±400 days across both modes asserting they
always name the same day.

**"Best by" vs "Expires".** A printed date is the user's fact; a bought-date-plus-shelf-life date is
the app's estimate from a coarse table. Labelling both "Expires" would launder the estimate into a
claim — the same over-reach the old `3d left` badge was already committing. `dateMode` already
encoded the distinction; the UI stopped hiding it.

**The scoped CSS override.** `.ing-name-wrap` is shared with the custom-item modal at
`index.html:1038`. The `min-width` floor is scoped to `.pantry-add-row` so that modal is unaffected.
This was the only place a mistake in the mobile commit could have leaked.

### The scope call I got wrong first, and corrected
I found the 26px name-input squeeze during the first commit, verified it pre-existing on unmodified
`main`, and left it out under the surgical-changes rule with a note in D-066 that it "should get its
own task". That was wrong once the consequence was clear: structured fields are worth nothing if the
row carrying them cannot be typed into on the phone the app is dogfooded on. The operator called for
the mobile pass; it landed as `e8ad4fb`, and D-066's section was rewritten to record the fix rather
than the deferral.

### Evidence
- `tests/inventory-expiry-display.spec.js` — 14 passed (8 data/display, 6 mobile)
- focused inventory-expiry + kitchen-truth + food-attention — 68 passed
- `npm run test:local` — 244 passed (was 238)
- `tools/Verify-Decisions.ps1` — 12/12 pointers hold
- Mutation-checked twice. The 8 data/display cases fail **7 of 8** against unmodified `main`. The
  two width cases fail against the pre-wrap CSS. Reported honestly: the other four mobile cases
  (overflow, reachability, persistence, not-one-column) pass both before and after **by design** —
  this bug was a squeeze, not an overflow, and the detail fields were in an already-wrapping row, so
  they were never unreachable. They guard adjacent failure modes.
- `#pantry-input` width before → after: 320px **26→188**, 390px **26→179**, 414px **45→203**,
  768px 399→399, 1280px 943→943. Desktop byte-identical; no horizontal overflow at any width.

### Risk-gate
Low. Two CSS properties (one parent-scoped), one renderer change, one entry function. Reversible in
a single revert. The residual cosmetic cost — a taller add form at 390px — is stated in TASKS.md and
D-066 as carried forward, not hidden.

---
## Review TASK-049 — APPROVED (test-infrastructure trust, D-065) — D-032 `done`, operator-approved
branch: wave-test-infra-trust @ 55f83c2 → main @ a067b8c (`--no-ff`, unrebased)
verdict: approved — infrastructure only, outside the red zone
date: 2026-08-24

### The gate
D-032 **`done`**. The wave changes the test harness, npm scripts, CI wiring, and one error-handling
path in `run-claude.ps1`. `git diff a292206 HEAD -- app.js index.html style.css sw.js manifest.json`
is **empty** — no product source at all, so there is no user-visible behaviour to revert. The one
automation change strictly *reduces* blast radius: a path that used to halt the overnight run now
warns and continues.

### Context — Claude-implemented, human-directed
Implemented directly by Claude from an operator brief. Review of Claude's own work, disclosed as in
TASK-044 through TASK-048. The mitigating factor specific to this wave is that its central finding
was that the **brief itself was wrong**, which is the opposite of the failure mode self-review
usually risks.

### The finding that defines this wave
The brief asserted a root cause: the automation invoked `Check-DocsConsistency.ps1` instead of
`.\tools\Check-DocsConsistency.ps1`. Verified false before any edit. `run-claude.ps1` has always
used a full path; the line is byte-identical to the halting commit (`git diff 38c86cb HEAD --
run-claude.ps1` is empty); and it runs correctly under both PowerShell 5.1 — which is what the
scheduled task actually invokes — and pwsh 7.

The message was then attributed experimentally rather than assumed. Only a bare-name call yields
`'Check-DocsConsistency.ps1'`; an empty variable yields `'\tools\…'`; a missing file yields the full
path. No bare-name call exists anywhere in the repo. **The halt is not reproducible from HEAD and
its trigger remains unknown** — recorded as an open item rather than papered over.

What *was* certain: the block's own comment read "Non-fatal … it never halts automation" and the
next line was `catch { Halt-Automation … }`. A docs-drift report killed the whole overnight run.
That contradiction is the defect, and fixing it is what actually makes the loop trustworthy.

### What I checked

**1. The automation fix is proven, not asserted.** Four cases run through the scheduler's own
`powershell.exe -NonInteractive -ExecutionPolicy Bypass -File` path: checker present (16 findings,
exit 1), checker absent, checker throws, and a **reproduction of the exact 2026-08-23 bare-name
error**. All four reach downstream work; none halts; the three failure cases surface a WARN in both
`claude-session.log` and `DIGEST.md`. The historical failure now degrades to a warning.

Worth recording how that proof nearly went wrong: the first harness extracted the block to a file
without a UTF-8 BOM, so PowerShell 5.1 misdecoded the em-dash and emoji and the block failed to
parse — yet the harness still printed "downstream reached", because a parse error in a dot-sourced
file is non-fatal. The first three runs were therefore **meaningless passes**. Caught by noticing
that no WARN reached the log despite the branch supposedly executing. A test that cannot fail is
not evidence.

**2. The split is enforced, not documented.** An explicit `PROD_SPECS` list would rot silently, so
`tests/suite-classification.spec.js` runs in the local project and fails if a spec containing the
deployed URL is not classified prod, if a listed spec no longer touches the network, or if a listed
file is missing. It also asserts every `tools/*.ps1` path `run-claude.ps1` references exists —
catching the whole bad-invocation class rather than the one script — and that Phase 3b still
contains its `Test-Path` and no `Halt-Automation`. Six tests, all reading files off disk, so the
guard cannot itself be flaky.

**3. Nothing stops being verified.** `npm test` narrowing to the local gate would be a regression if
CI still ran only `npm test`. CI now runs `test:local` first, keeps the 90s Pages sleep, then runs
`test:prod`. `playwright.config.js` was added to the workflow's `paths:` filter, since it decides
what each gate runs.

**4. The wait audit is an audit, not a sweep.** All 16 occurrences were classified before editing;
all 16 were post-`goto`/`reload` initialisation. None waited on network (every local spec aborts
`**/firebasejs/**`) and none was intentional UX timing, so nothing was retained — and the review
checked that this was a finding rather than a convenience, by confirming no category-C wait existed
to preserve. The readiness condition deliberately avoids `recipes.length > 0`, because several specs
boot a zero-recipe document on purpose; it was verified against both a first-run boot and a
saved-doc-with-no-recipes boot.

**5. The diff is exactly what it claims.** Across the 9 specs: 16 removed `waitForTimeout(2500)`
lines, 16 added `waitForAppReady(page)` lines, 9 added `require` lines. Nothing else. No assertion
touched, no test deleted (31 spec files → 32).

### One self-correction worth noting
The first draft of D-065 backticked two test-only identifiers, which pushed `Check-DocsConsistency`
from 16 findings to 18 — adding noise to the exact signal this wave exists to make trustworthy.
Rephrased before commit; drift is back to the pre-existing 16.

### Verification
`test:local` 230 passed (repeated runs, ~58s) · `test:prod` 77 passed / 4 skipped · `npm test` 230
passed, confirming it is the local gate · suite-classification 6/6 · `Verify-Decisions.ps1` 7/7
(3 new pointers) · docs-consistency runs correctly under PS 5.1 and pwsh 7 · product source diff
empty.

### Carried forward, not fixed
The root trigger of the historical bare-name error is still unknown. `Check-DocsConsistency` still
emits 16 mostly-noise findings and needs its own precision pass. Production tests inherently cannot
validate an unmerged branch. Shorter mid-test fixed waits (500/600ms) outside the audited 2500ms
initialisation class were not examined. The three specs hardened in D-064 keep their own local
condition helper rather than the new shared one. `wave1-portion-truth` remains parked at `88b5598`.

---
## Review TASK-048 — APPROVED (cooking-method discovery, D-060..D-064) — D-032 `done`, operator-approved
branch: wave-cook-method-discovery @ 5f3c342 → main @ 8e847c6 (`--no-ff`, unrebased)
verdict: approved — reversible, outside the red zone
date: 2026-08-23

### The gate
D-032 **`done`**, not `approved`/held. The wave changes recipe metadata, filtering, presentation,
and adds one opt-in action that writes recipes through the normal `saveData()` path. The diff
against `52f33ce` greps clean for `saveToFirestore`, `cloudReady`, `TOMBSTONE_KEYS`,
`applyTombstones`, `recordLocalDeletions`, `mergeDeletions`, `isFirstRun`, `onAuthStateChanged` and
`serviceWorker` — every hit is a comment — and adds no `AppState.<key> =` assignment. The one
genuinely dangerous version of the delivery feature, automatic re-seeding, is the version that was
deliberately not built. The operator approved explicitly at `5f3c342` and instructed the landing.

### Context — Claude-implemented, human-directed
Implemented directly by Claude across four operator briefs rather than delegated to Codex
(CLAUDE.md Delegation Policy). Review of Claude's own work, stated plainly — same disclosed caveat
as TASK-044 through TASK-047. Mitigated here by the fact that the wave's central finding was a
*test* failure of the previous wave, and by three defects below that tests caught rather than
inspection.

### The finding that defines this wave
The brief assumed the filters were missing. They were not. `RECIPE_QUICK_FILTERS` had working
rice-cooker / oven / no-cook / lowest-effort matchers since D-055, and D-059 added a test
exercising every chip; both were green. Verified against the shipped build in a throwaway worktree
at `52f33ce`: `#recipe-quick-filters` rendered `display: none`, `innerHTML: ""`, **zero chips**,
because `renderRecipeQuickFilters()` hides any chip matching no recipes and **all 26 seeded recipes
carried no metadata at all**. D-059 recorded that in writing and built neutral fallbacks around it.

Every discovery test passed because each injected its own fully-tagged fixtures. **A feature test
that supplies its own data proves the code works, not that the product does.** The new specs assert
against the shipped `sampleRecipes`, and the production smoke asserts against the deployed bundle.

### What I checked

**1. Presentation grouping, not schema.** `Rice cooker` matches `rice-cooker` and
`rice-cooker-steamer`; `Instant Pot` matches `instant-pot` and `pressure-cooker`. No
`cookingMethod` field, no migration, no data touched — the finer slugs stay filterable through the
refinement chip. A test asserts no recipe ever surfaces under a method its own `equipment[]` does
not support, and a second asserts a `microwave` recipe appears under none of the five.

**2. Empty primaries stay visible.** Hiding zero-count chips is precisely what made the capability
invisible, and hardest to find exactly when the user most needs to know it exists. Primary chips now
render muted with an empty state naming the editor field that fills them; refinements still hide.
That is the fix for the actual reported problem, and it is why the wave could ship honestly before
the recipes existed.

**3. Metadata is truthful, and a test enforces it.** All 26 originals are `pan` because every one is
an explicitly stovetop dish; Tortang Talong says "grill or roast" and is still `pan`, because
tagging it `oven` to populate a chip would invent a claim the recipe does not make. The 14 new
recipes each name their appliance in their own instructions, and a guard greps for it: an `oven`
recipe must say oven/bake/roast, a rice-cooker one must say "rice cooker", a `no-cook` one must not
say fry/boil/simmer/sauté. A separate test asserts ids 1–26 still carry exactly `['pan']`, so no
future edit can quietly relabel them.

**4. One definition of "easy".** `Lowest effort` used `<= 1` while Home's "Easiest" used `<= 2` —
a recipe could be Easiest on Home and excluded from Lowest effort on Cook. Aligned to `<= 2` with a
test asserting the two agree rather than merely both existing. The chip also sorts, reusing the
D-059 ranking helpers; ordering is by work, not clock, and Nilaga (60 min total, 15 hands-on)
correctly outranks Chicken Adobo (45 total, 18 hands-on).

**5. Delivery does not weaken the first-run gate.** `ensureStarterRecipes()` is untouched.
Eligibility disqualifies an id for two reasons: already present (permanent skip — the user may have
edited it, and a test renames/rescales/rewrites recipe 31 then asserts every field survives), or
tombstoned. The tombstone check is not cosmetic: `applyTombstones()` is LWW, so re-adding with a
fresh `updatedAt` would **beat** the tombstone and resurrect the recipe on every device. The pack
reads `AppState.deletions` and never writes it, asserted byte-identical after an add.

**6. Duplicate protection is in the function, not the button.** Candidates are re-derived per call.
The test drives `addStarterPackRecipes()` directly rather than clicking, because a guard that exists
only in the UI is not a guard.

### Defects found during review, all fixed on the branch

**Seed objects were shared with the module constant.** `[...sampleRecipes]` copies the array only.
`toggleFavorite()`, `updateServingSize()` and `normalizeRecipes()` all mutate in place, so a seeded
session rewrote `sampleRecipes` as the user worked. Reproduced end to end: scale recipe 27 to 8
servings and favourite it, let a sign-in merge replace `AppState.recipes` with a set lacking 27–40,
then use the starter pack — it added recipe 27 **pre-scaled to 8 servings and already favourited**,
then persisted it. Fixed at both seed entry points with the deep-copy pattern the pack already used;
`patchMissingNutrition()` was aliasing the seed's nutrition object and now copies. This is the
strongest argument in the wave for checking reachability instead of merging on "looks fine".

**`patchMissingNutrition()` over the whole list rewrote user recipes.** Adding a starter pack stamped
empty metadata defaults onto recipes the user had made. Caught by a test asserting a user's own
recipe is byte-identical after an add; now scoped to the new copies only.

**Two harnesses cleared `localStorage` from `addInitScript`**, which re-runs on every navigation
including `page.reload()`. Their reload assertions were starting from a blank slate; the
starter-pack "survives a reload" test passed only because a fresh re-seed also yields 40 recipes.
Both now guard the clear, so reload exercises the real restore path.

### One ranking change beyond the brief, stated rather than buried
`applianceFriction()` now counts appliance **families**, so `instant-pot` + `pressure-cooker` no
longer pays the two-appliance penalty. A consequence: `['rice-cooker-steamer', 'oven']` previously
escaped the penalty (the old filter removed the steamer slug entirely) and now pays it. That is a
genuine two-appliance recipe so the new answer is correct, but nobody asked for it. No test asserted
the old value; a test asserts the new one. Revert by dropping `'rice-cooker-steamer'` from
`APPLIANCE_FAMILY`. Friction *cost* is unchanged.

### Verification
Local suite on the branch and on merged `main`: **224 passed, 0 failed**, deterministic across
repeat runs. Full suite: **286 passed, 4 skipped, 0 failed**. Production smoke against the deployed
build at `8e847c6`: **15/15**, including the four method filters returning real recipes, the opt-in
prompt adding without overwriting, tombstone suppression, and seed isolation on the shipped bundle.

Note for future reviewers: **9 spec files hit the live GitHub Pages site**, not local files. They
validate whatever is deployed, are network-dependent, and were the source of every intermittent
failure observed during this wave. The 224-test local suite is the deterministic branch gate.

### Carried forward, not fixed
180-day tombstone horizon for deleted starter recipes; the Firebase multi-device path is untested in
the local harness (Firebase is stubbed in every local spec in this repo); `defaultStorageData` and
`defaultCookingHacks` may share the same shallow-copy pattern and need their own audit; `Lowest
effort` stays intentionally broad at `<= 2` (26 of 40) pending dogfooding. `wave1-portion-truth`
remains parked at `88b5598`.

---
## Review TASK-047 — APPROVED (what-should-we-eat ranking, D-059) — D-032 `done`, operator-approved
branch: wave-what-should-we-eat @ df1a905 → main
verdict: approved — reversible, outside the red zone
date: 2026-08-22

### The gate
D-032 **`done`**, not `approved`/held. This wave adds derived ranking and one additive Home card. It
writes nothing: the diff against `main` greps clean for `saveData(`, `saveToFirestore`, `cloudReady`,
`AppState.deletions`, `snapshotIdBaseline`, `tombstone`, `onAuthStateChanged`, `serviceWorker`,
`showNotification` and `FOOD_ALERTS_KEY`, and introduces no `AppState.<key> =` assignment. A broken
ranking is a bad suggestion the user ignores and a one-commit revert — not lost data. The operator
approved explicitly and instructed the landing; recorded here for the trail.

### Context — Claude-implemented, human-directed
Implemented directly by Claude at the operator's instruction rather than delegated to Codex
(CLAUDE.md Delegation Policy). Review of Claude's own work, stated plainly — same disclosed caveat
as TASK-044/045/046. Mitigated here by the ranking being a pure function with no DOM access, so
every weight is asserted independently by test rather than inferred from rendered HTML; two of the
three weighting defects below were found by those tests, not by reading the code.

### What I checked
**1. No parallel recommendation system.** `getWhatShouldWeEatSuggestions()` composes existing
helpers: ready food is `getReadyFoodSuggestions(1)[0]` verbatim, availability is
`getCookableRecipes()`, expiry pressure is `getExpirySuggestions()`, effort/variety are
`recipeEffortScore()` / `recipeActiveMinutes()` / `varietyPenalty()`, balance is
`normalizeMealBalance()`. No freshness boundary is recomputed anywhere in the wave, and a test
asserts the expiry signal comes from the shared scan rather than a private copy.

**2. Ranking is separable from rendering.** `eatCookCandidates()` returns scored candidates with a
named `parts` field per signal; `renderWhatShouldWeEatCard()` only draws. That is what made
one-signal-at-a-time assertions possible, and it is why the two weighting bugs surfaced.

**3. Shopping as a tier — the one structural decision.** The first cut priced missing ingredients at
2 each and recommended a shopping trip over dinner: a no-cook, assembly-effort, minimal-cleanup
recipe missing two items scored 5 against 12 for an ordinary pan recipe that could actually be
cooked. Correctly re-framed: needing to shop happens *before* you can start and often means not
eating tonight, so it is a tier, not a weight. Also the more explainable shape — "you have
everything for this one" is the first reason a person wants. The test now asserts the assembly
recipe still scores *better* and still loses, which is a sharper proof than a score comparison.

**4. Expiry weight.** −3 lost to an easier rival's effort-plus-appliance edge, contradicting the
briefed priority order that puts expiry second only to availability. Raised to −8 and locked by a
competing-reasons test.

**5. Effort reads hands-on time, not total.** A 40-minute pressure-cooker recipe beats a 20-minute
pan recipe, with a test asserting the inversion explicitly (total 40 vs 20; active-time cost 0 vs 2).
`recipeActiveMinutes()` falls back to total time when `activeTime` is undeclared — the safe
direction, so an unlabelled recipe is never mistaken for an effortless one.

**6. Honesty by omission, each with its own test.** No ready food → no "Eat this first". Nothing with
`recipeEffortScore() <= 2` → no "Easiest", because mislabelling a normal cook is a lie the user
notices once. Empty `cookHistory` → no "Something different", because with no history everything is
equally new and the reason would be fabricated. Zero picks hides the card entirely.

**7. Legacy data.** None of the 26 seeded recipes carry D-055 metadata. Undeclared appliance scores
the neutral middle (2) and undeclared balance is neither rewarded nor condemned (4), so pre-D-055
recipes rank sensibly instead of being buried. A test loads a legacy save and asserts those defaults
land, the card renders, and no hint is invented from absent balance data.

**8. Completion hints invent nothing.** Deterministic sentences off the existing `mealBalance`,
offered only when a protein is declared to build around. A manually added batch with no source
recipe, and a legacy recipe with no balance data, both get `''` rather than a guess.

**9. Reads only.** A test hammers rank → candidates → render card → render dashboard twice and
asserts pantry, cooked meals, grocery list, deletions, cook history and the `mealPrepFoodAlerts`
notification ledger are byte-identical afterwards. Displaying a recommendation consumes nothing;
only the pre-existing `useCookedPortion()` / `finishCookedMeal()` / cook actions mutate anything, and
none were modified.

**10. Existing surfaces intact.** The Ready-to-eat and What-should-I-cook cards are unchanged and
still render below the new one — their own tests assert presence, contents and relative order. The
recipe quick-filters are untouched and a new test exercises every chip (rice cooker, rice + steamer,
Instant Pot, oven, pan, no-cook, lowest effort).

**11. Presentation.** Reasons render as chips; `score` and `parts` ride on the object for tests only,
and a test asserts no rendered chip looks like a number. Labels use inline Lucide icons rather than
the sketched emoji — 🍱 and 🍽️ rendered as tofu boxes in the first review screenshots, and the repo
already migrated off emoji for that reason (`ICON_PATHS` comment).

### Merge-time finding
`origin/main` had advanced one commit since the branch was cut: `b488750 replies: cleared after send`
— the n8n reply-relay clearing `captures/replies/OUTBOX.md` back to its placeholder after sending the
notifications-wave Telegram summary, exactly as `captures/replies/README.md` documents. Verified
docs-only and with **zero file overlap** against the wave's diff before merging. Local `main` was
fast-forwarded to it; the branch was merged `--no-ff` on top, unrebased, so the reviewed commits
land byte-for-byte as reviewed.

### Post-merge verification (filled in after deployment)
- Pages deployment succeeded for final `main`; deployed bytes compared against the committed blobs
  rather than assumed.
- Production smoke `tests/production-smoke-what-should-we-eat.spec.js` against the live site.
- Full suite on final `main`.
(See the numbers recorded in STATUS.md's entry for this wave.)

### Pre-existing CI/live-smoke flake — flagged again, still not absorbed
A single live-site production smoke fails per full-suite run, a **different test each time**, and
passes in isolation: this session saw `production-smoke-ready-food.spec.js:212` and
`production-smoke-kitchen-truth.spec.js:386` fail on separate runs, the latter then passing 11/11 on
its own. These specs hit the *deployed* site, which cannot contain branch code, so they can never be
evidence about a branch under review. Already logged in `docs/AI_OS_NOTES.md` (2026-08-22) with
candidate fixes: raise the timeout for `production-smoke-*`, pin them to one worker, or split
live-site smoke into its own workflow. Deliberately left alone here rather than folded into an
unrelated wave.

### Known follow-up — recorded, NOT fixed here
Home now carries three suggestion surfaces: the new decision card plus the two older cards it
summarises. That is real redundancy and the one place this wave arguably works against its own UX
goal. It was kept deliberately — the existing cards' tests assert their presence *and* relative
order, and the brief said not to redesign Home. **Dogfood the new card first.** If it proves
sufficient, a later UX wave should consolidate or remove the redundant surfaces; that is a UI
decision with its own test churn and belongs in its own wave.

### Inherited / deferred, carried forward unchanged
- Pantry ingredient matching remains substring-based (`"Rice"` matches `"Rice Vinegar"`) — pre-existing.
- No shopping/grocery-planning expansion: the availability tier makes missing-ingredient recipes a
  last resort, and turning them into a shopping nudge was out of scope.
- No portion-aware serving maths.
- `wave1-portion-truth` remains parked and untouched at `88b5598`.
- No persisted recommendation state; results are derived fresh every render.

### Risk-gate
**D-032 `done`** — approved and reversible. No red-zone surface touched. Landed `--no-ff`.

→ TASK-047 status set to `approved` in TASKS.md before the merge, then `done` after deployment and
production smoke.

---
## Review TASK-046 — APPROVED (food attention notifications, D-058) — owner-approved D-032 red-zone merge
branch: wave-food-attention-notifications @ 31bf98d → main
verdict: approved — **red zone**, merged only on the operator's explicit written instruction
date: 2026-08-22

### The gate, stated plainly
This wave writes nothing to `AppState`, `AppState.deletions`, Firestore or `mealPrepAppData`, and a
regression test asserts that. It is still **red zone** under D-032, for one reason: it modifies
`sw.js`. The service worker is the offline-cache surface every user loads the app through, and a
broken worker is not a one-minute revert — it can wedge a cached app on a device that then never
fetches the fix. I recommended `approved` (held for a human) rather than `done` (auto-merge),
returned the branch unmerged and unpushed, and did not merge on my own judgement. The operator then
explicitly instructed: *"Approved pending one final device verification… Merge
wave-food-attention-notifications @ 31bf98d into current main with --no-ff."* That instruction is
the gate being satisfied — priority 1 in the CLAUDE.md Decision Priority list. Recorded here so the
audit trail shows a human, not Claude, released the red-zone work. **This was not an automatic
merge.**

### Context — Claude-implemented, human-directed
Implemented directly by Claude at the operator's explicit instruction rather than delegated to Codex
(CLAUDE.md Delegation Policy). This is a review of Claude's own work, stated plainly — the same
disclosed caveat as TASK-044/045. Mitigated here by the fact that the central architectural claim
(the notification layer invents no freshness of its own) is proven *structurally* by a test that
stubs `collectAttentionItems()` and asserts the notification follows the stub, rather than by a
second read of the same code.

### The finding that shaped the whole wave
Phase 1 characterised the platform before any code was written, and the answer was negative:
**this app cannot deliver a notification while it is closed, and nothing short of new backend
infrastructure would change that.** Hosting is static GitHub Pages with no server-side compute; the
only backend is a stateless recipe-import Worker with no scheduler; `sw.js` was cache-only; the
Firebase project is Auth + Firestore with no FCM registration, no VAPID key and no messaging SDK.
Web Push would mean a VAPID keypair, a per-device subscription store, and a scheduled service that
reads every user's inventory — a materially larger security and privacy surface than this app has
today. Periodic Background Sync is Chromium-only, installed-PWA-only, engagement-gated and free to
never fire. The Notification Triggers API never shipped past origin trial.

The operator's decision gate ("if reliable background notifications require significant backend push
infrastructure, stop and report") was therefore hit, reported, and honoured. No push stack was
built. See DECISIONS D-058.

### What I checked
**1. No second freshness model.** `maybeNotifyAttention()` calls `collectAttentionItems()` and reads
its Expired / Use soon buckets. `pantryDaysLeft()`, `daysLeftFrom()`, `cookedShelfLife()`,
`freshnessStatus()` and `FRESHNESS_WARN_DAYS` are byte-identical to `main`. Verified structurally,
not by inspection: one test replaces `collectAttentionItems()` with a stub returning a fabricated
item and asserts the notification follows the stub. If a parallel expiry rule is ever introduced,
that test fails.

**2. Keep suppression is inherited, not re-implemented.** There is no `keptOn` or `isKeptToday()`
reference anywhere in the new code. Keep works because it removes the record from the Expired bucket
before the notification layer sees it. Two tests cover it: kept-before-first-alert (never announced,
ledger stays empty) and kept-after-an-alert (silent on the next pass). The Inventory tab still shows
the item's own "Expired Nd ago" badge — D-057's rule that Keep hides the *offer*, never the *truth*,
is preserved.

**3. Expired food is never offered for eating.** Three copy shapes, and every expired body says
"Open Meal Prep to review". A test lowercases title+body and asserts absence of `eat`, `cook`,
`consume`, `use soon`, `used soon`, `use it`, `use them`. A second test on a mixed kitchen asserts
the expired item's name never appears in the "should be used soon" clause.

**4. Deduplication is the smallest state that works.** A ledger of `"<kind>:<id>" → state`, rewritten
from the current world each pass. Unchanged food is silent across four consecutive passes and across
a page reload; use-soon → expired announces once more (genuinely new information) then goes quiet;
removed food drops out of the ledger so a re-add can announce again. Keys namespaced by kind, so a
pantry id can never mask a cooked-meal id — asserted directly.

**5. No new top-level state.** The ledger lives in the device-local `localStorage` key
`mealPrepFoodAlerts`, alongside the existing `mealPrepHelpSeen` / `pantryOnboardingDone` /
`mealPrepWeekTemplate` precedent. A test asserts that neither `Object.keys(AppState)` nor the
persisted `mealPrepAppData` payload contains any alert/notification/announce field. This matters
beyond tidiness: every key added to `AppState` flows through `buildFirestorePayload()`, the union
merges and the tombstone machinery — the exact code this wave was scoped to stay out of. It is also
correct on the merits, since syncing "already told you" would let a phone silence a laptop.

**6. Permission hygiene.** `Notification.requestPermission()` appears exactly once in the codebase,
inside `toggleFoodAlerts()`, reachable only from the Settings row. A test asserts zero permission
requests after a cold load. Denial disables the row, relabels it "Blocked in browser settings" and
changes nothing else; a browser with no `Notification` object at all (iOS Safari in a tab) reads
"Not supported on this browser" and is inert. Both paths verified with the rest of the app still
rendering, the banner still showing and the Keep/Remove buttons still present.

**7. The `sw.js` change — the actual red-zone surface.** Additive only: one `notificationclick`
listener plus `CACHE` v4 → v5. The `install` / `activate` / `fetch` handlers are unchanged, so the
network-first app-shell strategy that makes deploys go live immediately is intact. The worker
registers no `push` handler and no `periodicsync` handler — it schedules and sends nothing, it only
routes a tap. The listener is guarded (`c.url.startsWith(self.registration.scope)`) and falls back
to `openWindow(scope)`. The cache bump is conventional here and clears stale v4 entries.

**8. Android Chrome constraint handled correctly.** Android Chrome throws on the page-side
`new Notification()` constructor and requires `registration.showNotification()`. The code prefers the
SW path via `getRegistration()` — deliberately not `serviceWorker.ready`, which never resolves when
no worker is registered and would have hung the promise on `file://` and in tests — and falls back
to the constructor only where there is no registration.

**9. Verification.** 27 new cases, all passing. Full suite 178 passed on the branch against a
151-passed baseline on `main@4de1512` — zero regressions. Two initial failures were my own test
fixtures, not app bugs (`instructions: []` where the app's schema wants a string, reproduced on
unmodified code; and an init-script ordering bug that wiped the ledger before a reload). Both fixed
in the fixtures; neither was masked.

### What I could NOT verify — the honest residual
**No real Android device was reachable from this environment.** `adb` is installed
(platform-tools 37.0.0) but reports zero devices attached and zero configured AVDs, and the session
is non-interactive so no device could be attached. Recorded as an owner/manual item rather than
silently skipped or claimed.

Post-deployment I ran the largest practical substitute — production smoke against the deployed
HTTPS site in Chromium with a real registered service worker and a genuinely granted notification
permission — which covers the same Blink service-worker code path Android Chrome uses. What that
substitute still cannot reach, and what the owner should check on a phone:

- **PWA install** from the Chrome menu on `shinyamadasan.github.io/Meal-Prep/`
- **The real OS permission prompt** — Chromium's `grantPermissions()` bypasses the UI
- **Tapping the notification in the Android tray** and confirming it focuses Meal Prep and lands on
  the Needs Attention card (the `notificationclick` → `postMessage` → `openAttentionView()` chain is
  smoke-verified as *wired*, but not tapped by a human thumb)
- **`navigator.setAppBadge()` on the launcher icon** — requires an installed PWA
- **Close/reopen with no notification arriving in between**, confirming the app never implies
  background push exists

### Risk-gate
**D-032 red zone → `approved`, not `done`.** `sw.js` is the offline-cache surface. Held; `main` was
not touched on Claude's judgement. Merged `--no-ff` only after the operator's explicit written
authorisation, with the real-device check recorded above as an outstanding manual item the operator
chose to accept rather than block on.

### Post-merge verification (filled in after deployment)
- Pages deployment `github-pages` **succeeded** for SHA `8fbf89d5edf685f45f590b6bc674ca8642c7efa3`,
  matching final `main`. Deployed bytes were fetched and checked directly, not assumed: `sw.js`
  carries the `notificationclick` handler and **no** `push` / `periodicsync` / `pushManager`;
  `app.js` carries all six new functions; `index.html` carries the Settings row and **no**
  `firebase-messaging` / `getMessaging` / `vapid`.
- Production smoke (`tests/production-smoke-attention-notifications.spec.js`): **9/9 headed**
  against the live site, with a real registered service worker and a browser-granted permission. It
  proves the SW `showNotification()` path is the one actually taken (the constructor path is
  asserted unused — that is the Android Chrome constraint), one grouped notification for five items
  spanning pantry AND cooked food, silence on unchanged food across three passes and a reload, and
  that no push subscription is ever created.
- Headless it reports **5 passed / 4 skipped** with an explicit reason. Headless Chromium
  hard-denies the Notifications permission regardless of `grantPermissions()`, so those four cases
  would have passed vacuously. Skipping loudly was chosen over a green tick that proves nothing;
  `npm run test:smoke:notifications` runs them headed for real coverage.
- Full suite on final `main`: **183 passed, 4 skipped, 0 failed**.

### Pre-existing CI condition — flagged, not absorbed
The "Button tests" workflow reports one failure per run, and did so **before** this wave: the
TASK-045 docs commit (run `32582675564`) failed on `ready-food-portions.spec.js:307`; this wave's
merge (run `32586471466`) failed on `production-smoke-ready-food.spec.js:212`. A different test each
time, neither touched by this wave, both passing locally. That is flaky CI — 30s timeout, 2 workers,
tests hitting the live site — not a regression introduced here. Deliberately left alone rather than
quietly folded into this wave; it deserves its own look.

→ TASK-046 status set to `approved` in TASKS.md before the merge, then `done` after deployment and
production smoke.

---
## Review TASK-045 — APPROVED (cook-path depletion tombstones, D-057 addendum) — owner-approved D-032 red-zone merge
branch: fix/cook-depletion-tombstones → main
verdict: approved — **red zone**, merged only on the operator's explicit written instruction
date: 2026-08-22

### The gate, stated plainly
This patch exists to write into `AppState.deletions`. Under D-032 that is **red zone**, not `done`,
regardless of how small the diff is — a broken UI change is reverted in a minute; lost user data
cannot be reverted at all (north-star goal #2). I recommended `approved` (held for a human) rather
than `done` (auto-merge), returned the branch unmerged and unpushed, and did not merge on my own
judgement. The operator then explicitly instructed: *"Owner approves fix/cook-depletion-tombstones @
163586a under D-032 … Merge the branch into current main with --no-ff."* That instruction is the
gate being satisfied — priority 1 in the CLAUDE.md Decision Priority list. Recorded here so the
audit trail shows a human, not Claude, released the red-zone work. **This was not an automatic
merge.**

### Context — Claude-implemented, human-directed
Implemented directly by Claude at the operator's explicit instruction rather than delegated to Codex
(CLAUDE.md Delegation Policy). This is a review of Claude's own work, stated plainly. The
independent evidence is the mutation check and the production smoke, which runs against the deployed
bundle rather than the working tree.

### What was reviewed
- `163586a` — explicit tombstones on the cook-depletion path, plus the new regression spec

### The bug, confirmed rather than assumed
`deductIngredientsForRecipe()` ended its depletion branch with a bare
`AppState.pantry.filter(...)` and no tombstone. The delete relied entirely on the vanish-diff in
`recordLocalDeletions()`, which returns early — recording **nothing** — when more than
`MASS_DELETE_GUARD` (5) ids disappear at once. So a cook that emptied six or more tracked pantry
items removed them locally with nothing to sync, and the next merge from another device resurrected
the food. This is exactly the failure D-057 designed the explicit-tombstone pattern to prevent for
bulk expired cleanup; the cook path was the one remaining consumer that had never been given it.

I verified the blast radius rather than trusting the brief: `deductIngredientsForRecipe()` has a
single call site (`_doMarkCooked()`), and `checkAndReplenishLowStock()` — the only thing running
between the deduction and `saveData()` — mutates `groceryList` only. No other cook-path helper
removes pantry records.

### Findings

**1. The mechanism was USED, not CHANGED — again the whole review.**
The new code writes `AppState.deletions[String(id)] = now`, filters, then calls
`snapshotIdBaseline()`. That is byte-for-byte the sequence `removeAllExpired()` and
`unstockPurchasedGroceryItem()` already perform on `main`. No new deletion mechanism. A grep of the
diff confirms zero edits to `TOMBSTONE_KEYS`, `MASS_DELETE_GUARD`, `recordLocalDeletions()`,
`snapshotIdBaseline()`, `collectSyncedIds()`, `mergeDeletions()`, `applyTombstones()`,
`purgeOldTombstones()`, `saveData()`, `saveToFirestore()` or the `cloudReady` write guard.

**2. Hard Rules hold — verified against the diff.**
- **HR3 (quote recipe ids in handlers)** — no handler markup in the diff; untouched.
- **HR4 (`patchMissingNutrition()` after load)** — zero occurrences; untouched.
- **HR5 (persist through `saveData()`)** — no `saveToLocalStorage` in the added lines. The
  function does not persist at all; its single caller `_doMarkCooked()` still ends in `saveData()`,
  unchanged.
- **HR6 (never write Firestore before reading it)** — zero hits for `cloudReady` /
  `saveToFirestore`; the write guard is not touched.
- **HR7 (one `:root` block)** — `style.css` not in the diff.
- **HR9 (match existing style)** — plain `var`, `function(){}` callbacks, no framework, no build
  step, matching the surrounding file.
- **HR10** — not applicable; not a chained sprint group.

**3. Save/snapshot ordering preserved.** Tombstone → remove → `snapshotIdBaseline()`, all before
the caller's existing `saveData()`. The re-baseline moved inside the deduction rather than sitting
at the call site, which is what `removeAllExpired()` does at its own equivalent point; it is
recorded as a risk below.

**4. The blast radius really is limited to emptied records.** Only ids pushed into `depleted` —
records whose quantity reached `<= 0` — are tombstoned. A partially depleted item keeps its
record, its (correct) reduced quantity and gets no tombstone; that is asserted in two separate
tests, one of them with a ×2 multiplier so the scaling path is covered too.

**5. One incidental change, called out because it is not cosmetic.** The pantry filter now keys on
`String(p.id)` against a lookup object instead of `depleted.indexOf(p.id)` identity. This is
deliberate — it matches how the tombstone map itself is keyed, so the set of records removed and
the set of ids tombstoned cannot diverge on a numeric-vs-string id. Strictly more inclusive than the
previous check, and the ids come from the same objects either way.

**6. The tests are not vacuous, and that was proven rather than asserted.** Mutation check: `app.js`
reverted to `main`'s version, spec re-run → **9/9 failed**, the end-to-end resurrection case
failing with `Expected: 0, Received: 6`, which is the production bug reproduced exactly. Fix
restored and re-verified. The 6-item test also carries a **control arm**: the same six ids removed
naively, then `recordLocalDeletions()` called → zero tombstones, proving both that the guard really
does swallow this size of delete and that the fix does not depend on the diff.

**7. A docs/code disagreement resolved in the code's favour.** `planning/ROADMAP.md` Known Issues
listed this as an open defect and D-057 recorded it as a deliberate follow-up. Both are now false;
the ROADMAP entry is removed and D-057 carries an addendum closing it.

### Risks accepted, on the record
- `snapshotIdBaseline()` now fires inside the deduction rather than at the call site. If a future
  edit puts a *different* real pantry deletion between `deductIngredientsForRecipe()` and
  `saveData()` without its own tombstone, that one would be re-baselined away. Same exposure
  `removeAllExpired()` already carries; no current caller does this.
- Existing tombstone LWW still applies: an item re-added on another device with an `updatedAt` newer
  than the cook survives. By design, unchanged by this patch.

### Verdict
**Approved**, and merged to `main` with `--no-ff` on the operator's explicit red-zone
authorisation. `wave1-portion-truth` untouched at `88b5598`.

---
## Review TASK-044 — APPROVED (kitchen-truth wave, D-057) — owner-approved D-032 red-zone merge
branch: wave-kitchen-truth → main
verdict: approved — **red zone**, merged only on the operator's explicit written instruction
date: 2026-08-22

### The gate, stated plainly
Under D-032 this wave is **red zone**, not `done`. It adds a bulk-delete path and writes tombstones
into `AppState.deletions`. A broken UI change is reverted in a minute; lost user data cannot be
reverted at all (north-star goal #2). I recommended `approved` (held for human merge) rather than
`done` (auto-merge), and did not merge on my own judgement. The operator then explicitly instructed:
*"Approve and merge wave-kitchen-truth into current main with --no-ff … as an explicitly
owner-approved D-032 red-zone merge."* That instruction is the gate being satisfied — priority 1 in
the CLAUDE.md Decision Priority list. Recorded here so the audit trail shows a human, not Claude,
released the red-zone work.

### Context — Claude-implemented, human-directed
Implemented directly by Claude at the operator's explicit instruction rather than delegated to Codex
(CLAUDE.md Delegation Policy). This is a review of Claude's own work, stated plainly. The independent
evidence is the test suite — in particular the production smoke, which runs against the deployed
bundle rather than the working tree.

### What was reviewed
- `0ccb16d` — grocery→inventory transfer, safe merge, attention model, expired cleanup, docs
- `d465f1e` — pre-merge verification: bulk-control tap target, keptOn lifecycle regression lock

### Findings

**1. Hard Rules hold — each verified against the diff, not assumed.**
- **HR3 (quote recipe ids in handlers)** — the two new inline handlers build their arguments as
  `var args = '\'' + e.kind + '\', \'' + escJ(String(e.id)) + '\''`, so both the kind and the id are
  single-quoted and `escJ`-escaped. `removeAllExpired()` takes no arguments.
- **HR4 (`patchMissingNutrition()` after load)** — zero occurrences in the diff; untouched.
- **HR5 (persist through `saveData()`)** — zero occurrences of `saveToLocalStorage` in the added
  lines. Every new mutator (`toggleGroceryItem`, `keepAttentionItem`, `removeAttentionItem`,
  `removeAllExpired`) ends in `saveData()`.
- **HR6 (never write Firestore before reading it)** — a grep of the diff for `cloudReady`,
  `saveToFirestore`, `saveData` (definition), `mergeCloudConflict`, `unionByIdLWW`,
  `applyTombstones`, `recordLocalDeletions` and `MASS_DELETE_GUARD` returns **nothing**. The write
  guard is not touched.
- **HR7 (one `:root` block)** — `style.css` still has exactly one, at line 1.
- **HR9 (match existing style)** — plain top-level functions, imperative `render*()`, no framework,
  no build step, no module system.
- **HR10** — not applicable; this was not a chained sprint group.

**2. The tombstone mechanism was USED, not CHANGED — and that distinction is the whole review.**
The brief said to stop and report before altering tombstone architecture. Nothing in that
architecture moved. What the new code does is write `AppState.deletions[id] = now` and then call
`snapshotIdBaseline()` before dropping records — which is **exactly** what `deleteSelectedPantryItems()`
(`main:app.js:8326`) and `clearExpiredPantryItems()` (`main:app.js:8352`) already did before this
wave. I verified those two call sites exist on `main` rather than taking the pattern on trust.

This matters because the naive implementation is silently broken: `recordLocalDeletions()`
deliberately ignores more than `MASS_DELETE_GUARD` (5) simultaneous disappearances as a suspected
load race. A nine-item cleanup relying on the vanish-diff would record **zero** tombstones and
another device would resurrect the food on the next merge. The bulk test seeds six expired pantry
items specifically to cross that threshold and asserts a tombstone for every removed id.

**3. The data-safety constraint was honoured.** No new top-level `AppState` collection. Three
additive fields on existing objects: `pantry[].keptOn` / `cookedMeals[].keptOn`,
`groceryList[].userSet`, `groceryList[].stocked`. All three ride the existing generic round-trip
through localStorage, `buildFirestorePayload()`, backup, export/import and the union merges with no
registry edit. A test asserts the Firestore payload's top-level key set is unchanged.

**4. Two judgement calls I want on the record, because both could have gone the other way.**

*Merge date.* On an accepted merge the code deliberately does **not** rewrite `purchaseDate`.
Stamping today is the obvious implementation and is quietly destructive — six-day-old chicken becomes
fresh chicken the moment you buy more, and the freshness system stops being trustworthy. Keeping the
older date under-claims freshness for the new stock, which is visible and self-correcting;
over-claiming is invisible. Refusing to merge into an already-expired record follows from the same
reasoning taken one step further: there is no date to keep that would be honest.

*Keep.* The brief permitted omitting Keep if it could not be built without asking for a new date, and
it cannot — the app has no way to know the real remaining life of food someone has just eyeballed. So
Keep touches no dates: it writes `keptOn = todayISO()` and suppresses the record from the attention
surfaces for that day. Because `isKeptToday()` is a strict equality against `todayISO()`, the
suppression lapses on its own at midnight; it is an acknowledgement, not a dismissal. Verified by a
regression test that advances the wall clock via `page.clock.setFixedTime()`, and **mutation-checked** —
replacing `isKeptToday()` with permanent suppression fails that test, so the coverage is not vacuous.

**5. Two real defects were found and fixed during verification, not waved through.**
- `getExpiredPantryItems()` matched on `item.expiryDate` alone while every badge computes freshness
  through `pantryDaysLeft()`. Bought-date items — the common case — never matched, so the Inventory
  "Clear expired" button stayed hidden while the banner directly above it read "2 expired". A bulk
  cleanup that existed and could not fire. Now classifies through `pantryDaysLeft()`.
- The bulk **Remove expired (N)** control inherited `.dash-l1-cta`, a `padding: 0` text link, and
  shipped at **12px tall** on a phone — a hairline tap target for the most destructive action in the
  wave. Caught by the mobile smoke, fixed, and regression-locked: the committed mobile test now
  asserts every Keep / Remove / Remove-expired control meets 30×44px and sits inside the viewport.

**6. A docs/code disagreement was resolved in the code's favour, then the docs corrected.**
`docs/FEATURES.md` already listed "Grocery → Pantry auto-transfer on check (with undo)" as *Working*.
It did not exist: `toggleGroceryItem()` flipped a flag, never wrote to `AppState.pantry`, and never
called `saveData()` — so the tick did not even survive a reload. The feature now matches its
long-standing description.

### Follow-ups recorded, deliberately NOT fixed here
Both are logged in `planning/ROADMAP.md` Known Issues rather than silently absorbed:
1. **`deductIngredientsForRecipe()` removes depleted pantry items without explicit tombstones**,
   relying on the vanish-diff. Depleting more than five tracked items in one cook records no
   tombstones and lets another device resurrect them. Same fix pattern as above, but it sits on the
   cook path, not the inventory path — out of this wave's scope.
2. **The grocery row is a ~33px tap target on phones** (pre-existing `.grocery-item` padding under the
   narrow breakpoint, untouched by this wave). D-057 promoted that row to the primary inventory-write
   interaction, so it now carries more weight than it did.

### Verdict
**Approved**, and merged to `main` with `--no-ff` on the operator's explicit red-zone authorisation.
Tests: 127 passed (100 pre-existing unchanged, 27 new). `wave1-portion-truth` untouched at `88b5598`.

---

## Review TASK-043 — APPROVED (ready-food-first wave, D-056)
branch: wave-ready-food-first → main
verdict: approved — merged to `main` as `352a799` (`--no-ff`), deployed and re-verified live
date: 2026-08-22

### Context — Claude-implemented, human-directed
Implemented directly by Claude at the operator's explicit instruction rather than delegated to
Codex (CLAUDE.md Delegation Policy). This is therefore a review of Claude's own work, stated
plainly. The independent evidence is the test suite — in particular the production smoke, which
runs against the deployed bundle rather than the working tree.

### What was reviewed
- `8ea8519` — portion fields, normalizer, capture UI, one-tap use, Home ready-food card
- `3599ba3` — `.gitignore` entry resolving the automation blocker
- `352a799` — the merge commit

### Findings

**1. Hard Rules hold.**
- **HR3 (quote recipe ids in handlers)** — new inline handlers pass cooked-meal ids, all quoted
  and `escJ`-escaped: `useCookedPortion('...')`, `finishCookedMeal('...')`. The pre-existing
  `removeCookedMeal` handler was also switched to `escJ` in passing, which is strictly safer.
- **HR4 (`patchMissingNutrition()` after load)** — untouched.
- **HR5 (persist through `saveData()`)** — `useCookedPortion()` calls `saveData()`;
  `finishCookedMeal()` delegates to `removeCookedMeal()`, which already did. No direct
  `saveToLocalStorage()` anywhere in the new code.
- **HR6 (never write Firestore before reading it)** — `saveToFirestore()` and its `cloudReady`
  guard are not touched by this wave.
- **HR7 (one `:root` block)** — `style.css` still has exactly one, at line 1.
- **HR9 (match existing style)** — plain top-level functions, imperative `render*()`, no
  framework or build step.

**2. The data-safety constraint was honoured.** The brief said to prefer additive fields on
existing `cookedMeals` objects, avoid new top-level state, and stop and report before adding one.
None was added. `cookedMeals` already round-trips generically, so **no sync registry was edited**
— verified by diffing the registry call sites. The Firestore payload, localStorage record, backup
snapshot, export and import union all carry portions with no code change.

**3. Normalization coverage is complete, and that mattered.** `cookedMeals` had no normalizer at
all before this wave. All **six** assignment sites are now covered — including the live cloud
listener, which is easy to miss because it sits far from the other five and is the path a second
device takes. A `grep` for `AppState.cookedMeals = ` shows every remaining assignment is either
normalized or the deletion filter.

**4. Legacy behaviour is preserved and tested, not assumed.** A cooked meal saved without portion
fields loads, normalizes to `{initialPortions: null, portionsRemaining: null}`, renders with no
portion badge and no `Used 1`, and keeps its pre-existing `Done` button. Asserted both locally and
against the deployed build.

**5. The UX constraint is enforced by assertion, not by claim.** The brief's most important rule
was that using stored food should require one tap. Two tests assert
`document.querySelectorAll('.modal:not(.hidden), .confirm-overlay').length === 0` immediately
after the tap — so a future change that introduces a confirmation dialog will fail the suite.

**6. Zero/finished behaviour reuses the existing path.** The last portion routes into
`removeCookedMeal()` rather than introducing an archive flag or a second deletion concept. That
keeps one tombstone behaviour instead of two, which is the right call in a codebase whose worst
historical incidents were sync/deletion bugs. Negative portions are impossible: guarded at the
decrement (`next <= 0` finishes) and again in the normalizer.

**7. Refusing to suggest expired food is a correctness decision, not a nicety.**
`getReadyFoodSuggestions()` excludes batches past their date. The freshness banner still flags
them for disposal, so nothing is hidden — but the app will not tell someone to eat spoiled food.
Tested on both the local and deployed builds.

**8. No Landers special-casing.** The end-to-end test asserts the stored object's exact key set
after the full workflow, so a future shortcut that smuggles in a bespoke field would fail.

**9. The automation blocker was resolved conservatively.** `recipe-request.json` was investigated
before action: zero references repo-wide, never tracked on any branch, created the day the
recipe-import Worker was hand-built. It was **ignored rather than deleted** — the 2026-08-21
recovery sweep audited every untracked file and left this one, so it may still be a manual test
payload. The rule is root-anchored (`/recipe-request.json`) and verified to newly ignore exactly
one path. Reversible; deletion would not be.

### Risk gate (D-032)
Landed as **`done`**, not held at `approved`. Justification: no red-zone surface is touched — no
Firestore write/read-guard code, no `saveData()` internals, no tombstone/merge-deletion machinery,
no auth, no `:root`, no AI Dev OS files. The change is two optional fields on an existing synced
collection plus UI, and the one behavioural change to deletion is *delegation to the existing
path*, not a new one. The operator also gave an explicit merge instruction (Decision Priority 1).

`wave1-portion-truth` — the genuinely red-zone sibling — remains parked and untouched.

### Verification evidence
- `npx playwright test tests/` → **100/100 pass** on merged `main` (18 spec files)
- Pages build `352a799` = `built`, 35.8s, `2026-08-22T06:51:22Z`
- Live `app.js` contains `normalizeCookedMeal`, `useCookedPortion`, `getReadyFoodSuggestions`,
  `renderReadyFoodCard`, `readyFoodBucket`, `portionsRemaining`; live `index.html` contains
  `manual-cooked-portions`
- `tests/production-smoke-ready-food.spec.js` → **8/8 against the deployed site**
- `git ls-remote origin refs/heads/main` → `352a799`
- `git status --porcelain` → empty (the automation preflight condition)

### Must-fix
None.

### Follow-ups (not blocking)
1. `_doMarkCooked()` still does not call `stampUpdated()` on the batch it creates, so
   recipe-cooked batches carry no `updatedAt` and lose tombstone LWW against a stale tombstone.
   Pre-existing; deliberately not fixed here because it is sync-adjacent and this wave was scoped
   away from it. Deserves its own small task.
2. Portions count meals, not mass — two people eating one batch at different rates will drift
   from the number on the card. Accepted; per-person servings is exactly what the parked
   `wave1-portion-truth` does.
3. Moving a batch fridge → freezer keeps its portions correctly but restarts freezer life from
   the original `cookedDate`. Pre-existing freshness behaviour, unchanged by this wave.
4. Two of my own earlier tests froze a cooking-hack count at 13 and broke when a 14th was added.
   Both now derive the count from `defaultCookingHacks.length`. Worth watching for the same
   pattern elsewhere — a frozen count is a test that will fail on unrelated growth.
5. `wave1-portion-truth` still needs a merge/rework/abandon decision; it claims D-054 and
   abandoning it leaves a permanent gap in the decision log.

### Note on direction
The operator has re-pointed the roadmap away from the full "What should we eat?" engine toward
**keeping grocery/fridge inventory truthful with almost no maintenance**. That is the right read:
`getCookableRecipes()`, the expiry scan and this wave's ready-food ranking all degrade quietly
when the pantry drifts from reality, so inventory truth is load-bearing for everything already
shipped. No design work has been done on it; it needs its own brief.

---
## Review TASK-042 — APPROVED (low-effort cooking wave, D-055)
branch: wave-low-effort-cooking → main
verdict: approved — merged to `main` as `944c8b0` (`--no-ff`) after verification, deployed and re-verified live
date: 2026-08-21

### Context — Claude-implemented, human-directed
This wave was implemented directly by Claude at the human operator's explicit instruction, not
delegated to Codex (CLAUDE.md Delegation Policy: "explicitly requested by the human"). The brief,
the scope boundaries and the merge instruction all came from the operator. This entry is therefore
a review of Claude's own work — stated plainly rather than dressed up as an independent gate. The
strongest independent evidence here is the test suite, and specifically the fact that the
edit-preservation tests were proven to fail against the pre-fix code.

### What was reviewed
- `eb23227` — low-effort metadata, discovery chips, Home suggestions, hacks, `NaN min` fix
- `32d01b8` — `saveRecipe()` edit-path preservation fix + D-054 → D-055 renumber
- `944c8b0` — the merge commit

### Findings

**1. Hard Rules hold.**
- **HR3 (quote recipe ids in handlers)** — new inline handlers are `setRecipeQuickFilter('<slug>')`
  and the existing `openRecipeFromHome('${escJ(sid)}')` / `planRecipeForToday('${escJ(sid)}')` in
  the suggestion card. Ids are quoted and `escJ`-escaped. Correct.
- **HR4 (`patchMissingNutrition()` after load)** — untouched; `normalizeRecipeMeta()` was added
  *inside* `normalizeRecipes()`, which `patchMissingNutrition()` already calls first, so every
  existing load path picks up the new defaults without a new call site.
- **HR5 (persist through `saveData()`)** — the only new mutator, `saveRecipe()`, still routes
  through `persistRecipe()` → `saveData()`. `seedNewDefaultHacks()` deliberately does NOT save;
  it mutates in-memory and lets the next ordinary `saveData()` carry it.
- **HR6 (never write Firestore before reading it)** — `saveToFirestore()` and its `cloudReady`
  guard are not touched by this wave at all.
- **HR7 (one `:root` block)** — `style.css` still has exactly one, at line 1. The two other grep
  hits are prose inside comments.
- **HR9 (match existing style)** — no framework, no build step, no module system; plain top-level
  functions and imperative `render*()`, consistent with the surrounding file.

**2. The data-safety constraint was honoured.** The brief said to prefer fields on existing recipe
objects and to stop and report before adding any new top-level `AppState` key. No new top-level key
was added. Recipes already round-trip generically through `saveToLocalStorage()`,
`buildFirestorePayload()`, `snapshotData()`, `exportData()` and the import `unionById()` merge, so
the new fields sync for free and **no sync registry was edited**. The one new piece of state — the
active filter chip — is a module-level `var` precisely because it is view state that must not
persist or sync.

**3. Backwards compatibility is tested, not assumed.** A recipe object carrying none of the new
fields loads, normalizes to empty defaults, and renders with **no metadata strip at all**
(`low-effort-metadata.spec.js`). The weekly-plan slot shape is unchanged and asserted to still be
a bare string id in `low-effort-discovery.spec.js`.

**4. The `NaN min` fix is complete, not partial.** The brief explicitly said not to fix only some
call sites. All 10 occurrences of the `basePrepTime || prepTime` / `baseCookTime || cookTime`
pattern were replaced: edit-form population (×2), the recipe-list time filter, recipe-card totals
(×2), the card's scaled base annotations (×2), the planner slot, the recipe-selection card, and
week stats (×2). A `grep` for the old pattern now returns only the explanatory comment. Regression
coverage asserts the whole rendered page contains no `NaN`.

**5. The `saveRecipe()` fix is narrow and its tests are not vacuous.** The fix changes one object
construction — an edit now starts from the existing recipe and overlays form-owned fields — and
does not refactor the recipe model. Crucially, the fix was **reverted and the new suite re-run**:
4 of 5 tests failed against the old code and all 5 pass against the new. The fifth
(`adding a brand-new recipe is unaffected`) passes both ways by design, guarding against
over-applying the merge to the create path. Behaviour deliberately preserved: the form stays
authoritative for what it owns (clearing an input still clears), emptying all four nutrition
inputs still clears nutrition, and a new recipe inherits nothing.

**6. Suggestion logic refuses to guess.** `getCookSuggestions()` omits a category rather than
filling it: "Something different" requires a non-empty `cookHistory`, and "Easiest" is dropped
when the easiest available recipe is still normal-effort. Verified by a dedicated test that
asserts `renderCookSuggestionCard()` returns an empty string rather than an empty shell.

**7. One design flaw was found and fixed during the wave, by screenshot.** The first cut ranked
"Easiest" before "Use soon", so a recipe that was both got labelled with the weaker reason and the
expiring-ingredient prompt vanished. Claim order is now use-soon → easiest → different while
*display* order is pinned to easiest → use-soon → different, so food about to spoil wins a
contested recipe but the card does not reshuffle between visits.

### Risk gate (D-032)
Landed as **`done`**, not held at `approved`. Justification: this wave touches no red-zone surface
— no Firestore write/read-guard code, no `saveData()` internals, no tombstone/merge-deletion
machinery, no auth, no `:root` block, no AI Dev OS files. It is additive recipe fields plus UI, and
the one behavioural fix (`saveRecipe`) strictly *reduces* data loss. The operator additionally gave
an explicit merge instruction, which is Decision Priority 1.

The genuinely red-zone sibling work (`wave1-portion-truth`) was **not** merged and remains parked.

### Verification evidence
- `npx playwright test tests/` → **74/74 pass** on merged `main` (15 spec files; button smoke
  471 in DOM / 199 clicked / 0 broken)
- Pre-fix revert check → 4/5 edit-preservation tests fail, confirming they bite
- `gh api repos/shinyamadasan/Meal-Prep/pages/builds/latest` → `built`, commit `944c8b0`,
  duration 37.7s, `2026-08-22T03:41:26Z`
- `curl https://shinyamadasan.github.io/Meal-Prep/app.js` → contains `RECIPE_EQUIPMENT`,
  `renderRecipeQuickFilters`, `getCookSuggestions`, `recipeCookMinutes`, `seedNewDefaultHacks`,
  and the new `Object.assign({}, existingRecipe, formFields)` merge
- `tests/production-smoke-low-effort.spec.js` → **6/6 against the deployed site**: vocabularies
  live, filters narrow correctly, Home suggestions render in fixed display order, all 13 hacks
  present, edit preservation holds, no `NaN` on any tab (both with the real seeded samples and
  with a planted zero-cook-time recipe)
- `git ls-remote origin refs/heads/main` → `944c8b0`

### Must-fix
None.

### Follow-ups (not blocking)
1. `recipeEffortScore()` infers effort from active time when `effort` is unset; a long recipe with
   a short hands-on phase reads as harder than it is until the field is filled in. Accepted
   deliberately — the alternative was excluding unlabelled recipes from discovery entirely.
2. `seedNewDefaultHacks()` writes to `customHacks`, a synced and tombstoned list. Additive-by-id,
   never overwrites an edited copy, leaves a deliberately-emptied list alone, and runs before
   `applyTombstones()` / `snapshotIdBaseline()`. Residual: a hack deleted >180 days ago could
   reappear once its tombstone is purged.
3. The production smoke filters a `requestStorageAccess: Permission denied` console error emitted
   by the real Firebase SDK under Chromium's headless storage partitioning. It is environmental,
   not app code — but the filter is a place a genuine error could hide, so it is scoped to that
   exact string.
4. Decide the fate of `wave1-portion-truth` (`88b5598`). It claims D-054; this wave took D-055 to
   avoid the collision. Abandoning it leaves D-054 as a permanent gap in the decision log.

---
## Review TASK-041 — APPROVED (recipe URL import, retroactive red-zone review)
branch: release/recipe-url-import-clean → main
verdict: approved — merged to `main` as `f0c0ffa` after verification
date: 2026-08-21

### Context — this is a retroactive review, and that matters
The recipe URL import feature did not come through the pipeline. It was built by the human
operator on 2026-08-09 in a separate worktree and pushed directly to `main` (`9007d4e`), which
means **it has been live on GitHub Pages since 2026-08-09 without ever having been reviewed**.
This entry does not pretend otherwise. The review below was performed on 2026-08-21, twelve days
after the code reached production, as part of a repository recovery. See TASK-041.

Two further pieces of the same work had never been committed at all: production-polish changes and
a test file sitting uncommitted in the release worktree. Those are now `c01206a` and `f0c0ffa`.

### What was reviewed
- `9007d4e` — recipe URL import MVP (app UI, normalization, save path, Cloudflare Worker)
- `c01206a` — null-safe nutrition display + ordered instruction steps
- `f0c0ffa` — red-zone test coverage + two existing suites updated to match shipped behaviour

### Findings

**1. Hard Rules hold.** Checked each surface the feature touches:
- **HR5 (persist through `saveData()`)** — imports land via `saveCurrentRecipeImportDraft()` →
  `persistRecipe()` → `saveData()`. No direct `saveToLocalStorage()` call anywhere in the import
  path. Correct.
- **HR6 (never write Firestore before reading it)** — `saveToFirestore()`'s `cloudReady` guard is
  untouched by this work; the early-return at the top of the function is intact. Correct.
- **HR4 (`patchMissingNutrition()` after load)** — still called on all eight load paths, including
  the cloud-load paths. Imported recipes carrying partial nutrition go through the same patch.
- **HR3 (quote recipe ids in handlers)** — imported recipes get `id: Date.now()` (a number), which
  makes quoting *more* important, not less. Handlers use `'${recipe.id}'`. Correct.
- **HR7 (one `:root` block)** — `style.css` still has exactly one, at line 1.
- **HR9 (match existing style)** — no framework, no build step, no module system introduced. The
  Worker is a separate deployable under `workers/`, not a change to the app's architecture.

**2. The Worker is a sensible trust boundary.** `workers/recipe-import/src/index.js` rejects
non-POST methods, rejects credentialed URLs (`url.username || url.password`), blocks local/internal
targets, caps redirects and response size, and enforces a timeout — i.e. it treats SSRF as the
primary risk, which is the right call for a "fetch an arbitrary URL for the user" service. CORS in
`wrangler.jsonc` is pinned to `https://shinyamadasan.github.io` rather than `*`. No secrets or API
keys in the Worker source or config.

**3. Imported data is treated as hostile.** `recipe-import-s6-verification.spec.js` and the new
`recipe-import-production-polish.spec.js` both assert that imported markup renders as inert text —
including an `<img src=x onerror=alert(1)>` payload, which is asserted to produce zero `img`
elements and zero dialogs. This is the correct posture given TASK-039 fixed a confirmed XSS in
`openPrepMode()`.

**4. The polish commit fixes a real data-shaped bug.** Before `c01206a`, a recipe imported with
partial nutrition (calories/protein/carbs/fat but no fiber/sodium) computed
`undefined * currentServings` → `NaN`, which rendered as "NaN" on the card and, worse, poisoned
every aggregate that summed it (`calculateDayNutrition`, the weekly totals) into `NaN`.
`scaleKnownNutrition()` now returns `null` there, so the card shows an em dash and the aggregates
degrade to skipping the value.

**5. Tests were strengthened, not weakened.** Worth stating explicitly since two existing suites
were modified:
- `buttons-functional.spec.js` — the old "Paste Recipe: opens and cancels" test named a button that
  no longer exists (it is now "Import Recipe"). The replacement drives both From URL and Paste Text
  modes and asserts more than the version it replaces.
- `button-smoke.spec.js` — skips the two buttons that open a *native OS file chooser*
  (`importData`/`importCSV`), which Playwright cannot dismiss and which hang the run. The skip is
  narrow, counted, and printed in the summary. Everything else is still clicked: 471 buttons in
  DOM, 199 clicked, 0 broken.

### Verification
- `npx playwright test` → **45/45 passed** (11 spec files)
- `node --test workers/recipe-import/test/*.node.js` → **9/9 passed**
- Both re-run on the merged `main` (`f0c0ffa`) before pushing, not only on the release branch.
- Worker liveness probed directly: `OPTIONS` → 204 with
  `Access-Control-Allow-Origin: https://shinyamadasan.github.io`; `GET` → 405.
- Deployment confirmed, not assumed: Pages build `f0c0ffa` reported `built`, and the live
  `app.js` / `style.css` were re-fetched and contain the new code.

### Risk-gate
Red-zone under **D-032** — this touches the recipe save path, localStorage persistence, and the
normalization applied to loaded data. Under normal operation this would land as `approved` and wait
for a human `/merge`.

It was merged during this session because the operator explicitly directed the recovery through to
a merge, *and* because the code was already in production and had been since 2026-08-09 — holding
the branch would not have made the live site any safer, while landing it added the polish fix and
the first real test coverage of these paths. The merge was a fast-forward onto `origin/main`
(`9007d4e` → `f0c0ffa`); no force-push, no rewritten history.

### Residual risk
- Aggregate nutrition totals now silently under-count a recipe with partial nutrition instead of
  showing `NaN`. Better, but still not *honest* — the weekly total gives no hint that a value was
  missing. Carried as a follow-up on TASK-041.
- The Worker is a live production dependency with no monitoring or alerting wired to it. If it goes
  down, URL import degrades to an error message (handled — `recipe-import-ui.spec.js` covers it),
  but nobody is notified.
- No manual on-device check was performed against a real recipe URL end-to-end; all import testing
  used mocked Worker responses plus the Worker's own unit tests.

---


## Review TASK-040 — APPROVED, HELD (fix pre-existing TASK-036 test regression)
branch: task-040
verdict: approved (held per this session's convention; test-fixture-only, arguably Low risk)

### Context
`TASK-037`'s auto-merge gate failed `npm test` — not from anything TASK-037 touched, but from a
pre-existing gap: `TASK-036` converted `clearGroceryList()` to the non-blocking
`showConfirmDialog()`, and `tests/buttons-functional.spec.js`'s "Clear All empties the list" test
still listened for a native browser `dialog` event that no longer fires there. Already flagged as
a known issue in `TASK-035`'s review nits ("carry it as an open item"); this blocks every future
task's auto-merge until fixed, so fixing it now rather than deferring further.

### Findings
**1. Root cause confirmed by reproducing the original failure first.** Checked out `task-037`,
ran the full suite, reproduced the exact failure: `.confirm-overlay` left un-clicked,
`#grocery-list` still contained the test item after "Clear All." Confirmed via `grep` that no
other test in the suite relies on a native dialog event for any of the ten call sites `TASK-036`
converted — `button-smoke.spec.js`'s dialog listener is a global dismiss-only safety net, harmless
either way.

**2. Fix is minimal and correct.** Two-line change: click `.confirm-ok-btn` (the custom dialog's
own confirm button, matching `showConfirmDialog`'s DOM structure) instead of registering a native
dialog handler that no longer fires.

**3. Verification.** Targeted test passes (was failing before). Full suite re-run: 21/21 passed —
confirms the fix doesn't affect anything else and the suite is genuinely green again.

### Risk-gate
Test-fixture-only — no production code touched, no data/sync/security surface. Reasonable case for
`done` (Low risk, reversible), but held at `approved` anyway per this session's established
practice of never self-merging Claude-direct work, however small.

→ TASK-040 status set to `approved` in TASKS.md. Land with `/merge TASK-040` then
`/merge TASK-040 yes`.

## Review TASK-036 — APPROVED, HELD (Replace native confirm() with showConfirmDialog())
branch: task-036
verdict: approved (red-zone: clearLocalStorage() touches tombstone/Firestore machinery — held for human `/merge`)

### Guardian Gauntlet

Both specialists ran as read-only advisors. Neither was permitted to edit or write any file.

**security-guardian — ran, TASK-036 scope: CLEAN**

Traced all ten call sites for XSS, secret leakage, and async-callback timing issues:

- `restoreBackup()`: `backup.at` is normalized through `toLocaleString()` (runtime output, not a raw passthrough) then wrapped in `escapeHtml()` before interpolation into `bodyHtml`. `backup.label` is always written by `createBackup()` with hardcoded literals and is also `escapeHtml()`-wrapped. `title` and button labels are string literals. CLEAN.
- `clearDay()`: `day` comes from `['Monday'…'Sunday']` literals in `renderWeeklyPlanner()` — not user-controlled. `escapeHtml(day)` is applied anyway. CLEAN.
- All other eight sites pass only static string literals for all four parameters. CLEAN.
- Async callback in `clearLocalStorage()`: `showConfirmDialog` removes the overlay on the first ok-button click before calling `onConfirm`, preventing double-invocation. `await saveToFirestore()` inside the async callback preserves the pre-change ordering (local write → cloud write → reload). No race condition introduced. CLEAN.
- No credentials, tokens, or PII in the diff.

Pre-existing finding flagged by the guardian (NOT introduced by TASK-036, NOT a blocker for this task):
> `recipe.currentServings` is interpolated raw into `innerHTML` at `app.js:7704` (`markRecipeCooked` flow, a pre-existing `showConfirmDialog` call site not touched by this task). Severity: Medium (requires same-origin write access as a precondition). Recommended fix: coerce to `Number()` in `normalizeRecipes` or wrap in `escapeHtml(String(...))` at the injection site. Track as a follow-on bug.

**quality-guardian — ran, ALL criteria CONFIRMED**

Traced criterion by criterion:

1. **All ten call sites converted** — MET. Confirmed by diff inspection: `restoreBackup`, `clearLocalStorage`, `deleteRecipe`, `clearDay`, `clearWeeklyPlan`, `clearGroceryList`, `deleteIngredient`, `deleteHack`, `loadWeekTemplate`, `deleteUserIngredient`. Grep for `confirm(` on task-036 returns zero matches (case-sensitive; `onConfirm()` does not match). ✓

2. **No destructive action fires without confirm button** — MET. `showConfirmDialog` only calls `onConfirm()` inside the `.confirm-ok-btn` click handler. Cancel calls only `close()`. Backdrop click calls only `close()`. `onConfirm` is never called at construction time. For all ten callbacks, every state mutation and every `saveData()`/render call is inside the callback. ✓

3. **Confirmation message text preserved** — MET. All ten messages carry the same semantic content as the originals, adapted to title/body/button-label shape. `\n\n` separators become `<p>` elements, which is a rendering improvement (proper spacing vs. literal newlines in a native dialog) not a content change. ✓

4. **Call pattern matches existing `showConfirmDialog` usage** — MET. All ten call the function with the same five positional arguments `(title, bodyHtml, confirmLabel, cancelLabel, onConfirm)` as the pre-existing JSON-import and `addToPantry` sites. ✓

5. **Constraints (mechanical change only)** — MET. No logic altered in any of the ten actions. `clearGroceryList()` omits `saveData()` both before and after the change — pre-existing omission, not a regression introduced here. ✓

6. **Test steps** — all pass per CHANGELOG/TEST_REPORT: `node --check` ✓, zero `confirm(` matches ✓, smoke + button-smoke 2/2 ✓, npm test 21/21 ✓, code-trace of Cancel/Confirm for all ten flows ✓.

### Findings summary

No must-fix items. No REWORK.

**Nit (pre-existing, carry forward as a separate task):** `clearGroceryList()` does not call `saveData()` — the cleared list does not persist to cloud for signed-in users until the next event that triggers a save. Pre-existing on `main`; out of scope for this task.

**Follow-on task (from security-guardian, medium severity, not a blocker here):** `recipe.currentServings` raw in `markRecipeCooked`'s `showConfirmDialog` bodyHtml at app.js ~7704. Should be wrapped in `escapeHtml(String(Number(...)))` or coerced in `normalizeRecipes`.

### Risk-gate

The change is a UI delivery mechanism swap — native browser dialog → custom modal overlay. The underlying destructive logic in all ten callbacks is byte-for-bit identical to what it was before. However, `clearLocalStorage()` — one of the ten — explicitly touches the tombstone-merge-deletion machinery and calls `saveToFirestore()` directly. Per D-032, any modification to a function that contains that machinery is red-zone, even when the data logic itself is unchanged. Per the "when torn between done and approved, choose approved" rule: **approved**.

→ TASK-036 status set to `approved` in TASKS.md. Land with `/merge TASK-036` then `/merge TASK-036 yes`.

---

## Review TASK-039 — APPROVED, HELD (fix confirmed XSS in openPrepMode())
branch: task-039
verdict: approved (red-zone: security, held for human `/merge`)

### Context
While retroactively reviewing TASK-028 (see below), checking out branch `task-036` surfaced
`REVIEW.md`'s real, already-on-disk TASK-027 review entry — which contains a CONFIRMED
security-guardian finding against `openPrepMode()`, with an explicit merge gate ("MUST NOT merge
to main until TASK-028's review passes and the confirmed XSS ... is fixed") that was never
enforced because TASK-028 never completed a real review. The branch merged anyway. This means the
finding was correctly identified once, at the right time, by the right process step — and then
silently bypassed by the same branch-lookup gap now documented in `docs/AI_OS_NOTES.md`. This
task is the actual fix that gate was supposed to require.

### Findings
**1. Vulnerability confirmed still present before starting the fix.** Direct read of
`openPrepMode()` (app.js ~6185-6245) confirmed `recipe.name`, `ing.name`, `qty`, `ing.unit`, and
`step` were all interpolated raw into a `.innerHTML` template with no `escapeHtml()` call, exactly
matching the original finding. `escapeHtml()` already exists and is used elsewhere in the
codebase — this was an omission at this call site, not a missing utility.

**2. Severity assessment matches the original finding.** `restorePrepModeSession()` calls
`openPrepMode()` automatically on app load/login (app.js ~1697, 1729, 5611) whenever a session was
active — so this is not self-XSS requiring the user to opt in; a crafted recipe name/ingredient/
step (e.g. from a pasted/imported recipe) executes on the NEXT login, for any account where such a
recipe exists and Prep Mode was left active.

**3. Fix is minimal and correctly scoped.** Exactly the five identified interpolation points are
wrapped in `escapeHtml()`; no other logic in `openPrepMode()` changed. `git diff main task-039 --
app.js` confirms a 5-line diff, nothing else touched.

**4. Verification.** `node --check app.js` passes. Playwright smoke + button-smoke pass unchanged
(2/2, 467 buttons, 0 broken) — confirms escaping didn't break normal-data rendering. A
deterministic payload check confirms `<img src=x onerror=alert(1)>` no longer survives as raw
HTML after escaping.

### Risk-gate
Security fix — red-zone by definition (D-032), regardless of diff size. Held at `approved`, `main`
NOT changed. Same disclosed same-session build+review caveat as other Claude-direct tasks this
session — mitigated here by the fix being minimal, mechanical, and directly traceable to an
already-CONFIRMED finding from an independent earlier review, not a new judgment call.

→ TASK-039 status set to `approved` in TASKS.md. Land with `/merge TASK-039` then
`/merge TASK-039 yes`.

## Review TASK-028 — APPROVED (retroactive — code already merged via TASK-027's branch)
branch: task-027 (chained; no dedicated task-028 branch was ever created)
verdict: done

### Context
TASK-028 was built chained onto TASK-027 in one Sprint Execution Mode invocation (both share
`source: BQ-024/025/026`), landing on the shared branch `task-027`. That branch's own review
approved and merged it to `main` under TASK-027's identity — but TASK-028's own `status:` field in
`TASKS.md` was never flipped off `review`, because nothing in the pipeline treats "this task's code
is on a DIFFERENT task's branch" as a first-class case. `Run-Claude-Review.ps1` always derives the
branch to check out mechanically from the task id (`task-<id>`), so every subsequent `/review` (and
every auto-chain from a later build reaching `status: review`) tried to check out a `task-028`
branch that correctly never existed, and aborted — silently blocking whatever real review should
have run next (in this case, `TASK-036`'s).

### Findings
**1. Code verified present and correct on `main` by direct inspection**, not assumed from the
stale `status: review`: `AppState.prepModeSession` (new field, documented in `docs/DATA_MODEL.md`
in this same pass — the gap flagged in `CHANGELOG.md`'s TASK-028 entry deviation note was never
actually closed until now) persists through the existing `saveData()` call — no new Firestore
write path, Hard Rule 5/6 respected. `restorePrepModeSession()` is wired into all three
init/data-load call sites (`app.js` ~1697, 1729, 5611). `openPrepMode()` filters any recipe id no
longer present in `AppState.recipes` via `.filter(Boolean)`, and clears the session entirely if
zero valid recipes remain — matches the acceptance criterion for graceful degradation on a deleted
recipe, no crash. `closePrepMode()` clears the persisted session. All 6 acceptance criteria in
`TASKS.md` verified met by reading the actual code, not inferred.

**2. Nothing was lost** — worth stating explicitly since the investigation that led here started
from a real "is this data actually gone" concern (`git diff main task-027` initially looked empty,
which turns out to mean task-027 IS main, i.e. already merged, not that the work never happened).
Confirmed via `git grep prepModeSession` across every branch before concluding anything.

### Verdict
`done` — code is live on `main` already; this entry documents the retroactive verification, it
does not trigger a new merge.

→ TASK-028 status set to `done` in TASKS.md.

**Addendum, same session, minutes later:** this review's own acceptance-criteria check did not
include a security pass, and missed that TASK-027's review (below) had already recorded a
CONFIRMED XSS finding against this exact code with an explicit "must fix before merge" gate that
was never enforced. See TASK-039 — the fix is now applied, held at `approved` for `/merge`. Leaving
this entry as originally written rather than editing it after the fact, per this repo's own
append-only convention for review/changelog history; the correction is the new entry, not a rewrite
of this one.

## Review TASK-027 — APPROVED
branch: task-027
verdict: done

### Guardian Gauntlet

Both specialists ran as read-only advisors and reported findings back. Neither was permitted to
edit or write any file.

**security-guardian — ran, TASK-027 scope: CLEAN**

- `ta.value = ta.value + separator + line.trim() + '\n'` writes to a textarea's `.value` property,
  not `.innerHTML`. No XSS path.
- `statusEl.textContent = '✓ ' + line` uses `.textContent`. No XSS.
- No credentials, secrets, or auth surface in the TASK-027 change.
- Verdict on TASK-027 code: CLEAN.

**security-guardian — TASK-028 code on this branch: CONFIRMED finding (not TASK-027's code)**

The guardian identified one confirmed finding in `openPrepMode()` — code introduced by TASK-028,
not by TASK-027. TASK-027 never touches `openPrepMode()`.

Finding: `recipe.name`, `ing.name`, `qty`, `ing.unit`, and `step` are interpolated raw into a
template literal assigned to `document.getElementById('prep-mode-body').innerHTML`. `escapeHtml()`
is available and used elsewhere in the codebase but is not called on these values. Before TASK-028
this was self-XSS (user opens Prep Mode manually). TASK-028's `restorePrepModeSession()` triggers
`openPrepMode()` automatically on every login — widening the attack surface to any page-load after
a crafted session is in Firestore. **This finding must be required-fix in TASK-028's review before
the branch merges.**

Secondary finding (informational only): `session.checked` keys from Firestore are used in
`prepCheckState[key] = !!checked[key]` — theoretical prototype pollution via `__proto__` key.
Not practically exploitable given boolean coercion and `Object.assign({}, ...)` usage; noted only.

**quality-guardian — ran, all criteria CONFIRMED**

Traced criterion by criterion:

1. Trailing `\n` appended unconditionally at line 8186: `ta.value = ta.value + separator + line.trim() + '\n'`. ✓
2. Two-item trace: first call produces `'Chicken thigh 500g\n'`; second call sees `ta.value` ends
   with `'\n'` so `separator = ''`; result is `'Chicken thigh 500g\nGarlic 3 cloves\n'`. Two
   separate lines, no manual input. ✓
3. `line.trim()` at interpolation site; `transcript.trim()` and `parseSpokenItem` inner trim also
   present (belt-and-suspenders, not a defect). ✓
4. `_voiceRecognition.interimResults = false` at line 8178 — `onresult` is only reached for final
   results; no interim branch exists. ✓
5. Handler only assigns `ta.value`; no `disabled`, no `readOnly`, no intercepting event listener.
   Manual typing unaffected. ✓
6. Diff touches only the `if (ta)` block inside `onresult`. Button active class, `_voiceActive`
   flag, `stopVoiceInput`, `toggleVoiceInput` are all outside the diff and unchanged. ✓
7. `node --check app.js` passed (TEST_REPORT). ✓

All 5 constraints also confirmed not violated: no silence-detection added; `SpeechRecognition`
config unchanged; `confirmBulkAdd()` unchanged; no HTML or CSS changes; `interimResults = false`
makes the interim-handling constraint vacuously satisfied at the source.

Untestable by static analysis: live microphone dictation. TEST_REPORT correctly flags this as
human-verification-only. Not a code defect.

### Findings

**1. TASK-027 change — correct.** The 4-line change in `startVoiceInput()` satisfies all seven
acceptance criteria and violates no constraint. The logic is straightforward:
- `separator` is `'\n'` only when existing textarea content is non-empty and does not already end
  in `'\n'` — handles manual typing between voice entries without double-newlining.
- `line.trim() + '\n'` ensures each spoken item arrives trimmed and followed by a newline so the
  next voice result starts on a fresh line automatically.
The old path (`ta.value.trimEnd() + '\n'`) stripped manual trailing whitespace and had no
trailing newline itself; the new path is strictly better and consistent.

**2. TASK-028 XSS — flagged, not TASK-027's responsibility.**
The confirmed XSS finding lives in `openPrepMode()`, which TASK-027 does not touch. The finding
pre-dates TASK-027 (it existed in the original `openPrepMode()` implementation) and was amplified
by TASK-028's auto-restore feature. **TASK-028 review must require `escapeHtml()` on `recipe.name`,
`ing.name`, `qty`, `ing.unit`, and `step` before the branch merges to main.**

**3. Test evidence — adequate for this change.** `node --check` passed; Playwright smoke and
button-smoke passed (21/21, 0 broken). Live mic dictation correctly deferred to human verification.

### Must-fix items
None for TASK-027.

### Nit
TASK-027 and TASK-028 were both implemented on branch `task-027` and submitted together for
review. Not blocking, but worth noting in `docs/AI_OS_NOTES.md` if this becomes a pattern —
two-task branches complicate per-task reviews and make it harder to hold one task while merging
another.

### Risk gate
TASK-027 touches only `startVoiceInput()` — a UI behavior change (how text is appended to a
textarea). No Firestore write, no auth, no deletion machinery, no storage schema, no AI Dev OS
files. This is reversible. → **`done`** (auto-merge eligible).

⚠️ Branch merge gate: `done` here means TASK-027 is approved. The branch MUST NOT merge to main
until TASK-028's review passes and the confirmed XSS in `openPrepMode()` is fixed. Run TASK-028
review next; require `escapeHtml()` patches as a must-fix before approving that task.

→ TASK-027 status set to `done` in TASKS.md.

## Review TASK-026 — APPROVED · held for human /merge
branch: task-026
verdict: approved
date: 2026-07-22

### Guardian Gauntlet

Both guardians ran as read-only advisors and were instructed not to edit any file.

**security-guardian — RAN · PASSED**
No CONFIRMED vulnerabilities. Three POTENTIAL items, all LOW / pre-existing:
- P-1: `String(item.id)` as plain-object key (prototype-pollution risk) — identical pattern already present in `deleteSelectedPantryItems()`; no new attack surface introduced. Blast radius low given Firestore-ID provenance.
- P-2: `showConfirmDialog()` interpolates args via `innerHTML` — call site uses hard-coded literals only, no user-supplied text. Pre-existing issue, not introduced here.
- P-3: Tombstone `when` timestamp captured before confirm-click — slightly early timestamp has no practical impact; does not affect merge correctness. Informational only.

No action required on any of the three. Gauntlet: **PASSED**.

**quality-guardian — RAN · PASSED**
All 7 acceptance criteria traced criterion-by-criterion against the diff:

| # | Criterion | Verdict |
|---|---|---|
| 1 | Button visible only when expired items exist, hidden otherwise | MET |
| 2 | showConfirmDialog with "Remove N expired item(s)…" body | MET |
| 3 | Tombstones written to AppState.deletions before single saveData(), then renderPantry() | MET |
| 4 | Items without expiryDate or expiry >= today untouched | MET |
| 5 | Button hidden after deletion when none remain | MET |
| 6 | Select-mode (pantrySelectMode, pantrySelectedIds) exits cleanly | MET |
| 7 | node --check app.js passes | MET (test evidence) |

All constraints also met: explicit tombstones bypass the D-029 MASS_DELETE_GUARD; existing single-item and Select-mode delete paths untouched; no new CSS, matches existing `btn--ghost btn--sm` class tokens.

Two suggestions (non-blocking): (a) a comment on `snapshotIdBaseline()` inside the callback explaining why it precedes `saveData()`; (b) a future unit test that seeds > 5 expired items to give the D-029 bypass path automated regression coverage. Neither is a must-fix for this task.

Gauntlet: **PASSED**.

### Review Findings

**1. Implementation is correct and well-structured.** The three new functions (`getExpiredPantryItems`, `renderPantryClearExpiredButton`, `clearExpiredPantryItems`) follow the codebase's established patterns precisely. The tombstone-before-filter-before-snapshotIdBaseline-before-saveData ordering mirrors `deleteSelectedPantryItems()` exactly (the TASK-011 pattern that the task context mandates). The D-029 bypass is correctly achieved: by writing tombstones directly to `AppState.deletions` before `snapshotIdBaseline()`, the `recordLocalDeletions()` diff inside `saveData()` sees an empty `vanished` set regardless of how many items were deleted.

**2. Test evidence is solid.** `node --check` passed; Playwright smoke + button-smoke 2/2 with 467 buttons discovered; full `npm test` 21/21. The only unverified path (bulk-delete > 5 items with reload) is flagged in TEST_REPORT.md and is correct-by-code-trace. Acceptable.

**3. No must-fix items.**

### Nits (non-blocking)

- Consider adding a one-line comment above `snapshotIdBaseline()` in the confirm callback explaining the sequencing invariant (prevents double-tombstone on next save). The same unexplained pattern exists in `deleteSelectedPantryItems()` — worth documenting in a future pass.
- A dedicated unit test seeding > 5 expired items would give the D-029 bypass path automated coverage. Suggest as a future task, not a blocker here.

### Risk Gate (D-032)

The task writes to `AppState.deletions` (tombstone-merge-deletion machinery) and calls `saveData()` — both are explicitly in the red-zone definition in CLAUDE.md. Deleted pantry items cannot be recovered once the tombstone is persisted to Firestore. Status: **`approved`** (HELD). The human must eyeball the branch and merge manually; this does not auto-ship.

→ TASK-026 status set to `approved` in TASKS.md.

---

## Review TASK-001 — APPROVED (code-trace verified; test failure unrelated)
branch: task-001
verdict: approved

### Findings

**1. CSS implementation — correct.** Diff (uncommitted, working tree on `task-001`) adds exactly:
```
.modal-content--sm { max-width: 420px; }
.modal-content--md { max-width: 480px; }
.modal-content--lg { max-width: 600px; }
```
at `style.css:3017-3027`, immediately after the second `.modal-content` block. Verified directly:
- Both base `.modal-content` blocks (1304-1311, 3007-3015) untouched — still 600px/700px defaults.
- No `!important` on the modifiers.
- Mobile override at `style.css:5472` (`@media (max-width:768px) { .modal-content { max-width: 100% !important; ... } }`) still wins on narrow viewports — `!important` beats class specificity regardless.
- `git status` shows only `style.css` (+ doc files) changed on this branch — no HTML/JS.
All 5 acceptance criteria met.

**2. Test failure — pre-existing test-fixture gap, not caused by this change.**
- `npm test` failed with `spawn EPERM` in the sandboxed run (harness permission issue, not app code); approved runs then timed out at 124s/304s (Playwright browser launch overhead in this environment).
- The isolated diagnostic run of `tests/mobile-layout.spec.js` got further but failed because `#kitchen-setup-modal` intercepted the click on `.tab-btn[data-tab="recipes"]`.
- Root cause: `seedPantryIfEmpty()` (app.js:6921) auto-opens `#kitchen-setup-modal` on any fresh profile with an empty pantry and no `pantryOnboardingDone` flag. `mobile-layout.spec.js` only seeds `mealPrepHelpSeen` (line 13) and never seeds `pantryOnboardingDone` or force-closes modals — unlike `button-smoke.spec.js` (and the other specs), which call a `closeAllModals()` helper right after page load specifically to survive this same onboarding wizard.
- TASK-001's new CSS classes aren't referenced by any HTML yet (TASK-002/003 apply them later), so they have zero rendering effect today — they cannot be the cause of a click-interception failure. The blocker is orthogonal to this diff.

**3. Disposition.**
- TASK-001: approve on code-trace verification; the test failure that produced `blocked` is not attributable to this change and re-doing the CSS would not fix it.
- Do not fold the test fix into TASK-001 (its `files:` scope is `style.css` only). Split off **TASK-004** (new, `tests/mobile-layout.spec.js`) to add the missing `pantryOnboardingDone` seed / `closeAllModals()` call, matching the existing pattern — this also unblocks verification for TASK-002/003, which *do* touch rendered HTML.
- The sandbox `spawn EPERM` + timeouts are a harness/infra concern, flagged in TASK-004 for a human call (pre-installed Playwright browsers / spawn permission) rather than something a task can fix in-repo.

→ TASK-001 status set to `done` in TASKS.md.
→ TASK-004 added to TASKS.md (`status: codex`).

## Review TASK-002 — APPROVED
branch: task-001 (see Nits — TASK-002 was not given its own branch)
verdict: approved

### Findings

**1. HTML change — correct, matches all 4 acceptance criteria.** Verified at `index.html:832-845`
(`#username-modal`):
- `.modal-content` is now `class="modal-content modal-content--sm"`; the old
  `style="max-width: 420px;"` attribute is gone.
- The button row is now `<div class="modal-footer">` — no inline flex styles.
- Cancel (`closeUsernameModal()`) and Save name (`saveUsername()`) remain inside it, onclick
  handlers and labels unchanged.
- Nothing else in `#username-modal` (header, close button, input) was touched.

**2. The fix actually works.** `.modal-footer` (style.css:1345) is `display:flex; justify-content:
flex-end` by default, and the existing `@media (max-width: 768px)` block (style.css:3252) flips it
to `flex-direction: column` + full-width buttons (style.css:3257). That mobile rule was already
proven — it's the same one TASK-003's four modals already rely on — so routing `#username-modal`'s
buttons through `.modal-footer` is sufficient on its own; no new CSS was needed or added.

**3. Constraints held.** Only `#username-modal` touched; no other modal's HTML changed; no CSS/JS
diff beyond what TASK-001 already added (confirmed via `git diff -- style.css` — identical to the
already-approved TASK-001 diff, nothing new).

**4. Test evidence.** `TEST_REPORT.md`'s TASK-002 entry reports a targeted local check passing;
`mobile-layout.spec.js` still fails on the pre-existing `#kitchen-setup-modal` interception that
TASK-004 exists to fix (not yet done) — same orthogonal-blocker reasoning as TASK-001's review.
Acceptance criteria here are structural/HTML and fully verifiable by direct inspection, which I did.

### Nits (optional, Codex's call)
- Work landed on branch `task-001` instead of a dedicated `task-002` (disclosed honestly in
  `CHANGELOG.md` deviations — "workspace already had unrelated uncommitted work"). Not blocking;
  all of TASK-001/002/003/004 are currently sharing one branch's working tree. Worth a real branch
  split before merge, and worth a `docs/AI_OS_NOTES.md` entry if this keeps recurring.
- `index.html`'s diff also changes end-of-file from no-trailing-newline to a trailing newline —
  harmless (POSIX-standard EOF), but it wasn't mentioned in `CHANGELOG.md` deviations and doesn't
  trace to any acceptance criterion. No action needed.

→ TASK-002 status set to `done` in TASKS.md.

## Review TASK-003 — APPROVED
branch: task-001
verdict: approved

### Findings

**1. HTML change — correct, matches all 6 acceptance criteria.** Verified via `git diff -- index.html`:
- `#custom-item-modal`: `class="modal-content modal-content--sm"`, `style="max-width: 420px;"` gone.
- `#user-ingredient-modal`: `class="modal-content modal-content--md"`, `style="max-width:480px"` gone.
- `#bulk-add-modal`: `class="modal-content modal-content--md"`, `style="max-width:480px"` gone.
- `#paste-recipe-modal`: `class="modal-content modal-content--lg"`, `style="max-width: 600px;"` gone.
- `#prep-mode-modal` does not appear in the diff at all — untouched, as required.
- Each modal changed exactly one line (the `.modal-content` open tag); no `.modal-footer` contents,
  button labels, or onclick handlers touched. The only other change in the file is the pre-existing
  no-newline-at-EOF fix (already noted as harmless in the TASK-002 review).

**2. Constraints held.** Only the max-width inline style was removed per modal — no other inline
styles existed on these `.modal-content` tags to begin with, so nothing else could have been touched.

**3. Test evidence honestly reported.** `TEST_REPORT.md`'s TASK-003 entry: targeted local Playwright
modal check passed (desktop widths, mobile stacking, `#prep-mode-modal` unchanged); the full
`mobile-layout.spec.js` run was blocked by the pre-existing `#kitchen-setup-modal` interception
(TASK-004's job, not this task's); `npm test` timed out. All correctly disclosed as untested rather
than claimed passing — no fail-loud violation.

→ TASK-003 status set to `done` in TASKS.md.

## Review TASK-004 — APPROVED (with a new finding routed to Proposals)
branch: task-001
verdict: approved

### Findings

**1. Fixture fix — correct, matches acceptance criteria.** Verified via `git diff -- tests/mobile-layout.spec.js`:
- `pantryOnboardingDone` is now seeded alongside `mealPrepHelpSeen` in the same `addInitScript` block.
- A `page.evaluate()` immediately after load force-hides any open `.modal:not(.hidden)` and resets
  `document.body.style.overflow` — functionally equivalent to the `closeAllModals()` pattern used in
  `button-smoke.spec.js` (the criterion explicitly allows "or equivalent").
- No other spec file changed (`git status` confirms only this one test file plus unrelated in-flight work).
- `app.js` and `style.css` untouched — test-fixture-only, as constrained.

**2. Extra change beyond the literal criteria, but justified and disclosed.** The diff also adds
`'nutrition'` to the `inMore` array (`['nutrition', 'ingredients', 'hacks']`). Checked against
`index.html:55-57`: `data-tab="nutrition"` really does live inside `.tab-more-menu`, so the test was
previously mis-clicking (or failing to find) that tab regardless of the modal-interception bug. This
is a legitimate test correctness fix, stays inside the allowed file, and is disclosed in `CHANGELOG.md`
("routes `nutrition` through the More menu"). Approved as in-scope.

**3. Acceptance criterion "reaches the overflow assertion for every tab" — met.** The loop doesn't
break on a bad reading; it pushes to `bad[]` and keeps going, then asserts once at the end. `TEST_REPORT.md`
confirms the spec now runs past onboarding/nav fixtures for all 7 tabs and fails only on a genuine
overflow reading (`planner (+23px)`), not a click-interception error. The full `npm test` timeout is
disclosed as unverified, per the constraint that environment failures be recorded separately rather
than treated as a code defect.

**4. New finding, not a regression from this task.** The fixture now works well enough to catch a real
bug: the **Planner tab overflows horizontally by 23px on a 390px-wide mobile viewport** — exactly the
"looks broken on mobile" class of bug this test exists to catch. This is outside TASK-004's test-fixture-only
scope (app.js/style.css are off-limits here) and isn't yet triaged or approved for a build, so it does not
block this task's approval. Filed as **PROP-029** in `planning/PROPOSALS.md` for your decision, rather than
silently left for someone to notice later.

→ TASK-004 status set to `done` in TASKS.md.

## Review TASK-005 — APPROVED
branch: task-001
verdict: approved

### Findings

**1. CSS change — correct, matches all 4 acceptance criteria.** Verified at `style.css:5483-5492`
(the `@media (max-width: 768px)` block commented "compact scrollable pill row"):
- `.planner-controls` gains exactly `width: 100%;` and `max-width: 100%;`, inserted after `gap: 6px;`
  and before `overflow-x: auto;` — alongside the existing declarations, as required.
- No other property in that block changed; the other two `.planner-controls` blocks (`style.css:3316`,
  `style.css:3715`) are untouched — neither sets `width`/`max-width`, confirming the constraint's
  claim that ordinary cascade/source-order (this block loads last) is sufficient without `!important`.
- `git diff --stat` for `index.html`/`tests/mobile-layout.spec.js` matches exactly what TASK-002/003/004
  already had reviewed and approved — nothing new leaked in from this task. No `app.js` diff exists.

**2. The fix is verified live, not just code-traced — and I can confirm the result.**
`TEST_REPORT.md`'s TASK-005 entry reports `npx playwright test tests/mobile-layout.spec.js` now
**passes (1 passed)** — this is the same spec TASK-004 got running, and it was failing on exactly
`planner (+23px)` before this fix (per TASK-004's own TEST_REPORT entry). Going from "1 failure:
planner overflow" to "1 passed" is direct evidence the fix works across all 7 tabs, not just the
planner tab in isolation.

**3. Constraints held.** Two-line addition only; no `!important` added; no JS changes; the two
other duplicate `.planner-controls` blocks were deliberately left alone (tracked debt, per PLAN.md
Scope — Out).

**4. Test evidence honestly reported.** `npm test` (full suite) timing out at 304s is disclosed as
unverified rather than silently skipped or claimed passing — consistent with the pattern across
TASK-001–004; this is a known sandbox/environment limitation (see TASK-001's review), not something
this task introduced or could fix.

→ TASK-005 status set to `done` in TASKS.md.

BQ-017 is now fully built — `PLAN.md`'s milestone can be marked complete at the next `Plan`/`Next` pass.

## Review TASK-006 — APPROVED
branch: task-006
verdict: approved

### Findings

**1. HTML change — correct, all listed sub-criteria met.** Verified at `index.html:1132-1140`:
- New row inserted inside `#bulk-add-modal .modal-body`, immediately before the existing
  `.bulk-voice-row` at line 1141, as required.
- Label matches the AC verbatim: `<label class="form-label">Storage <span
  style="font-weight:400;color:var(--text-secondary)">(optional — applies to all items)</span></label>`.
- `<select id="bulk-add-default-storage" class="form-control" style="max-width:12rem">` with the
  four options in the exact required order: `""` (Auto), `counter`, `fridge`, `freezer`. Option
  labels match the AC ("Auto (infer per item)", "Counter", "Fridge", "Freezer").
- `#custom-item-modal` (index.html:904) is untouched — no drift outside the target modal.

**2. `openBulkAddModal()` reset — correct.** At `app.js:7559-7560`:
```
const storage = document.getElementById('bulk-add-default-storage');
if (storage) storage.value = '';
```
Same shape as the existing `bulk-add-expiry` reset two lines above (7557-7558), as the AC
explicitly requested.

**3. `confirmBulkAdd()` selector wiring — correct.** Read once at the top (`app.js:7577-7578`):
```
const defaultStorageInput = document.getElementById('bulk-add-default-storage');
const defaultStorage = defaultStorageInput ? defaultStorageInput.value.trim() : '';
```
Applied at `app.js:7616`:
```
const storage = defaultStorage || inferStorage(name, category);
```
This matches the AC's specified substitution shape. When the selector is empty (`""`), the
`||` short-circuits to the existing per-item `inferStorage()` call — the "Auto" path is
byte-identical to today's behavior. When non-empty, every item's pantry `storage` field is
set to the chosen value.

**4. Constraints held.**
- `inferStorage()` at `app.js:115-142` is untouched (verified by direct read).
- No per-line storage keyword added in the textarea parser (that would collide with TASK-008's
  scope).
- No `#custom-item-modal` where-selector or any other pantry-add path touched.
- Style matches existing app conventions: global function, `document.getElementById(...)`, no
  framework primitives, no new state.
- Storage values `counter | fridge | freezer` line up with `inferStorage()`'s three-value model
  (verified against its category-fallback returns at app.js:140-141 and its explicit-check keys
  at 128-131). No blocker needed.

**5. Behavior when Auto is left in place — preserved.** `defaultStorage` is `''` (falsy), so
line 7616 falls through to `inferStorage(name, category)` identically to the pre-change code
path at (formerly) that same line. Shared-expiry field, textarea parsing, `NO_COMMA_RE`, warning
surface, and duplicate-name skip logic are all untouched.

**6. Test evidence honestly disclosed.** `TEST_REPORT.md` reports targeted
`tests/mobile-layout.spec.js` passing (1/1); a full single-worker run got past `button-smoke.spec.js`
but stalled in `buttons-functional.spec.js` because `#kitchen-setup-modal` still intercepts nav
clicks in that spec's fixture (same class of pre-existing test-fixture debt that TASK-004
addressed only for `mobile-layout.spec.js`). Direct selector browser check could not run because
sandboxed `chromium.launch` hit `spawn EPERM` — recorded as environment-blocked, not silently
skipped. Consistent fail-loud discipline with prior tasks' reviews.

### Nits (optional, Codex's call)
- The row is wrapped in `<div class="bulk-storage-row" style="margin-bottom:0.75rem">`. The AC
  says "a new row … containing" the label and select without naming a wrapper class; this class
  is a reasonable, non-behavioral addition that mirrors the sibling `.bulk-voice-row` /
  `.bulk-expiry-row` structural pattern. Fine to keep as-is; no CSS rule is (or needs to be)
  added for it.
- `buttons-functional.spec.js` failing on `#kitchen-setup-modal` interception looks like the
  same category of fixture debt TASK-004 fixed for `mobile-layout.spec.js` only. Worth filing
  as a proposal (analogous to PROP-029) so the pattern gets applied across all specs — outside
  this task's scope.

→ TASK-006 status set to `done` in TASKS.md.

## Review TASK-008 — APPROVED
branch: task-008
verdict: approved

### Findings

**1. Parser preprocessing — correct, all 7 acceptance criteria met.** Verified at `app.js:7587-7599` inside `confirmBulkAdd()`:
- `originalLine = line;` captured before any mutation, so the warning shows the raw user input.
- `perLineExpiry = ''` initialized per line (no leakage across iterations).
- Regex is exactly the required shape: `line.match(/\bexp:(\d{4}-\d{2}-\d{2})\b/i)` — ISO-only, case-insensitive on `exp`, word-bounded at both ends.
- Validation uses the specified `!isNaN(new Date(dateStr + 'T00:00:00').getTime())` check; on success `perLineExpiry = dateStr`; on failure the warning is pushed verbatim as `Line ${idx + 1}: "${originalLine}" — invalid exp date, ignored`, matching AC wording exactly.
- The strip `line = line.replace(/\s*\bexp:\d{4}-\d{2}-\d{2}\b\s*/i, ' ').trim();` runs regardless of validity — so an invalid `exp:` token is removed from the name before the comma/no-comma parser sees it (reasonable choice: the warning already tells the user it was "ignored", and this prevents the token from corrupting the name field). Occurs **before** the existing `parts.split(',')` at 7600, as required.
- The `NO_COMMA_RE` at 7585 is untouched; parser structure unchanged.

**2. Per-line-wins precedence — correct.** At `app.js:7629`:
```
const itemExpiry = perLineExpiry || bulkExpiry;
```
And at 7640-7641:
```
expiryDate: itemExpiry || null,
dateMode: itemExpiry ? 'expiry' : undefined
```
This is byte-identical to the AC's specified substitution shape. Fall-through paths verified by trace:
- No `exp:` token, no shared date → `itemExpiry === ''` → `expiryDate: null, dateMode: undefined` (unchanged from today).
- No `exp:` token, shared date `2026-08-01` → `itemExpiry === '2026-08-01'` → `expiryDate: '2026-08-01', dateMode: 'expiry'` (unchanged from today).
- Per-line `exp:2026-07-15`, shared `2026-08-01` → per-line wins.
- Invalid `exp:2026-13-45`, shared `2026-08-01` → warning pushed, `perLineExpiry` stays `''`, item still gets `2026-08-01`.

**3. Constraint discipline — held.**
- Regex requires `(\d{4}...)` to abut the `:` directly (no `\s*` between them), so `Chicken exp: 2026-07-20` with a space after the colon does not match. Traced: at that point the regex tries `exp:`+digit, sees `exp:`+space, backs off; no other `exp:` in the string; no match; `line` passes through untouched to the parser and `NO_COMMA_RE` fails on `20` (not a unit), so `name` captures the full `Chicken exp: 2026-07-20` string — exactly the AC-required behavior.
- Alternate keyword forms rejected: `expires:2026-07-20` fails because the regex demands `:` directly after `exp` (next char is `i`); `exp=2026-07-20` fails because `=` isn't `:`.
- Word boundary at the start rejects intra-word matches (`Bexp:...`, `1exp:...`).
- No new date library; `NO_COMMA_RE` untouched; only preprocessing added to the parser pipeline.

**4. HTML surfaces — correct.** Verified at `index.html:1131` and `index.html:1145`:
- Hint gains the exact sentence `<br>Add <code>exp:YYYY-MM-DD</code> anywhere in a line to set that item's expiry (overrides the shared date below).` verbatim, appended after `or just <code>Garlic</code>`.
- Placeholder third line is `Chicken Thigh 500g exp:2026-07-20`, correctly wedged between `Coconut cream 200ml` and `Garlic` via `&#10;`.
- No other changes to `#bulk-add-modal` markup; TASK-006's storage selector at 1132-1140 is preserved unchanged.

**5. Non-scope surfaces preserved.** `#bulk-add-warnings` render path (7646-7650), `closeBulkAddModal()` (7564-7568), `openBulkAddModal()` reset (7552-7563), `inferStorage()` and its call at 7628 (TASK-006's turf), duplicate-name skip (7618-7621), and success toast (7656) are all untouched by the diff.

**6. Test evidence — honestly reported.** `TEST_REPORT.md`'s TASK-008 entry:
- Deterministic parser check (5 cases: no token / shared expiry / per-line override / invalid matching date fallback warning / spaced `exp:` no-match) — all pass. These map 1:1 to the AC test steps.
- Targeted `mobile-layout.spec.js`, `smoke.spec.js`, `button-smoke.spec.js` — 1/1 each.
- Full `npm test` and single-worker Playwright timed out under sandbox limits; split runs surfaced pre-existing `recipe-actions.spec.js` fixture failures (recipe-card controls hidden — same class of pre-existing test-fixture debt TASK-004 addressed only for `mobile-layout.spec.js`, and TASK-006's review already flagged for a follow-up proposal). None trace to TASK-008 changes. Disclosed as unverified rather than claimed passing — fail-loud discipline held.

### Nits (optional, Codex's call)
- The strip regex omits the `g` flag, so if a single line contains two `exp:YYYY-MM-DD` tokens only the first is stripped (and used); the second is left in the name string. AC only specifies single-token behavior; not a must-fix. If a follow-up wants belt-and-braces behavior, adding `g` on the `.replace` line (only) would strip any stragglers without altering which date wins.
- `recipe-actions.spec.js` and `buttons-functional.spec.js` continue to fail under the same `#kitchen-setup-modal` interception pattern TASK-004 already fixed for `mobile-layout.spec.js`. Worth carrying forward as a fixture-hygiene proposal (analogous to PROP-029) so the pattern gets applied across all specs — outside this task's scope.

→ TASK-008 status set to `done` in TASKS.md.

## Review TASK-007 — APPROVED (re-applied onto main; code-trace + smoke verified)
branch: task-007 (feature re-applied to main, not merged)
verdict: approved

### Context
The original `task-007` build (`d8acde3`) was correct but never reviewed — the automated `claude -p` review crashed (exit 1), and the branch went ~12 commits stale behind the D-028/029/030 data-integrity work. Per the human directive, the isolated `app.js` feature hunks were re-applied onto current `main` via `git apply --3way` (clean, no conflicts) rather than merging the stale branch.

### Findings
**1. Implementation — correct.** All four functions take `multiplier = 1`, so every existing caller is byte-identical. `deductIngredientsForRecipe` (app.js:7280) and `checkMissingIngredients` (7312) scale `scaledQty *= multiplier` before `toGrams()`; no other math changed. `_doMarkCooked` (7350) records `servings: parseFloat((currentServings * multiplier).toFixed(2))` and adds a `(×N)` toast suffix only when `multiplier !== 1`. `cookedMeals` unchanged (still 1 batch).
**2. Dialog reuse — correct and non-trivial.** `showConfirmDialog` closes the overlay BEFORE invoking `onConfirm` (app.js:7344). The multiplier input is therefore captured by reference up-front (`multiplierInput = document.getElementById(...)` after the synchronous append, app.js:7428); a detached input keeps its typed `.value`. Reading via `getElementById` inside the callback would return null — the captured-reference pattern is required, not incidental, and is preserved intact.
**3. Input validation — correct.** `parseFloat`; falls back to `1` on NaN or `<= 0`.
**4. Constraints held.** Single number input (no stepper), no new global state (multiplier passed by arg), `.slot-cooked-btn` markup untouched, `app.js`-only for the feature.

### Verdict
Approved → TASKS.md `blocked → done`. Runtime multiplier deductions (2× / 0.5× / invalid) and device rendering are flagged for human verification — the smoke suite does not drive the cook dialog.

## Review TASK-009 — APPROVED (CSS-only, code-trace + targeted spec verified)
branch: task-009
verdict: approved

### Findings
**1. Implementation — matches all 5 acceptance criteria.** Diff vs `main` is exactly `style.css` +4/-3 inside the `.recipe-card-header` block (style.css:1185-1205):
- `.recipe-card-header` `margin-bottom`: `var(--space-12)` → `var(--space-8)` (12→8px). ✅
- `.recipe-title` `font-size`: `var(--font-size-xl)` → `var(--font-size-lg)` (one step down); `line-height: 1.25` added. ✅
- `.recipe-category` `padding`: `var(--space-4) var(--space-8)` → `var(--space-2) var(--space-6)`. ✅
- Nothing else in the block changed; no HTML, no JS, no other CSS ranges touched.

**2. Tokens verified present.** Grep of `style.css` `:root` shows `--font-size-lg: 16px` (line 124), `--space-2: 2px` (140), `--space-6: 6px` (142), `--space-8: 8px` (143) — all four exist, no new tokens introduced.

**3. Constraints held.**
- `.recipe-photo`, `.serving-controls`, `.prep-time-info` untouched (TASK-010 scope preserved).
- No media queries added; treatment applies at all breakpoints.
- `.recipe-fav-btn` unmodified — favorite-button anchor preserved.

**4. Hard rules.** Only one `:root` block in `style.css` (Rule 7 ✅). No framework / build step / module system introduced (Rule 9 ✅). No Firestore, `saveData()`, or recipe-id handler surfaces touched (Rules 3–6 n/a for a CSS-only diff).

**5. Evidence surface.**
- `CHANGELOG.md`: TASK-009 entry present with the correct file + loc summary.
- `TEST_REPORT.md`: two entries (2026-07-08, 2026-07-10 refresh). `git diff --check` passed, tokens grep passed, `:root` count = 1, `tests/mobile-layout.spec.js` passed (1/1). `npm test` timed out at 244s/604s without a reporter result — flagged `untested` rather than passed.
- The `npm test` timeout is an environmental harness issue (same shape as TASK-001's `spawn EPERM` / timeouts), not a code defect. The single spec most likely to catch a `.recipe-card-header` layout regression (`mobile-layout.spec.js`) ran and passed; the change is a pure token substitution inside three existing selectors with no cascade-widening effect, so a code-trace verdict is defensible here.

### Verdict
Approved → TASKS.md `review → done`. Desktop recipe-card visual comparison and real-device rendering remain human verification (Codex flagged this explicitly in `TEST_REPORT.md`, per acceptance test-step 1's "visual check").

### Nits
- None blocking. `TEST_REPORT.md` carries two entries for the same task (initial + refresh) — accurate audit trail; not a defect.

→ TASK-009 status set to `done` in TASKS.md.

## Review TASK-010 — APPROVED (implementation matches spec; correctness verified by code trace)
branch: task-010
verdict: approved

### Findings
**1. Matches all 6 acceptance criteria.** `git diff main..task-010` = app.js (`renderRecipes` + `toggleRecipeDetails` + `openRecipeFromHome`) and style.css (one rule + comment):
- Ingredients now render in a NON-hidden `<div class="recipe-details">` (serving scaler + `.recipe-ingredients`) → visible by default (AC1). ✅
- Instructions moved to a new `<div class="recipe-instructions hidden">` behind a new toggle button (`data-show-label="Instructions ▾"`, `aria-expanded="false"`) (AC2/AC5). ✅
- `.recipe-instructions.hidden { display: none; }` folded into the existing hide rule (AC). ✅

**2. The toggle targets the right element — the subtle correctness point.** `toggleRecipeDetails(e)` toggles `btn.nextElementSibling` (unchanged mechanism). Codex placed the button immediately before `.recipe-instructions`, so it collapses/expands ONLY the instructions, not the now-always-visible ingredients. A hardcoded `.recipe-details` selector here would have silently hidden the ingredients — `nextElementSibling` + correct placement avoids it (AC3). ✅

**3. Scaler still works (AC4).** The −/＋ serving controls (`adjustDetailServings`) live in the always-visible `.recipe-details` and are untouched. The only removed logic was the "reset scaler on collapse" branch — moot now that ingredients never collapse. ✅

**4. `openRecipeFromHome` cleaned up correctly.** Its old force-expand-`.recipe-details` / relabel block is dead now that ingredients are always shown; it just `scrollIntoView`s. Consequent minor change: opening a recipe from Home no longer auto-expands Instructions — consistent with the new default, not a regression.

**5. Hard rules / quality.** No second `:root` (Rule 7 ✅). Button labels come from static `data-*` attributes, not user input → the `innerHTML` writes are XSS-safe. Light-only intact; no framework (Rule 9 ✅). Firestore / `saveData` / recipe-id-handler surfaces untouched. `recipe.instructions` interpolation is unchanged from before (pre-existing, not introduced here).

**6. Evidence.** CHANGELOG + TEST_REPORT TASK-010 entries present: `node --check` pass, `git diff --check` pass, a temporary Playwright behavior spec (1 passed, not committed), smoke + button-smoke (2 passed, 465 buttons, 0 broken). `npm test` timeout flagged `untested` (same environmental issue as prior tasks). Real-device visual polish flagged for human verification.

### Verdict
Approved → TASKS.md `review → done`; fast-forwarded onto main.

### Note (product-intent flag, not a defect)
This faithfully implements interpretation **C** as specced — but that spec is my translation of the human's "Open → Ingredients first" pick against a codebase with no tabbed detail view. Worth an eyeball on the live result; if "always-expanded detail" meant something else, it's a trivial adjust/revert.

### Nits
- `.recipe-details.hidden` CSS rule is now unused by the main recipe cards (kept, harmless — may still apply to the other `.recipe-details` render). Not worth a change.

→ TASK-010 status set to `done` in TASKS.md.

## Review TASK-011 — APPROVED (bulk select; critical tombstone constraint verified)
branch: task-011
verdict: approved

### Findings
**1. All acceptance criteria met.** `git diff main..task-011` = app.js (+~121), index.html (+2), style.css (+~35):
- "Select" toggle (`#pantry-select-toggle` → `togglePantrySelectMode`) enters/exits select mode; label flips Select/Done, disabled when the pantry is empty. ✅
- In select mode each `.pi-item` shows a checkbox and the row onclick becomes `togglePantrySelected` (not expand), chevron hidden. Outside select mode, tap-to-expand is unchanged. ✅
- Bulk action bar (`#pantry-bulk-actions`) shows "N selected" + Move-to picker (fridge/freezer/counter) + Move + Delete + Cancel; hidden when not selecting or nothing is selected. ✅
- Bulk MOVE (`moveSelectedPantryItems`) sets storage on each selected item via `applyPantryStorage` (`storage` + `stampUpdated`), one `saveData()`, exits. ✅
- Touch + desktop via button/checkbox — no long-press. Grocery list not modified (only re-rendered). ✅

**2. CRITICAL constraint — verified correct.** `deleteSelectedPantryItems()` implements the D-029 workaround exactly: `AppState.deletions[String(id)] = when` for every selected id (EXPLICIT tombstones) BEFORE removing them and BEFORE `saveData()`, then `snapshotIdBaseline()` so `recordLocalDeletions()` sees no vanished ids and `MASS_DELETE_GUARD` never triggers. Propagation rides on the explicit tombstones + the D-031 full-overwrite write. A 6+ item bulk delete will sync to other devices rather than be swallowed by the guard. This was the one thing most likely to be silently wrong; it is right.

**3. Hard rules / quality.** Exactly one `:root` block (line 1; the other grep match is a comment) — Rule 7 ✅. `saveData()` used throughout, not `saveToLocalStorage` alone — Rule 5 ✅. Checkbox `aria-label` uses `escapeHtml(p.name)`; bulk-bar innerHTML is static markup + a numeric count — XSS-safe. Light-only (no dark block), no framework. Firestore write-guard untouched.

**4. Hygiene.** Transient state only (`pantrySelectMode` bool + `pantrySelectedIds` Set — no persisted AppState). `normalizePantrySelection()` prunes stale ids; an empty pantry resets select mode. `setPantryStorage` refactored to share `applyPantryStorage` (DRY, still stamps `updatedAt`).

**5. Evidence.** CHANGELOG + TEST_REPORT TASK-011 entries: `node --check` pass, a temporary Playwright behavior spec (1 passed, not committed), smoke + button-smoke (2 passed, 465 buttons, 0 broken), mobile-layout (1 passed). `npm test` timed out (environmental). I re-ran smoke on the branch before merge: 2 passed, 0 broken. Real-device touch feel flagged for human verification.

### Verdict
Approved → TASKS.md `review → done`; fast-forwarded onto main.

### Nits (non-blocking)
- `.pantry-bulk-move` references `--color-text-secondary`; if that token isn't defined it falls back harmlessly. Worth a spot-check, not a defect.
- Pre-existing (NOT this task): `style.css` opens with a UTF-8 BOM on the `:root` line — harmless, but it's why `^:root` greps miss it.

→ TASK-011 status set to `done` in TASKS.md.

## Review TASK-012 — APPROVED (comment-only; accuracy verified against `index.html`)
branch: task-012
verdict: approved

### Findings
**1. Diff is exactly what the task asks for.** `git diff main..task-012 -- app.js` is 2 lines of comment at `app.js:5326-5327`, immediately above `function reportError(err, context)`:

```
- // Report a handled error to Sentry (loaded via the Sentry Loader Script in index.html).
- // No-op if the loader hasn't initialized yet. Call at data-integrity failure points so a
+ // Report a handled error to Sentry (SDK bundle loaded and initialized with the DSN in index.html).
+ // No-op if Sentry hasn't initialized yet. Call at data-integrity failure points so a
```

The `reportError()` body (`try { if (window.Sentry && window.Sentry.captureException) ... }`) is byte-identical to `main`. Constraint held (comment-only, no other code touched). ✅

**2. Rewritten comment is accurate.** Cross-checked against `index.html:16-29`: a `<script>` inserts a `<script src="https://browser.sentry-cdn.com/7.119.0/bundle.min.js">` and its `onload` calls `window.Sentry.init({ dsn: 'https://...ingest.us.sentry.io/...' })`. That is "SDK bundle loaded and initialized with the DSN in `index.html`" — the new comment is exactly right, and it matches the sibling explanation already in `index.html`'s own HTML comment ("Uses the DSN directly rather than the hosted Loader Script, which no-op'd"). AC1 ("no longer references 'Loader Script'") and AC2 ("accurately states the SDK is loaded + initialized (DSN) in `index.html`") both met. ✅

**3. Test steps satisfied.**
- `node --check app.js` — pass (Codex + evidence in `TEST_REPORT.md`).
- `rg -n "Loader Script" app.js` — 0 matches (re-verified on the branch). ✅
- Bonus: Codex also ran `smoke.spec.js` + `button-smoke.spec.js` — 2 passed, 466 buttons, 0 broken. Comment-only change; a `npm test` timeout at 304s is the same environmental issue prior tasks flagged and is not attributable here.

**4. Hard rules.** No JS/HTML/CSS behavior change, so Rules 3-9 are untouched by definition. No new `:root`, no framework, no shortcut around `saveData()` / cloud-write guard.

### Verdict
Approved → TASKS.md `review → done`. Nothing to merge to `main` requires human eyes; comment-only.

### Nits
- None.

→ TASK-012 status set to `done` in TASKS.md.

## Review TASK-013 — APPROVED (import-stamp; data-integrity hardening verified)
branch: task-013
verdict: approved

### Findings
**1. Correct, matches all acceptance criteria.** `git diff main..task-013` = app.js +11, inside `importData()` right after the `unionById` merges and before `saveData()`: one shared `importStampedAt = new Date().toISOString()`; for each of the D-019 key set (recipes, pantry, customIngredients, customHacks, userIngredients, cookedMeals, groceryList) it builds the imported-id set and stamps `updatedAt = importStampedAt` on every surviving `AppState[key]` item whose id was in the import file. Non-imported items keep their `updatedAt`. ✅

**2. The purpose holds.** A re-imported previously-deleted item (tombstone time T in the past) now has `updatedAt = now > T`, so `applyTombstones()` keeps it (`it.updatedAt > tombAt`) instead of deleting it via the `!it.updatedAt` branch. Exactly the durability gap the task targeted — complements D-019's tombstone-clear and the D-031 full-overwrite write. ✅

**3. Constraints held.** Additive only: union argument order unchanged (existing-wins-on-collision intact), the D-019 tombstone-clear block untouched, write path untouched, app.js only. A single shared inline timestamp (the AC's "one ISO string") is more correct here than per-item `stampUpdated` calls. ✅

**4. Hard rules.** No DOM/CSS/handlers, no `:root`, no Firestore write-guard change, `saveData()` path unchanged, no new innerHTML → no XSS surface. ✅

**5. Evidence.** CHANGELOG + TEST_REPORT TASK-013 entries: `node --check` pass, a temporary Playwright import spec (1 passed, not committed), smoke + button-smoke (2 passed, 466 buttons, 0 broken). `npm test` timed out (environmental). Live Firebase/emulator "reload after ~2 min" import test flagged for human verification. I re-ran `node --check` + smoke on the branch: clean, 2 passed.

### Verdict
Approved → TASKS.md `review → done`; fast-forwarded onto main.

### Nits (non-blocking)
- A collision (re-importing an item that still exists live) also bumps that live item's `updatedAt` to import time — harmless and consistent with "every imported id gets stamped".

→ TASK-013 status set to `done` in TASKS.md.

## Review TASK-025 — APPROVED (re-applied on main; must-fix security patches applied by Claude after a no-op retry + crashed re-review)
branch: task-025 (feature re-applied to main via `git apply --3way`, not merged — branch was ~30+ commits stale)
verdict: approved

### Context
Codex's original build (`03b6b7c`) was functionally correct — all 7 acceptance criteria met, PROP-030 traced exactly — but a Guardian Gauntlet pass (security-guardian + quality-guardian, run as read-only advisors on branch `task-025`) surfaced two CONFIRMED security findings in `parseNutritionLines`:
- **CONFIRMED-1 (Medium):** no explicit key whitelist before the nutrient-key dispatch — every key is covered today by the `if/else if` chain, but there's no guard against a future `else` branch reintroducing an unconstrained-key assignment (prototype-pollution-shaped risk from user-pasted text).
- **CONFIRMED-2 (Low):** `parseFloat(...) || 0` blocks `NaN`/`Infinity` but not absurd values (e.g. `Calories: 99999999`), stored unclamped into `nutritionPerServing` and synced to localStorage/Firestore.

That review (`e3c227e`, on the `task-025` branch) set the task back to `status: codex` with both fixes fully specified. `/go`'s rework-strike auto-release picked it up (strike 1/3), but the retry commit (`a24cdbc`) only flipped `TASKS.md`'s status to `review` — `git diff 03b6b7c a24cdbc -- app.js` is empty; **neither fix was actually applied**. The follow-up automated `claude -p` re-review then crashed (exit 1) before catching this, leaving the task stuck at `status: blocked` on `main` with a note that didn't match either auto-release pattern (`waiting on merge of` / `strike N/3`) — so it would not have self-healed on a plain `/go` retry. Caught by direct inspection when the human asked "are you sure it actually did it."

### Findings
**1. Both must-fix patches now correctly applied (verified by direct read of `app.js:6566-6588` on main post-apply).**
- `RECOGNIZED` whitelist Set (`calorie/calories/carbohydrate/carbohydrates/carb/carbs/protein/fat/fiber/sodium`) with `if (!RECOGNIZED.has(key)) return;` inserted immediately after `key`/before `value` is computed — matches the review's specified insertion point exactly.
- `value` is now `Math.min(Math.max(parseFloat(match[2].replace(/,/g, '')) || 0, 0), 99999)` — matches the review's specified clamp exactly.
- The six `if/else if` dispatch guards are untouched, as the review required.

**2. Regression-verified, not just code-traced.** A 9-case deterministic harness (extracting `parseRecipeText` + its real dependencies from `app.js` and running them in isolation) covers the original 4 acceptance-criteria cases plus 5 new cases targeting exactly these two findings: a `Calories: 99999999` line clamps to `99999`; a line with `__proto__: 5` / `constructor: 9` keys produces no own-property pollution on the result and does not touch the global `Object.prototype`; a recognized key after unrecognized ones still parses. All 9 pass. Playwright `smoke` + `button-smoke` also pass (467 buttons, 0 broken), run twice — once on the fixed `task-025` branch, once again after the `git apply --3way` onto main.

**3. No unrelated changes.** `git diff origin/main -- app.js` (pre-apply) was exactly the original 39-line feature plus these 2 patches (6 lines) — nothing else in `parseRecipeText` or elsewhere in `app.js` was touched. Same file-scope discipline as the original acceptance criteria (`app.js` only).

**4. Why re-applied instead of merged.** Same precedent as TASK-007: the `task-025` branch forked before TASK-014/016/026+ and a large batch of automation/ops work landed on `main`, so merging the branch directly would drag in unrelated stale state and likely conflict. The isolated `app.js` hunk (with the fix on top) applied cleanly via `git apply --3way` with zero conflicts.

**5. Risk-gate.** This task touches only `parseRecipeText()` in `app.js` — parsing logic, no Firestore write-guard, no `saveData()` call site, no auth. Per D-032, qualifies for `done` (auto-merge), consistent with the original review's own risk-gate call once the security findings were actually resolved.

### Disclosed limitation
Claude both authored this specific 2-line patch and reviewed it (no independent third pass), same disclosed caveat as TASK-014/016. Unlike those, this is NOT an automation-surface task (Hard Rule 10 doesn't apply here), the patch is a small, exactly-specified, mechanical fix matching a prior independent Guardian Gauntlet's own instructions verbatim, and it was verified with new regression tests targeting precisely the two findings — not just re-asserted by the same reviewer. Judged sufficient to land at `done` rather than holding for a further human pass.

→ TASK-025 status set to `done` in TASKS.md.

## Review TASK-032 — APPROVED, HELD (automation-surface fix for the TASK-025 stuck-state gaps)
branch: task-032
verdict: approved (red-zone, held for human `/merge`)

### Context
Directly caused by TASK-025's own incident: a rework-retry that silently changed no code, and a crashed re-review that then left the task stuck in a shape neither `/review` nor `/go` could actually resume, despite the task's own note claiming both would work. This task closes both gaps at their root in `tools/Run-Codex-Build.ps1` and `tools/Dispatch-Commands.ps1`.

### Findings
**1. No-op-build guard — correct.** `Run-Codex-Build.ps1`'s new check (`$hasEvidence`) requires `CHANGELOG.md` or `TEST_REPORT.md` to appear in `$changed` before a build reaching `status: review` is allowed to auto-chain into review. This is a direct, general enforcement of AGENTS.md's own mandated evidence steps — not special-cased to rework retries, so it also catches a fresh build that skips evidence-recording for any reason. Verified against the exact TASK-025 shape (`$changed` = `TASKS.md` only) plus 4 other fixture cases — all correct.

**2. Shared classifier — correct, and caught a real latent bug in the process.** Consolidating the build-loop's inline APPROVED/REWORK/else classification into `Resolve-ReviewOutcome` (so the new pending-review-resume path can't drift from it) surfaced that the old inline check would have matched the literal word "APPROVED" inside Run-Claude-Review.ps1's red-zone "APPROVED but HELD" message and incorrectly marked that task `done` on main — even though `main NOT changed` is explicit in that same message. This never manifested in production (Codex-built tasks reaching a HELD verdict haven't yet occurred through the automated path), but it is a real, previously-undetected correctness gap in the exact function this task is fixing. Now checked and routed to `status: approved` before the generic `APPROVED` match.

**3. Crashed-review handling — correct, and matches Run-Claude-Review.ps1's own stated intent.** Run-Claude-Review.ps1's crash path already says (in its own comment) that a bare engine failure "stays `status: review`, which is already a valid 'try me again' state." The bug was that `Invoke-Autopilot` never mirrored that state onto `main` — it unilaterally overwrote it to `blocked` with an unmatched note. The new `Resolve-ReviewOutcome` case detects the exact text Run-Claude-Review.ps1 emits on crash and sets `status: review` on main instead, with no strike cap (deliberate — this is transient infra flakiness, not a task defect, so capping it would misclassify the failure type).

**4. Pending-review-resume step — correct placement and gating.** Added before the "plan once" and "idle audit" steps, and the build loop below is now gated on `-not $built` so it never double-spends the one-mission-per-`/go` budget. `$waiting`/`$built` initialization was moved up to before this new step (single declaration, verified via grep — no duplicate).

**5. Summary wording fix.** `RETRYING:` vs `NEEDS YOU:`, keyed off the new `.NeedsHuman` field, correctly excludes only the crash-retry case (the one case where no human action is needed) — REWORK, no-op, HELD, and generic-blocked all still correctly report `NEEDS YOU:`.

**6. Verification.** Both files parse clean. `Resolve-ReviewOutcome` verified via an isolated fixture harness (real dependencies, `Publish-TasksChange` stubbed) — 7 cases / 16 assertions, all pass, including the two hardest cases (HELD-not-done, and strike-increment-from-existing-note). The `$hasEvidence` guard verified via 5 fixture cases. No live end-to-end run (would require a real crashed `claude -p`/`codex exec` process) — honestly disclosed as unverified in TEST_REPORT.md rather than claimed.

### Risk-gate
Automation/OS-surface (Hard Rule 10, D-023): solo, never chained. Touches `tools/Dispatch-Commands.ps1` and `tools/Run-Codex-Build.ps1` directly — the AI Dev OS's own automation. Per D-032 this is red-zone regardless of how mechanically verified the diff is: held at `approved`, `main` NOT changed. Same disclosed same-session caveat as TASK-014/016/031 (Claude both built and reviewed this specific diff) — mitigated here by the isolated fixture harness giving independent-of-the-author verification of the actual behavior, not just a second read of the same code.

→ TASK-032 status set to `approved` in TASKS.md. Land with `/merge TASK-032` then `/merge TASK-032 yes`.

## Review TASK-033 — APPROVED, HELD (ported digest-length + stale-lock fixes from ChronaSense)
branch: task-033
verdict: approved (red-zone, held for human `/merge`)

### Context
Same-session mirror of TASK-032, in the opposite direction. While working the ChronaSense app (a sibling project, same developer, same AI Dev OS template), two live reliability bugs surfaced: an unbounded digest that failed Telegram delivery outright once enough proposals piled up, and a 2-hour, silent stale-lock wait that let a genuinely hung process block the queue for 48+ minutes undetected. Ported both fixes back here since this app shares the identical `tools/Generate-Digest.ps1` / `tools/Dispatch-Commands.ps1` template — the same latent bugs exist here, just haven't fired yet given this app's currently-small proposal count.

### Findings
**1. Digest length cap — correct, verified against this app's own real data.** `Generate-Digest.ps1` now tracks cumulative length while adding proposal groups/items and stops before a 3700-char threshold, appending a truncation note rather than cutting the raw string. Run against this app's actual `planning/PROPOSALS.md`: output is 530 chars, identical to what pre-fix logic would have produced at this size — the fix is provably a no-op until content actually approaches the limit, not a behavior change for the common case.

**2. Stale-lock + `/status` fix — correct, verified by direct comparison rather than re-derivation.** Since this is a straight port, verification was done by diffing the new logic against ChronaSense's own `task-002` branch (byte-for-byte identical) rather than re-running an app-agnostic fixture test a second time for no new signal — that branch already passed 4 fixture cases covering the exact decision boundary (44 vs 46 minutes). Same conservative design carried over: clears the lock file on a confirmed-dead or confirmed-stale-with-still-alive-PID lock, never auto-kills the process, and now surfaces the wait via a real Telegram notice instead of `Write-Host` output nobody watching a scheduled task would see.

**3. `/status` lock-age addition — small, correct, directly closes the "how do I know what's happening" gap.** Previously `/status` reported only "BUSY" with no duration; a human checking mid-hang would have seen the same output as checking during a completely normal run. Now reports elapsed minutes using the same `LastWriteTime` check the stale-lock fix itself relies on.

### Verdict
Gate picked: `approved` (red-zone: touches `tools/Generate-Digest.ps1` and `tools/Dispatch-Commands.ps1` directly — the AI Dev OS itself). Same disclosed same-session caveat as TASK-014/016/031/032 (Claude both built and reviewed this diff) — mitigated by testing against this app's own real data plus a direct diff against an independently fixture-tested source, rather than a second read of the same code.

→ TASK-033 status set to `approved` in TASKS.md. Land with `/merge TASK-033` then `/merge TASK-033 yes`.

## Review TASK-034 — APPROVED, HELD (per-task scope note, soft gate)
branch: task-034
verdict: approved (red-zone, held for human `/merge`)

### Context
Prompted by comparing this OS against `github.com/cathrynlavery/codex-build`, a similar
Claude-orchestrates/Codex-builds skill. Its `check_scope.py` mechanically fails a run if a task
touches a file outside its own declared allowlist. This repo already has `Run-Codex-Build.ps1`'s
`$deniedPatterns` deny-list, but that's a repo-wide "never touch the OS itself" guard, not a
per-task check — a task declaring `files: app.js` that also edits `style.css` passes the deny-list
untouched (CSS is legitimate app-code surface) with nothing flagging the extra touch was never
requested. The user explicitly asked for this to be a soft gate, not a hard block, after weighing
the tradeoff: an adjacent-file touch is sometimes a legitimate dependency, and a rigid fail-closed
check would trade silent scope creep for false-positive blocks needing manual intervention.

### Findings
**1. Detection logic — correct, and scoped to what it should check.** `Get-TaskDeclaredFiles`
parses a task's `files:` field (single-line and the multi-line-continuation form several real
entries in this file actually use), stripping `(new)` annotations. The out-of-scope computation
correctly unions declared files across every tracked task in the invocation (not just the first),
which matters for Sprint Execution Mode's chained-task case — checking only the first task's
declared list would have false-flagged files a LATER chained task legitimately owns.

**2. Soft-gate design — matches the explicit requirement.** A mismatch never blocks the build,
never marks a task blocked, and never touches the build's own exit code. It only writes an
advisory note, consumed once by the review step. This is the right shape for a heuristic that can
have legitimate false positives (a shared import, a companion test file) — a hard gate here would
have recreated the exact "guesswork that blocks real work" problem this session has spent most of
its effort removing elsewhere (D-051's no-op/crash-resume fixes), just relocated to a new surface.

**3. Cross-task-ID leak prevention — correctly handled, and tested for it specifically.** The
handoff file is prefixed with the task ID(s) it applies to; `Run-Claude-Review.ps1` only uses it if
the task currently under review is named there, and unconditionally deletes the file after
reading — match or not — so a note from an unrelated earlier run can never attach to the wrong
task, and a discarded note can't linger to confuse a later one either. Verified directly (6/6
fixture assertions covering exactly this: matching ID, one-of-several IDs, unrelated stale ID,
delete-on-both-paths, missing-file).

**4. Reviewer-facing wording — appropriately hedged.** The injected prompt text explicitly labels
the note "mechanically detected... not a verdict" and asks the reviewer to judge legitimate vs.
scope creep, rather than phrasing it as an accusation — keeps the model doing the judgment call
the check itself deliberately doesn't make.

**5. Verification.** Both files parse clean. Two isolated fixture harnesses (file/scope parsing:
8/8; note round-trip: 6/6), 14 assertions total, all pass. No live end-to-end run — a real build
that genuinely touches an undeclared file, verified to actually surface in a real REVIEW.md entry,
remains outstanding; honestly disclosed in TEST_REPORT.md rather than claimed.

### Risk-gate
Automation/OS-surface (Hard Rule 10, D-023): solo, never chained. Touches
`tools/Run-Codex-Build.ps1` and `tools/Run-Claude-Review.ps1` directly — the AI Dev OS's own
automation. Per D-032 this is red-zone regardless of how mechanically verified the diff is: held
at `approved`, `main` NOT changed. Same disclosed same-session caveat as TASK-014/016/031/032/033
(Claude both built and reviewed this diff) — mitigated by the isolated fixture harnesses giving
independent-of-the-author verification of the actual branching behavior, not just a second read of
the same code.

→ TASK-034 status set to `approved` in TASKS.md. Land with `/merge TASK-034` then
`/merge TASK-034 yes`.

<!-- Entries go here, newest first. -->

<!-- REVIEW TEMPLATE — copy and fill:

## Review TASK-<id> — <APPROVED | REWORK>
branch: task-<id>-<slug>
verdict: approved OR changes requested

### Must-fix (Codex must address before approval)
- [ ] item

### Nits (optional, Codex's call)
- item

→ task status set to `approved` / `codex` in TASKS.md

-->
