# Meal Prep Planner — Project Context

Plain HTML/CSS/JS single-page app. No build step. No framework.
Deployed on GitHub Pages at: https://shinyamadasan.github.io/Meal-Prep/

## Files
- `app.js` — all application logic (~5500+ lines)
- `style.css` — all styles
- `index.html` — single HTML file, all tabs inline

## Data Storage
- `AppState` global object holds all runtime state
- `saveData()` → calls `saveToLocalStorage()` + `saveToFirestore()`
- Firebase Auth + Firestore for cloud sync when user is logged in
- localStorage (`STORAGE_KEY`) as offline fallback
- **Important:** recipes loaded from localStorage/Firebase are plain JSON
  and may be missing fields added later. Always call `patchMissingNutrition()`
  after loading recipes.

## Key Data Structures

### AppState
```js
AppState.recipes          // user's recipe list (includes sampleRecipes on first load)
AppState.weeklyPlan       // { Monday: { breakfast, lunch, dinner, snacks[] }, ... }
AppState.pantry           // [{ id, name }]
AppState.customIngredients // storage guide items
AppState.nutritionGoals   // { calories, protein, carbs, fat, fiber, sodium }
```

### Recipe object
```js
{
  id,                    // number (1-11 for samples), string for user-added (Firestore ID)
  name,
  baseServings,          // original serving count
  currentServings,       // scaled serving count
  baseIngredients: [{ name, baseQuantity, unit, category, pricePerUnit? }],
  nutritionPerServing: { calories, protein, carbs, fat, fiber, sodium },
  fridgeLife,            // days
  freezerLife,           // days
  instructions,
  category,              // "Breakfast", "Main Dish", etc.
}
```

## Key Functions
- `renderRecipes()` — My Recipes tab
- `renderWeeklyPlanner()` — Weekly planner tab
- `renderNutritionTab()` → calls `renderWeeklyNutritionChart()`, `renderDailyNutritionBreakdown()`, `filterRecipesByNutrition()`
- `calculateRecipeNutrition(recipe)` — uses `nutritionPerServing` if present, else tries ingredient lookup
- `patchMissingNutrition(recipes)` — backfills nutrition from `sampleRecipes` for old saved data
- `filterRecipesByNutrition()` — renders recipe cards in Nutrition tab
- `openEditRecipeModal(recipeId)` — opens recipe edit form (recipeId is string OR number, always quote in onclick)
- `attachIngredientAutocomplete(inputEl)` — wires autocomplete to any text input
- `addToPantry()` / `renderPantry()` — pantry management
- `saveData()` — saves to both localStorage and Firestore

## Databases (in app.js)
- `sampleRecipes` — 11 built-in recipes with `nutritionPerServing`
- `INGREDIENT_DB` — 130+ ingredients with `{ name, unit, category, price, store }`
- `LOCAL_NUTRITION_DB` — 90+ ingredients with `{ name, calories, protein, carbs, fat, fiber, sodium }` per 100g
- `PANTRY_KNOWLEDGE` — 22 ingredients with storage guidance (location, lasts, store, spoilage, freshness)

## Nutrition Search
`searchNutritionDB()` — searches `LOCAL_NUTRITION_DB` first (instant, offline).
Falls back to USDA FoodData Central API (`DEMO_KEY`) if not found locally.

## Ingredient Autocomplete
`attachIngredientAutocomplete(input)` — works on recipe form AND pantry input.
Shows name, unit, category, price, and where to buy from `INGREDIENT_DB`.

## CSS Notes
- CSS variables in `:root` — dark mode via `[data-color-scheme="dark"]` attribute
- Do NOT add a second `:root` block — it will override dark mode (already fixed once)
- Mobile breakpoint: `@media (max-width: 768px)`

## Deployment
```
git add app.js style.css index.html
git commit -m "..."
git push origin main
```
GitHub Pages auto-deploys from main branch. Takes ~1 min to go live.

## Current State (update each session)
- Last push: commit `a190564` — fixed grocery list mobile layout (category total inline with header, checkbox inline with ingredient)
- Pending: user to confirm on phone that fix worked
- Recent major work: Settings modal (in ⋯ More menu), planner vertical scroll, grocery density pass, mobile header cleanup

## Common Bugs to Avoid
- `onclick="openEditRecipeModal(${recipe.id})"` — ALWAYS quote the id: `onclick="openEditRecipeModal('${recipe.id}')"`
  because Firestore IDs are strings and render as bare identifiers without quotes
- After loading recipes from storage, always call `patchMissingNutrition(AppState.recipes)`
  so that hardcoded sample recipe data (like nutritionPerServing) is applied to old saved copies
- PowerShell `Add-Content` mangles Unicode — use Edit tool for any file with emoji/special chars
