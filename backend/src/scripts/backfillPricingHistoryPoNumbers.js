/**
 * backfillPricingHistoryPoNumbers.js — one-time data fix
 * ════════════════════════════════════════════════════════════════════
 * Pricing History rows written from a Purchase Order used to be recorded when
 * the PO was saved as a DRAFT — before its final PO number existed — so their
 * `referenceNumber` is blank. This stamps the final PO number on those rows.
 * (New rows are written at PO approval and always carry the PO number.)
 *
 * SAFETY
 *   • Dry-run by default — prints the plan and writes NOTHING.
 *   • Pass `--commit` to apply.
 *   • Idempotent — only rows with a blank referenceNumber whose PO now has a
 *     poNumber are touched; re-running is a no-op.
 *   • Touches only `referenceNumber`. Rows of POs that were never approved
 *     (no poNumber) are listed and left as they are.
 *
 * USAGE
 *   node src/scripts/backfillPricingHistoryPoNumbers.js            ← preview
 *   node src/scripts/backfillPricingHistoryPoNumbers.js --commit   ← apply
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import PricingHistory, { PRICING_SOURCE } from '../modules/vendors/pricingHistory.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import { logger } from '../utils/logger.js';

const COMMIT = process.argv.includes('--commit');

const run = async () => {
  await connectDB();

  const rows = await PricingHistory.find({
    source: PRICING_SOURCE.PURCHASE_ORDER,
    referenceId: { $ne: null },
    referenceNumber: { $in: ['', null] },
  }).select('_id referenceId').lean();

  const poIds = [...new Set(rows.map((r) => String(r.referenceId)))];
  const pos = await VendorPurchaseOrder.find({ _id: { $in: poIds } }).select('_id poNumber draftNumber').lean();
  const poById = new Map(pos.map((p) => [String(p._id), p]));

  let fixable = 0;
  const unresolved = [];
  for (const id of poIds) {
    const po = poById.get(id);
    const count = rows.filter((r) => String(r.referenceId) === id).length;
    if (po?.poNumber) {
      fixable += count;
      logger.info(`  ${po.draftNumber || id} → ${po.poNumber}  (${count} row(s))`);
      if (COMMIT) {
        await PricingHistory.updateMany(
          { source: PRICING_SOURCE.PURCHASE_ORDER, referenceId: po._id, referenceNumber: { $in: ['', null] } },
          { $set: { referenceNumber: po.poNumber } },
        );
      }
    } else {
      unresolved.push(`${po?.draftNumber || id} (${count} row(s))`);
    }
  }

  logger.info(`Blank-reference PO history rows: ${rows.length} · fixable: ${fixable} · PO not approved/missing: ${unresolved.length}`);
  if (unresolved.length) logger.info(`  Left unchanged: ${unresolved.join(', ')}`);
  logger.info(COMMIT ? 'Committed.' : 'Dry run — nothing written. Re-run with --commit to apply.');
  await mongoose.disconnect();
};

run().catch(async (err) => {
  logger.error(`backfillPricingHistoryPoNumbers failed: ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
