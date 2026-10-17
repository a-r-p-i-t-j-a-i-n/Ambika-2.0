/**
 * Fixture + database oracle for the combined GRN + Incoming QC page.
 *
 *   node src/scripts/e2eGrnQcFixture.js --seed     fresh scratch DB + one GRN per QC state
 *   node src/scripts/e2eGrnQcFixture.js --verify   assert what the browser run left behind
 *   node src/scripts/e2eGrnQcFixture.js --race     service-level concurrency checks (no browser):
 *                                                  double create / complete, historical duplicates,
 *                                                  failed create + retry, invoice eligibility, service QC
 *   node src/scripts/e2eGrnQcFixture.js --stock    rejection stock-out location matrix (no browser):
 *                                                  MAIN / PLG01 / JW001, RM opt-in on/off, balances
 *                                                  before/after, ledger reconciliation
 *
 * Pairs with frontend/e2e/grnQc.e2e.mjs, which drives the real UI in Chromium.
 * --race and --stock add their own GRNs, so run them after --seed.
 *
 * SAFETY: pinned to a localhost scratch database (dropped on --seed) and runs
 * the shared e2e guard (S3 + email must be off) before anything connects. It
 * never reads the configured MONGO_URI, so it cannot touch the Atlas data.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote, { GRN_STATUS } from '../modules/procurement/grn/grn.model.js';
import IncomingQC from '../modules/procurement/incoming-qc/incomingQc.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_grnqc';
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eGrnQcFixture.js');
export const E2E_USER = { email: 'e2e@test.local', password: 'E2e@12345', name: 'E2E Runner', role: 'MD' };

const SKUS = [
  { code: 'E2E-BOLT', name: 'E2E Bolt M8', unit: 'PCS', itemType: 'CONSUMABLE' },
  { code: 'E2E-NUT', name: 'E2E Nut M8', unit: 'PCS', itemType: 'CONSUMABLE' },
  { code: 'E2E-COIL', name: 'E2E Coil 1250mm', unit: 'KGS', itemType: 'RAW_MATERIAL' },
];
const BOLT_NUT = [['E2E-BOLT', 10, ''], ['E2E-NUT', 5, '']];

/**
 * One GRN per state the QC section must handle (browser run).
 *   state: DRAFT | COMPLETED (completed through grnService.complete → real receipts)
 *   approval: GRN approvalStatus once completed · qc: seed a DRAFT / PASSED QC
 *   rm: the GRN's "Add to RM Stock" / "Received At" choice
 */
const CP = 'CONSUMABLE_PACKAGING';
const GRNS = [
  { tag: 'FLOW',      state: 'DRAFT', inventoryType: CP },                                        // full journey in the browser
  { tag: 'DRAFT',     state: 'DRAFT', inventoryType: CP },                                        // complete the GRN first
  { tag: 'UNSIGNED',  state: 'COMPLETED', inventoryType: CP, approval: 'READY_FOR_MD_APPROVAL' },  // waiting for MD
  { tag: 'NOREQ',     state: 'COMPLETED', inventoryType: CP, approval: 'NOT_REQUIRED' },          // no approval raised
  { tag: 'READYFAIL', state: 'COMPLETED', inventoryType: CP, approval: 'MD_APPROVED' },           // everything rejected → FAILED
  { tag: 'READYPASS', state: 'COMPLETED', inventoryType: CP, approval: 'MD_APPROVED' },           // everything accepted → PASSED
  { tag: 'RESUME',    state: 'COMPLETED', inventoryType: CP, approval: 'MD_APPROVED', qc: 'DRAFT' },   // draft QC exists
  { tag: 'DONE',      state: 'COMPLETED', inventoryType: CP, approval: 'MD_APPROVED', qc: 'PASSED' },  // QC already completed
  // Records written by the earlier form (rework / defect / severity) — kept, never dropped.
  { tag: 'REWORK',    state: 'COMPLETED', inventoryType: CP, approval: 'MD_APPROVED', qc: 'DRAFT_REWORK' },
  { tag: 'HIST',      state: 'COMPLETED', inventoryType: CP, approval: 'MD_APPROVED', qc: 'PARTIAL_REWORK' },
  // Raw Material through the browser: an RM GRN — rejected coil must leave PLG01.
  { tag: 'RMPLG', state: 'DRAFT', inventoryType: 'RM', lines: [['E2E-COIL', 500, 'B-RMPLG']], rm: { rmReceivedAtLocation: 'PLG01' } },
  // A GRN completed BEFORE Inventory Type existed, with "Add to RM Stock" OFF: no
  // inventoryType, coil never stocked. Kept exactly as recorded — QC moves nothing.
  { tag: 'RMOFF', state: 'COMPLETED', approval: 'MD_APPROVED', lines: [['E2E-COIL', 600, 'B-RMOFF']], rm: { addToRmStock: false, rmReceivedAtLocation: 'PLG01' } },
];

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== 'ambika_e2e_grnqc') throw new Error('Connected to an unexpected database — aborting.');
};

const services = async () => ({
  grnService: (await import('../modules/procurement/grn/grn.service.js')).grnService,
  incomingQcService: (await import('../modules/procurement/incoming-qc/incomingQc.service.js')).incomingQcService,
  vendorInvoiceService: (await import('../modules/procurement/vendor-invoice/vendorInvoice.service.js')).vendorInvoiceService,
});

/** PO + draft GRN; when `complete`, completed through the real service so the receipts are genuine. */
const makeGrn = async ({ tag, lines = BOLT_NUT, rm = {}, inventoryType = null, complete = false, approval = 'MD_APPROVED' }, ctx) => {
  const { skus, vendorId, user, grnService } = ctx;
  const po = await VendorPurchaseOrder.create({
    poNumber: `PO-E2E-${tag}`, vendorId, vendorName: 'E2E Vendor Pvt Ltd',
    indentId: new mongoose.Types.ObjectId(), poStatus: 'APPROVED',
    items: lines.map(([code, qty]) => ({
      skuId: skus[code]._id, skuCode: code, itemName: skus[code].name, unit: skus[code].unit,
      quantity: qty, receivedQty: 0, pendingQty: qty, rate: 100, gstRate: 18,
    })),
  });
  let grn = await GoodsReceiptNote.create({
    grnNumber: `GRN-E2E-${tag}`, poId: po._id, poNumber: po.poNumber,
    vendorId, vendorName: 'E2E Vendor Pvt Ltd', warehouse: 'MAIN',
    // With an Inventory Type the RM fields follow it (as the service derives them);
    // without one this is a GRN from before Inventory Type existed.
    inventoryType,
    addToRmStock: inventoryType ? inventoryType === 'RM' : !!rm.addToRmStock,
    rmReceivedAtLocation: inventoryType && inventoryType !== 'RM' ? null : (rm.rmReceivedAtLocation || null),
    grnStatus: GRN_STATUS.DRAFT, stockPosted: false,
    items: po.items.map((p, i) => ({
      poItemId: p._id, skuId: p.skuId, skuCode: p.skuCode, itemName: p.itemName, unit: p.unit,
      orderedQty: p.quantity, receivedQty: p.quantity, rate: p.rate, batchNo: lines[i][2] || '',
    })),
    totalReceivedQty: lines.reduce((t, l) => t + l[1], 0),
  });
  if (complete) {
    await grnService.complete(String(grn._id), {}, user);
    // Stand-in for the MD's signature (the browser run signs for real); the QC
    // gate reads only this mirror field.
    await GoodsReceiptNote.updateOne({ _id: grn._id }, { $set: { approvalStatus: approval } });
    grn = await GoodsReceiptNote.findById(grn._id).lean();
  }
  return { grn, po };
};

