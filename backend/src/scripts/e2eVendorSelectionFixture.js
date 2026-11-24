/**
 * API oracle for vendor selection per indent item (indent/itemVendor.js):
 * Step 1.3 approved vendor → PO, Pending-for-PO vendor pick when no quotation
 * was required, and the PO guard that never lets a different vendor through.
 *
 *   node src/scripts/e2eVendorSelectionFixture.js --seed   upsert user + vendors (never drops)
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5097 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_vendorsel node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5097/api/v1 node src/scripts/e2eVendorSelectionFixture.js --api
 *
 * --api creates fresh indents on every run (names carry a run tag), so it can be
 * re-run without reseeding. Checks:
 *   R  Quotation required: 1.3 refuses an inactive / unknown / non-master / ineligible
 *      vendor (eligible = quoted at Step 1.2 OR previously supplied the SKU); the vendor is
 *      OPTIONAL at 1.3; the approved vendor lands on the item; the PO must use it (other
 *      vendor refused, retry refused, draft edit to another vendor refused).
 *   L  Item approved with no vendor (MISSING): the PO / Pending-for-PO confirm accept only an
 *      eligible vendor; confirm is one-time.
 *   N  Quotation not required: no Step 1.3; vendor picked / changed / cleared on
 *      Pending for PO (eligible vendors only); the PO must use it; locked while on a PO, free
 *      after cancel; an unpicked item takes an eligible vendor on the PO, which is then saved
 *      on the item (and given back when that PO is cancelled).
 *   V  Union rule: a quoted-only vendor and a history-only vendor are each eligible; the vendor
 *      chosen on the PO persists on the item and is released with the PO.
 *   M  Mixed multi-line indent: different approved vendors per line, one PO per
 *      vendor, multi-indent PO, indent status roll-up.
 *   S  Status / auth / master-data rejections; concurrent picks stay consistent.
 *   E  Existing records: older vendor-grain approvals held to their vendor list;
 *      a legacy draft PO stays editable; a Party-vendor PO keeps its vendor.
 *   X  Concurrency: PO creation is one transaction (insert + indent link), so a
 *      competing PO, vendor change or Step 1.3 re-approval can never leave two
 *      POs on one item or a PO on a stale vendor; draft edits can't attach new
 *      indent items and can't land on an approved PO. The race checks need a
 *      replica set (transactions) — on a standalone mongod they report SKIP.
 *
 * Replica-set run (throwaway, like e2eQcGatedPostingFixture):
 *   mongod --replSet rsVendorSel --port 27018 --dbpath <scratch dir>   + rs.initiate()
 *   E2E_VENDORSEL_URI='mongodb://127.0.0.1:27018/ambika_e2e_vendorsel?replicaSet=rsVendorSel&directConnection=true'
 *   (pass the same URI as the e2eServer's MONGO_URI, then --seed / --api as above)
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard
 * (S3 + email off). Never reads MONGO_URI. Nothing here drops or resets a DB.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import Party from '../modules/clients/party.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import SKU from '../modules/skus/sku.model.js';

export const DB_NAME = 'ambika_e2e_vendorsel';
export const E2E_URI = process.env.E2E_VENDORSEL_URI || `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eVendorSelectionFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5097/api/v1').replace(/\/+$/, '');
const LOGIN = { email: 'vendorsel-e2e@test.local', password: 'E2e@12345' };
const VENDORS = [
  { code: 'VS-ALPHA', name: 'VS Alpha Traders', isActive: true },
  { code: 'VS-BETA', name: 'VS Beta Supplies', isActive: true },
  { code: 'VS-GAMMA', name: 'VS Gamma Inactive', isActive: false },
];
const PARTY_NAME = 'VS Legacy Party Vendor';
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

// ── Seed (idempotent upserts — never drops) ────────────────────────────────
const seed = async () => {
  await connect();
  if (!await User.findOne({ email: LOGIN.email })) {
    await User.create({ ...LOGIN, name: 'E2E Vendor Doer', role: 'MD', roles: ['MD'], mobile: '9000000077', isActive: true });
  }
  for (const v of VENDORS) {
    await Vendor.updateOne({ code: v.code }, { $set: { name: v.name, isActive: v.isActive, isDeleted: false } }, { upsert: true });
  }
  if (!await Party.findOne({ name: PARTY_NAME })) {
    await Party.create({ name: PARTY_NAME, partyType: 'VENDOR' }).catch(() => Party.create({ name: PARTY_NAME }));
  }
  console.log(`[seed] ${DB_NAME}: user ${LOGIN.email} / ${LOGIN.password}, vendors ${VENDORS.map((v) => v.name).join(', ')}, party "${PARTY_NAME}"`);
};

// ── HTTP helpers ───────────────────────────────────────────────────────────
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

// Indent items must be SKU Master items (indent/itemSku.js): one upserted SKU
// per item name, named exactly like the item so name-based checks still hold.
// A "Quote Required? = No" item must name one of the item's PREVIOUS vendors at
// Step 1.2 (indent/itemVendorHistory.js): every SKU is put on VS Alpha's Vendor
// Master item list (counts as history; rate 0 = no vendor rate to fetch).
const skuItem = async (name, quantity) => {
  const code = `E2E-${name}`.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 60);
  const sku = await SKU.findOneAndUpdate({ code }, { $setOnInsert: { code, name, unit: 'PCS', itemType: 'CONSUMABLE' } }, { upsert: true, new: true }).lean();
  await Vendor.updateOne({ code: 'VS-ALPHA', 'products.skuId': { $ne: sku._id } }, { $push: { products: { skuId: sku._id, skuCode: sku.code, productName: name, rate: 0 } } });
  return { skuId: String(sku._id), skuCode: sku.code, itemName: sku.name, quantity, unit: 'Pcs' };
};

// Beta has supplied this item before (Vendor Master item list) → Beta is eligible for it. Without this call
// only Alpha is (every SKU is on Alpha's list); Beta is neither quoted nor in the history.
const giveBeta = (item) => Vendor.updateOne({ code: 'VS-BETA', 'products.skuId': { $ne: item.skuId } }, { $push: { products: { skuId: item.skuId, skuCode: item.skuCode, productName: item.itemName, rate: 0 } } });

const newApprovedIndent = async (names) => {
  const ind = await ok('POST', '/procurement/indents', {
    department: 'Stores', remarks: `vendor-selection e2e ${RUN}`,
    items: await Promise.all(names.map((n, i) => skuItem(`${n} ${RUN}`, 10 + i))),
  });
  await ok('POST', `/procurement/indents/${ind._id}/submit`, {});
  return ok('POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
};
// Step 1.2 — per item 'YES' (with a file) or 'QUOTE_NOT_REQUIRED'.
// Step 1.2 now makes the vendor of a "Quote Not Required" item mandatory (a previous
// vendor of the item — here VS Alpha). This oracle tests the Pending-for-PO pick that
// older / flat-payload records still use, so after a successful save the Step 1.2
// pick is dropped again — the state of an item recorded before that existed.
let nrVendorId = '';
const NO_PICK = { 'items.$[].vendorId': '', 'items.$[].vendorName': '', 'items.$[].vendorSource': '', 'items.$[].vendorSelectedAt': '', 'items.$[].vendorSelectedById': '' };
const quote = async (indent, statuses) => {
  const items = indent.items.map((it, i) => ({
    itemId: it._id, itemName: it.itemName, statusDone: statuses[i],
    ...(statuses[i] === 'QUOTE_NOT_REQUIRED' ? { vendorId: nrVendorId } : {}),
    quotationDocuments: statuses[i] === 'YES' ? [doc(`vs-${RUN}-${i}`)] : [],
  }));
  const res = await quoteCall(indent, statuses, items);
  if (res.status === 200 && statuses.includes('QUOTE_NOT_REQUIRED')) {
    await PurchaseIndent.updateOne({ _id: indent._id }, {
      $unset: NO_PICK,
      $pull: { activityTimeline: { action: 'ITEM_VENDOR', description: /from purchase history/ } }, // its audit line too
    });
  }
  return res;
};
const quoteCall = (indent, statuses, items) => {
  return call('POST', `/procurement/indents/${indent._id}/quote-comparative`, {
    statusDone: statuses.every((s) => s === 'QUOTE_NOT_REQUIRED') ? 'QUOTE_NOT_REQUIRED' : 'YES', itemQuotations: items,
  });
};
// Step 1.3 — vendorIds[i] per item (undefined = not sent).
const approve = (indent, statuses, vendorIds) => call('POST', `/procurement/indents/${indent._id}/approve-quotation`, {
  itemApprovedQuotations: indent.items.map((it, i) => ({
    itemId: it._id, itemName: it.itemName, statusDone: statuses[i],
    approvedQuotationDocuments: statuses[i] === 'YES' ? [doc(`vs-${RUN}-${i}`)] : [],
    ...(vendorIds[i] !== undefined ? { vendorId: vendorIds[i] } : {}),
  })),
});
const approvedRows = async () => (await ok('GET', '/procurement/purchase-orders/approved-items')).items;
const rowOf = async (item) => (await approvedRows()).find((r) => String(r.indentItemId) === String(item._id));
const setVendor = (indent, item, vendorId, opts) => call('PATCH', '/procurement/purchase-orders/approved-items/vendor',
  { indentId: indent._id, indentItemId: item._id, vendorId }, opts);
const poFromItems = (entries, vendorId) => call('POST', '/procurement/purchase-orders/create-from-items', {
  vendorId, expectedDeliveryDate: new Date(Date.now() + 7 * 864e5).toISOString(),
  items: entries.map(([indent, it]) => ({
    indentId: indent._id, indentItemId: it._id, itemName: it.itemName, quantity: it.approvedQuantity || it.quantity, unit: it.unit, rate: 100, gstRate: 18,
  })),
});
const fresh = (id) => PurchaseIndent.findById(id).lean();
const itemNow = async (indent, item) => (await fresh(indent._id)).items.find((it) => String(it._id) === String(item._id));
const vendorTimeline = async (indent) => (await fresh(indent._id)).activityTimeline.filter((t) => t.action === 'ITEM_VENDOR');
const UNSET_VENDOR = { 'items.$[].vendorId': '', 'items.$[].vendorName': '', 'items.$[].vendorSource': '', 'items.$[].vendorSelectedAt': '', 'items.$[].vendorSelectedById': '' };

// ── API checks ─────────────────────────────────────────────────────────────
const api = async () => {
  await connect();
  const login = await call('POST', '/auth/login', LOGIN);
  token = login.data?.token || login.data?.accessToken || '';
  if (!token) throw new Error(`login failed: ${login.status} ${login.message} — run --seed first`);
  const [alpha, beta, gamma] = await Promise.all(VENDORS.map((v) => Vendor.findOne({ code: v.code }).lean()));
  nrVendorId = String(alpha._id);
  const party = await Party.findOne({ name: PARTY_NAME }).lean();
  const A = String(alpha._id);
  const B = String(beta._id);
  const G = String(gamma._id);
  console.log(`run ${RUN} against ${API}`);

  // ── R: quotation required ──
  console.log('\nR  Quotation required — vendor from the approved quotation');
  const r = await newApprovedIndent(['R Steel Coil']);
  const [rItem] = r.items;
  check('R1 Step 1.2 "Yes" with a file accepted', (await quote(r, ['YES'])).status === 200);
  const rInactive = await approve(r, ['YES'], [G]);
  check('R3 inactive Vendor-Master vendor refused', rInactive.status === 400 && /inactive/.test(rInactive.message), `${rInactive.status} ${rInactive.message}`);
  const rUnknown = await approve(r, ['YES'], [String(new mongoose.Types.ObjectId())]);
  check('R4 unknown vendor id refused', rUnknown.status === 400 && /not found in the Vendor Master/.test(rUnknown.message), `${rUnknown.status} ${rUnknown.message}`);
  const rParty = await approve(r, ['YES'], [String(party._id)]);
  check('R5 Party (customer master) id refused — Vendor Master only', rParty.status === 400, `${rParty.status} ${rParty.message}`);
  const rIneligible = await approve(r, ['YES'], [B]);
  check('R5b a vendor that neither quoted for the item nor ever supplied it refused', rIneligible.status === 400 && /neither quoted for nor previously supplied/.test(rIneligible.message), `${rIneligible.status} ${rIneligible.message}`);
  check('R6 refused approvals left the indent unapproved', (await fresh(r._id)).overallStatus === 'QUOTE_RECEIVED');
  const rNo = await approve(r, ['YES'], [undefined]);
  check('R2 Step 1.3 without a vendor is accepted — the vendor is optional and chosen on the PO', rNo.status === 200 && (await rowOf(rItem))?.vendorState === 'MISSING' && !(await itemNow(r, rItem)).vendorId, `${rNo.status} ${rNo.message}`);
  const rOk = await approve(r, ['YES'], [A]);
  check('R7 Step 1.3 with an active vendor accepted', rOk.status === 200, `${rOk.status} ${rOk.message}`);
  const rSaved = await itemNow(r, rItem);
  check('R8 approved vendor stored on the item (APPROVED_QUOTATION, master name)',
    String(rSaved.vendorId) === A && rSaved.vendorSource === 'APPROVED_QUOTATION' && rSaved.vendorName === alpha.name && !!rSaved.vendorSelectedAt,
    JSON.stringify({ v: rSaved.vendorId, s: rSaved.vendorSource, n: rSaved.vendorName }));
  check('R9 approval timeline names the vendor', (await fresh(r._id)).activityTimeline.some((t) => t.action === 'APPROVE_QUOTATION' && t.description.includes(alpha.name)));
  const rRow = await rowOf(rItem);
  check('R10 Pending for PO row: REQUIRED / SET / vendor', rRow?.quotationPath === 'REQUIRED' && rRow?.vendorState === 'SET' && String(rRow?.vendorId) === A && rRow?.vendorSource === 'APPROVED_QUOTATION', JSON.stringify(rRow));
  const rWrong = await poFromItems([[r, rItem]], B);
  check('R11 PO with a different vendor refused', rWrong.status === 400 && rWrong.message.includes(`approved quotation is "${alpha.name}"`), `${rWrong.status} ${rWrong.message}`);
  check('R12 refused PO created nothing', await VendorPurchaseOrder.countDocuments({ indentIds: r._id }) === 0);
  const rClear = await setVendor(r, rItem, null);
  check('R13 approved vendor cannot be cleared on Pending for PO', rClear.status === 400, `${rClear.status} ${rClear.message}`);
  await giveBeta(rItem); // Beta eligible → the refusal below is the 'cannot be changed' rule, not eligibility
  const rChange = await setVendor(r, rItem, B);
  check('R14 approved vendor cannot be changed on Pending for PO', rChange.status === 400 && /cannot be changed/.test(rChange.message), `${rChange.status} ${rChange.message}`);
  const rPo = await poFromItems([[r, rItem]], A);
  check('R15 PO with the approved vendor created', rPo.status === 201 || rPo.status === 200, `${rPo.status} ${rPo.message}`);
  check('R16 PO inherits the approved vendor', String(rPo.data?.vendorId) === A && rPo.data?.vendorName === alpha.name, JSON.stringify({ v: rPo.data?.vendorId, n: rPo.data?.vendorName }));
  const rRetry = await poFromItems([[r, rItem]], A);
  check('R17 retry does not create a second PO', rRetry.status === 400 && await VendorPurchaseOrder.countDocuments({ indentIds: r._id }) === 1, `${rRetry.status} ${rRetry.message}`);
  const rEdit = await call('PATCH', `/procurement/purchase-orders/${rPo.data?._id}`, { vendorId: B });
  const rPoNow = await VendorPurchaseOrder.findById(rPo.data?._id).lean();
  check('R18 draft PO edit to another vendor refused, vendor kept', rEdit.status === 400 && String(rPoNow.vendorId) === A, `${rEdit.status} ${rEdit.message}`);
  const rOnPo = await setVendor(r, rItem, A);
  check('R19 vendor action refused once the item is on a PO', rOnPo.status === 400 && /already on/.test(rOnPo.message), `${rOnPo.status} ${rOnPo.message}`);
  const rReapprove = await approve(r, ['YES'], [B]);
  check('R20 Step 1.3 re-approval after the PO refused; vendor unchanged', rReapprove.status === 400 && String((await itemNow(r, rItem)).vendorId) === A, `${rReapprove.status}`);

  // ── L: approved before vendors were recorded ──
  console.log('\nL  Legacy approved quotation without a vendor');
  const l = await newApprovedIndent(['L Packing Tape']);
  const [lItem] = l.items;
  await quote(l, ['YES']);
  await approve(l, ['YES'], [A]);
  await PurchaseIndent.updateOne({ _id: l._id }, { $unset: UNSET_VENDOR }); // as recorded before this feature
  const lRow = await rowOf(lItem);
  check('L1 Pending for PO row: vendor MISSING', lRow?.vendorState === 'MISSING' && !lRow?.vendorId, JSON.stringify(lRow));
  const lPo = await poFromItems([[l, lItem]], B);
  check('L2 an item with no vendor fixed refuses a PO vendor that neither quoted nor supplied it (400)', lPo.status === 400 && /neither quoted for nor previously supplied/.test(lPo.message), `${lPo.status} ${lPo.message}`);
  const lPoOld = await call('POST', '/procurement/purchase-orders', {
    indentId: l._id, vendorId: B, expectedDeliveryDate: new Date(Date.now() + 7 * 864e5).toISOString(),
    items: [{ indentItemId: lItem._id, itemName: lItem.itemName, quantity: lItem.approvedQuantity, unit: lItem.unit, rate: 10, gstRate: 18 }],
  });
  check('L3 single-indent PO endpoint refuses it too', lPoOld.status === 400 && /neither quoted for nor previously supplied/.test(lPoOld.message), `${lPoOld.status} ${lPoOld.message}`);
  check('L4 confirm with an inactive vendor refused', (await setVendor(l, lItem, G)).status === 400);
  check('L5 confirm with a Party id refused', (await setVendor(l, lItem, String(party._id))).status === 400);
  const lIneligible = await setVendor(l, lItem, B);
  check('L5b confirm with an ineligible vendor refused (neither quoted nor supplied)', lIneligible.status === 400 && /neither quoted for nor previously supplied/.test(lIneligible.message), `${lIneligible.status} ${lIneligible.message}`);
  await giveBeta(lItem); // Beta supplied it before → eligible now
  const lConfirm = await setVendor(l, lItem, B);
  const lSaved = await itemNow(l, lItem);
  check('L6 approved vendor confirmed (APPROVED_QUOTATION)', lConfirm.status === 200 && String(lSaved.vendorId) === B && lSaved.vendorSource === 'APPROVED_QUOTATION', `${lConfirm.status} ${lConfirm.message}`);
  check('L7 confirmation audited', (await vendorTimeline(l)).some((t) => /approved vendor confirmed/.test(t.description)));
  const lAgain = await setVendor(l, lItem, B);
  check('L8 repeated confirm is a no-op (no extra audit entry)', lAgain.status === 200 && (await vendorTimeline(l)).length === 1, `${lAgain.status}`);
  check('L9 confirmed vendor cannot be swapped', (await setVendor(l, lItem, A)).status === 400);
  check('L10 approved quotation documents untouched by the confirm',
    (await fresh(l._id)).quotationApprovalStep.itemApprovedQuotations[0].approvedQuotationDocuments.length === 1);
  const lPoOk = await poFromItems([[l, lItem]], B);
  check('L11 PO with the confirmed vendor created', [200, 201].includes(lPoOk.status) && String(lPoOk.data?.vendorId) === B, `${lPoOk.status} ${lPoOk.message}`);

  // ── N: quotation not required ──
  console.log('\nN  Quotation not required — vendor picked on Pending for PO');
  const n = await newApprovedIndent(['N Grease', 'N Gloves']);
  const [n1, n2] = n.items;
  check('N1 Step 1.2 "Quote Not Required" accepted', (await quote(n, ['QUOTE_NOT_REQUIRED', 'QUOTE_NOT_REQUIRED'])).status === 200);
  const nNow = await fresh(n._id);
  check('N2 Step 1.3 skipped, indent PO-ready without visiting it', nNow.quotationApprovalStep.skipped === true && nNow.overallStatus === 'QUOTATION_APPROVED');
  const n1Row = await rowOf(n1);
  check('N3 Pending for PO row: NOT_REQUIRED / UNASSIGNED', n1Row?.quotationPath === 'NOT_REQUIRED' && n1Row?.vendorState === 'UNASSIGNED', JSON.stringify(n1Row));
  check('N4 inactive vendor refused', (await setVendor(n, n1, G)).status === 400);
  const nPick = await setVendor(n, n1, A);
  check('N5 vendor selected (PO_PREPARATION)', nPick.status === 200 && nPick.data?.vendorState === 'SET' && (await itemNow(n, n1)).vendorSource === 'PO_PREPARATION', `${nPick.status} ${nPick.message}`);
  const nIneligible = await setVendor(n, n1, B);
  check('N5b a vendor outside the item\'s eligible vendors refused', nIneligible.status === 400 && /neither quoted for nor previously supplied/.test(nIneligible.message), `${nIneligible.status} ${nIneligible.message}`);
  await giveBeta(n1);
  const nChange = await setVendor(n, n1, B);
  check('N6 vendor changed before any PO', nChange.status === 200 && String((await itemNow(n, n1)).vendorId) === B);
  check('N7 change audited (from → to)', (await vendorTimeline(n)).some((t) => t.description.includes(`changed from ${alpha.name} to ${beta.name}`)));
  const nClear = await setVendor(n, n1, null);
  check('N8 vendor cleared → UNASSIGNED', nClear.status === 200 && (await rowOf(n1))?.vendorState === 'UNASSIGNED' && !(await itemNow(n, n1)).vendorId);
  await setVendor(n, n1, B);
  const nRow = await rowOf(n1);
  check('N9 Pending for PO row shows the picked vendor', nRow?.vendorState === 'SET' && nRow?.vendorName === beta.name && nRow?.vendorSource === 'PO_PREPARATION');
  const nWrong = await poFromItems([[n, n1]], A);
  check('N10 PO with another vendor refused', nWrong.status === 400 && nWrong.message.includes(`vendor selected on Pending for PO is "${beta.name}"`), `${nWrong.status} ${nWrong.message}`);
  const nPo = await poFromItems([[n, n1]], B);
  check('N11 PO inherits the picked vendor', [200, 201].includes(nPo.status) && String(nPo.data?.vendorId) === B, `${nPo.status} ${nPo.message}`);
  check('N12 vendor locked while the item is on the PO', (await setVendor(n, n1, A)).status === 400);
  const nParty = await poFromItems([[n, n2]], String(party._id));
  check('N13a unpicked item: a legacy Party vendor (no history) is refused — eligible Vendor Master vendors only', nParty.status === 400 && /neither quoted for nor previously supplied/.test(nParty.message), `${nParty.status} ${nParty.message}`);
  const nFree = await poFromItems([[n, n2]], A);
  check('N13 unpicked item takes an eligible vendor on the PO', [200, 201].includes(nFree.status) && String(nFree.data?.vendorId) === A, `${nFree.status} ${nFree.message}`);
  check('N14 indent rolled up to PO_READY', (await fresh(n._id)).overallStatus === 'PO_READY');
  check('N15 PO cancel accepted', (await call('POST', `/procurement/purchase-orders/${nPo.data._id}/cancel`, { remarks: 'e2e' })).status === 200);
  check('N16 cancelled PO frees the item — its vendor pick is kept', String((await itemNow(n, n1)).vendorId) === B && (await rowOf(n1))?.vendorState === 'SET');
  check('N17 vendor changeable again after the cancel', (await setVendor(n, n1, A)).status === 200);
  const n2OnPo = await itemNow(n, n2);
  check('N18 the vendor chosen on the PO is saved on the item (PO_PREPARATION, tied to that PO)', String(n2OnPo.vendorId) === A && n2OnPo.vendorSource === 'PO_PREPARATION' && String(n2OnPo.vendorFromPoId) === String(nFree.data._id), JSON.stringify({ v: n2OnPo.vendorId, s: n2OnPo.vendorSource, p: n2OnPo.vendorFromPoId }));
  check('N19 cancelling that PO gives the item its open vendor back', (await call('POST', `/procurement/purchase-orders/${nFree.data._id}/cancel`, { remarks: 'e2e' })).status === 200
    && !(await itemNow(n, n2)).vendorId && (await rowOf(n2))?.vendorState === 'UNASSIGNED');

  // ── M: mixed multi-line indent ──
  console.log('\nM  Mixed indent — different vendors per line');
  const m = await newApprovedIndent(['M Bolt', 'M Nut', 'M Washer']);
  const [m1, m2, m3] = m.items;
  // Step 1.3 approves a vendor from the item's PREVIOUS vendors only: M Nut is also on Beta's Vendor Master item list.
  await Vendor.updateOne({ code: 'VS-BETA', 'products.skuId': { $ne: m2.skuId } }, { $push: { products: { skuId: m2.skuId, skuCode: m2.skuCode, productName: m2.itemName, rate: 0 } } });
  await quote(m, ['YES', 'YES', 'QUOTE_NOT_REQUIRED']);
  const mOk = await approve(m, ['YES', 'YES', 'QUOTE_NOT_REQUIRED'], [A, B, undefined]);
  check('M1 Step 1.3 with a vendor per quoted line (not-required line needs none)', mOk.status === 200, `${mOk.status} ${mOk.message}`);
  const [r1, r2, r3] = await Promise.all([rowOf(m1), rowOf(m2), rowOf(m3)]);
  check('M2 rows: Alpha / Beta approved, third line UNASSIGNED',
    String(r1?.vendorId) === A && String(r2?.vendorId) === B && r3?.vendorState === 'UNASSIGNED' && r3?.quotationPath === 'NOT_REQUIRED');
  const mBoth = await poFromItems([[m, m1], [m, m2]], A);
  check('M3 one PO for lines approved to different vendors refused', mBoth.status === 400 && mBoth.message.includes(beta.name), `${mBoth.status} ${mBoth.message}`);
  check('M4 PO line 1 with Alpha', [200, 201].includes((await poFromItems([[m, m1]], A)).status));
  check('M5 indent PARTIAL_PO_CREATED', (await fresh(m._id)).overallStatus === 'PARTIAL_PO_CREATED');
  check('M6 PO line 2 with Beta', [200, 201].includes((await poFromItems([[m, m2]], B)).status));
  const n3 = await newApprovedIndent(['N3 Cable Tie']);
  await quote(n3, ['QUOTE_NOT_REQUIRED']);
  await setVendor(m, m3, A);
  const mMulti = await poFromItems([[m, m3], [n3, n3.items[0]]], A);
  check('M7 multi-indent PO (picked + unpicked lines, same vendor)', [200, 201].includes(mMulti.status) && mMulti.data?.indentIds?.length === 2, `${mMulti.status} ${mMulti.message}`);
  check('M8 indent PO_READY after every line is on a PO', (await fresh(m._id)).overallStatus === 'PO_READY');

  // ── V: union rule + vendor persisted from the PO ──
  console.log('\nV  Quoted-only and history-only vendors; the PO vendor persists on the item');
  const v = await newApprovedIndent(['V Quoted', 'V History']);
  const [v1, v2] = v.items;
  const vq = await call('POST', `/procurement/indents/${v._id}/quote-comparative`, { statusDone: 'YES', itemQuotations: [
    { itemId: v1._id, itemName: v1.itemName, statusDone: 'YES', quotationDocuments: [{ ...doc(`vs-${RUN}-0`), vendorId: B, quotedRate: 80, deliveryDays: 3 }] },
    { itemId: v2._id, itemName: v2.itemName, statusDone: 'YES', quotationDocuments: [doc(`vs-${RUN}-1`)] },
  ] });
  check('V1 Step 1.2 with a vendor-tagged quotation accepted', vq.status === 200, `${vq.status} ${vq.message}`);
  check('V2 Step 1.3 for both items with no vendor accepted (optional)', (await approve(v, ['YES', 'YES'], [undefined, undefined])).status === 200);
  const vRows = [await rowOf(v1), await rowOf(v2)];
  const el = (row) => new Map((row?.eligibleVendors || []).map((x) => [String(x.vendorId), x.basis.join('+')]));
  check('V3 Pending for PO eligible vendors: item 1 = Beta (QUOTED only) + Alpha (history); item 2 = Alpha only — Beta never offered for it',
    el(vRows[0]).get(B) === 'QUOTED' && el(vRows[0]).has(A) && el(vRows[1]).has(A) && !el(vRows[1]).has(B),
    JSON.stringify(vRows.map((x) => x?.eligibleVendors?.map((e) => [e.vendorName, e.basis]))));
  const vBoth = await poFromItems([[v, v1], [v, v2]], B);
  check('V4 one PO for both items on Beta refused: Beta never supplied item 2 and did not quote for it', vBoth.status === 400 && /neither quoted for nor previously supplied/.test(vBoth.message), `${vBoth.status} ${vBoth.message}`);
  const vPoB = await poFromItems([[v, v1]], B);
  check('V5 PO on the quoted-only vendor accepted', [200, 201].includes(vPoB.status) && String(vPoB.data?.vendorId) === B, `${vPoB.status} ${vPoB.message}`);
  const v1Saved = await itemNow(v, v1);
  check('V6 the vendor chosen on the PO is saved on the item (APPROVED_QUOTATION — it is a quoted item)', String(v1Saved.vendorId) === B && v1Saved.vendorSource === 'APPROVED_QUOTATION' && String(v1Saved.vendorFromPoId) === String(vPoB.data?._id), JSON.stringify({ v: v1Saved.vendorId, s: v1Saved.vendorSource, p: v1Saved.vendorFromPoId }));
  const vPoA = await poFromItems([[v, v2]], A);
  check('V7 PO on the history-only vendor (no quotation from it) accepted', [200, 201].includes(vPoA.status) && String(vPoA.data?.vendorId) === A, `${vPoA.status} ${vPoA.message}`);
  check('V8 cancelling the PO releases the vendor it supplied', (await call('POST', `/procurement/purchase-orders/${vPoB.data._id}/cancel`, { remarks: 'e2e' })).status === 200 && !(await itemNow(v, v1)).vendorId && (await rowOf(v1))?.vendorState === 'MISSING');

  // ── S: status / auth / concurrency ──
  console.log('\nS  Status, permission and concurrency rules');
  const s = await newApprovedIndent(['S Pending Quote', 'S Rejected']);
  const sNotReady = await setVendor(s, s.items[0], A);
  check('S1 vendor refused before the indent is PO-ready', sNotReady.status === 400 && /not ready for PO/.test(sNotReady.message), `${sNotReady.status} ${sNotReady.message}`);
  check('S2 unknown item refused', (await setVendor(n, { _id: new mongoose.Types.ObjectId() }, A)).status === 400);
  check('S3 unauthenticated request refused', (await setVendor(n, n1, A, { auth: false })).status === 401);
  check('S4 malformed vendor id refused by validation', (await setVendor(n, n1, 'not-an-id')).status === 422);
  const c = await newApprovedIndent(['C Race']);
  await quote(c, ['QUOTE_NOT_REQUIRED']);
  await giveBeta(c.items[0]);
  const race = await Promise.all([setVendor(c, c.items[0], A), setVendor(c, c.items[0], B), setVendor(c, c.items[0], A)]);
  const okCount = race.filter((x) => x.status === 200).length;
  const cItem = await itemNow(c, c.items[0]);
  const cLog = await vendorTimeline(c);
  check('S5 concurrent picks: each answered 200 or 409', race.every((x) => [200, 409].includes(x.status)), race.map((x) => x.status).join(','));
  check('S6 concurrent picks: one consistent vendor, audit matches it',
    [A, B].includes(String(cItem.vendorId)) && cLog.length >= 1 && cLog.length <= okCount && cLog.at(-1).description.endsWith(`${cItem.vendorName} (quotation not required)`),
    `${cItem.vendorName} / ${cLog.map((t) => t.description).join(' | ')}`);

  // ── E: existing records ──
  console.log('\nE  Existing indents and POs');
  const legacyNo = `VS-LEG-${RUN}`;
  const leg = await PurchaseIndent.create({
    indentNumber: legacyNo, approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED',
    items: [{ itemName: `E Legacy Item ${RUN}`, skuCode: `VSLEG${RUN}`.toUpperCase(), quantity: 5, approvedQuantity: 5, approvalStatus: 'APPROVED', itemLineNo: 1 }],
    quoteComparativeStep: { statusDone: 'YES' },
    quotationApprovalStep: { statusDone: 'YES', approvedVendors: [{ vendorId: alpha._id, vendorName: alpha.name, items: [{ itemName: `E Legacy Item ${RUN}`, approvedQty: 5, approvedRate: 9 }] }] },
  });
  const legBody = (vendorId) => ({
    indentId: leg._id, vendorId, expectedDeliveryDate: new Date(Date.now() + 7 * 864e5).toISOString(),
    items: [{ itemName: leg.items[0].itemName, skuCode: leg.items[0].skuCode, quantity: 5, unit: 'Pcs', rate: 9, gstRate: 18 }],
  });
  const legWrong = await call('POST', '/procurement/purchase-orders', legBody(B));
  check('E1 vendor-grain approval: vendor outside its approved list refused', legWrong.status === 400 && legWrong.message.includes(alpha.name), `${legWrong.status} ${legWrong.message}`);
  check('E2 vendor-grain approval: its approved vendor accepted', [200, 201].includes((await call('POST', '/procurement/purchase-orders', legBody(A))).status));
  check('E3 vendor-grain approval: Pending-for-PO vendor action refused', (await setVendor(leg, leg.items[0], A)).status === 400);
  // A draft PO raised for an item whose vendor was never recorded (pre-feature).
  const d = await newApprovedIndent(['E Draft Legacy']);
  await quote(d, ['YES']);
  await approve(d, ['YES'], [A]);
  const dPo = await poFromItems([[d, d.items[0]]], A);
  await PurchaseIndent.updateOne({ _id: d._id }, { $unset: UNSET_VENDOR });
  const dPoDoc = await VendorPurchaseOrder.findById(dPo.data._id).lean();
  const dEdit = await call('PATCH', `/procurement/purchase-orders/${dPo.data._id}`, {
    remarks: 'edited by e2e',
    items: dPoDoc.items.map((it) => ({ indentId: it.indentId, indentItemId: it.indentItemId, itemName: it.itemName, quantity: it.quantity, unit: it.unit, rate: 120, gstRate: 18 })),
  });
  check('E4 legacy draft PO stays editable (no vendor recorded on its item)', dEdit.status === 200, `${dEdit.status} ${dEdit.message}`);
  // A draft PO saved on a legacy Party vendor before the eligibility rule (written straight to the DB) stays editable.
  const partyPoDoc = await VendorPurchaseOrder.create({ draftNumber: `VS-PARTY-${RUN}`, poStatus: 'DRAFT', approvalStatus: 'DRAFT', indentId: leg._id, indentIds: [leg._id], indentNumber: legacyNo, vendorId: party._id, vendorName: PARTY_NAME, items: [{ itemName: 'E party line', quantity: 1, rate: 5, unit: 'Pcs' }] });
  const partyEdit = await call('PATCH', `/procurement/purchase-orders/${partyPoDoc._id}`, { remarks: 'edited by e2e' });
  const partyPo = await VendorPurchaseOrder.findById(partyPoDoc._id).lean();
  check('E5 legacy Party-vendor draft PO keeps its saved vendor through an edit', partyEdit.status === 200 && String(partyPo.vendorId) === String(party._id) && partyPo.vendorName === PARTY_NAME, `${partyEdit.status} ${partyEdit.message}`);
  const partyEditVendor = await call('PATCH', `/procurement/purchase-orders/${partyPoDoc._id}`, { vendorId: B });
  check('E6 …but moving it to a vendor with no purchase history is refused', partyEditVendor.status === 400, `${partyEditVendor.status} ${partyEditVendor.message}`);

  // ── X: concurrency ──
  console.log('\nX  Concurrency — PO creation is atomic; draft edits are guarded');
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  const txns = !!hello.setName;
  const TRIALS = Number(process.env.RACE_TRIALS || 10);
  const pause = (ms) => new Promise((res) => { setTimeout(res, ms); });
  const raceCheck = (label, ok, detail) => {
    if (txns) check(label, ok, detail);
    else console.log(`  SKIP  ${label} — standalone mongod has no transactions (${ok ? 'no race seen this run' : `race seen: ${detail}`})`);
  };
  const quoteNotRequired = async (name) => { const ind = await newApprovedIndent([name]); await quote(ind, ['QUOTE_NOT_REQUIRED']); await giveBeta(ind.items[0]); return ind; };
  const activePos = (ind) => VendorPurchaseOrder.find({ indentIds: ind._id, isDeleted: { $ne: true }, poStatus: { $ne: 'CANCELLED' } }).lean();
  const bad = { A: [], B: [], C: [], link: [], codes: new Set() };
  for (let t = 0; t < TRIALS; t += 1) {
    const jitter = (t % 5) * 10;
    // A — two POs for one open item, different vendors.
    const a = await quoteNotRequired('XA Race');
    const ra = await Promise.all([poFromItems([[a, a.items[0]]], A), pause(jitter).then(() => poFromItems([[a, a.items[0]]], B))]);
    ra.forEach((x) => bad.codes.add(x.status));
    const aPos = await activePos(a);
    if (aPos.length !== 1) bad.A.push(`${aPos.length} POs (${ra.map((x) => x.status).join('/')})`);
    const aItem = await itemNow(a, a.items[0]);
    if (aPos.length === 1 && String(aItem.poId) !== String(aPos[0]._id)) bad.link.push(`A item→${aItem.poId} PO ${aPos[0]._id}`);
    // B — PO on the picked vendor while the pick changes.
    const b = await quoteNotRequired('XB Race');
    await setVendor(b, b.items[0], A);
    const [bPo, bSv] = await Promise.all([poFromItems([[b, b.items[0]]], A), pause(jitter).then(() => setVendor(b, b.items[0], B))]);
    bad.codes.add(bPo.status); bad.codes.add(bSv.status);
    const bItem = await itemNow(b, b.items[0]);
    const bPos = await activePos(b);
    if (bPos.some((p) => String(p.vendorId) !== String(bItem.vendorId))) bad.B.push(`PO ${bPos.map((p) => p.vendorName)} vs item ${bItem.vendorName} (${bPo.status}/${bSv.status})`);
    if (bPos.length === 1 && String(bItem.poId) !== String(bPos[0]._id)) bad.link.push(`B item→${bItem.poId}`);
    // C — PO on the approved vendor while Step 1.3 is re-approved for another.
    const c = await newApprovedIndent(['XC Race']);
    await giveBeta(c.items[0]);
    await quote(c, ['YES']);
    await approve(c, ['YES'], [A]);
    const [cPo, cRe] = await Promise.all([poFromItems([[c, c.items[0]]], A), pause(jitter).then(() => approve(c, ['YES'], [B]))]);
    bad.codes.add(cPo.status); bad.codes.add(cRe.status);
    const cItem = await itemNow(c, c.items[0]);
    const cPos = await activePos(c);
    if (cPos.some((p) => String(p.vendorId) !== String(cItem.vendorId))) bad.C.push(`PO ${cPos.map((p) => p.vendorName)} vs approved ${cItem.vendorName} (${cPo.status}/${cRe.status})`);
    if (cPos.length === 1 && String(cItem.poId) !== String(cPos[0]._id)) bad.link.push(`C item→${cItem.poId}`);
  }
  raceCheck(`X1 concurrent POs for one item → exactly one PO (${TRIALS} trials)`, bad.A.length === 0, bad.A.join('; '));
  raceCheck(`X2 PO vs vendor change → PO never on a stale pick (${TRIALS} trials)`, bad.B.length === 0, bad.B.join('; '));
  raceCheck(`X3 PO vs Step 1.3 re-approval → PO never on a stale approved vendor (${TRIALS} trials)`, bad.C.length === 0, bad.C.join('; '));
  raceCheck('X4 every PO that was created is linked to its item', bad.link.length === 0, bad.link.join('; '));
  check('X5 race losers answer 400/409, never 5xx', [...bad.codes].every((s) => s < 500), [...bad.codes].join(','));

  // Draft edit attaching another indent's item (fixed to Beta) onto an Alpha PO — refused.
  const ex = await quoteNotRequired('XE Base');
  const ey = await quoteNotRequired('XE Other');
  await setVendor(ey, ey.items[0], B);
  const exPo = (await poFromItems([[ex, ex.items[0]]], A)).data;
  const lineOf = ([ind, it]) => ({ indentId: ind._id, indentItemId: it._id, itemName: it.itemName, quantity: 5, unit: 'Pcs', rate: 10, gstRate: 18 });
  const exAdd = await call('PATCH', `/procurement/purchase-orders/${exPo._id}`, { items: [lineOf([ex, ex.items[0]]), lineOf([ey, ey.items[0]])] });
  check('X6 draft edit cannot attach an indent item that is not on the PO', exAdd.status === 400 && /not on this PO/.test(exAdd.message), `${exAdd.status} ${exAdd.message}`);
  check('X7 refused edit left the PO unchanged', (await VendorPurchaseOrder.findById(exPo._id).lean()).items.length === 1);
  const exOk = await call('PATCH', `/procurement/purchase-orders/${exPo._id}`, {
    items: [{ ...lineOf([ex, ex.items[0]]), rate: 12 }, { itemName: `XE Freight ${RUN}`, quantity: 1, unit: 'Nos', rate: 50, gstRate: 18 }],
  });
  check('X8 draft edit may still change its own lines and add a plain line', exOk.status === 200 && exOk.data?.items?.length === 2, `${exOk.status} ${exOk.message}`);
  // Draft edit racing approval: an edit never lands on an approved PO.
  let editAfterApproval = 0;
  const edCodes = new Set();
  for (let t = 0; t < TRIALS; t += 1) {
    const d2 = await quoteNotRequired('XD Race');
    const d2Po = (await poFromItems([[d2, d2.items[0]]], A)).data;
    const [ap, up] = await Promise.all([
      call('POST', `/procurement/purchase-orders/${d2Po._id}/approve`, { decision: 'APPROVED' }),
      pause((t % 5) * 10).then(() => call('PATCH', `/procurement/purchase-orders/${d2Po._id}`, { items: [{ ...lineOf([d2, d2.items[0]]), rate: 99 }] })),
    ]);
    edCodes.add(up.status);
    const after = await VendorPurchaseOrder.findById(d2Po._id).lean();
    const tl = after.activityTimeline || [];
    const lastUpdate = tl.map((e) => e.action).lastIndexOf('UPDATE');
    const approvedAt = tl.findIndex((e) => /APPROV/.test(e.action || ''));
    if (ap.status < 300 && up.status < 300 && after.approvalStatus === 'APPROVED' && approvedAt >= 0 && lastUpdate > approvedAt) editAfterApproval += 1;
  }
  check(`X9 draft edit racing approval never edits the approved PO (${TRIALS} trials)`, editAfterApproval === 0 && [...edCodes].every((s) => [200, 400, 409].includes(s)), `${editAfterApproval} late edits, codes ${[...edCodes]}`);
  // Single-indent create(): every item is linked, also when lines carry no SKU.
  const sc = await quoteNotRequired('XS Single');
  const scPo = await call('POST', '/procurement/purchase-orders', {
    indentId: sc._id, vendorId: A, expectedDeliveryDate: new Date(Date.now() + 7 * 864e5).toISOString(), items: [lineOf([sc, sc.items[0]])],
  });
  const scItem = await itemNow(sc, sc.items[0]);
  check('X10 single-indent PO links its item (no SKU on the line)', [200, 201].includes(scPo.status) && String(scItem.poId) === String(scPo.data?._id) && scItem.procurementStatus === 'PO_CREATED', `${scPo.status} ${scPo.message}`);
  console.log(`  (database: ${txns ? `replica set ${hello.setName} — transactions on` : 'standalone — no transactions'})`);

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
};

if (isEntry(import.meta.url)) {
  const mode = process.argv[2];
  try {
    if (mode === '--seed') await seed();
    else if (mode === '--api') await api();
    else { console.log('usage: --seed | --api'); process.exitCode = 2; }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
