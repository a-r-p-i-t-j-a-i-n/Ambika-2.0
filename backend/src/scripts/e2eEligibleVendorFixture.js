/**
 * API oracle for the eligible-vendor rule (quoted at Step 1.2 OR previously supplied) and the
 * PO workflow around it: Step 1.3, Pending for PO, PO create / edit / submit, JSL, line checks,
 * the two submission endpoints, approval, partial approval and vendor persistence.
 *
 *   node src/scripts/e2eEligibleVendorFixture.js --seed     upsert users, vendors, SKUs (never drops)
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5098 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_eligvendor node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5098/api/v1 node src/scripts/e2eEligibleVendorFixture.js --api
 *
 * --api creates fresh indents / POs on every run (re-runnable). Direct DB writes: Vendor Master item
 * lists (what the PO form does) and, in section S, corrupting a saved draft to prove both submission
 * endpoints refuse it identically.
 *   E  eligibility     — quoted-only vendor offered + accepted at Step 1.3; history-only vendor (no quote)
 *                        offered + accepted; unrelated vendor refused; Pending for PO uses the same rule
 *   P  PO create       — open items take an eligible vendor on the PO (quoted-only / history-only / both);
 *                        unrelated refused; the vendor is saved on the indent item and given back on cancel
 *   M  separate POs    — items with different vendors → separate POs, each keeping its own delivery date,
 *                        lead time, credit period, payment / delivery terms, remarks and T&C
 *   L  line checks     — missing / foreign / SKU-mismatched indentItemId refused
 *   J  JSL             — same rule as the OTHER format + a JSL PO is held to the Jindal vendor (server-side)
 *   S  submission      — Save as Draft is not approvable; POST /:id/submit and PATCH {submit:true} refuse the
 *                        same defects (quantity, foreign item, ineligible vendor) and accept a valid draft;
 *                        submit never approves; maker-checker + procurement.approve stay enforced
 *   Z  partial 1.3     — unticked (PENDING) item does not block the selected ones; only approved items are
 *                        PO-eligible; the locked vendor of a PO'd item is never overwritten
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard (S3 + email off).
 * Never reads MONGO_URI. Nothing here drops or resets a DB.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import RecycleBinItem from '../modules/recycle-bin/recycleBin.model.js';

export const DB_NAME = 'ambika_e2e_eligvendor';
export const E2E_URI = process.env.E2E_ELIGVENDOR_URI || `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eEligibleVendorFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5098/api/v1').replace(/\/+$/, '');
const PASSWORD = 'E2e@12345';
const USERS = {
  MD:       { email: 'elig-md@test.local',       name: 'E2E Elig MD',       role: 'MD', roles: ['MD'], mobile: '9000000181' },
  BUYER:    { email: 'elig-buyer@test.local',    name: 'E2E Elig Buyer',    role: 'EA', roles: ['PLANNER'], mobile: '9000000182' },
  APPROVER: { email: 'elig-approver@test.local', name: 'E2E Elig Approver', role: 'EA', roles: ['PLANNER'], permissionGrants: ['procurement.approve'], mobile: '9000000183' },
  MAKER:    { email: 'elig-maker@test.local',    name: 'E2E Elig Maker',    role: 'EA', roles: ['PLANNER'], permissionGrants: ['procurement.approve'], mobile: '9000000184' },
};
const VENDORS = [
  { code: 'EV-Q', name: 'EV Quoted Only', isActive: true },
  { code: 'EV-H', name: 'EV History Only', isActive: true },
  { code: 'EV-U', name: 'EV Unrelated', isActive: true },
  { code: 'EV-B', name: 'EV Both', isActive: true },
  { code: 'EV-JIN', name: 'Jindal Stainless Ltd', isActive: true },
];
const SKUS = {
  S1: { code: 'EV-S1', name: 'EV Gasket' },
  S2: { code: 'EV-S2', name: 'EV Washer' },
  S3: { code: 'EV-S3', name: 'EV Spring' },
  S4: { code: 'EV-S4', name: 'EV Clamp' },
  JSL: { code: 'EV-JSL', name: 'EV Steel Sheet' },
};
const RUN = Date.now().toString(36);
const doc = (name) => ({ fileName: `${name}.pdf`, fileUrl: `https://example.invalid/e2e/${name}.pdf`, fileType: 'application/pdf' });

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
const skuDoc = (k) => SKU.findOne({ code: SKUS[k].code }).lean();
const vendorId = async (code) => String((await Vendor.findOne({ code }).lean())._id);
// Put a SKU on a vendor's Vendor Master item list (= purchase history, what the PO form does for a vendor's first use).
const putOnItemList = async (vCode, sKey, rate = 100) => {
  const s = await skuDoc(sKey);
  await Vendor.updateOne({ code: vCode }, { $pull: { products: { skuCode: s.code } } });
  await Vendor.updateOne({ code: vCode }, { $push: { products: { skuId: s._id, skuCode: s.code, productName: s.name, rate } } });
};
const takeOffItemList = async (vCode, sKey) => {
  const s = await skuDoc(sKey);
  await Vendor.updateOne({ code: vCode }, { $pull: { products: { skuCode: s.code } } });
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
  for (const s of Object.values(SKUS)) {
    await SKU.updateOne({ code: s.code }, { $setOnInsert: { code: s.code, name: s.name, unit: 'PCS', itemType: 'CONSUMABLE' } }, { upsert: true });
  }
  console.log(`[seed] ${DB_NAME}: users ${Object.values(USERS).map((u) => u.email).join(', ')} / ${PASSWORD}; ${VENDORS.length} vendors, ${Object.keys(SKUS).length} SKUs`);
};

// ── HTTP ──────────────────────────────────────────────────────────────────
let token = '';
const call = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, data: json?.data, message: json?.message || '' };
};
const ok = async (method, path, body) => {
  const r = await call(method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${r.message}`);
  return r.data;
};
const loginAs = async (key) => {
  token = '';
  const r = await call('POST', '/auth/login', { email: USERS[key].email, password: PASSWORD });
  token = r.data?.token || r.data?.accessToken || '';
  if (!token) throw new Error(`login failed for ${key}: ${r.status} ${r.message} — run --seed first`);
};

// A fresh approved indent. `quotes[i]` = vendor id whose quote file is tagged on item i (null = untagged file).
const mkIndent = async (skuKeys, quotes = []) => {
  const items = [];
  for (const [i, k] of skuKeys.entries()) {
    const s = await skuDoc(k);
    items.push({ skuId: String(s._id), skuCode: s.code, itemName: s.name, quantity: 10 + i, unit: 'Pcs' });
  }
  const ind = await ok('POST', '/procurement/indents', { department: 'Stores', remarks: `elig e2e ${RUN}`, items });
  await ok('POST', `/procurement/indents/${ind._id}/submit`, {});
  const appr = await ok('POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
  await ok('POST', `/procurement/indents/${ind._id}/quote-comparative`, {
    statusDone: 'YES',
    itemQuotations: appr.items.map((it, i) => ({
      itemId: it._id, itemName: it.itemName, statusDone: 'YES',
      quotationDocuments: [{ ...doc(`q-${RUN}-${skuKeys[i]}-${i}`), ...(quotes[i] ? { vendorId: quotes[i], quotedRate: 80 + i, deliveryDays: 5 + i } : {}) }],
    })),
  });
  return ok('GET', `/procurement/indents/${ind._id}`);
};
const fresh = (id) => ok('GET', `/procurement/indents/${id}`);
const filesOf = (indent, i) => (indent.quoteComparativeStep.itemQuotations.find((q) => String(q.itemId) === String(indent.items[i]._id))?.quotationDocuments || [])
  .map((d) => ({ fileName: d.fileName, fileUrl: d.fileUrl, fileType: d.fileType }));
// One Step 1.3 row. kind: APPROVE (vendorId optional) | HOLD | PENDING
const row = (indent, i, kind, vId) => ({
  itemId: indent.items[i]._id, itemName: indent.items[i].itemName,
  statusDone: { APPROVE: 'YES', HOLD: 'ON_HOLD', PENDING: 'PENDING' }[kind],
  approvedQuotationDocuments: filesOf(indent, i), ...(kind === 'APPROVE' && vId ? { vendorId: vId } : {}),
  actualAt: '2026-11-20', remarks: `r${i}-${kind}`,
});
const approve13 = (indent, rows) => call('POST', `/procurement/indents/${indent._id}/approve-quotation`, { itemApprovedQuotations: rows });
const approveAll = (indent, vendors = []) => approve13(indent, indent.items.map((_, i) => row(indent, i, 'APPROVE', vendors[i])));
const readyIndent = async (skuKeys, quotes = [], vendors = []) => {
  const ind = await mkIndent(skuKeys, quotes);
  const r = await approveAll(ind, vendors);
  if (r.status >= 400) throw new Error(`approve-quotation → ${r.status} ${r.message}`);
  return fresh(ind._id);
};
const pickerRow = async (indent, i) => (await ok('GET', '/procurement/purchase-orders/approved-items')).items
  .find((r) => String(r.indentItemId) === String(indent.items[i]._id));

const dayIso = (n) => new Date(Date.now() + n * 864e5).toISOString();
const line = (indent, i, extra = {}) => ({
  indentId: indent._id, indentItemId: indent.items[i]._id, itemName: indent.items[i].itemName,
  skuCode: indent.items[i].skuCode, skuId: indent.items[i].skuId,
  quantity: indent.items[i].approvedQuantity || indent.items[i].quantity, unit: 'Pcs', rate: 100, gstRate: 18, ...extra,
});
const poBody = (vId, lines, extra = {}) => ({ vendorId: vId, expectedDeliveryDate: dayIso(7), items: lines, ...extra });
const createPo = (vId, lines, extra) => call('POST', '/procurement/purchase-orders/create-from-items', poBody(vId, lines, extra));
const getPo = (id) => ok('GET', `/procurement/purchase-orders/${id}`);
const itemOf = (indent, i) => indent.items[i];
const dbPo = (id) => VendorPurchaseOrder.findById(id).lean();

const api = async () => {
  await connect();
  await loginAs('MD');
  // A brand-new quoted-only vendor every run, so it provably has no purchase history (earlier runs' approved POs would give one).
  await Vendor.updateOne({ code: `EV-Q-${RUN}` }, { $set: { name: `EV Quoted Only ${RUN}`, isActive: true, isDeleted: false } }, { upsert: true });
  const Q = await vendorId(`EV-Q-${RUN}`); const H = await vendorId('EV-H'); const U = await vendorId('EV-U');
  const B = await vendorId('EV-B'); const JIN = await vendorId('EV-JIN');
  // Known starting point: H and B supply S1/S2 by item list (history); Q and U never did.
  for (const k of ['S1', 'S2', 'S3', 'S4', 'JSL']) for (const v of ['EV-H', 'EV-U', 'EV-B', 'EV-JIN']) await takeOffItemList(v, k);
  await putOnItemList('EV-H', 'S2'); await putOnItemList('EV-B', 'S1'); await putOnItemList('EV-H', 'S4');

  // ── E — eligibility at Step 1.3 and Pending for PO ───────────────────────
  console.log('\nE  eligibility — quoted OR previously supplied');
  const e1 = await mkIndent(['S1', 'S2'], [Q, null]);   // item 0: Q quoted (no history) · item 1: untagged quote, H has history
  const hist = await ok('GET', `/procurement/indents/${e1._id}/item-vendor-history`);
  const h0 = hist.items.find((x) => String(x.itemId) === String(e1.items[0]._id));
  const h1 = hist.items.find((x) => String(x.itemId) === String(e1.items[1]._id));
  const names0 = (h0.eligibleVendors || []).map((v) => v.vendorName);
  check('E1 item 0: quoted vendor Q is eligible with its quote (no purchase history)', (h0.eligibleVendors || []).some((v) => String(v.vendorId) === Q && v.quoted && Number(v.quotedRate) === 80 && Number(v.deliveryDays) === 5), JSON.stringify(h0.eligibleVendors));
  check('E2 item 0: Both (history vendor, never quoted) is eligible too — the union; Unrelated is not', names0.includes('EV Both') && !names0.includes('EV Unrelated'), names0.join(','));
  const histNames0 = (h0.vendors || []).map((v) => v.vendorName);
  check('E3 item 0: the "history only" list (Step 1.2 NR dropdown) still lists previous vendors only — Both yes, this run quoted-only vendor and Unrelated no', histNames0.includes('EV Both') && !histNames0.includes(`EV Quoted Only ${RUN}`) && !histNames0.includes('EV Unrelated'), JSON.stringify(histNames0));
  check('E4 item 1: previously supplied vendor H is eligible without any quotation; Q (quoted item 0 only) is not', (h1.eligibleVendors || []).some((v) => String(v.vendorId) === H && !v.quoted) && !(h1.eligibleVendors || []).some((v) => String(v.vendorId) === Q), JSON.stringify(h1.eligibleVendors));
  const bad1 = await approve13(e1, [row(e1, 0, 'APPROVE', U), row(e1, 1, 'APPROVE')]);
  check('E5 Step 1.3: unrelated vendor refused (400, names the eligible vendors)', bad1.status === 400 && /neither quoted for nor previously supplied/.test(bad1.message) && /EV Quoted Only/.test(bad1.message), `${bad1.status} ${bad1.message}`);
  const bad2 = await approve13(e1, [row(e1, 0, 'APPROVE', Q), row(e1, 1, 'APPROVE', Q)]);
  check('E6 Step 1.3: a vendor that quoted for ANOTHER item only is refused for this one', bad2.status === 400 && /neither quoted for nor previously supplied/.test(bad2.message), `${bad2.status} ${bad2.message}`);
  const good1 = await approve13(e1, [row(e1, 0, 'APPROVE', Q), row(e1, 1, 'APPROVE', H)]);
  const e1b = await fresh(e1._id);
  check('E7 Step 1.3: quoted-only vendor Q (item 0) and history-only vendor H (item 1) are both accepted and saved on the items',
    good1.status < 400 && String(itemOf(e1b, 0).vendorId) === Q && String(itemOf(e1b, 1).vendorId) === H && itemOf(e1b, 0).vendorSource === 'APPROVED_QUOTATION', `${good1.status} ${good1.message}`);
  const r0 = await pickerRow(e1b, 0);
  check('E8 PO picker row: fixed vendor Q shown, eligible list carries the basis', r0?.vendorState === 'SET' && String(r0.vendorId) === Q && Array.isArray(r0.eligibleVendors) && r0.eligibleVendors.some((v) => String(v.vendorId) === Q && v.basis.includes('QUOTED')), JSON.stringify(r0 && { s: r0.vendorState, e: r0.eligibleVendors }));
  const wrongFixed = await createPo(H, [line(e1b, 0)]);
  check('E9 a PO for an item whose vendor is fixed (Q) on another vendor is refused', wrongFixed.status === 400 && /must be the same/.test(wrongFixed.message), `${wrongFixed.status} ${wrongFixed.message}`);

  const e2 = await readyIndent(['S1', 'S2'], [Q, null]);   // approved WITHOUT a vendor
  const setU = await call('PATCH', '/procurement/purchase-orders/approved-items/vendor', { indentId: e2._id, indentItemId: e2.items[0]._id, vendorId: U });
  check('E10 Pending for PO "Select Vendor": unrelated vendor refused', setU.status === 400 && /neither quoted for nor previously supplied/.test(setU.message), `${setU.status} ${setU.message}`);
  const setQ = await call('PATCH', '/procurement/purchase-orders/approved-items/vendor', { indentId: e2._id, indentItemId: e2.items[0]._id, vendorId: Q });
  check('E11 Pending for PO "Select Vendor": quoted-only vendor accepted', setQ.status === 200 && String(setQ.data?.vendorId) === Q, `${setQ.status} ${setQ.message}`);
  const setH = await call('PATCH', '/procurement/purchase-orders/approved-items/vendor', { indentId: e2._id, indentItemId: e2.items[1]._id, vendorId: H });
  check('E12 Pending for PO "Select Vendor": previously-supplied vendor with no quotation accepted', setH.status === 200 && String(setH.data?.vendorId) === H, `${setH.status} ${setH.message}`);

  // ── P — PO create with open vendors ──────────────────────────────────────
  console.log('\nP  PO create — vendor chosen on the PO');
  const p1 = await readyIndent(['S1', 'S2', 'S3'], [Q, null, null]);  // all approved with no vendor
  check('P0 approved without a vendor → items are open (MISSING)', (await pickerRow(p1, 0))?.vendorState === 'MISSING');
  const pU = await createPo(U, [line(p1, 0)]);
  check('P1 PO on an unrelated vendor refused', pU.status === 400 && /neither quoted for nor previously supplied/.test(pU.message), `${pU.status} ${pU.message}`);
  const pNone = await createPo(H, [line(p1, 2)]);
  check('P2 item with NO eligible vendor at all (no quote, no history) refused: "No eligible vendors found"', pNone.status === 400 && /No eligible vendors found/.test(pNone.message), `${pNone.status} ${pNone.message}`);
  const pMix = await createPo(Q, [line(p1, 0), line(p1, 1)]);
  check('P3 one PO needs a vendor eligible for EVERY item on it (Q quoted S1 only → refused with S2)', pMix.status === 400 && /EV Washer|Washer/.test(pMix.message), `${pMix.status} ${pMix.message}`);
  const pQ = await createPo(Q, [line(p1, 0)], { saveMode: 'DRAFT' });
  check('P4 quoted-only vendor (no purchase history) can take the PO', pQ.status === 201, `${pQ.status} ${pQ.message}`);
  const p1b = await fresh(p1._id);
  check('P5 the PO vendor is saved on the indent item (source approved quotation, tagged with the PO)', String(itemOf(p1b, 0).vendorId) === Q && itemOf(p1b, 0).vendorSource === 'APPROVED_QUOTATION' && String(itemOf(p1b, 0).vendorFromPoId) === String(pQ.data._id), JSON.stringify(itemOf(p1b, 0)));
  const dup = await createPo(Q, [line(p1, 0)]);
  check('P6 the item is locked on its PO — no second PO and no vendor overwrite', dup.status === 400, `${dup.status} ${dup.message}`);
  const lockedSet = await call('PATCH', '/procurement/purchase-orders/approved-items/vendor', { indentId: p1._id, indentItemId: p1.items[0]._id, vendorId: H });
  check('P7 Pending for PO cannot change the vendor of an item already on a PO', lockedSet.status === 400 && /already on/.test(lockedSet.message), `${lockedSet.status} ${lockedSet.message}`);
  const pH = await createPo(H, [line(p1, 1)], { saveMode: 'DRAFT' });
  check('P8 previously-supplied vendor (no quotation) can take the PO', pH.status === 201, `${pH.status} ${pH.message}`);
  // Draft vendor change follows to the item; the new vendor must be eligible.
  const chgBad = await call('PATCH', `/procurement/purchase-orders/${pH.data._id}`, { vendorId: U });
  check('P9 editing a draft onto an unrelated vendor is refused', chgBad.status === 400, `${chgBad.status} ${chgBad.message}`);
  await putOnItemList('EV-B', 'S2');
  const chgOk = await call('PATCH', `/procurement/purchase-orders/${pH.data._id}`, { vendorId: B });
  const p1c = await fresh(p1._id);
  check('P10 editing the draft onto another eligible vendor works and the item vendor follows', chgOk.status === 200 && String(itemOf(p1c, 1).vendorId) === B, `${chgOk.status} ${chgOk.message} item=${itemOf(p1c, 1).vendorId}`);
  const cancel = await call('POST', `/procurement/purchase-orders/${pH.data._id}/cancel`, {});
  const p1d = await fresh(p1._id);
  check('P11 cancelling a PO gives the item back its OPEN vendor (the PO-supplied one is cleared; item is PO-selectable again)', cancel.status === 200 && !itemOf(p1d, 1).vendorId && !itemOf(p1d, 1).poId, `${cancel.status} vendor=${itemOf(p1d, 1).vendorId}`);
  check('P12 …while a vendor fixed at Step 1.3 is untouched by a cancel (e1 item 0 stays Q)', String(itemOf(await fresh(e1._id), 0).vendorId) === Q);
  // Delete → Recycle Bin restore: the PO-supplied vendor goes with the delete and comes back with the PO.
  const pDel = await createPo(H, [line(p1d, 1)], { saveMode: 'DRAFT' });
  const del = await call('DELETE', `/procurement/purchase-orders/${pDel.data?._id}`, { reason: 'e2e restore check' });
  const p1e = await fresh(p1._id);
  check('P13 deleting the draft PO frees the item and clears the vendor it had supplied', pDel.status === 201 && del.status === 200 && !itemOf(p1e, 1).vendorId && !itemOf(p1e, 1).poId, `${pDel.status} ${del.status} ${del.message} vendor=${itemOf(p1e, 1).vendorId}`);
  const bin = await RecycleBinItem.findOne({ recordId: pDel.data?._id }).sort({ createdAt: -1 }).lean();
  const restored = bin ? await call('POST', '/recycle-bin/restore', { ids: [String(bin._id)] }) : { status: 0, message: 'no bin entry' };
  const p1f = await fresh(p1._id);
  check('P14 restoring the PO from the Recycle Bin relinks the item AND writes its vendor back (tagged with the PO)',
    restored.status === 200 && String(itemOf(p1f, 1).poId) === String(pDel.data?._id) && String(itemOf(p1f, 1).vendorId) === H && String(itemOf(p1f, 1).vendorFromPoId) === String(pDel.data?._id),
    `${restored.status} ${restored.message} item=${JSON.stringify({ po: itemOf(p1f, 1).poId, v: itemOf(p1f, 1).vendorId, f: itemOf(p1f, 1).vendorFromPoId })}`);
  await call('POST', `/procurement/purchase-orders/${pDel.data?._id}/cancel`, {});
  check('P15 …and cancelling the restored PO gives the vendor back again', !itemOf(await fresh(p1._id), 1).vendorId);

  // ── M — separate POs, own terms ──────────────────────────────────────────
  console.log('\nM  separate POs per vendor, independent terms');
  const m1 = await readyIndent(['S1', 'S2'], [Q, null], [Q, H]);  // two vendors fixed by the approval
  const terms = {
    Q: { expectedDeliveryDate: dayIso(7), deliveryTerms: 'Ex-works Q', paymentTerms: '30 days Q', creditPeriod: 30, remarks: 'Remarks for Q', termsAndConditions: 'T&C for Q only' },
    H: { expectedDeliveryDate: dayIso(14), deliveryTerms: 'Door delivery H', paymentTerms: '45 days H', creditPeriod: 45, remarks: 'Remarks for H', termsAndConditions: 'T&C for H only' },
  };
  const poQ = await createPo(Q, [line(m1, 0)], { ...terms.Q, saveMode: 'DRAFT' });
  const poH = await createPo(H, [line(m1, 1)], { ...terms.H, saveMode: 'DRAFT' });
  check('M1 two vendors → two separate POs', poQ.status === 201 && poH.status === 201 && String(poQ.data._id) !== String(poH.data._id), `${poQ.status} ${poQ.message} / ${poH.status} ${poH.message}`);
  const gQ = await getPo(poQ.data._id); const gH = await getPo(poH.data._id);
  const dayDiff = (po) => Math.round((new Date(po.expectedDeliveryDate) - new Date(po.poDate)) / 864e5);
  check('M2 each PO keeps its own delivery terms, payment terms, credit period, remarks and T&C (not overwritten by the other)',
    gQ.deliveryTerms === 'Ex-works Q' && gQ.paymentTerms === '30 days Q' && gQ.creditPeriod === 30 && gQ.remarks === 'Remarks for Q' && gQ.termsAndConditions === 'T&C for Q only'
    && gH.deliveryTerms === 'Door delivery H' && gH.paymentTerms === '45 days H' && gH.creditPeriod === 45 && gH.remarks === 'Remarks for H' && gH.termsAndConditions === 'T&C for H only',
    JSON.stringify({ q: [gQ.deliveryTerms, gQ.paymentTerms, gQ.creditPeriod, gQ.remarks, gQ.termsAndConditions], h: [gH.deliveryTerms, gH.paymentTerms, gH.creditPeriod, gH.remarks, gH.termsAndConditions] }));
  check('M3 each PO keeps its own Expected Delivery Date and Lead Time', dayDiff(gQ) === 7 && dayDiff(gH) === 14 && gQ.leadTimeDays === 7 && gH.leadTimeDays === 14, `${dayDiff(gQ)}/${dayDiff(gH)} lead ${gQ.leadTimeDays}/${gH.leadTimeDays}`);
  check('M4 each PO holds only its own vendor\'s item and vendor', gQ.items.length === 1 && gH.items.length === 1 && String(gQ.vendorId) === Q && String(gH.vendorId) === H && String(gQ.items[0].indentItemId) === String(m1.items[0]._id), '');
  await call('PATCH', `/procurement/purchase-orders/${poQ.data._id}/terms`, { termsAndConditions: 'Edited Q terms' });
  check('M5 editing one PO\'s terms leaves the other PO untouched', (await getPo(poQ.data._id)).termsAndConditions === 'Edited Q terms' && (await getPo(poH.data._id)).termsAndConditions === 'T&C for H only');

  // ── L — line checks ──────────────────────────────────────────────────────
  console.log('\nL  indentItemId checks');
  const l1 = await readyIndent(['S1', 'S2'], [Q, null], [Q, H]);
  const l2 = await readyIndent(['S1'], [Q], [Q]);
  const noId = await createPo(Q, [{ ...line(l1, 0), indentItemId: undefined }]);
  check('L1 create-from-items: a line without indentItemId is refused', noId.status === 400 && /indentItemId|indent item/.test(noId.message), `${noId.status} ${noId.message}`);
  const foreign = await createPo(Q, [{ ...line(l1, 0), indentItemId: l2.items[0]._id }]);
  check('L2 an indentItemId that belongs to ANOTHER indent is refused', foreign.status === 400 && /not an item of/.test(foreign.message), `${foreign.status} ${foreign.message}`);
  const invented = await createPo(Q, [{ ...line(l1, 0), indentItemId: String(new mongoose.Types.ObjectId()) }]);
  check('L3 an invented indentItemId is refused', invented.status === 400 && /not an item of/.test(invented.message), `${invented.status} ${invented.message}`);
  const skuMis = await createPo(Q, [{ ...line(l1, 0), skuId: l1.items[1].skuId, skuCode: l1.items[1].skuCode }]);
  check('L4 a line whose SKU does not match its indent item is refused', skuMis.status === 400 && /does not match the SKU/.test(skuMis.message), `${skuMis.status} ${skuMis.message}`);
  const okLine = await createPo(Q, [line(l1, 0)], { saveMode: 'DRAFT' });
  check('L5 the valid line is accepted', okLine.status === 201, `${okLine.status} ${okLine.message}`);

  // ── J — JSL ──────────────────────────────────────────────────────────────
  console.log('\nJ  JSL and non-JSL, same rule');
  const j1 = await readyIndent(['JSL'], [null], []);   // open
  const jl = (extra = {}) => ({ ...line(j1, 0), grade: '304', width: '1250', finish: '2B', baseRate: 100, unit: 'Kgs', ...extra });
  const jNoHist = await createPo(JIN, [jl()], { poFormatType: 'JSL' });
  check('J1 JSL PO on Jindal WITHOUT quote or history for the item is refused (no JSL exemption)', jNoHist.status === 400 && /No eligible vendors found|neither quoted for nor previously supplied/.test(jNoHist.message), `${jNoHist.status} ${jNoHist.message}`);
  await putOnItemList('EV-H', 'JSL');
  const jOther = await createPo(H, [jl()], { poFormatType: 'JSL' });
  check('J2 JSL PO on an eligible but non-Jindal vendor is refused: a JSL PO is always raised on Jindal', jOther.status === 400 && /always raised on Jindal/.test(jOther.message), `${jOther.status} ${jOther.message}`);
  const jNonJsl = await createPo(U, [jl()], { poFormatType: 'OTHER' });
  check('J3 the same unrelated vendor is refused on the OTHER format too', jNonJsl.status === 400 && /neither quoted for nor previously supplied/.test(jNonJsl.message), `${jNonJsl.status} ${jNonJsl.message}`);
  await putOnItemList('EV-JIN', 'JSL');
  const jOk = await createPo(JIN, [jl()], { poFormatType: 'JSL', saveMode: 'DRAFT' });
  check('J4 JSL PO on Jindal once it supplies the item is accepted', jOk.status === 201, `${jOk.status} ${jOk.message}`);
  // submit gate also holds JSL: break the vendor in the DB, both endpoints refuse
  await VendorPurchaseOrder.updateOne({ _id: jOk.data._id }, { $set: { vendorId: H, vendorName: 'EV History Only' } });
  const jSub = await call('POST', `/procurement/purchase-orders/${jOk.data._id}/submit`, {});
  const jPatch = await call('PATCH', `/procurement/purchase-orders/${jOk.data._id}`, { submit: true });
  check('J5 a JSL draft moved off Jindal cannot be submitted by EITHER endpoint', jSub.status === 400 && jPatch.status === 400 && /always raised on Jindal/.test(jSub.message) && /always raised on Jindal/.test(jPatch.message), `${jSub.status} ${jSub.message} | ${jPatch.status} ${jPatch.message}`);

  // ── S — submission paths, approval, maker-checker ────────────────────────
  console.log('\nS  Draft / Submit / Approve — both endpoints, identical checks');
  const s1 = await readyIndent(['S1', 'S2', 'S4'], [Q, null, null], []);   // all open
  const mkDraft = async (userKey, i, vId, extra = {}) => {
    await loginAs(userKey);
    const r = await createPo(vId, [line(s1, i)], { saveMode: 'DRAFT', ...extra });
    if (r.status !== 201) throw new Error(`draft failed: ${r.status} ${r.message}`);
    return r.data;
  };
  const dA = await mkDraft('BUYER', 0, Q);
  check('S1 Save as Draft → NOT_SUBMITTED, still DRAFT', dA.submissionStatus === 'NOT_SUBMITTED' && dA.approvalStatus === 'DRAFT', `${dA.submissionStatus} ${dA.approvalStatus}`);
  await loginAs('MD');
  const apDraft = await call('POST', `/procurement/purchase-orders/${dA._id}/approve`, { decision: 'APPROVED' });
  check('S2 a draft cannot be approved before it is submitted (400), even by the MD', apDraft.status === 400 && /not been submitted|submit it for approval/.test(apDraft.message), `${apDraft.status} ${apDraft.message}`);
  await loginAs('BUYER');
  const sub = await call('POST', `/procurement/purchase-orders/${dA._id}/submit`, {});
  check('S3 POST /:id/submit moves it to the approval queue and does NOT approve it', sub.status === 200 && sub.data?.submissionStatus === 'SUBMITTED' && sub.data?.approvalStatus === 'DRAFT' && !sub.data?.poNumber, `${sub.status} ${sub.message}`);
  // identical defects on two drafts: one per endpoint
  const dB = await mkDraft('BUYER', 1, H);
  const dC = await mkDraft('BUYER', 2, H);
  const same = async (label, breakFn) => {
    await breakFn(dB._id); await breakFn(dC._id);
    await loginAs('BUYER');
    const viaPost = await call('POST', `/procurement/purchase-orders/${dB._id}/submit`, {});
    const viaPatch = await call('PATCH', `/procurement/purchase-orders/${dC._id}`, { submit: true });
    return { label, viaPost, viaPatch };
  };
  const verdict = (r, re) => check(`${r.label} — POST /submit and PATCH {submit:true} both refuse (400) with the same reason`, r.viaPost.status === 400 && r.viaPatch.status === 400 && re.test(r.viaPost.message) && re.test(r.viaPatch.message), `${r.viaPost.status} ${r.viaPost.message} | ${r.viaPatch.status} ${r.viaPatch.message}`);
  verdict(await same('S4 a zero quantity', (id) => VendorPurchaseOrder.updateOne({ _id: id }, { $set: { 'items.0.quantity': 0 } })), /quantity greater than zero/);
  verdict(await same('S5 an indentItemId of another indent', (id) => VendorPurchaseOrder.updateOne({ _id: id }, { $set: { 'items.0.quantity': 3, 'items.0.indentItemId': new mongoose.Types.ObjectId(String(l2.items[0]._id)) } })), /not an item of/);
  // repair the item ids, then break the vendor
  await VendorPurchaseOrder.updateOne({ _id: dB._id }, { $set: { 'items.0.indentItemId': s1.items[1]._id } });
  await VendorPurchaseOrder.updateOne({ _id: dC._id }, { $set: { 'items.0.indentItemId': s1.items[2]._id } });
  verdict(await same('S6 a vendor that is neither quoted nor previously supplied', (id) => VendorPurchaseOrder.updateOne({ _id: id }, { $set: { vendorId: U, vendorName: 'EV Unrelated' } })), /neither quoted for nor previously supplied/);
  // valid drafts: both endpoints accept
  await VendorPurchaseOrder.updateOne({ _id: dB._id }, { $set: { vendorId: H, vendorName: 'EV History Only' } });
  await VendorPurchaseOrder.updateOne({ _id: dC._id }, { $set: { vendorId: H, vendorName: 'EV History Only' } });
  await loginAs('BUYER');
  const okPost = await call('POST', `/procurement/purchase-orders/${dB._id}/submit`, {});
  const okPatch = await call('PATCH', `/procurement/purchase-orders/${dC._id}`, { submit: true });
  check('S7 a valid draft is accepted by BOTH endpoints and neither approves it', okPost.status === 200 && okPatch.status === 200 && okPost.data?.approvalStatus === 'DRAFT' && okPatch.data?.approvalStatus === 'DRAFT' && okPost.data?.submissionStatus === 'SUBMITTED' && okPatch.data?.submissionStatus === 'SUBMITTED', `${okPost.status} ${okPost.message} | ${okPatch.status} ${okPatch.message}`);
  // maker-checker + permission
  const buyerAp = await call('POST', `/procurement/purchase-orders/${dA._id}/approve`, { decision: 'APPROVED' });
  check('S8 the buyer (no procurement.approve) cannot approve (403)', buyerAp.status === 403, `${buyerAp.status} ${buyerAp.message}`);
  await loginAs('MAKER');
  const m1ind = await readyIndent(['S1'], [Q], [Q]);
  const mk = await createPo(Q, [line(m1ind, 0)], { saveMode: 'SUBMIT' });
  const mkAp = await call('POST', `/procurement/purchase-orders/${mk.data._id}/approve`, { decision: 'APPROVED' });
  check('S9 maker-checker: whoever created and submitted the PO cannot approve it, even holding procurement.approve (403)', mk.status === 201 && mkAp.status === 403 && /prepared this PO/.test(mkAp.message), `${mk.status} ${mkAp.status} ${mkAp.message}`);
  await loginAs('APPROVER');
  const apOk = await call('POST', `/procurement/purchase-orders/${dA._id}/approve`, { decision: 'APPROVED' });
  check('S10 an independent approver approves the submitted PO → final PO number', apOk.status === 200 && apOk.data?.approvalStatus === 'APPROVED' && /PO/.test(apOk.data?.poNumber || ''), `${apOk.status} ${apOk.message}`);
  const mkAp2 = await call('POST', `/procurement/purchase-orders/${mk.data._id}/approve`, { decision: 'APPROVED' });
  check('S11 …and the maker\'s own PO is approvable by that independent approver', mkAp2.status === 200, `${mkAp2.status} ${mkAp2.message}`);

  // ── Z — partial Step 1.3 ────────────────────────────────────────────────
  console.log('\nZ  partial Step 1.3 — selected items approved, others stay pending');
  await loginAs('MD');
  const z1 = await mkIndent(['S1', 'S2', 'S4'], [Q, null, null]);
  const zr = await approve13(z1, [row(z1, 0, 'APPROVE', Q), row(z1, 1, 'PENDING'), row(z1, 2, 'APPROVE', H)]);
  const z1b = await fresh(z1._id);
  check('Z1 two ticked items approved while the unticked one is PENDING — the step is partial, not blocked', zr.status < 400 && z1b.quotationApprovalStep.partial === true && !z1b.quotationApprovalStep.statusDone, `${zr.status} ${zr.message}`);
  const zRows = (await ok('GET', '/procurement/purchase-orders/approved-items')).items.filter((r) => String(r.indentId) === String(z1._id));
  check('Z2 only the approved items are PO-eligible (the pending item is not offered)', zRows.length === 2 && !zRows.some((r) => String(r.indentItemId) === String(z1.items[1]._id)), JSON.stringify(zRows.map((r) => r.itemName)));
  const zPend = await createPo(H, [line(z1b, 1)]);
  check('Z3 a PO naming the pending item is refused', zPend.status === 400, `${zPend.status} ${zPend.message}`);
  const zh = await mkIndent(['S2', 'S4'], [null, null]);
  await approve13(zh, [row(zh, 0, 'HOLD'), row(zh, 1, 'APPROVE', H)]);
  const zHeld = await createPo(H, [line(await fresh(zh._id), 0)]);
  check('Z3b a PO naming an ON HOLD item is refused by the API even with an eligible vendor', zHeld.status === 400 && /not approved for a PO/.test(zHeld.message), `${zHeld.status} ${zHeld.message}`);
  const zPo = await createPo(Q, [line(z1b, 0)], { saveMode: 'DRAFT' });
  check('Z4 the approved item proceeds to a PO; the indent is never PO_READY while an item is owed a decision', zPo.status === 201 && (await fresh(z1._id)).overallStatus === 'PARTIAL_PO_CREATED', `${zPo.status} ${zPo.message}`);
  const zChange = await approve13(z1b, [row(z1b, 0, 'APPROVE', H), row(z1b, 1, 'PENDING'), row(z1b, 2, 'APPROVE', H)]);
  check('Z5 the vendor locked by an existing PO is never overwritten by a later Step 1.3 save (400)', zChange.status === 400 && /already on/.test(zChange.message), `${zChange.status} ${zChange.message}`);
  check('Z6 …and the item still holds its locked vendor', String(itemOf(await fresh(z1._id), 0).vendorId) === Q);
  const zDone = await approve13(z1b, [row(z1b, 0, 'APPROVE', Q), row(z1b, 1, 'APPROVE', H), row(z1b, 2, 'APPROVE', H)]);
  const z1c = await fresh(z1._id);
  check('Z7 approving the remaining item later completes the step', zDone.status < 400 && z1c.quotationApprovalStep.statusDone === 'YES' && !z1c.quotationApprovalStep.partial, `${zDone.status} ${zDone.message}`);

  console.log(`\n${passes} passed, ${failures} failed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
};

const main = async () => {
  const mode = process.argv[2];
  if (mode === '--seed') { await seed(); await mongoose.disconnect(); return; }
  if (mode === '--api') { await api(); return; }
  console.log('usage: node src/scripts/e2eEligibleVendorFixture.js --seed | --api');
};
if (isEntry(import.meta.url)) main().catch((err) => { console.error(err); process.exit(1); });
