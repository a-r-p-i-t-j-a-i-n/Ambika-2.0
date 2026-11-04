/**
 * Fixture + API oracle for Purchase FMS → Advance Payments → "+ Record Advance Payment".
 *
 *   node src/scripts/e2eAdvanceRecordFixture.js --seed    drop + seed ambika_e2e_advrecord
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5094 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_advrecord node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5094/api/v1 node src/scripts/e2eAdvanceRecordFixture.js --api
 *
 * --seed builds, through the REAL PI service (create / approve → MD approval raised):
 *   A  approved PO, approved PI, MD approved       → selectable (partial then full payment)
 *   B  approved PO, approved PI, MD approved       → selectable (concurrent payments)
 *   H  approved PO, approved PI, still with the MD → selectable, but payment refused (MD gate)
 *   C  PO approved then CANCELLED, PI still READY  → never selectable, payment refused
 *   D  PO back to DRAFT, PI READY                  → never selectable, payment refused
 *   E  PO REJECTED, PI READY                       → never selectable, payment refused
 *   F  approved PO, PI received but NOT approved   → never selectable, payment refused
 *   G  approved PO, PI not required (no PI)        → never selectable
 *   Z  approved PO, PI fully paid                  → never selectable
 *
 * --api (HTTP) checks: selector membership + fields, queue = selector, partial →
 * Part Payment, overpay / zero refused, ineligible POs refused with nothing posted,
 * simultaneous submits never overpay, full payment completes + leaves both lists,
 * history, reconciliation, read-only selector, auth. Section P writes — re-seed
 * before re-running.
 *
 * SAFETY: shared e2e guard (localhost, DB name has "e2e", S3 + email off). --api never drops the DB.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import ProformaInvoice from '../modules/procurement/proforma-invoice/proformaInvoice.model.js';
import AdvancePayment from '../modules/procurement/advance-payment/advancePayment.model.js';

export const DB_NAME = 'ambika_e2e_advrecord';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eAdvanceRecordFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5094/api/v1').replace(/\/+$/, '');
export const MD = { email: 'advrec-md-e2e@test.local', password: 'E2e@12345' };
export const FINANCE = { email: 'advrec-fin-e2e@test.local', password: 'E2e@12345' };

let passes = 0; let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${detail}` : ''}`);
};
let refSeq = 0; // each payment needs its own reference (the same one twice on a PI is refused)
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

const piDoc = { fileName: 'vendor-pi.pdf', fileUrl: 'http://127.0.0.1:5094/uploads/e2e/vendor-pi.pdf', fileType: 'application/pdf' };

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  const { proformaInvoiceService } = await import('../modules/procurement/proforma-invoice/proformaInvoice.service.js');

  await User.create({ ...MD, name: 'AdvRec MD', role: 'MD', roles: ['MD'], mobile: '9000000091', isActive: true });
  const fin = await User.create({ ...FINANCE, name: 'AdvRec Finance', role: 'Accountant', roles: ['FINANCE'], mobile: '9000000092', isActive: true });
  const sku = await SKU.create({ code: 'E2E-REC-ITEM', name: 'E2E Record Item', unit: 'PCS', itemType: 'CONSUMABLE', category: 'Misc' });

  const mkPo = (tag, vendorName, qty, rate, extra = {}) => VendorPurchaseOrder.create({
    poNumber: `PO-REC-${tag}`, vendorId: new mongoose.Types.ObjectId(), vendorName, indentNumber: `Ind-REC-${tag}`,
    indentId: new mongoose.Types.ObjectId(), poStatus: 'RELEASED_TO_VENDOR', approvalStatus: 'APPROVED',
    items: [{ skuId: sku._id, skuCode: sku.code, itemName: sku.name, unit: sku.unit, quantity: qty, receivedQty: 0, pendingQty: qty, rate, gstRate: 18 }],
    grandTotal: Math.round(qty * rate * 1.18 * 100) / 100,
    ...extra,
  });
  const mkPi = async (tag, vendor, qty, rate, { approve = true, mdApproved = true } = {}) => {
    const po = await mkPo(tag, vendor, qty, rate);
    const pi = await proformaInvoiceService.create({ poId: String(po._id), piDocument: piDoc }, fin);
    if (approve) await proformaInvoiceService.approve(String(pi._id), { remarks: 'E2E' }, fin);
    if (approve && mdApproved) await ProformaInvoice.updateOne({ _id: pi._id }, { $set: { mdApprovalStatus: 'MD_APPROVED' } });
    return { po, pi };
  };

  await mkPi('A', 'E2E Alpha Traders', 10, 100);                       // total 1180
  await mkPi('B', 'E2E Beta Metals', 20, 50);                          // total 1180
  await mkPi('H', 'E2E Hotel Steel', 5, 100, { mdApproved: false });   // stays READY_FOR_MD_APPROVAL
  const C = await mkPi('C', 'E2E Gamma Supplies', 5, 100);
  await VendorPurchaseOrder.updateOne({ _id: C.po._id }, { $set: { poStatus: 'CANCELLED' } });
  const D = await mkPi('D', 'E2E Delta Works', 5, 100);
  await VendorPurchaseOrder.updateOne({ _id: D.po._id }, { $set: { approvalStatus: 'DRAFT', poStatus: 'DRAFT' } });
  const E = await mkPi('E', 'E2E Epsilon Co', 5, 100);
  await VendorPurchaseOrder.updateOne({ _id: E.po._id }, { $set: { approvalStatus: 'REJECTED' } });
  await mkPi('F', 'E2E Foxtrot Ltd', 5, 100, { approve: false });
  await mkPo('G', 'E2E Golf Co', 2, 100, { piStatus: 'PI_NOT_REQUIRED' });
  const Z = await mkPi('Z', 'E2E Zeta Steel', 4, 100);
  await ProformaInvoice.updateOne({ _id: Z.pi._id }, { $set: { piStatus: 'PAYMENT_COMPLETED', paidAmount: Z.pi.totalValue, balanceAmount: 0 } });

  const pis = await ProformaInvoice.find().sort('createdAt').lean();
  console.log(`[seed] ${DB_NAME}: MD ${MD.email} / ${MD.password}; FINANCE ${FINANCE.email}`);
  for (const p of pis) console.log(`  ${p.piNumber} ${p.poNumber} ${p.vendorName} total=${p.totalValue} paid=${p.paidAmount} ${p.piStatus} md=${p.mdApprovalStatus}`);
  await mongoose.disconnect();
};

// ── HTTP ───────────────────────────────────────────────────────────────────
const call = async (method, path, body, token) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, data: json?.data, meta: json?.meta, message: json?.message || '' };
};
const login = async (u) => (await call('POST', '/auth/login', u)).data?.token;

const api = async () => {
  await connect();
  const tok = await login(MD);
  if (!tok) throw new Error('login failed — seed first and start the backend on the scratch DB');
  const piBy = (tag) => ProformaInvoice.findOne({ poNumber: `PO-REC-${tag}` }).lean();
  const eligible = async (qs = '') => (await call('GET', `/procurement/advance-payments/eligible-pos${qs}`, undefined, tok));
  const queue = async () => (await call('GET', '/procurement/step-queues/ADVANCE_PAYMENT?limit=100', undefined, tok));
  const pay = (pi, body, t = tok) => call('POST', '/procurement/advance-payments', {
    piId: String(pi._id), paymentDate: new Date().toISOString().slice(0, 10), paymentMode: 'NEFT', paymentReferenceNumber: `UTR-REC-${++refSeq}`, ...body,
  }, t);
  const A = await piBy('A'); const B = await piBy('B'); const H = await piBy('H');
  const Cc = await piBy('C'); const D = await piBy('D'); const E = await piBy('E'); const F = await piBy('F'); const Z = await piBy('Z');
  const posOf = (rows) => (rows || []).map((r) => r.poNumber).sort();

  console.log('\nS  Selector (GET /advance-payments/eligible-pos)');
  const before = await Promise.all([ProformaInvoice.countDocuments(), AdvancePayment.countDocuments()]);
  const s1 = await eligible();
  check('lists exactly the approved POs with a payable PI: A, B, H', s1.status === 200 && JSON.stringify(posOf(s1.data)) === JSON.stringify(['PO-REC-A', 'PO-REC-B', 'PO-REC-H']), `${s1.status} ${posOf(s1.data)}`);
  check('never lists cancelled / draft / rejected PO, unapproved PI, no-PI PO or paid-up PI (C D E F G Z)', !posOf(s1.data).some((n) => /-(C|D|E|F|G|Z)$/.test(n)));
  const rowA = (s1.data || []).find((r) => r.poNumber === 'PO-REC-A');
  check('row carries vendor, indent, PO date / total / approval, payment status',
    rowA?.vendorName === 'E2E Alpha Traders' && rowA.indentNumber === 'Ind-REC-A' && rowA.poDate && rowA.poTotal === 1180 && rowA.poApprovalStatus === 'APPROVED' && rowA.paymentStatus === 'PENDING', JSON.stringify(rowA));
  check('row carries the PI the form pays: number, total = advance required, paid, balance, MD status',
    rowA?.pi?.piNumber === A.piNumber && rowA.pi.totalValue === 1180 && rowA.pi.paidAmount === 0 && rowA.pi.balanceAmount === 1180 && rowA.pi.mdApprovalStatus === 'MD_APPROVED', JSON.stringify(rowA?.pi));
  check('no payment history yet', Array.isArray(rowA?.payments) && rowA.payments.length === 0);
  const s2 = await eligible('?search=beta');
  check('search matches vendor name (case-insensitive)', JSON.stringify(posOf(s2.data)) === JSON.stringify(['PO-REC-B']), String(posOf(s2.data)));
  const s3 = await eligible('?search=' + encodeURIComponent('Ind-REC-H'));
  check('search matches indent number', JSON.stringify(posOf(s3.data)) === JSON.stringify(['PO-REC-H']), String(posOf(s3.data)));
  const s4 = await eligible('?search=' + encodeURIComponent('.*'));
  check('search is literal text, not a regex', s4.status === 200 && (s4.data || []).length === 0, `${s4.status} ${posOf(s4.data)}`);
  check('invalid limit → 422', (await eligible('?limit=0')).status === 422);
  const unauth = await call('GET', '/procurement/advance-payments/eligible-pos');
  check('selector needs login → 401', unauth.status === 401, String(unauth.status));
  const q1 = await queue();
  check('Awaiting Advance queue = the same PIs as the selector (shared rule)',
    JSON.stringify((q1.data?.rows || []).map((r) => r.number).sort()) === JSON.stringify([A.piNumber, B.piNumber, H.piNumber].sort()), JSON.stringify((q1.data?.rows || []).map((r) => r.number)));
  const after = await Promise.all([ProformaInvoice.countDocuments(), AdvancePayment.countDocuments()]);
  check('reading the selector / queue wrote nothing', JSON.stringify(before) === JSON.stringify(after));

  console.log('\nV  Validation — nothing posted on refusal');
  const snap = async (pi) => { const p = await ProformaInvoice.findById(pi._id).lean(); return `${p.paidAmount}/${p.balanceAmount}/${p.piStatus}`; };
  const cnt0 = await AdvancePayment.countDocuments();
  for (const [tag, pi] of [['C cancelled PO', Cc], ['D draft PO', D], ['E rejected PO', E], ['F unapproved PI', F], ['Z paid-up PI', Z]]) {
    const s0 = await snap(pi);
    const r = await pay(pi, { paymentStatus: 'PART_PAYMENT', paidAmount: 100 });
    check(`payment against ${tag} refused (${r.status}) and nothing posted`, r.status === 400 && (await snap(pi)) === s0, `${r.status} ${r.message}`);
    if (tag.startsWith('C')) check('  …the reason names the cancelled PO', /cancelled/i.test(r.message), r.message);
  }
  const h = await pay(H, { paymentStatus: 'PART_PAYMENT', paidAmount: 100 });
  check('payment against a PI still with the MD refused (MD gate kept)', h.status === 400 && /MD/.test(h.message), `${h.status} ${h.message}`);
  check('amount 0 → 422', (await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: 0 })).status === 422);
  check('negative amount → 422', (await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: -5 })).status === 422);
  const over = await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: 1180.01 });
  check('amount above the remaining advance → 400', over.status === 400 && /exceeds/.test(over.message), `${over.status} ${over.message}`);
  check('refusals recorded no payment', (await AdvancePayment.countDocuments()) === cnt0);

  console.log('\nP  Partial → history → full (writes)');
  const p1 = await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: 400, remarks: 'first' });
  check('partial advance 400 recorded (201)', p1.status === 201 && p1.data?.paidAmount === 400 && p1.data.balanceAmount === 780 && p1.data.paymentStatus === 'PART_PAYMENT', `${p1.status} ${p1.message}`);
  const aAfter = await ProformaInvoice.findById(A._id).lean();
  check('PI paid 400 / balance 780, still READY_FOR_ADVANCE_PAYMENT', aAfter.paidAmount === 400 && aAfter.balanceAmount === 780 && aAfter.piStatus === 'READY_FOR_ADVANCE_PAYMENT');
  const s5 = await eligible();
  const rowA2 = (s5.data || []).find((r) => r.poNumber === 'PO-REC-A');
  check('selector still lists A: paid 400, remaining 780, Part Payment, one history entry',
    rowA2?.pi.paidAmount === 400 && rowA2.pi.balanceAmount === 780 && rowA2.paymentStatus === 'PART_PAYMENT' && rowA2.payments.length === 1 && rowA2.payments[0].paidAmount === 400, JSON.stringify(rowA2));
  const q2 = await queue();
  const qA = (q2.data?.rows || []).find((r) => r.number === A.piNumber);
  check('Awaiting Advance row for A updated: paid 400, remaining 780, PART_PAYMENT', qA?.paidAmount === 400 && qA.remainingAmount === 780 && qA.paymentStatus === 'PART_PAYMENT', JSON.stringify(qA));
  const full1 = await pay(A, { paymentStatus: 'FULL_PAYMENT', paidAmount: 700 });
  check('full payment that does not clear the balance → 400', full1.status === 400, `${full1.status} ${full1.message}`);
  const p2 = await pay(A, { paymentStatus: 'FULL_PAYMENT', paidAmount: 780 });
  check('full payment 780 recorded', p2.status === 201 && p2.data?.balanceAmount === 0, `${p2.status} ${p2.message}`);
  const aDone = await ProformaInvoice.findById(A._id).lean();
  check('PI PAYMENT_COMPLETED, paid 1180, balance 0', aDone.piStatus === 'PAYMENT_COMPLETED' && aDone.paidAmount === 1180 && aDone.balanceAmount === 0);
  const poA = await VendorPurchaseOrder.findOne({ poNumber: 'PO-REC-A' }).lean();
  check('PO piStatus mirrors PAYMENT_COMPLETED', poA.piStatus === 'PAYMENT_COMPLETED', poA.piStatus);
  check('a further payment on the settled PI refused', (await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: 1 })).status === 400);
  const s6 = await eligible();
  check('A left the selector and the queue', !posOf(s6.data).includes('PO-REC-A') && !((await queue()).data?.rows || []).some((r) => r.number === A.piNumber));
  const list = await call('GET', `/procurement/advance-payments?piId=${A._id}&limit=50`, undefined, tok);
  check('both payments are in the payment list (history kept)', list.status === 200 && (list.data || []).length === 2, `${list.status} ${(list.data || []).length}`);

  console.log('\nC  Concurrency');
  const N = 6;
  const res = await Promise.all(Array.from({ length: N }, () => pay(B, { paymentStatus: 'PART_PAYMENT', paidAmount: 1000 })));
  const ok = res.filter((r) => r.status === 201).length;
  const bAfter = await ProformaInvoice.findById(B._id).lean();
  check(`${N} simultaneous 1000 payments on a 1180 advance: exactly one succeeds`, ok === 1, `successes=${ok} statuses=${res.map((r) => r.status)}`);
  check('the others are refused cleanly (400 / 409), never 500', res.filter((r) => r.status !== 201).every((r) => [400, 409].includes(r.status)), String(res.map((r) => r.status)));
  check('PI paid 1000 / balance 180 — never above the advance', bAfter.paidAmount === 1000 && bAfter.balanceAmount === 180 && bAfter.paidAmount <= bAfter.totalValue, `${bAfter.paidAmount}/${bAfter.balanceAmount}`);
  const res2 = await Promise.all(Array.from({ length: N }, () => pay(B, { paymentStatus: 'FULL_PAYMENT', paidAmount: 180 })));
  const bDone = await ProformaInvoice.findById(B._id).lean();
  check('simultaneous full payments of the exact balance: exactly one succeeds, PI completed',
    res2.filter((r) => r.status === 201).length === 1 && bDone.balanceAmount === 0 && bDone.paidAmount === 1180, `statuses=${res2.map((r) => r.status)} paid=${bDone.paidAmount}`);

  console.log('\nR  Reconciliation');
  for (const p of await ProformaInvoice.find({ isDeleted: { $ne: true } }).lean()) {
    const paid = (await AdvancePayment.find({ piId: p._id, paymentStatus: { $ne: 'CANCELLED' } }).lean()).reduce((s, x) => s + x.paidAmount, 0);
    const seededPaid = String(p._id) === String(Z._id);
    check(`${p.piNumber}: paid = payment history, balance = total − paid, never above total`,
      (seededPaid || r2(p.paidAmount) === r2(paid)) && r2(p.balanceAmount) === r2(p.totalValue - p.paidAmount) && p.paidAmount <= p.totalValue,
      `paid=${p.paidAmount} history=${paid}`);
  }

  console.log(`\n${failures ? 'FAILED' : 'OK'} — ${passes} passed, ${failures} failed`);
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
};

const MODE = (process.argv.find((a) => a.startsWith('--')) || '').slice(2);
if (isEntry(import.meta.url)) {
  (MODE === 'seed' ? seed() : MODE === 'api' ? api() : Promise.reject(new Error('use --seed or --api')))
    .catch((e) => { console.error(e); process.exit(1); });
}
