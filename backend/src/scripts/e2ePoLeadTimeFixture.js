/**
 * API oracle for PO Lead Time ↔ Expected Delivery Date (purchase-order/poLeadTime.js)
 * and the Vendor Master default Lead Time (vendor.leadTimeDays).
 *
 *   node src/scripts/e2ePoLeadTimeFixture.js --seed      upsert users + vendors (never drops)
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5097 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_poleadtime node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5097/api/v1 node src/scripts/e2ePoLeadTimeFixture.js --api
 *   API=... node src/scripts/e2ePoLeadTimeFixture.js --prep-ui   data for the browser probe
 *
 * Users: MD (roles ['MD']) and BUYER (PLANNER). --api makes fresh indents/POs and
 * a fresh vendor every run (re-runnable). Checks:
 *   V  Vendor Master default Lead Time: create/update/clear/keep, validation.
 *   C  Create (create, create-from-items, direct save): the pair is re-derived,
 *      mismatches / dates before the PO Date / > 365 days refused with nothing
 *      saved, month end / year end / leap day, older clients' free text ignored.
 *   U  Draft edit: PO Date, Lead Time or date alone; mismatch refused; other edits
 *      leave the dates alone.
 *   P  Preview / saved / released PDF print the stored pair; approve + release keep it.
 *   R  Revise: the new draft's pair is checked the same way.
 *   L  A PO saved before leadTimeDays existed keeps working.
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard
 * (S3 + email off). Never reads MONGO_URI. Nothing here drops or resets a DB.
 */
import zlib from 'zlib';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import SKU from '../modules/skus/sku.model.js';

export const DB_NAME = 'ambika_e2e_poleadtime';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2ePoLeadTimeFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5097/api/v1').replace(/\/+$/, '');
const ORIGIN = new URL(API).origin;
const PASSWORD = 'E2e@12345';
export const USERS = {
  MD:    { email: 'polead-md@test.local',    name: 'E2E Lead MD',    role: 'MD', roles: ['MD'],      mobile: '9000000081' },
  BUYER: { email: 'polead-buyer@test.local', name: 'E2E Lead Buyer', role: 'EA', roles: ['PLANNER'], mobile: '9000000082' },
};
// One SKU every probe vendor carries, so the PO form's SKU filter lists all three.
const PROBE_SKU = { code: 'E2E-LT-PROBE', name: 'E2E Lead Time Probe Item' };
export const VENDORS = [
  { code: 'LT-TEN', name: 'LT Ten Days Supplies', leadTimeDays: 10 },
  { code: 'LT-THREE', name: 'LT Three Days Traders', leadTimeDays: 3 },
  { code: 'LT-NONE', name: 'LT No Default Metals', leadTimeDays: null },
];
const RUN = Date.now().toString(36);
const PO = '/procurement/purchase-orders';

let failures = 0;
let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${String(detail).slice(0, 400)}` : ''}`);
};

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

const probeSku = () => SKU.findOneAndUpdate(
  { code: PROBE_SKU.code },
  { $setOnInsert: { code: PROBE_SKU.code, name: PROBE_SKU.name, unit: 'PCS', itemType: 'CONSUMABLE' } },
  { upsert: true, new: true },
).lean();

// ── Seed (idempotent upserts — never drops) ────────────────────────────────
const seed = async () => {
  await connect();
  for (const u of Object.values(USERS)) {
    const { role, roles, ...rest } = u;
    if (!await User.findOne({ email: u.email })) {
      await User.create({ ...rest, password: PASSWORD, role, roles, permissionGrants: [], isActive: true });
    }
    await User.updateOne({ email: u.email }, { $set: { role, roles, permissionGrants: [], permissionDenies: [], isActive: true } });
  }
  const sku = await probeSku();
  for (const v of VENDORS) {
    await Vendor.updateOne({ code: v.code }, {
      $set: {
        name: v.name, isActive: true, isDeleted: false, leadTimeDays: v.leadTimeDays, creditPeriodDays: 30,
        products: [{ skuId: sku._id, skuCode: sku.code, productName: sku.name, unit: 'Pcs', rate: 100, gstRate: 18 }],
      },
    }, { upsert: true });
  }
  console.log(`[seed] ${DB_NAME}: users ${Object.values(USERS).map((u) => u.email).join(', ')} / ${PASSWORD}; vendors ${VENDORS.map((v) => `${v.name} (${v.leadTimeDays ?? 'no default'})`).join(', ')}`);
};

