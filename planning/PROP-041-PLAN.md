# PROP-041 — Conversational Food Management: smallest implementation plan

Status: **Phase 1 built and approved (held) 2026-11-27; release prepared, awaiting owner approval
(`planning/PROP-041-P1-RELEASE.md`). Phase 2 PRIORITISED 2026-11-27 (owner) — four items, separate
track (see "Phase 2 — owner priorities"). Phase 3 not approved.** · track: separate from FFS-V1 (released)
Owner direction approved 2026-11-26 (chat). Nothing here is built or deployed without approval.
Source audit: `planning/PROPOSALS.md` PROP-041.

## Principles (binding for every task)
- **Reuse, don't re-derive.** The bridge must give the same safety and matching answers as the app.
  Pure logic moves to `shared/` as classic scripts on `globalThis` (the `shared/readyFoodContract.js`
  pattern already loaded by both the app and the Worker). No framework, no build step, no new service.
- **Keep every existing guard.** `expectedRevision` + Firestore `updateTime` precondition, one guarded
  write per request, explicit tombstones, ids only from reads (no fuzzy ids), `ambiguous` refusal,
  single-owner OAuth until Phase 3 changes it deliberately.
- **Chat recommends only food the app calls usable.** Unknown safety information = not usable.
- **Routine explicit requests: one call. Ambiguous: clarify. Bulk destructive: preview + confirm +
  recoverable.**
- All tasks are High risk (D-032 red zone): solo build, independent review, `approved` (held) merge,
  Worker deploy only on owner approval. The app side (`shared/` extraction) ships only after V1.

## Phase 1 — Safety and reliability (safety-critical; do first, ship together)

| Task | What | Why it is safety-critical |
| --- | --- | --- |
| P1-1 Shared safety core | Move `INGREDIENT_DB` data and the pure safety functions (`FRIDGE_SAFETY_LIMITS`, `pantryFridgeSafety`, `pantryDateSignal`, `pantryLotAvailable`, `cookedShelfLife`, `cookedDateSignal`, `stockFoodClass` and their inputs) into `shared/` unchanged. App loads them by `<script>`; Worker imports them. Functions take `today` as an argument. Parity test: same cases, same verdicts, browser and Node. | One source of truth for "safe to eat"; no second rule set to drift. |
| P1-2 Truthful reads | `get_inventory` / `get_ready_food` add `purchaseDate`, `expiryDate`, `printedDateKind`, `category`, `storage`, and `safety: {status, reason, label, daysLeft, usable}` from P1-1. Household calendar day from a configured household time zone (owner decision). Descriptions: "never suggest `usable:false`; unknown = not usable". Fix the `record_ready_food` freshness wording (audit C3). | Closes audit C1: chat can no longer call unsafe or unknown food available. |
| P1-3 No duplicate writes | Every write tool takes a required `requestId`. One atomic Firestore `commit`: the guarded user-document update plus a create-only `users/{uid}/mcpRequests/{requestId}` record (precondition: must not exist). A replay returns the stored result and changes nothing. The record holds actor, tool, revision before/after, and a snapshot of any record removed. A subcollection, because the app saves the user document with a full overwrite. | Retries after timeouts can no longer double-add or double-consume. |
| P1-4 Safe merges | `add_stock` uses P1-1: refuse merging into a lot that is not `usable` or is unknown, and refuse merging raw fridge protein bought on a different day ("record as a new lot"). Remove the bridge's own category-default freshness check. | Closes audit C2: new food never inherits an older or unsafe lot's clock. |
| P1-5 Recovery | `undo_request(requestId)`: restores the snapshot from P1-3 under a revision check, refusing if the affected records changed since; clears their tombstones the same way the app's restore does (D-083). | Chat removals become recoverable, like app removals. |

Exit gate: worker suites, ledger contract, full app suite, parity test, and a live read-only check
in ChatGPT. Phase 1 changes no user-visible app behaviour.

## Phase 2 — Everyday inventory (convenience; built on Phase 1 guards)

