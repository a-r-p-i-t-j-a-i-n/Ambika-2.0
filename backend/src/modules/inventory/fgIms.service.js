import mongoose from 'mongoose';
import InventoryPolicy from './inventoryPolicy.model.js';
import InventoryStock from './inventoryStock.model.js';
import InventoryMovement, { MOVEMENT_TYPE, TXN_TYPE } from './inventoryMovement.model.js';
import { inventoryService } from './inventory.service.js';
import SKU from '../skus/sku.model.js';
import { AppError } from '../../utils/apiResponse.js';

/**
 * FG IMS service — Finished Goods inventory on top of the shared stock engine.
 *
 * Finished goods (jars, bowls, …) are what the company SELLS. Unlike RM /
 * consumables they are not bought from a vendor — they are PRODUCED in-house and
 * then DISPATCHED to customers. So the two ends of the flow are:
 *   • Production In  (PRODUCE_IN)  — units completed on the line (the Daily
 *                                    Production Report). Adds to stock.
 *   • Dispatch Out   (DISPATCH_OUT)— units shipped to a customer. Removes stock.
 *
 * This module is deliberately standalone: it does NOT auto-wire to the Dispatch
 * or DPR modules yet — it records its own Production-In / Dispatch-Out entries on
 * the same append-only ledger (InventoryMovement) so stock always reconciles.
 *
 * Planning mirrors the RM sheet: three demand rates (Off-season / Normal / Peak
 * — finished-goods demand is seasonal), a committed order book (booked), work in
 * production (in-production), safety factor, and a suggested production quantity.
 */

