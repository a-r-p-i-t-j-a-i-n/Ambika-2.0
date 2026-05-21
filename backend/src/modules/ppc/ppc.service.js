/**
 * PPC service — Production Planning & Control.
 *
 * Demand is computed LIVE from open sales orders (sum of item balanceQty).
 * That demand drives `netToProduce`; the factory then plans daily targets and
 * records what it actually produced. None of this touches dispatch data.
 */

import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
dayjs.extend(isSameOrBefore);

import ProductionPlan, { PPC_STAGES } from './production-plan.model.js';
import SKU from '../skus/sku.model.js';
import SalesOrder from '../order/order.model.js';
import { AppError } from '../../utils/apiResponse.js';

// ── Helpers ──────────────────────────────────────────────────────────

// Net production target = open demand minus stock/WIP, plus a safety buffer.
const computeNet = (demand, fgStock, openingWip, bufferPct) => {
  const base = Math.max(0, Number(demand || 0) - Number(fgStock || 0) - Number(openingWip || 0));
  return Math.ceil(base * (1 + (Number(bufferPct) || 0) / 100));
};

// Live open-order demand per SKU code (what still has to exist to be shipped).
const computeDemand = async () => {
  const rows = await SalesOrder.aggregate([
    { $unwind: '$items' },
    { $match: { 'items.balanceQty': { $gt: 0 } } },
    {
      $group: {
        _id: '$items.skuCode',
        skuId:    { $first: '$items.skuId' },
        skuName:  { $first: '$items.skuName' },
        openQty:  { $sum: '$items.balanceQty' },
        orderQty: { $sum: '$items.orderQty' },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id, r]));
};

// Spread a quantity evenly across the working days (Mon–Sat) of a month.
// For the current month it starts from today; for past/future months, day 1.
const buildDays = (year, month, netQty) => {
  const monthStart = dayjs(`${year}-${String(month).padStart(2, '0')}-01`).startOf('day');
  const monthEnd = monthStart.endOf('month');
  const today = dayjs().startOf('day');
  const start = (today.isAfter(monthStart, 'day') && today.isSameOrBefore(monthEnd, 'day'))
    ? today : monthStart;

  const working = [];
  for (let d = start; d.isSameOrBefore(monthEnd, 'day'); d = d.add(1, 'day')) {
    if (d.day() !== 0) working.push(d); // skip Sunday
  }
  if (working.length === 0) return [];

  const per = Math.floor(netQty / working.length);
  let rem = netQty - per * working.length;
  return working.map((wd) => {
    let targetQty = per;
    if (rem > 0) { targetQty += 1; rem -= 1; }
    return { date: wd.toDate(), targetQty, producedQty: 0 };
  });
};

// Turn one plan (+ its live demand) into a board row.
const buildRow = (sku, openBalance, plan, today) => {
  const days = plan?.days || [];
  const produced = days.reduce((s, d) => s + (d.producedQty || 0), 0);
  const netToProduce = plan?.netToProduce || 0;
  const balance = Math.max(0, netToProduce - produced);

  const todayDay = days.find((d) => dayjs(d.date).isSame(today, 'day'));
  const todayTarget = todayDay?.targetQty || 0;
  const todayProduced = todayDay?.producedQty || 0;

  // Cumulative target up to & including today — used to judge "behind".
  const targetToDate = days
    .filter((d) => dayjs(d.date).isSameOrBefore(today, 'day'))
    .reduce((s, d) => s + (d.targetQty || 0), 0);

  let status = 'NOT_PLANNED';
  if (plan) {
    if (netToProduce > 0 && produced >= netToProduce) status = 'DONE';
    else if (produced + 0.001 < targetToDate) status = 'BEHIND';
    else status = 'ON_TRACK';
  }

  const wip = plan?.wip || { cutting: 0, drawing: 0, buffing: 0, finishing: 0, packing: 0 };
  const wipTotal = PPC_STAGES.reduce((s, k) => s + (wip[k] || 0), 0);
  const achievementPct = netToProduce > 0
    ? Math.min(100, Math.round((produced / netToProduce) * 100)) : 0;

  return {
    skuId: String(sku._id),
    skuCode: sku.code,
    skuName: sku.name,
    category: sku.category || '',
    planId: plan ? String(plan._id) : null,
    openBalance,
    fgStock: plan?.fgStock || 0,
    openingWip: plan?.openingWip || 0,
    bufferPct: plan?.bufferPct ?? 3,
    netToProduce,
    produced,
    balance,
    todayTarget,
    todayProduced,
    targetToDate,
    achievementPct,
    status,
    wip: {
      cutting: wip.cutting || 0, drawing: wip.drawing || 0, buffing: wip.buffing || 0,
      finishing: wip.finishing || 0, packing: wip.packing || 0,
    },
    wipTotal,
    days: days
      .map((d) => ({ date: d.date, targetQty: d.targetQty || 0, producedQty: d.producedQty || 0 }))
      .sort((a, b) => new Date(a.date) - new Date(b.date)),
  };
};

// ── Public API ───────────────────────────────────────────────────────

// The Production Board: one row per FG SKU that has demand or a plan, + KPIs.
export const getBoard = async ({ year, month }) => {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) throw new AppError('year and month are required', 422);

  const [demand, plans, fgSkus] = await Promise.all([
    computeDemand(),
    ProductionPlan.find({ periodYear: y, periodMonth: m }).lean(),
    SKU.find({ itemType: 'FINISHED_GOOD', isDeleted: { $ne: true } })
      .select('_id code name category').lean(),
  ]);

  const planBySku = new Map(plans.map((p) => [String(p.skuId), p]));
  const today = dayjs().startOf('day');

  const rows = [];
  for (const sku of fgSkus) {
    const d = demand.get(sku.code);
    const plan = planBySku.get(String(sku._id));
    const openBalance = d ? d.openQty : 0;
    if (!plan && openBalance <= 0) continue; // nothing to do for this SKU
    rows.push(buildRow(sku, openBalance, plan, today));
  }
  rows.sort((a, b) => b.balance - a.balance || b.openBalance - a.openBalance);

  const sum = (key) => rows.reduce((s, r) => s + (r[key] || 0), 0);
  const kpis = {
    skuCount:       rows.length,
    plannedCount:   rows.filter((r) => r.planId).length,
    unplannedCount: rows.filter((r) => !r.planId).length,
    totalToProduce: sum('netToProduce'),
    totalProduced:  sum('produced'),
    totalBalance:   sum('balance'),
    behindCount:    rows.filter((r) => r.status === 'BEHIND').length,
    doneCount:      rows.filter((r) => r.status === 'DONE').length,
    todayTarget:    sum('todayTarget'),
    todayProduced:  sum('todayProduced'),
    totalWip:       sum('wipTotal'),
  };

  return { period: { year: y, month: m }, rows, kpis };
};

