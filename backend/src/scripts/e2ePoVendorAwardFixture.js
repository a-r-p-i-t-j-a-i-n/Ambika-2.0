/**
 * API oracle — indent-wise vendor award → one PO per vendor → Draft / Submit /
 * Approve (client feedback "Purchase FMS – Vendor Management", 2026-11-19).
 *
 *   node src/scripts/e2ePoVendorAwardFixture.js --seed   upsert users + vendors (never drops)
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5095 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_povendoraward node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5095/api/v1 node src/scripts/e2ePoVendorAwardFixture.js --api
 *   node src/scripts/e2ePoVendorAwardFixture.js --prep-ui   data for the browser probe → frontend/e2e/shots/po-vendor-award-manifest.json
 *
 * --api makes fresh indents each run (names carry a run tag) — re-runnable.
 *   Q  Step 1.2 records who quoted (vendor per quotation file, name from the
 *      Vendor Master); Step 1.3 approves only an ELIGIBLE vendor: one who quoted for
 *      the item (even if its file was not kept) OR previously supplied its SKU;
 *      tags on kept files come from Step 1.2; legacy untagged quotations rely on
 *      purchase history (no Vendor Master fallback).
 *   P  Items awarded to different vendors → one PO per vendor with only its
 *      items, all linked to the indent; duplicate / wrong-vendor POs refused.
 *   T  Each PO keeps its own Delivery Terms, Remarks and T&C.
 *   R  Partial award: remaining items stay pending (PARTIAL_PO_CREATED).
 *   S  Single vendor (one item / several items) → one PO.
 *   D  Save as Draft (not submitted, cannot be approved) → Submit → Approve;
 *      direct Submit; Save & Submit from an edit; no saveMode = submitted;
 *      legacy POs approvable; MD direct save unchanged; doer queues.
 *   F  Downstream unchanged: release → follow-up → PI → advance → GRN + QC → stock.
 *
 * SAFETY: localhost scratch DB behind the shared e2e guard; never drops.
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import IncomingQC from '../modules/procurement/incoming-qc/incomingQc.model.js';
import ProformaInvoice from '../modules/procurement/proforma-invoice/proformaInvoice.model.js';

export const DB_NAME = 'ambika_e2e_povendoraward';
export const E2E_URI = process.env.E2E_POVENDOR_URI || `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2ePoVendorAwardFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5095/api/v1').replace(/\/+$/, '');
const PASSWORD = 'E2e@12345';
const USERS = {
  MD:    { email: 'povaward-md@test.local',    name: 'E2E Award MD',    role: 'MD', roles: ['MD'], mobile: '9000000091' },
  BUYER: { email: 'povaward-buyer@test.local', name: 'E2E Award Buyer', role: 'EA', roles: ['PLANNER'], mobile: '9000000092' },
  // PO Approval permission (procurement.approve) via a grant — the APPROVER decides
  // others' POs; the MAKER holds it too but prepares POs (maker-checker); VIEWER has none.
  APPROVER: { email: 'povaward-approver@test.local', name: 'E2E Award Approver', role: 'EA', roles: ['PLANNER'], permissionGrants: ['procurement.approve'], mobile: '9000000093' },
  MAKER:    { email: 'povaward-maker@test.local',    name: 'E2E Award Maker',    role: 'EA', roles: ['PLANNER'], permissionGrants: ['procurement.approve'], mobile: '9000000094' },
  VIEWER:   { email: 'povaward-viewer@test.local',   name: 'E2E Award Viewer',   role: 'EA', roles: ['PLANNER'], permissionGrants: [], mobile: '9000000095' },
};
const VENDORS = [
  { code: 'PVA-X', name: 'PVA Xenon Metals', isActive: true },
  { code: 'PVA-Y', name: 'PVA Yarrow Supplies', isActive: true },
  { code: 'PVA-Z', name: 'PVA Zinc Traders', isActive: true },
  { code: 'PVA-W', name: 'PVA Wolfram Inactive', isActive: false },
];
const RUN = Date.now().toString(36);
const file = (name, vendorId, quotedRate = null, deliveryDays = null, extra = {}) => ({
  fileName: `${name}.pdf`, fileUrl: `https://example.invalid/e2e/povaward/${RUN}/${name}.pdf`, fileType: 'application/pdf',
  ...(vendorId ? { vendorId } : {}), quotedRate, deliveryDays, ...extra,
});

let failures = 0;
let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${detail}` : ''}`);
};
const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

const seed = async () => {
  await connect();
  for (const u of Object.values(USERS)) {
    if (!await User.findOne({ email: u.email })) await User.create({ ...u, password: PASSWORD, isActive: true });
    else await User.updateOne({ email: u.email }, { $set: { roles: u.roles, role: u.role, permissionGrants: u.permissionGrants || [] } });
  }
  for (const v of VENDORS) {
    await Vendor.updateOne({ code: v.code }, { $set: { name: v.name, isActive: v.isActive, isDeleted: false } }, { upsert: true });
  }
  console.log(`[seed] ${DB_NAME}: users ${Object.values(USERS).map((u) => u.email).join(', ')} / ${PASSWORD}; vendors ${VENDORS.map((v) => v.name).join(', ')}`);
};

// ── HTTP ─────────────────────────────────────────────────────────────────
const tokens = {};
const call = async (who, method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, data: json?.data, meta: json?.meta || json?.pagination, message: json?.message || '' };
};
const ok = async (who, method, p, body) => {
  const r = await call(who, method, p, body);
  if (r.status >= 400) throw new Error(`${method} ${p} → ${r.status} ${r.message}`);
  return r.data;
};
const login = async () => {
  for (const [k, u] of Object.entries(USERS)) {
    const r = await call(k, 'POST', '/auth/login', { email: u.email, password: PASSWORD });
    tokens[k] = r.data?.token || '';
    if (!tokens[k]) throw new Error(`login ${u.email} failed: ${r.status} ${r.message} — run --seed first`);
  }
};

const skuItem = async (name, quantity) => {
  const code = `E2E-${name}`.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 60);
  const sku = await SKU.findOneAndUpdate({ code }, { $setOnInsert: { code, name, unit: 'PCS', itemType: 'CONSUMABLE' } }, { upsert: true, new: true }).lean();
  return { skuId: String(sku._id), skuCode: sku.code, itemName: sku.name, quantity, unit: 'Pcs' };
};
const approvedIndent = async (names, tag = 'award') => {
  const ind = await ok('BUYER', 'POST', '/procurement/indents', {
    department: 'Stores', remarks: `po vendor award e2e ${RUN}`,
    items: await Promise.all(names.map((n, i) => skuItem(`${tag} ${n} ${RUN}`, 10 + i))),
  });
  await ok('BUYER', 'POST', `/procurement/indents/${ind._id}/submit`, {});
  return ok('MD', 'POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
};
// Step 1.2 — filesPerItem[i] = [file(...)] for a YES item.
const quote = (who, indent, filesPerItem) => call(who, 'POST', `/procurement/indents/${indent._id}/quote-comparative`, {
  statusDone: 'YES',
  itemQuotations: indent.items.map((it, i) => ({ itemId: it._id, itemName: it.itemName, statusDone: 'YES', quotationDocuments: filesPerItem[i] })),
});
// Step 1.3 — keep[i] = files kept for item i, vendorIds[i] = approved vendor.
const approveQ = (indent, keep, vendorIds) => call('MD', 'POST', `/procurement/indents/${indent._id}/approve-quotation`, {
  itemApprovedQuotations: indent.items.map((it, i) => ({
    itemId: it._id, itemName: it.itemName, statusDone: 'YES', approvedQuotationDocuments: keep[i], vendorId: vendorIds[i],
  })),
});
const fresh = (id) => PurchaseIndent.findById(id).lean();
// Previous-supply history for a vendor: the indent's SKUs go on its Vendor Master item list.
const giveHistory = async (vendorId, indent) => {
  for (const it of indent.items) {
    await Vendor.updateOne({ _id: vendorId }, { $push: { products: { skuId: it.skuId, skuCode: it.skuCode, productName: it.itemName, rate: 100 } } });
  }
};
const poNow = (id) => VendorPurchaseOrder.findById(id).lean();
const approvedRows = async () => (await ok('BUYER', 'GET', '/procurement/purchase-orders/approved-items')).items;
const line = (indent, it, extra = {}) => ({
  indentId: indent._id, indentItemId: it._id, itemName: it.itemName, skuCode: it.skuCode, skuId: it.skuId,
  quantity: it.approvedQuantity || it.quantity, unit: it.unit, rate: 100, gstRate: 18, ...extra,
});
const poFor = (who, vendorId, lines, extra = {}) => call(who, 'POST', '/procurement/purchase-orders/create-from-items', {
  vendorId, expectedDeliveryDate: new Date(Date.now() + 7 * 864e5).toISOString(), items: lines, ...extra,
});
const sameIds = (a, b) => JSON.stringify([...a].map(String).sort()) === JSON.stringify([...b].map(String).sort());

// One indent, three items, all quoted + approved to vendors[i]; returns { indent, items }.
const awardedIndent = async (names, vendorIds, tag) => {
  const ind = await approvedIndent(names, tag);
  const files = ind.items.map((it, i) => [file(`${tag}-${i}`, vendorIds[i], 100 + i, 5)]);
  const q = await quote('BUYER', ind, files);
  if (q.status !== 200) throw new Error(`quote ${q.status} ${q.message}`);
  const a = await approveQ(ind, files, vendorIds);
  if (a.status !== 200) throw new Error(`approve ${a.status} ${a.message}`);
  return fresh(ind._id);
};

// ── API checks ───────────────────────────────────────────────────────────
const api = async () => {
  await connect();
  await login();
  const [X, Y, Z, W] = (await Promise.all(VENDORS.map((v) => Vendor.findOne({ code: v.code }).lean()))).map((v) => ({ id: String(v._id), name: v.name }));
  console.log(`run ${RUN} against ${API}`);

  // ── Q: who quoted ──
  console.log('\nQ  Step 1.2 records who quoted; Step 1.3 approves only those vendors');
  const ind = await approvedIndent(['Item A', 'Item B', 'Item C'], 'Q');
  const [iA, iB, iC] = ind.items;
  const fA1 = file('qa-x', X.id, 100, 7, { vendorName: 'Spoofed Name' });
  const fA2 = file('qa-z', Z.id, 120, 3);
  const fB1 = file('qb-y', Y.id, 50, 10);
  const fB2 = file('qb-x', X.id, 55, 6);
  const fC1 = file('qc-x', X.id, 30, null);
  const unknown = await quote('BUYER', ind, [[file('qa-u', String(new mongoose.Types.ObjectId()))], [fB1], [fC1]]);
  check('Q1 a quotation tagged with an unknown vendor is refused (400)', unknown.status === 400 && /not found in the Vendor Master/.test(unknown.message), `${unknown.status} ${unknown.message}`);
  const inactive = await quote('BUYER', ind, [[file('qa-w', W.id)], [fB1], [fC1]]);
  check('Q2 a new tag naming an inactive vendor is refused (400)', inactive.status === 400 && /inactive/.test(inactive.message), `${inactive.status} ${inactive.message}`);
  const badRate = await quote('BUYER', ind, [[file('qa-n', X.id, -5)], [fB1], [fC1]]);
  check('Q3 a negative quoted rate is refused (422)', badRate.status === 422, `${badRate.status} ${badRate.message}`);
  const q12 = await quote('BUYER', ind, [[fA1, fA2], [fB1, fB2], [fC1]]);
  check('Q4 Step 1.2 with vendor-tagged quotations accepted', q12.status === 200, `${q12.status} ${q12.message}`);
  const s12 = (await fresh(ind._id)).quoteComparativeStep.itemQuotations;
  const docA = s12.find((r) => String(r.itemId) === String(iA._id)).quotationDocuments;
  check('Q5 each file keeps its vendor, rate and delivery days', String(docA[0].vendorId) === X.id && docA[0].quotedRate === 100 && docA[0].deliveryDays === 7
    && String(docA[1].vendorId) === Z.id && docA[1].quotedRate === 120, JSON.stringify(docA));
  check('Q6 vendor name comes from the Vendor Master, not the client', docA[0].vendorName === X.name, docA[0].vendorName);
  const notQuoted = await approveQ(ind, [[fA1, fA2], [fB1, fB2], [fC1]], [Y.id, Y.id, X.id]);
  check('Q7 Step 1.3 refuses a vendor who neither quoted for the item nor ever supplied it (400)', notQuoted.status === 400 && /neither quoted for nor previously supplied/.test(notQuoted.message), `${notQuoted.status} ${notQuoted.message}`);
  // Union rule: a vendor who QUOTED stays eligible even when its file is not kept at Step 1.3.
  const qr = await approvedIndent(['Removed'], 'QR');
  const qrA = file('qr-z', Z.id, 70, 5); const qrB = file('qr-x', X.id, 75, 6);
  await quote('BUYER', qr, [[qrA, qrB]]);
  const removed = await approveQ(qr, [[qrB]], [Z.id]);
  check('Q8 Step 1.3 accepts a vendor who quoted although its quotation file was not kept (union rule)', removed.status === 200, `${removed.status} ${removed.message}`);
  // …and a vendor who only supplied the SKU before (no quotation from it) is eligible too.
  const qh = await approvedIndent(['History'], 'QH');
  await quote('BUYER', qh, [[file('qh-x', X.id, 60, 4)]]);
  await giveHistory(Y.id, qh);
  const histOnly = await approveQ(qh, [[file('qh-x', X.id, 60, 4)]], [Y.id]);
  check('Q8b Step 1.3 accepts a previously-supplied vendor that sent no quotation (union rule)', histOnly.status === 200, `${histOnly.status} ${histOnly.message}`);
  check('Q9 refused approvals left the indent at QUOTE_RECEIVED', (await fresh(ind._id)).overallStatus === 'QUOTE_RECEIVED');
  // The client tries to re-tag the kept file — the server copies Step 1.2's tag.
  const spoof = { ...fB1, vendorId: Z.id, quotedRate: 1 };
  const a13 = await approveQ(ind, [[fA1, fA2], [spoof], [fC1]], [X.id, Y.id, X.id]);
  check('Q10 Step 1.3 accepted: A→X, B→Y, C→X', a13.status === 200, `${a13.status} ${a13.message}`);
  const after13 = await fresh(ind._id);
  const keptB = after13.quotationApprovalStep.itemApprovedQuotations.find((r) => String(r.itemId) === String(iB._id)).approvedQuotationDocuments[0];
  check('Q11 kept file carries the Step 1.2 vendor/rate, not the client\'s', String(keptB.vendorId) === Y.id && keptB.quotedRate === 50 && keptB.vendorName === Y.name, JSON.stringify(keptB));
  const vend = Object.fromEntries(after13.items.map((it) => [it.itemName, `${it.vendorName}|${it.vendorSource}`]));
  check('Q12 approved vendor stored per item (APPROVED_QUOTATION)', vend[iA.itemName] === `${X.name}|APPROVED_QUOTATION` && vend[iB.itemName] === `${Y.name}|APPROVED_QUOTATION` && vend[iC.itemName] === `${X.name}|APPROVED_QUOTATION`, JSON.stringify(vend));
  const rows = (await approvedRows()).filter((r) => String(r.indentId) === String(ind._id));
  const rowA = rows.find((r) => String(r.indentItemId) === String(iA._id));
  check('Q13 Pending-for-PO rows list who quoted + the kept quotation rate', rows.length === 3 && rowA.quotedVendors.length === 2 && rowA.quotedRate === 100 && rowA.quotedDeliveryDays === 7, JSON.stringify(rowA));
  // Legacy: quotations recorded with no vendor keep the Vendor Master choice.
  const leg = await approvedIndent(['Legacy'], 'QL');
  const lf = file('ql', null);
  await quote('BUYER', leg, [[lf]]);
  const legNo = await approveQ(leg, [[lf]], [Z.id]);
  check('Q14a quotations with no vendor recorded + no purchase history → no vendor is eligible (400, no Vendor Master fallback)', legNo.status === 400 && /No eligible vendors found/.test(legNo.message), `${legNo.status} ${legNo.message}`);
  await giveHistory(Z.id, leg);
  const legOk = await approveQ(leg, [[lf]], [Z.id]);
  check('Q14 …with purchase history the vendor is eligible (legacy untagged quotation)', legOk.status === 200, `${legOk.status} ${legOk.message}`);

  // ── P: one PO per vendor ──
  console.log('\nP  Different vendors → separate POs');
  const poX = await poFor('BUYER', X.id, [line(after13, after13.items[0]), line(after13, after13.items[2])], {
    saveMode: 'SUBMIT', deliveryTerms: 'Door delivery — Xenon', remarks: 'X: call before dispatch', termsAndConditions: 'Xenon special terms: 30 days',
  });
  const poY = await poFor('BUYER', Y.id, [line(after13, after13.items[1])], { saveMode: 'DRAFT', deliveryTerms: 'Ex-works — Yarrow', remarks: 'Y: pack in crates' });
  check('P1 PO for Vendor X (Item A + Item C) created', poX.status === 201, `${poX.status} ${poX.message}`);
  check('P2 PO for Vendor Y (Item B) created', poY.status === 201, `${poY.status} ${poY.message}`);
  const PX = await poNow(poX.data?._id);
  const PY = await poNow(poY.data?._id);
  check('P3 PO X holds only Item A + Item C, vendor X', sameIds(PX.items.map((l) => l.indentItemId), [iA._id, iC._id]) && String(PX.vendorId) === X.id);
  check('P4 PO Y holds only Item B, vendor Y', sameIds(PY.items.map((l) => l.indentItemId), [iB._id]) && String(PY.vendorId) === Y.id);
  check('P5 both POs link back to the same indent', String(PX.indentId) === String(ind._id) && String(PY.indentId) === String(ind._id) && PX.indentNumber === ind.indentNumber);
  const indP = await fresh(ind._id);
  const byItem = Object.fromEntries(indP.items.map((it) => [String(it._id), String(it.poId)]));
  check('P6 each indent item points at its own vendor\'s PO; indent PO_READY', byItem[iA._id] === String(PX._id) && byItem[iC._id] === String(PX._id) && byItem[iB._id] === String(PY._id) && indP.overallStatus === 'PO_READY', JSON.stringify({ byItem, s: indP.overallStatus }));
  const dup = await poFor('BUYER', X.id, [line(after13, after13.items[0])]);
  check('P7 a second PO for an awarded item is refused (400)', dup.status === 400 && /Already on an active PO|not ready for PO/.test(dup.message), `${dup.status} ${dup.message}`);
  check('P8 awarded items are gone from Pending for PO', !(await approvedRows()).some((r) => String(r.indentId) === String(ind._id)));
  check('P9 the refusal created no extra PO', await VendorPurchaseOrder.countDocuments({ indentIds: ind._id }) === 2);
  const ind2 = await awardedIndent(['M1', 'M2'], [X.id, Y.id], 'PW');
  const wrong = await poFor('BUYER', X.id, [line(ind2, ind2.items[1])]);
  check('P10 an item cannot go on another vendor\'s PO (400)', wrong.status === 400 && wrong.message.includes(`approved quotation is "${Y.name}"`), `${wrong.status} ${wrong.message}`);
  const mixed = await poFor('BUYER', X.id, [line(ind2, ind2.items[0]), line(ind2, ind2.items[1])]);
  check('P11 one PO mixing two vendors\' items is refused (400)', mixed.status === 400, `${mixed.status} ${mixed.message}`);

  // ── T: per-PO terms ──
  console.log('\nT  Each PO keeps its own Delivery Terms / Remarks / T&C');
  check('T1 PO X delivery terms + remarks are its own', PX.deliveryTerms === 'Door delivery — Xenon' && PX.remarks === 'X: call before dispatch');
  check('T2 PO Y delivery terms + remarks are its own', PY.deliveryTerms === 'Ex-works — Yarrow' && PY.remarks === 'Y: pack in crates');
  check('T3 PO X custom T&C; PO Y keeps the default (no carry-over)', PX.termsAndConditions.includes('Xenon special terms') && !PY.termsAndConditions.includes('Xenon'), PY.termsAndConditions.slice(0, 60));
  const editY = await call('BUYER', 'PATCH', `/procurement/purchase-orders/${PY._id}`, { deliveryTerms: 'FOR site — Yarrow', remarks: 'Y edited' });
  const PX2 = await poNow(PX._id);
  check('T4 editing PO Y\'s terms leaves PO X untouched', editY.status === 200 && (await poNow(PY._id)).deliveryTerms === 'FOR site — Yarrow' && PX2.deliveryTerms === 'Door delivery — Xenon' && PX2.remarks === 'X: call before dispatch', `${editY.status} ${editY.message}`);

  // ── R: partial award ──
  console.log('\nR  Partial award — remaining items stay pending');
  const ind3 = await awardedIndent(['R1', 'R2', 'R3'], [X.id, Y.id, Y.id], 'PR');
  const part = await poFor('BUYER', X.id, [line(ind3, ind3.items[0])], { saveMode: 'SUBMIT' });
  const left = (await approvedRows()).filter((r) => String(r.indentId) === String(ind3._id));
  check('R1 PO for the first item only', part.status === 201, `${part.status} ${part.message}`);
  check('R2 the other two items stay on Pending for PO with their vendor', left.length === 2 && left.every((r) => String(r.vendorId) === Y.id && r.vendorState === 'SET'), JSON.stringify(left.map((r) => r.itemName)));
  check('R3 indent PARTIAL_PO_CREATED', (await fresh(ind3._id)).overallStatus === 'PARTIAL_PO_CREATED');
  const rest = await poFor('BUYER', Y.id, left.map((r) => ({ ...line(ind3, ind3.items.find((it) => String(it._id) === String(r.indentItemId))) })), { saveMode: 'SUBMIT' });
  check('R4 the rest go on one PO for Vendor Y → indent PO_READY', rest.status === 201 && (await fresh(ind3._id)).overallStatus === 'PO_READY', `${rest.status} ${rest.message}`);

  // ── S: single vendor ──
  console.log('\nS  One vendor');
  const s1 = await awardedIndent(['S1'], [Z.id], 'S1');
  const s1po = await poFor('BUYER', Z.id, [line(s1, s1.items[0])], { saveMode: 'SUBMIT' });
  check('S1 one item, one vendor → one PO', s1po.status === 201 && await VendorPurchaseOrder.countDocuments({ indentIds: s1._id }) === 1, `${s1po.status} ${s1po.message}`);
  const s2 = await awardedIndent(['S2a', 'S2b'], [Z.id, Z.id], 'S2');
  const s2po = await poFor('BUYER', Z.id, s2.items.map((it) => line(s2, it)), { saveMode: 'SUBMIT' });
  check('S2 two items, same vendor → one PO with both lines', s2po.status === 201 && (await poNow(s2po.data?._id)).items.length === 2 && (await fresh(s2._id)).overallStatus === 'PO_READY', `${s2po.status} ${s2po.message}`);

  // ── D: draft / submit / approve ──
  console.log('\nD  Save as Draft → Submit → Approve');
  check('D1 Save as Draft → NOT_SUBMITTED, still DRAFT, no PO number', PY.submissionStatus === 'NOT_SUBMITTED' && PY.approvalStatus === 'DRAFT' && !PY.poNumber && poY.message === 'Purchase order saved as draft', `${PY.submissionStatus} ${poY.message}`);
  check('D2 Submit for Approval at create → SUBMITTED with who/when', PX.submissionStatus === 'SUBMITTED' && String(PX.submittedById) && PX.submittedBy === USERS.BUYER.name && !!PX.submittedAt && PX.approvalStatus === 'DRAFT' && !PX.poNumber);
  const apDraft = await call('MD', 'POST', `/procurement/purchase-orders/${PY._id}/approve`, { decision: 'APPROVED' });
  const rjDraft = await call('MD', 'POST', `/procurement/purchase-orders/${PY._id}/approve`, { decision: 'REJECTED' });
  check('D3 an unsubmitted draft cannot be approved or rejected (400)', apDraft.status === 400 && rjDraft.status === 400 && /not been submitted/.test(apDraft.message) && (await poNow(PY._id)).approvalStatus === 'DRAFT', `${apDraft.status}/${rjDraft.status} ${apDraft.message}`);
  const qSub = await call('BUYER', 'GET', `/procurement/purchase-orders?approvalStatus=DRAFT&submissionStatus=SUBMITTED&limit=200`);
  const qNot = await call('BUYER', 'GET', `/procurement/purchase-orders?approvalStatus=DRAFT&submissionStatus=NOT_SUBMITTED&limit=200`);
  check('D4 list filter: Y under not submitted, X under awaiting approval', qNot.data.some((p) => p._id === String(PY._id)) && !qSub.data.some((p) => p._id === String(PY._id)) && qSub.data.some((p) => p._id === String(PX._id)));
  const stats = await ok('BUYER', 'GET', '/procurement/purchase-orders/stats');
  check('D5 stats count drafts not submitted / awaiting approval', stats.notSubmitted >= 1 && stats.awaitingApproval >= 1, JSON.stringify(stats));
  const sub = await call('BUYER', 'POST', `/procurement/purchase-orders/${PY._id}/submit`);
  const PY2 = await poNow(PY._id);
  check('D6 Submit → SUBMITTED, timeline SUBMIT, still not approved', sub.status === 200 && PY2.submissionStatus === 'SUBMITTED' && PY2.activityTimeline.some((t) => t.action === 'SUBMIT') && PY2.approvalStatus === 'DRAFT' && !PY2.poNumber, `${sub.status} ${sub.message}`);
  const sub2 = await call('BUYER', 'POST', `/procurement/purchase-orders/${PY._id}/submit`);
  check('D7 submitting again is a harmless no-op (200, one SUBMIT entry)', sub2.status === 200 && (await poNow(PY._id)).activityTimeline.filter((t) => t.action === 'SUBMIT').length === 1);
  const apY = await call('MD', 'POST', `/procurement/purchase-orders/${PY._id}/approve`, { decision: 'APPROVED' });
  const PY3 = await poNow(PY._id);
  check('D8 a submitted draft is approved by the approver → final PO number', apY.status === 200 && PY3.approvalStatus === 'APPROVED' && /PO/.test(PY3.poNumber || ''), `${apY.status} ${apY.message}`);
  const subApproved = await call('BUYER', 'POST', `/procurement/purchase-orders/${PY._id}/submit`);
  check('D9 an approved PO cannot be submitted (400)', subApproved.status === 400, `${subApproved.status} ${subApproved.message}`);
  const apX = await call('MD', 'POST', `/procurement/purchase-orders/${PX._id}/approve`, { decision: 'APPROVED', remarks: 'ok' });
  check('D10 direct Submit at create → approvable straight away', apX.status === 200 && (await poNow(PX._id)).approvalStatus === 'APPROVED', `${apX.status} ${apX.message}`);
  // Save & Submit from an edit.
  const e1 = await awardedIndent(['E1'], [Z.id], 'E1');
  const eDraft = await poFor('BUYER', Z.id, [line(e1, e1.items[0])], { saveMode: 'DRAFT' });
  const eSave = await call('BUYER', 'PATCH', `/procurement/purchase-orders/${eDraft.data?._id}`, { remarks: 'still working' });
  check('D11 a plain draft edit keeps it not submitted', eSave.status === 200 && (await poNow(eDraft.data?._id)).submissionStatus === 'NOT_SUBMITTED');
  const eSub = await call('BUYER', 'PATCH', `/procurement/purchase-orders/${eDraft.data?._id}`, { remarks: 'final', submit: true });
  const E = await poNow(eDraft.data?._id);
  check('D12 Save & Submit: the edit and the submission land together', eSub.status === 200 && E.submissionStatus === 'SUBMITTED' && E.remarks === 'final' && /submitted for approval/.test(eSub.message), `${eSub.status} ${eSub.message}`);
  // Editing a submitted draft keeps it submitted.
  await call('BUYER', 'PATCH', `/procurement/purchase-orders/${E._id}`, { remarks: 'final 2' });
  check('D13 editing a submitted draft keeps it submitted', (await poNow(E._id)).submissionStatus === 'SUBMITTED');
  // API clients that send no saveMode keep the old behaviour (submitted).
  const n1 = await awardedIndent(['N1'], [Z.id], 'N1');
  const noMode = await poFor('BUYER', Z.id, [line(n1, n1.items[0])]);
  check('D14 no saveMode → submitted (unchanged for API clients), approvable', noMode.status === 201 && (await poNow(noMode.data?._id)).submissionStatus === 'SUBMITTED'
    && (await call('MD', 'POST', `/procurement/purchase-orders/${noMode.data?._id}/approve`, { decision: 'APPROVED' })).status === 200, `${noMode.status} ${noMode.message}`);
  // A PO saved before submission existed (no field) is still approvable.
  const l1 = await awardedIndent(['L1'], [Z.id], 'L1');
  const legPo = await poFor('BUYER', Z.id, [line(l1, l1.items[0])], { saveMode: 'DRAFT' });
  await VendorPurchaseOrder.updateOne({ _id: legPo.data?._id }, { $unset: { submissionStatus: '', submittedAt: '', submittedById: '', submittedBy: '' } });
  const legAp = await call('MD', 'POST', `/procurement/purchase-orders/${legPo.data?._id}/approve`, { decision: 'APPROVED' });
  check('D15 a pre-existing draft (no submission field) is approvable as before', legAp.status === 200, `${legAp.status} ${legAp.message}`);
  // MD direct save unchanged; non-MD refused.
  const m1 = await awardedIndent(['MD1'], [Z.id], 'MD1');
  const buyerDirect = await poFor('BUYER', Z.id, [line(m1, m1.items[0])], { saveMode: 'DIRECT' });
  check('D16 non-MD "Save PO Directly" still refused (403)', buyerDirect.status === 403, `${buyerDirect.status} ${buyerDirect.message}`);
  const mdDirect = await poFor('MD', Z.id, [line(m1, m1.items[0])], { saveMode: 'DIRECT' });
  check('D17 MD direct save → APPROVED with final number (unchanged)', mdDirect.status === 201 && mdDirect.data?.approvalStatus === 'APPROVED' && !!mdDirect.data?.poNumber, `${mdDirect.status} ${mdDirect.message}`);
  const badMode = await poFor('BUYER', Z.id, [line(m1, m1.items[0])], { saveMode: 'APPROVE' });
  check('D18 an unknown saveMode is refused (422)', badMode.status === 422, `${badMode.status}`);
  // Cancelled draft cannot be submitted.
  const c1 = await awardedIndent(['C1'], [Z.id], 'C1');
  const cDraft = await poFor('BUYER', Z.id, [line(c1, c1.items[0])], { saveMode: 'DRAFT' });
  await call('BUYER', 'POST', `/procurement/purchase-orders/${cDraft.data?._id}/cancel`, { reason: 'e2e' });
  const cSub = await call('BUYER', 'POST', `/procurement/purchase-orders/${cDraft.data?._id}/submit`);
  check('D19 a cancelled draft cannot be submitted (400)', cSub.status === 400, `${cSub.status} ${cSub.message}`);
  // Doer queues (fmsCatalog): unsubmitted → Create PO step; submitted → PO Approval.
  const { FMS_CATALOG } = await import('../modules/fms-doers/fmsCatalog.js');
  const step = (k) => FMS_CATALOG.PURCHASE.steps.find((s) => s.key === k);
  const idsOf = async (k) => new Set((await Promise.all(step(k).sources.filter((s) => s.entityType === 'PO').map((s) => s.find()))).flat().map((d) => String(d._id)));
  const d2 = await awardedIndent(['Q1'], [Z.id], 'DQ');
  const dq = await poFor('BUYER', Z.id, [line(d2, d2.items[0])], { saveMode: 'DRAFT' });
  const createQ = await idsOf('PO_CREATE');
  const approvalQ = await idsOf('PO_APPROVAL');
  check('D20 doer queues: unsubmitted draft on Create PO, not on PO Approval', createQ.has(String(dq.data?._id)) && !approvalQ.has(String(dq.data?._id)));
  await call('BUYER', 'POST', `/procurement/purchase-orders/${dq.data?._id}/submit`);
  check('D21 …after Submit it moves to PO Approval', (await idsOf('PO_APPROVAL')).has(String(dq.data?._id)) && !(await idsOf('PO_CREATE')).has(String(dq.data?._id)));

  // ── A: PO approval permission + maker-checker ──
  console.log('\nA  PO approval — procurement.approve + maker-checker (route AND service)');
  const freshPo = async (who, saveMode = 'SUBMIT', tag = 'A') => {
    const i = await awardedIndent([`${tag} item`], [Z.id], `${tag}${Math.random().toString(36).slice(2, 6)}`);
    const r = await poFor(who, Z.id, [line(i, i.items[0])], { saveMode });
    if (r.status !== 201) throw new Error(`PO ${r.status} ${r.message}`);
    return r.data;
  };
  const decide = (who, id, decision = 'APPROVED') => call(who, 'POST', `/procurement/purchase-orders/${id}/approve`, { decision, remarks: `${who} ${decision}` });
  const pA = await freshPo('BUYER', 'SUBMIT', 'AV');
  const vAp = await decide('VIEWER', pA._id);
  const vRj = await decide('VIEWER', pA._id, 'REJECTED');
  check('A1 a user without procurement.approve cannot approve or reject (403 at the route)', vAp.status === 403 && vRj.status === 403 && /procurement\.approve/.test(vAp.message), `${vAp.status}/${vRj.status} ${vAp.message}`);
  const bAp = await decide('BUYER', pA._id);
  check('A2 the creator without the permission is refused too (403)', bAp.status === 403, `${bAp.status} ${bAp.message}`);
  const pM = await freshPo('MAKER', 'SUBMIT', 'AM');
  const mAp = await decide('MAKER', pM._id);
  const mRj = await decide('MAKER', pM._id, 'REJECTED');
  check('A3 maker-checker: the creator WITH the permission cannot approve or reject their own PO (403)', mAp.status === 403 && mRj.status === 403 && /you prepared this PO/i.test(mAp.message), `${mAp.status}/${mRj.status} ${mAp.message}`);
  check('A4 refusals left both POs submitted drafts with no PO number', (await poNow(pA._id)).approvalStatus === 'DRAFT' && !(await poNow(pM._id)).poNumber);
  // The approver who edits a submitted draft becomes one of its makers.
  const pE = await freshPo('BUYER', 'SUBMIT', 'AE');
  await call('APPROVER', 'PATCH', `/procurement/purchase-orders/${pE._id}`, { remarks: 'approver tweaked it' });
  const eAp = await decide('APPROVER', pE._id);
  check('A5 an approver who edited the draft cannot approve it (403)', eAp.status === 403 && /you prepared this PO/i.test(eAp.message), `${eAp.status} ${eAp.message}`);
  // …nor one who submitted it.
  const pS = await freshPo('BUYER', 'DRAFT', 'AS');
  await call('APPROVER', 'POST', `/procurement/purchase-orders/${pS._id}/submit`);
  const sAp = await decide('APPROVER', pS._id);
  check('A6 an approver who submitted the draft cannot approve it (403)', sAp.status === 403, `${sAp.status} ${sAp.message}`);
  const okAp = await decide('APPROVER', pA._id);
  const pA2 = await poNow(pA._id);
  check('A7 an independent approver with procurement.approve approves → final PO number, decided by them', okAp.status === 200 && pA2.approvalStatus === 'APPROVED' && /PO/.test(pA2.poNumber || '') && String(pA2.approval.decidedById) === String((await User.findOne({ email: USERS.APPROVER.email }).lean())._id), `${okAp.status} ${okAp.message}`);
  const okRj = await decide('APPROVER', pM._id, 'REJECTED');
  check('A8 an independent approver may reject (unchanged rejection rules: no PO number)', okRj.status === 200 && (await poNow(pM._id)).approvalStatus === 'REJECTED' && !(await poNow(pM._id)).poNumber, `${okRj.status} ${okRj.message}`);
  // The MD: exempt from maker-checker (Save PO Directly is MD self-approval already).
  const pMd = await freshPo('MD', 'SUBMIT', 'AMD');
  const mdAp = await decide('MD', pMd._id);
  check('A9 the MD may approve a PO they prepared (MD rule preserved)', mdAp.status === 200 && (await poNow(pMd._id)).approvalStatus === 'APPROVED', `${mdAp.status} ${mdAp.message}`);
  const mdI = await awardedIndent(['AMD direct'], [Z.id], 'AMDD');
  const mdDirect2 = await poFor('MD', Z.id, [line(mdI, mdI.items[0])], { saveMode: 'DIRECT' });
  check('A10 MD "Save PO Directly" still creates + approves in one step', mdDirect2.status === 201 && mdDirect2.data?.approvalStatus === 'APPROVED', `${mdDirect2.status} ${mdDirect2.message}`);
  const mkDirect = await poFor('MAKER', Z.id, [line(mdI, mdI.items[0])], { saveMode: 'DIRECT' });
  check('A11 a non-MD with procurement.approve still cannot "Save PO Directly" (403)', mkDirect.status === 403, `${mkDirect.status}`);
  // Service-level: the same rules when approve() is called without the route.
  const { purchaseOrderService } = await import('../modules/procurement/purchase-order/purchaseOrder.service.js');
  const svcErr = async (who, id) => {
    const u = await User.findOne({ email: USERS[who].email }).lean();
    try { await purchaseOrderService.approve(String(id), { decision: 'APPROVED' }, u); return 'ok'; } catch (e) { return `${e.statusCode || e.status} ${e.message}`; }
  };
  const pSvc = await freshPo('MAKER', 'SUBMIT', 'ASV');
  const sv1 = await svcErr('VIEWER', pSvc._id);
  const sv2 = await svcErr('MAKER', pSvc._id);
  check('A12 service-level: no permission → refused even without the route', /^403 .*procurement\.approve/.test(sv1), sv1);
  check('A13 service-level: maker → refused even without the route', /^403 .*prepared this PO/.test(sv2), sv2);
  check('A14 service-level: an independent approver passes', (await svcErr('APPROVER', pSvc._id)) === 'ok');
  // A PO saved before submission existed (no submission fields) is still held to maker-checker.
  const pL = await freshPo('MAKER', 'SUBMIT', 'ALG');
  await VendorPurchaseOrder.updateOne({ _id: pL._id }, { $unset: { submissionStatus: '', submittedAt: '', submittedById: '', submittedBy: '' } });
  check('A15 legacy draft: its creator still cannot approve it; an independent approver can', (await decide('MAKER', pL._id)).status === 403 && (await decide('APPROVER', pL._id)).status === 200);
  const { FMS_CATALOG: CAT } = await import('../modules/fms-doers/fmsCatalog.js');
  const perm = CAT.PURCHASE.steps.find((s) => s.key === 'PO_APPROVAL').permissions[0];
  // Doer planning stays confirm-to-assign (enforced:false); approving itself is enforced (A1-A15).
  check('A16 doer step 1.4A still names procurement.approve (planning: confirm-to-assign)', perm.slug === 'procurement.approve' && perm.enforced === false);

  // ── L: legacy quotations with no vendor recorded ──
  console.log('\nL  Legacy quotations (no vendor recorded) keep working');
  // An indent quoted the pre-vendor way: Step 1.2 files with no vendor keys at all.
  const legacyIndent = async (names, tag) => {
    const i = await approvedIndent(names, tag);
    await PurchaseIndent.collection.updateOne({ _id: new mongoose.Types.ObjectId(String(i._id)) }, { $set: {
      overallStatus: 'QUOTE_RECEIVED',
      'quoteStep.status': 'RECEIVED',
      quoteComparativeStep: {
        stepNo: 'Step 1.2', stepName: 'Receive Quote & Make Comparative 1.02', statusDone: 'YES', actualAt: new Date('2026-09-01'),
        itemQuotations: i.items.map((it, k) => ({ itemId: new mongoose.Types.ObjectId(String(it._id)), itemName: it.itemName, statusDone: 'YES',
          quotationDocuments: [{ fileName: `old-${k}.pdf`, fileUrl: `https://example.invalid/e2e/povaward/${RUN}/${tag}-old-${k}.pdf`, fileType: 'application/pdf', uploadedAt: new Date('2026-09-01') }] })),
        quotationDocuments: [], vendors: [],
      },
    } });
    return fresh(i._id);
  };
  const lg = await legacyIndent(['Old A', 'Old B'], 'LG');
  const lgGet = await call('BUYER', 'GET', `/procurement/indents/${lg._id}`);
  const oldDoc = lgGet.data?.quoteComparativeStep?.itemQuotations?.[0]?.quotationDocuments?.[0];
  check('L1 a historical indent (files with no vendor fields) reads fine; files show no vendor', lgGet.status === 200 && oldDoc?.fileUrl && !oldDoc.vendorId, JSON.stringify(oldDoc));
  const resave = await quote('BUYER', lg, lg.quoteComparativeStep.itemQuotations.map((q) => q.quotationDocuments.map((d) => ({ fileName: d.fileName, fileUrl: d.fileUrl, fileType: d.fileType, uploadedAt: d.uploadedAt }))));
  check('L2 re-saving Step 1.2 with the old untagged files is accepted (no vendor forced)', resave.status === 200, `${resave.status} ${resave.message}`);
  const keepOld = (await fresh(lg._id)).quoteComparativeStep.itemQuotations.map((q) => q.quotationDocuments);
  check('L3 …the old files stay untagged and keep their original upload date', keepOld.every((ds) => ds.every((d) => !d.vendorId)) && new Date(keepOld[0][0].uploadedAt).toISOString().startsWith('2026-09-01'));
  await giveHistory(Z.id, { items: [lg.items[0]] }); await giveHistory(Y.id, { items: [lg.items[1]] });
  const lgAp = await approveQ(lg, keepOld.map((ds) => ds.map((d) => ({ fileName: d.fileName, fileUrl: d.fileUrl, fileType: d.fileType }))), [Z.id, Y.id]);
  check('L4 Step 1.3 on legacy quotations: a vendor with purchase history', lgAp.status === 200, `${lgAp.status} ${lgAp.message}`);
  const lgInactive = await legacyIndent(['Old C'], 'LGI');
  await giveHistory(W.id, lgInactive);
  const lgW = await approveQ(lgInactive, [lgInactive.quoteComparativeStep.itemQuotations[0].quotationDocuments], [W.id]);
  check('L5 …but still only ACTIVE Vendor-Master vendors (inactive refused, 400)', lgW.status === 400 && /inactive/.test(lgW.message), `${lgW.status} ${lgW.message}`);
  const lgRows = (await approvedRows()).filter((r) => String(r.indentId) === String(lg._id));
  check('L6 Pending for PO: legacy items carry their vendor, quotedVendors empty', lgRows.length === 2 && lgRows.every((r) => r.vendorState === 'SET' && r.quotedVendors.length === 0 && r.quotedRate === null));
  const lgPo = await poFor('BUYER', Z.id, [line(lg, lg.items[0])], { saveMode: 'SUBMIT' });
  check('L7 a PO from a legacy approval is created and approved as usual', lgPo.status === 201 && (await decide('APPROVER', lgPo.data?._id)).status === 200, `${lgPo.status} ${lgPo.message}`);
  // Mixed: an old untagged file plus a new tagged one → only the tagged vendor counts.
  const mx = await legacyIndent(['Mixed'], 'LMX');
  const old = mx.quoteComparativeStep.itemQuotations[0].quotationDocuments[0];
  const oldF = { fileName: old.fileName, fileUrl: old.fileUrl, fileType: old.fileType, uploadedAt: old.uploadedAt };
  const newF = file('mx-new-x', X.id, 80, 4);
  check('L8 adding a vendor-tagged quotation next to an old one is accepted', (await quote('BUYER', mx, [[oldF, newF]])).status === 200);
  const mxZ = await approveQ(mx, [[oldF, newF]], [Z.id]);
  const mxX = await approveQ(mx, [[oldF, newF]], [X.id]);
  check('L9 mixed: a vendor with neither a quote nor history is refused (Z), the quoted vendor is accepted (X)', mxZ.status === 400 && /neither quoted for nor previously supplied/.test(mxZ.message) && mxX.status === 200, `${mxZ.status} ${mxZ.message} / ${mxX.status}`);
  // Pre item-wise record: one flat quotation file on a single-item indent.
  const fl = await approvedIndent(['Flat'], 'LFL');
  await PurchaseIndent.collection.updateOne({ _id: new mongoose.Types.ObjectId(String(fl._id)) }, { $set: {
    overallStatus: 'QUOTE_RECEIVED', 'quoteStep.status': 'RECEIVED',
    quoteComparativeStep: { statusDone: 'YES', quotationDocuments: [{ fileName: 'flat.pdf', fileUrl: `https://example.invalid/e2e/povaward/${RUN}/flat.pdf`, fileType: 'application/pdf' }], itemQuotations: [], vendors: [] },
  } });
  await giveHistory(Y.id, fl);
  const flAp = await approveQ(await fresh(fl._id), [[{ fileName: 'flat.pdf', fileUrl: `https://example.invalid/e2e/povaward/${RUN}/flat.pdf`, fileType: 'application/pdf' }]], [Y.id]);
  check('L10 pre item-wise (flat) quotation: approved for a vendor with purchase history', flAp.status === 200, `${flAp.status} ${flAp.message}`);

  // ── F: downstream unchanged ──
  console.log('\nF  Downstream: release → follow-up → PI → advance → GRN + QC');
  const rel = await call('BUYER', 'POST', `/procurement/purchase-orders/${PX._id}/release`, { sendEmail: false });
  const PXr = await poNow(PX._id);
  check('F1 approved PO X releases; follow-up opens', rel.status === 200 && PXr.poStatus === 'RELEASED_TO_VENDOR' && PXr.followUpStatus === 'PENDING', `${rel.status} ${rel.message}`);
  const pi = await call('BUYER', 'POST', '/procurement/proforma-invoices', { poId: String(PX._id), piDocument: { fileName: 'pi.pdf', fileUrl: `https://example.invalid/e2e/povaward/${RUN}/pi.pdf`, fileType: 'application/pdf' } });
  check('F2 PI created from the PO', pi.status === 201, `${pi.status} ${pi.message}`);
  const piAp = await call('MD', 'POST', `/procurement/proforma-invoices/${pi.data?._id}/approve`, {});
  check('F3 PI approved', piAp.status === 200, `${piAp.status} ${piAp.message}`);
  // The MD's PI sign-off, stood in the way the other fixtures do (MD approval mirror).
  await ProformaInvoice.updateOne({ _id: pi.data?._id }, { $set: { mdApprovalStatus: 'MD_APPROVED' } });
  const fu = await call('BUYER', 'POST', '/procurement/follow-ups', { poId: String(PX._id), followUpType: 'CALL', remarks: 'award e2e' });
  await call('BUYER', 'POST', `/procurement/follow-ups/${fu.data?._id}/mark-done`, { remarks: 'vendor confirmed dispatch' });
  const fuReady = await call('BUYER', 'POST', `/procurement/follow-ups/${fu.data?._id}/mark-ready-for-grn`, { finalMaterialDate: new Date().toISOString(), remarks: 'material ready' });
  check('F3b follow-up created and marked Ready for GRN', fu.status === 201 && fuReady.status === 200 && (await poNow(PX._id)).followUpStatus === 'READY_FOR_GRN', `${fu.status}/${fuReady.status} ${fuReady.message || fu.message}`);
  const adv = await call('BUYER', 'POST', '/procurement/advance-payments', {
    piId: pi.data?._id, paymentStatus: 'PART_PAYMENT', paymentDate: new Date().toISOString(), paidAmount: 50, paymentMode: 'NEFT', paymentReferenceNumber: `UTR-${RUN}`,
  });
  check('F4 advance payment recorded against the PI', adv.status === 201, `${adv.status} ${adv.message}`);
  const lines = PXr.items.map((p) => ({ poItemId: String(p._id), poId: String(PX._id), poNumber: PXr.poNumber, itemName: p.itemName, skuCode: p.skuCode, skuId: String(p.skuId), unit: p.unit, invoiceQty: p.quantity, receivedQty: p.quantity, rate: p.rate }));
  const qcs = [{ checkedByName: 'QC E2E', preparedBy: 'Store E2E', items: PXr.items.map((p) => ({ lineKey: String(p._id), poItemId: String(p._id), itemName: p.itemName, receivedQty: p.quantity, acceptedQty: p.quantity, rejectedQty: 0 })) }];
  const grn = await call('BUYER', 'POST', '/procurement/grns/save-with-qc', { complete: true, grn: { poIds: [String(PX._id)], grnDate: new Date().toISOString().slice(0, 10), challanNumber: `CH-${RUN}`, items: lines }, qcs });
  const g = grn.data?.grn;
  check('F5 GRN + QC saved and completed in one go', grn.status === 201 && g?.grnStatus === 'FULLY_RECEIVED', `${grn.status} ${grn.message}`);
  const posted = (await InventoryMovement.find({ refType: 'GRN', refId: g?._id, txnType: 'GRN_IN' }).lean()).reduce((t, m) => t + m.quantity, 0);
  const want = PXr.items.reduce((t, p) => t + p.quantity, 0);
  check(`F6 accepted stock posted (${want}) and the QC recorded`, posted === want && await IncomingQC.countDocuments({ grnId: g?._id }) === 1, `posted ${posted}`);
  check('F7 PO X fully received', (await poNow(PX._id)).poStatus === 'FULLY_RECEIVED');

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
};

// ── Browser probe data: an indent quoted by two vendors, awaiting Step 1.3 ──
const prepUi = async () => {
  await connect();
  await login();
  const [X, Y, Z] = (await Promise.all(VENDORS.slice(0, 3).map((v) => Vendor.findOne({ code: v.code }).lean()))).map((v) => ({ id: String(v._id), name: v.name }));
  // 1. For Step 1.2 in the UI: approved indent, quotation not yet recorded.
  const q12 = await approvedIndent(['UI Bolt', 'UI Nut'], 'UI12');
  // 2. For Step 1.3 in the UI: items quoted by X/Z and Y/X.
  const q13 = await approvedIndent(['UI Gear', 'UI Shaft', 'UI Bush'], 'UI13');
  await quote('BUYER', q13, [
    [file('ui-gear-x', X.id, 100, 7), file('ui-gear-z', Z.id, 120, 3)],
    [file('ui-shaft-y', Y.id, 50, 10), file('ui-shaft-x', X.id, 55, 6)],
    [file('ui-bush-x', X.id, 30, 5)],
  ]);
  // Zinc never quoted for UI Bush but supplied it before → eligible through purchase history (the union rule).
  await giveHistory(Z.id, { items: [q13.items[2]] });
  // 3. Maker-checker: a PO prepared + submitted by the MAKER (who holds procurement.approve).
  const mk = await awardedIndent(['UI Maker Item'], [Z.id], 'UIMK');
  const makerPo = await ok('MAKER', 'POST', '/procurement/purchase-orders/create-from-items', {
    vendorId: Z.id, expectedDeliveryDate: new Date(Date.now() + 7 * 864e5).toISOString(), saveMode: 'SUBMIT', items: [line(mk, mk.items[0])],
  });
  // 4. Legacy quotations (no vendor recorded): one awaiting Step 1.3, one for a Step 1.2 edit.
  const legacy = async (names, tag) => {
    const i = await approvedIndent(names, tag);
    await PurchaseIndent.collection.updateOne({ _id: new mongoose.Types.ObjectId(String(i._id)) }, { $set: {
      overallStatus: 'QUOTE_RECEIVED', 'quoteStep.status': 'RECEIVED',
      quoteComparativeStep: {
        stepNo: 'Step 1.2', statusDone: 'YES', actualAt: new Date('2026-09-01'), quotationDocuments: [], vendors: [],
        itemQuotations: i.items.map((it, k) => ({ itemId: new mongoose.Types.ObjectId(String(it._id)), itemName: it.itemName, statusDone: 'YES',
          quotationDocuments: [{ fileName: `old-quote-${k}.pdf`, fileUrl: `https://example.invalid/e2e/povaward/${RUN}/${tag}-${k}.pdf`, fileType: 'application/pdf', uploadedAt: new Date('2026-09-01') }] })),
      },
    } });
    return i;
  };
  const leg13 = await legacy(['UI Legacy Pin'], 'UIL13');
  const leg12 = await legacy(['UI Legacy Clip'], 'UIL12');
  const manifest = {
    run: RUN, password: PASSWORD, buyer: USERS.BUYER.email, md: USERS.MD.email,
    approver: USERS.APPROVER.email, maker: USERS.MAKER.email, viewer: USERS.VIEWER.email,
    makerPo: { _id: String(makerPo._id), draftNumber: makerPo.draftNumber },
    legacy13Indent: { _id: String(leg13._id), indentNumber: leg13.indentNumber },
    legacy12Indent: { _id: String(leg12._id), indentNumber: leg12.indentNumber },
    vendors: { X, Y, Z },
    step12Indent: { _id: String(q12._id), indentNumber: q12.indentNumber },
    step13Indent: { _id: String(q13._id), indentNumber: q13.indentNumber, items: q13.items.map((it) => it.itemName) },
  };
  const out = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../frontend/e2e/shots/po-vendor-award-manifest.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`[prep-ui] wrote ${out}`);
};

if (isEntry(import.meta.url)) {
  const mode = process.argv[2];
  try {
    if (mode === '--seed') await seed();
    else if (mode === '--api') await api();
    else if (mode === '--prep-ui') await prepUi();
    else { console.log('usage: --seed | --api | --prep-ui'); process.exitCode = 2; }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
