// TASK-071: consume_ready_food / POST /v1/ready-food/consume parity with the app's canonical
// "Used 1" path. Every successful consume must atomically write the cookedMeals change AND ONE
// append-only mealConsumptions fact in a single guarded PATCH (one revision +1). Runs entirely
// against the in-memory fake Firestore; nothing here touches the network or production.
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest, handleRequest } from '../src/index.js';
import { consumeReadyFood, consumeWriteSpec } from '../src/operations/readyFood.js';
import { NotFoundError, ValidationError, InsufficientServingsError } from '../src/errors.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_WRITE_SCOPE } from '../src/mcpAuth.js';
import { testEnv, request } from './support/fixtures.js';
import { createFakeFirestore } from './support/fakeFirestore.js';

const NOW = 1_800_000_000;
const FACT_KEYS = ['consumedAt', 'cookedMealId', 'id', 'mealName', 'portionsConsumed', 'recipeId'];
const MC_ID = /^mc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEAL = { id: 'meal-1', recipeId: 'recipe-9', name: 'Chili', portionsRemaining: 3, initialPortions: 3, storage: 'fridge', cookedDate: '2026-01-15' };
const OTHER = { id: 'meal-2', name: 'Adobo', portionsRemaining: 2, storage: 'freezer', cookedDate: '2026-01-10' };
const PANTRY = [{ id: 'p1', name: 'Rice', quantity: 1, staple: false }];
const PRIOR = [
  { id: 'mc_prior-1', cookedMealId: 'meal-0', recipeId: null, mealName: 'Soup', portionsConsumed: 1, consumedAt: '2026-01-01T10:00:00.000Z' },
  { id: 'legacy-odd', anything: 'kept', n: 7 } // not canonical: must still survive untouched
];
const clone = (v) => JSON.parse(JSON.stringify(v));

function assertCanonicalFact(fact) {
  assert.deepEqual(Object.keys(fact).sort(), FACT_KEYS, 'closed six-field schema, no provenance field');
  assert.match(fact.id, MC_ID);
  assert.equal(typeof fact.cookedMealId, 'string');
  assert.ok(fact.recipeId === null || typeof fact.recipeId === 'string');
  assert.equal(typeof fact.mealName, 'string');
  assert.ok(Number.isInteger(fact.portionsConsumed) && fact.portionsConsumed >= 1 && fact.portionsConsumed <= 99);
  assert.equal(new Date(fact.consumedAt).toISOString(), fact.consumedAt, 'canonical ISO instant');
}

// ── Operation level (pure) ───────────────────────────────────────────────────

const state = (over = {}) => Object.assign({ cookedMeals: [MEAL, OTHER], deletionsCookedMeals: {}, mealConsumptions: PRIOR }, over);
const FIXED = { now: () => new Date('2026-02-03T04:05:06.789Z'), newId: () => 'mc_00000000-0000-4000-8000-000000000001' };

test('partial: one fact with pre-mutation snapshots, prior facts byte-identical, nothing else touched', () => {
  const input = state();
  const before = JSON.stringify(input);
  const r = consumeReadyFood(input, { cookedMealId: 'meal-1', servings: 1 }, FIXED);
  assert.equal(JSON.stringify(input), before, 'inputs never mutated');
  assert.equal(r.removed, false);
  assert.equal(r.cookedMeals[0].portionsRemaining, 2);
  assert.deepEqual(r.cookedMeals[1], OTHER);
  assert.equal(r.mealConsumptions.length, PRIOR.length + 1);
  assert.equal(JSON.stringify(r.mealConsumptions.slice(0, PRIOR.length)), JSON.stringify(PRIOR));
  assert.deepEqual(r.consumption, {
    id: 'mc_00000000-0000-4000-8000-000000000001', cookedMealId: 'meal-1', recipeId: 'recipe-9',
    mealName: 'Chili', portionsConsumed: 1, consumedAt: '2026-02-03T04:05:06.789Z'
  });
  assert.equal(r.mealConsumptions[PRIOR.length], r.consumption);
  assert.deepEqual(r.deletionsCookedMeals, {});
});

