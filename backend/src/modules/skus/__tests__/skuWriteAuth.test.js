/**
 * The SKU master requires authentication, and reclassifying needs masters.editSku.
 *
 * A SKU's itemType decides which inventory module purchased stock is posted to,
 * so the master must not be readable or writable anonymously. Before this, no
 * SKU route ran `protect` except DELETE. No database — the router is mounted on
 * a bare express app and called over HTTP without a token (protect refuses
 * before any lookup), and the reclassification guard is driven through the
 * service with the model call stubbed.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import router from '../sku.routes.js';
import Sku, { ITEM_TYPES } from '../sku.model.js';
import { updateSku, bulkUpsertSkus } from '../sku.service.js';
import { createSkuSchema, updateSkuSchema, bulkUpsertSkuSchema } from '../sku.validation.js';
import { protect } from '../../../middleware/auth.middleware.js';

const ID = '6ac09965f1c61c40fa20aa01';
const ROUTES = [
  ['get', '/'], ['get', '/lookup/list'], ['get', `/${ID}`],
  ['post', '/'], ['post', '/bulk-upsert'], ['put', `/${ID}`], ['patch', `/${ID}`], ['delete', `/${ID}`],
];

test('protect is the first thing the SKU router runs — before every route', () => {
  const first = router.stack.findIndex((l) => l.handle === protect);
  const firstRoute = router.stack.findIndex((l) => l.route);
  assert.equal(first, 0, 'protect is mounted first');
  assert.ok(first < firstRoute);
});

test('every SKU route answers 401 without a token', async () => {
  const app = express();
  app.use(express.json());
  app.use('/skus', router);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ message: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}/skus`;
    for (const [method, path] of ROUTES) {
      const res = await fetch(`${base}${path}`, {
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' },
        body: ['get', 'delete'].includes(method) ? undefined : JSON.stringify({ name: 'x', code: 'X', items: [{ name: 'x', code: 'X' }] }),
      });
      assert.equal(res.status, 401, `${method.toUpperCase()} ${path}`);
    }
  } finally {
    await new Promise((resolve) => { server.close(resolve); });
  }
});

const routeOf = (method, path) => router.stack.find((l) => l.route?.path === path && l.route.methods[method])?.route;

test('bulk-upsert (which can rewrite every itemType) needs masters.editSku', async () => {
  const [, gate] = routeOf('post', '/bulk-upsert').stack.map((s) => s.handle); // attachUserPermissions, requirePermission
  const run = (perms) => new Promise((resolve) => {
    gate({ user: { roles: [] }, userPermissions: new Set(perms) }, {}, resolve);
  });
  const denied = await run(['masters.viewSku']);
  assert.equal(denied?.statusCode, 403);
  assert.match(denied.message, /masters\.editSku/);
  assert.equal(await run(['masters.editSku']), undefined, 'holder passes');
});

test('changing an existing SKU\'s itemType without masters.editSku is refused (403)', async (t) => {
  const doc = { _id: 'x', code: 'CO-BS-50-00', itemType: 'CONSUMABLE', save: async function save() { return this; } };
  t.mock.method(Sku, 'findOne', async () => doc);
  await assert.rejects(updateSku('x', { itemType: 'RAW_MATERIAL' }, 'u1', { canReclassify: false }),
    (e) => e.statusCode === 403 && /masters\.editSku/.test(e.message));
  assert.equal(doc.itemType, 'CONSUMABLE', 'nothing changed');
});

test('re-sending the same itemType, or holding the permission, is allowed', async (t) => {
  const doc = { _id: 'x', code: 'CO-BS-50-00', itemType: 'CONSUMABLE', save: async function save() { return this; } };
  t.mock.method(Sku, 'findOne', async () => doc);
  await updateSku('x', { itemType: 'CONSUMABLE', name: 'Brush 5"' }, 'u1', { canReclassify: false });
  assert.equal(doc.name, 'Brush 5"');
  await updateSku('x', { itemType: 'RAW_MATERIAL' }, 'u1', { canReclassify: true });
  assert.equal(doc.itemType, 'RAW_MATERIAL');
});

/* ── Classification is always an explicit choice ──────────────────────────────
 * The Mongoose schema defaults itemType to FINISHED_GOOD, which is a BLOCKED
 * destination: a SKU created without a type used to become a finished good
 * silently, and the first GRN line that carried it could not be routed. */

