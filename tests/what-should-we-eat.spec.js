const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady } = require('./app-ready');

/**
 * "What should we eat?" wave — deterministic, explainable ranking.
 *
 * The product rules this file exists to prove:
 *   Food we already cooked beats cooking something new.
 *   Expired food is never offered as a meal.
 *   Ranking is composed from the helpers that already exist — one freshness
 *     model, one pantry model, one variety model.
 *   Every ranking signal is observable and testable WITHOUT reading the DOM.
 *   A category with no honest basis is omitted, not filled with a guess.
 *   Nothing is persisted, and nothing is consumed merely by being recommended.
 */

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// Local calendar date N days ago — daysLeftFrom()/todayISO() work in local time.
const DAYS_AGO = `(d) => { const t = new Date(); t.setDate(t.getDate() - d);
  return t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0'); }`;

// Builds a recipe with the D-055 metadata filled in, so a test can vary exactly
// one signal at a time.
const MAKE_RECIPE = `(o) => Object.assign({
  id: o.id,
  name: o.name,
  category: 'Dinner',
  baseServings: 2,
  currentServings: 2,
  basePrepTime: 5,
  baseCookTime: 10,
  fridgeLife: 3,
  freezerLife: 30,
  baseIngredients: (o.ingredients || ['Chicken', 'Rice']).map((n) => ({
    name: n, baseQuantity: 1, unit: 'pc', category: 'Protein'
  })),
  instructions: 'Cook it.',
  nutritionPerServing: { calories: 400, protein: 30, carbs: 40, fat: 10, fiber: 2, sodium: 300 },
  equipment: o.equipment || [],
  effort: o.effort || null,
  activeTime: o.activeTime == null ? null : o.activeTime,
  mealBalance: o.mealBalance || { protein: false, vegetables: false, carb: false },
  tags: o.tags || []
}, o.extra || {})`;

// Runs a scenario in page scope with the two builders available.
async function rank(page, setup) {
  return page.evaluate(({ setupSrc, daysSrc, makeSrc }) => {
    const daysAgo = eval(daysSrc);
    const makeRecipe = eval(makeSrc);
    return eval('(' + setupSrc + ')')({ daysAgo, makeRecipe });
  }, { setupSrc: setup.toString(), daysSrc: DAYS_AGO, makeSrc: MAKE_RECIPE });
}

// ══ A. Ready food beats cooking ═════════════════════════════════════════════

test('ready fridge food outranks cooking another recipe', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.recipes = [makeRecipe({
      id: 501, name: 'Easy Rice Cooker Chicken', equipment: ['rice-cooker'],
      effort: 'very-low', activeTime: 5, tags: ['minimal-cleanup'],
      mealBalance: { protein: true, vegetables: true, carb: true },
      ingredients: ['Chicken', 'Rice']
    })];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 2, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    AppState.cookedMeals = [{
      id: 'r1', name: 'Landers Lechon Manok', cookedDate: daysAgo(1),
      storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 2
    }];
    AppState.cookHistory = [];
    const picks = getWhatShouldWeEatSuggestions();
    return { keys: picks.map((p) => p.key), first: picks[0], count: picks.length };
  });

  expect(result.keys[0]).toBe('eat-first');
  expect(result.first.kind).toBe('ready');
  expect(result.first.name).toBe('Landers Lechon Manok');
  expect(result.first.reasons).toContain('Ready now');
  // The easy recipe is still offered — second, not instead.
  expect(result.keys).toContain('easiest');
});

test('ready fridge food nearing expiry outranks ordinary ready fridge food', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo }) => {
    AppState.recipes = [];
    AppState.pantry = [];
    AppState.cookHistory = [];
    AppState.cookedMeals = [
      // 5 days of life left — perfectly good, not urgent.
      { id: 'fresh', name: 'Fresh Batch', cookedDate: daysAgo(0), storage: 'fridge', fridgeLife: 5, freezerLife: 60, portionsRemaining: 4 },
      // 1 day left — inside FRESHNESS_WARN_DAYS.
      { id: 'soon', name: 'Nearly Gone Batch', cookedDate: daysAgo(3), storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 4 }
    ];
    const picks = getWhatShouldWeEatSuggestions();
    return {
      first: picks[0].name,
      reasons: picks[0].reasons,
      order: getReadyFoodSuggestions().map((m) => m.name)
    };
  });

  expect(result.first).toBe('Nearly Gone Batch');
  expect(result.reasons).toContain('Use soon');
  expect(result.order).toEqual(['Nearly Gone Batch', 'Fresh Batch']);
});

test('expired ready food is never recommended as something to eat', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo }) => {
    AppState.recipes = [];
    AppState.pantry = [];
    AppState.cookHistory = [];
    AppState.cookedMeals = [
      { id: 'bad', name: 'Very Expired Adobo', cookedDate: daysAgo(20), storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 3 }
    ];
    const picks = getWhatShouldWeEatSuggestions();
    return {
      picks: picks.map((p) => p.name),
      // It IS still surfaced as something to throw away — a different job.
      attentionExpired: collectAttentionItems().expired.map((e) => e.name)
    };
  });

  expect(result.picks).not.toContain('Very Expired Adobo');
  expect(result.picks).toHaveLength(0);
  expect(result.attentionExpired).toContain('Very Expired Adobo');
});

