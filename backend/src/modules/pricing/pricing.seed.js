/**
 * Pricing module — boot-time idempotent seed.
 *
 * For every SKU that has a `sellingPrice > 0` but NO PriceRevision row yet,
 * insert an initial LIVE revision so the audit history starts from a sane
 * baseline. Existing screens keep reading `SKU.sellingPrice` as before.
 *
 * Also ensures the CompanySettings singleton exists.
 */

import SKU from '../skus/sku.model.js';
import User from '../auth/auth.model.js';
import PriceRevision from './price-revision.model.js';
import CompanySettings from './company-settings.model.js';
import { logger } from '../../utils/logger.js';

export const seedPricing = async () => {
  try {
    await CompanySettings.getSingleton();

    // Find a "system" actor to attribute the initial revisions to.
    // Prefer an MD user; otherwise any active user; bail if no users exist.
    const systemUser =
      (await User.findOne({ roles: 'MD', isActive: { $ne: false } }).select('_id name').lean()) ||
      (await User.findOne({ role: 'MD' }).select('_id name').lean()) ||
      (await User.findOne({ isActive: { $ne: false } }).select('_id name').lean()) ||
      (await User.findOne({}).select('_id name').lean());

    if (!systemUser) {
      logger.info('[pricing] seed — skipped: no users yet to attribute initial revisions.');
      return;
    }

    const skus = await SKU.find({
      sellingPrice: { $gt: 0 },
    }).select('_id code name sellingPrice rmCost gstRate sellingPriceFrom rmCostFrom').lean();

    let created = 0;
    for (const sku of skus) {
      const existing = await PriceRevision.exists({
        skuId: sku._id, priceType: 'SELLING',
      });
      if (existing) continue;

      const now = new Date();
      await PriceRevision.create({
        skuId:           sku._id,
        skuCode:         sku.code,
        skuName:         sku.name,
        priceType:       'SELLING',
        oldPrice:        null,
        newPrice:        sku.sellingPrice,
        effectiveFrom:   sku.sellingPriceFrom || now,
        reason:          'Initial import (seed)',
        status:          'LIVE',
        changePercent:   0,
        requestedBy:     systemUser._id,
        requestedByName: systemUser.name || 'System',
        approvedBy:      systemUser._id,
        approvedByName:  systemUser.name || 'System',
        approvedAt:      now,
        createdBy:       systemUser._id,
      });
      created += 1;

      if (!sku.sellingPriceFrom) {
        await SKU.updateOne({ _id: sku._id }, { sellingPriceFrom: now });
      }
    }
    if (created > 0) {
      logger.info(`[pricing] seed — created ${created} initial price revisions.`);
    }
  } catch (err) {
    logger.error('[pricing] seed failed:', err);
  }
};

export default seedPricing;
