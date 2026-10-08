/**
 * Visible demo data for the WHOLE purchase-to-scrap flow, built through the app.
 *
 *   node src/scripts/e2eDemoFlowFixture.js --seed       fresh scratch DB + masters (user, SKUs)
 *   node src/scripts/e2eDemoFlowFixture.js --purchase   Purchase FMS chain over HTTP, per coil:
 *                                                        vendor -> indent -> submit -> approve
 *                                                        -> quote -> comparative -> approve quote
 *                                                        -> PO -> approve -> release
 *                                                        -> PI not required -> follow-up ready for GRN
 *   node src/scripts/e2eDemoFlowFixture.js --verify     reconcile the whole chain from the DB
 *   node src/scripts/e2eDemoFlowFixture.js --dump       print the record numbers as JSON
 *
 * The GRN, Add to RM Stock and Cut Coils steps are NOT here — they are driven in
 * the browser by frontend/e2e/fullFlow.e2e.mjs (BATCH_PREFIX=DEMO-COIL), so the
 * operator-facing half is exercised through the real screens.
 *
 * WHY THE PURCHASE CHAIN IS DRIVEN OVER HTTP AND NOT DIRECTLY
 * Every step calls the running backend's real routes as a logged-in user, so
 * each request passes the same Joi validation, permission check and service
 * rules the Purchase FMS screens send it through. Nothing here writes a
 * procurement document into Mongo by hand.
 *
 * SAFETY: --seed is pinned to a localhost scratch database. --purchase talks
 * only to the scratch backend on :5099, and refuses to run unless that backend
 * reports itself connected to this same scratch database.
 */
import fs from 'node:fs';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import Indent from '../modules/procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote from '../modules/procurement/grn/grn.model.js';
import InventoryMovement, { TXN_TYPE, MOVEMENT_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import { scrapImsService } from '../modules/inventory/scrapIms.service.js';
import { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } from '../modules/inventory/scrapSku.js';
import { COIL_CIRCLE_MAP } from '../data/coil-circle-map.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_fullflow';
// Local scratch DB, S3 off, email off — or stop before anything connects.
// Only when RUN as a script: unit tests import pure data from some fixtures.
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eDemoFlowFixture.js');
const DB_NAME = 'ambika_e2e_fullflow';
const API = 'http://127.0.0.1:5099/api/v1';
export const E2E_USER = {
  email: 'fullflow-e2e@test.local', password: 'E2e@12345', name: 'Demo Purchase Officer', role: 'MD',
};

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(E2E_URI)) {
  console.error('Refusing to run: fixture must target localhost.');
  process.exit(1);
}

/** The three purchases, exactly as briefed. */
export const PURCHASES = [
  {
    key: 'C1', coil: 'JSL204-07', coilName: 'Cu 0.70 mm', batchNo: 'DEMO-COIL-001',
    qty: 2000, rate: 185, gst: 18, receivedAt: 'PLG01',
    vendor: { name: 'Demo Steel Traders', code: 'DEMOV1', location: 'Ahmedabad', state: 'Gujarat' },
  },
  {
    key: 'C2', coil: 'JSL204-08', coilName: 'Cu 0.80 mm', batchNo: 'DEMO-COIL-002',
    qty: 2500, rate: 192, gst: 18, receivedAt: 'JW001',
    vendor: { name: 'Demo Coil Suppliers', code: 'DEMOV2', location: 'Vadodara', state: 'Gujarat' },
  },
  {
    key: 'C3', coil: 'JSL202-06', coilName: 'DD 0.60 mm', batchNo: 'DEMO-COIL-003',
    qty: 1500, rate: 170, gst: 18, receivedAt: 'PLG01',
    vendor: { name: 'Demo Metals Co', code: 'DEMOV3', location: 'Surat', state: 'Gujarat' },
  },
];
/** A competitor that quotes on every indent and loses on price — so the
 *  comparative screen shows a real choice, not a single row. */
