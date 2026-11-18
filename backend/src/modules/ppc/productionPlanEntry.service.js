/**
 * Production-plan service — party-wise plans that do not need an order.
 *
 * Every write funnels through `normaliseItems` so the stored roll-ups
 * (`totalPlannedQty` / `totalProducedQty`) can never drift from `items`, and
 * through `deriveStatus` so the calendar's colour is a pure function of the
 * numbers rather than something a caller can set inconsistently.
 */

import mongoose from 'mongoose';
import ProductionPlanEntry from './production-plan-entry.model.js';
import Party from '../clients/party.model.js';
import SKU from '../skus/sku.model.js';
import { generateDocNumber } from '../../utils/docNumberGenerator.js';
import { recycleBinService } from '../recycle-bin/recycleBin.service.js';
import { binPlan } from '../recycle-bin/recycleBin.restore.js';

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Start/end of the given day in server time — plans are day-granular. */
const dayStart = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * Resolve the SKU lines: trust the client for quantities, but re-read code and
 * name from the SKU collection so a renamed SKU can't leave stale text on old
 * plans, and so a caller can't invent a line for a SKU that doesn't exist.
 */
async function normaliseItems(rawItems, existing = null) {
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .filter((it) => it && it.skuId && toNum(it.plannedQty) > 0);

  if (!items.length) {
    const err = new Error('Add at least one SKU with a quantity greater than zero');
    err.statusCode = 400;
    throw err;
  }

  const ids = [...new Set(items.map((it) => String(it.skuId)))];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) {
    const err = new Error('One of the selected SKUs is invalid');
    err.statusCode = 400;
    throw err;
  }

  const skus = await SKU.find({ _id: { $in: ids } }).select('name code').lean();
  const byId = new Map(skus.map((s) => [String(s._id), s]));

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    const err = new Error('One of the selected SKUs no longer exists');
    err.statusCode = 400;
    throw err;
  }

  // Two lines for the same SKU on one plan are a data-entry slip, not a
  // feature — fold them together rather than storing a confusing duplicate.
  const priorByKey = new Map(
    ((existing?.items) || []).map((it) => [String(it.skuId), it]),
  );

  const merged = new Map();
  for (const it of items) {
    const key = String(it.skuId);
    const sku = byId.get(key);
    const prev = merged.get(key);
    const plannedQty = toNum(it.plannedQty) + (prev ? prev.plannedQty : 0);
    merged.set(key, {
      skuId:       key,
      skuCode:     sku.code || '',
      skuName:     sku.name || 'SKU',
      plannedQty,
      producedQty: toNum(it.producedQty) + (prev ? prev.producedQty : 0),
      // Never taken from the request body: consumption is owned by dispatch
      // planning. Editing a plan's quantities must not wipe what an order has
      // already drawn from it, or the same capacity could be inherited twice.
      consumedQty:  prev ? prev.consumedQty : toNum(priorByKey.get(key)?.consumedQty),
      consumptions: prev ? prev.consumptions : (priorByKey.get(key)?.consumptions || []),
      note:        String(it.note || prev?.note || '').trim(),
    });
  }

  return [...merged.values()];
}

const sumBy = (items, key) => items.reduce((s, it) => s + toNum(it[key]), 0);

const badRequest = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

/** The party is optional — a plan can be for SKUs only. */
async function resolveParty(partyId) {
  if (!partyId) return { partyId: null, partyName: '' };
  if (!mongoose.isValidObjectId(partyId)) throw badRequest('That party is invalid');
  const party = await Party.findById(partyId).select('name').lean();
  if (!party) throw badRequest('That party no longer exists');
  return { partyId, partyName: party.name };
}

/**
 * Each SKU line may carry its own date (else the plan's). A plan is one date,
 * so lines are grouped per day, in the order the lines came.
 */
