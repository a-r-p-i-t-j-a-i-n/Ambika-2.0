/**
 * Fixture + oracle for the Material Receipt Type chosen PER GRN LINE (moved
 * off the GRN header).
 *
 *   node src/scripts/e2eGrnReceiptTypeFixture.js --seed     fresh scratch DB: POs ready for GRN + legacy GRNs
 *   node src/scripts/e2eGrnReceiptTypeFixture.js --api      HTTP checks against the e2e backend (API_URL,
 *                                                           default http://127.0.0.1:5099/api/v1)
 *   node src/scripts/e2eGrnReceiptTypeFixture.js --verify   DB checks after frontend/e2e/grnReceiptType.e2e.mjs
 *
 * --api goes through the real routes (Joi + stripUnknown + service), so a
 * per-line value the schema forgot to declare would be caught here. It then
 * runs Incoming QC through the services to show stock posting still works on
 * a GRN whose lines carry different receipt types.
 *
 * Legacy GRNs are seeded the way older code left them: one header
 * howItemReceived, NO field on the lines.
 *
 * SAFETY: pinned to a localhost scratch database (dropped on --seed) behind the
 * shared e2e guard (S3 + email must be off). It never reads MONGO_URI.
 */
import zlib from 'node:zlib';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote, { GRN_STATUS } from '../modules/procurement/grn/grn.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';

export const DB_NAME = 'ambika_e2e_grn_receipt_type';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eGrnReceiptTypeFixture.js');
export const E2E_USER = { email: 'grn-receipt-e2e@test.local', password: 'E2e@12345', name: 'Receipt Type Runner', role: 'MD' };
const API = (process.env.API_URL || 'http://127.0.0.1:5099/api/v1').replace(/\/+$/, '');

const SKUS = [
  { code: 'RT-BOLT', name: 'RT Bolt M8', unit: 'PCS', itemType: 'CONSUMABLE' },
  { code: 'RT-NUT', name: 'RT Nut M8', unit: 'PCS', itemType: 'CONSUMABLE' },
  { code: 'RT-WASHER', name: 'RT Washer M8', unit: 'PCS', itemType: 'CONSUMABLE' },
];
const VENDOR = 'RT Vendor Pvt Ltd';

/** POs ready for a GRN. RT-BOLT sits on two POs of each pair on purpose. */
const READY_POS = {
  'PO-RT-A': [['RT-BOLT', 10], ['RT-NUT', 5]],     // --api multi-PO
  'PO-RT-B': [['RT-BOLT', 8], ['RT-WASHER', 4]],   // --api multi-PO
  'PO-RT-C': [['RT-BOLT', 3], ['RT-NUT', 2]],      // --api older client (header value only)
  'PO-RT-UI-A': [['RT-BOLT', 6], ['RT-NUT', 3]],   // browser multi-PO
  'PO-RT-UI-B': [['RT-BOLT', 7], ['RT-WASHER', 2]],// browser multi-PO
};
/** GRNs as the code before the move left them — header type only. */
const LEGACY = [
  { tag: 'LEG-UI', header: 'DAMAGED_RECEIVED', lines: [['RT-NUT', 9], ['RT-WASHER', 3]] },    // browser: edit restores
  { tag: 'LEG-API', header: 'EXTRA_RECEIVED', lines: [['RT-BOLT', 4]] },                       // --api: edit without items
  { tag: 'LEG-CMP', header: 'DAMAGED_RECEIVED', lines: [['RT-NUT', 6], ['RT-BOLT', 2]] },      // --api: completed untouched
  { tag: 'LEG-DONE', header: 'PARTIAL_RECEIVED', lines: [['RT-WASHER', 5]], completed: true }, // browser: detail page
];

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