const COMPETITOR = { name: 'Demo Alternate Supplier', code: 'DEMOV9', location: 'Rajkot', state: 'Gujarat', markup: 7 };

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) {
    throw new Error(`Connected to an unexpected database (${mongoose.connection.name}) — aborting.`);
  }
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ══ --seed: master data only ══════════════════════════════════════════════ */

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();

  await User.create({
    ...E2E_USER, password: E2E_USER.password, mobile: '9000000009', isActive: true, roles: ['MD'],
  });

  for (const p of PURCHASES) {
    await SKU.create({
      code: p.coil, name: p.coilName, category: 'Coil', unit: 'KGS', itemType: 'RAW_MATERIAL', isActive: true,
    });
    for (const c of COIL_CIRCLE_MAP[p.coil] || []) {
      if (await SKU.exists({ code: c.code })) continue;
      await SKU.create({
        code: c.code, name: c.clientLabel, category: 'Circles', unit: 'PCS', itemType: 'CIRCLE', isActive: true,
      });
    }
  }
  // Exists in the real master (ensureScrapSku) — an in-house cut posts into it.
  await SKU.create({ code: SCRAP_SKU_CODE, ...SCRAP_SKU_DEFAULTS, isActive: true });

  console.log(JSON.stringify({ ok: true, db: mongoose.connection.name, user: E2E_USER.email, skus: await SKU.countDocuments() }, null, 2));
  await mongoose.disconnect();
};

/* ══ --purchase: the Purchase FMS chain over HTTP ══════════════════════════ */

let TOKEN = '';
const api = async (method, path, body, { form } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(form ? {} : { 'content-type': 'application/json' }),
    },
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.errors ? ` ${JSON.stringify(json.errors).slice(0, 300)}` : '';
    throw new Error(`${method} ${path} -> ${res.status}: ${json?.message || res.statusText}${detail}`);
  }
  return json?.data ?? json;
};