test('default identity is mc_<UUID> and the default instant is a canonical ISO string', () => {
  const r = consumeReadyFood(state(), { cookedMealId: 'meal-1', servings: 1 });
  assertCanonicalFact(r.consumption);
  const second = consumeReadyFood(state(), { cookedMealId: 'meal-1', servings: 1 });
  assert.notEqual(second.consumption.id, r.consumption.id);
});

test('multi-serving: 2.9 floors to 2 and is ONE fact with portionsConsumed=2', () => {
  const r = consumeReadyFood(state(), { cookedMealId: 'meal-1', servings: 2.9 }, FIXED);
  assert.equal(r.mealConsumptions.length, PRIOR.length + 1, 'exactly one new fact, not two');
  assert.equal(r.consumption.portionsConsumed, 2);
  assert.equal(r.cookedMeals[0].portionsRemaining, 1);
});

test('final serving: snapshots taken before removal, one fact, one tombstone at the SAME instant, item=null', () => {
  const r = consumeReadyFood(state({ deletionsCookedMeals: { old: 'x' } }), { cookedMealId: 'meal-1', servings: 3 }, FIXED);
  assert.equal(r.removed, true);
  assert.equal(r.item, null);
  assert.deepEqual(r.cookedMeals, [OTHER]);
  assert.deepEqual(r.deletionsCookedMeals, { old: 'x', 'meal-1': '2026-02-03T04:05:06.789Z' });
  assert.equal(r.consumption.portionsConsumed, 3);
  assert.equal(r.consumption.mealName, 'Chili');
  assert.equal(r.consumption.recipeId, 'recipe-9');
  assert.equal(r.consumption.consumedAt, r.deletionsCookedMeals['meal-1'], 'one instant for the whole command');
  assert.equal(r.mealConsumptions.length, PRIOR.length + 1);
});

test('recipeId is null when the batch has none, and ids are stringified like the app does', () => {
  const r = consumeReadyFood(state({ cookedMeals: [Object.assign({}, OTHER, { id: 42 })] }), { cookedMealId: '42', servings: 1 }, FIXED);
  assert.equal(r.consumption.recipeId, null);
  assert.equal(r.consumption.cookedMealId, '42');
  const numeric = consumeReadyFood(state({ cookedMeals: [Object.assign({}, MEAL, { recipeId: 7 })] }), { cookedMealId: 'meal-1', servings: 1 }, FIXED);
  assert.equal(numeric.consumption.recipeId, '7');
});

test('write spec: partial and final field paths are exactly the atomic sets', () => {
  const partial = consumeWriteSpec(consumeReadyFood(state(), { cookedMealId: 'meal-1', servings: 1 }, FIXED));
  assert.deepEqual(partial.fieldPaths, ['cookedMeals', 'mealConsumptions']);
  assert.deepEqual(Object.keys(partial.fields).sort(), ['cookedMeals', 'mealConsumptions']);
  const final = consumeWriteSpec(consumeReadyFood(state(), { cookedMealId: 'meal-1', servings: 3 }, FIXED));
  assert.deepEqual(final.fieldPaths, ['cookedMeals', 'deletions.cookedMeals', 'mealConsumptions']);
  assert.deepEqual(Object.keys(final.fields).sort(), ['cookedMeals', 'deletions', 'mealConsumptions']);
});

test('every failure throws before producing any state (zero fact)', () => {
  const cases = [
    ['not found', { cookedMealId: 'ghost', servings: 1 }, NotFoundError],
    ['insufficient', { cookedMealId: 'meal-1', servings: 4 }, InsufficientServingsError],
    ['zero', { cookedMealId: 'meal-1', servings: 0 }, ValidationError],
    ['too many', { cookedMealId: 'meal-1', servings: 100 }, ValidationError],
    ['string', { cookedMealId: 'meal-1', servings: '1' }, ValidationError],
    ['NaN', { cookedMealId: 'meal-1', servings: NaN }, ValidationError]
  ];
  for (const [label, input, Err] of cases) {
    const s = state();
    const before = JSON.stringify(s);
    assert.throws(() => consumeReadyFood(s, input, FIXED), Err, label);
    assert.equal(JSON.stringify(s), before, label + ': state untouched');
  }
  const untracked = state({ cookedMeals: [{ id: 'u', name: 'Soup', portionsRemaining: null }] });
  assert.throws(() => consumeReadyFood(untracked, { cookedMealId: 'u', servings: 1 }, FIXED), ValidationError, 'untracked');
  const nameless = state({ cookedMeals: [{ id: 'n', portionsRemaining: 2 }] });
  assert.throws(() => consumeReadyFood(nameless, { cookedMealId: 'n', servings: 1 }, FIXED), ValidationError, 'nameless batch cannot be described by the closed schema');
});

