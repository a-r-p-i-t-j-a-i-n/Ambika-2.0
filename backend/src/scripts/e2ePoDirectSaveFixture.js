/**
 * API oracle for "Save PO Directly" being MD-only (purchase-order/poDirectSave.js).
 *
 *   node src/scripts/e2ePoDirectSaveFixture.js --seed   upsert users + vendors (never drops)
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5096 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_podirect node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5096/api/v1 node src/scripts/e2ePoDirectSaveFixture.js --api
 *
 * Users: MD (roles ['MD']); BUYER (PLANNER + a procurement.approve grant — could
 * save directly before this rule); VIEWER; EXMD (MD role removed, stale legacy
 * role 'MD'). The MD prepares PO-ready indents; each check then calls the PO
 * routes as the user under test. --api creates fresh indents on every run, so it
 * can be re-run without reseeding. Checks:
 *   M  MD direct save on both create routes: APPROVED + final number, audit,
 *      indent linked + synced; MD draft stays a draft; release still works.
 *   N  Non-MD direct save refused (403, message) on both routes, whatever the
 *      permissions, stale role, or client-sent role/headers; nothing created.
 *   D  Non-MD draft: created as DRAFT, editable, cannot be approved by an edit,
 *      cannot be released; the existing approval step approves it.
 *   V  Vendor / validation rules still apply to an MD direct save.
 *   R  Revise: non-MD DIRECT 403, MD DIRECT 400, a draft revision still works.
 *   A  No token → 401.
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard
 * (S3 + email off). Never reads MONGO_URI. Nothing here drops or resets a DB.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import SKU from '../modules/skus/sku.model.js';

export const DB_NAME = 'ambika_e2e_podirect';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2ePoDirectSaveFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5096/api/v1').replace(/\/+$/, '');
const PASSWORD = 'E2e@12345';
export const USERS = {
  MD:     { email: 'podirect-md@test.local',     name: 'E2E PO MD',      role: 'MD', roles: ['MD'],      permissionGrants: [],                      mobile: '9000000081' },
  BUYER:  { email: 'podirect-buyer@test.local',  name: 'E2E PO Buyer',   role: 'EA', roles: ['PLANNER'], permissionGrants: ['procurement.approve'], mobile: '9000000082' },
  VIEWER: { email: 'podirect-viewer@test.local', name: 'E2E PO Viewer',  role: 'EA', roles: ['VIEWER'],  permissionGrants: [],                      mobile: '9000000083' },
  EXMD:   { email: 'podirect-exmd@test.local',   name: 'E2E PO Ex-MD',   role: 'MD', roles: ['VIEWER'],  permissionGrants: [],                      mobile: '9000000084' },
};
const VENDORS = [
  { code: 'PD-ALPHA', name: 'PD Alpha Traders', isActive: true },
  { code: 'PD-BETA', name: 'PD Beta Supplies', isActive: true },
];
const RUN = Date.now().toString(36);
const MD_ONLY = 'Only the MD can save a PO directly — save it as a draft and submit it for approval';

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

// ── Seed (idempotent upserts — never drops) ────────────────────────────────
const seed = async () => {
  await connect();
  for (const u of Object.values(USERS)) {
    const { role, roles, permissionGrants, ...rest } = u;
    if (!await User.findOne({ email: u.email })) {
      await User.create({ ...rest, password: PASSWORD, role, roles, permissionGrants, isActive: true });
    }
    // Re-assert the identity under test on every seed (a reseed must not drift).
    await User.updateOne({ email: u.email }, { $set: { role, roles, permissionGrants, permissionDenies: [], isActive: true } });
  }
  for (const v of VENDORS) {
    await Vendor.updateOne({ code: v.code }, { $set: { name: v.name, isActive: v.isActive, isDeleted: false } }, { upsert: true });
  }
  console.log(`[seed] ${DB_NAME}: users ${Object.values(USERS).map((u) => u.email).join(', ')} / ${PASSWORD}; vendors ${VENDORS.map((v) => v.name).join(', ')}`);
};

// ── HTTP helpers ───────────────────────────────────────────────────────────
const tokens = {};
const call = async (who, method, path, body, headers = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(who && tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data: json?.data, message: json?.message || '' };
};
const ok = async (who, method, path, body) => {
  const r = await call(who, method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${r.message}`);
  return r.data;
};

const skuItem = async (name, quantity) => {
  const code = `E2E-${name}`.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 60);
  const sku = await SKU.findOneAndUpdate({ code }, { $setOnInsert: { code, name, unit: 'PCS', itemType: 'CONSUMABLE' } }, { upsert: true, new: true }).lean();
  return { skuId: String(sku._id), skuCode: sku.code, itemName: sku.name, quantity, unit: 'Pcs' };
};

// A PO-ready indent (quotation not required), every item's vendor fixed to `vendorId`.
let seq = 0;
const readyIndent = async (label, vendorId) => {
  seq += 1;
  const ind = await ok('MD', 'POST', '/procurement/indents', {
    department: 'Stores', remarks: `po-direct-save e2e ${RUN}`,
    items: [await skuItem(`PD ${label} ${RUN}-${seq}`, 10)],
  });
  await ok('MD', 'POST', `/procurement/indents/${ind._id}/submit`, {});
  const approved = await ok('MD', 'POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
  await ok('MD', 'POST', `/procurement/indents/${ind._id}/quote-comparative`, {
    statusDone: 'QUOTE_NOT_REQUIRED',
    itemQuotations: approved.items.map((it) => ({ itemId: it._id, itemName: it.itemName, statusDone: 'QUOTE_NOT_REQUIRED', quotationDocuments: [] })),
  });
  for (const it of approved.items) {
    await ok('MD', 'PATCH', '/procurement/purchase-orders/approved-items/vendor', { indentId: ind._id, indentItemId: it._id, vendorId });
  }
  return PurchaseIndent.findById(ind._id).lean();
};

const due = () => new Date(Date.now() + 7 * 864e5).toISOString();
const line = (indent, it, extra = {}) => ({
  indentId: indent._id, indentItemId: it._id, itemName: it.itemName, skuCode: it.skuCode, skuId: it.skuId,
  quantity: it.approvedQuantity || it.quantity, unit: it.unit, rate: 100, gstRate: 18, ...extra,
});
const fromItems = (who, indent, vendorId, saveMode, extra = {}) => call(who, 'POST', '/procurement/purchase-orders/create-from-items', {
  vendorId, expectedDeliveryDate: due(), items: indent.items.map((it) => line(indent, it)), ...(saveMode ? { saveMode } : {}), ...extra,
});
const single = (who, indent, vendorId, saveMode, extra = {}) => call(who, 'POST', '/procurement/purchase-orders', {
  indentId: indent._id, vendorId, expectedDeliveryDate: due(), items: indent.items.map((it) => line(indent, it)), ...(saveMode ? { saveMode } : {}), ...extra,
});
const posOn = (indent) => VendorPurchaseOrder.countDocuments({ indentIds: indent._id, isDeleted: { $ne: true } });
const poNow = (id) => VendorPurchaseOrder.findById(id).lean();
const indentNow = (id) => PurchaseIndent.findById(id).lean();
const isDraft = (po) => po && po.approvalStatus === 'DRAFT' && po.poStatus === 'DRAFT' && !po.poNumber && !po.approval?.decidedAt;
const refused = (r) => r.status === 403 && r.message === MD_ONLY;

// ── API checks ─────────────────────────────────────────────────────────────
const api = async () => {
  await connect();
  for (const [key, u] of Object.entries(USERS)) {
    const login = await call(null, 'POST', '/auth/login', { email: u.email, password: PASSWORD });
    tokens[key] = login.data?.token || '';
    if (!tokens[key]) throw new Error(`login ${u.email} failed: ${login.status} ${login.message} — run --seed first`);
  }
  const [alpha, beta] = await Promise.all(VENDORS.map((v) => Vendor.findOne({ code: v.code }).lean()));
  const A = String(alpha._id);
  const B = String(beta._id);
  const users = Object.fromEntries(await Promise.all(Object.entries(USERS).map(async ([k, u]) => [k, await User.findOne({ email: u.email }).lean()])));
  console.log(`run ${RUN} against ${API}`);
  const exmd = users.EXMD;
  check('S1 Ex-MD fixture still carries the stale legacy role (roles VIEWER, role MD)', exmd.role === 'MD' && exmd.roles.join() === 'VIEWER', JSON.stringify({ role: exmd.role, roles: exmd.roles }));
  check('S2 Buyer holds procurement.approve (the old direct-save gate)', users.BUYER.permissionGrants.includes('procurement.approve'));

  // ── M: MD direct save ──
  console.log('\nM  MD — Save PO Directly');
  const m1 = await readyIndent('M1', A);
  const mItems = await fromItems('MD', m1, A, 'DIRECT');
  const mPo = await poNow(mItems.data?._id);
  check('M1 MD create-from-items DIRECT → 201', mItems.status === 201, `${mItems.status} ${mItems.message}`);
  check('M2 PO is APPROVED with a final PO number', mPo?.approvalStatus === 'APPROVED' && mPo?.poStatus === 'APPROVED' && !!mPo?.poNumber && !!mPo?.draftNumber, JSON.stringify({ a: mPo?.approvalStatus, s: mPo?.poStatus, n: mPo?.poNumber }));
  check('M3 response message names the approved PO', mItems.message === `Purchase order ${mPo?.poNumber} created and approved`, mItems.message);
  check('M4 approval recorded against the MD, remark says direct save by the MD',
    String(mPo?.approval?.decidedById) === String(users.MD._id) && mPo?.approval?.remarks === 'Saved directly by the MD — no separate approval step', JSON.stringify(mPo?.approval));
  check('M5 PO timeline: CREATE then APPROVE', mPo?.activityTimeline.map((t) => t.action).join() === 'CREATE,APPROVE', mPo?.activityTimeline.map((t) => t.action).join());
  const m1Now = await indentNow(m1._id);
  check('M6 indent item linked to the PO and synced to the final PO number',
    String(m1Now.items[0].poId) === String(mPo?._id) && m1Now.items[0].poNumber === mPo?.poNumber && m1Now.items[0].procurementStatus === 'PO_CREATED', JSON.stringify({ id: m1Now.items[0].poId, n: m1Now.items[0].poNumber, s: m1Now.items[0].procurementStatus }));
  check('M7 indent timeline: PO_CREATED + PO_APPROVED', ['PO_CREATED', 'PO_APPROVED'].every((a) => m1Now.activityTimeline.some((t) => t.action === a)));
  check('M8 indent status rolled up (PO_READY)', m1Now.overallStatus === 'PO_READY', m1Now.overallStatus);

  const m2 = await readyIndent('M2', A);
  const mSingle = await single('MD', m2, A, 'DIRECT');
  const mSinglePo = await poNow(mSingle.data?._id);
  check('M9 MD single-indent create DIRECT → APPROVED with a final number', mSingle.status === 201 && mSinglePo?.approvalStatus === 'APPROVED' && !!mSinglePo?.poNumber, `${mSingle.status} ${mSingle.message}`);

  const m3 = await readyIndent('M3', A);
  const mDraft = await fromItems('MD', m3, A, 'DRAFT');
  check('M10 MD "Save as Draft" still saves a draft', mDraft.status === 201 && isDraft(await poNow(mDraft.data?._id)), `${mDraft.status} ${mDraft.message}`);
  const m4 = await readyIndent('M4', A);
  const mDefault = await fromItems('MD', m4, A, undefined);
  check('M11 no saveMode defaults to a draft (MD)', mDefault.status === 201 && isDraft(await poNow(mDefault.data?._id)), `${mDefault.status}`);

  const rel = await call('MD', 'POST', `/procurement/purchase-orders/${mPo?._id}/release`, { sendEmail: false });
  const relPo = await poNow(mPo?._id);
  check('M12 a directly saved PO releases normally (downstream follow-up opens)', rel.status === 200 && relPo.poStatus === 'RELEASED_TO_VENDOR' && relPo.followUpStatus === 'PENDING', `${rel.status} ${rel.message}`);

  // ── N: non-MD direct save refused ──
  console.log('\nN  Non-MD — Save PO Directly refused');
  const n1 = await readyIndent('N1', A);
  for (const who of ['BUYER', 'VIEWER', 'EXMD']) {
    const r1 = await fromItems(who, n1, A, 'DIRECT');
    check(`N ${who}: create-from-items DIRECT → 403 "${MD_ONLY.slice(0, 32)}…"`, refused(r1), `${r1.status} ${r1.message}`);
    const r2 = await single(who, n1, A, 'DIRECT');
    check(`N ${who}: single-indent create DIRECT → 403`, refused(r2), `${r2.status} ${r2.message}`);
  }
  const spoofBody = await fromItems('BUYER', n1, A, 'DIRECT', { role: 'MD', roles: ['MD'], isRoot: true, user: { roles: ['MD'] }, approvalStatus: 'APPROVED' });
  check('N client-sent role / roles / isRoot / approvalStatus in the body ignored → 403', refused(spoofBody), `${spoofBody.status} ${spoofBody.message}`);
  const spoofHdr = await call('VIEWER', 'POST', '/procurement/purchase-orders/create-from-items', {
    vendorId: A, expectedDeliveryDate: due(), items: n1.items.map((it) => line(n1, it)), saveMode: 'DIRECT',
  }, { 'X-User-Role': 'MD', 'X-Roles': 'MD' });
  check('N role headers ignored → 403', refused(spoofHdr), `${spoofHdr.status} ${spoofHdr.message}`);
  const spoofCase = await fromItems('BUYER', n1, A, 'direct');
  check('N lower-case "direct" is not a draft loophole → 422 (validation)', spoofCase.status === 422, `${spoofCase.status} ${spoofCase.message}`);
  check('N every refusal created nothing (no PO on the indent)', await posOn(n1) === 0);
  const n1Now = await indentNow(n1._id);
  check('N refused requests left the indent untouched (still PO-ready, item not on a PO)',
    n1Now.overallStatus === 'QUOTATION_APPROVED' && !n1Now.items[0].poId && !n1Now.activityTimeline.some((t) => t.action === 'PO_CREATED'), JSON.stringify({ s: n1Now.overallStatus, p: n1Now.items[0].poId }));

  // ── D: non-MD draft → approval workflow ──
  console.log('\nD  Non-MD — Save as Draft, then PO Approval');
  const dDraft = await fromItems('BUYER', n1, A, 'DRAFT');
  const dPo = await poNow(dDraft.data?._id);
  check('D1 Buyer "Save as Draft" → 201 DRAFT (no final number, no approval)', dDraft.status === 201 && isDraft(dPo), `${dDraft.status} ${dDraft.message}`);
  check('D2 response message is the plain draft message', dDraft.message === 'Purchase order created', dDraft.message);
  check('D3 created by the buyer, timeline CREATE only', String(dPo?.createdBy) === String(users.BUYER._id) && dPo?.activityTimeline.map((t) => t.action).join() === 'CREATE');
  const dInd = await indentNow(n1._id);
  check('D4 indent linked to the draft (item PO_CREATED, ref = draft number)', String(dInd.items[0].poId) === String(dPo?._id) && dInd.items[0].poNumber === dPo?.draftNumber, JSON.stringify({ p: dInd.items[0].poId, n: dInd.items[0].poNumber }));
  const v1 = await call('VIEWER', 'POST', '/procurement/purchase-orders', { ...{ indentId: m3._id }, vendorId: A, expectedDeliveryDate: due(), items: [] });
  check('D5 validation still runs for a non-MD draft (no items → 422)', v1.status === 422, `${v1.status} ${v1.message}`);

  const sneak = await call('BUYER', 'PATCH', `/procurement/purchase-orders/${dPo?._id}`, {
    remarks: 'edited by buyer', approvalStatus: 'APPROVED', poStatus: 'APPROVED', poNumber: 'AGL/PO-HACK', saveMode: 'DIRECT', approval: { decidedById: String(users.MD._id) },
  });
  const sneakPo = await poNow(dPo?._id);
  check('D6 Buyer can edit own draft (200, remarks saved)', sneak.status === 200 && sneakPo.remarks === 'edited by buyer', `${sneak.status} ${sneak.message}`);
  check('D7 an edit cannot approve it — approvalStatus/poStatus/poNumber/approval ignored', isDraft(sneakPo), JSON.stringify({ a: sneakPo.approvalStatus, s: sneakPo.poStatus, n: sneakPo.poNumber, ap: sneakPo.approval }));
  const qtyEdit = await call('BUYER', 'PATCH', `/procurement/purchase-orders/${dPo?._id}`, { items: [line(n1, n1.items[0], { quantity: 4, rate: 50 })] });
  const qtyPo = await poNow(dPo?._id);
  check('D8 draft lines editable (qty 4 × 50 → taxable 200), still a draft', qtyEdit.status === 200 && qtyPo.items[0].quantity === 4 && qtyPo.totalTaxableValue === 200 && isDraft(qtyPo), `${qtyEdit.status} ${qtyEdit.message} taxable=${qtyPo.totalTaxableValue}`);
  const relDraft = await call('BUYER', 'POST', `/procurement/purchase-orders/${dPo?._id}/release`, { sendEmail: false });
  check('D9 a draft cannot be released (400)', relDraft.status === 400 && /approved before/.test(relDraft.message) && isDraft(await poNow(dPo?._id)), `${relDraft.status} ${relDraft.message}`);
  const bulk = await call('BUYER', 'POST', '/procurement/purchase-orders/bulk-release', { poIds: [dPo?._id] });
  check('D10 bulk release does not release a draft', isDraft(await poNow(dPo?._id)), `${bulk.status} ${bulk.message}`);

  const appr = await call('MD', 'POST', `/procurement/purchase-orders/${dPo?._id}/approve`, { decision: 'APPROVED', remarks: 'ok from MD' });
  const apprPo = await poNow(dPo?._id);
  check('D11 existing approval step approves the draft (final number minted)', appr.status === 200 && apprPo.approvalStatus === 'APPROVED' && apprPo.poStatus === 'APPROVED' && !!apprPo.poNumber, `${appr.status} ${appr.message}`);
  check('D12 approval audit: approver, remarks, APPROVE in the timeline',
    String(apprPo.approval?.decidedById) === String(users.MD._id) && apprPo.approval?.remarks === 'ok from MD' && apprPo.activityTimeline.some((t) => t.action === 'APPROVE'));
  check('D13 indent synced to the final PO number', (await indentNow(n1._id)).items[0].poNumber === apprPo.poNumber);
  const again = await call('MD', 'POST', `/procurement/purchase-orders/${dPo?._id}/approve`, { decision: 'APPROVED' });
  check('D14 second approval refused (single-flip guard intact)', again.status === 400 && (await poNow(dPo?._id)).poNumber === apprPo.poNumber, `${again.status} ${again.message}`);
  const editApproved = await call('BUYER', 'PATCH', `/procurement/purchase-orders/${dPo?._id}`, { remarks: 'late edit' });
  check('D15 an approved PO is no longer editable (400)', editApproved.status === 400, `${editApproved.status} ${editApproved.message}`);

  // Rejection keeps it out of release.
  const d2 = await readyIndent('D2', A);
  const rejDraft = await fromItems('VIEWER', d2, A, 'DRAFT');
  const rej = await call('MD', 'POST', `/procurement/purchase-orders/${rejDraft.data?._id}/approve`, { decision: 'REJECTED', remarks: 'no' });
  const rejPo = await poNow(rejDraft.data?._id);
  check('D16 a rejected draft gets no PO number and cannot be released', rej.status === 200 && rejPo.approvalStatus === 'REJECTED' && !rejPo.poNumber
    && (await call('VIEWER', 'POST', `/procurement/purchase-orders/${rejPo._id}/release`, { sendEmail: false })).status === 400, `${rej.status} ${rej.message}`);

  // ── V: vendor / validation rules not bypassed by a direct save ──
  console.log('\nV  Vendor + validation rules on an MD direct save');
  const v = await readyIndent('V1', A);
  const wrongVendor = await fromItems('MD', v, B, 'DIRECT');
  check('V1 MD DIRECT with a vendor other than the fixed one refused (400)', wrongVendor.status === 400 && /vendor/i.test(wrongVendor.message), `${wrongVendor.status} ${wrongVendor.message}`);
  const wrongSingle = await single('MD', v, B, 'DIRECT');
  check('V2 same on the single-indent route', wrongSingle.status === 400, `${wrongSingle.status} ${wrongSingle.message}`);
  const noDate = await call('MD', 'POST', '/procurement/purchase-orders/create-from-items', { vendorId: A, items: v.items.map((it) => line(v, it)), saveMode: 'DIRECT' });
  check('V3 MD DIRECT without Expected Delivery Date → 422', noDate.status === 422, `${noDate.status} ${noDate.message}`);
  check('V4 refused MD direct saves created nothing', await posOn(v) === 0);
  const vOk = await fromItems('MD', v, A, 'DIRECT');
  check('V5 the right vendor then saves directly', vOk.status === 201 && (await poNow(vOk.data?._id))?.approvalStatus === 'APPROVED', `${vOk.status} ${vOk.message}`);
  const dup = await fromItems('MD', v, A, 'DIRECT');
  check('V6 a second direct PO for the same item refused (already on a PO)', dup.status === 400 && await posOn(v) === 1, `${dup.status} ${dup.message}`);

  // ── R: revise ──
  console.log('\nR  Revise a cancelled PO');
  const cancel = await call('MD', 'POST', `/procurement/purchase-orders/${vOk.data?._id}/cancel`, { remarks: 'revise test' });
  check('R0 cancel the PO to revise', cancel.status === 200, `${cancel.status} ${cancel.message}`);
  const reviseBody = (saveMode) => ({ vendorId: A, expectedDeliveryDate: due(), items: v.items.map((it) => line(v, it)), ...(saveMode ? { saveMode } : {}) });
  const rBuyer = await call('BUYER', 'POST', `/procurement/purchase-orders/${vOk.data?._id}/revise`, reviseBody('DIRECT'));
  check('R1 non-MD revise with DIRECT → 403', refused(rBuyer), `${rBuyer.status} ${rBuyer.message}`);
  const rMd = await call('MD', 'POST', `/procurement/purchase-orders/${vOk.data?._id}/revise`, reviseBody('DIRECT'));
  check('R2 MD revise with DIRECT → 400 (a revision is always a draft)', rMd.status === 400 && /always saved as a draft/.test(rMd.message), `${rMd.status} ${rMd.message}`);
  check('R3 refused revisions created nothing', await posOn(v) === 1);
  const rDraft = await call('BUYER', 'POST', `/procurement/purchase-orders/${vOk.data?._id}/revise`, reviseBody());
  const rPo = await poNow(rDraft.data?._id);
  check('R4 non-MD draft revision → 201 DRAFT linked to the cancelled PO', rDraft.status === 201 && isDraft(rPo) && String(rPo.revisedFromPoId) === String(vOk.data?._id) && rPo.revisionNo === 1, `${rDraft.status} ${rDraft.message}`);

  // ── A: authentication ──
  console.log('\nA  Authentication');
  const anon = await call(null, 'POST', '/procurement/purchase-orders/create-from-items', reviseBody('DIRECT'));
  check('A1 no token → 401', anon.status === 401, `${anon.status} ${anon.message}`);
  const bad = await call(null, 'POST', '/procurement/purchase-orders', reviseBody('DIRECT'), { Authorization: 'Bearer not-a-token' });
  check('A2 forged token → 401', bad.status === 401, `${bad.status} ${bad.message}`);

  // Documented, unchanged: the ordinary approve route has no permission gate.
  const selfRun = await readyIndent('INFO', A);
  const selfDraft = await fromItems('VIEWER', selfRun, A, 'DRAFT');
  const selfAppr = await call('VIEWER', 'POST', `/procurement/purchase-orders/${selfDraft.data?._id}/approve`, { decision: 'APPROVED' });
  console.log(`\n  INFO  existing approval route: a VIEWER approving their own draft → ${selfAppr.status} (unchanged; no permission gate on /:id/approve)`);

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
};

// ── UI prep: one PO-ready indent per user for the browser probe ────────────
// Writes frontend/e2e/shots/po-direct-save-manifest.json (git-ignored).
const prepUi = async () => {
  await connect();
  const login = await call(null, 'POST', '/auth/login', { email: USERS.MD.email, password: PASSWORD });
  tokens.MD = login.data?.token || '';
  if (!tokens.MD) throw new Error(`login failed: ${login.status} ${login.message} — run --seed first`);
  const alpha = await Vendor.findOne({ code: VENDORS[0].code }).lean();
  const manifest = { password: PASSWORD, vendorName: alpha.name, users: {} };
  for (const [key, u] of Object.entries(USERS)) {
    const ind = await readyIndent(`UI ${key}`, String(alpha._id));
    manifest.users[key] = { email: u.email, indentId: String(ind._id), indentNumber: ind.indentNumber, itemRef: ind.indentNumber.replace(/\/(?=[^/]*$)/, '.1/') };
  }
  const { writeFile } = await import('node:fs/promises');
  const out = new URL('../../../frontend/e2e/shots/po-direct-save-manifest.json', import.meta.url);
  await writeFile(out, JSON.stringify(manifest, null, 2));
  console.log(`[prep-ui] ${Object.values(manifest.users).map((x) => x.indentNumber).join(', ')} → ${out.pathname}`);
};

if (isEntry(import.meta.url)) {
  const mode = process.argv[2];
  const run = mode === '--seed' ? seed : mode === '--api' ? api : mode === '--prep-ui' ? prepUi : null;
  if (!run) { console.error('usage: --seed | --api | --prep-ui'); process.exit(2); }
  run()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
