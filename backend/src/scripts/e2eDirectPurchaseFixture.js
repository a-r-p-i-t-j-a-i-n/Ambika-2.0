/**
 * Service-level oracle for the Direct Purchase Voucher (voucherType
 * DIRECT_PURCHASE — goods bought with no Indent / PO / GRN). No browser.
 *
 *   node src/scripts/e2eDirectPurchaseFixture.js --api       seed + every check below
 *   node src/scripts/e2eDirectPurchaseFixture.js --seed-ui   seed only, for frontend/e2e/directPurchase.e2e.mjs
 *                                                            (backend: e2eServer.js on this DB;
 *                                                             login direct-purchase-e2e@test.local / E2e@12345)
 *
 * Checks: one / many items; SKU binding (name / code / unit from the master,
 * purchase unit, unknown / inactive / deleted / finished-good / scrap refused);
 * vendor (inactive / deleted / Party id refused); quantity / rate / discount /
 * GST / total validation; duplicate invoice number across direct purchase,
 * expense bill and vendor invoice (both directions) and a concurrent double
 * save; draft save / reopen / edit (header-only and items); edits cannot reach
 * PO / expense fields, and purchase / expense vouchers cannot take direct
 * purchase fields; post (re-checks vendor + number) → MD approval (real
 * signature) → locked → Tally Entry → MD gate → part + full Final Payment and
 * payment history; PDF; list filter / search / stats; MD approval list label;
 * duplicate bill numbers across every document kind and both supplier masters
 * (same valid GSTIN = same supplier; name / placeholder / mistyped GSTIN never match);
 * and NO stock movement anywhere through the whole lifecycle.
 *
 * SAFETY: pinned to a localhost scratch database (dropped on every run) behind
 * the shared e2e guard (S3 + email must be off). Never reads MONGO_URI.
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import Party from '../modules/clients/party.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import VendorInvoice from '../modules/procurement/vendor-invoice/vendorInvoice.model.js';
import GoodsReceiptNote from '../modules/procurement/grn/grn.model.js';
import VendorVoucher from '../modules/procurement/voucher/voucher.model.js';
import { CHECKLIST_KEYS } from '../modules/procurement/tally-entry/tallyEntry.model.js';
import { createVoucherSchema, updateVoucherSchema } from '../modules/procurement/voucher/voucher.validation.js';

export const E2E_DB = 'ambika_e2e_direct_purchase';
export const E2E_URI = `mongodb://127.0.0.1:27017/${E2E_DB}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eDirectPurchaseFixture.js');

export const E2E_LOGIN = { email: 'direct-purchase-e2e@test.local', password: 'E2e@12345' };
// 1×1 transparent PNG — a stand-in signature image for the real MD sign().
const SIGNATURE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        → ${detail}` : ''}`);
};
const errMsg = async (p) => { try { await p; return ''; } catch (e) { return e.message || String(e); } };
const id = (d) => String(d._id);
const VALIDATE = { abortEarly: false, stripUnknown: true };

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== E2E_DB) throw new Error('Connected to an unexpected database — aborting.');
};

/** Exactly what the route does: Joi (422 on error), then the service. */
const routeCreate = async (vs, body, user) => {
  const { error, value } = createVoucherSchema.validate(body, VALIDATE);
  if (error) throw new Error(`422 ${error.details.map((d) => d.message).join('; ')}`);
  return vs.create(value, user);
};
const routeUpdate = async (vs, vid, body, user) => {
  const { error, value } = updateVoucherSchema.validate(body, VALIDATE);
  if (error) throw new Error(`422 ${error.details.map((d) => d.message).join('; ')}`);
  return vs.update(vid, value, user);
};

