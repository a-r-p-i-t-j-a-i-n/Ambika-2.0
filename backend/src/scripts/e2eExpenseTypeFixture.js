/**
 * Service-level oracle for the Expense Type of an Expense / Direct Bill voucher
 * (no browser): Direct (no PO/GRN), Against PO (no GRN), Against GRN (a GRN
 * raised without a PO).
 *
 *   node src/scripts/e2eExpenseTypeFixture.js --api       seed + every check below
 *   node src/scripts/e2eExpenseTypeFixture.js --seed-ui   seed only, for frontend/e2e/expenseType.e2e.mjs
 *                                                         (backend: e2eServer.js on this DB;
 *                                                          login expense-e2e@test.local / E2e@12345)
 *
 * Seeds a fresh scratch DB — POs in every state, GRNs raised with and without a
 * PO and completed through the real GRN + Incoming QC services — then checks:
 *   - Direct: saves with no PO / GRN; a PO or GRN sent with it is ignored; old
 *     expense vouchers (no expenseType) still read, edit and post as Direct
 *   - Against PO: picker lists only approved / released POs with no live GRN
 *     and no live vendor invoice; vendor comes from the PO; vendor mismatch,
 *     draft / cancelled / rejected PO, PO with a GRN refused; the PO-value cap;
 *     two concurrent bills over the cap never both kept
 *   - one payment path per PO: GRN create, GRN complete and vendor invoice
 *     create refused while a live expense voucher holds the PO; cancelling the
 *     draft voucher frees the PO
 *   - Against GRN: only completed W/O-PO GRNs; a PO GRN / draft GRN / vendor
 *     mismatch / second bill on one GRN refused; two concurrent bills on one
 *     GRN never both kept
 *   - edits: amount re-capped, switching type / document, back to Direct
 *   - purchase vouchers cannot be relinked through an edit
 *   - downstream unchanged: post → MD approval → Tally Entry → MD gate →
 *     Final Payment (carries the PO)
 *
 * SAFETY: pinned to a localhost scratch database (dropped on every run) behind
 * the shared e2e guard (S3 + email must be off). Never reads MONGO_URI.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import Party from '../modules/clients/party.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote, { GRN_STATUS } from '../modules/procurement/grn/grn.model.js';
import IncomingQC from '../modules/procurement/incoming-qc/incomingQc.model.js';
import VendorVoucher from '../modules/procurement/voucher/voucher.model.js';
import { CHECKLIST_KEYS } from '../modules/procurement/tally-entry/tallyEntry.model.js';
import { completeGrnThroughQc } from './e2eGrnLifecycle.js';

export const E2E_DB = 'ambika_e2e_expense_type';
export const E2E_URI = `mongodb://127.0.0.1:27017/${E2E_DB}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eExpenseTypeFixture.js');

export const E2E_LOGIN = { email: 'expense-e2e@test.local', password: 'E2e@12345' };
const VENDOR_A = new mongoose.Types.ObjectId();
const VENDOR_B = new mongoose.Types.ObjectId();
const VENDOR_C = new mongoose.Types.ObjectId();
const NAMES = { [VENDOR_A]: 'E2E Vendor A', [VENDOR_B]: 'E2E Vendor B', [VENDOR_C]: 'E2E Vendor C (walk-in)' };

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${detail}` : ''}`);
};
const errMsg = async (p) => { try { await p; return ''; } catch (e) { return e.message || String(e); } };
const id = (d) => String(d._id);

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== E2E_DB) throw new Error('Connected to an unexpected database — aborting.');
};

const makePo = (poNumber, vendorId, sku, { qty = 10, rate = 1000, grandTotal, ...extra } = {}) => VendorPurchaseOrder.create({
  poNumber, vendorId, vendorName: NAMES[vendorId], indentId: new mongoose.Types.ObjectId(),
  approvalStatus: 'APPROVED', poStatus: 'RELEASED_TO_VENDOR', paymentTerms: '30 days',
  items: [{ skuId: sku._id, skuCode: sku.code, itemName: sku.name, unit: sku.unit, quantity: qty, receivedQty: 0, pendingQty: qty, rate, gstRate: 18 }],
  grandTotal: grandTotal ?? qty * rate * 1.18,
  ...extra,
});

// A PO the GRN service will accept (followed up, PI settled, final material date).
const READY_FOR_GRN = { followUpStatus: 'READY_FOR_GRN', piStatus: 'NOT_RECEIVED', readyForGrnAt: new Date(), finalMaterialDate: new Date() };

const draftGrnOnPo = (grnNumber, po) => GoodsReceiptNote.create({
  grnNumber, poId: po._id, poNumber: po.poNumber, poIds: [po._id], poNumbers: [po.poNumber],
  vendorId: po.vendorId, vendorName: po.vendorName, warehouse: 'MAIN', grnStatus: GRN_STATUS.DRAFT, stockPosted: false,
  items: [{
    poItemId: po.items[0]._id, poId: po._id, poNumber: po.poNumber, skuId: po.items[0].skuId, skuCode: po.items[0].skuCode,
    itemName: po.items[0].itemName, unit: po.items[0].unit, orderedQty: po.items[0].quantity, receivedQty: 2, invoiceQty: 2, rate: po.items[0].rate,
  }],
  totalReceivedQty: 2,
});

/** A GRN with no PO through the real service; completed through QC unless draft. */
const grnWithoutPo = async (grnService, user, sku, vendorId, { invoiceNumber = '', draft = false } = {}) => {
  const grn = await grnService.create({
    isWithoutPo: true, vendorId: String(vendorId), vendorName: NAMES[vendorId], invoiceNumber, invoiceDate: new Date('2026-10-20'),
    items: [{ skuId: String(sku._id), skuCode: sku.code, itemName: sku.name, unit: sku.unit, receivedQty: 5, rate: 200 }],
  }, user);
  if (!draft) await completeGrnThroughQc(grn._id, user);
  return GoodsReceiptNote.findById(grn._id).lean();
};

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  const user = (await User.create({
    email: E2E_LOGIN.email, password: E2E_LOGIN.password, name: 'E2E Expense', role: 'MD',
    mobile: '9000000088', isActive: true, roles: ['MD'],
  })).toObject();
  const sku = await SKU.create({ code: 'E2E-EXP-BOLT', name: 'E2E Expense Bolt', unit: 'PCS', itemType: 'CONSUMABLE' });
  const party = await Party.create({ name: 'E2E Direct Party' });
  const { grnService } = await import('../modules/procurement/grn/grn.service.js');

  const po = {
    a:    (await makePo('PO-EXP-A', VENDOR_A, sku)).toObject(),                                   // 11 800
    b:    (await makePo('PO-EXP-B', VENDOR_B, sku, { qty: 1, rate: 1000, grandTotal: 1000, poStatus: 'APPROVED' })).toObject(),
    draft:(await makePo('PO-EXP-DRAFT', VENDOR_A, sku, { approvalStatus: 'DRAFT', poStatus: 'DRAFT' })).toObject(),
    canc: (await makePo('PO-EXP-CANC', VENDOR_A, sku, { poStatus: 'CANCELLED' })).toObject(),
    rej:  (await makePo('PO-EXP-REJ', VENDOR_A, sku, { approvalStatus: 'REJECTED', poStatus: 'APPROVED' })).toObject(),
    cg:   (await makePo('PO-EXP-CG', VENDOR_A, sku)).toObject(),                                  // only a cancelled GRN
    g:    (await makePo('PO-EXP-G', VENDOR_A, sku, READY_FOR_GRN)).toObject(),                   // has a completed GRN + QC
    r:    (await makePo('PO-EXP-R', VENDOR_A, sku, READY_FOR_GRN)).toObject(),                   // GRN-create guard
    s:    (await makePo('PO-EXP-S', VENDOR_A, sku, READY_FOR_GRN)).toObject(),                   // GRN-complete guard
    ui:   (await makePo('PO-EXP-UI', VENDOR_A, sku, { qty: 5, rate: 2000 })).toObject(),          // 11 800, browser
    ui2:  (await makePo('PO-EXP-UI2', VENDOR_B, sku, { qty: 1, rate: 500 })).toObject(),          // 590, browser over-value
  };
  const cancelledGrn = await draftGrnOnPo('GRN-EXP-CG', po.cg);
  await GoodsReceiptNote.updateOne({ _id: cancelledGrn._id }, { $set: { grnStatus: GRN_STATUS.CANCELLED } });
  const poGrnDraft = await draftGrnOnPo('GRN-EXP-G', po.g);
  const poGrn = await completeGrnThroughQc(poGrnDraft._id, user);
  const poGrnQc = await IncomingQC.findOne({ grnId: poGrn._id }).lean();

  const grn = {
    w1:    await grnWithoutPo(grnService, user, sku, VENDOR_C, { invoiceNumber: 'SUP-77' }),
    w2:    await grnWithoutPo(grnService, user, sku, VENDOR_C),
    draft: await grnWithoutPo(grnService, user, sku, VENDOR_C, { draft: true }),
    ui:    await grnWithoutPo(grnService, user, sku, VENDOR_C, { invoiceNumber: 'SUP-UI-9' }),
    po: poGrn,
  };
  return { user, sku, party, po, grn, poGrnQc };
};

