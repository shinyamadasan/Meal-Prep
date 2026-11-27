// TASK-095 (PROP-041 P1-5): undo_request — recoverable chat changes for 30 days, never over newer
// changes, never deleting a meal-consumption ledger fact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE, MCP_WRITE_SCOPE } from '../src/mcpAuth.js';
import * as requests from '../src/operations/requests.js';
import { testEnv } from './support/fixtures.js';
import { createFakeFirestore, simulateAppWrite } from './support/fakeFirestore.js';

const NOW = 1_800_000_000;
const CLOCK_MS = Date.parse('2026-11-27T03:04:05.678Z');
const CLOCK_ISO = new Date(CLOCK_MS).toISOString();
const DAY_MS = 24 * 60 * 60 * 1000;
const OWNER = 'test-owner-subject';

const CHICKEN = { id: 'chicken', name: 'Chicken', quantity: 500, unit: 'g', staple: false, category: 'protein', storage: 'fridge', updatedAt: '2026-11-20T00:00:00.000Z' };
const EGGS = { id: 'eggs', name: 'Eggs', quantity: 6, unit: 'pcs', staple: false, category: 'dairy', storage: 'fridge', updatedAt: '2026-11-20T00:00:00.000Z' };
const SALT = { id: 'salt', name: 'Salt', staple: true, stockLevel: 'full', quantity: 1, unit: 'kg', category: 'spices', updatedAt: '2026-11-20T00:00:00.000Z' };
const RICE = { id: 'rice', name: 'Rice', staple: true, stockLevel: 'empty', category: 'grains', updatedAt: '2026-11-20T00:00:00.000Z' };
const MEAL = { id: 'meal-1', name: 'Chili', recipeId: 'recipe-9', portionsRemaining: 3, storage: 'fridge', cookedDate: '2026-11-26' };
const PRIOR_FACT = { id: 'mc-prior', cookedMealId: 'meal-0', recipeId: null, mealName: 'Old', portionsConsumed: 1, consumedAt: '2026-11-01T00:00:00.000Z' };

function seed() {
  return {
    version: 3,
    pantry: [structuredClone(CHICKEN), structuredClone(EGGS), structuredClone(SALT), structuredClone(RICE)],
    cookedMeals: [structuredClone(MEAL)],
    mealConsumptions: [structuredClone(PRIOR_FACT)],
    deletions: { pantry: { 'old-lot': '2026-10-01T00:00:00.000Z' }, cookedMeals: {} }
  };
}

function context() {
  return {
    auth: { token: 'not-a-real-token', audience: MCP_RESOURCE, expiresAt: NOW + 300, scope: [MCP_SCOPE, MCP_WRITE_SCOPE], userId: OWNER, clientId: 'https://chatgpt.com/oauth/client.json' },
    props: { ownerSubject: OWNER, issuer: MCP_ISSUER, resource: MCP_RESOURCE, notBefore: NOW - 1 }
  };
}

