/**
 * Service-level oracle for Vendor Invoices against multiple GRNs (no browser).
 *
 *   node src/scripts/e2eMultiGrnInvoiceFixture.js --api       seed + every check below
 *   node src/scripts/e2eMultiGrnInvoiceFixture.js --seed-ui   seed only (all GRNs eligible) for a browser look;
 *                                                             backend: e2eServer.js on this DB
 *   node src/scripts/e2eMultiGrnInvoiceFixture.js --number-race
 *       concurrent creates / renames with one vendor invoice number (see numberRace).
 *       Does NOT drop the DB — adds run-tagged data on top, so it can be re-run as is.
 *
 * Seeds a fresh scratch DB — POs, a PI with an advance, and GRNs completed
 * through the real GRN + Incoming QC services (QC accepts everything) — then
 * checks:
 *   - eligible-GRN list (date, per-line qcItemId / batch, per-PO-line rates)
 *   - single-GRN invoice (legacy qcId payload) still works
 *   - one invoice over two GRNs: per-line qty, repeated SKUs (two batches of one
 *     SKU on one GRN, the same SKU again on the other GRN), totals, PI advance,
 *     debit note, net payable, all GRN refs
 *   - partial invoicing, over-pending refusal, edit re-derivation, reject frees qty
 *   - duplicate invoice number (same vendor refused, other vendor allowed)
 *   - cross-vendor / cross-PO (incl. a multi-PO GRN's two QCs) / repeated pick refused
 *   - an older invoice without line refs (SKU-only) is spread over its lines
 *   - two concurrent creates on one QC: exactly one wins
 *   - downstream: approve → voucher → post → Tally Entry → MD gate → Final Payment
 * --number-race also checks the numbering safeguard: index verified from the DB,
 * case-only renames of older duplicates, keys removed on reject / delete even
 * when written after the invoice was loaded.
 *
 * SAFETY: pinned to a localhost scratch database (dropped on every run) behind
 * the shared e2e guard (S3 + email must be off). Never reads MONGO_URI.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import ProformaInvoice from '../modules/procurement/proforma-invoice/proformaInvoice.model.js';
import GoodsReceiptNote, { GRN_STATUS } from '../modules/procurement/grn/grn.model.js';
import IncomingQC from '../modules/procurement/incoming-qc/incomingQc.model.js';
import VendorInvoice from '../modules/procurement/vendor-invoice/vendorInvoice.model.js';
import VendorVoucher from '../modules/procurement/voucher/voucher.model.js';
import { CHECKLIST_KEYS } from '../modules/procurement/tally-entry/tallyEntry.model.js';
import { completeGrnThroughQc } from './e2eGrnLifecycle.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_multigrn_inv';
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eMultiGrnInvoiceFixture.js');

const VENDOR_A = new mongoose.Types.ObjectId();
const VENDOR_B = new mongoose.Types.ObjectId();
const DOC = { fileName: 'inv.pdf', fileUrl: 'https://example.invalid/e2e/inv.pdf', fileType: 'application/pdf' };

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${detail}` : ''}`);
};
const errMsg = async (p) => { try { await p; return ''; } catch (e) { return e.message || String(e); } };
const r2 = (n) => Math.round(n * 100) / 100;
const ids = (arr) => (arr || []).map(String);

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== 'ambika_e2e_multigrn_inv') throw new Error('Connected to an unexpected database — aborting.');
};

const makePo = (poNumber, vendorId, lines, extra = {}) => VendorPurchaseOrder.create({
  poNumber, vendorId, vendorName: vendorId === VENDOR_A ? 'E2E Vendor A' : 'E2E Vendor B',
  indentId: new mongoose.Types.ObjectId(), poStatus: 'APPROVED',
  items: lines.map(([sku, qty, rate]) => ({
    skuId: sku._id, skuCode: sku.code, itemName: sku.name, unit: sku.unit,
    quantity: qty, receivedQty: 0, pendingQty: qty, rate, gstRate: 18,
  })),
  ...extra,
});

/** lines: [po, poLineIndex, receivedQty, batchNo] — one or more POs (multi-PO GRN). */
const makeGrn = async (grnNumber, lines, user) => {
  const pos = [...new Map(lines.map(([po]) => [String(po._id), po])).values()];
  const head = pos[0];
  const grn = await GoodsReceiptNote.create({
    grnNumber, poId: head._id, poNumber: head.poNumber,
    poIds: pos.map((p) => p._id), poNumbers: pos.map((p) => p.poNumber),
    piId: head.piId || undefined, piNumber: head.piNumber || '',
    vendorId: head.vendorId, vendorName: head.vendorName, warehouse: 'MAIN',
    grnStatus: GRN_STATUS.DRAFT, stockPosted: false,
    items: lines.map(([po, idx, qty, batchNo]) => {
      const p = po.items[idx];
      return {
        poItemId: p._id, poId: po._id, poNumber: po.poNumber, skuId: p.skuId, skuCode: p.skuCode,
        itemName: p.itemName, unit: p.unit, orderedQty: p.quantity, receivedQty: qty, invoiceQty: qty,
        rate: p.rate, batchNo: batchNo || '',
      };
    }),
    totalReceivedQty: lines.reduce((t, l) => t + l[2], 0),
  });
  await completeGrnThroughQc(grn._id, user);
  const qcs = await IncomingQC.find({ grnId: grn._id }).sort('createdAt').lean();
  return { grn, qcs };
};