/** A small but genuine PDF, so the quotation documents open in the browser. */
const quotationPdf = (title, lines) => {
  const text = [title, ...lines].map((l, i) => `BT /F1 ${i ? 11 : 15} Tf 50 ${770 - i * 22} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
};

const upload = async (fileName, buffer) => {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), fileName);
  const d = await api('POST', '/uploads?folder=misc', undefined, { form });
  return { fileName: d.fileName || fileName, fileUrl: d.url || d.fileUrl, fileType: 'application/pdf', uploadedAt: new Date() };
};

const step = (label, detail = '') => console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`);

const purchase = async () => {
  // Refuse to drive anything that is not the scratch backend on the scratch DB.
  await connect();
  const skus = Object.fromEntries((await SKU.find({ code: { $in: PURCHASES.map((p) => p.coil) } }).lean()).map((s) => [s.code, s]));
  if (Object.keys(skus).length !== 3) throw new Error('Run --seed first.');
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: E2E_USER.email, password: E2E_USER.password }),
  }).then((r) => r.json());
  TOKEN = login?.data?.token || login?.token || login?.data?.accessToken || '';
  if (!TOKEN) throw new Error(`Login against :5099 failed — is the scratch backend up? ${JSON.stringify(login).slice(0, 200)}`);
  // The scratch backend's user exists ONLY in this scratch DB — logging in with
  // it is itself proof the backend is reading ambika_e2e_fullflow.
  step('logged in to the scratch backend', E2E_USER.email);

  /* Vendors (master data, through the vendor API) */
  const vendorIds = {};
  for (const v of [...PURCHASES.map((p) => p.vendor), COMPETITOR]) {
    const doc = await api('POST', '/vendors', {
      code: v.code, name: v.name, location: v.location, state: v.state,
      contactPerson: 'Demo Contact', phone: '9000000000', email: '', gstRate: 18, creditPeriodDays: 30,
    });
    vendorIds[v.name] = doc._id;
    step('vendor created', `${v.name} (${v.code})`);
  }

  const out = [];
  for (const p of PURCHASES) {
    console.log(`\n── ${p.batchNo} · ${p.coil} ${p.coilName} · ${p.qty} KG ──`);
    const sku = skus[p.coil];
    const vendorId = vendorIds[p.vendor.name];
    const altId = vendorIds[COMPETITOR.name];
    const altRate = p.rate + COMPETITOR.markup;

    /* 1.1 Indent: create -> submit -> approve */
    let indent = await api('POST', '/procurement/indents', {
      requestType: 'MATERIAL_PURCHASE', department: 'Production', raisedBy: 'Demo Purchase Officer',
      remarks: `Coil requirement for circle cutting — ${p.batchNo}`,
      items: [{ skuId: String(sku._id), skuCode: sku.code, itemName: sku.name, quantity: p.qty, unit: 'KGS' }],
    });
    step('indent created', indent.indentNumber || indent._id);
    indent = await api('POST', `/procurement/indents/${indent._id}/submit`, {});
    step('indent submitted', indent.approvalStatus || '');
    const itemId = String(indent.items[0]._id);
    indent = await api('POST', `/procurement/indents/${indent._id}/approve`, {
      approvedBy: 'Demo Purchase Officer', remarks: 'Approved for purchase',
      items: [{ _id: itemId, approvedQuantity: p.qty, revisedQuantity: p.qty, approvalStatus: 'APPROVED' }],
    });
    step('indent approved', `${indent.approvalStatus || ''} · approved qty ${p.qty}`);

    /* 1.2 Quotes: receive -> comparative (two vendors, real PDF documents) */
    await api('POST', `/procurement/indents/${indent._id}/receive-quote`, {
      status: 'RECEIVED', vendorId, vendorName: p.vendor.name, remarks: 'Quotations requested from two suppliers',
    });
    const docWin = await upload(`Quotation-${p.vendor.code}-${p.batchNo}.pdf`, quotationPdf(`QUOTATION — ${p.vendor.name}`, [
      `Item: ${sku.code} ${sku.name}`, `Quantity: ${p.qty} KG`, `Rate: Rs ${p.rate} per KG`, `GST: ${p.gst}%`, 'Delivery: 7 days', 'DEMO DOCUMENT — scratch environment',
    ]));
    const docAlt = await upload(`Quotation-${COMPETITOR.code}-${p.batchNo}.pdf`, quotationPdf(`QUOTATION — ${COMPETITOR.name}`, [
      `Item: ${sku.code} ${sku.name}`, `Quantity: ${p.qty} KG`, `Rate: Rs ${altRate} per KG`, `GST: ${p.gst}%`, 'Delivery: 10 days', 'DEMO DOCUMENT — scratch environment',
    ]));
    step('quotation PDFs uploaded (local disk)', `${docWin.fileName}, ${docAlt.fileName}`);

    const qItem = (rate, days) => ({
      skuId: String(sku._id), skuCode: sku.code, itemName: sku.name, unit: 'KGS',
      requestedQty: p.qty, quotedRate: rate, gstRate: p.gst, deliveryDays: days, paymentTerms: '30 days credit',
      totalAmount: round2(p.qty * rate),
    });
    indent = await api('POST', `/procurement/indents/${indent._id}/quote-comparative`, {
      statusDone: 'YES', remarks: `Lowest quote: ${p.vendor.name} @ ₹${p.rate}/kg`,
      quotationDocuments: [docWin, docAlt],
      itemQuotations: [{
        itemId, skuId: String(sku._id), skuCode: sku.code, itemName: sku.name,
        statusDone: 'YES', quotationDocuments: [docWin, docAlt],
      }],
      vendors: [
        { vendorId, vendorName: p.vendor.name, quotationStatus: 'RECEIVED', items: [qItem(p.rate, 7)], totalQuotationValue: round2(p.qty * p.rate) },
        { vendorId: altId, vendorName: COMPETITOR.name, quotationStatus: 'RECEIVED', items: [qItem(altRate, 10)], totalQuotationValue: round2(p.qty * altRate) },
      ],
    });
    step('quote comparative recorded', `${p.vendor.name} ₹${p.rate} vs ${COMPETITOR.name} ₹${altRate}`);

    /* 1.3 Approve the winning quotation */
    indent = await api('POST', `/procurement/indents/${indent._id}/approve-quotation`, {
      remarks: `Approved ${p.vendor.name} — lowest rate`,
      approvedQuotationDocuments: [docWin],
      itemApprovedQuotations: [{
        itemId, skuId: String(sku._id), skuCode: sku.code, itemName: sku.name,
        statusDone: 'YES', approvedQuotationDocuments: [docWin],
      }],
      approvedVendors: [{
        vendorId, vendorName: p.vendor.name, approvalRemarks: 'Lowest rate, 7-day delivery',
        approvedQuotationDocument: docWin,
        items: [{ skuId: String(sku._id), skuCode: sku.code, itemName: sku.name, unit: 'KGS', approvedQty: p.qty, approvedRate: p.rate, gstRate: p.gst, totalAmount: round2(p.qty * p.rate) }],
      }],
    });
    step('quotation approved', p.vendor.name);

    /* 1.4 PO: create from the approved item -> approve -> release */
    const created = await api('POST', '/procurement/purchase-orders/create-from-items', {
      vendorId, vendorName: p.vendor.name, poFormatType: 'OTHER',
      deliveryTerms: 'Door delivery', paymentTerms: '30 days credit', leadTime: '7 days', creditPeriod: 30,
      remarks: `Coil purchase — ${p.batchNo}`,
      items: [{
        indentId: String(indent._id), indentNumber: indent.indentNumber, indentItemId: itemId,
        skuId: String(sku._id), skuCode: sku.code, itemName: sku.name,
        quantity: p.qty, unit: 'KGS', rate: p.rate, gstRate: p.gst,
      }],
    });
    const poDoc = Array.isArray(created) ? created[0] : (created.po || created.pos?.[0] || created);
    // A draft carries only a draft number; the real PO number is minted at approval.
    step('PO created (draft)', `${poDoc.draftNumber || poDoc._id} · ${poDoc.poStatus || ''}`);
    let po = await api('POST', `/procurement/purchase-orders/${poDoc._id}/approve`, { decision: 'APPROVED', remarks: 'Approved' });
    step('PO approved', `${po.poNumber} · ${po.approvalStatus || po.poStatus || ''}`);
    po = await api('POST', `/procurement/purchase-orders/${poDoc._id}/release`, {
      sendEmail: false, supplierAcknowledgement: 'Acknowledged by phone', remarks: 'Released to vendor',
    });
    step('PO released', po.poStatus || '');

    /* 1.6 PI not required -> 1.5 follow-up -> ready for GRN */
    po = await api('POST', `/procurement/purchase-orders/${poDoc._id}/pi-not-required`, {
      reason: 'Credit vendor — no proforma needed', remarks: 'Demo flow',
    });
    step('PI marked Not Required', po.piStatus || '');
    // Step 1.5 is the purchase officer's own work: raise a follow-up on the
    // released PO, record that the vendor was chased (DONE — required before
    // Ready for GRN), then declare the material ready with its final date.
    const fu = await api('POST', '/procurement/follow-ups', {
      poId: String(poDoc._id), followUpType: 'CALL', remarks: 'Chase vendor for dispatch date',
    });
    step('follow-up raised', fu.followUpNumber || fu._id);
    await api('POST', `/procurement/follow-ups/${fu._id}/mark-done`, {
      followUpType: 'CALL', remarks: 'Vendor confirmed dispatch',
      message: `Spoke to ${p.vendor.name}: ${p.qty} KG ${p.coil} dispatched, batch ${p.batchNo}`,
    });
    step('follow-up marked DONE');
    await api('POST', `/procurement/follow-ups/${fu._id}/mark-ready-for-grn`, {
      finalMaterialDate: new Date().toISOString(), remarks: 'Material at gate — ready to receive',
    });
    const fresh = await api('GET', `/procurement/purchase-orders/${poDoc._id}`);
    step('follow-up: ready for GRN', `${fresh.followUpStatus} · PI ${fresh.piStatus}`);

    out.push({
      batchNo: p.batchNo, coil: p.coil, qty: p.qty, rate: p.rate, supplier: p.vendor.name,
      indentNumber: indent.indentNumber, poNumber: fresh.poNumber, poId: fresh._id,
      poStatus: fresh.poStatus, approvalStatus: fresh.approvalStatus, followUpStatus: fresh.followUpStatus, piStatus: fresh.piStatus,
      receivedAt: p.receivedAt,
    });
  }

  const file = process.env.DEMO_OUT;
  if (file) fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\n${JSON.stringify(out, null, 2)}`);
  await mongoose.disconnect();
};

/* ══ --verify: reconcile the whole chain ═══════════════════════════════════ */

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : (detail ? ` — ${detail}` : '')}`);
};
const eq = (name, actual, expected) => check(name, actual === expected, `expected ${expected}, got ${actual}`);

