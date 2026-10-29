import Sku from './sku.model.js';
import InventoryStock from '../inventory/inventoryStock.model.js';
import GoodsReceiptNote, { GRN_LINE_STOCK_STATUS } from '../procurement/grn/grn.model.js';
import { AppError } from '../../utils/apiResponse.js';
import { normalizeConversionConfig, sameUnit } from './unitConversion.js';

const CONVERSION_FIELDS = ['purchaseUnit', 'purchaseConversionFactor'];
const touchesConversion = (data = {}) => ['unit', ...CONVERSION_FIELDS].some((f) => data[f] !== undefined);

/**
 * Validate the purchase-unit conversion the SKU would have after this save
 * (stored values overlaid with the request) and write the normalised pair back
 * onto `data`. A request that touches none of unit / purchaseUnit / factor is
 * left alone, so price-only edits and imports never trip over it.
 */
const applyConversionConfig = (data, stored = {}) => {
  if (!touchesConversion(data)) return data;
  const pick = (f) => (data[f] !== undefined ? data[f] : stored?.[f]);
  const { value, errors } = normalizeConversionConfig({
    unit: pick('unit'), purchaseUnit: pick('purchaseUnit'), purchaseConversionFactor: pick('purchaseConversionFactor'),
  });
  if (errors.length) throw new AppError(errors.join(' '), 400);
  return { ...data, ...value };
};

/**
 * The stock unit names what every existing stock row and ledger movement of
 * the SKU counts in. Relabelling it while stock is held ("BOX" → "PCS") would
 * silently turn 40 boxes into 40 pieces, so a real change is refused until the
 * stock is zero. Spellings of the same unit ("pcs" → "PCS", "Kg" → "KGS") are
 * not a change.
 */
const assertStockUnitChangeAllowed = async (sku, nextUnit) => {
  if (nextUnit === undefined || !sku) return;
  const current = String(sku.unit || '').trim();
  const next = String(nextUnit || '').trim();
  if (!current || !next || sameUnit(current, next)) return;
  const held = await InventoryStock.findOne({ skuId: sku._id, isDeleted: { $ne: true }, qtyOnHand: { $ne: 0 } })
    .select('warehouse qtyOnHand unit').lean();
  if (held) {
    throw new AppError(
      `Stock Unit cannot change from ${current} to ${next}: ${held.qtyOnHand} ${held.unit || current} is in stock at ${held.warehouse}, `
      + `and that stock is counted in ${current}. To buy this item in another unit, set a Purchase Unit and conversion factor instead.`,
      409,
    );
  }
  // Received but not yet through QC: it posts on QC completion in the unit its
  // GRN line froze, so it is stock in all but name.
  const awaiting = await GoodsReceiptNote.findOne({
    isDeleted: { $ne: true },
    items: { $elemMatch: { skuId: sku._id, stockStatus: GRN_LINE_STOCK_STATUS.AWAITING_QC } },
  }).select('grnNumber').lean();
  if (awaiting) {
    throw new AppError(
      `Stock Unit cannot change from ${current} to ${next}: ${awaiting.grnNumber} has this item received and awaiting Incoming QC, `
      + `and it will be posted in ${current}. Complete that QC first, or set a Purchase Unit and conversion factor instead.`,
      409,
    );
  }
};

export const createSku = async (data, userId) => {
  const existingSku = await Sku.findOne({ code: String(data.code || '').trim().toUpperCase(), isDeleted: false });
  if (existingSku) {
    throw new AppError(`SKU code '${data.code}' already exists`, 400);
  }
  
  const sku = new Sku({
    ...applyConversionConfig(data),
    createdBy: userId
  });
  
  return await sku.save();
};

export const getSkus = async (query = {}) => {
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 10;
  const skip = (page - 1) * limit;
  
  const filter = { isDeleted: false };
  if (query.clientId) filter.clientId = query.clientId;
  if (query.itemType) filter.itemType = query.itemType;
  if (query.category) filter.category = query.category;

  if (query.search) {
    filter.$or = [
      { name: new RegExp(query.search, 'i') },
      { code: new RegExp(query.search, 'i') },
      { category: new RegExp(query.search, 'i') },
      { aliases: new RegExp(query.search, 'i') }
    ];
  }
  
  const [data, total, itemTypeAgg] = await Promise.all([
    Sku.find(filter)
      .populate('clientId', 'companyName code')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }),
    Sku.countDocuments(filter),
    // Counts per item type across ALL non-deleted SKUs — drives the kind tabs,
    // so they stay stable while the user filters the list.
    Sku.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$itemType', count: { $sum: 1 } } },
    ]),
  ]);

  const itemTypeCounts = itemTypeAgg.reduce((acc, r) => {
    acc[r._id || 'FINISHED_GOOD'] = r.count;
    return acc;
  }, {});

  return { data, meta: { total, page, limit, itemTypeCounts } };
};

export const getSkuById = async (id) => {
  const sku = await Sku.findOne({ _id: id, isDeleted: false }).populate('clientId', 'companyName code');
  if (!sku) throw new AppError('SKU not found', 404);
  return sku;
};

