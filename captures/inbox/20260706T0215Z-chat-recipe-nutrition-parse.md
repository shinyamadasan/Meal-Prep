---
id: 20260706T0215Z-chat-recipe-nutrition-parse
command: (none)
type: unknown
captured: 2026-07-06T02:15:00.000Z
via: chat
msg_id: chat
status: new
---

Add-recipe paste is good, but I wish it were easier and could parse the WHOLE thing — including the
nutrients — from a copy-pasted recipe page.

Real example I pasted (from panlasangpinoy-style recipe pages):

Ginisang Pechay at Giniling with Oyster Sauce
Sauteed bok choy and ground pork with oyster sauce. This simple vegetable dish is best enjoyed with warm white rice. You can also pair it with fried fish.
Prep Time
5minutes mins
Cook Time
20minutes mins
Course: Main CourseCuisine: Filipino RecipeKeyword: ginisa, pechay Servings: 4 People Calories: 284kcal Author: Vanjo Merano
Ingredients
2 bunches pechay chopped
170.1 g ground pork
4 tablespoons oyster sauce
1 piece onion chopped
4 cloves garlic minced
250 g water

Salt and ground black pepper to taste
3 tablespoons cooking oil
Instructions
Heat oil in a pan. Saute onion and garlic.
Once the onion softens, add ground pork. Continue to saute until color turns light brown.
Add oyster sauce and water. Stir. Cook uncovered in medium heat until water reduces to half.
Put the pechay into the pan. Cover and cook for 2 minutes.
Season with salt and ground black pepper.
Serve with rice. Enjoy!
Nutrition
Calories: 284kcal | Carbohydrates: 15g | Protein: 14g | Fat: 20g | Saturated Fat: 4g | Cholesterol: 31mg | Sodium: 793mg | Potassium: 1242mg | Fiber: 5g | Sugar: 6g | Vitamin A: 18766IU | Vitamin C: 192mg | Calcium: 464mg | Iron: 4mg

Notes from a code read of the current parser (`parseRecipeText`, app.js):

- It returns `{ name, servings, prepTime, cookTime, category, ingredients, instructions }` — it parses
  NO nutrition at all. Nutrition is instead estimated later from ingredients (LOCAL_NUTRITION_DB /
  patchMissingNutrition), which is less accurate than the page's own published per-serving values.
- The pasted "Nutrition" block maps 1:1 onto the six fields the Recipe model already stores in
  `nutritionPerServing`: calories(284), carbs(15g), protein(14g), fat(20g), fiber(5g), sodium(793mg).
  The extra micros (saturated fat, cholesterol, potassium, sugar, vitamins, calcium, iron) have no
  home in the current model — open question whether to store or drop them.
- BUG (likely pre-existing): instruction capture never stops at a `Nutrition` (or `Notes`) header, so
  the whole nutrition block currently gets appended into the recipe's instructions text.
- Servings and prep/cook time DO appear to parse correctly from this format already.

Ask: parse the nutrition block into `nutritionPerServing` when the pasted text provides it (prefer the
page's published values over the estimate), and stop instruction capture at the Nutrition/Notes header
so it stops polluting the instructions.
