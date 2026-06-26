import mongoose from 'mongoose';
import InventoryPolicy from './inventoryPolicy.model.js';
import InventoryStock from './inventoryStock.model.js';
import InventoryMovement, { MOVEMENT_TYPE, TXN_TYPE } from './inventoryMovement.model.js';
import { inventoryService } from './inventory.service.js';
import SKU from '../skus/sku.model.js';
import { AppError } from '../../utils/apiResponse.js';

/**
 * IMS service — the Packaging & Consumables Inventory layer on top of the core
 * stock engine (inventory.service). It joins SKU + InventoryPolicy +
 * InventoryStock into a single planning view, computes reorder/forecast, and
 * exposes multi-line Stock-In (receipt) and Stock-Out (issue) that reuse the
 * same ledger so on-hand always reconciles with the movements.
 */

// Item types this IMS covers (consumables & packaging).
export const IMS_ITEM_TYPES = ['CONSUMABLE', 'PACKING', 'PACKAGING'];

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

/** Stock status from on-hand + in-transit vs the policy thresholds. */
const deriveMetrics = (policy = {}, stock = {}) => {
  const adc = Number(policy.averageDailyConsumption || 0);
  const leadDays = Number(policy.leadDays || 0);
  const safetyFactor = Number(policy.safetyFactor || 1.5);
  const inTransit = Number(policy.materialInTransit || 0);
  const onHand = round2(stock.qtyOnHand || 0);

  const leadTimeDemand = round2(adc * leadDays);                 // qty consumed over a lead time
  // Order-up-to / max level: stored value wins, else the sheet rule ADC×lead×SF.
  const maxLevel = round2(policy.maxLevel || adc * leadDays * safetyFactor);
  const safetyStock = round2(Math.max(0, maxLevel - leadTimeDemand)); // the buffer above lead demand
  const reorderPoint = leadTimeDemand;                            // reorder when cover ≤ lead time
  const projectedAvailable = round2(onHand + inTransit);
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
    leadTimeDemand, safetyStock, reorderPoint, maxLevel,
    projectedAvailable, daysCover, status, suggestedOrderQty,
    avgCost: round2(stock.avgCost || 0),
    stockValue: round2((stock.qtyOnHand || 0) * (stock.avgCost || 0)),
  };
};

