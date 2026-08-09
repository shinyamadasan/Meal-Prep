import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleRequest,
  isBlockedIp,
  validateTargetUrl,
  collectJsonLdBlocks,
  parseJsonLdBlocks,
  flattenJsonLdNodes,
  isRecipeNode,
  selectBestRecipe,
  extractRecipeSource,
  extractInstructions
} from '../src/index.js';

const PUBLIC = ['93.184.216.34'];
const PRIVATE = ['127.0.0.1'];

function envFor() {
  return {
    ALLOWED_ORIGINS: 'https://shinyamadasan.github.io',
    FETCH_TIMEOUT_MS: 50,
    resolveHostnameAddresses(hostname) {
      if (hostname === 'private.example') return PRIVATE;
      return PUBLIC;
    }
  };
}

function htmlResponse(body, init = {}) {
  return new Response(body, {
    status: init.status || 200,
    headers: { 'Content-Type': init.type || 'text/html; charset=UTF-8', ...(init.headers || {}) }
  });
}

function request(body, method = 'POST') {
  return new Request('https://worker.test/recipe-import', {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'https://shinyamadasan.github.io' },
    body: body == null ? undefined : JSON.stringify(body)
  });
}

test('request boundary rejects invalid methods and bodies', async () => {
  assert.equal((await handleRequest(request(null, 'GET'), envFor())).status, 405);
  assert.equal((await handleRequest(new Request('https://worker.test/recipe-import', { method: 'POST' }), envFor())).status, 400);
  assert.equal((await handleRequest(request({}), envFor())).status, 400);
});

test('url validation rejects malformed, unsupported, credentialed, and local targets', async () => {
  await assert.rejects(() => validateTargetUrl('not a url', envFor()), /INVALID_URL/);
  await assert.rejects(() => validateTargetUrl('ftp://example.com/recipe', envFor()), /INVALID_URL/);
  await assert.rejects(() => validateTargetUrl('https://user:pass@example.com/recipe', envFor()), /INVALID_URL/);
  await assert.rejects(() => validateTargetUrl('http://localhost/recipe', envFor()), /BLOCKED_TARGET/);
  await assert.rejects(() => validateTargetUrl('http://127.0.0.1/recipe', envFor()), /BLOCKED_TARGET/);
  await assert.rejects(() => validateTargetUrl('http://10.0.0.1/recipe', envFor()), /BLOCKED_TARGET/);
  await assert.rejects(() => validateTargetUrl('http://[::1]/recipe', envFor()), /BLOCKED_TARGET/);
  await assert.rejects(() => validateTargetUrl('https://private.example/recipe', envFor()), /BLOCKED_TARGET/);
  assert.equal(isBlockedIp('192.168.1.1'), true);
  assert.equal(isBlockedIp('93.184.216.34'), false);
});

test('fetch handles redirects, blocked redirect targets, loops, content type, status, size, and timeout', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url.includes('/ok')) return htmlResponse(recipeHtml('OK Recipe'));
      if (url.includes('/redirect-public')) return new Response(null, { status: 302, headers: { Location: 'https://example.com/ok' } });
      if (url.includes('/redirect-private')) return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/nope' } });
      if (url.includes('/loop')) return new Response(null, { status: 302, headers: { Location: 'https://example.com/loop' } });
      if (url.includes('/json')) return htmlResponse('{}', { type: 'application/json' });
      if (url.includes('/missing')) return htmlResponse('nope', { status: 404 });
      if (url.includes('/large')) return htmlResponse('x'.repeat(2 * 1024 * 1024 + 1));
      if (url.includes('/timeout')) return new Promise((resolve, reject) => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        setTimeout(() => reject(err), 1);
      });
      return htmlResponse(recipeHtml('Fallback'));
    };

    assert.equal((await handleRequest(request({ url: 'https://example.com/redirect-public' }), envFor())).status, 200);
    assert.equal((await handleRequest(request({ url: 'https://example.com/redirect-private' }), envFor())).status, 400);
    assert.equal((await handleRequest(request({ url: 'https://example.com/loop' }), envFor())).status, 508);
    assert.equal((await handleRequest(request({ url: 'https://example.com/json' }), envFor())).status, 415);
    assert.equal((await handleRequest(request({ url: 'https://example.com/missing' }), envFor())).status, 502);
    assert.equal((await handleRequest(request({ url: 'https://example.com/large' }), envFor())).status, 413);
    assert.equal((await handleRequest(request({ url: 'https://example.com/timeout' }), envFor())).status, 504);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('json-ld discovery handles multiple blocks, malformed blocks, arrays, @graph, and type arrays', async () => {
  const html = [
    '<script type="application/ld+json">{bad</script>',
    '<script type="application/ld+json">[{"@type":"BreadcrumbList"}]</script>',
    '<script type="application/ld+json">{"@graph":[{"@type":["Thing","Recipe"],"name":"Graph Recipe","recipeIngredient":["1 cup rice"],"recipeInstructions":["Cook rice."]}]}</script>'
  ].join('');
  const blocks = await collectJsonLdBlocks(html);
  assert.equal(blocks.length, 3);
  const parsed = parseJsonLdBlocks(blocks);
  assert.equal(parsed.values.length, 2);
  assert.equal(parsed.warnings.length, 1);
  const recipes = flattenJsonLdNodes(parsed.values).filter(isRecipeNode);
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].name, 'Graph Recipe');
});

