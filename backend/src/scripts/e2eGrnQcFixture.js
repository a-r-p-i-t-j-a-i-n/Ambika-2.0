/**
 * Fixture + database oracle for the combined GRN + Incoming QC page.
 *
 *   node src/scripts/e2eGrnQcFixture.js --seed     fresh scratch DB + one GRN per QC state
 *   node src/scripts/e2eGrnQcFixture.js --verify   assert what the browser run left behind
 *   node src/scripts/e2eGrnQcFixture.js --race     service-level concurrency checks (no browser):
 *                                                  double create / complete, historical duplicates,
 *                                                  failed create + retry, MD signature gate,
 *                                                  invoice eligibility, service QC
 *   node src/scripts/e2eGrnQcFixture.js --stock    stock matrix (no browser): QC-gated GRNs post the
 *                                                  ACCEPTED qty at QC (MAIN / PLG01 / JW001, rework,
 *                                                  all-rejected, concurrency); LEGACY GRNs keep moving
 *                                                  the rejected qty out; balances + reconciliation
 *
 * Two kinds of GRN are seeded and kept apart on purpose:
 *   new workflow  completed through grnService.complete() — NO stock at completion;
 *                 the accepted qty posts when the MD-signed GRN's QC completes
 *   LEGACY        completed before QC-gated posting — every received unit was
 *                 posted as GRN_IN at completion (written here exactly as the
 *                 old code wrote it); its QC moves the rejected qty back out
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
const LEGACY_DATE = new Date('2026-09-01T06:00:00Z');

/**
 * One GRN per state the QC section must handle (browser run).
 *   state  DRAFT      a draft (new workflow when completed in the browser)
 *          COMPLETED  completed through grnService.complete() — no stock yet
 *          LEGACY     completed before QC-gated posting — stock posted at completion
 *   approval: GRN approvalStatus once completed · qc: seed a DRAFT / PASSED QC
 *   rm: Received At for coil lines · legacyRmOff: the old "Add to RM Stock" was OFF
 */
const GRNS = [
  { tag: 'FLOW',      state: 'DRAFT' },                                          // full journey in the browser
  { tag: 'DRAFT',     state: 'DRAFT' },                                          // complete the GRN first
  { tag: 'UNSIGNED',  state: 'COMPLETED', approval: 'READY_FOR_MD_APPROVAL' },   // waiting for MD
  { tag: 'NOREQ',     state: 'COMPLETED', approval: 'NOT_REQUIRED' },            // no approval raised
  { tag: 'READYFAIL', state: 'COMPLETED', approval: 'MD_APPROVED' },             // everything rejected → FAILED
  { tag: 'READYPASS', state: 'COMPLETED', approval: 'MD_APPROVED' },             // everything accepted → PASSED
  { tag: 'RESUME',    state: 'COMPLETED', approval: 'MD_APPROVED', qc: 'DRAFT' },        // draft QC exists
  // A draft QC from the earlier form (rework / defect / severity) — kept, re-split, never dropped.
  { tag: 'REWORK',    state: 'COMPLETED', approval: 'MD_APPROVED', qc: 'DRAFT_REWORK' },
  // Raw Material through the browser: its accepted coil is posted at PLG01 on QC.
  { tag: 'RMPLG',     state: 'DRAFT', lines: [['E2E-COIL', 500, 'B-RMPLG']], rm: 'PLG01' },
  // ── LEGACY GRNs (stock posted at completion, before QC-gated posting) ──
  { tag: 'DONE',      state: 'LEGACY', qc: 'PASSED' },                           // QC already completed
  { tag: 'HIST',      state: 'LEGACY', qc: 'PARTIAL_REWORK' },                   // earlier rework / defect record
  { tag: 'LEGACY',    state: 'LEGACY' },                                         // QC still open: rejections move OUT
  // Completed with the old "Add to RM Stock" OFF: the coil was never stocked — QC moves nothing.
  { tag: 'RMOFF',     state: 'LEGACY', lines: [['E2E-COIL', 600, 'B-RMOFF']], legacyRmOff: true },
];

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== 'ambika_e2e_grnqc') throw new Error('Connected to an unexpected database — aborting.');
};

