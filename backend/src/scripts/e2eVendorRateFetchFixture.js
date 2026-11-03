/**
 * Oracle + data for "PO rate auto-fetch from the Vendor Master" (New PO form +
 * GET /procurement/rate-changes/vendor-rate).
 *
 *   node src/scripts/e2eVendorRateFetchFixture.js --seed      upsert users, SKUs, vendors (never drops)
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5096 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_ratechange node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5096/api/v1 node src/scripts/e2eVendorRateFetchFixture.js --api
 *   API=... node src/scripts/e2eVendorRateFetchFixture.js --prep-ui   approved items for the browser spec
 *
 * It lives on the Rate Change scratch DB (ambika_e2e_ratechange) next to the RC-*
 * data: every SKU / vendor here is prefixed VF-, so it can never move an RC-* rate.
 * Users are the Rate Change fixture's (run its --seed first): buyer = the doer.
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard
 * (S3 + email off). Never reads MONGO_URI. Nothing here drops or resets a DB.
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import Vendor from '../modules/vendors/vendor.model.js';
import SKU from '../modules/skus/sku.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import RateChangeRequest from '../modules/procurement/rate-change/rateChange.model.js';
import RateChangeHistory from '../modules/procurement/rate-change/rateChangeHistory.model.js';
import PricingHistory from '../modules/vendors/pricingHistory.model.js';
import { DB_NAME, E2E_URI, USERS } from './e2eRateChangeFixture.js';

if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eVendorRateFetchFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5096/api/v1').replace(/\/+$/, '');
const PASSWORD = 'E2e@12345';
const PO = '/procurement/purchase-orders';
const RC = '/procurement/rate-changes';
const RUN = Date.now().toString(36);

export const SKUS = {
  A:    { code: 'VF-SKU-A',    name: 'VF Hex Nut M8',        unit: 'PCS' },
  BOX:  { code: 'VF-SKU-BOX',  name: 'VF Nitrile Gloves',    unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: 25 },
  WRONG:{ code: 'VF-SKU-WRONG', name: 'VF Packing Tape',     unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: 12 },
  KG:   { code: 'VF-SKU-KG',   name: 'VF Steel Rod 12mm',    unit: 'KGS' },
  NONE: { code: 'VF-SKU-NONE', name: 'VF Unpriced Item',     unit: 'PCS' },
  ZERO: { code: 'VF-SKU-ZERO', name: 'VF Zero Rate Item',    unit: 'PCS' },
  LOOSE:{ code: 'VF-SKU-LOOSE', name: 'VF Bolt M10',         unit: 'PCS' },
};
export const VENDORS = {
  V1: { code: 'VF-V1', name: 'VF Alpha Supplies' },
  V2: { code: 'VF-V2', name: 'VF Beta Traders' },
  V3: { code: 'VF-V3', name: 'VF Gamma Stores' },
};

let failures = 0;
let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${String(detail).slice(0, 500)}` : ''}`);
};

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

const upsertSku = (s) => SKU.findOneAndUpdate(
  { code: s.code },
  { $set: { name: s.name, unit: s.unit, itemType: 'CONSUMABLE', isActive: true, isDeleted: false,
    ...(s.purchaseUnit ? { purchaseUnit: s.purchaseUnit, purchaseConversionFactor: s.purchaseConversionFactor } : {}) } },
  { upsert: true, new: true },
).lean();

/**
 * Catalog layout (every case the PO form has to get right):
 *   V1  A      Pcs 50
 *       BOX    Pcs 10 FIRST, then BOX 250   → a BOX line must fetch 250, never the per-piece 10
 *       WRONG  Pcs 5 only                    → a BOX line has NO rate in its unit
 *       KG     'Kg' 70                       → Kg ≡ KGS
 *       ZERO   Pcs 0                         → a row with no rate is "not configured"
 *       LOOSE  name "VF Bolt M10 Long" (no SKU code) → must NOT be fetched for "VF Bolt M10"
 *   V2  A      Pcs 60 · BOX BOX 260
 *   V3  A      Pcs 0   (carries the SKU, no rate) · NONE has no row anywhere
 */
