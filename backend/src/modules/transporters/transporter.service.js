import Transporter from './transporter.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import { recycleBinService } from '../recycle-bin/recycleBin.service.js';
import { binPlan } from '../recycle-bin/recycleBin.restore.js';

export const transporterService = {
  async getAll(query) {
    const features = new ApiFeatures(Transporter.find({ isDeleted: { $ne: true } }), query)
      .filter()
      .search(['name', 'code', 'contactPerson', 'phone', 'gstNo'])
      .sort()
      .select()
      .paginate();
    return features.exec();
  },

  async getById(id) {
    const t = await Transporter.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!t) throw new AppError('Transporter not found', 404);
    return t;
  },

  async create(data, userId) {
    return Transporter.create({ ...data, createdBy: userId });
  },

  async update(id, data, userId) {
    const t = await Transporter.findOneAndUpdate(
      { _id: id, isDeleted: { $ne: true } },
      { $set: { ...data, updatedBy: userId } },
      { new: true, runValidators: true },
    ).lean();
    if (!t) throw new AppError('Transporter not found', 404);
    return t;
  },

  async remove(id, userId) {
    const t = await Transporter.findOneAndUpdate(
      { _id: id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, updatedBy: userId } },
      { new: true },
    );
    if (!t) throw new AppError('Transporter not found', 404);
    await recycleBinService.record('transporter', {
      recordId: t._id,
      title: t.name,
      subtitle: [t.code, t.phone].filter(Boolean).join(' · '),
      keywords: [t.contactPerson, t.gstNo, t.vehicleTypes],
      actor: userId,
      plan: { steps: [binPlan.unhide(Transporter.modelName, t._id)] },
    });
    return t;
  },
};
