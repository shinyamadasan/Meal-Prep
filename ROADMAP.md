# Meal Prep Planner — Roadmap

**Strategic** — this file is for the human to set priority. Vision/scope live in
[docs/PROJECT.md](docs/PROJECT.md); the **active** task lives in [TASK.md](TASK.md).

## How the active task flows (autonomous sessions)
The agent does **not** pick from this roadmap. It works the single task in `TASK.md`. When that task
is done it updates `STATUS.md` and **promotes the top item of the Task Queue below into `TASK.md`**
(mechanical FIFO). You control priority by ordering the queue.
1. Do the task in `TASK.md` (meet its Success Criteria).
2. Update `STATUS.md`; mark it ✅ in **Done** below (newest at top; prune old — git has history).
3. Promote the top **Task Queue** item into `TASK.md`. If the queue is empty, stop.

---

## Task Queue (Now / Next / Later)

Prioritized; top item is promoted next. Each entry: one-line outcome + success criteria.

*(empty — add prioritized tasks here)*

---

## Known Issues & Debt

Bugs, gaps, and dead code. Fixing one = delete it here (note it in the git commit).

### Bugs / broken
- **Family sharing acceptance flow** — invitations write to `familyInvitations` but there's no UI to
  accept; `status` stays `pending` forever. (Feature is Hidden anyway.)
- **Sentry inactive** — code loads only when `SENTRY_DSN` is set; it's empty.

### Gaps
- **USDA `DEMO_KEY` rate limit** — ~1000/hr/IP, no retry or user-facing message (DECISIONS D-007).
- **Snack serving scaling** — snacks use the recipe's global `currentServings`; no per-slot override.
- **Prep Mode** — no batch-cook ingredient aggregation across the week's recipes.
- `LOCAL_NUTRITION_DB` still missing some common Filipino ingredients.

### Dead / orphaned code
- **`#storage` tab** — full UI + `renderStorageGuide()` but no nav button (superseded by Inventory).
- **Orphaned pantry reads** — `addToPantry()` still calls `getElementById` on the removed
  `#pantry-qty-input` / `#pantry-storage` (resolves null, no crash).
- **`colorScheme` localStorage key** — read on load, never written (no dark-mode toggle exists).
- **`recipe.highlights`** — rendered as tag chips but no edit-form input to set it.
- **`printGroceryList()`** — defined, no button wired.
- Hidden features: Family Sharing modal, Community Feed / `sharedRecipes`.

---

## Do Not Work On

- Dark mode toggle (more problems than value — see DECISIONS "Do Not Work On" rationale).
- Community feed / family sharing features.
- PWA manifest or offline-mode changes (service worker is intentionally minimal).
- UI redesign beyond what a task specifies.
- New sample recipes.
- USDA API changes.

---

## Done (recent — full history in git log)

- ✅ Pantry add row simplified; ingredient browser modal (2026-06-24)
- ✅ Weekly nutrition totals, grocery A→Z sort, recipe detail scaler, bulk pantry add, cook history (2026-06-23)
- ✅ Recipe favorites, buy-it button, global error handler, Mung Beans, text search, bug fixes (2026-06-22)
- ✅ Password reset, expiry suggestions, grocery→pantry transfer, paste-parser confidence, Filipino nutrition entries (2026-06-22)
- ✅ Phase C — pantry auto-deduction on cook (`markRecipeCooked()` → `deductIngredientsForRecipe()`) (2026-06-22)