test('freezer food is offered when there is nothing in the fridge', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo }) => {
    AppState.recipes = [];
    AppState.pantry = [];
    AppState.cookHistory = [];
    AppState.cookedMeals = [
      { id: 'fz', name: 'Frozen Kaldereta', cookedDate: daysAgo(10), storage: 'freezer', fridgeLife: 4, freezerLife: 90, portionsRemaining: 2 }
    ];
    const onlyFreezer = getWhatShouldWeEatSuggestions();

    // Add fridge food; it must take over.
    AppState.cookedMeals.push({ id: 'fr', name: 'Fridge Tinola', cookedDate: daysAgo(1), storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 2 });
    const withFridge = getWhatShouldWeEatSuggestions();

    return {
      freezerName: onlyFreezer[0].name,
      freezerReasons: onlyFreezer[0].reasons,
      fridgeWins: withFridge[0].name
    };
  });

  expect(result.freezerName).toBe('Frozen Kaldereta');
  expect(result.freezerReasons).toContain('Freezer');
  expect(result.fridgeWins).toBe('Fridge Tinola');
});

// ══ B. Cook-candidate ranking ═══════════════════════════════════════════════

test('a cook-now recipe outranks one missing ingredients', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    AppState.recipes = [
      makeRecipe({ id: 601, name: 'Have Everything', effort: 'low', activeTime: 10,
        ingredients: ['Chicken', 'Rice'] }),
      makeRecipe({ id: 602, name: 'Missing Two', effort: 'low', activeTime: 10,
        ingredients: ['Chicken', 'Saffron', 'Truffle'] })
    ];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 2, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    const cands = eatCookCandidates();
    const by = {};
    cands.forEach((c) => { by[c.recipe.name] = c; });
    return {
      order: cands.map((c) => c.recipe.name),
      haveMissing: by['Have Everything'].missing,
      missMissing: by['Missing Two'].missing,
      haveScore: by['Have Everything'].score,
      missScore: by['Missing Two'].score
    };
  });

  expect(result.order[0]).toBe('Have Everything');
  expect(result.haveMissing).toBe(0);
  expect(result.missMissing).toBe(2);
  // The two recipes are identical in every other respect, so their scores TIE —
  // which is precisely the proof that availability alone decided the order.
  expect(result.haveScore).toBe(result.missScore);
});

test('a balanced low-effort recipe ranks ahead of an unbalanced normal one', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    AppState.recipes = [
      makeRecipe({ id: 611, name: 'Balanced Easy', effort: 'very-low', activeTime: 5,
        mealBalance: { protein: true, vegetables: true, carb: true },
        equipment: ['rice-cooker'], ingredients: ['Chicken', 'Rice'] }),
      makeRecipe({ id: 612, name: 'Unbalanced Normal', effort: 'normal', activeTime: 25,
        mealBalance: { protein: true, vegetables: false, carb: false },
        equipment: ['pan'], ingredients: ['Chicken', 'Rice'] })
    ];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 2, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    const cands = eatCookCandidates();
    const by = {};
    cands.forEach((c) => { by[c.recipe.name] = c; });
    const picks = getWhatShouldWeEatSuggestions();
    return {
      order: cands.map((c) => c.recipe.name),
      balancedParts: by['Balanced Easy'].parts,
      otherParts: by['Unbalanced Normal'].parts,
      easiest: picks.find((p) => p.key === 'easiest'),
    };
  });

  expect(result.order[0]).toBe('Balanced Easy');
  expect(result.balancedParts.balance).toBe(0);
  expect(result.otherParts.balance).toBe(4);
  expect(result.easiest.name).toBe('Balanced Easy');
  expect(result.easiest.reasons).toContain('Balanced');
});

test('a recipe using a use-soon ingredient is boosted, from the SAME expiry scan', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    AppState.recipes = [
      makeRecipe({ id: 621, name: 'Uses The Broccoli', effort: 'low', activeTime: 10,
        ingredients: ['Broccoli', 'Rice'] }),
      makeRecipe({ id: 622, name: 'Uses Nothing Urgent', effort: 'low', activeTime: 10,
        ingredients: ['Chicken', 'Rice'] })
    ];
    AppState.pantry = [
      // 1 day left → inside getExpirySuggestions()'s <= 3 day window.
      { id: 1, name: 'Broccoli', category: 'Vegetable', purchaseDate: daysAgo(4), shelfLifeDays: 5 },
      { id: 2, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 3, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    const cands = eatCookCandidates();
    const by = {};
    cands.forEach((c) => { by[c.recipe.name] = c; });
    return {
      order: cands.map((c) => c.recipe.name),
      boosted: by['Uses The Broccoli'].parts.expiry,
      notBoosted: by['Uses Nothing Urgent'].parts.expiry,
      ingredient: by['Uses The Broccoli'].expiringIngredient,
      // Proof it is the existing scan, not a second one.
      expiryScan: getExpirySuggestions().map((e) => e.recipe.name)
    };
  });

  expect(result.order[0]).toBe('Uses The Broccoli');
  expect(result.boosted).toBe(-8);
  expect(result.notBoosted).toBe(0);
  expect(result.ingredient).toBe('Broccoli');
  expect(result.expiryScan).toContain('Uses The Broccoli');
});

