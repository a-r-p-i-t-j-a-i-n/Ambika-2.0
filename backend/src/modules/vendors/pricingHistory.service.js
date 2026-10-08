import PricingHistory, { PRICING_SOURCE } from './pricingHistory.model.js';
import Vendor from './vendor.model.js';
import { logger } from '../../utils/logger.js';

const num = (n) => Number(n) || 0;
const upper = (s) => String(s || '').trim().toUpperCase();
const norm = (s) => String(s || '').trim().toLowerCase();

// Locate the matching vendor-catalog product for a change spec: skuCode → skuId → name.
const findProduct = (vendor, { skuId, skuCode, itemName }) => {
  const products = vendor.products || [];
  if (skuCode) {
    const want = upper(skuCode);
    const bySku = products.find((p) => upper(p.skuCode) === want);
    if (bySku) return bySku;
  }
  if (skuId) {
    const byId = products.find((p) => p.skuId && String(p.skuId) === String(skuId));
    if (byId) return byId;
  }
  if (itemName) {
    const n = norm(itemName);
    return products.find((p) => norm(p.productName) === n) || null;
  }
  return null;
};

// Build a PricingHistory entry object (not yet persisted).
const buildEntry = (vendor, product, change, ctx) => ({
  vendorId: vendor._id,
  vendorName: vendor.name || '',
  skuId: product?.skuId || change.skuId || null,
  skuCode: upper(product?.skuCode || change.skuCode),
  itemName: product?.productName || change.itemName || '',
  oldRate: num(change.oldRate),
  newRate: num(change.newRate),
  oldGstRate: num(change.oldGstRate),
  newGstRate: num(change.newGstRate),
  hsn: change.hsn || product?.hsn || '',
  unit: change.unit || product?.unit || '',
  effectiveDate: ctx.effectiveDate || new Date(),
  source: ctx.source,
  referenceType: ctx.source,
  referenceId: ctx.referenceId || vendor._id,
  referenceNumber: ctx.referenceNumber || '',
  updatedBy: ctx.userId || null,
  updatedByName: ctx.userName || '',
  remarks: ctx.remarks || '',
});