const run = async ({ seedOnly = false } = {}) => {
  await connect();
  await mongoose.connection.dropDatabase();
  const user = (await User.create({
    email: 'multigrn-e2e@test.local', password: 'E2e@12345', name: 'E2E Multi-GRN', role: 'MD',
    mobile: '9000000077', isActive: true, roles: ['MD'],
  })).toObject();
  const bolt = await SKU.create({ code: 'E2E-BOLT', name: 'E2E Bolt M8', unit: 'PCS', itemType: 'CONSUMABLE' });
  const nut = await SKU.create({ code: 'E2E-NUT', name: 'E2E Nut M8', unit: 'PCS', itemType: 'CONSUMABLE' });

  const { vendorInvoiceService: vis, getAdvancePosition } = await import('../modules/procurement/vendor-invoice/vendorInvoice.service.js');
  const { voucherService } = await import('../modules/procurement/voucher/voucher.service.js');
  const { tallyEntryService } = await import('../modules/procurement/tally-entry/tallyEntry.service.js');
  const { finalPaymentService } = await import('../modules/procurement/final-payment/finalPayment.service.js');

  // PO1 lists BOLT twice at different rates (two PO lines) + NUT; it has a PI with ₹1000 advance.
  let po1 = await makePo('PO-E2E-MG1', VENDOR_A, [[bolt, 300, 50], [bolt, 100, 55], [nut, 40, 2]]);
  const pi1 = await ProformaInvoice.create({
    piNumber: 'PI-E2E-MG1', poId: po1._id, poNumber: po1.poNumber, vendorId: VENDOR_A, vendorName: 'E2E Vendor A',
    totalValue: 5000, paidAmount: 1000, balanceAmount: 4000,
  });
  await VendorPurchaseOrder.updateOne({ _id: po1._id }, { $set: { piId: pi1._id, piNumber: pi1.piNumber, piStatus: 'PAYMENT_COMPLETED' } });
  po1 = await VendorPurchaseOrder.findById(po1._id).lean();
  const po2 = (await makePo('PO-E2E-MG2', VENDOR_A, [[bolt, 50, 50]])).toObject();
  const po3 = (await makePo('PO-E2E-MG3', VENDOR_B, [[bolt, 50, 50]])).toObject();
  const po4 = (await makePo('PO-E2E-MG4', VENDOR_A, [[bolt, 50, 50]])).toObject();

  console.log('\n[seed] GRNs through grnService.complete → MD mirror → Incoming QC (accept all)');
  const g1 = await makeGrn('GRN-E2E-MG1', [[po1, 0, 100, 'B1'], [po1, 1, 60, 'B2'], [po1, 2, 10]], user);
  const g2 = await makeGrn('GRN-E2E-MG2', [[po1, 0, 40, 'B3'], [po1, 2, 10]], user);
  const g3 = await makeGrn('GRN-E2E-MG3', [[po2, 0, 10]], user);
  const g4 = await makeGrn('GRN-E2E-MG4', [[po3, 0, 10]], user);
  const g5 = await makeGrn('GRN-E2E-MG5', [[po1, 0, 30, 'L1'], [po1, 1, 20, 'L2']], user);
  const g6 = await makeGrn('GRN-E2E-MG6', [[po2, 0, 10], [po4, 0, 10]], user); // multi-PO GRN → 2 QCs
  const [qc1, qc2, qc3, qc4, qc5] = [g1, g2, g3, g4, g5].map((g) => g.qcs[0]);
  check('seed: every GRN has a PASSED QC (multi-PO GRN has two)',
    [g1, g2, g3, g4, g5].every((g) => g.qcs.length === 1 && g.qcs[0].qcStatus === 'PASSED')
    && g6.qcs.length === 2 && g6.qcs.every((q) => q.qcStatus === 'PASSED'),
    JSON.stringify([g1, g2, g3, g4, g5, g6].map((g) => g.qcs.map((q) => q.qcStatus))));
  if (seedOnly) {
    console.log('\n[seed-ui] seeded — every GRN still eligible; log in as multigrn-e2e@test.local / E2e@12345\n');
    return;
  }

  const eligible = async () => vis.getInvoiceableGrns({});
  const entry = (list, qc) => list.find((e) => String(e._id) === String(qc._id));

  console.log('\n[eligible GRNs]');
  let list = await eligible();
  const e1 = entry(list, qc1);
  check('all six GRNs (seven QCs) are offered', list.length === 7, `got ${list.length}`);
  check('entry carries GRN date, PO, vendor, QC status', !!e1?.grnDate && e1.poNumber === 'PO-E2E-MG1' && e1.vendorName === 'E2E Vendor A' && e1.qcStatus === 'PASSED');
  check('lines carry qcItemId + batch', e1?.items.length === 3 && e1.items.every((i) => i.qcItemId) && e1.items[0].batchNo === 'B1' && e1.items[1].batchNo === 'B2');
  check('repeated SKU priced from its own PO line (50 vs 55)', e1?.items[0].rate === 50 && e1?.items[1].rate === 55, JSON.stringify(e1?.items.map((i) => i.rate)));

  console.log('\n[single GRN — legacy qcId payload]');
  const single = await vis.create({ qcId: String(qc3._id), invoiceNumber: 'INV-SINGLE' }, user);
  check('one line, qty defaults to pending', single.items.length === 1 && single.items[0].invoiceQty === 10);
  check('legacy + array refs both set', String(single.qcId) === String(qc3._id) && ids(single.qcIds).join() === String(qc3._id) && single.grnNumbers.join() === 'GRN-E2E-MG3');
  check('amount 10 × 50 + 18% = 590, no PI → no advance', single.invoiceAmount === 590 && single.advancePaid === 0 && single.netPayableAmount === 590);

  console.log('\n[one invoice, two GRNs]');
  const rows = [e1, entry(list, qc2)].flatMap((e) => e.items.map((i) => ({
    qcId: String(e._id), qcItemId: String(i.qcItemId), skuCode: i.skuCode, itemName: i.itemName,
    invoiceQty: i.batchNo === 'B1' ? 70 : i.pendingInvoiceQty, rate: i.rate, gstRate: i.gstRate,
  })));
  const multi = await vis.create({
    qcIds: [String(qc1._id), String(qc2._id)], invoiceNumber: 'INV-MULTI', items: rows, invoiceDocument: DOC,
    debitNoteRequired: true, debitNoteNumber: 'DN-1', debitNoteAmount: 100, debitNoteReason: 'short weight',
  }, user);
  check('five lines (two BOLT batches on GRN1, BOLT again on GRN2, NUT on both)', multi.items.length === 5);
  check('per-line qty kept: B1 70, B2 60, NUT 10, B3 40, NUT 10',
    multi.items.map((i) => `${i.batchNo || i.skuCode}:${i.invoiceQty}`).join() === 'B1:70,B2:60,E2E-NUT:10,B3:40,E2E-NUT:10',
    multi.items.map((i) => `${i.batchNo || i.skuCode}:${i.invoiceQty}`).join());
  check('every line names its GRN + QC line', multi.items.every((i) => i.grnNumber && i.qcItemId && i.grnItemId));
  check('taxable 8840 · GST 1591.2 · invoice 10431.2', multi.taxableAmount === 8840 && multi.gstAmount === 1591.2 && multi.invoiceAmount === 10431.2,
    `${multi.taxableAmount} / ${multi.gstAmount} / ${multi.invoiceAmount}`);
  check('PI advance 1000 adjusted; net = 10431.2 − 100 DN − 1000 = 9331.2', multi.advancePaid === 1000 && multi.netPayableAmount === 9331.2, `${multi.advancePaid} / ${multi.netPayableAmount}`);
  check('header refs: first pick + both GRNs/QCs', String(multi.qcId) === String(qc1._id)
    && multi.grnNumbers.join() === 'GRN-E2E-MG1,GRN-E2E-MG2' && ids(multi.qcIds).join() === [qc1._id, qc2._id].join());

  list = await eligible();
  const e1b = entry(list, qc1);
  check('GRN1 still offered with only B1 pending 30', e1b && e1b.pendingInvoiceQty === 30 && e1b.items[0].pendingInvoiceQty === 30 && e1b.items[1].pendingInvoiceQty === 0);
  check('fully invoiced GRN2 / GRN3 no longer offered', !entry(list, qc2) && !entry(list, qc3));

  console.log('\n[partial + over-pending]');
  const b1 = e1b.items[0];
  check('31 on B1 (pending 30) without remarks is refused',
    /exceeds remaining/.test(await errMsg(vis.create({ qcIds: [String(qc1._id)], invoiceNumber: 'INV-OVER', items: [{ qcId: String(qc1._id), qcItemId: String(b1.qcItemId), invoiceQty: 31 }] }, user))));
  const rest = await vis.create({ qcIds: [String(qc1._id)], invoiceNumber: 'INV-REST' }, user);
  check('second invoice on GRN1 takes the remaining 30 only', rest.items.map((i) => i.invoiceQty).join() === '30,0,0' && rest.invoiceAmount === 1770);
  check('PI advance already used → 0 on the second invoice', rest.advancePaid === 0);
  check('GRN1 now fully invoiced', !entry(await eligible(), qc1));

  console.log('\n[duplicate invoice number / invalid combinations]');
  check('same number, same vendor (any case) is refused',
    /already recorded for this vendor/.test(await errMsg(vis.create({ qcIds: [String(qc5._id)], invoiceNumber: 'inv-multi' }, user))));
  const otherVendor = await vis.create({ qcIds: [String(qc4._id)], invoiceNumber: 'INV-MULTI' }, user);
  check('same number for another vendor is allowed', otherVendor.invoiceNumber === 'INV-MULTI' && String(otherVendor.vendorId) === String(VENDOR_B));
  check('renaming an invoice to an existing number is refused',
    /already recorded/.test(await errMsg(vis.update(String(rest._id), { invoiceNumber: 'INV-SINGLE' }, user))));
  const g6a = g6.qcs[0]; const g6b = g6.qcs[1];
  check('GRNs of different vendors are refused',
    /same vendor/.test(await errMsg(vis.create({ qcIds: [String(g6a._id), String(qc4._id)], invoiceNumber: 'X1' }, user))));
  check('the two POs of one multi-PO GRN cannot share an invoice (same-PO rule)',
    /same PO/.test(await errMsg(vis.create({ qcIds: [String(g6a._id), String(g6b._id)], invoiceNumber: 'X2' }, user))));
  check('the same GRN picked twice is refused',
    /more than once/.test(await errMsg(vis.create({ qcIds: [String(qc5._id), String(qc5._id)], invoiceNumber: 'X3' }, user))));

  console.log('\n[older invoice without line refs]');
  // As an invoice saved before line-level refs looks: header qcId only, SKU-only lines.
  const legacyId = new mongoose.Types.ObjectId();
  await VendorInvoice.collection.insertOne({
    _id: legacyId, invoiceNumber: 'INV-LEGACY', qcId: qc5._id, qcNumber: qc5.qcNumber, grnId: qc5.grnId, grnNumber: qc5.grnNumber,
    poId: po1._id, poNumber: po1.poNumber, vendorId: VENDOR_A, vendorName: 'E2E Vendor A', invoiceStatus: 'RECEIVED', isDeleted: false,
    items: [{ _id: new mongoose.Types.ObjectId(), skuCode: 'E2E-BOLT', itemName: 'E2E Bolt M8', acceptedQty: 30, invoiceQty: 30, rate: 50, gstRate: 18 },
      { _id: new mongoose.Types.ObjectId(), skuCode: 'E2E-BOLT', itemName: 'E2E Bolt M8', acceptedQty: 20, invoiceQty: 5, rate: 50, gstRate: 18 }],
    invoiceAmount: 2065, advancePaid: 0, netPayableAmount: 2065, activityTimeline: [], createdAt: new Date(), updatedAt: new Date(),
  });
  let e5 = entry(await eligible(), qc5);
  check('SKU-only 35 spread: L1 30 invoiced / 0 pending, L2 5 / 15 (was 35 on both → hidden)',
    e5 && e5.items.map((i) => `${i.alreadyInvoicedQty}/${i.pendingInvoiceQty}`).join() === '30/0,5/15',
    JSON.stringify(e5?.items.map((i) => [i.alreadyInvoicedQty, i.pendingInvoiceQty])));
  const legacyRows = [{ qcId: String(qc5._id), skuCode: 'E2E-BOLT', invoiceQty: 30 }, { qcId: String(qc5._id), skuCode: 'E2E-BOLT', invoiceQty: 5 }];
  const legacyEdited = await vis.update(String(legacyId), { items: legacyRows, remarks: 'edited' }, user);
  check('editing it keeps 30 + 5 on the right lines and adds line refs',
    legacyEdited.items.map((i) => `${i.batchNo}:${i.invoiceQty}`).join() === 'L1:30,L2:5' && legacyEdited.items.every((i) => i.qcItemId),
    legacyEdited.items.map((i) => `${i.batchNo}:${i.invoiceQty}`).join());
  e5 = entry(await eligible(), qc5);
  check('pending unchanged after the edit (L2 15)', e5?.items[1].pendingInvoiceQty === 15);

  console.log('\n[concurrent creates on one QC]');
  const race = await Promise.allSettled([
    vis.create({ qcIds: [String(qc5._id)], invoiceNumber: 'INV-RACE-1' }, user),
    vis.create({ qcIds: [String(qc5._id)], invoiceNumber: 'INV-RACE-2' }, user),
  ]);
  check('exactly one wins', race.filter((r) => r.status === 'fulfilled').length === 1, race.map((r) => r.reason?.message || 'ok').join(' | '));
  check('L2 is not double-invoiced (15 total across live invoices)',
    (await VendorInvoice.find({ invoiceNumber: /^INV-RACE/, isDeleted: { $ne: true } }).lean()).reduce((t, i) => t + i.items[1].invoiceQty, 0) === 15);
  check('QC invoice locks released', (await IncomingQC.countDocuments({ invoiceLockAt: { $ne: null } })) === 0);

  console.log('\n[edit the two-GRN invoice]');
  const lineRows = (inv, patch) => inv.items.map((i) => ({ qcId: String(i.qcId), qcItemId: String(i.qcItemId), invoiceQty: patch[i.batchNo] ?? i.invoiceQty, rate: i.rate, gstRate: i.gstRate }));
  check('B1 75 (pending 70 once INV-REST holds 30) is refused',
    /exceeds remaining/.test(await errMsg(vis.update(String(multi._id), { items: lineRows(multi, { B1: 75 }) }, user))));
  const edited = await vis.update(String(multi._id), { items: lineRows(multi, { B1: 65 }) }, user);
  check('B1 65 → invoice 10136.2, advance kept 1000, net 9036.2',
    edited.invoiceAmount === 10136.2 && edited.advancePaid === 1000 && edited.netPayableAmount === 9036.2,
    `${edited.invoiceAmount} / ${edited.advancePaid} / ${edited.netPayableAmount}`);
  const adv = await getAdvancePosition(pi1._id);
  check('PI advance position: paid 1000 · allocated 1000 · available 0', adv.advancePaid === 1000 && adv.advanceAllocated === 1000 && adv.advanceAvailable === 0, JSON.stringify(adv));

  console.log('\n[reject frees quantity]');
  await vis.reject(String(rest._id), { remarks: 'wrong copy' }, user);
  const e1c = entry(await eligible(), qc1);
  check('rejecting INV-REST puts B1 back: pending 35 (100 − 65)', e1c?.items[0].pendingInvoiceQty === 35, JSON.stringify(e1c?.items.map((i) => i.pendingInvoiceQty)));

  console.log('\n[downstream: voucher → Tally → MD → final payment]');
  await vis.approve(String(multi._id), {}, user);
  const voucher = await voucherService.create({ invoiceId: String(multi._id) }, user);
  check('voucher carries both GRNs + QCs', voucher.grnNumbers.join() === 'GRN-E2E-MG1,GRN-E2E-MG2' && voucher.qcIds.length === 2);
  check('voucher amounts = invoice (9036.2 net, 1000 advance, 100 DN)',
    voucher.netPayableAmount === 9036.2 && voucher.advancePaid === 1000 && voucher.debitNoteAmount === 100 && voucher.invoiceAmount === 10136.2);
  await voucherService.post(String(voucher._id), {}, user);
  check('posting links the voucher onto the invoice', String((await VendorInvoice.findById(multi._id).lean()).voucherId) === String(voucher._id));
  const tally = await tallyEntryService.create({ voucherId: String(voucher._id) }, user);
  check('Tally Entry lists both GRNs', tally.grnNumbers.join() === 'GRN-E2E-MG1,GRN-E2E-MG2' && tally.grnNumber === 'GRN-E2E-MG1');
  await tallyEntryService.complete(String(tally._id), { statusDone: 'YES', checklist: Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, true])) }, user);
  const pay = { voucherId: String(voucher._id), paymentStatus: 'FULL_PAYMENT', paidAmount: 9036.2, paymentMode: 'NEFT', paymentReferenceNumber: 'UTR-E2E' };
  check('final payment waits for the MD', /MD/i.test(await errMsg(finalPaymentService.create(pay, user))));
  // Stand-in for the MD's signature on the approval mirror field (as the other fixtures do).
  await VendorVoucher.updateOne({ _id: voucher._id }, { $set: { approvalStatus: 'MD_APPROVED' } });
  await finalPaymentService.create(pay, user);
  const vAfter = await VendorVoucher.findById(voucher._id).lean();
  const invAfter = await VendorInvoice.findById(multi._id).lean();
  check('full payment closes voucher + invoice', vAfter.voucherStatus === 'FULLY_PAID' && r2(vAfter.balanceAmount) === 0 && invAfter.invoiceStatus === 'PAYMENT_COMPLETED',
    `${vAfter.voucherStatus} / ${vAfter.balanceAmount} / ${invAfter.invoiceStatus}`);

  console.log(`\n${failures ? `FAILED — ${failures} check(s)` : 'ALL CHECKS PASSED'}\n`);
};

