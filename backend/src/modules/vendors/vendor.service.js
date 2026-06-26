import Vendor from './vendor.model.js';
import PricingHistory, { PRICING_SOURCE } from './pricingHistory.model.js';
import { pricingHistoryService } from './pricingHistory.service.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';

const num = (n) => Number(n) || 0;
const upper = (s) => String(s || '').trim().toUpperCase();
const norm = (s) => String(s || '').trim().toLowerCase();

// Match an incoming product row to a previous one (by _id, then skuCode, then name).
const findPrev = (prev, incoming) => {
  if (incoming._id) {
    const byId = prev.find((p) => String(p._id) === String(incoming._id));
    if (byId) return byId;
  }
  if (incoming.skuCode) {
    const bySku = prev.find((p) => upper(p.skuCode) === upper(incoming.skuCode));
    if (bySku) return bySku;
  }
  if (incoming.productName) {
    return prev.find((p) => norm(p.productName) === norm(incoming.productName)) || null;
  }
  return null;
};

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

  async update(id, data, user) {
    const userId = user?._id;
    const vendor = await Vendor.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!vendor) throw new AppError('Vendor not found', 404);

    // Snapshot previous products so we can diff rate/GST changes for the audit.
    const prevProducts = (vendor.products || []).map((p) => (p.toObject ? p.toObject() : { ...p }));

    const { products, ...rest } = data;
    Object.assign(vendor, rest);

    const historyEntries = [];
    if (Array.isArray(products)) {
      vendor.products = products.map((incoming) => {
        const prev = findPrev(prevProducts, incoming);
        const oldRate = prev ? num(prev.rate) : null;
        const oldGstRate = prev ? num(prev.gstRate) : null;
        const newRate = num(incoming.rate);
        const newGstRate = num(incoming.gstRate);
        const rateChanged = oldRate != null && newRate !== oldRate;
        const gstChanged = oldGstRate != null && newGstRate !== oldGstRate;

        const stamped = {
          skuId: incoming.skuId || prev?.skuId || null,
          productName: incoming.productName || '',
          skuCode: upper(incoming.skuCode),
          unit: incoming.unit || 'Pcs',
          rate: newRate,
          gstRate: newGstRate,
          hsn: incoming.hsn || prev?.hsn || '',
          notes: incoming.notes || '',
          lastUpdatedAt: (rateChanged || gstChanged) ? new Date() : (prev?.lastUpdatedAt || null),
          lastUpdatedBy: (rateChanged || gstChanged) ? userId : (prev?.lastUpdatedBy || null),
        };

        if (rateChanged || gstChanged) {
          historyEntries.push({
            vendorId: vendor._id,
            vendorName: vendor.name || '',
            skuId: stamped.skuId,
            skuCode: stamped.skuCode,
            itemName: stamped.productName,
            oldRate: oldRate || 0,
            newRate,
            oldGstRate: oldGstRate || 0,
            newGstRate,
            hsn: stamped.hsn,
            unit: stamped.unit,
            effectiveDate: new Date(),
            source: PRICING_SOURCE.VENDOR_MASTER,
            referenceType: PRICING_SOURCE.VENDOR_MASTER,
            referenceId: vendor._id,
            referenceNumber: '',
            updatedBy: userId || null,
            updatedByName: user?.name || '',
            remarks: 'Rate updated through Vendor Master',
          });
        }
        return stamped;
      });
    }

    vendor.updatedBy = userId;
    await vendor.save();
    if (historyEntries.length) {
      try { await PricingHistory.insertMany(historyEntries); }
      catch { /* audit insert is non-fatal */ }
    }
    return vendor.toObject();
  },

  // ── Pricing history (per vendor) ──
  async getPricingHistory(vendorId, query) {
    const vendor = await Vendor.findOne({ _id: vendorId, isDeleted: { $ne: true } }).select('_id').lean();
    if (!vendor) throw new AppError('Vendor not found', 404);
    return pricingHistoryService.getHistory(vendorId, query);
  },

  async addPricingHistory(vendorId, data, user) {
    const vendor = await Vendor.findOne({ _id: vendorId, isDeleted: { $ne: true } });
    if (!vendor) throw new AppError('Vendor not found', 404);
    const entry = await pricingHistoryService.applyVendorMasterChange(vendor, {
      skuId: data.skuId, skuCode: data.skuCode, itemName: data.itemName,
      newRate: data.rate, newGstRate: data.gstRate, hsn: data.hsn, unit: data.unit,
      remarks: data.remarks, effectiveDate: data.effectiveDate,
    }, user);
    if (!entry) throw new AppError('No rate or GST change detected — nothing to record', 400);
    return entry;
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
