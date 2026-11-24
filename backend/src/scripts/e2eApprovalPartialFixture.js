/**
 * API oracle for Step 1.3 item-wise approval — partial submission, holds, reopening,
 * completing later, the previous-vendors-only rule and duplicate-PO prevention
 * (indent/approvalProgress.js + indent.service.approveQuotation).
 *
 * Reuses the nrvendor scratch DB and its seed (vendors, SKUs, history POs):
 *   node src/scripts/e2eNrVendorHistoryFixture.js --seed
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5093 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_nrvendor node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5093/api/v1 node src/scripts/e2eApprovalPartialFixture.js --api
 *
 * Creates fresh indents / POs every run (re-runnable). The only direct DB write is
 * adding a product to a Vendor Master item list (the same thing the PO form does).
 *   V  vendor history  — vendor outside the item's history refused; item with no history
 *                        refused ("No eligible vendors found" — eligible = quoted OR previously supplied); inactive refused; explicit
 *                        YES row without a vendor still refused (back-compat)
 *   P  partial submit  — item 1 on hold, items 2+3 approved: step NOT complete, held item
 *                        has no vendor and is not PO-eligible, approved items are
 *   D  PO + duplicates — one PO for the approved items, indent never PO_READY while items
 *                        are owed; a second PO for the same / held items is refused
 *   R  reopen/complete — a stale client naming only the held item keeps the other
 *                        approvals; remarks/dates intact; PO'd items locked; completing
 *                        later finishes the step; the last PO makes the indent PO_READY;
 *                        exactly one active PO per vendor group (no duplicates)
 *   S  select + PO     — Step 1.3 vendor is OPTIONAL: ticked items approved with no vendor go to the PO,
 *                        whose vendor must be a previous vendor of EVERY item (create / edit / submit); no history →
 *                        "No eligible vendors found"; Select Vendor (Pending for PO) held to the same rule and then
 *                        fixes the PO vendor; one PO per vendor group, no duplicates; a cleared vendor is given up
 *   H  holds           — an approved (un-POed) item can be put back on hold (vendor
 *                        cleared, leaves PO picker); all-hold submit keeps the indent at
 *                        QUOTE_RECEIVED; legacy full approval unchanged
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard
 * (S3 + email off). Never reads MONGO_URI. Nothing here drops or resets a DB.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import Vendor from '../modules/vendors/vendor.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';

export const DB_NAME = 'ambika_e2e_nrvendor';
export const E2E_URI = process.env.E2E_NRVENDOR_URI || `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eApprovalPartialFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5093/api/v1').replace(/\/+$/, '');
const LOGIN = { email: 'nrvendor-e2e@test.local', password: 'E2e@12345' };
const RUN = Date.now().toString(36);
const doc = (name) => ({ fileName: `${name}.pdf`, fileUrl: `https://example.invalid/e2e/${name}.pdf`, fileType: 'application/pdf' });

let failures = 0;
let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${detail}` : ''}`);
};

let token = '';
const call = async (method, path, body, { auth = true } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data: json?.data, message: json?.message || '' };
};
const ok = async (method, path, body) => {
  const r = await call(method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${r.message}`);
  return r.data;
};

const SKU_CODES = { NOHIST: 'NV-NOHIST', HIST: 'NV-HIST', CODE: 'NV-CODE' };
const skuDoc = (key) => SKU.findOne({ code: SKU_CODES[key] }).lean();

// A fresh approved indent whose Step 1.2 answered Yes for every item (untagged files — Step 1.2 names no vendor).
const quotedIndent = async (keys) => {
  const items = [];
  for (const [i, k] of keys.entries()) {
    const s = await skuDoc(k);
    items.push({ skuId: String(s._id), skuCode: s.code, itemName: s.name, quantity: 10 + i, unit: 'Pcs' });
  }
  const ind = await ok('POST', '/procurement/indents', { department: 'Stores', remarks: `partial 1.3 e2e ${RUN}`, items });
  await ok('POST', `/procurement/indents/${ind._id}/submit`, {});
  const appr = await ok('POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
  await ok('POST', `/procurement/indents/${ind._id}/quote-comparative`, {
    statusDone: 'YES',
    itemQuotations: appr.items.map((it, i) => ({
      itemId: it._id, itemName: it.itemName, statusDone: 'YES', quotationDocuments: [doc(`pq-${RUN}-${keys[i]}-${i}`)],
    })),
  });
  return ok('GET', `/procurement/indents/${ind._id}`);
};
const fresh = (id) => ok('GET', `/procurement/indents/${id}`);

// One row of the Step 1.3 payload. kind: 'APPROVE' (vendor) | 'HOLD' | 'PENDING' | 'YES-NO-VENDOR'
const R = (indent, i, kind, vendorId, extra = {}) => {
  const it = indent.items[i];
  const files = (indent.quoteComparativeStep.itemQuotations.find((q) => String(q.itemId) === String(it._id))?.quotationDocuments || [])
    .map((d) => ({ fileName: d.fileName, fileUrl: d.fileUrl, fileType: d.fileType }));
  return {
    itemId: it._id, itemName: it.itemName,
    statusDone: { APPROVE: 'YES', 'YES-NO-VENDOR': 'YES', HOLD: 'ON_HOLD', PENDING: 'PENDING' }[kind],
    approvedQuotationDocuments: files,
    ...(kind === 'APPROVE' ? { vendorId } : {}),
    actualAt: extra.actualAt || '2026-11-20', remarks: extra.remarks ?? `r${i}-${kind}`,
  };
};
const approve = (indent, rows) => call('POST', `/procurement/indents/${indent._id}/approve-quotation`, { itemApprovedQuotations: rows });
const pickerRows = async (indent) => (await ok('GET', '/procurement/purchase-orders/approved-items')).items
  .filter((r) => String(r.indentId) === String(indent._id));
const poFromItems = (entries, vendorId, rate = 100) => call('POST', '/procurement/purchase-orders/create-from-items', {
  vendorId, expectedDeliveryDate: new Date(Date.now() + 7 * 864e5).toISOString(),
  items: entries.map(([indent, it]) => ({
    indentId: indent._id, indentItemId: it._id, itemName: it.itemName, quantity: it.approvedQuantity || it.quantity, unit: it.unit, rate, gstRate: 18,
  })),
});
const activePos = (indentId) => VendorPurchaseOrder.find({ indentId, isDeleted: { $ne: true }, poStatus: { $ne: 'CANCELLED' } }).lean();
const queueHas = async (indent, state) => {
  const r = await ok('GET', `/procurement/indents?fmsStep=QUOTATION_APPROVAL&stepState=${state}&limit=200`);
  const list = Array.isArray(r) ? r : (r?.items || r?.data || []);
  return list.some((x) => String(x._id) === String(indent._id));
};

const api = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
  const login = await call('POST', '/auth/login', LOGIN);
  token = login.data?.token || login.data?.accessToken || '';
  if (!token) throw new Error(`login failed: ${login.status} ${login.message} — run e2eNrVendorHistoryFixture.js --seed first`);
  const vend = async (code) => String((await Vendor.findOne({ code }).lean())._id);
  const A = await vend('NV-ALPHA'); const B = await vend('NV-BETA'); const G = await vend('NV-GAMMA'); const D = await vend('NV-DELTA'); const O = await vend('NV-OTHER');
  // Start clean: NV-NOHIST must have no history (an earlier run added it to Delta's item list).
  await Vendor.updateOne({ code: 'NV-DELTA' }, { $pull: { products: { skuCode: 'NV-NOHIST' } } });
  console.log(`run ${RUN} against ${API}`);

  // ── V: previous vendors only ──
  console.log('\nV  Vendor history rule at Step 1.3');
  const v = await quotedIndent(['NOHIST', 'HIST', 'CODE']);
  let r = await approve(v, [R(v, 0, 'HOLD'), R(v, 1, 'APPROVE', O), R(v, 2, 'APPROVE', A)]);
  check('V1 a vendor who never supplied the item is refused (and the allowed ones are named)', r.status === 400 && /neither quoted for nor previously supplied/.test(r.message) && /NV Alpha Traders/.test(r.message), `${r.status} ${r.message}`);
  r = await approve(v, [R(v, 0, 'APPROVE', A), R(v, 1, 'HOLD'), R(v, 2, 'HOLD')]);
  check('V2 an item with no previous vendor refuses any vendor — "No Previous Vendors Found" (no Vendor Master fallback)', r.status === 400 && /No eligible vendors found/.test(r.message), `${r.status} ${r.message}`);
  r = await approve(v, [R(v, 0, 'HOLD'), R(v, 1, 'APPROVE', G), R(v, 2, 'HOLD')]);
  check('V3 an inactive vendor is refused', r.status === 400, `${r.status} ${r.message}`);
  r = await approve(v, [R(v, 0, 'HOLD'), R(v, 1, 'APPROVE', B), R(v, 2, 'HOLD')]);
  check('V4 a vendor with only a DRAFT PO for the item is not "previous"', r.status === 400 && /neither quoted for nor previously supplied/.test(r.message), `${r.status} ${r.message}`);
  const untouched = await fresh(v._id);
  check('V5 every refusal left the indent untouched (no partial write)', untouched.overallStatus === 'QUOTE_RECEIVED' && !untouched.quotationApprovalStep?.itemApprovedQuotations?.length && untouched.items.every((it) => !it.vendorId));

  // ── P: partial submit ──
  console.log('\nP  Partial submission — item 1 on hold, items 2 and 3 approved');
  r = await approve(v, [R(v, 0, 'HOLD', undefined, { remarks: 'waiting for a vendor', actualAt: '2026-11-18' }), R(v, 1, 'APPROVE', A, { remarks: 'ok-2', actualAt: '2026-11-19' }), R(v, 2, 'APPROVE', A, { remarks: 'ok-3', actualAt: '2026-11-20' })]);
  check('P1 submit of the two ready items succeeds without the held one', r.status === 200, `${r.status} ${r.message}`);
  let ind = await fresh(v._id);
  const step = ind.quotationApprovalStep;
  check('P2 the step is NOT complete: no statusDone, partial = true', !step.statusDone && step.partial === true, JSON.stringify({ s: step.statusDone, p: step.partial }));
  check('P3 indent is PO-eligible for its approved items (QUOTATION_APPROVED), not PO_READY', ind.overallStatus === 'QUOTATION_APPROVED', ind.overallStatus);
  check('P4 approved items carry Alpha (APPROVED_QUOTATION); the held item has no vendor', ind.items[1].vendorSource === 'APPROVED_QUOTATION' && String(ind.items[1].vendorId) === A && String(ind.items[2].vendorId) === A && !ind.items[0].vendorId);
  const rows = step.itemApprovedQuotations;
  const byStatus = (id) => rows.find((x) => String(x.itemId) === String(id));
  check('P5 saved rows keep each item\'s status, remarks and actual date', byStatus(ind.items[0]._id).statusDone === 'ON_HOLD' && byStatus(ind.items[0]._id).remarks === 'waiting for a vendor'
    && byStatus(ind.items[1]._id).statusDone === 'YES' && byStatus(ind.items[1]._id).remarks === 'ok-2' && String(byStatus(ind.items[2]._id).actualAt).startsWith('2026-11-20'), JSON.stringify(rows.map((x) => [x.statusDone, x.remarks, x.actualAt])));
  check('P6 the held item keeps its quotation file', byStatus(ind.items[0]._id).approvedQuotationDocuments.length === 1);
  check('P7 the indent stays on the Step 1.3 queue (PENDING) and is not DONE', await queueHas(ind, 'PENDING') && !(await queueHas(ind, 'DONE')));
  let picker = await pickerRows(ind);
  check('P8 PO picker offers the approved items (Alpha fixed) and NOT the held item', picker.length === 2
    && picker.every((x) => x.vendorState === 'SET' && String(x.vendorId) === A) && !picker.some((x) => String(x.indentItemId) === String(ind.items[0]._id)), JSON.stringify(picker.map((x) => [x.indentItemId, x.vendorState])));

  // ── D: PO + duplicates ──
  console.log('\nD  PO for the approved items, duplicate prevention');
  let po = await poFromItems([[ind, ind.items[1]], [ind, ind.items[2]]], A);
  check('D1 one PO is raised for items 2 + 3 (Alpha)', po.status === 201 || po.status === 200, `${po.status} ${po.message}`);
  ind = await fresh(v._id);
  check('D2 indent is PARTIAL_PO_CREATED — never PO_READY while an item is still owed a decision', ind.overallStatus === 'PARTIAL_PO_CREATED', ind.overallStatus);
  check('D3 items 2 + 3 are linked to the PO, item 1 is not', ind.items[1].procurementStatus === 'PO_CREATED' && ind.items[2].procurementStatus === 'PO_CREATED' && ind.items[0].procurementStatus !== 'PO_CREATED');
  po = await poFromItems([[ind, ind.items[1]]], A);
  check('D4 a second PO for an item already on a PO is refused', po.status >= 400, `${po.status} ${po.message}`);
  po = await poFromItems([[ind, ind.items[0]]], A);
  check('D5 a PO for the held item is refused (not approved)', po.status >= 400, `${po.status} ${po.message}`);
  check('D6 the indent still sits on the Step 1.3 queue', await queueHas(ind, 'PENDING'));

  // ── R: reopen + complete later ──
  console.log('\nR  Reopen, complete the remaining item later');
  r = await approve(ind, [R(ind, 1, 'APPROVE', D)]);
  check('R1 changing the vendor of an item already on a PO is refused', r.status === 400 && /already on/.test(r.message), `${r.status} ${r.message}`);
  r = await approve(ind, [R(ind, 2, 'HOLD')]);
  check('R2 putting an item that is already on a PO on hold is refused', r.status === 400 && /already on/.test(r.message), `${r.status} ${r.message}`);
  r = await approve(ind, [R(ind, 0, 'APPROVE', A)]);
  check('R3 the held item still cannot take a vendor with no history (Alpha)', r.status === 400 && /No eligible vendors found/.test(r.message), `${r.status} ${r.message}`);
  // The vendor later supplies the SKU (Vendor Master item list — what the PO form does) → history now exists.
  const nohist = await skuDoc('NOHIST');
  await Vendor.updateOne({ code: 'NV-DELTA' }, { $addToSet: { products: { skuId: nohist._id, skuCode: nohist.code, productName: nohist.name, rate: 50 } } });
  r = await approve(ind, [R(ind, 0, 'APPROVE', D, { remarks: 'price agreed', actualAt: '2026-11-22' })]);
  check('R4 a stale client naming ONLY the held item completes it later', r.status === 200, `${r.status} ${r.message}`);
  ind = await fresh(v._id);
  const rows2 = ind.quotationApprovalStep.itemApprovedQuotations;
  const row2 = (i) => rows2.find((x) => String(x.itemId) === String(ind.items[i]._id));
  check('R5 the earlier approvals survive untouched (status, remarks, date)', rows2.length === 3 && row2(1).statusDone === 'YES' && row2(1).remarks === 'ok-2' && String(row2(2).actualAt).startsWith('2026-11-20'));
  check('R6 now complete: statusDone YES, partial false', ind.quotationApprovalStep.statusDone === 'YES' && ind.quotationApprovalStep.partial === false);
  check('R7 indent stays PARTIAL_PO_CREATED (2 of 3 on a PO) and leaves the Step 1.3 queue', ind.overallStatus === 'PARTIAL_PO_CREATED' && !(await queueHas(ind, 'PENDING')) && await queueHas(ind, 'DONE'), ind.overallStatus);
  check('R8 earlier items keep Alpha and their PO link; the new item is Delta', String(ind.items[1].vendorId) === A && ind.items[1].procurementStatus === 'PO_CREATED' && String(ind.items[0].vendorId) === D);
  po = await poFromItems([[ind, ind.items[0]]], D, 50);
  check('R9 the last item gets its own PO (Delta)', po.status === 201 || po.status === 200, `${po.status} ${po.message}`);
  ind = await fresh(v._id);
  check('R10 every item is POed and the step is complete → PO_READY', ind.overallStatus === 'PO_READY', ind.overallStatus);
  const pos = await activePos(ind._id);
  check('R11 exactly two active POs (Alpha: items 2+3, Delta: item 1) — no duplicates', pos.length === 2 && pos.filter((p) => String(p.vendorId) === A).length === 1 && pos.filter((p) => String(p.vendorId) === D).length === 1, JSON.stringify(pos.map((p) => [String(p.vendorId), p.items.length])));
  r = await approve(ind, [R(ind, 0, 'APPROVE', D)]);
  check('R12 a completed + fully POed approval cannot be re-submitted', r.status === 400, `${r.status} ${r.message}`);

  // ── H: holds ──
  console.log('\nH  Holding and re-holding');
  const h = await quotedIndent(['HIST', 'CODE']);
  r = await approve(h, [R(h, 0, 'APPROVE', A), R(h, 1, 'APPROVE', A)]);
  check('H1 full approval (every item a vendor) completes the step as before', r.status === 200, `${r.status} ${r.message}`);
  let hi = await fresh(h._id);
  check('H2 complete: statusDone YES, partial false, QUOTATION_APPROVED', hi.quotationApprovalStep.statusDone === 'YES' && hi.quotationApprovalStep.partial === false && hi.overallStatus === 'QUOTATION_APPROVED');
  r = await approve(h, [R(h, 1, 'HOLD')]);
  check('H3 an approved item with no PO can be put back on hold', r.status === 200, `${r.status} ${r.message}`);
  hi = await fresh(h._id);
  check('H4 …its vendor is cleared, the step reopens (partial) and the item leaves the PO picker', !hi.items[1].vendorId && String(hi.items[0].vendorId) === A && hi.quotationApprovalStep.partial === true && !hi.quotationApprovalStep.statusDone
    && !(await pickerRows(hi)).some((x) => String(x.indentItemId) === String(hi.items[1]._id)));
  check('H5 …and the indent is back on the Step 1.3 queue', await queueHas(hi, 'PENDING'));

  const z = await quotedIndent(['HIST']);
  r = await approve(z, [R(z, 0, 'HOLD')]);
  const zi = await fresh(z._id);
  check('H6 submitting only holds keeps the indent at QUOTE_RECEIVED with nothing PO-eligible', r.status === 200 && zi.overallStatus === 'QUOTE_RECEIVED' && zi.quotationApprovalStep.partial === true && (await pickerRows(zi)).length === 0, `${r.status} ${zi.overallStatus}`);

  // legacy shape: rows without item ids keep the all-or-nothing behaviour
  const l = await quotedIndent(['HIST']);
  r = await call('POST', `/procurement/indents/${l._id}/approve-quotation`, {
    itemApprovedQuotations: [{ itemName: l.items[0].itemName, statusDone: 'YES', approvedQuotationDocuments: [doc(`legacy-${RUN}`)] }],
  });
  const li = await fresh(l._id);
  check('H7 a legacy payload (rows without item ids) still completes in one go', r.status === 200 && li.quotationApprovalStep.statusDone === 'YES' && li.quotationApprovalStep.partial === false, `${r.status} ${r.message}`);

  // ── S: Step 1.3 vendor is optional — bulk-selected items go to the PO, vendor chosen THERE ──
  console.log('\nS  Select items → PO; vendor optional at Step 1.3, chosen on the PO from previous vendors');
  // Start clean: NV-NOHIST has no history until Delta's item list gets it (below).
  await Vendor.updateOne({ code: 'NV-DELTA' }, { $pull: { products: { skuCode: 'NV-NOHIST' } } });
  const s = await quotedIndent(['NOHIST', 'HIST', 'CODE']);
  // the user ticks items 2 and 3 only (no vendors); item 1 is left unticked = PENDING
  r = await approve(s, [R(s, 0, 'PENDING'), R(s, 1, 'YES-NO-VENDOR'), R(s, 2, 'YES-NO-VENDOR')]);
  check('S1 ticked items 2+3 are approved WITHOUT any vendor (Step 1.3 vendor is optional)', r.status === 200, `${r.status} ${r.message}`);
  let si = await fresh(s._id);
  check('S2 partial: step not complete, indent PO-eligible (QUOTATION_APPROVED), item 1 pending, no item has a vendor',
    si.quotationApprovalStep.partial === true && !si.quotationApprovalStep.statusDone && si.overallStatus === 'QUOTATION_APPROVED' && si.items.every((it) => !it.vendorId));
  let sp = await pickerRows(si);
  check('S3 PO picker offers items 2+3 as "vendor not selected" (not blocked) and NOT the unticked item',
    sp.length === 2 && sp.every((x) => x.vendorState === 'MISSING') && !sp.some((x) => String(x.indentItemId) === String(si.items[0]._id)), JSON.stringify(sp.map((x) => [x.indentItemId, x.vendorState])));
  const hist1 = sp.find((x) => String(x.indentItemId) === String(si.items[1]._id));
  const hist2 = sp.find((x) => String(x.indentItemId) === String(si.items[2]._id));
  check('S4 each row carries its ELIGIBLE vendors only — untagged quotes, so = previous vendors (HIST: Alpha+Delta · CODE: Alpha) — never the whole master',
    JSON.stringify(hist1.eligibleVendors.map((h) => h.vendorName).sort()) === JSON.stringify(['NV Alpha Traders', 'NV Delta Catalog'])
    && JSON.stringify(hist2.eligibleVendors.map((h) => h.vendorName)) === JSON.stringify(['NV Alpha Traders']), JSON.stringify([hist1.eligibleVendors, hist2.eligibleVendors]));
  po = await poFromItems([[si, si.items[1]], [si, si.items[2]]], B);
  check('S5 PO with a vendor that never supplied the items (Beta) is refused', po.status === 400 && /neither quoted for nor previously supplied/.test(po.message), `${po.status} ${po.message}`);
  po = await poFromItems([[si, si.items[1]], [si, si.items[2]]], D, 90);
  check('S6 PO with Delta is refused — Delta supplied item 2 but not item 3 (every item must have the vendor in its history)', po.status === 400 && /neither quoted for nor previously supplied/.test(po.message), `${po.status} ${po.message}`);
  po = await poFromItems([[si, si.items[1]], [si, si.items[2]]], A);
  check('S7 PO with Alpha (previous vendor of both) is created — one PO for the vendor group', po.status === 201 || po.status === 200, `${po.status} ${po.message}`);
  si = await fresh(s._id);
  check('S8 indent is PARTIAL_PO_CREATED (item 1 still owed) and the step is still open', si.overallStatus === 'PARTIAL_PO_CREATED' && si.quotationApprovalStep.partial === true && await queueHas(si, 'PENDING'), si.overallStatus);
  po = await poFromItems([[si, si.items[1]]], A);
  check('S9 a second PO for an item already on a PO is refused (no duplicate)', po.status >= 400, `${po.status} ${po.message}`);
  let poId = ((await activePos(si._id))[0] || {})._id;
  r = await call('PATCH', `/procurement/purchase-orders/${poId}`, { vendorId: D });
  check('S10 editing the draft to a vendor that has not supplied every item is refused', r.status === 400 && /neither quoted for nor previously supplied/.test(r.message), `${r.status} ${r.message}`);
  r = await call('POST', `/procurement/purchase-orders/${poId}/submit`, {});
  check('S11 a valid-vendor draft submits for approval', r.status === 200, `${r.status} ${r.message}`);

  // later: complete item 1 (no vendor), then its PO — vendor from history once it has one
  r = await approve(si, [R(si, 0, 'YES-NO-VENDOR')]);
  check('S12 item 1 is completed later without a vendor; earlier approvals untouched; step complete', r.status === 200, `${r.status} ${r.message}`);
  si = await fresh(s._id);
  check('S13 step complete (statusDone YES), indent still PARTIAL_PO_CREATED, items 2+3 keep their PO link', si.quotationApprovalStep.statusDone === 'YES' && si.overallStatus === 'PARTIAL_PO_CREATED'
    && si.items[1].procurementStatus === 'PO_CREATED' && si.items[2].procurementStatus === 'PO_CREATED' && si.items[0].procurementStatus !== 'PO_CREATED');
  po = await poFromItems([[si, si.items[0]]], A);
  check('S14 item 1 has no previous vendor → "No Previous Vendors Found" (the Vendor Master is not a fallback)', po.status === 400 && /No eligible vendors found/.test(po.message), `${po.status} ${po.message}`);
  const nohist2 = await skuDoc('NOHIST');
  await Vendor.updateOne({ code: 'NV-DELTA' }, { $addToSet: { products: { skuId: nohist2._id, skuCode: nohist2.code, productName: nohist2.name, rate: 50 } } });
  po = await poFromItems([[si, si.items[0]]], D, 50);
  check('S15 once Delta carries the SKU its PO is created', po.status === 201 || po.status === 200, `${po.status} ${po.message}`);
  si = await fresh(s._id);
  const spos = await activePos(si._id);
  check('S16 indent PO_READY; exactly two active POs (Alpha: items 2+3, Delta: item 1)', si.overallStatus === 'PO_READY' && spos.length === 2
    && spos.filter((p) => String(p.vendorId) === A && p.items.length === 2).length === 1 && spos.filter((p) => String(p.vendorId) === D && p.items.length === 1).length === 1, `${si.overallStatus} ${JSON.stringify(spos.map((p) => [String(p.vendorId), p.items.length]))}`);

  // vendor selected at Pending for PO (Select Vendor) is held to the same rule and then fixes the PO vendor
  await Vendor.updateOne({ code: 'NV-DELTA' }, { $pull: { products: { skuCode: 'NV-NOHIST' } } });
  const t = await quotedIndent(['HIST']);
  r = await approve(t, [R(t, 0, 'YES-NO-VENDOR')]);
  let ti = await fresh(t._id);
  check('S17 single quoted item approved without a vendor → complete step, PO-eligible, vendor not selected', r.status === 200 && ti.quotationApprovalStep.statusDone === 'YES' && (await pickerRows(ti))[0]?.vendorState === 'MISSING');
  r = await call('PATCH', '/procurement/purchase-orders/approved-items/vendor', { indentId: t._id, indentItemId: ti.items[0]._id, vendorId: B });
  check('S18 Select Vendor with a non-previous vendor (Beta) is refused', r.status === 400 && /neither quoted for nor previously supplied/.test(r.message), `${r.status} ${r.message}`);
  r = await call('PATCH', '/procurement/purchase-orders/approved-items/vendor', { indentId: t._id, indentItemId: ti.items[0]._id, vendorId: D });
  check('S19 Select Vendor with a previous vendor (Delta) is saved', r.status === 200, `${r.status} ${r.message}`);
  po = await poFromItems([[ti, ti.items[0]]], A);
  check('S20 the vendor chosen there is then fixed — a PO with another vendor is refused', po.status === 400 && /Delta/.test(po.message), `${po.status} ${po.message}`);
  po = await poFromItems([[ti, ti.items[0]]], D, 90);
  check('S21 …and a PO with that vendor is created', po.status === 201 || po.status === 200, `${po.status} ${po.message}`);

  // re-approving with the vendor cleared gives the saved vendor up (before any PO)
  const c = await quotedIndent(['HIST']);
  await approve(c, [R(c, 0, 'APPROVE', A)]);
  let ci = await fresh(c._id);
  const hadVendor = String(ci.items[0].vendorId) === A;
  await approve(c, [R(c, 0, 'YES-NO-VENDOR')]);
  ci = await fresh(c._id);
  check('S22 an approved item whose vendor is cleared (before a PO) loses it and stays approved', hadVendor && !ci.items[0].vendorId && ci.quotationApprovalStep.statusDone === 'YES');

  console.log(`\n${failures ? 'FAILED' : 'OK'} — ${passes} passed, ${failures} failed`);
  process.exitCode = failures ? 1 : 0;
};

const main = async () => {
  try {
    if (process.argv[2] === '--api') await api();
    else console.log('usage: node src/scripts/e2eApprovalPartialFixture.js --api   (seed first: e2eNrVendorHistoryFixture.js --seed)');
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
};
if (isEntry(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