/**
 * Seed a QC as older data may hold it.
 *   DRAFT          first line 2 rejected (balanced), rest accepted
 *   PASSED         everything accepted, completed
 *   DRAFT_REWORK   draft from the earlier form: first line 6 accepted / 2 rejected /
 *                  2 rework + defect "scratch" (MAJOR) — rework must be re-split
 *   PARTIAL_REWORK completed earlier with first line 7 accepted / 3 rework + defect "dent"
 */
const seedQc = async (grn, kind) => {
  const done = ['PASSED', 'PARTIAL_REWORK'].includes(kind);
  const firstLine = {
    DRAFT: (r) => ({ acceptedQty: r - 2, rejectedQty: 2, reworkQty: 0 }),
    PASSED: (r) => ({ acceptedQty: r, rejectedQty: 0, reworkQty: 0 }),
    DRAFT_REWORK: (r) => ({ acceptedQty: r - 4, rejectedQty: 2, reworkQty: 2, defectType: 'scratch', defectSeverity: 'MAJOR' }),
    PARTIAL_REWORK: (r) => ({ acceptedQty: r - 3, rejectedQty: 0, reworkQty: 3, defectType: 'dent', defectSeverity: 'MINOR' }),
  }[kind];
  const items = grn.items.map((it, i) => ({
    grnItemId: it._id, skuId: it.skuId, skuCode: it.skuCode, itemName: it.itemName, unit: it.unit,
    receivedQty: it.receivedQty,
    ...(i === 0 ? firstLine(it.receivedQty) : { acceptedQty: it.receivedQty, rejectedQty: 0, reworkQty: 0 }),
  }));
  const status = { PASSED: ['PASSED', 'PASS'], PARTIAL_REWORK: ['PARTIAL', 'PARTIAL_PASS'] }[kind] || ['DRAFT', ''];
  const doc = await IncomingQC.create({
    qcNumber: `QC-E2E-${grn.grnNumber.replace('GRN-E2E-', '')}`, grnId: grn._id, grnNumber: grn.grnNumber,
    poId: grn.poId, poNumber: grn.poNumber, vendorId: grn.vendorId, vendorName: grn.vendorName, warehouse: 'MAIN',
    qcStatus: status[0], overallResult: status[1],
    stockPosted: done, completedAt: done ? new Date() : null,
    checkedByName: 'Seeded Inspector', remarks: done ? 'Seeded completed QC' : 'Seeded draft — resume me',
    items,
    totalReceived: items.reduce((s, x) => s + x.receivedQty, 0),
    totalAccepted: items.reduce((s, x) => s + x.acceptedQty, 0),
    totalRejected: items.reduce((s, x) => s + x.rejectedQty, 0),
    totalRework: items.reduce((s, x) => s + x.reworkQty, 0),
  });
  if (done) {
    await GoodsReceiptNote.updateOne({ _id: grn._id }, { $set: { qcStatus: status[0], qcId: doc._id, qcNumber: doc.qcNumber, qcCompletedAt: new Date() } });
  }
  return doc;
};

const context = async () => {
  const user = await User.findOne({ email: E2E_USER.email }).lean();
  const skus = Object.fromEntries((await SKU.find({}).lean()).map((s) => [s.code, s]));
  return { user, skus, vendorId: new mongoose.Types.ObjectId(), ...(await services()) };
};

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  await User.create({ ...E2E_USER, mobile: '9000000001', isActive: true, roles: ['MD'] });
  for (const s of SKUS) await SKU.create(s);
  const ctx = await context();
  const out = {};
  for (const g of GRNS) {
    const { grn } = await makeGrn({ ...g, complete: g.state === 'COMPLETED' }, ctx);
    if (g.qc) await seedQc(grn, g.qc);
    out[g.tag] = String(grn._id);
  }
  // A PO with no GRN yet, eligible for the Create GRN form's picker (READY_FOR_GRN
  // + PI settled + confirmed material date), so the browser raises a brand-new GRN.
  const bolt = ctx.skus['E2E-BOLT'];
  await VendorPurchaseOrder.create({
    poNumber: 'PO-E2E-NEWGRN', vendorId: ctx.vendorId, vendorName: 'E2E Vendor Pvt Ltd',
    indentId: new mongoose.Types.ObjectId(), poStatus: 'APPROVED',
    followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_NOT_REQUIRED', readyForGrnAt: new Date(), finalMaterialDate: new Date(),
    items: [{ skuId: bolt._id, skuCode: bolt.code, itemName: bolt.name, unit: bolt.unit, quantity: 8, receivedQty: 0, pendingQty: 8, rate: 100, gstRate: 18 }],
  });
  // …and one with a coil, for an Inventory Type = Raw Material GRN through the form.
  const coil = ctx.skus['E2E-COIL'];
  await VendorPurchaseOrder.create({
    poNumber: 'PO-E2E-NEWRM', vendorId: ctx.vendorId, vendorName: 'E2E Vendor Pvt Ltd',
    indentId: new mongoose.Types.ObjectId(), poStatus: 'APPROVED',
    followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_NOT_REQUIRED', readyForGrnAt: new Date(), finalMaterialDate: new Date(),
    items: [{ skuId: coil._id, skuCode: coil.code, itemName: coil.name, unit: coil.unit, quantity: 50, receivedQty: 0, pendingQty: 50, rate: 90, gstRate: 18 }],
  });
  console.log(JSON.stringify({ ok: true, grnIds: out }, null, 2));
  await mongoose.disconnect();
};

// ── Oracle helpers ────────────────────────────────────────────────────────────
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const finish = async () => {
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
};
const errMsg = (p) => p.then(() => 'OK', (e) => `${e.statusCode || ''} ${e.message}`.trim());