const amounts = (basicValue, gstRatePercent = 18) => ({ basicValue, taxableAmount: basicValue, gstRatePercent });

const run = async ({ seedOnly = false } = {}) => {
  const s = await seed();
  const { user, party, po, grn, poGrnQc } = s;
  const okGrnStates = ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'];
  check('seed: W/O-PO GRNs completed (draft one stays DRAFT), the PO GRN has a QC',
    [grn.w1, grn.w2, grn.ui].every((g) => g.isWithoutPo && okGrnStates.includes(g.grnStatus))
    && grn.draft.grnStatus === 'DRAFT' && !!poGrnQc,
    JSON.stringify([grn.w1, grn.w2, grn.draft, grn.ui].map((g) => g.grnStatus)));
  if (seedOnly) {
    console.log(`\nSeeded ${E2E_DB} for the browser spec — login ${E2E_LOGIN.email} / ${E2E_LOGIN.password}\n`);
    return;
  }

  const { voucherService: vs } = await import('../modules/procurement/voucher/voucher.service.js');
  const { grnService } = await import('../modules/procurement/grn/grn.service.js');
  const { vendorInvoiceService } = await import('../modules/procurement/vendor-invoice/vendorInvoice.service.js');
  const { tallyEntryService } = await import('../modules/procurement/tally-entry/tallyEntry.service.js');
  const { finalPaymentService } = await import('../modules/procurement/final-payment/finalPayment.service.js');
  const base = { voucherType: 'EXPENSE', expenseCategory: 'AMC' };
  const options = async (type, extra = {}) => (await vs.getExpenseLinkOptions({ type, ...extra })).map((o) => o.poNumber || o.grnNumber);

  console.log('\n[1] Direct Expense (without PO & GRN)');
  const d1 = await vs.create({ ...base, partyName: 'Ad-hoc Electrician', ...amounts(1000) }, user);
  check('saves with no PO / GRN; type DIRECT; total 1180',
    d1.expenseType === 'DIRECT' && !d1.poId && !d1.grnId && !d1.grnIds.length && d1.netPayableAmount === 1180,
    JSON.stringify({ t: d1.expenseType, po: d1.poId, net: d1.netPayableAmount }));
  const d2 = await vs.create({ ...base, expenseType: 'DIRECT', poId: id(po.a), grnId: id(grn.w1), partyName: 'X', ...amounts(100) }, user);
  check('a PO / GRN sent with a Direct expense is not stored', !d2.poId && !d2.grnId && !d2.grnIds.length);
  const d3 = await vs.create({ ...base, vendorId: id(party), partyName: 'ignored', expenseInvoiceNo: 'DP-1', ...amounts(500) }, user);
  check('vendor-master Direct bill still takes the Party name', String(d3.vendorId) === id(party) && d3.vendorName === 'E2E Direct Party');
  check('duplicate Direct bill no. for the same vendor still refused',
    /already exists/.test(await errMsg(vs.create({ ...base, vendorId: id(party), partyName: 'x', expenseInvoiceNo: 'dp-1', ...amounts(1) }, user))));

  // An expense voucher saved before Expense Type existed: no expenseType field at all.
  const legacyId = new mongoose.Types.ObjectId();
  await VendorVoucher.collection.insertOne({
    _id: legacyId, voucherNumber: 'AGL/EXP-LEGACY', voucherType: 'EXPENSE', voucherDate: new Date(), expenseCategory: 'Travel',
    partyName: 'Old Party', vendorName: 'Old Party', basicValue: 200, netPayableAmount: 200, totalAmountPayable: 200, balanceAmount: 200,
    paidAmount: 0, voucherStatus: 'DRAFT', tallyEntryStatus: 'PENDING', finalPaymentStatus: 'PENDING', approvalStatus: 'NOT_REQUIRED',
    grnIds: [], grnNumbers: [], qcIds: [], activityTimeline: [], isDeleted: false, createdAt: new Date(), updatedAt: new Date(),
  });
  const legacy = await vs.getById(String(legacyId));
  check('old expense voucher reads with expenseType null (= Direct)', legacy.expenseType === null || legacy.expenseType === undefined, String(legacy.expenseType));
  const legacyEdited = await vs.update(String(legacyId), { remarks: 'edited', basicValue: 250 }, user);
  check('…edits as Direct (party kept, total 250, now typed DIRECT)',
    legacyEdited.partyName === 'Old Party' && legacyEdited.netPayableAmount === 250 && legacyEdited.expenseType === 'DIRECT' && !legacyEdited.poId);
  const legacyPosted = await vs.post(String(legacyId), {}, user);
  check('…and posts', legacyPosted.voucherStatus === 'POSTED');

  console.log('\n[2] Expense Against PO — picker');
  const poList = await options('PO');
  check('lists released / approved POs with no GRN and no invoice (A, B, CG, R, S, UI, UI2)',
    ['PO-EXP-A', 'PO-EXP-B', 'PO-EXP-CG', 'PO-EXP-R', 'PO-EXP-S', 'PO-EXP-UI', 'PO-EXP-UI2'].every((n) => poList.includes(n)), poList.join());
  check('…not the draft, cancelled, rejected PO or the PO with a GRN',
    !['PO-EXP-DRAFT', 'PO-EXP-CANC', 'PO-EXP-REJ', 'PO-EXP-G'].some((n) => poList.includes(n)), poList.join());
  check('search narrows the list', (await options('PO', { search: 'exp-ui2' })).join() === 'PO-EXP-UI2');

  console.log('\n[3] Expense Against PO — create rules');
  const pa = await vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po.a), expenseInvoiceNo: 'VA-100', ...amounts(5000) }, user);
  check('saves against PO-EXP-A with no GRN; vendor + party from the PO',
    pa.expenseType === 'AGAINST_PO' && String(pa.poId) === id(po.a) && pa.poNumber === 'PO-EXP-A' && !pa.grnId
    && String(pa.vendorId) === String(VENDOR_A) && pa.vendorName === 'E2E Vendor A' && pa.partyName === 'E2E Vendor A' && pa.netPayableAmount === 5900,
    JSON.stringify({ v: pa.vendorName, p: pa.partyName, n: pa.netPayableAmount }));
  check('vendor mismatch refused',
    /does not match/.test(await errMsg(vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po.b), vendorId: String(VENDOR_A), expenseInvoiceNo: 'X1', ...amounts(10) }, user))));
  check('the PO\'s own vendor is accepted when sent',
    !(await errMsg(vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po.cg), vendorId: String(VENDOR_A), expenseInvoiceNo: 'VA-CG', ...amounts(10) }, user))));
  check('bill no. required', /Bill\/Invoice No/.test(await errMsg(vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po.b), ...amounts(10) }, user))));
  check('PO required', /Purchase Order/.test(await errMsg(vs.create({ ...base, expenseType: 'AGAINST_PO', expenseInvoiceNo: 'X', ...amounts(10) }, user))));
  check('unknown PO → 404', /not found/.test(await errMsg(vs.create({ ...base, expenseType: 'AGAINST_PO', poId: String(new mongoose.Types.ObjectId()), expenseInvoiceNo: 'X', ...amounts(10) }, user))));
  for (const [k, label] of [['draft', 'draft'], ['canc', 'cancelled'], ['rej', 'rejected']]) {
    check(`${label} PO refused`, /can only be raised against an approved PO/.test(
      await errMsg(vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po[k]), expenseInvoiceNo: `X-${k}`, ...amounts(10) }, user))));
  }
  check('PO with a GRN refused (pays through GRN → invoice)',
    /already has GRN /.test(await errMsg(vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po.g), expenseInvoiceNo: 'X-G', ...amounts(10) }, user))));
  check('same bill no. for the same vendor refused', /already exists/.test(
    await errMsg(vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po.r), expenseInvoiceNo: 'va-100', ...amounts(10) }, user))));

  console.log('\n[4] PO value cap (gross bill before TDS / advance)');
  const a2 = await vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po.a), expenseInvoiceNo: 'VA-101', ...amounts(4000), tdsAmount: 400 }, user);
  check('second bill on PO-EXP-A within the PO value is kept (5900 + 4720 ≤ 11800)', a2.voucherStatus === 'DRAFT' && a2.netPayableAmount === 4320);
  const aRow = (await vs.getExpenseLinkOptions({ type: 'PO' })).find((o) => o.poNumber === 'PO-EXP-A');
  check('picker shows billed 10620 / left 1180 on PO-EXP-A', aRow?.expensedAmount === 10620 && aRow?.remainingAmount === 1180, JSON.stringify(aRow));
  check('a bill above what is left is refused',
    /above the PO value/.test(await errMsg(vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po.a), expenseInvoiceNo: 'VA-102', ...amounts(1001) }, user))));
  check('editing a bill above the PO value is refused',
    /above the PO value/.test(await errMsg(vs.update(id(a2), { basicValue: 6000, taxableAmount: 6000 }, user))));
  check('…and leaves it unchanged', (await VendorVoucher.findById(a2._id).lean()).basicValue === 4000);
  const exact = await vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po.a), expenseInvoiceNo: 'VA-103', ...amounts(1000) }, user);
  check('a bill that uses exactly what is left is kept, then the PO leaves the picker',
    exact.netPayableAmount === 1180 && !(await options('PO')).includes('PO-EXP-A'));

  console.log('\n[5] duplicate / concurrent submissions on one PO');
  const race = await Promise.allSettled([1, 2].map((n) => vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po.b), expenseInvoiceNo: `VB-${n}`, ...amounts(600, 0) }, user)));
  const liveB = await VendorVoucher.find({ poId: po.b._id, isDeleted: { $ne: true }, voucherStatus: { $ne: 'CANCELLED' } }).lean();
  check('two concurrent 600 bills on a 1000 PO: never both kept', liveB.length <= 1, `${liveB.length} live; ${race.map((r) => r.status).join()}`);
  check('…losers get the cap message', race.filter((r) => r.status === 'rejected').every((r) => /above the PO value/.test(r.reason.message)));

  console.log('\n[6] one payment path per PO — GRN / invoice refused while a live expense holds the PO');
  const pr = await vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po.r), expenseInvoiceNo: 'VA-R1', ...amounts(100) }, user);
  const grnBlocked = await errMsg(grnService.create({ poId: id(po.r) }, user));
  check('GRN create on PO-EXP-R refused (names the voucher)', /being paid as an expense/.test(grnBlocked) && grnBlocked.includes(pr.voucherNumber), grnBlocked);
  await vs.cancel(id(pr), { remarks: 'goods coming after all' }, user);
  const rGrn = await grnService.create({ poId: id(po.r) }, user).catch((e) => e);
  check('cancelling the draft voucher frees the PO: GRN create works', rGrn?.grnNumber && rGrn.grnStatus === 'DRAFT', rGrn?.message);
  check('…and the PO can no longer be expensed (has a GRN now)',
    /already has GRN/.test(await errMsg(vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po.r), expenseInvoiceNo: 'VA-R2', ...amounts(10) }, user))));

  await vs.create({ ...base, expenseType: 'AGAINST_PO', poId: id(po.s), expenseInvoiceNo: 'VA-S1', ...amounts(100) }, user);
  // A draft GRN that slipped in beside the voucher (the race the create guard can miss).
  const sGrn = await draftGrnOnPo('GRN-EXP-S-RACE', po.s);
  check('GRN complete on a PO held by an expense refused', /this GRN cannot be completed/.test(await errMsg(grnService.complete(id(sGrn), {}, user))));
  const sAfter = await GoodsReceiptNote.findById(sGrn._id).lean();
  check('…the GRN stays an untouched draft (no claim, no stock)', sAfter.grnStatus === 'DRAFT' && sAfter.stockPosted === false);

  // An expense voucher on a PO that already has an invoiceable QC (only reachable by a race / old data).
  const raced = await VendorVoucher.create({
    voucherNumber: 'AGL/EXP-RACE', voucherType: 'EXPENSE', expenseType: 'AGAINST_PO', poId: po.g._id, poNumber: po.g.poNumber,
    vendorId: VENDOR_A, vendorName: 'E2E Vendor A', expenseCategory: 'AMC', expenseInvoiceNo: 'VA-RACE', voucherStatus: 'DRAFT',
  });
  check('vendor invoice create on that PO refused',
    /a vendor invoice cannot be raised on it/.test(await errMsg(vendorInvoiceService.create({ qcIds: [id(poGrnQc)], invoiceNumber: 'INV-G-1' }, user))));
  check('posting that raced voucher is refused too', /Cannot post: PO PO-EXP-G already has GRN /.test(await errMsg(vs.post(id(raced), {}, user))));
  await vs.cancel(id(raced), {}, user);
  const invOk = await vendorInvoiceService.create({ qcIds: [id(poGrnQc)], invoiceNumber: 'INV-G-1' }, user).catch((e) => e);
  check('…once that voucher is cancelled, the invoice goes through', invOk?.invoiceNumber === 'INV-G-1', invOk?.message);

  console.log('\n[7] Expense Against GRN (without PO)');
  const grnList = await options('GRN');
  check('picker lists completed W/O-PO GRNs only (not the draft, not the PO GRN)',
    [grn.w1, grn.w2, grn.ui].every((g) => grnList.includes(g.grnNumber)) && !grnList.includes(grn.draft.grnNumber) && !grnList.includes(grn.po.grnNumber),
    grnList.join());
  const ga = await vs.create({ ...base, expenseCategory: 'Other', expenseType: 'AGAINST_GRN', grnId: id(grn.w1), expenseInvoiceNo: 'SUP-77', ...amounts(1000) }, user);
  check('saves against the GRN with no PO; vendor from the GRN; GRN refs stored',
    ga.expenseType === 'AGAINST_GRN' && String(ga.grnId) === id(grn.w1) && ga.grnNumbers.join() === grn.w1.grnNumber
    && String(ga.grnIds[0]) === id(grn.w1) && !ga.poId && String(ga.vendorId) === String(VENDOR_C) && ga.partyName === NAMES[VENDOR_C]);
  check('a second bill on the same GRN refused',
    /already billed on expense voucher/.test(await errMsg(vs.create({ ...base, expenseType: 'AGAINST_GRN', grnId: id(grn.w1), expenseInvoiceNo: 'SUP-78', ...amounts(10) }, user))));
  check('…and the GRN leaves the picker (but stays for its own voucher on edit)',
    !(await options('GRN')).includes(grn.w1.grnNumber) && (await options('GRN', { excludeVoucherId: id(ga) })).includes(grn.w1.grnNumber));
  check('a GRN raised against a PO is refused (pays via QC → invoice)',
    /raised against PO PO-EXP-G/.test(await errMsg(vs.create({ ...base, expenseType: 'AGAINST_GRN', grnId: id(grn.po), expenseInvoiceNo: 'X', ...amounts(10) }, user))));
  check('a draft GRN is refused', /is DRAFT — complete the GRN/.test(
    await errMsg(vs.create({ ...base, expenseType: 'AGAINST_GRN', grnId: id(grn.draft), expenseInvoiceNo: 'X', ...amounts(10) }, user))));
  check('vendor mismatch refused', /does not match the selected GRN/.test(
    await errMsg(vs.create({ ...base, expenseType: 'AGAINST_GRN', grnId: id(grn.w2), vendorId: String(VENDOR_A), expenseInvoiceNo: 'X', ...amounts(10) }, user))));
  const gRace = await Promise.allSettled([1, 2].map((n) => vs.create({ ...base, expenseType: 'AGAINST_GRN', grnId: id(grn.w2), expenseInvoiceNo: `W2-${n}`, ...amounts(10) }, user)));
  const liveW2 = await VendorVoucher.countDocuments({ grnId: grn.w2._id, isDeleted: { $ne: true }, voucherStatus: { $ne: 'CANCELLED' } });
  check('two concurrent bills on one GRN: never both kept', liveW2 <= 1, `${liveW2} live; ${gRace.map((r) => r.status).join()}`);

  console.log('\n[8] editing');
  const gaEdit = await vs.update(id(ga), { basicValue: 1200, taxableAmount: 1200, remarks: 'rate revised' }, user);
  check('amount edit keeps the GRN link, re-totals (1416)', String(gaEdit.grnId) === id(grn.w1) && gaEdit.netPayableAmount === 1416);
  const toDirect = await vs.update(id(a2), { expenseType: 'DIRECT', partyName: 'Now a direct bill' }, user);
  check('switch Against PO → Direct: PO + PO vendor dropped, party kept',
    toDirect.expenseType === 'DIRECT' && !toDirect.poId && !toDirect.poNumber && !toDirect.vendorId && toDirect.partyName === 'Now a direct bill',
    JSON.stringify({ po: toDirect.poId, v: toDirect.vendorId, p: toDirect.partyName }));
  check('…which frees its share of PO-EXP-A (left 4720)',
    (await vs.getExpenseLinkOptions({ type: 'PO' })).find((o) => o.poNumber === 'PO-EXP-A')?.remainingAmount === 4720);
  const toGrn = await vs.update(id(a2), { expenseType: 'AGAINST_GRN', grnId: id(grn.ui), expenseInvoiceNo: 'VA-101' }, user);
  check('switch Direct → Against GRN: GRN + GRN vendor taken',
    toGrn.expenseType === 'AGAINST_GRN' && String(toGrn.grnId) === id(grn.ui) && String(toGrn.vendorId) === String(VENDOR_C));
  check('switching to a PO with a GRN refused on edit', /already has GRN/.test(
    await errMsg(vs.update(id(a2), { expenseType: 'AGAINST_PO', poId: id(po.g) }, user))));
  const back = await vs.update(id(a2), { expenseType: 'DIRECT', partyName: 'Back to direct' }, user);
  check('…and back to Direct frees the GRN', !back.grnId && !back.grnIds.length && (await options('GRN')).includes(grn.ui.grnNumber));

  console.log('\n[9] purchase vouchers cannot be relinked through an edit');
  const purchase = await VendorVoucher.create({
    voucherNumber: 'AGL/PUR-E2E', voucherType: 'PURCHASE', invoiceNumber: 'INV-P', vendorId: VENDOR_B, vendorName: 'E2E Vendor B',
    poId: po.b._id, poNumber: po.b.poNumber, netPayableAmount: 100, balanceAmount: 100, voucherStatus: 'DRAFT',
  });
  const pEdit = await vs.update(id(purchase), { vendorId: String(VENDOR_A), poId: id(po.a), expenseType: 'AGAINST_PO', remarks: 'ok' }, user);
  check('vendor / PO / expense type ignored, remarks saved',
    String(pEdit.vendorId) === String(VENDOR_B) && String(pEdit.poId) === id(po.b) && !pEdit.expenseType && pEdit.remarks === 'ok');

  console.log('\n[10] downstream unchanged: post → MD → Tally → Final Payment');
  const posted = await vs.post(id(pa), {}, user);
  check('Against PO voucher posts; MD approval raised', posted.voucherStatus === 'POSTED'
    && (await VendorVoucher.findById(pa._id).lean()).approvalStatus === 'READY_FOR_MD_APPROVAL');
  check('a posted voucher cannot be cancelled (PO stays on the expense path)', /cannot be cancelled/.test(await errMsg(vs.cancel(id(pa), {}, user))));
  const tally = await tallyEntryService.create({ voucherId: id(pa) }, user);
  await tallyEntryService.complete(String(tally._id), { statusDone: 'YES', checklist: Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, true])) }, user);
  const pay = { voucherId: id(pa), paymentStatus: 'FULL_PAYMENT', paidAmount: 5900, paymentMode: 'NEFT', paymentReferenceNumber: 'UTR-EXP' };
  check('final payment still waits for the MD', /MD/i.test(await errMsg(finalPaymentService.create(pay, user))));
  await VendorVoucher.updateOne({ _id: pa._id }, { $set: { approvalStatus: 'MD_APPROVED' } }); // MD signature stand-in
  check('MD-signed voucher is locked for edits', /locked/.test(await errMsg(vs.update(id(pa), { remarks: 'x' }, user))));
  const payment = await finalPaymentService.create(pay, user);
  const paAfter = await VendorVoucher.findById(pa._id).lean();
  check('final payment carries the PO; voucher FULLY_PAID',
    String(payment.poId) === id(po.a) && payment.poNumber === 'PO-EXP-A' && paAfter.voucherStatus === 'FULLY_PAID' && paAfter.balanceAmount === 0);
  // Even once the material is followed up to READY_FOR_GRN, the PO stays on the expense path.
  await VendorPurchaseOrder.updateOne({ _id: po.a._id }, { $set: READY_FOR_GRN });
  check('PO-EXP-A still refuses a GRN after payment', /being paid as an expense/.test(await errMsg(grnService.create({ poId: id(po.a) }, user))));
  const gPosted = await vs.post(id(ga), {}, user);
  check('Against GRN voucher posts', gPosted.voucherStatus === 'POSTED');
  const pdf = await vs.generatePdf(id(ga)).catch((e) => e);
  check('expense PDF renders for a GRN-linked voucher', Boolean(pdf?.voucherPdfUrl), pdf?.message);

  console.log(`\n${failures ? `FAILED — ${failures} check(s)` : 'ALL CHECKS PASSED'}\n`);
};

if (isEntry(import.meta.url)) {
  const mode = process.argv[2];
  if (!['--api', '--seed-ui'].includes(mode)) {
    console.error('usage: node src/scripts/e2eExpenseTypeFixture.js --api | --seed-ui');
    process.exit(2);
  }
  run({ seedOnly: mode === '--seed-ui' })
    .catch((err) => { console.error(err); failures += 1; })
    .finally(async () => { await mongoose.disconnect(); process.exit(failures ? 1 : 0); });
}
