# Proposal Queue — pending product judgment

> **Triage writes here. Nothing here is built.** Each capture becomes a *proposal*, enriched with
> evidence and scored against the **Current Objective** in [ROADMAP.md](ROADMAP.md), then waits for
> **your approval**. Approve → it moves to `ROADMAP.md` (the approved backlog). Park/Reject is recorded
> and dropped.
>
> **Every proposal leads with `▶ Decision`** — the AI's recommended next action
> (**Approve · Park · Reject · Clarify**) with a one-line why, so you can act from the digest on your
> phone without figuring out what to do. The rest of the fields are the evidence behind that call.
>
> Single responsibility: **Triage routes + enriches — it never schedules or builds.**
>
> **This file is a stage contract.** The format under "Proposal contract" below is the structured output
> triage produces and the *approval* + *sprint* stages consume — so any of those agents can be improved
> or replaced as long as it reads/writes this shape.
>
> Flow: `captures/inbox → Triage(+enrich) → PROPOSALS.md (here) → you approve → ROADMAP.md`

## Pending

### PROP-001 — Job #5 "cheapest": descope vs build store-compare
- **▶ Decision: Approve (Option A — descope).** Reframe Price Book honestly as a price *reference* now (cheap, raises first-run trust); defer the Option B build until a user actually asks for store-compare.
- **type:** decision · **source captures:** alpha audit (×1)
- **goal alignment:** ⚠️ mixed vs the Current Objective (**Alpha stability**). **Option A (descope)**
  *supports* it — removes a promise the app doesn't keep, which raises first-run trust. **Option B (build)**
  *conflicts* — adds new surface during a stabilize phase. Serves North-star "save money," but not *now*.
- **expected user value:** Low for a first-timer — Price Book is a low-traffic "More"-menu job. Higher
  later if the objective shifts to growth/monetization.
- **evidence:** last external-testing blocker; Price Book implies "find cheapest" but only shows reference
  prices; **0** user captures requesting it (no demand signal yet).
- **effort:** A=S · B=M · **dependencies:** none · **confidence:** high · **ambiguity:** none
- **why now vs later:** decide the *direction* now to clear the go/no-go verdict — but the **build (B)
  should wait** until a user actually asks. **A (descope) now** is the stability-aligned move.
- **AI-recommended priority:** **P2** (raw priority was P1; **down-weighted** because building it doesn't
  serve the current objective)
- **status:** pending — your call (Approve A / Approve B / Park / Reject)

---

### PROP-002 — Dashboard: data doesn't load on first open (tab-switch workaround required)
- **▶ Decision: Approve.** P0 — broken first impression on every app open; belongs in the next build.
- **type:** bug · **source captures:** 20260626T1146Z-30 (×1) · *note: captured as /feature, reclassified bug*
- **goal alignment:** strongly supports — North-star #1 (core loop friction) + #3 (zero-friction start). The home screen is the first thing a user sees; showing stale/empty data is a broken first impression.
- **expected user value:** High — every user hits this on every app open; forces a meaningless tab-switch before the app feels alive.
- **evidence:** 1 capture from active use today. Symptom: dashboard renders empty/stale until navigating to Inventory tab and back. Likely initialization-order issue — `renderDashboard()` runs before data is available, or isn't triggered after `loadUserData()` resolves.
- **effort:** S–M · **dependencies:** none · **confidence:** high · **ambiguity:** root cause needs a quick code trace (could be a missing `await` or a missing render call in the init chain)
- **why now vs later:** P0 — home screen is broken on load. Fix before any other UX work.
- **AI-recommended priority:** **P0**
- **status:** pending

---

