import mongoose from 'mongoose';
import { RecycleBinItem, RecycleBinSetting } from './recycleBin.model.js';
import { MODULES, TYPES, pageFrom } from './recycleBin.catalog.js';
import { currentRequest } from '../../middleware/requestContext.js';
import User from '../auth/auth.model.js';
import { AppError } from '../../utils/apiResponse.js';
import { logger } from '../../utils/logger.js';

/**
 * Recycle Bin — what a delete leaves behind so it can be put back.
 *
 *   record(type, info)        after a delete that only HIDES the record (isDeleted)
 *   capture(type, info, run)  around a delete that ERASES it: the bin row (with a
 *                             full copy in info.plan) is written first, and is
 *                             dropped again if the delete itself fails.
 *
 * `info.plan` says how to restore (see recycleBin.restore.js). Who deleted and
 * from which screen come from the request; `info.actor` overrides the person.
 */

export const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const RESTORE_LOCK_MS = 2 * 60 * 1000; // a restore left half-way (crash) can be retried after this
const MAX_BATCH = 100;

// ── Pure helpers (exported for tests) ───────────────────────

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lower-case, de-duplicated search text from any mix of strings / numbers. */
export const buildKeywords = (parts) => [...new Set(
  (parts || []).flat(Infinity)
    .filter((p) => p !== null && p !== undefined && p !== '')
    .map((p) => String(p).toLowerCase().trim())
    .filter(Boolean),
)].join(' ').slice(0, 2000);

/**
 * Search box → filter. Commas separate alternatives ("grn 42, epack" = either);
 * the words inside one alternative must all match, in any order.
 */
export const searchFilter = (q) => {
  const groups = String(q || '').split(',')
    .map((g) => g.trim().toLowerCase().split(/\s+/).filter(Boolean))
    .filter((words) => words.length)
    .slice(0, 10);
  if (!groups.length) return {};
  const clause = (words) => (words.length === 1
    ? { keywords: { $regex: escapeRegex(words[0]) } }
    : { $and: words.slice(0, 8).map((w) => ({ keywords: { $regex: escapeRegex(w) } })) });
  return groups.length === 1 ? clause(groups[0]) : { $or: groups.map(clause) };
};

/** Whose rows a person may see: everyone's, or only the ones they deleted. */
export const scopeOf = (access = {}, userId = null) => (access.all ? {} : { 'deletedBy.id': userId || { $in: [] } });

const asList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
const isId = (v) => mongoose.isValidObjectId(v);

/** Everything except search + paging: tab, module, type, person, dates, and whose items. */
export const listFilter = ({ status = 'pending', module, type, deletedBy, from, to } = {}, access = {}, userId = null) => {
  const filter = { status };
  const modules = asList(module);
  const types = asList(type);
  const people = asList(deletedBy).filter(isId);
  if (modules.length) filter.module = { $in: modules };
  if (types.length) filter.type = { $in: types };
  if (!access.all) Object.assign(filter, scopeOf(access, userId));
  else if (people.length) filter['deletedBy.id'] = { $in: people.map((p) => new mongoose.Types.ObjectId(String(p))) };
  const range = {};
  if (from && !Number.isNaN(Date.parse(from))) range.$gte = new Date(from);
  if (to && !Number.isNaN(Date.parse(to))) range.$lte = new Date(to);
  if (Object.keys(range).length) filter.deletedAt = range;
  return filter;
};

/** The date a tab is sorted by (newest first). */
export const sortFieldOf = (status) => (status === 'restored' ? 'restoredAt' : 'deletedAt');

export const encodeCursor = (date, id) => `${new Date(date).getTime()}_${id}`;
export const decodeCursor = (cursor) => {
  const [ms, id] = String(cursor || '').split('_');
  if (!ms || !isId(id) || Number.isNaN(Number(ms))) return null;
  return { at: new Date(Number(ms)), id: new mongoose.Types.ObjectId(id) };
};

/** A bin row as the page shows it — never the restore plan. */
export const viewOf = (row, now = new Date()) => {
  const def = TYPES[row.type] || {};
  const sortField = sortFieldOf(row.status);
  return {
    id: String(row._id),
    system: 'erp',
    module: row.module,
    moduleLabel: MODULES[row.module] || row.module,
    type: row.type,
    typeLabel: def.label || row.type,
    title: row.title,
    subtitle: row.subtitle || '',
    from: row.from || null,
    openPath: row.openPath || null,
    reason: row.reason || '',
    deletedBy: row.deletedBy ? { id: row.deletedBy.id ? String(row.deletedBy.id) : null, name: row.deletedBy.name || '' } : null,
    deletedAt: row.deletedAt,
    status: row.status,
    restoredBy: row.restoredBy ? { id: row.restoredBy.id ? String(row.restoredBy.id) : null, name: row.restoredBy.name || '' } : null,
    restoredAt: row.restoredAt || null,
    lastError: row.lastError || '',
    expiresAt: row.expiresAt || null,
    daysLeft: row.expiresAt ? Math.max(0, Math.ceil((new Date(row.expiresAt) - now) / DAY_MS)) : null,
    sortAt: row[sortField] || row.deletedAt,
  };
};

