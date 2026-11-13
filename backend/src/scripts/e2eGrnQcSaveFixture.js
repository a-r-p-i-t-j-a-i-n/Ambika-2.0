/**
 * Fixture + oracle for the ONE Save of the combined GRN + Incoming QC form
 * (POST /procurement/grns[/:id]/save-with-qc — grn/grnQcSave.service.js).
 *
 *   node src/scripts/e2eGrnQcSaveFixture.js --seed     fresh scratch DB: POs ready for GRN
 *   node src/scripts/e2eGrnQcSaveFixture.js --api      HTTP checks against the e2e backend (API_URL,
 *                                                      default http://127.0.0.1:5099/api/v1)
 *   node src/scripts/e2eGrnQcSaveFixture.js --verify   DB checks after frontend/e2e/grnQcSave.e2e.mjs
 *
 * --api covers: GRN + QC created and saved together as a draft (no stock),
 * reopened, edited, completed in one call (stock exactly once, PO received
 * qty right, MD approval raised), a repeated / concurrent complete, received
 * below / equal / above pending, one line over among several, over without
 * consent refused (draft AND complete, server-side), increase-then-reduce
 * clears the consent, an unbalanced QC refused BEFORE the GRN is finalised,
 * a GRN completed the old way finished here, and a multi-PO GRN's two QCs.
 *
 * SAFETY: pinned to its OWN localhost scratch database (dropped on --seed) behind
 * the shared e2e guard (S3 + email must be off). It never reads MONGO_URI.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote from '../modules/procurement/grn/grn.model.js';
import IncomingQC from '../modules/procurement/incoming-qc/incomingQc.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';

export const DB_NAME = 'ambika_e2e_grn_qc_save';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eGrnQcSaveFixture.js');
export const E2E_USER = { email: 'grn-qc-save-e2e@test.local', password: 'E2e@12345', name: 'GRN QC Save Runner', role: 'MD' };
const API = (process.env.API_URL || 'http://127.0.0.1:5099/api/v1').replace(/\/+$/, '');

const SKUS = [
  { code: 'QS-A', name: 'QS Bolt M8', unit: 'PCS', itemType: 'CONSUMABLE' },
  { code: 'QS-B', name: 'QS Nut M8', unit: 'PCS', itemType: 'CONSUMABLE' },
  { code: 'QS-C', name: 'QS Washer M8', unit: 'PCS', itemType: 'CONSUMABLE' },
];
const VENDOR = 'QS Vendor Pvt Ltd';
const POS = {
  'PO-QS-1': [['QS-A', 100]],                            // together, draft, reopen, edit, complete, repeat
  'PO-QS-2': [['QS-A', 100], ['QS-B', 50], ['QS-C', 20]], // only one line over
  'PO-QS-3': [['QS-A', 100]],                            // below pending
  'PO-QS-4': [['QS-A', 100]],                            // equal to pending
  'PO-QS-5': [['QS-A', 100]],                            // increase over, then reduce
  'PO-QS-6': [['QS-A', 100]],                            // unbalanced QC refused before GRN completes
  'PO-QS-7': [['QS-A', 100]],                            // GRN completed the old way, QC here
  'PO-QS-8A': [['QS-A', 10]],                            // multi-PO GRN …
  'PO-QS-8B': [['QS-B', 5]],                             // … two QCs, one Save
  'PO-QS-UI': [['QS-A', 100], ['QS-B', 50]],             // browser: create + save + reopen + complete
  'PO-QS-UI2': [['QS-A', 40], ['QS-B', 30]],             // browser: over-receipt / responsive
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
  await User.create({ ...E2E_USER, mobile: '9000000081', isActive: true, roles: ['MD'] });
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
/** A QC entry for some PO lines: [[code, received, accepted, rejected]]. */
const qcOf = (po, splits, extra = {}) => ({
  checkedByName: 'QC Asha', preparedBy: 'Store Ravi', remarks: 'Probe QC', ...extra,
  items: splits.map(([code, received, accepted, rejected]) => {
    const p = po.items.find((i) => i.skuCode === code);
    return { lineKey: String(p._id), poItemId: String(p._id), itemName: p.itemName, receivedQty: received, acceptedQty: accepted, rejectedQty: rejected };
  }),
});
const save = (id, body) => http('POST', id ? `/procurement/grns/${id}/save-with-qc` : '/procurement/grns/save-with-qc', body);
const grnBody = (po, lines, extra = {}) => ({ poIds: [String(po._id)], grnDate: new Date().toISOString().slice(0, 10), items: lines, ...extra });
const stockOfGrn = async (grnId) => (await InventoryMovement.find({ refType: 'GRN', refId: grnId, txnType: 'GRN_IN' }).lean()).reduce((t, m) => t + m.quantity, 0);
const movesOfGrn = (grnId) => InventoryMovement.countDocuments({ refType: 'GRN', refId: grnId });
const poLine = async (poNumber, code) => (await VendorPurchaseOrder.findOne({ poNumber }).lean()).items.find((i) => i.skuCode === code);

