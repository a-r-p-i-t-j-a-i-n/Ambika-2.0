import InventoryPolicy from './inventoryPolicy.model.js';
import InventoryStock from './inventoryStock.model.js';
import InventoryMovement, { MOVEMENT_TYPE, TXN_TYPE } from './inventoryMovement.model.js';
import CoilConversion from './coilConversion.model.js';
import { inventoryService } from './inventory.service.js';
import { generateDocNumber } from '../../utils/docNumberGenerator.js';
import SKU from '../skus/sku.model.js';
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

export const RM_ITEM_TYPES = ['RAW_MATERIAL', 'CIRCLE'];
const kindOf = (itemType) => (itemType === 'CIRCLE' ? 'CIRCLE' : 'COIL');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

// Active ADC = the column the chosen mode points at, falling back to the legacy ADC.
const resolveAdc = (policy = {}) => {
  const mode = policy.consumptionMode || 'LOW';
  const byMode = { LOW: policy.adcLow, NORMAL: policy.adcNormal, PEAK: policy.adcPeak }[mode];
  return Number(byMode || policy.averageDailyConsumption || 0);
};

/** Stock status + planning metrics from on-hand/in-transit/booked vs policy. */
const deriveMetrics = (policy = {}, stock = {}) => {
  const adc = resolveAdc(policy);
  const leadDays = Number(policy.leadDays || 0);
  const safetyFactor = Number(policy.safetyFactor || 1.5);
  const inTransit = Number(policy.materialInTransit || 0);
  const booked = Number(policy.bookedQty || 0);
  const onHand = round2(stock.qtyOnHand || 0);

  const leadTimeDemand = round2(adc * leadDays);
  const maxLevel = round2(policy.maxLevel || adc * leadDays * safetyFactor);
  const safetyStock = round2(Math.max(0, maxLevel - leadTimeDemand));
  const reorderPoint = leadTimeDemand;
  // Available to plan with = on-hand + in-transit − already booked.
  const projectedAvailable = round2(onHand + inTransit - booked);
  const daysCover = adc > 0 ? round2(onHand / adc) : null;
  // "Available in %" against the max level (the sheet's coloured % column).
  const availablePct = maxLevel > 0 ? Math.round((projectedAvailable / maxLevel) * 100) : null;

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
    onHand, inTransit, booked, adc, leadDays, safetyFactor,
    leadTimeDemand, safetyStock, reorderPoint, maxLevel,
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

    const [stocks, policies] = await Promise.all([
      InventoryStock.find({ skuId: { $in: ids }, isDeleted: { $ne: true } }).lean(),
      InventoryPolicy.find({ skuId: { $in: ids }, isDeleted: { $ne: true } }).lean(),
    ]);
    const stockBy = new Map(stocks.map((s) => [String(s.skuId), s]));
    const polBy = new Map(policies.map((p) => [String(p.skuId), p]));

    const rows = skus.map((sku) => {
      const stock = stockBy.get(String(sku._id)) || {};
      const policy = polBy.get(String(sku._id)) || {
        averageDailyConsumption: 0, leadDays: sku.leadDays ?? 16, safetyFactor: 2,
        moq: 0, maxLevel: 0, materialInTransit: 0, bookedQty: 0, openingStock: 0,
      };
      const m = deriveMetrics(policy, stock);
      return {
        skuId: sku._id,
        skuCode: sku.code,
        skuName: sku.name,
        itemType: sku.itemType,
        kind: kindOf(sku.itemType),
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
        ...m,
      };
    });

    let docs = rows;
    if (query.kind) docs = docs.filter((r) => r.kind === query.kind);
    if (query.status) docs = docs.filter((r) => r.status === query.status);
    return { docs, summary: this._summary(rows) };
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
      if (m.inTransit > 0 && d === Math.round(m.leadDays)) projected = round2(projected + m.inTransit);
      if (d > 0) projected = round2(projected - m.adc);
      const clamped = Math.max(0, projected);
      if (reorderDay === null && clamped <= m.reorderPoint) reorderDay = d;
      if (stockoutDay === null && clamped <= 0) stockoutDay = d;
      series.push({ day: d, date, projected: clamped });
    }
    return {
      sku: { skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: sku.unit, category: sku.category, kind: kindOf(sku.itemType) },
      metrics: m, reorderDay, stockoutDay, series,
    };
  },

  async getReorderList(query = {}) {
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
      vendorName: data.vendorName, rate: data.rate,
      convertedItemName: data.convertedItemName, remarks: data.remarks,
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

  // ── Stock-In (manual receipt / opening / correction) ───────────────────────
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
        txnType, sourceModule: 'RM_IMS', refType: 'RM_RECEIPT', refNumber: payload.reference || '',
        remarks: [reason === 'OPENING' ? 'Opening stock' : 'Stock-in', payload.reference, it.remarks].filter(Boolean).join(' · '),
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
    const allowNegative = !!payload.allowNegative;
    const movementDate = payload.date ? new Date(payload.date) : new Date();

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
        skuId: it.skuId, quantity: Number(it.quantity), warehouse: payload.warehouse,
        txnType: TXN_TYPE.CONSUME_OUT, sourceModule: 'RM_IMS',
        refType: 'RM_ISSUE', refNumber: payload.reference || '',
        remarks: [context, it.remarks].filter(Boolean).join(' · ') || 'Production issue',
        performedBy: user, movementDate,
      }, { allowNegative });
      results.push({ skuId: it.skuId, movementNumber: movement.movementNumber, balanceAfter: stock.qtyOnHand });
    }
    return { count: results.length, results };
  },

  // ── Coil → Circle conversion (blanking) ─────────────────────────────────────
  /**
   * Consume a coil and produce one or more circle SKUs. Writes a CONVERT_OUT for
   * the coil and a CONVERT_IN per circle, records scrap & yield, and stores the
   * conversion document for the Scrap-summary / Circle In-Out views.
   */
  async convert(payload, user) {
    const coil = await SKU.findById(payload.coilSkuId).select('code name unit itemType').lean();
    if (!coil) throw new AppError('Coil SKU not found', 404);
    const coilWeight = Number(payload.coilWeightKg || 0);
    if (coilWeight <= 0) throw new AppError('Coil weight must be greater than zero.', 400);

    const circles = (payload.circles || []).filter((c) => c.circleSkuId && Number(c.weightKg) > 0);
    if (!circles.length) throw new AppError('Add at least one produced circle (with weight).', 400);

    const conversionDate = payload.conversionDate ? new Date(payload.conversionDate) : new Date();
    const allowNegative = !!payload.allowNegative;

    // Guard coil stock unless overridden.
    if (!allowNegative) {
      const coilStock = await InventoryStock.findOne({ skuId: coil._id }).lean();
      if (coilWeight > Number(coilStock?.qtyOnHand || 0)) {
        throw new AppError(`Not enough coil stock for ${coil.code} (on hand ${coilStock?.qtyOnHand || 0}). Tick "allow negative" to override.`, 400);
      }
    }

    const conversionNumber = await generateDocNumber('RM_CONVERSION', conversionDate).catch(() => `RMC-${Date.now()}`);

    // 1) Consume the coil.
    const { movement: coilMov } = await inventoryService.decreaseStock({
      skuId: coil._id, skuCode: coil.code, skuName: coil.name, unit: coil.unit,
      quantity: coilWeight, warehouse: payload.warehouse,
      txnType: TXN_TYPE.CONVERT_OUT, sourceModule: 'RM_IMS', refType: 'RM_CONVERSION', refNumber: conversionNumber,
      batchNo: payload.batchNo || '',
      remarks: `Coil consumed for circle conversion${payload.batchNo ? ` · batch ${payload.batchNo}` : ''}`,
      performedBy: user, movementDate: conversionDate,
    }, { allowNegative });

    // 2) Produce each circle SKU.
    const producedRows = [];
    let circlesWeight = 0;
    for (const c of circles) {
      const circleSku = await SKU.findById(c.circleSkuId).select('code name unit').lean();
      if (!circleSku) throw new AppError(`Circle SKU ${c.circleSkuId} not found`, 404);
      const pcs = Number(c.pcs || 0);
      const wt = Number(c.weightKg || 0);
      circlesWeight = round2(circlesWeight + wt);
      const { movement: circMov } = await inventoryService.increaseStock({
        skuId: circleSku._id, skuCode: circleSku.code, skuName: circleSku.name, unit: circleSku.unit || 'PCS',
        quantity: pcs > 0 ? pcs : wt, unitCost: Number(payload.rate || 0),
        warehouse: payload.warehouse,
        txnType: TXN_TYPE.CONVERT_IN, sourceModule: 'RM_IMS', refType: 'RM_CONVERSION', refNumber: conversionNumber,
        batchNo: payload.batchNo || '',
        remarks: `Circles produced from ${coil.code}${payload.batchNo ? ` · batch ${payload.batchNo}` : ''}`,
        performedBy: user, movementDate: conversionDate,
      });
      producedRows.push({
        circleSkuId: circleSku._id, circleSkuCode: circleSku.code, circleSkuName: circleSku.name,
        sizeLabel: c.sizeLabel || '', pcs, weightKg: wt,
        movementId: circMov._id, movementNumber: circMov.movementNumber,
      });
    }

    const scrapKg = round2(coilWeight - circlesWeight);
    const yieldRatioPct = coilWeight > 0 ? round2((circlesWeight / coilWeight) * 100) : 0;

    const doc = await CoilConversion.create({
      conversionNumber, conversionDate,
      batchNo: payload.batchNo || '',
      coilSkuId: coil._id, coilSkuCode: coil.code, coilSkuName: coil.name,
      coilWeightKg: coilWeight, rate: Number(payload.rate || 0),
      circles: producedRows,
      circlesWeightKg: circlesWeight, scrapKg, yieldRatioPct,
      scrapVerified: payload.scrapVerified || 'PENDING',
      coilMovementId: coilMov._id, coilMovementNumber: coilMov.movementNumber,
      remarks: payload.remarks || '',
      createdBy: user?._id,
    });
    return doc.toObject();
  },

  async listConversions(query = {}) {
    const filter = { isDeleted: { $ne: true } };
    if (query.search) {
      const r = rx(query.search);
      filter.$or = [{ conversionNumber: r }, { batchNo: r }, { coilSkuCode: r }, { coilSkuName: r }];
    }
    const limit = Math.min(Number(query.limit) || 100, 500);
    const docs = await CoilConversion.find(filter).sort({ conversionDate: -1, createdAt: -1 }).limit(limit).lean();
    const totals = docs.reduce((a, d) => ({
      coilKg: round2(a.coilKg + d.coilWeightKg),
      circlesKg: round2(a.circlesKg + d.circlesWeightKg),
      scrapKg: round2(a.scrapKg + d.scrapKg),
    }), { coilKg: 0, circlesKg: 0, scrapKg: 0 });
    const avgYield = docs.length ? round2(docs.reduce((s, d) => s + (d.yieldRatioPct || 0), 0) / docs.length) : 0;
    return { docs, totals: { ...totals, avgYield } };
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
