/**
 * API oracle for "vendor selection is explicit; the PO offers Select Previous Vendor / Add New Vendor".
 *
 *   node src/scripts/e2eVendorPickFixture.js --seed     upsert user, vendors, SKUs, history POs (never drops)
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5106 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_vendorpick node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5106/api/v1 node src/scripts/e2eVendorPickFixture.js --api
 *
 * --api creates fresh indents / POs on every run (re-runnable).
 *   R  root cause     — what the PO picker row says when a quotation was uploaded / approved with no vendor
 *   V  previous       — "Select Previous Vendor" list = actual placed-PO history, active vendors only
 *   N  add new        — any ACTIVE Vendor Master vendor can take the PO, history or not; inactive / deleted /
 *                       legacy Party refused (server-side)
 *   X  explicit       — a vendor picked earlier (Quote Required = No) is kept; the user may change it; a vendor
 *                       approved with a quotation (Step 1.3) stays locked
 *   M  separate POs   — items on different vendors → separate POs with independent terms; the same indent rolls up
 *   P  Pending for PO — "Select Vendor" accepts any active vendor
 *   J  JSL            — Jindal needs no history; a JSL PO is still only for Jindal
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard (S3 + email off).
 * Never reads MONGO_URI. Nothing here drops or resets a DB.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import Party from '../modules/clients/party.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';

export const DB_NAME = 'ambika_e2e_vendorpick';
export const E2E_URI = process.env.E2E_VENDORPICK_URI || `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eVendorPickFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5106/api/v1').replace(/\/+$/, '');
const LOGIN = { email: 'vp-md@test.local', password: 'E2e@12345' };
const VENDORS = [
  { code: 'VP-A', name: 'VP Alpha Previous', isActive: true, location: 'Rajkot' },
  { code: 'VP-B', name: 'VP Beta Previous', isActive: true },
  { code: 'VP-SOLO', name: 'VP Solo Previous', isActive: true },
  { code: 'VP-NEW', name: 'VP New Vendor', isActive: true },
  { code: 'VP-QUOTED', name: 'VP Quote Tagged', isActive: true },
  { code: 'VP-CAT', name: 'VP Catalog Only', isActive: true },
  { code: 'VP-OFF', name: 'VP Inactive Vendor', isActive: false },
  { code: 'VP-GONE', name: 'VP Deleted Vendor', isActive: true },
  { code: 'VP-JIN', name: 'Jindal Stainless Ltd', isActive: true },
];
const SKUS = {
  S1: { code: 'VP-S1', name: 'VP Bearing' },   // previous vendors: Beta (latest PO), Alpha; Inactive has a PO; draft/cancelled POs ignored
  S2: { code: 'VP-S2', name: 'VP Seal' },      // exactly ONE previous vendor (Solo)  — the one the form used to auto-pick
  S3: { code: 'VP-S3', name: 'VP Gadget' },    // NO purchase history (Catalog Only lists it on its item list)
  S4: { code: 'VP-S4', name: 'VP Washer' },    // NO purchase history
  S5: { code: 'VP-S5', name: 'VP Spring' },    // NO purchase history
  JSL: { code: 'VP-JSL', name: 'VP Steel Sheet' },
};
const PARTY_NAME = 'VP Legacy Party Vendor';
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

// ── Seed (idempotent — never drops) ────────────────────────────────────────
const seed = async () => {
  await connect();
  if (!await User.findOne({ email: LOGIN.email })) {
    await User.create({ ...LOGIN, name: 'E2E Vendor Pick MD', role: 'MD', roles: ['MD'], mobile: '9000000191', isActive: true });
  }
  for (const v of VENDORS) {
    await Vendor.updateOne({ code: v.code }, { $set: { name: v.name, isActive: v.isActive, isDeleted: false, ...(v.location ? { location: v.location } : {}) } }, { upsert: true });
  }
  for (const s of Object.values(SKUS)) {
    await SKU.updateOne({ code: s.code }, { $setOnInsert: { code: s.code, name: s.name, unit: 'PCS', itemType: 'CONSUMABLE' } }, { upsert: true });
  }
  let party = await Party.findOne({ name: PARTY_NAME });
  if (!party) party = await Party.create({ name: PARTY_NAME, partyType: 'VENDOR' }).catch(() => Party.create({ name: PARTY_NAME }));
  const v = Object.fromEntries(await Promise.all(VENDORS.map(async (x) => [x.code, await Vendor.findOne({ code: x.code }).lean()])));
  const s = Object.fromEntries(await Promise.all(Object.keys(SKUS).map(async (k) => [k, await skuDoc(k)])));
  // Catalog Only lists S3 on its Vendor Master item list but never bought it — NOT purchase history.
  await Vendor.updateOne({ code: 'VP-CAT' }, { $set: { products: [{ skuId: s.S3._id, skuCode: s.S3.code, productName: s.S3.name, rate: 70 }] } });

  // History POs (inserted directly — fixed numbers so a re-seed is a no-op).
  const indentId = new mongoose.Types.ObjectId('000000000000000000000def');
  const po = async (poNumber, vendor, poStatus, lines, poDate) => {
    if (await VendorPurchaseOrder.findOne({ poNumber })) return;
    await VendorPurchaseOrder.create({
      poNumber, poStatus, poDate: new Date(poDate), indentId, indentIds: [indentId], indentNumber: 'VP-HIST-IND',
      vendorId: vendor._id, vendorName: vendor.name,
      items: lines.map((l) => ({ itemName: l.name || 'hist', quantity: 5, rate: l.rate ?? 100, ...l })),
    });
  };
  await po('VP/PO/1', v['VP-A'], 'APPROVED', [{ skuId: s.S1._id, skuCode: s.S1.code, rate: 100 }], '2026-09-01');
  await po('VP/PO/2', v['VP-A'], 'RELEASED_TO_VENDOR', [{ skuId: s.S1._id, skuCode: s.S1.code, rate: 110 }], '2026-10-15');
  await po('VP/PO/3', v['VP-B'], 'CLOSED', [{ skuId: s.S1._id, skuCode: s.S1.code, rate: 95 }], '2026-10-20');
  await po('VP/PO/4', v['VP-OFF'], 'APPROVED', [{ skuId: s.S1._id, skuCode: s.S1.code }], '2026-10-21');
  await po('VP/PO/5', v['VP-NEW'], 'DRAFT', [{ skuId: s.S1._id, skuCode: s.S1.code }], '2026-10-22');
  await po('VP/PO/6', v['VP-NEW'], 'CANCELLED', [{ skuId: s.S1._id, skuCode: s.S1.code }], '2026-10-23');
  await po('VP/PO/7', v['VP-SOLO'], 'APPROVED', [{ skuId: s.S2._id, skuCode: s.S2.code, rate: 40 }], '2026-10-01');
  console.log(`[seed] ${DB_NAME}: user ${LOGIN.email} / ${LOGIN.password}; ${VENDORS.length} vendors, ${Object.keys(SKUS).length} SKUs, 7 history POs`);
};

// ── HTTP ───────────────────────────────────────────────────────────────────
let token = '';
const call = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
const login = async () => {
  const r = await call('POST', '/auth/login', { email: LOGIN.email, password: LOGIN.password });
  token = r.data?.token || r.data?.accessToken || '';
  if (!token) throw new Error(`login failed: ${r.status} ${r.message} — run --seed first`);
};

// A fresh approved indent. spec[i] = { sku, quote?: vendorId (tag on the quote file), nr?: vendorId (Quote Required = No, vendor picked) }.
const mkIndent = async (spec) => {
  const items = [];
  for (const [i, sp] of spec.entries()) {
    const s = await skuDoc(sp.sku);
    items.push({ skuId: String(s._id), skuCode: s.code, itemName: s.name, quantity: 10 + i, unit: 'Pcs' });
  }
  const ind = await ok('POST', '/procurement/indents', { department: 'Stores', remarks: `vendor pick e2e ${RUN}`, items });
  await ok('POST', `/procurement/indents/${ind._id}/submit`, {});
  const appr = await ok('POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
  const allNr = spec.every((sp) => sp.nr);
  await ok('POST', `/procurement/indents/${ind._id}/quote-comparative`, {
    statusDone: allNr ? 'QUOTE_NOT_REQUIRED' : 'YES',
    itemQuotations: appr.items.map((it, i) => (spec[i].nr
      ? { itemId: it._id, itemName: it.itemName, statusDone: 'QUOTE_NOT_REQUIRED', vendorId: spec[i].nr, quotationDocuments: [] }
      : {
        itemId: it._id, itemName: it.itemName, statusDone: 'YES',
        quotationDocuments: [{ ...doc(`q-${RUN}-${spec[i].sku}-${i}`), ...(spec[i].quote ? { vendorId: spec[i].quote, quotedRate: 80 + i, deliveryDays: 5 + i } : {}) }],
      })),
  });
  return ok('GET', `/procurement/indents/${ind._id}`);
};
const fresh = (id) => ok('GET', `/procurement/indents/${id}`);
const filesOf = (indent, i) => (indent.quoteComparativeStep.itemQuotations.find((q) => String(q.itemId) === String(indent.items[i]._id))?.quotationDocuments || [])
  .map((d) => ({ fileName: d.fileName, fileUrl: d.fileUrl, fileType: d.fileType }));
const approve13 = (indent, rows) => call('POST', `/procurement/indents/${indent._id}/approve-quotation`, { itemApprovedQuotations: rows });
// Step 1.3 for every QUOTED item; `vendors[i]` = the vendor approved for it (omit → approved WITHOUT a vendor).
const approveQuoted = async (indent, spec, vendors = []) => {
  const rows = [];
  indent.items.forEach((it, i) => {
    if (spec[i].nr) return;
    rows.push({
      itemId: it._id, itemName: it.itemName, statusDone: 'YES', approvedQuotationDocuments: filesOf(indent, i),
      ...(vendors[i] ? { vendorId: vendors[i] } : {}), actualAt: '2026-11-20', remarks: `r${i}`,
    });
  });
  if (!rows.length) return fresh(indent._id);
  const r = await approve13(indent, rows);
  if (r.status >= 400) throw new Error(`approve-quotation → ${r.status} ${r.message}`);
  return fresh(indent._id);
};
const readyIndent = async (spec, vendors = []) => approveQuoted(await mkIndent(spec), spec, vendors);
const pickerRow = async (indent, i) => (await ok('GET', '/procurement/purchase-orders/approved-items')).items
  .find((r) => String(r.indentItemId) === String(indent.items[i]._id));
const names = (list) => (list || []).map((v) => v.vendorName);

const dayIso = (n) => new Date(Date.now() + n * 864e5).toISOString();
const line = (indent, i, extra = {}) => ({
  indentId: indent._id, indentItemId: indent.items[i]._id, itemName: indent.items[i].itemName,
  skuCode: indent.items[i].skuCode, skuId: indent.items[i].skuId,
  quantity: indent.items[i].approvedQuantity || indent.items[i].quantity, unit: 'Pcs', rate: 100, gstRate: 18, ...extra,
});
const poBody = (vId, lines, extra = {}) => ({ vendorId: vId, expectedDeliveryDate: dayIso(7), items: lines, ...extra });
const createPo = (vId, lines, extra) => call('POST', '/procurement/purchase-orders/create-from-items', poBody(vId, lines, extra));
const getPo = (id) => ok('GET', `/procurement/purchase-orders/${id}`);
// The PO a create call returned, or an empty stand-in when the call was refused (so one failed check does not abort the run).
const safePo = (r) => (r?.data?._id ? getPo(r.data._id) : Promise.resolve({ items: [], vendorId: null }));
const itemOf = (indent, i) => indent.items[i];
const setVendor = (indent, i, vId) => call('PATCH', '/procurement/purchase-orders/approved-items/vendor', { indentId: indent._id, indentItemId: indent.items[i]._id, vendorId: vId });

const api = async () => {
  await connect();
  await login();
  const A = await vendorId('VP-A'); const B = await vendorId('VP-B'); const SOLO = await vendorId('VP-SOLO');
  const NEWV = await vendorId('VP-NEW'); const QV = await vendorId('VP-QUOTED'); const CAT = await vendorId('VP-CAT');
  const OFF = await vendorId('VP-OFF'); const JIN = await vendorId('VP-JIN');
  // A vendor that is deleted after the picker could have listed it.
  await Vendor.updateOne({ code: 'VP-GONE' }, { $set: { isActive: true, isDeleted: true } });
  const GONE = await vendorId('VP-GONE');
  const party = await Party.findOne({ name: PARTY_NAME }).lean();

  // ── R — root cause: nothing is selected just because a quotation exists ──
  console.log('\nR  quotation uploaded / approved without a vendor → the PO row has NO vendor');
  const r1 = await mkIndent([{ sku: 'S2' }, { sku: 'S3', quote: QV }]);   // S2: one previous vendor · S3: quote file tagged with a vendor, no history
  const r1a = await pickerRow(r1, 0);
  check('R0 a quoted indent is not on the PO picker before Step 1.3 approves it', r1a === undefined, JSON.stringify(r1a && { s: r1a.vendorState }));
  const r1b = await approveQuoted(r1, [{ sku: 'S2' }, { sku: 'S3', quote: QV }]);
  const rowSolo = await pickerRow(r1b, 0);
  const rowTag = await pickerRow(r1b, 1);
  check('R1 approved WITHOUT a vendor: the row carries no vendor (state MISSING, vendorId null)', rowSolo?.vendorState === 'MISSING' && !rowSolo.vendorId && !itemOf(r1b, 0).vendorId, JSON.stringify(rowSolo && { s: rowSolo.vendorState, v: rowSolo.vendorId }));
  check('R2 …even with exactly one previous vendor (Solo) — it is offered, never selected', names(rowSolo?.previousVendors).join() === 'VP Solo Previous' && !rowSolo.vendorId, JSON.stringify(rowSolo?.previousVendors));
  check('R3 a vendor named on the quotation file is only a hint: row stays MISSING, vendorId null', rowTag?.vendorState === 'MISSING' && !rowTag.vendorId && !itemOf(r1b, 1).vendorId && (rowTag.quotedVendors || []).some((q) => String(q.vendorId) === QV), JSON.stringify(rowTag && { s: rowTag.vendorState, v: rowTag.vendorId, q: rowTag.quotedVendors }));
  check('R4 …and the quote-tagged vendor is NOT a previous vendor (no purchase ever)', !names(rowTag?.previousVendors).includes('VP Quote Tagged') && (rowTag?.previousVendors || []).length === 0, JSON.stringify(rowTag?.previousVendors));
  const noVendor = await call('POST', '/procurement/purchase-orders/create-from-items', { expectedDeliveryDate: dayIso(7), items: [line(r1b, 0)] });
  check('R5 a PO with no vendor chosen is refused by the API (the server never fills one in)', noVendor.status >= 400, `${noVendor.status} ${noVendor.message}`);
  check('R6 the refused request changed nothing: item still has no vendor and is not on a PO', !itemOf(await fresh(r1._id), 0).vendorId && !itemOf(await fresh(r1._id), 0).poId);

  // ── V — Select Previous Vendor ───────────────────────────────────────────
  console.log('\nV  Select Previous Vendor = actual placed-PO history, active vendors only');
  const v1 = await readyIndent([{ sku: 'S1' }, { sku: 'S2' }, { sku: 'S3' }]);
  const vRow = await pickerRow(v1, 0);
  const prev = vRow?.previousVendors || [];
  check('V1 S1 lists its two previous vendors, latest purchase first (Beta then Alpha)', names(prev).join() === 'VP Beta Previous,VP Alpha Previous', JSON.stringify(names(prev)));
  check('V2 each shows the purchase reference: last PO number, date, rate and PO count', prev[0]?.lastPoNumber === 'VP/PO/3' && Number(prev[0]?.lastRate) === 95 && !!prev[0]?.lastPoDate
    && prev[1]?.lastPoNumber === 'VP/PO/2' && prev[1]?.poCount === 2 && Number(prev[1]?.lastRate) === 110, JSON.stringify(prev));
  check('V3 an inactive vendor with a placed PO is not listed; neither are draft / cancelled-PO vendors', !names(prev).includes('VP Inactive Vendor') && !names(prev).includes('VP New Vendor'), JSON.stringify(names(prev)));
  const sRow = await pickerRow(v1, 2);
  check('V4 a vendor that only lists the SKU on its Vendor Master item list (Catalog Only) is NOT a previous vendor — S3 has none', (sRow?.previousVendors || []).length === 0, JSON.stringify(sRow?.previousVendors));

  // ── N — Add New Vendor ───────────────────────────────────────────────────
  console.log('\nN  Add New Vendor — any ACTIVE Vendor Master vendor, no history needed');
  const noHist = await createPo(NEWV, [line(v1, 2)], { saveMode: 'DRAFT' });
  check('N1 item with NO purchase history: a vendor that never supplied / quoted it (New) takes the PO', noHist.status === 201, `${noHist.status} ${noHist.message}`);
  const v1b = await fresh(v1._id);
  check('N2 the vendor chosen on the PO is recorded on the item, tagged with the PO (so a cancel gives the item back)', String(itemOf(v1b, 2).vendorId) === NEWV && String(itemOf(v1b, 2).vendorFromPoId) === String(noHist.data?._id) && itemOf(v1b, 2).vendorSource === 'APPROVED_QUOTATION', JSON.stringify(itemOf(v1b, 2)));
  const diff = await createPo(CAT, [line(v1, 1)], { saveMode: 'DRAFT' });
  check('N3 an item WITH previous vendors (S2: Solo) can still go to a different, non-previous vendor (Catalog Only)', diff.status === 201 && String((await safePo(diff)).vendorId) === CAT, `${diff.status} ${diff.message}`);
  const inactive = await createPo(OFF, [line(v1, 0)]);
  check('N4 an INACTIVE vendor is refused (400)', inactive.status === 400 && /inactive/i.test(inactive.message), `${inactive.status} ${inactive.message}`);
  const gone = await createPo(GONE, [line(v1, 0)]);
  check('N5 a DELETED vendor is refused', gone.status >= 400 && !/must be the same/.test(gone.message), `${gone.status} ${gone.message}`);
  const legacy = party ? await createPo(String(party._id), [line(v1, 0)]) : { status: 0, message: 'no party seeded' };
  check('N6 a legacy Party record (not a Vendor Master vendor) is refused for an item with no vendor fixed', legacy.status === 400 && /Vendor Master/.test(legacy.message), `${legacy.status} ${legacy.message}`);
  const ghost = await createPo(String(new mongoose.Types.ObjectId()), [line(v1, 0)]);
  check('N7 an unknown vendor id is refused', ghost.status >= 400, `${ghost.status} ${ghost.message}`);
  const prevPick = await createPo(B, [line(v1, 0)], { saveMode: 'DRAFT' });
  check('N8 a previous vendor (Beta) takes the PO as before', prevPick.status === 201, `${prevPick.status} ${prevPick.message}`);
  const cancel = await call('POST', `/procurement/purchase-orders/${noHist.data?._id}/cancel`, {});
  const v1c = await fresh(v1._id);
  check('N9 cancelling the PO gives the item back with NO vendor (the user must choose again)', cancel.status === 200 && !itemOf(v1c, 2).vendorId && !itemOf(v1c, 2).poId, `${cancel.status} v=${itemOf(v1c, 2).vendorId}`);
  const reNew = await pickerRow(v1c, 2);
  check('N10 …and the picker row is back to "no vendor"', reNew?.vendorState === 'MISSING' && !reNew.vendorId, JSON.stringify(reNew && { s: reNew.vendorState, v: reNew.vendorId }));

  // ── X — an earlier explicit selection ────────────────────────────────────
  console.log('\nX  explicit selection made earlier');
  const x1 = await mkIndent([{ sku: 'S1', nr: A }, { sku: 'S1', nr: B }]);   // Quote Required = No, vendor picked (from purchase history)
  const x0 = await pickerRow(x1, 0);
  check('X1 Quote Required = No with a vendor picked: the row is SET to that vendor (source Pending-for-PO / No-quote pick)', x0?.vendorState === 'SET' && String(x0.vendorId) === A && x0.vendorSource === 'PO_PREPARATION', JSON.stringify(x0 && { s: x0.vendorState, v: x0.vendorId, src: x0.vendorSource }));
  const keep = await createPo(A, [line(x1, 0)], { saveMode: 'DRAFT' });
  const x1b = await fresh(x1._id);
  check('X2 the PO on that same vendor is accepted and the selection is preserved on the item', keep.status === 201 && String(itemOf(x1b, 0).vendorId) === A && itemOf(x1b, 0).vendorSource === 'PO_PREPARATION' && !itemOf(x1b, 0).vendorFromPoId, `${keep.status} ${keep.message} ${JSON.stringify(itemOf(x1b, 0))}`);
  await call('POST', `/procurement/purchase-orders/${keep.data?._id}/cancel`, {});
  check('X3 cancelling that PO does NOT erase the explicit selection (it was not written by the PO)', String(itemOf(await fresh(x1._id), 0).vendorId) === A);
  const chg = await createPo(NEWV, [line(x1, 1)], { saveMode: 'DRAFT' });
  const x1c = await fresh(x1._id);
  check('X4 the user can CHANGE a Quote-Required=No selection on the PO (Beta → New): accepted, item now follows the PO vendor', chg.status === 201 && String(itemOf(x1c, 1).vendorId) === NEWV && String(itemOf(x1c, 1).vendorFromPoId) === String(chg.data?._id), `${chg.status} ${chg.message} ${JSON.stringify(itemOf(x1c, 1))}`);
  check('X5 …and the change is on the audit trail of the indent', (x1c.activityTimeline || []).some((t) => t.action === 'ITEM_VENDOR' && /VP Beta Previous/.test(t.description) && /VP New Vendor/.test(t.description)), JSON.stringify((x1c.activityTimeline || []).slice(-3)));
  const inactiveChg = await createPo(OFF, [line(x1, 0)]);
  check('X6 changing it to an inactive vendor is still refused', inactiveChg.status === 400 && /inactive/i.test(inactiveChg.message), `${inactiveChg.status} ${inactiveChg.message}`);
  const x2 = await readyIndent([{ sku: 'S1', quote: QV }], [A]);   // vendor approved WITH the quotation at Step 1.3
  const x2row = await pickerRow(x2, 0);
  check('X7 a vendor approved with the quotation at Step 1.3 is SET (source approved quotation)', x2row?.vendorState === 'SET' && String(x2row.vendorId) === A && x2row.vendorSource === 'APPROVED_QUOTATION', JSON.stringify(x2row && { s: x2row.vendorState, v: x2row.vendorId }));
  const lockedOther = await createPo(NEWV, [line(x2, 0)]);
  check('X8 …and stays locked: a different vendor is refused ("must be the same")', lockedOther.status === 400 && /must be the same/.test(lockedOther.message), `${lockedOther.status} ${lockedOther.message}`);
  const lockedSame = await createPo(A, [line(x2, 0)], { saveMode: 'DRAFT' });
  check('X9 the approved vendor itself takes the PO', lockedSame.status === 201, `${lockedSame.status} ${lockedSame.message}`);

  // ── M — different vendors per item → separate POs, independent terms ─────
  console.log('\nM  items on different vendors → separate POs, independent terms');
  const m1 = await readyIndent([{ sku: 'S1' }, { sku: 'S4' }, { sku: 'S5' }]);
  const T = {
    A: { expectedDeliveryDate: dayIso(7), deliveryTerms: 'Ex-works A', paymentTerms: '30 days A', creditPeriod: 30, remarks: 'Remarks A', termsAndConditions: 'T&C for A only' },
    N: { expectedDeliveryDate: dayIso(14), deliveryTerms: 'Door delivery N', paymentTerms: '45 days N', creditPeriod: 45, remarks: 'Remarks N', termsAndConditions: 'T&C for N only' },
    Q: { expectedDeliveryDate: dayIso(21), deliveryTerms: 'Pick-up Q', paymentTerms: 'Advance Q', creditPeriod: 0, remarks: 'Remarks Q', termsAndConditions: 'T&C for Q only' },
  };
  const mA = await createPo(A, [line(m1, 0)], { ...T.A, saveMode: 'DRAFT' });     // previous vendor
  const mN = await createPo(NEWV, [line(m1, 1)], { ...T.N, saveMode: 'DRAFT' });  // Add New Vendor, no history
  const mQ = await createPo(QV, [line(m1, 2)], { ...T.Q, saveMode: 'DRAFT' });    // Add New Vendor (quote-tagged elsewhere), no history
  check('M1 three items → three separate POs on three vendors (one previous, two added)', [mA, mN, mQ].every((r) => r.status === 201)
    && new Set([mA, mN, mQ].map((r) => String(r.data?._id))).size === 3, `${mA.status} ${mA.message} / ${mN.status} ${mN.message} / ${mQ.status} ${mQ.message}`);
  const gA = await safePo(mA); const gN = await safePo(mN); const gQ = await safePo(mQ);
  const pick = (g) => [g.deliveryTerms, g.paymentTerms, g.creditPeriod, g.remarks, g.termsAndConditions];
  check('M2 each PO keeps its own delivery terms, payment terms, credit period, remarks and T&C', JSON.stringify(pick(gA)) === JSON.stringify(['Ex-works A', '30 days A', 30, 'Remarks A', 'T&C for A only'])
    && JSON.stringify(pick(gN)) === JSON.stringify(['Door delivery N', '45 days N', 45, 'Remarks N', 'T&C for N only'])
    && JSON.stringify(pick(gQ)) === JSON.stringify(['Pick-up Q', 'Advance Q', 0, 'Remarks Q', 'T&C for Q only']), JSON.stringify([pick(gA), pick(gN), pick(gQ)]));
  const lead = (g) => Math.round((new Date(g.expectedDeliveryDate) - new Date(g.poDate)) / 864e5);
  check('M3 each keeps its own Expected Delivery Date', lead(gA) === 7 && lead(gN) === 14 && lead(gQ) === 21, `${lead(gA)}/${lead(gN)}/${lead(gQ)}`);
  check('M4 each PO holds only its own vendor and item', [gA, gN, gQ].every((g) => g.items.length === 1)
    && String(gA.vendorId) === A && String(gN.vendorId) === NEWV && String(gQ.vendorId) === QV
    && String(gA.items[0].indentItemId) === String(m1.items[0]._id) && String(gN.items[0].indentItemId) === String(m1.items[1]._id) && String(gQ.items[0].indentItemId) === String(m1.items[2]._id), '');
  const m1b = await fresh(m1._id);
  check('M5 the one indent rolls up to PO_READY once every item is on a PO', m1b.overallStatus === 'PO_READY', m1b.overallStatus);
  await call('PATCH', `/procurement/purchase-orders/${mA.data?._id}/terms`, { termsAndConditions: 'Edited A terms' });
  check('M6 editing one PO\'s terms leaves the others untouched', (await safePo(mA)).termsAndConditions === 'Edited A terms' && (await safePo(mN)).termsAndConditions === 'T&C for N only' && (await safePo(mQ)).termsAndConditions === 'T&C for Q only');
  // A draft moved to another active vendor: grouping follows.
  const edit = await call('PATCH', `/procurement/purchase-orders/${mN.data?._id}`, { vendorId: B });
  const m1c = await fresh(m1._id);
  check('M7 a draft PO changed to another vendor is accepted and the item vendor follows', edit.status === 200 && String((await safePo(mN)).vendorId) === B && String(itemOf(m1c, 1).vendorId) === B, `${edit.status} ${edit.message} item=${itemOf(m1c, 1).vendorId}`);
  const editBad = await call('PATCH', `/procurement/purchase-orders/${mN.data?._id}`, { vendorId: OFF });
  check('M8 …but not onto an inactive vendor', editBad.status === 400, `${editBad.status} ${editBad.message}`);

  // ── P — Pending for PO "Select Vendor" ───────────────────────────────────
  console.log('\nP  Pending for PO — Select Vendor');
  const p1 = await readyIndent([{ sku: 'S3' }, { sku: 'S4' }]);
  const pSet = await setVendor(p1, 0, NEWV);
  check('P1 any active vendor can be selected for an item with no history (no "No eligible vendors" dead end)', pSet.status === 200 && String(pSet.data?.vendorId) === NEWV, `${pSet.status} ${pSet.message}`);
  const pOff = await setVendor(p1, 1, OFF);
  check('P2 an inactive vendor is refused', pOff.status === 400 && /inactive/i.test(pOff.message), `${pOff.status} ${pOff.message}`);
  const pMiss = await setVendor(p1, 1, String(new mongoose.Types.ObjectId()));
  check('P3 an unknown vendor is refused', pMiss.status === 400, `${pMiss.status} ${pMiss.message}`);
  const pRow = await pickerRow(await fresh(p1._id), 0);
  check('P4 the row now shows that explicit vendor, and the PO uses it', pRow?.vendorState === 'SET' && String(pRow.vendorId) === NEWV && (await createPo(NEWV, [line(p1, 0)], { saveMode: 'DRAFT' })).status === 201);

  // ── J — JSL ──────────────────────────────────────────────────────────────
  console.log('\nJ  JSL');
  const j1 = await readyIndent([{ sku: 'JSL' }]);
  const jl = (extra = {}) => ({ ...line(j1, 0), grade: '304', width: '1250', finish: '2B', baseRate: 100, unit: 'Kgs', ...extra });
  const jOther = await createPo(A, [jl()], { poFormatType: 'JSL' });
  check('J1 a JSL PO is still only for Jindal (another active vendor refused)', jOther.status === 400 && /always raised on Jindal/.test(jOther.message), `${jOther.status} ${jOther.message}`);
  const jOk = await createPo(JIN, [jl()], { poFormatType: 'JSL', saveMode: 'DRAFT' });
  check('J2 Jindal takes the JSL PO without any purchase history for the item', jOk.status === 201, `${jOk.status} ${jOk.message}`);

  console.log(`\n${failures ? 'FAILED' : 'OK'} — ${passes} passed, ${failures} failed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
};

const main = async () => {
  const mode = process.argv[2];
  if (mode === '--seed') { await seed(); await mongoose.disconnect(); return; }
  if (mode === '--api') { await api(); return; }
  console.log('usage: node src/scripts/e2eVendorPickFixture.js --seed | --api');
  process.exit(2);
};
main().catch(async (err) => { console.error(err); try { await mongoose.disconnect(); } catch { /* ignore */ } process.exit(1); });
