/**
 * Inherit a party's PRODUCTION PLAN into an order's DISPATCH PLAN.
 *
 * The factory plans party-wise long before a PO arrives ("on 15 Oct we'll have
 * 10,000 Dome Jars ready for Atomberg"). When the PO finally lands, the planner
 * should not retype those dates — they should draw on what is already promised.
 *
 * ── The allocation rule ──────────────────────────────────────────────────
 * Per SKU, independently:
 *   need     = orderQty - already planned on the dispatch schedule
 *   capacity = each production-plan day's (plannedQty - consumedQty), DATE order
 * Fill EARLIEST DATE FIRST; each day gives min(its free capacity, need left).
 * That produces exactly the behaviour asked for:
 *
 *   plan 10k/15th + 10k/20th + 10k/25th, PO 25k -> 10k, 10k, 5k (25th part-used)
 *   plan 10k across 3 days,              PO  5k -> 5k on the first day, rest free
 *   PO larger than the whole plan                -> plan fully drawn, remainder
 *                                                   reported as `uncovered`
 *   SKU absent from the plan                     -> fully `uncovered`
 *   SKU planned but not ordered                  -> untouched, reported `unused`
 *
 * Nothing is forced: `previewInherit` proposes, the planner edits, and only the
 * caller's apply step writes. Capacity is re-checked on write, so two planners
 * working at once cannot both spend the same day.
 */

import mongoose from 'mongoose';
import ProductionPlanEntry from './production-plan-entry.model.js';
import SalesOrder from '../order/order.model.js';
import DispatchSchedule from '../schedule/schedule.model.js';
import { AppError } from '../../utils/apiResponse.js';

const num = (v) => Number(v || 0) || 0;
const keyOf = (v) => String(v || '').trim().toUpperCase();

/** Match an order line to a plan line by SKU id first, then code, then name. */
const matchKeys = (x) => [
  x.skuId ? `id:${String(x.skuId)}` : null,
  x.skuCode ? `code:${keyOf(x.skuCode)}` : null,
  x.skuName ? `name:${keyOf(x.skuName)}` : null,
].filter(Boolean);

/**
 * Build the proposal. Pure read - writes nothing.
 */
export async function previewInherit(soNumber) {
  const order = await SalesOrder.findOne({ soNumber }).lean();
  if (!order) throw new AppError(`Sales Order ${soNumber} not found`, 404);

  const schedule = await DispatchSchedule.findOne({ soNumber }).sort({ createdAt: -1 }).lean();

  // What each SKU still needs: ordered minus what the dispatch plan already holds.
  const plannedBySku = new Map();
  (schedule?.items || []).forEach((it) => {
    const planned = (it.phases || [])
      .filter((p) => p.status !== 'CANCELLED')
      .reduce((sum, p) => sum + num(p.plannedQty), 0);
    matchKeys(it).forEach((k) => plannedBySku.set(k, planned));
  });

  const needs = (order.items || []).map((oi) => {
    const already = matchKeys(oi).map((k) => plannedBySku.get(k)).find((v) => v != null) || 0;
    return {
      orderItemId: String(oi._id),
      skuId: oi.skuId ? String(oi.skuId) : null,
      skuCode: oi.skuCode || '',
      skuName: oi.skuName || '',
      orderQty: num(oi.orderQty),
      alreadyPlanned: already,
      need: Math.max(0, num(oi.orderQty) - already),
    };
  });
  const needKeys = new Set(needs.flatMap(matchKeys));

  // EVERY live plan for this party, oldest first. We deliberately do NOT
  // allocate here: the planner picks which dates to draw on (a date that has
  // already passed cannot be dispatched from, but its stock still exists), and
  // the split is recomputed live as they tick dates on and off.
  const planDocs = await ProductionPlanEntry.find({
    partyId: order.partyId,
    isDeleted: { $ne: true },
    planStatus: { $ne: 'CANCELLED' },
  }).sort({ plannedDate: 1 }).lean();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const plans = planDocs.map((plan) => {
    const items = (plan.items || [])
      // Only lines this order could actually use.
      .filter((pi) => matchKeys(pi).some((k) => needKeys.has(k)))
      .map((pi) => {
        const free = Math.max(0, num(pi.plannedQty) - num(pi.consumedQty));
        const need = needs.find((n) => {
          const a = new Set(matchKeys(pi));
          return matchKeys(n).some((k) => a.has(k));
        });
        return {
          orderItemId: need ? need.orderItemId : null,
          skuId: pi.skuId ? String(pi.skuId) : (need?.skuId || null),
          skuCode: pi.skuCode || need?.skuCode || '',
          skuName: pi.skuName || need?.skuName || '',
          plannedQty: num(pi.plannedQty),
          consumedQty: num(pi.consumedQty),
          free,
        };
      });

    const date = new Date(plan.plannedDate);
    return {
      planId: String(plan._id),
      planNo: plan.planNo,
      plannedDate: plan.plannedDate,
      // A past date is shown (the stock was made) but never pre-selected — you
      // cannot promise a dispatch on a day that has already gone.
      isPast: date < startOfToday,
      items,
      freeTotal: items.reduce((sum, i) => sum + i.free, 0),
      plannedTotal: items.reduce((sum, i) => sum + i.plannedQty, 0),
      consumedTotal: items.reduce((sum, i) => sum + i.consumedQty, 0),
    };
  }).filter((p) => p.items.length);

  return {
    soNumber,
    partyName: order.partyName || '',
    poNumber: order.poNumber || '',
    needs,
    plans,
    totals: {
      orderQty: needs.reduce((sum, n) => sum + n.orderQty, 0),
      needQty: needs.reduce((sum, n) => sum + n.need, 0),
      planFuture: plans.filter((p) => !p.isPast).reduce((sum, p) => sum + p.freeTotal, 0),
      planAll: plans.reduce((sum, p) => sum + p.freeTotal, 0),
      planDays: plans.length,
    },
  };
}

