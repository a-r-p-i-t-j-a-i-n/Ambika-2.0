import Party from './party.model.js';
import Sku from '../skus/sku.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import { recycleBinService } from '../recycle-bin/recycleBin.service.js';
import { binPlan } from '../recycle-bin/recycleBin.restore.js';

/** The same SKU: by SKU id, else by code (rows from the Party sheet may have no id). */
const sameSku = (entry, sku) => (
  (entry.skuId && String(entry.skuId) === String(sku._id))
  || (Boolean(entry.skuCode) && Boolean(sku.code) && String(entry.skuCode).toUpperCase() === String(sku.code).toUpperCase())
);

/**
 * Add SKUs from the SKU master to a party's Ordered SKUs (plain objects in,
 * plain objects out; the input list is not changed).
 *   • a SKU not on the list is added, with its unit, packing and price;
 *   • a row already there by code but not yet tied to the SKU master gets its
 *     skuId (it now auto-fills on Sales Orders) — reported as `linked`;
 *   • a SKU already on the list is left as it is — reported as `already`.
 */
export const addToOrderedSkus = (list = [], skus = []) => {
  const next = list.map((entry) => ({ ...entry }));
  const added = [];
  const linked = [];
  const already = [];
  skus.forEach((sku) => {
    const existing = next.find((entry) => sameSku(entry, sku));
    if (existing) {
      if (!existing.skuId) {
        existing.skuId = sku._id;
        linked.push(sku.name);
      } else {
        already.push(sku.name);
      }
      return;
    }
    next.push({
      skuId: sku._id,
      skuName: sku.name,
      skuCode: String(sku.code || '').toUpperCase(),
      unit: sku.unit || 'Pcs',
      pcsPerBox: Number(sku.pcsPerBox) || 0,
      weightPerBox: Number(sku.weightPerBox) || 0,
      sellingPrice: Number(sku.sellingPrice) || 0,
      priceHistory: [],
      lastOrderedAt: null,
    });
    added.push(sku.name);
  });
  return { list: next, added, linked, already };
};

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
    if (!party.isDeleted) {
      await recycleBinService.record('party', {
        recordId: party._id,
        title: party.name,
        subtitle: [party.code, party.location].filter(Boolean).join(' · '),
        keywords: [party.gstNo, party.contactPerson, party.email, party.state],
        actor: userId,
        plan: { steps: [binPlan.unhide(Party.modelName, party._id, {}, { timeline: true })] },
      });
    }
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
   * Party → Ordered SKUs → Add: SKUs picked from the SKU master join this
   * party's list (they then auto-fill on its Sales Orders). Only this list is
   * written; past orders are untouched.
   * @returns {{ party: object, added: string[], linked: string[], already: string[] }}
   */
  async addOrderedSkus(id, skuIds, userId) {
    const party = await Party.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!party) throw new AppError('Party not found', 404);
    const skus = await Sku.find({ _id: { $in: skuIds }, isDeleted: { $ne: true } })
      .select('name code unit pcsPerBox weightPerBox sellingPrice').lean();
    if (!skus.length) throw new AppError('Those SKUs are no longer in the SKU master', 404);

    const current = (party.orderedSkus || []).map((entry) => entry.toObject());
    const { list, added, linked, already } = addToOrderedSkus(current, skus);
    if (added.length || linked.length) {
      party.orderedSkus = list;
      party.markModified('orderedSkus');
      party.updatedBy = userId;
      party.activityTimeline.push({
        action: 'UPDATE',
        description: `Ordered SKUs added: ${[...added, ...linked].join(', ')}`.slice(0, 500),
        actorId: userId,
      });
      await party.save();
    }
    return { party: party.toObject(), added, linked, already };
  },

  /**
   * Party → Ordered SKUs → Remove one item. It stops auto-filling on new Sales
   * Orders; past orders are untouched. (A later order with this SKU adds it
   * back — see syncOrderedSkus.)
   */
  async removeOrderedSku(id, itemId, userId) {
    const party = await Party.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!party) throw new AppError('Party not found', 404);
    const item = party.orderedSkus.id(itemId);
    if (!item) throw new AppError('That SKU is no longer on this party', 404);
    const name = item.skuName || item.skuCode || 'SKU';
    const index = party.orderedSkus.findIndex((e) => String(e._id) === String(itemId));
    const saved = item.toObject();
    party.orderedSkus.pull({ _id: itemId });
    party.updatedBy = userId;
    party.activityTimeline.push({
      action: 'UPDATE',
      description: `Ordered SKU removed: ${name}`.slice(0, 500),
      actorId: userId,
    });
    await party.save();
    await recycleBinService.record('partySku', {
      recordId: saved._id,
      title: name,
      subtitle: [saved.skuCode, party.name].filter(Boolean).join(' · '),
      keywords: [party.code],
      openPath: `/parties/${party._id}`,
      actor: userId,
      plan: { steps: [binPlan.repush(Party.modelName, party._id, 'orderedSkus', saved, index)] },
    });
    return { party: party.toObject(), removed: name };
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
