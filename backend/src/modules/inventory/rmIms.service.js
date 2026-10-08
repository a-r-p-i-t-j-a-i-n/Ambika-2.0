import mongoose from 'mongoose';
import InventoryPolicy from './inventoryPolicy.model.js';
import InventoryStock, { DEFAULT_WAREHOUSE } from './inventoryStock.model.js';
import InventoryMovement, { MOVEMENT_TYPE, TXN_TYPE } from './inventoryMovement.model.js';
import CoilConversion from './coilConversion.model.js';
import ScrapRecord, { SCRAP_LOCATIONS } from './scrapRecord.model.js';
// Round numbering and the running remaining weight. Pure arithmetic kept out of
// this file on purpose, so the client's worked example can be asserted without
// a database — see the header of coilLineage.js for why nothing is stored.
import {
  deriveRounds, ledgerCoilState, summariseCoilRow, CUT_STATUS, EPS,
} from './coilLineage.js';
// An in-house cut now posts its offcut into scrap stock, so the cut needs to
// know which item that is. Resolver only — it never creates the SKU.
import { resolveScrapSku, SCRAP_UNIT } from './scrapSku.js';
import { inventoryService, combineStockRows, stockBySkuId } from './inventory.service.js';
// resolveMaxLevel is the Consumables max-level rule; the two consumption
// aggregations are its measured-consumption pipeline. Both are scoped by the
// SKU ids the caller passes, so Raw Material reuses them as they are rather
// than growing a second implementation that could drift.
import { imsService, resolveMaxLevel } from './ims.service.js';
import { rmInTransitService } from './rmInTransit.service.js';
import {
  checkSafetyFactor, checkStockInReason, STOCK_IN_REASONS,
  checkStockOutReason, STOCK_OUT_REASONS,
} from './ims.validation.js';
import { generateDocNumber } from '../../utils/docNumberGenerator.js';
// The client's sheet of which circle sizes each coil is approved to produce.
// Data + pure rules only; this module decides what a refusal looks like over
// HTTP. It is the ONLY place the mapping is written down — the screen reads it
// back through /circle-options rather than keeping a copy.
import {
  checkCirclesAgainstCoil, allowedCirclesForCoil, MAP_VERDICT, isCoilMapped,
} from '../../data/coil-circle-map.js';
import SKU, { RM_ITEM_TYPES } from '../skus/sku.model.js';
// Read-only, and the model only — never the GRN service. A coil receipt records
// its indent on the GRN header and does not copy it onto the movement, so the
// received-coil lookup reads it back from there.
import GoodsReceiptNote from '../procurement/grn/grn.model.js';
import { AppError } from '../../utils/apiResponse.js';

/**
 * RM IMS service — Raw Material inventory on top of the shared stock engine.
 *
 * Covers the two halves of the client's raw-material flow:
 *   • COIL   (itemType RAW_MATERIAL) — metal coils bought from vendors.
 *   • CIRCLE (itemType CIRCLE)       — blanks cut from a coil for production.
 *
 * Reuses InventoryStock / InventoryMovement / InventoryPolicy (so Purchase→GRN→QC
 * receipts already land here as GRN_IN), and adds RM-specific planning (Low/Normal/
 * Peak ADC, booked qty, available %, vendor/rate) plus the Coil→Circle conversion
 * that records scrap & yield (the "Scrap Summary" / "Circle In-Out" sheets).
 */

/**
 * Where a cut happened, for its scrap record.
 *
 * This is the ONE field a conversion cannot simply hand over. Two candidates
 * exist - the operator's own "Received At" on the Cut Coils screen, and the
 * location on the coil's receipt - and the ORDER between them matters:
 *
 *   WHERE A COIL WAS RECEIVED IS NOT WHERE IT WAS CUT.
 *
 * The receipt used to win. That was harmless only while every GRN posted to
 * MAIN, which is not a cutting location, so the receipt branch never actually
 * fired and the operator's choice always stood. Now that a GRN can record a
 * real PLG01/JW001 "Received At", the old order would let a coil received at
 * the plant overrule an operator who is telling us the cut happened at the job
 * worker - and that is not a label, it decides stock: isPhysicalScrap() posts a
 * SCRAP_IN for a PLG01 cut and nothing for JW001. Of 246,679 kg of recorded
 * scrap, 229,774 kg is JW001 offcuts that stayed with the job worker and were
 * never stock Ambika held, so getting this backwards invents stock.
 *
 * So: the operator, who was standing there, is asked first. The receipt is the
 * fallback for a cut that names no location of its own.
 *
 * Neither can be copied blindly. Every historical CONVERT_OUT sits at MAIN,
 * which is not a cutting location at all, and ScrapRecord.location is a
 * required two-value enum - so an unchecked copy would throw inside the
 * transaction and fail the whole cut for a reason that has nothing to do with
 * cutting.
 *
 * Returns null when it genuinely cannot be determined, rather than guessing.
 */
export const resolveScrapLocation = (receipt, warehouse) => {
  const fromPayload = String(warehouse || '').trim().toUpperCase();
  if (SCRAP_LOCATIONS.includes(fromPayload)) return fromPayload;
  const fromReceipt = String(receipt?.warehouse || '').trim().toUpperCase();
  if (SCRAP_LOCATIONS.includes(fromReceipt)) return fromReceipt;
  return null;
};

/**
 * Turn a coil→circle map verdict into what the operator should be told.
 *
 * Separated from the check itself so the wording is in one place and can be
 * asserted in a test: this message is the whole feedback an API caller gets,
 * and a vague one ("invalid circle") would leave the floor guessing which of
 * five rows is wrong.
 *
 * An UNMAPPED coil is refused outright rather than falling back to "any circle
 * will do". The client's sheet is the authority on what a coil may produce, and
 * silence in it is not permission — it is a gap to take back to the client.
 */
export const describeCircleMapRefusal = (verdict) => {
  if (!verdict || verdict.ok) return '';
  if (verdict.reason === MAP_VERDICT.COIL_UNMAPPED) {
    return `No approved circle sizes are configured for coil ${verdict.coilCode}. `
      + 'This coil cannot be cut until its circle mapping is added.';
  }
  return `${verdict.offending.join(', ')} cannot be produced from coil ${verdict.coilCode}. `
    + `Approved circles for this coil: ${verdict.allowed.join(', ')}.`;
};

// Defined in the SKU master (the classification home) and re-exported here so
// every existing importer of this module keeps working unchanged.
export { RM_ITEM_TYPES };
const kindOf = (itemType) => (itemType === 'CIRCLE' ? 'CIRCLE' : 'COIL');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Kilograms as the operator reads them on screen (en-IN grouping: 1,000).
const kgText = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

// The PLANNED rate: the Low/Normal/Peak column the chosen mode points at. This
// is a forecasting choice the planner makes, not a measurement.
const resolveAdc = (policy = {}) => {
  const mode = policy.consumptionMode || 'LOW';
  const byMode = { LOW: policy.adcLow, NORMAL: policy.adcNormal, PEAK: policy.adcPeak }[mode];
  return Number(byMode || policy.averageDailyConsumption || 0);
};

// The window Consumables measures over, reused verbatim so the two modules
// cannot report a different "average" for the same ledger.
const CONSUMPTION_WINDOW_DAYS = 90;
const adcFrom = (bucket) => round2((bucket?.qty || 0) / CONSUMPTION_WINDOW_DAYS);

/**
 * Which daily rate actually drives the levels, and where it came from.
 *
 * Measured consumption wins the moment there is any: that is the whole point of
 * deriving it from the ledger. When there is none the PLANNED rate stands in,
 * because Raw Material is only now starting to record issues — zeroing the rate
 * would zero every Max Level and put the entire master into OUT_OF_STOCK, which
 * is not what "no history yet" means.
 *
 * A SKU with neither is reported as adcSource NONE with adc 0. It stays active
 * and keeps its stock; it simply cannot be planned until it has a rate. Nothing
 * is invented for it.
 */
export const resolveActiveAdc = (policy = {}, measuredAdc = 0) => {
  const planned = resolveAdc(policy);
  const measured = round2(measuredAdc);
  if (measured > 0) return { adc: measured, adcSource: 'MEASURED', plannedAdc: planned, measuredAdc: measured };
  if (planned > 0) return { adc: planned, adcSource: 'PLANNED', plannedAdc: planned, measuredAdc: measured };
  return { adc: 0, adcSource: 'NONE', plannedAdc: planned, measuredAdc: measured };
};

/**
 * The policy a raw-material item is planned with when it has none of its own.
 *
 * Defined once, because the three read paths each carried their own idea of the
 * default: the stock list built `safetyFactor: 2` inline, the model defaults to
 * 1.5, and the forecast passed a bare `{}` (lead time 0). The same item read as
 * three different plans depending on which screen you opened. Every read path
 * now starts from this one row.
 */
const rmPolicyOrDefaults = (policy, sku = {}) => policy || {
  averageDailyConsumption: 0, adcLow: 0, adcNormal: 0, adcPeak: 0, consumptionMode: 'LOW',
  leadDays: sku.leadDays ?? 16, safetyFactor: 1.5,
  moq: 0, maxLevel: 0, maxLevelMode: 'AUTO',
  materialInTransit: 0, bookedQty: 0, openingStock: 0,
};

/**
 * Stock status + planning metrics from on-hand/in-transit/booked vs policy.
 *
 * @param {object} policy
 * @param {object} stock
 * @param {object} [ctx]
 *   measuredAdc?  the 90-day measured rate for this SKU (0 when none)
 *   openPo?       this SKU's open-PO row from rmInTransit.service, when any
 */
export const deriveMetrics = (policy = {}, stock = {}, ctx = {}) => {
  const { adc, adcSource, plannedAdc, measuredAdc } = resolveActiveAdc(policy, ctx.measuredAdc);
  const leadDays = Number(policy.leadDays || 0);
  const safetyFactor = Number(policy.safetyFactor || 1.5);
  // Material In Transit is now the open-PO figure whenever procurement has one.
  // The typed policy number is only a fallback for a SKU with no PO at all, and
  // it never adds to the PO figure — that would count the same material twice.
  const openPo = ctx.openPo || null;
  const manualInTransit = Number(policy.materialInTransit || 0);
  const inTransit = openPo ? round2(openPo.pendingQty) : manualInTransit;
  const inTransitSource = openPo ? 'PO' : (manualInTransit > 0 ? 'MANUAL' : 'NONE');
  const booked = Number(policy.bookedQty || 0);
  const onHand = round2(stock.qtyOnHand || 0);
  // Recorded weight beside a piece count (circles). Never mixed into onHand.
  const onHandKg = round2(stock.qtyOnHandKg || 0);

  const leadTimeDemand = round2(adc * leadDays);
  // Order-up-to / Max Level — ADC × Lead Time × Safety Factor unless a genuine
  // manual override exists. This used to be `policy.maxLevel || formula`, so any
  // stored figure won silently and forever: editing a SKU's Safety Factor moved
  // nothing. resolveMaxLevel is the Consumables implementation, reused as-is so
  // the two modules cannot drift apart.
  const { maxLevel, formulaMaxLevel, storedMaxLevel, maxLevelMode, maxLevelInferred } = resolveMaxLevel(policy, adc);
  const safetyStock = round2(Math.max(0, maxLevel - leadTimeDemand));
  const reorderPoint = leadTimeDemand;
  // Available to plan with = on-hand + in-transit − already booked.
  const projectedAvailable = round2(onHand + inTransit - booked);
  const daysCover = adc > 0 ? round2(onHand / adc) : null;
  // "Available in %" — the sheet's coloured % column, which is Total Available
  // Quantity ÷ Max Level (Inventory!Q = N/L×100). Deliberately NOT the projected
  // figure: in-transit and booked belong to the reorder decision below, not to
  // the "how full is this bin" reading the shop floor takes off this column.
  const availablePct = maxLevel > 0 ? Math.round((onHand / maxLevel) * 100) : null;

  let status = 'OK';
  if (onHand <= 0) status = 'OUT_OF_STOCK';
  else if (projectedAvailable <= reorderPoint) status = 'REORDER';
  else if (maxLevel > 0 && onHand > maxLevel * 1.25) status = 'OVERSTOCK';
  else if (adc > 0 && projectedAvailable <= safetyStock + reorderPoint && projectedAvailable > reorderPoint) status = 'LOW';

  let suggestedOrderQty = round2(Math.max(0, maxLevel - projectedAvailable));
  const moq = Number(policy.moq || 0);
  if (suggestedOrderQty > 0 && moq > 0 && suggestedOrderQty < moq) suggestedOrderQty = moq;

  const rate = Number(policy.rate || stock.avgCost || 0);
  return {
    onHand, onHandKg, inTransit, booked, adc, leadDays, safetyFactor,
    // Where each of the two figures that move the levels actually came from, so
    // no screen has to guess whether it is showing a measurement or a plan.
    adcSource, plannedAdc, measuredAdc, consumption90dDays: CONSUMPTION_WINDOW_DAYS,
    inTransitSource,
    openPoCount: openPo?.poCount || 0,
    openPoNumbers: openPo?.poNumbers || [],
    openPoOrderedQty: openPo?.orderedQty || 0,
    openPoReceivedQty: openPo?.receivedQty || 0,
    openPoEarliestExpectedAt: openPo?.earliestExpectedAt || null,
    openPoOverdueCount: openPo?.overduePoCount || 0,
    openPoOverdueQty: openPo?.overduePendingQty || 0,
    manualInTransit,
    leadTimeDemand, safetyStock, reorderPoint, maxLevel,
    // Max-level provenance, so the UI can say when the Safety Factor is being
    // overruled instead of silently showing a number the formula did not make.
    formulaMaxLevel, storedMaxLevel, maxLevelMode, maxLevelInferred,
    projectedAvailable, daysCover, availablePct, status, suggestedOrderQty,
    avgCost: round2(stock.avgCost || 0),
    rate: round2(rate),
    stockValue: round2((stock.qtyOnHand || 0) * rate),
    buyCost: round2(suggestedOrderQty * rate),
  };
};