/**
 * Hold every duplicate-number PRE-CHECK (the service's findOne on invoiceNumber)
 * until `parties` requests have all reached it, so each of them passes the
 * pre-check before any writes — the classic check-then-write race, made
 * deterministic. Only the database index can then stop the duplicate.
 * Returns { release, stats } — release() restores VendorInvoice.findOne.
 */
const gateNumberPreCheck = (parties, timeoutMs = 8000) => {
  const original = VendorInvoice.findOne;
  const stats = { arrived: 0, timedOut: false };
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const timer = setTimeout(() => { stats.timedOut = true; open(); }, timeoutMs);
  VendorInvoice.findOne = function gatedFindOne(filter, ...rest) {
    const query = original.call(this, filter, ...rest);
    if (!(filter?.invoiceNumber instanceof RegExp)) return query;
    const exec = query.exec.bind(query);
    query.exec = async (...args) => {
      stats.arrived += 1;
      if (stats.arrived >= parties) { clearTimeout(timer); open(); }
      await gate;
      return exec(...args);
    };
    return query;
  };
  return { stats, release: () => { clearTimeout(timer); VendorInvoice.findOne = original; } };
};

/**
 * --number-race: concurrent creates / renames with the same vendor invoice
 * number. Adds its own run-tagged vendors, POs and GRNs to the existing scratch
 * DB — nothing is dropped, reset or deleted, so it can be re-run as is.
 */
