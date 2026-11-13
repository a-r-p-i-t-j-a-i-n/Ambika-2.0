/**
 * Service-level oracle for "approving a Vendor Invoice prepares its draft
 * Payment Voucher" (no browser).
 *
 *   node src/scripts/e2eInvoiceVoucherFixture.js --seed-ui   seed only: fresh DB, invoices at every stage,
 *                                                            for a browser look (backend: e2eServer.js on this DB)
 *   node src/scripts/e2eInvoiceVoucherFixture.js --api       seed + every check below
 *
 * Checks: auto-prepared draft (snapshot of the invoice, audit text, not yet linked/posted),
 * idempotency (manual create after auto, auto retry, second approve), 5 concurrent approvals,
 * 8 concurrent creates on an older approved invoice, the unique index itself, approval
 * kept + error recorded when voucher creation fails (and the retry), cancel → re-create,
 * rejected invoice, older invoice (approved before this change, no voucher) untouched by
 * approval logic, and the downstream chain (post → Tally → MD gate → part / part / full payment).
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard (S3 + email off).
 * Never reads MONGO_URI. Refuses to touch a database that already holds data unless it is
 * this fixture's own (--api / --seed-ui drop ONLY ambika_e2e_invvoucher, created by this script).
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote, { GRN_STATUS } from '../modules/procurement/grn/grn.model.js';
import IncomingQC from '../modules/procurement/incoming-qc/incomingQc.model.js';
import VendorInvoice from '../modules/procurement/vendor-invoice/vendorInvoice.model.js';
import VendorVoucher from '../modules/procurement/voucher/voucher.model.js';
import { CHECKLIST_KEYS } from '../modules/procurement/tally-entry/tallyEntry.model.js';
import { completeGrnThroughQc } from './e2eGrnLifecycle.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_invvoucher';
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eInvoiceVoucherFixture.js');

const VENDOR = new mongoose.Types.ObjectId();
const DOC = { fileName: 'inv.pdf', fileUrl: 'https://example.invalid/e2e/inv.pdf', fileType: 'application/pdf' };

let failures = 0;
let passes = 0;
const check = (label, ok, detail = '') => {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${detail}` : ''}`);
};
const errMsg = async (p) => { try { await p; return ''; } catch (e) { return e.message || String(e); } };
const r2 = (n) => Math.round(n * 100) / 100;
const settle = (promises) => Promise.allSettled(promises);
const liveVouchers = (invoiceId) => VendorVoucher.find({ invoiceId, isDeleted: { $ne: true }, voucherStatus: { $ne: 'CANCELLED' } }).lean();

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== 'ambika_e2e_invvoucher') throw new Error('Connected to an unexpected database — aborting.');
};

const run = async ({ seedOnly = false } = {}) => {
  await connect();
  await mongoose.connection.dropDatabase(); // this script's own scratch DB only (name asserted above)
  const user = (await User.create({
    email: 'invvoucher-e2e@test.local', password: 'E2e@12345', name: 'E2E Invoice Voucher', role: 'MD',
    mobile: '9000000078', isActive: true, roles: ['MD'],
  })).toObject();
  const bolt = await SKU.create({ code: 'E2E-BOLT', name: 'E2E Bolt M8', unit: 'PCS', itemType: 'CONSUMABLE' });
  await VendorVoucher.init(); // make sure the unique index exists before anything is written
  const { vendorInvoiceService: vis } = await import('../modules/procurement/vendor-invoice/vendorInvoice.service.js');
  const { voucherService } = await import('../modules/procurement/voucher/voucher.service.js');
  const { tallyEntryService } = await import('../modules/procurement/tally-entry/tallyEntry.service.js');
  const { finalPaymentService } = await import('../modules/procurement/final-payment/finalPayment.service.js');
  const { verifyInvoiceNumberIndex } = await import('../modules/procurement/vendor-invoice/invoiceNumberIndexGuard.js');
  await verifyInvoiceNumberIndex();

  const po = await VendorPurchaseOrder.create({
    poNumber: 'PO-E2E-IV1', vendorId: VENDOR, vendorName: 'E2E Vendor', indentId: new mongoose.Types.ObjectId(), poStatus: 'APPROVED',
    items: [{ skuId: bolt._id, skuCode: bolt.code, itemName: bolt.name, unit: bolt.unit, quantity: 1000, receivedQty: 0, pendingQty: 1000, rate: 100, gstRate: 18 }],
  });
  let n = 0;
  /** One GRN + QC (10 pcs) and an unapproved invoice on it. */
  const newInvoice = async (invoiceNumber) => {
    n += 1;
    const grn = await GoodsReceiptNote.create({
      grnNumber: `GRN-E2E-IV${n}`, poId: po._id, poNumber: po.poNumber, poIds: [po._id], poNumbers: [po.poNumber],
      vendorId: VENDOR, vendorName: 'E2E Vendor', warehouse: 'MAIN', grnStatus: GRN_STATUS.DRAFT, stockPosted: false,
      items: [{ poItemId: po.items[0]._id, poId: po._id, poNumber: po.poNumber, skuId: bolt._id, skuCode: bolt.code, itemName: bolt.name, unit: bolt.unit,
        orderedQty: 1000, receivedQty: 10, invoiceQty: 10, rate: 100 }],
      totalReceivedQty: 10,
    });
    await completeGrnThroughQc(grn._id, user);
    const qc = await IncomingQC.findOne({ grnId: grn._id }).lean();
    return vis.create({ qcId: String(qc._id), invoiceNumber, invoiceDocument: DOC }, user);
  };

  console.log('\n[seed] invoices on QC-passed GRNs (10 pcs × ₹100 + 18% GST = ₹1,180 each)');
  const invA = await newInvoice('INV-IV-A');   // normal flow
  const invB = await newInvoice('INV-IV-B');   // idempotency
  const invC = await newInvoice('INV-IV-C');   // 5 concurrent approvals
  const invD = await newInvoice('INV-IV-D');   // older approved invoice, no voucher → concurrent creates
  const invE = await newInvoice('INV-IV-E');   // voucher creation fails
  const invF = await newInvoice('INV-IV-F');   // cancel → re-create
  const invG = await newInvoice('INV-IV-G');   // rejected
  const invH = await newInvoice('INV-IV-H');   // left unapproved (browser)
  const invI = await newInvoice('INV-IV-I');   // pre-check race made deterministic
  check('seed: nine invoices at ₹1,180', [invA, invB, invC, invD, invE, invF, invG, invH, invI].every((i) => i.invoiceAmount === 1180 && i.invoiceStatus === 'RECEIVED'),
    JSON.stringify([invA, invH].map((i) => [i.invoiceAmount, i.invoiceStatus])));
  // An "older" approved invoice (approved before auto-preparation existed): status set directly, no voucher.
  await VendorInvoice.updateMany({ _id: { $in: [invD._id, invI._id] } }, { $set: { invoiceStatus: 'PAYMENT_PENDING', approvedBy: 'legacy', approvedAt: new Date('2026-10-01') } });

  if (seedOnly) {
    const a = await vis.approve(String(invA._id), { remarks: 'seed' }, user);
    await vis.approve(String(invB._id), {}, user);
    console.log(`\n[seed-ui] seeded — A,B approved (draft vouchers ${a.preparedVoucher?.voucherNumber}…), D older approved w/o voucher, H awaiting approval.`);
    console.log('          log in as invvoucher-e2e@test.local / E2e@12345\n');
    return;
  }

  console.log('\n[approval prepares the draft voucher]');
  const a = await vis.approve(String(invA._id), { remarks: 'ok' }, user);
  const vA = await VendorVoucher.findById(a.preparedVoucher?._id).lean();
  check('approve returns the prepared voucher, no error', !!vA && a.voucherPrepareError === '' && a.preparedVoucher.voucherStatus === 'DRAFT', JSON.stringify(a.preparedVoucher));
  check('invoice is PAYMENT_PENDING with approver + audit entry', a.invoiceStatus === 'PAYMENT_PENDING' && a.approvedBy === 'E2E Invoice Voucher' && a.activityTimeline.some((t) => t.action === 'APPROVE'));
  check('voucher is a PURCHASE draft linked by invoiceId, number AGL/PUR-…', vA.voucherType === 'PURCHASE' && String(vA.invoiceId) === String(invA._id) && /PUR/.test(vA.voucherNumber), vA?.voucherNumber);
  check('voucher is a snapshot of the invoice (1180 / adv 0 / DN 0 / net 1180, balance 1180, paid 0)',
    vA.invoiceAmount === 1180 && vA.netPayableAmount === 1180 && vA.balanceAmount === 1180 && vA.paidAmount === 0 && vA.advancePaid === 0 && vA.debitNoteAmount === 0);
  check('voucher carries vendor, PO, GRN and QC refs', vA.vendorName === 'E2E Vendor' && vA.poNumber === 'PO-E2E-IV1' && vA.grnNumbers.join() === 'GRN-E2E-IV1' && vA.qcIds.length === 1);
  check('audit says it was prepared automatically on approval', /automatically on approval of invoice INV-IV-A/.test(vA.activityTimeline[0].description), vA.activityTimeline[0].description);
  check('DRAFT only: not posted, no payment, approval NOT_REQUIRED yet, invoice not linked until posting',
    vA.voucherStatus === 'DRAFT' && !vA.postedAt && vA.approvalStatus === 'NOT_REQUIRED' && !(await VendorInvoice.findById(invA._id).lean()).voucherId);
  check('exactly one live voucher for the invoice', (await liveVouchers(invA._id)).length === 1);

  console.log('\n[idempotency]');
  check('a manual Create Voucher after auto is refused', /already exists for this invoice/.test(await errMsg(voucherService.create({ invoiceId: String(invA._id) }, user))));
  const inv = await VendorInvoice.findById(invA._id);
  const again = await voucherService.createPurchaseForInvoice(inv, {}, user, { auto: true });
  check('an automatic retry returns the SAME voucher (created=false)', again.created === false && String(again.voucher._id) === String(vA._id));
  check('a second approve of the same invoice is refused', /already approved/.test(await errMsg(vis.approve(String(invA._id), {}, user))));
  check('still exactly one live voucher', (await liveVouchers(invA._id)).length === 1);
  const dbl = await vis.approve(String(invB._id), {}, user);
  check('invoice B approved too (own voucher)', dbl.preparedVoucher && String(dbl.preparedVoucher._id) !== String(vA._id));

  console.log('\n[concurrent approvals — 5 at once on one invoice]');
  const res = await settle(Array.from({ length: 5 }, () => vis.approve(String(invC._id), {}, user)));
  const won = res.filter((r) => r.status === 'fulfilled');
  const lost = res.filter((r) => r.status === 'rejected');
  check('exactly one approval wins, four are refused', won.length === 1 && lost.length === 4 && lost.every((r) => /already approved/.test(r.reason.message)), res.map((r) => r.status).join());
  const liveC = await liveVouchers(invC._id);
  check('one live voucher, one APPROVE audit entry', liveC.length === 1 && (await VendorInvoice.findById(invC._id).lean()).activityTimeline.filter((t) => t.action === 'APPROVE').length === 1, `vouchers=${liveC.length}`);

  console.log('\n[concurrent creates — older approved invoice, 8 at once (4 manual + 4 automatic)]');
  const invDdoc = await VendorInvoice.findById(invD._id);
  const calls = [];
  for (let i = 0; i < 4; i += 1) {
    calls.push(voucherService.create({ invoiceId: String(invD._id) }, user));
    calls.push(voucherService.createPurchaseForInvoice(invDdoc, {}, user, { auto: true }));
  }
  const cres = await settle(calls);
  const liveD = await liveVouchers(invD._id);
  check('exactly one live voucher results', liveD.length === 1, `live=${liveD.length}`);
  check('every manual loser is told it already exists; none crashed',
    cres.filter((r) => r.status === 'rejected').every((r) => /already exists for this invoice/.test(r.reason.message)), cres.filter((r) => r.status === 'rejected').map((r) => r.reason.message).join(' | '));
  check('every automatic call resolved to a voucher (the winner, or its own)', cres.filter((r, i) => i % 2 === 1).every((r) => r.status === 'fulfilled' && r.value.voucher), '');
  check('older invoice D got its voucher only because someone created it (approval logic never back-filled it)',
    (await VendorVoucher.countDocuments({ invoiceId: invA._id })) === 1 && liveD[0].activityTimeline[0].action === 'CREATE');

  console.log('\n[the unique index itself]');
  const idx = (await VendorVoucher.collection.indexes()).find((i) => i.name === 'uniq_live_purchase_voucher_per_invoice');
  check('index exists, unique, partial on live PURCHASE vouchers', !!idx && idx.unique === true && idx.partialFilterExpression?.voucherType === 'PURCHASE', JSON.stringify(idx));
  const raw = { voucherNumber: 'AGL/PUR-RAW-1', voucherType: 'PURCHASE', invoiceId: invA._id, voucherStatus: 'DRAFT', netPayableAmount: 1 };
  const dup = await errMsg(VendorVoucher.create(raw));
  check('a second live purchase voucher for the invoice is refused by the database (E11000)', /E11000|duplicate key/i.test(dup), dup);
  const okCancelled = await VendorVoucher.create({ ...raw, voucherNumber: 'AGL/PUR-RAW-2', voucherStatus: 'CANCELLED' });
  check('a CANCELLED one is allowed beside the live one (not indexed)', !!okCancelled._id);
  await VendorVoucher.deleteOne({ _id: okCancelled._id });
  const exp = await VendorVoucher.create({ voucherNumber: 'AGL/EXP-RAW-1', voucherType: 'EXPENSE', voucherStatus: 'DRAFT' });
  const exp2 = await VendorVoucher.create({ voucherNumber: 'AGL/EXP-RAW-2', voucherType: 'EXPENSE', voucherStatus: 'DRAFT' });
  check('expense vouchers (no invoiceId) are never constrained', !!exp._id && !!exp2._id);
  await VendorVoucher.deleteMany({ _id: { $in: [exp._id, exp2._id] } });

  console.log('\n[pre-check race made deterministic — only the database can stop the duplicate]');
  {
    // Every create passes its findOne pre-check (as if all six ran before any write),
    // so the unique index — not the friendly check — decides the winner.
    const realFindOne = VendorVoucher.findOne;
    let blinded = 6;
    VendorVoucher.findOne = function blindFindOne(filter, ...rest) {
      if (blinded > 0 && String(filter?.invoiceId) === String(invI._id)) { blinded -= 1; return realFindOne.call(this, { _id: new mongoose.Types.ObjectId() }); }
      return realFindOne.call(this, filter, ...rest);
    };
    const invIdoc = await VendorInvoice.findById(invI._id);
    let rr;
    try {
      rr = await settle([0, 1, 2].flatMap(() => [
        voucherService.create({ invoiceId: String(invI._id) }, user),
        voucherService.createPurchaseForInvoice(invIdoc, {}, user, { auto: true }),
      ]));
    } finally { VendorVoucher.findOne = realFindOne; }
    const liveI = await liveVouchers(invI._id);
    const manual = rr.filter((r, i) => i % 2 === 0);
    check('all six passed the pre-check, yet exactly one live voucher exists', blinded === 0 && liveI.length === 1, `blinded=${blinded} live=${liveI.length}`);
    check('manual losers got the friendly "already exists" refusal (via the E11000 path)',
      manual.filter((r) => r.status === 'rejected').every((r) => /already exists for this invoice/.test(r.reason.message)) && manual.filter((r) => r.status === 'fulfilled').length <= 1,
      rr.map((r) => (r.status === 'rejected' ? r.reason.message : 'ok')).join(' | '));
    check('automatic losers resolved to the winning voucher', rr.filter((r, i) => i % 2 === 1).every((r) => r.status === 'fulfilled' && r.value.voucher && String(r.value.voucher._id) === String(liveI[0]._id)));
  }

  console.log('\n[voucher creation fails → approval kept, error recorded, retry is safe]');
  const realCreate = VendorVoucher.create;
  VendorVoucher.create = async () => { throw new Error('simulated voucher outage'); };
  let e;
  try { e = await vis.approve(String(invE._id), {}, user); } finally { VendorVoucher.create = realCreate; }
  const invEdb = await VendorInvoice.findById(invE._id).lean();
  check('approve still succeeds; invoice PAYMENT_PENDING', e.invoiceStatus === 'PAYMENT_PENDING' && invEdb.invoiceStatus === 'PAYMENT_PENDING');
  check('response says no voucher and why', e.preparedVoucher === null && /simulated voucher outage/.test(e.voucherPrepareError), e.voucherPrepareError);
  check('failure is on the invoice audit timeline', invEdb.activityTimeline.some((t) => t.action === 'VOUCHER_PREPARE_FAILED' && /create it from the invoice/.test(t.description)));
  check('no voucher exists (invoice is in "Awaiting Voucher")', (await liveVouchers(invE._id)).length === 0);
  const retry = await voucherService.create({ invoiceId: String(invE._id) }, user);
  check('Create Voucher (the retry) makes exactly one', !!retry._id && (await liveVouchers(invE._id)).length === 1);
  check('a further retry is refused, never a second voucher', /already exists/.test(await errMsg(voucherService.create({ invoiceId: String(invE._id) }, user))));

  console.log('\n[cancel → re-create]');
  const f = await vis.approve(String(invF._id), {}, user);
  await voucherService.cancel(String(f.preparedVoucher._id), { remarks: 'wrong' }, user);
  check('cancelled draft frees the invoice', (await liveVouchers(invF._id)).length === 0);
  const f2 = await voucherService.create({ invoiceId: String(invF._id) }, user);
  check('a new voucher can be created (index ignores the cancelled one)', !!f2._id && String(f2._id) !== String(f.preparedVoucher._id) && (await liveVouchers(invF._id)).length === 1);

  console.log('\n[rejected invoice]');
  await vis.reject(String(invG._id), { remarks: 'bad' }, user);
  check('rejected invoice has no voucher and cannot get one', (await VendorVoucher.countDocuments({ invoiceId: invG._id })) === 0
    && /approved \(payment-pending\)/.test(await errMsg(voucherService.create({ invoiceId: String(invG._id) }, user))));
  check('a rejected invoice cannot be approved afterwards', /rejected/i.test(await errMsg(vis.approve(String(invG._id), {}, user))));
  check('unapproved invoice H has no voucher', (await VendorVoucher.countDocuments({ invoiceId: invH._id })) === 0
    && /approved \(payment-pending\)/.test(await errMsg(voucherService.create({ invoiceId: String(invH._id) }, user))));

  console.log('\n[downstream on the auto-prepared voucher: post → Tally → MD gate → part / part / full payment]');
  const post = await voucherService.post(String(vA._id), {}, user);
  check('Review & Post → POSTED, invoice now linked to the voucher', post.voucherStatus === 'POSTED'
    && String((await VendorInvoice.findById(invA._id).lean()).voucherId) === String(vA._id));
  const noTally = { voucherId: String(vA._id), paymentStatus: 'PART_PAYMENT', paidAmount: 400, paymentMode: 'NEFT', paymentReferenceNumber: 'UTR-1' };
  check('payment before Tally is refused', /Tally Entry is completed/.test(await errMsg(finalPaymentService.create(noTally, user))));
  const tally = await tallyEntryService.create({ voucherId: String(vA._id) }, user);
  await tallyEntryService.complete(String(tally._id), { statusDone: 'YES', checklist: Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, true])) }, user);
  check('payment waits for the MD', /MD/i.test(await errMsg(finalPaymentService.create(noTally, user))));
  await VendorVoucher.updateOne({ _id: vA._id }, { $set: { approvalStatus: 'MD_APPROVED' } }); // stand-in for the MD signature
  await finalPaymentService.create(noTally, user);
  let v = await VendorVoucher.findById(vA._id).lean();
  check('part payment 400: PARTIALLY_PAID, paid 400, balance 780', v.voucherStatus === 'PARTIALLY_PAID' && v.paidAmount === 400 && r2(v.balanceAmount) === 780, `${v.voucherStatus}/${v.paidAmount}/${v.balanceAmount}`);
  check('over-balance payment refused', /exceeds the voucher balance/.test(await errMsg(finalPaymentService.create({ ...noTally, paidAmount: 800, paymentStatus: 'PART_PAYMENT' }, user))));
  await finalPaymentService.create({ ...noTally, paidAmount: 300, paymentReferenceNumber: 'UTR-2' }, user);
  v = await VendorVoucher.findById(vA._id).lean();
  check('second part payment 300: balance 480, still PARTIALLY_PAID', v.voucherStatus === 'PARTIALLY_PAID' && r2(v.paidAmount) === 700 && r2(v.balanceAmount) === 480);
  check('invoice still PAYMENT_PENDING while a balance is outstanding', (await VendorInvoice.findById(invA._id).lean()).invoiceStatus === 'PAYMENT_PENDING');
  await finalPaymentService.create({ ...noTally, paymentStatus: 'FULL_PAYMENT', paidAmount: 480, paymentReferenceNumber: 'UTR-3' }, user);
  v = await VendorVoucher.findById(vA._id).lean();
  const invAfter = await VendorInvoice.findById(invA._id).lean();
  check('full payment: FULLY_PAID, balance 0, invoice PAYMENT_COMPLETED', v.voucherStatus === 'FULLY_PAID' && r2(v.balanceAmount) === 0 && r2(v.paidAmount) === 1180 && invAfter.invoiceStatus === 'PAYMENT_COMPLETED');
  check('a fully paid voucher stays the invoice\'s single live voucher', (await liveVouchers(invA._id)).length === 1);

  console.log(`\n${failures ? `FAILED — ${failures} check(s) failed, ${passes} passed` : `ALL ${passes} CHECKS PASSED`}\n`);
};

if (isEntry(import.meta.url)) {
  const mode = process.argv[2];
  if (!['--api', '--seed-ui'].includes(mode)) {
    console.error('usage: node src/scripts/e2eInvoiceVoucherFixture.js --api | --seed-ui');
    process.exit(2);
  }
  run({ seedOnly: mode === '--seed-ui' })
    .catch((err) => { console.error(err); failures += 1; })
    .finally(async () => { await mongoose.disconnect(); process.exit(failures ? 1 : 0); });
}
