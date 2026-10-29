/**
 * API oracle for Purchase FMS step visibility: every step table lists every
 * record relevant to it by default, with its real status; filters only narrow;
 * records waiting to enter a step show on that step's "Awaiting" queue.
 *
 *   node src/scripts/e2eStepVisibilityFixture.js --seed   drop + seed the scratch DB
 *   (start the guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5096 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_stepvis node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5096/api/v1 node src/scripts/e2eStepVisibilityFixture.js --api
 *
 * --seed writes the documents of every step directly, in each state a step can
 * show (pending / done / not required / waiting for the MD / started …), with
 * consistent links (indent → PO → follow-up / PI → GRN → QC → invoice → voucher
 * → Tally → final payment). No advance payment exists, so that step starts
 * empty while two PIs wait for it.
 *
 * --api checks, through the real HTTP API:
 *   Q  Steps 1.02 / 1.03: the unfiltered list holds every indent that reached the
 *      step in every state; each state filter narrows exactly; draft / rejected
 *      indents never appear; tile counts = list totals.
 *   L  Every step's own list returns all its records with no filter, and each
 *      status filter narrows to exactly the seeded records.
 *   W  Vendor Invoices workflow chips are resolved on the server: exact totals,
 *      full pages, page 2, cancelled vouchers ignored, combined with search.
 *   A  Awaiting queues: exact membership and state per queue, no record listed
 *      twice, nothing already recorded at the step, filters / counts / paging,
 *      bad queue or state refused, and reading a queue writes nothing.
 *   T  Transitions through the real create APIs: a follow-up, a Tally entry and
 *      an advance payment each move their record out of the queue into the
 *      step's own list (and nowhere else).
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard
 * (S3 + email off). Never reads MONGO_URI. --api never drops the DB, but its
 * section T creates records — re-seed before re-running.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import PurchaseFollowUp from '../modules/procurement/follow-up/followUp.model.js';
import ProformaInvoice from '../modules/procurement/proforma-invoice/proformaInvoice.model.js';
import AdvancePayment from '../modules/procurement/advance-payment/advancePayment.model.js';
import GoodsReceiptNote from '../modules/procurement/grn/grn.model.js';
import IncomingQC from '../modules/procurement/incoming-qc/incomingQc.model.js';
import VendorInvoice from '../modules/procurement/vendor-invoice/vendorInvoice.model.js';
import VendorVoucher from '../modules/procurement/voucher/voucher.model.js';
import PurchaseTallyEntry from '../modules/procurement/tally-entry/tallyEntry.model.js';
import VendorFinalPayment from '../modules/procurement/final-payment/finalPayment.model.js';

export const DB_NAME = 'ambika_e2e_stepvis';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eStepVisibilityFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5096/api/v1').replace(/\/+$/, '');
export const LOGIN = { email: 'stepvis-e2e@test.local', password: 'E2e@12345' };

const ALPHA = { vendorId: new mongoose.Types.ObjectId('64c000000000000000000a01'), vendorName: 'E2E Alpha Steel' };
const BETA = { vendorId: new mongoose.Types.ObjectId('64c000000000000000000b02'), vendorName: 'E2E Beta (Pvt) Traders' };
// Bulk invoices for the paging checks (W).
export const BULK_AWAITING_VOUCHER = 30;
export const BULK_RECEIVED = 28;

let failures = 0;
let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${detail}` : ''}`);
};
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

// ── Seed ───────────────────────────────────────────────────────────────────
const oid = () => new mongoose.Types.ObjectId();
const day = (n) => new Date(Date.UTC(2026, 9, n, 6, 0, 0)); // Oct n, 2026, 11:30 IST
const base = (n) => ({ isDeleted: false, createdAt: day(n), updatedAt: day(n) });
const ins = (Model, docs) => Model.collection.insertMany(docs);

const indent = (n, number, extra) => ({
  _id: oid(), ...base(n), indentNumber: number, timestamp: day(n), department: 'Stores', raisedBy: 'E2E',
  requestType: 'MATERIAL_PURCHASE',
  items: [{ _id: oid(), itemName: `Item ${number}`, skuCode: `SKU-${number}`, quantity: 10, approvedQuantity: 10, unit: 'Pcs', approvalStatus: 'APPROVED' }],
  ...extra,
});

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  await User.create({ ...LOGIN, name: 'E2E StepVis Doer', role: 'MD', roles: ['MD'], mobile: '9000000077', isActive: true });

  // Indents — quotation steps 1.02 / 1.03.
  const I = {
    draft: indent(1, 'SV-IND-DRAFT', { approvalStatus: 'DRAFT', overallStatus: 'INDENT_GENERATED' }),
    rejected: indent(1, 'SV-IND-REJ', { approvalStatus: 'REJECTED', overallStatus: 'INDENT_GENERATED' }),
    quotePending: indent(2, 'SV-IND-QP', { approvalStatus: 'APPROVED', overallStatus: 'QUOTE_PENDING' }),
    quoted: indent(3, 'SV-IND-QR', { approvalStatus: 'APPROVED', overallStatus: 'QUOTE_RECEIVED', quoteComparativeStep: { statusDone: 'YES', actualAt: day(4) } }),
    approved: indent(4, 'SV-IND-QA', {
      approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED',
      quoteComparativeStep: { statusDone: 'YES', actualAt: day(4) }, quotationApprovalStep: { statusDone: 'YES', actualAt: day(5) },
    }),
    notRequired: indent(5, 'SV-IND-NR', {
      approvalStatus: 'APPROVED', overallStatus: 'PO_READY',
      quoteComparativeStep: { statusDone: 'QUOTE_NOT_REQUIRED', actualAt: day(5) }, quotationApprovalStep: { skipped: true },
    }),
    partialPo: indent(6, 'SV-IND-PPO', {
      approvalStatus: 'APPROVED', overallStatus: 'PARTIAL_PO_CREATED',
      quoteComparativeStep: { statusDone: 'YES', actualAt: day(6) }, quotationApprovalStep: { statusDone: 'YES', actualAt: day(7) },
    }),
    service: indent(7, 'SV-IND-SVC', {
      requestType: 'INTERNAL_SERVICE', approvalStatus: 'APPROVED', overallStatus: 'SERVICE_PENDING',
      quoteComparativeStep: { statusDone: 'YES', actualAt: day(7) }, quotationApprovalStep: { statusDone: 'YES', actualAt: day(8) },
      approvedVendors: [{ ...BETA }],
    }),
  };
  await ins(PurchaseIndent, Object.values(I));

  // POs.
  const po = (n, number, v, extra) => ({
    _id: oid(), ...base(n), poNumber: number, poDate: day(n), indentId: I.approved._id, indentNumber: I.approved.indentNumber,
    ...v, approvalStatus: 'APPROVED', releaseStatus: 'RELEASED', releasedAt: day(n), poStatus: 'RELEASED_TO_VENDOR',
    followUpStatus: 'NOT_STARTED', piStatus: 'NOT_RECEIVED', grandTotal: 10000 + n, expectedDeliveryDate: day(n + 10),
    items: [{ _id: oid(), itemName: 'Item', quantity: 10, receivedQty: 0, unit: 'Pcs', rate: 1000, gstRate: 18 }],
    ...extra,
  });
  const P = {
    noFollowUp: po(8, 'SV-PO-NOFU', ALPHA, {}),
    followingUp: po(9, 'SV-PO-FU', BETA, { followUpStatus: 'IN_PROGRESS' }),
    readyNoPi: po(10, 'SV-PO-RDY', ALPHA, { followUpStatus: 'READY_FOR_GRN', readyForGrnAt: day(12), finalMaterialDate: day(12) }),
    readyPiPending: po(10, 'SV-PO-PIP', BETA, { followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_RECEIVED', readyForGrnAt: day(12), finalMaterialDate: day(12) }),
    readyNoDate: po(11, 'SV-PO-NODATE', BETA, { followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_APPROVED', readyForGrnAt: day(13) }),
    readyFuDate: po(11, 'SV-PO-FUDATE', ALPHA, { followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_APPROVED', readyForGrnAt: day(13) }),
    draft: po(12, 'SV-PO-DRAFT', ALPHA, { poNumber: '', draftNumber: 'SV-DRAFT-1', approvalStatus: 'DRAFT', releaseStatus: 'NOT_RELEASED', releasedAt: null, poStatus: 'DRAFT' }),
    partial: po(12, 'SV-PO-PART', ALPHA, { followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_NOT_REQUIRED', poStatus: 'PARTIAL_RECEIVED', readyForGrnAt: day(13), finalMaterialDate: day(13) }),
    received: po(13, 'SV-PO-FULL', BETA, { followUpStatus: 'CLOSED', piStatus: 'PI_APPROVED', poStatus: 'FULLY_RECEIVED', readyForGrnAt: day(14), finalMaterialDate: day(14) }),
  };
  await ins(VendorPurchaseOrder, Object.values(P));

  const fu = (n, number, p, status, extra = {}) => ({
    _id: oid(), ...base(n), followUpNumber: number, poId: p._id, poNumber: p.poNumber, vendorId: p.vendorId, vendorName: p.vendorName,
    plannedAt: day(n + 2), followUpStatus: status, isActiveFollowUp: ['PENDING', 'RESCHEDULED'].includes(status) ? true : null,
    followUpType: 'CALL', communicationLog: [], activityTimeline: [], ...extra,
  });
  await ins(PurchaseFollowUp, [
    fu(10, 'SV-FU-1', P.followingUp, 'PENDING'),
    fu(11, 'SV-FU-2', P.readyNoPi, 'READY_FOR_GRN', { finalMaterialDate: day(12) }),
    // An older PO whose PO-level date is missing but its follow-up has one (grn.service fallback).
    fu(12, 'SV-FU-3', P.readyFuDate, 'READY_FOR_GRN', { finalMaterialDate: day(13) }),
  ]);

  // PIs — no advance payment recorded anywhere yet.
  const pi = (n, number, p, extra) => ({
    _id: oid(), ...base(n), piNumber: number, piDate: day(n), poId: p._id, poNumber: p.poNumber, vendorId: p.vendorId, vendorName: p.vendorName,
    totalValue: 5000, paidAmount: 0, balanceAmount: 5000, items: [], ...extra,
  });
  const PI = {
    ready: pi(14, 'SV-PI-READY', P.readyNoDate, { piStatus: 'READY_FOR_ADVANCE_PAYMENT', mdApprovalStatus: 'MD_APPROVED' }),
    atMd: pi(15, 'SV-PI-ATMD', P.readyFuDate, { piStatus: 'READY_FOR_ADVANCE_PAYMENT', mdApprovalStatus: 'READY_FOR_MD_APPROVAL' }),
    received: pi(15, 'SV-PI-RCVD', P.readyPiPending, { piStatus: 'RECEIVED', mdApprovalStatus: 'NOT_REQUIRED' }),
  };
  await ins(ProformaInvoice, Object.values(PI));

  // GRNs + QCs.
  const grnLine = () => ({ _id: oid(), itemName: 'Item', receivedQty: 10, unit: 'Pcs' });
  const grn = (n, number, p, extra) => ({
    _id: oid(), ...base(n), grnNumber: number, grnDate: day(n), poId: p._id, poNumber: p.poNumber, vendorId: p.vendorId, vendorName: p.vendorName,
    isWithoutPo: false, qcStatus: 'PENDING', qcIds: [], qcNumbers: [], items: [grnLine()], ...extra,
  });
  const G = {
    partialFresh: grn(15, 'SV-GRN-PART', P.partial, { grnStatus: 'PARTIAL_RECEIVED' }),
    draftQc: grn(16, 'SV-GRN-QCDRAFT', P.received, { grnStatus: 'FULLY_RECEIVED' }),
    passed: grn(16, 'SV-GRN-PASSED', P.received, { grnStatus: 'FULLY_RECEIVED', qcStatus: 'PASSED' }),
    invoiced: grn(17, 'SV-GRN-INVOICED', P.received, { grnStatus: 'FULLY_RECEIVED', qcStatus: 'PASSED' }),
    draft: grn(17, 'SV-GRN-DRAFT', P.received, { grnStatus: 'DRAFT' }),
  };
  const qc = (n, number, g, status, extra = {}) => ({
    _id: oid(), ...base(n), qcNumber: number, qcDate: day(n), grnId: g._id, grnNumber: g.grnNumber, poId: g.poId, poNumber: g.poNumber,
    vendorId: g.vendorId, vendorName: g.vendorName, qcStatus: status, overallResult: status === 'PASSED' ? 'PASS' : 'PENDING',
    items: [{ _id: oid(), grnItemId: g.items[0]._id, itemName: 'Item', unit: 'Pcs', receivedQty: 10, acceptedQty: status === 'PASSED' ? 10 : 0, rejectedQty: 0 }],
    ...extra,
  });
  const Q = {
    draft: qc(16, 'SV-QC-DRAFT', G.draftQc, 'DRAFT'),
    passed: qc(17, 'SV-QC-PASSED', G.passed, 'PASSED'),
    invoiced: qc(18, 'SV-QC-INVOICED', G.invoiced, 'PASSED'),
  };
  G.draftQc.qcIds = [Q.draft._id]; G.draftQc.qcId = Q.draft._id; G.draftQc.qcNumber = Q.draft.qcNumber;
  G.passed.qcIds = [Q.passed._id]; G.passed.qcId = Q.passed._id;
  G.invoiced.qcIds = [Q.invoiced._id]; G.invoiced.qcId = Q.invoiced._id;
  await ins(GoodsReceiptNote, Object.values(G));
  await ins(IncomingQC, Object.values(Q));

  // Invoices (+ their vouchers) in every workflow state.
  const inv = (n, number, status, v = ALPHA, extra = {}) => ({
    _id: oid(), ...base(n), invoiceNumber: number, invoiceDate: day(n), invoiceStatus: status, ...v,
    poNumber: P.received.poNumber, grnNumber: G.invoiced.grnNumber, invoiceAmount: 1180, netPayableAmount: 1180, advancePaid: 0, items: [],
    ...extra,
  });
  const V_INV = {
    draft: inv(18, 'SV-INV-DRAFT', 'DRAFT'),
    received: inv(18, 'SV-INV-RCVD', 'RECEIVED', BETA),
    noVoucher: inv(19, 'SV-INV-NOVOU', 'PAYMENT_PENDING'),
    cancelledVoucher: inv(19, 'SV-INV-CANCV', 'PAYMENT_PENDING', BETA),
    atMd: inv(20, 'SV-INV-ATMD', 'PAYMENT_PENDING'),
    partPaid: inv(20, 'SV-INV-PART', 'PAYMENT_PENDING', BETA),
    posted: inv(21, 'SV-INV-POSTED', 'PAYMENT_PENDING'),
    completed: inv(21, 'SV-INV-DONE', 'PAYMENT_COMPLETED', ALPHA, {
      qcId: Q.invoiced._id, items: [{ _id: oid(), qcId: Q.invoiced._id, qcItemId: Q.invoiced.items[0]._id, invoiceQty: 10 }],
    }),
    rejected: inv(21, 'SV-INV-REJ', 'REJECTED', BETA),
  };
  const bulk = [
    ...Array.from({ length: BULK_AWAITING_VOUCHER }, (_, i) => inv(22, `SV-BULK-AV-${String(i + 1).padStart(2, '0')}`, 'PAYMENT_PENDING', i % 2 ? BETA : ALPHA)),
    ...Array.from({ length: BULK_RECEIVED }, (_, i) => inv(22, `SV-BULK-RC-${String(i + 1).padStart(2, '0')}`, 'RECEIVED')),
  ];
  await ins(VendorInvoice, [...Object.values(V_INV), ...bulk]);

  const vou = (n, number, invoice, extra) => ({
    _id: oid(), ...base(n), voucherNumber: number, voucherDate: day(n), voucherType: 'PURCHASE',
    invoiceId: invoice?._id || null, invoiceNumber: invoice?.invoiceNumber || '', vendorId: invoice?.vendorId, vendorName: invoice?.vendorName,
    netPayableAmount: 1180, paidAmount: 0, balanceAmount: 1180, tallyEntryStatus: 'PENDING', approvalStatus: 'NOT_REQUIRED', ...extra,
  });
  const V = {
    cancelled: vou(19, 'SV-VOU-CANC', V_INV.cancelledVoucher, { voucherStatus: 'CANCELLED' }),
    atMd: vou(20, 'SV-VOU-ATMD', V_INV.atMd, { voucherStatus: 'POSTED', postedAt: day(20), approvalStatus: 'READY_FOR_MD_APPROVAL' }),
    partPaid: vou(20, 'SV-VOU-PART', V_INV.partPaid, {
      voucherStatus: 'PARTIALLY_PAID', postedAt: day(20), approvalStatus: 'MD_APPROVED', tallyEntryStatus: 'COMPLETED', paidAmount: 680, balanceAmount: 500,
    }),
    posted: vou(21, 'SV-VOU-POSTED', V_INV.posted, { voucherStatus: 'POSTED', postedAt: day(21), approvalStatus: 'MD_APPROVED' }),
    tallied: vou(21, 'SV-VOU-TALLIED', V_INV.posted, {
      voucherStatus: 'POSTED', postedAt: day(21), approvalStatus: 'READY_FOR_MD_APPROVAL', tallyEntryStatus: 'COMPLETED', balanceAmount: 800,
    }),
    paid: vou(21, 'SV-VOU-PAID', V_INV.completed, { voucherStatus: 'FULLY_PAID', postedAt: day(21), approvalStatus: 'MD_APPROVED', tallyEntryStatus: 'COMPLETED', paidAmount: 1180, balanceAmount: 0 }),
    draft: vou(22, 'SV-VOU-DRAFT', null, { voucherStatus: 'DRAFT', voucherType: 'EXPENSE', partyName: 'E2E Expense Party' }),
  };
  // SV-VOU-TALLIED is a second (older-numbered, newer-created) voucher on the
  // posted invoice only for the tally/final queues; the invoice's live voucher
  // is the newest one, so give the invoice's own voucher the later createdAt.
  V.posted.createdAt = day(23);
  await ins(VendorVoucher, Object.values(V));

  const tally = (n, number, v, status) => ({
    _id: oid(), ...base(n), entryNumber: number, voucherId: v._id, voucherNumber: v.voucherNumber, invoiceNumber: v.invoiceNumber,
    vendorId: v.vendorId, vendorName: v.vendorName, plannedAt: day(n), tallyEntryStatus: status, statusDone: status === 'COMPLETED' ? 'YES' : 'NO',
  });
  await ins(PurchaseTallyEntry, [
    tally(21, 'SV-TALLY-PART', V.partPaid, 'COMPLETED'),
    tally(22, 'SV-TALLY-ATMD', V.atMd, 'PENDING'), // started, not completed — in the list, not the queue
    tally(22, 'SV-TALLY-TALLIED', V.tallied, 'COMPLETED'),
    tally(22, 'SV-TALLY-PAID', V.paid, 'COMPLETED'),
  ]);
  await ins(VendorFinalPayment, [{
    _id: oid(), ...base(23), paymentNumber: 'SV-FP-1', voucherId: V.partPaid._id, voucherNumber: V.partPaid.voucherNumber,
    invoiceNumber: V.partPaid.invoiceNumber, ...BETA, paymentStatus: 'PART_PAYMENT', paymentDate: day(23), paidAmount: 680, paymentMode: 'NEFT',
  }]);

  console.log(`[seed] ${DB_NAME}: user ${LOGIN.email} / ${LOGIN.password}; ${Object.keys(I).length} indents, ${Object.keys(P).length} POs, `
    + `${Object.keys(PI).length} PIs, 0 advance payments, ${Object.keys(G).length} GRNs, ${Object.keys(Q).length} QCs, `
    + `${Object.keys(V_INV).length + bulk.length} invoices, ${Object.keys(V).length} vouchers`);
  await mongoose.disconnect();
};

// ── HTTP helpers ───────────────────────────────────────────────────────────
let token = '';
const call = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data: json?.data, meta: json?.meta, message: json?.message || '' };
};
const get = async (path) => {
  const r = await call('GET', path);
  if (r.status !== 200) throw new Error(`GET ${path} → ${r.status} ${r.message}`);
  return r;
};
const numbers = (rows, key) => rows.map((r) => r[key]);
const queue = async (key, qs = '') => {
  const r = await get(`/procurement/step-queues/${key}?limit=100${qs}`);
  return { ...r.data, total: r.meta?.total, meta: r.meta };
};

const DB_COUNTS = async () => {
  const models = [PurchaseIndent, VendorPurchaseOrder, PurchaseFollowUp, ProformaInvoice, AdvancePayment, GoodsReceiptNote,
    IncomingQC, VendorInvoice, VendorVoucher, PurchaseTallyEntry, VendorFinalPayment];
  return Object.fromEntries(await Promise.all(models.map(async (m) => [m.modelName, await m.countDocuments()])));
};

// ── API checks ─────────────────────────────────────────────────────────────
const api = async () => {
  await connect();
  const login = await call('POST', '/auth/login', LOGIN);
  token = login.data?.token;
  if (!token) throw new Error(`login failed: ${login.status} ${login.message}`);

  console.log('\nQ  Steps 1.02 / 1.03 — every indent that reached the step, by default');
  const ind = async (qs) => numbers((await get(`/procurement/indents?limit=100&${qs}`)).data, 'indentNumber');
  const q12All = await ind('fmsStep=QUOTE_COMPARATIVE');
  check('1.02 unfiltered = every approved indent (pending, done, not required)',
    same(q12All, ['SV-IND-QP', 'SV-IND-QR', 'SV-IND-QA', 'SV-IND-NR', 'SV-IND-PPO', 'SV-IND-SVC']), q12All.join(','));
  const q13All = await ind('fmsStep=QUOTATION_APPROVAL');
  check('1.03 unfiltered = every indent past 1.02 (the Approved Quotation table is not blank)',
    same(q13All, ['SV-IND-QR', 'SV-IND-QA', 'SV-IND-NR', 'SV-IND-PPO', 'SV-IND-SVC']), q13All.join(','));
  const q13Pending = await ind('fmsStep=QUOTATION_APPROVAL&stepState=PENDING');
  check('1.03 PENDING narrows to the one awaiting approval (the old default)', same(q13Pending, ['SV-IND-QR']), q13Pending.join(','));
  check('1.03 DONE = approved quotations incl. downstream (PO raised, service)',
    same(await ind('fmsStep=QUOTATION_APPROVAL&stepState=DONE'), ['SV-IND-QA', 'SV-IND-PPO', 'SV-IND-SVC']));
  check('1.03 NOT_REQUIRED = the skipped one', same(await ind('fmsStep=QUOTATION_APPROVAL&stepState=NOT_REQUIRED'), ['SV-IND-NR']));
  check('1.02 PENDING = quote pending only', same(await ind('fmsStep=QUOTE_COMPARATIVE&stepState=PENDING'), ['SV-IND-QP']));
  check('draft / rejected indents are on Purchase Indents only',
    !q12All.includes('SV-IND-DRAFT') && !q12All.includes('SV-IND-REJ') && (await ind('')).includes('SV-IND-DRAFT'));
  const stats = (await get('/procurement/indents/stats')).data.quotationSteps;
  for (const step of ['QUOTE_COMPARATIVE', 'QUOTATION_APPROVAL']) {
    const s = stats[step];
    const totals = {
      ALL: (await get(`/procurement/indents?limit=1&fmsStep=${step}`)).meta.total,
      PENDING: (await get(`/procurement/indents?limit=1&fmsStep=${step}&stepState=PENDING`)).meta.total,
    };
    check(`${step} tiles: ALL ${s.ALL} = list total ${totals.ALL}; PENDING ${s.PENDING} = ${totals.PENDING}; states add up`,
      s.ALL === totals.ALL && s.PENDING === totals.PENDING && s.PENDING + s.DONE + s.NOT_REQUIRED === s.ALL, JSON.stringify(s));
  }
  check('1.03 search narrows within the step and paging totals follow',
    (await get('/procurement/indents?limit=1&fmsStep=QUOTATION_APPROVAL&search=SV-IND-Q')).meta.total === 2);

  console.log('\nL  Each step list shows all its records with no filter');
  const lists = [
    ['purchase-orders', 9, 'poStatus=RELEASED_TO_VENDOR', 6],
    ['follow-ups', 3, 'followUpStatus=READY_FOR_GRN', 2],
    ['proforma-invoices', 3, 'piStatus=READY_FOR_ADVANCE_PAYMENT', 2],
    ['advance-payments', 0, null, 0],
    ['grns', 5, 'qcStatus=PENDING', 3],
    ['incoming-qc', 3, 'qcStatus=PASSED', 2],
    ['vendor-invoices', 9 + BULK_AWAITING_VOUCHER + BULK_RECEIVED, 'invoiceStatus=REJECTED', 1],
    ['tally-entries', 4, 'tallyEntryStatus=PENDING', 1],
    ['final-payments', 1, 'paymentStatus=PART_PAYMENT', 1],
  ];
  for (const [path, all, filter, narrowed] of lists) {
    const total = (await get(`/procurement/${path}?limit=1`)).meta.total;
    let line = `${path}: unfiltered ${total} = ${all}`;
    let good = total === all;
    if (filter) {
      const n = (await get(`/procurement/${path}?limit=1&${filter}`)).meta.total;
      line += `; ${filter} → ${n} = ${narrowed}`;
      good = good && n === narrowed;
    }
    check(line, good);
  }

  console.log('\nW  Vendor Invoices workflow chips (server-side)');
  const wf = async (key, qs = '') => get(`/procurement/vendor-invoices?limit=25&workflow=${key}${qs}`);
  const av = await wf('AWAITING_VOUCHER');
  const avExpected = BULK_AWAITING_VOUCHER + 2; // SV-INV-NOVOU + SV-INV-CANCV (cancelled voucher ignored)
  check(`Awaiting Voucher total ${av.meta.total} = ${avExpected}, page 1 full (25 rows)`, av.meta.total === avExpected && av.data.length === 25);
  const av2 = await wf('AWAITING_VOUCHER', '&page=2');
  check(`Awaiting Voucher page 2 = the remaining ${avExpected - 25} rows`, av2.data.length === avExpected - 25);
  const avAll = numbers((await get(`/procurement/vendor-invoices?limit=100&workflow=AWAITING_VOUCHER`)).data, 'invoiceNumber');
  check('Awaiting Voucher includes the invoice whose only voucher was cancelled, excludes invoices with a live voucher',
    avAll.includes('SV-INV-CANCV') && avAll.includes('SV-INV-NOVOU') && !avAll.some((n) => ['SV-INV-ATMD', 'SV-INV-PART', 'SV-INV-POSTED'].includes(n)));
  const ai = await wf('AWAITING_INVOICE');
  check(`Awaiting Invoice Action = draft + received (${2 + BULK_RECEIVED}), not every invoice`, ai.meta.total === 2 + BULK_RECEIVED, `got ${ai.meta.total}`);
  check('Awaiting MD Approval = the invoice whose live voucher is at the MD',
    same(numbers((await wf('AWAITING_MD_APPROVAL')).data, 'invoiceNumber'), ['SV-INV-ATMD']));
  check('Voucher Posted / MD Approved = live voucher MD-approved',
    same(numbers((await wf('VOUCHER_POSTED')).data, 'invoiceNumber'), ['SV-INV-PART', 'SV-INV-POSTED']));
  check('Partially Paid = live voucher partially paid', same(numbers((await wf('PARTIALLY_PAID')).data, 'invoiceNumber'), ['SV-INV-PART']));
  check('workflow + search narrows further', (await wf('AWAITING_VOUCHER', '&search=SV-INV')).meta.total === 2);
  check('unknown workflow refused (422)', (await call('GET', '/procurement/vendor-invoices?workflow=NOPE')).status === 422);
  check('no workflow = every invoice', (await get('/procurement/vendor-invoices?limit=1')).meta.total === 9 + BULK_AWAITING_VOUCHER + BULK_RECEIVED);

  console.log('\nA  Awaiting queues');
  const before = await DB_COUNTS();
  const expectQueue = async (key, expected) => {
    const r = await queue(key);
    const got = Object.fromEntries(r.rows.map((row) => [row.number, row.state]));
    const ids = r.rows.map((row) => `${row.entityType}-${row._id}`);
    check(`${key}: ${JSON.stringify(expected)}`, JSON.stringify(got, Object.keys(got).sort()) === JSON.stringify(expected, Object.keys(expected).sort())
      && r.total === Object.keys(expected).length && new Set(ids).size === ids.length, JSON.stringify(got));
    return r;
  };
  const fuQ = await expectQueue('FOLLOW_UP', { 'SV-PO-NOFU': 'READY' });
  check('FOLLOW_UP row offers Start Follow-up, keeps the PO for the preset, links the PO',
    fuQ.rows[0].action === 'START_FOLLOW_UP' && fuQ.rows[0].record.poNumber === 'SV-PO-NOFU' && fuQ.rows[0].link.startsWith('/procurement/purchase-orders/'));
  const apQ = await expectQueue('ADVANCE_PAYMENT', { 'SV-PI-READY': 'READY', 'SV-PI-ATMD': 'WAITING' });
  const atMd = apQ.rows.find((r) => r.number === 'SV-PI-ATMD');
  check('a PI at the MD is WAITING with no action, labelled', atMd.action === null && atMd.statusLabel === 'Waiting for MD approval');
  const grnQ = await expectQueue('GRN', { 'SV-PO-RDY': 'READY', 'SV-PO-FUDATE': 'READY', 'SV-PO-PART': 'READY', 'SV-PO-NODATE': 'WAITING' });
  check('GRN: no-PI PO is ready (PI optional); PI still pending is not; date from the follow-up counts',
    !grnQ.rows.some((r) => r.number === 'SV-PO-PIP') && grnQ.rows.find((r) => r.number === 'SV-PO-FUDATE').action === 'CREATE_GRN');
  check('GRN: no Final Material Date → WAITING, no Create GRN',
    grnQ.rows.find((r) => r.number === 'SV-PO-NODATE').statusLabel === 'Final Material Date missing' && grnQ.rows.find((r) => r.number === 'SV-PO-NODATE').action === null);
  check('GRN: partly received PO labelled for its next GRN', grnQ.rows.find((r) => r.number === 'SV-PO-PART').statusLabel === 'Partly received — next GRN');
  const qcQ = await expectQueue('INCOMING_QC', { 'SV-GRN-PART': 'READY', 'SV-GRN-QCDRAFT': 'IN_PROGRESS', 'SV-IND-SVC': 'READY' });
  check('QC: service indent row links the indent', qcQ.rows.find((r) => r.number === 'SV-IND-SVC').link.startsWith('/procurement/indents/'));
  await expectQueue('VENDOR_INVOICE', { 'SV-GRN-PASSED': 'READY' });
  await expectQueue('TALLY_ENTRY', { 'SV-VOU-POSTED': 'READY' });
  const fpQ = await expectQueue('FINAL_PAYMENT', { 'SV-VOU-PART': 'READY', 'SV-VOU-TALLIED': 'WAITING' });
  check('final payment: part-paid voucher shows its balance', fpQ.rows.find((r) => r.number === 'SV-VOU-PART').amount === 500
    && fpQ.rows.find((r) => r.number === 'SV-VOU-PART').statusLabel === 'Part paid — balance due');

  const g = (qs) => queue('GRN', qs);
  check('queue search (number) narrows', (await g('&search=nodate')).total === 1);
  check('queue search treats regex characters literally', (await g('&search=.*')).total === 0);
  const byVendor = await g(`&vendor=${encodeURIComponent(BETA.vendorName)}`);
  check('queue vendor filter (name with brackets) narrows', byVendor.total === 1 && byVendor.rows[0].number === 'SV-PO-NODATE');
  check('queue vendor options list every vendor in the queue', same(byVendor.vendors, [ALPHA.vendorName, BETA.vendorName]));
  const waiting = await g('&state=WAITING');
  check('queue state filter narrows; tiles keep every state count', waiting.total === 1 && waiting.stateCounts.READY === 3 && waiting.stateCounts.WAITING === 1);
  check('queue date range narrows (Ready On 13 Oct only)', (await g('&from=2026-10-13&to=2026-10-13')).total === 3);
  const p2 = await get('/procurement/step-queues/GRN?limit=3&page=2');
  check('queue paging: page 2 of 4 at 3/page has 1 row, total 4', p2.data.rows.length === 1 && p2.meta.total === 4 && p2.meta.totalPages === 2);
  check('clearing filters restores the full queue', (await g('')).total === 4);
  check('unknown queue refused (422)', (await call('GET', '/procurement/step-queues/NOPE')).status === 422);
  check('bad state refused (422)', (await call('GET', '/procurement/step-queues/GRN?state=DONE')).status === 422);
  check('no login → 401', (await fetch(`${API}/procurement/step-queues/GRN`)).status === 401);
  check('reading every queue wrote nothing', JSON.stringify(await DB_COUNTS()) === JSON.stringify(before));

  console.log('\nT  A record leaves the queue once its step record exists');
  const po = fuQ.rows[0].record;
  const fuRes = await call('POST', '/procurement/follow-ups', { poId: po._id, followUpType: 'CALL', remarks: 'stepvis e2e' });
  check(`follow-up created for ${po.poNumber} (${fuRes.status})`, fuRes.status < 300, fuRes.message);
  check('… the PO left Awaiting First Follow-up', (await queue('FOLLOW_UP')).total === 0);
  check('… and its follow-up is on the Follow-ups list', (await get('/procurement/follow-ups?limit=100')).data.some((f) => f.poNumber === po.poNumber));

  const vRow = (await queue('TALLY_ENTRY')).rows[0];
  const tRes = await call('POST', '/procurement/tally-entries', { voucherId: vRow._id, statusDone: 'NO' });
  check(`tally entry created for ${vRow.number} (${tRes.status})`, tRes.status < 300, tRes.message);
  check('… the voucher left Awaiting Tally Entry, entry on the list',
    (await queue('TALLY_ENTRY')).total === 0 && (await get('/procurement/tally-entries?limit=100')).data.some((t) => t.voucherNumber === vRow.number));

  const piRow = (await queue('ADVANCE_PAYMENT')).rows.find((r) => r.number === 'SV-PI-READY');
  const aRes = await call('POST', '/procurement/advance-payments', {
    piId: piRow._id, paymentStatus: 'PART_PAYMENT', paymentDate: new Date().toISOString(), paidAmount: 1000, paymentMode: 'NEFT',
  });
  check(`part advance recorded for SV-PI-READY (${aRes.status})`, aRes.status < 300, aRes.message);
  const apAfter = await queue('ADVANCE_PAYMENT');
  const stillReady = apAfter.rows.find((r) => r.number === 'SV-PI-READY');
  check('… a part-paid PI stays awaiting its balance, labelled part paid, balance 4000',
    stillReady?.statusLabel === 'Part paid — balance due' && stillReady?.amount === 4000);
  check('… and the payment is on the Advance Payments list', (await get('/procurement/advance-payments?limit=10')).meta.total === 1);

  console.log(`\n${passes} passed, ${failures} failed`);
  await mongoose.disconnect();
  if (failures) process.exitCode = 1;
};

if (isEntry(import.meta.url)) {
  const run = process.argv.includes('--seed') ? seed : process.argv.includes('--api') ? api : null;
  if (!run) { console.log('usage: --seed | --api'); process.exit(2); }
  run().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => {}); process.exit(1); });
}
