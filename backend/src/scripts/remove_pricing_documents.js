/**
 * Remove entries from the Pricing Documents screen.
 *
 * A "document" on that screen is NOT its own record — it is a PriceRevision that
 * happens to carry an attachment (see pricing.service.js → documents()). So the
 * card is removed by clearing the attachment off the revision, which leaves the
 * price change, its approval trail and any quote priced from it untouched.
 *
 * Pass --purge-revision to delete the whole PriceRevision instead. That also
 * removes the price change itself, so the SKU loses the price this revision set.
 *
 * Safety: dry run by default; --apply writes a timestamped JSON backup of the
 * full documents BEFORE changing anything.
 *
 * Usage:
 *   node src/scripts/remove_pricing_documents.js                 # dry run
 *   node src/scripts/remove_pricing_documents.js --apply         # detach files
 *   node src/scripts/remove_pricing_documents.js --apply --sku CK0600-204,DJ1500-204
 */

import fs from 'fs';
import path from 'path';
import dns from 'dns';
import mongoose from 'mongoose';
import env from '../config/env.js';
import PriceRevision from '../modules/pricing/price-revision.model.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PURGE = args.includes('--purge-revision');
const skuIdx = args.indexOf('--sku');
const SKUS = skuIdx !== -1 ? (args[skuIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : null;

// A mongodb+srv:// URI needs an SRV lookup first. On a machine whose resolver is
// a local stub this dies with querySrv ECONNREFUSED before the connection even
// starts, so fall back to public resolvers for that lookup only.
const ensureSrvResolvable = async () => {
  const host = `_mongodb._tcp.${env.MONGO_URI.split('@')[1]?.split('/')[0]?.split('?')[0]}`;
  try {
    await dns.promises.resolveSrv(host);
  } catch (e) {
    console.log(`SRV lookup via system DNS (${dns.getServers().join(', ')}) failed: ${e.code}`);
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    await dns.promises.resolveSrv(host);
    console.log('SRV resolved via public DNS (8.8.8.8) — continuing.\n');
  }
};

const run = async () => {
  await ensureSrvResolvable();
  await mongoose.connect(env.MONGO_URI);
  console.log(`db: ${mongoose.connection.name}   mode: ${APPLY ? (PURGE ? 'APPLY — DELETE REVISIONS' : 'APPLY — detach files') : 'DRY RUN'}\n`);

  // Exactly what the Documents screen lists: revisions carrying an attachment.
  const filter = {
    attachmentUrl: { $exists: true, $nin: [null, ''] },
    ...(SKUS ? { skuCode: { $in: SKUS } } : {}),
  };
  const docs = await PriceRevision.find(filter).sort({ createdAt: -1 }).lean();

  if (!docs.length) {
    console.log('Nothing matched — the Documents screen is already empty.');
    await mongoose.disconnect();
    return;
  }

  docs.forEach((r) => {
    console.log(`revision ${r._id}`);
    console.log(`  sku      : ${r.skuCode} — ${r.skuName}`);
    console.log(`  price    : ${r.oldPrice} → ${r.newPrice}  (${r.changePercent?.toFixed?.(1) ?? '—'}%)  ${r.status}`);
    console.log(`  file     : ${r.attachmentName || '(unnamed)'}`);
    console.log(`  raised by: ${r.requestedByName || '—'}${r.approvedByName ? `  approved by: ${r.approvedByName}` : ''}\n`);
  });
  console.log(`${docs.length} document card(s).\n`);

  if (!APPLY) {
    console.log('Dry run — nothing changed. Re-run with --apply.');
    await mongoose.disconnect();
    return;
  }

  const dir = path.resolve('backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `pricing-documents-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(docs, null, 2));
  console.log(`backup written: ${file}`);

  const ids = docs.map((d) => d._id);
  if (PURGE) {
    const res = await PriceRevision.deleteMany({ _id: { $in: ids } });
    console.log(`deleted ${res.deletedCount} price revision(s) — the price changes are gone too.`);
  } else {
    const res = await PriceRevision.updateMany(
      { _id: { $in: ids } },
      { $set: { attachmentUrl: '', attachmentName: '' } },
    );
    console.log(`detached the file from ${res.modifiedCount} revision(s) — prices and approvals untouched.`);
  }

  const left = await PriceRevision.countDocuments({ attachmentUrl: { $exists: true, $nin: [null, ''] } });
  console.log(`document cards remaining: ${left}${left === 0 ? '  ✓ screen is clear' : ''}`);

  await mongoose.disconnect();
};

run().catch((e) => { console.error(e); process.exit(1); });