// ══ C. Effort, appliance, cleanup, active time ══════════════════════════════

test('appliance metadata orders low-friction cooking, all else equal', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    const base = { effort: 'low', activeTime: 10, ingredients: ['Chicken', 'Rice'] };
    AppState.recipes = [
      makeRecipe(Object.assign({ id: 631, name: 'No Cook', equipment: ['no-cook'] }, base)),
      makeRecipe(Object.assign({ id: 632, name: 'Rice Cooker', equipment: ['rice-cooker'] }, base)),
      makeRecipe(Object.assign({ id: 633, name: 'Steamer Combo', equipment: ['rice-cooker-steamer'] }, base)),
      makeRecipe(Object.assign({ id: 634, name: 'Instant Pot', equipment: ['instant-pot'] }, base)),
      makeRecipe(Object.assign({ id: 635, name: 'Oven', equipment: ['oven'] }, base)),
      makeRecipe(Object.assign({ id: 636, name: 'Pan', equipment: ['pan'] }, base)),
      makeRecipe(Object.assign({ id: 637, name: 'Unstated', equipment: [] }, base)),
      makeRecipe(Object.assign({ id: 638, name: 'Two Appliances', equipment: ['pan', 'oven'] }, base))
    ];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 2, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    const by = {};
    eatCookCandidates().forEach((c) => { by[c.recipe.name] = c.parts.appliance; });
    return by;
  });

  expect(result['No Cook']).toBe(0);
  expect(result['Rice Cooker']).toBe(2);
  expect(result['Steamer Combo']).toBe(2);
  expect(result['Instant Pot']).toBe(2);
  expect(result['Oven']).toBe(3);
  expect(result['Pan']).toBe(4);
  expect(result['Unstated']).toBe(2);          // neutral, not punished
  expect(result['Two Appliances']).toBe(4);    // min(pan 4, oven 3) = 3, +1 for juggling two
  // The documented preference order actually holds.
  expect(result['No Cook']).toBeLessThan(result['Rice Cooker']);
  expect(result['Rice Cooker']).toBeLessThan(result['Oven']);
  expect(result['Oven']).toBeLessThan(result['Pan']);
});

test('minimal-cleanup is a real ranking advantage', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    const base = { effort: 'low', activeTime: 10, equipment: ['pan'], ingredients: ['Chicken', 'Rice'] };
    AppState.recipes = [
      makeRecipe(Object.assign({ id: 641, name: 'Tidy', tags: ['minimal-cleanup'] }, base)),
      makeRecipe(Object.assign({ id: 642, name: 'Messy', tags: [] }, base))
    ];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 2, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    const cands = eatCookCandidates();
    const by = {};
    cands.forEach((c) => { by[c.recipe.name] = c; });
    return {
      order: cands.map((c) => c.recipe.name),
      tidy: by['Tidy'].parts.cleanup,
      messy: by['Messy'].parts.cleanup,
      tidyScore: by['Tidy'].score,
      messyScore: by['Messy'].score
    };
  });

  expect(result.tidy).toBe(-2);
  expect(result.messy).toBe(0);
  expect(result.order[0]).toBe('Tidy');
  expect(result.tidyScore).toBeLessThan(result.messyScore);
});

test('active time beats total cook time — the walk-away pot wins', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    AppState.recipes = [
      // 40 minutes total, but you leave the room after 5.
      makeRecipe({ id: 651, name: 'Slow Pressure Cooker', effort: 'low', activeTime: 5,
        equipment: ['instant-pot'], ingredients: ['Chicken', 'Rice'],
        extra: { basePrepTime: 5, baseCookTime: 35 } }),
      // 20 minutes total, all of it standing over a pan.
      makeRecipe({ id: 652, name: 'Quick Pan Fry', effort: 'low', activeTime: 20,
        equipment: ['pan'], ingredients: ['Chicken', 'Rice'],
        extra: { basePrepTime: 5, baseCookTime: 15 } })
    ];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 2, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    const cands = eatCookCandidates();
    const by = {};
    cands.forEach((c) => { by[c.recipe.name] = c; });
    return {
      order: cands.map((c) => c.recipe.name),
      slowTotal: recipeTotalMinutes(by['Slow Pressure Cooker'].recipe),
      quickTotal: recipeTotalMinutes(by['Quick Pan Fry'].recipe),
      slowActivePart: by['Slow Pressure Cooker'].parts.activeTime,
      quickActivePart: by['Quick Pan Fry'].parts.activeTime
    };
  });

  // Total time says the pan recipe is quicker...
  expect(result.slowTotal).toBe(40);
  expect(result.quickTotal).toBe(20);
  // ...but hands-on time, which is what actually costs you, says otherwise.
  expect(result.slowActivePart).toBe(0);
  expect(result.quickActivePart).toBe(2);
  expect(result.order[0]).toBe('Slow Pressure Cooker');
});

// ══ D. Variety ══════════════════════════════════════════════════════════════