const makePo = (poNumber, lines, skus, vendorId, extra = {}) => VendorPurchaseOrder.create({
  poNumber, vendorId, vendorName: VENDOR, indentId: new mongoose.Types.ObjectId(), poStatus: 'RELEASED_TO_VENDOR',
  followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_NOT_REQUIRED', readyForGrnAt: new Date(), finalMaterialDate: new Date(),
  items: lines.map(([code, qty]) => ({
    skuId: skus[code]._id, skuCode: code, itemName: skus[code].name, unit: skus[code].unit,
    quantity: qty, receivedQty: 0, pendingQty: qty, rate: 50, gstRate: 18,
  })),
  ...extra,
});

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  const user = await User.create({ ...E2E_USER, mobile: '9000000071', isActive: true, roles: ['MD'] });
  for (const s of SKUS) await SKU.create(s);
  const skus = Object.fromEntries((await SKU.find({}).lean()).map((s) => [s.code, s]));
  const vendorId = new mongoose.Types.ObjectId();
  for (const [poNumber, lines] of Object.entries(READY_POS)) await makePo(poNumber, lines, skus, vendorId);

  for (const g of LEGACY) {
    const po = await makePo(`PO-RT-${g.tag}`, g.lines, skus, vendorId, g.completed ? {
      poStatus: 'FULLY_RECEIVED', items: g.lines.map(([code, qty]) => ({
        skuId: skus[code]._id, skuCode: code, itemName: skus[code].name, unit: skus[code].unit,
        quantity: qty, receivedQty: qty, pendingQty: 0, rate: 50, gstRate: 18,
      })),
    } : {});
    const grn = await GoodsReceiptNote.create({
      grnNumber: `GRN-RT-${g.tag}`, poId: po._id, poNumber: po.poNumber, poIds: [po._id], poNumbers: [po.poNumber],
      vendorId, vendorName: VENDOR, warehouse: 'MAIN', howItemReceived: g.header,
      ...(g.completed ? {
        grnStatus: GRN_STATUS.FULLY_RECEIVED, stockPosted: true, approvalStatus: 'NOT_REQUIRED', completedAt: new Date('2026-09-01'),
      } : { grnStatus: GRN_STATUS.DRAFT, stockPosted: false }),
      items: po.items.map((p) => ({
        poItemId: p._id, poId: po._id, poNumber: po.poNumber, skuId: p.skuId, skuCode: p.skuCode, itemName: p.itemName, unit: p.unit,
        orderedQty: p.quantity, invoiceQty: p.quantity, receivedQty: p.quantity, rate: p.rate,
      })),
      totalReceivedQty: g.lines.reduce((t, l) => t + l[1], 0),
      createdBy: user._id,
    });
    // Exactly the older shape: the lines have no howItemReceived at all.
    await GoodsReceiptNote.collection.updateOne({ _id: grn._id }, { $unset: { 'items.$[].howItemReceived': 1 } });
  }
  console.log(JSON.stringify({ ok: true, db: DB_NAME, login: E2E_USER.email }, null, 2));
  await mongoose.disconnect();
};