| Task | What | Safety notes |
| --- | --- | --- |
| P2-1 Register items | `add_pantry_item`: name, quantity, unit, storage, bought date (default: household today), staple flag and level, printed date and kind. Covers prepared ingredients (e.g. *Frozen Minced Garlic*, storage freezer). If an active same-name lot with the same date and storage exists, return `ambiguous` with both choices. | Create-only; idempotent via P1-3. |
| P2-2 Edit items | `update_pantry_item`: storage, bought date, printed date and kind. Moving raw protein freezer→fridge returns the thaw reminder; an explicit `thawedToday` sets the bought date. | Safety verdict recomputed in the result. |
| P2-3 Staple levels | `set_stock_level`: full / ok / low / empty. Existing `mark_in_stock` / `mark_out_of_stock` stay as compatible aliases. | Low/Empty reach Shop via the app's TASK-090 sync. |
| P2-4 Conversions without double-counting | `convert_stock`: consume raw lot(s) and create the prepared lot in one write. `record_ready_food` gains an optional explicit `consume` list (ids + amounts) applied in the same write. | One write = no window where both raw and prepared are counted. |
| P2-5 Ready food | Move a leftover between fridge and freezer (existing `consume_ready_food` unchanged). | Fridge clock follows the app's rules. |
| P2-6 Multi-operation requests | `apply_changes`: up to 10 operations from P2-1..5 and the existing deltas, one `requestId`, one `expectedRevision`, all-or-nothing. Any removal of more than one record requires `dryRun` first, then a confirmation token matching that preview. | Bulk destructive changes: preview, confirmation, snapshot (P1-5 undo). |

## Phase 3 — Food assistance (convenience; reuses app logic)

| Task | What |
| --- | --- |
| P3-1 Shared matching | Move ingredient matching, Cook-now tiers, effort/quick filters, Balanced Plate, Fill the gaps and Shop consolidation (TASK-090 B2) into `shared/`, with parity tests. |
| P3-2 Recommendations | `get_cook_options(mode: instant / quick / meal-prep)` and `get_fill_the_gaps`: the app's own answers, using usable food only. No separate engine. |
| P3-3 Shop list | `get_shopping_list`, `add_shopping_items`, `check_off_items` (adds to the Fridge the way the app does), `remove_shopping_item`; app consolidation rules. |
| P3-4 Cook a recipe | `record_cooked_recipe(recipeId, multiplier, portions)`: deducts like the app's **Cooked** button, in one write. |
| P3-5 Two household members | Allow-list of two OAuth subjects mapped to the one household document; per-person tokens and revocation; actor recorded per request (P1-3). |

## Owner decisions (2026-11-26) and Claude's challenges
| # | Owner decision | Challenge / refinement (adopted unless the owner objects) |
| --- | --- | --- |
| 1 | Time zone Asia/Manila | Agreed. One Worker setting (`HOUSEHOLD_TIME_ZONE`), not per person. It replaces the bridge's current UTC ±1-day skew guard, which becomes unnecessary. |
| 2 | Duplicate-write records kept 30 days | Agreed, and simpler: the duplicate-write record and the undo snapshot are the **same** record (P1-3), so one 30-day retention covers both. Expiry through a Firestore TTL policy on an `expireAt` field (one-time setting, no code); fallback: prune expired records inside each write. |
| 3 | Undo / recovery 30 days | Agreed, with one safety limit: undo restores only while the affected records are unchanged since that request (or, for a removed record, still absent with its id unused). A 3-week-old undo over later edits is refused, not forced. |
| 4 | AI may create and edit records on explicit instruction | Agreed. Defaults are stated back in every reply ("bought today, stored in Freezer"). A missing storage location is inferred the same way the app does. A missing date on raw meat is never invented: it defaults to today only when the user said "bought today" or "just bought"; otherwise chat asks. |
| 5 | Individual removals recoverable | Covered by P1-3 + P1-5. Stronger than the app's single-slot local backup. |
| 6 | Removing 2+ distinct records needs confirmation; consumption and grocery logging are not bulk | Agreed, with two clarifications. (a) Consumption that empties a non-staple removes it; that stays routine (no confirmation) but is undoable. (b) A confirmation rule per request can be sidestepped by many one-item requests, so tool descriptions require chat to group removals into one `apply_changes` call, and every removal is undoable regardless. A time-window counter was considered and rejected as more complex than undo. |
| 7 | Both members individually authorized in Phase 3 | Agreed: an allow-list of two Cloudflare Access identities mapped to the one household document (`TARGET_UID`), each with their own token and revocable alone; the request record names who acted. **Scope note:** this covers chat access only. If the second member should also sign in to the *app* with their own account, that needs Firestore rules and app sharing changes; that's a separate decision, not part of PROP-041. |