function groupByDay(rawItems, fallbackDate) {
  const groups = new Map();
  for (const it of Array.isArray(rawItems) ? rawItems : []) {
    if (!it || !it.skuId || !(toNum(it.plannedQty) > 0)) continue;
    const raw = it.plannedDate || fallbackDate;
    if (!raw || Number.isNaN(new Date(raw).getTime())) throw badRequest('Select a date for every SKU');
    const key = dayStart(raw).getTime();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  if (!groups.size) throw badRequest('Add at least one SKU with a quantity greater than zero');
  return [...groups.entries()].map(([t, items]) => ({ date: new Date(t), items }));
}

/**
 * Status follows the numbers. A cancelled plan is the one state a human sets,
 * so it is preserved rather than recomputed.
 */
function deriveStatus(items, current) {
  if (current === 'CANCELLED') return 'CANCELLED';
  const planned  = sumBy(items, 'plannedQty');
  const produced = sumBy(items, 'producedQty');
  if (produced <= 0) return 'PLANNED';
  if (produced >= planned) return 'COMPLETED';
  return 'IN_PROGRESS';
}

/** Shared shaping for create/update so both paths store identical roll-ups. */
async function buildPayload(body, existing = null) {
  const items = await normaliseItems(body.items, existing);
  const planStatus = deriveStatus(items, body.planStatus || existing?.planStatus);

  return {
    items,
    totalPlannedQty:  sumBy(items, 'plannedQty'),
    totalProducedQty: sumBy(items, 'producedQty'),
    totalConsumedQty: sumBy(items, 'consumedQty'),
    consumedBySo: [...new Set(items.flatMap((it) => (it.consumptions || []).map((c) => c.soNumber).filter(Boolean)))],
    planStatus,
  };
}

export async function listPlans(query = {}) {
  const { from, to, partyId, planStatus, search, limit = 2000 } = query;

  const filter = { isDeleted: { $ne: true } };

  if (from || to) {
    filter.plannedDate = {};
    if (from) filter.plannedDate.$gte = dayStart(from);
    if (to) {
      const end = dayStart(to);
      end.setHours(23, 59, 59, 999);
      filter.plannedDate.$lte = end;
    }
  }
  if (partyId && mongoose.isValidObjectId(partyId)) filter.partyId = partyId;
  if (planStatus) filter.planStatus = planStatus;
  if (search) {
    const rx = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ planNo: rx }, { partyName: rx }, { soNumber: rx }, { poNumber: rx }];
  }

  const rows = await ProductionPlanEntry.find(filter)
    .sort({ plannedDate: 1, partyName: 1 })
    .limit(Math.min(Number(limit) || 2000, 5000))
    .lean();

  return rows;
}

/** Creates one plan per date the lines carry; returns them in line order. */
export async function createPlan(body, userId) {
  const groups = groupByDay(body?.items, body?.plannedDate);
  const party = await resolveParty(body.partyId);
  // Every date's lines are checked before any is saved, so a bad line can't
  // leave half the plans behind.
  const shaped = await Promise.all(groups.map((g) => buildPayload({ ...body, items: g.items })));

  const docs = [];
  for (let i = 0; i < groups.length; i += 1) {
    const planNo = await generateDocNumber('PRODUCTION_PLAN', groups[i].date);
    const doc = await ProductionPlanEntry.create({
      ...shaped[i],
      planNo,
      ...party,
      plannedDate: groups[i].date,
      // An order link is welcome but never required — that is the point of this model.
      salesOrderId: body.salesOrderId && mongoose.isValidObjectId(body.salesOrderId) ? body.salesOrderId : null,
      soNumber:     String(body.soNumber || '').trim(),
      poNumber:     String(body.poNumber || '').trim(),
      source:       body.salesOrderId ? 'ORDER' : 'MANUAL',
      remarks:      String(body.remarks || '').trim(),
      createdBy:    userId,
      updatedBy:    userId,
    });
    docs.push(doc.toObject());
  }
  return docs;
}

