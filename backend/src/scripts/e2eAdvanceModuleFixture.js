/**
 * Fixture + API oracle for the complete Purchase FMS Advance Payments module
 * (candidates picker, multi-payment history, detail, PDF, table totals, KPIs).
 *
 *   node src/scripts/e2eAdvanceModuleFixture.js --seed    drop + seed ambika_e2e_advmodule
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5093 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_advmodule node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5093/api/v1 node src/scripts/e2eAdvanceModuleFixture.js --api
 *
 * --seed builds, through the REAL PI service, one PO per business situation:
 *   A  approved PO + approved/MD-approved PI, total 35,400   → payable (3 partial payments then full)
 *   B  approved PO + approved/MD-approved PI, total 1,180    → payable (concurrent payments)
 *   H  approved PO + approved PI still with the MD           → AWAITING_MD (selectable, payment refused)
 *   N  released PO, no PI                                    → NO_PI
 *   I  PO approved but not released, no PI                   → PO_NOT_RELEASED
 *   P  released PO, PI received but not approved             → PI_PENDING
 *   R  released PO, PI rejected                              → PI_REJECTED
 *   G  PO with PI marked not required                        → PI_NOT_REQUIRED
 *   Z  PI fully paid (2 payments)                            → FULLY_PAID
 *   S  PI closed short (1 payment)                           → SHORT_CLOSED
 *   C  PO CANCELLED with a READY PI, K PO CLOSED with a READY PI → never listed, never payable
 *
 * Section P (payments) writes — re-seed before re-running. SAFETY: shared e2e guard.
 */
import zlib from 'node:zlib';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import ProformaInvoice from '../modules/procurement/proforma-invoice/proformaInvoice.model.js';
import AdvancePayment from '../modules/procurement/advance-payment/advancePayment.model.js';

export const DB_NAME = 'ambika_e2e_advmodule';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eAdvanceModuleFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5093/api/v1').replace(/\/+$/, '');
export const MD = { email: 'advmod-md-e2e@test.local', password: 'E2e@12345' };
export const FINANCE = { email: 'advmod-fin-e2e@test.local', password: 'E2e@12345' };

let passes = 0; let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${detail}` : ''}`);
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

