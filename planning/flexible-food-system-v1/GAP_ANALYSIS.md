# Flexible Food System V1 — Gap Analysis

Inputs:
- [KNOWLEDGE_BASE.md](KNOWLEDGE_BASE.md) (what the book recommends)
- [CAPABILITY_AUDIT.md](CAPABILITY_AUDIT.md) (what the app does today)

**Author:** Claude, 2026-11-25. Planning only.

**Headline:** the app already supports "eat well without a plan" more than it seems. Cook Now,
Quick Eat, Meal Prep and Efficiency mostly exist. The real gaps are:

1. **Stock truth.** Every recommendation is built on pantry availability, and that is currently
   unreliable (audit F1/F2).
2. **The no-plan grocery list** (book F5). This is the book's signature idea and the app has nothing
   like it.
3. **Balanced Plate as guidance**, not just a data field.
4. **Source-referenced recipe knowledge** that separates the original from our adaptation.
5. **Versatility ranking.**

---

## Gap table

| # | Capability | Book says | App today | Gap | Size | Risk (D-032) |
|---|---|---|---|---|---|---|
| G0 | (all) | Check what you have before you shop or cook (F4 step 5) | Availability counts 0 g, expired and substring matches as "have" | **Recommendations can be wrong.** Fix the read path first | M | Low for read-path (no writes); High for deduction/merge math (F3/F4 write stock) |
| G1 | Grocery | No-plan template 4/4/3/3/3/3/1–2 with rules (≥1 low-prep, ≥1 plant protein, ≥2 whole-grain starches) (F5) | Grocery only from a plan or staples | **Missing.** Derive "what's missing per role" from current stock and add it to Shop in one tap | M | Low (additive; adds grocery items through the existing add path) |
| G2 | Balanced Plate | ½ produce, ¼ protein, ¼ carb, plus a thumb of fat; "add, not subtract" (F2) | `mealBalance` has 3 booleans, not shown in suggestions | Add a **completion hint** on Cook Now / Quick Eat cards ("add a vegetable: you have frozen broccoli") | S–M | Low |
| G3 | Quick Eat | Snack Pack: 2 of 3 groups (F6); pair a convenience food with a vegetable or protein (F1/F7) | Ready food and Meal Lego; no snack pairing | **Snack Pack suggestions** from stock; "pair it" nudge for ready/frozen meals | S | Low |
| G4 | Recipe Knowledge | ~75 recipes with page refs, remixes and kitchen notes (§3) | No source field; no original vs adaptation | Optional `source` {book, page} and an adaptation note on Recipe. **Opt-in reference pack**, private-safe | M | **High** (Firestore-synced recipe shape) → merge held |
| G5 | Versatile Inventory | Versatile staples recur across methods (§4) | No ranking | **Versatility score** = number of recipes + methods + plate roles an ingredient serves. Use it to order G1 suggestions | S | Low |
| G6 | Efficiency | Sheet pan, one pot, no-cook, hands-off (F9) | effort, activeTime, equipment; no supervision signal | Derive **hands-off** from equipment (oven, rice cooker, IP, air fryer, no-cook). Tie-break in Cook Now. No new field | S | Low |
| G7 | Cook Now | Cook from what you have, in little time | Cookable tiers exist | No "time I have" input. **Deliberately not proposed**: an extra input would add friction. Effort ranking already covers it | — | — |
| G8 | Meal Prep | Double batch → freeze; freezer dump meals; cook from frozen | Batches, freezer life, tags | Covered. Book freezer recipes enter through G4. Audit F8/F10 remain separate bugs | — | — |
| G9 | Inventory hygiene | — | Stale and inconsistent records (I-1 to I-8) | **Read-only Stock health report**; no auto-fixes | S | Low (read-only) |

## What we will *not* do in V1

| Excluded | Why |
|---|---|
| Ship the book's full recipe text in the public app or repo | Copyright; the repo is public (see G4 design) |
| Add a calorie/macro tracker or any per-meal logging | Conflicts with "no additional manual tracking" |
| New tabs or navigation changes | Conflicts with "no unnecessary UI redesign" |
| Touch `cookedMeals`, `mealConsumption`, tombstones or merge | ChronaSense contract |
| Auto-correct or delete stale inventory | The owner instruction is to investigate without modifying. Corrections are a later, explicitly approved step |
| Fix F3/F4 quantity-math writes in this first wave | Red-zone stock writes. They need their own High-risk solo task after V1 slices 0–2, as the audit itself recommends |

## Dependencies

```
G0 (truthful availability, read path)
 ├─► G1 no-plan grocery (needs "what I have" to be true)
 ├─► G2 Balanced Plate hint (suggests items you actually have)
 └─► G3 Snack Pack
G5 versatility ──► orders G1 suggestions (optional enhancement)
G4 recipe source/adaptation ──► independent; held merge
G9 stock health report ──► independent; read-only
```
