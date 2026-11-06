Adds exactly two improvements:

- Home now shows every strictly favorited recipe in a visible **❤️ My Favorites** section. Compact responsive cards reuse existing read-only details, favorite toggles and Add to Plan/duplicate prevention. Favorite, recipe-edit/delete and import changes refresh Home; an empty state explains the heart action.
- Adds explicit **Air Fryer** equipment, create/edit selection and a primary quick-filter chip. Normalization, paste metadata, JSON imports/exports and reload retain `air-fryer`. Oven recipes are never automatically relabeled.

No inventory, shopping, sync or MCP implementation changes, new dependencies or collections. Existing Add to Plan behavior is reused intact. Application delta: +30 JS / +22 CSS lines.

Validation: 21 new browser cases; 109 focused cases pass. Complete local regression: **834/834 pass**, zero failures/skips/flaky results; exact evidence in `feature-evidence/task-079/REPORT.md`. Affected paste-import suite 12/12 passes; its previous Air-Fryer-is-unknown expectation now recognizes the supported slug while still rejecting Sous vide equipment. Decision pointers 118/118; documentation warnings remain 55 baseline/zero new. Independent review: **Scoped PASS**, no remaining must-fix (REVIEW.md). Real-device and production checks remain unperformed.

Screenshots:
- [Home desktop](https://github.com/shinyamadasan/Meal-Prep/blob/task-079-home-favorites-air-fryer/feature-evidence/task-079/home-1280.png) · [Home mobile](https://github.com/shinyamadasan/Meal-Prep/blob/task-079-home-favorites-air-fryer/feature-evidence/task-079/home-390.png)
- [Air Fryer desktop](https://github.com/shinyamadasan/Meal-Prep/blob/task-079-home-favorites-air-fryer/feature-evidence/task-079/air-fryer-1280.png) · [Air Fryer mobile](https://github.com/shinyamadasan/Meal-Prep/blob/task-079-home-favorites-air-fryer/feature-evidence/task-079/air-fryer-390.png)

Draft for owner review; do not merge/deploy without explicit approval. Older clients need refresh to recognize the new equipment slug. No production writes performed.
