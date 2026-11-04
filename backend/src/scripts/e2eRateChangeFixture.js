/**
 * API oracle for PO Rate Change Approvals (procurement/rate-change).
 *
 *   node src/scripts/e2eRateChangeFixture.js --seed      upsert users, SKUs, vendors (never drops)
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5096 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_ratechange node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5096/api/v1 node src/scripts/e2eRateChangeFixture.js --api
 *   API=... node src/scripts/e2eRateChangeFixture.js --prep-ui   data for the browser probe
 *   API=... node src/scripts/e2eRateChangeFixture.js --prep-test-only   TEST ONLY vendor/SKU (100) + 4 indents
 *            for frontend/e2e/purchaseApproval.e2e.mjs (Purchase Approval sidebar walkthrough)
 *   API=... node src/scripts/e2eRateChangeFixture.js --atomic   approvals with a write made to fail part-way
 *            (in-process); run on :27017 and on a replica set (E2E_RC_URI) for both rollback paths
 *
 * --seed RESETS the seeded vendors' catalog rates (V1 SKU-A 100, V2 SKU-A 120,
 * V1 BOX 250/BOX) so --api can run again; requests/POs/history from earlier runs
 * stay (history is append-only by design) and every run makes fresh indents.
 *
 * Users (E2e@12345): MD (roles MD), BUYER (PLANNER — the doer), APPROVER
 * (PLANNER + procurement.approveRateChange), POAPPROVER (PLANNER +
 * procurement.approve), VIEWER (PLANNER, no grant).
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard
 * (S3 + email off). Never reads MONGO_URI. Nothing here drops or resets a DB.
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import SKU from '../modules/skus/sku.model.js';
import PricingHistory from '../modules/vendors/pricingHistory.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import RateChangeRequest from '../modules/procurement/rate-change/rateChange.model.js';
import RateChangeHistory from '../modules/procurement/rate-change/rateChangeHistory.model.js';
import Notification from '../modules/notifications/notification.model.js';

export const DB_NAME = 'ambika_e2e_ratechange';
export const E2E_URI = process.env.E2E_RC_URI || `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eRateChangeFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5096/api/v1').replace(/\/+$/, '');
const PASSWORD = 'E2e@12345';
export const USERS = {
  MD:         { email: 'ratechange-md@test.local',       name: 'E2E Rate MD',         role: 'MD', roles: ['MD'],      grants: [], mobile: '9000000091' },
  BUYER:      { email: 'ratechange-buyer@test.local',    name: 'E2E Rate Buyer',      role: 'EA', roles: ['PLANNER'], grants: [], mobile: '9000000092' },
  APPROVER:   { email: 'ratechange-approver@test.local', name: 'E2E Rate Approver',   role: 'EA', roles: ['PLANNER'], grants: ['procurement.approveRateChange'], mobile: '9000000093' },
  POAPPROVER: { email: 'ratechange-poappr@test.local',   name: 'E2E PO Approver',     role: 'EA', roles: ['PLANNER'], grants: ['procurement.approve'], mobile: '9000000094' },
  VIEWER:     { email: 'ratechange-viewer@test.local',   name: 'E2E Rate Viewer',     role: 'EA', roles: ['PLANNER'], grants: [], mobile: '9000000095' },
};
export const SKUS = {
  A:   { code: 'RC-SKU-A',   name: 'RC Hex Bolt M10',   unit: 'PCS' },
  BOX: { code: 'RC-SKU-BOX', name: 'RC Nitrile Gloves', unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: 25 },
  NEW: { code: 'RC-SKU-NEW', name: 'RC Cable Tie 200mm', unit: 'PCS' },
  B:   { code: 'RC-SKU-B',   name: 'RC Washer M10',     unit: 'PCS' },
};
export const VENDORS = {
  V1: { code: 'RC-V1', name: 'RC Alpha Fasteners' },
  V2: { code: 'RC-V2', name: 'RC Beta Industrial' },
};
// The Purchase Approval walkthrough's own vendor + SKU, kept apart from the
// RC-* data so it can never move a rate --api depends on.
export const TEST_ONLY = {
  vendor: { code: 'TEST-RC-VENDOR', name: 'TEST ONLY Rate Approval Vendor' },
  sku: { code: 'TEST-RC-SKU', name: 'TEST ONLY Rate Approval Item', unit: 'PCS' },
  rate: 100,
  reason: 'TEST ONLY — rate change approval verification',
};
const RUN = Date.now().toString(36);
const PO = '/procurement/purchase-orders';
const RC = '/procurement/rate-changes';

let failures = 0;
let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${String(detail).slice(0, 500)}` : ''}`);
};

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

const upsertSku = (s) => SKU.findOneAndUpdate(
  { code: s.code },
  { $set: { name: s.name, unit: s.unit, itemType: 'CONSUMABLE', isActive: true, isDeleted: false,
    ...(s.purchaseUnit ? { purchaseUnit: s.purchaseUnit, purchaseConversionFactor: s.purchaseConversionFactor } : {}) } },
  { upsert: true, new: true },
).lean();

// ── Seed (idempotent upserts — never drops) ────────────────────────────────
const seed = async () => {
  await connect();
  for (const u of Object.values(USERS)) {
    const { role, roles, grants, ...rest } = u;
    if (!await User.findOne({ email: u.email })) {
      await User.create({ ...rest, password: PASSWORD, role, roles, permissionGrants: grants, isActive: true });
    }
    await User.updateOne({ email: u.email }, { $set: { role, roles, permissionGrants: grants, permissionDenies: [], isActive: true } });
  }
  const sku = {};
  for (const [k, s] of Object.entries(SKUS)) sku[k] = await upsertSku(s);
  const row = (s, unit, rate, gstRate = 18) => ({ skuId: s._id, skuCode: s.code, productName: s.name, unit, rate, gstRate });
  await Vendor.updateOne({ code: VENDORS.V1.code }, { $set: {
    name: VENDORS.V1.name, isActive: true, isDeleted: false, creditPeriodDays: 30,
    products: [row(sku.A, 'Pcs', 100), row(sku.BOX, 'BOX', 250, 12), row(sku.B, 'Pcs', 8)],
  } }, { upsert: true });
  await Vendor.updateOne({ code: VENDORS.V2.code }, { $set: {
    name: VENDORS.V2.name, isActive: true, isDeleted: false, creditPeriodDays: 15,
    products: [row(sku.A, 'Pcs', 120)],
  } }, { upsert: true });
  console.log(`[seed] ${DB_NAME}: users ${Object.values(USERS).map((u) => u.email).join(', ')} / ${PASSWORD}`);
  console.log(`[seed] ${VENDORS.V1.name}: ${SKUS.A.code} 100/Pcs, ${SKUS.BOX.code} 250/BOX, ${SKUS.B.code} 8/Pcs · ${VENDORS.V2.name}: ${SKUS.A.code} 120/Pcs`);
};

// ── HTTP helpers ───────────────────────────────────────────────────────────
const tokens = {};
const call = async (who, method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(who && tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data: json?.data, message: json?.message || '' };
};
const ok = async (who, method, p, body) => {
  const r = await call(who, method, p, body);
  if (r.status >= 400) throw new Error(`${method} ${p} → ${r.status} ${r.message}`);
  return r.data;
};
const login = async () => {
  for (const [key, u] of Object.entries(USERS)) {
    const r = await call(null, 'POST', '/auth/login', { email: u.email, password: PASSWORD });
    tokens[key] = r.data?.token || '';
    if (!tokens[key]) throw new Error(`login ${u.email} failed: ${r.status} ${r.message} — run --seed first`);
  }
};

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const DATES = { poDate: localToday(), expectedDeliveryDate: plusDays(localToday(), 7) };

// A PO-ready indent (quotation not required) whose items are fixed to `vendorId`.
let seq = 0;
const readyIndent = async (label, skuKeys, vendorId) => {
  const skus = await Promise.all(skuKeys.map((k) => SKU.findOne({ code: (k === 'TEST' ? TEST_ONLY.sku : SKUS[k]).code }).lean()));
  const ind = await ok('BUYER', 'POST', '/procurement/indents', {
    department: 'Stores', remarks: `rate-change e2e ${RUN} ${label}`,
    items: skus.map((s) => { seq += 1; return { skuId: String(s._id), skuCode: s.code, itemName: s.name, quantity: 4 + (seq % 3), unit: s.purchaseUnit || s.unit }; }),
  });
  await ok('BUYER', 'POST', `/procurement/indents/${ind._id}/submit`, {});
  const approved = await ok('MD', 'POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
  await ok('BUYER', 'POST', `/procurement/indents/${ind._id}/quote-comparative`, {
    statusDone: 'QUOTE_NOT_REQUIRED',
    itemQuotations: approved.items.map((it) => ({ itemId: it._id, itemName: it.itemName, statusDone: 'QUOTE_NOT_REQUIRED', quotationDocuments: [] })),
  });
  if (vendorId) {
    for (const it of approved.items) {
      await ok('BUYER', 'PATCH', `${PO}/approved-items/vendor`, { indentId: ind._id, indentItemId: it._id, vendorId: String(vendorId) });
    }
  }
  return PurchaseIndent.findById(ind._id).lean();
};
// One PO line per indent item; `over(it, i)` overrides rate / reason / unit / gst.
const poLines = (indent, over = () => ({})) => indent.items.map((it, i) => ({
  indentId: indent._id, indentItemId: it._id, itemName: it.itemName, skuCode: it.skuCode, skuId: it.skuId,
  quantity: it.approvedQuantity || it.quantity, unit: it.unit, rate: 100, gstRate: 18, ...over(it, i),
}));
const createPo = (who, indent, vendorId, over, extra = {}) => call(who, 'POST', `${PO}/create-from-items`, {
  poFormatType: 'OTHER', vendorId: String(vendorId), items: poLines(indent, over), ...DATES, ...extra,
});
const poNow = (id) => VendorPurchaseOrder.findById(id).lean();
const vendorRow = async (vendorId, skuCode, unit) => {
  const v = await Vendor.findById(vendorId).lean();
  return (v.products || []).find((p) => p.skuCode === skuCode && (!unit || p.unit === unit));
};
const reqsOf = (poId) => RateChangeRequest.find({ poId }).sort({ requestedAt: 1, _id: 1 }).lean();
const eventsOf = (requestId) => RateChangeHistory.find({ requestId }).sort({ at: 1, _id: 1 }).lean();
const round2 = (n) => Math.round(n * 100) / 100;
const poEdit = (who, po, over) => call(who, 'PATCH', `${PO}/${po._id}`, {
  items: po.items.map((l, i) => ({
    indentId: l.indentId, indentItemId: l.indentItemId, itemName: l.itemName, skuCode: l.skuCode, skuId: l.skuId,
    quantity: l.quantity, unit: l.unit, rate: l.rate, gstRate: l.gstRate, ...over(l, i),
  })),
});
const approvePo = (who, id) => call(who, 'POST', `${PO}/${id}/approve`, { decision: 'APPROVED', remarks: 'e2e' });

// ── API checks ─────────────────────────────────────────────────────────────
const api = async () => {
  await connect();
  await login();
  const v1 = await Vendor.findOne({ code: VENDORS.V1.code }).lean();
  const v2 = await Vendor.findOne({ code: VENDORS.V2.code }).lean();
  const users = Object.fromEntries(await Promise.all(Object.entries(USERS).map(async ([k, u]) => [k, await User.findOne({ email: u.email }).lean()])));
  const V1 = String(v1._id);
  const V2 = String(v2._id);
  const A = SKUS.A.code;
  if ((await vendorRow(V1, A)).rate !== 100) throw new Error('Run --seed first (V1 SKU-A must start at 100)');
  console.log(`run ${RUN} against ${API}`);

  // ── F: fetching the vendor rate ──
  console.log('\nF  Fetching the authoritative vendor rate');
  let vr = await ok('BUYER', 'GET', `${RC}/vendor-rate?vendorId=${V1}&skuCode=${A}&unit=PCS`);
  check('F1 V1 + SKU-A fetches 100 from the Vendor Master', vr.found && vr.rate === 100, JSON.stringify(vr));
  vr = await ok('BUYER', 'GET', `${RC}/vendor-rate?vendorId=${V2}&skuCode=${A}&unit=Nos`);
  check('F2 the same SKU at V2 fetches V2\'s own 120 (Pcs = Nos)', vr.found && vr.rate === 120, JSON.stringify(vr));
  vr = await ok('BUYER', 'GET', `${RC}/vendor-rate?vendorId=${V1}&skuCode=${SKUS.BOX.code}&unit=BOX`);
  check('F3 a BOX-priced SKU fetches its BOX rate (250)', vr.found && vr.rate === 250 && vr.unit === 'BOX', JSON.stringify(vr));
  vr = await ok('BUYER', 'GET', `${RC}/vendor-rate?vendorId=${V1}&skuCode=${SKUS.NEW.code}`);
  check('F4 an item the vendor has no rate for → not found', vr.found === false && vr.problem === 'NONE', JSON.stringify(vr));

  // ── N: no change ──
  console.log('\nN  PO at the vendor rate — normal workflow');
  let ind = await readyIndent('N1', ['A'], V1);
  let r = await createPo('BUYER', ind, V1, () => ({ rate: 100 }));
  const poN = r.data;
  check('N1 create at the fetched rate → 201', r.status === 201, `${r.status} ${r.message}`);
  let po = await poNow(poN._id);
  check('N2 no rate change request; line fetchedRate 100, no status', (await reqsOf(poN._id)).length === 0
    && po.items[0].fetchedRate === 100 && po.items[0].rateChangeStatus === '', JSON.stringify(po.items[0]));
  const phBefore = await PricingHistory.countDocuments({ vendorId: V1 });
  r = await approvePo('POAPPROVER', poN._id);
  check('N3 the PO approves normally', r.status === 200 && r.data.approvalStatus === 'APPROVED', `${r.status} ${r.message}`);
  check('N4 vendor rate and pricing history untouched', (await vendorRow(V1, A)).rate === 100 && await PricingHistory.countDocuments({ vendorId: V1 }) === phBefore);
  const approvedPoN = await poNow(poN._id);

  // ── R: submitting a changed rate ──
  console.log('\nR  Changed rate → approval request');
  ind = await readyIndent('R1', ['A'], V1);
  const poCount = await VendorPurchaseOrder.countDocuments({});
  r = await createPo('BUYER', ind, V1, () => ({ rate: 112.5 }));
  check('R1 a changed rate without a reason is refused (400) and names the rates', r.status === 400 && /reason/i.test(r.message) && /100/.test(r.message) && /112\.5/.test(r.message), `${r.status} ${r.message}`);
  check('R2 the refusal saved nothing', await VendorPurchaseOrder.countDocuments({}) === poCount);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 112.5, rateChangeReason: 'Steel price rise from 1 Nov' }));
  const poR = r.data;
  check('R3 with a reason → 201 (draft keeps the proposed rate)', r.status === 201 && poR.items[0].rate === 112.5, `${r.status} ${r.message}`);
  const [reqR] = await reqsOf(poR._id);
  check('R4 one PENDING request with vendor/SKU/rates/refs/requester/reason', reqR && reqR.status === 'PENDING'
    && String(reqR.vendorId) === V1 && reqR.skuCode === A && reqR.existingVendorRate === 100 && reqR.originalPoRate === 100
    && reqR.requestedRate === 112.5 && reqR.poRef === poR.draftNumber && reqR.indentNumber === ind.indentNumber
    && String(reqR.indentItemId) === String(ind.items[0]._id) && String(reqR.requestedBy) === String(users.BUYER._id)
    && reqR.reason === 'Steel price rise from 1 Nov' && /^RC-\d{3,}\//.test(reqR.requestNumber) && reqR.quotationPath === 'NOT_REQUIRED', JSON.stringify(reqR));
  po = await poNow(poR._id);
  const q = po.items[0].quantity;
  check('R5 PO line stamped PENDING + totals recalculated at the proposed rate', po.items[0].rateChangeStatus === 'PENDING'
    && po.items[0].rateChangeRequestNumber === reqR.requestNumber && po.items[0].fetchedRate === 100
    && po.totalTaxableValue === round2(q * 112.5) && po.grandTotal === round2(q * 112.5 * 1.18), JSON.stringify({ q, t: po.totalTaxableValue, g: po.grandTotal }));
  check('R6 vendor rate unchanged while pending', (await vendorRow(V1, A)).rate === 100);
  r = await approvePo('POAPPROVER', poR._id);
  check('R7 the PO cannot be approved while the rate change is pending', r.status === 400 && r.message.includes(reqR.requestNumber), `${r.status} ${r.message}`);
  check('R8 …and stays a draft', (await poNow(poR._id)).approvalStatus === 'DRAFT');
  const evR = await eventsOf(reqR._id);
  check('R9 history: REQUESTED by the buyer', evR.length === 1 && evR[0].event === 'REQUESTED' && evR[0].previousRate === 100 && evR[0].newRate === 112.5 && evR[0].actorName === USERS.BUYER.name);
  const notes = await Notification.find({ userId: users.APPROVER._id, title: new RegExp(reqR.requestNumber.replace(/[/]/g, '.')) }).lean();
  check('R10 approvers notified (in-app)', notes.length >= 1 && notes[0].link === '/purchase-fms/rate-change-approvals', JSON.stringify(notes));
  check('R11 the requester is not notified of their own request', !await Notification.exists({ userId: users.BUYER._id, title: new RegExp(`${reqR.requestNumber.replace(/[/]/g, '.')} awaits`) }));

  // ── P: permissions ──
  console.log('\nP  Permissions');
  r = await call('VIEWER', 'POST', `${RC}/${reqR._id}/approve`, {});
  check('P1 a user without the permission cannot approve (403)', r.status === 403, `${r.status} ${r.message}`);
  r = await call('BUYER', 'POST', `${RC}/${reqR._id}/approve`, {});
  check('P2 the requester (no permission) cannot approve (403)', r.status === 403, `${r.status} ${r.message}`);
  r = await call('VIEWER', 'POST', `${RC}/${reqR._id}/reject`, { reason: 'no' });
  check('P3 …nor reject (403)', r.status === 403, `${r.status} ${r.message}`);
  let list = await ok('VIEWER', 'GET', `${RC}?status=PENDING`);
  check('P4 anyone signed in can read the list; canApprove false for the viewer', list.canApprove === false && list.rows.some((x) => x._id === String(reqR._id)));
  list = await ok('APPROVER', 'GET', `${RC}?status=PENDING&vendorId=${V1}`);
  check('P5 canApprove true for a rate approver; vendor filter works', list.canApprove === true && list.rows.every((x) => x.vendorId === V1));
  // The approver raises their own change → cannot approve it.
  ind = await readyIndent('P6', ['A'], V1);
  r = await createPo('APPROVER', ind, V1, () => ({ rate: 101, rateChangeReason: 'Own change' }));
  const [ownReq] = await reqsOf(r.data._id);
  r = await call('APPROVER', 'POST', `${RC}/${ownReq._id}/approve`, {});
  check('P6 an approver cannot approve their own rate change (403)', r.status === 403 && /another approver/.test(r.message), `${r.status} ${r.message}`);
  const detailOwn = await ok('APPROVER', 'GET', `${RC}/${ownReq._id}`);
  check('P7 detail tells the approver why (approveBlock)', /another approver/.test(detailOwn.approveBlock));
  r = await call('POAPPROVER', 'POST', `${RC}/${ownReq._id}/reject`, { reason: 'Not agreed with vendor' });
  check('P8 procurement.approve holders may decide rate changes too (reject 200)', r.status === 200, `${r.status} ${r.message}`);
  const ownPoAfter = await poNow(ownReq.poId);
  check('P9 rejected → vendor rate untouched, draft line back at 100', (await vendorRow(V1, A)).rate === 100
    && ownPoAfter.items[0].rate === 100 && ownPoAfter.items[0].rateChangeStatus === 'REJECTED', JSON.stringify(ownPoAfter.items[0]));

  // ── J: rejection rules ──
  console.log('\nJ  Rejection');
  r = await call('APPROVER', 'POST', `${RC}/${reqR._id}/reject`, {});
  check('J1 reject without a reason refused (422)', r.status === 422, `${r.status} ${r.message}`);
  r = await call('APPROVER', 'POST', `${RC}/${reqR._id}/reject`, { reason: ' x ' });
  check('J2 a 1-character reason refused (422)', r.status === 422, `${r.status} ${r.message}`);
  check('J3 still pending after the refusals', (await RateChangeRequest.findById(reqR._id).lean()).status === 'PENDING');

  // ── A: approval ──
  console.log('\nA  Approval updates the PO line and the vendor rate together');
  r = await call('APPROVER', 'POST', `${RC}/${reqR._id}/approve`, { remarks: 'Agreed with vendor', expectedVendorRate: 100 });
  check('A1 approve → 200', r.status === 200 && r.data.status === 'APPROVED', `${r.status} ${r.message}`);
  const row = await vendorRow(V1, A);
  check('A2 V1 SKU-A is now 112.5 (stamped by the approver)', row.rate === 112.5 && String(row.lastUpdatedBy) === String(users.APPROVER._id));
  check('A3 V2 SKU-A untouched (120) — vendors keep their own rates', (await vendorRow(V2, A)).rate === 120);
  po = await poNow(poR._id);
  check('A4 PO line APPROVED at 112.5, fetchedRate 112.5, totals consistent', po.items[0].rate === 112.5 && po.items[0].rateChangeStatus === 'APPROVED'
    && po.items[0].fetchedRate === 112.5 && po.totalTaxableValue === round2(q * 112.5) && po.activityTimeline.some((t) => t.action === 'RATE_CHANGE_APPROVED'));
  const reqRA = await RateChangeRequest.findById(reqR._id).lean();
  check('A5 request records approver, time, source before/after', reqRA.decidedByName === USERS.APPROVER.name && reqRA.decidedAt
    && reqRA.vendorSourceBefore.rate === 100 && reqRA.vendorSourceAfter.rate === 112.5 && reqRA.decisionRemarks === 'Agreed with vendor');
  const ph = await PricingHistory.findOne({ vendorId: V1, source: 'RATE_CHANGE_APPROVAL', referenceId: poR._id }).lean();
  check('A6 vendor pricing history row (100 → 112.5, RATE_CHANGE_APPROVAL)', ph && ph.oldRate === 100 && ph.newRate === 112.5 && ph.referenceNumber === poR.draftNumber, JSON.stringify(ph));
  r = await call('APPROVER', 'POST', `${RC}/${reqR._id}/approve`, {});
  check('A7 a replayed approval is refused (409), nothing applied twice', r.status === 409 && (await eventsOf(reqR._id)).filter((e) => e.event === 'APPROVED').length === 1
    && await PricingHistory.countDocuments({ vendorId: V1, source: 'RATE_CHANGE_APPROVAL', referenceId: poR._id }) === 1, `${r.status} ${r.message}`);
  r = await call('APPROVER', 'POST', `${RC}/${reqR._id}/reject`, { reason: 'Too late' });
  check('A8 a decided request cannot be rejected afterwards (409)', r.status === 409, `${r.status} ${r.message}`);
  r = await approvePo('POAPPROVER', poR._id);
  check('A9 the PO now approves', r.status === 200 && r.data.approvalStatus === 'APPROVED', `${r.status} ${r.message}`);
  check('A10 PO approval did not touch the vendor rate again', (await vendorRow(V1, A)).rate === 112.5
    && await PricingHistory.countDocuments({ vendorId: V1, referenceId: poR._id, source: 'PURCHASE_ORDER', newRate: { $ne: 112.5 } }) === 0);
  check('A11 an earlier approved PO keeps its own rate (100)', (await poNow(poN._id)).items[0].rate === approvedPoN.items[0].rate);

  // ── U: future POs ──
  console.log('\nU  Future POs fetch the approved rate');
  vr = await ok('BUYER', 'GET', `${RC}/vendor-rate?vendorId=${V1}&skuCode=${A}&unit=PCS`);
  check('U1 V1 SKU-A now fetches 112.5', vr.rate === 112.5);
  ind = await readyIndent('U2', ['A'], V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 112.5 }));
  check('U2 a new PO at 112.5 needs no approval', r.status === 201 && (await reqsOf(r.data._id)).length === 0, `${r.status} ${r.message}`);
  r = await createPo('BUYER', await readyIndent('U3', ['A'], V1), V1, () => ({ rate: 100 }));
  check('U3 the OLD rate is now a change that needs a reason', r.status === 400 && /reason/.test(r.message), `${r.status} ${r.message}`);
  const detailA = await ok('APPROVER', 'GET', `${RC}/${reqR._id}`);
  check('U4 detail lists later POs that used the approved rate', detailA.laterPos.length >= 1, JSON.stringify(detailA.laterPos));
  check('U5 detail shows the same SKU at other vendors (V2 120)', detailA.otherVendors.some((o) => o.vendorName === VENDORS.V2.name && o.rate === 120));

  // ── K: reject then resubmit ──
  console.log('\nK  Rejection keeps the vendor rate; a new request can follow');
  ind = await readyIndent('K1', ['A'], V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 130, rateChangeReason: 'Urgent air freight' }));
  const poK = r.data;
  const [reqK] = await reqsOf(poK._id);
  r = await call('APPROVER', 'POST', `${RC}/${reqK._id}/reject`, { reason: 'Use the contracted rate' });
  check('K1 reject with a reason → 200', r.status === 200 && r.data.status === 'REJECTED', `${r.status} ${r.message}`);
  check('K2 vendor rate unchanged (112.5)', (await vendorRow(V1, A)).rate === 112.5);
  po = await poNow(poK._id);
  check('K3 the rejected rate is not left on the PO: line back at 112.5, REJECTED, totals recalculated',
    po.items[0].rate === 112.5 && po.items[0].rateChangeStatus === 'REJECTED' && po.totalTaxableValue === round2(po.items[0].quantity * 112.5)
    && po.activityTimeline.some((t) => t.action === 'RATE_CHANGE_REJECTED' && /Use the contracted rate/.test(t.description)));
  const evK = await eventsOf(reqK._id);
  check('K4 history: REQUESTED → REJECTED with the reason and rejecter', evK.map((e) => e.event).join(',') === 'REQUESTED,REJECTED'
    && evK[1].rejectionReason === 'Use the contracted rate' && evK[1].actorName === USERS.APPROVER.name);
  check('K5 the requester is told it was rejected', await Notification.exists({ userId: users.BUYER._id, title: `Rate change ${reqK.requestNumber} rejected` }));
  r = await poEdit('BUYER', po, () => ({ rate: 125, rateChangeReason: 'Vendor revised quote to 125' }));
  const reqsK = await reqsOf(poK._id);
  check('K6 a new request after rejection; the rejected one stays REJECTED', r.status === 200 && reqsK.length === 2
    && reqsK[0].status === 'REJECTED' && reqsK[1].status === 'PENDING' && reqsK[1].requestedRate === 125 && reqsK[1].originalPoRate === 112.5, `${r.status} ${r.message}`);
  r = await approvePo('POAPPROVER', poK._id);
  check('K7 the PO stays unapprovable while the new request is pending', r.status === 400, `${r.status} ${r.message}`);

  // ── E: draft edits ──
  console.log('\nE  Draft edits keep, replace or withdraw requests');
  po = await poNow(poK._id);
  r = await poEdit('BUYER', po, () => ({ quantity: po.items[0].quantity + 1 }));
  let reqsE = await reqsOf(poK._id);
  check('E1 an edit that keeps the rate keeps the same request (no reason needed)', r.status === 200 && reqsE.length === 2 && reqsE[1].status === 'PENDING'
    && String((await poNow(poK._id)).items[0]._id) === String(reqsE[1].poLineId), `${r.status} ${r.message}`);
  po = await poNow(poK._id);
  r = await poEdit('BUYER', po, () => ({ rate: 127 }));
  check('E2 a different rate without a reason is refused (400), the request stands', r.status === 400 && (await RateChangeRequest.findById(reqsE[1]._id).lean()).status === 'PENDING', `${r.status} ${r.message}`);
  r = await poEdit('BUYER', po, () => ({ rate: 127, rateChangeReason: 'Final negotiated' }));
  reqsE = await reqsOf(poK._id);
  check('E3 a different rate with a reason supersedes it (old WITHDRAWN, new PENDING 127)', r.status === 200 && reqsE.length === 3
    && reqsE[1].status === 'WITHDRAWN' && /Replaced/.test(reqsE[1].withdrawnReason) && reqsE[2].status === 'PENDING' && reqsE[2].requestedRate === 127, `${r.status} ${r.message}`);
  po = await poNow(poK._id);
  r = await poEdit('BUYER', po, () => ({ rate: 112.5 }));
  reqsE = await reqsOf(poK._id);
  check('E4 setting the rate back to the vendor rate withdraws it; the PO approves', r.status === 200 && reqsE[2].status === 'WITHDRAWN'
    && (await approvePo('POAPPROVER', poK._id)).status === 200, `${r.status} ${r.message}`);
  r = await call('APPROVER', 'POST', `${RC}/${reqsE[2]._id}/approve`, {});
  check('E5 a withdrawn request cannot be approved (409)', r.status === 409, `${r.status} ${r.message}`);
  r = await poEdit('BUYER', await poNow(poK._id), () => ({ rate: 200, rateChangeReason: 'after approval' }));
  check('E6 an approved PO cannot be edited, so no request is raised (400)', r.status === 400 && (await reqsOf(poK._id)).length === 3, `${r.status} ${r.message}`);

  // ── X: PO deleted / cancelled / rejected ──
  console.log('\nX  PO deleted / cancelled / rejected withdraws its open request');
  for (const [label, act] of [
    ['deleted', (id) => call('MD', 'DELETE', `${PO}/${id}`)],
    ['cancelled', (id) => call('MD', 'POST', `${PO}/${id}/cancel`, { remarks: 'e2e cancel' })],
    ['rejected', (id) => call('POAPPROVER', 'POST', `${PO}/${id}/approve`, { decision: 'REJECTED', remarks: 'e2e reject' })],
  ]) {
    ind = await readyIndent(`X-${label}`, ['A'], V1);
    r = await createPo('BUYER', ind, V1, () => ({ rate: 99, rateChangeReason: `will be ${label}` }));
    const [rq] = await reqsOf(r.data._id);
    const a = await act(r.data._id);
    const after = await RateChangeRequest.findById(rq._id).lean();
    check(`X ${label} PO → request WITHDRAWN, vendor rate unchanged`, a.status === 200 && after.status === 'WITHDRAWN'
      && new RegExp(label).test(after.withdrawnReason) && (await vendorRow(V1, A)).rate === 112.5, `${a.status} ${a.message} ${after.status}`);
  }
  // Ineligible at approval time (as if the withdrawal hook had failed): nothing applied, request closed.
  ind = await readyIndent('X-inel', ['A'], V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 98, rateChangeReason: 'ineligible test' }));
  const [rqI] = await reqsOf(r.data._id);
  await VendorPurchaseOrder.updateOne({ _id: r.data._id }, { $set: { approvalStatus: 'REJECTED' } });
  r = await call('APPROVER', 'POST', `${RC}/${rqI._id}/approve`, {});
  const rqIAfter = await RateChangeRequest.findById(rqI._id).lean();
  const evI = await eventsOf(rqI._id);
  check('X approve when the PO is no longer a draft → 409, vendor untouched, request WITHDRAWN, conflict in history',
    r.status === 409 && r.data?.code === 'PO_NOT_ELIGIBLE' && (await vendorRow(V1, A)).rate === 112.5 && rqIAfter.status === 'WITHDRAWN'
    && evI.some((e) => e.event === 'APPROVAL_CONFLICT' && e.outcome === 'CONFLICT') && evI.some((e) => e.event === 'WITHDRAWN'), `${r.status} ${r.message} ${JSON.stringify(r.data)}`);

  // ── S: stale + concurrent ──
  console.log('\nS  Stale vendor rate and concurrent approvals');
  const indS1 = await readyIndent('S1', ['A'], V1);
  const s1 = (await createPo('BUYER', indS1, V1, () => ({ rate: 115, rateChangeReason: 'stale A' }))).data;
  const indS2 = await readyIndent('S2', ['A'], V1);
  const s2 = (await createPo('BUYER', indS2, V1, () => ({ rate: 118, rateChangeReason: 'stale B' }))).data;
  const [rqA] = await reqsOf(s1._id);
  const [rqB] = await reqsOf(s2._id);
  check('S1 two pending requests on the same vendor rate (both saw 112.5)', rqA.existingVendorRate === 112.5 && rqB.existingVendorRate === 112.5);
  r = await call('APPROVER', 'POST', `${RC}/${rqB._id}/approve`, {});
  check('S2 B approved → vendor 118', r.status === 200 && (await vendorRow(V1, A)).rate === 118, `${r.status} ${r.message}`);
  list = await ok('APPROVER', 'GET', `${RC}?status=PENDING&search=${encodeURIComponent(rqA.requestNumber)}`);
  check('S3 the list flags A as stale with the live rate 118', list.rows[0]?.stale === true && list.rows[0]?.currentVendorRate === 118, JSON.stringify(list.rows[0]));
  r = await call('APPROVER', 'POST', `${RC}/${rqA._id}/approve`, {});
  check('S4 approving A without confirming refuses (409 STALE_VENDOR_RATE, current 118)', r.status === 409 && r.data?.code === 'STALE_VENDOR_RATE' && r.data?.currentVendorRate === 118, `${r.status} ${r.message} ${JSON.stringify(r.data)}`);
  check('S5 …the newer 118 was not overwritten; A pending with lastConflict; conflict in history', (await vendorRow(V1, A)).rate === 118
    && (await RateChangeRequest.findById(rqA._id).lean()).lastConflict?.currentVendorRate === 118
    && (await eventsOf(rqA._id)).some((e) => e.event === 'APPROVAL_CONFLICT'));
  r = await call('APPROVER', 'POST', `${RC}/${rqA._id}/approve`, { acknowledgeRateChange: true, expectedVendorRate: 112.5 });
  check('S6 confirming the WRONG current rate still refuses (409)', r.status === 409 && (await vendorRow(V1, A)).rate === 118, `${r.status} ${r.message}`);
  r = await call('APPROVER', 'POST', `${RC}/${rqA._id}/approve`, { acknowledgeRateChange: true, expectedVendorRate: 118 });
  const rqAA = await RateChangeRequest.findById(rqA._id).lean();
  check('S7 confirming the current 118 approves A → vendor 115; before/after recorded as 118 → 115', r.status === 200 && (await vendorRow(V1, A)).rate === 115
    && rqAA.vendorSourceBefore.rate === 118 && rqAA.vendorSourceAfter.rate === 115, `${r.status} ${r.message}`);
  check('S8 an approved PO\'s line is never changed by later rate approvals', (await poNow(poR._id)).items[0].rate === 112.5);
  // Concurrent: two approvers at once.
  ind = await readyIndent('S9', ['A'], V1);
  const s9 = (await createPo('BUYER', ind, V1, () => ({ rate: 116, rateChangeReason: 'race' }))).data;
  const [rq9] = await reqsOf(s9._id);
  const race = await Promise.all([
    call('APPROVER', 'POST', `${RC}/${rq9._id}/approve`, {}),
    call('POAPPROVER', 'POST', `${RC}/${rq9._id}/approve`, {}),
    call('MD', 'POST', `${RC}/${rq9._id}/approve`, {}),
  ]);
  const wins = race.filter((x) => x.status === 200).length;
  check('S9 three concurrent approvals → exactly one succeeds, the rest 409', wins === 1 && race.filter((x) => x.status === 409).length === 2, race.map((x) => `${x.status} ${x.message}`).join(' | '));
  check('S10 …applied once: vendor 116, one APPROVED event, one pricing row', (await vendorRow(V1, A)).rate === 116
    && (await eventsOf(rq9._id)).filter((e) => e.event === 'APPROVED').length === 1
    && await PricingHistory.countDocuments({ source: 'RATE_CHANGE_APPROVAL', referenceId: s9._id }) === 1);
  // Vendor rate moved after a draft was saved at the then-current rate.
  ind = await readyIndent('S11', ['A'], V1);
  const s11 = (await createPo('BUYER', ind, V1, () => ({ rate: 116 }))).data;
  await Vendor.updateOne({ _id: V1, 'products.skuCode': A }, { $set: { 'products.$.rate': 117 } });
  r = await approvePo('POAPPROVER', s11._id);
  check('S11 a draft whose vendor rate moved after saving cannot be approved silently', r.status === 400 && /changed from ₹116/.test(r.message), `${r.status} ${r.message}`);
  await Vendor.updateOne({ _id: V1, 'products.skuCode': A }, { $set: { 'products.$.rate': 116 } });
  check('S12 …and approves once the rates agree again', (await approvePo('POAPPROVER', s11._id)).status === 200);

  // ── V: different vendors, units, tax ──
  console.log('\nV  Vendors, units and tax');
  ind = await readyIndent('V1', ['A'], V2);
  r = await createPo('BUYER', ind, V2, () => ({ rate: 120 }));
  check('V1 V2 at its own 120 needs no approval (V1 is at 116)', r.status === 201 && (await reqsOf(r.data._id)).length === 0, `${r.status} ${r.message}`);
  ind = await readyIndent('V2', ['A'], V2);
  r = await createPo('BUYER', ind, V2, () => ({ rate: 116, rateChangeReason: 'match Alpha' }));
  const [rqV2] = await reqsOf(r.data._id);
  check('V2 V2 at V1\'s 116 is a change against V2\'s 120', rqV2 && String(rqV2.vendorId) === V2 && rqV2.existingVendorRate === 120 && rqV2.requestedRate === 116);
  r = await call('APPROVER', 'POST', `${RC}/${rqV2._id}/approve`, {});
  check('V3 approving it updates V2 only', r.status === 200 && (await vendorRow(V2, A)).rate === 116 && (await vendorRow(V1, A)).rate === 116, `${r.status} ${r.message}`);
  ind = await readyIndent('V4', ['BOX'], V1);
  check('V4 the BOX SKU\'s indent line is in BOX (purchase unit)', ind.items[0].unit === 'BOX', ind.items[0].unit);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 260, gstRate: 12, quantity: 3, rateChangeReason: 'box price up' }));
  const poBox = r.data;
  const [rqBox] = await reqsOf(poBox._id);
  check('V5 BOX line at 260 vs 250/BOX → request in BOX', r.status === 201 && rqBox.unit === 'BOX' && rqBox.existingVendorRate === 250, `${r.status} ${r.message}`);
  po = await poNow(poBox._id);
  check('V6 totals: 3 × 260 = 780 taxable, 12% = 93.6, 873.6', po.totalTaxableValue === 780 && po.totalGSTAmount === 93.6 && po.grandTotal === 873.6, JSON.stringify([po.totalTaxableValue, po.totalGSTAmount, po.grandTotal]));
  r = await call('APPROVER', 'POST', `${RC}/${rqBox._id}/approve`, {});
  po = await poNow(poBox._id);
  check('V7 approved: BOX row 260, the PCS-priced rows untouched, totals still 873.6', r.status === 200 && (await vendorRow(V1, SKUS.BOX.code, 'BOX')).rate === 260
    && po.grandTotal === 873.6 && po.items[0].taxAmount === 93.6, `${r.status} ${r.message}`);
  ind = await readyIndent('V8', ['BOX'], V1);
  r = await createPo('BUYER', ind, V1, () => ({ unit: 'PCS', rate: 11, rateChangeReason: 'per piece' }));
  check('V8 a changed rate in a unit the vendor does not price (PCS vs BOX) is refused (400)', r.status === 400 && /per BOX/.test(r.message), `${r.status} ${r.message}`);
  r = await createPo('BUYER', ind, V1, () => ({ unit: 'PCS', rate: 260 }));
  check('V9 …and so is the BOX rate carried onto a PCS line unchanged: no vendor rate exists in PCS, nothing is matched across units (400, no request)',
    r.status === 400 && /per BOX/.test(r.message), `${r.status} ${r.message}`);

  // ── Q: security / validation ──
  console.log('\nQ  Validation and security');
  ind = await readyIndent('Q1', ['A'], V1);
  r = await createPo('BUYER', ind, V1, () => ({ skuCode: SKUS.B.code, rate: 9, rateChangeReason: 'wrong sku' }));
  check('Q1 a rate change for an SKU that is not the line\'s indent item is refused', r.status === 400 && /not the item of/.test(r.message), `${r.status} ${r.message}`);
  for (const [bad, label] of [[-5, 'negative'], ['abc', 'text']]) {
    r = await createPo('BUYER', ind, V1, () => ({ rate: bad, rateChangeReason: 'bad' }));
    check(`Q2 ${label} rate refused (422)`, r.status === 422, `${r.status} ${r.message}`);
  }
  r = await createPo('BUYER', ind, V1, () => ({ rate: 117, rateChangeReason: 'x'.repeat(501) }));
  check('Q3 a reason over 500 characters refused (422)', r.status === 422, `${r.status} ${r.message}`);
  r = await call('BUYER', 'POST', `/vendors/${V1}/products`, { skuCode: A, productName: SKUS.A.name, rate: 1, gstRate: 18, unit: 'Pcs' });
  check('Q4 the PO screen\'s add-product route cannot change an existing vendor rate (409)', r.status === 409 && (await vendorRow(V1, A)).rate === 116, `${r.status} ${r.message}`);
  r = await call('BUYER', 'POST', `/vendors/${V1}/products`, { skuCode: A, productName: SKUS.A.name, rate: 116, gstRate: 18, unit: 'Pcs' });
  check('Q5 …re-saving the same rate is still fine (2xx)', r.status < 300 && (await vendorRow(V1, A)).rate === 116, `${r.status} ${r.message}`);
  r = await call('BUYER', 'POST', `${RC}`, { poId: String(poR._id) });
  check('Q6 requests cannot be created through the approvals API (no POST /)', r.status === 404 || r.status === 405, `${r.status}`);
  let threw = false;
  try { await RateChangeHistory.updateOne({ requestId: reqR._id }, { $set: { reason: 'rewritten' } }); } catch { threw = true; }
  let threwDel = false;
  try { await RateChangeHistory.deleteMany({ requestId: reqR._id }); } catch { threwDel = true; }
  check('Q7 history is append-only (update and delete refused by the model)', threw && threwDel && (await eventsOf(reqR._id)).length === 2);

  // ── L: legacy / unchanged behaviour ──
  console.log('\nL  Older behaviour that stays');
  ind = await readyIndent('L1', ['NEW'], V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 55, rateSource: 'MANUAL' }));
  check('L1 an item the vendor has no rate for needs no approval (nothing was fetched)', r.status === 201 && (await reqsOf(r.data._id)).length === 0, `${r.status} ${r.message}`);
  await approvePo('POAPPROVER', r.data._id);
  check('L2 …and is added to the vendor on PO approval, as before', (await vendorRow(V1, SKUS.NEW.code))?.rate === 55);
  ind = await readyIndent('L3', ['B'], V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 8, gstRate: 5, rateSource: 'MANUAL' }));
  await approvePo('POAPPROVER', r.data._id);
  const rowB = await vendorRow(V1, SKUS.B.code);
  check('L3 a GST-only edit is still written back on PO approval; the rate is not', rowB.gstRate === 5 && rowB.rate === 8, JSON.stringify(rowB));
  // A draft saved before this feature with a MANUAL rate and no request.
  ind = await readyIndent('L4', ['A'], V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 116 }));
  await VendorPurchaseOrder.updateOne({ _id: r.data._id }, { $set: { 'items.0.rate': 150, 'items.0.rateSource': 'MANUAL', 'items.0.fetchedRate': null } });
  const legacy = await approvePo('POAPPROVER', r.data._id);
  check('L4 an older draft with an unapproved manual rate cannot be approved (and the vendor is untouched)', legacy.status === 400
    && /no approved rate change/.test(legacy.message) && (await vendorRow(V1, A)).rate === 116, `${legacy.status} ${legacy.message}`);

  // ── D: MD direct save ──
  console.log('\nD  Save PO Directly (MD)');
  ind = await readyIndent('D1', ['A'], V1);
  r = await createPo('MD', ind, V1, () => ({ rate: 119 }), { saveMode: 'DIRECT' });
  check('D1 MD direct save with a changed rate and no reason is refused (400)', r.status === 400 && /reason/.test(r.message), `${r.status} ${r.message}`);
  r = await createPo('MD', ind, V1, () => ({ rate: 119, rateChangeReason: 'MD negotiated' }), { saveMode: 'DIRECT' });
  const [rqD] = await reqsOf(r.data?._id);
  check('D2 with a reason: PO approved, MD\'s own request approved (selfApproved), vendor 119', r.status === 201 && r.data.approvalStatus === 'APPROVED'
    && rqD?.status === 'APPROVED' && rqD.selfApproved === true && (await vendorRow(V1, A)).rate === 119, `${r.status} ${r.message} ${JSON.stringify(rqD)}`);
  ind = await readyIndent('D3', ['A'], V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 121, rateChangeReason: 'buyer' }));
  const [rqD3] = await reqsOf(r.data._id);
  r = await call('MD', 'POST', `${RC}/${rqD3._id}/approve`, {});
  check('D3 the MD can approve anyone\'s request', r.status === 200 && (await vendorRow(V1, A)).rate === 121, `${r.status} ${r.message}`);

  // ── H: history read ──
  console.log('\nH  Rate Change History');
  let h = await ok('VIEWER', 'GET', `${RC}/history?vendorId=${V1}&skuCode=${A}&limit=500`);
  const times = h.rows.map((x) => new Date(x.at).getTime());
  check('H1 chronological by default (oldest first)', times.every((t, i) => i === 0 || t >= times[i - 1]) && h.rows.length > 10);
  check('H2 filtered to the vendor + SKU', h.rows.every((x) => x.vendorId === V1 && x.skuCode === A));
  h = await ok('VIEWER', 'GET', `${RC}/history?event=REJECTED&requestedBy=${users.BUYER._id}`);
  check('H3 event + requester filters', h.rows.length >= 1 && h.rows.every((x) => x.event === 'REJECTED' && x.requestedBy === String(users.BUYER._id)));
  h = await ok('VIEWER', 'GET', `${RC}/history?requestId=${reqR._id}&order=desc`);
  check('H4 per-request trail, newest first on request', h.rows.map((x) => x.event).join(',') === 'APPROVED,REQUESTED');
  const today = localToday();
  h = await ok('VIEWER', 'GET', `${RC}/history?from=${plusDays(today, 2)}T00:00:00`);
  check('H5 a date range in the future finds nothing', h.rows.length === 0);
  const appr = (await ok('VIEWER', 'GET', `${RC}/history?requestId=${reqR._id}`)).rows.find((x) => x.event === 'APPROVED');
  check('H6 an APPROVED row carries vendor source before/after, approver, PO and indent refs', appr.vendorSourceBefore.rate === 100 && appr.vendorSourceAfter.rate === 112.5
    && appr.actorName === USERS.APPROVER.name && appr.poRef === poR.draftNumber && appr.indentNumber && appr.currency === 'INR' && appr.unit);
  list = await ok('VIEWER', 'GET', `${RC}?limit=200`);
  check('H7 list summary counts by status', list.summary.total === list.summary.PENDING + list.summary.APPROVED + list.summary.REJECTED + list.summary.WITHDRAWN
    && list.summary.APPROVED > 0 && list.summary.REJECTED > 0 && list.summary.WITHDRAWN > 0, JSON.stringify(list.summary));

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
};

// ── Data for the browser probe ─────────────────────────────────────────────
const prepUi = async () => {
  await connect();
  await login();
  const v1 = await Vendor.findOne({ code: VENDORS.V1.code }).lean();
  // Reset V1 SKU-A to 100 so the probe's numbers are fixed.
  await Vendor.updateOne({ _id: v1._id, 'products.skuCode': SKUS.A.code }, { $set: { 'products.$.rate': 100 } });
  const pending = await readyIndent('UI-pending', ['A'], v1._id);
  const r = await createPo('BUYER', pending, v1._id, () => ({ rate: 108, rateChangeReason: 'UI probe: freight surcharge' }));
  const [req] = await reqsOf(r.data._id);
  const forForm = await readyIndent('UI-form', ['A'], v1._id);
  const manifest = {
    api: API, password: PASSWORD, users: Object.fromEntries(Object.entries(USERS).map(([k, u]) => [k, u.email])),
    vendor: { _id: String(v1._id), name: v1.name }, sku: SKUS.A,
    pendingRequest: { _id: String(req._id), requestNumber: req.requestNumber, poId: String(r.data._id), poRef: r.data.draftNumber },
    formIndent: { _id: String(forForm._id), indentNumber: forForm.indentNumber, itemRef: forForm.items[0].itemDisplayNumber || '' },
  };
  const out = path.resolve(process.cwd(), '..', 'frontend', 'e2e', 'shots', 'rate-change-manifest.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`[prep-ui] wrote ${out}`);
};

// ── TEST ONLY walkthrough (frontend/e2e/purchaseApproval.e2e.mjs) ──────────
// Resets ONLY the TEST ONLY vendor's rate to 100 and makes four PO-ready
// indents fixed to it; every request is then raised by the spec itself,
// through the PO form or the PO API, never inserted here.
const upsertTestOnly = async () => {
  const sku = await upsertSku(TEST_ONLY.sku);
  await Vendor.updateOne({ code: TEST_ONLY.vendor.code }, { $set: {
    name: TEST_ONLY.vendor.name, isActive: true, isDeleted: false, creditPeriodDays: 30,
    products: [{ skuId: sku._id, skuCode: sku.code, productName: sku.name, unit: 'Pcs', rate: TEST_ONLY.rate, gstRate: 18 }],
  } }, { upsert: true });
  return { sku, vendor: await Vendor.findOne({ code: TEST_ONLY.vendor.code }).lean() };
};

const prepTestOnly = async () => {
  await connect();
  await login();
  const { vendor } = await upsertTestOnly();
  const indents = {};
  for (const k of ['approve', 'reject', 'unauthorised', 'stale']) {
    const ind = await readyIndent(`TEST ONLY ${k}`, ['TEST'], vendor._id);
    const it = ind.items[0];
    indents[k] = {
      _id: String(ind._id), indentNumber: ind.indentNumber, itemId: String(it._id), skuId: String(it.skuId), quantity: it.approvedQuantity || it.quantity, unit: it.unit, itemName: it.itemName,
    };
  }
  const manifest = {
    api: API, password: PASSWORD, users: Object.fromEntries(Object.entries(USERS).map(([k, u]) => [k, u.email])),
    vendor: { _id: String(vendor._id), name: vendor.name, code: vendor.code },
    sku: TEST_ONLY.sku, rate: TEST_ONLY.rate, reason: TEST_ONLY.reason, indents,
  };
  const out = path.resolve(process.cwd(), '..', 'frontend', 'e2e', 'shots', 'test-only-rate-manifest.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`[prep-test-only] ${vendor.name} · ${TEST_ONLY.sku.code} reset to ${TEST_ONLY.rate}; 4 indents; wrote ${out}`);
};

// ── Atomicity under injected failures ──────────────────────────────────────
// Raises real requests on the TEST ONLY vendor through the PO API, then
// approves them IN THIS PROCESS with one write made to fail part-way, and
// checks that neither the vendor rate nor the PO line moved. Run it on the
// standalone mongod (undo path) and on a replica set (transaction path).
const atomic = async () => {
  await connect();
  await login();
  const { rateChangeService } = await import('../modules/procurement/rate-change/rateChange.service.js');
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  console.log(`run ${RUN} · ${hello.setName ? `replica set ${hello.setName} (transaction)` : 'standalone (undo list)'}`);
  if (!await Vendor.exists({ code: TEST_ONLY.vendor.code })) await upsertTestOnly();
  const vendor = await Vendor.findOne({ code: TEST_ONLY.vendor.code }).lean();
  const approver = await User.findOne({ email: USERS.APPROVER.email }).lean();
  const rateNow = async () => (await vendorRow(vendor._id, TEST_ONLY.sku.code)).rate;

  const cases = [
    // [label, model, static to break, how it fails, PO request expected after]
    ['the last write (rate change history) fails', RateChangeHistory, 'insertMany', 'throw', 'PENDING'],
    ['the pricing history write fails', PricingHistory, 'create', 'throw', 'PENDING'],
    ['the PO write matches nothing (PO changed mid-approval)', VendorPurchaseOrder, 'updateOne', 'nomatch', 'WITHDRAWN'],
  ];
  let n = 0;
  for (const [label, Model, fn, how, expectStatus] of cases) {
    n += 1;
    const base = await rateNow();
    const proposed = base + 10 + n;
    const ind = await readyIndent(`TEST ONLY atomic ${n}`, ['TEST'], vendor._id);
    const r = await createPo('BUYER', ind, vendor._id, () => ({ rate: proposed, rateChangeReason: `${TEST_ONLY.reason} (atomicity ${n})` }));
    if (r.status !== 201) throw new Error(`PO create → ${r.status} ${r.message}`);
    const [req] = await reqsOf(r.data._id);
    const poBefore = await poNow(r.data._id);

    const orig = Model[fn];
    let calls = 0;
    Model[fn] = function patched(...args) {
      calls += 1;
      if (calls > 1) return orig.apply(this, args); // only the approval's own write
      if (how === 'nomatch') return Promise.resolve({ acknowledged: true, matchedCount: 0, modifiedCount: 0 });
      return Promise.reject(new Error(`INJECTED failure: ${label}`));
    };
    let err = null;
    try { await rateChangeService.approve(req._id, {}, approver); } catch (e) { err = e; } finally { Model[fn] = orig; }

    const reqAfter = await RateChangeRequest.findById(req._id).lean();
    const poAfter = await poNow(r.data._id);
    const lineAfter = poAfter.items[0];
    const ev = await eventsOf(req._id);
    const pricing = await PricingHistory.countDocuments({ source: 'RATE_CHANGE_APPROVAL', referenceId: poAfter._id });
    check(`T${n}a ${label} → approval refused (${err?.statusCode || ''} ${String(err?.message || 'no error').slice(0, 70)})`, err && calls >= 1);
    check(`T${n}b …vendor rate NOT updated (still ${base})`, (await rateNow()) === base, `vendor ${await rateNow()}`);
    check(`T${n}c …PO line NOT updated (rate ${proposed}, label ${expectStatus}, totals unchanged)`, lineAfter.rate === proposed && lineAfter.rateChangeStatus === expectStatus
      && poAfter.grandTotal === poBefore.grandTotal && poAfter.totalTaxableValue === poBefore.totalTaxableValue && !poAfter.activityTimeline.some((a) => a.action === 'RATE_CHANGE_APPROVED'),
    JSON.stringify({ rate: lineAfter.rate, st: lineAfter.rateChangeStatus, gt: [poBefore.grandTotal, poAfter.grandTotal] }));
    check(`T${n}d …request ${expectStatus}, no APPROVED event, no pricing row`, reqAfter.status === expectStatus && (expectStatus !== 'PENDING' || !reqAfter.decidedAt)
      && !ev.some((e) => e.event === 'APPROVED') && pricing === 0, JSON.stringify({ s: reqAfter.status, ev: ev.map((e) => e.event), pricing }));

    if (expectStatus === 'PENDING') {
      const ok2 = await call('APPROVER', 'POST', `${RC}/${req._id}/approve`, {});
      const po2 = await poNow(r.data._id);
      check(`T${n}e …approving again with nothing broken applies both: vendor ${proposed}, PO line ${proposed}, one APPROVED event`, ok2.status === 200
        && (await rateNow()) === proposed && po2.items[0].rate === proposed && po2.items[0].rateChangeStatus === 'APPROVED'
        && (await eventsOf(req._id)).filter((e) => e.event === 'APPROVED').length === 1
        && await PricingHistory.countDocuments({ source: 'RATE_CHANGE_APPROVAL', referenceId: po2._id }) === 1, `${ok2.status} ${ok2.message}`);
    } else {
      check(`T${n}e …the conflict is in the history and the request cannot be approved later (409)`, ev.some((e) => e.event === 'APPROVAL_CONFLICT')
        && (await call('APPROVER', 'POST', `${RC}/${req._id}/approve`, {})).status === 409);
    }
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
};

if (isEntry(import.meta.url)) {
  const mode = process.argv[2];
  const run = { '--seed': seed, '--api': api, '--prep-ui': prepUi, '--prep-test-only': prepTestOnly, '--atomic': atomic }[mode];
  if (!run) {
    console.log('usage: --seed | --api | --prep-ui | --prep-test-only | --atomic');
    process.exit(2);
  }
  run()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
