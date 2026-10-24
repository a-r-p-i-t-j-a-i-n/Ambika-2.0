import mongoose from 'mongoose';
import InventoryPolicy from './inventoryPolicy.model.js';
import InventoryStock, { DEFAULT_WAREHOUSE } from './inventoryStock.model.js';
import InventoryMovement, { MOVEMENT_TYPE, TXN_TYPE } from './inventoryMovement.model.js';
import { inventoryService, combineStockRows, stockBySkuId } from './inventory.service.js';
import { awaitingQcBySku } from './awaitingQc.service.js';
import { projectStockSeries, AWAITING_QC_DAY } from './stockProjection.js';
import SKU, { CP_IMS_ITEM_TYPES } from '../skus/sku.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import {
  checkSafetyFactor, checkStockInReason, STOCK_IN_REASONS,
  checkStockOutReason, STOCK_OUT_REASONS,
} from './ims.validation.js';

/**
 * IMS service — the Packaging & Consumables Inventory layer on top of the core
 * stock engine (inventory.service). It joins SKU + InventoryPolicy +
 * InventoryStock into a single planning view, computes reorder/forecast, and
 * exposes multi-line Stock-In (receipt) and Stock-Out (issue) that reuse the
 * same ledger so on-hand always reconciles with the movements.
 */

// Item types this IMS covers (consumables & packaging) — the same list the GRN
// routes to this module (see inventoryDestinationOf in sku.model.js).
export const IMS_ITEM_TYPES = CP_IMS_ITEM_TYPES;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

// The client lives and reports in IST, so the day a movement "belongs to" (and
// every dated column in their Excel) is bucketed on the India calendar, not UTC.
const IST_TZ = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';
/** 'YYYY-MM-DD' for a Date, on the IST calendar. */
const istDayKey = (date) => new Date(date).toLocaleDateString('en-CA', { timeZone: IST_TZ });
/** Shift a 'YYYY-MM-DD' calendar string by n days (pure calendar math, TZ-free). */
const shiftDay = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// The two consumption figures the stock list shows side by side. BOTH are now
// measured from the CONSUME_OUT ledger — neither is a typed-in planning number:
//
//   Average Daily Consumption (ADC)  last 90 IST days of consumption ÷ 90
//   Daily Consumption               what was actually issued TODAY
//
// They answer different questions (the steady rate vs. what happened today), so
// they are computed by two separate aggregations and must never be conflated.
const CONSUMPTION_WINDOW_DAYS = 90;

/**
 * Lead Time for a Consumables item that has no Inventory Policy of its own.
 *
 * Consumables-only, and deliberately a constant rather than a fallback off the
 * SKU master. The default used to be written `sku.leadDays ?? 16`, which never
 * produced 16: SKU.leadDays carries its own model default of 7, so the nullish
 * fallback was satisfied every time and every unplanned item planned on 7 days.
 * All 180 Consumables SKUs hold exactly 7 and none leave the field unset, so
 * the 16 was unreachable.
 *
 * 16 is the stated business lead time for Consumables (indent → receipt) and is
 * what the policy model, the Policy drawer's pre-fill and the field help have
 * always said the default is.
 *
 * Scope: Consumables only. Raw Material keeps its own fallback and Finished
 * Goods deliberately defaults to 7 (production lead time, a different thing),
 * so neither is touched and neither should read this constant.
 */
export const CONSUMABLES_DEFAULT_LEAD_DAYS = 16;

/**
 * ADC from a 90-day consumption bucket: total ÷ 90, rounded to 2dp like every
 * other IMS figure. No bucket (nothing consumed in the window) means 0 — it
 * never falls back to the stored policy value, and never borrows today's number.
 */
const adcFrom = (bucket) => round2((bucket?.qty || 0) / CONSUMPTION_WINDOW_DAYS);

// How far a legacy stored maxLevel may sit from the formula and still be read as
// formula-derived. The client's sheet holds ADC×lead×SF rounded to whole units
// (2.8 × 16 × 1.5 = 67.2 was typed as 67), so whole-unit rounding must not be
// mistaken for a deliberate override.
const MAX_LEVEL_MATCH_TOLERANCE = 0.02; // 2%, floored at 1 unit

/**
 * Work out the order-up-to (Max) level for a policy, and say where it came from.
 *
 * Max Level = Average Daily Consumption × Lead Time × Safety Factor — that is the
 * approved rule, and it must stay live so editing the Safety Factor for a SKU
 * actually moves that SKU's Max Level, Safety Stock and suggested order qty.
 *
 * A stored maxLevel only wins when it is a genuine manual override:
 *   • maxLevelMode === 'MANUAL' (and a positive value) — set explicitly from the
 *     Policy drawer. Authoritative, never second-guessed.
 *   • maxLevelMode === 'AUTO' — the formula, whatever is stored.
 *   • no maxLevelMode at all (rows written before the flag existed) — inferred:
 *     a stored value that still matches ADC×lead×SF within rounding was clearly
 *     the sheet's own calculated column, so it is treated as formula-derived;
 *     anything else (e.g. a max level set against a zero ADC) is kept as a
 *     manual override. Nothing is rewritten on disk — the inference is read-only,
 *     so no data migration is needed either way.
 *
 * @returns {{maxLevel:number, formulaMaxLevel:number, storedMaxLevel:number,
 *            maxLevelMode:'AUTO'|'MANUAL', maxLevelInferred:boolean}}
 */
