/**
 * Fixture + oracle for the direct PO preview actions (Bulk Release PO row
 * "Preview PDF" icon, Purchase Orders table "View Purchase Order" icon).
 *
 *   node src/scripts/e2ePoPreviewFixture.js --seed     clone + seed (needs ambika_e2e_purchase seeded first)
 *   (backend) PORT=5099 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_po_preview node src/scripts/e2eServer.js
 *   (browser) node e2e/poDirectPreview.e2e.mjs           from frontend/
 *   node src/scripts/e2ePoPreviewFixture.js --verify   DB state after the browser spec
 *
 * --seed drops ambika_e2e_po_preview, copies every collection of
 * ambika_e2e_purchase into it (so that DB is never written), then adds:
 *   PVA, PVB, PVC, PVD  approved + not released (Bulk Release eligible), each
 *                       with a distinct quantity so their PDFs differ;
 *                       PVB carries a STALE stored poPdfUrl (another PO's file)
 *   PVCAN               cancelled, revised as PVREV
 *   PVREV               revision 1 of PVCAN, approved + not released
 * and gives the shared vendor a To email so Email Status reads Ready.
 * Writes frontend/e2e/shots/po-preview-manifest.json with the ids.
 *
 * --verify (after the spec, which previews PVA/PVB/PVC/PVREV and releases PVD):
 *   previewed POs are still approved + NOT_RELEASED, no email flag, no
 *   RELEASE/EMAIL timeline entries; PVB's stored PDF was replaced by a fresh
 *   one; PVD was released by the bulk release.
 *
 * SAFETY: pinned to localhost scratch databases behind the shared e2e guard
 * (S3 + email must be off). Never reads MONGO_URI. Stop the e2e backend before
 * --seed (it drops the DB).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

const SRC_DB = 'ambika_e2e_purchase';
const DST_DB = 'ambika_e2e_po_preview';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DST_DB}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2ePoPreviewFixture.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.resolve(HERE, '../../../frontend/e2e/shots/po-preview-manifest.json');
const VENDOR_EMAIL = 'pv-vendor@test.local';
const TAGS = ['PVA', 'PVB', 'PVC', 'PVD', 'PVCAN', 'PVREV'];
const poNo = (tag) => `AGL/PO-${tag}/26-27`;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${detail}` : ''}`);
};

const seed = async () => {
  const conn = await mongoose.createConnection(`mongodb://127.0.0.1:27017/${SRC_DB}`).asPromise();
  const src = conn.db;
  const template = await src.collection('vendorpurchaseorders')
    .findOne({ releaseStatus: 'RELEASED', poPdfUrl: { $nin: ['', null] }, isDeleted: { $ne: true } });
  if (!template) throw new Error(`${SRC_DB} has no released PO with a stored PDF — run e2ePurchaseFixture.js --seed and purchase.e2e.mjs first`);

  const dst = conn.useDb(DST_DB);
  await dst.db.dropDatabase();
  const colls = (await src.listCollections().toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
  for (const name of colls) {
    await src.collection(name).aggregate([{ $match: {} }, { $out: { db: DST_DB, coll: name } }]).toArray();
    for (const { key, v, ns, name: idxName, ...opts } of await src.collection(name).indexes()) {
      if (idxName === '_id_') continue;
      await dst.db.collection(name).createIndex(key, { name: idxName, ...opts });
    }
  }

  const now = new Date();
  const copy = (tag, qty, extra = {}) => {
    const { _id, items, ...rest } = template;
    const line = {
      ...items[0], _id: new mongoose.Types.ObjectId(), quantity: qty, pendingQty: qty, receivedQty: 0,
      taxableAmount: qty * items[0].rate, taxAmount: qty * items[0].rate * (items[0].gstRate / 100),
    };
    line.totalAmount = line.taxableAmount + line.taxAmount;
    return {
      ...rest, _id: new mongoose.Types.ObjectId(), poNumber: poNo(tag), draftNumber: `DRAFT-${tag}/26-27`,
      vendorName: `PV Vendor ${tag}`, items: [line],
      totalTaxableValue: line.taxableAmount, totalGSTAmount: line.taxAmount, grandTotal: line.totalAmount,
      approvalStatus: 'APPROVED', poStatus: 'APPROVED', releaseStatus: 'NOT_RELEASED',
      releasedBy: '', releasedById: null, releasedAt: null, supplierEmailSent: false, supplierEmailSentAt: null,
      followUpStatus: 'PENDING', readyForGrnAt: null, poPdfUrl: '', poPdfFileName: '',
      activityTimeline: [], poDate: now, createdAt: now, updatedAt: now, ...extra,
    };
  };
  const docs = {
    PVA: copy('PVA', 111),
    PVB: copy('PVB', 222, { poPdfUrl: template.poPdfUrl, poPdfFileName: template.poPdfFileName }),
    PVC: copy('PVC', 333),
    PVD: copy('PVD', 444),
    PVCAN: copy('PVCAN', 555, { poStatus: 'CANCELLED', releaseStatus: 'RELEASED', releasedAt: now }),
  };
  docs.PVREV = copy('PVREV', 50, { revisedFromPoId: docs.PVCAN._id, revisedFromPoNumber: poNo('PVCAN'), revisionNo: 1 });
  await dst.db.collection('vendorpurchaseorders').insertMany(Object.values(docs));
  const v = await dst.db.collection('vendors').updateOne({ _id: template.vendorId }, { $set: { toEmails: [VENDOR_EMAIL] } });

  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify({
    db: DST_DB,
    stalePdfUrl: template.poPdfUrl,
    pos: Object.fromEntries(TAGS.map((t) => [t, { id: String(docs[t]._id), poNumber: poNo(t), quantity: docs[t].items[0].quantity }])),
  }, null, 2));
  console.log(`seeded ${DST_DB}: ${colls.length} collections copied from ${SRC_DB}, ${TAGS.length} test POs, vendor email ${v.matchedCount ? 'set' : 'NOT set (vendor missing)'}`);
  console.log(`manifest → ${MANIFEST}`);
  await conn.close();
};

const verify = async () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const conn = await mongoose.createConnection(E2E_URI).asPromise();
  const col = conn.db.collection('vendorpurchaseorders');
  const get = (tag) => col.findOne({ poNumber: poNo(tag) });

  for (const tag of ['PVA', 'PVB', 'PVC', 'PVREV']) {
    const po = await get(tag);
    const actions = (po.activityTimeline || []).map((a) => a.action);
    check(`${tag}: still approved + NOT_RELEASED after preview`, po.approvalStatus === 'APPROVED' && po.poStatus === 'APPROVED' && po.releaseStatus === 'NOT_RELEASED',
      `${po.approvalStatus}/${po.poStatus}/${po.releaseStatus}`);
    check(`${tag}: no email sent, no release/email timeline entry`, !po.supplierEmailSent && !actions.some((a) => /RELEASE|EMAIL/.test(a)), actions.join(','));
    check(`${tag}: preview stored this PO's own PDF file`, String(po.poPdfFileName || '') === `AGL_PO-${tag}_26-27.pdf`, po.poPdfFileName);
  }
  const pvb = await get('PVB');
  check('PVB: stale stored PDF replaced by a fresh one', pvb.poPdfUrl && pvb.poPdfUrl !== manifest.stalePdfUrl, pvb.poPdfUrl);
  const pvd = await get('PVD');
  check('PVD: released by Bulk Release', pvd.releaseStatus === 'RELEASED' && pvd.poStatus === 'RELEASED_TO_VENDOR', `${pvd.poStatus}/${pvd.releaseStatus}`);
  const pvcan = await get('PVCAN');
  check('PVCAN: still cancelled', pvcan.poStatus === 'CANCELLED', pvcan.poStatus);

  await conn.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exitCode = failures ? 1 : 0;
};

if (isEntry(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === '--seed') await seed();
  else if (arg === '--verify') await verify();
  else { console.error('usage: --seed | --verify'); process.exitCode = 1; }
}
