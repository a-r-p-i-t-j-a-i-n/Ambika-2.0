import mongoose from 'mongoose';
import { AppError } from '../../utils/apiResponse.js';
import { logger } from '../../utils/logger.js';

/**
 * Recycle Bin — restore engine.
 *
 * A bin row's `plan` (written by the module that deleted the record):
 *   checks:      [{ model, match, except?, message }]   refuse when such a record exists
 *   before:      [{ hook, args }]                       domain checks (may throw)
 *   steps:       [{ kind: 'unhide' | 'reinsert' | 'repush' | 'set', … }]
 *   after:       [{ hook, args }]                       domain re-apply (links, totals)
 *   afterCommit: [{ hook, args }]                       caches etc., once saved
 *   openPath:    where the record can be opened again
 *
 * Plans are stored as plain data, so they never hold query operators or dotted
 * keys: `match`/`set` are plain field → value objects and the operators are
 * added here. Anything more involved is a named hook its module registers.
 * Everything up to `after` runs in one transaction where the database allows.
 */

const hooks = new Map();

/** A module's restore logic, called by name from a plan. */
export const registerRestoreHook = (name, fn) => { hooks.set(name, fn); };

/** Plan builders for the modules that put things in the bin. */
export const binPlan = {
  unhide: (model, ids, set = {}, opts = {}) => ({ kind: 'unhide', model, ids: [].concat(ids), set: { deletedAt: null, deletedBy: null, ...set }, ...opts }),
  reinsert: (model, docs, opts = {}) => ({ kind: 'reinsert', model, docs: [].concat(docs), ...opts }),
  repush: (model, parentId, path, item, index, opts = {}) => ({ kind: 'repush', model, parentId, path, item, index, ...opts }),
  set: (model, ids, set, opts = {}) => ({ kind: 'set', model, ids: [].concat(ids), set, ...opts }),
  absent: (model, match, message, except) => ({ model, match, message, ...(except ? { except } : {}) }),
  hook: (hook, args = {}) => ({ hook, args }),
};

const modelOf = (name) => {
  if (!mongoose.modelNames().includes(name)) throw new AppError(`Can't restore: "${name}" records are not available.`, 500);
  return mongoose.model(name);
};

const opts = (session, extra = {}) => (session ? { ...extra, session } : extra);

const assertPlainKeys = (obj, what) => {
  Object.keys(obj || {}).forEach((k) => {
    if (k.startsWith('$') || k.includes('.')) throw new Error(`Recycle Bin plan: ${what} key "${k}" is not allowed`);
  });
};