// Item types this IMS covers. FINISHED_GOOD is the canonical sell-side type;
// the others are defensive aliases for legacy / imported data (see sku.model).
export const FG_ITEM_TYPES = ['FINISHED_GOOD', 'FG', 'SALE_PRODUCT', 'READY_STOCK_PRODUCT'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

// The client lives and reports in IST, so a movement's "day" (and every dated
// column in their Excel) is bucketed on the India calendar, not UTC.
const IST_TZ = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';
const istDayKey = (date) => new Date(date).toLocaleDateString('en-CA', { timeZone: IST_TZ });
const shiftDay = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// Active demand rate = the column the chosen mode points at, falling back to the
// legacy single ADC. (Same three-tier model the RM sheet uses.)
const resolveDemand = (policy = {}) => {
  const mode = policy.consumptionMode || 'NORMAL';
  const byMode = { LOW: policy.adcLow, NORMAL: policy.adcNormal, PEAK: policy.adcPeak }[mode];
  return Number(byMode || policy.averageDailyConsumption || 0);
};

/**
 * Stock status + planning metrics for a finished good.
 * "add" = average daily demand (dispatch velocity). in-production = WIP expected
 * to be completed. booked = quantity committed to confirmed customer orders.
 */
const deriveMetrics = (policy = {}, stock = {}, sku = {}) => {
  const add = resolveDemand(policy);                       // avg daily demand
  const leadDays = Number(policy.leadDays || 0);           // production lead time
  const safetyFactor = Number(policy.safetyFactor || 1.5);
  const inProduction = Number(policy.materialInTransit || 0); // WIP expected in
  const booked = Number(policy.bookedQty || 0);            // committed to orders
  const onHand = round2(stock.qtyOnHand || 0);

  const leadTimeDemand = round2(add * leadDays);
  const maxLevel = round2(policy.maxLevel || add * leadDays * safetyFactor);
  const safetyStock = round2(Math.max(0, maxLevel - leadTimeDemand));
  const reorderPoint = leadTimeDemand;
  // What we can actually promise = in stock + coming off the line − already sold.
  const projectedAvailable = round2(onHand + inProduction - booked);
  const daysCover = add > 0 ? round2(onHand / add) : null;
  const availablePct = maxLevel > 0 ? Math.round((projectedAvailable / maxLevel) * 100) : null;

  let status = 'OK';
  if (onHand <= 0) status = 'OUT_OF_STOCK';
  else if (projectedAvailable <= reorderPoint) status = 'REORDER';
  else if (maxLevel > 0 && onHand > maxLevel * 1.25) status = 'OVERSTOCK';
  else if (add > 0 && projectedAvailable <= safetyStock + reorderPoint && projectedAvailable > reorderPoint) status = 'LOW';

  // How much to PRODUCE to refill up to the max level (respect a min batch = MOQ).
  let suggestedProduceQty = round2(Math.max(0, maxLevel - projectedAvailable));
  const moq = Number(policy.moq || 0);
  if (suggestedProduceQty > 0 && moq > 0 && suggestedProduceQty < moq) suggestedProduceQty = moq;

  // Value finished stock at its costing rate: policy rate → avg cost → RM cost.
  const rate = Number(policy.rate || stock.avgCost || sku.rmCost || 0);
  const sellingPrice = Number(sku.sellingPrice || 0);

  return {
    onHand, inProduction, booked, add, leadDays, safetyFactor,
    leadTimeDemand, safetyStock, reorderPoint, maxLevel,
    projectedAvailable, daysCover, availablePct, status, suggestedProduceQty,
    avgCost: round2(stock.avgCost || 0),
    rate: round2(rate),
    sellingPrice: round2(sellingPrice),
    stockValue: round2((stock.qtyOnHand || 0) * rate),
    retailValue: round2((stock.qtyOnHand || 0) * sellingPrice),
    committedValue: round2(booked * sellingPrice),
  };
};

export const fgImsService = {
  FG_ITEM_TYPES,

  /**
   * The master FG view — every finished-good SKU joined with its policy and
   * current in-stock balance, plus derived planning metrics. The dataset is
   * small (a few hundred SKUs) so we return the full filtered set.
   */
  async getOverview(query = {}) {
    const filter = { itemType: { $in: FG_ITEM_TYPES }, isDeleted: { $ne: true } };
    if (query.category) filter.category = query.category;
    if (query.search) {
      const r = rx(query.search);
      filter.$or = [{ name: r }, { code: r }, { category: r }, { aliases: r }];
    }
    const limit = Math.min(Number(query.limit) || 3000, 8000);
    const skus = await SKU.find(filter).sort({ category: 1, name: 1 }).limit(limit).lean();
    const ids = skus.map((s) => s._id);

    const [stocks, policies] = await Promise.all([
      InventoryStock.find({ skuId: { $in: ids }, isDeleted: { $ne: true } }).lean(),
      InventoryPolicy.find({ skuId: { $in: ids }, isDeleted: { $ne: true } }).lean(),
    ]);
    const stockBy = new Map(stocks.map((s) => [String(s.skuId), s]));
    const polBy = new Map(policies.map((p) => [String(p.skuId), p]));

    const rows = skus.map((sku) => {
      const stock = stockBy.get(String(sku._id)) || {};
      const policy = polBy.get(String(sku._id)) || {
        averageDailyConsumption: 0, leadDays: sku.leadDays ?? 7, safetyFactor: 1.5,
        moq: 0, maxLevel: 0, materialInTransit: 0, bookedQty: 0, openingStock: 0,
        consumptionMode: 'NORMAL',
      };
      const m = deriveMetrics(policy, stock, sku);
      return {
        skuId: sku._id,
        skuCode: sku.code,
        skuName: sku.name,
        itemType: sku.itemType,
        category: sku.category || '',
        unit: sku.unit || 'PCS',
        pcsPerBox: sku.pcsPerBox || 1,
        hasPolicy: polBy.has(String(sku._id)),
        consumptionMode: policy.consumptionMode || 'NORMAL',
        adcLow: round2(policy.adcLow || 0),
        adcNormal: round2(policy.adcNormal || 0),
        adcPeak: round2(policy.adcPeak || 0),
        moq: round2(policy.moq || 0),
        openingStock: round2(policy.openingStock || 0),
        lastMovementAt: stock.lastMovementAt || null,
        ...m,
      };
    });

    let docs = rows;
    if (query.status) docs = docs.filter((r) => r.status === query.status);
    return { docs, summary: this._summary(rows) };
  },

  _summary(rows) {
    const s = {
      itemCount: rows.length,
      totalOnHand: 0, totalStockValue: 0, totalRetailValue: 0,
      totalBooked: 0, totalInProduction: 0,
      outOfStock: 0, reorder: 0, low: 0, overstock: 0, ok: 0,
    };
    for (const r of rows) {
      s.totalOnHand = round2(s.totalOnHand + r.onHand);
      s.totalStockValue = round2(s.totalStockValue + r.stockValue);
      s.totalRetailValue = round2(s.totalRetailValue + r.retailValue);
      s.totalBooked = round2(s.totalBooked + r.booked);
      s.totalInProduction = round2(s.totalInProduction + r.inProduction);
      if (r.status === 'OUT_OF_STOCK') s.outOfStock += 1;
      else if (r.status === 'REORDER') s.reorder += 1;
      else if (r.status === 'LOW') s.low += 1;
      else if (r.status === 'OVERSTOCK') s.overstock += 1;
      else s.ok += 1;
    }
    return s;
  },

  /** Per-day stock burn-down for one finished good (demand-projection). */
  async getForecast(skuId, days = 30) {
    const [sku, stock, policy] = await Promise.all([
      SKU.findById(skuId).lean(),
      InventoryStock.findOne({ skuId, isDeleted: { $ne: true } }).lean(),
      InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } }).lean(),
    ]);
    if (!sku) throw new AppError('Item not found', 404);
    const m = deriveMetrics(policy || {}, stock || {}, sku);
    const n = Math.min(Math.max(Number(days) || 30, 7), 120);

    const series = [];
    let projected = m.onHand;
    let reorderDay = null;
    let stockoutDay = null;
    const today = new Date();
    for (let d = 0; d <= n; d += 1) {
      const date = new Date(today.getTime() + d * 86400000);
      // WIP assumed to finish production and hit stock after the lead time.
      if (m.inProduction > 0 && d === Math.round(m.leadDays)) projected = round2(projected + m.inProduction);
      if (d > 0) projected = round2(projected - m.add);
      const clamped = Math.max(0, projected);
      if (reorderDay === null && clamped <= m.reorderPoint) reorderDay = d;
      if (stockoutDay === null && clamped <= 0) stockoutDay = d;
      series.push({ day: d, date, projected: clamped });
    }
    return {
      sku: { skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: sku.unit, category: sku.category },
      metrics: m, reorderDay, stockoutDay, series,
    };
  },

  /**
   * Day-by-day stock card (dated closing-stock columns) reconstructed from the
   * ledger — a CONTINUOUS IST calendar series so flat days carry the previous
   * closing forward. Closing(day) = opening-before-window + Σ signed movements
   * up to end of that day, which always reconciles with on-hand.
   */
  async getStockHistory(skuId, query = {}) {
    const [sku, stock, policy] = await Promise.all([
      SKU.findById(skuId).lean(),
      InventoryStock.findOne({ skuId, isDeleted: { $ne: true } }).lean(),
      InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } }).lean(),
    ]);
    if (!sku) throw new AppError('Item not found', 404);
    const m = deriveMetrics(policy || {}, stock || {}, sku);

    const todayKey = istDayKey(new Date());
    let toKey = query.to ? istDayKey(new Date(`${query.to}T12:00:00${IST_OFFSET}`)) : todayKey;
    let fromKey = query.from ? istDayKey(new Date(`${query.from}T12:00:00${IST_OFFSET}`)) : shiftDay(toKey, -29);
    if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
    if (shiftDay(fromKey, 400) < toKey) fromKey = shiftDay(toKey, -400);

    const fromStart = new Date(`${fromKey}T00:00:00.000${IST_OFFSET}`);
    const toEnd = new Date(`${toKey}T23:59:59.999${IST_OFFSET}`);
    const oid = new mongoose.Types.ObjectId(String(skuId));

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
        add: m.add, leadDays: m.leadDays, onHand: m.onHand, inProduction: m.inProduction,
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

  /** Items at/below reorder point — the production plan, most urgent first. */
  async getReplenishList(query = {}) {
    const { docs } = await this.getOverview(query);
    return docs
      .filter((r) => ['OUT_OF_STOCK', 'REORDER', 'LOW'].includes(r.status))
      .sort((a, b) => (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9));
  },

  // ── Policy CRUD ────────────────────────────────────────────────────────────
  async getPolicy(skuId) {
    return InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } }).lean();
  },

  async upsertPolicy(skuId, data, user) {
    const sku = await SKU.findById(skuId).select('code name unit category itemType').lean();
    if (!sku) throw new AppError('SKU not found', 404);
    const set = {
      skuCode: sku.code, skuName: sku.name, unit: sku.unit, category: sku.category || '', itemType: sku.itemType,
      adcLow: data.adcLow, adcNormal: data.adcNormal, adcPeak: data.adcPeak,
      consumptionMode: data.consumptionMode,
      averageDailyConsumption: data.averageDailyConsumption,
      leadDays: data.leadDays, safetyFactor: data.safetyFactor,
      moq: data.moq, maxLevel: data.maxLevel,
      materialInTransit: data.materialInTransit, bookedQty: data.bookedQty,
      rate: data.rate, remarks: data.remarks,
      updatedBy: user?._id,
    };
    if (data.openingStock !== undefined) set.openingStock = data.openingStock;
    Object.keys(set).forEach((k) => set[k] === undefined && delete set[k]);

    return InventoryPolicy.findOneAndUpdate(
      { skuId },
      { $set: set, $setOnInsert: { skuId, createdBy: user?._id } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();
  },

  // ── Production In (Daily Production Report / opening / correction) ───────────
  async produce(payload, user) {
    const items = (payload.items || []).filter((i) => Number(i.quantity) > 0);
    if (!items.length) throw new AppError('Add at least one item with a quantity.', 400);
    const reason = payload.reason || 'PRODUCTION';
    const txnType = reason === 'OPENING' ? TXN_TYPE.OPENING
      : reason === 'SALES_RETURN' ? TXN_TYPE.SALES_RETURN_IN
        : reason === 'CORRECTION' ? TXN_TYPE.ADJUST_IN
          : TXN_TYPE.PRODUCE_IN;
    const movementDate = payload.date ? new Date(payload.date) : new Date();

    const label = {
      PRODUCTION: 'Production (DPR)', OPENING: 'Opening stock',
      SALES_RETURN: 'Sales return', CORRECTION: 'Correction',
    }[reason] || 'Production';

    const context = [
      payload.shift && `Shift: ${payload.shift}`,
      payload.line && `Line: ${payload.line}`,
      payload.supervisor && `Supervisor: ${payload.supervisor}`,
    ].filter(Boolean).join(' · ');

    const results = [];
    for (const it of items) {
      const { movement, stock } = await inventoryService.increaseStock({
        skuId: it.skuId, quantity: Number(it.quantity), unitCost: Number(it.unitCost || 0),
        batchNo: it.batchNo || '', warehouse: payload.warehouse,
        txnType, sourceModule: 'FG_IMS', refType: 'FG_PRODUCTION', refNumber: payload.reference || '',
        remarks: [label, context, payload.reference, it.remarks].filter(Boolean).join(' · '),
        performedBy: user, movementDate,
      });
      results.push({ skuId: it.skuId, movementNumber: movement.movementNumber, balanceAfter: stock.qtyOnHand });
    }
    return { count: results.length, results };
  },

  // ── Dispatch Out (goods shipped to a customer) ──────────────────────────────
  async dispatch(payload, user) {
    const items = (payload.items || []).filter((i) => Number(i.quantity) > 0);
    if (!items.length) throw new AppError('Add at least one item with a quantity.', 400);
    const allowNegative = !!payload.allowNegative;
    const movementDate = payload.date ? new Date(payload.date) : new Date();

    // Pre-validate on-hand for every line so we don't half-commit a dispatch.
    if (!allowNegative) {
      const ids = items.map((i) => i.skuId);
      const stocks = await InventoryStock.find({ skuId: { $in: ids } }).lean();
      const onHandBy = new Map(stocks.map((s) => [String(s.skuId), s.qtyOnHand]));
      const short = items.filter((i) => Number(i.quantity) > (onHandBy.get(String(i.skuId)) || 0));
      if (short.length) {
        const names = short.map((i) => i.skuCode || i.skuId).join(', ');
        throw new AppError(`Not enough stock to dispatch: ${names}. Lower the quantity or tick "allow negative".`, 400);
      }
    }

    const context = [
      payload.customer && `Customer: ${payload.customer}`,
      payload.orderNo && `Order: ${payload.orderNo}`,
      payload.vehicleNo && `Vehicle: ${payload.vehicleNo}`,
    ].filter(Boolean).join(' · ');

    const results = [];
    for (const it of items) {
      const { movement, stock } = await inventoryService.decreaseStock({
        skuId: it.skuId, quantity: Number(it.quantity), warehouse: payload.warehouse,
        txnType: TXN_TYPE.DISPATCH_OUT, sourceModule: 'FG_IMS',
        refType: 'FG_DISPATCH', refNumber: payload.reference || payload.orderNo || '',
        remarks: [context, it.remarks].filter(Boolean).join(' · ') || 'Finished goods dispatch',
        performedBy: user, movementDate,
      }, { allowNegative });
      results.push({ skuId: it.skuId, movementNumber: movement.movementNumber, balanceAfter: stock.qtyOnHand });
    }
    return { count: results.length, results };
  },

  /** Movement history scoped to finished-good SKUs. */
  async getMovements(query = {}) {
    const skus = await SKU.find({ itemType: { $in: FG_ITEM_TYPES }, isDeleted: { $ne: true } }).select('_id').lean();
    const ids = skus.map((s) => s._id);
    const filter = { skuId: { $in: ids }, isDeleted: { $ne: true } };
    if (query.skuId) filter.skuId = query.skuId;
    if (query.search) {
      const r = rx(query.search);
      filter.$or = [{ movementNumber: r }, { skuCode: r }, { skuName: r }, { refNumber: r }, { batchNo: r }];
    }
    if (query.txnType) filter.txnType = query.txnType;
    if (query.movementType) filter.movementType = query.movementType;
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Number(query.limit) || 50, 500);
    const [docs, total] = await Promise.all([
      InventoryMovement.find(filter).sort({ movementDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      InventoryMovement.countDocuments(filter),
    ]);
    return { docs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
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

    const fgSkus = await SKU.find({ itemType: { $in: FG_ITEM_TYPES }, isDeleted: { $ne: true } }).select('_id').lean();
    const fgIds = fgSkus.map((s) => s._id);
    const since = new Date(Date.now() - 30 * 86400000);

    // Top dispatched (OUT) and top produced (IN) finished goods over 30 days.
    const [topDispatched, topProduced] = await Promise.all([
      InventoryMovement.aggregate([
        { $match: { skuId: { $in: fgIds }, movementType: MOVEMENT_TYPE.OUT, movementDate: { $gte: since }, isDeleted: { $ne: true } } },
        { $group: { _id: { skuCode: '$skuCode', skuName: '$skuName' }, qty: { $sum: '$quantity' } } },
        { $sort: { qty: -1 } }, { $limit: 8 },
        { $project: { _id: 0, skuCode: '$_id.skuCode', skuName: '$_id.skuName', qty: 1 } },
      ]),
      InventoryMovement.aggregate([
        { $match: { skuId: { $in: fgIds }, txnType: TXN_TYPE.PRODUCE_IN, movementDate: { $gte: since }, isDeleted: { $ne: true } } },
        { $group: { _id: { skuCode: '$skuCode', skuName: '$skuName' }, qty: { $sum: '$quantity' } } },
        { $sort: { qty: -1 } }, { $limit: 8 },
        { $project: { _id: 0, skuCode: '$_id.skuCode', skuName: '$_id.skuName', qty: 1 } },
      ]),
    ]);

    const { docs: recentMovements } = await this.getMovements({ limit: 12 });

    const replenishList = docs
      .filter((r) => ['OUT_OF_STOCK', 'REORDER', 'LOW'].includes(r.status))
      .sort((a, b) => (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9))
      .slice(0, 12);

    return {
      summary,
      byCategory: Object.values(byCategory).sort((a, b) => b.value - a.value),
      topDispatched, topProduced, recentMovements, replenishList,
    };
  },
};

export default fgImsService;