const grnState = async (tag) => {
  const grn = await GoodsReceiptNote.findOne({ grnNumber: `GRN-E2E-${tag}` }).lean();
  const qcs = (await IncomingQC.find({ grnId: grn._id, isDeleted: { $ne: true } }).lean()).filter((q) => q.qcStatus !== 'CANCELLED');
  const rejectMovs = qcs.length ? await InventoryMovement.find({ refType: 'INCOMING_QC', refId: { $in: qcs.map((q) => q._id) } }).lean() : [];
  return { grn, qcs, rejectMovs };
};

/** On-hand for one SKU per store, e.g. { MAIN: 0, PLG01: 400 } (rows only where they exist). */
const balances = async (skuId) => Object.fromEntries(
  (await InventoryStock.find({ skuId }).lean()).map((s) => [s.warehouse, s.qtyOnHand]),
);
const fmt = (o) => JSON.stringify(o);

/** Every stock row equals the sum of its ledger: InventoryStock is derivable from InventoryMovement. */
const reconcile = async () => {
  const rows = await InventoryStock.find({}).lean();
  const sums = await InventoryMovement.aggregate([
    { $match: { isDeleted: { $ne: true } } },
    { $group: { _id: { s: '$skuId', w: '$warehouse' }, q: { $sum: '$qtyDelta' } } },
  ]);
  const ledger = new Map(sums.map((r) => [`${r._id.s}|${r._id.w}`, Math.round(r.q * 100) / 100]));
  const bad = rows.filter((r) => ledger.get(`${r.skuId}|${r.warehouse}`) !== Math.round(r.qtyOnHand * 100) / 100);
  const orphan = [...ledger.keys()].filter((k) => !rows.some((r) => `${r.skuId}|${r.warehouse}` === k));
  check('every stock balance reconciles with the movement ledger', !bad.length && !orphan.length,
    `${rows.length} row(s)${bad.length ? `; mismatched: ${bad.map((r) => `${r.skuCode}@${r.warehouse}`).join(',')}` : ''}`);
};