export const rmImsService = {
  RM_ITEM_TYPES,

  async getOverview(query = {}) {
    const itemTypes = query.itemType ? [query.itemType] : RM_ITEM_TYPES;
    const filter = { itemType: { $in: itemTypes }, isDeleted: { $ne: true } };
    if (query.category) filter.category = query.category;
    if (query.search) {
      const r = rx(query.search);
      filter.$or = [{ name: r }, { code: r }, { category: r }, { aliases: r }];
    }
    const limit = Math.min(Number(query.limit) || 3000, 8000);
    const skus = await SKU.find(filter).sort({ itemType: 1, category: 1, name: 1 }).limit(limit).lean();
    const ids = skus.map((s) => s._id);

    // Four grouped reads for the whole page — never one per row. The two
    // consumption aggregations are the Consumables pipeline, called with RM's
    // own SKU ids; the PO read is the procurement module, read-only.
    const [stocks, policies, today, window90d, openPo] = await Promise.all([
      InventoryStock.find({ skuId: { $in: ids }, isDeleted: { $ne: true } }).lean(),
      InventoryPolicy.find({ skuId: { $in: ids }, isDeleted: { $ne: true } }).lean(),
      imsService._todayConsumptionBySku(ids),
      imsService._consumptionBySku90d(ids),
      rmInTransitService.getOpenPoBySku(skus),
    ]);
    // Every warehouse a SKU is stocked in, folded into one figure. Keying the
    // Map by skuId alone kept only the LAST row, so the day anything is received
    // at the job worker rather than the plant, this would quietly show one
    // location's balance as if it were the whole stock.
    const stockBy = stockBySkuId(stocks);
    const polBy = new Map(policies.map((p) => [String(p.skuId), p]));

    const rows = skus.map((sku) => {
      const key = String(sku._id);
      const stock = stockBy.get(key) || {};
      const policy = rmPolicyOrDefaults(polBy.get(key), sku);
      const bucket90d = window90d.get(key);
      const m = deriveMetrics(policy, stock, {
        measuredAdc: adcFrom(bucket90d),
        openPo: openPo.bySkuId.get(key) || null,
      });
      // TODAY'S measured consumption — a different question and a different
      // aggregation from the 90-day average. Absent means nothing was issued
      // today, rendered as "—"; it is never back-filled from earlier days.
      const consumedToday = today.get(key);
      return {
        skuId: sku._id,
        skuCode: sku.code,
        skuName: sku.name,
        itemType: sku.itemType,
        kind: kindOf(sku.itemType),
        // Whether Cut Coils may offer this coil: only coils the Coil → Circle
        // sheet lists. Additive — every other screen reading the overview
        // ignores it, and the SKU stays in RM stock either way.
        circleMapped: kindOf(sku.itemType) === 'COIL' ? isCoilMapped(sku.code) : undefined,
        category: sku.category || '',
        unit: sku.unit || 'PCS',
        hasPolicy: polBy.has(String(sku._id)),
        consumptionMode: policy.consumptionMode || 'LOW',
        adcLow: round2(policy.adcLow || 0),
        adcNormal: round2(policy.adcNormal || 0),
        adcPeak: round2(policy.adcPeak || 0),
        moq: round2(policy.moq || 0),
        vendorName: policy.vendorName || '',
        openingStock: round2(policy.openingStock || 0),
        lastMovementAt: stock.lastMovementAt || null,
        // Today's total, as issued — no division, no averaging.
        dailyConsumption: consumedToday ? consumedToday.qty : null,
        consumptionTodayEvents: consumedToday ? consumedToday.events : 0,
        // The numerator behind the measured ADC, so a screen can show its working.
        consumption90dQty: bucket90d ? bucket90d.qty : 0,
        consumption90dEvents: bucket90d ? bucket90d.events : 0,
        ...m,
      };
    });

    let docs = rows;
    if (query.kind) docs = docs.filter((r) => r.kind === query.kind);
    if (query.status) docs = docs.filter((r) => r.status === query.status);
    // PO lines procurement holds that this module could not attribute to an RM
    // item. Surfaced, never swallowed — see rmInTransit.service.
    return { docs, summary: this._summary(rows), inTransit: { unmatched: openPo.unmatched, summary: openPo.summary } };
  },

  _summary(rows) {
    const s = {
      itemCount: rows.length, coilCount: 0, circleCount: 0,
      totalOnHand: 0, totalStockValue: 0,
      outOfStock: 0, reorder: 0, low: 0, overstock: 0, ok: 0,
    };
    for (const r of rows) {
      if (r.kind === 'CIRCLE') s.circleCount += 1; else s.coilCount += 1;
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

  /** Per-day stock burn-down for one item (the dated-columns projection). */
  async getForecast(skuId, days = 30) {
    const [sku, stocks, policy] = await Promise.all([
      SKU.findById(skuId).lean(),
      InventoryStock.find({ skuId, isDeleted: { $ne: true } }).lean(),
      InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } }).lean(),
    ]);
    if (!sku) throw new AppError('Item not found', 404);
    // Same combined stock, the same policy defaults, the same measured rate and
    // the same open-PO figure the stock list uses, so the projection cannot
    // disagree with the row it was opened from.
    const [measuredAdc, openPo] = await Promise.all([
      this._measuredAdcForSku(skuId),
      rmInTransitService.getOpenPoBySku([{ _id: sku._id, code: sku.code }]),
    ]);
    const m = deriveMetrics(rmPolicyOrDefaults(policy, sku), combineStockRows(stocks), {
      measuredAdc, openPo: openPo.bySkuId.get(String(skuId)) || null,
    });
    const n = Math.min(Math.max(Number(days) || 30, 7), 120);

    const series = [];
    let projected = m.onHand;
    let reorderDay = null;
    let stockoutDay = null;
    const today = new Date();
    for (let d = 0; d <= n; d += 1) {
      const date = new Date(today.getTime() + d * 86400000);
      if (m.inTransit > 0 && d === Math.round(m.leadDays)) projected = round2(projected + m.inTransit);
      if (d > 0) projected = round2(projected - m.adc);
      const clamped = Math.max(0, projected);
      if (reorderDay === null && clamped <= m.reorderPoint) reorderDay = d;
      if (stockoutDay === null && clamped <= 0) stockoutDay = d;
      series.push({ day: d, date, projected: clamped });
    }
    return {
      sku: { skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: sku.unit, category: sku.category, kind: kindOf(sku.itemType) },
      // Whether the levels above came from a real policy or from the fallback,
      // so the UI can say "not configured" instead of showing a default as data.
      metrics: { ...m, hasPolicy: !!policy },
      reorderDay, stockoutDay, series,
    };
  },

  /**
   * Everything one raw-material item is, on one call.
   *
   * The screen renders this; it computes nothing of its own. Every planning
   * figure comes from the same deriveMetrics the stock list uses, so the item
   * page and the row it was opened from cannot disagree.
   */
  async getItemDetail(skuId) {
    const sku = await SKU.findById(skuId).lean();
    if (!sku) throw new AppError('Item not found', 404);
    if (!RM_ITEM_TYPES.includes(sku.itemType)) {
      throw new AppError('That item is not a raw material.', 400);
    }

    const [stocks, policy, measuredAdc, today, openPo, conversions] = await Promise.all([
      InventoryStock.find({ skuId, isDeleted: { $ne: true } }).lean(),
      InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } }).lean(),
      this._measuredAdcForSku(skuId),
      imsService._todayConsumptionBySku([skuId]),
      rmInTransitService.getOpenPoBySku([{ _id: sku._id, code: sku.code }]),
      // Conversions this item took part in, either as the coil or as a circle.
      CoilConversion.find({
        isDeleted: { $ne: true },
        $or: [{ coilSkuId: skuId }, { 'circles.circleSkuId': skuId }],
      }).sort({ conversionDate: -1 }).limit(20).lean(),
    ]);

    const combined = combineStockRows(stocks);
    const po = openPo.bySkuId.get(String(skuId)) || null;
    const m = deriveMetrics(rmPolicyOrDefaults(policy, sku), combined, { measuredAdc, openPo: po });
    const consumedToday = today.get(String(skuId));
    const kind = kindOf(sku.itemType);

    // Lifetime totals per movement type — the "movement summary" band.
    const totals = await InventoryMovement.aggregate([
      { $match: { skuId: new mongoose.Types.ObjectId(String(skuId)), isDeleted: { $ne: true } } },
      { $group: { _id: '$txnType', qty: { $sum: '$quantity' }, kg: { $sum: '$quantityKg' }, events: { $sum: 1 } } },
    ]);
    const byTxn = {};
    for (const t of totals) byTxn[t._id] = { qty: round2(t.qty), kg: t.kg == null ? null : round2(t.kg), events: t.events };

    // Scrap is not a stock movement — it only exists as the difference on a
    // conversion document, so it is read from there rather than the ledger.
    const scrapKg = round2(conversions
      .filter((c) => String(c.coilSkuId) === String(skuId))
      .reduce((s, c) => s + (c.scrapKg || 0), 0));

    return {
      sku: {
        skuId: sku._id, skuCode: sku.code, skuName: sku.name,
        itemType: sku.itemType, kind, category: sku.category || '',
        unit: sku.unit || (kind === 'CIRCLE' ? 'PCS' : 'KGS'),
        // Circles are counted in pieces and weighed; coils are only weighed.
        tracksWeight: kind === 'CIRCLE',
      },
      metrics: { ...m, hasPolicy: !!policy },
      policy: policy
        ? { ...policy, ...resolveMaxLevel(policy, m.adc) }
        : null,
      consumption: {
        today: consumedToday ? consumedToday.qty : null,
        todayEvents: consumedToday ? consumedToday.events : 0,
        windowDays: CONSUMPTION_WINDOW_DAYS,
        measuredAdc: m.measuredAdc,
        plannedAdc: m.plannedAdc,
        adcSource: m.adcSource,
      },
      procurement: {
        vendorName: policy?.vendorName || '',
        rate: round2(policy?.rate || combined.avgCost || 0),
        openPoCount: po?.poCount || 0,
        poNumbers: po?.poNumbers || [],
        orderedQty: po?.orderedQty || 0,
        receivedQty: po?.receivedQty || 0,
        pendingQty: po?.pendingQty || 0,
        earliestExpectedAt: po?.earliestExpectedAt || null,
        overduePoCount: po?.overduePoCount || 0,
      },
      // One row per warehouse the item is actually stocked in. No rule is
      // applied about whether job-work stock counts as available — that is
      // still an open question, so both are simply reported.
      locations: stocks.map((s) => ({
        warehouse: s.warehouse,
        qtyOnHand: round2(s.qtyOnHand || 0),
        qtyOnHandKg: round2(s.qtyOnHandKg || 0),
        lastMovementAt: s.lastMovementAt || null,
      })),
      movementSummary: { byTxn, scrapKg, conversionCount: conversions.length },
      conversions,
    };
  },

  /**
   * Day-by-day stock card — the application's answer to the client's "IMS" tab.
   *
   * Reconstructed from the ledger, so it always ties back to the movements:
   *   closing(day) = balance before the window + Σ signed movements to that day
   * Bucketed on the IST calendar, and CONTINUOUS — a day with no movement still
   * carries the previous closing forward, which is how a stock register reads.
   *
   * Split by what the movement WAS, because "stock went down" and "stock was
   * cut into circles" are different events the client tracks separately.
   */
  async getStockHistory(skuId, query = {}) {
    const sku = await SKU.findById(skuId).select('code name unit itemType category').lean();
    if (!sku) throw new AppError('Item not found', 404);
    const kind = kindOf(sku.itemType);

    const IST = 'Asia/Kolkata';
    const OFF = '+05:30';
    const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: IST });
    const shift = (ymd, n) => {
      const [y, mo, da] = ymd.split('-').map(Number);
      return new Date(Date.UTC(y, mo - 1, da + n)).toISOString().slice(0, 10);
    };

    const todayKey = dayKey(new Date());
    let toKey = query.to ? dayKey(new Date(`${query.to}T12:00:00${OFF}`)) : todayKey;
    let fromKey = query.from ? dayKey(new Date(`${query.from}T12:00:00${OFF}`)) : shift(toKey, -29);
    if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
    if (shift(fromKey, 400) < toKey) fromKey = shift(toKey, -400); // ~13 months, never runaway

    const fromStart = new Date(`${fromKey}T00:00:00.000${OFF}`);
    const toEnd = new Date(`${toKey}T23:59:59.999${OFF}`);
    const oid = new mongoose.Types.ObjectId(String(skuId));
    // Signed straight off movementType — never relies on qtyDelta being set.
    const signed = (f) => ({ $cond: [{ $eq: ['$movementType', MOVEMENT_TYPE.IN] }, `$${f}`, { $multiply: [`$${f}`, -1] }] });

    const [openingAgg, daily] = await Promise.all([
      InventoryMovement.aggregate([
        { $match: { skuId: oid, isDeleted: { $ne: true }, movementDate: { $lt: fromStart } } },
        { $group: { _id: null, net: { $sum: signed('quantity') }, netKg: { $sum: signed('quantityKg') } } },
      ]),
      InventoryMovement.aggregate([
        { $match: { skuId: oid, isDeleted: { $ne: true }, movementDate: { $gte: fromStart, $lte: toEnd } } },
        {
          $group: {
            _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$movementDate', timezone: IST } }, txn: '$txnType' },
            qty: { $sum: '$quantity' },
            kg: { $sum: '$quantityKg' },
            dir: { $first: '$movementType' },
            events: { $sum: 1 },
          },
        },
      ]),
    ]);

    // Which bucket each txnType belongs to on the client's stock card.
    const BUCKET = {
      [TXN_TYPE.GRN_IN]: 'inward', [TXN_TYPE.OPENING]: 'inward', [TXN_TYPE.ADJUST_IN]: 'adjustment',
      [TXN_TYPE.TRANSFER_IN]: 'adjustment', [TXN_TYPE.CONVERT_IN]: 'conversionIn',
      [TXN_TYPE.CONVERT_OUT]: 'conversionOut', [TXN_TYPE.CONSUME_OUT]: 'consumption',
      [TXN_TYPE.ADJUST_OUT]: 'adjustment', [TXN_TYPE.TRANSFER_OUT]: 'adjustment',
      [TXN_TYPE.RETURN_OUT]: 'adjustment', [TXN_TYPE.QC_REJECT_OUT]: 'adjustment',
      [TXN_TYPE.DISPATCH_OUT]: 'adjustment',
    };
    const blank = () => ({ inward: 0, conversionIn: 0, conversionOut: 0, consumption: 0, adjustment: 0, inKg: 0, outKg: 0, events: 0 });
    const byDay = new Map();
    for (const d of daily) {
      const row = byDay.get(d._id.day) || blank();
      const bucket = BUCKET[d._id.txn] || 'adjustment';
      row[bucket] = round2(row[bucket] + d.qty);
      row.events += d.events;
      if (d.kg != null) {
        if (d.dir === MOVEMENT_TYPE.IN) row.inKg = round2(row.inKg + d.kg);
        else row.outKg = round2(row.outKg + d.kg);
      }
      // Track the signed total so closing cannot drift from the buckets.
      row._net = round2((row._net || 0) + (d.dir === MOVEMENT_TYPE.IN ? d.qty : -d.qty));
      byDay.set(d._id.day, row);
    }

    const openingBalance = round2(openingAgg[0]?.net || 0);
    const openingKg = round2(openingAgg[0]?.netKg || 0);
    const days = [];
    let running = openingBalance;
    let runningKg = openingKg;
    let totalIn = 0; let totalOut = 0; let daysWithMovement = 0;
    let peak = openingBalance; let low = openingBalance;
    for (let key = fromKey; key <= toKey; key = shift(key, 1)) {
      const a = byDay.get(key) || blank();
      const opening = round2(running);
      const openKg = round2(runningKg);
      const net = round2(a._net || 0);
      const netKg = round2(a.inKg - a.outKg);
      const closing = round2(opening + net);
      const closingKg = round2(openKg + netKg);
      running = closing; runningKg = closingKg;
      totalIn = round2(totalIn + a.inward + a.conversionIn + Math.max(0, a.adjustment));
      totalOut = round2(totalOut + a.conversionOut + a.consumption);
      if (a.events > 0) daysWithMovement += 1;
      peak = Math.max(peak, closing); low = Math.min(low, closing);
      days.push({
        date: key,
        opening,
        inward: a.inward,
        conversionIn: a.conversionIn,
        conversionOut: a.conversionOut,
        consumption: a.consumption,
        adjustment: a.adjustment,
        net,
        closing,
        // Only meaningful for circles, and only where a source stated a weight.
        // Never derived from a factor — a day with no stated weight shows null.
        openingKg: kind === 'CIRCLE' ? openKg : null,
        closingKg: kind === 'CIRCLE' ? closingKg : null,
        inKg: kind === 'CIRCLE' && a.inKg ? a.inKg : null,
        outKg: kind === 'CIRCLE' && a.outKg ? a.outKg : null,
        movementCount: a.events,
      });
    }

    return {
      sku: {
        skuId: sku._id, skuCode: sku.code, skuName: sku.name, kind,
        unit: sku.unit || (kind === 'CIRCLE' ? 'PCS' : 'KGS'),
        tracksWeight: kind === 'CIRCLE',
      },
      range: { from: fromKey, to: toKey, dayCount: days.length },
      summary: {
        openingBalance, closingBalance: round2(running),
        openingKg: kind === 'CIRCLE' ? openingKg : null,
        closingKg: kind === 'CIRCLE' ? round2(runningKg) : null,
        totalIn, totalOut, net: round2(totalIn - totalOut),
        peak: round2(peak), low: round2(low), daysWithMovement,
      },
      days,
    };
  },

  async getReorderList(query = {}) {
    const { docs } = await this.getOverview(query);
    return docs
      .filter((r) => ['OUT_OF_STOCK', 'REORDER', 'LOW'].includes(r.status))
      .sort((a, b) => (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9));
  },

  /** The measured 90-day rate for one SKU, for the single-item endpoints. */
  async _measuredAdcForSku(skuId) {
    const map = await imsService._consumptionBySku90d([skuId]);
    return adcFrom(map.get(String(skuId)));
  },

  // ── Policy CRUD ────────────────────────────────────────────────────────────
  async getPolicy(skuId) {
    const policy = await InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } }).lean();
    if (!policy) return null;
    // Resolve the max level here too, so the dialog opens knowing whether this
    // SKU's Max Level follows the Safety Factor or overrides it — and against the
    // SAME rate the stock list plans with, measured where there is history.
    const measuredAdc = await this._measuredAdcForSku(skuId);
    const active = resolveActiveAdc(policy, measuredAdc);
    return {
      ...policy,
      ...resolveMaxLevel(policy, active.adc),
      ...active,
      consumption90dDays: CONSUMPTION_WINDOW_DAYS,
    };
  },

  async upsertPolicy(skuId, data, user) {
    const sku = await SKU.findById(skuId).select('code name unit category itemType').lean();
    if (!sku) throw new AppError('SKU not found', 404);
    // Second line of defence: the route already runs rmPolicySchema, but the
    // range must hold for any other caller too — never trust the input control
    // alone. A Safety Factor below 1 makes the safety stock negative.
    if (data.safetyFactor !== undefined) {
      const check = checkSafetyFactor(data.safetyFactor);
      if (!check.ok) throw new AppError(check.message, 422);
      data = { ...data, safetyFactor: check.value };
    }
    const set = {
      skuCode: sku.code, skuName: sku.name, unit: sku.unit, category: sku.category || '', itemType: sku.itemType,
      adcLow: data.adcLow, adcNormal: data.adcNormal, adcPeak: data.adcPeak,
      consumptionMode: data.consumptionMode,
      averageDailyConsumption: data.averageDailyConsumption,
      leadDays: data.leadDays, safetyFactor: data.safetyFactor,
      moq: data.moq, maxLevel: data.maxLevel, maxLevelMode: data.maxLevelMode,
      materialInTransit: data.materialInTransit, bookedQty: data.bookedQty,
      vendorName: data.vendorName, rate: data.rate,
      convertedItemName: data.convertedItemName, remarks: data.remarks,
      updatedBy: user?._id,
    };
    // Switching a SKU back to AUTO leaves the old maxLevel on disk untouched —
    // the flag alone decides which number is used, so flipping back to MANUAL
    // restores the previous override.
    if (data.openingStock !== undefined) set.openingStock = data.openingStock;

    // A row written before maxLevelMode existed is read by inference, and that
    // inference compares the stored max level against ADC × lead × SF. Editing
    // any of those three would move the goalposts and could silently re-read a
    // formula-derived value as a manual override. So when the caller does not
    // state a mode, freeze the inference as it stands *before* this edit lands.
    if (set.maxLevelMode === undefined) {
      const existing = await InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } })
        .select('maxLevel maxLevelMode averageDailyConsumption adcLow adcNormal adcPeak consumptionMode leadDays safetyFactor').lean();
      if (existing && existing.maxLevelMode === undefined) {
        // Inferred against the rate the row is actually planned with, measured
        // included — the same one resolveMaxLevel is given on every read path.
        const existingAdc = resolveActiveAdc(existing, await this._measuredAdcForSku(skuId)).adc;
        set.maxLevelMode = resolveMaxLevel(existing, existingAdc).maxLevelMode;
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
    const measuredAdc = await this._measuredAdcForSku(skuId);
    const active = resolveActiveAdc(policy, measuredAdc);
    return {
      ...policy,
      ...resolveMaxLevel(policy, active.adc),
      ...active,
      consumption90dDays: CONSUMPTION_WINDOW_DAYS,
    };
  },

  // ── Stock-In (manual receipt / opening / correction) ───────────────────────
  async receive(payload, user) {
    const items = (payload.items || []).filter((i) => Number(i.quantity) > 0);
    if (!items.length) throw new AppError('Add at least one item with a quantity.', 400);
    // Second line of defence: the route already runs rmReceiveSchema, but the
    // OTHER-needs-text rule must hold for any other caller too. checkStockInReason
    // also maps RM's older VENDOR / OPENING / CORRECTION codes forward, so an
    // older client build keeps working unchanged.
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

    // One unit of work: every line lands or none does, and a replayed submission
    // is recognised by its request id rather than adding stock twice. Same
    // helper Consumables and Finished Goods post through.
    return inventoryService.runStockEntry({
      items,
      clientRequestId: payload.clientRequestId,
      meta: { sourceModule: 'RM_IMS', action: 'receive', performedBy: user?._id },
      write: async (it, session) => {
        const { movement, stock } = await inventoryService.increaseStock({
          skuId: it.skuId, quantity: Number(it.quantity), unitCost: Number(it.unitCost || 0),
          // The weight beside the pieces, when the slip stated one (circles).
          // Left undefined for coils, whose quantity already IS their weight.
          quantityKg: it.quantityKg,
          batchNo: it.batchNo || '', warehouse: payload.warehouse,
          txnType, sourceModule: 'RM_IMS', refType: 'RM_RECEIPT', refNumber: payload.reference || '',
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
    // runs rmIssueSchema, but the OTHER-needs-text rule must hold for any caller.
    // Every reason here is a genuine consumption, so the txnType stays
    // CONSUME_OUT and what a future ADC measures is completely unchanged.
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
      meta: { sourceModule: 'RM_IMS', action: 'issue', performedBy: user?._id },
      preflight: async (lines, session) => {
        if (allowNegative) return;
        // Checked against the warehouse the movement will actually come out of,
        // so this can never pass where the stock engine would refuse. The old
        // check ignored the warehouse entirely and summed nothing.
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
          skuId: it.skuId, quantity: Number(it.quantity), quantityKg: it.quantityKg, warehouse,
          txnType: TXN_TYPE.CONSUME_OUT, sourceModule: 'RM_IMS',
          refType: 'RM_ISSUE', refNumber: payload.reference || '',
          reason, customReason,
          remarks: [reasonText, context, it.remarks].filter(Boolean).join(' · '),
          performedBy: user, movementDate, clientRequestId: payload.clientRequestId,
        }, { allowNegative, session });
        return { skuId: it.skuId, movementNumber: movement.movementNumber, balanceAfter: stock.qtyOnHand };
      },
    });
  },

  // ── Coil → Circle conversion (blanking) ─────────────────────────────────────

  /**
   * The conversion a submission produced, if it produced one.
   *
   * `waitMs` covers the window where a replay overtakes the request it is a
   * replay of: the first is still inside its transaction, so the document is
   * not visible yet. Polls briefly rather than failing the second request.
   */
  async _findBySubmission(key, { waitMs = 0 } = {}) {
    if (!key) return null;
    const deadline = Date.now() + waitMs;
    for (;;) {
      const doc = await CoilConversion.findOne({ clientRequestId: key, isDeleted: { $ne: true } }).lean();
      if (doc || Date.now() >= deadline) return doc || null;
      await new Promise((r) => { setTimeout(r, 150); });
    }
  },

  /**
   * Cut one coil into circles.
   *
   * Three kinds of write happen here: the coil leaves stock, each circle size
   * enters it, and a CoilConversion records the cut. They used to run one after
   * another with nothing tying them together, so a failure part way through —
   * a bad circle SKU on the third line, a dropped connection — left the coil
   * consumed, some circles produced, and no document to explain either. The
   * ledger could not be reconciled back and only a manual adjustment could fix
   * it. A double-click had the same effect twice.
   *
   * Now the whole cut is one unit of work, and a submission is claimed before
   * any of it runs:
   *
   *   • claim   — the id the screen minted for this submission. A replay is
   *               answered with the conversion the first request produced.
   *   • atomic  — every write shares one session, so all of them land or none
   *               does. On a standalone mongod, which has no transactions, the
   *               work still runs and the engine logs that it is not atomic.
   *   • release — a claim is given back when the work fails, so a corrected
   *               retry of a rejected cut is not locked out.
   *
   * The stock guards moved inside the session too. Read outside it, they were a
   * snapshot from before the writes: two operators cutting the same coil could
   * both pass a check for the weight only one of them could have.
   */
  /**
   * Find the one goods receipt a batch number names — or refuse.
   *
   * Called only when the caller did not name a receipt itself and did not ask
   * for the manual fallback. It is deliberately the strictest of the three
   * paths, because it is the only one where the system is choosing the coil on
   * someone's behalf:
   *
   *   exactly one match  → bind it. The batch number did identify one coil.
   *   no match           → refuse. There is nothing to bind, and guessing
   *                        would be the orphan this whole change removes.
   *   several matches    → refuse, and NAME them. A batch number that answers
   *                        for two receipts has stopped being an identifier,
   *                        so the operator picks; the system must not.
   *
   * Scoped to (batchNo, skuId) and to GRN_IN, which is the pair the ledger is
   * indexed on — the same scope `listReceivedCoils` derives availability over,
   * so the picker and this resolver can never disagree about which receipts
   * exist for a batch.
   *
   * The second query is the case-insensitive retry, and it runs ONLY when the
   * exact match found nothing: an anchored case-insensitive regex cannot use
   * the index, so it must not be the common path. Operators type batch numbers
   * off a label in whatever case the label uses.
   */
  async _resolveCoilReceipt(coil, rawBatchNo, session) {
    const batchNo = String(rawBatchNo || '').trim();
    const pick = (session ? (q) => q.session(session) : (q) => q);

    if (!batchNo) {
      throw new AppError(
        `Pick the received coil being cut, or enter its batch number — a cut has to say which physical coil of ${coil.code} it came off. `
        + 'If this coil genuinely has no goods receipt, tick "No receipt available" and the cut will be recorded as untraceable.',
        400,
      );
    }

    const base = { skuId: coil._id, txnType: TXN_TYPE.GRN_IN, isDeleted: { $ne: true } };
    const fields = 'movementNumber batchNo skuId skuCode skuName unit quantity unitCost warehouse txnType movementDate refType refId refNumber poNumber piNumber vendorName';

    let matches = await pick(InventoryMovement.find({ ...base, batchNo }).select(fields)).lean();
    if (!matches.length) {
      const anchored = new RegExp(`^${batchNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      matches = await pick(InventoryMovement.find({ ...base, batchNo: anchored }).select(fields)).lean();
    }

    if (matches.length === 1) return matches[0];

    if (!matches.length) {
      throw new AppError(
        `No goods receipt of ${coil.code} carries batch number "${batchNo}", so this cut cannot be traced to a physical coil. `
        + 'Check the batch number, or tick "No receipt available" to record the cut as untraceable on purpose.',
        400,
      );
    }

    throw new AppError(
      `Batch number "${batchNo}" matches ${matches.length} goods receipts of ${coil.code} `
      + `(${matches.map((m) => m.movementNumber).filter(Boolean).join(', ')}), so it does not identify one coil. `
      + 'Pick the exact receipt from the coil list.',
      409,
    );
  },

  async convert(payload, user) {
    const coil = await SKU.findById(payload.coilSkuId).select('code name unit itemType').lean();
    if (!coil) throw new AppError('Coil SKU not found', 404);
    // `let`: a FULL round is re-resolved inside the session to exactly what
    // the coil has left (see below), so the stored weight is the ledger's.
    let coilWeight = Number(payload.coilWeightKg || 0);
    if (coilWeight <= 0) throw new AppError('Coil weight must be greater than zero.', 400);
    /**
     * The operator's choice for THIS round: FULL ("cut everything left") or
     * PARTIAL ("cut the weight I typed"). Null for a caller that sends neither,
     * which behaves exactly as every cut did before this existed.
     */
    const cuttingTypeRaw = String(payload.cuttingType || '').trim().toUpperCase();
    const cuttingType = ['FULL', 'PARTIAL'].includes(cuttingTypeRaw) ? cuttingTypeRaw : null;
    if (cuttingTypeRaw && !cuttingType) throw new AppError('Cutting type must be FULL or PARTIAL.', 400);

    const circles = (payload.circles || []).filter((c) => c.circleSkuId && Number(c.weightKg) > 0);
    if (!circles.length) throw new AppError('Add at least one produced circle (with weight).', 400);

    const conversionDate = payload.conversionDate ? new Date(payload.conversionDate) : new Date();
    const allowNegative = !!payload.allowNegative;
    /**
     * "This coil genuinely has no goods receipt behind it."
     *
     * The escape hatch for the 22 coils received without a batch number and for
     * any cut that predates the receipt, and it has to stay — but it is now a
     * DELIBERATE choice rather than what happens by default when a lookup
     * quietly returned nothing. That inversion is the whole of Phase 1: a cut
     * that could have named its coil is no longer allowed to lose it silently.
     */
    const manualFallback = !!payload.manualFallback;
    // "Full" means "everything this physical coil has left" — a cut that names
    // no coil has no such figure, so there is nothing for FULL to resolve to.
    if (cuttingType === 'FULL' && manualFallback) {
      throw new AppError('Full cutting needs the physical coil (its batch number): a full cut takes exactly what that coil has left. Use Partial cutting for a cut with no receipt.', 400);
    }

    /* ── Is this coil approved to produce these circles? ──
     *
     * The client's mapping sheet, enforced here and not only in the dropdown:
     * the screen filters the options, but an API caller - a script, a retry
     * with an edited body, a second client - never sees that filter.
     *
     * Deliberately BEFORE the submission claim and before the transaction, so a
     * refused combination moves no stock and burns no idempotency key: a cut
     * corrected and re-sent under the same id must still be accepted.
     *
     * One read for every row at once, so a fourth circle row costs no extra
     * query. The per-circle SKU.findById inside the session stays as it is -
     * that one is the read the WRITE is built from, under the same lock as the
     * stock it posts.
     */
    const circleIdsForCheck = [...new Set(circles.map((c) => String(c.circleSkuId)))];
    const circleSkusForCheck = await SKU.find({ _id: { $in: circleIdsForCheck } })
      .select('code').lean();
    // A circle id that matches no SKU is NOT judged here. It is left to the
    // in-session lookup, which already answers it with "Circle SKU <id> not
    // found" - a clearer message than calling an item that does not exist
    // unapproved, and the existing behaviour for that case.
    const mapVerdict = checkCirclesAgainstCoil(coil.code, circleSkusForCheck.map((s) => s.code));
    if (!mapVerdict.ok) throw new AppError(describeCircleMapRefusal(mapVerdict), 400);

    /* ── Does every circle carry a piece count? ──
     *
     * Checked here, before the coil is touched, for the same reason as the
     * mapping above: it needs nothing from the database, so there is no excuse
     * for asking it AFTER the CONVERT_OUT. It used to be asked only inside the
     * loop below, once the coil had already been consumed — which leaned on
     * the transaction to undo the deduction. Where there is no transaction (a
     * standalone mongod, where runAtomically degrades), the refused cut left
     * the coil short by its full weight with no conversion to explain it.
     *
     * rmConvertSchema already refuses this at the route; this covers every
     * caller that reaches the service another way. The in-loop check stays as
     * the last line of defence.
     */
    const codeById = new Map(circleSkusForCheck.map((s) => [String(s._id), s.code]));
    const noPieces = circles.find((c) => !(Number(c.pcs || 0) > 0));
    if (noPieces) {
      const code = codeById.get(String(noPieces.circleSkuId)) || 'every circle';
      throw new AppError(`Enter the number of pieces produced for ${code}. Circles are stocked in pieces.`, 400);
    }

    // ── Has this exact submission already been saved? ──
    const key = inventoryService.ledgerText(payload.clientRequestId);
    const claim = await inventoryService.claimRequestKey(key, {
      sourceModule: 'RM_IMS', action: 'convert', performedBy: user?._id,
    });
    if (claim.replay) {
      // The work IS done, or is being done right now by the request that got
      // here first. Either way this one must not cut the coil again.
      //
      // A double-click is the common case and the two requests are milliseconds
      // apart, so the first is usually still inside its transaction when the
      // second arrives and there is nothing to hand back yet. Waiting briefly
      // turns that into the answer the operator expects rather than an error
      // about a cut that did in fact save.
      const prior = await this._findBySubmission(key, { waitMs: 1500 });
      if (prior) return prior;
      throw new AppError('This conversion is already being saved. Give it a moment, then refresh.', 409);
    }

    try {
      // Taken before the transaction on purpose: a rolled-back cut leaves a gap
      // in the numbering, which is harmless, where a number issued inside the
      // session would be handed out twice.
      const conversionNumber = await generateDocNumber('RM_CONVERSION', conversionDate).catch(() => `RMC-${Date.now()}`);

      const saved = await inventoryService.runAtomically(async (session) => {
        /* ── Preflight, inside the session ── */

        // When a physical coil was named, check THAT coil, not just the item.
        // The item-level guard below asks "does the plant hold this much of this
        // grade?", which a cut can pass while the coil in the operator's hands
        // is already spent: 479 of 501 received coils are cut away to nothing
        // while their grade still shows thousands of kilos in stock.
        /**
         * ── WHICH PHYSICAL COIL IS BEING CUT ──────────────────────────────
         *
         * Three ways in, in strict order of how much they can be trusted:
         *
         *   1. the caller named the receipt      — authoritative, always wins
         *   2. nobody named one, so resolve it   — and ONLY if exactly one
         *                                          receipt answers to this
         *                                          batch number on this sku
         *   3. the caller said there is none     — an explicit, visible choice
         *
         * What is NOT here any more is the fourth way, which used to be the
         * default: send no receipt, send no explanation, and get an orphan
         * conversion whose scrap can never be traced to the coil it came off.
         * The screen only sent `coilReceiptId` when the typed batch text still
         * matched the picked coil's character for character, so correcting a
         * digit after picking a coil silently threw the lineage away.
         *
         * The resolution is a READ INSIDE THE SESSION, like every other guard
         * in this transaction, so the receipt it binds is the receipt whose
         * balance is checked a few lines down.
         */
        let receipt = null;
        let receiptBinding = 'EXPLICIT';

        if (payload.coilReceiptId) {
          receipt = await InventoryMovement.findOne({
            _id: payload.coilReceiptId, isDeleted: { $ne: true },
          }).session(session).lean();
          if (!receipt) throw new AppError('That received coil no longer exists. Search for it again.', 404);
        } else if (manualFallback) {
          // Nothing to bind, and that is what the operator said. The cut is
          // recorded unlinked and reports as Untraceable, which is honest.
          receiptBinding = 'MANUAL_FALLBACK';
        } else {
          receipt = await rmImsService._resolveCoilReceipt(coil, payload.batchNo, session);
          receiptBinding = 'AUTO';
        }

        // FULL with no coil bound (neither named nor resolvable) has nothing to
        // resolve to. manualFallback is refused before the session; this is
        // the same rule for any other way of arriving without a receipt.
        if (cuttingType === 'FULL' && !receipt) {
          throw new AppError('Full cutting needs the physical coil (its batch number).', 400);
        }

        if (receipt) {
          // Checked for EVERY receipt, however it arrived — an id posted by a
          // script gets the same scrutiny as one the picker chose.
          if (receipt.txnType !== TXN_TYPE.GRN_IN) {
            throw new AppError('The reference given is not a goods receipt, so it does not identify a coil.', 400);
          }
          if (String(receipt.skuId) !== String(coil._id)) {
            throw new AppError(`That coil is ${receipt.skuCode}, not ${coil.code}. Pick the coil again.`, 400);
          }
          if (!receipt.batchNo) {
            throw new AppError('That receipt carries no batch number, so the coil cannot be identified. Use manual selection instead.', 400);
          }

          // A FULL round always needs the coil's balance, override or not —
          // it is the number a full cut resolves to.
          if (!allowNegative || cuttingType === 'FULL') {
            const bal = await InventoryMovement.aggregate([
              { $match: { batchNo: receipt.batchNo, skuId: receipt.skuId, isDeleted: { $ne: true } } },
              {
                $group: {
                  _id: null,
                  inQty: { $sum: { $cond: [{ $eq: ['$movementType', MOVEMENT_TYPE.IN] }, '$quantity', 0] } },
                  outQty: { $sum: { $cond: [{ $eq: ['$movementType', MOVEMENT_TYPE.OUT] }, '$quantity', 0] } },
                },
              },
            ]).session(session);
            const available = round2(Number(bal[0]?.inQty || 0) - Number(bal[0]?.outQty || 0));

            /**
             * ── FULL CUTTING: the server decides the weight ────────────────
             *
             * "Full" means every kilogram this physical coil has left, by the
             * batch ledger, read here inside the session. The weight the
             * screen sent is NOT trusted to be that figure — it is CHECKED
             * against it. A mismatch means the screen was stale (another round
             * was saved since it loaded), and the circles the operator weighed
             * were weighed against a coil that is no longer that size, so the
             * cut is refused rather than quietly re-sized under them.
             */
            if (cuttingType === 'FULL') {
              if (available <= EPS) {
                throw new AppError(`Physical coil ${receipt.batchNo} is already fully cut — 0 KG remaining, so there is nothing left for a full cut.`, 400);
              }
              if (Math.abs(coilWeight - available) > EPS) {
                throw new AppError(
                  `Physical coil ${receipt.batchNo} now has ${kgText(available)} KG remaining, not ${kgText(coilWeight)} KG — it changed since the form loaded. Enter the batch number again to refresh, then save the full cut.`,
                  409,
                );
              }
              coilWeight = available;
            }

            if (!allowNegative && coilWeight > available) {
              throw new AppError(
                // Worded for the operator holding the coil: what this physical
                // coil still has, against what this ROUND tried to take.
                available > 0
                  ? `Only ${kgText(available)} KG is available from this physical coil (${receipt.batchNo}), but ${kgText(coilWeight)} KG was entered for this round. Cut less, or turn on "Allow cutting more coil than we hold".`
                  : `Physical coil ${receipt.batchNo} is fully cut — 0 KG is available. Turn on "Allow cutting more coil than we hold" to override.`,
                400,
              );
            }
          }
        }

        // The item as a whole. Summed across warehouses, the way getOverview and
        // every reconciliation in this module read a SKU's stock — a single row
        // is one of three and can be deeply negative on its own.
        if (!allowNegative) {
          const coilStocks = await InventoryStock.find({ skuId: coil._id }).session(session).lean();
          const onHand = round2(Number(combineStockRows(coilStocks)?.qtyOnHand || 0));
          if (coilWeight > onHand) {
            throw new AppError(`Not enough coil stock for ${coil.code} (on hand ${onHand}). Tick "allow negative" to override.`, 400);
          }
        }

        // The coil's own identity and its own price win over anything typed.
        const batchNo = receipt ? receipt.batchNo : (payload.batchNo || '');
        const rate = receipt && !(Number(payload.rate) > 0)
          ? round2(receipt.unitCost)
          : Number(payload.rate || 0);

        /* ── 1) Consume the coil ── */
        // A coil is stocked BY WEIGHT, so its `quantity` already is its kilograms
        // — there is no second measure to record and quantityKg stays unset. Only
        // circles, which are stocked by piece, carry a separate weight.
        const { movement: coilMov } = await inventoryService.decreaseStock({
          skuId: coil._id, skuCode: coil.code, skuName: coil.name, unit: coil.unit,
          quantity: coilWeight, warehouse: payload.warehouse,
          txnType: TXN_TYPE.CONVERT_OUT, sourceModule: 'RM_IMS', refType: 'RM_CONVERSION', refNumber: conversionNumber,
          batchNo, clientRequestId: key,
          remarks: `Coil consumed for circle conversion${batchNo ? ` · batch ${batchNo}` : ''}`,
          performedBy: user, movementDate: conversionDate,
        }, { allowNegative, session });

        /* ── 2) Produce each circle SKU ── */
        const producedRows = [];
        let circlesWeight = 0;
        for (const c of circles) {
          const circleSku = await SKU.findById(c.circleSkuId).select('code name unit').session(session).lean();
          if (!circleSku) throw new AppError(`Circle SKU ${c.circleSkuId} not found`, 404);
          const pcs = Number(c.pcs || 0);
          const wt = Number(c.weightKg || 0);
          // Both figures are required by rmConvertSchema, so neither can be
          // missing here. The guard stays as a second line of defence for any
          // other caller: this used to be `pcs > 0 ? pcs : wt`, which silently
          // posted KILOGRAMS into a balance counted in PIECES whenever a piece
          // count was absent.
          if (!(pcs > 0)) {
            throw new AppError(`Enter the number of pieces produced for ${circleSku.code}. Circles are stocked in pieces.`, 400);
          }
          circlesWeight = round2(circlesWeight + wt);
          const { movement: circMov } = await inventoryService.increaseStock({
            skuId: circleSku._id, skuCode: circleSku.code, skuName: circleSku.name, unit: circleSku.unit || 'PCS',
            // PIECES is the stock quantity; the weight rides alongside in its own
            // field and is what yield and scrap are worked out from.
            quantity: pcs, quantityKg: wt, unitCost: rate,
            warehouse: payload.warehouse,
            txnType: TXN_TYPE.CONVERT_IN, sourceModule: 'RM_IMS', refType: 'RM_CONVERSION', refNumber: conversionNumber,
            batchNo, clientRequestId: key,
            remarks: `Circles produced from ${coil.code}${batchNo ? ` · batch ${batchNo}` : ''}`,
            performedBy: user, movementDate: conversionDate,
          }, { session });
          producedRows.push({
            circleSkuId: circleSku._id, circleSkuCode: circleSku.code, circleSkuName: circleSku.name,
            sizeLabel: c.sizeLabel || '', pcs, weightKg: wt,
            movementId: circMov._id, movementNumber: circMov.movementNumber,
          });
        }

        /* ── 3) Record the cut ── */
        const scrapKg = round2(coilWeight - circlesWeight);
        const yieldRatioPct = coilWeight > 0 ? round2((circlesWeight / coilWeight) * 100) : 0;

        const [doc] = await CoilConversion.create([{
          conversionNumber, conversionDate,
          batchNo,
          coilSkuId: coil._id, coilSkuCode: coil.code, coilSkuName: coil.name,
          coilWeightKg: coilWeight, rate,
          circles: producedRows,
          circlesWeightKg: circlesWeight, scrapKg, yieldRatioPct,
          scrapVerified: payload.scrapVerified || 'PENDING',
          coilMovementId: coilMov._id, coilMovementNumber: coilMov.movementNumber,
          // Null unless a physical coil was named — see the model.
          coilReceiptId: receipt ? receipt._id : null,
          coilReceiptNumber: receipt ? (receipt.movementNumber || '') : '',
          // Undefined, not '', so the unique index stays sparse for callers
          // that send no id.
          clientRequestId: key || undefined,
          // The operator's instruction for this round; undefined when none was
          // given, so older callers write exactly what they always did.
          cuttingType: cuttingType || undefined,
          remarks: payload.remarks || '',
          createdBy: user?._id,
        }], session ? { session } : undefined);

        /**
         * ── 4) Record the scrap ──
         *
         * The cut already knows everything about its own scrap — how much, what
         * yield, whether it was checked — and stores it on the conversion.
         * Nothing carried that into the Scrap module, so a cut keyed into the
         * app produced a scrapKg the Scrap dashboard, register and detail never
         * saw: their figures simply stopped moving while the ledger went on.
         *
         * One ScrapRecord per cut, in the same session, so it lands with the
         * conversion or not at all.
         *
         * ── AND, FOR AN IN-HOUSE CUT, ONE SCRAP_IN ─────────────────────────
         * An in-house cut leaves a physical heap of offcuts in the plant, so it
         * also posts the scrap INTO scrap stock (see below the create).
         *
         * That is not a double deduction, and the distinction matters: the
         * CONVERT_OUT above took the coil's WHOLE weight off the COIL sku —
         * circles and offcut alike. This puts the offcut back on a DIFFERENT
         * sku, the scrap one. Nothing leaves the coil twice; the weight that
         * used to vanish from the ledger now lands somewhere.
         *
         * A JOB-WORK cut posts nothing. Those offcuts stay with the job worker
         * and were never stock Ambika held — 229,774 of the 246,679 kg on
         * record are exactly that, which is why this is a rule and not a
         * convenience.
         */
        const scrapLocation = resolveScrapLocation(receipt, payload.warehouse);
        const [scrapDoc] = await ScrapRecord.create([{
          // No sourceRef — that identity belongs to the workbook import and
          // this record did not come from there.
          batchNo,
          scrapDate: conversionDate,
          // The coil's own receipt location, or the one the operator chose.
          // PLG01 stands in only when a caller sent no cutting location at all,
          // and the remark below says so rather than implying certainty.
          location: scrapLocation || 'PLG01',
          coilSkuId: coil._id, coilSkuCode: coil.code, coilSkuName: coil.name,
          coilWeightKg: coilWeight,
          circlesWeightKg: circlesWeight,
          scrapKg,
          yieldRatioPct: coilWeight > 0 ? yieldRatioPct : null,
          // The same vocabulary the conversion uses, carried across unchanged.
          // Verification is not decided here: S1 records the cut, it does not
          // introduce a workflow.
          disposition: payload.scrapVerified || 'PENDING',
          // The conversion carries no verification date, so there is none.
          verifiedAt: null,
          coilRate: rate,
          batchStatus: circlesWeight > 0 ? 'CUT' : 'UNCUT',
          conversionId: doc._id,
          conversionNumber: doc.conversionNumber,
          coilReceiptId: receipt ? receipt._id : null,
          clientRequestId: key || undefined,
          remarks: scrapLocation ? '' : 'Cutting location was not recorded on this conversion; defaulted to PLG01.',
          createdBy: user?._id,
        }], session ? { session } : undefined);

        /* ── 5) Put in-house scrap into scrap stock ── */
        const cutLocation = scrapLocation || 'PLG01';
        const cutProducedScrap = circlesWeight > 0 && scrapKg > 0;
        if (cutLocation === 'PLG01' && cutProducedScrap) {
          // Resolved inside the transaction but never created here: a missing
          // scrap item is a configuration problem and must fail the cut loudly
          // rather than conjure master data mid-write.
          const scrapSku = await resolveScrapSku();
          const { movement: scrapMov } = await inventoryService.increaseStock({
            skuId: scrapSku._id,
            skuCode: scrapSku.code,
            skuName: scrapSku.name,
            unit: scrapSku.unit || SCRAP_UNIT,
            quantity: scrapKg,
            warehouse: cutLocation,
            txnType: TXN_TYPE.SCRAP_IN,
            sourceModule: 'RM_IMS',
            // Points at the conversion, not at the scrap record: the cut is the
            // event, and it is what the RM screens already link to.
            refType: 'RM_CONVERSION',
            refId: doc._id,
            refNumber: doc.conversionNumber,
            reason: 'CUTTING_OFFCUT',
            remarks: `Offcut from cut ${doc.conversionNumber} · coil ${coil.code} · batch ${batchNo || '—'}`,
            batchNo: batchNo || '',
            performedBy: user,
            movementDate: conversionDate,
            clientRequestId: key || undefined,
            // No unitCost — scrap has no rate anywhere in the client's source.
          }, { session });

          // The audit link back: "this cut is why scrap stock moved".
          scrapDoc.stockMovementId = scrapMov._id;
          await scrapDoc.save(session ? { session } : undefined);
        }

        // `receiptBinding` is NOT a stored field and deliberately so — it
        // describes how THIS request arrived at its coil, not a property of the
        // cut. `coilReceiptId` on the document already records the only part
        // that matters afterwards: whether the lineage exists. The screen uses
        // this to say "we linked this to coil X for you" on an auto-bind.
        return { ...doc.toObject(), receiptBinding };
      });

      // One coil out, one row per circle in.
      if (claim.claimed) await inventoryService.settleRequestKey(key, 1 + circles.length);
      return saved;
    } catch (e) {
      // Request keys are disposable — they expire after seven days. A retry
      // that arrives later than that gets past the claim and is caught by the
      // unique index instead. The cut is already recorded, so this is a replay
      // with a different shape, not a failure: hand back what was saved.
      if (e?.code === 11000 && e?.keyPattern?.clientRequestId) {
        const prior = await this._findBySubmission(key);
        if (prior) return prior;
      }
      // The cut did not happen, so its id must not lock out the corrected retry.
      if (claim.claimed) await inventoryService.releaseRequestKey(key);
      throw e;
    }
  },


  async listConversions(query = {}) {
    const filter = { isDeleted: { $ne: true } };
    if (query.search) {
      const r = rx(query.search);
      filter.$or = [{ conversionNumber: r }, { batchNo: r }, { coilSkuCode: r }, { coilSkuName: r }];
    }
    const limit = Math.min(Number(query.limit) || 100, 500);
    // The rows shown are a PAGE; the totals are not. They used to be summed from
    // that page, so "coil consumed" and "average yield" silently described the
    // newest 50 cuts while claiming to describe all of them — unnoticeable while
    // one conversion existed, an order of magnitude out once the history landed.
    // The totals now come from their own aggregation over the whole filtered set.
    const [docs, agg] = await Promise.all([
      CoilConversion.find(filter).sort({ conversionDate: -1, createdAt: -1 }).limit(limit).lean(),
      CoilConversion.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            coilKg:   { $sum: '$coilWeightKg' },
            circlesKg: { $sum: '$circlesWeightKg' },
            scrapKg:  { $sum: '$scrapKg' },
            // Averaged per CUT, so a batch that produced six circle sizes counts
            // once — the same weight every other batch gets.
            avgYield: { $avg: '$yieldRatioPct' },
            count:    { $sum: 1 },
          },
        },
      ]),
    ]);
    /**
     * Where each cut's coil came from.
     *
     * A row can say "batch TX89165708" on its own, but a batch number does not
     * tell anyone which delivery it arrived on, from whom, or at what price.
     * Conversions that recorded the exact receipt carry that link, so it is
     * resolved here — one extra query for the whole page — and the history can
     * trace a cut back to its goods receipt. Rows without a link (every
     * historical cut, and any booked by item alone) simply get null.
     */
    const receiptIds = docs.map((d) => d.coilReceiptId).filter(Boolean);
    if (receiptIds.length) {
      const receipts = await InventoryMovement.find({ _id: { $in: receiptIds } })
        .select('movementNumber batchNo refType refNumber poNumber piNumber vendorName unitCost movementDate warehouse')
        .lean();
      const byId = new Map(receipts.map((m) => [String(m._id), m]));
      for (const d of docs) {
        const m = d.coilReceiptId ? byId.get(String(d.coilReceiptId)) : null;
        d.receipt = m
          ? {
            movementNumber: m.movementNumber,
            batchNo: m.batchNo,
            grnNumber: m.refType === 'GRN' ? (m.refNumber || '') : '',
            poNumber: m.poNumber || '',
            piNumber: m.piNumber || '',
            supplier: m.vendorName || '',
            unitCost: round2(m.unitCost),
            receivedDate: m.movementDate,
            warehouse: m.warehouse || '',
          }
          : null;
      }
    } else {
      for (const d of docs) d.receipt = null;
    }

    const a = agg[0] || {};
    return {
      docs,
      totals: {
        coilKg: round2(a.coilKg || 0),
        circlesKg: round2(a.circlesKg || 0),
        scrapKg: round2(a.scrapKg || 0),
        avgYield: round2(a.avgYield || 0),
        // How many of the listed cuts can be traced back to a goods receipt.
        traceable: docs.filter((d) => d.receipt).length,
        // How many cuts the totals cover, so the screen can say so rather than
        // letting the reader assume they match the rows below.
        conversionCount: a.count || 0,
        shown: docs.length,
      },
    };
  },

  /** Movement history scoped to RM (coil + circle) SKUs. */
  async getMovements(query = {}) {
    const skus = await SKU.find({ itemType: { $in: RM_ITEM_TYPES }, isDeleted: { $ne: true } }).select('_id').lean();
    const ids = skus.map((s) => s._id);
    const filter = { skuId: { $in: ids }, isDeleted: { $ne: true } };
    if (query.search) {
      const r = rx(query.search);
      filter.$or = [{ movementNumber: r }, { skuCode: r }, { skuName: r }, { refNumber: r }, { batchNo: r }];
    }
    if (query.txnType) filter.txnType = query.txnType;
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Number(query.limit) || 50, 200);
    const [docs, total] = await Promise.all([
      InventoryMovement.find(filter).sort({ movementDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      InventoryMovement.countDocuments(filter),
    ]);
    return { docs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  },

  // ── Received coils — the physical coils available to cut ────────────────────

  /**
   * The physical coils this plant has actually received.
   *
   * There is no ReceivedCoil collection and there should not be one: a GRN_IN
   * movement ALREADY is the record of one physical coil arriving. It carries
   * the batch number, the SKU, the weight, the rate actually paid for THAT
   * coil, the location, and the GRN / PO / vendor it came in on. This reads
   * those rows back and hands Cut Coils a row it can fill its form from.
   *
   * One row really is one coil: across every GRN_IN movement for a coil SKU,
   * no (batchNo, skuId) pair occurs twice and no batch number spans two SKUs.
   * The client's own sheet works the same way — GRN AGL/GRN-262/26-27 is eight
   * separate lines, one per coil, each with its own batch number and weight.
   *
   * `availableWeight` is DERIVED, never stored: Σ IN − Σ OUT for that batch.
   * It has to be, because a coil is frequently cut over several sessions — 133
   * of 481 historical batches were — so "received" and "still uncut" are
   * different numbers and only the second one may be offered to the operator.
   *
   * Read-only. This method posts nothing and changes no balance.
   */
  async listReceivedCoils(query = {}) {
    const limit = Math.min(Number(query.limit) || 25, 100);
    const includeConsumed = !!query.includeConsumed;

    // Circles are cut FROM coils, never cut themselves, so only RAW_MATERIAL.
    const allCoilSkus = await SKU.find({ itemType: 'RAW_MATERIAL', isDeleted: { $ne: true } })
      .select('_id code name unit').lean();

    /*
     * Cut Coils asks with `circleMapped`: offer only coils the Coil → Circle
     * sheet lists, because nothing else can be cut there. Opt-in, so Stock In —
     * which uses this same lookup to spot a batch number already received —
     * still sees every coil. A coil left out here is still in RM stock; it is
     * just not cuttable.
     *
     * When a typed batch exists ONLY on a coil left out this way, the lookup
     * says so (`unmappedBatch`), so the screen can explain "this coil has no
     * approved circle sizes" instead of a misleading "not received".
     */
    const coilSkus = query.circleMapped ? allCoilSkus.filter((s) => isCoilMapped(s.code)) : allCoilSkus;
    let unmappedBatch = null;
    const typed = String(query.q || '').trim();
    if (query.circleMapped && typed) {
      const unmappedIds = allCoilSkus.filter((s) => !isCoilMapped(s.code)).map((s) => s._id);
      if (unmappedIds.length) {
        const hit = await InventoryMovement.findOne({
          skuId: { $in: unmappedIds },
          txnType: TXN_TYPE.GRN_IN,
          isDeleted: { $ne: true },
          batchNo: new RegExp(`^${typed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        }).select('batchNo skuCode skuName').lean();
        if (hit) unmappedBatch = { batchNo: hit.batchNo, skuCode: hit.skuCode, skuName: hit.skuName };
      }
    }
    if (!coilSkus.length) {
      return { docs: [], summary: { matched: 0, available: 0, fullyCut: 0, unbatchedReceipts: 0, anomalies: 0, unmappedBatch } };
    }
    const unitBySku = new Map(coilSkus.map((s) => [String(s._id), s.unit || 'KG']));

    const filter = {
      skuId: { $in: coilSkus.map((s) => s._id) },
      txnType: TXN_TYPE.GRN_IN,
      // A receipt with no batch number cannot be identified as a coil, so it is
      // not offered here. Those exist (22 of 523 today) and are exactly why the
      // screen keeps its manual by-SKU fallback.
      batchNo: { $nin: ['', null] },
      isDeleted: { $ne: true },
    };
    if (query.skuId) filter.skuId = new mongoose.Types.ObjectId(query.skuId);
    if (query.warehouse) filter.warehouse = query.warehouse;

    const q = String(query.q || '').trim();
    if (q) {
      const r = rx(q);
      // The indent number lives on the GRN header and is not copied onto the
      // movement, so it is resolved to the GRNs that carry it and matched by
      // reference rather than being guessed at from the movement alone.
      const grns = await GoodsReceiptNote
        .find({ indentNumber: r, isDeleted: { $ne: true } }).select('_id').limit(500).lean();
      filter.$or = [
        { batchNo: r },     // the coil itself — the only identifier unique to one
        { refNumber: r },   // GRN number
        { poNumber: r },
        { piNumber: r },
        { skuCode: r }, { skuName: r }, { vendorName: r },
      ];
      if (grns.length) filter.$or.push({ refType: 'GRN', refId: { $in: grns.map((g) => g._id) } });
    }

    /**
     * Availability is worked out INSIDE the query, not after it.
     *
     * The obvious shape — fetch some receipts, then drop the ones already cut
     * away — is wrong, and measurably so: 378 of the 400 most recent coil
     * receipts are fully consumed, so a fetch-then-filter pass returned 22 of
     * the 23 coils that still have weight and missed the over-cut batch
     * entirely. Whether a coil appeared depended on how many spent ones
     * happened to sort ahead of it. So the ledger join, the availability test
     * and the limit all run in the pipeline, and the counts in `summary`
     * describe the whole matched set rather than the slice that came back.
     */
    const EPS = 0.001; // float noise on a sum of kilograms, not a real balance
    const availabilityMatch = includeConsumed
      ? { availableWeight: { $gte: 0 } }   // spent coils yes, impossible ones no
      : { availableWeight: { $gt: EPS } };

    const [agg] = await InventoryMovement.aggregate([
      { $match: filter },
      { $sort: { movementDate: -1, createdAt: -1 } },
      {
        // Everything that ever happened to this batch — the receipt, the cuts
        // that consumed it, any adjustment. Keyed on the pair, so a batch
        // number reused on another SKU one day could not bleed across.
        $lookup: {
          from: 'inventorymovements',
          let: { b: '$batchNo', s: '$skuId' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$batchNo', '$$b'] }, { $eq: ['$skuId', '$$s'] }] } } },
            { $match: { isDeleted: { $ne: true } } },
            {
              $group: {
                _id: null,
                inQty: { $sum: { $cond: [{ $eq: ['$movementType', MOVEMENT_TYPE.IN] }, '$quantity', 0] } },
                outQty: { $sum: { $cond: [{ $eq: ['$movementType', MOVEMENT_TYPE.OUT] }, '$quantity', 0] } },
                lastOutAt: { $max: { $cond: [{ $eq: ['$movementType', MOVEMENT_TYPE.OUT] }, '$movementDate', null] } },
              },
            },
          ],
          as: 'led',
        },
      },
      {
        $addFields: {
          inQty: { $ifNull: [{ $arrayElemAt: ['$led.inQty', 0] }, 0] },
          outQty: { $ifNull: [{ $arrayElemAt: ['$led.outQty', 0] }, 0] },
          lastOutAt: { $arrayElemAt: ['$led.lastOutAt', 0] },
        },
      },
      { $addFields: { availableWeight: { $subtract: ['$inQty', '$outQty'] } } },
      { $project: { led: 0 } },
      {
        $facet: {
          rows: [{ $match: availabilityMatch }, { $limit: limit }],
          stats: [{
            $group: {
              _id: null,
              matched: { $sum: 1 },
              available: { $sum: { $cond: [{ $gt: ['$availableWeight', EPS] }, 1, 0] } },
              // Cut away to nothing. Real, finished, and not offered again.
              fullyCut: { $sum: { $cond: [{ $and: [{ $lte: ['$availableWeight', EPS] }, { $gte: ['$availableWeight', -EPS] }] }, 1, 0] } },
              // More was cut from the batch than ever arrived — a data fault,
              // not a coil. Counted so it is visible, withheld so nothing is
              // offered with no stock behind it.
              anomalies: { $sum: { $cond: [{ $lt: ['$availableWeight', -EPS] }, 1, 0] } },
            },
          }],
        },
      },
    ]).option({ allowDiskUse: true });

    const receipts = agg?.rows || [];
    const stats = agg?.stats?.[0] || { matched: 0, available: 0, fullyCut: 0, anomalies: 0 };

    const grnIds = receipts.filter((m) => m.refType === 'GRN' && m.refId).map((m) => m.refId);
    const grnDocs = grnIds.length
      ? await GoodsReceiptNote.find({ _id: { $in: grnIds } })
        .select('grnNumber indentNumber piNumber receivedAt grnDate').lean()
      : [];
    const grnBy = new Map(grnDocs.map((g) => [String(g._id), g]));

    const docs = [];
    for (const m of receipts) {
      const available = round2(m.availableWeight);
      const consumed = round2(m.outQty);
      const grn = m.refType === 'GRN' && m.refId ? grnBy.get(String(m.refId)) : null;
      docs.push({
        id: m._id,
        movementId: m._id,
        movementNumber: m.movementNumber,
        batchNo: m.batchNo,
        skuId: m.skuId,
        skuCode: m.skuCode,
        skuName: m.skuName,
        unit: m.unit || unitBySku.get(String(m.skuId)) || 'KG',
        receivedWeight: round2(m.quantity),
        availableWeight: available,
        consumedWeight: consumed,
        // The rate actually paid for THIS coil, off its own receipt — not the
        // planning rate and not the SKU's average cost, which is what the Cut
        // Coils form used to prefill and why its valuation could be wrong.
        unitCost: round2(m.unitCost),
        warehouse: m.warehouse || DEFAULT_WAREHOUSE,
        grnNumber: m.refType === 'GRN' ? (m.refNumber || grn?.grnNumber || '') : '',
        poNumber: m.poNumber || '',
        indentNumber: grn?.indentNumber || '',
        piNumber: m.piNumber || grn?.piNumber || '',
        supplier: m.vendorName || '',
        receivedDate: m.movementDate,
        // True once part of the coil has been cut. The operator needs to see
        // this: the weight on offer is no longer the weight on the label.
        partiallyCut: consumed > 0 && available > 0,
        lastCutAt: m.lastOutAt || null,
      });
    }

    /**
     * The two ways a coil can hold stock and still not be offered here.
     *
     *   unbatchedReceipts    — received without a batch number, so there is
     *                          nothing to identify the coil by (22 today).
     *   batchesWithoutReceipt — a batch that moved but was never received
     *                          through a GRN: a stock adjustment carrying a
     *                          batch label, or a cut booked against a coil with
     *                          no receipt behind it (2 today, one of each).
     *
     * Both are reported so the screen can explain why a coil someone is holding
     * is not in the list, and point at the manual fallback, rather than just
     * appearing to have lost it. Only computed for the unfiltered listing —
     * they describe the data as a whole, not the search, and this method is
     * called on every keystroke.
     */
    let unbatchedReceipts = null;
    let batchesWithoutReceipt = null;
    if (!q) {
      const coilIds = coilSkus.map((s) => s._id);
      const [unbatched, orphans] = await Promise.all([
        InventoryMovement.countDocuments({
          skuId: { $in: coilIds },
          txnType: TXN_TYPE.GRN_IN,
          $or: [{ batchNo: '' }, { batchNo: null }],
          isDeleted: { $ne: true },
        }),
        InventoryMovement.aggregate([
          { $match: { skuId: { $in: coilIds }, batchNo: { $nin: ['', null] }, isDeleted: { $ne: true } } },
          { $group: { _id: { b: '$batchNo', s: '$skuId' }, hasReceipt: { $max: { $cond: [{ $eq: ['$txnType', TXN_TYPE.GRN_IN] }, 1, 0] } } } },
          { $match: { hasReceipt: 0 } },
          { $count: 'n' },
        ]),
      ]);
      unbatchedReceipts = unbatched;
      batchesWithoutReceipt = orphans[0]?.n || 0;
    }

    return {
      docs,
      // Counts over the WHOLE matched set, not over the page that came back, so
      // "22 shown of 23 still uncut" is something the screen can actually say.
      summary: {
        matched: stats.matched,
        available: stats.available,
        fullyCut: stats.fullyCut,
        anomalies: stats.anomalies,
        unbatchedReceipts,
        batchesWithoutReceipt,
        returned: docs.length,
        truncated: docs.length < (includeConsumed ? stats.matched : stats.available),
        // Set only for a circleMapped lookup whose typed batch exists solely on a
        // coil the Coil → Circle sheet does not list.
        unmappedBatch,
      },
    };
  },

  /**
   * ONE PHYSICAL COIL, END TO END — every cut it took, in order.
   *
   * This is the screen the client asked for: open a received coil and see how
   * many times it was cut, how much went into the machine each time, what came
   * out as circles, what was left as scrap, and how much coil remained after
   * every round.
   *
   * ── IT STORES NOTHING AND CACHES NOTHING ───────────────────────────────────
   * Every figure is recomputed from the records that already exist. The round
   * numbers and the running remaining weight are derived in `coilLineage.js`
   * (pure, and unit-tested against the client's worked example); the totals are
   * sums of the same rows. There is no counter to maintain and nothing that can
   * fall out of step with the ledger.
   *
   * ── FIXED QUERY COUNT, WHATEVER THE COIL DID ──────────────────────────────
   * Four reads for a coil cut twice, and four for a coil cut forty times:
   *
   *   1. the receipt          — by _id
   *   2. its GRN              — only for the indent number, which lives on the
   *                             GRN header and is not copied onto the movement
   *   3. its conversions      — by coilReceiptId, which the model indexes
   *   4. their scrap records  — one $in over the conversion ids, which the
   *                             unique partial index on conversionId serves
   *
   * plus one movement read for the batch's ledger, scoped by the existing
   * { batchNo, skuId } index. Nothing loops a query, and nothing reads the
   * movement collection unscoped.
   */
  async getCoilLineage(receiptId) {
    if (!mongoose.Types.ObjectId.isValid(String(receiptId))) {
      throw new AppError('Invalid coil receipt id.', 400);
    }

    const receipt = await InventoryMovement.findOne({ _id: receiptId, isDeleted: { $ne: true } }).lean();
    if (!receipt) throw new AppError('That received coil no longer exists.', 404);
    if (receipt.txnType !== TXN_TYPE.GRN_IN) {
      throw new AppError('That reference is not a goods receipt, so it does not identify a physical coil.', 400);
    }

    const [grn, conversions] = await Promise.all([
      receipt.refType === 'GRN' && receipt.refId
        ? GoodsReceiptNote.findById(receipt.refId).select('grnNumber indentNumber piNumber grnDate receivedAt').lean()
        : null,
      CoilConversion.find({ coilReceiptId: receipt._id, isDeleted: { $ne: true } }).lean(),
    ]);

    const conversionIds = conversions.map((c) => c._id);
    const scrapRecords = conversionIds.length
      ? await ScrapRecord.find({ conversionId: { $in: conversionIds }, isDeleted: { $ne: true } }).lean()
      : [];
    const scrapByConversionId = new Map(scrapRecords.map((s) => [String(s.conversionId), s]));

    const { rounds, totals } = deriveRounds({
      receivedKg: receipt.quantity,
      conversions,
      scrapByConversionId,
    });

    /**
     * The rest of the batch's ledger — everything that is not this receipt and
     * not one of the cuts above.
     *
     * It exists because `remainingKg` and the ledger's own availability are two
     * different questions, and the gap between them is exactly these rows. A
     * stock adjustment against the batch, an issue, or a cut booked by a client
     * that named no receipt all move the ledger without appearing as a round,
     * so showing the derived remaining weight alone would leave an unexplained
     * difference on screen. `ledgerAvailableKg` below is the ledger's answer,
     * reported beside the derived one rather than instead of it.
     */
    const batchMovements = receipt.batchNo
      ? await InventoryMovement.find({
        batchNo: receipt.batchNo, skuId: receipt.skuId, isDeleted: { $ne: true },
      }).sort({ movementDate: 1, createdAt: 1 }).lean()
      : [receipt];

    const roundMovementIds = new Set(
      conversions.map((c) => String(c.coilMovementId)).filter((x) => x && x !== 'null'),
    );
    let inQty = 0;
    let outQty = 0;
    const otherMovements = [];
    for (const m of batchMovements) {
      if (m.movementType === MOVEMENT_TYPE.IN) inQty += Number(m.quantity || 0);
      else outQty += Number(m.quantity || 0);
      if (String(m._id) === String(receipt._id)) continue;
      if (roundMovementIds.has(String(m._id))) continue;
      otherMovements.push({
        movementId: m._id,
        movementNumber: m.movementNumber,
        movementDate: m.movementDate,
        txnType: m.txnType,
        movementType: m.movementType,
        quantity: round2(m.quantity),
        warehouse: m.warehouse || '',
        refType: m.refType || '',
        refNumber: m.refNumber || '',
        reason: m.reason || '',
        remarks: m.remarks || '',
        performedByName: m.performedByName || '',
      });
    }
    const ledgerAvailableKg = round2(inQty - outQty);

    return {
      receipt: {
        movementId: receipt._id,
        movementNumber: receipt.movementNumber,
        batchNo: receipt.batchNo || '',
        skuId: receipt.skuId,
        skuCode: receipt.skuCode || '',
        itemName: receipt.skuName || '',
        unit: receipt.unit || 'KG',
        receivedWeightKg: round2(receipt.quantity),
        unitCost: round2(receipt.unitCost),
        grnNo: receipt.refType === 'GRN' ? (receipt.refNumber || grn?.grnNumber || '') : '',
        poNo: receipt.poNumber || '',
        indentCode: grn?.indentNumber || '',
        piNo: receipt.piNumber || grn?.piNumber || '',
        supplier: receipt.vendorName || '',
        receivedDate: receipt.movementDate,
        warehouse: receipt.warehouse || DEFAULT_WAREHOUSE,
      },
      totals: {
        ...totals,
        /**
         * What the LEDGER says is left, as opposed to `remainingKg`, which is
         * what the cutting rounds account for. They agree on a coil whose only
         * movements are its receipt and its cuts, which is the normal case.
         * When they differ, `otherMovements` is why, and the screen says so
         * instead of quietly showing one number as though it were both.
         */
        ledgerAvailableKg,
        reconciles: Math.abs(ledgerAvailableKg - totals.remainingKg) <= EPS,
        /**
         * The coil as the ledger sees it: `availableKg` (what a new round may
         * cut — the same figure convert() checks), `otherOutKg` (weight that
         * left the batch outside these rounds) and `status`. This, not
         * `totals.status`, is the coil's status: a spreadsheet-era coil with
         * no linked rounds is not "not cut" if its ledger says it is gone.
         */
        coil: ledgerCoilState({
          receivedKg: receipt.quantity,
          roundsCutKg: totals.cutKg,
          ledgerAvailableKg,
        }),
      },
      rounds,
      otherMovements,
    };
  },

  /**
   * CUTTING HISTORY — one row per PHYSICAL COIL, however many rounds it took.
   *
   * The list under the Cut Coils form. Each row is a coil (a GRN_IN receipt),
   * never a conversion: a coil cut four times is one row with `rounds: 4`, and
   * its rounds are the lineage endpoint above, opened on demand.
   *
   * ── WHAT IS AND IS NOT A ROUND ─────────────────────────────────────────────
   * Only a conversion that names its coil (`coilReceiptId`) is a round. The
   * spreadsheet-era cuts and "No receipt available" cuts name none, and are
   * NOT attached to a coil here by matching batch numbers — that would be a
   * guess displayed as a fact. They are counted in `summary.untraceable`
   * instead, exactly as Scrap by Physical Coil does.
   *
   * ── TWO REMAINING FIGURES, ON PURPOSE ──────────────────────────────────────
   *   remainingKg       received − Σ cut in the rounds (the coil's own story)
   *   ledgerAvailableKg Σ IN − Σ OUT on the batch (what convert() will allow)
   * Equal for every coil whose only movements are its receipt and its rounds.
   * Where they differ, `otherOutKg` is the weight that left outside the rounds,
   * and `status` follows the ledger — see `ledgerCoilState` in coilLineage.js.
   *
   * ── SCRAP OWNERSHIP ────────────────────────────────────────────────────────
   * `scrapKg` is the calculated offcut of every round (cut − circles), kept
   * for traceability. It is split by where each round was cut, off the round's
   * own ScrapRecord: `plantScrapKg` (PLG01 — Ambika's scrap stock) and
   * `jobWorkScrapKg` (JW001 — stayed with the job worker, never stock).
   *
   * Read-only and derived: one aggregation, nothing stored.
   */
  async listCuttingHistory(query = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(Math.max(1, Number(query.limit) || 25), 200);

    const post = [];
    const s = String(query.search || '').trim();
    if (s) {
      // Matched against the COIL, after grouping — matching conversions first
      // would sum only the rounds that happened to match and misstate the coil.
      const r = rx(s);
      post.push({
        $match: {
          $or: [
            { 'receipt.batchNo': r }, { 'receipt.skuCode': r }, { 'receipt.skuName': r },
            { 'receipt.movementNumber': r }, { 'receipt.refNumber': r }, { 'receipt.vendorName': r },
          ],
        },
      });
    }
    if (query.location) post.push({ $match: { locations: String(query.location).toUpperCase() } });
    if (query.status) post.push({ $match: { status: String(query.status).toUpperCase() } });

    const [agg] = await CoilConversion.aggregate([
      { $match: { coilReceiptId: { $type: 'objectId' }, isDeleted: { $ne: true } } },
      // Where each round was cut — on its ScrapRecord (one per conversion).
      {
        $lookup: {
          from: 'scraprecords',
          localField: '_id',
          foreignField: 'conversionId',
          pipeline: [{ $match: { isDeleted: { $ne: true } } }, { $project: { location: 1 } }],
          as: 'sr',
        },
      },
      { $addFields: { location: { $arrayElemAt: ['$sr.location', 0] } } },
      {
        $group: {
          _id: '$coilReceiptId',
          cutKg: { $sum: '$coilWeightKg' },
          circlesKg: { $sum: '$circlesWeightKg' },
          scrapKg: { $sum: '$scrapKg' },
          plantScrapKg: { $sum: { $cond: [{ $eq: ['$location', 'PLG01'] }, '$scrapKg', 0] } },
          jobWorkScrapKg: { $sum: { $cond: [{ $eq: ['$location', 'JW001'] }, '$scrapKg', 0] } },
          rounds: { $sum: 1 },
          locations: { $addToSet: '$location' },
          firstCutAt: { $min: '$conversionDate' },
          lastCutAt: { $max: '$conversionDate' },
          lastSavedAt: { $max: '$createdAt' },
        },
      },
      {
        $lookup: {
          from: 'inventorymovements',
          localField: '_id',
          foreignField: '_id',
          pipeline: [{
            $project: {
              batchNo: 1, skuId: 1, skuCode: 1, skuName: 1, quantity: 1, warehouse: 1, movementNumber: 1,
              movementDate: 1, refType: 1, refNumber: 1, vendorName: 1, isDeleted: 1,
            },
          }],
          as: 'rc',
        },
      },
      { $addFields: { receipt: { $arrayElemAt: ['$rc', 0] } } },
      // The batch's whole ledger, keyed on (batchNo, skuId) — the same join
      // listReceivedCoils uses, served by the { batchNo, skuId } index.
      {
        $lookup: {
          from: 'inventorymovements',
          let: { b: '$receipt.batchNo', k: '$receipt.skuId' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$batchNo', '$$b'] }, { $eq: ['$skuId', '$$k'] }] } } },
            { $match: { isDeleted: { $ne: true } } },
            {
              $group: {
                _id: null,
                inQty: { $sum: { $cond: [{ $eq: ['$movementType', MOVEMENT_TYPE.IN] }, '$quantity', 0] } },
                outQty: { $sum: { $cond: [{ $eq: ['$movementType', MOVEMENT_TYPE.OUT] }, '$quantity', 0] } },
              },
            },
          ],
          as: 'led',
        },
      },
      {
        $addFields: {
          receivedKg: { $ifNull: ['$receipt.quantity', 0] },
          ledgerAvailableKg: {
            $subtract: [
              { $ifNull: [{ $arrayElemAt: ['$led.inQty', 0] }, 0] },
              { $ifNull: [{ $arrayElemAt: ['$led.outQty', 0] }, 0] },
            ],
          },
        },
      },
      // Status in the pipeline only so it can be FILTERED on; the same rule as
      // cuttingStatus/ledgerCoilState, which recompute it for the rows below.
      {
        $addFields: {
          status: {
            $switch: {
              branches: [
                { case: { $lte: [{ $subtract: ['$receivedKg', '$ledgerAvailableKg'] }, EPS] }, then: CUT_STATUS.NOT_CUT },
                { case: { $gt: ['$ledgerAvailableKg', EPS] }, then: CUT_STATUS.PARTIALLY_CUT },
              ],
              default: CUT_STATUS.FULLY_CUT,
            },
          },
        },
      },
      { $project: { rc: 0, led: 0 } },
      ...post,
      { $sort: { lastCutAt: -1, lastSavedAt: -1, _id: -1 } },
      {
        $facet: {
          rows: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          stats: [{
            $group: {
              _id: null,
              coils: { $sum: 1 },
              rounds: { $sum: '$rounds' },
              partiallyCut: { $sum: { $cond: [{ $eq: ['$status', CUT_STATUS.PARTIALLY_CUT] }, 1, 0] } },
              fullyCut: { $sum: { $cond: [{ $eq: ['$status', CUT_STATUS.FULLY_CUT] }, 1, 0] } },
              cutKg: { $sum: '$cutKg' },
              circlesKg: { $sum: '$circlesKg' },
              scrapKg: { $sum: '$scrapKg' },
              plantScrapKg: { $sum: '$plantScrapKg' },
              jobWorkScrapKg: { $sum: '$jobWorkScrapKg' },
            },
          }],
        },
      },
    ]).option({ allowDiskUse: true });

    const docs = (agg?.rows || []).map((g) => {
      const rc = g.receipt || null;
      const row = summariseCoilRow({
        receivedKg: g.receivedKg, cutKg: g.cutKg, circlesKg: g.circlesKg, scrapKg: g.scrapKg, rounds: g.rounds,
      });
      const ledger = ledgerCoilState({
        receivedKg: g.receivedKg, roundsCutKg: g.cutKg, ledgerAvailableKg: g.ledgerAvailableKg,
      });
      const locations = (g.locations || []).filter(Boolean).sort();
      return {
        coilReceiptId: g._id,
        receiptNumber: rc?.movementNumber || '',
        receiptMissing: !rc || rc.isDeleted === true,
        batchNo: rc?.batchNo || '',
        skuId: rc?.skuId || null,
        skuCode: rc?.skuCode || '',
        itemName: rc?.skuName || '',
        receivedAt: rc?.warehouse || '',
        receivedDate: rc?.movementDate || null,
        grnNo: rc?.refType === 'GRN' ? (rc.refNumber || '') : '',
        supplier: rc?.vendorName || '',
        ...row,
        yieldPct: row.avgYieldPct,
        plantScrapKg: round2(g.plantScrapKg),
        jobWorkScrapKg: round2(g.jobWorkScrapKg),
        ledgerAvailableKg: ledger.availableKg,
        otherOutKg: ledger.otherOutKg,
        reconciles: Math.abs(ledger.availableKg - row.remainingKg) <= EPS,
        // The coil's status follows the ledger (see the header); `row.status`
        // from summariseCoilRow is the rounds-only view and is overwritten.
        status: ledger.status,
        overCut: ledger.overCut || row.remainingKg < -EPS,
        location: locations.length > 1 ? 'MIXED' : (locations[0] || null),
        locations,
        firstCutAt: g.firstCutAt || null,
        lastCutAt: g.lastCutAt || null,
      };
    });

    const stats = agg?.stats?.[0] || {};
    const [untraced] = await CoilConversion.aggregate([
      // `coilReceiptId: null` matches both null and ABSENT — the historical
      // imports never had the field at all.
      { $match: { isDeleted: { $ne: true }, coilReceiptId: null } },
      { $group: { _id: null, records: { $sum: 1 }, cutKg: { $sum: '$coilWeightKg' }, scrapKg: { $sum: '$scrapKg' } } },
    ]);

    return {
      docs,
      summary: {
        coils: stats.coils || 0,
        rounds: stats.rounds || 0,
        partiallyCut: stats.partiallyCut || 0,
        fullyCut: stats.fullyCut || 0,
        cutKg: round2(stats.cutKg),
        circlesKg: round2(stats.circlesKg),
        scrapKg: round2(stats.scrapKg),
        plantScrapKg: round2(stats.plantScrapKg),
        jobWorkScrapKg: round2(stats.jobWorkScrapKg),
        // Weighted over everything listed, like every coil-level yield here.
        yieldPct: stats.cutKg > 0 ? round2((stats.circlesKg / stats.cutKg) * 100) : null,
        untraceable: {
          records: untraced?.records || 0,
          cutKg: round2(untraced?.cutKg),
          scrapKg: round2(untraced?.scrapKg),
        },
        pagination: { page, limit, total: stats.coils || 0 },
      },
    };
  },

  /**
   * The circle sizes a given coil is approved to produce.
   *
   * What makes the Cut Coils dropdown depend on the coil instead of listing
   * every circle in the master. Read-only: it resolves the client's mapping
   * against the SKU master and creates nothing, the same contract as
   * listReceivedCoils next door.
   *
   * The mapping is keyed by SKU CODE (that is how the client's sheet is
   * written), but the screen works in SKU ids, so the coil is looked up first
   * and its own code is what the map is asked about - never a code typed by the
   * caller. So this answers for the coil the batch number actually identified.
   *
   * `mapped: false` is an answer, not an error: the coil exists, the sheet is
   * silent about it, and the screen says so rather than offering every circle.
   * `missingCodes` is never silently dropped - a size the client approved that
   * the master has no SKU for is a data gap someone has to see.
   */
  async listCircleOptions(query = {}) {
    const coil = await SKU.findById(query.coilSkuId)
      .select('code name itemType isActive isDeleted').lean();
    if (!coil || coil.isDeleted) throw new AppError('Coil SKU not found', 404);

    const coilCode = coil.code;
    const mapping = allowedCirclesForCoil(coilCode);
    if (!mapping) {
      return {
        coilSkuId: String(coil._id), coilSkuCode: coilCode, coilSkuName: coil.name,
        mapped: false, circles: [], missingCodes: [],
      };
    }

    const codes = mapping.map((m) => m.code);
    // itemType is the master's own classifier and stays the only one: a code on
    // the sheet that is not actually a CIRCLE in the master must not be offered
    // as one. Such a code falls into missingCodes and is reported, not hidden.
    const skus = await SKU.find({
      code: { $in: codes }, itemType: 'CIRCLE', isActive: true, isDeleted: { $ne: true },
    }).select('code name unit').lean();

    const bySkuCode = new Map(skus.map((s) => [s.code, s]));
    // Kept in the sheet's own order, which is the order the client reads their
    // sizes in - not alphabetical, which would put 10.50" before 8.50".
    const circles = codes
      .filter((c) => bySkuCode.has(c))
      .map((c) => {
        const s = bySkuCode.get(c);
        return {
          skuId: String(s._id), skuCode: s.code, skuName: s.name, unit: s.unit || 'PCS',
        };
      });
    const missingCodes = codes.filter((c) => !bySkuCode.has(c));

    return {
      coilSkuId: String(coil._id), coilSkuCode: coilCode, coilSkuName: coil.name,
      mapped: true, circles, missingCodes,
    };
  },

  // ── Dashboard ───────────────────────────────────────────────────────────────
  async getDashboard() {
    const { docs, summary } = await this.getOverview({});
    const byCategory = {};
    for (const r of docs) {
      const k = r.category || r.kind || 'Uncategorised';
      byCategory[k] = byCategory[k] || { category: k, items: 0, onHand: 0, value: 0, reorder: 0 };
      byCategory[k].items += 1;
      byCategory[k].onHand = round2(byCategory[k].onHand + r.onHand);
      byCategory[k].value = round2(byCategory[k].value + r.stockValue);
      if (['REORDER', 'OUT_OF_STOCK', 'LOW'].includes(r.status)) byCategory[k].reorder += 1;
    }

    const since = new Date(Date.now() - 30 * 86400000);
    const rmSkus = await SKU.find({ itemType: { $in: RM_ITEM_TYPES }, isDeleted: { $ne: true } }).select('_id').lean();
    const rmIds = rmSkus.map((s) => s._id);
    const topConsumed = await InventoryMovement.aggregate([
      { $match: { skuId: { $in: rmIds }, movementType: MOVEMENT_TYPE.OUT, movementDate: { $gte: since }, isDeleted: { $ne: true } } },
      { $group: { _id: { skuCode: '$skuCode', skuName: '$skuName' }, qty: { $sum: '$quantity' } } },
      { $sort: { qty: -1 } }, { $limit: 8 },
      { $project: { _id: 0, skuCode: '$_id.skuCode', skuName: '$_id.skuName', qty: 1 } },
    ]);

    const { docs: recentMovements } = await this.getMovements({ limit: 12 });
    const recentConversions = await CoilConversion.find({ isDeleted: { $ne: true } })
      .sort({ conversionDate: -1 }).limit(6)
      .select('conversionNumber conversionDate batchNo coilSkuCode coilSkuName coilWeightKg circlesWeightKg scrapKg yieldRatioPct').lean();

    const reorderList = docs
      .filter((r) => ['OUT_OF_STOCK', 'REORDER', 'LOW'].includes(r.status))
      .sort((a, b) => (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9))
      .slice(0, 12);

    return {
      summary,
      byCategory: Object.values(byCategory).sort((a, b) => b.value - a.value),
      topConsumed, recentMovements, recentConversions, reorderList,
    };
  },
};

export default rmImsService;