/** Every stock-ish collection's document count + the SKU docs — must not move. */
const stockSnapshot = async () => {
  const names = (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name)
    .filter((n) => /stock|inventor|movement|ledger|batch|coil|ims|grn|goodsreceipt|incomingqc|scrap/i.test(n));
  const counts = {};
  // Empty collections are skipped: models create theirs lazily (an empty
  // `inventorystocks` appearing mid-run is not a stock movement).
  for (const n of names.sort()) {
    const c = await mongoose.connection.db.collection(n).countDocuments();
    if (c) counts[n] = c;
  }
  const skus = await SKU.find({}).select('-updatedAt -__v').sort('code').lean();
  return JSON.stringify({ counts, skus });
};

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  const user = (await User.create({
    email: E2E_LOGIN.email, password: E2E_LOGIN.password, name: 'E2E Direct Purchase MD', role: 'MD',
    mobile: '9000000077', isActive: true, roles: ['MD'],
  })).toObject();
  const sku = {
    bolt:   await SKU.create({ code: 'E2E-DP-BOLT', name: 'E2E DP Bolt', unit: 'PCS', itemType: 'CONSUMABLE', gstRate: 18 }),
    paint:  await SKU.create({ code: 'E2E-DP-PAINT', name: 'E2E DP Paint', unit: 'Ltr', itemType: 'CHEMICAL', gstRate: 12 }),
    gloves: await SKU.create({ code: 'E2E-DP-GLOVES', name: 'E2E DP Gloves', unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: 25, itemType: 'CONSUMABLE', gstRate: 5 }),
    off:    await SKU.create({ code: 'E2E-DP-OFF', name: 'E2E DP Inactive', unit: 'PCS', itemType: 'CONSUMABLE', isActive: false }),
    gone:   await SKU.create({ code: 'E2E-DP-GONE', name: 'E2E DP Deleted', unit: 'PCS', itemType: 'CONSUMABLE', isDeleted: true }),
    fg:     await SKU.create({ code: 'E2E-DP-FG', name: 'E2E DP Finished Good', unit: 'PCS', itemType: 'FINISHED_GOOD' }),
    scrap:  await SKU.create({ code: 'E2E-DP-SCRAP', name: 'E2E DP Scrap', unit: 'KGS', itemType: 'SCRAP' }),
  };
  const vendor = {
    a: await Vendor.create({
      code: 'E2E-DPV-A', name: 'E2E DP Vendor A', creditPeriodDays: 30, isActive: true,
      products: [{ skuId: sku.bolt._id, productName: sku.bolt.name, skuCode: sku.bolt.code, unit: 'PCS', rate: 12.5, gstRate: 18, hsn: '7318' }],
    }),
    b: await Vendor.create({ code: 'E2E-DPV-B', name: 'E2E DP Vendor B', isActive: true }),
    ui: await Vendor.create({ code: 'E2E-DPV-UI', name: 'E2E DP Vendor UI', creditPeriodDays: 15, isActive: true,
      products: [{ skuId: sku.bolt._id, productName: sku.bolt.name, skuCode: sku.bolt.code, unit: 'PCS', rate: 10, gstRate: 18, hsn: '7318' }] }),
    off: await Vendor.create({ code: 'E2E-DPV-OFF', name: 'E2E DP Vendor Inactive', isActive: false }),
    gone: await Vendor.create({ code: 'E2E-DPV-GONE', name: 'E2E DP Vendor Deleted', isDeleted: true }),
  };
  const party = await Party.create({ name: 'E2E DP Party (not a vendor)' });
  // Supplier-identity fixtures. The same supplier in BOTH masters, told apart only
  // by a valid GSTIN (public example number — its check digit is correct):
  const GSTIN = '27AAPFU0939F1ZV';
  const GSTIN_TYPO = '27AAPFU0939F1ZX'; // wrong check digit
  const same = {
    vendor: await Vendor.create({ code: 'E2E-DPV-G', name: 'E2E Same Supplier (Vendor)', gstNo: GSTIN, isActive: true }),
    party: await Party.create({ name: 'E2E Same Supplier Ltd (Party)', gstNo: GSTIN.toLowerCase() }), // stored lower-case: still matches
  };
  const noGst = { // same NAME in both masters, no GSTIN
    vendor: await Vendor.create({ code: 'E2E-DPV-N', name: 'E2E Namesake Traders', isActive: true }),
    party: await Party.create({ name: 'E2E Namesake Traders' }),
  };
  const junk = { // identical placeholder / mistyped GSTIN in both masters
    vendor: await Vendor.create({ code: 'E2E-DPV-J', name: 'E2E Junk GST Vendor', gstNo: 'NA', isActive: true }),
    party: await Party.create({ name: 'E2E Junk GST Party', gstNo: 'NA' }),
    typoVendor: await Vendor.create({ code: 'E2E-DPV-T', name: 'E2E Typo GST Vendor', gstNo: GSTIN_TYPO, isActive: true }),
    typoParty: await Party.create({ name: 'E2E Typo GST Party', gstNo: GSTIN_TYPO }),
  };
  // A vendor invoice of vendor A (number VI-100) and an approved PO of vendor A
  // with no GRN (for an Expense Against PO bill).
  const po = await VendorPurchaseOrder.create({
    poNumber: 'PO-DP-A', vendorId: vendor.a._id, vendorName: vendor.a.name, indentId: new mongoose.Types.ObjectId(),
    approvalStatus: 'APPROVED', poStatus: 'RELEASED_TO_VENDOR',
    items: [{ skuId: sku.bolt._id, skuCode: sku.bolt.code, itemName: sku.bolt.name, unit: 'PCS', quantity: 100, receivedQty: 0, pendingQty: 100, rate: 10, gstRate: 18 }],
    grandTotal: 1180,
  });
  // The vendor invoices sit on their own PO (a PO with an invoice can't take an expense bill).
  const invPo = await VendorPurchaseOrder.create({ poNumber: 'PO-DP-INV', vendorId: vendor.a._id, vendorName: vendor.a.name, indentId: new mongoose.Types.ObjectId(), approvalStatus: 'APPROVED', poStatus: 'RELEASED_TO_VENDOR', items: [{ skuId: sku.bolt._id, skuCode: sku.bolt.code, itemName: sku.bolt.name, unit: 'PCS', quantity: 10, receivedQty: 0, pendingQty: 10, rate: 10, gstRate: 18 }], grandTotal: 118 });
  await VendorInvoice.init(); // build the live-number unique index on the scratch DB
  const invoice = await VendorInvoice.create({
    invoiceNumber: 'VI-100', vendorId: vendor.a._id, vendorName: vendor.a.name, poId: invPo._id, poNumber: invPo.poNumber,
    invoiceStatus: 'PAYMENT_PENDING', invoiceDate: new Date('2026-11-01'), invoiceAmount: 100, netPayableAmount: 100, qcId: new mongoose.Types.ObjectId(),
  });
  // Rejected invoices never block a number.
  await VendorInvoice.create({
    invoiceNumber: 'VI-REJ', vendorId: vendor.a._id, vendorName: vendor.a.name, poId: invPo._id, poNumber: invPo.poNumber,
    invoiceStatus: 'REJECTED', invoiceDate: new Date('2026-11-01'), invoiceAmount: 1, netPayableAmount: 1, qcId: new mongoose.Types.ObjectId(),
  });
  return { user, sku, vendor, party, po, invoice, same, noGst, junk };
};