test('recent cooking lowers a recipe without hiding it', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.cookedMeals = [];
    const base = { effort: 'low', activeTime: 10, equipment: ['pan'], ingredients: ['Chicken', 'Rice'] };
    AppState.recipes = [
      makeRecipe(Object.assign({ id: 661, name: 'Cooked Yesterday' }, base)),
      makeRecipe(Object.assign({ id: 662, name: 'Not For Ages' }, base)),
      // A never-cooked, easier option so Easiest and Something Different are
      // distinct picks — otherwise one recipe would claim both slots.
      makeRecipe(Object.assign({}, base, { id: 663, name: 'Brand New Easy', effort: 'assembly', activeTime: 2, equipment: ['no-cook'] }))
    ];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 2, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    AppState.cookHistory = [
      { recipeId: 661, recipeName: 'Cooked Yesterday', date: new Date(Date.now() - 864e5).toISOString(), servings: 2 },
      { recipeId: 662, recipeName: 'Not For Ages', date: new Date(Date.now() - 20 * 864e5).toISOString(), servings: 2 }
    ];
    const cands = eatCookCandidates();
    const by = {};
    cands.forEach((c) => { by[c.recipe.name] = c; });
    const picks = getWhatShouldWeEatSuggestions();
    return {
      order: cands.map((c) => c.recipe.name),
      names: cands.map((c) => c.recipe.name),
      recentVariety: by['Cooked Yesterday'].parts.variety,
      staleVariety: by['Not For Ages'].parts.variety,
      different: picks.find((p) => p.key === 'different')
    };
  });

  expect(result.recentVariety).toBe(2);   // penalised
  expect(result.staleVariety).toBe(-1);   // nudged up
  // Of the two otherwise-identical recipes, the stale one ranks higher.
  expect(result.order.indexOf('Not For Ages')).toBeLessThan(result.order.indexOf('Cooked Yesterday'));
  // Penalised, NOT hidden — it is still a candidate.
  expect(result.names).toContain('Cooked Yesterday');
  expect(result.different.name).toBe('Not For Ages');
  expect(result.different.reasons.join(' ')).toContain('Not for 20 days');
});

test('an empty cook history does not fabricate a Something Different', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    AppState.recipes = [
      makeRecipe({ id: 671, name: 'Only Recipe', effort: 'low', activeTime: 10, ingredients: ['Chicken', 'Rice'] })
    ];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 2, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    return getWhatShouldWeEatSuggestions().map((p) => p.key);
  });

  expect(result).not.toContain('different');
  expect(result).toEqual(['easiest']);
});

test('a normal-effort recipe is never mislabelled Easiest', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    AppState.recipes = [
      makeRecipe({ id: 681, name: 'Genuinely Fiddly', effort: 'normal', activeTime: 45,
        equipment: ['pan'], ingredients: ['Chicken', 'Rice'] })
    ];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 2, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    return {
      picks: getWhatShouldWeEatSuggestions().map((p) => p.key),
      // It is a candidate — just not an "Easiest".
      candidates: eatCookCandidates().map((c) => c.recipe.name)
    };
  });

  expect(result.picks).not.toContain('easiest');
  expect(result.picks).toHaveLength(0);
  expect(result.candidates).toContain('Genuinely Fiddly');
});

// ══ E. Completion hints ═════════════════════════════════════════════════════

test('an incomplete ready protein gets a simple completion hint', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.cookHistory = [];
    AppState.pantry = [];
    AppState.recipes = [
      makeRecipe({ id: 691, name: 'Roast Chicken', mealBalance: { protein: true, vegetables: false, carb: false } }),
      makeRecipe({ id: 692, name: 'Steamer Beef', equipment: ['rice-cooker-steamer'],
        mealBalance: { protein: true, vegetables: false, carb: true } }),
      makeRecipe({ id: 693, name: 'Salad Bowl', mealBalance: { protein: true, vegetables: true, carb: false } }),
      makeRecipe({ id: 694, name: 'Full Meal', mealBalance: { protein: true, vegetables: true, carb: true } }),
      makeRecipe({ id: 695, name: 'Legacy No Metadata' })
    ];
    AppState.cookedMeals = [{
      id: 'rc', name: 'Landers Lechon Manok', recipeId: 691, cookedDate: daysAgo(1),
      storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 2
    }];
    const pick = getWhatShouldWeEatSuggestions()[0];
    const R = (id) => AppState.recipes.find((r) => String(r.id) === String(id));
    return {
      readyHint: pick.hint,
      readyName: pick.name,
      proteinOnly: mealCompletionHint(R(691).mealBalance, R(691).equipment),
      steamer: mealCompletionHint(R(692).mealBalance, R(692).equipment),
      noCarb: mealCompletionHint(R(693).mealBalance, R(693).equipment),
      complete: mealCompletionHint(R(694).mealBalance, R(694).equipment),
      legacy: mealCompletionHint(R(695).mealBalance, R(695).equipment)
    };
  });

  expect(result.readyName).toBe('Landers Lechon Manok');
  expect(result.readyHint).toBe('Add rice + steamed veg');
  expect(result.proteinOnly).toBe('Add rice + steamed veg');
  expect(result.steamer).toBe('Steam veg above the rice');
  expect(result.noCarb).toBe('Add rice or bread');
  expect(result.complete).toBe('');
  // No balance data at all → no hint invented.
  expect(result.legacy).toBe('');
});

