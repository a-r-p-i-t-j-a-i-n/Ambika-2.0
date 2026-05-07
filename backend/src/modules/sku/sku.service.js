import SKU from './sku.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';

export const skuService = {
  async create(data) {
    return SKU.create(data);
  },

  async getAll(query) {
    const features = new ApiFeatures(SKU.find(), query)
      .filter()
      .search(['name', 'code', 'category'])
      .sort()
      .select()
      .paginate();
    return features.exec();
  },

  async getById(id) {
    const sku = await SKU.findById(id).lean();
    if (!sku) throw new AppError('SKU not found', 404);
    return sku;
  },

  async getByCode(code) {
    return SKU.findOne({ code: code.toUpperCase() }).lean();
  },

  async update(id, data) {
    const sku = await SKU.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    }).lean();
    if (!sku) throw new AppError('SKU not found', 404);
    return sku;
  },

  async remove(id) {
    const sku = await SKU.findByIdAndDelete(id);
    if (!sku) throw new AppError('SKU not found', 404);
    return sku;
  },

  async updateStock(id, { fgStock, wipStock }) {
    const update = {};
    if (fgStock !== undefined) update.fgStock = fgStock;
    if (wipStock !== undefined) update.wipStock = wipStock;
    return SKU.findByIdAndUpdate(id, update, { new: true }).lean();
  },
};