### PROP-003 — Recipe JSON import fails
- **▶ Decision: Approve.** P0 — recipe import is fully broken; fix before alpha user testing.
- **type:** bug · **source captures:** 20260626T1152Z-32 (×1) · *note: captured as /feature, reclassified bug*
- **goal alignment:** supports — North-star #1 (core loop). Recipe import is a primary way to populate the app; a silent failure blocks a real user from using it.
- **expected user value:** High — feature is non-functional. User tried importing `cpb-diet-import.json` (file visible in repo as untracked) and it failed.
- **evidence:** 1 capture from active use. The `cpb-diet-import.json` file in the working tree is likely the test file used. Root cause unknown — could be schema mismatch, parse error, or a missing field handler.
- **effort:** S–M · **dependencies:** none · **confidence:** high · **ambiguity:** root cause needs a code trace of the import handler + comparison against the actual JSON file structure
- **why now vs later:** P0 — can't import recipes at all. Fix before alpha user testing.
- **AI-recommended priority:** **P0**
- **status:** pending

---

### PROP-004 — Bulk add parser: unit treated as ingredient name when comma is missing
- **▶ Decision: Approve.** P1 — silently corrupts pantry data right now during alpha use.
- **type:** bug · **source captures:** 20260626T1009Z-12 (×1)
- **goal alignment:** supports — North-star #1 (reduce friction in core loop). Bulk add is a key pantry entry shortcut; a parser that silently corrupts data on format variations erodes trust.
- **expected user value:** High — user is hitting this right now during alpha. Corrupted pantry entries require manual cleanup.
- **evidence:** 1 capture from active use. Symptom: omitting the comma separator causes the unit (e.g. "ml") to be captured as part of the ingredient name. The parser likely splits on comma first; without it, the whole string becomes the name.
- **effort:** S · **dependencies:** none · **confidence:** high · **ambiguity:** need to confirm exact format the parser expects and edge cases (e.g. "Coconut cream 200ml" vs "Coconut cream, 200 ml")
- **why now vs later:** P1 — active data corruption. Fix this in the next sprint.
- **AI-recommended priority:** **P1**
- **status:** pending

---

### PROP-005 — Duplicate pantry name: ask user instead of silent skip
- **▶ Decision: Approve.** P1 — confirm the duplicate-add dialog copy at build time.
- **type:** bug/feature · **source captures:** 20260626T1044Z-28 (×1)
- **goal alignment:** supports — North-star #1 (friction) + #2 (never lose user data). Silently skipping a duplicate pantry add is wrong when the user legitimately has two of the same item (two oyster sauce jars with different expiry dates, different purchase dates, etc.).
- **expected user value:** High — pantry becomes inaccurate. User can't log a second jar of the same item at all right now.
- **evidence:** 1 capture from active use; user gave a concrete real-world example (two oyster sauces).
- **effort:** S · **dependencies:** none · **confidence:** high · **ambiguity:** decide the confirmation copy ("You already have X in your kitchen — add another?" + confirm/cancel)
- **why now vs later:** P1 — data accuracy issue; alpha users are adding real pantries now and hitting this.
- **AI-recommended priority:** **P1**
- **status:** pending

---

### PROP-006 — Pantry card: switching date field closes the card (should not close)
- **▶ Decision: Approve.** P1 — friction in the core stock-tracking flow.
- **type:** bug/UX · **source captures:** 20260626T1020Z-18 (×1, part A)
- **goal alignment:** supports — North-star #1 (reduce friction in buy→stock flow). The collapse trigger fires on a field blur/switch, forcing the user to reopen the card just to fill in expiry date.
- **expected user value:** High — hits anyone adding new pantry items and wanting to set expiry date right away (which is the post-bulk-add workflow).
- **evidence:** 1 capture from active use today.
- **effort:** S · **dependencies:** none · **confidence:** high · **ambiguity:** identify exactly which event (blur? click-outside?) triggers the collapse and whether suppressing it has side effects
- **why now vs later:** P1 — active friction in the core stock-tracking flow.
- **AI-recommended priority:** **P1**
- **status:** pending

---

