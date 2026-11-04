import { AppError } from '../../utils/apiResponse.js';

/**
 * Recycle Bin — a deleted dispatch phase and how to put it back.
 * Kept free of models / services so it can be tested on its own.
 */

const sameId = (a, b) => String(a) === String(b);
const byId = (list, id) => (list || []).find((x) => sameId(x._id, id));

/**
 * What deleting `phaseId` does, read just before the delete: every SKU's phase
 * with the same phaseNo is either dropped (no dispatches yet) or — when it
 * already has dispatches — only CANCELLED. The Recycle Bin keeps this.
 */
export const phaseDeleteSnapshot = (schedule, phaseId) => {
  let phaseNo = null;
  for (const it of schedule?.items || []) {
    const p = byId(it.phases, phaseId);
    if (p) { phaseNo = p.phaseNo; break; }
  }
  if (!phaseNo) return null;
  const removed = [];
  const cancelled = [];
  (schedule.items || []).forEach((it) => (it.phases || []).forEach((p, index) => {
    if (p.phaseNo !== phaseNo) return;
    if (Number(p.totalActualQty || 0) > 0) {
      cancelled.push({ itemId: it._id, skuName: it.skuName || it.skuCode || '', phaseId: p._id, prevStatus: p.status || 'PLANNED' });
    } else {
      removed.push({ itemId: it._id, skuName: it.skuName || it.skuCode || '', index, phase: p });
    }
  }));
  return { phaseNo, removed, cancelled };
};

/**
 * Put a deleted phase back into a schedule's items (mutates them): dropped
 * phases return at their old place, cancelled ones get their old status.
 * Checks everything first; refuses (409) rather than restore half of it.
 */
export const putPhaseBack = (items, { phaseNo, removed = [], cancelled = [] }) => {
  const cancelledIds = new Set(cancelled.map((c) => String(c.phaseId)));
  for (const r of removed) {
    const it = byId(items, r.itemId);
    if (!it) throw new AppError(`Can't restore — ${r.skuName || 'a SKU'} is no longer on this dispatch plan.`, 409);
    if (byId(it.phases, r.phase._id)) continue;
    if ((it.phases || []).some((p) => p.phaseNo === phaseNo && !cancelledIds.has(String(p._id)))) {
      throw new AppError(`Can't restore — ${phaseNo} has been planned again for ${it.skuName || 'this SKU'} since.`, 409);
    }
  }
  let changed = 0;
  [...removed].sort((a, b) => a.index - b.index).forEach((r) => {
    const it = byId(items, r.itemId);
    if (byId(it.phases, r.phase._id)) return;
    it.phases.splice(Math.min(r.index, it.phases.length), 0, r.phase);
    changed += 1;
  });
  cancelled.forEach((c) => {
    const p = byId(byId(items, c.itemId)?.phases, c.phaseId);
    if (p && p.status === 'CANCELLED') { p.status = c.prevStatus; changed += 1; }
  });
  return changed;
};