// ── HTTP helpers ─────────────────────────────────────────────────────────────
let token = '';
const http = async (method, url, body) => {
  const res = await fetch(`${API}${url}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data };
};

/** Text runs of a pdfkit PDF (inflates content streams, joins TJ hex pieces). */
export const pdfText = (buf) => {
  const out = [];
  const raw = buf.toString('latin1');
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(raw))) {
    let s;
    try { s = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    for (const tj of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      out.push([...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
    }
  }
  return out;
};

const typesByLine = (grn) => Object.fromEntries((grn.items || []).map((l) => [`${l.poNumber}|${l.skuCode}`, l.howItemReceived ?? null]));
const sorted = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const lineOf = (po, code, extra = {}) => {
  const p = po.items.find((i) => i.skuCode === code);
  return {
    poItemId: String(p._id), poId: String(po._id), poNumber: po.poNumber, itemName: p.itemName, skuCode: code,
    skuId: String(p.skuId), unit: p.unit, invoiceQty: p.quantity, receivedQty: p.quantity, rate: p.rate, ...extra,
  };
};

const api = async () => {
  await connect();
  const login = await http('POST', '/auth/login', { email: E2E_USER.email, password: E2E_USER.password });
  token = login.data?.data?.token || '';
  check('login', login.status === 200 && token);
  const po = Object.fromEntries((await VendorPurchaseOrder.find({}).lean()).map((p) => [p.poNumber, p]));
  const A = po['PO-RT-A']; const B = po['PO-RT-B'];

  console.log('\n── 1. Multi-PO GRN, a different type per SKU (RT-BOLT on both POs) ──');
  const want1 = {
    'PO-RT-A|RT-BOLT': 'DAMAGED_RECEIVED', 'PO-RT-A|RT-NUT': 'PARTIAL_RECEIVED',
    'PO-RT-B|RT-BOLT': 'EXTRA_RECEIVED', 'PO-RT-B|RT-WASHER': 'FULL_MATERIAL_RECEIVED',
  };
  const items1 = [
    lineOf(A, 'RT-BOLT', { howItemReceived: 'DAMAGED_RECEIVED' }), lineOf(A, 'RT-NUT', { howItemReceived: 'PARTIAL_RECEIVED' }),
    lineOf(B, 'RT-BOLT', { howItemReceived: 'EXTRA_RECEIVED' }), lineOf(B, 'RT-WASHER', { howItemReceived: 'FULL_MATERIAL_RECEIVED' }),
  ];
  const created = await http('POST', '/procurement/grns', { poIds: [String(A._id), String(B._id)], items: items1 });
  const g1 = created.data?.data;
  check('create → 201', created.status === 201, `${created.status} ${created.data?.message || ''}`);
  check('each line saved with its own type', same(typesByLine(g1), want1), JSON.stringify(typesByLine(g1)));
  check('header summary is null (lines differ)', g1?.howItemReceived === null, String(g1?.howItemReceived));
  const got1 = await http('GET', `/procurement/grns/${g1._id}`);
  check('GET (draft refreshed against the POs) keeps every line\'s type', same(typesByLine(got1.data.data), want1));

  console.log('\n── 2. Edit: reorder lines, change one, remove one ──');
  const items2 = [
    lineOf(B, 'RT-WASHER', { howItemReceived: 'FULL_MATERIAL_RECEIVED' }), lineOf(B, 'RT-BOLT', { howItemReceived: 'EXTRA_RECEIVED' }),
    lineOf(A, 'RT-NUT', { howItemReceived: 'FULL_MATERIAL_RECEIVED' }), lineOf(A, 'RT-BOLT', { howItemReceived: 'DAMAGED_RECEIVED' }),
  ];
  const upd2 = await http('PATCH', `/procurement/grns/${g1._id}`, { items: items2 });
  check('reordered + one changed → only that line changed', upd2.status === 200
    && same(typesByLine(upd2.data.data), { ...want1, 'PO-RT-A|RT-NUT': 'FULL_MATERIAL_RECEIVED' }), JSON.stringify(typesByLine(upd2.data.data)));
  const upd3 = await http('PATCH', `/procurement/grns/${g1._id}`, { items: items2.slice(1) });
  check('removing a line leaves the others\' types untouched', upd3.status === 200
    && same(typesByLine(upd3.data.data), { 'PO-RT-B|RT-BOLT': 'EXTRA_RECEIVED', 'PO-RT-A|RT-NUT': 'FULL_MATERIAL_RECEIVED', 'PO-RT-A|RT-BOLT': 'DAMAGED_RECEIVED' }),
    JSON.stringify(typesByLine(upd3.data.data)));
  const allSame = items1.map((l) => ({ ...l, howItemReceived: 'PARTIAL_RECEIVED' }));
  const upd4 = await http('PATCH', `/procurement/grns/${g1._id}`, { items: allSame });
  check('all lines one type → header summary = that type', upd4.status === 200 && upd4.data.data.howItemReceived === 'PARTIAL_RECEIVED');
  const upd5 = await http('PATCH', `/procurement/grns/${g1._id}`, { items: items1 });
  check('back to mixed → header null again', upd5.status === 200 && upd5.data.data.howItemReceived === null && same(typesByLine(upd5.data.data), want1));
  const upd6 = await http('PATCH', `/procurement/grns/${g1._id}`, { remarks: 'header-only edit' });
  check('an edit without items keeps every line\'s type', upd6.status === 200 && same(typesByLine(upd6.data.data), want1));

  console.log('\n── 3. Validation ──');
  const bad = await http('PATCH', `/procurement/grns/${g1._id}`, { items: [lineOf(A, 'RT-BOLT', { howItemReceived: 'LOST' })] });
  check('unknown line type → 422 (validation) with a readable message', bad.status === 422 && /Material Receipt Type must be one of/.test(bad.data?.message || ''), `${bad.status} ${bad.data?.message}`);
  const afterBad = await http('GET', `/procurement/grns/${g1._id}`);
  check('…and nothing was saved', same(typesByLine(afterBad.data.data), want1));

  console.log('\n── 4. Preview PDF ──');
  const prev = await http('POST', '/procurement/grns/preview-pdf', { poIds: [String(A._id), String(B._id)], items: items1 });
  const text = Buffer.isBuffer(prev.data) ? pdfText(prev.data) : [];
  const types = text.filter((t) => / RECEIVED$/.test(t) && !/^Invoice/.test(t));
  check('preview → PDF', prev.status === 200 && Buffer.isBuffer(prev.data));
  check('PDF rows carry each line\'s own type, in order', same(types, ['DAMAGED RECEIVED', 'PARTIAL RECEIVED', 'EXTRA RECEIVED', 'FULL MATERIAL RECEIVED']), JSON.stringify(types));
  check('PDF summary says "Per item"', text.some((t) => /Material Receipt Type: Per item/.test(t)));

  console.log('\n── 5. Older client: header value only ──');
  const C = po['PO-RT-C'];
  const old = await http('POST', '/procurement/grns', {
    poIds: [String(C._id)], howItemReceived: 'DAMAGED_RECEIVED',
    items: [lineOf(C, 'RT-BOLT'), lineOf(C, 'RT-NUT')],
  });
  check('header-only create → every line gets the header value', old.status === 201
    && Object.values(typesByLine(old.data.data)).every((t) => t === 'DAMAGED_RECEIVED') && old.data.data.howItemReceived === 'DAMAGED_RECEIVED');

  console.log('\n── 6. Legacy GRNs (header value, no line field) ──');
  const legApi = await GoodsReceiptNote.findOne({ grnNumber: 'GRN-RT-LEG-API' }).lean();
  check('seeded legacy line has NO howItemReceived', !('howItemReceived' in legApi.items[0]));
  const legGet = await http('GET', `/procurement/grns/${legApi._id}`);
  check('legacy draft loads; header kept', legGet.status === 200 && legGet.data.data.howItemReceived === 'EXTRA_RECEIVED');
  const legUpd = await http('PATCH', `/procurement/grns/${legApi._id}`, { remarks: 'touched' });
  check('editing a legacy draft copies its header value onto the line (not discarded)', legUpd.status === 200
    && legUpd.data.data.items[0].howItemReceived === 'EXTRA_RECEIVED' && legUpd.data.data.howItemReceived === 'EXTRA_RECEIVED');
  const legCmp = await GoodsReceiptNote.findOne({ grnNumber: 'GRN-RT-LEG-CMP' }).lean();
  const cmp = await http('POST', `/procurement/grns/${legCmp._id}/complete`, {});
  const cmpDoc = await GoodsReceiptNote.findById(legCmp._id).lean();
  check('completing an untouched legacy draft → 200', cmp.status === 200, cmp.data?.message);
  check('…its lines carry the header value; header kept', cmpDoc.items.every((l) => l.howItemReceived === 'DAMAGED_RECEIVED') && cmpDoc.howItemReceived === 'DAMAGED_RECEIVED');
  const done = await GoodsReceiptNote.findOne({ grnNumber: 'GRN-RT-LEG-DONE' }).lean();
  const doneGet = await http('GET', `/procurement/grns/${done._id}`);
  check('completed legacy GRN reads unchanged', doneGet.status === 200 && doneGet.data.data.howItemReceived === 'PARTIAL_RECEIVED'
    && doneGet.data.data.items[0].howItemReceived == null);

  console.log('\n── 7. Complete the mixed multi-PO GRN → PO reconciliation, QC, stock ──');
  const fin = await http('POST', `/procurement/grns/${g1._id}/complete`, {});
  check('complete → 200', fin.status === 200, fin.data?.message);
  const g = await GoodsReceiptNote.findById(g1._id).lean();
  check('completed lines keep their own types', same(typesByLine(g), want1), JSON.stringify(typesByLine(g)));
  check('completed header null (mixed)', g.howItemReceived === null);
  check('status FULLY_RECEIVED, QC pending, lines awaiting QC', g.grnStatus === 'FULLY_RECEIVED' && g.qcStatus === 'PENDING'
    && g.items.every((l) => l.stockStatus === 'AWAITING_QC'), `${g.grnStatus}/${g.qcStatus}`);
  const [pa, pb] = await Promise.all([VendorPurchaseOrder.findById(A._id).lean(), VendorPurchaseOrder.findById(B._id).lean()]);
  check('PO A + PO B received qty reconciled per line', [...pa.items, ...pb.items].every((i) => i.receivedQty === i.quantity && i.pendingQty === 0)
    && pa.poStatus === 'FULLY_RECEIVED' && pb.poStatus === 'FULLY_RECEIVED');
  check('no stock at GRN completion', (await InventoryMovement.countDocuments({ refType: 'GRN', refId: g._id })) === 0);

  const user = await User.findOne({ email: E2E_USER.email }).lean();
  const { incomingQcService } = await import('../modules/procurement/incoming-qc/incomingQc.service.js');
  await GoodsReceiptNote.updateOne({ _id: g._id }, { $set: { approvalStatus: 'MD_APPROVED' } }); // MD signature stand-in
  for (const poId of g.poIds.map(String)) {
    const qc = await incomingQcService.create({ grnId: String(g._id), poId }, user);
    await incomingQcService.complete(String(qc._id), {}, user);
  }
  const posted = await GoodsReceiptNote.findById(g._id).lean();
  const moves = await InventoryMovement.find({ refType: 'GRN', refId: g._id, txnType: 'GRN_IN' }).lean();
  const qtyBy = (code) => moves.filter((m) => m.skuCode === code).reduce((t, m) => t + m.quantity, 0);
  check('Incoming QC posts the accepted qty (bolt 10+8, nut 5, washer 4)', qtyBy('RT-BOLT') === 18 && qtyBy('RT-NUT') === 5 && qtyBy('RT-WASHER') === 4,
    `bolt ${qtyBy('RT-BOLT')} nut ${qtyBy('RT-NUT')} washer ${qtyBy('RT-WASHER')}`);
  check('lines POSTED and still carry their own types after QC', posted.items.every((l) => l.stockStatus === 'POSTED') && same(typesByLine(posted), want1));
  await finish();
};

// ── After the browser spec ────────────────────────────────────────────────────
const verify = async () => {
  await connect();
  const ui = await GoodsReceiptNote.findOne({ poNumbers: { $all: ['PO-RT-UI-A', 'PO-RT-UI-B'] }, isDeleted: { $ne: true } }).lean();
  check('browser GRN over both UI POs exists', !!ui);
  if (ui) {
    check('…saved per-SKU types (same SKU on two POs kept apart)', same(typesByLine(ui), {
      'PO-RT-UI-B|RT-BOLT': 'EXTRA_RECEIVED', 'PO-RT-UI-B|RT-WASHER': 'FULL_MATERIAL_RECEIVED',
      'PO-RT-UI-A|RT-BOLT': 'DAMAGED_RECEIVED', 'PO-RT-UI-A|RT-NUT': 'PARTIAL_RECEIVED',
    }), JSON.stringify(typesByLine(ui)));
    check('…finalized in the browser; header null (mixed)', ['FULLY_RECEIVED', 'PARTIAL_RECEIVED'].includes(ui.grnStatus) && ui.howItemReceived === null, `${ui.grnStatus} ${ui.howItemReceived}`);
    const pos = await VendorPurchaseOrder.find({ poNumber: { $in: ['PO-RT-UI-A', 'PO-RT-UI-B'] } }).lean();
    check('…both POs reconciled', pos.every((p) => p.items.every((i) => i.receivedQty === i.quantity)));
  }
  const leg = await GoodsReceiptNote.findOne({ grnNumber: 'GRN-RT-LEG-UI' }).lean();
  check('legacy draft edited in the browser: nut kept DAMAGED (from header), washer changed to PARTIAL',
    same(typesByLine(leg), { 'PO-RT-LEG-UI|RT-NUT': 'DAMAGED_RECEIVED', 'PO-RT-LEG-UI|RT-WASHER': 'PARTIAL_RECEIVED' }), JSON.stringify(typesByLine(leg)));
  check('…header re-derived (null, mixed)', leg.howItemReceived === null);
  await finish();
};

if (isEntry(import.meta.url)) {
  const arg = process.argv[2];
  const run = { '--seed': seed, '--api': api, '--verify': verify }[arg];
  if (!run) { console.error('Usage: e2eGrnReceiptTypeFixture.js --seed | --api | --verify'); process.exit(2); }
  run().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => {}); process.exit(1); });
}
