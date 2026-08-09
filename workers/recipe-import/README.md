# Recipe Import Worker

Small server-side boundary for Recipe URL Import. The static app posts a recipe URL to this Worker, and the Worker returns normalized source values from Schema.org Recipe JSON-LD.

## Architecture

1. Static app posts `{ "url": "https://example.com/recipe" }` to `/recipe-import`.
2. Worker validates the URL, applies SSRF/network protections, fetches bounded HTML, extracts JSON-LD, handles `@graph`, selects the best Recipe object, and returns primitive source values.
3. Client converts the Worker response into `RecipeImportDraft`, applies app-specific ingredient/category normalization, and saves through `buildRecipeFromImportDraft()` -> `persistRecipe()`.

The Worker is stateless. It does not know about `AppState`, pantry categories, Firestore, grocery logic, or saved recipes.

## Local Tests

From the repository root:

```powershell
npm run test:worker
```

Worker deployment dry run:

```powershell
npx wrangler deploy --dry-run --config workers/recipe-import/wrangler.jsonc
```

## Deployment

Authenticate Cloudflare first if needed:

```powershell
npx wrangler login
```

Deploy:

```powershell
npx wrangler deploy --config workers/recipe-import/wrangler.jsonc
```

The default config deploys to workers.dev with:

- Worker name: `meal-prep-recipe-import`
- Entry point: `src/index.js`
- Allowed origin: `https://shinyamadasan.github.io`

Do not loosen CORS to `*` for production.

## Static App Endpoint

The app reads the endpoint from:

```js
window.RECIPE_IMPORT_ENDPOINT
```

Set this to the deployed Worker `/recipe-import` URL before using URL import in production. Do not hard-code a fake endpoint.

Example:

```html
<script>
  window.RECIPE_IMPORT_ENDPOINT = 'https://meal-prep-recipe-import.<account>.workers.dev/recipe-import';
</script>
```

## Supported Import Method

V1 supports recipe pages that expose Schema.org Recipe JSON-LD. The Worker is deterministic and does not use AI.

Known limitations:

- No generic HTML scraping fallback.
- No AI fallback.
- No OCR or social/video import.
- Some websites may block automated server fetches.
- Remote recipe images are preview-only and are not persisted.
- Ambiguous ingredient quantities require review.
- Ambiguous yields require serving-count review.
- Source storage guidance is not inferred.
- Only `sourceUrl`, `sourceSite`, and `importedAt` are saved as provenance.
