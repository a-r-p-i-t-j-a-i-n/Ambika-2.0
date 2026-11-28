/**
 * API oracle for Step 1.2 "Quote Required? = No" → vendor chosen from the item's
 * previous vendors only (indent/itemVendorHistory.js).
 *
 *   node src/scripts/e2eNrVendorHistoryFixture.js --seed   upsert user, vendors, SKUs, history POs (never drops)
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5093 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_nrvendor node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5093/api/v1 node src/scripts/e2eNrVendorHistoryFixture.js --api
 *
 * --api creates fresh indents on every run, so it can be re-run without reseeding.
 *   H  GET /procurement/indents/:id/item-vendor-history — who is listed (placed POs,
 *      Vendor Master item list) and who is not (draft / cancelled PO, inactive vendor,
 *      legacy Party id, unrelated vendor); empty for an item with no history.
 *   S  Step 1.2 save — vendor mandatory; refused outside the history (also with
 *      a real Vendor Master vendor); empty-history item refused; stored on the item.
 *   P  Downstream — Pending for PO row, PO guard, mixed indent through Step 1.3.
 *   R  Re-saves — change vendor, back to "Yes" clears it, PO'd item locked,
 *      legacy flat payload and "Yes" rows unchanged.
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

export const DB_NAME = 'ambika_e2e_nrvendor';
export const E2E_URI = process.env.E2E_NRVENDOR_URI || `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eNrVendorHistoryFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5093/api/v1').replace(/\/+$/, '');
const LOGIN = { email: 'nrvendor-e2e@test.local', password: 'E2e@12345' };
const VENDORS = [
  { code: 'NV-ALPHA', name: 'NV Alpha Traders', isActive: true, location: 'Rajkot' },
  { code: 'NV-BETA', name: 'NV Beta Supplies', isActive: true },
  { code: 'NV-GAMMA', name: 'NV Gamma Inactive', isActive: false },
  { code: 'NV-DELTA', name: 'NV Delta Catalog', isActive: true },
  { code: 'NV-OTHER', name: 'NV Other Unrelated', isActive: true },
];
const SKUS = {
  HIST: { code: 'NV-HIST', name: 'NV Hist Bearing' },
  NOHIST: { code: 'NV-NOHIST', name: 'NV Brand New Gadget' },
  CANC: { code: 'NV-CANC', name: 'NV Cancelled Only Belt' },
  CODE: { code: 'NV-CODE', name: 'NV Code Matched Seal' },
};
const PARTY_NAME = 'NV Legacy Party Vendor';
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

const skuDoc = async (key) => SKU.findOne({ code: SKUS[key].code }).lean();

// ── Seed (idempotent — never drops) ────────────────────────────────────────
const seed = async () => {
  await connect();
  if (!await User.findOne({ email: LOGIN.email })) {
    await User.create({ ...LOGIN, name: 'E2E NR Vendor Doer', role: 'MD', roles: ['MD'], mobile: '9000000078', isActive: true });
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

  // Vendor Master item list: Delta supplies HIST; Alpha lists a different product.
  await Vendor.updateOne({ code: 'NV-DELTA' }, { $set: { products: [{ skuId: s.HIST._id, skuCode: s.HIST.code, productName: s.HIST.name, rate: 90 }] } });
  await Vendor.updateOne({ code: 'NV-OTHER' }, { $set: { products: [{ skuCode: 'SOMETHING-ELSE', productName: 'Something else', rate: 1 }] } });

  // History POs (inserted directly — fixed numbers so a re-seed is a no-op).
  const indentId = new mongoose.Types.ObjectId('000000000000000000000abc');
  const po = async (poNumber, vendor, poStatus, lines, poDate) => {
    if (await VendorPurchaseOrder.findOne({ poNumber })) return;
    await VendorPurchaseOrder.create({
      poNumber, poStatus, poDate: new Date(poDate), indentId, indentIds: [indentId], indentNumber: 'NV-HIST-IND',
      vendorId: vendor._id, vendorName: vendor.name,
      items: lines.map((l) => ({ itemName: l.name || 'hist', quantity: 5, rate: l.rate ?? 100, ...l })),
    });
  };
  await po('NV/PO/1', v['NV-ALPHA'], 'APPROVED', [{ skuId: s.HIST._id, skuCode: s.HIST.code, rate: 100 }], '2026-09-01');
  await po('NV/PO/2', v['NV-ALPHA'], 'RELEASED_TO_VENDOR', [{ skuId: s.HIST._id, skuCode: s.HIST.code, rate: 110 }], '2026-10-15');
  await po('NV/PO/3', v['NV-BETA'], 'DRAFT', [{ skuId: s.HIST._id, skuCode: s.HIST.code }], '2026-10-20');
  await po('NV/PO/4', v['NV-GAMMA'], 'APPROVED', [{ skuId: s.HIST._id, skuCode: s.HIST.code }], '2026-10-21');
  await po('NV/PO/5', v['NV-BETA'], 'CANCELLED', [{ skuId: s.CANC._id, skuCode: s.CANC.code }], '2026-10-22');
  await po('NV/PO/6', { _id: party._id, name: party.name }, 'CLOSED', [{ skuId: s.HIST._id, skuCode: s.HIST.code }], '2026-08-01'); // legacy Party id
  await po('NV/PO/7', v['NV-ALPHA'], 'FULLY_RECEIVED', [{ skuCode: s.CODE.code, rate: 20 }], '2026-10-01'); // code only, no skuId
  await po('NV/PO/8', v['NV-OTHER'], 'APPROVED', [{ skuCode: 'SOMETHING-ELSE' }], '2026-10-02');
  console.log(`[seed] ${DB_NAME}: user ${LOGIN.email} / ${LOGIN.password}; vendors, SKUs, 8 history POs, Delta catalog entry`);
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

const newApprovedIndent = async (keys) => {
  const items = [];
  for (const [i, k] of keys.entries()) {
    const s = await skuDoc(k);
    items.push({ skuId: String(s._id), skuCode: s.code, itemName: s.name, quantity: 10 + i, unit: 'Pcs' });
  }
  const ind = await ok('POST', '/procurement/indents', { department: 'Stores', remarks: `nr-vendor e2e ${RUN}`, items });
  await ok('POST', `/procurement/indents/${ind._id}/submit`, {});
  return ok('POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
};
// rows[i] = { status: 'YES' | 'QUOTE_NOT_REQUIRED', vendorId?, vendorTag? } per item. YES rows carry a file tagged with vendorTag.
const quote = (indent, rows, extra = {}) => call('POST', `/procurement/indents/${indent._id}/quote-comparative`, {
  statusDone: rows.every((r) => r.status === 'QUOTE_NOT_REQUIRED') ? 'QUOTE_NOT_REQUIRED' : 'YES',
  itemQuotations: indent.items.map((it, i) => ({
    itemId: it._id, itemName: it.itemName, statusDone: rows[i].status,
    ...(rows[i].vendorId !== undefined ? { vendorId: rows[i].vendorId } : {}),
    quotationDocuments: rows[i].status === 'YES' ? [{ ...doc(`nv-${RUN}-${i}`), ...(rows[i].vendorTag ? { vendorId: rows[i].vendorTag } : {}) }] : [],
  })),
  ...extra,
});
const NR = (vendorId) => ({ status: 'QUOTE_NOT_REQUIRED', vendorId });
const YES = (vendorTag) => ({ status: 'YES', vendorTag });
const approve = (indent, statuses, vendorIds) => call('POST', `/procurement/indents/${indent._id}/approve-quotation`, {
  itemApprovedQuotations: indent.items.map((it, i) => ({
    itemId: it._id, itemName: it.itemName, statusDone: statuses[i],
    approvedQuotationDocuments: statuses[i] === 'YES' ? [{ ...doc(`nv-${RUN}-${i}`) }] : [],
    ...(vendorIds[i] !== undefined ? { vendorId: vendorIds[i] } : {}),
  })),
});
const history = async (indent) => (await ok('GET', `/procurement/indents/${indent._id}/item-vendor-history`)).items;
const fresh = (id) => PurchaseIndent.findById(id).lean();
const itemNow = async (indent, i) => (await fresh(indent._id)).items[i];
const rowOf = async (indent, i) => (await ok('GET', '/procurement/purchase-orders/approved-items')).items
  .find((r) => String(r.indentItemId) === String(indent.items[i]._id));
const poFromItems = (entries, vendorId) => call('POST', '/procurement/purchase-orders/create-from-items', {
  vendorId, expectedDeliveryDate: new Date(Date.now() + 7 * 864e5).toISOString(),
  items: entries.map(([indent, it]) => ({
    indentId: indent._id, indentItemId: it._id, itemName: it.itemName, quantity: it.approvedQuantity || it.quantity, unit: it.unit, rate: 100, gstRate: 18,
  })),
});
const names = (list) => list.map((h) => h.vendorName);

// ── API checks ─────────────────────────────────────────────────────────────
const api = async () => {
  await connect();
  const login = await call('POST', '/auth/login', LOGIN);
  token = login.data?.token || login.data?.accessToken || '';
  if (!token) throw new Error(`login failed: ${login.status} ${login.message} — run --seed first`);
  const v = Object.fromEntries(await Promise.all(VENDORS.map(async (x) => [x.code, await Vendor.findOne({ code: x.code }).lean()])));
  const id = (code) => String(v[code]._id);
  const A = id('NV-ALPHA'); const B = id('NV-BETA'); const G = id('NV-GAMMA'); const D = id('NV-DELTA'); const O = id('NV-OTHER');
  const party = await Party.findOne({ name: PARTY_NAME }).lean();
  console.log(`run ${RUN} against ${API}`);

  // ── H: the history endpoint ──
  console.log('\nH  Item vendor history endpoint');
  const h = await newApprovedIndent(['HIST', 'NOHIST', 'CANC', 'CODE']);
  const hist = await history(h);
  const [hHist, hNo, hCanc, hCode] = hist;
  check('H1 one entry per indent item', hist.length === 4 && hist.every((x) => String(x.itemId) === String(h.items[hist.indexOf(x)]._id)));
  check('H2 HIST lists Alpha (placed POs) and Delta (Vendor Master item list) only', JSON.stringify(names(hHist.vendors)) === JSON.stringify([v['NV-ALPHA'].name, v['NV-DELTA'].name]), JSON.stringify(names(hHist.vendors)));
  check('H3 not listed: draft-PO vendor, inactive vendor, legacy Party, unrelated vendor',
    ![B, G, O, String(party._id)].some((x) => hHist.vendors.some((y) => String(y.vendorId) === x)));
  const alpha = hHist.vendors[0];
  check('H4 Alpha carries code, location, PO count, latest PO and rate', alpha.vendorCode === 'NV-ALPHA' && alpha.location === 'Rajkot' && alpha.poCount === 2 && alpha.lastPoNumber === 'NV/PO/2' && alpha.lastRate === 110 && alpha.basis.join() === 'PO', JSON.stringify(alpha));
  const delta = hHist.vendors[1];
  check('H5 Delta is catalog-only (no PO)', delta.poCount === 0 && delta.basis.join() === 'VENDOR' && delta.vendorCode === 'NV-DELTA', JSON.stringify(delta));
  check('H6 item with no history → empty list (not every vendor)', hNo.vendors.length === 0);
  check('H7 only a cancelled PO → empty list', hCanc.vendors.length === 0);
  check('H8 PO line with only a SKU code still matches', JSON.stringify(names(hCode.vendors)) === JSON.stringify([v['NV-ALPHA'].name]), JSON.stringify(names(hCode.vendors)));
  check('H9 unknown indent → 404', (await call('GET', `/procurement/indents/${new mongoose.Types.ObjectId()}/item-vendor-history`)).status === 404);
  check('H10 bad id → 422/400', [400, 422].includes((await call('GET', '/procurement/indents/not-an-id/item-vendor-history')).status));
  check('H11 login required', (await call('GET', `/procurement/indents/${h._id}/item-vendor-history`, undefined, { auth: false })).status === 401);
  const rej = await newApprovedIndent(['HIST', 'NOHIST']);
  check('H12 history is read from the stored indent (client cannot name a SKU)', (await history(rej)).length === 2);

  // ── S: saving Step 1.2 ──
  console.log('\nS  Step 1.2 save — mandatory + validated against history');
  const s1 = await newApprovedIndent(['HIST']);
  const noVendor = await quote(s1, [NR(undefined)]);
  check('S1 "No" without a vendor refused', noVendor.status === 400 && /Select the vendor for/.test(noVendor.message), `${noVendor.status} ${noVendor.message}`);
  const nullVendor = await quote(s1, [NR(null)]);
  check('S2 "No" with a null vendor refused', nullVendor.status === 400, `${nullVendor.status} ${nullVendor.message}`);
  const other = await quote(s1, [NR(O)]);
  check('S3 real active Vendor Master vendor with NO history for the item refused', other.status === 400 && /has not supplied/.test(other.message) && other.message.includes(v['NV-ALPHA'].name), `${other.status} ${other.message}`);
  check('S4 vendor whose only PO is a draft refused', (await quote(s1, [NR(B)])).status === 400);
  check('S5 inactive vendor (approved PO exists) refused', (await quote(s1, [NR(G)])).status === 400);
  check('S6 legacy Party id refused', (await quote(s1, [NR(String(party._id))])).status === 400);
  check('S7 unknown vendor id refused', (await quote(s1, [NR(String(new mongoose.Types.ObjectId()))])).status === 400);
  check('S8 malformed vendor id refused by validation', [400, 422].includes((await quote(s1, [NR('nope')])).status));
  const s1State = await fresh(s1._id);
  check('S9 refused saves left the indent at Step 1.2 with no vendor', s1State.overallStatus === 'QUOTE_PENDING' && !s1State.items[0].vendorId && !s1State.quoteComparativeStep?.statusDone, `${s1State.overallStatus}`);
  const s2 = await newApprovedIndent(['NOHIST']);
  const noHistory = await quote(s2, [NR(A)]);
  check('S10 item with no history refused: "No previous vendors found"', noHistory.status === 400 && /No previous vendors found for/.test(noHistory.message), `${noHistory.status} ${noHistory.message}`);
  check('S11 …even without a vendor', /No previous vendors found/.test((await quote(s2, [NR(undefined)])).message));
  const ok1 = await quote(s1, [NR(A)]);
  check('S12 vendor from the history accepted', ok1.status === 200, `${ok1.status} ${ok1.message}`);
  const saved = await itemNow(s1, 0);
  check('S13 vendor stored on the item (PO_PREPARATION, master name, who/when)', String(saved.vendorId) === A && saved.vendorSource === 'PO_PREPARATION' && saved.vendorName === v['NV-ALPHA'].name && !!saved.vendorSelectedAt && !!saved.vendorSelectedById, JSON.stringify(saved));
  const s1Now = await fresh(s1._id);
  check('S14 Step 1.3 skipped, indent PO-ready', s1Now.quotationApprovalStep.skipped === true && s1Now.overallStatus === 'QUOTATION_APPROVED');
  check('S15 selection audited on the timeline', s1Now.activityTimeline.some((t) => t.action === 'ITEM_VENDOR' && t.description.includes(v['NV-ALPHA'].name) && /purchase history/.test(t.description)));
  const s3 = await newApprovedIndent(['HIST']);
  const okDelta = await quote(s3, [NR(D)]);
  check('S16 catalog-only vendor (Vendor Master item list) accepted', okDelta.status === 200 && String((await itemNow(s3, 0)).vendorId) === D, `${okDelta.status} ${okDelta.message}`);

  // ── P: downstream ──
  console.log('\nP  Step 1.3 / Pending for PO / PO use the selected vendor');
  const pRow = await rowOf(s1, 0);
  check('P1 Pending for PO row: NOT_REQUIRED / SET / Alpha', pRow?.quotationPath === 'NOT_REQUIRED' && pRow?.vendorState === 'SET' && String(pRow?.vendorId) === A && pRow?.vendorSource === 'PO_PREPARATION', JSON.stringify(pRow));
  // new rule (2026-11-28): the "No" pick is a PRESELECTION — a PO on another ACTIVE vendor is allowed (covered by e2eVendorPickFixture X4);
  // an INACTIVE vendor is still refused.
  const pWrong = await poFromItems([[s1, s1Now.items[0]]], G);
  check('P2 PO with an INACTIVE vendor (Gamma) refused', pWrong.status === 400 && /inactive in the Vendor Master/.test(pWrong.message), `${pWrong.status} ${pWrong.message}`);
  const pPo = await poFromItems([[s1, s1Now.items[0]]], A);
  check('P3 PO with the selected vendor created, vendor inherited', [200, 201].includes(pPo.status) && String(pPo.data?.vendorId) === A, `${pPo.status} ${pPo.message}`);
  const afterPo = await quote(s1, [NR(D)]);
  check('P4 Step 1.2 cannot be redone once the indent moved on', afterPo.status === 400 && String((await itemNow(s1, 0)).vendorId) === A, `${afterPo.status} ${afterPo.message}`);

  const m = await newApprovedIndent(['HIST', 'CODE', 'CANC']);
  const mixed = await quote(m, [NR(D), YES(B), YES(A)]);
  check('P5 mixed indent saves: "No" item with history vendor + two quoted items', mixed.status === 200, `${mixed.status} ${mixed.message}`);
  const mState = await fresh(m._id);
  check('P6 quoted items carry no Step 1.2 vendor pick; the "No" item does', !mState.items[1].vendorId && !mState.items[2].vendorId && String(mState.items[0].vendorId) === D);
  const mOk = await approve(m, ['QUOTE_NOT_REQUIRED', 'YES', 'YES'], [undefined, B, A]);
  check('P7 Step 1.3 approves the quoted items (the "No" item needs nothing)', mOk.status === 200, `${mOk.status} ${mOk.message}`);
  const m0 = await itemNow(m, 0);
  check('P8 the "No" item keeps its vendor through Step 1.3', String(m0.vendorId) === D && m0.vendorSource === 'PO_PREPARATION');
  check('P9 quoted items got their Step 1.3 vendors', String((await itemNow(m, 1)).vendorId) === B && String((await itemNow(m, 2)).vendorId) === A);
  const mRow = await rowOf(m, 0);
  check('P10 mixed indent: "No" item row SET to Delta', mRow?.vendorState === 'SET' && String(mRow?.vendorId) === D);

  // ── R: re-saves ──
  console.log('\nR  Re-saves and legacy payloads');
  const r = await newApprovedIndent(['HIST']);
  await quote(r, [NR(A)]);
  const change = await quote(r, [NR(D)]);
  check('R1 vendor changed on a re-save (before any PO)', change.status === 200 && String((await itemNow(r, 0)).vendorId) === D, `${change.status} ${change.message}`);
  check('R2 change audited with the previous vendor', (await fresh(r._id)).activityTimeline.some((t) => t.action === 'ITEM_VENDOR' && /was NV Alpha Traders/.test(t.description)));
  const same = await quote(r, [NR(D)]);
  const sameCount = (await fresh(r._id)).activityTimeline.filter((t) => t.action === 'ITEM_VENDOR').length;
  check('R3 identical re-save adds no audit entry', same.status === 200 && sameCount === 2, `${same.status} count=${sameCount}`);
  const r2 = await newApprovedIndent(['HIST', 'CODE']);
  await quote(r2, [NR(A), NR(A)]);
  const back = await quote(r2, [YES(B), NR(A)]);
  const r2a = await itemNow(r2, 0);
  check('R4 item switched back to "Yes" drops its pre-selected vendor; the other item keeps it', back.status === 200 && !r2a.vendorId && r2a.vendorSource === '' && String((await itemNow(r2, 1)).vendorId) === A, `${back.status} ${back.message}`);
  const r3 = await newApprovedIndent(['HIST']);
  const forged = await quote(r3, [{ status: 'YES', vendorTag: B, vendorId: O }]);
  check('R5 a vendorId sent on a "Yes" row is ignored', forged.status === 200 && !(await itemNow(r3, 0)).vendorId, `${forged.status} ${forged.message}`);
  const r4 = await newApprovedIndent(['NOHIST']);
  const legacy = await call('POST', `/procurement/indents/${r4._id}/quote-comparative`, { statusDone: 'QUOTE_NOT_REQUIRED' });
  check('R6 flat legacy payload (no item rows) behaves as before — vendor still chosen on Pending for PO', legacy.status === 200 && (await rowOf(r4, 0))?.vendorState === 'UNASSIGNED', `${legacy.status} ${legacy.message}`);
  const r5 = await newApprovedIndent(['HIST']);
  const reject = await call('POST', `/procurement/indents/${r5._id}/quote-comparative`, {
    statusDone: 'QUOTE_NOT_REQUIRED', itemQuotations: [{ itemId: String(new mongoose.Types.ObjectId()), itemName: 'ghost', statusDone: 'QUOTE_NOT_REQUIRED', vendorId: O }],
  });
  check('R7 a row naming an item that is not on the indent is ignored (never trusted)', reject.status === 200 && !(await itemNow(r5, 0)).vendorId, `${reject.status} ${reject.message}`);

  console.log(`\n${failures ? 'FAILED' : 'OK'} — ${passes} passed, ${failures} failed`);
  process.exitCode = failures ? 1 : 0;
};

const main = async () => {
  const mode = process.argv[2];
  try {
    if (mode === '--seed') await seed();
    else if (mode === '--api') await api();
    else console.log('usage: node src/scripts/e2eNrVendorHistoryFixture.js --seed | --api');
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
};
if (isEntry(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
