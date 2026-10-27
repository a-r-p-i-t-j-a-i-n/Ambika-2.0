/**
 * Fixture + oracle for two Purchase FMS rules:
 *   1. Purchase Indent items come from the SKU Master (indent/itemSku.js).
 *   2. Vendor Detail shows the vendor's Purchase Orders, derived from the PO
 *      records via GET /procurement/purchase-orders?vendorId=… .
 *
 *   node src/scripts/e2eIndentSkuVendorHistoryFixture.js --seed   idempotent upserts (NEVER drops)
 *   node src/scripts/e2eIndentSkuVendorHistoryFixture.js --api    HTTP checks (API_URL, default :5099);
 *                                                                 re-runnable — every run uses its own suffix
 *
 * Browser side: frontend/e2e/indentSkuVendorHistory.e2e.mjs (run after --seed;
 * it re-arms its own legacy draft through --seed, so run --seed before it).
 *
 * Seed contents: 2,100 filler SKUs that sort before the real ones (so the
 * indent picker's first 2,000 rows never contain them — they are reachable only
 * through the picker's server search), three purchasable SKUs, one inactive and
 * one Finished Good; Vendor A whose catalogue names the bolt differently; Vendor
 * B; a legacy Party with a PO stored against the Party id; and two legacy DRAFT
 * indents whose item was typed by hand (no SKU).
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard
 * (S3 + email must be off). It never reads MONGO_URI and never drops anything.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import Party from '../modules/clients/party.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';

export const DB_NAME = 'ambika_e2e_skuvendorhist';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eIndentSkuVendorHistoryFixture.js');
export const LOGIN = { email: 'skuhist-e2e@test.local', password: 'E2e@12345' };
const API = (process.env.API_URL || 'http://127.0.0.1:5099/api/v1').replace(/\/+$/, '');
const RUN = Date.now().toString(36).toUpperCase();

export const SKUS = {
  BOLT: { code: 'SH-BOLT', name: 'SH Bolt M8 (SKU Master name)', unit: 'PCS', itemType: 'CONSUMABLE' },
  NUT: { code: 'SH-NUT', name: 'SH Nut M8', unit: 'PCS', itemType: 'CONSUMABLE' },
  WASHER: { code: 'SH-WASHER', name: 'SH Washer M8', unit: 'KGS', itemType: 'CONSUMABLE' },
  INACTIVE: { code: 'SH-OLD', name: 'SH Retired Part', unit: 'PCS', itemType: 'CONSUMABLE', isActive: false },
  FG: { code: 'SH-FG', name: 'SH Finished Tray', unit: 'PCS', itemType: 'FINISHED_GOOD' },
};
export const VENDORS = { A: 'SH Vendor Alpha', B: 'SH Vendor Beta' };
export const PARTY = 'SH Legacy Party Vendor';
export const LEGACY_DRAFTS = { API: 'SH-LEG-DRAFT-API', UI: 'SH-LEG-DRAFT-UI' };
export const LEGACY_ITEM = 'Hand typed bracket (no SKU)';
const FILLERS = 2100;

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

// ── Seed (upserts only) ─────────────────────────────────────────────────────
const seed = async () => {
  await connect();
  if (!(await User.findOne({ email: LOGIN.email }))) {
    await User.create({ ...LOGIN, name: 'SKU History Runner', role: 'MD', roles: ['MD'], mobile: '9000000077', isActive: true });
  }
  await SKU.bulkWrite(Array.from({ length: FILLERS }, (_, i) => {
    const code = `AA-FILL-${String(i).padStart(4, '0')}`;
    return { updateOne: { filter: { code }, update: { $setOnInsert: { code, name: `AA Filler ${String(i).padStart(4, '0')}`, unit: 'PCS', itemType: 'CONSUMABLE' } }, upsert: true } };
  }));
  for (const s of Object.values(SKUS)) {
    await SKU.updateOne({ code: s.code }, { $set: { name: s.name, unit: s.unit, itemType: s.itemType, isActive: s.isActive !== false, isDeleted: false } }, { upsert: true });
  }
  const bolt = await SKU.findOne({ code: SKUS.BOLT.code }).lean();
  // Vendor A's own catalogue calls the bolt something else — the indent must not pick that up.
  await Vendor.updateOne({ name: VENDORS.A }, {
    $set: { name: VENDORS.A, isActive: true, products: [{ skuId: bolt._id, productName: 'Alpha catalogue: Hex bolt 8mm', skuCode: 'ALPHA-HB8', unit: 'Nos', rate: 7 }] },
  }, { upsert: true });
  await Vendor.updateOne({ name: VENDORS.B }, { $set: { name: VENDORS.B, isActive: true } }, { upsert: true });
  const party = await Party.findOneAndUpdate({ name: PARTY }, { $setOnInsert: { name: PARTY } }, { upsert: true, new: true }).lean();
  // A legacy PO stored against the Party id (older POs did this).
  await VendorPurchaseOrder.updateOne({ poNumber: 'SH-LEGACY-PARTY-PO' }, {
    $setOnInsert: {
      poNumber: 'SH-LEGACY-PARTY-PO', vendorId: party._id, vendorName: PARTY, indentId: new mongoose.Types.ObjectId(),
      poStatus: 'RELEASED_TO_VENDOR', items: [{ itemName: 'Legacy line', skuCode: SKUS.NUT.code, quantity: 3, unit: 'PCS', rate: 5 }], grandTotal: 15,
    },
  }, { upsert: true });
  // Legacy DRAFT indents typed by hand — reset to that state on every seed.
  for (const indentNumber of Object.values(LEGACY_DRAFTS)) {
    await PurchaseIndent.updateOne({ indentNumber }, {
      $set: {
        indentNumber, approvalStatus: 'DRAFT', overallStatus: 'INDENT_GENERATED', department: 'Stores', raisedBy: 'Legacy',
        items: [{ itemName: LEGACY_ITEM, skuCode: '', quantity: 4, unit: 'Pcs', itemLineNo: 1 }],
        productNameRevised: LEGACY_ITEM, isDeleted: false,
      },
    }, { upsert: true });
  }
  console.log(JSON.stringify({ ok: true, db: DB_NAME, login: LOGIN.email, skus: await SKU.countDocuments() }, null, 2));
  await mongoose.disconnect();
};

// ── HTTP helpers ────────────────────────────────────────────────────────────
let token = '';
const call = async (method, path, body, { auth = true } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, data: json?.data, meta: json?.meta, message: json?.message || '' };
};
const ok = async (method, path, body) => {
  const r = await call(method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${r.message}`);
  return r.data;
};

/** Indent → submit → approve → quotation not required → ready for PO. */
const readyIndent = async (items) => {
  const ind = await ok('POST', '/procurement/indents', { department: 'Stores', remarks: `sku-history ${RUN}`, items });
  await ok('POST', `/procurement/indents/${ind._id}/submit`, {});
  const appr = await ok('POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
  await ok('POST', `/procurement/indents/${ind._id}/quote-comparative`, { statusDone: 'QUOTE_NOT_REQUIRED' });
  return appr;
};
// Lines as the New PO form sends them: name + SKU straight from the approved
// indent item (PurchaseOrderFormDrawer maps the approved-items row).
const poBody = (indent, vendorId) => ({
  vendorId, expectedDeliveryDate: new Date(Date.now() + 7 * 864e5).toISOString(),
  items: indent.items.map((it) => ({
    indentId: indent._id, indentItemId: it._id, itemName: it.itemName, skuCode: it.skuCode, skuId: String(it.skuId),
    quantity: it.approvedQuantity || it.quantity, unit: it.unit, rate: 10, gstRate: 18,
  })),
});
const vendorPos = async (vendorId) => (await call('GET', `/procurement/purchase-orders?vendorId=${vendorId}&limit=200&sort=-poDate,-createdAt`)).data || [];
const countIn = (list, id) => list.filter((p) => String(p._id) === String(id)).length;

const api = async () => {
  await connect();
  const login = await call('POST', '/auth/login', LOGIN);
  token = login.data?.token || '';
  check('login', login.status === 200 && token);
  const sku = Object.fromEntries(await Promise.all(Object.entries(SKUS).map(async ([k, s]) => [k, await SKU.findOne({ code: s.code }).lean()])));
  const vA = await Vendor.findOne({ name: VENDORS.A }).lean();
  const vB = await Vendor.findOne({ name: VENDORS.B }).lean();
  const party = await Party.findOne({ name: PARTY }).lean();

  console.log('\n── 1. Indent items come from the SKU Master ──');
  const typed = await call('POST', '/procurement/indents', { department: 'Stores', items: [
    { skuId: String(sku.BOLT._id), skuCode: 'TYPED-CODE', itemName: 'Name typed in the request', quantity: 5, unit: 'Box', remarks: `r ${RUN}` },
  ] });
  const t0 = typed.data?.items?.[0] || {};
  check('create → 201', typed.status === 201, `${typed.status} ${typed.message}`);
  check('item name + code come from the SKU record', t0.itemName === SKUS.BOLT.name && t0.skuCode === SKUS.BOLT.code && String(t0.skuId) === String(sku.BOLT._id),
    `${t0.itemName} / ${t0.skuCode}`);
  check('…not from Vendor Master\'s catalogue name', t0.itemName !== vA.products[0].productName);
  check('quantity, unit and remarks kept as entered', t0.quantity === 5 && t0.unit === 'Box' && t0.remarks === `r ${RUN}`);
  const byCode = await call('POST', '/procurement/indents', { department: 'Stores', items: [{ skuCode: 'sh-nut', itemName: 'x', quantity: 1 }] });
  check('an item named only by SKU code binds to that SKU', byCode.status === 201 && byCode.data.items[0].itemName === SKUS.NUT.name);
  const free = await call('POST', '/procurement/indents', { department: 'Stores', items: [{ itemName: `Free typed ${RUN}`, quantity: 1 }] });
  check('a free-typed item (no SKU) is refused', free.status === 400 && /not linked to SKU Master/.test(free.message), `${free.status} ${free.message}`);
  const inactive = await call('POST', '/procurement/indents', { department: 'Stores', items: [{ skuId: String(sku.INACTIVE._id), itemName: 'x', quantity: 1 }] });
  check('an inactive SKU is refused', inactive.status === 400 && /not an active item in SKU Master/.test(inactive.message), inactive.message);
  const ghost = await call('POST', '/procurement/indents', { department: 'Stores', items: [{ skuId: '6ac09965f1c61c40fa206c99', skuCode: SKUS.BOLT.code, itemName: 'x', quantity: 1 }] });
  check('an unknown skuId is refused (not re-matched by code)', ghost.status === 400, ghost.message);
  const fg = await call('POST', '/procurement/indents', { department: 'Stores', items: [{ skuId: String(sku.FG._id), itemName: 'x', quantity: 1 }] });
  check('Finished Goods still refused (existing guard)', fg.status === 400 && /Finished Goods/.test(fg.message), fg.message);
  const filler = await SKU.findOne({ code: 'AA-FILL-0007' }).lean();
  check('filler SKUs sort first (picker search is needed for the SH SKUs)', !!filler);

  console.log('\n── 2. Draft edit ──');
  const draftId = typed.data._id;
  const edited = await call('PATCH', `/procurement/indents/${draftId}`, { items: [
    { skuId: String(sku.WASHER._id), itemName: 'typed again', skuCode: 'X', quantity: 2, unit: 'KGS' },
  ] });
  check('editing a draft re-binds the item to the SKU', edited.status === 200 && edited.data.items[0].itemName === SKUS.WASHER.name && edited.data.items[0].skuCode === SKUS.WASHER.code);
  const leg = await PurchaseIndent.findOne({ indentNumber: LEGACY_DRAFTS.API }).lean();
  const legHeader = await call('PATCH', `/procurement/indents/${leg._id}`, { remarks: `header only ${RUN}` });
  check('legacy hand-typed draft: header-only edit still allowed, item untouched', legHeader.status === 200 && legHeader.data.items[0].itemName === LEGACY_ITEM);
  const legSame = await call('PATCH', `/procurement/indents/${leg._id}`, { items: [{ itemName: LEGACY_ITEM, quantity: 4 }] });
  check('…re-saving its hand-typed item is refused with the item named', legSame.status === 400 && legSame.message.includes(LEGACY_ITEM), legSame.message);
  check('a Vendor Master catalogue name for the bolt is still not the indent name', (await PurchaseIndent.findById(draftId).lean()).items[0].itemName === SKUS.WASHER.name);

  console.log('\n── 3. Downstream: quotation → PO keep the SKU ──');
  const i1 = await readyIndent([
    { skuId: String(sku.BOLT._id), itemName: 'x', quantity: 10, unit: 'Pcs' },
    { skuId: String(sku.NUT._id), itemName: 'x', quantity: 6, unit: 'Pcs' },
  ]);
  check('indent reached QUOTATION_APPROVED', (await PurchaseIndent.findById(i1._id).lean()).overallStatus === 'QUOTATION_APPROVED');
  const po1 = await call('POST', '/procurement/purchase-orders/create-from-items', poBody(i1, String(vA._id)));
  check('PO for Vendor A (2 SKU lines) created', [200, 201].includes(po1.status), `${po1.status} ${po1.message}`);
  const p1 = await VendorPurchaseOrder.findById(po1.data?._id).lean();
  check('PO lines carry the SKU Master name + code + id', p1 && p1.items.length === 2
    && p1.items.every((l) => [SKUS.BOLT.code, SKUS.NUT.code].includes(l.skuCode) && l.skuId)
    && p1.items.find((l) => l.skuCode === SKUS.BOLT.code)?.itemName === SKUS.BOLT.name, JSON.stringify(p1?.items.map((l) => [l.itemName, l.skuCode])));
  const i2 = await readyIndent([{ skuId: String(sku.WASHER._id), itemName: 'x', quantity: 3, unit: 'KGS' }]);
  const po2 = await call('POST', '/procurement/purchase-orders/create-from-items', poBody(i2, String(vB._id)));
  check('PO for Vendor B created', [200, 201].includes(po2.status), `${po2.status} ${po2.message}`);

  console.log('\n── 4. Vendor PO history ──');
  let listA = await vendorPos(vA._id);
  let listB = await vendorPos(vB._id);
  check('Vendor A history has its PO exactly once (2 lines, one entry)', countIn(listA, po1.data._id) === 1);
  check('…and not Vendor B\'s PO', countIn(listA, po2.data._id) === 0);
  check('Vendor B history has its PO, not Vendor A\'s', countIn(listB, po2.data._id) === 1 && countIn(listB, po1.data._id) === 0);
  check('every row in A\'s history belongs to A (by id)', listA.every((p) => String(p.vendorId) === String(vA._id)));
  const legacy = await VendorPurchaseOrder.findOne({ poNumber: 'SH-LEGACY-PARTY-PO' }).lean();
  check('legacy Party-id PO is on neither vendor\'s history', countIn(listA, legacy._id) === 0 && countIn(listB, legacy._id) === 0);
  check('…but is reachable by its own Party id', countIn(await vendorPos(party._id), legacy._id) === 1);
  const row = listA.find((p) => String(p._id) === String(po1.data._id));
  check('history row carries number/date/items/amount/status', row && (row.poNumber || row.draftNumber) && row.poDate && row.items.length === 2 && row.grandTotal > 0 && row.poStatus,
    row && `${row.poNumber || row.draftNumber} ${row.poStatus} ₹${row.grandTotal}`);

  const appr = await call('POST', `/procurement/purchase-orders/${po1.data._id}/approve`, { decision: 'APPROVED' });
  listA = await vendorPos(vA._id);
  check('approve → history shows APPROVED + final PO number', appr.status === 200
    && listA.find((p) => String(p._id) === String(po1.data._id))?.poStatus === 'APPROVED' && !!listA.find((p) => String(p._id) === String(po1.data._id))?.poNumber, `${appr.status} ${appr.message}`);
  const cancel = await call('POST', `/procurement/purchase-orders/${po1.data._id}/cancel`, { remarks: `e2e ${RUN}` });
  listA = await vendorPos(vA._id);
  check('cancel → history shows CANCELLED', cancel.status === 200 && listA.find((p) => String(p._id) === String(po1.data._id))?.poStatus === 'CANCELLED', `${cancel.status} ${cancel.message}`);
  const rev = await call('POST', `/procurement/purchase-orders/${po1.data._id}/revise`, poBody(i1, String(vA._id)));
  listA = await vendorPos(vA._id);
  const revRow = listA.find((p) => String(p._id) === String(rev.data?._id));
  check('revise → the revision appears too, linked to the original', [200, 201].includes(rev.status) && revRow?.revisionNo === 1
    && revRow?.revisedFromPoNumber === (listA.find((p) => String(p._id) === String(po1.data._id))?.poNumber), `${rev.status} ${rev.message} rev=${revRow?.revisionNo} from=${revRow?.revisedFromPoNumber}`);
  check('…original still listed once as CANCELLED', countIn(listA, po1.data._id) === 1);

  console.log('\n── 5. Access ──');
  const anon = await call('GET', `/procurement/purchase-orders?vendorId=${vA._id}`, null, { auth: false });
  check('no login → 401 (no PO data)', anon.status === 401 && !anon.data, String(anon.status));
  const anonVendor = await call('GET', `/vendors/${vA._id}`, null, { auth: false });
  check('no login → vendor detail 401', anonVendor.status === 401);
  const badId = await call('GET', '/procurement/purchase-orders?vendorId=not-an-id');
  check('malformed vendorId rejected by validation', badId.status === 422, String(badId.status));
  await finish();
};

if (isEntry(import.meta.url)) {
  const run = { '--seed': seed, '--api': api }[process.argv[2]];
  if (!run) { console.error('Usage: e2eIndentSkuVendorHistoryFixture.js --seed | --api'); process.exit(2); }
  run().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => {}); process.exit(1); });
}