export const imsService = {
  IMS_ITEM_TYPES,

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

    const [stocks, policies] = await Promise.all([
      InventoryStock.find({ skuId: { $in: ids }, isDeleted: { $ne: true } }).lean(),
      InventoryPolicy.find({ skuId: { $in: ids }, isDeleted: { $ne: true } }).lean(),
    ]);
    const stockBy = new Map(stocks.map((s) => [String(s.skuId), s]));
    const polBy = new Map(policies.map((p) => [String(p.skuId), p]));

    const rows = skus.map((sku) => {
      const stock = stockBy.get(String(sku._id)) || {};
      const policy = polBy.get(String(sku._id)) || {
        averageDailyConsumption: 0, leadDays: sku.leadDays ?? 16, safetyFactor: 1.5,
        moq: 0, maxLevel: 0, materialInTransit: 0, openingStock: 0, convertedItemName: '',
      };
      const m = deriveMetrics(policy, stock);
      return {
        skuId: sku._id,
        skuCode: sku.code,
        skuName: sku.name,
        itemType: sku.itemType,
        category: sku.category || '',
        unit: sku.unit || 'PCS',
        convertedItemName: policy.convertedItemName || '',
        hasPolicy: polBy.has(String(sku._id)),
        openingStock: round2(policy.openingStock || 0),
        moq: round2(policy.moq || 0),
        lastMovementAt: stock.lastMovementAt || null,
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
    const [sku, stock, policy] = await Promise.all([
      SKU.findById(skuId).lean(),
      InventoryStock.findOne({ skuId, isDeleted: { $ne: true } }).lean(),
      InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } }).lean(),
    ]);
    if (!sku) throw new AppError('Item not found', 404);
    const m = deriveMetrics(policy || {}, stock || {});
    const n = Math.min(Math.max(Number(days) || 30, 7), 120);

    const series = [];
    let projected = m.onHand;
    let reorderDay = null;
    let stockoutDay = null;
    const today = new Date();
    for (let d = 0; d <= n; d += 1) {
      const date = new Date(today.getTime() + d * 86400000);
      // Material-in-transit assumed to arrive after the lead time.
      if (m.inTransit > 0 && d === Math.round(m.leadDays)) projected = round2(projected + m.inTransit);
      if (d > 0) projected = round2(projected - m.adc);
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
   * Day-by-day stock card (the sheet's dated closing-stock columns) reconstructed
   * from the ledger. Returns a CONTINUOUS calendar series in IST so flat days carry
   * the previous closing forward — exactly how the client reads their Excel history.
   * Closing(day) = opening-before-window + Σ signed movements up to end of that day,
   * which always reconciles with on-hand (on-hand = Σ of all ledger deltas).
   */
  async getStockHistory(skuId, query = {}) {
    const [sku, stock, policy] = await Promise.all([
      SKU.findById(skuId).lean(),
      InventoryStock.findOne({ skuId, isDeleted: { $ne: true } }).lean(),
      InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } }).lean(),
    ]);
    if (!sku) throw new AppError('Item not found', 404);
    const m = deriveMetrics(policy || {}, stock || {});

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
    const policy = await InventoryPolicy.findOne({ skuId, isDeleted: { $ne: true } }).lean();
    return policy || null;
  },

  async upsertPolicy(skuId, data, user) {
    const sku = await SKU.findById(skuId).select('code name unit category itemType').lean();
    if (!sku) throw new AppError('SKU not found', 404);
    const set = {
      skuCode: sku.code, skuName: sku.name, unit: sku.unit, category: sku.category || '', itemType: sku.itemType,
      averageDailyConsumption: data.averageDailyConsumption,
      leadDays: data.leadDays,
      safetyFactor: data.safetyFactor,
      moq: data.moq,
      maxLevel: data.maxLevel,
      materialInTransit: data.materialInTransit,
      convertedItemName: data.convertedItemName,
      remarks: data.remarks,
      updatedBy: user?._id,
    };
    if (data.openingStock !== undefined) set.openingStock = data.openingStock;
    Object.keys(set).forEach((k) => set[k] === undefined && delete set[k]);

    const policy = await InventoryPolicy.findOneAndUpdate(
      { skuId },
      { $set: set, $setOnInsert: { skuId, createdBy: user?._id } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();
    return policy;
  },

  // ── Stock-In (manual receipt / opening / correction) ────────────────────────
  async receive(payload, user) {
    const items = (payload.items || []).filter((i) => Number(i.quantity) > 0);
    if (!items.length) throw new AppError('Add at least one item with a quantity.', 400);
    const reason = payload.reason || 'VENDOR';
    const txnType = reason === 'OPENING' ? TXN_TYPE.OPENING : TXN_TYPE.ADJUST_IN;
    const movementDate = payload.date ? new Date(payload.date) : new Date();

    const results = [];
    for (const it of items) {
      const { movement, stock } = await inventoryService.increaseStock({
        skuId: it.skuId, quantity: Number(it.quantity), unitCost: Number(it.unitCost || 0),
        batchNo: it.batchNo || '', warehouse: payload.warehouse,
        txnType, sourceModule: 'IMS', refType: 'IMS_RECEIPT', refNumber: payload.reference || '',
        remarks: [reason === 'OPENING' ? 'Opening stock' : 'Stock-in', payload.reference, it.remarks]
          .filter(Boolean).join(' · '),
        performedBy: user, movementDate,
      });
      results.push({ skuId: it.skuId, movementNumber: movement.movementNumber, balanceAfter: stock.qtyOnHand });
    }
    return { count: results.length, results };
  },

  // ── Stock-Out (production issue / consumption) ──────────────────────────────
  async issue(payload, user) {
    const items = (payload.items || []).filter((i) => Number(i.quantity) > 0);
    if (!items.length) throw new AppError('Add at least one item with a quantity.', 400);
    const warehouse = payload.warehouse;
    const allowNegative = !!payload.allowNegative;
    const movementDate = payload.date ? new Date(payload.date) : new Date();

    // Pre-validate on-hand for every line so we don't half-commit an issue.
    if (!allowNegative) {
      const ids = items.map((i) => i.skuId);
      const stocks = await InventoryStock.find({ skuId: { $in: ids } }).lean();
      const onHandBy = new Map(stocks.map((s) => [String(s.skuId), s.qtyOnHand]));
      const short = items.filter((i) => Number(i.quantity) > (onHandBy.get(String(i.skuId)) || 0));
      if (short.length) {
        const names = short.map((i) => i.skuCode || i.skuId).join(', ');
        throw new AppError(`Not enough stock for: ${names}. Lower the quantity or tick "allow negative".`, 400);
      }
    }

    const context = [
      payload.purpose && `Purpose: ${payload.purpose}`,
      payload.issuedTo && `Issued to: ${payload.issuedTo}`,
      payload.department && `Dept: ${payload.department}`,
    ].filter(Boolean).join(' · ');

    const results = [];
    for (const it of items) {
      const { movement, stock } = await inventoryService.decreaseStock({
        skuId: it.skuId, quantity: Number(it.quantity), warehouse,
        txnType: TXN_TYPE.CONSUME_OUT, sourceModule: 'IMS',
        refType: 'IMS_ISSUE', refNumber: payload.reference || '',
        remarks: [context, it.remarks].filter(Boolean).join(' · ') || 'Production issue',
        performedBy: user, movementDate,
      }, { allowNegative });
      results.push({ skuId: it.skuId, movementNumber: movement.movementNumber, balanceAfter: stock.qtyOnHand });
    }
    return { count: results.length, results };
  },

  /** Movement history scoped to consumable/packaging items. */
  async getMovements(query = {}) {
    return inventoryService.getMovements(query);
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

    // Top consumed (OUT) items over the last 30 days.
    const since = new Date(Date.now() - 30 * 86400000);
    const topConsumed = await InventoryMovement.aggregate([
      { $match: { movementType: MOVEMENT_TYPE.OUT, movementDate: { $gte: since }, isDeleted: { $ne: true } } },
      { $group: { _id: { skuId: '$skuId', skuCode: '$skuCode', skuName: '$skuName' }, qty: { $sum: '$quantity' } } },
      { $sort: { qty: -1 } },
      { $limit: 8 },
      { $project: { _id: 0, skuCode: '$_id.skuCode', skuName: '$_id.skuName', qty: 1 } },
    ]);

    const recentMovements = await InventoryMovement.find({ isDeleted: { $ne: true } })
      .sort({ movementDate: -1, createdAt: -1 }).limit(12)
      .select('movementNumber movementDate skuCode skuName movementType txnType quantity balanceAfter performedByName remarks')
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
