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
  
  if (query.search) {
    filter.$or = [
      { name: new RegExp(query.search, 'i') },
      { code: new RegExp(query.search, 'i') },
      { category: new RegExp(query.search, 'i') },
      { aliases: new RegExp(query.search, 'i') }
    ];
  }
  
  const [data, total] = await Promise.all([
    Sku.find(filter)
      .populate('clientId', 'companyName code')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }),
    Sku.countDocuments(filter)
  ]);
  
  return { data, meta: { total, page, limit } };
};

export const getSkuById = async (id) => {
  const sku = await Sku.findOne({ _id: id, isDeleted: false }).populate('clientId', 'companyName code');
  if (!sku) throw new AppError('SKU not found', 404);
  return sku;
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
  if (query.search) {
    filter.$or = [
      { name: new RegExp(query.search, 'i') },
      { code: new RegExp(query.search, 'i') },
      { aliases: new RegExp(query.search, 'i') },
    ];
  }

  return Sku.find(filter)
    .select('name code category pcsPerBox weightPerPc weightPerBox unit aliases')
    .sort({ name: 1 })
    .limit(Math.min(parseInt(query.limit, 10) || 500, 1000))
    .lean();
};