function rpc(method, params) {
  return new Request('https://localhost/mcp', {
    method: 'POST',
    headers: { Host: 'localhost', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
}

async function messageOf(response) {
  const raw = await response.text();
  if ((response.headers.get('Content-Type') || '').includes('text/event-stream')) {
    return JSON.parse(raw.split(/\r?\n/).find((line) => line.startsWith('data: ')).slice(6));
  }
  return JSON.parse(raw);
}

function bridge(fields = seed(), { hook } = {}) {
  const fake = createFakeFirestore({ fields });
  const calls = [];
  const clock = { ms: CLOCK_MS };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    let kind = 'other';
    if (u.pathname.endsWith('/documents:commit')) kind = 'commit';
    else if (/\/mcpRequests\//.test(u.pathname)) kind = 'requestGet';
    else if (/\/documents\/users\/[^/]+$/.test(u.pathname)) kind = method === 'GET' ? 'docGet' : 'patch';
    calls.push({ kind, url, init });
    if (hook) {
      const replaced = await hook(kind, url, init, fake);
      if (replaced) return replaced;
    }
    return fake.fetch(url, init);
  };
  const deps = { nowSeconds: NOW, now: () => clock.ms, fetchImpl, cryptoImpl: globalThis.crypto };
  const call = (name, args) => routeRequest(rpc('tools/call', { name, arguments: args }), testEnv(), deps, context()).then(messageOf);
  const count = (kind) => calls.filter((c) => c.kind === kind).length;
  const undo = (requestId, undoRequestId, expectedRevision = fake.store.fields.version) =>
    call('undo_request', { requestId, undoRequestId, expectedRevision });
  // Everything a write could touch: the user document AND every request record.
  const snapshot = () => JSON.stringify({ store: fake.store, requests: [...fake.requests.entries()] });
  return { fake, calls, call, count, undo, clock, snapshot };
}

function text(message) {
  return message.result.content && message.result.content[0] && message.result.content[0].text;
}

function ok(message, label) {
  assert.equal(message.result.isError, undefined, (label || '') + ': ' + text(message));
  return message.result.structuredContent;
}

function find(list, id) {
  return list.find((r) => String(r.id) === id);
}

// Refused with ZERO writes: no commit, user document and all request records byte-identical.
async function assertRefused(b, promise, reason) {
  const before = b.snapshot();
  const commits = b.count('commit');
  const message = await promise;
  assert.equal(message.result.isError, true, 'expected a refusal: ' + JSON.stringify(message.result));
  assert.match(text(message), new RegExp('^' + reason + ': '));
  assert.equal(b.count('commit'), commits, reason + ': no commit attempted');
  assert.equal(b.snapshot(), before, reason + ': nothing written');
  return text(message);
}

// The stored copy without the restamped updatedAt.
function withoutUpdatedAt(record) {
  const copy = Object.assign({}, record);
  delete copy.updatedAt;
  return copy;
}

// ── Public contract ──────────────────────────────────────────────────────────────────────────

test('tools/list: undo_request has a strict schema, write scope and destructive annotations', async () => {
  const response = await routeRequest(rpc('tools/list', {}), testEnv(), { nowSeconds: NOW }, context());
  const tool = (await messageOf(response)).result.tools.find((t) => t.name === 'undo_request');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required.slice().sort(), ['expectedRevision', 'requestId', 'undoRequestId']);
  assert.equal(tool.inputSchema.additionalProperties, false);
  for (const key of ['requestId', 'undoRequestId']) {
    assert.equal(tool.inputSchema.properties[key].pattern, '^[A-Za-z0-9_-]{8,128}$', key);
  }
  assert.equal(tool.inputSchema.properties.expectedRevision.type, 'integer');
  assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
  assert.ok(!tool.outputSchema.required.includes('replayed'));
  for (const reason of ['request_not_found', 'undo_expired', 'already_undone', 'changed_since', 'id_in_use', 'undo_of_undo', 'nothing_to_undo', 'undo_not_supported', 'undo_record_incomplete']) {
    assert.match(tool.description, new RegExp(reason), reason);
  }
});

test('malformed requestId or undoRequestId, or unknown keys, fail before any Firestore access', async () => {
  const cases = [
    { requestId: 'short', undoRequestId: 'undo-000001', expectedRevision: 4 },
    { requestId: 'orig-000001', undoRequestId: 'bad id!!', expectedRevision: 4 },
    { requestId: 'orig-000001', expectedRevision: 4 },
    { undoRequestId: 'undo-000001', expectedRevision: 4 },
    { requestId: 'orig-000001', undoRequestId: 'undo-000001' },
    { requestId: 'orig-000001', undoRequestId: 'undo-000001', expectedRevision: 4, uid: 'other' }
  ];
  for (const args of cases) {
    const b = bridge();
    const message = await b.call('undo_request', args);
    assert.equal(message.result.isError, true, JSON.stringify(args));
    assert.equal(b.calls.length, 0, JSON.stringify(args) + ': no Firestore access');
  }
});

// ── New request records carry the after-state undo needs ─────────────────────────────────────

test('every new request record stores `after`: changed records, added records and the tombstone values written', async () => {
  const b = bridge();
  ok(await b.call('consume_stock', { requestId: 'after-zero-01', ingredientId: 'chicken', quantity: 500, expectedUnit: 'g', expectedRevision: 3 }));
  const removal = b.fake.requestRecord('after-zero-01');
  assert.deepEqual(removal.after.pantry, []);
  assert.deepEqual(Object.keys(removal.after.deletions.pantry), ['chicken']);
  assert.equal(removal.after.deletions.pantry.chicken, b.fake.store.fields.deletions.pantry.chicken);
  assert.deepEqual(removal.before.deletions.pantry, { chicken: null });

  ok(await b.call('set_inventory_quantity', { requestId: 'after-set-001', ingredientId: 'eggs', quantity: 12, expectedUnit: 'pcs', expectedRevision: 4 }));
  const set = b.fake.requestRecord('after-set-001');
  assert.deepEqual(set.after.pantry, [find(b.fake.store.fields.pantry, 'eggs')]);
  assert.deepEqual(set.after.deletions, {});

  ok(await b.call('record_ready_food', { requestId: 'after-rec-001', name: 'Soup', servings: 2, storage: 'fridge', cookedDate: '2026-11-26', expectedRevision: 5 }));
  const rec = b.fake.requestRecord('after-rec-001');
  assert.equal(rec.after.cookedMeals.length, 1);
  assert.deepEqual(rec.after.cookedMeals, rec.added.cookedMeals);

  ok(await b.call('mark_in_stock', { requestId: 'after-noop-01', ingredientId: 'salt', expectedRevision: 6 }));
  assert.deepEqual(b.fake.requestRecord('after-noop-01').after, { pantry: [], cookedMeals: [], deletions: {} });
});

// ── Undo of each write tool ──────────────────────────────────────────────────────────────────

test('undo set_inventory_quantity: prior value back, updatedAt restamped, ONE commit of three writes', async () => {
  const b = bridge();
  ok(await b.call('set_inventory_quantity', { requestId: 'set-eggs-0001', ingredientId: 'eggs', quantity: 12, expectedUnit: 'pcs', expectedRevision: 3 }));
  const originalUpdateTime = b.fake.requests.get('set-eggs-0001').updateTime;
  const userUpdateTime = b.fake.store.updateTime;
  const commits = b.count('commit');

  const result = ok(await b.undo('set-eggs-0001', 'undo-eggs-001', 4));
  assert.deepEqual(result, {
    ok: true, revision: 5, undoneRequestId: 'set-eggs-0001', undoneTool: 'set_inventory_quantity',
    restored: [{ collection: 'pantry', id: 'eggs' }], removed: []
  });
  const eggs = find(b.fake.store.fields.pantry, 'eggs');
  assert.deepEqual(withoutUpdatedAt(eggs), withoutUpdatedAt(EGGS));
  assert.equal(eggs.updatedAt, CLOCK_ISO, 'restamped with the injected clock');
  assert.deepEqual(b.fake.store.fields.pantry.map((p) => p.id), ['chicken', 'eggs', 'salt', 'rice'], 'position kept');
  assert.equal(b.fake.store.fields.version, 5);

  assert.equal(b.count('commit'), commits + 1);
  const writes = JSON.parse(b.calls.filter((c) => c.kind === 'commit').at(-1).init.body).writes;
  assert.equal(writes.length, 3);
  assert.deepEqual(writes[0].updateMask.fieldPaths, ['pantry', 'version']);
  assert.deepEqual(writes[0].currentDocument, { updateTime: userUpdateTime });
  assert.match(writes[1].update.name, /\/mcpRequests\/undo-eggs-001$/);
  assert.deepEqual(writes[1].currentDocument, { exists: false });
  assert.match(writes[2].update.name, /\/mcpRequests\/set-eggs-0001$/);
  assert.deepEqual(writes[2].updateMask, { fieldPaths: ['undoneBy'] });
  assert.deepEqual(writes[2].currentDocument, { updateTime: originalUpdateTime });

  const original = b.fake.requestRecord('set-eggs-0001');
  assert.equal(original.undoneBy, 'undo-eggs-001');
  assert.equal(original.tool, 'set_inventory_quantity', 'the rest of the original record is untouched');
  const record = b.fake.requestRecord('undo-eggs-001');
  assert.equal(record.tool, 'undo_request');
  assert.equal(record.undoes, 'set-eggs-0001');
  assert.equal(record.revisionBefore, 4);
  assert.equal(record.revisionAfter, 5);
  assert.equal(Date.parse(record.expireAt) - Date.parse(record.createdAt), 30 * DAY_MS);
  assert.deepEqual(record.result, result);
});

test('undo consume_stock: partial use restores the quantity', async () => {
  const b = bridge();
  ok(await b.call('consume_stock', { requestId: 'use-chicken-1', ingredientId: 'chicken', quantity: 100, expectedUnit: 'g', expectedRevision: 3 }));
  assert.equal(find(b.fake.store.fields.pantry, 'chicken').quantity, 400);
  ok(await b.undo('use-chicken-1', 'undo-chicken1', 4));
  const chicken = find(b.fake.store.fields.pantry, 'chicken');
  assert.deepEqual(withoutUpdatedAt(chicken), withoutUpdatedAt(CHICKEN));
  assert.equal(chicken.updatedAt, CLOCK_ISO);
});

test('undo consume_stock to zero: the removed record returns with the same id and its tombstone is deleted (D-083)', async () => {
  const b = bridge();
  ok(await b.call('consume_stock', { requestId: 'use-chicken-0', ingredientId: 'chicken', quantity: 500, expectedUnit: 'g', expectedRevision: 3 }));
  assert.equal(find(b.fake.store.fields.pantry, 'chicken'), undefined);
  assert.ok(b.fake.store.fields.deletions.pantry.chicken);

  const result = ok(await b.undo('use-chicken-0', 'undo-chicken0', 4));
  assert.deepEqual(result.restored, [{ collection: 'pantry', id: 'chicken' }]);
  const chicken = find(b.fake.store.fields.pantry, 'chicken');
  assert.deepEqual(withoutUpdatedAt(chicken), withoutUpdatedAt(CHICKEN));
  assert.equal(chicken.updatedAt, CLOCK_ISO);
  assert.deepEqual(b.fake.store.fields.deletions.pantry, { 'old-lot': '2026-10-01T00:00:00.000Z' }, 'only the matching tombstone is cleared');
  const writes = JSON.parse(b.calls.filter((c) => c.kind === 'commit').at(-1).init.body).writes;
  assert.deepEqual(writes[0].updateMask.fieldPaths.slice().sort(), ['deletions.pantry', 'pantry', 'version']);
});

test('undo add_stock restores the earlier quantity', async () => {
  const b = bridge();
  ok(await b.call('add_stock', { requestId: 'buy-eggs-0001', ingredientId: 'eggs', quantity: 6, expectedUnit: 'pcs', expectedRevision: 3 }));
  assert.equal(find(b.fake.store.fields.pantry, 'eggs').quantity, 12);
  ok(await b.undo('buy-eggs-0001', 'undo-buy-0001', 4));
  assert.deepEqual(withoutUpdatedAt(find(b.fake.store.fields.pantry, 'eggs')), withoutUpdatedAt(EGGS));
});

test('undo mark_out_of_stock: a staple returns to its level; a removed non-staple is revived', async () => {
  const b = bridge();
  ok(await b.call('mark_out_of_stock', { requestId: 'out-salt-0001', ingredientId: 'salt', expectedRevision: 3 }));
  assert.equal(find(b.fake.store.fields.pantry, 'salt').stockLevel, 'empty');
  ok(await b.undo('out-salt-0001', 'undo-salt-001', 4));
  assert.deepEqual(withoutUpdatedAt(find(b.fake.store.fields.pantry, 'salt')), withoutUpdatedAt(SALT));

  ok(await b.call('mark_out_of_stock', { requestId: 'out-eggs-0001', ingredientId: 'eggs', expectedRevision: 5 }));
  assert.equal(find(b.fake.store.fields.pantry, 'eggs'), undefined);
  ok(await b.undo('out-eggs-0001', 'undo-eggs-out', 6));
  assert.deepEqual(withoutUpdatedAt(find(b.fake.store.fields.pantry, 'eggs')), withoutUpdatedAt(EGGS));
  assert.equal(b.fake.store.fields.deletions.pantry.eggs, undefined);
  assert.equal(b.fake.store.fields.version, 7);
});

test('undo mark_in_stock puts the staple back to empty', async () => {
  const b = bridge();
  ok(await b.call('mark_in_stock', { requestId: 'in-rice-00001', ingredientId: 'rice', expectedRevision: 3 }));
  assert.equal(find(b.fake.store.fields.pantry, 'rice').stockLevel, 'full');
  ok(await b.undo('in-rice-00001', 'undo-rice-001', 4));
  const rice = find(b.fake.store.fields.pantry, 'rice');
  assert.deepEqual(withoutUpdatedAt(rice), withoutUpdatedAt(RICE));
});

test('undo record_ready_food removes the untouched batch with a tombstone (D-071) and keeps every ledger fact', async () => {
  const b = bridge();
  const created = ok(await b.call('record_ready_food', { requestId: 'cook-soup-001', name: 'Soup', servings: 2, storage: 'fridge', cookedDate: '2026-11-26', expectedRevision: 3 }));
  const id = created.item.cookedMealId;
  const result = ok(await b.undo('cook-soup-001', 'undo-soup-001', 4));
  assert.deepEqual(result.removed, [{ collection: 'cookedMeals', id }]);
  assert.deepEqual(result.restored, []);
  assert.deepEqual(b.fake.store.fields.cookedMeals, [MEAL]);
  assert.equal(b.fake.store.fields.deletions.cookedMeals[id], CLOCK_ISO);
  assert.deepEqual(b.fake.store.fields.mealConsumptions, [PRIOR_FACT]);
  const writes = JSON.parse(b.calls.filter((c) => c.kind === 'commit').at(-1).init.body).writes;
  assert.deepEqual(writes[0].updateMask.fieldPaths.slice().sort(), ['cookedMeals', 'deletions.cookedMeals', 'version']);
});

test('undo consume_ready_food is refused with zero writes: a mealConsumptions fact is never deleted or offset', async () => {
  const b = bridge();
  ok(await b.call('consume_ready_food', { requestId: 'eat-chili-001', cookedMealId: 'meal-1', servings: 1, expectedRevision: 3 }));
  const facts = structuredClone(b.fake.store.fields.mealConsumptions);
  assert.equal(facts.length, 2);
  const message = await assertRefused(b, b.undo('eat-chili-001', 'undo-chili-01', 4), 'undo_not_supported');
  assert.match(message, /permanent/);
  assert.deepEqual(b.fake.store.fields.mealConsumptions, facts);
  // Also when the final serving removed the batch.
  ok(await b.call('consume_ready_food', { requestId: 'eat-chili-002', cookedMealId: 'meal-1', servings: 2, expectedRevision: 4 }));
  await assertRefused(b, b.undo('eat-chili-002', 'undo-chili-02', 5), 'undo_not_supported');
});

// ── Refusals ─────────────────────────────────────────────────────────────────────────────────

test('stale after edit: a record changed since the request is refused with zero writes', async () => {
  const b = bridge();
  ok(await b.call('set_inventory_quantity', { requestId: 'set-eggs-0002', ingredientId: 'eggs', quantity: 12, expectedUnit: 'pcs', expectedRevision: 3 }));
  simulateAppWrite(b.fake, (doc) => { find(doc.pantry, 'eggs').quantity = 10; });
  const message = await assertRefused(b, b.undo('set-eggs-0002', 'undo-stale-01', 5), 'changed_since');
  assert.match(message, /eggs/);
  assert.equal(b.fake.requestRecord('set-eggs-0002').undoneBy, undefined);

  // A later chat change counts too.
  const c = bridge();
  ok(await c.call('consume_stock', { requestId: 'use-chicken-2', ingredientId: 'chicken', quantity: 100, expectedUnit: 'g', expectedRevision: 3 }));
  ok(await c.call('consume_stock', { requestId: 'use-chicken-3', ingredientId: 'chicken', quantity: 50, expectedUnit: 'g', expectedRevision: 4 }));
  await assertRefused(c, c.undo('use-chicken-2', 'undo-stale-02', 5), 'changed_since');
  ok(await c.undo('use-chicken-3', 'undo-latest-1', 5), 'the latest change can still be undone');
  assert.equal(find(c.fake.store.fields.pantry, 'chicken').quantity, 400);
});

test('unrelated later changes do not block undo and are kept', async () => {
  const b = bridge();
  ok(await b.call('consume_stock', { requestId: 'use-chicken-4', ingredientId: 'chicken', quantity: 500, expectedUnit: 'g', expectedRevision: 3 }));
  simulateAppWrite(b.fake, (doc) => {
    find(doc.pantry, 'eggs').quantity = 2;
    doc.deletions.pantry.tofu = '2026-11-27T02:00:00.000Z';
    doc.mealConsumptions.push({ id: 'mc-new', cookedMealId: 'meal-1', recipeId: null, mealName: 'Chili', portionsConsumed: 1, consumedAt: '2026-11-27T01:00:00.000Z' });
  });
  ok(await b.undo('use-chicken-4', 'undo-unrel-01', 5));
  assert.equal(find(b.fake.store.fields.pantry, 'eggs').quantity, 2);
  assert.equal(find(b.fake.store.fields.pantry, 'chicken').quantity, 500);
  assert.deepEqual(b.fake.store.fields.deletions.pantry, { 'old-lot': '2026-10-01T00:00:00.000Z', tofu: '2026-11-27T02:00:00.000Z' });
  assert.equal(b.fake.store.fields.mealConsumptions.length, 2);
});

test('a changed or cleared tombstone is refused as changed_since; a removed id in use again is id_in_use', async () => {
  const b = bridge();
  ok(await b.call('mark_out_of_stock', { requestId: 'out-eggs-0002', ingredientId: 'eggs', expectedRevision: 3 }));
  simulateAppWrite(b.fake, (doc) => { doc.pantry.push(Object.assign({}, EGGS, { quantity: 2 })); delete doc.deletions.pantry.eggs; });
  await assertRefused(b, b.undo('out-eggs-0002', 'undo-reuse-01', 5), 'id_in_use');

  const c = bridge();
  ok(await c.call('mark_out_of_stock', { requestId: 'out-eggs-0003', ingredientId: 'eggs', expectedRevision: 3 }));
  simulateAppWrite(c.fake, (doc) => { doc.deletions.pantry.eggs = '2026-12-01T00:00:00.000Z'; });
  await assertRefused(c, c.undo('out-eggs-0003', 'undo-tomb-001', 5), 'changed_since');

  const d = bridge();
  ok(await d.call('mark_out_of_stock', { requestId: 'out-eggs-0004', ingredientId: 'eggs', expectedRevision: 3 }));
  simulateAppWrite(d.fake, (doc) => { delete doc.deletions.pantry.eggs; });
  await assertRefused(d, d.undo('out-eggs-0004', 'undo-tomb-002', 5), 'changed_since');
});

test('record_ready_food undo is refused once the batch was eaten from or edited', async () => {
  const b = bridge();
  const created = ok(await b.call('record_ready_food', { requestId: 'cook-soup-002', name: 'Soup', servings: 2, storage: 'fridge', cookedDate: '2026-11-26', expectedRevision: 3 }));
  ok(await b.call('consume_ready_food', { requestId: 'eat-soup-0001', cookedMealId: created.item.cookedMealId, servings: 1, expectedRevision: 4 }));
  await assertRefused(b, b.undo('cook-soup-002', 'undo-soup-002', 5), 'changed_since');

  const c = bridge();
  const made = ok(await c.call('record_ready_food', { requestId: 'cook-soup-003', name: 'Soup', servings: 2, storage: 'fridge', cookedDate: '2026-11-26', expectedRevision: 3 }));
  simulateAppWrite(c.fake, (doc) => { find(doc.cookedMeals, made.item.cookedMealId).storage = 'freezer'; });
  await assertRefused(c, c.undo('cook-soup-003', 'undo-soup-003', 5), 'changed_since');

  // A fact naming the batch (e.g. eaten in the app, then the portion count restored by hand) still blocks removal.
  const d = bridge();
  const kept = ok(await d.call('record_ready_food', { requestId: 'cook-soup-004', name: 'Soup', servings: 2, storage: 'fridge', cookedDate: '2026-11-26', expectedRevision: 3 }));
  simulateAppWrite(d.fake, (doc) => {
    doc.mealConsumptions.push({ id: 'mc-app', cookedMealId: kept.item.cookedMealId, recipeId: null, mealName: 'Soup', portionsConsumed: 1, consumedAt: '2026-11-27T01:00:00.000Z' });
  });
  await assertRefused(d, d.undo('cook-soup-004', 'undo-soup-004', 5), 'changed_since');
});

test('expired: a request is undoable until expireAt and refused from then on', async () => {
  const b = bridge();
  ok(await b.call('set_inventory_quantity', { requestId: 'set-eggs-0003', ingredientId: 'eggs', quantity: 12, expectedUnit: 'pcs', expectedRevision: 3 }));
  b.clock.ms = CLOCK_MS + 30 * DAY_MS;
  await assertRefused(b, b.undo('set-eggs-0003', 'undo-late-001', 4), 'undo_expired');
  b.clock.ms = CLOCK_MS + 30 * DAY_MS - 1;
  ok(await b.undo('set-eggs-0003', 'undo-late-002', 4), 'one millisecond before expiry');
});

test('missing request record: request_not_found, zero writes', async () => {
  const b = bridge();
  await assertRefused(b, b.undo('never-happened', 'undo-missing1', 3), 'request_not_found');
});

test('a record without the after-state (or with a broken snapshot) is refused as undo_record_incomplete', async () => {
  for (const damage of [
    (fields) => { delete fields.after; },
    (fields) => { delete fields.before; },
    (fields) => { fields.after = { stringValue: 'x' }; },
    (fields) => { delete fields.expireAt; }
  ]) {
    const b = bridge();
    ok(await b.call('set_inventory_quantity', { requestId: 'set-eggs-0004', ingredientId: 'eggs', quantity: 12, expectedUnit: 'pcs', expectedRevision: 3 }));
    damage(b.fake.requests.get('set-eggs-0004').fields);
    await assertRefused(b, b.undo('set-eggs-0004', 'undo-broken-1', 4), 'undo_record_incomplete');
  }
});

test('nothing to undo: a no-op original is refused and says so', async () => {
  const b = bridge();
  const noop = ok(await b.call('mark_in_stock', { requestId: 'in-salt-00001', ingredientId: 'salt', expectedRevision: 3 }));
  assert.equal(noop.unchanged, true);
  const message = await assertRefused(b, b.undo('in-salt-00001', 'undo-noop-001', 3), 'nothing_to_undo');
  assert.match(message, /nothing to undo/);
});

test('double undo, sequential: the second undo (new id) is already_undone with zero writes', async () => {
  const b = bridge();
  ok(await b.call('set_inventory_quantity', { requestId: 'set-eggs-0005', ingredientId: 'eggs', quantity: 12, expectedUnit: 'pcs', expectedRevision: 3 }));
  ok(await b.undo('set-eggs-0005', 'undo-first-01', 4));
  const message = await assertRefused(b, b.undo('set-eggs-0005', 'undo-second-1', 5), 'already_undone');
  assert.match(message, /undo-first-01/);
});

test('double undo, concurrent: both pass every read, only one commit lands, the other is already_undone', async () => {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  let docGets = 0;
  let racing = false;
  const b = bridge(seed(), {
    hook: async (kind, url, init, fake) => {
      if (!racing) return null;
      if (kind === 'docGet') {
        const response = await fake.fetch(url, init);
        docGets += 1;
        if (docGets === 2) release();
        return response;
      }
      if (kind === 'commit') await barrier;
      return null;
    }
  });
  ok(await b.call('set_inventory_quantity', { requestId: 'set-eggs-0006', ingredientId: 'eggs', quantity: 12, expectedUnit: 'pcs', expectedRevision: 3 }));
  racing = true;
  const commitsBefore = b.fake.counters.commits;
  const [x, y] = await Promise.all([b.undo('set-eggs-0006', 'undo-race-L01', 4), b.undo('set-eggs-0006', 'undo-race-R01', 4)]);
  const winners = [x, y].filter((m) => m.result.isError === undefined);
  const losers = [x, y].filter((m) => m.result.isError === true);
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.match(text(losers[0]), /^already_undone: /);
  assert.equal(b.fake.counters.commits, commitsBefore + 1, 'only one undo landed');
  assert.equal(b.fake.store.fields.version, 5);
  const winnerId = winners[0] === x ? 'undo-race-L01' : 'undo-race-R01';
  const loserId = winners[0] === x ? 'undo-race-R01' : 'undo-race-L01';
  assert.equal(b.fake.requestRecord('set-eggs-0006').undoneBy, winnerId);
  assert.equal(b.fake.requestRecord(loserId), undefined, 'the losing undo left no record');
});

test('the original-record precondition alone stops a second undo (user document unchanged in between)', async () => {
  // Simulates the narrow case where the user document precondition would pass: the original
  // record is marked undone by someone else between our read and our commit.
  let marked = false;
  const b = bridge(seed(), {
    hook: async (kind, url, init, fake) => {
      if (kind === 'commit' && !marked && JSON.parse(init.body).writes.length === 3) {
        marked = true;
        const entry = fake.requests.get('set-eggs-0007');
        fake.requests.set('set-eggs-0007', Object.assign({}, entry, {
          fields: Object.assign({}, entry.fields, { undoneBy: { stringValue: 'someone-else' } }),
          updateTime: '2026-01-01T05:55:00.000000Z'
        }));
      }
      return null;
    }
  });
  ok(await b.call('set_inventory_quantity', { requestId: 'set-eggs-0007', ingredientId: 'eggs', quantity: 12, expectedUnit: 'pcs', expectedRevision: 3 }));
  const storeBefore = JSON.stringify(b.fake.store);
  const message = await b.undo('set-eggs-0007', 'undo-guard-01', 4);
  assert.match(text(message), /^already_undone: /);
  assert.equal(JSON.stringify(b.fake.store), storeBefore, 'user document untouched');
  assert.equal(b.fake.requestRecord('undo-guard-01'), undefined);
});

test('undo of an undo is refused (undo_of_undo)', async () => {
  const b = bridge();
  ok(await b.call('set_inventory_quantity', { requestId: 'set-eggs-0008', ingredientId: 'eggs', quantity: 12, expectedUnit: 'pcs', expectedRevision: 3 }));
  ok(await b.undo('set-eggs-0008', 'undo-once-001', 4));
  await assertRefused(b, b.undo('undo-once-001', 'undo-twice-01', 5), 'undo_of_undo');
});

test('replay of the undo itself: same ids return the stored result and write nothing; a reused undoRequestId is refused', async () => {
  const b = bridge();
  ok(await b.call('set_inventory_quantity', { requestId: 'set-eggs-0009', ingredientId: 'eggs', quantity: 12, expectedUnit: 'pcs', expectedRevision: 3 }));
  const first = ok(await b.undo('set-eggs-0009', 'undo-replay-1', 4));
  const before = b.snapshot();
  const commits = b.count('commit');

  // Lost response, retried with the same ids (even with a now-stale expectedRevision).
  const again = ok(await b.undo('set-eggs-0009', 'undo-replay-1', 4));
  assert.deepEqual(again, Object.assign({}, first, { replayed: true }));
  assert.equal(b.count('commit'), commits);
  assert.equal(b.snapshot(), before);

  ok(await b.call('add_stock', { requestId: 'buy-eggs-0002', ingredientId: 'eggs', quantity: 6, expectedUnit: 'pcs', expectedRevision: 5 }));
  const reused = await assertRefused(b, b.undo('buy-eggs-0002', 'undo-replay-1', 6), 'request_id_reused');
  assert.match(reused, /different change/);
});

test('an undoRequestId equal to the original requestId is request_id_reused, zero writes', async () => {
  const b = bridge();
  ok(await b.call('set_inventory_quantity', { requestId: 'set-eggs-0010', ingredientId: 'eggs', quantity: 12, expectedUnit: 'pcs', expectedRevision: 3 }));
  await assertRefused(b, b.undo('set-eggs-0010', 'set-eggs-0010', 4), 'request_id_reused');
});

test('a stale expectedRevision is revision_conflict with zero writes; a refusal leaves the undoRequestId unspent', async () => {
  const b = bridge();
  ok(await b.call('set_inventory_quantity', { requestId: 'set-eggs-0011', ingredientId: 'eggs', quantity: 12, expectedUnit: 'pcs', expectedRevision: 3 }));
  await assertRefused(b, b.undo('set-eggs-0011', 'undo-retry-01', 3), 'revision_conflict');
  ok(await b.undo('set-eggs-0011', 'undo-retry-01', 4), 'same undoRequestId, fresh revision');
});

// ── Pure planner ─────────────────────────────────────────────────────────────────────────────

test('planUndo restores other touched tombstone entries to their prior value exactly and never edits mealConsumptions', () => {
  const record = {
    tool: 'synthetic', revisionBefore: 1, revisionAfter: 2, expireAt: new Date(CLOCK_MS + DAY_MS).toISOString(),
    before: { pantry: [{ id: 'a', quantity: 1 }], cookedMeals: [], deletions: { pantry: { a: null, x: '2026-01-01T00:00:00.000Z' } } },
    after: { pantry: [], cookedMeals: [], deletions: { pantry: { a: '2026-11-26T00:00:00.000Z', x: null } } },
    added: {}
  };
  const doc = { pantry: [{ id: 'b' }], cookedMeals: [], mealConsumptions: [PRIOR_FACT], deletions: { pantry: { a: '2026-11-26T00:00:00.000Z', keep: 'k' } } };
  const plan = requests.planUndo(record, doc, 'synthetic-01', CLOCK_MS);
  assert.deepEqual(plan.write.fieldPaths, ['pantry', 'deletions.pantry']);
  assert.deepEqual(plan.write.fields.pantry, [{ id: 'b' }, { id: 'a', quantity: 1, updatedAt: CLOCK_ISO }]);
  assert.deepEqual(plan.write.fields.deletions.pantry, { keep: 'k', x: '2026-01-01T00:00:00.000Z' });
  assert.equal('mealConsumptions' in plan.write.fields, false);
  assert.deepEqual(doc.deletions.pantry, { a: '2026-11-26T00:00:00.000Z', keep: 'k' }, 'input not mutated');
});

test('planUndo refuses a record that appended a ledger fact, whatever its tool name', () => {
  const record = {
    tool: 'anything', revisionBefore: 1, revisionAfter: 2, expireAt: new Date(CLOCK_MS + DAY_MS).toISOString(),
    before: { pantry: [], cookedMeals: [], deletions: {} }, after: { pantry: [], cookedMeals: [], deletions: {} },
    added: { mealConsumptions: [PRIOR_FACT] }
  };
  assert.throws(() => requests.planUndo(record, seed(), 'synthetic-02', CLOCK_MS), (e) => e.reason === 'undo_not_supported');
});

// ── TASK-095 review fixes ───────────────────────────────────────────────────────────────────────

test('review must-fix: undo record_ready_food after the app stamped and saved updatedAt on the new batch', async () => {
  const b = bridge();
  const created = ok(await b.call('record_ready_food', { requestId: 'cook-stamp-01', name: 'Soup', servings: 2, storage: 'fridge', cookedDate: '2026-11-26', expectedRevision: 3 }));
  const id = created.item.cookedMealId;
  assert.equal(find(b.fake.store.fields.cookedMeals, id).updatedAt, undefined, 'the bridge writes no updatedAt');
  // The app's loadFromFirestore stamps a missing updatedAt and the 30 s autosave writes it back.
  simulateAppWrite(b.fake, (doc) => { find(doc.cookedMeals, id).updatedAt = '2026-11-27T03:30:00.000Z'; });
  const result = ok(await b.undo('cook-stamp-01', 'undo-stamp-01', 5));
  assert.deepEqual(result.removed, [{ collection: 'cookedMeals', id }]);
  assert.deepEqual(b.fake.store.fields.cookedMeals, [MEAL]);
  assert.equal(b.fake.store.fields.deletions.cookedMeals[id], CLOCK_ISO);
});

test('review must-fix: a real edit of the added batch is still refused, with or without an updatedAt stamp', async () => {
  for (const stamp of [false, true]) {
    const b = bridge();
    const created = ok(await b.call('record_ready_food', { requestId: 'cook-edit-001', name: 'Soup', servings: 2, storage: 'fridge', cookedDate: '2026-11-26', expectedRevision: 3 }));
    const id = created.item.cookedMealId;
    simulateAppWrite(b.fake, (doc) => {
      const batch = find(doc.cookedMeals, id);
      batch.storage = 'freezer';
      if (stamp) batch.updatedAt = '2026-11-27T03:30:00.000Z';
    });
    await assertRefused(b, b.undo('cook-edit-001', 'undo-edit-001', 5), 'changed_since');
  }
});

test('review: a revived record carries an updatedAt newer than its old removal record (consistent clocks)', async () => {
  const b = bridge();
  ok(await b.call('mark_out_of_stock', { requestId: 'out-eggs-clk1', ingredientId: 'eggs', expectedRevision: 3 }));
  const tombstone = b.fake.store.fields.deletions.pantry.eggs;
  assert.ok(tombstone);
  // The inventory write stamps its tombstone with the real clock; run the undo a minute later.
  b.clock.ms = Math.max(Date.parse(tombstone), CLOCK_MS) + 60000;
  ok(await b.undo('out-eggs-clk1', 'undo-eggs-clk', 4));
  const eggs = find(b.fake.store.fields.pantry, 'eggs');
  assert.ok(Date.parse(eggs.updatedAt) > Date.parse(tombstone), 'revived updatedAt ' + eggs.updatedAt + ' > tombstone ' + tombstone);
  assert.equal(b.fake.store.fields.deletions.pantry.eggs, undefined);
});

test('review: two chat changes to one record - only the later can be undone; the earlier is then refused', async () => {
  const b = bridge();
  ok(await b.call('consume_stock', { requestId: 'use-chick-a01', ingredientId: 'chicken', quantity: 100, expectedUnit: 'g', expectedRevision: 3 }));
  ok(await b.call('consume_stock', { requestId: 'use-chick-b01', ingredientId: 'chicken', quantity: 50, expectedUnit: 'g', expectedRevision: 4 }));
  ok(await b.undo('use-chick-b01', 'undo-chick-b1', 5));
  assert.equal(find(b.fake.store.fields.pantry, 'chicken').quantity, 400);
  await assertRefused(b, b.undo('use-chick-a01', 'undo-chick-a1', 6), 'changed_since');
});