/**
 * Record that a dispatch phase drew `qty` from a production plan line.
 * Called once per committed line; keeps item and document roll-ups in step.
 */
export async function consumePlanLine({ planId, skuId, skuCode, qty, soNumber, phaseNo, session }) {
  if (!planId || num(qty) <= 0) return null;
  const q = ProductionPlanEntry.findById(planId);
  if (session) q.session(session);
  const plan = await q;
  if (!plan) return null;

  const item = plan.items.find((pi) => (
    (skuId && String(pi.skuId) === String(skuId))
    || (skuCode && keyOf(pi.skuCode) === keyOf(skuCode))
  ));
  if (!item) return null;

  const free = Math.max(0, num(item.plannedQty) - num(item.consumedQty));
  // Re-checked on write, not just at preview: between the two another planner
  // may have spent this day. Consumed must never exceed planned.
  const take = Math.min(free, num(qty));
  if (take <= 0) return { taken: 0, short: num(qty) };

  item.consumedQty = num(item.consumedQty) + take;
  item.consumptions = [...(item.consumptions || []), {
    soNumber: soNumber || '', phaseNo: phaseNo || '', qty: take, at: new Date(),
  }];

  plan.totalConsumedQty = plan.items.reduce((sum, it) => sum + num(it.consumedQty), 0);
  plan.consumedBySo = [...new Set(
    plan.items.flatMap((it) => (it.consumptions || []).map((c) => c.soNumber).filter(Boolean)),
  )];
  await (session ? plan.save({ session }) : plan.save());
  return { taken: take, short: num(qty) - take };
}

/** Give capacity back - used when an inherited dispatch phase is removed. */
export async function releasePlanConsumption({ soNumber, phaseNo }) {
  if (!soNumber) return 0;
  const plans = await ProductionPlanEntry.find({
    consumedBySo: soNumber,
    isDeleted: { $ne: true },
  });
  let released = 0;
  for (const plan of plans) {
    let touched = false;
    plan.items.forEach((item) => {
      const keep = [];
      (item.consumptions || []).forEach((c) => {
        const isMine = c.soNumber === soNumber && (!phaseNo || c.phaseNo === phaseNo);
        if (isMine) {
          item.consumedQty = Math.max(0, num(item.consumedQty) - num(c.qty));
          released += num(c.qty);
          touched = true;
        } else keep.push(c);
      });
      item.consumptions = keep;
    });
    if (!touched) continue;
    plan.totalConsumedQty = plan.items.reduce((sum, it) => sum + num(it.consumedQty), 0);
    plan.consumedBySo = [...new Set(
      plan.items.flatMap((it) => (it.consumptions || []).map((c) => c.soNumber).filter(Boolean)),
    )];
    // eslint-disable-next-line no-await-in-loop
    await plan.save();
  }
  return released;
}

export const productionPlanInheritService = {
  previewInherit,
  consumePlanLine,
  releasePlanConsumption,
  isValidId: (v) => mongoose.isValidObjectId(v),
};