export const resolveMaxLevel = (policy = {}, adcOverride) => {
  // ADC is measured, not stored. Callers pass the calculated 90-day figure; the
  // stored policy value is only a fallback for legacy callers that have none.
  const adc = adcOverride === undefined
    ? Number(policy.averageDailyConsumption || 0)
    : Number(adcOverride) || 0;
  const leadDays = Number(policy.leadDays || 0);
  const safetyFactor = Number(policy.safetyFactor || 1.5);
  const formulaMaxLevel = round2(adc * leadDays * safetyFactor);
  const storedMaxLevel = round2(policy.maxLevel || 0);
  const auto = { maxLevel: formulaMaxLevel, formulaMaxLevel, storedMaxLevel };

  const mode = policy.maxLevelMode;
  // An explicit MANUAL with nothing stored would zero out the max level and
  // break the status thresholds, so it falls back to the formula.
  if (mode === 'MANUAL' && storedMaxLevel > 0) {
    return { ...auto, maxLevel: storedMaxLevel, maxLevelMode: 'MANUAL', maxLevelInferred: false };
  }
  if (mode === 'AUTO' || mode === 'MANUAL') {
    return { ...auto, maxLevelMode: 'AUTO', maxLevelInferred: false };
  }

  // Legacy row — no flag. Infer, without touching the stored value.
  if (storedMaxLevel <= 0) return { ...auto, maxLevelMode: 'AUTO', maxLevelInferred: true };
  const slack = Math.max(1, formulaMaxLevel * MAX_LEVEL_MATCH_TOLERANCE);
  const matchesFormula = formulaMaxLevel > 0 && Math.abs(storedMaxLevel - formulaMaxLevel) <= slack;
  return matchesFormula
    ? { ...auto, maxLevelMode: 'AUTO', maxLevelInferred: true }
    : { ...auto, maxLevel: storedMaxLevel, maxLevelMode: 'MANUAL', maxLevelInferred: true };
};

/**
 * The policy an item is planned with when it has none of its own.
 *
 * Defined once, because the stock list built these defaults inline while the
 * forecast and the stock card passed `policy || {}` — so an item with no policy
 * showed a Lead Time of 7 days on one screen and 0 on the next. Every read path
 * now starts from the same row.
 */
// `sku` is still accepted so every existing call site is unchanged, but the
// Lead Time no longer comes from it — see CONSUMABLES_DEFAULT_LEAD_DAYS.
const imsPolicyOrDefaults = (policy, sku = {}) => policy || {
  averageDailyConsumption: 0, leadDays: CONSUMABLES_DEFAULT_LEAD_DAYS, safetyFactor: 1.5,
  moq: 0, maxLevel: 0, maxLevelMode: 'AUTO', materialInTransit: 0, openingStock: 0, convertedItemName: '',
};

/**
 * Stock status from on-hand + in-transit vs the policy thresholds.
 * `awaitingQc` is the Awaiting QC row from awaitingQc.service (or null).
 */
const deriveMetrics = (policy = {}, stock = {}, calculatedAdc = 0, awaitingQcRow = null) => {
  // ADC is the MEASURED 90-day rate supplied by the caller, never
  // policy.averageDailyConsumption. That stored column is kept on the model for
  // backward compatibility but no longer drives anything IMS shows or computes.
  const adc = round2(Number(calculatedAdc) || 0);
  const leadDays = Number(policy.leadDays || 0);
  const safetyFactor = Number(policy.safetyFactor || 1.5);
  const inTransit = Number(policy.materialInTransit || 0);
  const onHand = round2(stock.qtyOnHand || 0);

  const leadTimeDemand = round2(adc * leadDays);                 // qty consumed over a lead time
  // Order-up-to / max level — ADC×lead×SF unless a genuine manual override exists.
  const { maxLevel, formulaMaxLevel, storedMaxLevel, maxLevelMode, maxLevelInferred } = resolveMaxLevel(policy, adc);
  const safetyStock = round2(Math.max(0, maxLevel - leadTimeDemand)); // the buffer above lead demand
  // Reorder point is lead-time demand only — deliberately free of the Safety
  // Factor, so changing the SF never moves "Reorder at".
  const reorderPoint = leadTimeDemand;                            // reorder when cover ≤ lead time
  // Received on a completed GRN, QC not completed yet: not usable (never in
  // onHand) but still coming — pipeline stock for the reorder decision, like
  // in-transit. Before QC-gated posting this qty sat in onHand, so planning is unchanged.
  const awaitingQc = round2(awaitingQcRow?.qty || 0);
  const projectedAvailable = round2(onHand + inTransit + awaitingQc);
  const daysCover = adc > 0 ? round2(onHand / adc) : null;        // null = no consumption set

  let status = 'OK';
  if (onHand <= 0) status = 'OUT_OF_STOCK';
  else if (projectedAvailable <= reorderPoint) status = 'REORDER';
  else if (maxLevel > 0 && onHand > maxLevel * 1.25) status = 'OVERSTOCK';
  else if (adc > 0 && projectedAvailable <= safetyStock + reorderPoint && projectedAvailable > reorderPoint) status = 'LOW';

  // Suggested order to refill to max level (respect MOQ).
  let suggestedOrderQty = round2(Math.max(0, maxLevel - projectedAvailable));
  const moq = Number(policy.moq || 0);
  if (suggestedOrderQty > 0 && moq > 0 && suggestedOrderQty < moq) suggestedOrderQty = moq;

  return {
    onHand, inTransit, adc, leadDays, safetyFactor,
    awaitingQc, awaitingQcGrnNumbers: awaitingQcRow?.grnNumbers || [],
    leadTimeDemand, safetyStock, reorderPoint, maxLevel,
    // Max-level provenance, so the UI can say when the Safety Factor is being
    // overruled instead of silently showing a number the formula did not make.
    formulaMaxLevel, storedMaxLevel, maxLevelMode, maxLevelInferred,
    projectedAvailable, daysCover, status, suggestedOrderQty,
    avgCost: round2(stock.avgCost || 0),
    stockValue: round2((stock.qtyOnHand || 0) * (stock.avgCost || 0)),
  };
};

