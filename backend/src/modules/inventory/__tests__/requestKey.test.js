/**
 * The idempotency gate in front of every IMS entry — what a second request
 * with the same submission id is told. The models are stubbed, so no database
 * is needed: each test sets up the key row (and the ledger) a retry finds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import InventoryRequestKey from '../inventoryRequestKey.model.js';
import InventoryMovement from '../inventoryMovement.model.js';
import { inventoryService } from '../inventory.service.js';

const KEY = 'a2b4c6d8-0000-4000-8000-000000000001';
const dup = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
const query = (v) => ({ lean: async () => v });
const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000);

/** Stub the key row a retry finds, and how many movements carry the id. */
const setup = (t, { prior, posted = 0 }) => {
  const calls = { settled: null, takenOver: false };
  t.mock.method(InventoryRequestKey, 'create', async () => { throw dup(); });
  t.mock.method(InventoryRequestKey, 'findById', () => query(prior));
  t.mock.method(InventoryRequestKey, 'updateOne', async (_f, u) => { calls.settled = u.$set; });
  t.mock.method(InventoryRequestKey, 'findOneAndUpdate', () => { calls.takenOver = true; return query({ ...prior }); });
  t.mock.method(InventoryMovement, 'countDocuments', async () => posted);
  return calls;
};

test('the first request for an id claims it', async (t) => {
  t.mock.method(InventoryRequestKey, 'create', async () => [{}]);
  assert.deepEqual(await inventoryService.claimRequestKey(KEY, {}), { replay: false, claimed: true });
});

test('a finished entry is a replay, answered with what it wrote', async (t) => {
  setup(t, { prior: { _id: KEY, settled: true, count: 2, createdAt: minutesAgo(1) } });
  assert.deepEqual(await inventoryService.claimRequestKey(KEY, {}), { replay: true, count: 2 });
});

test('a key settled before `settled` existed still counts as finished', async (t) => {
  setup(t, { prior: { _id: KEY, count: 1, createdAt: minutesAgo(60) } });
  assert.equal((await inventoryService.claimRequestKey(KEY, {})).replay, true);
});

test('a claim that never settled but did post is a replay — and is settled now', async (t) => {
  // The request committed, then died before marking its key.
  const calls = setup(t, { prior: { _id: KEY, count: 0, createdAt: minutesAgo(30) }, posted: 2 });
  assert.deepEqual(await inventoryService.claimRequestKey(KEY, {}), { replay: true, count: 2 });
  assert.deepEqual(calls.settled, { count: 2, settled: true });
});

test('a claim still running is pending — never "already saved"', async (t) => {
  const calls = setup(t, { prior: { _id: KEY, count: 0, createdAt: new Date() } });
  const out = await inventoryService.claimRequestKey(KEY, {});
  assert.equal(out.pending, true);
  assert.equal(calls.takenOver, false);
});

test('a claim abandoned with nothing posted is taken over, so the retry posts', async (t) => {
  // The case that lost a stock correction: claimed, then cut off mid-save.
  const calls = setup(t, { prior: { _id: KEY, count: 0, createdAt: minutesAgo(9) } });
  assert.deepEqual(await inventoryService.claimRequestKey(KEY, {}), { replay: false, claimed: true });
  assert.equal(calls.takenOver, true);
});

test('an entry whose claim is pending is refused with a 409 and writes nothing', async (t) => {
  setup(t, { prior: { _id: KEY, count: 0, createdAt: new Date() } });
  let wrote = false;
  await assert.rejects(
    inventoryService.runStockEntry({
      items: [{ skuId: 'x' }], clientRequestId: KEY, meta: {}, write: async () => { wrote = true; },
    }),
    (e) => e.statusCode === 409 && /still being saved/.test(e.message),
  );
  assert.equal(wrote, false);
});
