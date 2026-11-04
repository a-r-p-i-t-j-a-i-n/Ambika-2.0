/**
 * Fixture + API oracle for Purchase FMS → Advance Payments → "Awaiting Advance".
 *
 *   node src/scripts/e2eAdvanceAwaitingFixture.js --seed    drop + seed ambika_e2e_advawait
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5095 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_advawait node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5095/api/v1 node src/scripts/e2eAdvanceAwaitingFixture.js --api
 *
 * --seed builds, through the REAL services (PI create / approve → MD approval raised):
 *   A  approved, MD approved          → awaiting, READY (planned date + doer from its doer task)
 *   B  approved, still with the MD    → awaiting, WAITING (Record Payment opens, submit refused)
 *   C  approved, then cancelled       → never awaiting, never payable
 *   D  received, NOT approved         → never awaiting, never payable
 *   E  rejected                       → never awaiting, never payable
 *   F  fully paid (PAYMENT_COMPLETED) → never awaiting
 *   G  READY but zero balance         → never awaiting
 *   PO-NOPI  a PO whose PI is not required → no PI, so nothing to pay
 *
 * --api (HTTP) checks: queue membership/fields, partial → part payment, overpay /
 * zero / negative refused, simultaneous submits never overpay, full payment
 * leaves the queue, both entries in the payment list with timing, payments to
 * C/D/E/F/B refused with nothing posted, CANCELLED entry posts nothing,
 * unauthenticated / non-permitted refused, paid + balance reconcile to the
 * payment history, reading the queue writes nothing. Section P writes — re-seed
 * before re-running.
 *
 * SAFETY: shared e2e guard (localhost, DB name has "e2e", S3 + email off). Never
 * reads MONGO_URI; --api never drops the DB.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import ProformaInvoice from '../modules/procurement/proforma-invoice/proformaInvoice.model.js';
import AdvancePayment from '../modules/procurement/advance-payment/advancePayment.model.js';
import { FmsTask } from '../modules/fms-doers/fmsDoer.model.js';

export const DB_NAME = 'ambika_e2e_advawait';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eAdvanceAwaitingFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5095/api/v1').replace(/\/+$/, '');
export const MD = { email: 'adv-md-e2e@test.local', password: 'E2e@12345' };
export const FINANCE = { email: 'adv-fin-e2e@test.local', password: 'E2e@12345' };
const PLANNED = new Date('2026-11-20T10:00:00Z');

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

const piDoc = { fileName: 'vendor-pi.pdf', fileUrl: 'http://127.0.0.1:5095/uploads/e2e/vendor-pi.pdf', fileType: 'application/pdf' };

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  const { proformaInvoiceService } = await import('../modules/procurement/proforma-invoice/proformaInvoice.service.js');

  const md = await User.create({ ...MD, name: 'Adv MD', role: 'MD', roles: ['MD'], mobile: '9000000081', isActive: true });
  const fin = await User.create({ ...FINANCE, name: 'Adv Finance', role: 'Accountant', roles: ['FINANCE'], mobile: '9000000082', isActive: true });
  const sku = await SKU.create({ code: 'E2E-ADV-ITEM', name: 'E2E Advance Item', unit: 'PCS', itemType: 'CONSUMABLE', category: 'Misc' });

  const mkPo = (tag, vendorName, qty, rate, extra = {}) => VendorPurchaseOrder.create({
    poNumber: `PO-ADV-${tag}`, vendorId: new mongoose.Types.ObjectId(), vendorName, indentNumber: `Ind-ADV-${tag}`,
    indentId: new mongoose.Types.ObjectId(), poStatus: 'RELEASED_TO_VENDOR', approvalStatus: 'APPROVED',
    items: [{ skuId: sku._id, skuCode: sku.code, itemName: sku.name, unit: sku.unit, quantity: qty, receivedQty: 0, pendingQty: qty, rate, gstRate: 18 }],
    ...extra,
  });
  const mkPi = async (tag, vendor, qty, rate, approve = true) => {
    const po = await mkPo(tag, vendor, qty, rate);
    const pi = await proformaInvoiceService.create({ poId: String(po._id), piDocument: piDoc }, fin);
    if (approve) await proformaInvoiceService.approve(String(pi._id), { remarks: 'E2E' }, fin);
    return { po, pi };
  };

  const A = await mkPi('A', 'E2E Alpha Traders', 10, 100);
  await ProformaInvoice.updateOne({ _id: A.pi._id }, { $set: { mdApprovalStatus: 'MD_APPROVED' } });
  await mkPi('B', 'E2E Beta Metals', 20, 50);                                  // stays READY_FOR_MD_APPROVAL
  const C = await mkPi('C', 'E2E Gamma Supplies', 5, 100);
  await proformaInvoiceService.cancel(String(C.pi._id), { remarks: 'E2E cancel' }, fin);
  await mkPi('D', 'E2E Delta Works', 5, 100, false);                           // never approved
  const E = await mkPi('E', 'E2E Epsilon Co', 5, 100, false);
  await proformaInvoiceService.reject(String(E.pi._id), { remarks: 'E2E reject' }, fin);
  const F = await mkPi('F', 'E2E Zeta Steel', 4, 100);
  await ProformaInvoice.updateOne({ _id: F.pi._id }, { $set: { piStatus: 'PAYMENT_COMPLETED', mdApprovalStatus: 'MD_APPROVED', paidAmount: F.pi.totalValue, balanceAmount: 0 } });
  const Gz = await mkPi('G', 'E2E Eta Traders', 3, 100);
  await ProformaInvoice.updateOne({ _id: Gz.pi._id }, { $set: { balanceAmount: 0, paidAmount: Gz.pi.totalValue } });
  await mkPo('NOPI', 'E2E Theta Co', 2, 100, { piStatus: 'PI_NOT_REQUIRED' });

  // A's open Step 1.7 doer task — the queue's Planned Date / Assigned Doer.
  await FmsTask.create({
    fmsKey: 'PURCHASE', stepKey: 'ADVANCE_PAYMENT', entityType: 'PI', entityId: A.pi._id, entityRef: A.pi.piNumber,
    status: 'OPEN', assignedDoerId: md._id, assignedDoerIds: [md._id], plannedAt: PLANNED,
  });

  const pis = await ProformaInvoice.find().sort('createdAt').lean();
  console.log(`[seed] ${DB_NAME}: MD ${MD.email} / ${MD.password}; FINANCE ${FINANCE.email}`);
  for (const p of pis) console.log(`  ${p.piNumber} ${p.vendorName} total=${p.totalValue} paid=${p.paidAmount} bal=${p.balanceAmount} ${p.piStatus} ${p.approvalStatus} md=${p.mdApprovalStatus}`);
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
  const finTok = await login(FINANCE);
  if (!tok || !finTok) throw new Error('login failed — seed first and start the backend on the scratch DB');
  const piBy = async (tag) => ProformaInvoice.findOne({ poNumber: `PO-ADV-${tag}` }).lean();
  const queue = async (qs = '') => (await call('GET', `/procurement/step-queues/ADVANCE_PAYMENT?limit=100${qs}`, undefined, tok));
  const pay = (pi, body, t = tok) => call('POST', '/procurement/advance-payments', {
    piId: String(pi._id), paymentDate: new Date().toISOString().slice(0, 10), paymentMode: 'NEFT', paymentReferenceNumber: `UTR-E2E-${++refSeq}`, ...body,
  }, t);
  const A = await piBy('A'); const B = await piBy('B'); const Cc = await piBy('C'); const D = await piBy('D');
  const E = await piBy('E'); const F = await piBy('F'); const G = await piBy('G');
  const total = A.totalValue;

  console.log('\nQ  Awaiting Advance membership + fields');
  const before = await Promise.all([ProformaInvoice.countDocuments(), AdvancePayment.countDocuments()]);
  let q = await queue();
  const nums = q.data.rows.map((r) => r.number);
  check('exactly the approved, unpaid PIs (A, B) are awaiting', JSON.stringify(nums.sort()) === JSON.stringify([A.piNumber, B.piNumber].sort()), nums.join(','));
  check('cancelled, unapproved, rejected, fully-paid and zero-balance PIs are not listed',
    ![Cc, D, E, F, G].some((p) => nums.includes(p.piNumber)));
  check('a PO whose PI is not required has no row', !q.data.rows.some((r) => String(r.refs).includes('PO-ADV-NOPI')));
  const rowA = q.data.rows.find((r) => r.number === A.piNumber);
  const rowB = q.data.rows.find((r) => r.number === B.piNumber);
  check('A: advance figures = PI value, nothing paid, PENDING, READY, can record',
    rowA.piAmount === total && rowA.advanceRequired === total && rowA.paidAmount === 0 && rowA.remainingAmount === total
    && rowA.paymentStatus === 'PENDING' && rowA.state === 'READY' && rowA.action === 'RECORD_ADVANCE', JSON.stringify(rowA));
  check('A: linked to its PO and Indent', rowA.refs.some((x) => x.startsWith('PO ')) && rowA.refs.some((x) => x.startsWith('Indent ')), String(rowA.refs));
  check('A: planned date + assigned doer come from its doer task',
    new Date(rowA.stepTiming?.plannedAt).getTime() === PLANNED.getTime() && rowA.stepTiming?.assignedDoerName === 'Adv MD' && rowA.stepTiming?.done === false, JSON.stringify(rowA.stepTiming));
  check('B: waiting for the MD, still offers Record Payment', rowB.state === 'WAITING' && rowB.action === 'RECORD_ADVANCE' && rowB.statusLabel === 'Waiting for MD approval');
  check('B: no doer task → blank doer / planned (never invented)', rowB.stepTiming?.plannedAt === null && rowB.stepTiming?.assignedDoerName === null);
  const after = await Promise.all([ProformaInvoice.countDocuments(), AdvancePayment.countDocuments()]);
  check('reading the queue writes nothing', JSON.stringify(before) === JSON.stringify(after));
  check('no login → 401', (await fetch(`${API}/procurement/step-queues/ADVANCE_PAYMENT`)).status === 401);

  console.log('\nP  Payments (writes)');
  const part = Math.floor(total / 3);
  const p1 = await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: part });
  check('partial advance recorded (201)', p1.status === 201, `${p1.status} ${p1.message}`);
  let piA = await piBy('A');
  check('PI paid / balance updated', r2(piA.paidAmount) === part && r2(piA.balanceAmount) === r2(total - part) && piA.piStatus === 'READY_FOR_ADVANCE_PAYMENT');
  q = await queue();
  const rowA2 = q.data.rows.find((r) => r.number === A.piNumber);
  check('A stays awaiting as PART_PAYMENT with the remaining advance',
    rowA2 && rowA2.paymentStatus === 'PART_PAYMENT' && rowA2.paidAmount === part && rowA2.remainingAmount === r2(total - part), JSON.stringify(rowA2));
  check('A keeps its planned date and doer after a part payment', new Date(rowA2.stepTiming?.plannedAt).getTime() === PLANNED.getTime());

  const remaining = r2(total - part);
  const over = await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: remaining + 1 });
  check('overpayment refused (400), nothing posted', over.status === 400 && r2((await piBy('A')).paidAmount) === part, `${over.status} ${over.message}`);
  check('zero amount refused (422 validation)', (await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: 0 })).status === 422);
  check('negative amount refused (422 validation)', (await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: -5 })).status === 422);
  check('FULL_PAYMENT that is not the exact balance refused', (await pay(A, { paymentStatus: 'FULL_PAYMENT', paidAmount: remaining - 1 })).status === 400);

  // Simultaneous submits for the whole remaining balance — exactly one may land.
  const race = await Promise.all(Array.from({ length: 5 }, () => pay(A, { paymentStatus: 'FULL_PAYMENT', paidAmount: remaining })));
  const won = race.filter((r) => r.status === 201).length;
  check('5 simultaneous full payments → exactly one succeeds', won === 1, race.map((r) => r.status).join(','));
  check('the others are refused cleanly (400/409), no 5xx', race.every((r) => [201, 400, 409].includes(r.status)), race.map((r) => `${r.status}:${r.message}`).join(' | '));
  piA = await piBy('A');
  check('PI paid exactly the PI value — never more', r2(piA.paidAmount) === r2(total) && r2(piA.balanceAmount) === 0, `paid=${piA.paidAmount}`);
  check('PI is PAYMENT_COMPLETED', piA.piStatus === 'PAYMENT_COMPLETED');
  q = await queue();
  check('fully paid A leaves Awaiting Advance', !q.data.rows.some((r) => r.number === A.piNumber));
  check('B is still awaiting', q.data.rows.some((r) => r.number === B.piNumber));
  check('payment against the completed PI refused', (await pay(A, { paymentStatus: 'PART_PAYMENT', paidAmount: 1 })).status === 400);

  const list = await call('GET', `/procurement/advance-payments?piId=${A._id}&limit=50`, undefined, tok);
  check('both payment entries are in the Advance Payments list', list.data.length === 2, `got ${list.data.length}`);
  const sum = r2(list.data.reduce((s, p) => s + (p.paymentStatus === 'CANCELLED' ? 0 : p.paidAmount), 0));
  check('entries add up to the PI value and each carries mode / ref / date',
    sum === r2(total) && list.data.every((p) => p.paymentMode === 'NEFT' && /^UTR-E2E-\d+$/.test(p.paymentReferenceNumber) && p.paymentDate), `sum=${sum}`);
  check('entries carry piNumber / poNumber / vendor / balance snapshots',
    list.data.every((p) => p.piNumber === A.piNumber && p.poNumber && p.vendorName === 'E2E Alpha Traders' && typeof p.balanceAmount === 'number'));
  check('payment rows carry stepTiming (actual date + performer)', list.data.every((p) => p.stepTiming?.actualAt && p.stepTiming?.doneByName), JSON.stringify(list.data[0]?.stepTiming));
  const one = await call('GET', `/procurement/advance-payments/${list.data[0]._id}`, undefined, tok);
  check('GET /:id returns the entry (Eye detail source)', one.status === 200 && one.data.piNumber === A.piNumber);
  const stats = await call('GET', '/procurement/advance-payments/stats', undefined, tok);
  const openBal = (await ProformaInvoice.find({ piStatus: 'READY_FOR_ADVANCE_PAYMENT' }).lean()).reduce((s, p) => s + p.balanceAmount, 0);
  check('stats pending amount = Σ balance of PIs still awaiting', r2(stats.data.pendingAmount) === r2(openBal), `${stats.data.pendingAmount} vs ${openBal}`);
  check('stats paid amount = Σ payment entries', r2(stats.data.paidAmount) === sum);

  console.log('\nG  Guards');
  const pB = await pay(B, { paymentStatus: 'PART_PAYMENT', paidAmount: 10 });
  check('PI still with the MD refused (400), nothing posted', pB.status === 400 && /MD/.test(pB.message) && r2((await piBy('B')).paidAmount) === 0, `${pB.status} ${pB.message}`);
  const mdAfter = await piBy('B');
  check('B stays awaiting MD approval (raised to MD, not paid)', ['READY_FOR_MD_APPROVAL'].includes(mdAfter.mdApprovalStatus));
  for (const [name, p] of [['cancelled', Cc], ['unapproved', D], ['rejected', E], ['fully paid', F]]) {
    const r = await pay(p, { paymentStatus: 'PART_PAYMENT', paidAmount: 1 });
    const fresh = await ProformaInvoice.findById(p._id).lean();
    check(`payment to a ${name} PI refused (400), nothing posted`, r.status === 400 && fresh.paidAmount === p.paidAmount, `${r.status} ${r.message}`);
  }
  const cancelEntry = await pay(B, { paymentStatus: 'CANCELLED', paidAmount: 0 });
  check('CANCELLED entry is recorded but posts nothing and B stays awaiting',
    cancelEntry.status === 201 && (await piBy('B')).paidAmount === 0 && (await queue()).data.rows.some((r) => r.number === B.piNumber));
  check('unknown PI → 404', (await call('POST', '/procurement/advance-payments', { piId: String(new mongoose.Types.ObjectId()), paymentStatus: 'PART_PAYMENT', paymentDate: '2026-11-03', paidAmount: 1 }, tok)).status === 404);
  check('no login → 401 on create', (await call('POST', '/procurement/advance-payments', {})).status === 401);
  check('bad payload → 422 validation', (await call('POST', '/procurement/advance-payments', { piId: 'x' }, tok)).status === 422);
  const del = await call('DELETE', `/procurement/advance-payments/${list.data[0]._id}`, undefined, finTok);
  check('delete by a user without procurement.deleteAdvancePayment → 403', del.status === 403, `${del.status} ${del.message}`);

  console.log('\nR  Reconciliation');
  for (const p of await ProformaInvoice.find({ isDeleted: { $ne: true } }).lean()) {
    const paid = (await AdvancePayment.find({ piId: p._id, paymentStatus: { $ne: 'CANCELLED' } }).lean()).reduce((s, x) => s + x.paidAmount, 0);
    const hist = await AdvancePayment.countDocuments({ piId: p._id });
    const seededPaid = [F, G].some((s) => String(s._id) === String(p._id));
    check(`${p.piNumber}: paid = payment history, balance = total − paid, never above total`,
      (seededPaid || r2(p.paidAmount) === r2(paid)) && (seededPaid || r2(p.balanceAmount) === r2(p.totalValue - p.paidAmount)) && p.paidAmount <= p.totalValue,
      `paid=${p.paidAmount} history=${paid} (${hist} entries)`);
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