const piDoc = { fileName: 'vendor-pi.pdf', fileUrl: 'http://127.0.0.1:5093/uploads/e2e/vendor-pi.pdf', fileType: 'application/pdf' };

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  const { proformaInvoiceService } = await import('../modules/procurement/proforma-invoice/proformaInvoice.service.js');

  await User.create({ ...MD, name: 'AdvMod MD', role: 'MD', roles: ['MD'], mobile: '9000000081', isActive: true });
  const fin = await User.create({ ...FINANCE, name: 'AdvMod Finance', role: 'Accountant', roles: ['FINANCE'], mobile: '9000000082', isActive: true });
  const sku = await SKU.create({ code: 'E2E-MOD-ITEM', name: 'E2E Module Item', unit: 'PCS', itemType: 'CONSUMABLE', category: 'Misc' });

  const mkPo = (tag, vendorName, qty, rate, extra = {}) => VendorPurchaseOrder.create({
    poNumber: `PO-MOD-${tag}`, vendorId: new mongoose.Types.ObjectId(), vendorName, indentNumber: `Ind-MOD-${tag}`,
    indentId: new mongoose.Types.ObjectId(), poStatus: 'RELEASED_TO_VENDOR', approvalStatus: 'APPROVED',
    vendorGST: '27AAAAA0000A1Z5', vendorAddress: `${vendorName} Road, Pune`, vendorPhone: '9800000000',
    items: [{ skuId: sku._id, skuCode: sku.code, itemName: sku.name, unit: sku.unit, quantity: qty, receivedQty: 0, pendingQty: qty, rate, gstRate: 18 }],
    grandTotal: Math.round(qty * rate * 1.18 * 100) / 100,
    ...extra,
  });
  const mkPi = async (tag, vendor, qty, rate, { approve = true, mdApproved = true, poExtra = {} } = {}) => {
    const po = await mkPo(tag, vendor, qty, rate, poExtra);
    const pi = await proformaInvoiceService.create({ poId: String(po._id), piDocument: piDoc }, fin);
    if (approve) await proformaInvoiceService.approve(String(pi._id), { remarks: 'E2E' }, fin);
    if (approve && mdApproved) await ProformaInvoice.updateOne({ _id: pi._id }, { $set: { mdApprovalStatus: 'MD_APPROVED' } });
    return { po, pi: await ProformaInvoice.findById(pi._id) };
  };

  await mkPi('A', 'E2E Alpha Traders', 100, 300);                       // 35,400
  await mkPi('B', 'E2E Beta Metals', 20, 50);                           // 1,180
  await mkPi('H', 'E2E Hotel Steel', 5, 100, { mdApproved: false });    // READY_FOR_MD_APPROVAL
  await mkPo('N', 'E2E November Foods', 3, 100);
  await mkPo('I', 'E2E India Tools', 3, 100, { poStatus: 'APPROVED', releaseStatus: 'NOT_RELEASED' });
  await mkPi('P', 'E2E Papa Plastics', 5, 100, { approve: false });
  const R = await mkPi('R', 'E2E Romeo Rubber', 5, 100, { approve: false });
  await proformaInvoiceService.reject(String(R.pi._id), { remarks: 'wrong rates' }, fin);
  await mkPo('G', 'E2E Golf Co', 2, 100, { piStatus: 'PI_NOT_REQUIRED' });
  const C = await mkPi('C', 'E2E Charlie Supplies', 5, 100);
  await VendorPurchaseOrder.updateOne({ _id: C.po._id }, { $set: { poStatus: 'CANCELLED' } });
  const K = await mkPi('K', 'E2E Kilo Closers', 5, 100);
  await VendorPurchaseOrder.updateOne({ _id: K.po._id }, { $set: { poStatus: 'CLOSED' } });

  // Z fully paid with two payments, S closed short with one — written like the service would.
  const mkPayment = (pi, n, amount, balance, status, extra = {}) => AdvancePayment.create({
    paymentNumber: `ADV-SEED-${pi.poNumber.slice(-1)}${n}`, piId: pi._id, piNumber: pi.piNumber, poId: pi.poId, poNumber: pi.poNumber,
    indentNumber: pi.indentNumber, vendorId: pi.vendorId, vendorName: pi.vendorName, paymentStatus: status,
    paymentDate: new Date(), paidAmount: amount, paymentMode: 'NEFT', paymentReferenceNumber: `SEED-${pi.poNumber.slice(-1)}${n}`,
    previousBalance: balance + amount, balanceAmount: balance, performedByName: 'AdvMod Finance', createdBy: fin._id, ...extra,
  });
  const Z = await mkPi('Z', 'E2E Zeta Steel', 4, 100);                  // 472
  await mkPayment(Z.pi, 1, 200, 272, 'PART_PAYMENT');
  await mkPayment(Z.pi, 2, 272, 0, 'FULL_PAYMENT');
  await ProformaInvoice.updateOne({ _id: Z.pi._id }, { $set: { piStatus: 'PAYMENT_COMPLETED', paidAmount: 472, balanceAmount: 0 } });
  const S = await mkPi('S', 'E2E Sierra Short', 10, 100);               // 1,180
  await mkPayment(S.pi, 1, 700, 480, 'SHORT_PAYMENT_COMPLETED', { remarks: 'Vendor closed short' });
  await ProformaInvoice.updateOne({ _id: S.pi._id }, { $set: { piStatus: 'PAYMENT_COMPLETED', paidAmount: 700, balanceAmount: 480 } });

  console.log(`[seed] ${DB_NAME}: MD ${MD.email} / ${MD.password}; FINANCE ${FINANCE.email}`);
  for (const p of await ProformaInvoice.find().sort('createdAt').lean()) {
    console.log(`  ${p.piNumber} ${p.poNumber} ${p.vendorName} total=${p.totalValue} paid=${p.paidAmount} ${p.piStatus} md=${p.mdApprovalStatus}`);
  }
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

