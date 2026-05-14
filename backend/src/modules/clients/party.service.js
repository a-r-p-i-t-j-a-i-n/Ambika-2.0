import Party from './party.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';

export const partyService = {
  async create(data, userId) {
    const party = new Party({
      ...data,
      createdBy: userId,
      activityTimeline: [{
        action: 'CREATE',
        description: 'Party created manually or via import',
        actorId: userId,
      }]
    });
    return party.save();
  },

  async getAll(query) {
    const features = new ApiFeatures(Party.find({ isDeleted: { $ne: true } }), query)
      .filter()
      .search(['name', 'code', 'location', 'contactPerson'])
      .sort()
      .select()
      .paginate();
    return features.exec();
  },

  async getById(id) {
    const party = await Party.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!party) throw new AppError('Party not found', 404);
    return party;
  },

  async update(id, data, userId) {
    const updateData = {
      ...data,
      updatedBy: userId,
    };
    
    const party = await Party.findOneAndUpdate(
      { _id: id, isDeleted: { $ne: true } },
      { 
        $set: updateData,
        $push: { 
          activityTimeline: {
            action: 'UPDATE',
            description: 'Party details updated',
            actorId: userId,
          }
        }
      },
      { new: true, runValidators: true }
    ).lean();

    if (!party) throw new AppError('Party not found', 404);
    return party;
  },

  async remove(id, userId) {
    const party = await Party.findOneAndUpdate(
      { _id: id },
      { 
        isDeleted: true, 
        deletedAt: new Date(),
        deletedBy: userId,
        $push: { 
          activityTimeline: {
            action: 'DELETE',
            description: 'Party soft-deleted',
            actorId: userId,
          }
        }
      }
    );
    if (!party) throw new AppError('Party not found', 404);
    return party;
  },

  async upsertByCode(code, data, userId) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    const existing = await Party.findOne({ code: normalizedCode });

    if (existing) {
      return this.update(existing._id, data, userId);
    } else {
      return this.create({ ...data, code: normalizedCode }, userId);
    }
  },

  async getByName(name) {
    return Party.findOne({ name: new RegExp(`^${name}$`, 'i') }).lean();
  },
};