const api = async () => {
  await connect();
  const login = await http('POST', '/auth/login', { email: E2E_USER.email, password: E2E_USER.password });
  token = login.data?.data?.token || '';
  check('login', login.status === 200 && token);
  const po = Object.fromEntries((await VendorPurchaseOrder.find({}).lean()).map((p) => [p.poNumber, p]));

  console.log('\n── 1. GRN + QC created together, saved once as a draft (PO-QS-1) ──');
  const P1 = po['PO-QS-1'];
  const d1 = await save(null, { complete: false, grn: grnBody(P1, [lineOf(P1, 'QS-A', 100)], { challanNumber: 'CH-1' }), qcs: [qcOf(P1, [['QS-A', 100, 95, 5]])] });
  const g1 = d1.data?.data?.grn;
  check('one Save → 201, GRN draft with its number', d1.status === 201 && g1?.grnStatus === 'DRAFT' && /GRN/.test(g1?.grnNumber || ''), `${d1.status} ${d1.data?.message}`);
  check('…QC kept on the draft GRN (no QC record yet)', g1?.qcDraft?.[0]?.items?.[0]?.rejectedQty === 5 && (await IncomingQC.countDocuments({ grnId: g1?._id })) === 0);
  check('…no stock, PO received still 0', (await movesOfGrn(g1._id)) === 0 && (await poLine('PO-QS-1', 'QS-A')).receivedQty === 0);
  const reopened = await http('GET', `/procurement/grns/${g1._id}`);
  check('2. reopened: GRN and QC both there', reopened.data?.data?.challanNumber === 'CH-1' && reopened.data?.data?.qcDraft?.[0]?.checkedByName === 'QC Asha');
  const line1 = reopened.data.data.items[0];
  const editBody = grnBody(P1, [{ ...lineOf(P1, 'QS-A', 100), _id: String(line1._id) }], { challanNumber: 'CH-1-EDIT' });
  delete editBody.poIds;
  const e1 = await save(g1._id, { complete: false, grn: editBody, qcs: [qcOf(P1, [['QS-A', 100, 90, 10]])] });
  check('3. edit the draft → 200; challan + QC split updated, still no stock', e1.status === 200 && e1.data.data.grn.challanNumber === 'CH-1-EDIT'
    && e1.data.data.grn.qcDraft[0].items[0].rejectedQty === 10 && (await movesOfGrn(g1._id)) === 0, `${e1.status} ${e1.data?.message}`);
  const c1 = await save(g1._id, { complete: true, grn: editBody, qcs: [qcOf(P1, [['QS-A', 100, 90, 10]])] });
  const qcs1 = c1.data?.data?.qcs || [];
  check('10. Save & Complete → 200: GRN completed + QC PARTIAL', c1.status === 200 && c1.data.data.grn.grnStatus === 'FULLY_RECEIVED' && qcs1.length === 1 && qcs1[0].qcStatus === 'PARTIAL', `${c1.status} ${c1.data?.message}`);
  check('11. stock posted = accepted 90 only', (await stockOfGrn(g1._id)) === 90, `posted ${await stockOfGrn(g1._id)}`);
  check('13. PO received 100 (received, not accepted), pending 0', (await poLine('PO-QS-1', 'QS-A')).receivedQty === 100);
  const g1doc = await GoodsReceiptNote.findById(g1._id).lean();
  check('…MD approval raised, QC draft cleared, QC remarks + people kept', g1doc.approvalStatus === 'READY_FOR_MD_APPROVAL' && g1doc.qcDraft === null
    && qcs1[0].checkedByName === 'QC Asha' && qcs1[0].remarks === 'Probe QC');
  const again = await Promise.all([1, 2].map(() => save(g1._id, { complete: true, qcs: [qcOf(P1, [['QS-A', 100, 90, 10]])] })));
  check('11. repeated / concurrent Save & Complete: stock still 90, one QC', (await stockOfGrn(g1._id)) === 90 && (await IncomingQC.countDocuments({ grnId: g1._id })) === 1,
    again.map((r) => r.status).join(','));
  check('…PO received still 100', (await poLine('PO-QS-1', 'QS-A')).receivedQty === 100);

  console.log('\n── 4/5. Below and equal to pending need no consent (PO-QS-3, PO-QS-4) ──');
  for (const [num, qty] of [['PO-QS-3', 80], ['PO-QS-4', 100]]) {
    const P = po[num];
    const r = await save(null, { complete: true, grn: grnBody(P, [lineOf(P, 'QS-A', qty)]), qcs: [qcOf(P, [['QS-A', qty, qty, 0]])] });
    const g = r.data?.data?.grn;
    check(`${num}: received ${qty} of 100 → completed in one Save, stock ${qty}`, r.status === 201 && ['PARTIAL_RECEIVED', 'FULLY_RECEIVED'].includes(g?.grnStatus)
      && (await stockOfGrn(g._id)) === qty && g.items[0].allowOverReceipt === false, `${r.status} ${r.data?.message}`);
  }

  console.log('\n── 6/7/9. One line over among three (PO-QS-2) ──');
  const P2 = po['PO-QS-2'];
  const lines2 = (consent) => [lineOf(P2, 'QS-A', 100), lineOf(P2, 'QS-B', 55, { remarks: 'vendor sent 5 extra', ...(consent ? { allowOverReceipt: true } : {}) }), lineOf(P2, 'QS-C', 20)];
  const qc2 = qcOf(P2, [['QS-A', 100, 100, 0], ['QS-B', 55, 55, 0], ['QS-C', 20, 20, 0]]);
  const before2 = await GoodsReceiptNote.countDocuments({ poNumbers: 'PO-QS-2' });
  const noConsentDraft = await save(null, { complete: false, grn: grnBody(P2, lines2(false)), qcs: [qc2] });
  check('9. over without consent: draft Save refused (409, names the item)', noConsentDraft.status === 409 && /QS Nut M8/.test(noConsentDraft.data?.message || ''), `${noConsentDraft.status} ${noConsentDraft.data?.message}`);
  const noConsentDone = await save(null, { complete: true, grn: grnBody(P2, lines2(false)), qcs: [qc2] });
  check('9. …and Save & Complete refused too; nothing saved', noConsentDone.status === 409 && (await GoodsReceiptNote.countDocuments({ poNumbers: 'PO-QS-2' })) === before2);
  const withConsent = await save(null, { complete: true, grn: grnBody(P2, lines2(true)), qcs: [qc2] });
  const g2 = withConsent.data?.data?.grn;
  const flags2 = Object.fromEntries((g2?.items || []).map((l) => [l.skuCode, l.allowOverReceipt === true]));
  check('7. with consent on that line only → completed; consent stored only on QS-B', withConsent.status === 201 && flags2['QS-B'] === true && !flags2['QS-A'] && !flags2['QS-C'], `${withConsent.status} ${withConsent.data?.message}`);
  check('13. PO lines received 100 / 55 / 20', (await poLine('PO-QS-2', 'QS-A')).receivedQty === 100 && (await poLine('PO-QS-2', 'QS-B')).receivedQty === 55 && (await poLine('PO-QS-2', 'QS-C')).receivedQty === 20);
  check('11. stock 175 (100 + 55 + 20)', (await stockOfGrn(g2._id)) === 175, `posted ${await stockOfGrn(g2._id)}`);

  console.log('\n── 8. Increase over pending, then reduce (PO-QS-5) ──');
  const P5 = po['PO-QS-5'];
  const up = await save(null, { complete: false, grn: grnBody(P5, [lineOf(P5, 'QS-A', 120, { allowOverReceipt: true, remarks: 'extra' })]), qcs: [qcOf(P5, [['QS-A', 120, 120, 0]])] });
  check('120 vs 100 with consent → draft saved, consent kept', up.status === 201 && up.data.data.grn.items[0].allowOverReceipt === true);
  const g5 = up.data.data.grn;
  const downBody = { items: [{ ...lineOf(P5, 'QS-A', 90, { allowOverReceipt: true }), _id: String(g5.items[0]._id) }] };
  const down = await save(g5._id, { complete: false, grn: downBody, qcs: [qcOf(P5, [['QS-A', 90, 90, 0]])] });
  check('reduced to 90 → consent cleared by the server even though the client sent it', down.status === 200 && down.data.data.grn.items[0].allowOverReceipt === false && down.data.data.grn.items[0].extraQty === 0, `${down.status} ${down.data?.message}`);

  console.log('\n── QC refused before anything is finalised (PO-QS-6) ──');
  const P6 = po['PO-QS-6'];
  const bad = await save(null, { complete: true, grn: grnBody(P6, [lineOf(P6, 'QS-A', 100)]), qcs: [qcOf(P6, [['QS-A', 100, 90, 5]])] });
  const g6 = await GoodsReceiptNote.findOne({ poNumbers: 'PO-QS-6' }).lean();
  check('unbalanced QC → 400 naming the line; GRN kept as a DRAFT', bad.status === 400 && /must equal received/.test(bad.data?.message || '') && g6?.grnStatus === 'DRAFT', `${bad.status} ${bad.data?.message}`);
  check('…no stock, PO untouched, QC split kept on the draft', (await movesOfGrn(g6._id)) === 0 && (await poLine('PO-QS-6', 'QS-A')).receivedQty === 0 && g6.qcDraft?.[0]?.items?.[0]?.rejectedQty === 5);
  const stale = await save(g6._id, { complete: true, qcs: [qcOf(P6, [['QS-A', 80, 80, 0]])] });
  check('a QC typed for a different received qty is refused, not carried over', stale.status === 400 && /received is now 100/.test(stale.data?.message || ''), `${stale.status} ${stale.data?.message}`);

  console.log('\n── A GRN completed the old way, its QC finished here (PO-QS-7) ──');
  const P7 = po['PO-QS-7'];
  const old = await http('POST', '/procurement/grns', grnBody(P7, [lineOf(P7, 'QS-A', 100)]));
  await http('POST', `/procurement/grns/${old.data.data._id}/complete`, {});
  const draftQc = await save(old.data.data._id, { complete: false, qcs: [qcOf(P7, [['QS-A', 100, 70, 30]])] });
  const qc7 = (draftQc.data?.data?.qcs || [])[0];
  check('draft Save on a completed GRN → its QC record saved as draft, no stock', draftQc.status === 200 && ['DRAFT', 'IN_PROGRESS'].includes(qc7?.qcStatus) && qc7?.totalRejected === 30 && (await stockOfGrn(old.data.data._id)) === 0, `${draftQc.status} ${draftQc.data?.message}`);
  const done7 = await save(old.data.data._id, { complete: true, qcs: [qcOf(P7, [['QS-A', 100, 70, 30]])] });
  check('Save & Complete → same QC completed, stock 70', done7.status === 200 && done7.data.data.qcs.length === 1 && String(done7.data.data.qcs[0]._id) === String(qc7._id)
    && (await stockOfGrn(old.data.data._id)) === 70, `${done7.status} ${done7.data?.message}`);
  const late = await save(old.data.data._id, { complete: false, grn: { challanNumber: 'LATE' }, qcs: [] });
  check('a completed GRN is not edited through this Save (its GRN body is ignored)', late.status === 200 && late.data.data.grn.challanNumber !== 'LATE');

  console.log('\n── Multi-PO GRN: two QCs, one Save (PO-QS-8A + 8B) ──');
  const A = po['PO-QS-8A']; const B = po['PO-QS-8B'];
  const multi = await save(null, {
    complete: true,
    grn: { poIds: [String(A._id), String(B._id)], items: [lineOf(A, 'QS-A', 10), lineOf(B, 'QS-B', 5)] },
    qcs: [{ ...qcOf(A, [['QS-A', 10, 10, 0]]), poId: String(A._id) }, { ...qcOf(B, [['QS-B', 5, 4, 1]]), poId: String(B._id) }],
  });
  const mq = multi.data?.data?.qcs || [];
  check('both QCs completed in one Save; stock 14', multi.status === 201 && mq.length === 2 && mq.every((q) => ['PASSED', 'PARTIAL'].includes(q.qcStatus))
    && (await stockOfGrn(multi.data.data.grn._id)) === 14, `${multi.status} ${multi.data?.message}`);

  console.log('\n── 12. Draft saves never post stock (whole DB) ──');
  const draftGrns = await GoodsReceiptNote.find({ grnStatus: 'DRAFT' }).select('_id').lean();
  check('no movement references any draft GRN', (await InventoryMovement.countDocuments({ refType: 'GRN', refId: { $in: draftGrns.map((g) => g._id) } })) === 0, `${draftGrns.length} drafts`);
  await finish();
};

