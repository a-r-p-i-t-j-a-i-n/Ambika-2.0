/**
 * API oracle: a vendor added for an item shows up in the Step 1.3 (Approved Quotation) vendor suggestions.
 *
 * The suggestions of an item = vendors that quoted for it OR have it on their Vendor Master item list
 * (indent/itemVendorHistory.js). The item list is matched by SKU id, else SKU code — so a vendor product typed in
 * as just a NAME (what the old Add Vendor dialog's plain text box produced) never matched and the vendor was
 * missing from the list. A product with no SKU link at all now matches by its exact name (case / spacing
 * ignored); a product linked to a SKU is decided by that SKU only.
 *
 *   node src/scripts/e2eVendorCatalogMatchFixture.js --seed      upsert users + SKUs (never drops)
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5083 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_vendorcatalog node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5083/api/v1 node src/scripts/e2eVendorCatalogMatchFixture.js --api
 *
 * --api is re-runnable: every run creates its own vendors (names carry a run tag) and a fresh indent.
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard (S3 + email off).
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';

export const DB_NAME = 'ambika_e2e_vendorcatalog';
export const E2E_URI = process.env.E2E_VC_URI || `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eVendorCatalogMatchFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5083/api/v1').replace(/\/+$/, '');
const PASSWORD = 'E2e@12345';
const USERS = {
  MD:    { email: 'vcatalog-md@test.local',    name: 'E2E Catalog MD',    role: 'MD', roles: ['MD'],      mobile: '9000000291' },
  BUYER: { email: 'vcatalog-buyer@test.local', name: 'E2E Catalog Buyer', role: 'EA', roles: ['PLANNER'], mobile: '9000000292' },
};
const ITEM = { code: 'VC-PK-PC-01', name: 'VC Paper Cone 1.00"', unit: 'PCS' };
const OTHER = { code: 'VC-PK-OTHER', name: 'VC Other Item', unit: 'PCS' };
const RUN = Date.now().toString(36);

let failures = 0; let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${String(detail).slice(0, 500)}` : ''}`);
};
const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};
const upsertSku = (s) => SKU.findOneAndUpdate({ code: s.code }, { $set: { name: s.name, unit: s.unit, itemType: 'CONSUMABLE', isActive: true, isDeleted: false } }, { upsert: true, new: true }).lean();

const seed = async () => {
  await connect();
  for (const u of Object.values(USERS)) {
    const { role, roles, ...rest } = u;
    if (!await User.findOne({ email: u.email })) await User.create({ ...rest, password: PASSWORD, role, roles, isActive: true });
    await User.updateOne({ email: u.email }, { $set: { role, roles, permissionGrants: [], permissionDenies: [], isActive: true } });
  }
  await upsertSku(ITEM); await upsertSku(OTHER);
  console.log(`[seed] ${DB_NAME}: ${Object.values(USERS).map((u) => u.email).join(', ')} / ${PASSWORD}; SKUs ${ITEM.code}, ${OTHER.code}`);
};

const tokens = {};
const call = async (who, method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method, headers: { 'Content-Type': 'application/json', ...(who && tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, data: json?.data, message: json?.message || '' };
};
const ok = async (who, method, p, body) => {
  const r = await call(who, method, p, body);
  if (r.status >= 400) throw new Error(`${method} ${p} → ${r.status} ${r.message}`);
  return r.data;
};

const api = async () => {
  await connect();
  for (const [k, u] of Object.entries(USERS)) {
    const r = await call(null, 'POST', '/auth/login', { email: u.email, password: PASSWORD });
    tokens[k] = r.data?.token || '';
    if (!tokens[k]) throw new Error(`login ${u.email} failed — run --seed first`);
  }
  const item = await SKU.findOne({ code: ITEM.code }).lean();
  const other = await SKU.findOne({ code: OTHER.code }).lean();
  console.log(`run ${RUN} against ${API}`);

  // Vendors, created through the Vendor Master API the way the form sends them.
  const mk = async (label, products, extra = {}) => ok('BUYER', 'POST', '/vendors', { name: `VC ${label} ${RUN}`, isActive: true, products, ...extra });
  const row = (o) => ({ unit: 'Pcs', rate: 5, gstRate: 18, ...o });
  const V = {
    linked:    await mk('Linked (picked from the SKU list)', [row({ skuId: String(item._id), skuCode: item.code, productName: item.name })]),
    nameOnly:  await mk('Name only (typed)', [row({ productName: ITEM.name })]),
    nameCase:  await mk('Name only, other case and spacing', [row({ productName: '  vc   PAPER cone 1.00"  ' })]),
    codeOnly:  await mk('Code only (typed)', [row({ productName: 'Cone paper', skuCode: 'vc-pk-pc-01' })]),
    otherName: await mk('Another product (typed)', [row({ productName: 'VC Something Else' })]),
    linkedOther: await mk('Same name but linked to ANOTHER SKU', [row({ skuId: String(other._id), skuCode: other.code, productName: ITEM.name })]),
    inactive:  await mk('Inactive, linked', [row({ skuId: String(item._id), skuCode: item.code, productName: item.name })], { isActive: false }),
    similar:   await mk('Similar name (not exact)', [row({ productName: 'VC Paper Cone 1.00" Large' })]),
  };
  const id = (k) => String(V[k]._id);
  const stored = await Vendor.findById(V.nameOnly._id).lean();
  check('F0 the "name only" vendor was saved with no SKU link (the situation being tested)', !stored.products[0].skuId && !stored.products[0].skuCode, JSON.stringify(stored.products[0]));

  // An approved indent whose quotation (Step 1.2) is received, waiting at Step 1.3.
  const ind = await ok('BUYER', 'POST', '/procurement/indents', {
    department: 'Stores', remarks: `vendor catalog match ${RUN}`,
    items: [{ skuId: String(item._id), skuCode: item.code, itemName: item.name, quantity: 100, unit: 'PCS' }],
  });
  await ok('BUYER', 'POST', `/procurement/indents/${ind._id}/submit`, {});
  const approved = await ok('MD', 'POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
  const docs = (it) => [{ fileName: 'q.pdf', fileUrl: `https://example.invalid/e2e/vc-${RUN}-${it._id}.pdf`, fileType: 'application/pdf' }];
  await ok('BUYER', 'POST', `/procurement/indents/${ind._id}/quote-comparative`, {
    statusDone: 'YES', itemQuotations: approved.items.map((it) => ({ itemId: it._id, itemName: it.itemName, statusDone: 'YES', quotationDocuments: docs(it) })),
  });

  console.log('\nS  Step 1.3 vendor suggestions for the item');
  const hist = await ok('MD', 'GET', `/procurement/indents/${ind._id}/item-vendor-history`);
  const names = (hist.items[0].eligibleVendors || []).map((v) => v.vendorName);
  const has = (k) => names.includes(V[k].name);
  check('S1 a vendor whose product was picked from the SKU list is suggested', has('linked'), names.join(' | '));
  check('S2 a vendor whose product was only TYPED IN with the exact item name is suggested', has('nameOnly'), names.join(' | '));
  check('S3 …whatever the case / spacing of the typed name', has('nameCase'), names.join(' | '));
  check('S4 a vendor with the SKU code typed in is suggested (already worked)', has('codeOnly'), names.join(' | '));
  check('S5 a vendor whose typed product is another item is NOT suggested', !has('otherName'));
  check('S6 a product LINKED to another SKU is not suggested for this item, even with the same name', !has('linkedOther'));
  check('S7 an inactive vendor is not suggested', !has('inactive'));
  check('S8 a merely similar name is not suggested', !has('similar'));
  const row2 = (hist.items[0].eligibleVendors || []).find((v) => v.vendorName === V.nameOnly.name);
  check('S9 the typed-name vendor is shown as being on the Vendor Master item list', !!row2 && (row2.basis || []).includes('VENDOR') && row2.inCatalog === true, JSON.stringify(row2));
  const vh = hist.items[0].vendors || [];
  check('S10 the same list serves Step 1.2 (Quote Required = No)', vh.some((v) => v.vendorName === V.nameOnly.name));

  console.log('\nA  Approving the item for such a vendor');
  const approveBody = (vendorKey) => ({
    itemApprovedQuotations: approved.items.map((it) => ({
      itemId: it._id, itemName: it.itemName, statusDone: 'YES', vendorId: id(vendorKey),
      approvedQuotationDocuments: docs(it), actualAt: new Date().toISOString().slice(0, 10), remarks: 'e2e',
    })),
  });
  let r = await call('MD', 'POST', `/procurement/indents/${ind._id}/approve-quotation`, approveBody('inactive'));
  check('A1 an INACTIVE vendor is refused (400)', r.status === 400 && /inactive/i.test(r.message), `${r.status} ${r.message}`);
  r = await call('MD', 'POST', `/procurement/indents/${ind._id}/approve-quotation`, approveBody('otherName'));
  check('A1b "Add New Vendor": any ACTIVE Vendor Master vendor is accepted, even one that neither quoted for nor supplied the item (200)', r.status === 200, `${r.status} ${r.message}`);
  r = await call('MD', 'POST', `/procurement/indents/${ind._id}/approve-quotation`, approveBody('nameOnly'));
  check('A2 the typed-name vendor can be approved for the item (re-approving before any PO is allowed)', r.status === 200, `${r.status} ${r.message}`);
  const after = await PurchaseIndent.findById(ind._id).lean();
  check('A3 the vendor is recorded on the approved quotation', JSON.stringify(after.quotationApprovalStep?.itemApprovedQuotations || []).includes(id('nameOnly')) || JSON.stringify(after.items).includes(id('nameOnly')));

  console.log(`\n${passes} passed, ${failures} failed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
};

if (isEntry(import.meta.url)) {
  const arg = process.argv[2];
  const run = arg === '--seed' ? seed : arg === '--api' ? api : null;
  if (!run) { console.error('usage: node src/scripts/e2eVendorCatalogMatchFixture.js --seed | --api'); process.exit(2); }
  run().then(() => { if (arg === '--seed') mongoose.disconnect(); }).catch((err) => { console.error(err); process.exit(1); });
}