export const pricingHistoryService = {
  /** Append a single pricing-history record. */
  async createHistory(data) {
    return PricingHistory.create(data);
  },

  /** List a vendor's pricing history, newest first. */
  async getHistory(vendorId, query = {}) {
    const filter = { vendorId };
    if (query.skuCode) filter.skuCode = upper(query.skuCode);
    if (query.source) filter.source = query.source;
    const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 200));
    return PricingHistory.find(filter)
      .populate('updatedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  },

  /** Latest rate/GST for a SKU — Vendor Master current value, else last history. */
  async getLatestRate(vendorId, { skuId, skuCode } = {}) {
    const vendor = await Vendor.findOne({ _id: vendorId, isDeleted: { $ne: true } }).lean();
    if (vendor) {
      const product = findProduct(vendor, { skuId, skuCode });
      if (product) return { rate: num(product.rate), gstRate: num(product.gstRate), hsn: product.hsn || '', unit: product.unit || 'Pcs', source: 'VENDOR_MASTER' };
    }
    const last = await PricingHistory.findOne({ vendorId, ...(skuCode ? { skuCode: upper(skuCode) } : {}) }).sort({ createdAt: -1 }).lean();
    if (last) return { rate: num(last.newRate), gstRate: num(last.newGstRate), hsn: last.hsn || '', unit: last.unit || 'Pcs', source: last.source };
    return null;
  },

  /**
   * Compare a change against the vendor's current product, and when the rate or
   * GST actually differs: mutate the product in-memory (current rate/GST/HSN/unit
   * + lastUpdated stamps) and return the history entry to persist. Returns null
   * when nothing changed (so no duplicate history is written). The caller saves
   * the vendor doc and bulk-inserts the returned entries.
   *  - If the SKU isn't in the catalog yet, it's added so the Vendor Master always
   *    reflects the latest rate for future auto-fetch.
   */
  recordChange(vendor, change, ctx) {
    const hasRate = change.newRate != null && change.newRate !== '';
    const hasGst = change.newGstRate != null && change.newGstRate !== '';
    if (!hasRate && !hasGst) return null;

    let product = findProduct(vendor, change);
    const isNew = !product;
    const oldRate = isNew ? 0 : num(product.rate);
    const oldGstRate = isNew ? 0 : num(product.gstRate);
    const newRate = hasRate ? num(change.newRate) : oldRate;
    const newGstRate = hasGst ? num(change.newGstRate) : oldGstRate;

    const rateChanged = hasRate && newRate !== oldRate;
    const gstChanged = hasGst && newGstRate !== oldGstRate;
    if (!isNew && !rateChanged && !gstChanged) return null; // nothing changed → no history

    if (isNew) {
      // Add the SKU to the vendor catalog so later POs auto-fetch its rate.
      vendor.products.push({
        skuId: change.skuId || null,
        productName: change.itemName || '',
        skuCode: upper(change.skuCode),
        unit: change.unit || 'Pcs',
        rate: newRate,
        gstRate: newGstRate,
        hsn: change.hsn || '',
        lastUpdatedAt: new Date(),
        lastUpdatedBy: ctx.userId || null,
      });
      product = vendor.products[vendor.products.length - 1];
    } else {
      if (hasRate) product.rate = newRate;
      if (hasGst) product.gstRate = newGstRate;
      if (change.hsn) product.hsn = change.hsn;
      if (change.unit) product.unit = change.unit;
      product.lastUpdatedAt = new Date();
      product.lastUpdatedBy = ctx.userId || null;
    }

    return buildEntry(vendor, product, { ...change, oldRate, newRate, oldGstRate, newGstRate }, ctx);
  },

  /**
   * Sync pricing history from an APPROVED Purchase Order's lines. Only OTHER-format
   * lines whose rate the user actually changed on the PO (rateSource = MANUAL) are
   * written back — rates auto-filled from the Vendor Master or carried from an
   * approved quotation never are. JSL POs are skipped (their "rate" is a computed
   * final price, not the catalog base rate). Idempotent per PO (a PO's lines are
   * recorded once) and non-fatal — never blocks PO approval.
   */
  async recordPoLines(po, user) {
    try {
      if (!po?.vendorId || !po.items?.length) return;
      // Older history rows written while this PO was still a draft carry no PO
      // number — stamp the final one now that it exists.
      if (po.poNumber) {
        await PricingHistory.updateMany(
          { referenceId: po._id, source: PRICING_SOURCE.PURCHASE_ORDER, referenceNumber: { $in: ['', null] } },
          { $set: { referenceNumber: po.poNumber } },
        );
      }
      if (po.poFormatType === 'JSL') return; // discount pricing — not a catalog rate
      const manualLines = po.items.filter((l) => l.rateSource === 'MANUAL' && (l.skuCode || l.skuId));
      if (!manualLines.length) return;
      // A PO's rates are recorded once — guards against a repeated approval hook.
      if (await PricingHistory.exists({ referenceId: po._id, source: PRICING_SOURCE.PURCHASE_ORDER })) return;
      const vendor = await Vendor.findOne({ _id: po.vendorId, isDeleted: { $ne: true } });
      if (!vendor) return; // legacy Party vendor — no Vendor Master to sync
      const ctx = {
        source: PRICING_SOURCE.PURCHASE_ORDER,
        referenceId: po._id,
        referenceNumber: po.poNumber || po.draftNumber || '',
        userId: user?._id,
        userName: user?.name || '',
        remarks: 'Rate updated through PO creation',
        effectiveDate: po.poDate || new Date(),
      };
      const entries = [];
      for (const line of manualLines) {
        if (!line.skuCode && !line.skuId) continue;
        const entry = this.recordChange(vendor, {
          skuId: line.skuId, skuCode: line.skuCode, itemName: line.itemName,
          newRate: line.rate, newGstRate: line.gstRate, hsn: line.hsn, unit: line.unit,
        }, ctx);
        if (entry) entries.push(entry);
      }
      if (entries.length) {
        vendor.updatedBy = user?._id;
        await vendor.save();
        await PricingHistory.insertMany(entries);
      }
    } catch (err) {
      logger.error(`[pricing] PO rate sync failed for ${po?.poNumber}: ${err.message}`);
    }
  },

  /**
   * Apply a manual Vendor-Master rate change (the POST endpoint). Records history
   * + updates the master's latest rate. Returns the history entry, or null when
   * nothing changed.
   */
  async applyVendorMasterChange(vendor, change, user) {
    const ctx = {
      source: PRICING_SOURCE.VENDOR_MASTER,
      referenceId: vendor._id,
      referenceNumber: '',
      userId: user?._id,
      userName: user?.name || '',
      remarks: change.remarks || 'Rate updated through Vendor Master',
      effectiveDate: change.effectiveDate || new Date(),
    };
    const entry = this.recordChange(vendor, change, ctx);
    if (!entry) return null;
    vendor.updatedBy = user?._id;
    await vendor.save();
    return this.createHistory(entry);
  },
};
