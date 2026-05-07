import Party from './party.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';

export const partyService = {
  async create(data) {
    return Party.create(data);
  },

  async getAll(query) {
    const features = new ApiFeatures(Party.find(), query)
      .filter()
      .search(['name', 'code', 'location', 'contactPerson'])
      .sort()
      .select()
      .paginate();
    return features.exec();
  },

  async getById(id) {
    const party = await Party.findById(id).lean();
    if (!party) throw new AppError('Party not found', 404);
    return party;
  },

  async update(id, data) {
    const party = await Party.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    }).lean();
    if (!party) throw new AppError('Party not found', 404);
    return party;
  },

  async remove(id) {
    const party = await Party.findByIdAndDelete(id);
    if (!party) throw new AppError('Party not found', 404);
    return party;
  },

  async getByName(name) {
    return Party.findOne({ name: new RegExp(`^${name}$`, 'i') }).lean();
  },
};
