/**
 * fixBuySidePriceStream.js — one-off data fix
 * ════════════════════════════════════════════════════════════════════
 * Before the Revise dialog locked the price stream, a buy-side item
 * (raw material / consumable / packing) could be priced on the SELLING
 * stream by mistake. The Pricing Hub shows those items on the PURCHASE
 * (RM_COST) stream, so the price "disappeared".
 *
 * This script re-streams every SELLING price revision that belongs to a
 * buy-side SKU over to RM_COST, and fixes the SKU price cache.
 *
 * SAFETY
 *   • Dry-run by default — prints the plan, writes nothing.
 *   • Pass `--commit` to apply.
 *   • Idempotent — once fixed there is nothing left to move.
 *   • Only ever touches buy-side SKUs. Finished-goods prices are untouched.
 *
 * USAGE
 *   node src/scripts/fixBuySidePriceStream.js            ← preview
 *   node src/scripts/fixBuySidePriceStream.js --commit   ← apply
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import SKU from '../modules/skus/sku.model.js';
import PriceRevision from '../modules/pricing/price-revision.model.js';
import { logger } from '../utils/logger.js';

const COMMIT = process.argv.includes('--commit');
const BUY_SIDE = ['RAW_MATERIAL', 'CONSUMABLE', 'PACKING'];

const run = async () => {
  await connectDB();

  const buySideSkus = await SKU.find({ itemType: { $in: BUY_SIDE } })
    .select('_id code name itemType').lean();
  const skuIds = buySideSkus.map((s) => s._id);
  const skuById = new Map(buySideSkus.map((s) => [String(s._id), s]));

  // SELLING revisions that wrongly sit on a buy-side SKU.
  const wrong = await PriceRevision.find({
    skuId: { $in: skuIds },
    priceType: 'SELLING',
  }).lean();

  const affectedSkuIds = [...new Set(wrong.map((r) => String(r.skuId)))];

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  FIX BUY-SIDE PRICE STREAM  —  ' + (COMMIT ? 'COMMIT MODE' : 'DRY RUN (no writes)'));
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Buy-side SKUs ................. ${buySideSkus.length}`);
  console.log(`  Mis-streamed revisions found .. ${wrong.length}`);
  console.log(`  SKUs affected ................. ${affectedSkuIds.length}`);

  if (wrong.length) {
    console.log('\n  Revisions to move  SELLING → RM_COST (purchase price):');
    for (const r of wrong.slice(0, 40)) {
      const sku = skuById.get(String(r.skuId));
      console.log(`    ${(sku?.code || '?').padEnd(16)} ₹${r.newPrice}   ${sku?.name || ''}`);
    }
    if (wrong.length > 40) console.log(`    … and ${wrong.length - 40} more.`);
  }

  if (!wrong.length) {
    console.log('\n  Nothing to fix — every buy-side price is already on the purchase stream.\n');
    await mongoose.connection.close();
    process.exit(0);
  }

  if (!COMMIT) {
    console.log('\n  DRY RUN — nothing was written. Re-run with --commit to apply.\n');
    await mongoose.connection.close();
    process.exit(0);
  }

  // 1) Re-stream the revisions.
  const res = await PriceRevision.updateMany(
    { skuId: { $in: skuIds }, priceType: 'SELLING' },
    { $set: { priceType: 'RM_COST' } },
  );

  // 2) Repair each affected SKU's price cache: buy-side items have a purchase
  //    cost, never a selling price.
  let cacheFixed = 0;
  for (const id of affectedSkuIds) {
    const latest = await PriceRevision.findOne({
      skuId: id, priceType: 'RM_COST', status: 'LIVE',
      effectiveFrom: { $lte: new Date() },
    }).sort({ effectiveFrom: -1, createdAt: -1 }).lean();

    await SKU.updateOne({ _id: id }, {
      $set: {
        sellingPrice: 0,
        sellingPriceFrom: null,
        ...(latest ? { rmCost: latest.newPrice, rmCostFrom: latest.effectiveFrom } : {}),
      },
    });
    cacheFixed += 1;
  }

  console.log(`\n  ✅ COMMITTED — ${res.modifiedCount} revision(s) re-streamed, ${cacheFixed} SKU cache(s) fixed.\n`);
  logger.info(`fixBuySidePriceStream: ${res.modifiedCount} revisions moved to RM_COST.`);
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  logger.error(`fixBuySidePriceStream failed: ${err.message}`, { stack: err.stack });
  try { await mongoose.connection.close(); } catch { /* noop */ }
  process.exit(1);
});
