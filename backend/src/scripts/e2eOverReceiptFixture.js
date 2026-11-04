/**
 * Fixture + oracle for the per-line "Allow Over-Receipt" consent on a GRN.
 *
 *   node src/scripts/e2eOverReceiptFixture.js --seed     fresh scratch DB: POs ready for GRN
 *   node src/scripts/e2eOverReceiptFixture.js --api      HTTP checks against the e2e backend (API_URL,
 *                                                        default http://127.0.0.1:5099/api/v1)
 *   node src/scripts/e2eOverReceiptFixture.js --verify   DB checks after frontend/e2e/grnOverReceipt.e2e.mjs
 *
 * --api goes through the real routes (Joi + stripUnknown + service): below /
 * equal / above pending, increase-then-reduce, one line over among several,
 * draft reopen, edit, missing consent, a draft pushed over by another GRN,
 * duplicate concurrent completion, Correct, and Complete + Incoming QC with the
 * stock actually posted.
 *
 * SAFETY: pinned to a localhost scratch database (dropped on --seed) behind the
 * shared e2e guard (S3 + email must be off). It never reads MONGO_URI.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote from '../modules/procurement/grn/grn.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';

export const DB_NAME = 'ambika_e2e_over_receipt';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eOverReceiptFixture.js');
export const E2E_USER = { email: 'over-receipt-e2e@test.local', password: 'E2e@12345', name: 'Over Receipt Runner', role: 'MD' };
const API = (process.env.API_URL || 'http://127.0.0.1:5099/api/v1').replace(/\/+$/, '');

const SKUS = [
  { code: 'OR-A', name: 'OR Bolt M8', unit: 'PCS', itemType: 'CONSUMABLE' },
  { code: 'OR-B', name: 'OR Nut M8', unit: 'PCS', itemType: 'CONSUMABLE' },
  { code: 'OR-C', name: 'OR Washer M8', unit: 'PCS', itemType: 'CONSUMABLE' },
];
const VENDOR = 'OR Vendor Pvt Ltd';
const POS = {
  'PO-OR-1': [['OR-A', 100]],                           // below / equal / above, reduce
  'PO-OR-2': [['OR-A', 100], ['OR-B', 50], ['OR-C', 20]], // several lines, one over
  'PO-OR-3': [['OR-A', 100]],                           // draft pushed over by another GRN
  'PO-OR-4': [['OR-A', 100]],                           // duplicate / concurrent completion
  'PO-OR-5': [['OR-A', 100]],                           // complete + QC stock
  'PO-OR-6': [['OR-A', 100]],                           // Correct a completed GRN
  'PO-OR-UI': [['OR-A', 100], ['OR-B', 50], ['OR-C', 20]], // browser spec
};

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const finish = async () => {
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
};

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  await User.create({ ...E2E_USER, mobile: '9000000072', isActive: true, roles: ['MD'] });
  for (const s of SKUS) await SKU.create(s);
  const skus = Object.fromEntries((await SKU.find({}).lean()).map((s) => [s.code, s]));
  const vendorId = new mongoose.Types.ObjectId();
  for (const [poNumber, lines] of Object.entries(POS)) {
    await VendorPurchaseOrder.create({
      poNumber, vendorId, vendorName: VENDOR, indentId: new mongoose.Types.ObjectId(), poStatus: 'RELEASED_TO_VENDOR',
      followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_NOT_REQUIRED', readyForGrnAt: new Date(), finalMaterialDate: new Date(),
      items: lines.map(([code, qty]) => ({
        skuId: skus[code]._id, skuCode: code, itemName: skus[code].name, unit: skus[code].unit,
        quantity: qty, receivedQty: 0, pendingQty: qty, rate: 50, gstRate: 18,
      })),
    });
  }
  console.log(JSON.stringify({ ok: true, db: DB_NAME, login: E2E_USER.email }, null, 2));
  await mongoose.disconnect();
};

let token = '';
const http = async (method, url, body) => {
  const res = await fetch(`${API}${url}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const lineOf = (po, code, receivedQty, extra = {}) => {
  const p = po.items.find((i) => i.skuCode === code);
  return {
    poItemId: String(p._id), poId: String(po._id), poNumber: po.poNumber, itemName: p.itemName, skuCode: code,
    skuId: String(p.skuId), unit: p.unit, invoiceQty: receivedQty, receivedQty, rate: p.rate, ...extra,
  };
};
const flags = (grn) => Object.fromEntries((grn.items || []).map((l) => [l.skuCode, l.allowOverReceipt === true]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const grnCount = (poNumber) => GoodsReceiptNote.countDocuments({ poNumbers: poNumber, isDeleted: { $ne: true } });

const api = async () => {
  await connect();
  const login = await http('POST', '/auth/login', { email: E2E_USER.email, password: E2E_USER.password });
  token = login.data?.data?.token || '';
  check('login', login.status === 200 && token);
  const po = Object.fromEntries((await VendorPurchaseOrder.find({}).lean()).map((p) => [p.poNumber, p]));
  const create = (p, items, extra = {}) => http('POST', '/procurement/grns', { poIds: [String(p._id)], items, ...extra });
  const P1 = po['PO-OR-1'];

  console.log('\n── 1-3. Below / equal / above pending (pending 100) ──');
  const below = await create(P1, [lineOf(P1, 'OR-A', 80)]);
  check('received 80 → 201, no consent needed, flag false', below.status === 201 && !flags(below.data.data)['OR-A']
    && below.data.data.items[0].extraQty === 0, `${below.status} ${below.data?.message || ''}`);
  const equal = await create(P1, [lineOf(P1, 'OR-A', 100)]);
  check('received 100 (= pending) → 201, flag false', equal.status === 201 && !flags(equal.data.data)['OR-A']);
  const before = await grnCount('PO-OR-1');
  const noConsent = await create(P1, [lineOf(P1, 'OR-A', 120)]);
  check('received 120 WITHOUT consent → 409 naming Allow Over-Receipt and the excess',
    noConsent.status === 409 && /Allow Over-Receipt/.test(noConsent.data?.message || '') && /extra 20/.test(noConsent.data?.message || ''),
    `${noConsent.status} ${noConsent.data?.message}`);
  check('…and nothing was saved', (await grnCount('PO-OR-1')) === before);
  const over = await create(P1, [lineOf(P1, 'OR-A', 120, { allowOverReceipt: true })]);
  const gOver = over.data?.data;
  check('received 120 WITH consent → 201, flag stored, extraQty 20', over.status === 201 && flags(gOver)['OR-A'] === true
    && gOver.items[0].extraQty === 20 && gOver.items[0].pendingBeforeGrn === 100, `${over.status} ${over.data?.message || ''}`);
  const ghost = await create(P1, [lineOf(P1, 'OR-A', 90, { allowOverReceipt: true })]);
  check('consent sent on a line that is NOT over → stored false (never trusted)', ghost.status === 201 && !flags(ghost.data.data)['OR-A']);

  console.log('\n── 4. Increase above the limit, then reduce ──');
  const up = await http('PATCH', `/procurement/grns/${gOver._id}`, { items: [lineOf(P1, 'OR-A', 150, { allowOverReceipt: true })] });
  check('120 → 150 with consent → 200, extraQty 50', up.status === 200 && up.data.data.items[0].extraQty === 50 && flags(up.data.data)['OR-A']);
  const down = await http('PATCH', `/procurement/grns/${gOver._id}`, { items: [lineOf(P1, 'OR-A', 90, { allowOverReceipt: true })] });
  check('reduce to 90 (stale consent still sent) → 200, consent cleared', down.status === 200 && !flags(down.data.data)['OR-A'] && down.data.data.items[0].extraQty === 0);
  const again = await http('PATCH', `/procurement/grns/${gOver._id}`, { items: [lineOf(P1, 'OR-A', 130)] });
  check('raise again to 130 without fresh consent → 409', again.status === 409 && /Allow Over-Receipt/.test(again.data?.message || ''), `${again.status}`);
  const stored = await GoodsReceiptNote.findById(gOver._id).lean();
  check('…the saved draft is untouched by the refused edit (90, no consent)', stored.items[0].receivedQty === 90 && stored.items[0].allowOverReceipt === false);

  console.log('\n── 5. Several items, only one over (PO-OR-2: A 100, B 50, C 20) ──');
  const P2 = po['PO-OR-2'];
  const mixed = [lineOf(P2, 'OR-A', 130), lineOf(P2, 'OR-B', 50), lineOf(P2, 'OR-C', 5)];
  const m1 = await create(P2, mixed);
  check('A over without consent → 409 naming A only', m1.status === 409 && /OR Bolt/.test(m1.data?.message || '') && !/OR Nut|OR Washer/.test(m1.data?.message || ''), m1.data?.message);
  const m2 = await create(P2, [lineOf(P2, 'OR-A', 130, { allowOverReceipt: true }), lineOf(P2, 'OR-B', 50, { allowOverReceipt: true }), lineOf(P2, 'OR-C', 5, { allowOverReceipt: true })]);
  check('consent only on the over line is kept; B (=pending) and C (<pending) stored false',
    m2.status === 201 && same(flags(m2.data.data), { 'OR-A': true, 'OR-B': false, 'OR-C': false }), JSON.stringify(flags(m2.data?.data || {})));
  const m3 = await http('PATCH', `/procurement/grns/${m2.data.data._id}`, { items: [lineOf(P2, 'OR-A', 130, { allowOverReceipt: true }), lineOf(P2, 'OR-B', 60), lineOf(P2, 'OR-C', 5)] });
  check('now B also goes over (60 > 50) without consent → 409 naming B', m3.status === 409 && /OR Nut/.test(m3.data?.message || ''), m3.data?.message);

  console.log('\n── 6-7. Save draft, reopen, edit ──');
  const reopened = await http('GET', `/procurement/grns/${m2.data.data._id}`);
  check('reopened draft returns each line\'s consent', same(flags(reopened.data.data), { 'OR-A': true, 'OR-B': false, 'OR-C': false }));
  const hdr = await http('PATCH', `/procurement/grns/${m2.data.data._id}`, { receivedBy: 'Gate Clerk' });
  check('header-only edit keeps the consent', hdr.status === 200 && flags(hdr.data.data)['OR-A'] === true);
  const resend = await http('PATCH', `/procurement/grns/${m2.data.data._id}`, { items: reopened.data.data.items.map((l) => ({ ...l, _id: undefined })).map((l) => ({
    poItemId: l.poItemId, poNumber: l.poNumber, itemName: l.itemName, skuCode: l.skuCode, skuId: l.skuId, unit: l.unit,
    invoiceQty: l.invoiceQty, receivedQty: l.receivedQty, rate: l.rate, allowOverReceipt: l.allowOverReceipt,
  })) });
  check('edit re-sending the saved lines (as the form does) → 200, consent kept', resend.status === 200 && same(flags(resend.data.data), { 'OR-A': true, 'OR-B': false, 'OR-C': false }));
  const noRemarks = await http('POST', `/procurement/grns/${m2.data.data._id}/complete`, {});
  check('complete with consent but NO remarks → 400 (remarks rule kept)', noRemarks.status === 400 && /remarks/i.test(noRemarks.data?.message || ''), `${noRemarks.status} ${noRemarks.data?.message}`);

  console.log('\n── 8. Draft saved within pending, another GRN completes first (PO-OR-3) ──');
  const P3 = po['PO-OR-3'];
  const d1 = await create(P3, [lineOf(P3, 'OR-A', 70)]);
  const d2 = await create(P3, [lineOf(P3, 'OR-A', 70, { remarks: 'second delivery' })]);
  check('two drafts of 70 against pending 100 both save', d1.status === 201 && d2.status === 201);
  const c1 = await http('POST', `/procurement/grns/${d1.data.data._id}/complete`, {});
  check('first GRN completes (70)', c1.status === 200, c1.data?.message);
  const c2 = await http('POST', `/procurement/grns/${d2.data.data._id}/complete`, { remarks: 'extra' });
  check('second draft (now 70 vs pending 30) completes WITHOUT consent → 409', c2.status === 409 && /Allow Over-Receipt/.test(c2.data?.message || ''), `${c2.status} ${c2.data?.message}`);
  const d2doc = await GoodsReceiptNote.findById(d2.data.data._id).lean();
  check('…it stays an untouched draft', d2doc.grnStatus === 'DRAFT' && !d2doc.stockPosted);
  const d2e = await http('PATCH', `/procurement/grns/${d2.data.data._id}`, { items: [lineOf(P3, 'OR-A', 70, { remarks: 'second delivery' })] });
  check('re-saving the draft now needs consent (pending moved) → 409', d2e.status === 409);
  const d2ok = await http('PATCH', `/procurement/grns/${d2.data.data._id}`, { items: [lineOf(P3, 'OR-A', 70, { remarks: 'second delivery', allowOverReceipt: true })] });
  check('…and with consent saves, extraQty 40', d2ok.status === 200 && d2ok.data.data.items[0].extraQty === 40);
  const c2ok = await http('POST', `/procurement/grns/${d2.data.data._id}/complete`, {});
  const poAfter3 = await VendorPurchaseOrder.findOne({ poNumber: 'PO-OR-3' }).lean();
  check('completes with the line consent alone → 200; PO received 140', c2ok.status === 200 && poAfter3.items[0].receivedQty === 140, `${c2ok.status} ${c2ok.data?.message} recv ${poAfter3.items[0].receivedQty}`);
  const legacy = await create(po['PO-OR-5'], [lineOf(po['PO-OR-5'], 'OR-A', 40)]);
  check('(sanity) a normal 40/100 draft saves for the legacy-consent check below', legacy.status === 201);

  console.log('\n── 9. Duplicate / concurrent completion (PO-OR-4) ──');
  const P4 = po['PO-OR-4'];
  const dup = await create(P4, [lineOf(P4, 'OR-A', 120, { allowOverReceipt: true, remarks: 'extra truck' })]);
  const race = await Promise.all([1, 2, 3].map(() => http('POST', `/procurement/grns/${dup.data.data._id}/complete`, {})));
  const okCount = race.filter((r) => r.status === 200).length;
  const poAfter4 = await VendorPurchaseOrder.findOne({ poNumber: 'PO-OR-4' }).lean();
  check('3 simultaneous completes → exactly one 200', okCount === 1, race.map((r) => r.status).join(','));
  check('PO received counted once (120), not 240/360', poAfter4.items[0].receivedQty === 120, String(poAfter4.items[0].receivedQty));
  const dupDoc = await GoodsReceiptNote.findById(dup.data.data._id).lean();
  check('GRN completed once, consent kept on the line', dupDoc.stockPosted === true && flags(dupDoc)['OR-A'] === true);

  console.log('\n── 10. Complete GRN + Incoming QC → stock (PO-OR-5) ──');
  const P5 = po['PO-OR-5'];
  const g5 = await create(P5, [lineOf(P5, 'OR-A', 120, { allowOverReceipt: true, remarks: 'vendor sent 20 extra, accepted' })]);
  check('draft 120 vs pending 100 with consent saves', g5.status === 201, g5.data?.message);
  const fin = await http('POST', `/procurement/grns/${g5.data.data._id}/complete`, {});
  check('complete → 200', fin.status === 200, fin.data?.message);
  const g5doc = await GoodsReceiptNote.findById(g5.data.data._id).lean();
  check('no stock at GRN completion (QC-gated)', (await InventoryMovement.countDocuments({ refType: 'GRN', refId: g5doc._id })) === 0);
  const user = await User.findOne({ email: E2E_USER.email }).lean();
  const { incomingQcService } = await import('../modules/procurement/incoming-qc/incomingQc.service.js');
  await GoodsReceiptNote.updateOne({ _id: g5doc._id }, { $set: { approvalStatus: 'MD_APPROVED' } }); // MD signature stand-in
  const qc = await incomingQcService.create({ grnId: String(g5doc._id) }, user);
  await incomingQcService.complete(String(qc._id), {}, user);
  const posted = await GoodsReceiptNote.findById(g5doc._id).lean();
  const moves = await InventoryMovement.find({ refType: 'GRN', refId: g5doc._id, txnType: 'GRN_IN' }).lean();
  const stocked = moves.reduce((t, m) => t + m.quantity, 0);
  check('QC posts the full 120 received (100 ordered + 20 extra)', stocked === 120, `posted ${stocked}`);
  check('line POSTED, consent kept; PO received 120', posted.items[0].stockStatus === 'POSTED' && posted.items[0].allowOverReceipt === true
    && (await VendorPurchaseOrder.findOne({ poNumber: 'PO-OR-5' }).lean()).items[0].receivedQty === 120);

  console.log('\n── 11. Correct a completed GRN (PO-OR-6) ──');
  const P6 = po['PO-OR-6'];
  const g6 = await create(P6, [lineOf(P6, 'OR-A', 100)]);
  await http('POST', `/procurement/grns/${g6.data.data._id}/complete`, {});
  const g6doc = await GoodsReceiptNote.findById(g6.data.data._id).lean();
  const corrLine = (extra) => ({ _id: String(g6doc.items[0]._id), poItemId: String(g6doc.items[0].poItemId), itemName: g6doc.items[0].itemName, skuCode: 'OR-A', skuId: String(g6doc.items[0].skuId), unit: 'PCS', invoiceQty: 130, receivedQty: 130, rate: 50, remarks: 'extra', ...extra });
  const cNo = await http('PATCH', `/procurement/grns/${g6doc._id}/correct`, { reason: 'qty fix', items: [corrLine()] });
  check('correcting to 130 without consent → 409', cNo.status === 409 && /Allow Over-Receipt/.test(cNo.data?.message || ''), `${cNo.status} ${cNo.data?.message}`);
  const cYes = await http('PATCH', `/procurement/grns/${g6doc._id}/correct`, { reason: 'qty fix', items: [corrLine({ allowOverReceipt: true })] });
  const g6after = await GoodsReceiptNote.findById(g6doc._id).lean();
  check('with line consent → 200; consent + received 130 stored', cYes.status === 200 && g6after.items[0].allowOverReceipt === true && g6after.items[0].receivedQty === 130, `${cYes.status} ${cYes.data?.message}`);

  console.log('\n── 12. Without-PO GRN has no pending to exceed ──');
  const wo = await http('POST', '/procurement/grns', { isWithoutPo: true, vendorId: String(new mongoose.Types.ObjectId()), vendorName: VENDOR, items: [{ itemName: 'OR Bolt M8', skuCode: 'OR-A', receivedQty: 500, allowOverReceipt: true, rate: 10 }] });
  check('W/O PO line saves; consent never stored (no pending)', wo.status === 201 && !flags(wo.data.data)['OR-A'] && wo.data.data.items[0].extraQty === 0, `${wo.status} ${wo.data?.message}`);
  await finish();
};

// ── After the browser spec ────────────────────────────────────────────────────
const verify = async () => {
  await connect();
  const g = await GoodsReceiptNote.findOne({ poNumbers: 'PO-OR-UI', isDeleted: { $ne: true } }).lean();
  check('browser GRN over PO-OR-UI exists', !!g);
  if (g) {
    const by = Object.fromEntries(g.items.map((l) => [l.skuCode, l]));
    check('…OR-A over pending with consent stored (150 vs 100)', by['OR-A']?.receivedQty === 150 && by['OR-A']?.allowOverReceipt === true && by['OR-A']?.extraQty === 50);
    check('…OR-B / OR-C within pending: no consent stored', !by['OR-B']?.allowOverReceipt && !by['OR-C']?.allowOverReceipt);
    check('…finalized in the browser', ['FULLY_RECEIVED', 'PARTIAL_RECEIVED'].includes(g.grnStatus) && g.stockPosted === true, g.grnStatus);
    const poDoc = await VendorPurchaseOrder.findOne({ poNumber: 'PO-OR-UI' }).lean();
    check('…PO received reflects the 150 on OR-A', poDoc.items.find((i) => i.skuCode === 'OR-A').receivedQty === 150);
  }
  await finish();
};

if (isEntry(import.meta.url)) {
  const run = { '--seed': seed, '--api': api, '--verify': verify }[process.argv[2]];
  if (!run) { console.error('Usage: e2eOverReceiptFixture.js --seed | --api | --verify'); process.exit(2); }
  run().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => {}); process.exit(1); });
}