// ── --verify: after the browser run ───────────────────────────────────────────
const verify = async () => {
  await connect();
  console.log('\n── After the browser run ──');

  const flow = await grnState('FLOW');
  const grnIn = await InventoryMovement.countDocuments({ refType: 'GRN', refId: flow.grn._id });
  check('FLOW: GRN completed in the browser posted stock once per line', grnIn === 2, `${grnIn} GRN_IN movement(s)`);
  check('FLOW: GRN was MD-signed in the browser', flow.grn.approvalStatus === 'MD_APPROVED', flow.grn.approvalStatus);
  check('FLOW: exactly one QC, PARTIAL, mirrored on the GRN', flow.qcs.length === 1 && flow.qcs[0].qcStatus === 'PARTIAL' && flow.grn.qcStatus === 'PARTIAL');
  check('FLOW: one QC_REJECT_OUT of 3 at MAIN (non-RM — unchanged)', flow.rejectMovs.length === 1 && flow.rejectMovs[0].quantity === 3 && flow.rejectMovs[0].warehouse === 'MAIN',
    flow.rejectMovs.map((m) => `${m.quantity}@${m.warehouse}`).join(','));

  const fq = flow.qcs[0] || {};
  check('FLOW: per-line remark stored in qcRemarks', fq.items?.[0]?.qcRemarks === 'Seal damaged on 3', fq.items?.[0]?.qcRemarks);
  check('FLOW: QC report / photo stored on the existing qcReportDocument', /qc-photo\.png/.test(fq.qcReportDocument?.fileName || '') && Boolean(fq.qcReportDocument?.fileUrl),
    fq.qcReportDocument?.fileName);
  check('FLOW: new QC carries no rework (two-way split)', (fq.items || []).every((it) => it.reworkQty === 0) && fq.totalRework === 0);

  const rw = await grnState('REWORK');
  const rq = rw.qcs[0] || {};
  check('REWORK: the seeded draft was completed (no second QC), PARTIAL', rw.qcs.length === 1 && rq.qcStatus === 'PARTIAL', `${rw.qcs.length} · ${rq.qcStatus}`);
  check('REWORK: rework re-split by the user → 6 accepted / 4 rejected / 0 rework', rq.items?.[0]?.acceptedQty === 6 && rq.items?.[0]?.rejectedQty === 4 && rq.items?.[0]?.reworkQty === 0);
  check('REWORK: earlier defect "scratch" / MAJOR kept on the record', rq.items?.[0]?.defectType === 'scratch' && rq.items?.[0]?.defectSeverity === 'MAJOR');
  check('REWORK: one stock-out of the 4 rejected', rw.rejectMovs.length === 1 && rw.rejectMovs[0].quantity === 4, rw.rejectMovs.map((x) => x.quantity).join(','));

  const hist = await grnState('HIST');
  const hq = hist.qcs[0] || {};
  check('HIST: historical completed QC untouched (rework 3, defect "dent" / MINOR)', hq.qcStatus === 'PARTIAL' && hq.items?.[0]?.reworkQty === 3
    && hq.items?.[0]?.defectType === 'dent' && hq.items?.[0]?.defectSeverity === 'MINOR' && hq.totalRework === 3);

  const fail = await grnState('READYFAIL');
  check('READYFAIL: one QC, FAILED, one stock-out per line at MAIN', fail.qcs.length === 1 && fail.qcs[0].qcStatus === 'FAILED'
    && fail.rejectMovs.length === 2 && fail.rejectMovs.every((m) => m.warehouse === 'MAIN'), `${fail.rejectMovs.length}`);
  const pass = await grnState('READYPASS');
  check('READYPASS: one QC, PASSED, no stock-out', pass.qcs.length === 1 && pass.qcs[0].qcStatus === 'PASSED' && pass.rejectMovs.length === 0);
  const resume = await grnState('RESUME');
  check('RESUME: the seeded draft was resumed — still one QC, PARTIAL, 2 out', resume.qcs.length === 1 && resume.qcs[0].qcNumber === 'QC-E2E-RESUME'
    && resume.qcs[0].qcStatus === 'PARTIAL' && resume.rejectMovs[0]?.quantity === 2);

  const coil = await SKU.findOne({ code: 'E2E-COIL' }).lean();
  const plg = await grnState('RMPLG');
  check('RMPLG: rejected coil (100) left PLG01 with its batch, not MAIN', plg.rejectMovs.length === 1 && plg.rejectMovs[0].warehouse === 'PLG01'
    && plg.rejectMovs[0].quantity === 100 && plg.rejectMovs[0].batchNo === 'B-RMPLG', plg.rejectMovs.map((m) => `${m.quantity}@${m.warehouse}/${m.batchNo}`).join(','));
  const off = await grnState('RMOFF');
  check('RMOFF: QC completed, but no stock-out for a coil never added to stock', off.qcs[0]?.qcStatus === 'PARTIAL' && off.rejectMovs.length === 0,
    `${off.qcs[0]?.qcStatus} · ${off.rejectMovs.length} mov`);
  check('RMOFF: the QC timeline says why nothing moved', (off.qcs[0]?.activityTimeline || []).some((e) => e.action === 'STOCK_NOTE' && /never added/.test(e.description)));
  const coilBal = await balances(coil._id);
  check('coil balances: PLG01 = 500 − 100 = 400, no MAIN row, nothing negative', coilBal.PLG01 === 400 && coilBal.MAIN === undefined && Object.values(coilBal).every((v) => v >= 0), fmt(coilBal));

  // Raised, completed, signed and QC'd entirely on the Create GRN form.
  const newGrn = await GoodsReceiptNote.findOne({ poNumber: 'PO-E2E-NEWGRN' }).lean();
  const newQcs = newGrn ? await IncomingQC.find({ grnId: newGrn._id }).lean() : [];
  const newIn = newGrn ? await InventoryMovement.find({ refType: 'GRN', refId: newGrn._id }).lean() : [];
  const newOut = newQcs.length ? await InventoryMovement.find({ refType: 'INCOMING_QC', refId: newQcs[0]._id }).lean() : [];
  check('NEWGRN: completed and MD-signed from the form', !!newGrn && newGrn.grnStatus === 'FULLY_RECEIVED' && newGrn.approvalStatus === 'MD_APPROVED',
    newGrn ? `${newGrn.grnNumber} · ${newGrn.grnStatus} · ${newGrn.approvalStatus}` : 'not found');
  check('NEWGRN: stock posted exactly once (one GRN_IN of 8 at MAIN)', newIn.length === 1 && newIn[0].quantity === 8 && newIn[0].warehouse === 'MAIN', `${newIn.length} movement(s)`);
  check('NEWGRN: exactly one QC, PARTIAL, mirrored on the GRN', newQcs.length === 1 && newQcs[0].qcStatus === 'PARTIAL' && newGrn.qcStatus === 'PARTIAL',
    newQcs.map((q) => `${q.qcNumber}:${q.qcStatus}`).join(','));
  check('NEWGRN: one QC_REJECT_OUT of 2 at MAIN (double-click did not duplicate it)', newOut.length === 1 && newOut[0].quantity === 2 && newOut[0].warehouse === 'MAIN',
    newOut.map((x) => `${x.quantity}@${x.warehouse}`).join(','));

  // Inventory Type chosen on the form: C&P (NEWGRN) and Raw Material (NEWRM).
  check('NEWGRN: Inventory Type Consumable & Packaging saved, no RM location', newGrn?.inventoryType === 'CONSUMABLE_PACKAGING' && newGrn?.rmReceivedAtLocation === null);
  const rmGrn = await GoodsReceiptNote.findOne({ poNumber: 'PO-E2E-NEWRM' }).lean();
  const rmIn = rmGrn ? await InventoryMovement.find({ refType: 'GRN', refId: rmGrn._id }).lean() : [];
  check('NEWRM: Inventory Type RM saved with Received At JW001', rmGrn?.inventoryType === 'RM' && rmGrn?.rmReceivedAtLocation === 'JW001' && rmGrn?.addToRmStock === true,
    rmGrn ? `${rmGrn.inventoryType} · ${rmGrn.rmReceivedAtLocation}` : 'not found');
  check('NEWRM: stock posted exactly once — one GRN_IN of 50 at JW001, batch B-FORM-RM-1 (double-click)',
    rmIn.length === 1 && rmIn[0].quantity === 50 && rmIn[0].warehouse === 'JW001' && rmIn[0].batchNo === 'B-FORM-RM-1',
    rmIn.map((m) => `${m.quantity}@${m.warehouse}/${m.batchNo}`).join(','));
  const { rmImsService } = await import('../modules/inventory/rmIms.service.js');
  const coilRow = ((await rmImsService.getOverview({ search: 'E2E-COIL' })).docs || []).find((r) => r.skuCode === 'E2E-COIL');
  const coilAll = await balances(coil._id);
  check('RM IMS overview shows the coil on hand = sum of its stock rows', coilRow && coilRow.onHand === Object.values(coilAll).reduce((s, v) => s + v, 0),
    `${coilRow?.onHand} vs ${fmt(coilAll)}`);

  for (const tag of ['DRAFT', 'UNSIGNED', 'NOREQ']) {
    const s = await grnState(tag);
    check(`${tag}: locked — no QC was created`, s.qcs.length === 0, `${s.qcs.length}`);
  }
  const done = await grnState('DONE');
  check('DONE: completed QC untouched', done.qcs.length === 1 && done.qcs[0].qcStatus === 'PASSED');
  await reconcile();
  await finish();
};

const qcLines = (grn, split) => grn.items.map((it, i) => {
  const [rej, rew] = split[i] || [0, 0];
  return {
    grnItemId: String(it._id), skuId: String(it.skuId), skuCode: it.skuCode, itemName: it.itemName, unit: it.unit, batchNo: it.batchNo,
    receivedQty: it.receivedQty, acceptedQty: it.receivedQty - rej - rew, rejectedQty: rej, reworkQty: rew,
  };
});