test('a manually added batch with no source recipe gets no invented hint', async ({ page }) => {
  await loadLocalApp(page);

  const hint = await rank(page, ({ daysAgo }) => {
    AppState.recipes = [];
    AppState.pantry = [];
    AppState.cookHistory = [];
    AppState.cookedMeals = [{
      id: 'manual', name: 'Takeout Lechon', cookedDate: daysAgo(1), source: 'takeout',
      storage: 'fridge', fridgeLife: 3, freezerLife: 30, portionsRemaining: 1
    }];
    return getWhatShouldWeEatSuggestions()[0].hint;
  });

  expect(hint).toBe('');
});

// ══ F. Home surface and actions ═════════════════════════════════════════════

test('Home renders the card above the existing ones, with reasons and no scores', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.recipes = [
      makeRecipe({ id: 701, name: 'Rice Cooker Chicken', equipment: ['rice-cooker'],
        effort: 'very-low', activeTime: 6, tags: ['minimal-cleanup'],
        mealBalance: { protein: true, vegetables: true, carb: true },
        ingredients: ['Chicken', 'Rice'] }),
      makeRecipe({ id: 702, name: 'Oven Pork Adobo', equipment: ['oven'], effort: 'low',
        activeTime: 10, tags: ['batch-friendly'], ingredients: ['Pork', 'Rice'] })
    ];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 2, name: 'Pork', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 3, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    AppState.cookedMeals = [{
      id: 'r9', name: 'Landers Lechon Manok', recipeId: 701, cookedDate: daysAgo(3),
      storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 2
    }];
    AppState.cookHistory = [
      { recipeId: 702, recipeName: 'Oven Pork Adobo', date: new Date(Date.now() - 15 * 864e5).toISOString(), servings: 2 }
    ];
    renderDashboard();
    const html = document.getElementById('dashboard').innerHTML;
    return {
      cards: document.querySelectorAll('.dash-card--eat').length,
      header: (document.querySelector('.dash-card--eat .dash-level-header') || {}).textContent || '',
      rows: document.querySelectorAll('.dash-card--eat .wse-row').length,
      labels: Array.from(document.querySelectorAll('.dash-card--eat .wse-label')).map((e) => e.textContent.trim()),
      names: Array.from(document.querySelectorAll('.dash-card--eat .wse-name')).map((e) => e.textContent.trim()),
      chips: Array.from(document.querySelectorAll('.dash-card--eat .wse-chip')).map((e) => e.textContent.trim()),
      actions: Array.from(document.querySelectorAll('.dash-card--eat .wse-action')).map((e) => e.textContent.trim()),
      hints: Array.from(document.querySelectorAll('.dash-card--eat .wse-hint')).map((e) => e.textContent.trim()),
      // Position relative to the cards that already existed.
      eatBeforeReady: html.indexOf('dash-card--eat') < html.indexOf('dash-card--ready'),
      readyStillThere: document.querySelectorAll('.dash-card--ready').length,
      suggestStillThere: document.querySelectorAll('.dash-card--suggest').length
    };
  });

  expect(result.cards).toBe(1);
  expect(result.header).toContain('What should we eat?');
  expect(result.rows).toBe(3);
  expect(result.labels[0]).toContain('Eat this first');
  expect(result.labels[1]).toContain('Easiest');
  expect(result.labels[2]).toContain('Something different');
  expect(result.names[0]).toBe('Landers Lechon Manok');
  expect(result.actions[0]).toBe('Used 1');

  // Reasons are shown, arithmetic is not.
  expect(result.chips.length).toBeGreaterThan(0);
  expect(result.chips.join(' ')).toContain('Ready now');
  for (const chip of result.chips) {
    expect(chip).not.toMatch(/score|points?\b|^-?\d+(\.\d+)?$/i);
  }

  // The pre-existing Home cards are untouched and still below it.
  expect(result.eatBeforeReady).toBe(true);
  expect(result.readyStillThere).toBe(1);
  expect(result.suggestStillThere).toBe(1);
});

test('Used 1 works straight from the recommendation card', async ({ page }) => {
  await loadLocalApp(page);

  await rank(page, ({ daysAgo }) => {
    AppState.recipes = [];
    AppState.pantry = [];
    AppState.cookHistory = [];
    AppState.cookedMeals = [{
      id: 'use1', name: 'Chicken Adobo', cookedDate: daysAgo(1),
      storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 3
    }];
    renderDashboard();
  });

  await expect(page.locator('.dash-card--eat .wse-chip')).toContainText(['3 portions']);
  await page.locator('.dash-card--eat .wse-action').click();
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => ({
    portions: AppState.cookedMeals[0].portionsRemaining,
    chips: Array.from(document.querySelectorAll('.dash-card--eat .wse-chip')).map((e) => e.textContent.trim())
  }));
  expect(after.portions).toBe(2);
  expect(after.chips).toContain('2 portions');
});