const services = async () => ({
  grnService: (await import('../modules/procurement/grn/grn.service.js')).grnService,
  incomingQcService: (await import('../modules/procurement/incoming-qc/incomingQc.service.js')).incomingQcService,
  vendorInvoiceService: (await import('../modules/procurement/vendor-invoice/vendorInvoice.service.js')).vendorInvoiceService,
  inventoryService: (await import('../modules/inventory/inventory.service.js')).inventoryService,
});

/**
 * PO + GRN.
 *   DRAFT / COMPLETED — a draft; COMPLETED runs the real grnService.complete()
 *     (no stock) and then stands in for the MD signature on the mirror field.
 *   LEGACY — the GRN as the previous code left it after completion: completed,
 *     stockPosted, no posting stage, one GRN_IN per stocked line written at
 *     completion (RM lines skipped when the old opt-in was OFF).
 */
const makeGrn = async ({ tag, lines = BOLT_NUT, rm = null, state = 'DRAFT', approval = 'MD_APPROVED', legacyRmOff = false }, ctx) => {
  const { skus, vendorId, user, grnService, inventoryService } = ctx;
  const legacy = state === 'LEGACY';
  const po = await VendorPurchaseOrder.create({
    poNumber: `PO-E2E-${tag}`, vendorId, vendorName: 'E2E Vendor Pvt Ltd',
    indentId: new mongoose.Types.ObjectId(), poStatus: legacy ? 'FULLY_RECEIVED' : 'APPROVED',
    items: lines.map(([code, qty]) => ({
      skuId: skus[code]._id, skuCode: code, itemName: skus[code].name, unit: skus[code].unit,
      quantity: qty, receivedQty: legacy ? qty : 0, pendingQty: legacy ? 0 : qty, rate: 100, gstRate: 18,
    })),
  });
  let grn = await GoodsReceiptNote.create({
    grnNumber: `GRN-E2E-${tag}`, poId: po._id, poNumber: po.poNumber, poIds: [po._id], poNumbers: [po.poNumber],
    vendorId, vendorName: 'E2E Vendor Pvt Ltd', warehouse: 'MAIN',
    rmReceivedAtLocation: rm || (legacy && !legacyRmOff && lines.some(([c]) => skus[c].itemType === 'RAW_MATERIAL') ? 'PLG01' : null),
    ...(legacy ? {
      grnStatus: GRN_STATUS.FULLY_RECEIVED, stockPosted: true, approvalStatus: 'MD_APPROVED', qcStatus: 'PENDING',
      addToRmStock: !legacyRmOff, completedAt: LEGACY_DATE, grnDate: LEGACY_DATE,
    } : { grnStatus: GRN_STATUS.DRAFT, stockPosted: false }),
    items: po.items.map((p, i) => ({
      poItemId: p._id, poId: po._id, poNumber: po.poNumber, skuId: p.skuId, skuCode: p.skuCode, itemName: p.itemName, unit: p.unit,
      orderedQty: p.quantity, receivedQty: p.quantity, invoiceQty: p.quantity, rate: p.rate, batchNo: lines[i][2] || '',
    })),
    totalReceivedQty: lines.reduce((t, l) => t + l[1], 0),
  });
  if (legacy) {
    for (const line of grn.items) {
      const isRm = skus[line.skuCode].itemType === 'RAW_MATERIAL';
      if (isRm && legacyRmOff) continue;
      const { movement } = await inventoryService.increaseStock({
        skuId: line.skuId, skuCode: line.skuCode, skuName: line.itemName, unit: line.unit,
        warehouse: isRm ? grn.rmReceivedAtLocation : 'MAIN', quantity: line.receivedQty, unitCost: line.rate,
        txnType: 'GRN_IN', sourceModule: 'PURCHASE_FMS', refType: 'GRN', refId: grn._id, refNumber: grn.grnNumber,
        batchNo: line.batchNo, poId: po._id, poNumber: po.poNumber, movementDate: LEGACY_DATE,
        remarks: 'Stock added from Purchase GRN', performedBy: user,
      });
      line.movementId = movement._id; line.movementNumber = movement.movementNumber;
    }
    await grn.save();
  } else if (state === 'COMPLETED') {
    await grnService.complete(String(grn._id), {}, user);
    // Stand-in for the MD's signature (the browser run signs for real); the QC
    // gate reads only this mirror field.
    await GoodsReceiptNote.updateOne({ _id: grn._id }, { $set: { approvalStatus: approval } });
  }
  grn = await GoodsReceiptNote.findById(grn._id).lean();
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
    stockPosted: done, completedAt: done ? LEGACY_DATE : null,
    checkedByName: 'Seeded Inspector', remarks: done ? 'Seeded completed QC' : 'Seeded draft — resume me',
    items,
    totalReceived: items.reduce((s, x) => s + x.receivedQty, 0),
    totalAccepted: items.reduce((s, x) => s + x.acceptedQty, 0),
    totalRejected: items.reduce((s, x) => s + x.rejectedQty, 0),
    totalRework: items.reduce((s, x) => s + x.reworkQty, 0),
  });
  if (done) {
    await GoodsReceiptNote.updateOne({ _id: grn._id }, { $set: { qcStatus: status[0], qcId: doc._id, qcNumber: doc.qcNumber, qcCompletedAt: LEGACY_DATE } });
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
    const { grn } = await makeGrn(g, ctx);
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
  // …and one with a coil, raised through the form: Received At is asked for automatically.
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
  const grnIns = await InventoryMovement.find({ refType: 'GRN', refId: grn._id, txnType: 'GRN_IN' }).sort('createdAt').lean();
  return { grn, qcs, rejectMovs, grnIns };
};
const ins = (s) => s.grnIns.map((m) => `${m.skuCode}:${m.quantity}@${m.warehouse}${m.batchNo ? `/${m.batchNo}` : ''}`).sort().join(',');
/** Every posted movement is dated at its QC's completion — not the GRN date. */
const datedAtQc = (s) => s.qcs.length === 1 && s.grnIns.every((m) => Math.abs(new Date(m.movementDate) - new Date(s.qcs[0].completedAt)) < 5);

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
  console.log('\n── New workflow: stock posts at QC, accepted qty only ──');

  const flow = await grnState('FLOW');
  check('FLOW: completed, MD-signed and QC-gated in the browser', flow.grn.stockPostingStage === 'QC_COMPLETION' && flow.grn.approvalStatus === 'MD_APPROVED',
    `${flow.grn.stockPostingStage} · ${flow.grn.approvalStatus}`);
  check('FLOW: exactly one QC, PARTIAL, mirrored on the GRN', flow.qcs.length === 1 && flow.qcs[0].qcStatus === 'PARTIAL' && flow.grn.qcStatus === 'PARTIAL');
  check('FLOW: only the ACCEPTED qty became stock — bolt 7 (3 rejected), nut 5, at MAIN', ins(flow) === 'E2E-BOLT:7@MAIN,E2E-NUT:5@MAIN', ins(flow));
  check('FLOW: …dated at QC completion', datedAtQc(flow));
  check('FLOW: rejected qty never entered stock (no QC_REJECT_OUT)', flow.rejectMovs.length === 0);
  const fq = flow.qcs[0] || {};
  check('FLOW: per-line remark stored in qcRemarks', fq.items?.[0]?.qcRemarks === 'Seal damaged on 3', fq.items?.[0]?.qcRemarks);
  check('FLOW: QC report / photo stored on the existing qcReportDocument', /qc-photo\.png/.test(fq.qcReportDocument?.fileName || '') && Boolean(fq.qcReportDocument?.fileUrl),
    fq.qcReportDocument?.fileName);
  check('FLOW: new QC carries no rework (two-way split)', (fq.items || []).every((it) => it.reworkQty === 0) && fq.totalRework === 0);
  check('FLOW: QC lines carry their stock-in movement number', (fq.items || []).every((it) => /MOV-/.test(it.stockInMovementNumber || '')));

  const rw = await grnState('REWORK');
  const rq = rw.qcs[0] || {};
  check('REWORK: the seeded draft was completed (no second QC), PARTIAL', rw.qcs.length === 1 && rq.qcStatus === 'PARTIAL', `${rw.qcs.length} · ${rq.qcStatus}`);
  check('REWORK: rework re-split by the user → 6 accepted / 4 rejected / 0 rework', rq.items?.[0]?.acceptedQty === 6 && rq.items?.[0]?.rejectedQty === 4 && rq.items?.[0]?.reworkQty === 0);
  check('REWORK: earlier defect "scratch" / MAJOR kept on the record', rq.items?.[0]?.defectType === 'scratch' && rq.items?.[0]?.defectSeverity === 'MAJOR');
  check('REWORK: posted bolt 6 + nut 5; the 4 rejected never in stock', ins(rw) === 'E2E-BOLT:6@MAIN,E2E-NUT:5@MAIN' && rw.rejectMovs.length === 0, ins(rw));

  const fail = await grnState('READYFAIL');
  check('READYFAIL: one QC, FAILED — and NOTHING posted (no GRN_IN, no stock-out)', fail.qcs.length === 1 && fail.qcs[0].qcStatus === 'FAILED'
    && fail.grnIns.length === 0 && fail.rejectMovs.length === 0, ins(fail));
  check('READYFAIL: lines recorded NOT_POSTED', fail.grn.items.every((l) => l.stockStatus === 'NOT_POSTED'));
  const pass = await grnState('READYPASS');
  check('READYPASS: one QC, PASSED, everything posted (bolt 10, nut 5)', pass.qcs.length === 1 && pass.qcs[0].qcStatus === 'PASSED' && ins(pass) === 'E2E-BOLT:10@MAIN,E2E-NUT:5@MAIN', ins(pass));
  const resume = await grnState('RESUME');
  check('RESUME: the seeded draft was resumed — still one QC, PARTIAL, bolt 8 + nut 5 posted', resume.qcs.length === 1 && resume.qcs[0].qcNumber === 'QC-E2E-RESUME'
    && resume.qcs[0].qcStatus === 'PARTIAL' && ins(resume) === 'E2E-BOLT:8@MAIN,E2E-NUT:5@MAIN', ins(resume));

  const coil = await SKU.findOne({ code: 'E2E-COIL' }).lean();
  const plg = await grnState('RMPLG');
  check('RMPLG: accepted coil (400 of 500) posted at PLG01 with its batch — the 100 rejected never in stock',
    ins(plg) === 'E2E-COIL:400@PLG01/B-RMPLG' && plg.rejectMovs.length === 0 && datedAtQc(plg), ins(plg));

  // Raised, completed, signed and QC'd entirely on the Create GRN form.
  const newGrn = await GoodsReceiptNote.findOne({ poNumber: 'PO-E2E-NEWGRN' }).lean();
  const newQcs = newGrn ? await IncomingQC.find({ grnId: newGrn._id }).lean() : [];
  const newIn = newGrn ? await InventoryMovement.find({ refType: 'GRN', refId: newGrn._id }).lean() : [];
  const newOut = newQcs.length ? await InventoryMovement.find({ refType: 'INCOMING_QC', refId: newQcs[0]._id }).lean() : [];
  check('NEWGRN: completed and MD-signed from the form, no manual Inventory Type', !!newGrn && newGrn.grnStatus === 'FULLY_RECEIVED' && newGrn.approvalStatus === 'MD_APPROVED'
    && newGrn.inventoryType === null && newGrn.stockPostingStage === 'QC_COMPLETION',
  newGrn ? `${newGrn.grnNumber} · ${newGrn.grnStatus} · ${newGrn.approvalStatus} · ${newGrn.inventoryType}` : 'not found');
  check('NEWGRN: PO received 8 at GRN completion', (await VendorPurchaseOrder.findOne({ poNumber: 'PO-E2E-NEWGRN' }).lean()).items[0].receivedQty === 8);
  check('NEWGRN: exactly one QC, PARTIAL, mirrored on the GRN', newQcs.length === 1 && newQcs[0].qcStatus === 'PARTIAL' && newGrn.qcStatus === 'PARTIAL',
    newQcs.map((q) => `${q.qcNumber}:${q.qcStatus}`).join(','));
  check('NEWGRN: ONE GRN_IN of the accepted 6 at MAIN (double-click did not duplicate it); no stock-out',
    newIn.length === 1 && newIn[0].quantity === 6 && newIn[0].warehouse === 'MAIN' && newOut.length === 0,
    `${newIn.map((m) => `${m.quantity}@${m.warehouse}`)} · out ${newOut.length}`);
  const rmGrn = await GoodsReceiptNote.findOne({ poNumber: 'PO-E2E-NEWRM' }).lean();
  const rmIn = rmGrn ? await InventoryMovement.find({ refType: 'GRN', refId: rmGrn._id }).lean() : [];
  check('NEWRM: Received At JW001 chosen on the form, routed to RM IMS', rmGrn?.rmReceivedAtLocation === 'JW001' && rmGrn?.items?.[0]?.inventoryDestination === 'RM_IMS',
    rmGrn ? `${rmGrn.rmReceivedAtLocation} · ${rmGrn.items?.[0]?.inventoryDestination}` : 'not found');
  check('NEWRM: ONE GRN_IN of the accepted 45 at JW001, batch B-FORM-RM-1',
    rmIn.length === 1 && rmIn[0].quantity === 45 && rmIn[0].warehouse === 'JW001' && rmIn[0].batchNo === 'B-FORM-RM-1',
    rmIn.map((m) => `${m.quantity}@${m.warehouse}/${m.batchNo}`).join(','));

  for (const tag of ['UNSIGNED', 'NOREQ']) {
    const s = await grnState(tag);
    check(`${tag}: completed but not signed — no QC and NO stock`, s.qcs.length === 0 && s.grnIns.length === 0
      && s.grn.items.every((l) => l.stockStatus === 'AWAITING_QC'), `${s.qcs.length} QC · ${s.grnIns.length} GRN_IN`);
  }
  const draft = await grnState('DRAFT');
  check('DRAFT: still a draft — no QC, no stock', draft.grn.grnStatus === 'DRAFT' && draft.qcs.length === 0 && draft.grnIns.length === 0);

  console.log('\n── LEGACY GRNs (stock posted at completion) ──');
  const legacy = await grnState('LEGACY');
  check('LEGACY: QC completed in the browser — rejected 2 moved OUT of MAIN (legacy rule)', legacy.qcs[0]?.qcStatus === 'PARTIAL'
    && legacy.rejectMovs.length === 1 && legacy.rejectMovs[0].txnType === 'QC_REJECT_OUT' && legacy.rejectMovs[0].quantity === 2 && legacy.rejectMovs[0].warehouse === 'MAIN',
  legacy.rejectMovs.map((m) => `${m.txnType} ${m.quantity}@${m.warehouse}`).join(','));
  check('LEGACY: not reposted — still its two completion-time GRN_INs, dated at completion',
    legacy.grnIns.length === 2 && legacy.grnIns.every((m) => +new Date(m.movementDate) === +LEGACY_DATE) && !legacy.grn.stockPostingStage, ins(legacy));
  const off = await grnState('RMOFF');
  check('RMOFF: QC completed, but no stock-out for a coil never added to stock', off.qcs[0]?.qcStatus === 'PARTIAL' && off.rejectMovs.length === 0 && off.grnIns.length === 0,
    `${off.qcs[0]?.qcStatus} · ${off.rejectMovs.length} mov`);
  check('RMOFF: the QC timeline says why nothing moved', (off.qcs[0]?.activityTimeline || []).some((e) => e.action === 'STOCK_NOTE' && /never added/.test(e.description)));
  const hist = await grnState('HIST');
  const hq = hist.qcs[0] || {};
  check('HIST: historical completed QC untouched (rework 3, defect "dent" / MINOR)', hq.qcStatus === 'PARTIAL' && hq.items?.[0]?.reworkQty === 3
    && hq.items?.[0]?.defectType === 'dent' && hq.items?.[0]?.defectSeverity === 'MINOR' && hq.totalRework === 3);
  const done = await grnState('DONE');
  check('DONE: completed QC untouched, its completion-time GRN_INs unchanged', done.qcs.length === 1 && done.qcs[0].qcStatus === 'PASSED'
    && done.grnIns.length === 2 && done.grnIns.every((m) => +new Date(m.movementDate) === +LEGACY_DATE));

  const coilBal = await balances(coil._id);
  check('coil balances: PLG01 = 400 (RMPLG accepted), JW001 = 45 (NEWRM accepted), no MAIN row',
    coilBal.PLG01 === 400 && coilBal.JW001 === 45 && coilBal.MAIN === undefined, fmt(coilBal));
  const { rmImsService } = await import('../modules/inventory/rmIms.service.js');
  const coilRow = ((await rmImsService.getOverview({ search: 'E2E-COIL' })).docs || []).find((r) => r.skuCode === 'E2E-COIL');
  check('RM IMS overview shows the coil on hand = sum of its stock rows, nothing awaiting QC', coilRow && coilRow.onHand === 445 && coilRow.awaitingQc === 0,
    `${coilRow?.onHand} · awaiting ${coilRow?.awaitingQc}`);
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
  const signed = async (tag, lines) => (await makeGrn({ tag, lines, state: 'COMPLETED' }, ctx)).grn;
  const grnIns = (grnId) => InventoryMovement.find({ refType: 'GRN', refId: grnId, txnType: 'GRN_IN' }).lean();
  const sig = (movs) => movs.map((m) => `${m.skuCode}:${m.quantity}`).sort().join(',');

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
  check('the one draft is edited and completed (PARTIAL), accepted 8 + 5 posted', after1.qcStatus === 'PARTIAL' && after1.remarks === 'resumed'
    && sig(await grnIns(g1._id)) === 'E2E-BOLT:8,E2E-NUT:5');

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
  check('two duplicate drafts completed at once → only one completes', both.filter((b) => b.status === 'fulfilled').length === 1,
    both.map((b) => (b.status === 'fulfilled' ? 'ok' : b.reason.message)).join(' | '));
  check('…the accepted qty posted once (bolt 8, nut 5), the duplicate stays a draft', sig(await grnIns(g4._id)) === 'E2E-BOLT:8,E2E-NUT:5',
    sig(await grnIns(g4._id)));
  const leftover = await IncomingQC.findOne({ _id: { $in: [dupA._id, dupB._id] }, qcStatus: 'DRAFT' }).lean();
  const third = await errMsg(qcs.complete(String(leftover._id), {}, user));
  check('…completing the duplicate later is refused, records untouched', /^409 .*already has a completed QC/.test(third), third);

  console.log('\n── Simultaneous complete of one QC ──');
  const g5 = await signed('RACE-DONE');
  const d5 = await qcs.create({ grnId: String(g5._id), items: qcLines(g5, [[4, 0]]) }, user);
  const outs = await Promise.allSettled([1, 2, 3].map(() => qcs.complete(String(d5._id), {}, user)));
  check('three concurrent completes → one success, accepted posted once (bolt 6, nut 5)', outs.filter((o) => o.status === 'fulfilled').length === 1
    && sig(await grnIns(g5._id)) === 'E2E-BOLT:6,E2E-NUT:5',
  outs.filter((o) => o.status === 'rejected').map((o) => o.reason.message.slice(0, 60)).join(' | '));

  console.log('\n── MD signature is required at the moment stock is posted ──');
  const g6 = await signed('RACE-UNSIGN');
  const d6 = await qcs.create({ grnId: String(g6._id) }, user);
  await GoodsReceiptNote.updateOne({ _id: g6._id }, { $set: { approvalStatus: 'READY_FOR_MD_APPROVAL' } }); // signature withdrawn
  const unsigned = await errMsg(qcs.complete(String(d6._id), {}, user));
  check('a QC whose GRN is no longer MD-signed cannot complete', /^400 .*signed by the MD/.test(unsigned), unsigned);
  check('…nothing posted and the QC is still open', (await grnIns(g6._id)).length === 0 && ['DRAFT', 'IN_PROGRESS'].includes((await IncomingQC.findById(d6._id).lean()).qcStatus));

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