// ── Who / where ─────────────────────────────────────────────

const personOf = async (actor) => {
  const req = currentRequest();
  const who = actor ?? req?.user ?? null;
  if (!who) return null;
  if (who._id && who.name) return { id: who._id, name: who.name };
  const id = who._id || who.id || who;
  if (!isId(id)) return null;
  try {
    const user = await User.findById(id).select('name').lean();
    return { id, name: user?.name || '' };
  } catch {
    return { id, name: '' };
  }
};

// ── Retention (auto-empty) ──────────────────────────────────

let retentionCache = { days: null, at: 0 };

export const getRetentionDays = async () => {
  if (retentionCache.days && Date.now() - retentionCache.at < 60 * 1000) return retentionCache.days;
  const row = await RecycleBinSetting.findById('default').lean();
  const days = Number(row?.retentionDays) || DEFAULT_RETENTION_DAYS;
  retentionCache = { days, at: Date.now() };
  return days;
};

// ── Service ─────────────────────────────────────────────────

export const recycleBinService = {
  /**
   * Put one deleted record in the bin. Throws if it can't be written — use
   * record() where the delete must go ahead regardless.
   *   info: { recordId, title, subtitle, keywords[], reason, openPath, actor, plan }
   */
  async add(type, info = {}) {
    const def = TYPES[type];
    if (!def) throw new Error(`Recycle Bin: unknown type "${type}"`);
    const req = currentRequest();
    const deletedBy = await personOf(info.actor);
    const deletedAt = new Date();
    const days = await getRetentionDays();
    const recordId = info.recordId && isId(info.recordId) ? info.recordId : undefined;
    const from = pageFrom(req?.get?.('x-client-page')) || def.from;
    const openPath = info.openPath || (recordId && def.open ? def.open(recordId) : def.from.path);
    return RecycleBinItem.create({
      module: def.module,
      type,
      recordId,
      title: String(info.title || def.label).slice(0, 200),
      subtitle: info.subtitle ? String(info.subtitle).slice(0, 300) : undefined,
      keywords: buildKeywords([info.title, info.subtitle, info.keywords, def.label, MODULES[def.module], from.label, deletedBy?.name, info.reason]),
      from,
      openPath,
      reason: info.reason ? String(info.reason).slice(0, 500) : undefined,
      deletedBy: deletedBy || undefined,
      deletedAt,
      expiresAt: new Date(deletedAt.getTime() + days * DAY_MS),
      plan: info.plan,
    });
  },

  /** add() for a delete that already happened (record only hidden): never throws. */
  async record(type, info = {}) {
    try {
      return await this.add(type, info);
    } catch (err) {
      logger.error(`[recycle-bin] could not record ${type} ${info.recordId || ''}: ${err.message}`);
      return null;
    }
  },

  /** Write the bin row first, then run the erasing delete; undo the row if it fails. */
  async capture(type, info, run) {
    const row = await this.add(type, info);
    try {
      return await run();
    } catch (err) {
      await RecycleBinItem.deleteOne({ _id: row._id }).catch(() => {});
      throw err;
    }
  },

  async list(query = {}, access = {}, userId = null) {
    const status = ['pending', 'restoring', 'restored'].includes(query.status) ? query.status : 'pending';
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const sortField = sortFieldOf(status);
    const now = new Date();
    const filter = { ...listFilter({ ...query, status }, access, userId), ...searchFilter(query.q), expiresAt: { $gt: now } };
    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      filter.$and = [...(filter.$and || []), { $or: [{ [sortField]: { $lt: cursor.at } }, { [sortField]: cursor.at, _id: { $lt: cursor.id } }] }];
    }
    const rows = await RecycleBinItem.find(filter).sort({ [sortField]: -1, _id: -1 }).limit(limit + 1).lean();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => viewOf(r, now)),
      nextCursor: rows.length > limit && last ? encodeCursor(last[sortField] || last.deletedAt, last._id) : null,
    };
  },

  /** Tab counts + what the filters can offer (modules, types, people). */
  async summary(access = {}, userId = null) {
    const scope = { expiresAt: { $gt: new Date() }, ...scopeOf(access, userId) };
    const [facets] = await RecycleBinItem.aggregate([
      { $match: scope },
      { $facet: {
        status: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
        types: [{ $group: { _id: { module: '$module', type: '$type' }, n: { $sum: 1 } } }],
        people: [{ $match: { 'deletedBy.id': { $ne: null } } }, { $group: { _id: '$deletedBy.id', name: { $last: '$deletedBy.name' }, n: { $sum: 1 } } }, { $sort: { name: 1 } }, { $limit: 300 }],
      } },
    ]);
    const counts = { pending: 0, restoring: 0, restored: 0 };
    (facets?.status || []).forEach((s) => { counts[s._id] = s.n; });
    return {
      counts,
      types: (facets?.types || []).map((t) => ({
        module: t._id.module, moduleLabel: MODULES[t._id.module] || t._id.module,
        type: t._id.type, typeLabel: TYPES[t._id.type]?.label || t._id.type, count: t.n,
      })),
      people: (facets?.people || []).map((p) => ({ id: String(p._id), name: p.name || 'Unknown', count: p.n })),
      retentionDays: await getRetentionDays(),
    };
  },

  /** Restore several bin rows, one after another. Returns a verdict per row. */
  async restore(ids, access = {}, user = null) {
    const { runRestore } = await import('./recycleBin.restore.js');
    const actor = await personOf(user);
    const days = await getRetentionDays();
    const results = [];
    for (const id of [...new Set(ids || [])].slice(0, MAX_BATCH)) {
      if (!isId(id)) { results.push({ id, ok: false, error: 'Not a valid bin item.' }); continue; }
      const now = new Date();
      const row = await RecycleBinItem.findOneAndUpdate(
        {
          _id: id,
          ...scopeOf(access, user?._id),
          $or: [{ status: 'pending' }, { status: 'restoring', restoringAt: { $lt: new Date(now - RESTORE_LOCK_MS) } }],
        },
        { $set: { status: 'restoring', restoringAt: now } },
        { new: true },
      ).select('+plan').lean();
      if (!row) { results.push({ id, ok: false, error: 'Already restored, or no longer in the bin.' }); continue; }

      try {
        const out = await runRestore(row, actor);
        const restoredAt = new Date();
        const openPath = out?.openPath || row.openPath;
        await RecycleBinItem.updateOne({ _id: row._id }, {
          $set: { status: 'restored', restoredAt, restoredBy: actor || undefined, openPath, expiresAt: new Date(restoredAt.getTime() + days * DAY_MS) },
          $unset: { plan: 1, lastError: 1, restoringAt: 1 },
        });
        results.push({ id, ok: true, title: row.title, openPath });
      } catch (err) {
        const message = err?.isOperational ? err.message : `Couldn't restore: ${err?.message || 'unexpected error'}`;
        if (!err?.isOperational) logger.error(`[recycle-bin] restore ${row.type} ${row._id} failed: ${err?.stack || err}`);
        await RecycleBinItem.updateOne({ _id: row._id }, { $set: { status: 'pending', lastError: message }, $unset: { restoringAt: 1 } });
        results.push({ id, ok: false, title: row.title, error: message });
      }
    }
    return results;
  },

  /** Delete forever: the bin rows go; what they held can't be restored any more. */
  async purge(ids, access = {}, user = null) {
    const valid = [...new Set(ids || [])].filter(isId).slice(0, MAX_BATCH);
    const res = await RecycleBinItem.deleteMany({
      _id: { $in: valid },
      status: { $ne: 'restoring' },
      ...scopeOf(access, user?._id),
    });
    return { removed: res.deletedCount || 0 };
  },

  async setRetentionDays(days, user = null) {
    const n = Math.round(Number(days));
    if (!Number.isFinite(n) || n < 1 || n > 365) throw new AppError('Choose between 1 and 365 days.', 400);
    await RecycleBinSetting.updateOne(
      { _id: 'default' },
      { $set: { retentionDays: n, updatedBy: (await personOf(user)) || undefined } },
      { upsert: true },
    );
    retentionCache = { days: n, at: Date.now() };
    // Every row's auto-empty date moves with the new setting (native pipeline update).
    const ms = n * DAY_MS;
    await RecycleBinItem.collection.updateMany({ status: { $ne: 'restored' } }, [{ $set: { expiresAt: { $add: ['$deletedAt', ms] } } }]);
    await RecycleBinItem.collection.updateMany({ status: 'restored' }, [{ $set: { expiresAt: { $add: [{ $ifNull: ['$restoredAt', '$deletedAt'] }, ms] } } }]);
    return n;
  },
};

export default recycleBinService;
