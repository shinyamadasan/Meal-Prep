🌅 *Meal Prep — Morning Digest*
Sat 27 Jun · 13 proposals waiting · 🎯 Objective: *Alpha stability*

✅ *RECOMMEND APPROVE (10)*
*1* · Job #5 "cheapest": descope vs build store-compare
   → Reframe Price Book honestly as a price *reference* now (cheap, raises first-run trust); defer the Option B build until a user actually asks for store-compare. _(Approve (Option A — descope))_
*2* · Dashboard: data doesn't load on first open (tab-switch workaround required)
   → P0 — broken first impression on every app open; belongs in the next build.
*3* · Recipe JSON import fails
   → P0 — recipe import is fully broken; fix before alpha user testing.
*4* · Bulk add parser: unit treated as ingredient name when comma is missing
   → P1 — silently corrupts pantry data right now during alpha use.
*5* · Duplicate pantry name: ask user instead of silent skip
   → P1 — confirm the duplicate-add dialog copy at build time.
*6* · Pantry card: switching date field closes the card (should not close)
   → P1 — friction in the core stock-tracking flow.
*7* · Storage guide: don't show (or flag) guidance for unrecognized ingredients
   → P2 — schedule after the P0/P1s; pick the fallback UX at build.
*8* · Pantry list: show recently added items at the top
   → P2 — small win; batch with the other post-add flow fixes (PROP-006/009).
*9* · Bulk add: include expiry date field in the add flow
   → P2 — sequence after PROP-004 (same parser).
*10* · Ingredient card unit input: allow typing + offer dropdown
   → P2 — quality-of-life; not urgent, batch with other P2s.

💤 *RECOMMEND PARK (3)*
*11* · Bulk add: autocomplete / search from existing pantry items
   → P3 — high effort; revisit after stability. If approved, build only the safe sub-part (autocomplete from the ingredient DB, not the pantry).
*12* · Long press to delete pantry item
   → P3 — nice-to-have; delete already works via the card edit.
*13* · Same product, different packaging sizes (data model decision)
   → Revisit as a product-direction decision once there's more user data — the data-model change is too big to make on a single example.

—
*Reply naturally:* `Approve 1-10` · `Approve 2 3` · `Park 7` · `Reject 12`
Approved → built next run. Silence → nothing happens.