// Auto-create plans for every FG SKU that has open demand but no plan yet.
export const generatePlans = async ({ year, month }, userId) => {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) throw new AppError('year and month are required', 422);

  const [demand, fgSkus, existing] = await Promise.all([
    computeDemand(),
    SKU.find({ itemType: 'FINISHED_GOOD', isDeleted: { $ne: true } })
      .select('_id code name category').lean(),
    ProductionPlan.find({ periodYear: y, periodMonth: m }).select('skuId').lean(),
  ]);
  const planned = new Set(existing.map((p) => String(p.skuId)));

  let created = 0;
  for (const sku of fgSkus) {
    if (planned.has(String(sku._id))) continue;       // never clobber an existing plan
    const openQty = demand.get(sku.code)?.openQty || 0;
    if (openQty <= 0) continue;

    const bufferPct = 3;
    const netToProduce = computeNet(openQty, 0, 0, bufferPct);
    await ProductionPlan.create({
      skuId: sku._id, skuCode: sku.code, skuName: sku.name, category: sku.category || '',
      periodYear: y, periodMonth: m,
      fgStock: 0, openingWip: 0, bufferPct,
      openOrderQtyAtPlan: openQty, netToProduce,
      days: buildDays(y, m, netToProduce),
      createdBy: userId, updatedBy: userId,
    });
    created += 1;
  }
  return { created };
};