// ── --stock: what posts where, new workflow vs legacy (no browser) ─────────────
const stock = async () => {
  await connect();
  const ctx = await context();
  const { incomingQcService: qcs, user, skus } = ctx;
  const COIL = skus['E2E-COIL']._id;
  const BOLT = skus['E2E-BOLT']._id;
  const tally = (movs) => movs.map((m) => `${m.txnType} ${m.skuCode} ${m.quantity}@${m.warehouse}${m.batchNo ? `/${m.batchNo}` : ''}`).join(', ') || 'none';

  /**
   * Make a GRN (new workflow COMPLETED, or LEGACY), take balances, then a QC with
   * [rejected, rework] per line. Reports every movement the QC caused: GRN_IN
   * (new workflow) or QC_REJECT_OUT (legacy).
   */
  const scenario = async (label, { tag, lines, rm = null, state = 'COMPLETED', legacyRmOff = false, split, skuId }) => {
    console.log(`\n── ${label} ──`);
    const preGrn = await balances(skuId);
    const { grn } = await makeGrn({ tag, lines, rm, state, legacyRmOff }, ctx);
    const before = await balances(skuId);
    const qc = await qcs.create({ grnId: String(grn._id), items: qcLines(grn, split) }, user);
    await qcs.complete(String(qc._id), {}, user);
    const after = await balances(skuId);
    const movs = [
      ...await InventoryMovement.find({ refType: 'INCOMING_QC', refId: qc._id }).lean(),
      ...(state === 'LEGACY' ? [] : await InventoryMovement.find({ refType: 'GRN', refId: grn._id }).lean()),
    ];
    const done = await IncomingQC.findById(qc._id).lean();
    console.log(`  INFO  ${done.qcStatus} · pre-GRN ${fmt(preGrn)} → after GRN ${fmt(before)} → after QC ${fmt(after)} · ${tally(movs)}`);
    return { preGrn, before, after, movs, qc: done, grn };
  };
  const d = (a, b, w) => (b[w] || 0) - (a[w] || 0);

  console.log('\n════ NEW WORKFLOW — stock posts at QC, accepted qty only ════');
  const s1 = await scenario('Bolt at MAIN, 3 of 10 rejected', { tag: 'STK-MAIN', lines: [['E2E-BOLT', 10, '']], split: [[3, 0]], skuId: BOLT });
  check('MAIN: completing the GRN changed no balance', fmt(s1.preGrn) === fmt(s1.before));
  check('MAIN: QC posted ONE GRN_IN of the accepted 7 at MAIN — no QC_REJECT_OUT', s1.movs.length === 1 && s1.movs[0].txnType === 'GRN_IN' && s1.movs[0].quantity === 7 && s1.movs[0].warehouse === 'MAIN', tally(s1.movs));
  check('MAIN: balance +7', d(s1.before, s1.after, 'MAIN') === 7);

  const s2 = await scenario('Coil at PLG01 — 100 rejected, 50 rework of 500', {
    tag: 'STK-PLG', lines: [['E2E-COIL', 500, 'B-STK-PLG']], rm: 'PLG01', split: [[100, 50]], skuId: COIL,
  });
  check('PLG01: only the accepted 350 posted, with the coil batch', s2.movs.length === 1 && s2.movs[0].quantity === 350 && s2.movs[0].warehouse === 'PLG01' && s2.movs[0].batchNo === 'B-STK-PLG', tally(s2.movs));
  check('PLG01: rejected 100 and rework 50 never in stock (balance +350, no MAIN row)', d(s2.before, s2.after, 'PLG01') === 350 && s2.after.MAIN === undefined, fmt(s2.after));

  const s3 = await scenario('Coil at JW001 — all 400 rejected', { tag: 'STK-JW', lines: [['E2E-COIL', 400, 'B-STK-JW']], rm: 'JW001', split: [[400, 0]], skuId: COIL });
  check('JW001: FAILED, nothing posted, balance unchanged', s3.qc.qcStatus === 'FAILED' && s3.movs.length === 0 && d(s3.before, s3.after, 'JW001') === 0, tally(s3.movs));
  check('JW001: the GRN line is NOT_POSTED and its batch has no ledger rows', (await GoodsReceiptNote.findById(s3.grn._id).lean()).items[0].stockStatus === 'NOT_POSTED'
    && (await InventoryMovement.countDocuments({ batchNo: 'B-STK-JW' })) === 0);

  const s4 = await scenario('Accepted + rework only (nothing rejected), coil at PLG01', {
    tag: 'STK-REWORK', lines: [['E2E-COIL', 200, 'B-STK-RW']], rm: 'PLG01', split: [[0, 30]], skuId: COIL,
  });
  check('REWORK: 170 posted; the 30 rework is not usable stock', s4.movs.length === 1 && s4.movs[0].quantity === 170 && d(s4.before, s4.after, 'PLG01') === 170, tally(s4.movs));

  console.log('\n── Repeated / concurrent complete on an RM QC at PLG01 ──');
  const { grn: gc } = await makeGrn({ tag: 'STK-CONC', lines: [['E2E-COIL', 250, 'B-STK-CONC']], rm: 'PLG01', state: 'COMPLETED' }, ctx);
  const before = await balances(COIL);
  const qc = await qcs.create({ grnId: String(gc._id), items: qcLines(gc, [[25, 0]]) }, user);
  await Promise.allSettled([1, 2, 3].map(() => qcs.complete(String(qc._id), {}, user)));
  const retried = await errMsg(qcs.complete(String(qc._id), {}, user));
  const movs = await InventoryMovement.find({ refType: 'GRN', refId: gc._id }).lean();
  const after = await balances(COIL);
  check('three concurrent + one retry → one GRN_IN of 225 at PLG01', movs.length === 1 && movs[0].warehouse === 'PLG01' && movs[0].quantity === 225, `retry: ${retried}`);
  check('PLG01 balance moved by exactly +225', d(before, after, 'PLG01') === 225, `${before.PLG01} → ${after.PLG01}`);

  console.log('\n── Coil lineage sees only the accepted coil ──');
  const batchRows = await InventoryMovement.find({ batchNo: 'B-STK-PLG', skuId: COIL }).lean();
  const ledgerAvailable = batchRows.reduce((s, m) => s + (m.movementType === 'IN' ? m.quantity : -m.quantity), 0);
  check('coil B-STK-PLG: ledger available = accepted 350, all at PLG01, one GRN_IN', ledgerAvailable === 350 && batchRows.length === 1 && batchRows[0].warehouse === 'PLG01', `${ledgerAvailable}`);

  console.log('\n════ LEGACY — completed before QC-gated posting (stock posted at completion) ════');
  const l1 = await scenario('Legacy bolt at MAIN, 3 of 10 rejected', { tag: 'LEG-MAIN', state: 'LEGACY', lines: [['E2E-BOLT', 10, '']], split: [[3, 0]], skuId: BOLT });
  check('legacy MAIN: one QC_REJECT_OUT of 3 at MAIN, no new GRN_IN', l1.movs.length === 1 && l1.movs[0].txnType === 'QC_REJECT_OUT' && l1.movs[0].quantity === 3 && l1.movs[0].warehouse === 'MAIN', tally(l1.movs));
  check('legacy MAIN: the GRN had posted 10 at completion; QC moved −3', d(l1.preGrn, l1.before, 'MAIN') === 10 && d(l1.before, l1.after, 'MAIN') === -3);

  const l2 = await scenario('Legacy coil at PLG01 (opt-in ON) — 100 rejected, 50 rework of 500', {
    tag: 'LEG-PLG', state: 'LEGACY', lines: [['E2E-COIL', 500, 'B-LEG-PLG']], split: [[100, 50]], skuId: COIL,
  });
  check('legacy PLG01: rejection leaves PLG01 with the coil batch, rework stays (legacy rule)', l2.movs.length === 1 && l2.movs[0].txnType === 'QC_REJECT_OUT'
    && l2.movs[0].warehouse === 'PLG01' && l2.movs[0].batchNo === 'B-LEG-PLG' && l2.movs[0].quantity === 100 && d(l2.before, l2.after, 'PLG01') === -100, tally(l2.movs));

  const l3 = await scenario('Legacy coil with "Add to RM Stock" OFF — 200 of 600 rejected', {
    tag: 'LEG-OFF', state: 'LEGACY', lines: [['E2E-COIL', 600, 'B-LEG-OFF']], legacyRmOff: true, split: [[200, 0]], skuId: COIL,
  });
  check('legacy OFF: no stock-out — the coil was never added to stock', l3.movs.length === 0 && fmt(l3.before) === fmt(l3.after));
  check('legacy OFF: QC records why on its timeline', l3.qc.activityTimeline.some((e) => e.action === 'STOCK_NOTE' && /never added/.test(e.description)));

  const l4 = await scenario('Legacy mixed GRN: coil OFF + bolt at MAIN, both partly rejected', {
    tag: 'LEG-MIX', state: 'LEGACY', lines: [['E2E-COIL', 300, 'B-LEG-MIX'], ['E2E-BOLT', 20, '']], legacyRmOff: true, split: [[50, 0], [5, 0]], skuId: BOLT,
  });
  check('legacy MIX: only the posted bolt moves out (5 at MAIN)', l4.movs.length === 1 && l4.movs[0].skuCode === 'E2E-BOLT' && l4.movs[0].quantity === 5 && l4.movs[0].warehouse === 'MAIN', tally(l4.movs));
  const legacyIns = await InventoryMovement.countDocuments({ refType: 'GRN', refNumber: /^GRN-E2E-LEG-/, txnType: 'GRN_IN', movementDate: { $ne: LEGACY_DATE } });
  check('legacy GRNs were never reposted (every GRN_IN still dated at their completion)', legacyIns === 0, `${legacyIns} re-dated`);

  await reconcile();
  await finish();
};

const mode = process.argv[2];
// --invtype (the manual, one-per-GRN Inventory Type) was retired with that
// feature; per-line routing is covered by e2eQcGatedPostingFixture.js --api.
const run = { '--seed': seed, '--verify': verify, '--race': race, '--stock': stock }[mode];
if (!run) { console.error('Usage: --seed | --verify | --race | --stock'); process.exit(1); }
run().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => {}); process.exit(1); });