const line = (s, extra = {}) => ({ skuId: id(s), quantity: 1, rate: 100, gstRate: 18, ...extra });
const dp = (vendor, invoiceNumber, items, extra = {}) => ({
  voucherType: 'DIRECT_PURCHASE', vendorId: id(vendor), invoiceNumber, invoiceDate: '2026-11-10', items, ...extra,
});

const run = async ({ seedOnly = false } = {}) => {
  const s = await seed();
  const { user, sku, vendor, party, po, invoice, same, noGst, junk } = s;
  check('seed: vendors, SKUs, a PO and a vendor invoice', Boolean(invoice?._id && po?._id));
  if (seedOnly) {
    console.log(`\nSeeded ${E2E_DB}. Login ${E2E_LOGIN.email} / ${E2E_LOGIN.password}`);
    return;
  }
  const { voucherService: vs } = await import('../modules/procurement/voucher/voucher.service.js');
  const { tallyEntryService } = await import('../modules/procurement/tally-entry/tallyEntry.service.js');
  const { finalPaymentService } = await import('../modules/procurement/final-payment/finalPayment.service.js');
  const { approvalService } = await import('../modules/approvals/approval.service.js');
  const { vendorInvoiceService } = await import('../modules/procurement/vendor-invoice/vendorInvoice.service.js');
  const { verifyInvoiceNumberIndex } = await import('../modules/procurement/vendor-invoice/invoiceNumberIndexGuard.js');
  await verifyInvoiceNumberIndex();
  const stockBefore = await stockSnapshot();

  console.log('\n[1] one item, no Indent / PO / GRN');
  const one = await routeCreate(vs, dp(vendor.a, 'DP-001', [{
    ...line(sku.bolt, { quantity: 10, rate: 12.5 }), description: 'M10 bolts, loose', itemName: 'CLIENT NAME', skuCode: 'HACK', unit: 'KG',
  }], { remarks: 'urgent counter purchase', paymentTerms: '30 days', dueDate: '2026-12-10', poId: id(po), grnId: id(po), invoiceId: id(invoice), indentId: id(po), expenseCategory: 'AMC' }), user);
  check('saved as a DRAFT Direct Purchase voucher numbered AGL/DPV-…',
    one.voucherType === 'DIRECT_PURCHASE' && one.voucherStatus === 'DRAFT' && /^AGL\/DPV-001\//.test(one.voucherNumber), one.voucherNumber);
  check('no PO / GRN / invoice / indent / expense reference stored (sent ones stripped)',
    !one.poId && !one.poNumber && !one.grnId && !(one.grnIds || []).length && !(one.grnNumbers || []).length
    && !one.invoiceId && !one.expenseCategory && !one.expenseType && one.indentId === undefined);
  const l1 = one.items[0];
  check('item name / SKU code / unit come from the SKU Master, not the client',
    l1.itemName === 'E2E DP Bolt' && l1.skuCode === 'E2E-DP-BOLT' && l1.unit === 'PCS' && l1.description === 'M10 bolts, loose');
  check('HSN defaults from the vendor\'s own product record', l1.hsn === '7318', l1.hsn);
  check('line: 10 × 12.5 = 125, GST 18% = 22.5, total 147.5',
    l1.grossAmount === 125 && l1.taxableAmount === 125 && l1.taxAmount === 22.5 && l1.lineTotal === 147.5);
  check('vendor name from the Vendor Master; payable = balance = invoice amount = 147.5',
    one.vendorName === 'E2E DP Vendor A' && one.netPayableAmount === 147.5 && one.balanceAmount === 147.5
    && one.invoiceAmount === 147.5 && one.totalAmountPayable === 147.5 && one.paidAmount === 0);
  check('invoice date, payment terms, due date and remarks saved',
    new Date(one.invoiceDate).toISOString().startsWith('2026-11-10') && one.paymentTerms === '30 days'
    && new Date(one.dueDate).toISOString().startsWith('2026-12-10') && one.remarks === 'urgent counter purchase');
  const reopened = await vs.getById(id(one));
  check('draft reopens with its items', reopened.items.length === 1 && reopened.items[0].skuCode === 'E2E-DP-BOLT');

  console.log('\n[2] several items, discount, mixed GST, purchase unit');
  const many = await routeCreate(vs, dp(vendor.b, 'DP-MULTI', [
    line(sku.bolt, { quantity: 3, rate: 33.33, discountAmount: 10, gstRate: 18 }),
    line(sku.paint, { quantity: 1.5, rate: 200, gstRate: 12 }),
    line(sku.gloves, { quantity: 4, rate: 250, gstRate: 5, discountAmount: 50 }),
  ]), user);
  check('3 lines saved in order', many.items.map((i) => i.skuCode).join() === 'E2E-DP-BOLT,E2E-DP-PAINT,E2E-DP-GLOVES');
  check('gloves line is in the SKU purchase unit (BOX)', many.items[2].unit === 'BOX', many.items[2].unit);
  check('line math: 99.99−10=89.99 → tax 16.2; 300 → tax 36; 1000−50=950 → tax 47.5',
    many.items[0].taxAmount === 16.2 && many.items[0].lineTotal === 106.19
    && many.items[1].taxAmount === 36 && many.items[2].taxableAmount === 950 && many.items[2].taxAmount === 47.5);
  check('totals: gross 1399.99, discount 60, taxable 1339.99, tax 99.7, grand 1439.69',
    many.grossAmount === 1399.99 && many.discountTotal === 60 && many.taxableAmount === 1339.99
    && many.taxAmount === 99.7 && many.netPayableAmount === 1439.69,
    JSON.stringify([many.grossAmount, many.discountTotal, many.taxableAmount, many.taxAmount, many.netPayableAmount]));

  console.log('\n[3] SKU validation');
  const skuErr = (s) => errMsg(routeCreate(vs, dp(vendor.b, `SKU-${s.code}`, [line(s)]), user));
  check('inactive SKU refused', /not an active item in SKU Master/.test(await skuErr(sku.off)));
  check('deleted SKU refused', /not an active item in SKU Master/.test(await skuErr(sku.gone)));
  check('finished good refused', /Finished Goods cannot be processed/.test(await skuErr(sku.fg)));
  check('scrap refused', /Scrap cannot be purchased/.test(await skuErr(sku.scrap)));
  check('unknown SKU id refused', /not an active item in SKU Master/.test(
    await errMsg(routeCreate(vs, dp(vendor.b, 'SKU-X', [{ skuId: String(new mongoose.Types.ObjectId()), quantity: 1, rate: 1, gstRate: 0 }]), user))));
  check('typed SKU code without id refused (422)', /422.*SKU Master/.test(
    await errMsg(routeCreate(vs, dp(vendor.b, 'SKU-Y', [{ skuCode: 'E2E-DP-BOLT', quantity: 1, rate: 1, gstRate: 0 }]), user))));
  check('no items refused', /at least one purchase item/.test(await errMsg(routeCreate(vs, dp(vendor.b, 'SKU-Z', []), user))));

  console.log('\n[4] vendor validation');
  const vErr = (vid, no) => errMsg(routeCreate(vs, { ...dp(vendor.b, no, [line(sku.bolt)]), vendorId: vid }, user));
  check('inactive vendor refused', /inactive in the Vendor Master/.test(await vErr(id(vendor.off), 'V-1')));
  check('deleted vendor refused', /not found in the Vendor Master/.test(await vErr(id(vendor.gone), 'V-2')));
  check('a Party (customer master) id is not a vendor', /not found in the Vendor Master/.test(await vErr(id(party), 'V-3')));
  check('missing vendor refused (422)', /422.*vendor/i.test(await errMsg(routeCreate(vs, { ...dp(vendor.b, 'V-4', [line(sku.bolt)]), vendorId: undefined }, user))));

  console.log('\n[5] quantity / rate / discount / GST / totals');
  const amtErr = (patch, no) => errMsg(routeCreate(vs, dp(vendor.b, no, [line(sku.bolt, patch)]), user));
  check('quantity 0 refused', /quantity/.test(await amtErr({ quantity: 0 }, 'A-1')));
  check('quantity with 4 decimals refused', /at most 3 decimals/.test(await amtErr({ quantity: 1.2345 }, 'A-2')));
  check('negative rate refused', /rate/.test(await amtErr({ rate: -5 }, 'A-3')));
  check('GST above 100 refused', /gstRate|GST/.test(await amtErr({ gstRate: 120 }, 'A-4')));
  check('discount above the line amount refused', /discount .* more than the line amount/.test(await amtErr({ discountAmount: 101 }, 'A-5')));
  check('a zero total refused', /total must be greater than zero/.test(await amtErr({ rate: 0 }, 'A-6')));
  check('invoice number and date required (422)',
    /Invoice Number/.test(await errMsg(routeCreate(vs, dp(vendor.b, '', [line(sku.bolt)]), user)))
    && /Invoice Date/.test(await errMsg(routeCreate(vs, { ...dp(vendor.b, 'A-7', [line(sku.bolt)]), invoiceDate: undefined }, user))));

  console.log('\n[6] duplicate invoice numbers');
  check('same vendor + same number (other case / spaces) refused',
    /already recorded for this vendor on direct purchase voucher/.test(await errMsg(routeCreate(vs, dp(vendor.a, '  dp-001 ', [line(sku.bolt)]), user))));
  const otherVendor = await routeCreate(vs, dp(vendor.b, 'DP-001', [line(sku.bolt)]), user);
  check('the same number for another vendor is fine', otherVendor.voucherStatus === 'DRAFT');
  check('a number already on a vendor invoice of that vendor refused',
    /already recorded for this vendor as a Vendor Invoice/.test(await errMsg(routeCreate(vs, dp(vendor.a, 'vi-100', [line(sku.bolt)]), user))));
  const afterRejected = await routeCreate(vs, dp(vendor.a, 'VI-REJ', [line(sku.bolt)]), user);
  check('a rejected vendor invoice does not block its number', afterRejected.voucherStatus === 'DRAFT');
  const exp = await vs.create({ voucherType: 'EXPENSE', expenseType: 'AGAINST_PO', poId: id(po), expenseCategory: 'Other', expenseInvoiceNo: 'EXP-55', taxableAmount: 100, gstRatePercent: 18, basicValue: 100 }, user);
  check('a number already on an expense bill of that vendor refused',
    /already recorded for this vendor on expense voucher/.test(await errMsg(routeCreate(vs, dp(vendor.a, 'exp-55', [line(sku.bolt)]), user))), exp.voucherNumber);
  await vs.cancel(id(exp), {}, user);
  check('expense bill now refuses a direct purchase voucher\'s number (other direction)',
    /already exists for this vendor/.test(await errMsg(vs.create({ voucherType: 'EXPENSE', expenseType: 'AGAINST_PO', poId: id(po), expenseCategory: 'Other', expenseInvoiceNo: 'dp-001', basicValue: 10 }, user))));
  check('vendor invoice rename to a direct purchase voucher\'s number refused',
    /direct purchase voucher/.test(await errMsg(vendorInvoiceService.update(id(invoice), { invoiceNumber: 'DP-001' }, user))));
  const race = await Promise.allSettled([1, 2].map(() => routeCreate(vs, dp(vendor.b, 'RACE-1', [line(sku.bolt)]), user)));
  const raceLive = await VendorVoucher.countDocuments({ vendorId: vendor.b._id, invoiceNumber: 'RACE-1', isDeleted: { $ne: true } });
  check('two concurrent saves of one bill: never both kept', raceLive <= 1 && race.some((r) => r.status === 'rejected'),
    `${raceLive} kept; ${race.map((r) => r.status).join(',')}`);
  const toCancel = await routeCreate(vs, dp(vendor.b, 'FREE-1', [line(sku.bolt)]), user);
  await vs.cancel(id(toCancel), {}, user);
  const reuse = await routeCreate(vs, dp(vendor.b, 'FREE-1', [line(sku.bolt)]), user);
  check('a cancelled voucher frees its number', reuse.voucherStatus === 'DRAFT');
  await vs.remove(id(reuse), user, {});
  const reuse2 = await routeCreate(vs, dp(vendor.b, 'FREE-1', [line(sku.bolt)]), user);
  check('a deleted draft frees its number', reuse2.voucherStatus === 'DRAFT');

  console.log('\n[7] draft edits');
  const hdr = await routeUpdate(vs, id(one), { voucherType: 'DIRECT_PURCHASE', remarks: 'edited remarks', paymentTerms: '45 days' }, user);
  check('header-only edit keeps the saved items and totals',
    hdr.remarks === 'edited remarks' && hdr.paymentTerms === '45 days' && hdr.items.length === 1 && hdr.netPayableAmount === 147.5);
  const itemsEdit = await routeUpdate(vs, id(one), { voucherType: 'DIRECT_PURCHASE', items: [
    { _id: id(hdr.items[0]), skuId: id(sku.bolt), quantity: 20, rate: 12.5, gstRate: 18, description: 'now 20' },
    line(sku.paint, { quantity: 2, rate: 50, gstRate: 12 }),
  ] }, user);
  check('items edit: re-bound and recomputed (250+45 + 100+12 = 407)',
    itemsEdit.items.length === 2 && itemsEdit.items[1].itemName === 'E2E DP Paint' && itemsEdit.netPayableAmount === 407
    && itemsEdit.balanceAmount === 407 && String(itemsEdit.items[0]._id) === id(hdr.items[0]), String(itemsEdit.netPayableAmount));
  check('edit to another live number of the vendor refused',
    /already recorded/.test(await errMsg(routeUpdate(vs, id(one), { voucherType: 'DIRECT_PURCHASE', invoiceNumber: 'VI-100' }, user))));
  const offMsg = await errMsg(routeUpdate(vs, id(one), { voucherType: 'DIRECT_PURCHASE', vendorId: id(vendor.off) }, user));
  check('edit to an inactive vendor refused', /inactive/.test(offMsg), offMsg || 'not refused');
  check('edit with an FG item refused', /Finished Goods/.test(await errMsg(routeUpdate(vs, id(one), { voucherType: 'DIRECT_PURCHASE', items: [line(sku.fg)] }, user))));
  const sneaky = await routeUpdate(vs, id(one), { voucherType: 'DIRECT_PURCHASE', poId: id(po), expenseType: 'AGAINST_PO', expenseCategory: 'AMC', basicValue: 999, remarks: 'ok' }, user);
  check('edit cannot attach a PO / expense fields', !sneaky.poId && !sneaky.expenseType && !sneaky.expenseCategory && !sneaky.basicValue && sneaky.netPayableAmount === 407);
  const expDraft = await vs.create({ voucherType: 'EXPENSE', expenseCategory: 'AMC', partyName: 'Walk-in', basicValue: 50 }, user);
  const expEdit = await routeUpdate(vs, id(expDraft), { items: [line(sku.bolt)], invoiceNumber: 'HACK', remarks: 'x' }, user);
  check('an expense voucher edit never takes direct purchase fields', !expEdit.items && !expEdit.invoiceNumber && expEdit.netPayableAmount === 50);
  check('an expense voucher cannot be turned into a direct purchase',
    /not a Direct Purchase voucher/.test(await errMsg(routeUpdate(vs, id(expDraft), { voucherType: 'DIRECT_PURCHASE', vendorId: id(vendor.b), invoiceNumber: 'T-1', items: [line(sku.bolt)] }, user))));
  const oldStyle = await routeUpdate(vs, id(one), { remarks: 'old-style client edit' }, user);
  check('a direct purchase edit without voucherType (old client shape) still edits its header only',
    oldStyle.remarks === 'old-style client edit' && oldStyle.items.length === 2 && oldStyle.netPayableAmount === 407);

  console.log('\n[8] post → MD approval');
  await Vendor.updateOne({ _id: vendor.a._id }, { $set: { isActive: false } });
  check('post refused while the vendor is inactive', /Cannot post: .*inactive/.test(await errMsg(vs.post(id(one), {}, user))));
  await Vendor.updateOne({ _id: vendor.a._id }, { $set: { isActive: true } });
  const posted = await vs.post(id(one), {}, user);
  const postedDoc = await VendorVoucher.findById(one._id).lean();
  check('posts; READY_FOR_MD_APPROVAL; no payment recorded',
    posted.voucherStatus === 'POSTED' && postedDoc.approvalStatus === 'READY_FOR_MD_APPROVAL' && postedDoc.paidAmount === 0 && postedDoc.balanceAmount === 407);
  check('a posted voucher cannot be edited or cancelled',
    /Only draft/.test(await errMsg(routeUpdate(vs, id(one), { voucherType: 'DIRECT_PURCHASE', remarks: 'x' }, user)))
    && /cannot be cancelled/.test(await errMsg(vs.cancel(id(one), {}, user))));
  const mdList = await approvalService.list({ documentType: 'VOUCHER' });
  const mdRow = mdList.docs.find((r) => String(r.documentId) === id(one));
  check('MD Approval screen lists it as "Direct Purchase Voucher" with vendor + amount',
    mdRow?.documentLabel === 'Direct Purchase Voucher' && mdRow.vendorName === 'E2E DP Vendor A' && mdRow.amount === 407, JSON.stringify(mdRow));

  console.log('\n[9] Tally Entry → MD gate → Final Payment');
  const tally = await tallyEntryService.create({ voucherId: id(one) }, user);
  check('Tally Entry raised without MD approval; carries vendor + invoice no, no PO / GRN',
    tally.tallyLedgerName === 'E2E DP Vendor A' && tally.invoiceNumber === 'DP-001' && !tally.poId && !tally.grnId && !(tally.grnNumbers || []).length);
  await tallyEntryService.complete(String(tally._id), { statusDone: 'YES', checklist: Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, true])) }, user);
  const pay = (paidAmount, paymentStatus, ref) => finalPaymentService.create({ voucherId: id(one), paymentStatus, paidAmount, paymentMode: 'NEFT', paymentReferenceNumber: ref }, user);
  check('final payment waits for the MD', /MD/i.test(await errMsg(pay(100, 'PART_PAYMENT', 'UTR-0'))));
  await approvalService.sign({ documentType: 'VOUCHER', documentId: id(one), signatureImageBase64: SIGNATURE_PNG, signatureType: 'DRAWN' }, user);
  const signed = await VendorVoucher.findById(one._id).lean();
  check('MD signature (real engine) → MD_APPROVED + signed PDF', signed.approvalStatus === 'MD_APPROVED' && /signed\.pdf$/.test(signed.voucherPdfFileName || ''), signed.voucherPdfFileName);
  check('MD-signed voucher locked', /locked/.test(await errMsg(routeUpdate(vs, id(one), { voucherType: 'DIRECT_PURCHASE', remarks: 'x' }, user))));
  const p1 = await pay(150, 'PART_PAYMENT', 'UTR-1');
  check('overpayment refused', /exceeds the voucher balance/.test(await errMsg(pay(500, 'FULL_PAYMENT', 'UTR-X'))));
  const p2 = await pay(257, 'FULL_PAYMENT', 'UTR-2');
  const paid = await VendorVoucher.findById(one._id).lean();
  check('part + full payment: FULLY_PAID, balance 0',
    paid.voucherStatus === 'FULLY_PAID' && paid.paidAmount === 407 && paid.balanceAmount === 0 && paid.finalPaymentStatus === 'FULL_PAYMENT');
  const history = await finalPaymentService.getByVoucher(id(one));
  check('payment history: 2 payments, invoice no carried, no PO',
    history.length === 2 && history.every((h) => h.invoiceNumber === 'DP-001' && !h.poId && !h.invoiceId) && p1.paymentNumber !== p2.paymentNumber);
  check('no invoice was touched by the payment', (await VendorInvoice.findById(invoice._id).lean()).invoiceStatus === 'PAYMENT_PENDING');

  console.log('\n[10] PDF, list, filters, stats');
  const pdf = await vs.generatePdf(id(many));
  const pdfFile = pdf.voucherPdfUrl ? path.resolve(process.cwd(), 'uploads', 'vouchers', path.basename(pdf.voucherPdfUrl)) : '';
  const pdfOk = pdfFile && fs.existsSync(pdfFile) && fs.readFileSync(pdfFile).subarray(0, 4).toString() === '%PDF';
  check('draft PDF renders (Direct Purchase layout)', pdfOk, pdf.voucherPdfUrl);
  if (pdfFile && fs.existsSync(pdfFile)) fs.unlinkSync(pdfFile);
  const signedPdf = await vs.generatePdf(id(one));
  check('signed voucher keeps its signed PDF', signedPdf.voucherPdfUrl === signed.voucherPdfUrl);
  const { docs: dpRows } = await vs.getAll({ voucherType: 'DIRECT_PURCHASE', limit: 100 });
  check('list filter by type = Direct Purchase', dpRows.length >= 6 && dpRows.every((r) => r.voucherType === 'DIRECT_PURCHASE'), String(dpRows.length));
  const { docs: found } = await vs.getAll({ search: 'DP-MULTI' });
  check('search by vendor invoice number', found.length === 1 && id(found[0]) === id(many));
  const { docs: byVendor } = await vs.getAll({ vendorId: id(vendor.a), voucherType: 'DIRECT_PURCHASE' });
  check('filter by vendor', byVendor.length >= 1 && byVendor.every((r) => String(r.vendorId) === id(vendor.a)));
  const stats = await vs.getStats();
  check('stats count it (fully paid)', stats.fullyPaid >= 1 && stats.total >= 6);

  console.log('\n[11] no stock posted by any step');
  const stockAfter = await stockSnapshot();
  check('stock / GRN / QC / inventory collections and SKU records unchanged', stockBefore === stockAfter,
    `before ${JSON.parse(stockBefore).counts && JSON.stringify(JSON.parse(stockBefore).counts)} after ${JSON.stringify(JSON.parse(stockAfter).counts)}`);


  console.log('\n[12] duplicate bill numbers across every document kind (supplier identity)');
  const { validGstin } = await import('../modules/procurement/voucher/supplierIdentity.js');
  check('GSTIN validity: format + check digit', validGstin('27aaPFU0939F1ZV') === '27AAPFU0939F1ZV'
    && !validGstin('27AAPFU0939F1ZX') && !validGstin('NA') && !validGstin('') && !validGstin('27AAPFU0939F1Z'));
  const expBill = (partyDoc, no) => vs.create({
    voucherType: 'EXPENSE', expenseCategory: 'Other', vendorId: id(partyDoc), partyName: partyDoc.name, expenseInvoiceNo: no, basicValue: 100,
  }, user);
  const dpFor = (v, no) => routeCreate(vs, dp(v, no, [line(sku.bolt)]), user);
  const OLD = /already exists for this vendor/;
  const VEXP = /on expense voucher/;
  const VDP = /on direct purchase voucher/;
  const VINV = /as a Vendor Invoice/;

  // A. Direct Expense bill (Party id) <-> Direct Purchase (Vendor id) of the SAME supplier (same valid GSTIN).
  await expBill(same.party, 'GX-1');
  check('A1: expense bill (Party) then a Direct Purchase (Vendor), same number -> refused', VEXP.test(await errMsg(dpFor(same.vendor, 'gx-1'))));
  await dpFor(same.vendor, 'GX-2');
  check('A2: Direct Purchase (Vendor) then an expense bill (Party), same number -> refused', OLD.test(await errMsg(expBill(same.party, ' GX-2 '))));
  check('A3: other numbers stay free for both', Boolean(await dpFor(same.vendor, 'GX-9')) && Boolean(await expBill(same.party, 'GX-8')));

  // B. Vendor Invoice <-> expense / Direct Purchase, across the two masters.
  const mkInv = (vendorDoc, no) => VendorInvoice.create({
    invoiceNumber: no, vendorId: vendorDoc._id, vendorName: vendorDoc.name, poId: invoice.poId, poNumber: 'PO-DP-INV',
    invoiceStatus: 'PAYMENT_PENDING', invoiceDate: new Date('2026-11-01'), invoiceAmount: 10, netPayableAmount: 10, qcId: new mongoose.Types.ObjectId(),
  });
  const invGx3 = await mkInv(same.vendor, 'GX-3');
  await mkInv(same.party, 'GX-4'); // a legacy invoice recorded under the Party id
  check('B1: Vendor Invoice (Vendor id) blocks an expense bill of the same supplier (Party id)', VINV.test(await errMsg(expBill(same.party, 'gx-3'))));
  check('B2: legacy Vendor Invoice (Party id) blocks a Direct Purchase (Vendor id)', VINV.test(await errMsg(dpFor(same.vendor, 'GX-4'))));
  check('B3: a Vendor Invoice cannot be renamed to the number of an expense bill of the same supplier',
    VEXP.test(await errMsg(vendorInvoiceService.update(id(invGx3), { invoiceNumber: 'GX-1' }, user))));
  check('B4: ...nor to the number of a Direct Purchase of the same supplier',
    VDP.test(await errMsg(vendorInvoiceService.update(id(invGx3), { invoiceNumber: 'GX-2' }, user))));
  check('B5: ...nor to another invoice of the same supplier recorded under the other master',
    /already recorded for this vendor/.test(await errMsg(vendorInvoiceService.update(id(invGx3), { invoiceNumber: 'GX-4' }, user))));

  // C. Normal Purchase Voucher (carries its invoice's number).
  const pv = await vs.create({ voucherType: 'PURCHASE', invoiceId: id(invoice) }, user);
  check('C1: Purchase Voucher still created from its approved invoice, unchanged',
    pv.voucherType === 'PURCHASE' && pv.invoiceNumber === 'VI-100' && pv.netPayableAmount === 100);
  check('C2: its invoice number blocks a Direct Purchase of that vendor', VINV.test(await errMsg(dpFor(vendor.a, 'VI-100'))));

  // D. Expense Against PO / Against GRN (the vendor comes from the document, here a Vendor id).
  const poV = await VendorPurchaseOrder.create({
    poNumber: 'PO-DP-EXP', vendorId: vendor.a._id, vendorName: vendor.a.name, indentId: new mongoose.Types.ObjectId(),
    approvalStatus: 'APPROVED', poStatus: 'RELEASED_TO_VENDOR',
    items: [{ skuId: sku.bolt._id, skuCode: sku.bolt.code, itemName: sku.bolt.name, unit: 'PCS', quantity: 10, receivedQty: 0, pendingQty: 10, rate: 10, gstRate: 18 }],
    grandTotal: 5000,
  });
  const apo = (no) => vs.create({ voucherType: 'EXPENSE', expenseType: 'AGAINST_PO', poId: id(poV), expenseCategory: 'Other', expenseInvoiceNo: no, basicValue: 100 }, user);
  await apo('AP-1');
  check('D1: expense Against PO blocks a Direct Purchase of the same vendor', VEXP.test(await errMsg(dpFor(vendor.a, 'ap-1'))));
  await dpFor(vendor.a, 'AP-2');
  check('D2: a Direct Purchase blocks an expense Against PO', OLD.test(await errMsg(apo('AP-2'))));
  const grn = await GoodsReceiptNote.create({
    grnNumber: 'GRN-DP-WOPO', isWithoutPo: true, vendorId: vendor.a._id, vendorName: vendor.a.name, grnStatus: 'RECEIVED', warehouse: 'MAIN',
    items: [{ skuId: sku.bolt._id, skuCode: sku.bolt.code, itemName: sku.bolt.name, unit: 'PCS', receivedQty: 1, invoiceQty: 1, rate: 10 }],
  });
  const agrn = (no) => vs.create({ voucherType: 'EXPENSE', expenseType: 'AGAINST_GRN', grnId: id(grn), expenseCategory: 'Other', expenseInvoiceNo: no, basicValue: 100 }, user);
  await dpFor(vendor.a, 'AG-1');
  check('D3: a Direct Purchase blocks an expense Against GRN', OLD.test(await errMsg(agrn('ag-1'))));
  await agrn('AG-2');
  check('D4: expense Against GRN blocks a Direct Purchase', VEXP.test(await errMsg(dpFor(vendor.a, 'AG-2'))));

  // E. What must NOT match: names, placeholder GSTINs, mistyped GSTINs, other suppliers.
  await expBill(noGst.party, 'NM-1');
  check('E1: same NAME in both masters, no GSTIN -> NOT treated as one supplier', Boolean(await dpFor(noGst.vendor, 'NM-1')));
  await expBill(junk.party, 'JK-1');
  check('E2: identical placeholder GSTIN ("NA") in both masters -> not matched', Boolean(await dpFor(junk.vendor, 'JK-1')));
  await expBill(junk.typoParty, 'TY-1');
  check('E3: identical but INVALID GSTIN (bad check digit) in both masters -> not matched', Boolean(await dpFor(junk.typoVendor, 'TY-1')));
  check('E4: a different supplier with the same number is never touched', Boolean(await dpFor(vendor.b, 'GX-1')));

  // F. Editing a bill saved before this rule must stay possible; changing it re-checks.
  const legacyExp = await VendorVoucher.create({
    voucherNumber: 'AGL/EXP-LEGACY-DUP', voucherType: 'EXPENSE', voucherDate: new Date(), expenseCategory: 'Other',
    vendorId: same.party._id, vendorName: same.party.name, partyName: same.party.name, expenseInvoiceNo: 'GX-3', basicValue: 10,
    netPayableAmount: 10, balanceAmount: 10, totalAmountPayable: 10, voucherStatus: 'DRAFT',
  });
  const legEdit = await vs.update(id(legacyExp), { remarks: 'still editable' }, user);
  check('F1: an old expense draft whose number repeats a Vendor Invoice can still be edited (vendor + number unchanged)', legEdit.remarks === 'still editable');
  check('F2: ...but re-pointing it at another taken number is refused', OLD.test(await errMsg(vs.update(id(legacyExp), { expenseInvoiceNo: 'GX-2' }, user))));

  console.log(`\n${failures ? `FAILED — ${failures} check(s)` : 'ALL CHECKS PASSED'}\n`);
};

if (isEntry(import.meta.url)) {
  const mode = process.argv[2];
  if (!['--api', '--seed-ui'].includes(mode)) {
    console.error('usage: node src/scripts/e2eDirectPurchaseFixture.js --api | --seed-ui');
    process.exit(2);
  }
  run({ seedOnly: mode === '--seed-ui' })
    .catch((err) => { console.error(err); failures += 1; })
    .finally(async () => { await mongoose.disconnect(); process.exit(failures ? 1 : 0); });
}