// Update a plan's demand inputs and/or daily targets; recomputes netToProduce.
export const updatePlan = async (id, patch, userId) => {
  const plan = await ProductionPlan.findById(id);
  if (!plan) throw new AppError('Production plan not found', 404);

  if (patch.fgStock != null)    plan.fgStock = Math.max(0, Number(patch.fgStock));
  if (patch.openingWip != null) plan.openingWip = Math.max(0, Number(patch.openingWip));
  if (patch.bufferPct != null)  plan.bufferPct = Math.max(0, Math.min(50, Number(patch.bufferPct)));
  if (patch.status && ['ACTIVE', 'DONE', 'ON_HOLD'].includes(patch.status)) plan.status = patch.status;

  if (Array.isArray(patch.days)) {
    for (const dp of patch.days) {
      const key = dayjs(dp.date).startOf('day');
      if (!key.isValid()) continue;
      let day = plan.days.find((d) => dayjs(d.date).isSame(key, 'day'));
      if (!day) {
        day = { date: key.toDate(), targetQty: 0, producedQty: 0 };
        plan.days.push(day);
      }
      if (dp.targetQty != null)   day.targetQty = Math.max(0, Number(dp.targetQty));
      if (dp.producedQty != null) day.producedQty = Math.max(0, Number(dp.producedQty));
    }
    plan.markModified('days');
  }

  // Refresh demand snapshot against live open orders, then recompute target.
  const demand = await computeDemand();
  plan.openOrderQtyAtPlan = demand.get(plan.skuCode)?.openQty ?? plan.openOrderQtyAtPlan;
  plan.netToProduce = computeNet(plan.openOrderQtyAtPlan, plan.fgStock, plan.openingWip, plan.bufferPct);

  plan.updatedBy = userId;
  await plan.save();
  return plan.toObject();
};

// Record what the floor produced on a given date (one entry per plan).
export const recordDailyProduction = async ({ date, entries }, userId) => {
  const key = dayjs(date).startOf('day');
  if (!key.isValid()) throw new AppError('A valid date is required', 422);
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new AppError('At least one production entry is required', 422);
  }

  let updated = 0;
  for (const e of entries) {
    const plan = await ProductionPlan.findById(e.planId);
    if (!plan) continue;
    let day = plan.days.find((d) => dayjs(d.date).isSame(key, 'day'));
    if (!day) {
      day = { date: key.toDate(), targetQty: 0, producedQty: 0 };
      plan.days.push(day);
    }
    day.producedQty = Math.max(0, Number(e.producedQty || 0));
    if (e.note != null) day.note = String(e.note);

    const produced = plan.days.reduce((s, d) => s + (d.producedQty || 0), 0);
    if (plan.netToProduce > 0 && produced >= plan.netToProduce) plan.status = 'DONE';
    else if (plan.status === 'DONE') plan.status = 'ACTIVE';

    plan.markModified('days');
    plan.updatedBy = userId;
    await plan.save();
    updated += 1;
  }
  return { updated };
};

// Move a quantity between shop-floor stages.
//   from: 'start' (feed the first stage) | a stage key
//   to:   a stage key | 'done' (counts as produced today)
export const moveWip = async ({ planId, from, to, qty }, userId) => {
  const n = Math.max(0, Math.round(Number(qty || 0)));
  if (n <= 0) throw new AppError('Quantity must be greater than zero', 422);

  const plan = await ProductionPlan.findById(planId);
  if (!plan) throw new AppError('Production plan not found', 404);

  if (from !== 'start') {
    if (!PPC_STAGES.includes(from)) throw new AppError('Invalid source stage', 422);
    plan.wip[from] = Math.max(0, (plan.wip[from] || 0) - n);
  }

  if (to === 'done') {
    const key = dayjs().startOf('day');
    let day = plan.days.find((d) => dayjs(d.date).isSame(key, 'day'));
    if (!day) {
      day = { date: key.toDate(), targetQty: 0, producedQty: 0 };
      plan.days.push(day);
    }
    day.producedQty = Math.max(0, (day.producedQty || 0) + n);
    plan.markModified('days');
    const produced = plan.days.reduce((s, d) => s + (d.producedQty || 0), 0);
    if (plan.netToProduce > 0 && produced >= plan.netToProduce) plan.status = 'DONE';
  } else {
    if (!PPC_STAGES.includes(to)) throw new AppError('Invalid destination stage', 422);
    plan.wip[to] = Math.max(0, (plan.wip[to] || 0) + n);
  }

  plan.markModified('wip');
  plan.updatedBy = userId;
  await plan.save();
  return plan.toObject();
};