// ── --race: concurrency / duplicates (no browser) ─────────────────────────────
const race = async () => {
  await connect();
  const ctx = await context();
  const { incomingQcService: qcs, vendorInvoiceService } = ctx;
  const { user } = ctx;
  const signed = async (tag, lines) => (await makeGrn({ tag, lines, complete: true }, ctx)).grn;

  console.log('\n── Duplicate QC creation ──');
  const g1 = await signed('RACE-CREATE');
  const creates = await Promise.allSettled([1, 2, 3, 4].map(() => qcs.create({ grnId: String(g1._id) }, user)));
  const made = creates.filter((c) => c.status === 'fulfilled').length;
  const live1 = await IncomingQC.countDocuments({ grnId: g1._id, qcStatus: { $ne: 'CANCELLED' } });
  check('four simultaneous creates → exactly one QC', made === 1 && live1 === 1, `${made} created, ${live1} in DB`);
  check('…the others get a controlled 409 naming the existing QC',
    creates.filter((c) => c.status === 'rejected').every((c) => c.reason.statusCode === 409 && /already exists|being saved/.test(c.reason.message)),
    creates.filter((c) => c.status === 'rejected').map((c) => `${c.reason.statusCode} ${c.reason.message}`).join(' | '));
  check('…and the GRN lock is released afterwards', !(await GoodsReceiptNote.findById(g1._id).lean()).qcLockAt);
  const again = await errMsg(qcs.create({ grnId: String(g1._id) }, user));
  check('repeated sequential create → 409 "already exists"', /^409 .*already exists/.test(again), again);

  console.log('\n── Resume the existing draft ──');
  const draft1 = await IncomingQC.findOne({ grnId: g1._id }).lean();
  await qcs.update(String(draft1._id), { items: qcLines(g1, [[2, 0]]), remarks: 'resumed' }, user);
  await qcs.complete(String(draft1._id), {}, user);
  const after1 = await IncomingQC.findById(draft1._id).lean();
  check('the one draft is edited and completed (PARTIAL)', after1.qcStatus === 'PARTIAL' && after1.remarks === 'resumed');

  console.log('\n── Failed create, then retry ──');
  const g2 = await signed('RACE-RETRY');
  const bad = await errMsg(qcs.create({ grnId: String(g2._id), items: [{ itemName: '', receivedQty: 1 }] }, user));
  check('a create that fails inside the lock reports its error', bad !== 'OK', bad);
  check('…leaves no QC and no lock behind', (await IncomingQC.countDocuments({ grnId: g2._id })) === 0 && !(await GoodsReceiptNote.findById(g2._id).lean()).qcLockAt);
  const retry = await errMsg(qcs.create({ grnId: String(g2._id) }, user));
  check('…and the retry creates the QC', retry === 'OK', retry);

  console.log('\n── Stale lock (crashed request) ──');
  const g3 = await signed('RACE-STALE');
  await GoodsReceiptNote.updateOne({ _id: g3._id }, { $set: { qcLockAt: new Date(Date.now() - 3 * 60 * 1000) } });
  check('a lock older than its 2-minute TTL is reclaimed', (await errMsg(qcs.create({ grnId: String(g3._id) }, user))) === 'OK');
  await GoodsReceiptNote.updateOne({ _id: g3._id }, { $set: { qcLockAt: new Date() } });
  const held = await errMsg(qcs.create({ grnId: String(g3._id) }, user));
  check('a live lock held by another request → 409 after a short wait', /^409 .*being saved/.test(held), held);
  await GoodsReceiptNote.updateOne({ _id: g3._id }, { $set: { qcLockAt: null } });

  console.log('\n── Historical duplicate drafts (seeded directly, as old data may hold) ──');
  const g4 = await signed('RACE-HIST');
  const dupA = await seedQc(g4, 'DRAFT');
  const dupB = await IncomingQC.create({ ...dupA.toObject(), _id: undefined, qcNumber: 'QC-E2E-RACE-HIST-B', activityTimeline: [] });
  const both = await Promise.allSettled([qcs.complete(String(dupA._id), {}, user), qcs.complete(String(dupB._id), {}, user)]);
  const movs4 = await InventoryMovement.find({ refType: 'INCOMING_QC', refId: { $in: [dupA._id, dupB._id] } }).lean();
  check('two duplicate drafts completed at once → only one completes', both.filter((b) => b.status === 'fulfilled').length === 1,
    both.map((b) => (b.status === 'fulfilled' ? 'ok' : b.reason.message)).join(' | '));
  check('…one stock-out only (2), the duplicate stays a draft', movs4.length === 1 && movs4[0].quantity === 2,
    `${movs4.length} movement(s)`);
  const leftover = await IncomingQC.findOne({ _id: { $in: [dupA._id, dupB._id] }, qcStatus: 'DRAFT' }).lean();
  const third = await errMsg(qcs.complete(String(leftover._id), {}, user));
  check('…completing the duplicate later is refused, records untouched', /^409 .*already has a completed QC/.test(third), third);

  console.log('\n── Simultaneous complete of one QC ──');
  const g5 = await signed('RACE-DONE');
  const d5 = await qcs.create({ grnId: String(g5._id), items: qcLines(g5, [[4, 0]]) }, user);
  const outs = await Promise.allSettled([1, 2, 3].map(() => qcs.complete(String(d5._id), {}, user)));
  const m5 = await InventoryMovement.find({ refType: 'INCOMING_QC', refId: d5._id }).lean();
  check('three concurrent completes → one success, one stock-out (4)', outs.filter((o) => o.status === 'fulfilled').length === 1 && m5.length === 1 && m5[0].quantity === 4,
    outs.filter((o) => o.status === 'rejected').map((o) => o.reason.message).join(' | '));

  console.log('\n── Vendor Invoice eligibility (unchanged) ──');
  const gp = await signed('INV-PASS');
  const qp = await qcs.create({ grnId: String(gp._id) }, user); await qcs.complete(String(qp._id), {}, user);
  const gf = await signed('INV-FAIL');
  const qf = await qcs.create({ grnId: String(gf._id), items: qcLines(gf, [[10, 0], [5, 0]]) }, user); await qcs.complete(String(qf._id), {}, user);
  const inv = await vendorInvoiceService.getInvoiceableQcs({});
  const ids = new Set(inv.map((q) => String(q._id)));
  check('PASSED and PARTIAL QCs invoiceable, FAILED not', ids.has(String(qp._id)) && ids.has(String(d5._id)) && !ids.has(String(qf._id)));
  const pend = inv.find((q) => String(q._id) === String(d5._id))?.items.find((i) => i.skuCode === 'E2E-BOLT')?.pendingInvoiceQty;
  check('PARTIAL invoiceable qty = accepted only (10 − 4 = 6)', pend === 6, `${pend}`);
  check('invoice against a FAILED QC refused', /not invoiceable/.test(await errMsg(vendorInvoiceService.create({ qcIds: [String(qf._id)], invoiceNumber: 'X' }, user))));

  console.log('\n── Internal-service QC (no GRN, no lock, no stock) ──');
  const indent = await PurchaseIndent.create({
    indentNumber: 'IND-E2E-SVC', requestType: 'INTERNAL_SERVICE', overallStatus: 'SERVICE_PENDING', approvalStatus: 'APPROVED',
    items: [{ itemName: 'AMC visit', quantity: 1, approvedQuantity: 1, unit: 'Nos' }],
  });
  const svc = await qcs.create({ indentId: String(indent._id) }, user);
  await qcs.complete(String(svc._id), { overallResult: 'PASS' }, user);
  check('service QC PASSED, no stock movement, indent SERVICE_QC_PASSED',
    (await IncomingQC.findById(svc._id).lean()).qcStatus === 'PASSED'
    && (await InventoryMovement.countDocuments({ refId: svc._id })) === 0
    && (await PurchaseIndent.findById(indent._id).lean()).overallStatus === 'SERVICE_QC_PASSED');
  await reconcile();
  await finish();
};