test('creating a SKU without an Item Type is refused, with a message that explains why', () => {
  const { error } = createSkuSchema.validate({ name: 'Brush 5"', code: 'CO-BS-50-00' });
  assert.ok(error, 'refused');
  assert.match(error.message, /Item Type is required/);
  assert.match(error.message, /RM IMS|C&P IMS|Main Store/, 'says where the type sends the stock');
});

test('an unsupported Item Type is refused and names the supported ones', () => {
  const { error } = createSkuSchema.validate({ name: 'x', code: 'X1', itemType: 'MISCELLANEOUS' });
  assert.ok(error);
  assert.match(error.message, /not a supported classification/);
  assert.match(error.message, /RAW_MATERIAL/);
});

test('every supported Item Type is still accepted on create', () => {
  for (const t of ITEM_TYPES) {
    const { error } = createSkuSchema.validate({ name: 'x', code: 'X1', itemType: t });
    assert.equal(error, undefined, `${t} accepted`);
  }
});

test('an update that does not mention itemType is still allowed (it must not reclassify)', () => {
  const { error, value } = updateSkuSchema.validate({ sellingPrice: 120 });
  assert.equal(error, undefined);
  assert.equal(value.itemType, undefined, 'nothing is defaulted in, so nothing is overwritten');
});

test('a bulk row may omit itemType (price-only import) but a NEW SKU cannot', async (t) => {
  const rowOk = bulkUpsertSkuSchema.validate({ items: [{ name: 'Brush', code: 'CO-BS-50-00', sellingPrice: 10 }] });
  assert.equal(rowOk.error, undefined, 'the row itself passes — existing SKUs are updated by it');

  // Existing code: the import runs, and the omitted type is simply not written.
  const calls = [];
  t.mock.method(Sku, 'exists', async () => ({ _id: 'x' }));
  t.mock.method(Sku, 'findOneAndUpdate', async (...a) => { calls.push(a[1]); return { code: 'CO-BS-50-00' }; });
  await bulkUpsertSkus([{ name: 'Brush', code: 'CO-BS-50-00', sellingPrice: 10 }], 'u1');
  assert.equal(calls[0].$set.itemType, undefined, 'the existing classification is left alone');

  // Unknown code: inserting it without a type would silently mean FINISHED_GOOD.
  t.mock.method(Sku, 'exists', async () => null);
  await assert.rejects(
    bulkUpsertSkus([{ name: 'New Thing', code: 'NEW-1' }], 'u1'),
    (e) => e.statusCode === 400 && /Item Type is required for new SKU 'NEW-1'/.test(e.message),
  );
});

test('a bulk row that DOES carry a type still writes it (same vocabulary as create)', async (t) => {
  const bad = bulkUpsertSkuSchema.validate({ items: [{ name: 'x', code: 'X1', itemType: 'NOT_A_TYPE' }] });
  assert.ok(bad.error, 'an unsupported type is refused in a bulk row too');
  const calls = [];
  t.mock.method(Sku, 'exists', async () => null);
  t.mock.method(Sku, 'findOneAndUpdate', async (...a) => { calls.push(a[1]); return { code: 'NEW-1' }; });
  await bulkUpsertSkus([{ name: 'New Thing', code: 'new-1', itemType: 'CONSUMABLE' }], 'u1');
  assert.equal(calls[0].$set.itemType, 'CONSUMABLE');
  assert.equal(calls[0].$set.code, 'NEW-1', 'the code is still normalised');
});