test('a present-but-non-array mealConsumptions is never overwritten', () => {
  for (const bad of [{}, 'x', 5, undefined, null]) {
    assert.throws(() => consumeReadyFood(state({ mealConsumptions: bad }), { cookedMealId: 'meal-1', servings: 1 }, FIXED), /not an array/);
  }
});

test('id collision handling: skips an already-used id, and fails loud rather than reuse one', () => {
  const ids = ['mc_prior-1', 'mc_fresh'];
  const r = consumeReadyFood(state(), { cookedMealId: 'meal-1', servings: 1 }, { now: FIXED.now, newId: () => ids.shift() });
  assert.equal(r.consumption.id, 'mc_fresh');
  assert.throws(() => consumeReadyFood(state(), { cookedMealId: 'meal-1', servings: 1 }, { now: FIXED.now, newId: () => 'mc_prior-1' }), /unique/);
});

// ── Persistence level: REST + MCP through the fake Firestore ─────────────────

function mcpRequest(args) {
  return new Request('https://localhost/mcp', {
    method: 'POST',
    headers: { Host: 'localhost', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', Authorization: 'Bearer oauth-test-token' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'consume_ready_food', arguments: args } })
  });
}
async function mcpMessage(response) {
  const text = await response.text();
  if ((response.headers.get('Content-Type') || '').includes('text/event-stream')) {
    return JSON.parse(text.split(/\r?\n/).find((l) => l.startsWith('data: ')).slice(6));
  }
  return JSON.parse(text);
}
const mcpContext = () => ({
  auth: { token: 't', audience: MCP_RESOURCE, expiresAt: NOW + 300, scope: [MCP_WRITE_SCOPE], userId: 'test-owner-subject', clientId: 'https://chatgpt.com/oauth/client.json' },
  props: { ownerSubject: 'test-owner-subject', issuer: MCP_ISSUER, resource: MCP_RESOURCE, notBefore: NOW - 1 }
});

// Wraps the fake so every document GET mask and PATCH (mask, precondition) is observable, with an
// optional hook to hold/force-fail PATCHes.
function instrumented(fields, { patchHook } = {}) {
  const fake = createFakeFirestore({ fields });
  const seen = { getMasks: [], patches: [], ok: 0 };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const isDoc = u.pathname.includes('/documents/users/');
    const method = (init.method || 'GET').toUpperCase();
    if (isDoc && method === 'GET') seen.getMasks.push(u.searchParams.getAll('mask.fieldPaths'));
    if (isDoc && method === 'PATCH') {
      seen.patches.push({ mask: u.searchParams.getAll('updateMask.fieldPaths'), precondition: u.searchParams.get('currentDocument.updateTime') });
      if (patchHook) { const forced = await patchHook(); if (forced) return forced; }
      const response = await fake.fetch(url, init);
      if (response.ok) seen.ok += 1;
      return response;
    }
    return fake.fetch(url, init);
  };
  const env = testEnv();
  const deps = { nowSeconds: NOW, fetchImpl, cryptoImpl: globalThis.crypto };
  return {
    fake, seen,
    mcp: (args) => routeRequest(mcpRequest(args), env, deps, mcpContext()).then(mcpMessage),
    rest: (body) => handleRequest(request('/v1/ready-food/consume', { method: 'POST', body }), env, deps).then(async (r) => ({ status: r.status, body: await r.json() }))
  };
}
const seed = (extra = {}) => Object.assign({ version: 0, pantry: PANTRY, cookedMeals: [MEAL, OTHER], mealConsumptions: clone(PRIOR) }, extra);

