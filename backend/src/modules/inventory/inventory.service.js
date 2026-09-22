import InventoryStock, { DEFAULT_WAREHOUSE } from './inventoryStock.model.js';
import InventoryMovement, { MOVEMENT_TYPE, TXN_TYPE } from './inventoryMovement.model.js';
import SKU from '../skus/sku.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import { generateMovementNumber } from '../../utils/docNumberGenerator.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Core stock engine — the ONLY place that mutates InventoryStock. Every call
 * upserts the on-hand balance AND writes one append-only InventoryMovement
 * row, so stock is always reconstructable from the ledger.
 *
 * @param {object} input
 *   skuId* , skuCode?, skuName?, unit?
 *   warehouse?            (default MAIN)
 *   movementType*         'IN' | 'OUT'
 *   txnType*              e.g. 'GRN_IN'
 *   quantity*             magnitude > 0
 *   unitCost?             per-unit cost (drives weighted-avg on IN)
 *   batchNo?, remarks?
 *   sourceModule?, refType?, refId?, refNumber?
 *   vendorId?, vendorName?, poId?, poNumber?, piId?, piNumber?
 *   performedBy?          { _id, name }  (or pass performedBy/performedByName)
 *   movementDate?
 * @param {object} opts  { allowNegative?: boolean }
 * @returns {{ movement, stock }}
 */
const createStockMovement = async (input = {}, opts = {}) => {
  const quantity = round2(input.quantity);
  if (!input.skuId) throw new AppError('skuId is required for a stock movement', 400);
  if (!(quantity > 0)) throw new AppError('Movement quantity must be greater than zero', 400);

  const movementType = input.movementType || MOVEMENT_TYPE.IN;
  if (!Object.values(MOVEMENT_TYPE).includes(movementType)) {
    throw new AppError(`Invalid movementType: ${movementType}`, 400);
  }
  const txnType = input.txnType || (movementType === MOVEMENT_TYPE.IN ? TXN_TYPE.ADJUST_IN : TXN_TYPE.ADJUST_OUT);
  const warehouse = (input.warehouse || DEFAULT_WAREHOUSE).trim();
  const unitCost = round2(input.unitCost);
  const sign = movementType === MOVEMENT_TYPE.IN ? 1 : -1;
  const qtyDelta = round2(sign * quantity);

  // Fill item identity from the SKU master when not supplied.
  let { skuCode, skuName, unit } = input;
  if (!skuCode || !skuName) {
    const sku = await SKU.findById(input.skuId).select('code name unit').lean();
    if (sku) { skuCode = skuCode || sku.code; skuName = skuName || sku.name; unit = unit || sku.unit; }
  }

  // Get-or-create the stock row for this SKU+warehouse.
  let stock = await InventoryStock.findOne({ skuId: input.skuId, warehouse });
  if (!stock) {
    stock = new InventoryStock({
      skuId: input.skuId, skuCode: skuCode || '', skuName: skuName || '', unit: unit || 'PCS',
      warehouse, qtyOnHand: 0,
    });
  }

  if (movementType === MOVEMENT_TYPE.OUT && stock.qtyOnHand < quantity && !opts.allowNegative) {
    throw new AppError(`Insufficient stock for ${skuCode || input.skuId} in ${warehouse} (on-hand ${stock.qtyOnHand}, requested ${quantity})`, 400);
  }

  // Weighted-average cost on IN (only when a unit cost is given).
  if (movementType === MOVEMENT_TYPE.IN && unitCost > 0) {
    const newQty = stock.qtyOnHand + quantity;
    stock.avgCost = newQty > 0 ? round2((stock.qtyOnHand * stock.avgCost + quantity * unitCost) / newQty) : unitCost;
    stock.lastCost = unitCost;
  }

  stock.qtyOnHand = round2(stock.qtyOnHand + qtyDelta);
  stock.lastMovementAt = input.movementDate || new Date();
  if (skuCode && !stock.skuCode) stock.skuCode = skuCode;
  if (skuName && !stock.skuName) stock.skuName = skuName;
  stock.updatedBy = input.performedBy?._id || input.performedById;
  await stock.save(opts.session ? { session: opts.session } : undefined);

  const movementNumber = await generateMovementNumber(input.movementDate || new Date());
  const [movement] = await InventoryMovement.create([{
    movementNumber,
    movementDate: input.movementDate || new Date(),
    skuId: input.skuId, skuCode: skuCode || '', skuName: skuName || '', unit: unit || stock.unit,
    warehouse,
    txnType, movementType, quantity, qtyDelta,
    balanceAfter: stock.qtyOnHand,
    unitCost, lineValue: round2(quantity * unitCost),
    batchNo: input.batchNo || '',
    sourceModule: input.sourceModule || '',
    refType: input.refType || '',
    refId: input.refId || undefined,
    refNumber: input.refNumber || '',
    vendorId: input.vendorId || undefined,
    vendorName: input.vendorName || '',
    poId: input.poId || undefined,
    poNumber: input.poNumber || '',
    piId: input.piId || undefined,
    piNumber: input.piNumber || '',
    // Only manual entries set these; every other caller leaves them blank.
    reason: input.reason || '',
    customReason: input.customReason || '',
    remarks: input.remarks || '',
    performedBy: input.performedBy?._id || input.performedById,
    performedByName: input.performedBy?.name || input.performedByName || '',
    createdBy: input.performedBy?._id || input.performedById,
  }], opts.session ? { session: opts.session } : undefined);

  return { movement, stock };
};

