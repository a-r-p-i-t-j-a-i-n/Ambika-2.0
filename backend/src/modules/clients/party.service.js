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

  /**
   * Keep a party's saved catalog (`orderedSkus`) in sync with an order's items.
   *   • A SKU not yet in the catalog is LEARNED (added as a new item).
   *   • A changed price APPENDS to that item's priceHistory and updates the latest
   *     `sellingPrice` — past prices are never overwritten.
   *   • Items are never removed here (dropping a SKU from one order must not wipe
   *     it from the client's group).
   * Best-effort and idempotent: re-submitting the same prices adds no history.
   */
  async syncOrderedSkus(partyId, items = [], meta = {}) {
    if (!partyId || !Array.isArray(items) || !items.length) return null;
    const party = await Party.findById(partyId);
    if (!party) return null;

    const now = new Date();
    const soNumber = meta.soNumber || '';
    const source = meta.source || 'ORDER';
    const catalog = party.orderedSkus || [];

    const matches = (entry, it) => (
      (it.skuId && entry.skuId && String(entry.skuId) === String(it.skuId))
      || (it.skuCode && entry.skuCode && entry.skuCode.toUpperCase() === String(it.skuCode).toUpperCase())
    );

    let changed = false;
    for (const it of items) {
      const skuName = it.skuName || '';
      const skuCode = (it.skuCode || '').toUpperCase();
      if (!skuName && !skuCode && !it.skuId) continue;
      const price = Number(it.rate ?? it.sellingPrice ?? it.price ?? 0) || 0;

      let entry = catalog.find((c) => matches(c, it));
      if (!entry) {
        // New SKU for this client — learn it into the group.
        catalog.push({
          skuId: it.skuId || null,
          skuName,
          skuCode,
          unit: it.unit || 'Pcs',
          sellingPrice: price,
          priceHistory: price > 0 ? [{ price, at: now, soNumber, source }] : [],
          lastOrderedAt: now,
        });
        changed = true;
        continue;
      }

      // Backfill a skuId we now know.
      if (!entry.skuId && it.skuId) entry.skuId = it.skuId;
      entry.lastOrderedAt = now;
      changed = true;

      if (price > 0) {
        // Seed the timeline with the prior price so the original is never lost.
        if ((!entry.priceHistory || entry.priceHistory.length === 0) && Number(entry.sellingPrice) > 0) {
          entry.priceHistory.push({ price: Number(entry.sellingPrice), at: entry.lastOrderedAt || now, soNumber: '', source: 'OPENING' });
        }
        if (Number(entry.sellingPrice || 0) !== price) {
          entry.sellingPrice = price;
          entry.priceHistory.push({ price, at: now, soNumber, source });
        }
      }
    }

    if (changed) {
      party.orderedSkus = catalog;
      party.markModified('orderedSkus');
      await party.save();
    }
    return party.orderedSkus;
  },
};
