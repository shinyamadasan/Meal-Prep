# Done — completed work log

> Append-only. The agent adds an entry here at **Task Completion** (newest at top). Full diffs live
> in `git log`; this is the human-readable "what shipped and when". Prune freely — git is the archive.

- ✅ P2 Task 1 — `suggested: true` + `suggestedReason: 'low stock'` flag on auto-suggested grocery items (`syncStapleToGrocery`, `checkAndReplenishLowStock`) (2026-06-25)
- ✅ Alpha P1 — one onboarding gate: Help modal no longer auto-opens on first run when Kitchen Setup Wizard fires (`pantryOnboardingDone` gate in `initApp()`) (2026-06-25)
- ✅ "Sample" badge on the 26 seeded recipes (`isSampleRecipe()`, Job #3 clarity) (2026-06-25)
- ✅ Product prompts PP1–PP7 added to PROMPTS.md (Engineering + Product sections); part of AI Dev OS v1.0 (2026-06-25)
- ✅ Alpha quick wins — pantry add-feedback toasts + Price Book heading naming fix (2026-06-25)
- ✅ Pantry search — filter the kitchen by name (`#pantry-search`, Job "did I already buy X?") (2026-06-25)
- ✅ Live recipe count on the Cook tab (`#recipe-count`, updates with search/filter) (2026-06-25)
- ✅ Firestore write guard — stop cloud-data wipe on deploy/reload (`AppState.cloudReady`) (2026-06-25)
- ✅ Pantry add row simplified; ingredient browser modal (2026-06-24)
- ✅ Weekly nutrition totals, grocery A→Z sort, recipe detail scaler, bulk pantry add, cook history (2026-06-23)
- ✅ Recipe favorites, buy-it button, global error handler, Mung Beans, text search, bug fixes (2026-06-22)
- ✅ Password reset, expiry suggestions, grocery→pantry transfer, paste-parser confidence, Filipino nutrition entries (2026-06-22)
- ✅ Phase C — pantry auto-deduction on cook (`markRecipeCooked()` → `deductIngredientsForRecipe()`) (2026-06-22)
