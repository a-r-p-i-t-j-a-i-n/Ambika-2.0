/**
 * Fixture for the Purchase FMS KPI-card e2e (frontend/e2e/purchaseKpiCards.e2e.mjs).
 *
 *   node src/scripts/e2eKpiFixture.js --seed      scratch DB ambika_e2e_kpi
 *
 * Records spread across every status the Purchase FMS summary cards count,
 * with DISTINCT counts per status so a card/row mismatch cannot hide. Raw
 * inserts (no workflow run) — this database exists only to exercise the list
 * filters behind the cards.
 *
 * Safety: the shared e2e guard (localhost scratch DB, S3 off, email off).
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import User from '../modules/auth/auth.model.js';
import Indent from '../modules/procurement/indent/indent.model.js';
import PO from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import FU from '../modules/procurement/follow-up/followUp.model.js';
import PI from '../modules/procurement/proforma-invoice/proformaInvoice.model.js';
import ADV from '../modules/procurement/advance-payment/advancePayment.model.js';
import GRN from '../modules/procurement/grn/grn.model.js';
import QC from '../modules/procurement/incoming-qc/incomingQc.model.js';
import INV from '../modules/procurement/vendor-invoice/vendorInvoice.model.js';
import TALLY from '../modules/procurement/tally-entry/tallyEntry.model.js';
import FP from '../modules/procurement/final-payment/finalPayment.model.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_kpi';
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eKpiFixture.js');
export const E2E_USER = { email: 'kpi-e2e@test.local', password: 'E2e@12345' };

const seed = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== 'ambika_e2e_kpi') throw new Error(`unexpected database ${mongoose.connection.name}`);
  await mongoose.connection.dropDatabase();

  const id = () => new mongoose.Types.ObjectId();
  const DAY = 86400000;
  const now = Date.now();
  const ago = (d) => new Date(now - d * DAY);
  const V = 'E2E KPI Vendor';
  const base = (i) => ({ isDeleted: false, createdAt: ago(30 - i), updatedAt: ago(30 - i) });
  const ins = async (Model, docs) => { await Model.collection.insertMany(docs); return docs; };
  let n = 0; const seq = () => ++n;

  await User.create({ email: 'kpi-e2e@test.local', password: 'E2e@12345', name: 'KPI E2E', role: 'MD', mobile: '9000000071', isActive: true, roles: ['MD'] });

  // ── Indents (approval / overall states) ──
  const indentSpec = [
    ['DRAFT', 'DRAFT', 1], ['PENDING_APPROVAL', 'PENDING_APPROVAL', 2], ['APPROVED', 'QUOTE_PENDING', 3], ['APPROVED', 'QUOTATION_APPROVED', 2],
  ];
  await ins(Indent, indentSpec.flatMap(([approvalStatus, overallStatus, c]) => Array.from({ length: c }, () => {
    const i = seq();
    return { ...base(i), indentNumber: `Ind-KPI-${i}`, approvalStatus, overallStatus, department: 'Stores', requestType: 'MATERIAL_PURCHASE', raisedBy: 'KPI',
      items: [{ _id: id(), itemName: `KPI item ${i}`, quantity: 10, unit: 'Pcs', approvalStatus: 'APPROVED' }] };
  })));

  // ── Purchase orders: [approvalStatus, releaseStatus, poStatus, count] ──
  const poSpec = [
    ['DRAFT', 'NOT_RELEASED', 'DRAFT', 2], ['APPROVED', 'NOT_RELEASED', 'APPROVED', 3], ['APPROVED', 'RELEASED', 'RELEASED_TO_VENDOR', 4],
    ['APPROVED', 'RELEASED', 'PARTIAL_RECEIVED', 2], ['APPROVED', 'RELEASED', 'FULLY_RECEIVED', 1], ['APPROVED', 'NOT_RELEASED', 'CANCELLED', 1],
  ];
  const pos = await ins(PO, poSpec.flatMap(([approvalStatus, releaseStatus, poStatus, c]) => Array.from({ length: c }, () => {
    const i = seq();
    return { ...base(i), _id: id(), ...(approvalStatus === 'APPROVED' ? { poNumber: `AGL/PO-KPI-${i}` } : {}), draftNumber: `DRAFT-KPI-${i}`,
      vendorName: V, poDate: ago(20), expectedDeliveryDate: ago(-10), approvalStatus, releaseStatus, poStatus, grandTotal: 1000 * i,
      followUpStatus: 'NOT_STARTED', piStatus: 'NOT_RECEIVED', advancePaymentStatus: 'NOT_STARTED', poFormatType: 'OTHER',
      items: [{ _id: id(), itemName: `KPI line ${i}`, quantity: 100, receivedQty: poStatus === 'PARTIAL_RECEIVED' ? 40 : 0, unit: 'KGS', rate: 10 }] };
  })));
  const payablePo = pos.find((p) => p.poStatus === 'RELEASED_TO_VENDOR');

  // ── Follow-ups: [status, plannedDaysAgo (positive = past), count] ──
  const fuSpec = [['PENDING', 3, 2], ['PENDING', -3, 1], ['RESCHEDULED', 2, 1], ['RESCHEDULED', -2, 1], ['DONE', 5, 2], ['READY_FOR_GRN', 1, 3], ['CLOSED', 9, 1]];
  await ins(FU, fuSpec.flatMap(([followUpStatus, d, c]) => Array.from({ length: c }, () => {
    const i = seq();
    return { ...base(i), followUpNumber: `FU-KPI-${i}`, poId: id(), poNumber: `AGL/PO-FU-${i}`, vendorName: V, plannedAt: ago(d), followUpStatus,
      followUpType: 'CALL', isActiveFollowUp: false };
  })));

  // ── PIs: [approvalStatus, piStatus, total, paid, count] ──
  const piSpec = [
    ['PENDING', 'RECEIVED', 1000, 0, 2], ['PENDING', 'CANCELLED', 1000, 0, 1], ['APPROVED', 'APPROVED', 1000, 0, 1],
    ['APPROVED', 'READY_FOR_ADVANCE_PAYMENT', 1000, 0, 1], ['APPROVED', 'READY_FOR_ADVANCE_PAYMENT', 1000, 400, 2],
    ['APPROVED', 'PAYMENT_COMPLETED', 1000, 1000, 1], ['APPROVED', 'PAYMENT_COMPLETED', 1000, 700, 1], ['REJECTED', 'DRAFT', 500, 0, 1],
  ];
  const pis = await ins(PI, piSpec.flatMap(([approvalStatus, piStatus, totalValue, paidAmount, c]) => Array.from({ length: c }, () => {
    const i = seq();
    return { ...base(i), _id: id(), piNumber: `PI-KPI-${i}`, poId: payablePo._id, poNumber: payablePo.poNumber, vendorName: V, piDate: ago(15),
      approvalStatus, piStatus, totalValue, paidAmount, balanceAmount: totalValue - paidAmount, items: [] };
  })));

  // ── Advance payments against those PIs ──
  const advRows = [];
  for (const pi of pis) {
    const adv = (paidAmount, paymentStatus) => { const i = seq(); advRows.push({ ...base(i), paymentNumber: `ADV-KPI-${i}`, piId: pi._id, piNumber: pi.piNumber, poId: pi.poId, poNumber: pi.poNumber, vendorName: V, paidAmount, paymentStatus, paymentMode: 'NEFT', paymentDate: ago(5) }); };
    if (pi.piStatus === 'READY_FOR_ADVANCE_PAYMENT' && pi.paidAmount > 0) adv(400, 'PART_PAYMENT');
    if (pi.piStatus === 'READY_FOR_ADVANCE_PAYMENT' && pi.paidAmount === 0) adv(300, 'CANCELLED');
    if (pi.piStatus === 'PAYMENT_COMPLETED' && pi.balanceAmount === 0) { adv(500, 'PART_PAYMENT'); adv(500, 'FULL_PAYMENT'); }
    if (pi.piStatus === 'PAYMENT_COMPLETED' && pi.balanceAmount > 0) adv(700, 'SHORT_PAYMENT_COMPLETED');
  }
  await ins(ADV, advRows);

  // ── GRNs ──
  const grnSpec = [['DRAFT', 2], ['RECEIVED', 1], ['PARTIAL_RECEIVED', 2], ['FULLY_RECEIVED', 3], ['CANCELLED', 1]];
  await ins(GRN, grnSpec.flatMap(([grnStatus, c]) => Array.from({ length: c }, () => {
    const i = seq();
    return { ...base(i), grnNumber: `AGL/GRN-KPI-${i}`, uniqueId: `UID-K${i}`, poNumber: payablePo.poNumber, vendorName: V, grnDate: ago(3),
      grnStatus, qcStatus: 'PENDING', totalReceivedQty: 10 * i, stockPosted: !['DRAFT', 'CANCELLED'].includes(grnStatus), items: [] };
  })));

  // ── Incoming QC ──
  const qcSpec = [['DRAFT', 1], ['IN_PROGRESS', 1], ['PASSED', 3], ['FAILED', 1], ['PARTIAL', 2], ['CANCELLED', 1]];
  await ins(QC, qcSpec.flatMap(([qcStatus, c]) => Array.from({ length: c }, () => {
    const i = seq();
    return { ...base(i), qcNumber: `AGL/QC-KPI-${i}`, grnNumber: `AGL/GRN-KPI-X${i}`, poNumber: payablePo.poNumber, vendorName: V, qcDate: ago(2), qcStatus, items: [] };
  })));

  // ── Vendor invoices ──
  const invSpec = [['DRAFT', 1], ['RECEIVED', 2], ['APPROVED', 1], ['PAYMENT_PENDING', 3], ['PAYMENT_COMPLETED', 2], ['REJECTED', 1]];
  await ins(INV, invSpec.flatMap(([invoiceStatus, c]) => Array.from({ length: c }, () => {
    const i = seq();
    return { ...base(i), invoiceNumber: `INV-KPI-${i}`, vendorName: V, invoiceDate: ago(4), invoiceStatus, invoiceAmount: 1000, netPayableAmount: 1000, items: [] };
  })));

  // ── Tally entries ──
  const tSpec = [['PENDING', 2], ['COMPLETED', 3], ['CANCELLED', 1]];
  await ins(TALLY, tSpec.flatMap(([tallyEntryStatus, c]) => Array.from({ length: c }, () => {
    const i = seq();
    return { ...base(i), entryNumber: `TLY-KPI-${i}`, voucherNumber: `AGL/PUR-KPI-${i}`, vendorName: V, tallyEntryStatus };
  })));

  // ── Final payments ──
  const fpSpec = [['PART_PAYMENT', 2], ['FULL_PAYMENT', 3], ['SHORT_PAYMENT_COMPLETED', 1], ['CANCELLED', 1]];
  await ins(FP, fpSpec.flatMap(([paymentStatus, c]) => Array.from({ length: c }, () => {
    const i = seq();
    return { ...base(i), paymentNumber: `PAY-KPI-${i}`, voucherNumber: `AGL/PUR-KPI-${i}`, vendorName: V, paidAmount: 100, balanceAfterPayment: 0, paymentStatus, paymentMode: 'NEFT', paymentDate: ago(1) };
  })));

  console.log(JSON.stringify({ ok: true, db: 'ambika_e2e_kpi', user: E2E_USER.email, records: n }));
  await mongoose.disconnect();
};

if (isEntry(import.meta.url)) {
  if (process.argv[2] !== '--seed') { console.error('Usage: --seed'); process.exit(1); }
  seed().catch(async (e) => { console.error('Fixture failed:', e.stack || e.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
}