export const EXPECTED = {
  'DEMO-COIL-001': { cut: 1300, circles: 1105, scrap: 195, remaining: 700, rounds: 2, yieldPct: 85, scrapPct: 15, plg: true },
  'DEMO-COIL-002': { cut: 1000, circles: 820, scrap: 180, remaining: 1500, rounds: 1, yieldPct: 82, scrapPct: 18, plg: false },
  'DEMO-COIL-003': { cut: 600, circles: 510, scrap: 90, remaining: 900, rounds: 1, yieldPct: 85, scrapPct: 15, plg: true },
};

const verify = async () => {
  await connect();
  console.log('\nDemo flow — independent reconciliation of ambika_e2e_fullflow\n');

  console.log('— duplicates —');
  eq('exactly 3 indents', await Indent.countDocuments({ isDeleted: { $ne: true } }), 3);
  eq('exactly 3 POs', await VendorPurchaseOrder.countDocuments({ isDeleted: { $ne: true } }), 3);
  eq('exactly 3 GRNs', await GoodsReceiptNote.countDocuments({ isDeleted: { $ne: true } }), 3);
  eq('exactly 3 GRN_IN movements', await InventoryMovement.countDocuments({ txnType: TXN_TYPE.GRN_IN, isDeleted: { $ne: true } }), 3);
  eq('exactly 4 conversions', await CoilConversion.countDocuments({ isDeleted: { $ne: true } }), 4);
  eq('exactly 4 scrap records', await ScrapRecord.countDocuments({ isDeleted: { $ne: true } }), 4);
  const dupMv = await InventoryMovement.aggregate([
    { $group: { _id: { t: '$txnType', r: '$refNumber', s: '$skuId' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } },
  ]);
  eq('no duplicated movement (same type + ref + sku)', dupMv.length, 0);

  for (const p of PURCHASES) {
    const e = EXPECTED[p.batchNo];
    console.log(`\n— ${p.batchNo} (${p.coil}) —`);
    const indent = await Indent.findOne({ 'items.skuCode': p.coil }).lean();
    const po = await VendorPurchaseOrder.findOne({ 'items.skuCode': p.coil }).lean();
    const grn = po && await GoodsReceiptNote.findOne({ poId: po._id }).lean();
    check('indent exists and is approved', !!indent && /APPROVED/.test(indent.approvalStatus || ''), indent?.approvalStatus);
    check('PO exists, approved and released', !!po && po.approvalStatus === 'APPROVED' && /RELEASED|RECEIVED|CLOSED/.test(po.poStatus || ''), `${po?.approvalStatus}/${po?.poStatus}`);
    eq('PO supplier', po?.vendorName, p.vendor.name);
    eq('PO rate', po?.items?.[0]?.rate, p.rate);
    eq('PO qty', po?.items?.[0]?.quantity, p.qty);
    check('PO went through PI-not-required + ready-for-GRN', po?.piStatus === 'PI_NOT_REQUIRED' && po?.followUpStatus === 'READY_FOR_GRN', `${po?.piStatus}/${po?.followUpStatus}`);
    if (!grn) { check('GRN exists', false, 'none'); continue; }
    eq('GRN references the PO', grn.poNumber, po.poNumber);
    eq('GRN received qty = PO qty', round2(grn.items?.[0]?.receivedQty), p.qty);
    eq('GRN batch', grn.items?.[0]?.batchNo, p.batchNo);
    eq('GRN Add to RM Stock', grn.addToRmStock, true);
    eq('GRN Received At', grn.rmReceivedAtLocation, p.receivedAt);
    eq('GRN completed (stock posted)', grn.stockPosted, true);
    eq('PO received qty booked back = PO qty', round2(po.items?.[0]?.receivedQty), p.qty);

    const ins = await InventoryMovement.find({ refId: grn._id, txnType: TXN_TYPE.GRN_IN }).lean();
    eq('one GRN_IN for this GRN', ins.length, 1);
    const r = ins[0];
    if (!r) continue;
    eq('GRN_IN qty = GRN qty = PO qty', round2(r.quantity), p.qty);
    eq('GRN_IN batch', r.batchNo, p.batchNo);
    eq('GRN_IN sku', r.skuCode, p.coil);
    eq('GRN_IN warehouse = Received At', r.warehouse, p.receivedAt);
    eq('GRN_IN GRN reference', r.refNumber, grn.grnNumber);

    const convs = await CoilConversion.find({ batchNo: p.batchNo, isDeleted: { $ne: true } }).lean();
    eq('conversions on this batch', convs.length, e.rounds);
    check('every conversion -> coilReceiptId = this GRN_IN', convs.every((c) => String(c.coilReceiptId) === String(r._id)));
    check('every conversion is on this coil sku', convs.every((c) => c.coilSkuCode === p.coil));
    check('every circle is approved for this coil',
      convs.every((c) => c.circles.every((x) => (COIL_CIRCLE_MAP[p.coil] || []).some((m) => m.code === x.circleSkuCode))));
    eq('Σ cut', round2(convs.reduce((s, c) => s + c.coilWeightKg, 0)), e.cut);
    eq('Σ circle output', round2(convs.reduce((s, c) => s + c.circlesWeightKg, 0)), e.circles);
    check('scrap = cut − output, per round', convs.every((c) => round2(c.scrapKg) === round2(c.coilWeightKg - c.circlesWeightKg)));

    const coilMv = await InventoryMovement.find({ batchNo: p.batchNo, skuCode: p.coil, isDeleted: { $ne: true } }).lean();
    const bal = round2(coilMv.reduce((s, m) => s + (m.movementType === MOVEMENT_TYPE.IN ? m.quantity : -m.quantity), 0));
    eq('received − cuts = remaining (coil ledger)', bal, e.remaining);
    const coilStock = round2((await InventoryStock.find({ skuCode: p.coil }).lean()).reduce((s, x) => s + x.qtyOnHand, 0));
    eq('RM stock balance = remaining', coilStock, e.remaining);
    const stockAt = (await InventoryStock.find({ skuCode: p.coil }).lean()).filter((x) => Math.abs(x.qtyOnHand) > 0.001).map((x) => x.warehouse);
    eq('coil stock sits at its Received At', stockAt.join(','), p.receivedAt);

    const srs = await ScrapRecord.find({ coilReceiptId: r._id }).lean();
    eq('scrap records traced to this GRN_IN', srs.length, e.rounds);
    eq('Σ scrap', round2(srs.reduce((s, x) => s + x.scrapKg, 0)), e.scrap);
    eq('cutting location', [...new Set(srs.map((x) => x.location))].join(','), p.receivedAt);
    eq('scrap posted to Ambika stock', srs.filter((x) => x.stockMovementId).length, e.plg ? e.rounds : 0);
  }

  console.log('\n— scrap stock —');
  const scrapStock = await InventoryStock.find({ skuCode: SCRAP_SKU_CODE }).lean();
  const byLoc = Object.fromEntries(scrapStock.map((s) => [s.warehouse, round2(s.qtyOnHand)]));
  eq('Ambika scrap stock (all locations) = 195 + 90', round2(scrapStock.reduce((s, x) => s + x.qtyOnHand, 0)), 285);
  eq('PLG01 scrap stock', byLoc.PLG01 ?? 0, 285);
  eq('JW001 scrap stock (job work never becomes stock)', byLoc.JW001 ?? 0, 0);
  const jwRecord = await ScrapRecord.findOne({ batchNo: 'DEMO-COIL-002' }).lean();
  check('JW001 180 kg still exists as a scrap RECORD', round2(jwRecord?.scrapKg) === 180 && !jwRecord?.stockMovementId);

  console.log('\n— circle stock —');
  const circleStock = await InventoryStock.find({ skuCode: { $regex: /^JSL20\d-\d\d-\d+$/ } }).lean();
  for (const c of circleStock.filter((x) => x.qtyOnHand > 0)) console.log(`  info  ${c.skuCode} @ ${c.warehouse}: ${c.qtyOnHand} pcs`);
  const pcsIn = (await InventoryMovement.find({ txnType: TXN_TYPE.CONVERT_IN }).lean()).reduce((s, m) => s + m.quantity, 0);
  eq('circle stock (pcs) = Σ pieces produced', round2(circleStock.reduce((s, x) => s + x.qtyOnHand, 0)), round2(pcsIn));

  console.log('\n— scrap by physical coil (the screen\'s own service) —');
  const { docs, summary } = await scrapImsService.getScrapByCoil({ page: 1, limit: 50 });
  eq('3 coils traced', summary.traced.coils, 3);
  eq('0 untraceable', summary.untraceable.records, 0);
  for (const [batch, e] of Object.entries(EXPECTED)) {
    const row = docs.find((d) => d.batchNo === batch);
    check(`${batch}: ${row ? `${row.receivedKg}/${row.cutKg}/${row.circlesKg}/${row.scrapKg}/${row.avgYieldPct}%/${row.remainingKg}/${row.rounds}` : 'missing'}`,
      !!row && row.cutKg === e.cut && row.circlesKg === e.circles && row.scrapKg === e.scrap
      && row.avgYieldPct === e.yieldPct && row.remainingKg === e.remaining && row.rounds === e.rounds);
  }

  const failed = results.filter((x) => !x.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)); }
  await mongoose.disconnect();
  if (failed.length) process.exit(1);
};