/** Text drawn on a PDFKit page: inflate the content streams and decode the hex strings. */
export const pdfText = (buf) => {
  const raw = buf.toString('latin1');
  let out = '';
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(raw))) {
    let body;
    try { body = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { body = m[1]; }
    for (const h of body.matchAll(/<([0-9a-fA-F\s]+)>/g)) out += Buffer.from(h[1].replace(/\s/g, ''), 'hex').toString('latin1');
    for (const s of body.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out += s[1];
    out += '\n';
  }
  return out;
};

const api = async () => {
  await connect();
  const tok = await login(MD);
  if (!tok) throw new Error('login failed — seed first and start the backend on the scratch DB');
  const piBy = (tag) => ProformaInvoice.findOne({ poNumber: `PO-MOD-${tag}` }).lean();
  const cands = (qs = '') => call('GET', `/procurement/advance-payments/candidates${qs}`, undefined, tok);
  const pay = (pi, body, t = tok) => call('POST', '/procurement/advance-payments', {
    piId: String(pi._id), paymentDate: new Date().toISOString().slice(0, 10), paymentMode: 'NEFT', ...body,
  }, t);
  const [A, B, H, Cc, K, Pp, Rr, Z, S] = await Promise.all(['A', 'B', 'H', 'C', 'K', 'P', 'R', 'Z', 'S'].map(piBy));
  const codeOf = (rows, tag) => (rows || []).find((r) => r.poNumber === `PO-MOD-${tag}`)?.state?.code;
  const poNums = (rows) => (rows || []).map((r) => r.poNumber).sort();

  console.log('\nS  Candidates (GET /advance-payments/candidates)');
  const before = await Promise.all([ProformaInvoice.countDocuments(), AdvancePayment.countDocuments()]);
  const c1 = await cands();
  check('200 and every approved, live PO is listed (A B H N I P R G Z S)',
    c1.status === 200 && JSON.stringify(poNums(c1.data)) === JSON.stringify(['A', 'B', 'G', 'H', 'I', 'N', 'P', 'R', 'S', 'Z'].map((t) => `PO-MOD-${t}`)), `${c1.status} ${poNums(c1.data)}`);
  check('cancelled PO (C) and closed PO (K) are never listed', !poNums(c1.data).some((n) => /-(C|K)$/.test(n)));
  const expected = { A: 'PAYABLE', B: 'PAYABLE', H: 'AWAITING_MD', N: 'NO_PI', I: 'PO_NOT_RELEASED', P: 'PI_PENDING', R: 'PI_REJECTED', G: 'PI_NOT_REQUIRED', Z: 'FULLY_PAID', S: 'SHORT_CLOSED' };
  for (const [tag, code] of Object.entries(expected)) check(`PO ${tag} state = ${code}`, codeOf(c1.data, tag) === code, String(codeOf(c1.data, tag)));
  check('only A, B and H can be paid (payable=true); the rest carry a reason',
    (c1.data || []).every((r) => r.state.payable === ['A', 'B', 'H'].includes(r.poNumber.slice(-1)) && (r.state.payable || r.state.reason)));
  check('payable POs sort first', (c1.data || []).slice(0, 3).every((r) => r.state.payable));
  check('NO_PI / PI_PENDING rows tell the user the next step', ['N', 'P', 'I'].every((t) => (c1.data || []).find((r) => r.poNumber === `PO-MOD-${t}`)?.state.nextStep));
  const rowA = (c1.data || []).find((r) => r.poNumber === 'PO-MOD-A');
  check('row carries PO + vendor details (indent, date, total, approval, GST, address, phone)',
    rowA?.indentNumber === 'Ind-MOD-A' && rowA.poDate && rowA.poTotal === 35400 && rowA.poApprovalStatus === 'APPROVED'
    && rowA.vendor?.gst === '27AAAAA0000A1Z5' && /Pune/.test(rowA.vendor.address) && rowA.vendor.phone === '9800000000', JSON.stringify(rowA));
  check('row carries the PI: number, total = advance, paid 0, balance, approval, MD',
    rowA?.pi?.piNumber === A.piNumber && rowA.pi.totalValue === 35400 && rowA.pi.paidAmount === 0 && rowA.pi.balanceAmount === 35400
    && rowA.pi.approvalStatus === 'APPROVED' && rowA.pi.mdApprovalStatus === 'MD_APPROVED', JSON.stringify(rowA?.pi));
  check('PO without a PI has pi = null', (c1.data || []).find((r) => r.poNumber === 'PO-MOD-N')?.pi === null);
  const rowZ = (c1.data || []).find((r) => r.poNumber === 'PO-MOD-Z');
  check('fully paid PO row carries its 2 payments (history persists)', rowZ?.payments?.length === 2 && rowZ.payments[0].paidAmount === 200 && rowZ.payments[1].paidAmount === 272, JSON.stringify(rowZ?.payments));

  const sPo = await cands('?search=PO-MOD-A');
  check('search by PO number', JSON.stringify(poNums(sPo.data)) === JSON.stringify(['PO-MOD-A']), String(poNums(sPo.data)));
  const sVen = await cands('?search=beta');
  check('search by vendor name (case-insensitive)', JSON.stringify(poNums(sVen.data)) === JSON.stringify(['PO-MOD-B']), String(poNums(sVen.data)));
  const sInd = await cands('?search=' + encodeURIComponent('Ind-MOD-N'));
  check('search by indent number finds a PO that has no PI', JSON.stringify(poNums(sInd.data)) === JSON.stringify(['PO-MOD-N']), String(poNums(sInd.data)));
  const sPi = await cands('?search=' + encodeURIComponent(A.piNumber));
  check('search by PI number', JSON.stringify(poNums(sPi.data)) === JSON.stringify(['PO-MOD-A']), `${A.piNumber} → ${poNums(sPi.data)}`);
  const sLit = await cands('?search=' + encodeURIComponent('.*'));
  check('search is literal text, not a regex', sLit.status === 200 && (sLit.data || []).length === 0, `${sLit.status} ${poNums(sLit.data)}`);
  const sOnly = await cands('?onlyPayable=true');
  check('onlyPayable=true → A, B, H', JSON.stringify(poNums(sOnly.data)) === JSON.stringify(['PO-MOD-A', 'PO-MOD-B', 'PO-MOD-H']), String(poNums(sOnly.data)));
  const sByPi = await cands(`?piId=${B._id}`);
  check('piId narrows to that PI\'s PO (PI-detail Record Payment path)', JSON.stringify(poNums(sByPi.data)) === JSON.stringify(['PO-MOD-B']), String(poNums(sByPi.data)));
  const legacy = await call('GET', '/procurement/advance-payments/eligible-pos', undefined, tok);
  check('old /eligible-pos still works and lists only payable POs', legacy.status === 200 && JSON.stringify(poNums(legacy.data)) === JSON.stringify(['PO-MOD-A', 'PO-MOD-B', 'PO-MOD-H']), String(poNums(legacy.data)));
  check('invalid limit → 422', (await cands('?limit=0')).status === 422);
  check('needs login → 401', (await call('GET', '/procurement/advance-payments/candidates')).status === 401);
  const queue = await call('GET', '/procurement/step-queues/ADVANCE_PAYMENT?limit=100', undefined, tok);
  check('Awaiting Advance queue = the payable PIs (shared rule, unchanged)',
    JSON.stringify((queue.data?.rows || []).map((r) => r.number).sort()) === JSON.stringify([A.piNumber, B.piNumber, H.piNumber].sort()), JSON.stringify((queue.data?.rows || []).map((r) => r.number)));
  const after = await Promise.all([ProformaInvoice.countDocuments(), AdvancePayment.countDocuments()]);
  check('reading candidates wrote nothing', JSON.stringify(before) === JSON.stringify(after));

  console.log('\nV  Validation — nothing posted on refusal');
  const snap = async (pi) => { const p = await ProformaInvoice.findById(pi._id).lean(); return `${p.paidAmount}/${p.balanceAmount}/${p.piStatus}`; };
  const cnt0 = await AdvancePayment.countDocuments();
  for (const [tag, pi] of [['C cancelled PO', Cc], ['K closed PO', K], ['P unapproved PI', Pp], ['R rejected PI', Rr], ['Z fully paid PI', Z], ['S short-closed PI', S]]) {
    const s0 = await snap(pi);
    const r = await pay(pi, { paymentStatus: 'PART_PAYMENT', paidAmount: 100, paymentReferenceNumber: `V-${tag[0]}` });
    check(`payment against ${tag} refused (${r.status}) and nothing posted`, r.status === 400 && (await snap(pi)) === s0, `${r.status} ${r.message}`);
  }
  const h = await pay(H, { paymentStatus: 'PART_PAYMENT', paidAmount: 100, paymentReferenceNumber: 'V-H' });
  check('payment against a PI still with the MD refused (MD gate kept)', h.status === 400 && /MD/.test(h.message), `${h.status} ${h.message}`);
  check('amount 0 → 422', (await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: 0 })).status === 422);
  check('negative amount → 422', (await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: -5 })).status === 422);
  const over = await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: 35400.01, paymentReferenceNumber: 'V-over' });
  check('amount above the remaining advance → 400', over.status === 400 && /exceeds/.test(over.message), `${over.status} ${over.message}`);
  check('refusals recorded no payment', (await AdvancePayment.countDocuments()) === cnt0);

  console.log('\nP  Three partial payments → history → full (writes)');
  const proof = { fileName: 'utr-slip.pdf', fileUrl: 'http://127.0.0.1:5093/uploads/e2e/utr-slip.pdf', fileType: 'application/pdf' };
  const p1 = await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: 10000, paymentReferenceNumber: 'UTR-A1', bankReference: 'HDFC 0123', proofDocument: proof, remarks: 'first' });
  check('first payment 10,000 recorded', p1.status === 201 && p1.data?.paidAmount === 10000 && p1.data.previousBalance === 35400 && p1.data.balanceAmount === 25400, `${p1.status} ${p1.message}`);
  check('bank reference + proof saved on the payment', p1.data?.bankReference === 'HDFC 0123' && p1.data.proofDocument?.fileUrl === proof.fileUrl && p1.data.proofDocument.uploadedAt, JSON.stringify(p1.data?.proofDocument));
  const dup = await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: 100, paymentReferenceNumber: 'utr-a1' });
  check('the same UTR on the same PI is refused (409, case-insensitive) and posts nothing', dup.status === 409 && /already recorded/.test(dup.message) && (await piBy('A')).paidAmount === 10000, `${dup.status} ${dup.message}`);
  const p2 = await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: 15000, paymentReferenceNumber: 'UTR-A2' });
  const p3 = await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: 5000, paymentReferenceNumber: 'UTR-A3' });
  check('second 15,000 and third 5,000 recorded', p2.status === 201 && p3.status === 201 && p3.data.balanceAmount === 5400, `${p2.status} ${p3.status} ${p3.message}`);
  const aMid = await piBy('A');
  check('PI paid 30,000 / balance 5,400, still ready for payment', aMid.paidAmount === 30000 && aMid.balanceAmount === 5400 && aMid.piStatus === 'READY_FOR_ADVANCE_PAYMENT');
  const c2 = await cands('?search=PO-MOD-A');
  const rowA2 = (c2.data || [])[0];
  check('candidate row: PAYABLE, 3 payments in order, paid 30,000, remaining 5,400, PARTIALLY_PAID',
    rowA2?.state.code === 'PAYABLE' && rowA2.paymentStatus === 'PARTIALLY_PAID' && rowA2.payments.map((x) => x.paidAmount).join() === '10000,15000,5000' && rowA2.pi.paidAmount === 30000 && rowA2.pi.balanceAmount === 5400, JSON.stringify(rowA2?.payments));
  const full1 = await pay(A, { paymentStatus: 'FULL_PAYMENT', paidAmount: 5000, paymentReferenceNumber: 'UTR-A4' });
  check('full payment that does not clear the balance → 400', full1.status === 400, `${full1.status} ${full1.message}`);
  const p4 = await pay(A, { paymentStatus: 'FULL_PAYMENT', paidAmount: 5400, paymentReferenceNumber: 'UTR-A4' });
  check('full payment 5,400 recorded → balance 0', p4.status === 201 && p4.data?.balanceAmount === 0, `${p4.status} ${p4.message}`);
  const aDone = await piBy('A');
  check('PI PAYMENT_COMPLETED, paid 35,400', aDone.piStatus === 'PAYMENT_COMPLETED' && aDone.paidAmount === 35400 && aDone.balanceAmount === 0);
  check('a further payment on the settled PI refused', (await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: 1, paymentReferenceNumber: 'UTR-A9' })).status === 400);
  const c3 = await cands('?search=PO-MOD-A');
  check('A is now FULLY_PAID (not payable) and keeps all 4 payments', c3.data?.[0]?.state.code === 'FULLY_PAID' && c3.data[0].payments.length === 4 && c3.data[0].state.payable === false);

  console.log('\nC  Concurrency');
  const N = 6;
  const res = await Promise.all(Array.from({ length: N }, (_v, i) => pay(B, { paymentStatus: 'PART_PAYMENT', paidAmount: 800, paymentReferenceNumber: `UTR-B${i}` })));
  const bAfter = await piBy('B');
  check(`${N} simultaneous 800 payments on a 1,180 advance: exactly one succeeds`, res.filter((r) => r.status === 201).length === 1, `statuses=${res.map((r) => r.status)}`);
  check('the others are refused cleanly (400 / 409), never 500', res.filter((r) => r.status !== 201).every((r) => [400, 409].includes(r.status)), String(res.map((r) => r.status)));
  check('PI paid 800 / balance 380 — never above the advance', bAfter.paidAmount === 800 && bAfter.balanceAmount === 380, `${bAfter.paidAmount}/${bAfter.balanceAmount}`);
  const sameRef = await Promise.all(Array.from({ length: 4 }, () => pay(B, { paymentStatus: 'PART_PAYMENT', paidAmount: 10, paymentReferenceNumber: 'UTR-SAME' })));
  check('4 simultaneous submits of the SAME UTR record it once', sameRef.filter((r) => r.status === 201).length === 1 && (await AdvancePayment.countDocuments({ piId: B._id, paymentReferenceNumber: 'UTR-SAME' })) === 1, `statuses=${sameRef.map((r) => r.status)}`);

  const cash = [
    await pay(B, { paymentStatus: 'PART_PAYMENT', paidAmount: 1, paymentMode: 'CASH', paymentReferenceNumber: 'CASH-SLIP' }),
    await pay(B, { paymentStatus: 'PART_PAYMENT', paidAmount: 1, paymentMode: 'CASH', paymentReferenceNumber: 'CASH-SLIP' }),
  ];
  check('cash payments are exempt from the duplicate-reference rule (2 x 1 recorded)', cash.every((r) => r.status === 201), `statuses=${cash.map((r) => r.status)}`);

  console.log('\nD  Detail + PDF');
  const listA = await call('GET', `/procurement/advance-payments?piId=${A._id}&limit=50&sort=createdAt`, undefined, tok);
  const second = (listA.data || [])[1];
  const d = await call('GET', `/procurement/advance-payments/${second?._id}/detail`, undefined, tok);
  check('detail: payment, PI, PO, vendor figures', d.status === 200 && d.data.payment.paymentNumber === second.paymentNumber && d.data.pi.piNumber === A.piNumber && d.data.po.poNumber === 'PO-MOD-A' && d.data.pi.vendorGST, `${d.status} ${d.message}`);
  check('detail: previous = 1 payment before this one, history = all 4 with running totals 10k/25k/30k/35.4k',
    d.data?.previous?.length === 1 && d.data.history.map((x) => x.runningPaid).join() === '10000,25000,30000,35400', JSON.stringify(d.data?.history?.map((x) => x.runningPaid)));
  check('detail: summary = advance 35,400, paid 35,400, remaining 0, FULLY_PAID',
    d.data?.summary?.advanceRequired === 35400 && d.data.summary.totalPaid === 35400 && d.data.summary.remaining === 0 && d.data.summary.state === 'FULLY_PAID', JSON.stringify(d.data?.summary));
  check('detail: unknown id → 404', (await call('GET', `/procurement/advance-payments/${new mongoose.Types.ObjectId()}/detail`, undefined, tok)).status === 404);

  const pdfRes = await fetch(`${API}/procurement/advance-payments/${second._id}/pdf`, { headers: { Authorization: `Bearer ${tok}` } });
  const pdf = Buffer.from(await pdfRes.arrayBuffer());
  const text = pdfText(pdf);
  check('PDF: 200, application/pdf, inline, %PDF header', pdfRes.status === 200 && /application\/pdf/.test(pdfRes.headers.get('content-type')) && /^inline/.test(pdfRes.headers.get('content-disposition') || '') && pdf.subarray(0, 4).toString() === '%PDF', `${pdfRes.status} ${pdfRes.headers.get('content-type')}`);
  check('PDF: one page', (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length === 1);
  const must = [second.paymentNumber, 'PO-MOD-A', A.piNumber, 'Ind-MOD-A', 'E2E Alpha Traders', 'UTR-A2', '35,400.00', '10,000.00', '15,000.00', '10,400.00', 'AdvMod Finance', 'ADVANCE PAYMENT'];
  const missing = must.filter((t) => !text.includes(t));
  check('PDF text carries payment no, PO, PI, indent, vendor, UTR, advance required, previous 10,000, current 15,000, remaining 10,400, recorded by', !missing.length, `missing: ${missing.join(' | ')}`);
  const dl = await fetch(`${API}/procurement/advance-payments/${second._id}/pdf?download=true`, { headers: { Authorization: `Bearer ${tok}` } });
  check('PDF ?download=true → attachment with the payment number as file name', /^attachment/.test(dl.headers.get('content-disposition') || '') && (dl.headers.get('content-disposition') || '').includes(second.paymentNumber.replace(/[^A-Za-z0-9._-]+/g, '-')), dl.headers.get('content-disposition'));
  check('PDF needs login → 401', (await fetch(`${API}/procurement/advance-payments/${second._id}/pdf`)).status === 401);
  check('PDF unknown id → 404', (await fetch(`${API}/procurement/advance-payments/${new mongoose.Types.ObjectId()}/pdf`, { headers: { Authorization: `Bearer ${tok}` } })).status === 404);

  console.log('\nL  Table rows, filters, KPIs');
  const all = await call('GET', '/procurement/advance-payments?limit=100&sort=createdAt', undefined, tok);
  const rowsA = (all.data || []).filter((r) => r.poNumber === 'PO-MOD-A');
  check('A\'s 4 payments are 4 rows (no artificial duplicates), each with the PI\'s advance 35,400 / total paid 35,400 / remaining 0 / FULLY_PAID',
    rowsA.length === 4 && rowsA.every((r) => r.advanceRequired === 35400 && r.totalPaid === 35400 && r.remainingBalance === 0 && r.piPaymentState === 'FULLY_PAID'), JSON.stringify(rowsA.map((r) => [r.advanceRequired, r.totalPaid, r.remainingBalance, r.piPaymentState])));
  const rowS = (all.data || []).find((r) => r.poNumber === 'PO-MOD-S');
  check('S row: SHORT_CLOSED, remaining 480', rowS?.piPaymentState === 'SHORT_CLOSED' && rowS.remainingBalance === 480 && rowS.advanceRequired === 1180);
  const rowB = (all.data || []).find((r) => r.poNumber === 'PO-MOD-B');
  check('B row: PARTIALLY_PAID, paid 812 (800 + 10 + 1 + 1), remaining 368', rowB?.piPaymentState === 'PARTIALLY_PAID' && rowB.totalPaid === 812 && rowB.remainingBalance === 368, JSON.stringify(rowB));
  const fp = await call('GET', '/procurement/advance-payments?limit=100&piPaymentState=FULLY_PAID', undefined, tok);
  check('filter piPaymentState=FULLY_PAID → only A and Z payments (6 rows), meta.total 6', fp.status === 200 && (fp.data || []).length === 6 && (fp.data || []).every((r) => ['PO-MOD-A', 'PO-MOD-Z'].includes(r.poNumber)) && fp.meta?.total === 6, `${fp.status} ${(fp.data || []).length} ${fp.meta?.total}`);
  const pp = await call('GET', '/procurement/advance-payments?limit=100&piPaymentState=PARTIALLY_PAID', undefined, tok);
  check('filter PARTIALLY_PAID → only B payments', (pp.data || []).length > 0 && (pp.data || []).every((r) => r.poNumber === 'PO-MOD-B'));
  const sc = await call('GET', '/procurement/advance-payments?limit=100&piPaymentState=SHORT_CLOSED', undefined, tok);
  check('filter SHORT_CLOSED → only S', (sc.data || []).length === 1 && sc.data[0].poNumber === 'PO-MOD-S');
  check('invalid piPaymentState → 422', (await call('GET', '/procurement/advance-payments?piPaymentState=NOPE', undefined, tok)).status === 422);
  const byInd = await call('GET', '/procurement/advance-payments?limit=100&search=Ind-MOD-S', undefined, tok);
  check('search by indent number', (byInd.data || []).length === 1 && byInd.data[0].poNumber === 'PO-MOD-S');
  const byPi = await call('GET', `/procurement/advance-payments?limit=100&search=${encodeURIComponent(Z.piNumber)}`, undefined, tok);
  check('search by PI number', (byPi.data || []).length === 2 && byPi.data.every((r) => r.poNumber === 'PO-MOD-Z'));
  const pg = await call('GET', '/procurement/advance-payments?limit=3&page=2&sort=createdAt', undefined, tok);
  check('pagination: page 2 of 3-per-page', pg.status === 200 && (pg.data || []).length === 3 && pg.meta?.page === 2 && pg.meta.total === (all.meta?.total), `${pg.status} ${(pg.data || []).length}`);

  const st = await call('GET', '/procurement/advance-payments/stats', undefined, tok);
  // Independent oracle straight from the DB.
  const livePis = await ProformaInvoice.find({ isDeleted: { $ne: true } }).lean();
  const livePos = new Map((await VendorPurchaseOrder.find().lean()).map((p) => [String(p._id), p]));
  const payable = livePis.filter((p) => p.piStatus === 'READY_FOR_ADVANCE_PAYMENT' && p.balanceAmount > 0 && livePos.get(String(p.poId)).approvalStatus === 'APPROVED' && !['CANCELLED', 'CLOSED'].includes(livePos.get(String(p.poId)).poStatus));
  const settled = livePis.filter((p) => p.piStatus === 'PAYMENT_COMPLETED');
  const paidSum = (await AdvancePayment.find({ paymentStatus: { $ne: 'CANCELLED' } }).lean()).reduce((s, x) => s + x.paidAmount, 0);
  const s = st.data || {};
  check('KPI total advance required = payable PIs + settled PIs', r2(s.totalAdvanceRequired) === r2([...payable, ...settled].reduce((a, p) => a + p.totalValue, 0)), `${s.totalAdvanceRequired}`);
  check('KPI total paid = sum of payment records', r2(s.totalPaid) === r2(paidSum), `${s.totalPaid} vs ${paidSum}`);
  check('KPI remaining advance = balance of payable PIs', r2(s.remainingAdvance) === r2(payable.reduce((a, p) => a + p.balanceAmount, 0)), `${s.remainingAdvance}`);
  check('KPI partially paid = 1 (B), fully paid = 2 (A, Z), short closed = 1 (S)', s.partiallyPaidCount === 1 && s.fullyPaidCount === 2 && s.shortClosedCount === 1, JSON.stringify([s.partiallyPaidCount, s.fullyPaidCount, s.shortClosedCount]));
  check('existing KPI keys kept (totalPayments, paidAmount, pendingAmount, outstandingAmount, cancelled)', ['totalPayments', 'paidAmount', 'pendingAmount', 'outstandingAmount', 'cancelled'].every((k) => typeof s[k] === 'number'));

  console.log('\nR  Reconciliation');
  for (const p of await ProformaInvoice.find({ isDeleted: { $ne: true } }).lean()) {
    const paid = (await AdvancePayment.find({ piId: p._id, paymentStatus: { $ne: 'CANCELLED' } }).lean()).reduce((x, y) => x + y.paidAmount, 0);
    const seeded = ['C', 'K', 'P', 'R', 'H'].some((t) => p.poNumber === `PO-MOD-${t}`) && paid === 0;
    check(`${p.piNumber}: paid = payment history, balance = total − paid, never above total`,
      (seeded || r2(p.paidAmount) === r2(paid)) && r2(p.balanceAmount) === r2(p.totalValue - p.paidAmount) && p.paidAmount <= p.totalValue, `paid=${p.paidAmount} history=${paid}`);
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
