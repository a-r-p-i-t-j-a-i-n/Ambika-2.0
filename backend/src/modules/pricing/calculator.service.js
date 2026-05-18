/**
 * Calculator preview service — server is the single source of truth for
 * any total a user sees on screen or downloads as a quote.
 *
 *   POST /api/v1/pricing/calculator/preview
 *     body: {
 *       asOfDate?: ISO date string (defaults to today),
 *       priceType?: 'SELLING' | 'RM_COST' (defaults to SELLING),
 *       lines: [{ skuId, qty, manualPrice? }]
 *     }
 *
 *   returns: {
 *     asOfDate, lines: [...resolved...], totals: { subtotal, gstTotal, grandTotal },
 *     gstBreakdown: { '12': X, '18': Y, '28': Z }
 *   }
 */

import SKU from '../skus/sku.model.js';
import PriceRevision from './price-revision.model.js';
import CompanySettings from './company-settings.model.js';
import { AppError } from '../../utils/apiResponse.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const fetchPriceAsOf = async (skuId, priceType, asOfDate) => {
  return PriceRevision
    .findOne({
      skuId, priceType, status: 'LIVE',
      effectiveFrom: { $lte: asOfDate },
    })
    .sort({ effectiveFrom: -1, createdAt: -1 })
    .lean();
};

export const previewCalculator = async ({
  asOfDate, priceType = 'SELLING', lines = [],
}) => {
  if (!Array.isArray(lines) || lines.length === 0) {
    return {
      asOfDate, lines: [],
      totals: { subtotal: 0, gstTotal: 0, grandTotal: 0 },
      gstBreakdown: {},
    };
  }

  const settings = await CompanySettings.getSingleton();
  const date = asOfDate ? new Date(asOfDate) : new Date();

  const skuIds = [...new Set(lines.map((l) => l.skuId).filter(Boolean))];
  const skus = await SKU.find({ _id: { $in: skuIds } })
    .select('_id code name gstRate sellingPrice rmCost')
    .lean();
  const skuById = new Map(skus.map((s) => [String(s._id), s]));

  const resolvedLines = [];
  const gstBreakdown = {};
  let subtotal = 0;
  let gstTotal = 0;

  for (const ln of lines) {
    const qty = Number(ln.qty || 0);
    const sku = skuById.get(String(ln.skuId));
    if (!sku) {
      resolvedLines.push({
        skuId: ln.skuId,
        code: '?',
        name: 'Unknown SKU',
        qty,
        unitPrice: 0,
        gstRate: 0,
        source: 'NONE',
        lineSubtotal: 0,
        lineGst: 0,
        lineTotal: 0,
        error: 'SKU not found',
      });
      continue;
    }

    let unitPrice = null;
    let source = 'NONE';
    let effectiveFrom = null;
    let revisionId = null;

    if (ln.manualPrice != null && ln.manualPrice !== '') {
      unitPrice = round2(ln.manualPrice);
      source = 'MANUAL';
    } else {
      const rev = await fetchPriceAsOf(sku._id, priceType, date);
      if (rev) {
        unitPrice = rev.newPrice;
        source = 'MASTER';
        effectiveFrom = rev.effectiveFrom;
        revisionId = rev._id;
      } else {
        // Fall back to SKU cache only if it has a value (older data path).
        const cache = priceType === 'SELLING' ? sku.sellingPrice : sku.rmCost;
        if (cache > 0) {
          unitPrice = cache;
          source = 'MASTER';
        }
      }
    }

    const gstRate = sku.gstRate ?? settings.defaultGstRate ?? 18;
    const lineSubtotal = round2((unitPrice || 0) * qty);
    const lineGst      = round2(lineSubtotal * gstRate / 100);
    const lineTotal    = round2(lineSubtotal + lineGst);

    subtotal += lineSubtotal;
    gstTotal += lineGst;
    gstBreakdown[gstRate] = round2((gstBreakdown[gstRate] || 0) + lineGst);

    resolvedLines.push({
      skuId: sku._id,
      code: sku.code,
      name: sku.name,
      qty,
      unitPrice: unitPrice || 0,
      gstRate,
      source,
      effectiveFrom,
      revisionId,
      lineSubtotal,
      lineGst,
      lineTotal,
    });
  }

  subtotal = round2(subtotal);
  gstTotal = round2(gstTotal);
  const grandTotal = round2(subtotal + gstTotal);

  return {
    asOfDate: date,
    priceType,
    lines: resolvedLines,
    totals: { subtotal, gstTotal, grandTotal },
    gstBreakdown,
  };
};
