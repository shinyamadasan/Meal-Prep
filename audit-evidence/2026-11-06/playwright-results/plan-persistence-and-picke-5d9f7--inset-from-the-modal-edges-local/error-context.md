# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plan-persistence-and-picker.spec.js >> Add-meals picker has no horizontal overflow at 1280px and content is inset from the modal edges
- Location: tests\plan-persistence-and-picker.spec.js:611:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.evaluate: Test timeout of 30000ms exceeded.
```

# Test source

```ts
  514 |     AppState.weeklyPlan.Monday.lunch = 'r_shortlife';
  515 |     showTab('planner');
  516 |   });
  517 |   const row = page.locator('#planned-batches-list .batch-row');
  518 | 
  519 |   await row.locator('.batch-name-btn').click();
  520 |   await expect(page.locator('#recipe-modal')).toBeVisible();
  521 |   expect(await detailOpens(page)).toEqual(['r_longlife']);
  522 |   expect(await page.evaluate(() => AppState.plannedBatches[0].servings)).toBe(2);
  523 |   await page.locator('#recipe-modal .modal-close').click();
  524 | 
  525 |   await expect(page.locator('#recipe-modal')).toBeHidden();
  526 |   await expect(page.locator('#planner')).toBeVisible();
  527 | 
  528 |   await row.locator('.batch-step-btn', { hasText: '+' }).click();
  529 |   await row.locator('.batch-servings').click();
  530 |   await row.locator('.batch-step-btn', { hasText: '−' }).click();
  531 |   await expect(page.locator('#recipe-modal')).toBeHidden();
  532 |   expect(await detailOpens(page)).toHaveLength(1);
  533 |   expect(await page.evaluate(() => ({
  534 |     servings: AppState.plannedBatches.map((b) => b.servings),
  535 |     monday: AppState.weeklyPlan.Monday.lunch
  536 |   }))).toEqual({ servings: [2], monday: 'r_shortlife' });
  537 | 
  538 |   await row.locator('.batch-remove-btn').click();
  539 |   await expect(page.locator('#recipe-modal')).toBeHidden();
  540 |   expect(await detailOpens(page)).toHaveLength(1);
  541 |   expect(await page.evaluate(() => AppState.plannedBatches)).toEqual([]);
  542 | });
  543 | 
  544 | test('Plan tab: a batch whose recipe was deleted is not inspectable', async ({ page }) => {
  545 |   await loadWithPlanRecipes(page);
  546 |   await countDetailOpens(page);
  547 |   await page.evaluate(() => {
  548 |     AppState.plannedBatches = [{ id: 'pb_gone', recipeId: 'r_missing', servings: 2, addedAt: null }];
  549 |     showTab('planner');
  550 |     renderPlannedBatches();
  551 |   });
  552 |   const row = page.locator('#planned-batches-list .batch-row');
  553 |   await expect(row.locator('.batch-name-btn')).toHaveCount(0);
  554 |   await row.locator('.batch-meta').click();
  555 |   await expect(page.locator('#recipe-modal')).toBeHidden();
  556 |   expect(await detailOpens(page)).toEqual([]);
  557 | });
  558 | 
  559 | test('closing another modal does not run the recipe modal close handler', async ({ page }) => {
  560 |   await loadWithPlanRecipes(page);
  561 |   // Regression guard: the recipe modal's close was bound via the document's FIRST .modal-close.
  562 |   await page.evaluate(() => openEditRecipeModal('r_longlife'));
  563 |   const clickedOther = await page.evaluate(() => {
  564 |     document.getElementById('recipe-modal').classList.add('hidden'); // hide without clearing the form
  565 |     const first = document.querySelector('.modal-close');
  566 |     if (first.closest('#recipe-modal')) return false;
  567 |     first.closest('.modal').classList.remove('hidden');
  568 |     first.click();
  569 |     return true;
  570 |   });
  571 |   expect(clickedOther).toBe(true); // recipe modal is no longer the first modal in the document
  572 |   await expect(page.locator('#recipe-name')).toHaveValue('Test Long Life Rice');
  573 | });
  574 | 
  575 | test('a long recipe name in the batch list wraps instead of overflowing horizontally', async ({ page }) => {
  576 |   await loadWithPlanRecipes(page);
  577 |   await page.evaluate(() => {
  578 |     AppState.recipes.push({
  579 |       id: 'r_long_name', name: 'A Very Long Test Recipe Name That Should Wrap Cleanly Across Several Lines Without Any Horizontal Overflow',
  580 |       baseServings: 2, currentServings: 2, baseIngredients: [], instructions: '',
  581 |       nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
  582 |     });
  583 |     addPlannedBatch('r_long_name');
  584 |     showTab('planner');
  585 |   });
  586 |   const overflow = await page.evaluate(() => {
  587 |     const list = document.getElementById('planned-batches-list');
  588 |     return list.scrollWidth - list.clientWidth;
  589 |   });
  590 |   expect(overflow).toBeLessThanOrEqual(1);
  591 | });
  592 | 
  593 | test('the freshness warning links a recipe by the same stable id the plan slot stores', async ({ page }) => {
  594 |   await loadWithPlanRecipes(page);
  595 |   await page.evaluate(() => {
  596 |     AppState.weeklyPlan.Wednesday.dinner = 'r_shortlife';
  597 |     saveData();
  598 |     showTab('planner');
  599 |     renderWeeklyPlanner();
  600 |   });
  601 |   const link = page.locator('.storage-alert-recipe-link');
  602 |   await expect(link).toHaveText('Test Short Life Stew');
  603 |   await link.click();
  604 |   const editing = await page.evaluate(() => String(AppState.currentEditingRecipe));
  605 |   expect(editing).toBe('r_shortlife');
  606 | });
  607 | 
  608 | // ── Picker spacing (Part 2) ───────────────────────────────────────────────────
  609 | 
  610 | for (const vp of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  611 |   test(`Add-meals picker has no horizontal overflow at ${vp.width}px and content is inset from the modal edges`, async ({ page }) => {
  612 |     await page.setViewportSize(vp);
  613 |     await loadWithPlanRecipes(page);
> 614 |     await page.evaluate(() => { showTab('planner'); openBatchPickerModal(); });
      |                ^ Error: page.evaluate: Test timeout of 30000ms exceeded.
  615 |     await expect(page.locator('#batch-picker-modal')).not.toHaveClass(/hidden/);
  616 | 
  617 |     const metrics = await page.evaluate(() => {
  618 |       const content = document.querySelector('#batch-picker-modal .modal-content');
  619 |       const row = document.querySelector('.batch-search-row');
  620 |       const results = document.getElementById('batch-picker-results');
  621 |       const rowPad = parseFloat(getComputedStyle(row).paddingLeft);
  622 |       return {
  623 |         contentOverflow: content.scrollWidth - content.clientWidth,
  624 |         pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  625 |         rowPad,
  626 |         resultsPad: parseFloat(getComputedStyle(results).paddingLeft)
  627 |       };
  628 |     });
  629 |     expect(metrics.contentOverflow).toBeLessThanOrEqual(1);
  630 |     expect(metrics.pageOverflow).toBeLessThanOrEqual(1);
  631 |     expect(metrics.rowPad).toBeGreaterThanOrEqual(12);
  632 |     expect(metrics.rowPad).toBeLessThanOrEqual(16);
  633 |     expect(metrics.resultsPad).toBeGreaterThanOrEqual(12);
  634 |     expect(metrics.resultsPad).toBeLessThanOrEqual(16);
  635 |   });
  636 | }
  637 | 
  638 | // ── Favorites: reused mechanism, wired into the picker ──────────────────────
  639 | 
  640 | test('picker favorite toggle: star toggles recipe.favorite, persists, and never touches plannedBatches or Added state', async ({ page }) => {
  641 |   await loadWithPlanRecipes(page);
  642 |   await page.evaluate(() => { showTab('planner'); openBatchPickerModal(); });
  643 | 
  644 |   const star = page.locator('#batch-picker-results .batch-result', { hasText: 'Test Long Life Rice' }).locator('.recipe-fav-btn');
  645 |   await expect(star).not.toHaveClass(/active/);
  646 | 
  647 |   await star.click(); // ☆ -> ★
  648 |   await expect(star).toHaveClass(/active/);
  649 |   expect(await page.evaluate(() => AppState.recipes.find((r) => r.id === 'r_longlife').favorite)).toBe(true);
  650 |   expect(await page.evaluate(() => AppState.plannedBatches)).toEqual([]); // favoriting never adds a batch
  651 | 
  652 |   await star.click(); // ★ -> ☆
  653 |   await expect(star).not.toHaveClass(/active/);
  654 |   expect(await page.evaluate(() => AppState.recipes.find((r) => r.id === 'r_longlife').favorite)).toBe(false);
  655 | 
  656 |   await star.click(); // leave it favorited for the reload check
  657 |   await page.reload({ waitUntil: 'domcontentloaded' });
  658 |   await waitForRestored(page, () => AppState.recipes.some((r) => r.id === 'r_longlife' && r.favorite === true));
  659 |   expect(await page.evaluate(() => AppState.recipes.find((r) => r.id === 'r_longlife').favorite)).toBe(true);
  660 | });
  661 | 
  662 | test('adding a recipe does not favorite it; an Added-✓ recipe can still be favorited; title inspection still works alongside both', async ({ page }) => {
  663 |   await loadWithPlanRecipes(page);
  664 |   await page.evaluate(() => { showTab('planner'); openBatchPickerModal(); });
  665 | 
  666 |   const row = page.locator('#batch-picker-results .batch-result', { hasText: 'Test Long Life Rice' });
  667 |   await row.locator('.batch-add-btn').click();
  668 |   expect(await page.evaluate(() => AppState.recipes.find((r) => r.id === 'r_longlife').favorite)).toBeFalsy();
  669 |   await expect(row.locator('.batch-picker-added')).toHaveText('Added ✓');
  670 | 
  671 |   await row.locator('.recipe-fav-btn').click();
  672 |   expect(await page.evaluate(() => AppState.recipes.find((r) => r.id === 'r_longlife').favorite)).toBe(true);
  673 |   await expect(row.locator('.batch-picker-added')).toHaveText('Added ✓'); // unaffected by favoriting
  674 |   expect(await page.evaluate(() => AppState.plannedBatches.map((b) => b.servings))).toEqual([2]); // unaffected
  675 | 
  676 |   await row.locator('.batch-name-btn').click();
  677 |   await expect(page.locator('#recipe-name')).toBeDisabled();
  678 |   await page.locator('#cancel-btn').click();
  679 |   expect(await page.evaluate(() => AppState.currentEditingRecipe)).toBe(null);
  680 | });
  681 | 
  682 | test('duplicate display names cannot cross-toggle favorite state — identity is by recipeId', async ({ page }) => {
  683 |   await loadWithPlanRecipes(page);
  684 |   await page.evaluate(() => {
  685 |     AppState.recipes.push({
  686 |       id: 'r_dup_a', name: 'Duplicate Name Recipe', baseServings: 1, currentServings: 1,
  687 |       baseIngredients: [], instructions: '', nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
  688 |     });
  689 |     AppState.recipes.push({
  690 |       id: 'r_dup_b', name: 'Duplicate Name Recipe', baseServings: 1, currentServings: 1,
  691 |       baseIngredients: [], instructions: '', nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
  692 |     });
  693 |     toggleFavorite('r_dup_a');
  694 |   });
  695 |   const r = await page.evaluate(() => ({
  696 |     a: AppState.recipes.find((r) => r.id === 'r_dup_a').favorite,
  697 |     b: AppState.recipes.find((r) => r.id === 'r_dup_b').favorite
  698 |   }));
  699 |   expect(r.a).toBe(true);
  700 |   expect(r.b).toBeFalsy();
  701 | });
  702 | 
  703 | test('Favorites chip filters the picker to favorited recipes only, and composes with Low effort', async ({ page }) => {
  704 |   await loadWithPlanRecipes(page);
  705 |   await page.evaluate(() => { toggleFavorite('r_longlife'); showTab('planner'); openBatchPickerModal(); });
  706 | 
  707 |   await expect(page.locator('#batch-picker-favorites-chip')).not.toHaveClass(/active/);
  708 |   await page.click('#batch-picker-favorites-chip');
  709 |   await expect(page.locator('#batch-picker-favorites-chip')).toHaveClass(/active/);
  710 | 
  711 |   const names = await page.locator('#batch-picker-results .batch-name').allTextContents();
  712 |   expect(names).toEqual(['Test Long Life Rice']);
  713 | 
  714 |   await page.click('#batch-picker-favorites-chip'); // OFF restores "All recipes"
```