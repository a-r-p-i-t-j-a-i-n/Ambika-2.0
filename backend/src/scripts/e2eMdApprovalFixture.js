/**
 * Fixture + database oracle for frontend/e2e/mdApproval.e2e.mjs — the MD
 * Approval screen and the "only payment waits for the MD" rule.
 *
 *   node src/scripts/e2eMdApprovalFixture.js --seed     drop + seed ambika_e2e_mdapproval
 *   node src/scripts/e2eMdApprovalFixture.js --verify   read what the browser run left behind
 *
 * Order: --seed (backend stopped), start the guarded backend (e2eServer.js) on
 * this DB + Vite, run the spec, then --verify.
 *
 * Seeds, through the REAL services wherever a document has a lifecycle:
 *   GRN  — completed (QC-gated, nothing stocked), MD approval PENDING
 *   PI   — approved, ready for advance payment, MD approval PENDING (advance gate)
 *   PV-1 — posted voucher, Tally done, MD approval PENDING (final payment gate)
 *   PV-2 — an older voucher, MD approved and fully paid (Completed bucket)
 * plus an MD user and a non-MD (Accounts) user. Writes the ids the browser
 * needs to frontend/e2e/shots/md-approval-manifest.json.
 *
 * SAFETY: the shared e2e guard runs before anything connects — localhost only,
 * database name must contain "e2e", S3 and email must be off. It never reads
 * MONGO_URI, so it cannot reach Atlas. Approval PDFs land in backend/uploads/
 * (git-ignored) because S3 is off.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote from '../modules/procurement/grn/grn.model.js';
import ProformaInvoice from '../modules/procurement/proforma-invoice/proformaInvoice.model.js';
import AdvancePayment from '../modules/procurement/advance-payment/advancePayment.model.js';
import VendorVoucher from '../modules/procurement/voucher/voucher.model.js';
import PurchaseTallyEntry from '../modules/procurement/tally-entry/tallyEntry.model.js';
import VendorFinalPayment from '../modules/procurement/final-payment/finalPayment.model.js';
import DocumentApproval from '../modules/approvals/approval.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import IncomingQC from '../modules/procurement/incoming-qc/incomingQc.model.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_mdapproval';
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eMdApprovalFixture.js');

export const MD_USER = { email: 'md-approval-e2e@test.local', password: 'E2e@12345', name: 'MD Approver', role: 'MD' };
export const ACCOUNTS_USER = { email: 'accounts-e2e@test.local', password: 'E2e@12345', name: 'Accounts Clerk', role: 'Accountant' };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.resolve(HERE, '../../../frontend/e2e/shots/md-approval-manifest.json');

const MODE = (process.argv.find((a) => a.startsWith('--')) || '--seed').slice(2);
const results = [];
const check = (name, pass, detail = '') => {
  results.push(!!pass);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ''}`);
};

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== 'ambika_e2e_mdapproval') throw new Error('Connected to an unexpected database — aborting.');
};

const mkPo = (tag, vendorName, sku, qty, rate, extra = {}) => VendorPurchaseOrder.create({
  poNumber: `PO-MDA-${tag}`, vendorId: new mongoose.Types.ObjectId(), vendorName,
  indentId: new mongoose.Types.ObjectId(), poStatus: 'RELEASED_TO_VENDOR', approvalStatus: 'APPROVED',
  items: [{ skuId: sku._id, skuCode: sku.code, itemName: sku.name, unit: sku.unit, quantity: qty, receivedQty: 0, pendingQty: qty, rate, gstRate: 18 }],
  ...extra,
});

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  const { grnService } = await import('../modules/procurement/grn/grn.service.js');
  const { proformaInvoiceService } = await import('../modules/procurement/proforma-invoice/proformaInvoice.service.js');
  const { approvalService } = await import('../modules/approvals/approval.service.js');
  await import('../modules/procurement/voucher/voucher.service.js'); // registers the VOUCHER adapter

  const md = await User.create({ ...MD_USER, mobile: '9000000071', isActive: true, roles: ['MD'] });
  const accounts = await User.create({ ...ACCOUNTS_USER, mobile: '9000000072', isActive: true, roles: ['FINANCE'] });
  const brush = await SKU.create({ code: 'E2E-MDA-BRUSH', name: 'E2E MDA Brush 5in', unit: 'PCS', itemType: 'CONSUMABLE', category: 'Brush' });
  for (const m of [InventoryMovement, GoodsReceiptNote, IncomingQC]) await m.createCollection().catch(() => {});

  // GRN — completed by the store (Accounts user stands in), MD approval pending.
  const poG = await mkPo('GRN', 'E2E Alpha Traders', brush, 40, 25,
    { followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_NOT_REQUIRED', readyForGrnAt: new Date(), finalMaterialDate: new Date() });
  const g = await grnService.create({
    poId: String(poG._id),
    items: [{ poItemId: String(poG.items[0]._id), itemName: brush.name, skuCode: brush.code, invoiceQty: 40, receivedQty: 40, rate: 25, batchNo: '' }],
  }, accounts);
  await grnService.complete(String(g._id), {}, accounts);

  // PI — approved → ready for advance payment → MD approval raised automatically.
  const poP = await mkPo('PI', 'E2E Beta Metals', brush, 100, 50);
  const pi = await proformaInvoiceService.create({
    poId: String(poP._id), piDocument: { fileName: 'vendor-pi.pdf', fileUrl: 'http://127.0.0.1:5099/uploads/e2e/vendor-pi.pdf', fileType: 'application/pdf' },
  }, accounts);
  await proformaInvoiceService.approve(String(pi._id), { remarks: 'E2E' }, accounts);

  // PV-1 — posted, Tally done; payment waits for the MD.
  const pv1 = await VendorVoucher.create({
    voucherNumber: 'PV-MDA-001', voucherType: 'PURCHASE', vendorName: 'E2E Gamma Supplies', invoiceNumber: 'INV-MDA-1',
    invoiceAmount: 1180, netPayableAmount: 1180, totalAmountPayable: 1180, balanceAmount: 1180, paidAmount: 0,
    voucherStatus: 'POSTED', postedAt: new Date(), tallyEntryStatus: 'PENDING', createdBy: accounts._id,
  });
  await approvalService.ensureReady({ documentType: 'VOUCHER', documentId: pv1._id, documentNumber: pv1.voucherNumber }, accounts);
  // Its Tally Entry, raised while the MD approval was pending (it never waits for it), then completed.
  const { tallyEntryService } = await import('../modules/procurement/tally-entry/tallyEntry.service.js');
  const te = await tallyEntryService.create({ voucherId: String(pv1._id) }, accounts);
  await PurchaseTallyEntry.updateOne({ _id: te._id }, { $set: { tallyEntryStatus: 'COMPLETED', statusDone: 'YES', actualAt: new Date() } });

  // PV-2 — an older voucher: MD approved and fully paid (Completed), requested 10 days ago.
  const pv2 = await VendorVoucher.create({
    voucherNumber: 'PV-MDA-000', voucherType: 'PURCHASE', vendorName: 'E2E Alpha Traders', invoiceNumber: 'INV-MDA-0',
    invoiceAmount: 500, netPayableAmount: 500, totalAmountPayable: 500, balanceAmount: 0, paidAmount: 500,
    voucherStatus: 'FULLY_PAID', postedAt: new Date(), tallyEntryStatus: 'COMPLETED', approvalStatus: 'MD_APPROVED', createdBy: accounts._id,
  });
  const old = new Date(Date.now() - 10 * 86400000);
  await DocumentApproval.collection.insertOne({
    documentType: 'VOUCHER', documentId: pv2._id, documentNumber: pv2.voucherNumber, status: 'APPROVED',
    levels: [{ order: 1, roleKey: 'MD', label: 'Managing Director' }], currentLevelOrder: 1,
    signedByUserId: md._id, signedByName: md.name, designation: 'Managing Director', signedAt: old, signatureVersion: 1,
    history: [{ action: 'SIGNED', levelOrder: 1, roleKey: 'MD', actorId: md._id, actorName: md.name, timestamp: old }],
    createdBy: accounts._id, isDeleted: false, isActive: true, createdAt: old, updatedAt: old,
  });

  const fresh = {
    grn: await GoodsReceiptNote.findById(g._id).lean(),
    pi: await ProformaInvoice.findById(pi._id).lean(),
  };
  const manifest = {
    md: MD_USER, accounts: ACCOUNTS_USER,
    grn: { id: String(g._id), number: fresh.grn.grnNumber, item: brush.name, qty: 40 },
    pi: { id: String(pi._id), number: fresh.pi.piNumber, total: fresh.pi.totalValue },
    pv1: { id: String(pv1._id), number: pv1.voucherNumber, amount: 1180 },
    pv2: { id: String(pv2._id), number: pv2.voucherNumber },
  };
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

  check('GRN completed, QC-gated, MD approval pending', fresh.grn.stockPostingStage === 'QC_COMPLETION' && fresh.grn.approvalStatus === 'READY_FOR_MD_APPROVAL',
    `${fresh.grn.stockPostingStage} · ${fresh.grn.approvalStatus}`);
  check('PI ready for advance payment, MD approval raised on approve', fresh.pi.piStatus === 'READY_FOR_ADVANCE_PAYMENT' && fresh.pi.mdApprovalStatus === 'READY_FOR_MD_APPROVAL' && !!fresh.pi.mdApprovalPdfUrl,
    `${fresh.pi.piStatus} · ${fresh.pi.mdApprovalStatus}`);
  await VendorVoucher.updateOne({ _id: pv1._id }, { $set: { tallyEntryStatus: 'COMPLETED' } });
  check('PV-1: Tally Entry created and completed while its MD approval is pending', (await VendorVoucher.findById(pv1._id).lean()).approvalStatus === 'READY_FOR_MD_APPROVAL');
  check('four approvals tracked', (await DocumentApproval.countDocuments()) === 4);
  check('nothing stocked, nothing paid yet', (await InventoryMovement.countDocuments()) === 0 && (await AdvancePayment.countDocuments()) === 0);
  console.log(`\n[md-approval] seeded ${E2E_URI} — manifest ${MANIFEST}`);
};

const verify = async () => {
  await connect();
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const md = await User.findOne({ email: MD_USER.email }).lean();
  const grn = await GoodsReceiptNote.findById(m.grn.id).lean();
  const pi = await ProformaInvoice.findById(m.pi.id).lean();
  const pv1 = await VendorVoucher.findById(m.pv1.id).lean();
  const ap = (t, id) => DocumentApproval.findOne({ documentType: t, documentId: id }).lean();

  console.log('\n── GRN → QC → stock, before (and without) the MD signature ──');
  const qcs = await IncomingQC.find({ grnId: grn._id }).lean();
  const ins = await InventoryMovement.find({ refType: 'GRN', refId: grn._id }).lean();
  check('the QC completed in the browser (PASSED)', grn.qcStatus === 'PASSED' && qcs.length === 1 && qcs[0].qcStatus === 'PASSED', `${grn.qcStatus} ${qcs.map((q) => q.qcStatus)}`);
  check('the accepted 40 posted to stock as one GRN_IN', ins.length === 1 && ins[0].txnType === 'GRN_IN' && ins[0].quantity === 40, JSON.stringify(ins.map((x) => [x.txnType, x.quantity])));
  check('…while the GRN is still awaiting the MD (recorded, never blocking)', grn.approvalStatus === 'READY_FOR_MD_APPROVAL' && (await ap('GRN', grn._id)).status === 'READY_FOR_APPROVAL');

  console.log('\n── Advance payment gate ──');
  const pays = await AdvancePayment.find({ piId: pi._id, isDeleted: { $ne: true } }).lean();
  const piAp = await ap('PROFORMA_INVOICE', pi._id);
  check('PI MD approved by the MD user in the browser', pi.mdApprovalStatus === 'MD_APPROVED' && piAp.status === 'APPROVED'
    && String(piAp.signedByUserId) === String(md._id) && piAp.history.some((h) => h.action === 'SIGNED'), `${pi.mdApprovalStatus} ${piAp.signedByName}`);
  check('the signed approval PDF replaced the unsigned one on the PI', !!piAp.signedPdfUrl && pi.mdApprovalPdfUrl === piAp.signedPdfUrl);
  check('exactly one advance payment — the refused attempt wrote nothing', pays.length === 1 && pays[0].paymentStatus === 'FULL_PAYMENT', JSON.stringify(pays.map((p) => p.paymentStatus)));
  check('…recorded after the approval', pays[0] && new Date(pays[0].createdAt) > new Date(piAp.signedAt));
  check('PI fully paid → PAYMENT_COMPLETED', pi.piStatus === 'PAYMENT_COMPLETED' && pi.balanceAmount === 0, `${pi.piStatus} ${pi.balanceAmount}`);

  console.log('\n── Final payment gate ──');
  const fps = await VendorFinalPayment.find({ voucherId: pv1._id, isDeleted: { $ne: true } }).lean();
  const pvAp = await ap('VOUCHER', pv1._id);
  check('voucher MD approved by the MD user', pv1.approvalStatus === 'MD_APPROVED' && pvAp.status === 'APPROVED' && String(pvAp.signedByUserId) === String(md._id));
  check('exactly one final payment, after the approval', fps.length === 1 && new Date(fps[0].createdAt) > new Date(pvAp.signedAt), `${fps.length}`);
  check('voucher fully paid', pv1.voucherStatus === 'FULLY_PAID' && pv1.balanceAmount === 0, `${pv1.voucherStatus} ${pv1.balanceAmount}`);

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  return failed;
};

if (isEntry(import.meta.url)) {
  const run = MODE === 'verify' ? verify : seed;
  run()
    .then(async (failed) => { await mongoose.disconnect(); process.exit(failed || results.some((r) => !r) ? 1 : 0); })
    .catch(async (e) => { console.error('[md-approval] failed:', e); await mongoose.disconnect().catch(() => {}); process.exit(1); });
}