export const imsService = {
  IMS_ITEM_TYPES,

  /**
   * Measured consumption per SKU over the last 90 IST calendar days — the input
   * to Average Daily Consumption (ADC = this total ÷ 90).
   *
   * Kept deliberately separate from _todayConsumptionBySku: the two have
   * different semantics (steady rate vs. what happened today) and are shown as
   * two different columns, so folding them into one aggregation would couple
   * numbers that must be free to disagree.
   *
   * ONE aggregation for the whole page — never a query per row. Same qualifying
   * rule as today's figure: only txnType CONSUME_OUT on movementType OUT, so
   * TRANSFER_OUT, QC_REJECT_OUT, RETURN_OUT, DISPATCH_OUT, ADJUST_OUT,
   * CONVERT_OUT and every IN movement are excluded.
   *
   * A SKU with no qualifying movement in the window is ABSENT from the map, and
   * the caller reads that as ADC 0 — never as "fall back to the stored value".
   *
   * @returns {Promise<Map<string, {qty:number, events:number}>>} keyed by String(skuId)
   */
  async _consumptionBySku90d(skuIds = []) {
    if (!skuIds.length) return new Map();
    // Start at 00:00 IST, 89 days back, so the window spans 90 IST calendar days
    // inclusive of today — the same day-bucketing getStockHistory uses.
    const fromKey = shiftDay(istDayKey(new Date()), -(CONSUMPTION_WINDOW_DAYS - 1));
    const fromStart = new Date(`${fromKey}T00:00:00.000${IST_OFFSET}`);

    const rows = await InventoryMovement.aggregate([
      {
        $match: {
          skuId: { $in: skuIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
          movementType: MOVEMENT_TYPE.OUT,
          txnType: TXN_TYPE.CONSUME_OUT,
          isDeleted: { $ne: true },
          movementDate: { $gte: fromStart },
        },
      },
      { $group: { _id: '$skuId', qty: { $sum: '$quantity' }, events: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), { qty: round2(r.qty), events: r.events }]));
  },

  /** ADC for one SKU, for the single-item endpoints. Same rule, same window. */
  async _adcForSku(skuId) {
    const map = await this._consumptionBySku90d([skuId]);
    return adcFrom(map.get(String(skuId)));
  },

  /**
   * TODAY'S actual consumption per SKU — the sum of today's CONSUME_OUT
   * quantities, not an average over any window.
   *
   * "Today" is the IST calendar day, because the client lives and reports in
   * IST: the window is [today 00:00 IST, tomorrow 00:00 IST), which is the same
   * day-bucketing getStockHistory uses. A movement posted at 23:30 IST belongs
   * to today even though it is already tomorrow in UTC.
   *
   * Several issues on the same day sum into one figure — 10 at 10am + 5 at 1pm
   * + 7 at 4pm reads as 22, not three rows and not an average.
   *
   * ONE aggregation for the whole page — never a query per row. The $match is
   * served by the existing { skuId: 1, movementDate: -1 } compound index.
   *
   * Only true production issues count. The equality match on CONSUME_OUT is what
   * excludes TRANSFER_OUT, QC_REJECT_OUT, RETURN_OUT, DISPATCH_OUT, ADJUST_OUT
   * and CONVERT_OUT, and movementType OUT excludes every IN movement, so none of
   * them can ever inflate the figure.
   *
   * A SKU with no qualifying movement today is ABSENT from the returned map.
   * That absence is meaningful: the caller renders it as "—" (nothing issued
   * today) rather than 0. Yesterday's consumption never fills it in.
   *
   * @returns {Promise<Map<string, {qty:number, events:number}>>} keyed by String(skuId)
   */
  async _todayConsumptionBySku(skuIds = []) {
    if (!skuIds.length) return new Map();
    const todayKey = istDayKey(new Date());
    const dayStart = new Date(`${todayKey}T00:00:00.000${IST_OFFSET}`);
    const nextDayStart = new Date(`${shiftDay(todayKey, 1)}T00:00:00.000${IST_OFFSET}`);

    const rows = await InventoryMovement.aggregate([
      {
        $match: {
          skuId: { $in: skuIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
          movementType: MOVEMENT_TYPE.OUT,
          txnType: TXN_TYPE.CONSUME_OUT,
          isDeleted: { $ne: true },
          // Half-open interval: $lt, not $lte, so a movement stamped exactly at
          // tomorrow 00:00 IST counts against tomorrow and never both days.
          movementDate: { $gte: dayStart, $lt: nextDayStart },
        },
      },
      { $group: { _id: '$skuId', qty: { $sum: '$quantity' }, events: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), { qty: round2(r.qty), events: r.events }]));
  },

  /**
   * The master IMS view — every consumable/packaging SKU joined with its policy
   * and current on-hand, plus derived reorder/forecast metrics. Dataset is small
   * (~a few hundred items) so we return the full filtered set (no heavy paging).
   */
  async getOverview(query = {}) {
    const itemTypes = query.itemType ? [query.itemType] : IMS_ITEM_TYPES;
    const filter = { itemType: { $in: itemTypes }, isDeleted: { $ne: true } };
    if (query.category) filter.category = query.category;
    if (query.search) {
      const r = rx(query.search);
      filter.$or = [{ name: r }, { code: r }, { category: r }, { aliases: r }];
    }
    const limit = Math.min(Number(query.limit) || 2000, 5000);
    const skus = await SKU.find(filter).sort({ category: 1, name: 1 }).limit(limit).lean();
    const ids = skus.map((s) => s._id);

    // Two grouped aggregations for the whole page — never one per row.
    const [stocks, policies, consumption, window90d, awaiting] = await Promise.all([
      InventoryStock.find({ skuId: { $in: ids }, isDeleted: { $ne: true } }).lean(),
      InventoryPolicy.find({ skuId: { $in: ids }, isDeleted: { $ne: true } }).lean(),
      this._todayConsumptionBySku(ids),
      this._consumptionBySku90d(ids),
      awaitingQcBySku(ids),
    ]);
    // Every warehouse a SKU is stocked in, folded into one figure — keying the
    // Map by skuId alone used to keep only the last row.
    const stockBy = stockBySkuId(stocks);
    const polBy = new Map(policies.map((p) => [String(p.skuId), p]));

    const rows = skus.map((sku) => {
      const stock = stockBy.get(String(sku._id)) || {};
      const policy = imsPolicyOrDefaults(polBy.get(String(sku._id)), sku);
      // ADC, measured: 90-day consumption ÷ 90. Drives lead-time demand, reorder
      // point, max level and safety stock through the unchanged formulas.
      const bucket90d = window90d.get(String(sku._id));
      const m = deriveMetrics(policy, stock, adcFrom(bucket90d), awaiting.get(String(sku._id)) || null);
      // TODAY'S measured consumption — a different question and a different
      // aggregation. Absent = nothing issued today, rendered as "—"; never
      // back-filled from earlier days and never divided by the window.
      const consumed = consumption.get(String(sku._id));
      return {
        skuId: sku._id,
        skuCode: sku.code,
        skuName: sku.name,
        itemType: sku.itemType,
        category: sku.category || '',
        unit: sku.unit || 'PCS',
        // "Converted Item Name (For Resale)" is SKU master data, so the master
        // wins. InventoryPolicy.convertedItemName is the older IMS-local copy —
        // still read as a fallback so seeded rows keep showing their value until
        // the master row carries it, but IMS never writes it any more.
        convertedItemName: sku.convertedItemNameForResale || policy.convertedItemName || '',
        convertedItemNameForResale: sku.convertedItemNameForResale || '',
        hasPolicy: polBy.has(String(sku._id)),
        openingStock: round2(policy.openingStock || 0),
        moq: round2(policy.moq || 0),
        lastMovementAt: stock.lastMovementAt || null,
        // Today's total, as issued — no division, no averaging.
        dailyConsumption: consumed ? consumed.qty : null,
        consumptionTodayEvents: consumed ? consumed.events : 0,
        // The numerator behind `adc`, so the UI can show its working.
        consumption90dQty: bucket90d ? bucket90d.qty : 0,
        consumption90dEvents: bucket90d ? bucket90d.events : 0,
        consumption90dDays: CONSUMPTION_WINDOW_DAYS,
        ...m,
      };
    });

    let docs = rows;
    if (query.status) docs = rows.filter((r) => r.status === query.status);
    return { docs, summary: this._summary(rows) };
  },

  _summary(rows) {
    const s = {
      itemCount: rows.length,
      totalOnHand: 0, totalStockValue: 0,
      outOfStock: 0, reorder: 0, low: 0, overstock: 0, ok: 0,
    };
    for (const r of rows) {
      s.totalOnHand = round2(s.totalOnHand + r.onHand);
      s.totalStockValue = round2(s.totalStockValue + r.stockValue);
      if (r.status === 'OUT_OF_STOCK') s.outOfStock += 1;
      else if (r.status === 'REORDER') s.reorder += 1;
      else if (r.status === 'LOW') s.low += 1;
      else if (r.status === 'OVERSTOCK') s.overstock += 1;
      else s.ok += 1;
    }
    return s;
  },

  /** Per-day stock burn-down for one item (the sheet's dated columns). */
  async getForecast(skuId, days = 30) {
    const [sku, stocks, policy] = await Promise.all([
      SKU.findById(skuId).lean(),
      InventoryStock.find({ skuId, isDeleted: { $ne: true } }).lean(),
      InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } }).lean(),
    ]);
    if (!sku) throw new AppError('Item not found', 404);
    // Same measured ADC, same combined stock and the same policy defaults the
    // stock list uses, so the projection cannot disagree with the row it was
    // opened from.
    const m = deriveMetrics(imsPolicyOrDefaults(policy, sku), combineStockRows(stocks), await this._adcForSku(skuId),
      (await awaitingQcBySku([skuId])).get(String(skuId)) || null);
    const n = Math.min(Math.max(Number(days) || 30, 7), 120);
    // Shared with the RM forecast: on hand, + Awaiting QC the next day,
    // + in transit after the lead time, − ADC each day.
    const { series, reorderDay, stockoutDay } = projectStockSeries({ ...m, days: n });
    return {
      awaitingQcDay: AWAITING_QC_DAY,
      sku: { skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: sku.unit, category: sku.category },
      // Whether the levels above came from a policy or from the fallback, so the
      // item page can say "not configured" instead of showing a default as data.
      metrics: { ...m, hasPolicy: !!policy },
      reorderDay, stockoutDay, series,
    };
  },

  /**
   * Day-by-day stock card (the sheet's dated closing-stock columns) reconstructed
   * from the ledger. Returns a CONTINUOUS calendar series in IST so flat days carry
   * the previous closing forward — exactly how the client reads their Excel history.
   * Closing(day) = opening-before-window + Σ signed movements up to end of that day,
   * which always reconciles with on-hand (on-hand = Σ of all ledger deltas).
   */
  async getStockHistory(skuId, query = {}) {
    const [sku, stocks, policy] = await Promise.all([
      SKU.findById(skuId).lean(),
      InventoryStock.find({ skuId, isDeleted: { $ne: true } }).lean(),
      InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } }).lean(),
    ]);
    if (!sku) throw new AppError('Item not found', 404);
    const m = deriveMetrics(imsPolicyOrDefaults(policy, sku), combineStockRows(stocks), await this._adcForSku(skuId),
      (await awaitingQcBySku([skuId])).get(String(skuId)) || null);

    // Resolve the [from, to] window as IST calendar days. Default: last 30 days.
    const todayKey = istDayKey(new Date());
    let toKey = query.to ? istDayKey(new Date(`${query.to}T12:00:00${IST_OFFSET}`)) : todayKey;
    let fromKey = query.from ? istDayKey(new Date(`${query.from}T12:00:00${IST_OFFSET}`)) : shiftDay(toKey, -29);
    if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
    // Clamp the window (~13 months) so we never build a runaway series.
    if (shiftDay(fromKey, 400) < toKey) fromKey = shiftDay(toKey, -400);

    const fromStart = new Date(`${fromKey}T00:00:00.000${IST_OFFSET}`);
    const toEnd = new Date(`${toKey}T23:59:59.999${IST_OFFSET}`);
    const oid = new mongoose.Types.ObjectId(String(skuId));

    // Signed magnitude straight off movementType — never relies on qtyDelta being set.
    const signedQty = {
      $cond: [{ $eq: ['$movementType', MOVEMENT_TYPE.IN] }, '$quantity', { $multiply: ['$quantity', -1] }],
    };

    const [openingAgg, dailyAgg] = await Promise.all([
      InventoryMovement.aggregate([
        { $match: { skuId: oid, isDeleted: { $ne: true }, movementDate: { $lt: fromStart } } },
        { $group: { _id: null, net: { $sum: signedQty } } },
      ]),
      InventoryMovement.aggregate([
        { $match: { skuId: oid, isDeleted: { $ne: true }, movementDate: { $gte: fromStart, $lte: toEnd } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$movementDate', timezone: IST_TZ } },
            inQty:  { $sum: { $cond: [{ $eq: ['$movementType', MOVEMENT_TYPE.IN] }, '$quantity', 0] } },
            outQty: { $sum: { $cond: [{ $eq: ['$movementType', MOVEMENT_TYPE.OUT] }, '$quantity', 0] } },
            count:  { $sum: 1 },
          },
        },
      ]),
    ]);

    const openingBalance = round2(openingAgg[0]?.net || 0);
    const aggBy = new Map(dailyAgg.map((d) => [d._id, d]));

    const days = [];
    let running = openingBalance;
    let peak = openingBalance;
    let low = openingBalance;
    let totalIn = 0;
    let totalOut = 0;
    let daysWithMovement = 0;
    for (let key = fromKey; key <= toKey; key = shiftDay(key, 1)) {
      const a = aggBy.get(key) || { inQty: 0, outQty: 0, count: 0 };
      const opening = round2(running);
      const inQty = round2(a.inQty);
      const outQty = round2(a.outQty);
      const net = round2(inQty - outQty);
      const closing = round2(opening + net);
      running = closing;
      totalIn = round2(totalIn + inQty);
      totalOut = round2(totalOut + outQty);
      if (a.count > 0) daysWithMovement += 1;
      peak = Math.max(peak, closing);
      low = Math.min(low, closing);
      days.push({
        date: key,
        opening, inQty, outQty, net, closing,
        movementCount: a.count,
        belowReorder: m.reorderPoint > 0 && closing <= m.reorderPoint,
        stockOut: closing <= 0,
      });
    }

    return {
      sku: { skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: sku.unit, category: sku.category },
      range: { from: fromKey, to: toKey, dayCount: days.length },
      metrics: {
        reorderPoint: m.reorderPoint, maxLevel: m.maxLevel,
        adc: m.adc, leadDays: m.leadDays, onHand: m.onHand, inTransit: m.inTransit,
      },
      summary: {
        openingBalance,
        closingBalance: round2(running),
        totalIn, totalOut, net: round2(totalIn - totalOut),
        peak: round2(peak), low: round2(low),
        daysWithMovement,
      },
      days,
    };
  },

  /** Items at/below reorder point, sorted by urgency, with suggested order qty. */
  async getReorderList(query = {}) {
    const { docs } = await this.getOverview(query);
    return docs
      .filter((r) => ['OUT_OF_STOCK', 'REORDER', 'LOW'].includes(r.status))
      .sort((a, b) => (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9));
  },

  // ── Policy CRUD ────────────────────────────────────────────────────────────
  async getPolicy(skuId) {
    const [policy, sku] = await Promise.all([
      InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } }).lean(),
      SKU.findById(skuId).select('convertedItemNameForResale').lean(),
    ]);
    if (!policy) return null;
    // Resolve the max level here too, so the drawer opens knowing whether this
    // SKU's Max Level follows the Safety Factor or overrides it. The resale name
    // and the measured ADC ride along read-only — the first is SKU master data,
    // the second is computed from the ledger; neither is editable here.
    const adc = await this._adcForSku(skuId);
    return {
      ...policy,
      ...resolveMaxLevel(policy, adc),
      calculatedAdc: adc,
      consumption90dDays: CONSUMPTION_WINDOW_DAYS,
      convertedItemNameForResale: sku?.convertedItemNameForResale || policy.convertedItemName || '',
    };
  },

  async upsertPolicy(skuId, data, user) {
    const sku = await SKU.findById(skuId).select('code name unit category itemType').lean();
    if (!sku) throw new AppError('SKU not found', 404);
    // Second line of defence: the route already runs policySchema, but the range
    // must hold for any other caller too — never trust the input control alone.
    if (data.safetyFactor !== undefined) {
      const check = checkSafetyFactor(data.safetyFactor);
      if (!check.ok) throw new AppError(check.message, 422);
      data = { ...data, safetyFactor: check.value };
    }
    const set = {
      skuCode: sku.code, skuName: sku.name, unit: sku.unit, category: sku.category || '', itemType: sku.itemType,
      averageDailyConsumption: data.averageDailyConsumption,
      leadDays: data.leadDays,
      safetyFactor: data.safetyFactor,
      moq: data.moq,
      maxLevel: data.maxLevel,
      maxLevelMode: data.maxLevelMode,
      materialInTransit: data.materialInTransit,
      convertedItemName: data.convertedItemName,
      remarks: data.remarks,
      updatedBy: user?._id,
    };
    // Switching a SKU back to AUTO leaves the old maxLevel on disk untouched —
    // the flag alone decides which number is used, so nothing is destroyed and
    // flipping back to MANUAL restores the previous override.
    if (data.openingStock !== undefined) set.openingStock = data.openingStock;

    // A row written before maxLevelMode existed is read by inference, and that
    // inference compares the stored max level against ADC × lead × SF. Editing
    // any of those three would move the goalposts and could silently re-read a
    // formula-derived value as a manual override. So when the caller does not
    // state a mode, freeze the inference as it stands *before* this edit lands.
    if (set.maxLevelMode === undefined) {
      const existing = await InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } })
        .select('maxLevel maxLevelMode averageDailyConsumption leadDays safetyFactor').lean();
      if (existing && existing.maxLevelMode === undefined) {
        set.maxLevelMode = resolveMaxLevel(existing, await this._adcForSku(skuId)).maxLevelMode;
      }
    }
    Object.keys(set).forEach((k) => set[k] === undefined && delete set[k]);

    // Scoped to this one SKU (skuId is unique on the collection), so saving
    // Product A's Safety Factor can never touch Product B's.
    const policy = await InventoryPolicy.findOneAndUpdate(
      { skuId },
      { $set: set, $setOnInsert: { skuId, createdBy: user?._id } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();
    const adc = await this._adcForSku(skuId);
    return { ...policy, ...resolveMaxLevel(policy, adc), calculatedAdc: adc, consumption90dDays: CONSUMPTION_WINDOW_DAYS };
  },

  // ── Stock-In (manual receipt / opening / correction) ────────────────────────
  async receive(payload, user) {
    const items = (payload.items || []).filter((i) => Number(i.quantity) > 0);
    if (!items.length) throw new AppError('Add at least one item with a quantity.', 400);
    // Second line of defence: the route already runs receiveSchema, but the
    // OTHER-needs-text rule must hold for any other caller too.
    const checked = checkStockInReason(payload.reason, payload.customReason);
    if (!checked.ok) throw new AppError(checked.message, 422);
    const { reason, customReason } = checked;

    // Unchanged movement logic: opening stock is still the only one that posts
    // an OPENING txn; everything else — including OTHER — is an ADJUST_IN.
    const txnType = reason === 'OPENING_STOCK' ? TXN_TYPE.OPENING : TXN_TYPE.ADJUST_IN;
    const movementDate = payload.date ? new Date(payload.date) : new Date();
    // What History shows: the reason label, and for OTHER the operator's words
    // beside it — "Other — Material received as sample".
    const reasonText = reason === 'OTHER'
      ? `${STOCK_IN_REASONS.OTHER} — ${customReason}`
      : STOCK_IN_REASONS[reason];

    // One unit of work: every line lands or none does, and a replayed
    // submission is recognised by its request id rather than adding stock twice.
    return inventoryService.runStockEntry({
      items,
      clientRequestId: payload.clientRequestId,
      meta: { sourceModule: 'IMS', action: 'receive', performedBy: user?._id },
      write: async (it, session) => {
        const { movement, stock } = await inventoryService.increaseStock({
          skuId: it.skuId, quantity: Number(it.quantity), unitCost: Number(it.unitCost || 0),
          batchNo: it.batchNo || '', warehouse: payload.warehouse,
          txnType, sourceModule: 'IMS', refType: 'IMS_RECEIPT', refNumber: payload.reference || '',
          reason, customReason,
          remarks: [reasonText, payload.reference, it.remarks].filter(Boolean).join(' · '),
          performedBy: user, movementDate, clientRequestId: payload.clientRequestId,
        }, { session });
        return { skuId: it.skuId, movementNumber: movement.movementNumber, balanceAfter: stock.qtyOnHand };
      },
    });
  },

  // ── Stock-Out (production issue / consumption) ──────────────────────────────
  async issue(payload, user) {
    const items = (payload.items || []).filter((i) => Number(i.quantity) > 0);
    if (!items.length) throw new AppError('Add at least one item with a quantity.', 400);
    const warehouse = (payload.warehouse || DEFAULT_WAREHOUSE).trim();
    const allowNegative = !!payload.allowNegative;
    const movementDate = payload.date ? new Date(payload.date) : new Date();

    // Why the material left the store. Second line of defence: the route already
    // runs issueSchema, but the OTHER-needs-text rule must hold for any caller.
    // Every reason here is a genuine consumption, so the txnType stays
    // CONSUME_OUT and what ADC measures is completely unchanged.
    const checked = checkStockOutReason(payload.reason, payload.customReason);
    if (!checked.ok) throw new AppError(checked.message, 422);
    const { reason, customReason } = checked;
    const reasonText = reason === 'OTHER'
      ? `${STOCK_OUT_REASONS.OTHER} — ${customReason}`
      : STOCK_OUT_REASONS[reason];

    const context = [
      payload.purpose && `Purpose: ${payload.purpose}`,
      payload.issuedTo && `Issued to: ${payload.issuedTo}`,
      payload.department && `Dept: ${payload.department}`,
    ].filter(Boolean).join(' · ');

    return inventoryService.runStockEntry({
      items,
      clientRequestId: payload.clientRequestId,
      // Two lines for the same item are one issue of their sum. Left separate,
      // each was checked against the same on-hand and passed, and then the first
      // committed while the second failed — an HTTP 400 on top of stock that had
      // already moved.
      mergeDuplicates: true,
      meta: { sourceModule: 'IMS', action: 'issue', performedBy: user?._id },
      preflight: async (lines, session) => {
        if (allowNegative) return;
        // Checked against the warehouse the movement will actually come out of,
        // so this can never pass where the stock engine would refuse.
        const ids = lines.map((i) => i.skuId);
        const q = InventoryStock.find({ skuId: { $in: ids }, warehouse, isDeleted: { $ne: true } });
        if (session) q.session(session);
        const stocks = await q.lean();
        const onHandBy = new Map(stocks.map((s) => [String(s.skuId), s.qtyOnHand]));
        const short = lines.filter((i) => Number(i.quantity) > (onHandBy.get(String(i.skuId)) || 0));
        if (short.length) {
          const names = short.map((i) => i.skuCode || i.skuId).join(', ');
          throw new AppError(`Not enough stock for: ${names}. Lower the quantity or tick "allow negative".`, 400);
        }
      },
      write: async (it, session) => {
        const { movement, stock } = await inventoryService.decreaseStock({
          skuId: it.skuId, quantity: Number(it.quantity), warehouse,
          txnType: TXN_TYPE.CONSUME_OUT, sourceModule: 'IMS',
          refType: 'IMS_ISSUE', refNumber: payload.reference || '',
          reason, customReason,
          remarks: [reasonText, context, it.remarks].filter(Boolean).join(' · '),
          performedBy: user, movementDate, clientRequestId: payload.clientRequestId,
        }, { allowNegative, session });
        return { skuId: it.skuId, movementNumber: movement.movementNumber, balanceAfter: stock.qtyOnHand };
      },
    });
  },

  /**
   * The ids of every consumable/packaging SKU — the scope every Consumables
   * screen is about. IMS_ITEM_TYPES is the one source of truth for what this
   * module covers; nothing here ever guesses from a code prefix.
   */
  async _imsSkuIds() {
    const skus = await SKU.find({ itemType: { $in: IMS_ITEM_TYPES }, isDeleted: { $ne: true } }).select('_id').lean();
    return skus.map((s) => s._id);
  },

  /** One Consumables & Packaging item's history, newest first, with its in/out totals. */
  async getItemLedger(skuId, query = {}) {
    const ok = await SKU.exists({ _id: skuId, itemType: { $in: IMS_ITEM_TYPES }, isDeleted: { $ne: true } });
    if (!ok) throw new AppError('Consumables & Packaging item not found', 404);
    return inventoryService.getItemLedger(skuId, query);
  },

  /**
   * Movement history scoped to consumable/packaging items.
   *
   * This used to hand the query straight to the shared engine reader, which is
   * scoped to nothing: the Consumables history listed finished-goods dispatches,
   * raw-material conversions and purchase GRNs alongside its own rows. The
   * filtering, searching, sorting and paging all still come from ApiFeatures —
   * only the starting set is now this module's own SKUs.
   */
  async getMovements(query = {}) {
    const ids = await this._imsSkuIds();
    const base = InventoryMovement.find({ skuId: { $in: ids }, isDeleted: { $ne: true } });
    const features = new ApiFeatures(base, query)
      .filter().search(['movementNumber', 'skuCode', 'skuName', 'refNumber', 'poNumber', 'piNumber', 'vendorName'])
      .sort().select().paginate();
    return features.exec();
  },

  // ── Dashboard ───────────────────────────────────────────────────────────────
  async getDashboard() {
    const { docs, summary } = await this.getOverview({});
    const byCategory = {};
    for (const r of docs) {
      const k = r.category || 'Uncategorised';
      byCategory[k] = byCategory[k] || { category: k, items: 0, onHand: 0, value: 0, reorder: 0 };
      byCategory[k].items += 1;
      byCategory[k].onHand = round2(byCategory[k].onHand + r.onHand);
      byCategory[k].value = round2(byCategory[k].value + r.stockValue);
      if (['REORDER', 'OUT_OF_STOCK', 'LOW'].includes(r.status)) byCategory[k].reorder += 1;
    }

    // Top consumed items over the last 30 days.
    //
    // Both of these were unscoped: "Top consumed" counted every OUT movement in
    // the company — a finished-goods dispatch, a QC rejection, a coil conversion
    // — and the recent list showed other modules' rows on the Consumables
    // dashboard. They are now this module's SKUs only, and "consumed" means the
    // same CONSUME_OUT that Average Daily Consumption is measured from, so the
    // two numbers on this screen can no longer contradict each other.
    const since = new Date(Date.now() - 30 * 86400000);
    const imsIds = await this._imsSkuIds();
    const topConsumed = await InventoryMovement.aggregate([
      {
        $match: {
          skuId: { $in: imsIds },
          movementType: MOVEMENT_TYPE.OUT,
          txnType: TXN_TYPE.CONSUME_OUT,
          movementDate: { $gte: since },
          isDeleted: { $ne: true },
        },
      },
      { $group: { _id: { skuId: '$skuId', skuCode: '$skuCode', skuName: '$skuName' }, qty: { $sum: '$quantity' } } },
      { $sort: { qty: -1 } },
      { $limit: 8 },
      { $project: { _id: 0, skuCode: '$_id.skuCode', skuName: '$_id.skuName', qty: 1 } },
    ]);

    const recentMovements = await InventoryMovement.find({ skuId: { $in: imsIds }, isDeleted: { $ne: true } })
      .sort({ movementDate: -1, createdAt: -1 }).limit(12)
      .select('movementNumber movementDate skuCode skuName movementType txnType quantity balanceAfter performedByName reason customReason remarks')
      .lean();

    const reorderList = docs
      .filter((r) => ['OUT_OF_STOCK', 'REORDER', 'LOW'].includes(r.status))
      .sort((a, b) => (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9))
      .slice(0, 12);

    return {
      summary,
      byCategory: Object.values(byCategory).sort((a, b) => b.value - a.value),
      topConsumed,
      recentMovements,
      reorderList,
    };
  },
};

export default imsService;