### PROP-007 — Storage guide: don't show (or flag) guidance for unrecognized ingredients
- **▶ Decision: Approve.** P2 — schedule after the P0/P1s; pick the fallback UX at build.
- **type:** UX/trust · **source captures:** 20260626T1012Z-14 (×1)
- **goal alignment:** supports — North-star #1 and alpha trust. Showing a generic or clearly wrong storage guide for items the app doesn't recognize damages trust in the guide for items it *does* know.
- **expected user value:** Medium — prevents "this guide is wrong" perception during alpha testing.
- **evidence:** 1 capture. Note: the `#storage` tab is orphaned (no nav button per ROADMAP Known Issues), but per-item storage guidance likely still appears on pantry cards via `renderStorageGuide()` or similar.
- **effort:** S · **dependencies:** none · **confidence:** med (need to confirm where storage guide surfaces for pantry items) · **ambiguity:** decide the fallback UX: hide the section entirely, show "No storage guide for this item", or show a generic disclaimer
- **why now vs later:** P2 — trust issue but not blocking the core loop. Fix after P0/P1 bugs.
- **AI-recommended priority:** **P2**
- **status:** pending

---

### PROP-008 — Pantry list: show recently added items at the top
- **▶ Decision: Approve.** P2 — small win; batch with the other post-add flow fixes (PROP-006/009).
- **type:** feature · **source captures:** 20260626T1020Z-18 (×1, part B)
- **goal alignment:** supports — North-star #1. After a bulk add, users need to fill in expiry dates and quantities; currently they have to scroll to find new items in an alphabetical or unordered list.
- **expected user value:** Medium — reduces post-add friction, especially after bulk add.
- **evidence:** 1 capture. Relates to PROP-006 (card closes) and PROP-009 (bulk add expiry) — all three address the same post-add flow.
- **effort:** S · **dependencies:** none · **confidence:** high · **ambiguity:** "recently added" = added in the last N minutes, or just the newest item? Likely sort by `dateAdded` descending for a short window, then revert to normal sort.
- **why now vs later:** P2 — UX improvement, not blocking.
- **AI-recommended priority:** **P2**
- **status:** pending

---

### PROP-009 — Bulk add: include expiry date field in the add flow
- **▶ Decision: Approve.** P2 — sequence after PROP-004 (same parser).
- **type:** feature · **source captures:** 20260626T1023Z-22 (×1)
- **goal alignment:** supports — North-star #1. Currently bulk add creates items without expiry; users then have to open each card individually to add the date. Relates to PROP-006 (card closes on date switch) and PROP-008 (recently added on top).
- **expected user value:** High if implemented cleanly — eliminates the post-bulk-add editing step for expiry. Medium if the format gets complicated.
- **evidence:** 1 capture. Related captures: #18 (PROP-006, PROP-008) address the same friction from a different angle.
- **effort:** M · **dependencies:** PROP-004 (bulk add parser) should land first — adds to the same parser · **confidence:** high · **ambiguity:** format question: append to existing line syntax (`Name, qty unit, expiry`) or a separate field in the modal? Separate field is safer UX.
- **why now vs later:** P2 — good UX gain but builds on fixing the parser (PROP-004) first.
- **AI-recommended priority:** **P2**
- **status:** pending

---

### PROP-010 — Ingredient card unit input: allow typing + offer dropdown
- **▶ Decision: Approve.** P2 — quality-of-life; not urgent, batch with other P2s.
- **type:** feature · **source captures:** 20260626T1015Z-16 (×1)
- **goal alignment:** supports — North-star #1 (reduce friction in data entry). A hybrid input (free-type + common-unit dropdown) reduces unit typos and standardizes data.
- **expected user value:** Medium — better data quality; reduces "g" vs "grams" inconsistencies that can break conversions.
- **evidence:** 1 capture.
- **effort:** M · **dependencies:** none · **confidence:** high · **ambiguity:** define the dropdown list (g, kg, ml, L, pcs, cups, tbsp, tsp, etc.) and whether free-type is primary or secondary
- **why now vs later:** P2 — quality-of-life, not blocking.
- **AI-recommended priority:** **P2**
- **status:** pending

---

