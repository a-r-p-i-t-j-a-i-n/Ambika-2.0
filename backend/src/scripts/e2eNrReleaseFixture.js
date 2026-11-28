/**
 * API oracle: items that need NO quotation go straight to PO creation; only quoted items go to Approved Quotation 1.03.
 *
 * Step 1.2 ("Receive Quote & Make Comparative") answers each item "Quote Required? = Yes / No". A "No" item has its vendor
 * picked there, has no quotation to approve, and must not wait behind Step 1.3:
 *   mixed indent (some No, some Yes)  the No items are released to PO NOW (QUOTATION_APPROVED + Pending for PO) and the
 *                                     indent stays on the Step 1.3 queue ONLY for its quoted items (a partial step)
 *   every item "No"                   Step 1.3 is skipped (unchanged)
 *   every item "Yes"                  everything waits for Step 1.3 (unchanged)
 *
 *   node src/scripts/e2eNrReleaseFixture.js --seed      upsert users, SKUs, vendors (never drops)
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5082 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_nrrelease node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5082/api/v1 node src/scripts/e2eNrReleaseFixture.js --api
 *   API=... node src/scripts/e2eNrReleaseFixture.js --prep-ui     a fresh 4 + 1 indent for the browser probe
 *
 * --api is re-runnable (fresh indents every run). SAFETY: pinned to a localhost scratch database behind the shared e2e
 * guard (S3 + email off). Nothing here drops or resets a database.
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';

export const DB_NAME = 'ambika_e2e_nrrelease';
export const E2E_URI = process.env.E2E_NRR_URI || `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eNrReleaseFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5082/api/v1').replace(/\/+$/, '');
const PASSWORD = 'E2e@12345';
const USERS = {
  MD:    { email: 'nrrelease-md@test.local',    name: 'E2E Release MD',    role: 'MD', roles: ['MD'],      mobile: '9000000391' },
  BUYER: { email: 'nrrelease-buyer@test.local', name: 'E2E Release Buyer', role: 'EA', roles: ['PLANNER'], mobile: '9000000392' },
};
const SKUS = ['NRR-1', 'NRR-2', 'NRR-3', 'NRR-4', 'NRR-5', 'NRR-6'].map((code, i) => ({ code, name: `NRR Item ${i + 1}`, unit: 'PCS' }));
const VENDOR = { code: 'NRR-V1', name: 'NRR Supplier One' };
const RUN = Date.now().toString(36);
const PO = '/procurement/purchase-orders';

let failures = 0; let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${String(detail).slice(0, 500)}` : ''}`);
};
const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

const seed = async () => {
  await connect();
  for (const u of Object.values(USERS)) {
    const { role, roles, ...rest } = u;
    if (!await User.findOne({ email: u.email })) await User.create({ ...rest, password: PASSWORD, role, roles, isActive: true });
    await User.updateOne({ email: u.email }, { $set: { role, roles, permissionGrants: [], permissionDenies: [], isActive: true } });
  }
  const skus = [];
  for (const s of SKUS) {
    skus.push(await SKU.findOneAndUpdate({ code: s.code }, { $set: { name: s.name, unit: s.unit, itemType: 'CONSUMABLE', isActive: true, isDeleted: false } }, { upsert: true, new: true }).lean());
  }
  // One vendor that carries every SKU (its Vendor Master item list = purchase history for the "Quote Required = No" pick),
  // back-dated so it is an EXISTING vendor (no new-vendor approval in the way of the POs here).
  await Vendor.updateOne({ code: VENDOR.code }, { $set: {
    name: VENDOR.name, isActive: true, isDeleted: false, creditPeriodDays: 30,
    products: skus.map((s) => ({ skuId: s._id, skuCode: s.code, productName: s.name, unit: 'Pcs', rate: 5, gstRate: 18 })),
  } }, { upsert: true });
  await Vendor.collection.updateOne({ code: VENDOR.code }, { $set: { createdAt: new Date('2020-01-01T00:00:00Z') } });
  console.log(`[seed] ${DB_NAME}: ${Object.values(USERS).map((u) => u.email).join(', ')} / ${PASSWORD}; ${SKUS.length} SKUs on ${VENDOR.name}`);
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
const login = async () => {
  for (const [k, u] of Object.entries(USERS)) {
    const r = await call(null, 'POST', '/auth/login', { email: u.email, password: PASSWORD });
    tokens[k] = r.data?.token || '';
    if (!tokens[k]) throw new Error(`login ${u.email} failed — run --seed first`);
  }
};
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const DATES = { poDate: localToday(), expectedDeliveryDate: plusDays(localToday(), 7) };
const doc = (it) => ({ fileName: 'q.pdf', fileUrl: `https://example.invalid/e2e/nrr-${RUN}-${it._id}.pdf`, fileType: 'application/pdf' });

/** An approved indent over SKUs (by index into SKUS). */
const approvedIndent = async (label, skuIdx) => {
  const skus = await Promise.all(skuIdx.map((i) => SKU.findOne({ code: SKUS[i].code }).lean()));
  const ind = await ok('BUYER', 'POST', '/procurement/indents', {
    department: 'Stores', remarks: `nr release e2e ${RUN} ${label}`,
    items: skus.map((s, k) => ({ skuId: String(s._id), skuCode: s.code, itemName: s.name, quantity: 10 + k, unit: 'PCS' })),
  });
  await ok('BUYER', 'POST', `/procurement/indents/${ind._id}/submit`, {});
  return ok('MD', 'POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
};
/** Step 1.2 save: `noQuote` = item indexes answered "Quote Required = No" (vendor picked), the rest are quoted. */
const step12 = (who, ind, noQuote, vendorId) => call(who, 'POST', `/procurement/indents/${ind._id}/quote-comparative`, {
  statusDone: noQuote.length === ind.items.length ? 'QUOTE_NOT_REQUIRED' : 'YES',
  itemQuotations: ind.items.map((it, i) => (noQuote.includes(i)
    ? { itemId: it._id, itemName: it.itemName, statusDone: 'QUOTE_NOT_REQUIRED', vendorId: String(vendorId), quotationDocuments: [] }
    : { itemId: it._id, itemName: it.itemName, statusDone: 'YES', quotationDocuments: [doc(it)] })),
});
const step13 = (who, ind, decisions, vendorId) => call(who, 'POST', `/procurement/indents/${ind._id}/approve-quotation`, {
  itemApprovedQuotations: decisions.map(([i, statusDone]) => ({
    itemId: ind.items[i]._id, itemName: ind.items[i].itemName, statusDone,
    approvedQuotationDocuments: statusDone === 'YES' ? [doc(ind.items[i])] : [],
    vendorId: statusDone === 'YES' && vendorId ? String(vendorId) : null, actualAt: localToday(), remarks: 'e2e',
  })),
});
const indNow = (id) => PurchaseIndent.findById(id).lean();
const queue13 = async (ind, state = 'PENDING') => {
  const r = await ok('MD', 'GET', `/procurement/indents?fmsStep=QUOTATION_APPROVAL&stepState=${state}&search=${encodeURIComponent(ind.indentNumber)}&limit=50`);
  return (Array.isArray(r) ? r : r.items || r.docs || r.rows || []).some((x) => String(x._id) === String(ind._id));
};
const pendingForPo = async (ind) => {
  const r = await ok('MD', 'GET', `${PO}/approved-items`);
  return (r.items || []).filter((x) => String(x.indentId) === String(ind._id));
};
const createPo = (ind, idxs, vendorId) => call('BUYER', 'POST', `${PO}/create-from-items`, {
  poFormatType: 'OTHER', vendorId: String(vendorId), ...DATES,
  items: idxs.map((i) => ({
    indentId: ind._id, indentItemId: ind.items[i]._id, itemName: ind.items[i].itemName, skuCode: ind.items[i].skuCode, skuId: ind.items[i].skuId,
    quantity: ind.items[i].approvedQuantity || ind.items[i].quantity, unit: 'PCS', rate: 5, gstRate: 18,
  })),
});

const api = async () => {
  await connect();
  await login();
  const v = await Vendor.findOne({ code: VENDOR.code }).lean();
  if (!v) throw new Error('Run --seed first');
  const V = String(v._id);
  console.log(`run ${RUN} against ${API}`);

  // ── M: mixed — 4 items need no quotation, 1 is quoted ──
  console.log('\nM  Mixed indent: 4 "Quote Required = No" + 1 quoted');
  let ind = await approvedIndent('M', [0, 1, 2, 3, 4]);
  let r = await step12('BUYER', ind, [0, 1, 2, 3], V);
  check('M1 Step 1.2 saves (200)', r.status === 200, `${r.status} ${r.message}`);
  let d = await indNow(ind._id);
  check('M2 the indent is PO-ready for its no-quote items: QUOTATION_APPROVED (not QUOTE_RECEIVED)', d.overallStatus === 'QUOTATION_APPROVED', d.overallStatus);
  check('M3 …and Step 1.3 is OPEN for the quoted item only: partial, not done, not skipped', d.quotationApprovalStep?.partial === true && !d.quotationApprovalStep?.statusDone && !d.quotationApprovalStep?.skipped, JSON.stringify(d.quotationApprovalStep));
  check('M4 it is on the Approved Quotation 1.03 queue (pending)', await queue13(ind));
  let pend = await pendingForPo(ind);
  const pendSkus = pend.map((x) => x.skuCode).sort();
  check('M5 Pending for PO lists exactly the 4 no-quote items — not the quoted one', JSON.stringify(pendSkus) === JSON.stringify(['NRR-1', 'NRR-2', 'NRR-3', 'NRR-4']), pendSkus.join(','));
  r = await createPo(ind, [4], V);
  check('M6 a PO for the QUOTED item is refused until its quotation is approved (400)', r.status === 400, `${r.status} ${r.message}`);
  r = await createPo(ind, [0, 1, 2, 3], V);
  check('M7 a PO for the 4 no-quote items is created straight away (201)', r.status === 201, `${r.status} ${r.message}`);
  d = await indNow(ind._id);
  check('M8 the indent rolls up to PARTIAL_PO_CREATED and Step 1.3 stays open', d.overallStatus === 'PARTIAL_PO_CREATED' && d.quotationApprovalStep?.partial === true, `${d.overallStatus} ${JSON.stringify(d.quotationApprovalStep)}`);
  check('M9 …still on the Approved Quotation queue for the quoted item', await queue13(ind));
  // Step 1.2 corrections after the no-quote items went to PO
  r = await step12('BUYER', ind, [0, 1, 2, 3], V);
  d = await indNow(ind._id);
  check('M10 Step 1.2 can still be corrected (the quoted item\'s files) and keeps the status', r.status === 200 && d.overallStatus === 'PARTIAL_PO_CREATED' && d.quotationApprovalStep?.partial === true, `${r.status} ${r.message} ${d.overallStatus}`);
  r = await step12('BUYER', ind, [1, 2, 3, 4], V);
  check('M11 an item already on a PO cannot switch between "quote required" and "not required" (400)', r.status === 400 && /already on/.test(r.message), `${r.status} ${r.message}`);
  // Step 1.3 for the quoted item only
  r = await step13('MD', ind, [[4, 'YES']], V);
  check('M12 Step 1.3 approves the quoted item (only its row is sent) → 200', r.status === 200, `${r.status} ${r.message}`);
  d = await indNow(ind._id);
  check('M13 Step 1.3 is complete: statusDone YES, no longer partial', d.quotationApprovalStep?.statusDone === 'YES' && d.quotationApprovalStep?.partial === false, JSON.stringify(d.quotationApprovalStep));
  check('M14 the indent stays PARTIAL_PO_CREATED (the quoted item has no PO yet) and leaves the Step 1.3 queue', d.overallStatus === 'PARTIAL_PO_CREATED' && !await queue13(ind) && await queue13(ind, 'DONE'));
  pend = await pendingForPo(ind);
  check('M15 the quoted item is now in Pending for PO too', pend.map((x) => x.skuCode).join() === 'NRR-5', pend.map((x) => x.skuCode).join());
  r = await createPo(ind, [4], V);
  d = await indNow(ind._id);
  check('M16 its PO → 201 and the indent is PO_READY', r.status === 201 && d.overallStatus === 'PO_READY', `${r.status} ${r.message} ${d.overallStatus}`);

  // ── H: the quoted item is put on hold ──
  console.log('\nH  Quoted item kept on hold at Step 1.3');
  ind = await approvedIndent('H', [0, 1, 2, 3, 4]);
  await step12('BUYER', ind, [0, 1, 2, 3], V);
  r = await step13('MD', ind, [[4, 'ON_HOLD']], null);
  d = await indNow(ind._id);
  check('H1 holding the only quoted item keeps the no-quote items PO-ready (QUOTATION_APPROVED, not QUOTE_RECEIVED)', r.status === 200 && d.overallStatus === 'QUOTATION_APPROVED' && d.quotationApprovalStep?.partial === true, `${r.status} ${r.message} ${d.overallStatus}`);
  pend = await pendingForPo(ind);
  check('H2 …and Pending for PO still lists the 4 no-quote items only', pend.length === 4 && !pend.some((x) => x.skuCode === 'NRR-5'), pend.map((x) => x.skuCode).join());

  // ── A: every item needs no quotation ──
  console.log('\nA  Every item answered "Quote Required = No"');
  ind = await approvedIndent('A', [0, 1]);
  r = await step12('BUYER', ind, [0, 1], V);
  d = await indNow(ind._id);
  check('A1 Step 1.3 is skipped and the indent goes straight to PO (QUOTATION_APPROVED, skipped)', r.status === 200 && d.overallStatus === 'QUOTATION_APPROVED' && d.quotationApprovalStep?.skipped === true && !d.quotationApprovalStep?.partial, `${r.status} ${d.overallStatus} ${JSON.stringify(d.quotationApprovalStep)}`);
  check('A2 it is not on the Approved Quotation queue', !await queue13(ind));
  check('A3 both items are in Pending for PO', (await pendingForPo(ind)).length === 2);

  // ── Q: every item is quoted ──
  console.log('\nQ  Every item quoted');
  ind = await approvedIndent('Q', [0, 1]);
  r = await step12('BUYER', ind, [], V);
  d = await indNow(ind._id);
  check('Q1 everything waits for Step 1.3: QUOTE_RECEIVED, not partial', r.status === 200 && d.overallStatus === 'QUOTE_RECEIVED' && !d.quotationApprovalStep?.partial, `${r.status} ${d.overallStatus}`);
  check('Q2 it is on the Approved Quotation queue and nothing is in Pending for PO', await queue13(ind) && (await pendingForPo(ind)).length === 0);

  // ── E: re-editing Step 1.2 before anything is decided ──
  console.log('\nE  Re-editing Step 1.2 (nothing approved, no PO yet)');
  ind = await approvedIndent('E', [0, 1, 2]);
  await step12('BUYER', ind, [0, 1], V);
  d = await indNow(ind._id);
  check('E0 starts mixed: PO-ready for 2 items, Step 1.3 open', d.overallStatus === 'QUOTATION_APPROVED' && d.quotationApprovalStep?.partial === true);
  r = await step12('BUYER', ind, [0, 1, 2], V);
  d = await indNow(ind._id);
  check('E1 the quoted item becomes "not required" too → Step 1.3 skipped', r.status === 200 && d.quotationApprovalStep?.skipped === true && !d.quotationApprovalStep?.partial && d.overallStatus === 'QUOTATION_APPROVED', `${r.status} ${r.message} ${d.overallStatus} ${JSON.stringify(d.quotationApprovalStep)}`);
  r = await step12('BUYER', ind, [0, 1], V);
  d = await indNow(ind._id);
  check('E2 …and back to a quoted item → mixed again (Step 1.3 reopened, partial)', r.status === 200 && d.quotationApprovalStep?.skipped === false && d.quotationApprovalStep?.partial === true && d.overallStatus === 'QUOTATION_APPROVED' && await queue13(ind), `${r.status} ${r.message} ${d.overallStatus} ${JSON.stringify(d.quotationApprovalStep)}`);
  r = await step12('BUYER', ind, [], V);
  d = await indNow(ind._id);
  check('E3 every item quoted again → QUOTE_RECEIVED, no longer partial', r.status === 200 && d.overallStatus === 'QUOTE_RECEIVED' && !d.quotationApprovalStep?.partial, `${r.status} ${r.message} ${d.overallStatus} ${JSON.stringify(d.quotationApprovalStep)}`);
  check('E4 …and nothing is PO-eligible any more', (await pendingForPo(ind)).length === 0);

  console.log(`\n${passes} passed, ${failures} failed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
};

// A fresh 4 + 1 indent, left at Step 1.2 done, for the browser probe.
const prepUi = async () => {
  await connect();
  await login();
  const v = await Vendor.findOne({ code: VENDOR.code }).lean();
  const ind = await approvedIndent('UI', [0, 1, 2, 3, 4]);
  const r = await step12('BUYER', ind, [0, 1, 2, 3], String(v._id));
  if (r.status !== 200) throw new Error(`step 1.2 failed: ${r.status} ${r.message}`);
  const out = { indentId: String(ind._id), indentNumber: ind.indentNumber, vendorId: String(v._id), vendorName: v.name, users: { MD: USERS.MD.email, BUYER: USERS.BUYER.email }, password: PASSWORD };
  const file = new URL('../../../frontend/e2e/shots/nr-release-manifest.json', import.meta.url);
  fs.mkdirSync(path.dirname(file.pathname.replace(/^\/([A-Za-z]:)/, '$1')), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`[prep-ui] ${JSON.stringify(out)}`);
  await mongoose.disconnect();
};

if (isEntry(import.meta.url)) {
  const arg = process.argv[2];
  const run = arg === '--seed' ? seed : arg === '--api' ? api : arg === '--prep-ui' ? prepUi : null;
  if (!run) { console.error('usage: node src/scripts/e2eNrReleaseFixture.js --seed | --api | --prep-ui'); process.exit(2); }
  run().then(() => { if (arg === '--seed') mongoose.disconnect(); }).catch((err) => { console.error(err); process.exit(1); });
}