test('the card is omitted entirely when there is nothing honest to say', async ({ page }) => {
  await loadLocalApp(page);

  const cards = await rank(page, () => {
    AppState.recipes = [];
    AppState.pantry = [];
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    renderDashboard();
    return {
      eat: document.querySelectorAll('.dash-card--eat').length,
      picks: getWhatShouldWeEatSuggestions().length
    };
  });

  expect(cards.picks).toBe(0);
  expect(cards.eat).toBe(0);
});

// ══ G. Safety: reads only ═══════════════════════════════════════════════════

test('displaying a recommendation never touches inventory or notification state', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.recipes = [makeRecipe({ id: 711, name: 'Some Recipe', effort: 'low', activeTime: 10, ingredients: ['Chicken', 'Rice'] })];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(4), shelfLifeDays: 5 },
      { id: 2, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    AppState.cookedMeals = [{ id: 'z1', name: 'Batch', cookedDate: daysAgo(1), storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 2 }];
    AppState.cookHistory = [];
    AppState.deletions = {};
    localStorage.setItem('mealPrepFoodAlerts', JSON.stringify({ enabled: true, announced: { seeded: 'expired' } }));

    const before = JSON.stringify({
      pantry: AppState.pantry, cooked: AppState.cookedMeals,
      grocery: AppState.groceryList, deletions: AppState.deletions,
      history: AppState.cookHistory
    });
    const alertsBefore = localStorage.getItem('mealPrepFoodAlerts');

    // Rank and render several times — the read path, hammered.
    getWhatShouldWeEatSuggestions();
    eatCookCandidates();
    renderWhatShouldWeEatCard();
    renderDashboard();
    renderDashboard();

    return {
      unchanged: before === JSON.stringify({
        pantry: AppState.pantry, cooked: AppState.cookedMeals,
        grocery: AppState.groceryList, deletions: AppState.deletions,
        history: AppState.cookHistory
      }),
      alertsUnchanged: alertsBefore === localStorage.getItem('mealPrepFoodAlerts'),
      portions: AppState.cookedMeals[0].portionsRemaining
    };
  });

  expect(result.unchanged).toBe(true);
  expect(result.alertsUnchanged).toBe(true);
  expect(result.portions).toBe(2);
});

test('no new top-level state is introduced, persisted or otherwise', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.recipes = [makeRecipe({ id: 721, name: 'A Recipe', effort: 'low', activeTime: 10, ingredients: ['Chicken', 'Rice'] })];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 2, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    getWhatShouldWeEatSuggestions();
    renderDashboard();
    saveToLocalStorage();
    const persisted = JSON.parse(localStorage.getItem('mealPrepAppData'));
    const rx = /recommend|suggestion|ranking|eatPick|whatShouldWeEat|wse/i;
    return {
      appStateLeak: Object.keys(AppState).filter((k) => rx.test(k)),
      persistedLeak: Object.keys(persisted).filter((k) => rx.test(k)),
      lsKeys: Object.keys(localStorage).filter((k) => rx.test(k))
    };
  });

  expect(result.appStateLeak).toEqual([]);
  expect(result.persistedLeak).toEqual([]);
  expect(result.lsKeys).toEqual([]);
});

// ══ H. Existing surfaces keep working ═══════════════════════════════════════

test('the recipe equipment filters still work', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ makeRecipe }) => {
    AppState.recipes = [
      makeRecipe({ id: 731, name: 'RC One', equipment: ['rice-cooker'], effort: 'very-low', activeTime: 5 }),
      makeRecipe({ id: 732, name: 'Steamer One', equipment: ['rice-cooker-steamer'], effort: 'very-low', activeTime: 5 }),
      makeRecipe({ id: 733, name: 'Pot One', equipment: ['instant-pot'], effort: 'low', activeTime: 8 }),
      makeRecipe({ id: 734, name: 'Oven One', equipment: ['oven'], effort: 'low', activeTime: 8 }),
      makeRecipe({ id: 735, name: 'Pan One', equipment: ['pan'], effort: 'normal', activeTime: 25 }),
      makeRecipe({ id: 736, name: 'Raw One', equipment: ['no-cook'], effort: 'assembly', activeTime: 3 })
    ];
    renderRecipes();
    const counts = {};
    RECIPE_QUICK_FILTERS.forEach((f) => { counts[f.id] = AppState.recipes.filter(f.match).length; });

    function visibleAfter(id) {
      setRecipeQuickFilter(id);
      const names = Array.from(document.querySelectorAll('#recipes-grid .recipe-card h3, #recipes-grid .recipe-name'))
        .map((e) => e.textContent.trim());
      const cards = document.querySelectorAll('#recipes-grid .recipe-card').length;
      setRecipeQuickFilter(id); // toggle back off
      return { cards: cards, names: names };
    }

    return {
      counts: counts,
      chipsRendered: document.querySelectorAll('#recipe-quick-filters .rq-chip').length,
      riceCooker: visibleAfter('rice-cooker'),
      steamer: visibleAfter('rice-steamer'),
      pressure: visibleAfter('pressure'),
      oven: visibleAfter('oven'),
      pan: visibleAfter('pan'),
      noCook: visibleAfter('no-cook'),
      lowest: visibleAfter('lowest-effort')
    };
  });

  // rice-cooker chip matches both the plain cooker and the steamer combo.
  expect(result.counts['rice-cooker']).toBe(2);
  expect(result.counts['rice-steamer']).toBe(1);
  expect(result.counts['pressure']).toBe(1);
  expect(result.counts['oven']).toBe(1);
  expect(result.counts['pan']).toBe(1);
  expect(result.counts['no-cook']).toBe(1);
  // assembly + 2 very-low + 2 low. "Lowest effort" uses the same
  // recipeEffortScore() <= 2 gate the Home "Easiest" pick uses, so the chip and
  // the recommendation can never disagree about what counts as easy. Only the
  // normal-effort pan recipe is excluded.
  expect(result.counts['lowest-effort']).toBe(5);
  expect(result.chipsRendered).toBeGreaterThan(0);
  expect(result.riceCooker.cards).toBe(2);
  expect(result.steamer.cards).toBe(1);
  expect(result.pressure.cards).toBe(1);
  expect(result.oven.cards).toBe(1);
  expect(result.pan.cards).toBe(1);
  expect(result.noCook.cards).toBe(1);
  expect(result.lowest.cards).toBe(5);
});