### PROP-011 — Bulk add: autocomplete / search from existing pantry items
- **▶ Decision: Park.** P3 — high effort; revisit after stability. If approved, build only the safe sub-part (autocomplete from the ingredient DB, not the pantry).
- **type:** feature · **source captures:** 20260626T1036Z-24 (×1)
- **goal alignment:** supports — North-star #1 (reduce friction). Typing ingredient names from scratch is slow; autocomplete from the existing pantry or ingredient DB would help.
- **expected user value:** Medium — significant speed gain for restocking known items.
- **evidence:** 1 capture. User correctly identifies the risk: autocomplete from pantry could suggest items that shouldn't be re-added (wrong signal for restocking vs first-add scenarios).
- **effort:** L · **dependencies:** PROP-004 (parser fix) should land first · **confidence:** med · **ambiguity:** two separate problems — (a) autocomplete from ingredient DB (safe, no dedup concern), (b) from existing pantry (requires clear signal: restock vs new). Start with (a) only.
- **why now vs later:** P3 — high effort, valid but not urgent during alpha stability phase.
- **AI-recommended priority:** **P3**
- **status:** pending

---

### PROP-012 — Long press to delete pantry item
- **▶ Decision: Park.** P3 — nice-to-have; delete already works via the card edit.
- **type:** feature · **source captures:** 20260626T1023Z-20 (×1)
- **goal alignment:** neutral — a power-user shortcut; item deletion via card edit already exists.
- **expected user value:** Low–Medium — faster for frequent deletions, but delete is not a high-frequency action.
- **evidence:** 1 capture.
- **effort:** M · **dependencies:** none · **confidence:** med · **ambiguity:** long press on mobile is tricky (needs 500ms timeout, visual feedback, accidental-trigger risk); needs a confirmation step to prevent accidental deletes. Desktop has no long press.
- **why now vs later:** P3 — nice-to-have, address after P0/P1/P2 backlog.
- **AI-recommended priority:** **P3**
- **status:** pending

---

### PROP-013 — Same product, different packaging sizes (data model decision)
- **▶ Decision: Park.** Revisit as a product-direction decision once there's more user data — the data-model change is too big to make on a single example.
- **type:** decision · **source captures:** 20260626T1037Z-26 (×1)
- **goal alignment:** neutral — real product question but no urgency during alpha stability.
- **expected user value:** unclear — depends on direction. Current model treats "Coconut Cream 200ml" and "Coconut Cream 400ml" as separate pantry items (correct short-term, but messy long-term).
- **evidence:** 1 capture with a concrete real-world example. No demand signal beyond this.
- **effort:** L — any solution that merges/relates variants touches the data model (AppState, Firestore schema) · **confidence:** low · **ambiguity:** three options: (A) keep as separate items (status quo, user names them distinctly), (B) sub-items under a parent ingredient, (C) a "variant" field on each pantry item. All have trade-offs.
- **why now vs later:** P3 — park. Get more user data before deciding; the data model change is significant.
- **AI-recommended priority:** **P3**
- **status:** pending — your call when you're ready to decide direction

---

## Proposal contract
*(the structured shape triage produces — keep this shape so downstream stages stay swappable)*
```
### PROP-NNN — <title>
- ▶ Decision: Approve | Park | Reject | Clarify — <one-line why; the recommended next action, stated first>
- type:        feature | bug | chore | decision
- source captures: <ids> (×N duplicates)
- goal alignment:  supports | conflicts | mixed | neutral  — vs the Current Objective (name it; add which North-star goal)
- expected user value: <who benefits, how much, in the current phase>
- evidence:    <recurring friction · dup count · roadmap/similar-past alignment · demand signal>
- effort:      S | M | L
- dependencies: <none | …>
- confidence:  high | med | low
- ambiguity:   <none | what's unclear>
- why now vs later: <why it belongs in the next sprint, or why it should wait>
- AI-recommended priority: P0..P3   (goal-adjusted, not raw priority)
- status:      pending
```
*`▶ Decision` is the recommended action; `status` is your recorded outcome. They differ on purpose —
the AI recommends, you decide.* **Approve** = build it (→ ROADMAP). **Park** = valid, not now. **Reject**
= drop it. **Clarify** = AI can't recommend confidently; it needs an answer from you first.