/** After the browser spec: what its saves left behind. */
const verify = async () => {
  await connect();
  const ui = await GoodsReceiptNote.findOne({ poNumbers: 'PO-QS-UI', isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean();
  check('UI GRN completed', ui && ['FULLY_RECEIVED', 'PARTIAL_RECEIVED'].includes(ui.grnStatus), ui?.grnStatus);
  const qcs = await IncomingQC.find({ grnId: ui?._id, isDeleted: { $ne: true } }).lean();
  check('exactly one QC, completed, with the entered split (A 98/2)', qcs.length === 1 && ['PARTIAL', 'PASSED'].includes(qcs[0].qcStatus)
    && qcs[0].items.find((i) => i.skuCode === 'QS-A')?.rejectedQty === 2, JSON.stringify(qcs.map((q) => [q.qcStatus, q.items.map((i) => `${i.skuCode}:${i.acceptedQty}/${i.rejectedQty}`)])));
  const moves = await InventoryMovement.find({ refType: 'GRN', refId: ui?._id, txnType: 'GRN_IN' }).lean();
  check('stock posted once: 98 + 50 = 148', moves.reduce((t, m) => t + m.quantity, 0) === 148, `${moves.length} movements`);
  const p = await VendorPurchaseOrder.findOne({ poNumber: 'PO-QS-UI' }).lean();
  check('PO received 100 / 50', p.items.find((i) => i.skuCode === 'QS-A').receivedQty === 100 && p.items.find((i) => i.skuCode === 'QS-B').receivedQty === 50);
  const ui2 = await GoodsReceiptNote.findOne({ poNumbers: 'PO-QS-UI2', isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean();
  check('UI2 draft saved with B over + consent, no stock', ui2?.grnStatus === 'DRAFT' && ui2.items.find((i) => i.skuCode === 'QS-B')?.allowOverReceipt === true
    && (await InventoryMovement.countDocuments({ refType: 'GRN', refId: ui2?._id })) === 0, ui2 ? `${ui2.grnStatus} ${JSON.stringify(ui2.items.map((i) => [i.skuCode, i.receivedQty, i.allowOverReceipt]))}` : 'none');
  await finish();
};

if (isEntry(import.meta.url)) {
  const arg = process.argv[2];
  const run = arg === '--seed' ? seed : arg === '--api' ? api : arg === '--verify' ? verify : null;
  if (!run) { console.error('Usage: --seed | --api | --verify'); process.exit(2); }
  run().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => {}); process.exit(1); });
}
