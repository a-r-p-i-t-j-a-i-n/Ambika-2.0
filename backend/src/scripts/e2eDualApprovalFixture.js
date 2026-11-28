/**
 * API oracle for the dual-approver rules in Purchase Approval:
 *   - Rate / UNIT changes → one shared request, decided by the MD OR the purchase approver
 *   - A PO for a NEW vendor → decided by the MD OR the purchase approver (not by procurement.approve alone)
 *
 *   node src/scripts/e2eDualApprovalFixture.js --seed      upsert users, SKUs, vendors (never drops)
 *   (start the guarded backend on that DB AFTER the seed, so the seeded vendors pre-date the new-vendor rule:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5093 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_dualapproval node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5093/api/v1 node src/scripts/e2eDualApprovalFixture.js --api
 *   API=... node src/scripts/e2eDualApprovalFixture.js --prep-ui   leaves pending data for the browser probe
 *
 * --seed RESETS the seeded vendors' catalog rows so --api can run again. Every run makes fresh indents and
 * fresh "new" vendors (created through the API after the server booted, i.e. after the rule went live).
 *
 * Users (E2e@12345): MD (roles MD), IMP (imp@msambikaglobal.in — the purchase approver, found by e-mail; seeded
 * exactly like the real account: DISPATCH_SUPERVISOR, NO approval permission), BUYER (PLANNER — the doer),
 * POAPPR (PLANNER + procurement.approve — an ordinary PO approver, NOT designated), VIEWER (PLANNER).
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard (S3 + email off). Never reads
 * MONGO_URI. Nothing here drops or resets a database.
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

export const DB_NAME = 'ambika_e2e_dualapproval';
export const E2E_URI = process.env.E2E_DA_URI || `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eDualApprovalFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5093/api/v1').replace(/\/+$/, '');
const PASSWORD = 'E2e@12345';
export const USERS = {
  MD:     { email: 'dual-md@test.local',       name: 'E2E Dual MD',        role: 'MD', roles: ['MD'], grants: [], mobile: '9000000191' },
  IMP:    { email: 'imp@msambikaglobal.in',    name: 'E2E Purchase Approver', role: 'Process Coordinator', roles: ['DISPATCH_SUPERVISOR'], grants: [], mobile: '9000000192' },
  BUYER:  { email: 'dual-buyer@test.local',    name: 'E2E Dual Buyer',     role: 'EA', roles: ['PLANNER'], grants: [], mobile: '9000000193' },
  POAPPR: { email: 'dual-poappr@test.local',   name: 'E2E Dual PO Approver', role: 'EA', roles: ['PLANNER'], grants: ['procurement.approve'], mobile: '9000000194' },
  VIEWER: { email: 'dual-viewer@test.local',   name: 'E2E Dual Viewer',    role: 'EA', roles: ['PLANNER'], grants: [], mobile: '9000000195' },
};
const N_RC = 8;   // rate-change SKUs (one per scenario — an approval moves its row)
const N_UN = 8;   // unit-change SKUs
const skuDef = (code, name) => ({ code, name, unit: 'PCS' });
export const SKUS = {
  ...Object.fromEntries(Array.from({ length: N_RC }, (_, i) => [`RC${i + 1}`, skuDef(`DA-RC${i + 1}`, `DA Rate Item ${i + 1}`)])),
  ...Object.fromEntries(Array.from({ length: N_UN }, (_, i) => [`UN${i + 1}`, skuDef(`DA-UN${i + 1}`, `DA Unit Item ${i + 1}`)])),
  UM: skuDef('DA-UM', 'DA Two-Unit Item'),
  NV: skuDef('DA-NV', 'DA New Vendor Item'),
  OK: skuDef('DA-OK', 'DA Ordinary Item'),
};
export const VENDORS = {
  V1: { code: 'DA-V1', name: 'DA Existing Vendor' },
  V0: { code: 'DA-V0', name: 'DA Legacy Vendor Never Used' }, // created before the rule, no PO ever
};
const RUN = Date.now().toString(36);
const PO = '/procurement/purchase-orders';
const RC = '/procurement/rate-changes';
const BACKDATE = new Date('2020-01-01T00:00:00Z');

let failures = 0;
let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${String(detail).slice(0, 600)}` : ''}`);
};

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

const upsertSku = (s) => SKU.findOneAndUpdate(
  { code: s.code },
  { $set: { name: s.name, unit: s.unit, itemType: 'CONSUMABLE', isActive: true, isDeleted: false } },
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
  const v1Rows = [
    ...Array.from({ length: N_RC }, (_, i) => row(sku[`RC${i + 1}`], 'Pcs', 100)),
    ...Array.from({ length: N_UN }, (_, i) => row(sku[`UN${i + 1}`], 'Kgs', 100)),
    row(sku.UM, 'Kgs', 40), row(sku.UM, 'Box', 250),
    row(sku.OK, 'Pcs', 60), row(sku.NV, 'Pcs', 50),
  ];
  await Vendor.updateOne({ code: VENDORS.V1.code }, { $set: { name: VENDORS.V1.name, isActive: true, isDeleted: false, creditPeriodDays: 30, products: v1Rows } }, { upsert: true });
  await Vendor.updateOne({ code: VENDORS.V0.code }, { $set: { name: VENDORS.V0.name, isActive: true, isDeleted: false, creditPeriodDays: 30, products: [row(sku.OK, 'Pcs', 61)] } }, { upsert: true });
  // The seeded vendors are "existing": back-date their Vendor Master creation record (raw write — no timestamps).
  await Vendor.collection.updateMany({ code: { $in: [VENDORS.V1.code, VENDORS.V0.code] } }, { $set: { createdAt: BACKDATE } });
  console.log(`[seed] ${DB_NAME}: users ${Object.values(USERS).map((u) => u.email).join(', ')} / ${PASSWORD}`);
  console.log(`[seed] ${VENDORS.V1.name}: ${N_RC} rate items 100/Pcs, ${N_UN} unit items 100/Kgs, 2-unit item, ordinary + new-vendor items · ${VENDORS.V0.name}: no PO history`);
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

// A PO-ready indent (quotation not required) whose items are fixed to `vendorId` (a vendor that carries the SKU).
let seq = 0;
const readyIndent = async (label, skuKey, vendorId) => {
  const s = await SKU.findOne({ code: SKUS[skuKey].code }).lean();
  seq += 1;
  const ind = await ok('BUYER', 'POST', '/procurement/indents', {
    department: 'Stores', remarks: `dual-approval e2e ${RUN} ${label}`,
    items: [{ skuId: String(s._id), skuCode: s.code, itemName: s.name, quantity: 4 + (seq % 3), unit: s.unit }],
  });
  await ok('BUYER', 'POST', `/procurement/indents/${ind._id}/submit`, {});
  const approved = await ok('MD', 'POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
  await ok('BUYER', 'POST', `/procurement/indents/${ind._id}/quote-comparative`, {
    statusDone: 'QUOTE_NOT_REQUIRED',
    itemQuotations: approved.items.map((it) => ({ itemId: it._id, itemName: it.itemName, statusDone: 'QUOTE_NOT_REQUIRED', vendorId: String(vendorId), quotationDocuments: [] })),
  });
  return PurchaseIndent.findById(ind._id).lean();
};
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
const reqOf = async (poId) => (await RateChangeRequest.find({ poId }).sort({ requestedAt: 1, _id: 1 }).lean())[0];
const eventsOf = (requestId) => RateChangeHistory.find({ requestId }).sort({ at: 1, _id: 1 }).lean();
const approvePo = (who, id) => call(who, 'POST', `${PO}/${id}/approve`, { decision: 'APPROVED', remarks: 'e2e' });
const rejectPo = (who, id) => call(who, 'POST', `${PO}/${id}/approve`, { decision: 'REJECTED', remarks: 'e2e no' });
const unread = (userId, refKey) => Notification.countDocuments({ userId, refKey, read: false });
const idOf = (x) => String(x?._id || x || '');

/** A vendor created through the Vendor Master API NOW (after the server booted = after the rule went live). */
const newVendor = async (label, who = 'BUYER') => {
  const nv = await SKU.findOne({ code: SKUS.NV.code }).lean();
  const v = await ok(who, 'POST', '/vendors', {
    name: `DA New Vendor ${RUN} ${label}`, isActive: true, creditPeriodDays: 15,
    products: [{ skuId: String(nv._id), skuCode: nv.code, productName: nv.name, unit: 'Pcs', rate: 50, gstRate: 18 }],
  });
  return v;
};