// ── --stock: where rejected stock leaves from (no browser) ─────────────────────
const stock = async () => {
  await connect();
  const ctx = await context();
  const { incomingQcService: qcs, user, skus } = ctx;
  const COIL = skus['E2E-COIL']._id;
  const BOLT = skus['E2E-BOLT']._id;

  /** Complete a GRN, then a QC with the given [rejected, rework] per line; report balances + movements. */
  const scenario = async (label, { tag, lines, rm, inventoryType = null, split, skuId }) => {
    console.log(`\n── ${label} ──`);
    const { grn } = await makeGrn({ tag, lines, rm, inventoryType, complete: true }, ctx);
    const before = await balances(skuId);
    const qc = await qcs.create({ grnId: String(grn._id), items: qcLines(grn, split) }, user);
    await qcs.complete(String(qc._id), {}, user);
    const after = await balances(skuId);
    const movs = await InventoryMovement.find({ refType: 'INCOMING_QC', refId: qc._id }).lean();
    const done = await IncomingQC.findById(qc._id).lean();
    console.log(`  INFO  ${done.qcStatus} · before ${fmt(before)} → after ${fmt(after)} · movements: ${movs.map((m) => `${m.txnType} ${m.skuCode} ${m.quantity}@${m.warehouse}${m.batchNo ? `/${m.batchNo}` : ''}`).join(', ') || 'none'}`);
    return { before, after, movs, qc: done };
  };

  const s1 = await scenario('Non-RM bolt received at MAIN, partial reject 3 of 10', {
    tag: 'STK-MAIN', lines: [['E2E-BOLT', 10, '']], inventoryType: 'CONSUMABLE_PACKAGING', split: [[3, 0]], skuId: BOLT,
  });
  check('MAIN: one QC_REJECT_OUT of 3 at MAIN', s1.movs.length === 1 && s1.movs[0].warehouse === 'MAIN' && s1.movs[0].quantity === 3);
  check('MAIN: balance moved by exactly −3', (s1.before.MAIN - s1.after.MAIN) === 3, `${s1.before.MAIN} → ${s1.after.MAIN}`);

  const s2 = await scenario('RM GRN (Inventory Type RM) at PLG01 — reject 100, rework 50 of 500', {
    tag: 'STK-PLG', lines: [['E2E-COIL', 500, 'B-STK-PLG']], inventoryType: 'RM', rm: { rmReceivedAtLocation: 'PLG01' }, split: [[100, 50]], skuId: COIL,
  });
  check('PLG01: rejection leaves PLG01 with the coil batch', s2.movs.length === 1 && s2.movs[0].warehouse === 'PLG01' && s2.movs[0].batchNo === 'B-STK-PLG');
  check('PLG01: only the rejected 100 moves (rework 50 and accepted 350 stay)', s2.movs[0]?.quantity === 100 && (s2.before.PLG01 - s2.after.PLG01) === 100,
    `${s2.before.PLG01} → ${s2.after.PLG01}`);
  check('PLG01: MAIN untouched — no coil row created there', s2.after.MAIN === undefined, fmt(s2.after));

  const s3 = await scenario('RM GRN at JW001 — all 400 rejected', {
    tag: 'STK-JW', lines: [['E2E-COIL', 400, 'B-STK-JW']], inventoryType: 'RM', rm: { rmReceivedAtLocation: 'JW001' }, split: [[400, 0]], skuId: COIL,
  });
  check('JW001: FAILED, 400 out of JW001', s3.qc.qcStatus === 'FAILED' && s3.movs.length === 1 && s3.movs[0].warehouse === 'JW001' && s3.movs[0].quantity === 400);
  check('JW001: balance moved by exactly −400, not negative', (s3.before.JW001 - s3.after.JW001) === 400 && s3.after.JW001 >= 0, `${s3.before.JW001} → ${s3.after.JW001}`);

  const s4 = await scenario('Earlier GRN (before Inventory Type): coil with Add to RM Stock OFF — reject 200 of 600', {
    tag: 'STK-OFF', lines: [['E2E-COIL', 600, 'B-STK-OFF']], rm: { addToRmStock: false, rmReceivedAtLocation: 'PLG01' }, split: [[200, 0]], skuId: COIL,
  });
  check('OFF: no stock-out — the coil was never added to stock', s4.movs.length === 0);
  check('OFF: coil balances unchanged everywhere', fmt(s4.before) === fmt(s4.after), `${fmt(s4.before)} → ${fmt(s4.after)}`);
  check('OFF: QC still completes PARTIAL and records why on its timeline',
    s4.qc.qcStatus === 'PARTIAL' && s4.qc.activityTimeline.some((e) => e.action === 'STOCK_NOTE' && /never added/.test(e.description)));
  check('OFF: no orphan batch — B-STK-OFF has no ledger rows at all', (await InventoryMovement.countDocuments({ batchNo: 'B-STK-OFF' })) === 0);

  const s5 = await scenario('Earlier mixed GRN (before Inventory Type): coil OFF + bolt at MAIN, both partly rejected', {
    tag: 'STK-MIX', lines: [['E2E-COIL', 300, 'B-STK-MIX'], ['E2E-BOLT', 20, '']], rm: { addToRmStock: false, rmReceivedAtLocation: 'PLG01' }, split: [[50, 0], [5, 0]], skuId: BOLT,
  });
  check('MIX: only the posted bolt moves out (5 at MAIN)', s5.movs.length === 1 && s5.movs[0].skuCode === 'E2E-BOLT' && s5.movs[0].quantity === 5 && s5.movs[0].warehouse === 'MAIN');

  const s6 = await scenario('Accepted + rework only (nothing rejected), coil at PLG01', {
    tag: 'STK-REWORK', lines: [['E2E-COIL', 200, 'B-STK-RW']], inventoryType: 'RM', rm: { rmReceivedAtLocation: 'PLG01' }, split: [[0, 30]], skuId: COIL,
  });
  check('REWORK: no stock movement, balance unchanged', s6.movs.length === 0 && s6.before.PLG01 === s6.after.PLG01);

  console.log('\n── Repeated / concurrent complete on an RM QC at PLG01 ──');
  const { grn: gc } = await makeGrn({ tag: 'STK-CONC', lines: [['E2E-COIL', 250, 'B-STK-CONC']], inventoryType: 'RM', rm: { rmReceivedAtLocation: 'PLG01' }, complete: true }, ctx);
  const before = await balances(COIL);
  const qc = await qcs.create({ grnId: String(gc._id), items: qcLines(gc, [[25, 0]]) }, user);
  await Promise.allSettled([1, 2, 3].map(() => qcs.complete(String(qc._id), {}, user)));
  const retried = await errMsg(qcs.complete(String(qc._id), {}, user));
  const movs = await InventoryMovement.find({ refType: 'INCOMING_QC', refId: qc._id }).lean();
  const after = await balances(COIL);
  check('three concurrent + one retry → one stock-out of 25 at PLG01', movs.length === 1 && movs[0].warehouse === 'PLG01' && movs[0].quantity === 25, `retry: ${retried}`);
  check('PLG01 balance moved by exactly −25', (before.PLG01 - after.PLG01) === 25, `${before.PLG01} → ${after.PLG01}`);

  console.log('\n── Coil lineage sees the rejection on the right coil ──');
  const plgReceipt = await InventoryMovement.findOne({ batchNo: 'B-STK-PLG', txnType: 'GRN_IN' }).lean();
  const batchRows = await InventoryMovement.find({ batchNo: 'B-STK-PLG', skuId: COIL }).lean();
  const ledgerAvailable = batchRows.reduce((s, m) => s + (m.movementType === 'IN' ? m.quantity : -m.quantity), 0);
  check('coil B-STK-PLG: ledger available = received 500 − rejected 100 = 400, all at PLG01',
    ledgerAvailable === 400 && batchRows.every((m) => m.warehouse === 'PLG01') && plgReceipt.warehouse === 'PLG01', `${ledgerAvailable}`);

  await reconcile();
  await finish();
};