test('multiple recipes select the most complete candidate deterministically', () => {
  const weak = { '@type': 'Recipe', name: 'Weak' };
  const strong = {
    '@type': 'Recipe',
    name: 'Strong',
    recipeYield: '4 servings',
    recipeIngredient: ['1 cup rice'],
    recipeInstructions: ['Cook.'],
    nutrition: { calories: '100 calories' },
    image: 'https://example.com/image.jpg'
  };
  assert.equal(selectBestRecipe([weak, strong]).node.name, 'Strong');
  assert.equal(selectBestRecipe([strong, weak]).node.name, 'Strong');
});

test('extracts source recipe fields without app-specific normalization', () => {
  const source = extractRecipeSource({
    '@type': 'Recipe',
    name: 'Paksiw Na Baboy Fixture',
    description: 'A sour pork stew.',
    prepTime: 'PT15M',
    cookTime: 'PT1H',
    totalTime: 'PT1H15M',
    recipeYield: ['4 servings'],
    recipeIngredient: ['2 lbs pork belly, cut into cubes'],
    recipeInstructions: [
      { '@type': 'HowToStep', text: 'Brown the pork.' },
      { '@type': 'HowToSection', name: 'Simmer', itemListElement: [{ '@type': 'HowToStep', text: 'Add vinegar.' }] }
    ],
    nutrition: {
      calories: '824 calories',
      proteinContent: '30 g',
      carbohydrateContent: '5 g',
      fatContent: '75 g',
      fiberContent: '1 g',
      sodiumContent: '1200 mg'
    },
    image: [{ '@type': 'ImageObject', url: 'https://example.com/paksiw.jpg' }],
    author: { name: 'Recipe Author' }
  }, { requestedUrl: 'https://panlasangpinoy.com/paksiw-na-baboy/', finalUrl: 'https://panlasangpinoy.com/paksiw-na-baboy/' });

  assert.equal(source.name, 'Paksiw Na Baboy Fixture');
  assert.equal(source.rawIngredients[0], '2 lbs pork belly, cut into cubes');
  assert.deepEqual(source.instructions, [
    { text: 'Brown the pork.' },
    { section: 'Simmer', text: 'Add vinegar.' }
  ]);
  assert.equal(source.recipeYield, '4 servings');
  assert.equal(source.nutrition.calories, '824 calories');
  assert.equal(source.image, 'https://example.com/paksiw.jpg');
  assert.equal(source.author, 'Recipe Author');
  assert.equal(source.sourceSite, 'panlasangpinoy.com');
});

test('missing optional data remains null or empty, never invented', () => {
  const source = extractRecipeSource({ '@type': 'Recipe', name: 'Sparse' }, { requestedUrl: 'https://example.com/r' });
  assert.equal(source.description, null);
  assert.equal(source.recipeYield, null);
  assert.deepEqual(source.rawIngredients, []);
  assert.deepEqual(source.instructions, []);
  assert.equal(source.nutrition, null);
  assert.equal(source.image, null);
});

test('endpoint returns stable success, warnings, CORS, and no-recipe envelopes', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => htmlResponse([
      '<script type="application/ld+json">{bad</script>',
      '<script type="application/ld+json">',
      JSON.stringify({ '@type': 'Recipe', name: '<img src=x>', recipeIngredient: ['1 cup rice'], recipeInstructions: ['Cook.'] }),
      '</script>'
    ].join(''));
    const res = await handleRequest(request({ url: 'https://example.com/recipe' }), envFor());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://shinyamadasan.github.io');
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.recipe.name, '<img src=x>');
    assert.equal(body.warnings.length, 1);

    globalThis.fetch = async () => htmlResponse('<html>No recipe</html>');
    const noRecipe = await handleRequest(request({ url: 'https://example.com/no-recipe' }), envFor());
    assert.equal(noRecipe.status, 422);
    assert.equal((await noRecipe.json()).errorCode, 'NO_RECIPE_FOUND');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('instruction extractor supports strings, HowToStep, and HowToSection', () => {
  assert.deepEqual(extractInstructions(['Stir.', { '@type': 'HowToStep', text: 'Simmer.' }]), [
    { text: 'Stir.' },
    { text: 'Simmer.' }
  ]);
  assert.deepEqual(extractInstructions({ '@type': 'HowToSection', name: 'Sauce', itemListElement: [{ '@type': 'HowToStep', text: 'Mix.' }] }), [
    { section: 'Sauce', text: 'Mix.' }
  ]);
});

function recipeHtml(name) {
  return '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Recipe',
    name,
    recipeIngredient: ['1 cup rice'],
    recipeInstructions: ['Cook.']
  }) + '</script>';
}