export const deleteSku = async (id, userId) => {
  const sku = await Sku.findOne({ _id: id, isDeleted: false });
  if (!sku) throw new AppError('SKU not found', 404);
  sku.isDeleted = true;
  sku.isActive = false;
  sku.deletedAt = new Date();
  sku.deletedBy = userId;
  await sku.save();
  return { ok: true, code: sku.code, name: sku.name };
};

/**
 * @param {object} [opts]
 *   canReclassify  caller holds `masters.editSku`. Required to CHANGE an
 *                  existing SKU's itemType: it decides which inventory module
 *                  purchased stock is posted to. Re-sending the same value is
 *                  not a change and needs nothing.
 */
export const updateSku = async (id, data, userId, opts = {}) => {
  const sku = await Sku.findOne({ _id: id, isDeleted: false });
  if (!sku) throw new AppError('SKU not found', 404);

  if (data.itemType !== undefined && data.itemType !== sku.itemType && !opts.canReclassify) {
    throw new AppError('Changing a SKU\'s Item Type requires the "Create / edit SKUs" (masters.editSku) permission — it decides where purchased stock is posted.', 403);
  }

  if (data.code && String(data.code).trim().toUpperCase() !== sku.code) {
    const existingSku = await Sku.findOne({
      _id: { $ne: id },
      code: String(data.code).trim().toUpperCase(),
      isDeleted: false,
    });
    if (existingSku) throw new AppError(`SKU code '${data.code}' already exists`, 400);
  }
  
  await assertStockUnitChangeAllowed(sku, data.unit);
  // Only future receipts use a new factor: posted stock and completed GRNs keep
  // the factor frozen on them (unitConversion.js).
  Object.assign(sku, applyConversionConfig(data, sku));
  sku.updatedBy = userId;
  
  return await sku.save();
};

export const bulkUpsertSkus = async (items = [], userId) => {
  const results = [];

  for (const item of items) {
    const code = String(item.code || '').trim().toUpperCase();
    const payload = {
      ...item,
      code,
      name: String(item.name || '').trim(),
      updatedBy: userId,
    };

    // A row that creates a NEW SKU must classify it. Without this the Mongoose
    // default (FINISHED_GOOD) would apply silently and the item would land in
    // a blocked destination — the same rule the create endpoint enforces, kept
    // here so an import cannot reach around it. Rows for codes that already
    // exist stay exempt: an omitted itemType is not written, so a price-only
    // import neither needs one nor can reclassify anything.
    if (!item.itemType) {
      const exists = await Sku.exists({ code });
      if (!exists) {
        throw new AppError(
          `Item Type is required for new SKU '${code}' — it decides which inventory its purchased stock is posted to. Add an Item Type column for every row that creates a SKU.`,
          400,
        );
      }
    }

    let row = payload;
    if (touchesConversion(item)) {
      const stored = await Sku.findOne({ code }).select('_id unit purchaseUnit purchaseConversionFactor').lean();
      await assertStockUnitChangeAllowed(stored, item.unit);
      row = applyConversionConfig(payload, stored || {});
    }

    const doc = await Sku.findOneAndUpdate(
      { code },
      {
        $set: row,
        $setOnInsert: { createdBy: userId },
      },
      { new: true, upsert: true, runValidators: true },
    );
    results.push(doc);
  }

  return results;
};

export const getSkuLookup = async (query = {}) => {
  const filter = { isDeleted: false, isActive: true };
  if (query.itemType) filter.itemType = query.itemType;
  if (query.category) filter.category = query.category;
  // Exact SKUs by id (comma-separated) — e.g. the GRN form resolving the item
  // types of the PO lines it shows. Anything that is not an ObjectId is ignored.
  if (query.ids) {
    filter._id = { $in: String(query.ids).split(',').map((s) => s.trim()).filter((s) => /^[0-9a-fA-F]{24}$/.test(s)) };
  }
  if (query.search) {
    filter.$or = [
      { name: new RegExp(query.search, 'i') },
      { code: new RegExp(query.search, 'i') },
      { aliases: new RegExp(query.search, 'i') },
    ];
  }
  // Master-only filter — excludes client-specific SKUs (those that have a clientId).
  // Used by the calculator / revise dialog so universal pickers don't show
  // party-prefixed entries like "ATOMBERG-MG-1.1-JAR-DRAW-TOOLS".
  if (String(query.masterOnly) === 'true') {
    filter.$or = [
      ...(filter.$or || []),
    ];
    filter.clientId = { $in: [null, undefined] };
  }

  // Party-scoped picker (Sales Order punching) — show the SKUs LINKED to this
  // client plus the universal/unlinked ones, but never another client's items.
  // ($in with null also matches docs where clientId was never set.)
  else if (query.clientId) {
    filter.clientId = { $in: [query.clientId, null] };
  }

  return Sku.find(filter)
    .select(
      'name code itemType category pcsPerBox weightPerPc weightPerBox unit purchaseUnit purchaseConversionFactor aliases ' +
      'convertedItemNameForResale ' +
      'sellingPrice rmCost gstRate sellingPriceFrom rmCostFrom marginFloor clientId',
    )
    .sort({ name: 1 })
    .limit(Math.min(parseInt(query.limit, 10) || 500, 2000))
    .lean();
};
