/**
 * Recycle Bin — search, scope, paging, screen names and the restore steps.
 *
 * DB-less: the restore steps run against a stubbed collection; nothing here
 * connects to Mongo.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import {
  buildKeywords, searchFilter, listFilter, scopeOf, sortFieldOf, encodeCursor, decodeCursor, viewOf,
} from '../recycleBin.service.js';
import { pageFrom, TYPES, MODULES } from '../recycleBin.catalog.js';
import { STEPS, binPlan } from '../recycleBin.restore.js';
import { idsSchema, listQuerySchema, settingsSchema } from '../recycleBin.validation.js';

const oid = (n) => new mongoose.Types.ObjectId(String(n).padStart(24, '0'));

test('keywords: lower-case, flattened, de-duplicated, no blanks', () => {
  assert.equal(buildKeywords(['GRN-0042', ['Epack', null, ['epack', 42]], '', undefined]), 'grn-0042 epack 42');
});

test('search: words in one box all match; commas give alternatives', () => {
  assert.deepEqual(searchFilter(''), {});
  assert.deepEqual(searchFilter('GRN'), { keywords: { $regex: 'grn' } });
  assert.deepEqual(searchFilter('grn epack'), { $and: [{ keywords: { $regex: 'grn' } }, { keywords: { $regex: 'epack' } }] });
  assert.deepEqual(searchFilter('so-1, po 7'), {
    $or: [{ keywords: { $regex: 'so-1' } }, { $and: [{ keywords: { $regex: 'po' } }, { keywords: { $regex: '7' } }] }],
  });
  // Regex characters are taken literally.
  assert.deepEqual(searchFilter('a.b(1)'), { keywords: { $regex: 'a\\.b\\(1\\)' } });
});

test('scope: without "everyone", only your own deletes — and nobody\'s when there is no user', () => {
  const me = oid(1);
  assert.deepEqual(scopeOf({ all: true }, me), {});
  assert.deepEqual(scopeOf({ all: false }, me), { 'deletedBy.id': me });
  assert.deepEqual(scopeOf({}, null), { 'deletedBy.id': { $in: [] } });
});

test('list filter: tab, modules, types, people (only with "everyone"), dates', () => {
  const me = oid(1);
  const f = listFilter({ status: 'pending', module: 'o2d,purchase', type: 'grn', deletedBy: `${oid(2)},bad`, from: '2026-11-01', to: '2026-11-04' }, { all: true }, me);
  assert.equal(f.status, 'pending');
  assert.deepEqual(f.module, { $in: ['o2d', 'purchase'] });
  assert.deepEqual(f.type, { $in: ['grn'] });
  assert.equal(String(f['deletedBy.id'].$in[0]), String(oid(2)));
  assert.equal(f['deletedBy.id'].$in.length, 1);
  assert.ok(f.deletedAt.$gte instanceof Date && f.deletedAt.$lte instanceof Date);

  const own = listFilter({ deletedBy: String(oid(2)) }, { all: false }, me);
  assert.deepEqual(own['deletedBy.id'], me); // can't look at someone else's
});

test('paging cursor round-trips; tabs sort by the right date', () => {
  const at = new Date('2026-11-04T10:00:00Z');
  const c = decodeCursor(encodeCursor(at, oid(9)));
  assert.equal(c.at.getTime(), at.getTime());
  assert.equal(String(c.id), String(oid(9)));
  assert.equal(decodeCursor('junk'), null);
  assert.equal(sortFieldOf('restored'), 'restoredAt');
  assert.equal(sortFieldOf('pending'), 'deletedAt');
});

test('row view: labels from the catalog, days left, never the restore plan', () => {
  const now = new Date('2026-11-04T00:00:00Z');
  const v = viewOf({
    _id: oid(5), module: 'purchase', type: 'grn', title: 'GRN-0042', status: 'pending',
    deletedAt: new Date('2026-11-03T00:00:00Z'), expiresAt: new Date('2026-11-14T12:00:00Z'),
    deletedBy: { id: oid(1), name: 'Arpit' }, plan: { steps: [] },
  }, now);
  assert.equal(v.typeLabel, 'GRN');
  assert.equal(v.moduleLabel, 'Purchase');
  assert.equal(v.daysLeft, 11);
  assert.equal(v.system, 'erp');
  assert.equal(v.deletedBy.name, 'Arpit');
  assert.equal('plan' in v, false);
});

test('catalog: every type belongs to a known module and has a screen', () => {
  for (const [key, def] of Object.entries(TYPES)) {
    assert.ok(MODULES[def.module], `${key} module`);
    assert.ok(def.label && def.from?.label && def.from.path.startsWith('/'), `${key} from`);
  }
});

test('screen names: longest matching prefix wins; unknown or odd paths give null', () => {
  assert.equal(pageFrom('/o2d-fms/steps/2.04').label, 'O2D › Step Board');
  assert.equal(pageFrom('/o2d-fms/templates').label, 'O2D › Task Templates');
  assert.equal(pageFrom('/o2d-fms').label, 'O2D FMS');
  assert.equal(pageFrom('/purchase-fms/grn?x=1').label, 'Purchase FMS › GRN');
  assert.equal(pageFrom('/procurement/grns/abc').label, 'Purchase › GRN');
  assert.equal(pageFrom('/machines/1').label, 'Master Data › Machines');
  assert.equal(pageFrom('/machine-operators').label, 'Master Data › Machine Operators');
  assert.equal(pageFrom('/o2d/invoice-entry').label, 'O2D');
  assert.equal(pageFrom('/nowhere'), null);
  assert.equal(pageFrom('http://evil/x'), null);
  assert.equal(pageFrom(undefined), null);
});

test('plan builders keep plans plain (no operators / dotted keys)', () => {
  const p = binPlan.unhide('Party', oid(1), { status: 'ACTIVE' }, { timeline: true });
  assert.deepEqual(p.set, { deletedAt: null, deletedBy: null, status: 'ACTIVE' });
  assert.equal(p.ids.length, 1);
  assert.deepEqual(binPlan.absent('SalesOrder', { soNumber: 'SO-1' }, 'taken'), { model: 'SalesOrder', match: { soNumber: 'SO-1' }, message: 'taken' });
});

test('request rules: ids, list query, auto-empty days', () => {
  assert.ok(idsSchema.validate({ ids: [] }).error);
  assert.ok(idsSchema.validate({ ids: ['x'] }).error);
  assert.ok(!idsSchema.validate({ ids: [String(oid(1))] }).error);
  assert.equal(listQuerySchema.validate({}).value.status, 'pending');
  assert.ok(listQuerySchema.validate({ status: 'gone' }).error);
  assert.ok(settingsSchema.validate({ retentionDays: 0 }).error);
  assert.ok(settingsSchema.validate({ retentionDays: 400 }).error);
  assert.ok(!settingsSchema.validate({ retentionDays: 30 }).error);
});

// ── Restore steps against a stubbed collection ─────────────────────────────
const Thing = mongoose.models.BinTestThing || mongoose.model('BinTestThing', new mongoose.Schema({ name: String, isDeleted: Boolean, items: [{ name: String }] }));
const stub = (methods) => {
  const calls = [];
  Object.entries(methods).forEach(([name, fn]) => {
    Thing.collection[name] = async (...args) => { calls.push([name, ...args]); return fn(...args); };
  });
  return calls;
};

test('unhide: clears the delete, can note it on the timeline; refuses when already back', async () => {
  const calls = stub({ updateMany: () => ({ matchedCount: 1 }) });
  await STEPS.unhide(binPlan.unhide('BinTestThing', oid(1), {}, { timeline: true }), null, { actor: { id: oid(7) } });
  const [, filter, update] = calls[0];
  assert.deepEqual(filter, { _id: { $in: [oid(1)] }, isDeleted: true });
  assert.equal(update.$set.isDeleted, false);
  assert.equal(update.$set.deletedAt, null);
  assert.equal(update.$push.activityTimeline.action, 'RESTORE');
  assert.equal(String(update.$push.activityTimeline.actorId), String(oid(7)));

  stub({ updateMany: () => ({ matchedCount: 0 }), findOne: () => ({ _id: oid(1) }) });
  await assert.rejects(STEPS.unhide(binPlan.unhide('BinTestThing', oid(1)), null), /already back/);
  stub({ updateMany: () => ({ matchedCount: 0 }), findOne: () => null });
  await assert.rejects(STEPS.unhide(binPlan.unhide('BinTestThing', oid(1)), null), /no longer exists/);
  // Optional (e.g. children hidden with it) never refuses.
  assert.equal(await STEPS.unhide(binPlan.unhide('BinTestThing', oid(1), {}, { optional: true }), null), 0);
});

test('reinsert: puts the saved copy back; refuses (or skips when optional) if it is already there', async () => {
  const doc = { _id: oid(3), name: 'SO-1' };
  let calls = stub({ findOne: () => null, insertOne: () => ({}) });
  assert.equal(await STEPS.reinsert(binPlan.reinsert('BinTestThing', doc), null), 1);
  assert.deepEqual(calls[1], ['insertOne', doc, {}]);

  stub({ findOne: () => ({ _id: oid(3) }), insertOne: () => ({}) });
  await assert.rejects(STEPS.reinsert(binPlan.reinsert('BinTestThing', doc), null), /already back/);
  calls = stub({ findOne: () => ({ _id: oid(3) }), insertOne: () => ({}) });
  assert.equal(await STEPS.reinsert(binPlan.reinsert('BinTestThing', doc, { optional: true }), null), 0);
  assert.equal(calls.some(([n]) => n === 'insertOne'), false);
});

test('repush: back into the list at its old place; explains a deleted parent', async () => {
  const item = { _id: oid(4), name: 'Jar' };
  const calls = stub({ updateOne: () => ({ matchedCount: 1 }) });
  await STEPS.repush(binPlan.repush('BinTestThing', oid(1), 'items', item, 2), null);
  const [, filter, update] = calls[0];
  assert.deepEqual(filter, { _id: oid(1), isDeleted: { $ne: true }, 'items._id': { $ne: oid(4) } });
  assert.deepEqual(update.$push, { items: { $each: [item], $position: 2 } });

  stub({ updateOne: () => ({ matchedCount: 0 }), findOne: () => ({ _id: oid(1), isDeleted: true }) });
  await assert.rejects(STEPS.repush(binPlan.repush('BinTestThing', oid(1), 'items', item, 0), null), /Restore that first/);
  await assert.rejects(STEPS.repush(binPlan.repush('BinTestThing', oid(1), 'a.b', item, 0), null), /top-level list/);
});

test('plans may not smuggle operators in', async () => {
  stub({ updateMany: () => ({ matchedCount: 1 }) });
  await assert.rejects(STEPS.unhide({ model: 'BinTestThing', ids: [oid(1)], set: { $where: 1 } }, null), /not allowed/);
  await assert.rejects(STEPS.set({ model: 'BinTestThing', ids: [oid(1)], set: { 'a.b': 1 } }, null), /not allowed/);
});
