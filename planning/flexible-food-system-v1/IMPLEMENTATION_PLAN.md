# Flexible Food System V1 — Smallest Useful Implementation Plan (PROPOSAL)

**Status (2026-11-25): wave 1 APPROVED by owner** (FFS-0/1/2 → TASK-080/081/082; FFS-3 prepared as
wave 2 → TASK-083). FFS-4 revised (rev 2) and awaiting approval. FFS-5 pending. **Owner deploy hold:
nothing merges to `main` or deploys without explicit owner approval.** FFS-1 was revised: no universal
60-day cutoff; per-food-class, three separate signals (D-087).

**Author:** Claude (PM/Tech Lead), 2026-11-25.

**Inputs:**
- [KNOWLEDGE_BASE.md](KNOWLEDGE_BASE.md)
- [CAPABILITY_AUDIT.md](CAPABILITY_AUDIT.md)
- [GAP_ANALYSIS.md](GAP_ANALYSIS.md)

## Smallest useful outcome

> On any day, with no plan:
> 1. Home suggests meals and snacks from food we **really** have.
> 2. Each suggestion says what would make it a balanced plate.
> 3. Shop shows a short "fill the gaps" list based on Kylie's no-plan template.
>
> All of this uses data already in the app. There is no new tracking, no new tab, and ChronaSense
> is untouched.

## Proposed slices (in build order)

Each slice is one `TASKS.md` task with its own branch, its own Codex build, and an independent
Claude review.

### FFS-0 — Truthful availability (read path) — **Risk: Medium, merge `done`**

Make the "do we have it?" checks honest. Change only the *read* side:
- `isInPantry`
- `findPantryMatch`
- `pantryMatchesForShop`
- `groceryItemChecked`
- `getExpirySuggestions`

Rules:
- A lot counts as available only if all of these hold:
  - `stockLevel !== 'empty'`
  - quantity is not `<= 0`; `null` quantity counts as "unknown, assume have" (current behavior)
  - not past expiry (raw food)
- Expired raw items move from suggestions to the Attention list.
- Name matching uses whole words, with an explicit alias list, so "Rice" no longer satisfies
  "Rice Vinegar".
- **No record is written or changed.** The display just stops trusting bad records.

Acceptance criteria:
- Audit F1 and F2 repro cases pass as regression tests.
- `npm test` and `npm run test:ledger-contract` pass.

Closes **G0** (read side) and audit F1/F2.

### FFS-1 — Stock health report (read-only) — **Risk: Low, merge `done`**

Add a collapsed "Stock health" section under the Fridge/Pantry header. It counts and lists records
by issue (I-1 to I-8):
- expired but marked ok/full
- quantity ≤ 0 or null
- mixed units across same-name lots
- empty staples
- not updated in more than 60 days

It has **no edit, delete or fix buttons** and makes no `saveData()` call. A test asserts that
rendering it leaves `AppState` byte-identical.

Closes **G9** and gives the owner the investigation they asked for, against live data.

### FFS-2 — No-plan grocery: "Fill the gaps" — **Risk: Low, merge `done`**

Add a card on Shop: **"No plan this week? Fill the gaps."**
- A static `NO_PLAN_TEMPLATE` maps roles to target counts and rules:

  | Role | Target | Rule |
  |---|---|---|
  | protein | 4 | ≥1 low-prep, ≥1 plant |
  | veg | 4 | — |
  | starch | 3 | ≥2 whole-grain |
  | fruit | 3 | — |
  | snack | 3 | — |
  | flavor | 3 | — |
  | drink | 1–2 | — |

- Roles come from `INGREDIENT_DB.category` (Protein, Vegetable, Grain, Fruit) plus a small keyword
  map for snack, flavor and drink.
- The card counts the **available** items per role (using FFS-0) and shows only the shortfall.
  Each suggestion is a known `INGREDIENT_DB` item not currently in stock, preferring the book's
  examples and convenience forms (frozen, precut, canned).
- "Add" and "Add all" use the existing grocery-add path. Nothing is auto-added.

Closes **G1**.

### FFS-3 — Balanced Plate and Snack Pack hints — **Risk: Low, merge `done`**