export const STEPS = {
  /**
   * A record that was only hidden (isDeleted) — and anything hidden with it.
   * `timeline: true` notes the restore in the record's activityTimeline.
   */
  async unhide({ model, ids, set = {}, unset = [], optional = false, timeline = false }, session, ctx = {}) {
    assertPlainKeys(set, 'unhide.set');
    const list = (ids || []).filter(Boolean);
    if (!list.length) return 0;
    const update = { $set: { isDeleted: false, updatedAt: new Date(), ...set } };
    if (unset.length) update.$unset = Object.fromEntries(unset.map((k) => [k, '']));
    if (timeline) {
      update.$push = { activityTimeline: { action: 'RESTORE', description: 'Restored from the Recycle Bin', actorId: ctx.actor?.id || null, timestamp: new Date() } };
    }
    const res = await modelOf(model).collection.updateMany({ _id: { $in: list }, isDeleted: true }, update, opts(session));
    if (!res.matchedCount && !optional) {
      const live = await modelOf(model).collection.findOne({ _id: list[0] }, opts(session, { projection: { _id: 1 } }));
      throw new AppError(live ? 'It is already back — nothing to restore.' : 'The record no longer exists, so it can\'t be restored.', 409);
    }
    return res.matchedCount;
  },

  /** A record that was erased: put the saved copy back, same id and all. */
  async reinsert({ model, docs, optional = false }, session) {
    const M = modelOf(model);
    let n = 0;
    for (const doc of docs || []) {
      const exists = await M.collection.findOne({ _id: doc._id }, opts(session, { projection: { _id: 1 } }));
      if (exists) {
        if (optional) continue;
        throw new AppError('It is already back — nothing to restore.', 409);
      }
      await M.collection.insertOne(doc, opts(session));
      n += 1;
    }
    return n;
  },

  /** An item taken out of a list inside a record (e.g. a party's SKU). */
  async repush({ model, parentId, path, item, index }, session) {
    if (path.startsWith('$') || path.includes('.')) throw new Error(`Recycle Bin plan: repush path "${path}" must be a top-level list`);
    const M = modelOf(model);
    const push = Number.isInteger(index) && index >= 0 ? { $each: [item], $position: index } : item;
    const res = await M.collection.updateOne(
      { _id: parentId, isDeleted: { $ne: true }, [`${path}._id`]: { $ne: item._id } },
      { $push: { [path]: push }, $set: { updatedAt: new Date() } },
      opts(session),
    );
    if (!res.matchedCount) {
      const parent = await M.collection.findOne({ _id: parentId }, opts(session, { projection: { _id: 1, isDeleted: 1 } }));
      if (!parent || parent.isDeleted) throw new AppError('Can\'t restore — the record it belonged to is deleted. Restore that first.', 409);
      throw new AppError('It is already back — nothing to restore.', 409);
    }
    return 1;
  },

  /** Put plain fields back (e.g. a step switched off → on again). */
  async set({ model, ids, set, optional = false }, session) {
    assertPlainKeys(set, 'set');
    const res = await modelOf(model).collection.updateMany({ _id: { $in: ids || [] } }, { $set: { ...set, updatedAt: new Date() } }, opts(session));
    if (!res.matchedCount && !optional) throw new AppError('The record no longer exists, so it can\'t be restored.', 409);
    return res.matchedCount;
  },
};

const callHook = async ({ hook, args }, ctx) => {
  const fn = hooks.get(hook);
  if (!fn) throw new AppError(`Can't restore: "${hook}" is not available.`, 500);
  return fn(args || {}, ctx);
};

/** Mongo transactions need a replica set; run without one where there is none. */
const withMaybeTransaction = async (fn) => {
  let session = null;
  try {
    session = await mongoose.startSession();
  } catch {
    return fn(null);
  }
  try {
    let result;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } catch (err) {
    if (err?.code === 20 || /Transaction numbers are only allowed/.test(err?.message || '')) return fn(null);
    throw err;
  } finally {
    session.endSession();
  }
};

const friendly = (err) => {
  if (err?.code === 11000) {
    const what = Object.entries(err.keyValue || {}).map(([k, v]) => `${k} ${v}`).join(', ');
    return new AppError(`Can't restore — ${what || 'its number'} is now used by another record.`, 409);
  }
  return err;
};

/** Restore one bin row. Throws an AppError (shown to the user) when it can't. */
export const runRestore = async (row, actor) => {
  const plan = row.plan;
  if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) {
    throw new AppError('Nothing was saved for this item, so it can\'t be restored.', 409);
  }
  const ctx = { actor, row };
  try {
    await withMaybeTransaction(async (session) => {
      ctx.session = session;
      for (const b of plan.before || []) await callHook(b, ctx);
      for (const c of plan.checks || []) {
        assertPlainKeys(c.match, 'check.match');
        const filter = { ...c.match, ...(c.except ? { _id: { $ne: c.except } } : {}) };
        const hit = await modelOf(c.model).collection.findOne(filter, opts(session, { projection: { _id: 1 } }));
        if (hit) throw new AppError(c.message || 'Can\'t restore — a matching record already exists.', 409);
      }
      for (const step of plan.steps) {
        const run = STEPS[step.kind];
        if (!run) throw new Error(`Recycle Bin plan: unknown step "${step.kind}"`);
        await run(step, session, ctx);
      }
      for (const a of plan.after || []) await callHook(a, ctx);
    });
  } catch (err) {
    throw friendly(err);
  }
  ctx.session = null;
  for (const a of plan.afterCommit || []) {
    try { await callHook(a, ctx); } catch (err) { logger.warn(`[recycle-bin] ${a.hook} after restore: ${err.message}`); }
  }
  return { openPath: plan.openPath || row.openPath };
};
