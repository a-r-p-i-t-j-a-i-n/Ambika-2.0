/**
 * DPR service — create / edit / list DPR rows and derive every dashboard from
 * them. On every save the entry is enriched from the masters (machine type,
 * SPM/cavity from the Process Route, SKU id) and its OEE block is recomputed by
 * oee.service, so the stored numbers can never drift from the inputs.
 *
 * Dashboards aggregate with PROPER weighting — OEE ratios are never averaged
 * naively. Availability = Σ run-time / Σ net-available, Performance = Σ earned
 * minutes / Σ run-time, Quality = Σ good / Σ produced, and OEE is their product.
 */
import mongoose from 'mongoose';
import DprEntry from './dpr.model.js';
import Machine from '../masters/machines/machine.model.js';
import Operator from '../masters/machine-operators/machineOperator.model.js';
import ProcessRoute from './processRoute.model.js';
import SKU from '../skus/sku.model.js';
import { computeOee, minutesBetween } from './oee.service.js';
import { AppError } from '../../utils/apiResponse.js';

const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const IST_OFFSET = '+05:30';
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// A DPR "day" is an IST calendar day; store it at IST-noon so it never slips a
// day when read back in any timezone.
const toDprDate = (d) => {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  const ymd = String(d).slice(0, 10);
  return new Date(`${ymd}T12:00:00.000${IST_OFFSET}`);
};

// ── Weighted-metric projection shared by every dashboard grouping ──────────────
// Given a group that has summed the raw quantities/minutes, derive the ratios.
const METRIC_PROJECT = {
  entries: 1,
  productionQty: { $round: ['$productionQty', 0] },
  goodQty: { $round: ['$goodQty', 0] },
  rejectQty: { $round: ['$rejectQty', 0] },
  reworkQty: { $round: ['$reworkQty', 0] },
  strokes: { $round: ['$strokes', 0] },
  availableMinutes: { $round: ['$availableMinutes', 0] },
  netAvailable: { $round: ['$netAvailable', 0] },
  runTime: { $round: ['$runTime', 0] },
  plannedTotal: { $round: ['$plannedTotal', 0] },
  downtimeTotal: { $round: ['$downtimeTotal', 0] },
  productionValue: { $round: ['$productionValue', 2] },
  rmConsumedKg: { $round: ['$rmConsumedKg', 2] },
  availability: { $cond: [{ $gt: ['$netAvailable', 0] }, { $divide: ['$runTime', '$netAvailable'] }, 0] },
  performance: { $cond: [{ $gt: ['$runTime', 0] }, { $divide: ['$earnedMinutes', '$runTime'] }, 0] },
  quality: { $cond: [{ $gt: ['$productionQty', 0] }, { $divide: ['$goodQty', '$productionQty'] }, 0] },
  machineEff: { $cond: [{ $gt: ['$netAvailable', 0] }, { $divide: ['$earnedMinutes', '$netAvailable'] }, 0] },
  rejectPpm: { $cond: [{ $gt: ['$productionQty', 0] }, { $multiply: [{ $divide: ['$rejectQty', '$productionQty'] }, 1e6] }, 0] },
};

// The $group accumulators every dashboard shares (id is supplied per call).
const groupAccumulators = (idExpr) => ({
  _id: idExpr,
  entries: { $sum: 1 },
  productionQty: { $sum: '$oee.productionQty' },
  goodQty: { $sum: '$oee.goodQty' },
  rejectQty: { $sum: '$oee.rejectQty' },
  reworkQty: { $sum: '$oee.reworkQty' },
  strokes: { $sum: '$strokes' },
  availableMinutes: { $sum: '$availableMinutes' },
  netAvailable: { $sum: '$oee.netAvailable' },
  runTime: { $sum: '$oee.runTime' },
  plannedTotal: { $sum: '$oee.plannedTotal' },
  downtimeTotal: { $sum: '$oee.downtimeTotal' },
  productionValue: { $sum: '$oee.productionValue' },
  rmConsumedKg: { $sum: '$rmConsumedKg' },
  earnedMinutes: { $sum: { $multiply: ['$oee.productionQty', '$oee.stdCycleMin'] } },
});