const numberRace = async () => {
  await connect();
  await VendorInvoice.init(); // make sure the partial unique index is built before racing
  const tag = Date.now().toString(36).toUpperCase();
  const user = (await User.findOne({ email: 'multigrn-e2e@test.local' }).lean()) || (await User.create({
    email: 'multigrn-e2e@test.local', password: 'E2e@12345', name: 'E2E Multi-GRN', role: 'MD',
    mobile: '9000000077', isActive: true, roles: ['MD'],
  })).toObject();
  const sku = async (code, name) => (await SKU.findOne({ code }).lean())
    || (await SKU.create({ code, name, unit: 'PCS', itemType: 'CONSUMABLE' })).toObject();
  const bolt = await sku('E2E-BOLT', 'E2E Bolt M8');
  const { vendorInvoiceService: vis } = await import('../modules/procurement/vendor-invoice/vendorInvoice.service.js');
  const guard = await import('../modules/procurement/vendor-invoice/invoiceNumberIndexGuard.js');

  const indexes = await VendorInvoice.collection.indexes();
  const idx = indexes.find((i) => i.name === 'uniq_live_vendor_invoice_number');
  console.log(`\n[index] run ${tag}`);
  check('partial unique index { vendorId, invoiceNumberKey } exists in the DB',
    !!idx && idx.unique === true && JSON.stringify(idx.partialFilterExpression) === '{"invoiceNumberKey":{"$type":"string"}}', JSON.stringify(idx));
  guard.resetInvoiceNumberIndexGuard();
  const guardStatus = await guard.verifyInvoiceNumberIndex();
  check('startup guard confirms it from the DB (listIndexes) → OK', guardStatus.status === 'OK', JSON.stringify(guardStatus));
  // Read-only look at another scratch DB that has invoices but never got the index.
  const otherIdx = await mongoose.connection.client.db('ambika_e2e_grnqc').collection('vendorinvoices').indexes().catch(() => []);
  const otherEval = guard.evaluateInvoiceNumberIndex(otherIdx);
  check('a scratch DB without the index (ambika_e2e_grnqc, read-only) is reported missing', !otherEval.ok && /missing/.test(otherEval.problem), otherEval.problem);

  // Fresh vendors every run, no PI (so no PI lock serialises the racers).
  const VA = new mongoose.Types.ObjectId();
  const VB = new mongoose.Types.ObjectId();
  const pa = (await makePo(`PO-NR-${tag}-A`, VA, [[bolt, 500, 50]], { vendorName: `E2E Race Vendor A ${tag}` })).toObject();
  const pb = (await makePo(`PO-NR-${tag}-B`, VB, [[bolt, 100, 50]], { vendorName: `E2E Race Vendor B ${tag}` })).toObject();
  const qcOf = async (n, po, qty) => (await makeGrn(`GRN-NR-${tag}-${n}`, [[po, 0, qty]], user)).qcs[0];
  const qa = [];
  for (const n of [1, 2, 3, 4, 5, 6]) qa.push(await qcOf(n, pa, 10));
  const q7Part = await qcOf(7, pa, 20);
  const qb = await qcOf('B1', pb, 10);
  const id = (q) => String(q._id);
  const liveWithKey = (vendorId, no) => VendorInvoice.countDocuments({ vendorId, invoiceNumberKey: no.toLowerCase(), isDeleted: { $ne: true } });

  console.log('\n[1] two creates pass the pre-check together (multi-GRN vs single GRN)');
  const NO = `RACE-${tag}`;
  let gate = gateNumberPreCheck(2);
  let res = await Promise.allSettled([
    vis.create({ qcIds: [id(qa[0]), id(qa[1])], invoiceNumber: NO }, user),
    vis.create({ qcIds: [id(qa[2])], invoiceNumber: NO.toLowerCase() }, user),
  ]);
  gate.release();
  check('both requests reached the pre-check before either wrote', gate.stats.arrived === 2 && !gate.stats.timedOut, JSON.stringify(gate.stats));
  const won = res.filter((r) => r.status === 'fulfilled');
  const lost = res.filter((r) => r.status === 'rejected');
  check('exactly one succeeds', won.length === 1 && lost.length === 1, res.map((r) => r.reason?.message || 'ok').join(' | '));
  check('the loser gets the validation message (400), not a raw duplicate-key error',
    lost[0]?.reason?.statusCode === 400 && /already recorded for this vendor/.test(lost[0]?.reason?.message || ''), lost[0]?.reason?.message);
  check('one live invoice holds the number', (await liveWithKey(VA, NO)) === 1);
  const winner = won[0]?.value;
  const loserQcs = String(winner?.qcId) === id(qa[0]) ? [qa[2]] : [qa[0], qa[1]];
  const eligibleA = await vis.getInvoiceableQcs({ vendorId: String(VA) });
  check('the losing request left its GRNs fully pending',
    loserQcs.every((q) => eligibleA.find((e) => String(e._id) === id(q))?.totalPendingInvoiceQty === 10));

  console.log('\n[2] burst: three creates, no gate');
  const BURST = `BURST-${tag}`;
  res = await Promise.allSettled([qa[3], qa[4], qa[5]].map((q) => vis.create({ qcIds: [id(q)], invoiceNumber: BURST }, user)));
  check('exactly one of three succeeds', res.filter((r) => r.status === 'fulfilled').length === 1, res.map((r) => r.reason?.message || 'ok').join(' | '));
  check('every loser gets the validation message', res.filter((r) => r.status === 'rejected').every((r) => r.reason?.statusCode === 400 && /already recorded/.test(r.reason.message)));
  check('one live invoice holds the burst number', (await liveWithKey(VA, BURST)) === 1);
  const burstWinner = res.find((r) => r.status === 'fulfilled')?.value;

  console.log('\n[3] other vendor, rejected and deleted invoices');
  const other = await vis.create({ qcIds: [id(qb)], invoiceNumber: NO }, user);
  check('same number for another vendor is allowed', other.invoiceNumber === NO);
  await vis.reject(String(winner._id), { remarks: 'race test' }, user);
  check('rejecting removes the number key', (await VendorInvoice.findById(winner._id).lean()).invoiceNumberKey === undefined);
  const reused = await vis.create({ qcIds: loserQcs.map(id), invoiceNumber: `Race-${tag}` }, user);
  check('a rejected number can be used again', String(reused.invoiceNumberKey) === NO.toLowerCase());
  check('burst winner is a DRAFT (no document)', burstWinner?.invoiceStatus === 'DRAFT');
  await vis.remove(String(burstWinner._id), user);
  check('deleting a draft removes its key', (await VendorInvoice.findById(burstWinner._id).lean()).invoiceNumberKey === undefined);
  const again = await vis.create({ qcIds: [String(burstWinner.qcId)], invoiceNumber: BURST }, user);
  check('a deleted draft\'s number can be used again', again.invoiceNumber === BURST);

  console.log('\n[4] invoices recorded before the key existed');
  // As older data looks: no invoiceNumberKey, and two live invoices sharing a number.
  const legacy = (no) => ({
    _id: new mongoose.Types.ObjectId(), invoiceNumber: no, qcId: new mongoose.Types.ObjectId(), vendorId: VA,
    vendorName: `E2E Race Vendor A ${tag}`, invoiceStatus: 'RECEIVED', isDeleted: false, items: [],
    invoiceAmount: 100, advancePaid: 0, netPayableAmount: 100, activityTimeline: [], createdAt: new Date(), updatedAt: new Date(),
  });
  const dupA = legacy(`OLD-${tag}`); const dupB = legacy(`old-${tag}`);
  const renA = legacy(`REN-A-${tag}`); const renB = legacy(`REN-B-${tag}`);
  await VendorInvoice.collection.insertMany([dupA, dupB, renA, renB]);
  const editedA = await vis.update(String(dupA._id), { invoiceNumber: dupA.invoiceNumber, remarks: 'still a duplicate' }, user);
  check('an existing duplicate stays editable with its number unchanged', editedA.remarks === 'still a duplicate' && editedA.invoiceNumberKey === undefined);
  const editedB = await vis.update(String(dupB._id), { tdsAmount: 5 }, user);
  check('…and so does its twin', editedB.tdsAmount === 5);
  check('renaming one to a number another live invoice uses is refused',
    /already recorded/.test(await errMsg(vis.update(String(dupA._id), { invoiceNumber: BURST }, user))));
  // Case-only renames are number changes: the lookup sees the unkeyed twin.
  check('a case-only rename of a duplicate is refused (its unkeyed twin holds the number)',
    /already recorded for this vendor/.test(await errMsg(vis.update(String(dupA._id), { invoiceNumber: `Old-${tag}` }, user))));
  check('…and so is the twin\'s', /already recorded for this vendor/.test(await errMsg(vis.update(String(dupB._id), { invoiceNumber: `OLD-${tag}` }, user))));
  const afterCase = await VendorInvoice.find({ _id: { $in: [dupA._id, dupB._id] } }).lean();
  check('…both keep their numbers and stay unkeyed',
    afterCase.map((d) => d.invoiceNumber).sort().join() === [`OLD-${tag}`, `old-${tag}`].sort().join() && afterCase.every((d) => d.invoiceNumberKey === undefined));
  const solo = legacy(`solo-${tag}`);
  await VendorInvoice.collection.insertOne(solo);
  const soloRenamed = await vis.update(String(solo._id), { invoiceNumber: `SOLO-${tag}` }, user);
  check('a case-only rename of an older invoice WITHOUT a twin is allowed and keys it',
    soloRenamed.invoiceNumber === `SOLO-${tag}` && soloRenamed.invoiceNumberKey === `solo-${tag}`.toLowerCase());
  check('an unchanged number on an unkeyed duplicate is still not checked (stays editable)',
    (await vis.update(String(dupB._id), { invoiceNumber: `old-${tag}`, remarks: 'same number' }, user)).remarks === 'same number');

  const RENAME = `RENAMED-${tag}`;
  gate = gateNumberPreCheck(2);
  res = await Promise.allSettled([
    vis.update(String(renA._id), { invoiceNumber: RENAME }, user),
    vis.update(String(renB._id), { invoiceNumber: RENAME }, user),
  ]);
  gate.release();
  check('two concurrent renames to one number: both passed the pre-check', gate.stats.arrived === 2 && !gate.stats.timedOut, JSON.stringify(gate.stats));
  check('…exactly one rename succeeds', res.filter((r) => r.status === 'fulfilled').length === 1, res.map((r) => r.reason?.message || 'ok').join(' | '));
  const renamedLoser = res[0].status === 'rejected' ? renA : renB;
  check('…the other keeps its old number', (await VendorInvoice.findById(renamedLoser._id).lean()).invoiceNumber === renamedLoser.invoiceNumber);
  check('…and one live invoice holds the new number', (await liveWithKey(VA, RENAME)) === 1);

  console.log('\n[5] key written after the invoice was loaded (e.g. by a backfill)');
  const staleR = legacy(`STALE-R-${tag}`);
  const staleD = { ...legacy(`STALE-D-${tag}`), invoiceStatus: 'DRAFT' };
  await VendorInvoice.collection.insertMany([staleR, staleD]);
  const rawKey = async (_id) => (await VendorInvoice.collection.findOne({ _id }, { projection: { invoiceNumberKey: 1 } }))?.invoiceNumberKey;
  // What the service's reject() / remove() do — load, change, save — with the
  // key written to the DB between the load and the save.
  const loadedR = await VendorInvoice.findById(staleR._id);
  await VendorInvoice.collection.updateOne({ _id: staleR._id }, { $set: { invoiceNumberKey: `stale-r-${tag}`.toLowerCase() } });
  loadedR.invoiceStatus = 'REJECTED';
  await loadedR.save();
  check('rejecting removes a key added after the invoice was loaded', (await rawKey(staleR._id)) === undefined);
  const loadedD = await VendorInvoice.findById(staleD._id);
  await VendorInvoice.collection.updateOne({ _id: staleD._id }, { $set: { invoiceNumberKey: `stale-d-${tag}`.toLowerCase() } });
  loadedD.isDeleted = true;
  await loadedD.save();
  check('deleting removes a key added after the invoice was loaded', (await rawKey(staleD._id)) === undefined);
  const taker = legacy(`TAKER-${tag}`);
  await VendorInvoice.collection.insertOne(taker);
  const took = await vis.update(String(taker._id), { invoiceNumber: `STALE-R-${tag}` }, user);
  check('…so the rejected number can be taken again', took.invoiceNumberKey === `stale-r-${tag}`.toLowerCase());

  console.log('\n[6] partial invoicing unaffected');
  const e7 = (await vis.getInvoiceableQcs({ vendorId: String(VA) })).find((e) => String(e._id) === id(q7Part));
  const part1 = await vis.create({ qcIds: [id(q7Part)], invoiceNumber: `PART1-${tag}`, items: [{ qcId: id(q7Part), qcItemId: String(e7.items[0].qcItemId), invoiceQty: 5 }] }, user);
  const part2 = await vis.create({ qcIds: [id(q7Part)], invoiceNumber: `PART2-${tag}` }, user);
  check('two numbers, one GRN: 5 + 15 invoiced', part1.items[0].invoiceQty === 5 && part2.items[0].invoiceQty === 15);
  check('QC invoice locks all released', (await IncomingQC.countDocuments({ invoiceLockAt: { $ne: null } })) === 0);

  console.log(`\n${failures ? `FAILED — ${failures} check(s)` : 'ALL CHECKS PASSED'}\n`);
};

if (isEntry(import.meta.url)) {
  const mode = process.argv[2];
  if (!['--api', '--seed-ui', '--number-race'].includes(mode)) {
    console.error('usage: node src/scripts/e2eMultiGrnInvoiceFixture.js --api | --seed-ui | --number-race');
    process.exit(2);
  }
  (mode === '--number-race' ? numberRace() : run({ seedOnly: mode === '--seed-ui' }))
    .catch((err) => { console.error(err); failures += 1; })
    .finally(async () => { await mongoose.disconnect(); process.exit(failures ? 1 : 0); });
}
