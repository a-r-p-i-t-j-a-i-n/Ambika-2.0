import Vendor from './vendor.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';

export const vendorService = {
  async getAll(query) {
    const features = new ApiFeatures(Vendor.find({ isDeleted: { $ne: true } }), query)
      .filter()
      .search(['name', 'code', 'contactPerson', 'gstNo'])
      .sort()
      .select()
      .paginate();
    return features.exec();
  },

  async getById(id) {
    const vendor = await Vendor.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!vendor) throw new AppError('Vendor not found', 404);
    return vendor;
  },

  async create(data, userId) {
    return Vendor.create({ ...data, createdBy: userId });
  },

  async update(id, data, userId) {
    const vendor = await Vendor.findOneAndUpdate(
      { _id: id, isDeleted: { $ne: true } },
      { $set: { ...data, updatedBy: userId } },
      { new: true, runValidators: true },
    ).lean();
    if (!vendor) throw new AppError('Vendor not found', 404);
    return vendor;
  },

  async remove(id, userId) {
    const vendor = await Vendor.findOneAndUpdate(
      { _id: id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, updatedBy: userId } },
      { new: true },
    );
    if (!vendor) throw new AppError('Vendor not found', 404);
    return vendor;
  },
};