// Clamp + round the derived ratios into clean percentages after projection (JS
// side, so the pipeline stays readable).
const finishRow = (r) => {
  const clamp01 = (v) => Math.min(1, Math.max(0, num(v)));
  const pct = (v) => Math.round(clamp01(v) * 1000) / 10; // 1 dp %
  // Availability × Performance × Quality — Performance capped at 100% so a
  // weighted roll-up decomposes the same way a single entry does.
  const a = clamp01(r.availability);
  const p = clamp01(r.performance);
  const qy = clamp01(r.quality);
  return {
    ...r,
    availabilityPct: pct(r.availability),
    performancePct: pct(r.performance),
    qualityPct: pct(r.quality),
    machineEffPct: Math.round(a * p * 1000) / 10,
    oeePct: Math.round(a * p * qy * 1000) / 10,
    rejectPpm: Math.round(num(r.rejectPpm)),
  };
};

export const dprService = {
  // ── Enrichment: fill machine/operator/sku/operation from the masters ────────
  async _enrich(payload) {
    const skuCode = String(payload.skuCode || '').toUpperCase();
    const machineCode = String(payload.machineCode || '').toUpperCase();

    const [machine, route, sku, operator] = await Promise.all([
      machineCode ? Machine.findOne({ code: machineCode }).lean() : null,
      skuCode && payload.operationNo != null
        ? ProcessRoute.findOne({ skuCode, operationNo: Number(payload.operationNo) }).lean()
        : null,
      skuCode ? SKU.findOne({ code: skuCode }).select('_id name sellingPrice').lean() : null,
      payload.operatorName
        ? Operator.findOne({ name: rx(`^${payload.operatorName}$`) }).lean()
        : null,
    ]);

    // SPM / cavity / part-rate: explicit payload wins, else the routing, else 0/1.
    const spm = payload.spm != null ? num(payload.spm) : num(route?.spm);
    const cavity = payload.cavity != null ? num(payload.cavity) || 1 : (num(route?.cavity) || 1);
    const partRate = payload.partRate != null ? num(payload.partRate)
      : (num(route?.partRate) || num(sku?.sellingPrice) || 0);

    return {
      machineId: machine?._id,
      machineType: payload.machineType || machine?.machineType || route?.machineType || '',
      operatorId: operator?._id,
      skuId: sku?._id,
      skuName: payload.skuName || route?.skuName || sku?.name || '',
      operationName: payload.operationName || route?.operationName || '',
      operationLabel: payload.operationLabel || route?.operationLabel
        || (route ? `${route.operationNo} - ${route.operationName}` : ''),
      isLastOperation: payload.isLastOperation != null ? !!payload.isLastOperation : !!route?.isLastOperation,
      spm, cavity, partRate,
    };
  },

  // Normalise the reason/defect/hourly arrays: keep only non-zero rows.
  _cleanArrays(payload) {
    const hourly = (payload.hourly || []).filter((h) => num(h.qty) > 0)
      .map((h) => ({ slot: h.slot, qty: num(h.qty) }));
    const plannedItems = (payload.plannedItems || []).filter((x) => num(x.minutes) > 0)
      .map((x) => ({ reason: x.reason, minutes: num(x.minutes) }));
    const downtimeItems = (payload.downtimeItems || []).filter((x) => num(x.minutes) > 0)
      .map((x) => ({ reason: x.reason, minutes: num(x.minutes) }));
    const defectItems = (payload.defectItems || []).filter((x) => num(x.qty) > 0)
      .map((x) => ({ type: x.type, qty: num(x.qty) }));
    return { hourly, plannedItems, downtimeItems, defectItems };
  },

  async _build(payload) {
    const enriched = await this._enrich(payload);
    const arrays = this._cleanArrays(payload);
    const availableMinutes = payload.availableMinutes != null
      ? num(payload.availableMinutes)
      : minutesBetween(payload.startTime, payload.stopTime);

    const oee = computeOee({
      ...arrays,
      reworkQty: num(payload.reworkQty),
      availableMinutes,
      startTime: payload.startTime,
      stopTime: payload.stopTime,
      spm: enriched.spm,
      cavity: enriched.cavity,
      partRate: enriched.partRate,
    });

    return {
      date: toDprDate(payload.date),
      shift: payload.shift || 'A',
      machineCode: String(payload.machineCode || '').toUpperCase(),
      machineId: enriched.machineId,
      machineType: enriched.machineType,
      operatorName: payload.operatorName || '',
      operatorId: enriched.operatorId,
      skuCode: String(payload.skuCode || '').toUpperCase(),
      skuName: enriched.skuName,
      skuId: enriched.skuId,
      operationNo: num(payload.operationNo),
      operationName: enriched.operationName,
      operationLabel: enriched.operationLabel,
      isLastOperation: enriched.isLastOperation,
      dieNo: payload.dieNo || '',
      coilNo: payload.coilNo || '',
      circleSize: payload.circleSize || '',
      startTime: payload.startTime || '',
      stopTime: payload.stopTime || '',
      availableMinutes,
      ...arrays,
      strokes: num(payload.strokes),
      toolBreakdownMinutes: num(payload.toolBreakdownMinutes),
      reworkQty: num(payload.reworkQty),
      spm: enriched.spm,
      cavity: enriched.cavity,
      rmConsumedKg: num(payload.rmConsumedKg),
      circleWeightKg: num(payload.circleWeightKg),
      materialGrade: payload.materialGrade || '',
      remarks: payload.remarks || '',
      oee,
    };
  },

  async create(payload, user) {
    if (!payload.machineCode) throw new AppError('Machine is required.', 400);
    if (!payload.skuCode) throw new AppError('SKU is required.', 400);
    const doc = await this._build(payload);
    const created = await DprEntry.create({ ...doc, createdBy: user?._id, updatedBy: user?._id });
    return created.toObject();
  },

  async update(id, payload, user) {
    const existing = await DprEntry.findById(id).lean();
    if (!existing || existing.isDeleted) throw new AppError('DPR entry not found', 404);
    // Merge existing + patch so a partial edit still recomputes OEE correctly.
    const merged = { ...existing, ...payload };
    const doc = await this._build(merged);
    const updated = await DprEntry.findByIdAndUpdate(
      id, { $set: { ...doc, updatedBy: user?._id } }, { new: true, runValidators: true },
    ).lean();
    return updated;
  },

  async remove(id) {
    const doc = await DprEntry.findByIdAndUpdate(id, { $set: { isDeleted: true } }, { new: true }).lean();
    if (!doc) throw new AppError('DPR entry not found', 404);
    return { _id: id, deleted: true };
  },

  async getById(id) {
    const doc = await DprEntry.findById(id).lean();
    if (!doc || doc.isDeleted) throw new AppError('DPR entry not found', 404);
    return doc;
  },

  // ── Register: the filterable list of raw DPR rows ───────────────────────────
  _dateMatch(query) {
    const m = { isDeleted: { $ne: true } };
    if (query.from || query.to) {
      m.date = {};
      if (query.from) m.date.$gte = new Date(`${String(query.from).slice(0, 10)}T00:00:00.000${IST_OFFSET}`);
      if (query.to) m.date.$lte = new Date(`${String(query.to).slice(0, 10)}T23:59:59.999${IST_OFFSET}`);
    }
    if (query.machineCode) m.machineCode = String(query.machineCode).toUpperCase();
    if (query.operatorName) m.operatorName = query.operatorName;
    if (query.skuCode) m.skuCode = String(query.skuCode).toUpperCase();
    if (query.shift) m.shift = query.shift;
    return m;
  },

  async list(query = {}) {
    const filter = this._dateMatch(query);
    if (query.search) {
      const r = rx(query.search);
      filter.$or = [{ machineCode: r }, { operatorName: r }, { skuCode: r }, { skuName: r }, { operationName: r }, { dieNo: r }];
    }
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Number(query.limit) || 50, 1000);
    const [docs, total] = await Promise.all([
      DprEntry.find(filter).sort({ date: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      DprEntry.countDocuments(filter),
    ]);
    // A compact roll-up of the filtered set for the register header.
    const [summary] = await DprEntry.aggregate([
      { $match: filter },
      { $group: groupAccumulators(null) },
      { $project: METRIC_PROJECT },
    ]);
    return {
      docs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      summary: summary ? finishRow(summary) : null,
    };
  },

  // ── Generic grouped aggregation used by the dashboards ──────────────────────
  async _groupBy(match, idExpr, extra = {}) {
    const rows = await DprEntry.aggregate([
      { $match: match },
      { $group: { ...groupAccumulators(idExpr), ...extra } },
      { $project: { ...METRIC_PROJECT, ...Object.keys(extra).reduce((a, k) => ({ ...a, [k]: 1 }), {}) } },
      { $sort: { productionQty: -1 } },
    ]);
    return rows.map(finishRow);
  },

  async _overall(match) {
    const [row] = await DprEntry.aggregate([
      { $match: match },
      { $group: groupAccumulators(null) },
      { $project: METRIC_PROJECT },
    ]);
    return row ? finishRow(row) : {
      entries: 0, productionQty: 0, goodQty: 0, rejectQty: 0, reworkQty: 0,
      availableMinutes: 0, netAvailable: 0, runTime: 0, downtimeTotal: 0, plannedTotal: 0,
      productionValue: 0, availabilityPct: 0, performancePct: 0, qualityPct: 0, machineEffPct: 0, oeePct: 0, rejectPpm: 0,
    };
  },

  async _trend(match) {
    const rows = await DprEntry.aggregate([
      { $match: match },
      { $group: groupAccumulators({ $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: 'Asia/Kolkata' } }) },
      { $project: METRIC_PROJECT },
      { $sort: { _id: 1 } },
    ]);
    return rows.map((r) => ({ date: r._id, ...finishRow(r) }));
  },

  // Pareto of an unwound reason/defect array (minutes or qty).
  async _pareto(match, arrayField, keyField, valueField) {
    const rows = await DprEntry.aggregate([
      { $match: match },
      { $unwind: `$${arrayField}` },
      { $group: { _id: `$${arrayField}.${keyField}`, value: { $sum: `$${arrayField}.${valueField}` }, count: { $sum: 1 } } },
      { $sort: { value: -1 } },
      { $limit: 20 },
    ]);
    return rows.map((r) => ({ key: r._id, value: Math.round(r.value), count: r.count }));
  },

  // ── Machine dashboard ───────────────────────────────────────────────────────
  async machineDashboard(query = {}) {
    const match = this._dateMatch(query);
    const [summary, byMachine, downtimePareto, trend] = await Promise.all([
      this._overall(match),
      this._groupBy(match, '$machineCode'),
      this._pareto(match, 'downtimeItems', 'reason', 'minutes'),
      this._trend(match),
    ]);
    return {
      summary,
      machines: byMachine.map((r) => ({ machineCode: r._id, ...r })),
      downtimePareto,
      trend,
    };
  },

  // ── Production dashboard ─────────────────────────────────────────────────────
  async productionDashboard(query = {}) {
    const match = this._dateMatch(query);
    const [summary, bySku, byOperation, defectPareto, trend] = await Promise.all([
      this._overall(match),
      this._groupBy(match, { skuCode: '$skuCode', skuName: '$skuName' }),
      this._groupBy(match, '$operationLabel'),
      this._pareto(match, 'defectItems', 'type', 'qty'),
      this._trend(match),
    ]);
    return {
      summary,
      bySku: bySku.map((r) => ({ skuCode: r._id.skuCode, skuName: r._id.skuName, ...r })),
      byOperation: byOperation.map((r) => ({ operation: r._id || '—', ...r })),
      defectPareto,
      trend,
    };
  },

  // ── Operator efficiency dashboard ────────────────────────────────────────────
  async operatorDashboard(query = {}) {
    const match = { ...this._dateMatch(query), operatorName: { $nin: ['', null] } };
    if (query.operatorName) match.operatorName = query.operatorName;
    const [summary, byOperator, trend] = await Promise.all([
      this._overall(match),
      this._groupBy(match, '$operatorName'),
      this._trend(match),
    ]);
    return {
      summary,
      operators: byOperator
        .map((r) => ({ operatorName: r._id || '—', ...r }))
        .sort((a, b) => b.oeePct - a.oeePct),
      trend,
    };
  },

  // ── MIS scoring — operator + machine leaderboards ranked by a composite score ─
  async misScoring(query = {}) {
    const match = this._dateMatch(query);
    const [summary, byOperator, byMachine, bySku] = await Promise.all([
      this._overall(match),
      this._groupBy({ ...match, operatorName: { $nin: ['', null] } }, '$operatorName'),
      this._groupBy(match, '$machineCode'),
      this._groupBy(match, { skuCode: '$skuCode', skuName: '$skuName' }),
    ]);

    // MIS score = the composite OEE %, but only entities with a meaningful sample
    // (≥1 entry and some run time) are ranked so a single idle row can't top it.
    const score = (r) => Math.round(r.oeePct * 10) / 10;
    const rankable = (r) => r.entries > 0 && r.netAvailable > 0;

    const operators = byOperator.filter(rankable)
      .map((r) => ({ name: r._id || '—', score: score(r), ...r }))
      .sort((a, b) => b.score - a.score)
      .map((r, i) => ({ rank: i + 1, ...r }));

    const machines = byMachine.filter(rankable)
      .map((r) => ({ machineCode: r._id, score: score(r), ...r }))
      .sort((a, b) => b.score - a.score)
      .map((r, i) => ({ rank: i + 1, ...r }));

    return {
      summary,
      operators,
      machines,
      skus: bySku.map((r) => ({ skuCode: r._id.skuCode, skuName: r._id.skuName, score: score(r), ...r })),
    };
  },
};

export default dprService;