## Phase 2 — owner priorities (2026-11-27)

Owner (chat, 2026-11-27): "For Phase 2, prioritize resolving the inventory stock-tracking ambiguity
affecting 59 of 97 items, along with new ingredient registration, prepared ingredient logging and
staple stock-level updates. Keep Phase 2 implementation separate." Phase 2 builds on its own branch
`prop041-p2` (from `prop041-p1`, which it needs), never ships with the Phase 1 release, and deploys
only on a separate owner approval. App feature scope stays frozen (D-090): Phase 2 changes the
bridge only. No bulk change to stored inventory: every data change is one explicit chat request,
recorded and undoable (P1-3, P1-5).

### Finding: why 59 of 97 lots are refused (production export 2026-11-26, read-only)
- The bridge's `classifyStaple()` (`operations/inventory.js`) knows only the stored `staple` flag and
  `category === 'Pantry'`; anything else is `ambiguous`, and every quantity write refuses it. It was
  written before the Worker had `INGREDIENT_DB`.
- The app's rule (`MealPrepFoodSafety.isStaple`, `shared/foodSafety.js` since TASK-091) is complete:
  stored flag → exact-name `INGREDIENT_DB.isStaple` → category `Pantry` → otherwise non-staple.
- On real data the app's rule calls **all 59 non-staple** (none is a staple by name). 26 carry a
  quantity and unit; **33 carry no quantity** ("presence-only": mostly seasonings and sauces recorded
  without an amount). The app shows those 33 as in stock with no amount.

### Phase 2 order
| # | Task | What | Decision needed |
| --- | --- | --- | --- |
| 1 | P2-0a Staple parity (TASK-097, ready) | Bridge uses `MealPrepFoodSafety.isStaple` — the app's exact answer; `ambiguous` disappears for staple classification. Reads add `tracking: 'level' \| 'quantity' \| 'presence'`. No stored data changes. Effect on the export: the 26 quantity lots become eligible for the quantity tools (still behind P1-4 safety); the 33 presence-only lots are reported as such. | none |
| 2 | P2-3 Staple levels | `set_stock_level(level: full / ok / low / empty)`; `mark_in_stock` / `mark_out_of_stock` stay as aliases. | D1 |
| 3 | P2-0b Presence-only items | On explicit instruction, one item per request, undoable: make it a staple with a level, or give it a quantity and unit. Never automatic, never bulk. | D1 |
| 4 | P2-1 Register items | `add_pantry_item` (name, quantity, unit, storage, bought date default household today, staple flag and level, printed date and kind); create-only, `ambiguous` when an active same-name lot with the same date and storage exists. | D3 |
| 5 | P2-1/P2-4 Prepared ingredients | A prepared ingredient (e.g. a frozen paste or chopped vegetables) is its own lot with its own storage and date; optional explicit `consume` list of raw lots in the same write (one write, no double count). | D2, D3 |
| later | P2-2, P2-5, P2-6 | Edit items, move ready food, multi-operation requests. | — |
| follow-up | Undo tombstone time | Write the undo tombstone as `max(now, live updatedAt + 1 ms)` (release finding 2.2). | none |

### Owner decisions needed before tasks 2-5 are released
- **D1 — presence-only items.** Recommended: both conversions allowed on explicit instruction ("salt
  is a staple, we have plenty" → staple, level full; "we have 200 g of paprika" → quantity), one
  item per request, undoable; chat never converts on its own. Alternative: staple only.
- **D2 — does logging a prepared ingredient deduct the raw ingredients?** Recommended: only when the
  user names them (chat may ask "did you use the 1 kg of onions?"); never inferred.
- **D3 — storage when unstated.** Recommended: infer like the app (`inferStorage`), state it back
  ("stored in Freezer"), and ask instead of guessing for raw meat, poultry and fish.