export const seed = async () => {
  await connect();
  const sku = {};
  for (const [k, s] of Object.entries(SKUS)) sku[k] = await upsertSku(s);
  const row = (s, unit, rate, gstRate = 18) => ({ skuId: s._id, skuCode: s.code, productName: s.name, unit, rate, gstRate });
  await Vendor.updateOne({ code: VENDORS.V1.code }, { $set: {
    name: VENDORS.V1.name, isActive: true, isDeleted: false, creditPeriodDays: 30,
    products: [
      row(sku.A, 'Pcs', 50),
      row(sku.BOX, 'Pcs', 10), row(sku.BOX, 'BOX', 250, 12),
      row(sku.WRONG, 'Pcs', 5),
      row(sku.KG, 'Kg', 70),
      row(sku.ZERO, 'Pcs', 0),
      { productName: 'VF Bolt M10 Long', unit: 'Pcs', rate: 33, gstRate: 18 },
    ],
  } }, { upsert: true });
  await Vendor.updateOne({ code: VENDORS.V2.code }, { $set: {
    name: VENDORS.V2.name, isActive: true, isDeleted: false, creditPeriodDays: 15,
    products: [row(sku.A, 'Pcs', 60), row(sku.BOX, 'BOX', 260, 12), row(sku.KG, 'Kgs', 75)],
  } }, { upsert: true });
  await Vendor.updateOne({ code: VENDORS.V3.code }, { $set: {
    name: VENDORS.V3.name, isActive: true, isDeleted: false, creditPeriodDays: 45,
    products: [row(sku.A, 'Pcs', 0)],
  } }, { upsert: true });
  console.log(`[seed] ${DB_NAME}: ${Object.values(VENDORS).map((v) => v.name).join(', ')} · ${Object.values(SKUS).map((s) => s.code).join(', ')}`);
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
    if (!tokens[key]) throw new Error(`login ${u.email} failed: ${r.status} ${r.message} — run e2eRateChangeFixture.js --seed first`);
  }
};