- A pure function `plateGaps(recipeOrReadyItem)` returns the missing roles: produce, protein, carb,
  fat.
  - It uses `mealBalance` where present.
  - Otherwise it infers roles from ingredient categories.
- Each card in "What should we eat?" and "Ready to eat" gets one quiet line: "Make it a plate: add
  frozen broccoli". The suggestion must be **an item in stock**; if none is, the line is omitted.
- A **Snack Pack** row in Quick Eat offers up to 3 pairs from stock, covering ≥2 of the 3 groups
  (fiber-carb, protein, fat).
- Copy uses the "add, not subtract" tone. No scores and no warnings.

Closes **G2** and **G3**.

### FFS-4 rev 2 (2026-11-25, owner revision) — Private cookbook recipes, usable while cooking — **Risk: High, merge `approved` (held)** — AWAITING OWNER APPROVAL

**Owner requirement:** selected cookbook recipes are usable directly inside our private household
app, so we don't have to open the PDF every time we cook. Each recipe carries:
- ingredients
- **verified** quantities
- cooking instructions
- the source reference
- original/adapted status

Copyrighted content stays **out of the public repository and the public app bundle**.

**How it stays private.** The app's code is public (GitHub Pages), but each user's recipes are not.
Recipes live in the signed-in owner's Firestore document (`users/{uid}`, already locked to that uid
by the security rules) and in that browser's localStorage. So the full recipe text travels only as
**household data**, never as **app code**:

```
book (print/PDF, private)
  → Claude drafts a recipe JSON from the scans (every quantity flagged "unverified")
  → owner verifies quantities against the printed page (checklist; OCR fractions are unreliable)
  → private file kept OUTSIDE the repo: Desktop\Meal-Prep-private\cookbook\so-easy-so-good.private.json
  → owner imports it while signed in via the EXISTING Import JSON path (More → Import)
  → stored in users/{uid} + local cache; it never enters git, app.js, index.html or sw.js
```

**Code changes (public, content-free):**
1. Optional Recipe fields, additive, patched on load (Hard Rule 4):
   ```
   source: { book, author, page, kind: 'original' | 'adaptation',
             verifiedAt: 'YYYY-MM-DD' | null, adaptedFrom: <recipe id> | null }
   adaptationNotes: string
   ```
2. **Originals are preserved.**
   - A recipe with `kind: 'original'` opens read-only for content edits; favorite and plan actions
     still work.
   - "Make our version" duplicates it into a new `kind: 'adaptation'` recipe with
     `adaptedFrom` = the original's id. The adaptation is freely editable, and its changes are
     written in `adaptationNotes`.
   - Both appear in the recipe list with badges: "📖 So Easy So Good p. 163" and "Our adaptation".
3. Import and export keep the new fields. Imported text stays inert (existing D-084 escaping).
   "Unverified" recipes show a small "quantities not yet verified" note.
4. The existing cook-mode/recipe-detail view shows ingredients (scaled) and instructions. That is
   already enough to cook without the PDF. No new screen.
5. **Guards against leaks:**
   - `.gitignore` gets `*.private.json` and `private/`.
   - A repo test fails if any `*.private.json` is tracked, or if `app.js`, `index.html` or `sw.js`
     contain cookbook instruction text. The test checks a short canary list of distinctive
     phrases, kept in the test as hashes rather than text.
   - The selected cookbook recipes are never seeded into the starter pack and never added to the
     public recipe list.

**Content workflow (data, not code):**
- The owner picks the recipes. My suggested starting set favors versatility and low effort:
  - Five-Minute Sesame Garlic Tofu
  - Sriracha Honey Tofu Bowls
  - Blackened Fish Taco Bowls
  - Honey-Soy Glazed Salmon with Broccolini
  - Sweet & Sticky Chicken
  - Italian One-Pot Chicken Pasta
  - Warm Lentils with Cauliflower
  - Southwestern Black Bean & Corn Soup (freezer)
  - Veggie Bean Chili (freezer)
  - Gochujang Bean & Egg Burritos (freezer)
  - Soy Garlic Marinated Eggs
  - Garlicky Roasted Chickpeas