test('old saved data with no recipe metadata still ranks and renders', async ({ page }) => {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      // A pre-D-055 save: no equipment / effort / activeTime / mealBalance / tags.
      localStorage.setItem('mealPrepAppData', JSON.stringify({
        recipes: [{
          id: 801, name: 'Legacy Adobo', category: 'Dinner', baseServings: 2, currentServings: 2,
          basePrepTime: 10, baseCookTime: 30,
          baseIngredients: [
            { name: 'Chicken', baseQuantity: 1, unit: 'kg', category: 'Protein' },
            { name: 'Soy Sauce', baseQuantity: 1, unit: 'cup', category: 'Pantry' }
          ],
          instructions: 'Simmer it.'
        }],
        pantry: [
          { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: '2099-01-01', shelfLifeDays: 10 },
          { id: 2, name: 'Soy Sauce', category: 'Pantry', purchaseDate: '2099-01-01', shelfLifeDays: 300 }
        ],
        cookedMeals: [{ id: 'legacy1', name: 'Legacy Batch', cookedDate: '2099-01-01', storage: 'fridge', fridgeLife: 4 }],
        cookHistory: [], groceryList: []
      }));
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);

  const result = await page.evaluate(() => {
    const cands = eatCookCandidates();
    const picks = getWhatShouldWeEatSuggestions();
    return {
      recipeCount: AppState.recipes.length,
      candidateCount: cands.length,
      // Unstated metadata gets the documented neutral defaults, not a crash.
      appliance: cands.length ? cands[0].parts.appliance : null,
      balance: cands.length ? cands[0].parts.balance : null,
      pickNames: picks.map((p) => p.name),
      readyHint: picks.length ? picks[0].hint : null,
      cardRendered: document.querySelectorAll('.dash-card--eat').length,
      dashboardOk: !!document.getElementById('dashboard')
    };
  });

  expect(result.recipeCount).toBe(1);
  expect(result.candidateCount).toBe(1);
  expect(result.appliance).toBe(2);      // unstated equipment → neutral
  expect(result.balance).toBe(4);        // unstated balance → not rewarded
  expect(result.pickNames).toContain('Legacy Batch');
  expect(result.readyHint).toBe('');     // no metadata → no invented hint
  expect(result.cardRendered).toBe(1);
  expect(result.dashboardOk).toBe(true);
});

// ══ I. Competing reasons ════════════════════════════════════════════════════

test('an expiring ingredient outweighs a slightly easier rival', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    AppState.recipes = [
      // Harder appliance and more hands-on, but it rescues the broccoli.
      makeRecipe({ id: 741, name: 'Broccoli Stir Fry', effort: 'low', activeTime: 15,
        equipment: ['pan'], ingredients: ['Broccoli', 'Rice'] }),
      // Genuinely easier, but nothing here is about to spoil.
      makeRecipe({ id: 742, name: 'Rice Cooker Chicken', effort: 'very-low', activeTime: 5,
        equipment: ['rice-cooker'], ingredients: ['Chicken', 'Rice'] })
    ];
    AppState.pantry = [
      { id: 1, name: 'Broccoli', category: 'Vegetable', purchaseDate: daysAgo(4), shelfLifeDays: 5 },
      { id: 2, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 20 },
      { id: 3, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    const by = {};
    eatCookCandidates().forEach((c) => { by[c.recipe.name] = c; });
    return {
      order: eatCookCandidates().map((c) => c.recipe.name),
      stirFry: by['Broccoli Stir Fry'].score,
      riceCooker: by['Rice Cooker Chicken'].score,
      stirFryParts: by['Broccoli Stir Fry'].parts
    };
  });

  // The expiry bonus beats the easier rival's effort/appliance edge.
  expect(result.stirFryParts.expiry).toBe(-8);
  expect(result.stirFry).toBeLessThan(result.riceCooker);
  expect(result.order[0]).toBe('Broccoli Stir Fry');
});