// ── API checks ─────────────────────────────────────────────────────────────
const api = async () => {
  await connect();
  await login();
  const v1 = await Vendor.findOne({ code: VENDORS.V1.code }).lean();
  const v0 = await Vendor.findOne({ code: VENDORS.V0.code }).lean();
  const users = Object.fromEntries(await Promise.all(Object.entries(USERS).map(async ([k, u]) => [k, await User.findOne({ email: u.email }).lean()])));
  const V1 = String(v1._id);
  const A = (k) => SKUS[k].code;
  if ((await vendorRow(V1, A('RC1'))).rate !== 100) throw new Error('Run --seed first (V1 rate items must start at 100)');
  console.log(`run ${RUN} against ${API}`);

  // ── I: who the approvers are ──
  console.log('\nI  Approver identity (looked up by e-mail / role — no user id written down)');
  let list = await ok('MD', 'GET', `${RC}?status=PENDING`);
  check('I1 canApprove true for the MD', list.canApprove === true);
  list = await ok('IMP', 'GET', `${RC}?status=PENDING`);
  check('I2 canApprove true for imp@ (no approval permission, found by e-mail)', list.canApprove === true);
  list = await ok('POAPPR', 'GET', `${RC}?status=PENDING`);
  check('I3 canApprove true for a procurement.approve holder (existing rule kept)', list.canApprove === true);
  list = await ok('VIEWER', 'GET', `${RC}?status=PENDING`);
  check('I4 canApprove false for everybody else', list.canApprove === false);

  // ── A: rate change — one shared request, either approver ──
  console.log('\nA  Rate change → one request for both approvers');
  let ind = await readyIndent('A1', 'RC1', V1);
  let r = await createPo('BUYER', ind, V1, () => ({ rate: 112.5, rateChangeReason: 'Steel price rise' }));
  check('A1 BUYER saves a PO at a changed rate → 201', r.status === 201, `${r.status} ${r.message}`);
  const poA1 = r.data;
  const rq1 = await reqOf(poA1._id);
  check('A2 exactly one PENDING request (RATE) — shared, not per approver', rq1 && rq1.status === 'PENDING' && rq1.changeType === 'RATE'
    && await RateChangeRequest.countDocuments({ poId: poA1._id }) === 1, JSON.stringify(rq1));
  const refKey1 = `rate-change:${rq1._id}`;
  const lm = await ok('MD', 'GET', `${RC}?status=PENDING`);
  const li = await ok('IMP', 'GET', `${RC}?status=PENDING`);
  check('A3 the request is in BOTH approvers\' Purchase Approval list', lm.rows.some((x) => x._id === idOf(rq1)) && li.rows.some((x) => x._id === idOf(rq1)));
  check('A4 both pending counts equal', lm.summary.PENDING === li.summary.PENDING, `${lm.summary.PENDING} vs ${li.summary.PENDING}`);
  check('A5 notified: imp@ AND the MD (unread, linked to the request)', await unread(users.IMP._id, refKey1) === 1 && await unread(users.MD._id, refKey1) === 1);
  const noteMd = await Notification.findOne({ userId: users.MD._id, refKey: refKey1 }).lean();
  check('A6 the notification opens Purchase Approval and names the request', noteMd?.link === '/purchase-fms/rate-change-approvals' && /Rate change/.test(noteMd.title) && noteMd.title.includes(rq1.requestNumber), JSON.stringify(noteMd));
  check('A7 the requester is not notified of their own request', await unread(users.BUYER._id, refKey1) === 0);
  const dMd = await ok('MD', 'GET', `${RC}/${rq1._id}`);
  const dImp = await ok('IMP', 'GET', `${RC}/${rq1._id}`);
  check('A8 detail: both may decide (canApprove, no block)', dMd.canApprove && dImp.canApprove && !dMd.approveBlock && !dImp.approveBlock);
  // unauthorized
  r = await call('VIEWER', 'POST', `${RC}/${rq1._id}/approve`, {});
  check('A9 an unauthorized user cannot approve (403)', r.status === 403, `${r.status} ${r.message}`);
  r = await call('BUYER', 'POST', `${RC}/${rq1._id}/reject`, { reason: 'nope' });
  check('A10 …nor reject (403)', r.status === 403, `${r.status} ${r.message}`);
  check('A11 vendor rate untouched while pending (unapproved change not applied)', (await vendorRow(V1, A('RC1'))).rate === 100);
  const phBefore = await PricingHistory.countDocuments({ vendorId: V1, skuCode: A('RC1') });
  // imp@ approves
  r = await call('IMP', 'POST', `${RC}/${rq1._id}/approve`, { remarks: 'ok from imp' });
  check('A12 imp@ approves → 200', r.status === 200 && r.data.status === 'APPROVED', `${r.status} ${r.message}`);
  const done1 = await RateChangeRequest.findById(rq1._id).lean();
  check('A13 decided by imp@ — id, name, time recorded', idOf(done1.decidedBy) === idOf(users.IMP._id) && done1.decidedByName === USERS.IMP.name && done1.decidedAt, JSON.stringify(done1));
  check('A14 approved change is effective: vendor rate 112.5, PO line approved', (await vendorRow(V1, A('RC1'))).rate === 112.5
    && (await poNow(poA1._id)).items[0].rateChangeStatus === 'APPROVED');
  const lm2 = await ok('MD', 'GET', `${RC}?status=PENDING`);
  check('A15 gone from the MD\'s pending list at once', !lm2.rows.some((x) => x._id === idOf(rq1)));
  check('A16 the MD\'s unread notification is settled too (count update)', await unread(users.MD._id, refKey1) === 0 && await unread(users.IMP._id, refKey1) === 0);
  check('A17 the MD sees it under Approved with imp@ as the decider', (await ok('MD', 'GET', `${RC}?status=APPROVED`)).rows.some((x) => x._id === idOf(rq1) && x.decidedByName === USERS.IMP.name));
  r = await call('MD', 'POST', `${RC}/${rq1._id}/approve`, {});
  check('A18 the MD cannot approve it again (409, names imp@)', r.status === 409 && r.message.includes(USERS.IMP.name), `${r.status} ${r.message}`);
  r = await call('MD', 'POST', `${RC}/${rq1._id}/reject`, { reason: 'too late' });
  check('A19 …nor reject it (409)', r.status === 409 && r.message.includes(USERS.IMP.name), `${r.status} ${r.message}`);
  const ev1 = await eventsOf(rq1._id);
  check('A20 audit: REQUESTED by the buyer, ONE APPROVED event by imp@', ev1.length === 2 && ev1[0].event === 'REQUESTED' && ev1[1].event === 'APPROVED' && ev1[1].actorName === USERS.IMP.name
    && idOf(ev1[1].actorId) === idOf(users.IMP._id), JSON.stringify(ev1.map((e) => [e.event, e.actorName])));
  check('A21 exactly one pricing-history row for the approval', await PricingHistory.countDocuments({ vendorId: V1, skuCode: A('RC1') }) === phBefore + 1);
  // The MD approves the next one → imp@'s side clears.
  ind = await readyIndent('A2', 'RC2', V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 90, rateChangeReason: 'Volume discount' }));
  const rq2 = await reqOf(r.data._id);
  const refKey2 = `rate-change:${rq2._id}`;
  r = await call('MD', 'POST', `${RC}/${rq2._id}/approve`, {});
  check('A22 the MD approves → 200, decided by the MD', r.status === 200 && (await RateChangeRequest.findById(rq2._id).lean()).decidedByName === USERS.MD.name, `${r.status} ${r.message}`);
  const li2 = await ok('IMP', 'GET', `${RC}?status=PENDING`);
  check('A23 gone from imp@\'s pending list; imp@ notification settled', !li2.rows.some((x) => x._id === idOf(rq2)) && await unread(users.IMP._id, refKey2) === 0);
  r = await call('IMP', 'POST', `${RC}/${rq2._id}/approve`, {});
  check('A24 imp@ cannot approve it afterwards (409)', r.status === 409 && r.message.includes(USERS.MD.name), `${r.status} ${r.message}`);
  // Simultaneous approvals.
  ind = await readyIndent('A3', 'RC3', V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 105, rateChangeReason: 'Race' }));
  const rq3 = await reqOf(r.data._id);
  const ph3 = await PricingHistory.countDocuments({ vendorId: V1, skuCode: A('RC3') });
  const race = await Promise.all([call('IMP', 'POST', `${RC}/${rq3._id}/approve`, {}), call('MD', 'POST', `${RC}/${rq3._id}/approve`, {})]);
  const won = race.filter((x) => x.status === 200);
  check('A25 both approve at once → exactly ONE succeeds, the other is refused (409)', won.length === 1 && race.filter((x) => x.status === 409).length === 1, race.map((x) => `${x.status} ${x.message}`).join(' | '));
  check('A26 …applied once: one APPROVED event, one pricing row, rate 105', (await eventsOf(rq3._id)).filter((e) => e.event === 'APPROVED').length === 1
    && await PricingHistory.countDocuments({ vendorId: V1, skuCode: A('RC3') }) === ph3 + 1 && (await vendorRow(V1, A('RC3'))).rate === 105);
  ind = await readyIndent('A4', 'RC4', V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 99, rateChangeReason: 'Race2' }));
  const rq4 = await reqOf(r.data._id);
  const race2 = await Promise.all([call('IMP', 'POST', `${RC}/${rq4._id}/approve`, {}), call('MD', 'POST', `${RC}/${rq4._id}/reject`, { reason: 'No way' })]);
  const fin4 = await RateChangeRequest.findById(rq4._id).lean();
  check('A27 approve vs reject at once → exactly one decision stands, consistent with the vendor rate', race2.filter((x) => x.status === 200).length === 1 && ['APPROVED', 'REJECTED'].includes(fin4.status)
    && ((await vendorRow(V1, A('RC4'))).rate === (fin4.status === 'APPROVED' ? 99 : 100)), race2.map((x) => `${x.status} ${x.message}`).join(' | '));
  // Rejection follows the existing workflow, by either approver.
  ind = await readyIndent('A5', 'RC5', V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 130, rateChangeReason: 'Reject me' }));
  const rq5 = await reqOf(r.data._id);
  const refKey5 = `rate-change:${rq5._id}`;
  r = await call('IMP', 'POST', `${RC}/${rq5._id}/reject`, { reason: 'Not agreed with vendor' });
  check('A28 imp@ rejects → 200', r.status === 200 && r.data.status === 'REJECTED', `${r.status} ${r.message}`);
  const po5 = await poNow(rq5.poId);
  check('A29 existing rejection workflow: vendor untouched, draft line back at 100, line REJECTED', (await vendorRow(V1, A('RC5'))).rate === 100 && po5.items[0].rate === 100 && po5.items[0].rateChangeStatus === 'REJECTED', JSON.stringify(po5.items[0]));
  check('A30 the MD\'s notification settled; the MD cannot act afterwards (409)', await unread(users.MD._id, refKey5) === 0
    && (await call('MD', 'POST', `${RC}/${rq5._id}/approve`, {})).status === 409);
  const ev5 = await eventsOf(rq5._id);
  check('A31 audit: REJECTED by imp@ with the reason', ev5.some((e) => e.event === 'REJECTED' && e.actorName === USERS.IMP.name && e.rejectionReason === 'Not agreed with vendor'));
  // Maker-checker.
  ind = await readyIndent('A6', 'RC6', V1);
  r = await createPo('IMP', ind, V1, () => ({ rate: 101, rateChangeReason: 'imp own change' }));
  const rq6 = await reqOf(r.data._id);
  r = await call('IMP', 'POST', `${RC}/${rq6._id}/approve`, {});
  check('A32 maker-checker: imp@ cannot approve a change imp@ raised (403)', r.status === 403 && /another approver/.test(r.message), `${r.status} ${r.message}`);
  check('A33 …the MD is told (notified) and imp@ is not', await unread(users.MD._id, `rate-change:${rq6._id}`) === 1 && await unread(users.IMP._id, `rate-change:${rq6._id}`) === 0);
  r = await call('MD', 'POST', `${RC}/${rq6._id}/approve`, {});
  check('A34 …the MD can approve it', r.status === 200, `${r.status} ${r.message}`);
  // the PO still approves normally afterwards (ordinary approver)
  r = await approvePo('POAPPR', rq1.poId);
  check('A35 a rate-approved PO then approves normally (existing PO approval)', r.status === 200 && r.data.approvalStatus === 'APPROVED', `${r.status} ${r.message}`);

  // ── U: unit change ──
  console.log('\nU  Unit change → the same shared approval');
  const U1 = A('UN1');
  let vr = await ok('BUYER', 'GET', `${RC}/vendor-rate?vendorId=${V1}&skuCode=${U1}&unit=PCS`);
  check('U1 fetching a Pcs line when the vendor prices per Kgs offers a unit change (one priced row)', vr.found === false && vr.problem === 'UNIT_MISMATCH'
    && vr.unitChange?.unit === 'Kgs' && vr.unitChange?.rate === 100 && /needs approval/.test(vr.message), JSON.stringify(vr));
  vr = await ok('BUYER', 'GET', `${RC}/vendor-rate?vendorId=${V1}&skuCode=${A('UM')}&unit=PCS`);
  check('U2 two priced rows in other units → no unit change offered (Vendor Master fix)', vr.unitChange === null && vr.problem === 'UNIT_MISMATCH', JSON.stringify(vr));
  ind = await readyIndent('U1', 'UM', V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 5, rateChangeReason: 'x' }));
  check('U3 …and saving such a line is refused (400) as before', r.status === 400 && /per Kgs \/ Box/.test(r.message), `${r.status} ${r.message}`);
  ind = await readyIndent('U2', 'UN1', V1);
  const poCount = await VendorPurchaseOrder.countDocuments({});
  r = await createPo('BUYER', ind, V1, () => ({ rate: 5 }));
  check('U4 a unit change without a reason is refused (400) and says so', r.status === 400 && /reason/i.test(r.message) && /unit/i.test(r.message), `${r.status} ${r.message}`);
  check('U5 …saving nothing', await VendorPurchaseOrder.countDocuments({}) === poCount);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 0, rateChangeReason: 'x' }));
  check('U6 a unit change needs the rate for the new unit (400)', r.status === 400 && /Enter the rate per/.test(r.message), `${r.status} ${r.message}`);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 5, rateChangeReason: 'Vendor now sells per piece' }));
  check('U7 with a reason → 201', r.status === 201, `${r.status} ${r.message}`);
  const poU1 = r.data;
  const ru1 = await reqOf(poU1._id);
  check('U8 one PENDING request: RATE_UNIT, Kgs 100 → Pcs 5', ru1.status === 'PENDING' && ru1.changeType === 'RATE_UNIT' && ru1.existingVendorUnit === 'Kgs'
    && ru1.requestedUnit === 'PCS' && ru1.existingVendorRate === 100 && ru1.requestedRate === 5, JSON.stringify(ru1));
  const refU1 = `rate-change:${ru1._id}`;
  const um = await ok('MD', 'GET', `${RC}?status=PENDING`);
  const ui = await ok('IMP', 'GET', `${RC}?status=PENDING`);
  const rowM = um.rows.find((x) => x._id === idOf(ru1));
  check('U9 in BOTH approvers\' list with the unit change and no cross-unit difference', rowM && ui.rows.some((x) => x._id === idOf(ru1)) && rowM.changeType === 'RATE_UNIT' && rowM.diffAmount === null, JSON.stringify(rowM));
  check('U10 both notified ("Rate & unit change … awaits approval")', await unread(users.IMP._id, refU1) === 1 && await unread(users.MD._id, refU1) === 1
    && /Rate & unit change/.test((await Notification.findOne({ userId: users.IMP._id, refKey: refU1 }).lean())?.title || ''));
  check('U11 unapproved: vendor row still Kgs / 100', (await vendorRow(V1, U1)).unit === 'Kgs' && (await vendorRow(V1, U1)).rate === 100);
  r = await approvePo('POAPPR', poU1._id);
  check('U12 the PO cannot be approved while the unit change is pending', r.status === 400 && /unit change|Purchase Approval/i.test(r.message), `${r.status} ${r.message}`);
  r = await call('VIEWER', 'POST', `${RC}/${ru1._id}/approve`, {});
  check('U13 unauthorized cannot approve a unit change (403)', r.status === 403);
  r = await call('MD', 'POST', `${RC}/${ru1._id}/approve`, {});
  check('U14 the MD approves → 200', r.status === 200 && r.data.status === 'APPROVED', `${r.status} ${r.message}`);
  const rowU1 = await vendorRow(V1, U1);
  check('U15 approved change is effective: the vendor row is now Pcs / 5', rowU1.unit === 'PCS' && rowU1.rate === 5, JSON.stringify(rowU1));
  check('U16 pricing history records the new unit and rate', !!(await PricingHistory.findOne({ vendorId: V1, skuCode: U1, source: 'RATE_CHANGE_APPROVAL', unit: 'PCS', newRate: 5 }).lean()));
  check('U17 imp@ cleared and refused afterwards (409, names the MD)', await unread(users.IMP._id, refU1) === 0
    && (await call('IMP', 'POST', `${RC}/${ru1._id}/approve`, {})).status === 409);
  const evU1 = await eventsOf(ru1._id);
  check('U18 audit: APPROVED by the MD with the unit change', evU1.some((e) => e.event === 'APPROVED' && e.actorName === USERS.MD.name && e.previousUnit === 'Kgs' && e.newUnit === 'PCS' && e.changeType === 'RATE_UNIT'), JSON.stringify(evU1.map((e) => [e.event, e.previousUnit, e.newUnit])));
  r = await approvePo('POAPPR', poU1._id);
  check('U19 the PO then approves normally', r.status === 200 && r.data.approvalStatus === 'APPROVED', `${r.status} ${r.message}`);
  // Unit only (same number).
  ind = await readyIndent('U3', 'UN2', V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 100, rateChangeReason: 'Same price, per piece' }));
  const ru2 = await reqOf(r.data._id);
  check('U20 the same number in another unit is a UNIT change', ru2?.changeType === 'UNIT', JSON.stringify(ru2));
  r = await call('IMP', 'POST', `${RC}/${ru2._id}/approve`, {});
  check('U21 imp@ approves a unit change → 200; the row is Pcs / 100', r.status === 200 && (await vendorRow(V1, A('UN2'))).unit === 'PCS' && (await vendorRow(V1, A('UN2'))).rate === 100, `${r.status} ${r.message}`);
  // Rejection of a unit change.
  ind = await readyIndent('U4', 'UN3', V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 6, rateChangeReason: 'Reject me' }));
  const ru3 = await reqOf(r.data._id);
  r = await call('MD', 'POST', `${RC}/${ru3._id}/reject`, { reason: 'Keep per Kgs' });
  const po3 = await poNow(ru3.poId);
  check('U22 reject → vendor row untouched (Kgs / 100)', r.status === 200 && (await vendorRow(V1, A('UN3'))).unit === 'Kgs' && (await vendorRow(V1, A('UN3'))).rate === 100, `${r.status} ${r.message}`);
  check('U23 …the PO line is left as it is (Pcs, line REJECTED) — never silently converted', po3.items[0].unit === 'PCS' && po3.items[0].rate === 6 && po3.items[0].rateChangeStatus === 'REJECTED', JSON.stringify(po3.items[0]));
  r = await approvePo('POAPPR', ru3.poId);
  check('U24 …so the PO cannot be approved until its doer fixes the line', r.status === 400, `${r.status} ${r.message}`);
  // Stale unit.
  ind = await readyIndent('U5', 'UN4', V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 7, rateChangeReason: 'Stale' }));
  const ru4 = await reqOf(r.data._id);
  await Vendor.updateOne({ _id: v1._id, 'products.skuCode': A('UN4') }, { $set: { 'products.$.unit': 'Box' } });
  r = await call('IMP', 'POST', `${RC}/${ru4._id}/approve`, {});
  check('U25 the vendor row\'s unit moved after the request → approval refused (409), nothing applied, still PENDING', r.status === 409
    && (await RateChangeRequest.findById(ru4._id).lean()).status === 'PENDING' && (await vendorRow(V1, A('UN4'))).unit === 'Box', `${r.status} ${r.message}`);
  await Vendor.updateOne({ _id: v1._id, 'products.skuCode': A('UN4') }, { $set: { 'products.$.unit': 'Kgs' } });
  r = await call('MD', 'POST', `${RC}/${ru4._id}/reject`, { reason: 'Tidy up' });
  check('U26 (the MD rejects it to close it)', r.status === 200);
  // Reverting the draft withdraws the request.
  ind = await readyIndent('U6', 'UN5', V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 8, rateChangeReason: 'Withdraw' }));
  const poU6 = r.data;
  const ru6 = await reqOf(poU6._id);
  const refU6 = `rate-change:${ru6._id}`;
  r = await call('BUYER', 'PATCH', `${PO}/${poU6._id}`, { items: poU6.items.map((l) => ({ indentId: l.indentId, indentItemId: l.indentItemId, itemName: l.itemName, skuCode: l.skuCode, skuId: l.skuId, quantity: l.quantity, unit: 'Kgs', rate: 100, gstRate: l.gstRate })) });
  check('U27 editing the line back to the vendor\'s unit + rate → request WITHDRAWN, approvers\' notification settled', r.status === 200
    && (await RateChangeRequest.findById(ru6._id).lean()).status === 'WITHDRAWN' && await unread(users.IMP._id, refU6) === 0 && await unread(users.MD._id, refU6) === 0, `${r.status} ${r.message}`);

  // ── N: a PO for a NEW vendor ──
  console.log('\nN  New-vendor PO → the MD or the purchase approver');
  const NV1 = await newVendor('1');
  const nv1 = await Vendor.findById(NV1._id).lean();
  const rule = await mongoose.connection.collection('purchaseapprovalconfigs').findOne({ key: 'DEFAULT' });
  check('N0 the rule start is stamped and the new vendor was created after it', rule && nv1.createdAt >= rule.newVendorRuleFrom && v1.createdAt < rule.newVendorRuleFrom, `${rule?.newVendorRuleFrom} / ${nv1.createdAt}`);
  const mkNv = async (label, vendor, who = 'BUYER', extra = {}) => {
    const i = await readyIndent(label, 'NV', vendor._id);
    return createPo(who, i, vendor._id, () => ({ rate: 50 }), extra);
  };
  r = await mkNv('N1', NV1);
  check('N1 BUYER raises a PO on the new vendor → 201', r.status === 201, `${r.status} ${r.message}`);
  const poN1 = r.data;
  let pn1 = await poNow(poN1._id);
  check('N2 stamped as a new-vendor PO with the Vendor Master creation date', pn1.newVendorApproval?.isRequired === true && pn1.newVendorApproval.reason === 'NEW_VENDOR'
    && new Date(pn1.newVendorApproval.vendorCreatedAt).getTime() === new Date(nv1.createdAt).getTime(), JSON.stringify(pn1.newVendorApproval));
  // Two more POs on the same (still new) vendor BEFORE the first is approved.
  const poN2 = (await mkNv('N1b', NV1)).data;
  const poN3 = (await mkNv('N1c', NV1)).data;
  const refN1 = `po-approval:${poN1._id}`;
  const pm = await ok('MD', 'GET', `${RC}/po-approvals?status=PENDING`);
  const pi = await ok('IMP', 'GET', `${RC}/po-approvals?status=PENDING`);
  check('N3 the request is in BOTH approvers\' Purchase Approval (New Vendor POs) list', pm.rows.some((x) => x._id === idOf(poN1._id)) && pi.rows.some((x) => x._id === idOf(poN1._id)));
  const rowN = pi.rows.find((x) => x._id === idOf(poN1._id));
  check('N4 each can decide it (canDecide true for imp@ and the MD)', rowN?.canDecide === true && pm.rows.find((x) => x._id === idOf(poN1._id))?.canDecide === true && pi.canApprove === true && pm.canApprove === true, JSON.stringify(rowN));
  check('N5 pending counts equal for both', pm.summary.PENDING === pi.summary.PENDING && pm.summary.PENDING >= 3, `${pm.summary.PENDING}/${pi.summary.PENDING}`);
  check('N6 notified: imp@ AND the MD, not the buyer', await unread(users.IMP._id, refN1) === 1 && await unread(users.MD._id, refN1) === 1 && await unread(users.BUYER._id, refN1) === 0);
  const nn = await Notification.findOne({ userId: users.IMP._id, refKey: refN1 }).lean();
  check('N7 the notification opens the New Vendor POs tab on that PO', nn?.link === `/purchase-fms/rate-change-approvals?tab=new-vendor&po=${idOf(poN1._id)}` && /New-vendor PO/.test(nn.title), JSON.stringify(nn));
  const vb = await ok('VIEWER', 'GET', `${RC}/po-approvals?status=PENDING`);
  check('N8 anyone signed in can read the list; canDecide false for a viewer', vb.canApprove === false && vb.rows.every((x) => x.canDecide === false));
  const det = await ok('MD', 'GET', `${RC}/po-approvals/${poN1._id}`);
  check('N9 detail: the Vendor Master record (created date/by), lines, who submitted', det.vendor?.name === NV1.name && !!det.vendor.createdAt && det.vendor.createdByName === USERS.BUYER.name
    && det.items.length === 1 && det.events.some((e) => e.action === 'CREATE' && e.actorName === USERS.BUYER.name), JSON.stringify(det).slice(0, 400));
  // Permission matrix
  r = await approvePo('POAPPR', poN1._id);
  check('N10 procurement.approve alone cannot decide a new-vendor PO (403)', r.status === 403 && /new vendor/i.test(r.message), `${r.status} ${r.message}`);
  r = await rejectPo('POAPPR', poN1._id);
  check('N11 …nor reject it (403)', r.status === 403);
  r = await approvePo('VIEWER', poN1._id);
  check('N12 an unauthorized user cannot (403)', r.status === 403);
  r = await approvePo('BUYER', poN1._id);
  check('N13 the maker (buyer) cannot (403)', r.status === 403);
  check('N14 nothing changed so far', (await poNow(poN1._id)).approvalStatus === 'DRAFT');
  // imp@ approves
  r = await approvePo('IMP', poN1._id);
  check('N15 imp@ approves (no procurement.approve needed) → 200, PO number minted', r.status === 200 && r.data.approvalStatus === 'APPROVED' && !!r.data.poNumber, `${r.status} ${r.message}`);
  pn1 = await poNow(poN1._id);
  check('N16 decided by imp@ — id, name, time on the PO; APPROVE in the timeline', idOf(pn1.approval.decidedById) === idOf(users.IMP._id) && pn1.approval.decidedBy === USERS.IMP.name && pn1.approval.decidedAt
    && pn1.activityTimeline.some((t) => t.action === 'APPROVE' && idOf(t.actorId) === idOf(users.IMP._id)), JSON.stringify(pn1.approval));
  const pm2 = await ok('MD', 'GET', `${RC}/po-approvals?status=PENDING`);
  check('N17 gone from the MD\'s pending list at once; MD notification settled', !pm2.rows.some((x) => x._id === idOf(poN1._id)) && await unread(users.MD._id, refN1) === 0 && await unread(users.IMP._id, refN1) === 0);
  const pa = await ok('MD', 'GET', `${RC}/po-approvals?status=APPROVED`);
  check('N18 the MD sees it Approved by imp@', pa.rows.some((x) => x._id === idOf(poN1._id) && x.decidedBy === USERS.IMP.name && x.status === 'APPROVED'));
  r = await approvePo('MD', poN1._id);
  check('N19 the MD cannot approve it again (400, names imp@)', r.status === 400 && r.message.includes(USERS.IMP.name), `${r.status} ${r.message}`);
  r = await rejectPo('MD', poN1._id);
  check('N20 …nor reject it', r.status === 400 && r.message.includes(USERS.IMP.name) && (await poNow(poN1._id)).approvalStatus === 'APPROVED', `${r.status} ${r.message}`);
  check('N21 the buyer is told who approved', !!(await Notification.findOne({ userId: users.BUYER._id, title: /approved/i, body: new RegExp(USERS.IMP.name) }).lean()));
  // Simultaneous decisions on the next one (still stamped required — raised while the vendor was new).
  const pn2 = await poNow(poN2._id);
  check('N22 a second PO raised before the first was approved is stamped too', pn2.newVendorApproval?.isRequired === true);
  r = await approvePo('POAPPR', poN2._id);
  check('N23 …and still needs the MD / purchase approver (403 for procurement.approve)', r.status === 403);
  const race3 = await Promise.all([approvePo('IMP', poN2._id), approvePo('MD', poN2._id)]);
  check('N24 both approve at once → exactly ONE succeeds', race3.filter((x) => x.status === 200).length === 1 && race3.filter((x) => x.status === 400).length === 1, race3.map((x) => `${x.status} ${x.message}`).join(' | '));
  const pn2b = await poNow(poN2._id);
  const winner = race3[0].status === 200 ? users.IMP : users.MD;
  check('N25 the PO records the actual winner, one PO number, one APPROVE entry', idOf(pn2b.approval.decidedById) === idOf(winner._id) && !!pn2b.poNumber && pn2b.activityTimeline.filter((t) => t.action === 'APPROVE').length === 1, JSON.stringify(pn2b.approval));
  // Rejection by the MD → follows the existing PO rejection; imp@ cannot act afterwards.
  r = await rejectPo('MD', poN3._id);
  check('N26 the MD rejects → 200, REJECTED (existing rejection workflow)', r.status === 200 && r.data.approvalStatus === 'REJECTED', `${r.status} ${r.message}`);
  const pn3 = await poNow(poN3._id);
  check('N27 the rejection records the MD', idOf(pn3.approval.decidedById) === idOf(users.MD._id) && pn3.activityTimeline.some((t) => t.action === 'REJECT' && idOf(t.actorId) === idOf(users.MD._id)));
  r = await approvePo('IMP', poN3._id);
  check('N28 imp@ cannot approve a PO the MD rejected (400)', r.status === 400 && r.message.includes(USERS.MD.name), `${r.status} ${r.message}`);
  check('N29 the Rejected list has it', (await ok('IMP', 'GET', `${RC}/po-approvals?status=REJECTED`)).rows.some((x) => x._id === idOf(poN3._id)));
  // The vendor is vetted by its first approved PO.
  r = await mkNv('N30', NV1);
  const pnAfter = await poNow(r.data._id);
  check('N30 after its first approved PO the vendor is an ordinary vendor: a later PO is not stamped', r.status === 201 && pnAfter.newVendorApproval?.isRequired === false && pnAfter.newVendorApproval.reason === 'ALREADY_APPROVED_PO', JSON.stringify(pnAfter.newVendorApproval));
  r = await approvePo('POAPPR', pnAfter._id);
  check('N31 …and procurement.approve decides it as usual', r.status === 200, `${r.status} ${r.message}`);
  // Existing vendors.
  ind = await readyIndent('N32', 'OK', V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 60 }));
  const pEx = await poNow(r.data._id);
  check('N32 an existing vendor\'s PO is NOT a new-vendor PO', pEx.newVendorApproval?.isRequired === false && pEx.newVendorApproval.reason === 'CREATED_BEFORE_RULE', JSON.stringify(pEx.newVendorApproval));
  check('N33 …and is not in the New Vendor POs list', !(await ok('MD', 'GET', `${RC}/po-approvals`)).rows.some((x) => x._id === idOf(pEx._id)));
  check('N34 …no approver is notified of it', await unread(users.IMP._id, `po-approval:${pEx._id}`) === 0 && await unread(users.MD._id, `po-approval:${pEx._id}`) === 0);
  r = await approvePo('IMP', pEx._id);
  check('N35 …and imp@ does not gain approval of ordinary POs (403, needs procurement.approve)', r.status === 403 && /procurement\.approve/.test(r.message), `${r.status} ${r.message}`);
  r = await approvePo('POAPPR', pEx._id);
  check('N36 …the ordinary approver decides it as before', r.status === 200, `${r.status} ${r.message}`);
  // A legacy vendor with no purchase history at all is not "new".
  const ind0 = await readyIndent('N37', 'OK', v0._id);
  r = await createPo('BUYER', ind0, v0._id, () => ({ rate: 61 }));
  const p0 = await poNow(r.data._id);
  check('N37 a vendor with NO purchase history but created before the rule is not new', r.status === 201 && p0.newVendorApproval?.isRequired === false && p0.newVendorApproval.reason === 'CREATED_BEFORE_RULE', JSON.stringify(p0.newVendorApproval));
  // Draft vs submitted.
  const NV4 = await newVendor('4');
  const ind4 = await readyIndent('N38', 'NV', NV4._id);
  r = await createPo('BUYER', ind4, NV4._id, () => ({ rate: 50 }), { saveMode: 'DRAFT' });
  const pDraft = r.data;
  check('N38 a saved-as-draft new-vendor PO is not a request yet: not listed, nobody notified', !(await ok('IMP', 'GET', `${RC}/po-approvals`)).rows.some((x) => x._id === idOf(pDraft._id))
    && await unread(users.IMP._id, `po-approval:${pDraft._id}`) === 0 && await unread(users.MD._id, `po-approval:${pDraft._id}`) === 0);
  r = await approvePo('IMP', pDraft._id);
  check('N39 …and cannot be approved before it is submitted (400)', r.status === 400 && /not been submitted/.test(r.message), `${r.status} ${r.message}`);
  r = await call('BUYER', 'POST', `${PO}/${pDraft._id}/submit`, {});
  check('N40 submitting it makes it a request: listed, both approvers notified', r.status === 200
    && (await ok('IMP', 'GET', `${RC}/po-approvals?status=PENDING`)).rows.some((x) => x._id === idOf(pDraft._id))
    && await unread(users.IMP._id, `po-approval:${pDraft._id}`) === 1 && await unread(users.MD._id, `po-approval:${pDraft._id}`) === 1, `${r.status} ${r.message}`);
  r = await rejectPo('IMP', pDraft._id);
  check('N41 imp@ rejects it → REJECTED, both notifications settled', r.status === 200 && r.data.approvalStatus === 'REJECTED'
    && await unread(users.MD._id, `po-approval:${pDraft._id}`) === 0, `${r.status} ${r.message}`);
  // MD direct save = the MD's own approval.
  const NV2 = await newVendor('2');
  const ind2 = await readyIndent('N42', 'NV', NV2._id);
  r = await createPo('MD', ind2, NV2._id, () => ({ rate: 50 }), { saveMode: 'DIRECT' });
  const pDirect = r.data && await poNow(r.data._id);
  check('N42 the MD saving a new-vendor PO directly approves it (one approval is enough)', r.status === 201 && pDirect.approvalStatus === 'APPROVED' && pDirect.newVendorApproval?.isRequired === true
    && idOf(pDirect.approval.decidedById) === idOf(users.MD._id), `${r.status} ${r.message}`);
  check('N43 …and imp@ gets no stale request for it', await unread(users.IMP._id, `po-approval:${pDirect._id}`) === 0);
  // Maker-checker for the purchase approver.
  const NV3 = await newVendor('3', 'IMP');
  const ind3 = await readyIndent('N44', 'NV', NV3._id);
  r = await createPo('IMP', ind3, NV3._id, () => ({ rate: 50 }));
  const pImp = r.data;
  r = await approvePo('IMP', pImp._id);
  check('N44 imp@ cannot approve a new-vendor PO imp@ prepared (maker-checker 403)', r.status === 403 && /prepared/i.test(r.message), `${r.status} ${r.message}`);
  check('N45 …the MD is told (not imp@), and the PO row says why imp@ cannot decide', await unread(users.MD._id, `po-approval:${pImp._id}`) === 1 && await unread(users.IMP._id, `po-approval:${pImp._id}`) === 0
    && (await ok('IMP', 'GET', `${RC}/po-approvals?status=PENDING`)).rows.find((x) => x._id === idOf(pImp._id))?.canDecide === false);
  r = await approvePo('MD', pImp._id);
  check('N46 the MD approves it', r.status === 200, `${r.status} ${r.message}`);

  console.log(`\n${passes} passed, ${failures} failed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
};

// ── Leave pending data for the browser probe ───────────────────────────────
const prepUi = async () => {
  await connect();
  await login();
  const v1 = await Vendor.findOne({ code: VENDORS.V1.code }).lean();
  const V1 = String(v1._id);
  const out = {};
  // The browser probe APPROVES these rows' requests, so put the three catalog rows back first (re-runnable).
  const resetRow = (key, unit, rate) => Vendor.updateOne({ _id: v1._id, 'products.skuCode': SKUS[key].code }, { $set: { 'products.$.unit': unit, 'products.$.rate': rate } });
  await resetRow('RC7', 'Pcs', 100); await resetRow('UN6', 'Kgs', 100); await resetRow('UN7', 'Kgs', 100);
  // A pending rate change and a pending unit change, both by the buyer.
  let ind = await readyIndent('UI-RC', 'RC7', V1);
  let r = await createPo('BUYER', ind, V1, () => ({ rate: 133, rateChangeReason: 'UI probe rate change' }));
  out.rateRequestId = idOf((await reqOf(r.data._id))._id);
  ind = await readyIndent('UI-UN', 'UN6', V1);
  r = await createPo('BUYER', ind, V1, () => ({ rate: 9, rateChangeReason: 'UI probe unit change' }));
  out.unitRequestId = idOf((await reqOf(r.data._id))._id);
  // A pending new-vendor PO and one to leave decided.
  const NV = await newVendor(`ui-${RUN}`);
  const indN = await readyIndent('UI-NV', 'NV', NV._id);
  r = await createPo('BUYER', indN, NV._id, () => ({ rate: 50 }));
  out.newVendorPoId = idOf(r.data._id);
  out.newVendorName = NV.name;
  // An approved indent for a Kgs-priced item, left WITHOUT a PO: the browser creates the PO in PCS (a unit change).
  const indU = await readyIndent('UI-UNPO', 'UN7', V1);
  out.unitPo = { indentId: idOf(indU._id), indentNumber: indU.indentNumber, itemRef: indU.indentNumber.replace(/\/(?=[^/]*$)/, '.1/') };
  out.users = Object.fromEntries(Object.entries(USERS).map(([k, u]) => [k, u.email]));
  out.password = PASSWORD;
  const file = new URL('../../../frontend/e2e/shots/dual-approval-manifest.json', import.meta.url);
  fs.mkdirSync(path.dirname(file.pathname.replace(/^\/([A-Za-z]:)/, '$1')), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`[prep-ui] wrote ${file.pathname}\n${JSON.stringify(out, null, 2)}`);
  await mongoose.disconnect();
};

if (isEntry(import.meta.url)) {
  const arg = process.argv[2];
  const run = arg === '--seed' ? seed : arg === '--api' ? api : arg === '--prep-ui' ? prepUi : null;
  if (!run) {
    console.error('usage: node src/scripts/e2eDualApprovalFixture.js --seed | --api | --prep-ui');
    process.exit(2);
  }
  run().then(() => { if (arg === '--seed') mongoose.disconnect(); }).catch((err) => { console.error(err); process.exit(1); });
}
