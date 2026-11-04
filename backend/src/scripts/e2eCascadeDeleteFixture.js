/**
 * Fixture + oracle for Purchase FMS cascade delete (modules/procurement/cascade-delete).
 *
 *   node src/scripts/e2eCascadeDeleteFixture.js --seed     drop + seed ambika_e2e_cascade
 *   (guarded backend on that DB:)
 *     AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *     BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= \
 *     PORT=5092 MONGO_URI=mongodb://127.0.0.1:27017/ambika_e2e_cascade node src/scripts/e2eServer.js
 *   API=http://127.0.0.1:5092/api/v1 node src/scripts/e2eCascadeDeleteFixture.js --api
 *   node src/scripts/e2eCascadeDeleteFixture.js --atomic   in-process fault injection (no server needed)
 *
 * --api and --atomic both write: re-seed before re-running either. Replica set:
 * set E2E_CASCADE_URI=mongodb://127.0.0.1:27018/ambika_e2e_cascade?replicaSet=…&directConnection=true
 * for all three steps (and the server's MONGO_URI) — the audit then says TRANSACTION.
 *
 * One independent workflow per scenario (W*), plus W0 that nothing may touch:
 *   W1  1.3 approved → 2 POs, follow-up, 2 PIs, 2 cancelled advances, draft GRN, pending rate change, open task
 *   W2  1.3 approved → PO → PI → PAID advance                       (blocked: money)
 *   W3  PO → follow-up, PI, cancelled advance, completed GRN (no stock), draft QC
 *   W4a PI with a PAID advance (blocked)       W4b PI with a cancelled advance only
 *   W5  draft PO, nothing downstream
 *   W6  PO carrying two indents                                     (blocked: shared)
 *   W7  PO → GRN (stock posted, MD signed) → QC passed → invoice → voucher (posted, MD) → Tally done → paid  (blocked)
 *   W8  PO + PI for the double-click race       W9  PO for "plan changed"
 *   W10 PO + PI for permissions                 W11 1.2 "Quote Not Required" + vendor picked → draft PO
 *   W12 internal-service indent, 1.3 approved → draft service QC
 *   W13 PI with one PART payment (delete the payment itself)
 *   W14 follow-up READY_FOR_GRN with a GRN after it (blocked)
 *   W15 / W16 PO + follow-up + PI for the --atomic rollback runs
 *   W0  sentinel: indent → PO → PI → paid advance (never touched)
 *
 * SAFETY: shared e2e guard (localhost scratch DB whose name contains "e2e", S3 + email off).
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
import RateChangeRequest from '../modules/procurement/rate-change/rateChange.model.js';
import DocumentApproval from '../modules/approvals/approval.model.js';
import Notification from '../modules/notifications/notification.model.js';
import { FmsTask } from '../modules/fms-doers/fmsDoer.model.js';
import PurchaseCascadeDeletion from '../modules/procurement/cascade-delete/cascadeDelete.model.js';

export const DB_NAME = 'ambika_e2e_cascade';
export const E2E_URI = process.env.E2E_CASCADE_URI || `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eCascadeDeleteFixture.js');

const API = (process.env.API || 'http://127.0.0.1:5092/api/v1').replace(/\/+$/, '');
const PASSWORD = 'E2e@12345';
export const USERS = {
  MD:      { email: 'cascade-md-e2e@test.local',      name: 'Cascade MD',      role: 'MD', roles: ['MD'], permissionGrants: [], mobile: '9000000091' },
  BUYER:   { email: 'cascade-buyer-e2e@test.local',   name: 'Cascade Buyer',   role: 'EA', roles: ['VIEWER'], permissionGrants: [], mobile: '9000000092' },
  LIMITED: { email: 'cascade-limited-e2e@test.local', name: 'Cascade Limited', role: 'EA', roles: ['VIEWER'], permissionGrants: ['procurement.deletePurchaseOrder'], mobile: '9000000093' },
};

let passes = 0; let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${detail}` : ''}`);
};
const section = (t) => console.log(`\n${t}`);

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

// ── Seed ───────────────────────────────────────────────────────────────────
const VENDOR = new mongoose.Types.ObjectId();
const day = (n) => new Date(Date.UTC(2026, 9, 1 + n, 6));
const file = (name) => ({ fileName: name, fileUrl: `http://127.0.0.1/uploads/e2e/${name}`, fileType: 'application/pdf', uploadedAt: day(1) });

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  const users = {};
  for (const [k, u] of Object.entries(USERS)) {
    users[k] = await User.create({ ...u, password: PASSWORD, isActive: true });
  }
  const by = users.BUYER._id;

  const mkIndent = async (tag, { step12 = 'YES', step13 = 'YES', status = 'QUOTATION_APPROVED', service = false, vendorSource = 'APPROVED_QUOTATION' } = {}) => {
    const notRequired = step12 === 'QUOTE_NOT_REQUIRED';
    return PurchaseIndent.create({
      indentNumber: `Ind-CD-${tag}`, approvalStatus: 'APPROVED', createdBy: by, raisedBy: 'Cascade Buyer', department: 'Stores',
      requestType: service ? 'INTERNAL_SERVICE' : 'MATERIAL_PURCHASE',
      items: [{
        itemName: `Item ${tag}`, quantity: 10, unit: 'Pcs', approvalStatus: 'APPROVED', revisedQuantity: 10, approvedQuantity: 10, itemLineNo: 1,
        vendorId: VENDOR, vendorName: 'Cascade Vendor', vendorSource, vendorSelectedAt: day(2),
      }],
      quoteStep: { plannedAt: day(3), actualAt: day(2), status: notRequired ? 'NOT_REQUIRED' : 'RECEIVED' },
      quoteComparativeStep: { statusDone: step12, actualAt: day(2), quotationDocuments: notRequired ? [] : [file(`quote-${tag}.pdf`)] },
      quotationApprovalStep: notRequired
        ? { statusDone: null, skipped: true, skippedReason: 'Quotation Not Required', actualAt: day(2) }
        : (step13 === 'YES' ? { statusDone: 'YES', actualAt: day(3), approvedQuotationDocuments: [file(`approved-${tag}.pdf`)] } : {}),
      overallStatus: status,
    });
  };
  const mkPo = async (tag, indents, { draft = false, released = false, status } = {}) => {
    const list = Array.isArray(indents) ? indents : [indents];
    const po = await VendorPurchaseOrder.create({
      ...(draft ? { draftNumber: `DRAFT-CD-${tag}` } : { poNumber: `PO-CD-${tag}` }),
      indentId: list[0]._id, indentIds: list.map((i) => i._id), indentNumber: list[0].indentNumber,
      vendorId: VENDOR, vendorName: 'Cascade Vendor', createdBy: by,
      approvalStatus: draft ? 'DRAFT' : 'APPROVED', poStatus: status || (draft ? 'DRAFT' : (released ? 'RELEASED_TO_VENDOR' : 'APPROVED')),
      releaseStatus: released ? 'RELEASED' : 'NOT_RELEASED',
      items: list.map((i) => ({ indentId: i._id, indentItemId: i.items[0]._id, itemName: i.items[0].itemName, quantity: 10, unit: 'Pcs', rate: 100, gstRate: 18 })),
      grandTotal: 1180 * list.length,
    });
    for (const i of list) {
      await PurchaseIndent.updateOne({ _id: i._id, 'items._id': i.items[0]._id }, {
        $set: { 'items.$.poId': po._id, 'items.$.poNumber': po.poNumber || po.draftNumber, 'items.$.procurementStatus': 'PO_CREATED', overallStatus: 'PO_READY' },
      });
    }
    return po;
  };
  const mkFu = (tag, po, status = 'PENDING', active = false) => PurchaseFollowUp.create({
    followUpNumber: `FU-CD-${tag}`, poId: po._id, poNumber: po.poNumber || po.draftNumber, indentId: po.indentId, vendorId: VENDOR,
    plannedAt: day(5), followUpStatus: status, isActiveFollowUp: active, createdBy: by,
  });
  const mkPi = async (tag, po, { status = 'READY_FOR_ADVANCE_PAYMENT', approval = 'APPROVED', md = 'MD_APPROVED', paid = 0 } = {}) => {
    const pi = await ProformaInvoice.create({
      piNumber: `PI-CD-${tag}`, poId: po._id, poNumber: po.poNumber, indentId: po.indentId, vendorId: VENDOR, vendorName: 'Cascade Vendor',
      items: [{ itemName: 'Item', quantity: 10, rate: 100 }], piStatus: status, approvalStatus: approval, mdApprovalStatus: md,
      totalValue: 1180, paidAmount: paid, balanceAmount: 1180 - paid, createdBy: by,
    });
    await VendorPurchaseOrder.updateOne({ _id: po._id }, { $set: { piId: pi._id, piNumber: pi.piNumber, piStatus: status === 'DRAFT' ? 'PI_RECEIVED' : 'READY_FOR_ADVANCE_PAYMENT' } });
    return pi;
  };
  const mkAdv = (tag, pi, status, amount, n = 1) => AdvancePayment.create({
    paymentNumber: `ADV-CD-${tag}${n > 1 ? `-${n}` : ''}`, piId: pi._id, piNumber: pi.piNumber, poId: pi.poId, vendorId: VENDOR,
    paymentStatus: status, paymentDate: day(6 + n), paidAmount: amount, paymentMode: 'NEFT', paymentReferenceNumber: `UTR-CD-${tag}-${n}`,
    previousBalance: 1180, balanceAmount: 1180 - amount, createdBy: by,
  });
  const mkGrn = (tag, po, { status = 'DRAFT', lines = [{ stockStatus: 'AWAITING_QC' }], md = 'NOT_REQUIRED', poIds } = {}) => GoodsReceiptNote.create({
    grnNumber: `GRN-CD-${tag}`, poId: po._id, poIds: poIds || [po._id], poNumber: po.poNumber, indentId: po.indentId, vendorId: VENDOR,
    grnStatus: status, approvalStatus: md, qcStatus: 'PENDING', createdBy: by,
    items: lines.map((l) => ({ itemName: 'Item', receivedQty: 10, poItemId: po.items[0]._id, ...l })),
  });
  const mkQc = (tag, grn, status = 'DRAFT', extra = {}) => IncomingQC.create({
    qcNumber: `QC-CD-${tag}`, grnId: grn?._id, poId: grn?.poId, indentId: grn?.indentId, vendorId: VENDOR, qcStatus: status, sourceType: 'GRN',
    items: [{ itemName: 'Item', receivedQty: 10 }], createdBy: by, ...extra,
  });

  // W0 — sentinel, never touched by any scenario.
  const i0 = await mkIndent('W0');
  const po0 = await mkPo('W0', i0, { released: true });
  const pi0 = await mkPi('W0', po0);
  await mkAdv('W0', pi0, 'FULL_PAYMENT', 1180);
  await mkFu('W0', po0, 'PENDING', true);

  // W1 — the Quotation Approval example.
  const i1 = await mkIndent('W1');
  const po1 = await mkPo('W1', i1, { released: false });
  const po1b = await mkPo('W1B', i1, { draft: true });
  await mkFu('W1', po1);
  const pi1 = await mkPi('W1', po1);
  const pi1b = await mkPi('W1B', po1b, { status: 'DRAFT', approval: 'PENDING', md: 'NOT_REQUIRED' });
  await mkAdv('W1', pi1, 'CANCELLED', 0, 1);
  await mkAdv('W1', pi1, 'CANCELLED', 0, 2);
  await mkGrn('W1', po1);
  await RateChangeRequest.create({
    requestNumber: 'RC-CD-W1', vendorId: VENDOR, requestedRate: 120, poId: po1b._id, poLineId: po1b.items[0]._id, reason: 'E2E', status: 'PENDING', requestedBy: by,
  });
  await FmsTask.create({ fmsKey: 'PURCHASE', stepKey: 'PO_RELEASE', stepCode: '1.4B', entityType: 'PO', entityId: po1._id, entityRef: po1.poNumber, status: 'OPEN' });
  await DocumentApproval.create({ documentType: 'PROFORMA_INVOICE', documentId: pi1._id, documentNumber: pi1.piNumber, levels: [{ order: 1, roleKey: 'MD' }], status: 'APPROVED' });
  void pi1b;

  // W2 — paid advance blocks.
  const i2 = await mkIndent('W2');
  const po2 = await mkPo('W2', i2, { released: true });
  const pi2 = await mkPi('W2', po2, { paid: 500 });
  await mkAdv('W2', pi2, 'PART_PAYMENT', 500);

  // W3 — delete a PO with eligible downstream records.
  const i3 = await mkIndent('W3');
  const po3 = await mkPo('W3', i3, { released: true });
  await mkFu('W3', po3, 'READY_FOR_GRN');
  const pi3 = await mkPi('W3', po3);
  await mkAdv('W3', pi3, 'CANCELLED', 0);
  const grn3 = await mkGrn('W3', po3, { status: 'FULLY_RECEIVED' });
  await mkQc('W3', grn3, 'DRAFT');

  // W4a — PI with a paid advance; W4b — PI with a cancelled advance only.
  const i4a = await mkIndent('W4A');
  const po4a = await mkPo('W4A', i4a, { released: true });
  const pi4a = await mkPi('W4A', po4a, { paid: 1180, status: 'PAYMENT_COMPLETED' });
  await mkAdv('W4A', pi4a, 'FULL_PAYMENT', 1180);
  const i4b = await mkIndent('W4B');
  const po4b = await mkPo('W4B', i4b, { released: true });
  const pi4b = await mkPi('W4B', po4b);
  await mkAdv('W4B', pi4b, 'CANCELLED', 0);

  // W5 — nothing downstream.
  const i5 = await mkIndent('W5');
  await mkPo('W5', i5, { draft: true });

  // W6 — one PO for two indents.
  const i6a = await mkIndent('W6A');
  const i6b = await mkIndent('W6B');
  await mkPo('W6', [i6a, i6b], { released: true });

  // W7 — money, stock, Tally and signatures.
  const i7 = await mkIndent('W7');
  const po7 = await mkPo('W7', i7, { released: true, status: 'FULLY_RECEIVED' });
  const grn7 = await mkGrn('W7', po7, { status: 'FULLY_RECEIVED', md: 'MD_APPROVED', lines: [{ stockStatus: 'POSTED', movementId: new mongoose.Types.ObjectId() }] });
  const qc7 = await mkQc('W7', grn7, 'PASSED');
  const inv7 = await VendorInvoice.create({
    invoiceNumber: 'INV-CD-W7', qcId: qc7._id, grnId: grn7._id, grnIds: [grn7._id], qcIds: [qc7._id], poId: po7._id, vendorId: VENDOR, invoiceStatus: 'PAYMENT_PENDING', createdBy: by,
  });
  const v7 = await VendorVoucher.create({
    voucherNumber: 'PV-CD-W7', invoiceId: inv7._id, poId: po7._id, vendorId: VENDOR, voucherStatus: 'POSTED', approvalStatus: 'MD_APPROVED', tallyEntryStatus: 'COMPLETED', createdBy: by,
  });
  await PurchaseTallyEntry.create({ entryNumber: 'TLY-CD-W7', voucherId: v7._id, invoiceId: inv7._id, poId: po7._id, tallyEntryStatus: 'COMPLETED', createdBy: by });
  await VendorFinalPayment.create({ paymentNumber: 'PAY-CD-W7', voucherId: v7._id, invoiceId: inv7._id, poId: po7._id, paymentStatus: 'FULL_PAYMENT', paidAmount: 1180, createdBy: by });

  // W8 (race), W9 (plan changed), W10 (permissions).
  const i8 = await mkIndent('W8');
  const po8 = await mkPo('W8', i8, { released: true });
  await mkPi('W8', po8);
  const i9 = await mkIndent('W9');
  await mkPo('W9', i9, { released: true });
  const i10 = await mkIndent('W10');
  const po10 = await mkPo('W10', i10, { released: true });
  await mkPi('W10', po10);

  // W11 — 1.2 "Quote Not Required", vendor picked at PO preparation, draft PO.
  const i11 = await mkIndent('W11', { step12: 'QUOTE_NOT_REQUIRED', vendorSource: 'PO_PREPARATION' });
  await mkPo('W11', i11, { draft: true });

  // W12 — internal service: 1.3 approved → service QC in draft.
  const i12 = await mkIndent('W12', { service: true, status: 'SERVICE_PENDING', vendorSource: '' });
  await IncomingQC.create({
    qcNumber: 'QC-CD-W12', indentId: i12._id, sourceType: 'SERVICE', qcStatus: 'DRAFT', vendorId: VENDOR, items: [{ itemName: 'Service', receivedQty: 1 }], createdBy: by,
  });

  // W13 — one part payment on a PI (deleted on its own).
  const i13 = await mkIndent('W13');
  const po13 = await mkPo('W13', i13, { released: true });
  const pi13 = await mkPi('W13', po13, { paid: 400 });
  await mkAdv('W13', pi13, 'PART_PAYMENT', 400);
  await ProformaInvoice.updateOne({ _id: pi13._id }, { $set: { balanceAmount: 780 } });
  await AdvancePayment.updateOne({ paymentNumber: 'ADV-CD-W13' }, { $set: { previousBalance: 1180, balanceAmount: 780 } });

  // W14 — follow-up that made the PO ready, GRN after it.
  const i14 = await mkIndent('W14');
  const po14 = await mkPo('W14', i14, { released: true });
  await mkFu('W14', po14, 'READY_FOR_GRN');
  await mkGrn('W14', po14, { status: 'RECEIVED' });

  // W15 / W16 — for --atomic.
  for (const tag of ['W15', 'W16']) {
    const i = await mkIndent(tag);
    const po = await mkPo(tag, i, { released: true });
    await mkFu(tag, po);
    await mkPi(tag, po);
  }

  console.log(`[seed] ${DB_NAME} on ${E2E_URI.replace(/\?.*/, '')}: MD ${USERS.MD.email} / ${PASSWORD}`);
  for (const M of [PurchaseIndent, VendorPurchaseOrder, PurchaseFollowUp, ProformaInvoice, AdvancePayment, GoodsReceiptNote, IncomingQC]) {
    console.log(`  ${M.modelName.padEnd(22)} ${await M.countDocuments()}`);
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
  return { status: res.status, data: json?.data, message: json?.message || '' };
};
const login = async (u) => (await call('POST', '/auth/login', { email: u.email, password: PASSWORD })).data?.token;
const preview = (type, id, token) => call('GET', `/procurement/cascade-delete/${type}/${id}/preview`, undefined, token);
const execute = (type, id, body, token) => call('POST', `/procurement/cascade-delete/${type}/${id}`, body, token);
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const ids = {};
const load = async () => {
  const one = async (M, f) => M.findOne(f).lean();
  ids.i = async (tag) => one(PurchaseIndent, { indentNumber: `Ind-CD-${tag}` });
  ids.po = async (tag) => one(VendorPurchaseOrder, { $or: [{ poNumber: `PO-CD-${tag}` }, { draftNumber: `DRAFT-CD-${tag}` }] });
  ids.pi = async (tag) => one(ProformaInvoice, { piNumber: `PI-CD-${tag}` });
  ids.fu = async (tag) => one(PurchaseFollowUp, { followUpNumber: `FU-CD-${tag}` });
  ids.adv = async (n) => one(AdvancePayment, { paymentNumber: n });
  ids.grn = async (tag) => one(GoodsReceiptNote, { grnNumber: `GRN-CD-${tag}` });
  ids.qc = async (tag) => one(IncomingQC, { qcNumber: `QC-CD-${tag}` });
};
const groupCount = (plan, type) => plan?.affected?.find((g) => g.type === type)?.count || 0;
const groupTypes = (plan) => (plan?.affected || []).map((g) => `${g.type}:${g.count}`).join(' ');
const blockerTypes = (plan) => [...new Set((plan?.blockers || []).map((b) => b.type))].sort();
const preservedTypes = (plan) => (plan?.preserved || []).map((g) => g.type);

/** A fingerprint of every document outside `except` — must not move. */
const MODELS = [PurchaseIndent, VendorPurchaseOrder, PurchaseFollowUp, ProformaInvoice, AdvancePayment, GoodsReceiptNote, IncomingQC,
  VendorInvoice, VendorVoucher, PurchaseTallyEntry, VendorFinalPayment];
const snapshotAll = async () => {
  const m = new Map();
  for (const M of MODELS) {
    for (const d of await M.find().select('updatedAt isDeleted __v').lean()) m.set(`${M.modelName}:${d._id}`, `${d.isDeleted}|${d.__v}|${d.updatedAt?.getTime()}`);
  }
  return m;
};
const changedSince = (before, after) => [...after].filter(([k, v]) => before.get(k) !== v).map(([k]) => k);
const NUMBER_FIELD = {
  PurchaseIndent: 'indentNumber', PurchaseFollowUp: 'followUpNumber', ProformaInvoice: 'piNumber', AdvancePayment: 'paymentNumber',
  GoodsReceiptNote: 'grnNumber', IncomingQC: 'qcNumber', VendorInvoice: 'invoiceNumber', VendorVoucher: 'voucherNumber',
  PurchaseTallyEntry: 'entryNumber', VendorFinalPayment: 'paymentNumber',
};
const numberOfDoc = async (key) => {
  const [model, id] = key.split(':');
  const d = await mongoose.model(model).findById(id).lean();
  if (model === 'VendorPurchaseOrder') return d?.poNumber || d?.draftNumber || key;
  return d?.[NUMBER_FIELD[model]] || key;
};

const api = async () => {
  await connect();
  await load();
  const md = await login(USERS.MD);
  const limited = await login(USERS.LIMITED);
  check('MD and limited user log in', Boolean(md && limited));
  const buyer = await User.findOne({ email: USERS.BUYER.email }).lean();
  const before0 = await snapshotAll();

  // ── S1 Quotation Approval with eligible downstream records ──
  section('S1  Delete Quotation Approval (Step 1.3) — preserve Indent + 1.2, delete POs / PIs / advances / follow-up / GRN');
  const i1 = await ids.i('W1');
  const p1 = await preview('QUOTATION_APPROVAL', i1._id, md);
  const plan1 = p1.data;
  check('preview 200', p1.status === 200, `${p1.status} ${p1.message}`);
  check('affected: 1.3 ×1, PO ×2, follow-up ×1, PI ×2, advance ×2, GRN ×1',
    groupTypes(plan1) === 'QUOTATION_APPROVAL:1 PO:2 FOLLOW_UP:1 PI:2 ADVANCE_PAYMENT:2 GRN:1', groupTypes(plan1));
  check('9 records in total, 8 downstream', plan1?.totalRecords === 9 && plan1?.downstreamCount === 8, `${plan1?.totalRecords}/${plan1?.downstreamCount}`);
  check('preserved: Indent and Receive Quote & Make Comparative (not 1.3)',
    JSON.stringify(preservedTypes(plan1)) === JSON.stringify(['INDENT', 'QUOTE_COMPARATIVE']), JSON.stringify(preservedTypes(plan1)));
  check('no blockers, can delete, reason required', plan1?.blockers.length === 0 && plan1?.canDelete && plan1?.reasonRequired);
  check('effects: indent back to Step 1.3, rate change withdrawn, task closed, MD history kept',
    /back to Step 1\.3/.test(plan1?.effects.join(' ')) && /rate change/.test(plan1?.effects.join(' '))
    && /FMS task/.test(plan1?.effects.join(' ')) && /MD approval/.test(plan1?.effects.join(' ')), plan1?.effects.join(' | '));
  const snapPreview = await snapshotAll();
  check('preview (and closing the modal) changes nothing', changedSince(before0, snapPreview).length === 0, changedSince(before0, snapPreview).join(', '));

  section('S6/S7  Confirmation cannot be bypassed — nothing is deleted');
  const body1 = { reason: 'Quotation approved for the wrong vendor', acknowledged: true, planToken: plan1.planToken };
  const noAck = await execute('QUOTATION_APPROVAL', i1._id, { ...body1, acknowledged: undefined }, md);
  check('no acknowledgement → 422', noAck.status === 422, `${noAck.status} ${noAck.message}`);
  const falseAck = await execute('QUOTATION_APPROVAL', i1._id, { ...body1, acknowledged: false }, md);
  check('checkbox unticked (acknowledged:false) → 422', falseAck.status === 422, `${falseAck.status} ${falseAck.message}`);
  const noToken = await execute('QUOTATION_APPROVAL', i1._id, { reason: body1.reason, acknowledged: true }, md);
  check('no preview token → 422', noToken.status === 422, `${noToken.status}`);
  const badToken = await execute('QUOTATION_APPROVAL', i1._id, { ...body1, planToken: 'x'.repeat(32) }, md);
  check('a token from another preview → 409 PLAN_CHANGED', badToken.status === 409 && badToken.data?.code === 'PLAN_CHANGED', `${badToken.status} ${JSON.stringify(badToken.data)}`);
  const noReason = await execute('QUOTATION_APPROVAL', i1._id, { ...body1, reason: ' ' }, md);
  check('no reason → 400', noReason.status === 400, `${noReason.status} ${noReason.message}`);
  const snapRefused = await snapshotAll();
  check('every refused attempt changed nothing', changedSince(before0, snapRefused).length === 0, changedSince(before0, snapRefused).join(', '));

  section('S1/S8  Confirm — only the listed records go');
  const ok1 = await execute('QUOTATION_APPROVAL', i1._id, body1, md);
  check('execute 200', ok1.status === 200, `${ok1.status} ${ok1.message}`);
  check('result: 9 deleted, 8 downstream', ok1.data?.deletedCount === 9 && ok1.data?.downstreamCount === 8, JSON.stringify(ok1.data?.affected));
  const after1 = await snapshotAll();
  const changed1 = changedSince(before0, after1);
  const expected1 = ['PO-CD-W1', 'DRAFT-CD-W1B', 'FU-CD-W1', 'PI-CD-W1', 'PI-CD-W1B', 'ADV-CD-W1', 'ADV-CD-W1-2', 'GRN-CD-W1', 'Ind-CD-W1'];
  const changedNums = await Promise.all(changed1.map(numberOfDoc));
  check('exactly the 8 listed records + the indent changed (nothing else in the DB)',
    changedNums.length === expected1.length && expected1.every((n) => changedNums.includes(n)), changedNums.sort().join(', '));
  const dels = await Promise.all([ids.po('W1'), ids.po('W1B'), ids.fu('W1'), ids.pi('W1'), ids.pi('W1B'), ids.adv('ADV-CD-W1'), ids.adv('ADV-CD-W1-2'), ids.grn('W1')]);
  check('all 8 downstream records soft-deleted with deletedBy + a DELETE history line naming the step',
    dels.every((d) => d.isDeleted && d.deletedBy && d.activityTimeline.some((t) => t.action === 'DELETE' && /Quotation Approval Ind-CD-W1/.test(t.description))),
    dels.map((d) => `${d.isDeleted}`).join(','));
  const i1a = await ids.i('W1');
  check('indent kept, back at Step 1.3 (QUOTE_RECEIVED)', !i1a.isDeleted && i1a.overallStatus === 'QUOTE_RECEIVED', i1a.overallStatus);
  check('Step 1.2 quotes kept', i1a.quoteComparativeStep.statusDone === 'YES' && i1a.quoteComparativeStep.quotationDocuments.length === 1);
  check('Step 1.3 cleared', !i1a.quotationApprovalStep.statusDone && !i1a.quotationApprovalStep.approvedQuotationDocuments?.length);
  check('item vendor (from the approval) and PO link cleared',
    !i1a.items[0].vendorId && !i1a.items[0].vendorSource && !i1a.items[0].poId && i1a.items[0].procurementStatus === 'PENDING');
  check('indent history says why', i1a.activityTimeline.some((t) => t.action === 'DELETE_QUOTATION_APPROVAL' && /wrong vendor/.test(t.description)));
  const rc = await RateChangeRequest.findOne({ requestNumber: 'RC-CD-W1' }).lean();
  check('pending rate change request withdrawn', rc?.status === 'WITHDRAWN', rc?.status);
  const audit1 = await PurchaseCascadeDeletion.findOne({ rootId: i1._id }).lean();
  check('audit row: COMPLETED, who, when, why, 9 records, preserved steps',
    audit1?.status === 'COMPLETED' && String(audit1.initiatedBy) && audit1.initiatedByName === 'Cascade MD' && audit1.finishedAt
    && /wrong vendor/.test(audit1.reason) && audit1.deleted.length === 9 && audit1.preserved.length >= 2 && audit1.rootSnapshot?.quotationApprovalStep?.statusDone === 'YES',
    JSON.stringify({ s: audit1?.status, n: audit1?.deleted?.length }));
  console.log(`        (atomic mode: ${audit1?.atomicMode})`);
  const hist = await call('GET', `/procurement/cascade-delete/history?recordId=${dels[0]._id}`, undefined, md);
  check('history endpoint finds the deletion by a downstream record', hist.status === 200 && hist.data?.length === 1 && hist.data[0].rootType === 'QUOTATION_APPROVAL');
  const note = await Notification.findOne({ userId: buyer._id, title: /Quotation Approval Ind-CD-W1 deleted/ }).lean();
  check('the records\' creator is notified', Boolean(note) && /8 downstream/.test(note.body), note?.body);
  let task = null;
  for (let k = 0; k < 20; k += 1) {
    task = await FmsTask.findOne({ entityId: dels[0]._id, stepKey: 'PO_RELEASE' }).lean();
    if (task?.status !== 'OPEN') break;
    await sleep(500);
  }
  check('open FMS task on the deleted PO closed ("Item deleted")', task?.status === 'CLOSED' && task.closedReason === 'Item deleted', `${task?.status} ${task?.closedReason}`);
  const again = await execute('QUOTATION_APPROVAL', i1._id, body1, md);
  check('running it again is refused (step no longer done) — 400', again.status === 400, `${again.status} ${again.message}`);
  const apprRow = await DocumentApproval.findOne({ documentId: dels[3]._id }).lean();
  check('MD approval row of the deleted PI kept for audit', Boolean(apprRow) && !apprRow.isDeleted);

  // ── S2 paid advance blocks ──
  section('S2/S9  Quotation Approval with a PAID advance downstream — blocked, nothing changes');
  const snap2 = await snapshotAll();
  const i2 = await ids.i('W2');
  const p2 = (await preview('QUOTATION_APPROVAL', i2._id, md)).data;
  check('blocked by the advance payment (money)', !p2.canDelete && JSON.stringify(blockerTypes(p2)) === '["ADVANCE_PAYMENT"]'
    && /₹500 is recorded as paid/.test(p2.blockers[0].reason) && p2.blockers[0].action, JSON.stringify(p2.blockers));
  const x2 = await execute('QUOTATION_APPROVAL', i2._id, { reason: 'try', acknowledged: true, planToken: p2.planToken }, md);
  check('execute → 409 BLOCKED with the blockers', x2.status === 409 && x2.data?.code === 'BLOCKED' && x2.data.blockers.length === 1, `${x2.status} ${x2.message}`);
  check('nothing changed', changedSince(snap2, await snapshotAll()).length === 0);

  // ── S3 delete a PO ──
  section('S3  Delete PO — preserve indent + quotation steps; delete follow-up, PI, cancelled advance, GRN (no stock), draft QC');
  const po3 = await ids.po('W3');
  const p3 = (await preview('PO', po3._id, md)).data;
  check('affected: PO, follow-up, PI, advance, GRN, QC',
    groupTypes(p3) === 'PO:1 FOLLOW_UP:1 PI:1 ADVANCE_PAYMENT:1 GRN:1 INCOMING_QC:1', groupTypes(p3));
  check('preserved: Indent, 1.2, 1.3', JSON.stringify(preservedTypes(p3)) === JSON.stringify(['INDENT', 'QUOTE_COMPARATIVE', 'QUOTATION_APPROVAL']), JSON.stringify(preservedTypes(p3)));
  check('completed GRN carries a "no stock posted" note', p3.affected.find((g) => g.type === 'GRN').records[0].warnings.some((w) => /no stock/.test(w)));
  const snap3 = await snapshotAll();
  const x3 = await execute('PO', po3._id, { reason: 'Raised against the wrong indent', acknowledged: true, planToken: p3.planToken }, md);
  check('execute 200, 6 deleted', x3.status === 200 && x3.data.deletedCount === 6, `${x3.status} ${x3.message}`);
  const d3 = await Promise.all([ids.po('W3'), ids.fu('W3'), ids.pi('W3'), ids.adv('ADV-CD-W3'), ids.grn('W3'), ids.qc('W3')]);
  check('PO, follow-up, PI, advance, GRN, QC all deleted', d3.every((d) => d.isDeleted), d3.map((d) => d.isDeleted).join(','));
  const i3 = await ids.i('W3');
  check('indent kept, its item free again (QUOTATION_APPROVED, no PO link), 1.3 kept',
    !i3.isDeleted && i3.overallStatus === 'QUOTATION_APPROVED' && !i3.items[0].poId && i3.quotationApprovalStep.statusDone === 'YES', i3.overallStatus);
  const ch3 = await Promise.all(changedSince(snap3, await snapshotAll()).map(numberOfDoc));
  check('only those 6 + the indent changed', ch3.length === 7 && ch3.includes('Ind-CD-W3'), ch3.join(', '));

  // ── S4 delete a PI ──
  section('S4  Delete PI — a paid advance blocks; a cancelled one goes with the PI, the PO is kept');
  const pi4a = await ids.pi('W4A');
  const p4a = (await preview('PI', pi4a._id, md)).data;
  check('PI with a paid advance: blocked by ADVANCE_PAYMENT', !p4a.canDelete && JSON.stringify(blockerTypes(p4a)) === '["ADVANCE_PAYMENT"]', JSON.stringify(p4a.blockers));
  const pi4b = await ids.pi('W4B');
  const p4b = (await preview('PI', pi4b._id, md)).data;
  check('PI with a cancelled advance: PI + advance, PO and indent preserved',
    groupTypes(p4b) === 'PI:1 ADVANCE_PAYMENT:1' && preservedTypes(p4b).includes('PO') && preservedTypes(p4b).includes('INDENT'), `${groupTypes(p4b)} / ${preservedTypes(p4b)}`);
  check('effect: PO goes back to "no PI"', /PO-CD-W4B goes back to "no PI"/.test(p4b.effects.join(' ')), p4b.effects.join(' | '));
  const x4b = await execute('PI', pi4b._id, { reason: 'Duplicate PI', acknowledged: true, planToken: p4b.planToken }, md);
  check('execute 200', x4b.status === 200, x4b.message);
  const po4b = await ids.po('W4B');
  check('PO kept with piStatus NOT_RECEIVED and no PI link', !po4b.isDeleted && po4b.piStatus === 'NOT_RECEIVED' && !po4b.piId, `${po4b.piStatus}`);
  check('advance deleted', (await ids.adv('ADV-CD-W4B')).isDeleted);

  // ── S5 no downstream ──
  section('S5  A step with no downstream records');
  const po5 = await ids.po('W5');
  const p5 = (await preview('PO', po5._id, md)).data;
  check('only the PO, no reason needed (draft)', p5.totalRecords === 1 && p5.downstreamCount === 0 && !p5.reasonRequired, JSON.stringify(p5.affected));
  const x5 = await execute('PO', po5._id, { acknowledged: true, planToken: p5.planToken }, md);
  check('execute 200 without a reason', x5.status === 200, x5.message);
  check('draft PO deleted, indent item free again', (await ids.po('W5')).isDeleted && !(await ids.i('W5')).items[0].poId);

  // ── S6 shared PO ──
  section('S6  A PO shared with another indent blocks the quotation-step delete');
  const i6 = await ids.i('W6A');
  const p6 = (await preview('QUOTATION_APPROVAL', i6._id, md)).data;
  check('blocked: PO also belongs to Ind-CD-W6B', !p6.canDelete && p6.blockers.some((b) => b.type === 'PO' && /Ind-CD-W6B/.test(b.reason)), JSON.stringify(p6.blockers));

  // ── S7 money, stock, Tally, signatures ──
  section('S7  Delete a PO with stock, MD signatures, Tally and payments downstream — blocked');
  const snap7 = await snapshotAll();
  const po7 = await ids.po('W7');
  const p7 = (await preview('PO', po7._id, md)).data;
  check('blockers: GRN (stock/MD), QC (stock), voucher (posted/MD), Tally (done), final payment (paid)',
    JSON.stringify(blockerTypes(p7)) === JSON.stringify(['FINAL_PAYMENT', 'GRN', 'INCOMING_QC', 'TALLY_ENTRY', 'VOUCHER']), JSON.stringify(blockerTypes(p7)));
  check('every blocker says what to do', p7.blockers.every((b) => b.reason && b.action));
  const x7 = await execute('PO', po7._id, { reason: 'x'.repeat(5), acknowledged: true, planToken: p7.planToken }, md);
  check('execute → 409, nothing changed', x7.status === 409 && changedSince(snap7, await snapshotAll()).length === 0, `${x7.status}`);
  const pQc = (await preview('INCOMING_QC', (await ids.qc('W7'))._id, md)).data;
  check('a completed QC itself cannot be deleted (stock)', !pQc.canDelete && pQc.blockers.some((b) => b.type === 'INCOMING_QC'));

  // ── S10 race ──
  section('S10  Double click / two users at once — one deletion, never two');
  const po8 = await ids.po('W8');
  const p8 = (await preview('PO', po8._id, md)).data;
  const b8 = { reason: 'Race test', acknowledged: true, planToken: p8.planToken };
  const race = await Promise.all([execute('PO', po8._id, b8, md), execute('PO', po8._id, b8, md), execute('PO', po8._id, b8, md)]);
  const codes = race.map((r) => r.status).sort();
  check('exactly one 200, the others refused', codes.filter((c) => c === 200).length === 1 && codes.every((c) => [200, 404, 409].includes(c)), codes.join(','));
  const pi8 = await ids.pi('W8');
  check('PI deleted once (one DELETE history line)', pi8.isDeleted && pi8.activityTimeline.filter((t) => t.action === 'DELETE').length === 1);
  check('one COMPLETED audit row, no RUNNING left', (await PurchaseCascadeDeletion.countDocuments({ rootId: po8._id, status: 'COMPLETED' })) === 1
    && (await PurchaseCascadeDeletion.countDocuments({ status: 'RUNNING' })) === 0);

  // ── S11 plan changed ──
  section('S11  Something new rests on the record after the preview — refused, nothing deleted');
  const po9 = await ids.po('W9');
  const p9 = (await preview('PO', po9._id, md)).data;
  await PurchaseFollowUp.create({ followUpNumber: 'FU-CD-W9-LATE', poId: po9._id, plannedAt: day(9), followUpStatus: 'PENDING', isActiveFollowUp: false });
  const x9 = await execute('PO', po9._id, { reason: 'stale', acknowledged: true, planToken: p9.planToken }, md);
  check('409 PLAN_CHANGED', x9.status === 409 && x9.data?.code === 'PLAN_CHANGED', `${x9.status} ${x9.message}`);
  check('PO and the new follow-up still live', !(await ids.po('W9')).isDeleted && !(await PurchaseFollowUp.findOne({ followUpNumber: 'FU-CD-W9-LATE' })).isDeleted);
  const p9b = (await preview('PO', po9._id, md)).data;
  check('a fresh preview lists the new follow-up', groupCount(p9b, 'FOLLOW_UP') === 1);

  // ── S12 permissions ──
  section('S12  Every downstream record needs its own delete permission');
  const po10 = await ids.po('W10');
  const p10 = await preview('PO', po10._id, limited);
  check('limited user: preview lists the missing PI permission', p10.status === 200 && !p10.data.canDelete
    && p10.data.missingPermissions.includes('procurement.deleteProformaInvoice') && !p10.data.missingPermissions.includes('procurement.deletePurchaseOrder'),
  JSON.stringify(p10.data?.missingPermissions));
  const x10 = await execute('PO', po10._id, { reason: 'no perm', acknowledged: true, planToken: p10.data.planToken }, limited);
  check('limited user: execute → 403, PO still live', x10.status === 403 && !(await ids.po('W10')).isDeleted, `${x10.status}`);

  // ── S13 Step 1.2 ──
  section('S13  Delete Receive Quote (Step 1.2) after "Quote Not Required"');
  const i11 = await ids.i('W11');
  const p11skip = await preview('QUOTATION_APPROVAL', i11._id, md);
  check('Step 1.3 was skipped → nothing to delete (400)', p11skip.status === 400, `${p11skip.status} ${p11skip.message}`);
  const p11 = (await preview('QUOTE_COMPARATIVE', i11._id, md)).data;
  check('1.2 + its PO; indent preserved', groupTypes(p11) === 'QUOTE_COMPARATIVE:1 PO:1' && JSON.stringify(preservedTypes(p11)) === '["INDENT"]', `${groupTypes(p11)} ${preservedTypes(p11)}`);
  const x11 = await execute('QUOTE_COMPARATIVE', i11._id, { reason: 'Quote is required after all', acknowledged: true, planToken: p11.planToken }, md);
  check('execute 200', x11.status === 200, x11.message);
  const i11a = await ids.i('W11');
  check('indent back at Step 1.2 (QUOTE_PENDING), planned date kept, vendor pick cleared',
    i11a.overallStatus === 'QUOTE_PENDING' && i11a.quoteStep.status === 'PENDING' && i11a.quoteStep.plannedAt?.getTime() === day(3).getTime()
    && !i11a.quoteComparativeStep.statusDone && !i11a.quotationApprovalStep.skipped && !i11a.items[0].vendorId, i11a.overallStatus);

  // ── S14 service indent ──
  section('S14  Internal-service indent: Quotation Approval takes its draft service QC');
  const i12 = await ids.i('W12');
  const p12 = (await preview('QUOTATION_APPROVAL', i12._id, md)).data;
  check('1.3 + service QC', groupTypes(p12) === 'QUOTATION_APPROVAL:1 INCOMING_QC:1', groupTypes(p12));
  const x12 = await execute('QUOTATION_APPROVAL', i12._id, { reason: 'Service not needed yet', acknowledged: true, planToken: p12.planToken }, md);
  check('execute 200; QC deleted; indent QUOTE_RECEIVED', x12.status === 200 && (await ids.qc('W12')).isDeleted && (await ids.i('W12')).overallStatus === 'QUOTE_RECEIVED');

  // ── S15 a payment as the selected record ──
  section('S15  Deleting a payment itself reverses it on the PI (its own delete), with a warning');
  const adv13 = await ids.adv('ADV-CD-W13');
  const p13 = (await preview('ADVANCE_PAYMENT', adv13._id, md)).data;
  check('preview: reason required, "does not refund" effect', p13.reasonRequired && /does not refund the vendor/.test(p13.effects.join(' ')), p13.effects.join(' | '));
  const x13 = await execute('ADVANCE_PAYMENT', adv13._id, { reason: 'Entered against the wrong PI', acknowledged: true, planToken: p13.planToken }, md);
  const pi13 = await ids.pi('W13');
  check('execute 200; PI paid 400 → 0, balance back to 1,180', x13.status === 200 && pi13.paidAmount === 0 && pi13.balanceAmount === 1180, `${pi13.paidAmount}/${pi13.balanceAmount}`);
  check('payment history has the reason', (await ids.adv('ADV-CD-W13')).activityTimeline.some((t) => t.action === 'CASCADE_DELETE' && /wrong PI/.test(t.description)));

  // ── S16 follow-up ──
  section('S16  A follow-up never deletes a GRN — it is blocked instead');
  const fu14 = await ids.fu('W14');
  const p14 = (await preview('FOLLOW_UP', fu14._id, md)).data;
  check('blocked by GRN-CD-W14; nothing listed downstream', !p14.canDelete && p14.downstreamCount === 0 && p14.blockers.some((b) => b.type === 'GRN' && b.number === 'GRN-CD-W14'), JSON.stringify(p14.blockers));

  // ── S17 unrelated records ──
  section('S17  Unrelated indents / POs / vendors unchanged');
  const sentinel = [await ids.i('W0'), await ids.po('W0'), await ids.pi('W0'), await ids.adv('ADV-CD-W0'), await ids.fu('W0')];
  check('W0 sentinel untouched (not deleted, same version and last change)', sentinel.every((d, k) => !d.isDeleted && before0.get(`${[PurchaseIndent, VendorPurchaseOrder, ProformaInvoice, AdvancePayment, PurchaseFollowUp][k].modelName}:${d._id}`)
      === `${d.isDeleted}|${d.__v}|${d.updatedAt?.getTime()}`));
  for (const tag of ['W2', 'W4A', 'W6A', 'W6B', 'W7', 'W10', 'W14', 'W15', 'W16']) {
    const i = await ids.i(tag);
    if (i.isDeleted) check(`indent ${tag} untouched`, false);
  }
  check('blocked / refused workflows still live (W2, W4A, W6, W7, W10, W14)', !(await ids.po('W2')).isDeleted && !(await ids.pi('W4A')).isDeleted
    && !(await ids.po('W6')).isDeleted && !(await ids.po('W7')).isDeleted && !(await ids.po('W10')).isDeleted && !(await ids.fu('W14')).isDeleted);

  await mongoose.disconnect();
};

// ── --atomic: in-process fault injection ──────────────────────────────────
const atomic = async () => {
  await connect();
  await load();
  const { cascadeDeleteService } = await import('../modules/procurement/cascade-delete/cascadeDelete.service.js');
  const { purchaseOrderService } = await import('../modules/procurement/purchase-order/purchaseOrder.service.js');
  const user = await User.findOne({ email: USERS.MD.email }).lean();
  const state = async (tag) => {
    const [po, fu, pi] = await Promise.all([ids.po(tag), ids.fu(tag), ids.pi(tag)]);
    return [po, fu, pi].map((d) => `${d.isDeleted}|${d.__v}|${d.activityTimeline.length}`).join(' ');
  };

  section('A1  The PO\'s own delete refuses after the downstream records went → they are put back');
  const po15 = await ids.po('W15');
  const before15 = await state('W15');
  const plan15 = await cascadeDeleteService.preview('PO', po15._id, null);
  const realRemove = purchaseOrderService.remove;
  purchaseOrderService.remove = async () => { throw new Error('injected: PO delete failed'); };
  let err15 = null;
  try {
    await cascadeDeleteService.execute('PO', po15._id, { reason: 'fault', acknowledged: true, planToken: plan15.planToken }, user, {});
  } catch (e) { err15 = e; } finally { purchaseOrderService.remove = realRemove; }
  check('the deletion fails with the injected error', /injected/.test(err15?.message || ''), err15?.message);
  check('follow-up + PI restored exactly (isDeleted, version, history)', (await state('W15')) === before15, `${before15} → ${await state('W15')}`);
  const a15 = await PurchaseCascadeDeletion.findOne({ rootId: po15._id }).lean();
  check('audit row FAILED, rolledBack, error kept, lock released', a15?.status === 'FAILED' && a15.rolledBack && /injected/.test(a15.error), JSON.stringify(a15 && { s: a15.status, r: a15.rolledBack }));
  console.log(`        (atomic mode: ${a15?.atomicMode || '(failed in step 4)'})`);

  section('A2  A write fails half-way through the downstream records → none of them stay deleted');
  const po16 = await ids.po('W16');
  const before16 = await state('W16');
  const plan16 = await cascadeDeleteService.preview('PO', po16._id, null);
  const realBulk = ProformaInvoice.bulkWrite;
  ProformaInvoice.bulkWrite = async () => { throw new Error('injected: PI write failed'); };
  let err16 = null;
  try {
    await cascadeDeleteService.execute('PO', po16._id, { reason: 'fault', acknowledged: true, planToken: plan16.planToken }, user, {});
  } catch (e) { err16 = e; } finally { ProformaInvoice.bulkWrite = realBulk; }
  check('fails with the injected error', /injected/.test(err16?.message || ''), err16?.message);
  check('follow-up (written before the failure) is live again; PO + PI untouched', (await state('W16')) === before16, `${before16} → ${await state('W16')}`);
  const a16 = await PurchaseCascadeDeletion.findOne({ rootId: po16._id }).lean();
  console.log(`        (atomic mode on this server: ${a16?.atomicMode || (mongoose.connection.client.topology?.description?.type || '?')})`);

  section('A3  After the failures the same deletion succeeds normally');
  const plan16b = await cascadeDeleteService.preview('PO', po16._id, null);
  const ok16 = await cascadeDeleteService.execute('PO', po16._id, { reason: 'retry', acknowledged: true, planToken: plan16b.planToken }, user, {});
  check('retry deletes PO + follow-up + PI', ok16.deletedCount === 3 && (await ids.pi('W16')).isDeleted && (await ids.fu('W16')).isDeleted, JSON.stringify(ok16.affected));
  console.log(`        (atomic mode: ${ok16.atomicMode})`);
  await mongoose.disconnect();
};

if (isEntry(import.meta.url)) {
  const arg = process.argv[2];
  const run = { '--seed': seed, '--api': api, '--atomic': atomic }[arg];
  if (!run) {
    console.log('usage: node src/scripts/e2eCascadeDeleteFixture.js --seed | --api | --atomic');
    process.exit(1);
  }
  run().then(() => {
    if (arg !== '--seed') console.log(`\n${passes} passed, ${failures} failed`);
    process.exit(failures ? 1 : 0);
  }).catch(async (e) => {
    console.error(e);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