/* ══ --dump: every record number, for the report ══════════════════════════ */

const dump = async () => {
  await connect();
  const out = [];
  for (const p of PURCHASES) {
    const indent = await Indent.findOne({ 'items.skuCode': p.coil }).lean();
    const po = await VendorPurchaseOrder.findOne({ 'items.skuCode': p.coil }).lean();
    const grn = po && await GoodsReceiptNote.findOne({ poId: po._id }).lean();
    const mv = await InventoryMovement.find({ batchNo: p.batchNo }).sort({ createdAt: 1 }).lean();
    const convs = await CoilConversion.find({ batchNo: p.batchNo }).sort({ conversionDate: 1, createdAt: 1 }).lean();
    const srs = await ScrapRecord.find({ batchNo: p.batchNo }).sort({ createdAt: 1 }).lean();
    out.push({
      batchNo: p.batchNo, coil: p.coil, supplier: po?.vendorName, indent: indent?.indentNumber,
      po: po?.poNumber, poStatus: po?.poStatus, grn: grn?.grnNumber, grnStatus: grn?.grnStatus,
      receivedAt: grn?.rmReceivedAtLocation,
      movements: mv.map((m) => `${m.movementNumber} ${m.txnType} ${m.skuCode} ${m.movementType === 'IN' ? '+' : '-'}${m.quantity} @${m.warehouse} ref ${m.refNumber}`),
      conversions: convs.map((c) => `${c.conversionNumber} cut ${c.coilWeightKg} → ${c.circlesWeightKg} (${c.circles.map((x) => `${x.pcs}×${x.circleSkuCode}`).join(', ')}) scrap ${c.scrapKg} yield ${c.yieldRatioPct}% receipt ${c.coilReceiptId}`),
      scrapRecords: srs.map((s) => `${s._id} ${s.scrapKg} kg @${s.location} ${s.batchStatus} stockMovement ${s.stockMovementId || 'none'}`),
    });
  }
  const stock = await InventoryStock.find({ qtyOnHand: { $ne: 0 } }).sort({ skuCode: 1 }).lean();
  console.log(JSON.stringify({ records: out, stock: stock.map((s) => `${s.skuCode} @${s.warehouse}: ${s.qtyOnHand}`) }, null, 2));
  await mongoose.disconnect();
};

const MODES = { '--seed': seed, '--purchase': purchase, '--verify': verify, '--dump': dump };
const mode = process.argv.find((a) => MODES[a]);
if (!mode) {
  console.error(`Usage: node src/scripts/e2eDemoFlowFixture.js [${Object.keys(MODES).join(' | ')}]`);
  process.exit(1);
}
MODES[mode]().catch((e) => { console.error(`\nFAILED: ${e.message}`); process.exit(1); });
