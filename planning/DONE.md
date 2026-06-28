# Done — completed work log

> Append-only. The agent adds an entry here at **Task Completion** (newest at top). Full diffs live
> in `git log`; this is the human-readable "what shipped and when". Prune freely — git is the archive.

- ✅ BQ-001–BQ-006 sprint — bulk add parser (no-comma format), pantry card stays open on edit, storage guide hides for unrecognized items, recently added at top, bulk add expiry date field, unit input datalist (2026-06-27)
- ✅ BQ-001 — Price Book subtitle reframed as personal price reference (honest expectations; no store-compare promise) (2026-06-27)
- ✅ BQ-002 — Dashboard renders on first open: added `renderDashboard()` to signed-out, Firebase-unavailable, and `loadUserData()` init paths (2026-06-27)
- ✅ BQ-003 — Recipe JSON import fixed: replaced `confirm()` (silently blocked in iOS PWA) with `showConfirmDialog()`; shows recipe count in dialog body (2026-06-27)
- ✅ BQ-004 — Duplicate pantry name: `addToPantry()` now asks "add another?" via `showConfirmDialog()` instead of silent skip (2026-06-27)
- ✅ P2 Task 3 — Dismiss suggested grocery items: ✕ button, `suggestDismissed` pantry flag, skip re-add, auto-clear on restock (2026-06-25)
- ✅ P2 Task 2 — "Suggested" amber badge on auto-suggested grocery items (`.grocery-suggested-badge`, tooltip = reason) (2026-06-25)
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