// ── HTTP helpers ───────────────────────────────────────────────────────────
const tokens = {};
const call = async (who, method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(who && tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/pdf')) return { status: res.status, pdf: Buffer.from(await res.arrayBuffer()) };
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data: json?.data, message: json?.message || '' };
};
const ok = async (who, method, path, body) => {
  const r = await call(who, method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${r.message}`);
  return r.data;
};
const login = async () => {
  for (const [key, u] of Object.entries(USERS)) {
    const r = await call(null, 'POST', '/auth/login', { email: u.email, password: PASSWORD });
    tokens[key] = r.data?.token || '';
    if (!tokens[key]) throw new Error(`login ${u.email} failed: ${r.status} ${r.message} — run --seed first`);
  }
};

// Drawn text of a PDFKit PDF (Helvetica = cp1252), whitespace-normalized.
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
const pdfText = (buf) => {
  const raw = buf.toString('latin1');
  const lines = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(raw))) {
    let s;
    try { s = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    for (const op of s.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
      const hexes = op[1] != null ? [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]) : [op[2]];
      lines.push(hexes.map((h) => [...Buffer.from(h, 'hex')].map((b) => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b))).join('')).join(''));
    }
  }
  return lines.join(' ').replace(/\s+/g, ' ');
};
const storedPdfText = async (who, id) => {
  const r = await call(who, 'POST', `${PO}/${id}/pdf`);
  if (r.status !== 200) throw new Error(`pdf ${id} → ${r.status} ${r.message}`);
  const res = await fetch(r.data.poPdfUrl.replace(/^https?:\/\/[^/]+/, ORIGIN));
  return pdfText(Buffer.from(await res.arrayBuffer()));
};

// A PO-ready indent (quotation not required). `vendorId` fixes its items' vendor;
// without it the items are open to any vendor (the browser probe picks one).
let seq = 0;
const readyIndent = async (label, vendorId = null) => {
  seq += 1;
  const sku = await probeSku();
  const ind = await ok('MD', 'POST', '/procurement/indents', {
    department: 'Stores', remarks: `po-lead e2e ${RUN} ${label}`,
    items: [{ skuId: String(sku._id), skuCode: sku.code, itemName: sku.name, quantity: 10 + seq, unit: 'Pcs' }],
  });
  await ok('MD', 'POST', `/procurement/indents/${ind._id}/submit`, {});
  const approved = await ok('MD', 'POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
  await ok('MD', 'POST', `/procurement/indents/${ind._id}/quote-comparative`, {
    statusDone: 'QUOTE_NOT_REQUIRED',
    itemQuotations: approved.items.map((it) => ({ itemId: it._id, itemName: it.itemName, statusDone: 'QUOTE_NOT_REQUIRED', quotationDocuments: [] })),
  });
  if (vendorId) {
    for (const it of approved.items) {
      await ok('MD', 'PATCH', `${PO}/approved-items/vendor`, { indentId: ind._id, indentItemId: it._id, vendorId });
    }
  }
  return PurchaseIndent.findById(ind._id).lean();
};
const lines = (indent) => indent.items.map((it) => ({
  indentId: indent._id, indentItemId: it._id, itemName: it.itemName, skuCode: it.skuCode, skuId: it.skuId,
  quantity: it.approvedQuantity || it.quantity, unit: it.unit, rate: 100, gstRate: 18,
}));
const fromItems = (who, indent, vendorId, dates) => call(who, 'POST', `${PO}/create-from-items`, {
  poFormatType: 'OTHER', vendorId, items: lines(indent), ...dates,
});
const poNow = (id) => VendorPurchaseOrder.findById(id).lean();
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const pair = (po) => `${ymd(po?.poDate)} → ${ymd(po?.expectedDeliveryDate)} = ${po?.leadTimeDays} / "${po?.leadTime}"`;
const isPair = (po, poDate, edd, days) => ymd(po?.poDate) === poDate && ymd(po?.expectedDeliveryDate) === edd
  && po?.leadTimeDays === days && po?.leadTime === (days === 1 ? '1 day' : `${days} days`)
  && new Date(po.expectedDeliveryDate).toISOString().endsWith('T00:00:00.000Z');
const poCount = () => VendorPurchaseOrder.countDocuments({});
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// ── API checks ─────────────────────────────────────────────────────────────
const api = async () => {
  await connect();
  await login();
  const [ten, three, none] = await Promise.all(VENDORS.map((v) => Vendor.findOne({ code: v.code }).lean()));
  const T = String(ten._id);
  console.log(`run ${RUN} against ${API}`);

  // ── V: Vendor Master ──
  console.log('\nV  Vendor Master default Lead Time');
  const vName = `LT Api Vendor ${RUN}`;
  const created = await call('MD', 'POST', '/vendors', { name: vName, creditPeriodDays: 15, leadTimeDays: 12 });
  const vid = created.data?._id;
  check('V1 create with a default Lead Time stores it', created.status === 201 && (await Vendor.findById(vid).lean())?.leadTimeDays === 12, `${created.status} ${created.message}`);
  const plain = await call('MD', 'POST', '/vendors', { name: `LT Api Plain ${RUN}` });
  check('V2 create without one stores "not configured" (null)', plain.status === 201 && (await Vendor.findById(plain.data._id).lean()).leadTimeDays == null);
  await ok('MD', 'PUT', `/vendors/${vid}`, { phone: '9876543210' });
  check('V3 an update that leaves it out keeps it', (await Vendor.findById(vid).lean()).leadTimeDays === 12);
  await ok('MD', 'PUT', `/vendors/${vid}`, { leadTimeDays: 0 });
  check('V4 0 days (same-day supplier) is a valid default', (await Vendor.findById(vid).lean()).leadTimeDays === 0);
  await ok('MD', 'PUT', `/vendors/${vid}`, { leadTimeDays: null });
  check('V5 null clears it', (await Vendor.findById(vid).lean()).leadTimeDays == null);
  for (const [bad, label] of [[-1, 'negative'], [1.5, 'fractional'], [366, 'over 365'], ['abc', 'text']]) {
    const r = await call('MD', 'PUT', `/vendors/${vid}`, { leadTimeDays: bad });
    check(`V6 ${label} default refused (422)`, r.status === 422 && /Lead Time/.test(r.message), `${r.status} ${r.message}`);
  }
  const list = await ok('BUYER', 'GET', '/vendors?limit=500&sort=name');
  check('V7 the vendor list the PO form loads carries the default', list.find((v) => v._id === T)?.leadTimeDays === 10
    && list.find((v) => v._id === String(none._id))?.leadTimeDays == null, JSON.stringify(list.find((v) => v._id === T)));
  check('V8 GET /vendors/:id carries it', (await ok('BUYER', 'GET', `/vendors/${three._id}`)).leadTimeDays === 3);

  // ── C: create ──
  console.log('\nC  Create — the server re-derives the pair');
  let ind = await readyIndent('C1', T);
  let r = await fromItems('BUYER', ind, T, { poDate: '2026-10-29', expectedDeliveryDate: '2026-11-05', leadTimeDays: 7 });
  check('C1 PO Date 29/10/2026 + 7 days = 05/11/2026 stored with "7 days"', r.status === 201 && isPair(await poNow(r.data._id), '2026-10-29', '2026-11-05', 7), `${r.status} ${r.message} ${pair(await poNow(r.data?._id))}`);
  const c1 = r.data;

  ind = await readyIndent('C2', T);
  r = await fromItems('BUYER', ind, T, { poDate: '2026-10-29', expectedDeliveryDate: '2026-11-05' });
  check('C2 date only → Lead Time derived (7)', r.status === 201 && isPair(await poNow(r.data._id), '2026-10-29', '2026-11-05', 7), pair(await poNow(r.data?._id)));

  ind = await readyIndent('C3', T);
  const before = await poCount();
  r = await fromItems('BUYER', ind, T, { poDate: '2026-10-29', expectedDeliveryDate: '2026-11-05', leadTimeDays: 6 });
  check('C3 Lead Time that disagrees with the dates refused (400)', r.status === 400 && /does not match/.test(r.message), `${r.status} ${r.message}`);
  r = await fromItems('BUYER', ind, T, { poDate: '2026-10-29', expectedDeliveryDate: '2026-10-28' });
  check('C4 date before the PO Date refused (400)', r.status === 400 && /before the PO Date/.test(r.message), `${r.status} ${r.message}`);
  r = await fromItems('BUYER', ind, T, { poDate: '2026-10-29', expectedDeliveryDate: '2062-10-29' });
  check('C5 more than 365 days out refused (400)', r.status === 400 && /more than 365 days/.test(r.message), `${r.status} ${r.message}`);
  for (const [bad, label] of [[-1, 'negative'], [2.5, 'fractional'], ['7 days', 'text']]) {
    r = await fromItems('BUYER', ind, T, { poDate: '2026-10-29', expectedDeliveryDate: '2026-11-05', leadTimeDays: bad });
    check(`C6 ${label} Lead Time refused (422)`, r.status === 422, `${r.status} ${r.message}`);
  }
  r = await fromItems('BUYER', ind, T, { poDate: '2026-10-29', leadTimeDays: 7 });
  check('C7 Expected Delivery Date is still required on create (422)', r.status === 422 && /expectedDeliveryDate/.test(r.message), `${r.status} ${r.message}`);
  const indAfter = await PurchaseIndent.findById(ind._id).lean();
  check('C8 refusals saved nothing: no PO, indent item still open', await poCount() === before
    && indAfter.items.every((it) => it.procurementStatus !== 'PO_CREATED'), `${await poCount()} vs ${before}`);

  const boundaries = [
    ['2026-01-31', '2026-02-01', 1, 'month end'],
    ['2026-02-28', '2026-03-01', 1, 'non-leap February'],
    ['2028-02-28', '2028-02-29', 1, 'leap day'],
    ['2028-02-29', '2028-03-07', 7, 'from a leap day'],
    ['2026-12-31', '2027-01-01', 1, 'year end'],
    ['2026-12-25', '2027-01-04', 10, 'across the year end'],
    ['2026-10-29', '2026-10-29', 0, 'same day (0 days)'],
  ];
  for (const [poDate, edd, days, label] of boundaries) {
    ind = await readyIndent(`C9 ${label}`, T);
    r = await fromItems('BUYER', ind, T, { poDate, leadTimeDays: days, expectedDeliveryDate: edd });
    check(`C9 ${label}: ${poDate} + ${days} = ${edd}`, r.status === 201 && isPair(await poNow(r.data._id), poDate, edd, days), `${r.status} ${r.message} ${pair(await poNow(r.data?._id))}`);
  }

  // Older API clients (the follow-up probes) send free text and a full-ISO date.
  ind = await readyIndent('C10', T);
  const iso3 = new Date(Date.now() + 3 * 864e5).toISOString();
  r = await fromItems('BUYER', ind, T, { leadTime: '7 days', expectedDeliveryDate: iso3 });
  const c10 = await poNow(r.data?._id);
  check('C10 older client: free-text "7 days" ignored, date 3 days out → "3 days"', r.status === 201 && c10.leadTimeDays === 3 && c10.leadTime === '3 days'
    && ymd(c10.expectedDeliveryDate) === iso3.slice(0, 10), `${r.status} ${r.message} ${pair(c10)}`);

  ind = await readyIndent('C11', T);
  r = await call('BUYER', 'POST', PO, {
    indentId: ind._id, vendorId: T, poFormatType: 'OTHER', items: lines(ind),
    poDate: '2026-11-30', leadTimeDays: 5, expectedDeliveryDate: '2026-12-05',
  });
  check('C11 single-indent create (POST /purchase-orders) derives the same way', r.status === 201 && isPair(await poNow(r.data._id), '2026-11-30', '2026-12-05', 5), `${r.status} ${r.message}`);
  ind = await readyIndent('C12', T);
  r = await call('BUYER', 'POST', PO, {
    indentId: ind._id, vendorId: T, items: lines(ind), poDate: '2026-11-30', leadTimeDays: 4, expectedDeliveryDate: '2026-12-05',
  });
  check('C12 single-indent create refuses a mismatch (400)', r.status === 400 && /does not match/.test(r.message), `${r.status} ${r.message}`);

  ind = await readyIndent('C13', T);
  r = await fromItems('MD', ind, T, { saveMode: 'DIRECT', poDate: '2026-10-29', leadTimeDays: 10, expectedDeliveryDate: '2026-11-08' });
  const direct = await poNow(r.data?._id);
  check('C13 MD "Save PO Directly": approved, pair stored, terms default kept', r.status === 201 && direct.approvalStatus === 'APPROVED'
    && isPair(direct, '2026-10-29', '2026-11-08', 10) && !!direct.termsAndConditions, `${r.status} ${r.message} ${pair(direct)}`);
  ind = await readyIndent('C14', T);
  r = await fromItems('BUYER', ind, T, { saveMode: 'DIRECT', poDate: '2026-10-29', leadTimeDays: 10, expectedDeliveryDate: '2026-11-08' });
  check('C14 non-MD direct save still refused (403)', r.status === 403, `${r.status} ${r.message}`);

  // ── U: draft edit ──
  console.log('\nU  Draft edit (PATCH /:id)');
  const id = c1._id;
  r = await call('BUYER', 'PATCH', `${PO}/${id}`, { poDate: '2026-10-31' });
  check('U1 PO Date alone: delivery date kept, Lead Time follows (5)', r.status === 200 && isPair(await poNow(id), '2026-10-31', '2026-11-05', 5), `${r.status} ${r.message} ${pair(await poNow(id))}`);
  r = await call('BUYER', 'PATCH', `${PO}/${id}`, { leadTimeDays: 10 });
  check('U2 Lead Time alone: delivery date moves (10/11/2026)', r.status === 200 && isPair(await poNow(id), '2026-10-31', '2026-11-10', 10), `${r.status} ${r.message} ${pair(await poNow(id))}`);
  r = await call('BUYER', 'PATCH', `${PO}/${id}`, { expectedDeliveryDate: '2026-11-15' });
  check('U3 date alone: Lead Time follows (15)', r.status === 200 && isPair(await poNow(id), '2026-10-31', '2026-11-15', 15), pair(await poNow(id)));
  r = await call('BUYER', 'PATCH', `${PO}/${id}`, { poDate: '2026-11-01', expectedDeliveryDate: '2026-11-15', leadTimeDays: 13 });
  check('U4 mismatch refused (400), PO unchanged', r.status === 400 && isPair(await poNow(id), '2026-10-31', '2026-11-15', 15), `${r.status} ${r.message} ${pair(await poNow(id))}`);
  r = await call('BUYER', 'PATCH', `${PO}/${id}`, { expectedDeliveryDate: '2026-10-30' });
  check('U5 date before the PO Date refused (400)', r.status === 400 && /before the PO Date/.test(r.message), `${r.status} ${r.message}`);
  r = await call('BUYER', 'PATCH', `${PO}/${id}`, { remarks: `edit ${RUN}` });
  check('U6 other edits leave the dates alone', r.status === 200 && isPair(await poNow(id), '2026-10-31', '2026-11-15', 15) && (await poNow(id)).remarks === `edit ${RUN}`);
  r = await call('BUYER', 'PATCH', `${PO}/${id}`, { poDate: '2026-11-01', expectedDeliveryDate: '2026-11-08', leadTimeDays: 7, leadTime: 'ignored text' });
  check('U7 full form payload saved consistently ("7 days")', r.status === 200 && isPair(await poNow(id), '2026-11-01', '2026-11-08', 7), `${r.status} ${r.message} ${pair(await poNow(id))}`);

  // ── P: PDFs, approve, release ──
  console.log('\nP  PDFs, approve, release');
  const pv = await call('BUYER', 'POST', `${PO}/preview-pdf`, {
    poFormatType: 'OTHER', vendorId: T, items: lines(ind), poDate: '2026-10-29', expectedDeliveryDate: '2026-11-05', leadTimeDays: 7,
  });
  const pvText = pv.pdf ? pdfText(pv.pdf) : '';
  check('P1 preview prints "Lead Time: 7 days" and the delivery date', pv.status === 200 && pvText.includes('Lead Time: 7 days') && pvText.includes('Expected Delivery: 05 Nov 2026'),
    `${pv.status} ${pvText.match(/Expected Delivery[^:]*: [^L]*|Lead Time: [^ ]+ [^ ]+/g)}`);
  const pv2 = await call('BUYER', 'POST', `${PO}/preview-pdf`, {
    poFormatType: 'OTHER', vendorId: T, items: lines(ind), poDate: '2026-10-29', expectedDeliveryDate: '2026-11-05', leadTimeDays: 6,
  });
  check('P2 preview stays lenient for an unfinished pair (200)', pv2.status === 200 && !!pv2.pdf, `${pv2.status} ${pv2.message}`);
  const saved = await storedPdfText('BUYER', id);
  check('P3 saved draft PDF prints "Lead Time: 7 days" / 08 Nov 2026', saved.includes('Lead Time: 7 days') && saved.includes('Expected Delivery: 08 Nov 2026'));
  await ok('MD', 'POST', `${PO}/${id}/approve`, { decision: 'APPROVED' });
  r = await call('BUYER', 'PATCH', `${PO}/${id}`, { leadTimeDays: 9 });
  check('P4 approved PO: dates can no longer be edited (400)', r.status === 400 && isPair(await poNow(id), '2026-11-01', '2026-11-08', 7), `${r.status} ${r.message}`);
  await ok('MD', 'POST', `${PO}/${id}/release`, { sendEmail: false });
  const rel = await poNow(id);
  check('P5 release keeps the stored pair', rel.releaseStatus === 'RELEASED' && isPair(rel, '2026-11-01', '2026-11-08', 7), pair(rel));
  const relText = pdfText(Buffer.from(await (await fetch(rel.poPdfUrl.replace(/^https?:\/\/[^/]+/, ORIGIN))).arrayBuffer()));
  check('P6 released PDF prints the same pair', relText.includes('Lead Time: 7 days') && relText.includes('Expected Delivery: 08 Nov 2026'));

  // ── R: revise ──
  console.log('\nR  Revise a cancelled PO');
  ind = await readyIndent('R', T);
  r = await fromItems('BUYER', ind, T, { poDate: '2026-09-01', leadTimeDays: 14, expectedDeliveryDate: '2026-09-15' });
  const toCancel = r.data;
  await ok('BUYER', 'POST', `${PO}/${toCancel._id}/cancel`, { remarks: 'revise me' });
  const today = localToday();
  const revBody = (extra) => ({ vendorId: T, poFormatType: 'OTHER', items: lines(ind), ...extra });
  const nBefore = await poCount();
  r = await call('BUYER', 'POST', `${PO}/${toCancel._id}/revise`, revBody({ poDate: today, leadTimeDays: 14, expectedDeliveryDate: '2026-09-15' }));
  check('R1 revise with the old (now past) date and today\'s PO Date refused (400), nothing created', r.status === 400 && await poCount() === nBefore, `${r.status} ${r.message}`);
  r = await call('BUYER', 'POST', `${PO}/${toCancel._id}/revise`, revBody({ poDate: today, leadTimeDays: 14, expectedDeliveryDate: plusDays(today, 14) }));
  const rev = await poNow(r.data?._id);
  check('R2 revise with the kept 14 days from today: new draft stores today + 14', r.status === 201 && isPair(rev, today, plusDays(today, 14), 14) && rev.revisedFromPoId && String(rev.revisedFromPoId) === String(toCancel._id),
    `${r.status} ${r.message} ${pair(rev)}`);

  // ── L: legacy ──
  console.log('\nL  POs saved before leadTimeDays existed');
  ind = await readyIndent('L', T);
  r = await fromItems('BUYER', ind, T, { poDate: '2026-10-01', expectedDeliveryDate: '2026-10-15' });
  const legId = r.data._id;
  await VendorPurchaseOrder.updateOne({ _id: legId }, { $unset: { leadTimeDays: 1 }, $set: { leadTime: 'two weeks' } });
  const legRead = await ok('BUYER', 'GET', `${PO}/${legId}`);
  check('L1 legacy PO reads fine (no leadTimeDays, its text kept)', legRead.leadTimeDays == null && legRead.leadTime === 'two weeks');
  await ok('BUYER', 'PATCH', `${PO}/${legId}`, { remarks: 'legacy remark edit' });
  check('L2 a non-date edit leaves the legacy text alone', (await poNow(legId)).leadTime === 'two weeks');
  await ok('BUYER', 'PATCH', `${PO}/${legId}`, { poDate: '2026-10-01', expectedDeliveryDate: '2026-10-15', leadTimeDays: 14 });
  check('L3 re-saving it from the form stores the days ("14 days")', isPair(await poNow(legId), '2026-10-01', '2026-10-15', 14), pair(await poNow(legId)));

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
};

// ── UI prep: open approved items, a draft and a cancelled PO for the probe ──
// Writes frontend/e2e/shots/po-lead-time-manifest.json (git-ignored).
const prepUi = async () => {
  await connect();
  await login();
  const [ten] = await Promise.all(VENDORS.map((v) => Vendor.findOne({ code: v.code }).lean()));
  const T = String(ten._id);
  // Reset the probe vendors' defaults (a probe run may have edited them).
  for (const v of VENDORS) await Vendor.updateOne({ code: v.code }, { $set: { leadTimeDays: v.leadTimeDays } });
  const createA = await readyIndent('UI create A');
  const createB = await readyIndent('UI create B');
  const draftInd = await readyIndent('UI draft', T);
  const draft = (await fromItems('BUYER', draftInd, T, { poDate: '2026-10-20', leadTimeDays: 14, expectedDeliveryDate: '2026-11-03' })).data;
  const revInd = await readyIndent('UI revise', T);
  const cancelled = (await fromItems('BUYER', revInd, T, { poDate: '2026-09-01', leadTimeDays: 12, expectedDeliveryDate: '2026-09-13' })).data;
  await ok('BUYER', 'POST', `${PO}/${cancelled._id}/cancel`, { remarks: 'probe revise' });
  const ref = (ind) => ind.indentNumber.replace(/\/(?=[^/]*$)/, '.1/');
  const manifest = {
    password: PASSWORD, users: { MD: USERS.MD.email, BUYER: USERS.BUYER.email },
    vendors: Object.fromEntries(VENDORS.map((v) => [v.code, { name: v.name, leadTimeDays: v.leadTimeDays }])),
    createItemRefs: [ref(createA), ref(createB)],
    pos: { draft: draft._id, cancelled: cancelled._id },
    run: RUN,
  };
  const { writeFile } = await import('node:fs/promises');
  const out = new URL('../../../frontend/e2e/shots/po-lead-time-manifest.json', import.meta.url);
  await writeFile(out, JSON.stringify(manifest, null, 2));
  console.log(`[prep-ui] ${JSON.stringify({ refs: manifest.createItemRefs, pos: manifest.pos })} → ${out.pathname}`);
};

if (isEntry(import.meta.url)) {
  const mode = process.argv[2];
  const run = mode === '--seed' ? seed : mode === '--api' ? api : mode === '--prep-ui' ? prepUi : null;
  if (!run) { console.error('usage: --seed | --api | --prep-ui'); process.exit(2); }
  run()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