/** A PO-ready indent (quotation not required) with NO vendor fixed: the doer picks the vendor on the PO form. */
let seq = 0;
export const readyIndent = async (label, skuKeys, { itemName = {}, vendorId = null } = {}) => {
  const skus = await Promise.all(skuKeys.map((k) => SKU.findOne({ code: SKUS[k].code }).lean()));
  const ind = await ok('BUYER', 'POST', '/procurement/indents', {
    department: 'Stores', remarks: `vendor-rate-fetch ${RUN} ${label}`,
    items: skus.map((s, i) => { seq += 1; return { skuId: String(s._id), skuCode: s.code, itemName: itemName[skuKeys[i]] || s.name, quantity: 4 + (seq % 3), unit: s.purchaseUnit || s.unit }; }),
  });
  await ok('BUYER', 'POST', `/procurement/indents/${ind._id}/submit`, {});
  const approved = await ok('MD', 'POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
  await ok('BUYER', 'POST', `/procurement/indents/${ind._id}/quote-comparative`, {
    statusDone: 'QUOTE_NOT_REQUIRED',
    itemQuotations: approved.items.map((it) => ({ itemId: it._id, itemName: it.itemName, statusDone: 'QUOTE_NOT_REQUIRED', quotationDocuments: [] })),
  });
  if (vendorId) {
    for (const it of approved.items) {
      await ok('BUYER', 'PATCH', `${PO}/approved-items/vendor`, { indentId: ind._id, indentItemId: it._id, vendorId: String(vendorId) });
    }
  }
  return PurchaseIndent.findById(ind._id).lean();
};

const vendorRate = (who, vendorKey, vendorIds, q) => {
  const p = new URLSearchParams({ vendorId: String(vendorIds[vendorKey]), ...q });
  return call(who, 'GET', `${RC}/vendor-rate?${p}`);
};

// ── API checks: the authoritative fetch the form uses ───────────────────────
const apiChecks = async () => {
  await connect();
  await login();
  const vendors = {};
  const ids = {};
  for (const [k, v] of Object.entries(VENDORS)) { vendors[k] = await Vendor.findOne({ code: v.code }).lean(); ids[k] = vendors[k]._id; }
  const sku = {};
  for (const [k, s] of Object.entries(SKUS)) sku[k] = await SKU.findOne({ code: s.code }).lean();
  const vr = (v, q) => vendorRate('BUYER', v, ids, q);

  console.log('\n[A] exact vendor + SKU + unit');
  let r = await vr('V1', { skuCode: SKUS.A.code, unit: 'PCS' });
  check('A1 V1 SKU-A in PCS → 50 from the Pcs row', r.data?.found && r.data.rate === 50, JSON.stringify(r.data));
  r = await vr('V2', { skuCode: SKUS.A.code, unit: 'PCS' });
  check('A2 V2 SKU-A → 60 (another vendor, another rate)', r.data?.found && r.data.rate === 60, JSON.stringify(r.data));
  r = await vr('V1', { skuCode: SKUS.BOX.code.toLowerCase(), unit: 'BOX' });
  check('A3 V1 BOX line → 250, not the per-piece 10 (SKU code case-insensitive)', r.data?.found && r.data.rate === 250 && r.data.gstRate === 12, JSON.stringify(r.data));
  r = await vr('V1', { skuCode: SKUS.BOX.code, unit: 'PCS' });
  check('A4 V1 PCS line of the same SKU → 10', r.data?.found && r.data.rate === 10, JSON.stringify(r.data));
  r = await vr('V1', { skuId: String(sku.BOX._id), unit: 'BOX' });
  check('A5 match by skuId when no code is sent', r.data?.found && r.data.rate === 250, JSON.stringify(r.data));
  r = await vr('V1', { skuCode: SKUS.KG.code, unit: 'KGS' });
  check('A6 Kg on the vendor row ≡ KGS on the line → 70', r.data?.found && r.data.rate === 70, JSON.stringify(r.data));
  r = await vr('V2', { skuCode: SKUS.KG.code, unit: 'Kg' });
  check('A7 Kgs row ≡ Kg line → 75', r.data?.found && r.data.rate === 75, JSON.stringify(r.data));

  console.log('\n[B] nothing is fetched when nothing matches');
  r = await vr('V1', { skuCode: SKUS.WRONG.code, unit: 'BOX' });
  check('B1 only a Pcs row exists, line is BOX → not found, UNIT_MISMATCH', r.data?.found === false && r.data.problem === 'UNIT_MISMATCH' && r.data.rate == null, JSON.stringify(r.data));
  check('B2 …and it names the unit the vendor prices it in', (r.data?.candidates || []).some((c) => /pcs/i.test(c.unit)), JSON.stringify(r.data));
  r = await vr('V2', { skuCode: SKUS.NONE.code, unit: 'PCS' });
  check('B3 vendor has no row for the SKU → not found, NONE (no other vendor\'s rate)', r.data?.found === false && r.data.problem === 'NONE' && r.data.rate == null, JSON.stringify(r.data));
  r = await vr('V1', { skuCode: SKUS.LOOSE.code, itemName: SKUS.LOOSE.name, unit: 'PCS' });
  check('B4 "VF Bolt M10" does NOT pick up the vendor\'s "VF Bolt M10 Long" (no loose-name fallback)', r.data?.found === false && r.data.rate == null, JSON.stringify(r.data));
  r = await vr('V1', { itemName: 'VF Bolt M10 Long', unit: 'PCS' });
  check('B5 the exact name still matches a row that has no SKU code → 33', r.data?.found && r.data.rate === 33, JSON.stringify(r.data));
  r = await vr('V1', { skuCode: SKUS.ZERO.code, unit: 'PCS' });
  check('B6 a catalog row at rate 0 is "not configured": found=false, problem NO_RATE', r.data?.found === false && r.data.problem === 'NO_RATE' && r.data.rate == null, JSON.stringify(r.data));
  r = await vr('V3', { skuCode: SKUS.A.code, unit: 'PCS' });
  check('B7 V3 carries SKU-A at 0 → not configured (not V1\'s 50, not V2\'s 60)', r.data?.found === false && r.data.problem === 'NO_RATE', JSON.stringify(r.data));
  r = await call('BUYER', 'GET', `${RC}/vendor-rate?vendorId=${new mongoose.Types.ObjectId()}&skuCode=${SKUS.A.code}`);
  check('B8 unknown vendor → 404', r.status === 404, r.status);

  await workflowChecks({ vendors, ids, sku });

  console.log(`\n${passes} passed, ${failures} failed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
};

const DATES = (() => {
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const d = new Date();
  return { poDate: iso(d), expectedDeliveryDate: iso(new Date(d.getTime() + 7 * 864e5)) };
})();
const poLines = (indent, over = () => ({})) => indent.items.map((it, i) => ({
  indentId: indent._id, indentItemId: it._id, itemName: it.itemName, skuCode: it.skuCode, skuId: it.skuId,
  quantity: it.approvedQuantity || it.quantity, unit: it.unit, rate: 100, gstRate: 18, ...over(it, i),
}));
const createPo = (who, indent, vendorId, over, extra = {}) => call(who, 'POST', `${PO}/create-from-items`, {
  poFormatType: 'OTHER', vendorId: String(vendorId), items: poLines(indent, over), ...DATES, ...extra,
});
const approvePo = (who, id) => call(who, 'POST', `${PO}/${id}/approve`, { decision: 'APPROVED', remarks: 'e2e' });
const poNow = (id) => VendorPurchaseOrder.findById(id).lean();
const rowOf = async (vendorId, skuCode, unit) => (await Vendor.findById(vendorId).lean()).products.filter((q) => q.skuCode === skuCode && (!unit || q.unit === unit));
const round2 = (n) => Math.round(n * 100) / 100;

// ── The whole PO → Purchase Approval → Vendor Master workflow, several lines at once ──
const workflowChecks = async ({ ids }) => {
  const V1 = ids.V1; const V2 = ids.V2;
  console.log('\n[W] Multi-item PO: changed, rejected, unchanged, first-time and unpriced lines in ONE PO');
  const ind = await readyIndent('W-multi', ['A', 'BOX', 'KG', 'NONE', 'ZERO'], { vendorId: V1 });
  const rate = { [SKUS.A.code]: 55, [SKUS.BOX.code]: 270, [SKUS.KG.code]: 70, [SKUS.NONE.code]: 30, [SKUS.ZERO.code]: 20 };
  let r = await createPo('BUYER', ind, V1, (it) => ({
    rate: rate[it.skuCode], gstRate: 18,
    ...(it.skuCode === SKUS.A.code ? { rateChangeReason: 'W: surcharge on nuts' } : {}),
    ...(it.skuCode === SKUS.BOX.code ? { rateChangeReason: 'W: gloves price rise' } : {}),
    ...([SKUS.NONE.code, SKUS.ZERO.code].includes(it.skuCode) ? { rateSource: 'MANUAL' } : {}),
  }));
  check('W1 the PO saves as a DRAFT with five lines', r.status === 201 && r.data.approvalStatus === 'DRAFT' && r.data.items.length === 5, `${r.status} ${r.message}`);
  const po = r.data;
  const reqs = await RateChangeRequest.find({ poId: po._id }).sort({ requestedAt: 1 }).lean();
  const byCode = Object.fromEntries(reqs.map((q) => [q.skuCode, q]));
  check('W2 exactly two PENDING requests (nuts 50→55, gloves 250→270); the unchanged, first-time and unpriced lines raise none',
    reqs.length === 2 && byCode[SKUS.A.code]?.existingVendorRate === 50 && byCode[SKUS.A.code]?.requestedRate === 55
    && byCode[SKUS.BOX.code]?.existingVendorRate === 250 && byCode[SKUS.BOX.code]?.requestedRate === 270
    && reqs.every((q) => q.status === 'PENDING' && q.requestedByName), JSON.stringify(reqs.map((q) => [q.skuCode, q.existingVendorRate, q.requestedRate, q.status])));
  const lineOf = async (code) => (await poNow(po._id)).items.find((l) => l.skuCode === code);
  const [lA, lBox, lKg, lNone, lZero] = await Promise.all([SKUS.A.code, SKUS.BOX.code, SKUS.KG.code, SKUS.NONE.code, SKUS.ZERO.code].map(lineOf));
  check('W3 draft lines keep the PROPOSED rates and carry PENDING on the two changed lines only',
    lA.rate === 55 && lA.rateChangeStatus === 'PENDING' && lA.fetchedRate === 50 && lBox.rate === 270 && lBox.rateChangeStatus === 'PENDING' && lBox.fetchedRate === 250
    && lKg.rate === 70 && !lKg.rateChangeStatus && lKg.fetchedRate === 70 && lNone.fetchedRate == null && lZero.fetchedRate == null,
    JSON.stringify([lA, lBox, lKg].map((l) => [l.rate, l.rateChangeStatus, l.fetchedRate])));
  const t0 = (await poNow(po._id)).totalTaxableValue;
  check('W4 totals are computed from the proposed rates', t0 === round2([lA, lBox, lKg, lNone, lZero].reduce((a, l) => a + round2(Number(l.quantity) * l.rate), 0)), String(t0));
  check('W5 the Vendor Master is untouched while pending (nuts 50, gloves BOX 250, no first-time rows yet)',
    (await rowOf(V1, SKUS.A.code))[0].rate === 50 && (await rowOf(V1, SKUS.BOX.code, 'BOX'))[0].rate === 250
    && (await rowOf(V1, SKUS.NONE.code)).length === 0 && (await rowOf(V1, SKUS.ZERO.code))[0].rate === 0);

  r = await approvePo('POAPPROVER', po._id);
  check('W6 the PO CANNOT be approved while a rate change is pending — the message names both', r.status === 400 && /awaiting approval/.test(r.message)
    && r.message.includes(byCode[SKUS.A.code].requestNumber) && r.message.includes(byCode[SKUS.BOX.code].requestNumber), `${r.status} ${r.message}`);
  check('W7 …and it is still a draft', (await poNow(po._id)).approvalStatus === 'DRAFT');
  r = await call('POAPPROVER', 'POST', `${RC}/${byCode[SKUS.A.code]._id}/approve`, {});
  check('W8 a holder of procurement.approve decides too → nuts approved', r.status === 200 && r.data.status === 'APPROVED', `${r.status} ${r.message}`);
  r = await call('BUYER', 'POST', `${RC}/${byCode[SKUS.BOX.code]._id}/approve`, {});
  check('W9 the doer cannot approve their own rate change (403)', r.status === 403, `${r.status} ${r.message}`);
  const lA2 = await lineOf(SKUS.A.code);
  const poMid = await poNow(po._id);
  check('W10 after the nuts approval: vendor row 55, line APPROVED at 55 naming the request, still DRAFT', (await rowOf(V1, SKUS.A.code))[0].rate === 55 && lA2.rateChangeStatus === 'APPROVED' && lA2.rate === 55
    && lA2.rateChangeRequestNumber === byCode[SKUS.A.code].requestNumber && poMid.approvalStatus === 'DRAFT');
  check('W11 …the totals did not move (the draft already carried 55)', poMid.totalTaxableValue === t0, `${poMid.totalTaxableValue} vs ${t0}`);
  r = await approvePo('POAPPROVER', po._id);
  check('W12 the PO is still blocked — by the gloves request only', r.status === 400 && r.message.includes(byCode[SKUS.BOX.code].requestNumber) && !r.message.includes(byCode[SKUS.A.code].requestNumber), `${r.status} ${r.message}`);

  r = await call('APPROVER', 'POST', `${RC}/${byCode[SKUS.BOX.code]._id}/reject`, { reason: 'W: use the contract rate' });
  const lBox2 = await lineOf(SKUS.BOX.code);
  const poRej = await poNow(po._id);
  check('W13 reject → vendor BOX rate unchanged (250); the line is back at 250, REJECTED; the rejected 270 is not left on the PO',
    r.status === 200 && (await rowOf(V1, SKUS.BOX.code, 'BOX'))[0].rate === 250 && lBox2.rate === 250 && lBox2.rateChangeStatus === 'REJECTED' && lBox2.taxableAmount === round2(Number(lBox2.quantity) * 250),
    JSON.stringify([r.status, lBox2.rate, lBox2.rateChangeStatus]));
  check('W14 totals recalculated after the rejection; PO still a draft', poRej.approvalStatus === 'DRAFT'
    && poRej.totalTaxableValue === round2(poRej.items.reduce((a, l) => a + l.taxableAmount, 0)) && poRej.totalTaxableValue < t0, String(poRej.totalTaxableValue));
  const listed = await call('BUYER', 'GET', `${RC}?poId=${po._id}&limit=20`);
  const rejRow = (listed.data?.rows || []).find((q) => q.status === 'REJECTED');
  check('W15 the rejection and its reason are visible to the doer on the PO\'s requests', rejRow?.rejectionReason === 'W: use the contract rate' && rejRow.requestNumber === byCode[SKUS.BOX.code].requestNumber, JSON.stringify(rejRow));

  const pricingBefore = await PricingHistory.countDocuments({ vendorId: V1 });
  r = await approvePo('POAPPROVER', po._id);
  check('W16 nothing pending → the PO approves (it was a draft all along)', r.status === 200 && r.data.approvalStatus === 'APPROVED' && r.data.poNumber, `${r.status} ${r.message}`);
  const none = await rowOf(V1, SKUS.NONE.code);
  const zero = await rowOf(V1, SKUS.ZERO.code);
  check('W17 first-time rate (no row): added once at 30', none.length === 1 && none[0].rate === 30, JSON.stringify(none));
  check('W18 first-time rate on an unpriced row: the SAME row is filled (no duplicate) at 20', zero.length === 1 && zero[0].rate === 20, JSON.stringify(zero));
  const firsts = await PricingHistory.find({ vendorId: V1, source: 'PURCHASE_ORDER', referenceId: po._id }).lean();
  check('W19 both first rates are audited as FIRST vendor rates (0 → new), naming the approver and the PO',
    firsts.length === 2 && firsts.every((h) => /First vendor rate/.test(h.remarks) && /E2E PO Approver/.test(h.remarks) && h.oldRate === 0 && h.updatedByName === 'E2E PO Approver'),
    JSON.stringify(firsts.map((h) => [h.remarks, h.oldRate, h.newRate, h.updatedByName])));
  check('W20 the approved nuts rate stayed at 55; no other vendor rate was touched by the PO approval',
    (await rowOf(V1, SKUS.A.code))[0].rate === 55 && (await rowOf(V1, SKUS.KG.code))[0].rate === 70 && (await PricingHistory.countDocuments({ vendorId: V1 })) === pricingBefore + 2);
  const rel = await call('MD', 'POST', `${PO}/${po._id}/release`, { sendEmail: false });
  check('W21 the approved PO can be released to the vendor', rel.status === 200 && (await poNow(po._id)).releaseStatus === 'RELEASED', `${rel.status} ${rel.message}`);
  const ph = await PricingHistory.findOne({ vendorId: V1, skuCode: SKUS.A.code, source: 'RATE_CHANGE_APPROVAL' }).sort({ createdAt: -1 }).lean();
  check('W22 Vendor Pricing History records the nuts change as a Rate Change Approval (50 → 55, this PO)',
    ph && ph.oldRate === 50 && ph.newRate === 55 && String(ph.referenceId) === String(po._id) && /RC-/.test(ph.remarks), JSON.stringify(ph));
  const trail = await RateChangeHistory.find({ poId: po._id }).sort({ at: 1, _id: 1 }).lean();
  const ev = trail.map((h) => `${h.event}:${h.skuCode}`);
  check('W23 permanent history: REQUESTED ×2, APPROVED (nuts), REJECTED (gloves) with vendor, PO, requester, decider and reasons',
    ev.filter((e) => e.startsWith('REQUESTED')).length === 2 && ev.includes(`APPROVED:${SKUS.A.code}`) && ev.includes(`REJECTED:${SKUS.BOX.code}`)
    && trail.every((h) => h.vendorName && h.poRef && h.requestedByName)
    && trail.find((h) => h.event === 'REJECTED').rejectionReason === 'W: use the contract rate' && !!trail.find((h) => h.event === 'APPROVED').actorName, ev.join(','));
  let denied = 0;
  try { await RateChangeHistory.updateOne({ _id: trail[0]._id }, { $set: { reason: 'tampered' } }); } catch { denied += 1; }
  try { await RateChangeHistory.deleteOne({ _id: trail[0]._id }); } catch { denied += 1; }
  check('W24 history cannot be changed or deleted', denied === 2 && (await RateChangeHistory.findById(trail[0]._id).lean())?.reason !== 'tampered');

  console.log('\n[W] The doer cannot talk their way round the check');
  let ind2 = await readyIndent('W-forge', ['A'], { vendorId: V2 });
  r = await createPo('BUYER', ind2, V2, () => ({ rate: 65, fetchedRate: 65, rateSource: 'VENDOR_MASTER', rateChangeStatus: 'APPROVED' }));
  check('W25 a changed rate with forged fetchedRate / APPROVED flags and no reason is refused (400)', r.status === 400 && /reason/i.test(r.message), `${r.status} ${r.message}`);
  r = await createPo('BUYER', ind2, V2, () => ({ rate: 65, fetchedRate: 65, rateSource: 'VENDOR_MASTER', rateChangeStatus: 'APPROVED', rateChangeRequestNumber: 'RC-FAKE', rateChangeReason: 'W: forged flags' }));
  const forged = r.data?._id ? (await poNow(r.data._id)).items[0] : null;
  check('W26 with a reason the forged flags are ignored: the line is PENDING (not APPROVED), fetchedRate is the vendor\'s 60, a real request exists',
    r.status === 201 && forged.rateChangeStatus === 'PENDING' && forged.fetchedRate === 60 && forged.rateChangeRequestNumber !== 'RC-FAKE', `${r.status} ${r.message} ${JSON.stringify(forged)}`);
  r = await approvePo('POAPPROVER', r.data?._id);
  check('W27 …and such a PO cannot be approved', r.status === 400 && /awaiting approval/.test(r.message), `${r.status} ${r.message}`);
  ind2 = await readyIndent('W-other-vendor', ['A'], { vendorId: V1 });
  r = await createPo('BUYER', ind2, V1, () => ({ rate: 60 }));
  check('W28 another vendor\'s rate is no free pass: 60 is V2\'s rate, V1\'s is 55 → a reason is required (400)', r.status === 400 && /reason/i.test(r.message), `${r.status} ${r.message}`);

  console.log('\n[W] Units: nothing is matched across units');
  const ind3 = await readyIndent('W-unit', ['WRONG'], { vendorId: V1 });
  r = await createPo('BUYER', ind3, V1, () => ({ rate: 5 }));
  check('W29 a BOX line for an item V1 prices per Pcs only cannot be saved — even at the Pcs rate (400, says per Pcs)', r.status === 400 && /per Pcs/i.test(r.message), `${r.status} ${r.message}`);
  r = await createPo('BUYER', ind3, V1, () => ({ unit: 'PCS', rate: 5 }));
  check('W30 the same line in Pcs at the vendor rate saves (201), no request', r.status === 201 && (await RateChangeRequest.countDocuments({ poId: r.data._id })) === 0, `${r.status} ${r.message}`);
  await VendorPurchaseOrder.updateOne({ _id: r.data._id }, { $set: { 'items.0.unit': 'BOX' } });
  const legacyUnit = await approvePo('POAPPROVER', r.data._id);
  check('W31 an older draft already in the wrong unit cannot be approved — the message says per Pcs vs BOX', legacyUnit.status === 400 && /per Pcs/i.test(legacyUnit.message) && /BOX/.test(legacyUnit.message), `${legacyUnit.status} ${legacyUnit.message}`);

  console.log('\n[W] Drafts saved before this feature');
  const ind4 = await readyIndent('W-legacy', ['A'], { vendorId: V1 });
  r = await createPo('BUYER', ind4, V1, () => ({ rate: 55 }));
  const legacyId = r.data._id;
  await VendorPurchaseOrder.updateOne({ _id: legacyId }, { $set: { 'items.0.rate': 58, 'items.0.fetchedRate': null, 'items.0.rateSource': 'MANUAL' } });
  r = await approvePo('POAPPROVER', legacyId);
  check('W32 an older draft with a rate that is not the vendor\'s (no fetchedRate, no request) cannot be approved', r.status === 400 && /no approved rate change/.test(r.message), `${r.status} ${r.message}`);
  const stored = await poNow(legacyId);
  const editBody = (extra) => ({ items: stored.items.map((l) => ({
    indentId: l.indentId, indentItemId: l.indentItemId, itemName: l.itemName, skuCode: l.skuCode, skuId: l.skuId, quantity: l.quantity, unit: l.unit, rate: l.rate, gstRate: l.gstRate, ...extra,
  })) });
  r = await call('BUYER', 'PATCH', `${PO}/${legacyId}`, editBody({}));
  check('W33 editing it without a reason is refused and asks for one', r.status === 400 && /reason/i.test(r.message), `${r.status} ${r.message}`);
  r = await call('BUYER', 'PATCH', `${PO}/${legacyId}`, editBody({ rateChangeReason: 'W: legacy draft' }));
  const legacyReq = await RateChangeRequest.findOne({ poId: legacyId, status: 'PENDING' }).lean();
  check('W34 with a reason it raises a request 55 → 58 and goes through the normal approval', r.status === 200 && legacyReq?.existingVendorRate === 55 && legacyReq.requestedRate === 58, `${r.status} ${r.message}`);
  r = await call('APPROVER', 'POST', `${RC}/${legacyReq._id}/approve`, {});
  const done = await approvePo('POAPPROVER', legacyId);
  check('W35 approved: vendor nuts rate 58, and the PO approves', r.status === 200 && (await rowOf(V1, SKUS.A.code))[0].rate === 58 && done.status === 200, `${r.status} ${done.status} ${done.message}`);
};

// ── Browser spec data ──────────────────────────────────────────────────────
const prepUi = async () => {
  await connect();
  await seed();
  await login();
  const brief = (ind) => ({
    _id: String(ind._id), indentNumber: ind.indentNumber,
    items: ind.items.map((it) => ({ _id: String(it._id), skuCode: it.skuCode, ref: it.itemDisplayNumber || '', qty: it.approvedQuantity || it.quantity, unit: it.unit })),
  });
  const v1 = await Vendor.findOne({ code: VENDORS.V1.code }).lean();
  const main = await readyIndent('ui-main', ['A', 'BOX', 'KG']);   // V1 and V2 both carry all three
  const wrong = await readyIndent('ui-wrong', ['WRONG']);          // V1 prices it per Pcs only; the line is BOX
  const none = await readyIndent('ui-none', ['NONE']);             // no vendor carries it
  const zero = await readyIndent('ui-zero', ['ZERO']);             // V1 carries it at rate 0
  const loose = await readyIndent('ui-loose', ['LOOSE']);          // V1 only has "VF Bolt M10 Long" (no SKU code)
  for (const it of loose.items) {
    await ok('BUYER', 'PATCH', `${PO}/approved-items/vendor`, { indentId: String(loose._id), indentItemId: String(it._id), vendorId: String(v1._id) });
  }
  const manifest = {
    api: API, password: PASSWORD, users: Object.fromEntries(Object.entries(USERS).map(([k, u]) => [k, u.email])),
    vendors: Object.fromEntries(Object.entries(VENDORS).map(([k, v]) => [k, v.name])),
    skus: SKUS,
    main: brief(main), wrong: brief(wrong), none: brief(none), zero: brief(zero), loose: brief(loose),
  };
  const out = path.resolve(process.cwd(), '..', 'frontend', 'e2e', 'shots', 'vendor-rate-fetch-manifest.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`[prep-ui] wrote ${out}`);
  await mongoose.disconnect();
};

if (isEntry(import.meta.url)) {
  const arg = process.argv[2];
  const run = arg === '--seed' ? async () => { await seed(); await mongoose.disconnect(); }
    : arg === '--api' ? apiChecks
      : arg === '--prep-ui' ? prepUi : null;
  if (!run) { console.log('usage: --seed | --api | --prep-ui'); process.exit(2); }
  run().catch((e) => { console.error(e); process.exit(1); });
}