test('shopping outweighs convenience — a missing ingredient sinks an easier recipe', async ({ page }) => {
  await loadLocalApp(page);

  const result = await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    AppState.recipes = [
      // The easiest possible recipe — but you'd have to go out for two things.
      makeRecipe({ id: 751, name: 'Assembly But Shopping', effort: 'assembly', activeTime: 2,
        equipment: ['no-cook'], tags: ['minimal-cleanup'],
        ingredients: ['Chicken', 'Burrata', 'Prosciutto'] }),
      // Duller, but everything is already here.
      makeRecipe({ id: 752, name: 'Pan Cook Have It All', effort: 'low', activeTime: 15,
        equipment: ['pan'], ingredients: ['Chicken', 'Rice'] })
    ];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 20 },
      { id: 2, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    const by = {};
    eatCookCandidates().forEach((c) => { by[c.recipe.name] = c; });
    return {
      order: eatCookCandidates().map((c) => c.recipe.name),
      shoppingMissing: by['Assembly But Shopping'].missing,
      shoppingScore: by['Assembly But Shopping'].score,
      haveItScore: by['Pan Cook Have It All'].score,
      easiestPick: getWhatShouldWeEatSuggestions().find((p) => p.key === 'easiest').name
    };
  });

  expect(result.shoppingMissing).toBe(2);
  // The assembly recipe scores BETTER on effort/appliance/cleanup — and still
  // loses, because needing to shop is a tier above every convenience signal.
  expect(result.shoppingScore).toBeLessThan(result.haveItScore);
  expect(result.order[0]).toBe('Pan Cook Have It All');
  expect(result.easiestPick).toBe('Pan Cook Have It All');
});

// ══ J. Mobile + console health ══════════════════════════════════════════════

test('the card stays compact on a phone with no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadLocalApp(page);

  await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.recipes = [
      makeRecipe({ id: 761, name: 'Rice Cooker Chicken And Mushroom Rice', equipment: ['rice-cooker'],
        effort: 'very-low', activeTime: 6, tags: ['minimal-cleanup'],
        mealBalance: { protein: true, vegetables: true, carb: true }, ingredients: ['Chicken', 'Rice'] }),
      makeRecipe({ id: 762, name: 'Oven Pork Adobo With Extremely Long Name For Testing', equipment: ['oven'],
        effort: 'low', activeTime: 10, tags: ['batch-friendly'], ingredients: ['Pork', 'Rice'] })
    ];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 2, name: 'Pork', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 3, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    AppState.cookedMeals = [{
      id: 'm1', name: 'Landers Lechon Manok', recipeId: 761, cookedDate: daysAgo(3),
      storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 2
    }];
    AppState.cookHistory = [{ recipeId: 762, recipeName: 'Oven Pork Adobo With Extremely Long Name For Testing',
      date: new Date(Date.now() - 15 * 864e5).toISOString(), servings: 2 }];
    renderDashboard();
  });

  const card = page.locator('.dash-card--eat');
  await expect(card).toBeVisible();

  const box = await card.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // Compact: three rows must not turn Home into a scroll marathon.
  expect(box.height).toBeLessThan(420);

  // Every action button is a usable tap target and sits inside the viewport.
  const actions = page.locator('.dash-card--eat .wse-action');
  const n = await actions.count();
  expect(n).toBe(3);
  for (let i = 0; i < n; i++) {
    const b = await actions.nth(i).boundingBox();
    expect(b.x + b.width).toBeLessThanOrEqual(390);
    expect(b.height).toBeGreaterThanOrEqual(30);
  }

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('ranking and rendering raise no console or page errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR_FAILED|firebasejs/i.test(t)) return; // offline fixture
    errors.push('console: ' + t);
  });

  await loadLocalApp(page);
  await rank(page, ({ daysAgo, makeRecipe }) => {
    AppState.recipes = [
      makeRecipe({ id: 771, name: 'One', equipment: ['rice-cooker'], effort: 'very-low', activeTime: 5,
        mealBalance: { protein: true, vegetables: true, carb: true }, ingredients: ['Chicken', 'Rice'] }),
      makeRecipe({ id: 772, name: 'Two', equipment: ['pan', 'oven'], effort: 'normal', activeTime: 30,
        ingredients: ['Pork', 'Rice'] }),
      makeRecipe({ id: 773, name: 'Three', ingredients: ['Fish', 'Rice'] })
    ];
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(4), shelfLifeDays: 5 },
      { id: 2, name: 'Pork', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 3, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    AppState.cookedMeals = [
      { id: 'a', name: 'Batch A', recipeId: 771, cookedDate: daysAgo(3), storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 1 },
      { id: 'b', name: 'Batch B', cookedDate: daysAgo(30), storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 2 },
      { id: 'c', name: 'Batch C', cookedDate: daysAgo(2), storage: 'freezer', fridgeLife: 4, freezerLife: 90 }
    ];
    AppState.cookHistory = [{ recipeId: 772, recipeName: 'Two', date: new Date(Date.now() - 9 * 864e5).toISOString(), servings: 2 }];
    renderDashboard();
    renderRecipes();
    getWhatShouldWeEatSuggestions();
    return true;
  });
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);
});