export async function updatePlan(id, body, userId) {
  if (!mongoose.isValidObjectId(id)) {
    const err = new Error('Invalid plan id');
    err.statusCode = 400;
    throw err;
  }

  const existing = await ProductionPlanEntry.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!existing) {
    const err = new Error('Plan not found');
    err.statusCode = 404;
    throw err;
  }

  const patch = { updatedBy: userId };

  // Sent empty → the plan no longer has a party.
  if (body.partyId !== undefined && String(body.partyId || '') !== String(existing.partyId || '')) {
    Object.assign(patch, await resolveParty(body.partyId));
  }

  if (body.plannedDate) patch.plannedDate = dayStart(body.plannedDate);
  if (body.remarks !== undefined) patch.remarks = String(body.remarks || '').trim();
  if (body.soNumber !== undefined) patch.soNumber = String(body.soNumber || '').trim();
  if (body.poNumber !== undefined) patch.poNumber = String(body.poNumber || '').trim();

  // Lines given another date leave this plan and become plans of their own.
  let moved = [];
  // Cancelling is a status-only edit; it must not require resending the lines.
  if (body.planStatus === 'CANCELLED') {
    patch.planStatus = 'CANCELLED';
  } else if (body.items) {
    const groups = groupByDay(body.items, body.plannedDate || existing.plannedDate);
    // What an order already drew is recorded on THIS plan, so those lines stay
    // here (on one date) — moving them would lose the record of the draw.
    const usedIds = new Set(existing.items.filter((it) => toNum(it.consumedQty) > 0).map((it) => String(it.skuId)));
    const withUsed = groups.filter((g) => g.items.some((it) => usedIds.has(String(it.skuId))));
    if (withUsed.length > 1) throw badRequest('SKUs already used by an order must stay on one date');
    const sameDay = groups.find((g) => g.date.getTime() === dayStart(existing.plannedDate).getTime());
    const main = withUsed[0] || sameDay || groups[0];
    moved = groups.filter((g) => g !== main);
    // Checked before anything is saved.
    await Promise.all(moved.map((g) => normaliseItems(g.items)));
    patch.plannedDate = main.date;
    Object.assign(patch, await buildPayload({ ...body, items: main.items }, existing));
  } else if (body.planStatus) {
    patch.planStatus = deriveStatus(existing.items, body.planStatus);
  }

  const updated = await ProductionPlanEntry.findByIdAndUpdate(id, patch, { new: true }).lean();
  for (const g of moved) {
    await createPlan({
      partyId: updated.partyId, salesOrderId: updated.salesOrderId, soNumber: updated.soNumber,
      poNumber: updated.poNumber, remarks: updated.remarks, plannedDate: g.date, items: g.items,
    }, userId);
  }
  return updated;
}

/** Soft delete — plans feed a director's monthly view, so nothing is truly removed. */
export async function deletePlan(id, userId) {
  if (!mongoose.isValidObjectId(id)) {
    const err = new Error('Invalid plan id');
    err.statusCode = 400;
    throw err;
  }
  // The delete marks the plan CANCELLED; its status before is kept for a restore.
  const before = await ProductionPlanEntry.findOne({ _id: id, isDeleted: { $ne: true } }).select('planStatus').lean();
  const doc = await ProductionPlanEntry.findOneAndUpdate(
    { _id: id, isDeleted: { $ne: true } },
    { isDeleted: true, deletedAt: new Date(), deletedBy: userId, planStatus: 'CANCELLED' },
    { new: true },
  ).lean();

  if (!doc) {
    const err = new Error('Plan not found');
    err.statusCode = 404;
    throw err;
  }
  await recycleBinService.record('productionPlan', {
    recordId: doc._id,
    title: doc.planNo || 'Production plan',
    subtitle: [doc.partyName, before?.planStatus].filter(Boolean).join(' · '),
    keywords: [(doc.items || []).map((i) => [i.skuName, i.skuCode])],
    actor: userId,
    plan: { steps: [binPlan.unhide(ProductionPlanEntry.modelName, doc._id, { planStatus: before?.planStatus || 'PLANNED' })] },
  });
  return doc;
}

/**
 * Party-wise roll-up for the month — what the director actually opens.
 * Returns one row per party with its per-day totals already summed.
 */
export async function partySummary(query = {}) {
  const rows = await listPlans({ ...query, limit: 5000 });

  const byParty = new Map();
  for (const r of rows) {
    if (r.planStatus === 'CANCELLED') continue;
    const key = String(r.partyId);
    if (!byParty.has(key)) {
      byParty.set(key, {
        partyId: key,
        partyName: r.partyName || 'No party',
        planCount: 0,
        totalPlannedQty: 0,
        totalProducedQty: 0,
        days: {},
        skus: {},
      });
    }
    const p = byParty.get(key);
    p.planCount += 1;
    p.totalPlannedQty += toNum(r.totalPlannedQty);
    p.totalProducedQty += toNum(r.totalProducedQty);

    const dayKey = new Date(r.plannedDate).toISOString().slice(0, 10);
    p.days[dayKey] = (p.days[dayKey] || 0) + toNum(r.totalPlannedQty);

    for (const it of r.items || []) {
      const sk = it.skuName || 'SKU';
      p.skus[sk] = (p.skus[sk] || 0) + toNum(it.plannedQty);
    }
  }

  return [...byParty.values()].sort((a, b) => b.totalPlannedQty - a.totalPlannedQty);
}