// ── --invtype: GRN Inventory Type → which IMS module the stock lands in ────────
const invtype = async () => {
  await connect();
  const ctx = await context();
  const { grnService, user, skus } = ctx;
  const { rmImsService } = await import('../modules/inventory/rmIms.service.js');
  const { imsService } = await import('../modules/inventory/ims.service.js');
  if (!skus['E2E-INK']) skus['E2E-INK'] = (await SKU.create({ code: 'E2E-INK', name: 'E2E Ink Black', unit: 'LTR', itemType: 'INK' })).toObject();
  const onHandIn = async (svc, code) => {
    const res = await svc.getOverview({ search: code });
    const row = (res.docs || res).find((r) => r.skuCode === code);
    return row ? row.onHand : undefined;
  };
  const movesFor = (grnId) => InventoryMovement.find({ refType: 'GRN', refId: grnId }).lean();
  const errOf = (p) => p.then(() => 'OK', (e) => `${e.statusCode || ''} ${e.message}`.trim());

  console.log('\n── Raw Material (RM) → RM IMS at the Received At ──');
  const rmBefore = (await onHandIn(rmImsService, 'E2E-COIL')) || 0;
  const { grn: rm } = await makeGrn({ tag: 'INV-RM', lines: [['E2E-COIL', 320, 'B-INV-RM']], inventoryType: 'RM', rm: { rmReceivedAtLocation: 'JW001' } }, ctx);
  check('RM GRN: Inventory Type saved on the GRN', (await GoodsReceiptNote.findById(rm._id).lean()).inventoryType === 'RM');
  await Promise.allSettled([1, 2, 3].map(() => grnService.complete(String(rm._id), {}, user)));
  const rmMoves = await movesFor(rm._id);
  check('RM GRN: one GRN_IN movement of 320 at JW001 with its batch (3 concurrent completes)', rmMoves.length === 1
    && rmMoves[0].txnType === 'GRN_IN' && rmMoves[0].quantity === 320 && rmMoves[0].warehouse === 'JW001' && rmMoves[0].batchNo === 'B-INV-RM',
    rmMoves.map((m) => `${m.quantity}@${m.warehouse}/${m.batchNo}`).join(','));
  const rmAfter = await onHandIn(rmImsService, 'E2E-COIL');
  check('RM GRN: the coil shows in RM IMS with +320 on hand', rmAfter === rmBefore + 320, `${rmBefore} → ${rmAfter}`);
  check('RM GRN: not listed by Consumable & Packaging IMS', (await onHandIn(imsService, 'E2E-COIL')) === undefined);
  check('RM GRN: retry after completion refused, nothing more posted', /already|Only draft/i.test(await errOf(grnService.complete(String(rm._id), {}, user)))
    && (await movesFor(rm._id)).length === 1);

  console.log('\n── Consumable & Packaging → C&P IMS at the GRN store ──');
  const cpBefore = (await onHandIn(imsService, 'E2E-BOLT')) || 0;
  const { grn: cp } = await makeGrn({ tag: 'INV-CP', lines: [['E2E-BOLT', 40, '']], inventoryType: 'CONSUMABLE_PACKAGING' }, ctx);
  await Promise.allSettled([1, 2].map(() => grnService.complete(String(cp._id), {}, user)));
  const cpMoves = await movesFor(cp._id);
  check('C&P GRN: one GRN_IN movement of 40 at MAIN', cpMoves.length === 1 && cpMoves[0].quantity === 40 && cpMoves[0].warehouse === 'MAIN', `${cpMoves.length}`);
  const cpAfter = await onHandIn(imsService, 'E2E-BOLT');
  check('C&P GRN: the bolt shows in Consumable & Packaging IMS with +40 on hand', cpAfter === cpBefore + 40, `${cpBefore} → ${cpAfter}`);
  const cpDoc = await GoodsReceiptNote.findById(cp._id).lean();
  check('C&P GRN: no RM location recorded, addToRmStock false', cpDoc.rmReceivedAtLocation === null && cpDoc.addToRmStock === false && cpDoc.inventoryType === 'CONSUMABLE_PACKAGING');

  console.log('\n── Other purchasable types under Consumable & Packaging ──');
  const { grn: ink } = await makeGrn({ tag: 'INV-INK', lines: [['E2E-INK', 5, '']], inventoryType: 'CONSUMABLE_PACKAGING' }, ctx);
  await grnService.complete(String(ink._id), {}, user);
  const inkMoves = await movesFor(ink._id);
  check('Ink (not in any IMS list) posts to MAIN exactly as before', inkMoves.length === 1 && inkMoves[0].warehouse === 'MAIN' && inkMoves[0].quantity === 5);
  console.log(`  INFO  Ink in C&P IMS list: ${(await onHandIn(imsService, 'E2E-INK')) === undefined ? 'not listed (C&P IMS shows Consumable / Packing / Packaging only)' : 'listed'}`);

  console.log('\n── Mismatched lines are refused before anything posts ──');
  const { grn: badRm } = await makeGrn({ tag: 'INV-BAD-RM', lines: [['E2E-COIL', 10, 'B-INV-BAD'], ['E2E-BOLT', 4, '']], inventoryType: 'RM', rm: { rmReceivedAtLocation: 'PLG01' } }, ctx);
  const e1 = await errOf(grnService.complete(String(badRm._id), {}, user));
  const badRmAfter = await GoodsReceiptNote.findById(badRm._id).lean();
  check('RM GRN with a bolt line → 400 naming the bolt', /^400 .*"E2E Bolt M8" is not Raw Material/.test(e1), e1);
  check('…nothing posted and the GRN is still an open draft (claim released)', (await movesFor(badRm._id)).length === 0 && badRmAfter.grnStatus === 'DRAFT' && !badRmAfter.stockPosted);
  const { grn: badCp } = await makeGrn({ tag: 'INV-BAD-CP', lines: [['E2E-COIL', 10, 'B-INV-BAD2']], inventoryType: 'CONSUMABLE_PACKAGING' }, ctx);
  const e2 = await errOf(grnService.complete(String(badCp._id), {}, user));
  check('C&P GRN with a coil → 400 naming the coil', /^400 .*"E2E Coil 1250mm" is not Consumable & Packaging/.test(e2), e2);
  check('…nothing posted', (await movesFor(badCp._id)).length === 0);
  const e3 = await errOf(grnService.update(String(badCp._id), { remarks: 'try again' }, user));
  check('saving the mismatched draft is refused too', /^400 .*not Consumable & Packaging/.test(e3), e3);

  console.log('\n── Mixed PO → separate GRNs (lines not received stay at 0) ──');
  const po = await VendorPurchaseOrder.create({
    poNumber: 'PO-E2E-INV-MIX', vendorId: ctx.vendorId, vendorName: 'E2E Vendor Pvt Ltd', indentId: new mongoose.Types.ObjectId(), poStatus: 'APPROVED',
    followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_NOT_REQUIRED', readyForGrnAt: new Date(), finalMaterialDate: new Date(),
    items: [
      { skuId: skus['E2E-COIL']._id, skuCode: 'E2E-COIL', itemName: skus['E2E-COIL'].name, unit: 'KGS', quantity: 100, receivedQty: 0, pendingQty: 100, rate: 90 },
      { skuId: skus['E2E-BOLT']._id, skuCode: 'E2E-BOLT', itemName: skus['E2E-BOLT'].name, unit: 'PCS', quantity: 30, receivedQty: 0, pendingQty: 30, rate: 5 },
    ],
  });
  const lineFor = (code, qty, batch = '') => {
    const p = po.items.find((i) => i.skuCode === code);
    return { poItemId: String(p._id), skuId: String(p.skuId), skuCode: code, itemName: p.itemName, unit: p.unit, receivedQty: qty, invoiceQty: qty, rate: p.rate, batchNo: batch };
  };
  const both = await errOf(grnService.create({ poId: String(po._id), inventoryType: 'RM', rmReceivedAtLocation: 'PLG01', items: [lineFor('E2E-COIL', 100, 'B-MIX'), lineFor('E2E-BOLT', 30)] }, user));
  check('creating an RM GRN that receives both kinds is refused with the split instruction', /^400 .*receive it on a separate GRN with Inventory Type "Consumable & Packaging"/.test(both), both);
  const g1 = await grnService.create({ poId: String(po._id), inventoryType: 'RM', rmReceivedAtLocation: 'PLG01', items: [lineFor('E2E-COIL', 100, 'B-MIX'), lineFor('E2E-BOLT', 0)] }, user);
  check('RM GRN receiving only the coil (bolt at 0) is created with its Inventory Type', g1.inventoryType === 'RM' && g1.rmReceivedAtLocation === 'PLG01');
  await grnService.complete(String(g1._id), {}, user);
  const g2 = await grnService.create({ poId: String(po._id), inventoryType: 'CONSUMABLE_PACKAGING', items: [lineFor('E2E-BOLT', 30)] }, user);
  check('C&P GRN for the bolt is created (Received At not stored)', g2.inventoryType === 'CONSUMABLE_PACKAGING' && g2.rmReceivedAtLocation === null);
  await grnService.complete(String(g2._id), {}, user);
  const m1 = await movesFor(g1._id); const m2 = await movesFor(g2._id);
  check('mixed PO: coil → PLG01 (RM IMS), bolt → MAIN (C&P IMS), one movement each',
    m1.length === 1 && m1[0].skuCode === 'E2E-COIL' && m1[0].warehouse === 'PLG01' && m2.length === 1 && m2[0].skuCode === 'E2E-BOLT' && m2[0].warehouse === 'MAIN',
    `${m1.map((m) => `${m.skuCode}@${m.warehouse}`)} | ${m2.map((m) => `${m.skuCode}@${m.warehouse}`)}`);
  const poAfter = await VendorPurchaseOrder.findById(po._id).lean();
  check('…and the PO is fully received across the two GRNs', poAfter.poStatus === 'FULLY_RECEIVED', poAfter.poStatus);

  console.log('\n── Changing the type on a draft, and historical GRNs ──');
  const { grn: sw } = await makeGrn({ tag: 'INV-SWITCH', lines: [['E2E-BOLT', 6, '']], inventoryType: 'RM', rm: { rmReceivedAtLocation: 'PLG01' } }, ctx);
  check('switching a draft to a type that does not fit is refused', /^400/.test(await errOf(grnService.update(String(sw._id), { inventoryType: 'RM', rmReceivedAtLocation: 'PLG01' }, user))));
  await grnService.update(String(sw._id), { inventoryType: 'CONSUMABLE_PACKAGING' }, user);
  const swDoc = await GoodsReceiptNote.findById(sw._id).lean();
  check('…switching to the right type saves it and clears the RM location', swDoc.inventoryType === 'CONSUMABLE_PACKAGING' && swDoc.rmReceivedAtLocation === null && swDoc.addToRmStock === false);
  const { grn: legacy } = await makeGrn({ tag: 'INV-LEGACY', lines: [['E2E-COIL', 70, 'B-INV-LEG']], rm: { addToRmStock: true, rmReceivedAtLocation: 'PLG01' } }, ctx);
  await grnService.complete(String(legacy._id), {}, user);
  const legDoc = await GoodsReceiptNote.findById(legacy._id).lean();
  const legMoves = await movesFor(legacy._id);
  check('a GRN raised before Inventory Type (checkbox ON) completes exactly as before (70 at PLG01)', legMoves.length === 1 && legMoves[0].warehouse === 'PLG01');
  check('…and is not given an Inventory Type it never had', legDoc.inventoryType === null && legDoc.addToRmStock === true);
  await reconcile();
  await finish();
};

const mode = process.argv[2];
const run = { '--seed': seed, '--verify': verify, '--race': race, '--stock': stock, '--invtype': invtype }[mode];
if (!run) { console.error('Usage: --seed | --verify | --race | --stock | --invtype'); process.exit(1); }
run().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => {}); process.exit(1); });
