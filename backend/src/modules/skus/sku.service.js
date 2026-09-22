import Sku from './sku.model.js';
import { AppError } from '../../utils/apiResponse.js';

export const createSku = async (data, userId) => {
  const existingSku = await Sku.findOne({ code: String(data.code || '').trim().toUpperCase(), isDeleted: false });
  if (existingSku) {
    throw new AppError(`SKU code '${data.code}' already exists`, 400);
  }
  
  const sku = new Sku({
    ...data,
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

export const updateSku = async (id, data, userId) => {
  const sku = await Sku.findOne({ _id: id, isDeleted: false });
  if (!sku) throw new AppError('SKU not found', 404);

  if (data.code && String(data.code).trim().toUpperCase() !== sku.code) {
    const existingSku = await Sku.findOne({
      _id: { $ne: id },
      code: String(data.code).trim().toUpperCase(),
      isDeleted: false,
    });
    if (existingSku) throw new AppError(`SKU code '${data.code}' already exists`, 400);
  }
  
  Object.assign(sku, data);
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

    const doc = await Sku.findOneAndUpdate(
      { code },
      {
        $set: payload,
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
      'name code itemType category pcsPerBox weightPerPc weightPerBox unit aliases ' +
      'convertedItemNameForResale ' +
      'sellingPrice rmCost gstRate sellingPriceFrom rmCostFrom marginFloor clientId',
    )
    .sort({ name: 1 })
    .limit(Math.min(parseInt(query.limit, 10) || 500, 2000))
    .lean();
};