- Each recipe is tagged with:
  - `equipment`, `effort`, `activeTime`, `tags` (batch-friendly, freezer-friendly, cook-fresh, minimal-cleanup)
  - `mealBalance`

  This lets the same recipe surface in Meal Prep, Cook Now and Quick Eat.
- Verification is a human step. A recipe gets `verifiedAt` only after the owner confirms its
  quantities against the printed page. Known OCR gaps (missing pp 179–80; Chicken Taco Salad Jars
  dressing) are excluded until the book is checked.

**Acceptance (draft):**
- Old recipes load unchanged.
- Originals can't be content-edited; adaptations can.
- Import/export round-trip keeps `source` and `adaptationNotes`.
- The leak-guard test is green.
- No cookbook text appears in any tracked file.
- `npm test` and `npm run test:ledger-contract` are green.
- Merge is held for the owner (Firestore-synced recipe shape, D-032).

### FFS-4 (rev 1, superseded) — Recipe source and adaptation + private-safe cookbook reference pack

- Add optional Recipe fields (additive; old recipes are unaffected):
  - `source: { book, page, kind: 'original' | 'adaptation' }`
  - `adaptationNotes: string`
- Patch these in `patchMissingNutrition` per Hard Rule 4.
- The recipe card shows "📖 So Easy So Good p. 163" and an "Our adaptation" badge.
- **Reference pack (opt-in, D-063 pattern)** contains, per book recipe:
  - title, page and category
  - equipment, effort, tags and plate roles
  - an ingredient **name** list (no quantities) for pantry matching
  - instructions: "See book p. N"

  It contains no verbatim text. The owner can then type in their own quantities and instructions as
  an `adaptation`.
- Needs `docs/DATA_MODEL.md` and a D-0NN decision.

Closes **G4**.

### FFS-5 — Versatility and hands-off ranking — **Risk: Low, merge `done`**

- `ingredientVersatility(name)`: the number of recipes × distinct methods × plate roles that use the
  ingredient. It is computed and never stored.
- Used to order FFS-2 suggestions.
- `recipeIsHandsOff(recipe)` is derived from equipment.
- Both are used as a tie-breaker in the Cook Now ranking.

Closes **G5** and **G6**.

### Deferred, not in V1

These are red-zone stock **writes** and become a solo High-risk task after V1, as the audit
recommends:
- Audit **F3/F4** quantity-merge and deduction math.
- **F9** empty-staple restock.
- **F8/F10** plan/batch consistency.

## Smallest-first recommendation

If the owner wants only one wave, approve **FFS-0 + FFS-1 + FFS-2**:
- truthful stock
- visibility into stale records
- the book's no-plan grocery list

That wave delivers the core of "eat well without a plan" in about 3 small tasks, all merge-reversible.

## Workflow (existing builder and reviewer loop)

1. **Owner** approves or edits the proposals PROP-035 to PROP-040 in `planning/PROPOSALS.md`. They
   are deliberately marked `Decision: Clarify` so D-042 auto-promotion cannot schedule them.
2. **Claude** moves approved items to `planning/ROADMAP.md` and `planning/BUILD_QUEUE.md`, updates
   `PLAN.md`, and writes Ready `TASKS.md` entries (`status: codex`). Each entry has objective,
   files, acceptance criteria, constraints and verification. **Solo execution, no chaining**, because
   FFS-0 is Medium and FFS-4 is High.
3. **Codex** builds each task on `task-<id>`, runs `npm test` and `npm run test:ledger-contract`, and
   appends to `CHANGELOG.md` and `TEST_REPORT.md`.
4. **Claude** reviews independently in `REVIEW.md`:
   - FFS-0/1/2/3/5 → `done` (auto-merge).
   - FFS-4 → `approved` (held for owner merge).

## Open questions for the owner

1. **Approve which wave?** The recommendation is FFS-0 → FFS-2 first.
2. **Reference pack and copyright.** Metadata only, with "See book p. N", is proposed. Is that
   enough, or should cookbook content stay out of the app entirely, so that only recipes the owner
   types in carry a `source`?
3. **Stale-record threshold** for FFS-1. 60 days without update is proposed.
4. **Read-only live inventory check now?** If yes, export a backup JSON or run MCP `get_inventory`,
   and Claude will classify it offline with no writes.