export const inventoryService = {
  createStockMovement,

  /** Thin helper: record an IN movement (caller supplies txnType e.g. GRN_IN). */
  increaseStock: (input, opts) => createStockMovement({ ...input, movementType: MOVEMENT_TYPE.IN }, opts),

  /** Thin helper: record an OUT movement. */
  decreaseStock: (input, opts) => createStockMovement({ ...input, movementType: MOVEMENT_TYPE.OUT }, opts),

  // ── Reads (for the future Inventory Ledger screen + traceability) ──
  async getStock(query) {
    const features = new ApiFeatures(InventoryStock.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['skuCode', 'skuName']).sort().select().paginate();
    return features.exec();
  },

  async getStockBySku(skuId) {
    return InventoryStock.find({ skuId, isDeleted: { $ne: true } }).lean();
  },

  async getMovements(query) {
    const features = new ApiFeatures(InventoryMovement.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['movementNumber', 'skuCode', 'skuName', 'refNumber', 'poNumber', 'piNumber', 'vendorName'])
      .sort().select().paginate();
    return features.exec();
  },

  /** Every movement created by a given source document (e.g. a GRN). */
  async getMovementsByRef(refType, refId) {
    return InventoryMovement.find({ refType, refId, isDeleted: { $ne: true } }).sort('createdAt').lean();
  },

  async getStats() {
    const rows = await InventoryStock.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          skuCount:   { $sum: 1 },
          totalQty:   { $sum: '$qtyOnHand' },
          stockValue: { $sum: { $multiply: ['$qtyOnHand', '$avgCost'] } },
        },
      },
    ]);
    return rows[0] || { skuCount: 0, totalQty: 0, stockValue: 0 };
  },

  /** Manual adjustment endpoint (reuses the same engine). */
  async adjust(data, user) {
    const movementType = data.movementType || MOVEMENT_TYPE.IN;
    return createStockMovement({
      ...data,
      movementType,
      txnType: movementType === MOVEMENT_TYPE.IN ? TXN_TYPE.ADJUST_IN : TXN_TYPE.ADJUST_OUT,
      sourceModule: 'INVENTORY',
      refType: 'ADJUSTMENT',
      remarks: data.remarks || 'Manual stock adjustment',
      performedBy: user,
    });
  },
};

export { MOVEMENT_TYPE, TXN_TYPE };