for (const surface of ['mcp', 'rest']) {
  const run = async (b, args) => {
    if (surface === 'mcp') {
      const m = await b.mcp(args);
      return { ok: m.result.isError === undefined, out: m.result.structuredContent, text: m.result.content && m.result.content[0].text };
    }
    const r = await b.rest(args);
    return { ok: r.status === 200, out: r.body, text: r.body.error && r.body.error.code };
  };

  test(surface + ' partial consume: ONE guarded PATCH writes cookedMeals + mealConsumptions + version, revision +1', async () => {
    const b = instrumented(seed());
    const res = await run(b, { cookedMealId: 'meal-1', servings: 2, expectedRevision: 0 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.out.revision, 1);
    assert.equal(res.out.removed, false);
    assert.equal(b.seen.patches.length, 1, 'single PATCH');
    assert.deepEqual(b.seen.patches[0].mask.slice().sort(), ['cookedMeals', 'mealConsumptions', 'version']);
    assert.ok(b.seen.patches[0].precondition, 'update-time guarded');
    const f = b.fake.store.fields;
    assert.equal(f.version, 1);
    assert.equal(f.cookedMeals[0].portionsRemaining, 1);
    assert.equal(f.mealConsumptions.length, PRIOR.length + 1);
    assert.equal(JSON.stringify(f.mealConsumptions.slice(0, PRIOR.length)), JSON.stringify(PRIOR), 'history preserved byte-for-byte');
    const fact = f.mealConsumptions[PRIOR.length];
    assertCanonicalFact(fact);
    assert.deepEqual([fact.cookedMealId, fact.recipeId, fact.mealName, fact.portionsConsumed], ['meal-1', 'recipe-9', 'Chili', 2]);
    assert.deepEqual(f.pantry, PANTRY);
    assert.deepEqual(f.deletions, {});
    assert.deepEqual(f.cookedMeals[1], OTHER);
  });

  test(surface + ' final serving: cookedMeals + tombstone + fact in ONE PATCH; fact snapshots the removed batch', async () => {
    const b = instrumented(seed());
    const res = await run(b, { cookedMealId: 'meal-1', servings: 3, expectedRevision: 0 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.out.removed, true);
    assert.equal(res.out.item, null);
    assert.equal(res.out.revision, 1);
    assert.equal(b.seen.patches.length, 1);
    assert.deepEqual(b.seen.patches[0].mask.slice().sort(), ['cookedMeals', 'deletions.cookedMeals', 'mealConsumptions', 'version']);
    const f = b.fake.store.fields;
    assert.deepEqual(f.cookedMeals, [OTHER]);
    assert.deepEqual(Object.keys(f.deletions.cookedMeals), ['meal-1']);
    assert.equal(f.mealConsumptions.length, PRIOR.length + 1);
    const fact = f.mealConsumptions[PRIOR.length];
    assertCanonicalFact(fact);
    assert.deepEqual([fact.cookedMealId, fact.recipeId, fact.mealName, fact.portionsConsumed], ['meal-1', 'recipe-9', 'Chili', 3]);
    assert.equal(fact.consumedAt, f.deletions.cookedMeals['meal-1']);
  });

  test(surface + ' multi-serving 2.9 writes one fact with portionsConsumed=2', async () => {
    const b = instrumented(seed());
    const res = await run(b, { cookedMealId: 'meal-1', servings: 2.9, expectedRevision: 0 });
    assert.equal(res.ok, true, JSON.stringify(res));
    const facts = b.fake.store.fields.mealConsumptions;
    assert.equal(facts.length, PRIOR.length + 1);
    assert.equal(facts[PRIOR.length].portionsConsumed, 2);
  });

  test(surface + ' a document with no mealConsumptions yet gets its first fact as a one-element array', async () => {
    const fields = seed();
    delete fields.mealConsumptions;
    const b = instrumented(fields);
    const res = await run(b, { cookedMealId: 'meal-1', servings: 1, expectedRevision: 0 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(b.fake.store.fields.mealConsumptions.length, 1);
    assertCanonicalFact(b.fake.store.fields.mealConsumptions[0]);
  });

  test(surface + ' failures leave zero facts and zero PATCHes (stale, not found, insufficient, invalid, untracked)', async () => {
    const cases = [
      ['stale', { cookedMealId: 'meal-1', servings: 1, expectedRevision: 5 }],
      ['not found', { cookedMealId: 'ghost', servings: 1, expectedRevision: 0 }],
      ['insufficient', { cookedMealId: 'meal-1', servings: 4, expectedRevision: 0 }],
      ['invalid servings', { cookedMealId: 'meal-1', servings: 0, expectedRevision: 0 }],
      ['untracked', { cookedMealId: 'meal-u', servings: 1, expectedRevision: 0 }]
    ];
    for (const [label, args] of cases) {
      const b = instrumented(seed({ cookedMeals: [MEAL, OTHER, { id: 'meal-u', name: 'Soup', portionsRemaining: null }] }));
      const snapshot = JSON.stringify(b.fake.store.fields);
      const res = await run(b, args);
      assert.equal(res.ok, false, label);
      assert.equal(b.seen.patches.length, 0, label + ': no write attempted');
      assert.equal(JSON.stringify(b.fake.store.fields), snapshot, label + ': store untouched');
    }
  });

  test(surface + ' persistence failure: single attempt, no retry, store (and history) unchanged', async () => {
    const b = instrumented(seed(), { patchHook: async () => new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), { status: 503 }) });
    const snapshot = JSON.stringify(b.fake.store.fields);
    const res = await run(b, { cookedMealId: 'meal-1', servings: 1, expectedRevision: 0 });
    assert.equal(res.ok, false);
    assert.equal(b.seen.patches.length, 1, 'no retry');
    assert.equal(JSON.stringify(b.fake.store.fields), snapshot);
  });

  test(surface + ' refuses to overwrite a corrupt non-array mealConsumptions', async () => {
    const b = instrumented(seed({ mealConsumptions: { corrupt: true } }));
    const snapshot = JSON.stringify(b.fake.store.fields);
    const res = await run(b, { cookedMealId: 'meal-1', servings: 1, expectedRevision: 0 });
    assert.equal(res.ok, false);
    assert.equal(b.seen.patches.length, 0);
    assert.equal(JSON.stringify(b.fake.store.fields), snapshot);
  });
}

test('the read mask now includes mealConsumptions (and only that was added)', async () => {
  const b = instrumented(seed());
  await b.mcp({ cookedMealId: 'meal-1', servings: 1, expectedRevision: 0 });
  assert.deepEqual(b.seen.getMasks[0].slice().sort(), ['cookedMeals', 'deletions', 'mealConsumptions', 'pantry', 'version']);
});

// ── Concurrency ──────────────────────────────────────────────────────────────

function racing(fields) {
  const fake = createFakeFirestore({ fields });
  const stats = { gets: 0, patches: 0, ok: 0 };
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async (url, init = {}) => {
    const isDoc = new URL(url).pathname.includes('/documents/users/');
    const method = (init.method || 'GET').toUpperCase();
    if (isDoc && method === 'GET') {
      stats.gets += 1;
      const r = await fake.fetch(url, init);
      if (stats.gets === 2) release();
      return r;
    }
    if (isDoc && method === 'PATCH') {
      stats.patches += 1;
      await barrier;
      const r = await fake.fetch(url, init);
      if (r.ok) stats.ok += 1;
      return r;
    }
    return fake.fetch(url, init);
  };
  const env = testEnv();
  const deps = { nowSeconds: NOW, fetchImpl, cryptoImpl: globalThis.crypto };
  return { fake, stats, call: (args) => routeRequest(mcpRequest(args), env, deps, mcpContext()).then(mcpMessage) };
}

for (const [label, servings] of [['partial', 1], ['final-serving', 3]]) {
  test('two same-revision ' + label + ' consumes: one wins, one conflicts, exactly one fact, revision +1 once, no retry', async () => {
    const { fake, stats, call } = racing(seed());
    const args = { cookedMealId: 'meal-1', servings, expectedRevision: 0 };
    const results = await Promise.all([call(args), call(args)]);
    assert.equal(results.filter((m) => m.result.isError === undefined).length, 1);
    assert.equal(results.filter((m) => m.result.isError === true && /^revision_conflict/.test(m.result.content[0].text)).length, 1);
    assert.equal(stats.patches, 2);
    assert.equal(stats.ok, 1, 'one mutation landed; no third PATCH');
    const f = fake.store.fields;
    assert.equal(f.version, 1);
    assert.equal(f.mealConsumptions.length, PRIOR.length + 1, 'exactly one new fact');
    assert.equal(Object.keys(f.deletions.cookedMeals || {}).length, servings === 3 ? 1 : 0, 'at most one tombstone');
  });
}
