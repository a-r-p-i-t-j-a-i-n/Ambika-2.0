/**
 * Database oracle for automatic SKU-based routing + QC-gated stock posting.
 *
 *   node src/scripts/e2eQcGatedPostingFixture.js --api        drop + seed + run every service-level scenario
 *   node src/scripts/e2eQcGatedPostingFixture.js --seed-ui    drop + seed for frontend/e2e/qcGatedGrn.e2e.mjs
 *   node src/scripts/e2eQcGatedPostingFixture.js --verify-ui  read what the browser run left behind
 *
 * Runs the REAL services (grnService, incomingQcService, IMS overviews, vendor
 * invoice eligibility) against a scratch database and checks the ledger after
 * every step: what posts, where, when, how often — and what never posts.
 *
 * Transactions need a replica set. Default target is a throwaway single-node
 * replica set on :27018 (see the run notes in the final report); override with
 * E2E_QC_URI. --api reports whether transactions were really in force, and the
 * atomic-rollback scenario is only meaningful when they are.
 *
 * SAFETY: the shared e2e guard runs before anything connects — localhost only,
 * database name must contain "e2e", S3 and email must be off. It never reads
 * MONGO_URI, so it cannot reach Atlas.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';
import { STOCK_IN_REASONS } from '../modules/inventory/ims.validation.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote from '../modules/procurement/grn/grn.model.js';
import IncomingQC from '../modules/procurement/incoming-qc/incomingQc.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';

const MODE = (process.argv.find((a) => a.startsWith('--')) || '--api').slice(2);
const DEFAULT_DB = MODE.endsWith('ui') ? 'ambika_e2e_qcgated_ui' : 'ambika_e2e_qcgated';
export const E2E_URI = process.env.E2E_QC_URI || `mongodb://127.0.0.1:27018/${DEFAULT_DB}?replicaSet=rsQcGated&directConnection=true`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eQcGatedPostingFixture.js');
export const E2E_USER = { email: 'e2e@test.local', password: 'E2e@12345', name: 'E2E Runner', role: 'MD' };

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const expectReject = async (name, promise, re) => {
  try {
    await promise;
    check(name, false, 'was accepted');
  } catch (e) {
    check(name, re.test(e.message), e.message.slice(0, 160));
  }
};
const section = (t) => console.log(`\n── ${t} ──`);

const SKUS = [
  { code: 'E2E-COIL', name: 'E2E Coil 1250mm', unit: 'KGS', itemType: 'RAW_MATERIAL', category: 'Coil' },
  { code: 'E2E-BRUSH', name: 'E2E Brush 5in', unit: 'PCS', itemType: 'CONSUMABLE', category: 'Brush' },
  { code: 'E2E-BOX', name: 'E2E Packing Box', unit: 'PCS', itemType: 'PACKING', category: 'Carton Box' },
  { code: 'E2E-INK', name: 'E2E Chemical Ink', unit: 'LTR', itemType: 'INK' },
  { code: 'E2E-SPARE', name: 'E2E Spare Bearing', unit: 'PCS', itemType: 'SPARE_PART' },
  { code: 'E2E-SVC', name: 'E2E Polishing Service', unit: 'Nos', itemType: 'SERVICE' },
  { code: 'E2E-JW', name: 'E2E Job Work Cutting', unit: 'Nos', itemType: 'JOB_WORK' },
  { code: 'E2E-JAR', name: 'E2E Mixer Jar (FG)', unit: 'PCS', itemType: 'FINISHED_GOOD' },
  { code: 'E2E-TAPE', name: 'E2E Packaging Tape', unit: 'PCS', itemType: 'PACKAGING' }, // legacy-only fixture
  // Used only by S20, so its Awaiting QC figures are exact.
  { code: 'E2E-AW-RM', name: 'E2E Awaiting Coil', unit: 'KGS', itemType: 'RAW_MATERIAL' },
  { code: 'E2E-AW-CP', name: 'E2E Awaiting Brush', unit: 'PCS', itemType: 'CONSUMABLE' },
  // A mapped coil + one of its approved circles, so a real Cut Coils round can run at JW001.
  { code: 'JSL204-08', name: 'Cu 0.80 mm', unit: 'KGS', itemType: 'RAW_MATERIAL', category: 'Coil' },
  { code: 'JSL204-08-850', name: 'Cu - 0.8mm - 8.50"', unit: 'PCS', itemType: 'CIRCLE', category: 'Circles' },
];

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (!/e2e/i.test(mongoose.connection.name)) throw new Error('Connected to an unexpected database — aborting.');
};

const services = async () => ({
  grnService: (await import('../modules/procurement/grn/grn.service.js')).grnService,
  incomingQcService: (await import('../modules/procurement/incoming-qc/incomingQc.service.js')).incomingQcService,
  vendorInvoiceService: (await import('../modules/procurement/vendor-invoice/vendorInvoice.service.js')).vendorInvoiceService,
  inventoryService: (await import('../modules/inventory/inventory.service.js')).inventoryService,
  awaitingQcBySku: (await import('../modules/inventory/awaitingQc.service.js')).awaitingQcBySku,
  rmImsService: (await import('../modules/inventory/rmIms.service.js')).rmImsService,
  imsService: (await import('../modules/inventory/ims.service.js')).imsService,
  assertPurchasable: (await import('../modules/procurement/purchase-item-guard.js')).assertPurchasable,
});

/** Drop the scratch DB and load the master data every mode shares. */
const seedBase = async () => {
  await mongoose.connection.dropDatabase();
  await User.create({ ...E2E_USER, mobile: '9000000001', isActive: true, roles: ['MD'] });
  for (const s of SKUS) await SKU.create(s);
  // An itemType the enum does not know (data imported around the model) — the
  // router must refuse it, never guess. Written straight to the collection.
  await SKU.collection.insertOne({
    code: 'E2E-ODD', name: 'E2E Unclassified Gadget', itemType: 'GADGET', unit: 'PCS',
    isDeleted: false, isActive: true, createdAt: new Date(), updatedAt: new Date(),
  });
  // Each collection the transactions write to must exist before a transaction
  // runs (MongoDB cannot create a collection inside one on older servers).
  for (const m of [InventoryMovement, InventoryStock, GoodsReceiptNote, IncomingQC, VendorPurchaseOrder]) {
    await m.createCollection().catch(() => {});
  }
};

const ctxLoad = async () => ({
  user: await User.findOne({ email: E2E_USER.email }).lean(),
  sku: Object.fromEntries((await SKU.find({}).lean()).map((s) => [s.code, s])),
  vendorId: new mongoose.Types.ObjectId('6ac09965f1c61c40fa20aa01'),
});

/** A PO that is eligible for a GRN (READY_FOR_GRN, PI not required, material date set). */
const mkPo = async (ctx, tag, lines, extra = {}) => VendorPurchaseOrder.create({
  poNumber: `PO-QG-${tag}`, vendorId: ctx.vendorId, vendorName: 'E2E Vendor Pvt Ltd',
  indentId: new mongoose.Types.ObjectId(), poStatus: 'RELEASED_TO_VENDOR', approvalStatus: 'APPROVED',
  followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_NOT_REQUIRED', readyForGrnAt: new Date(), finalMaterialDate: new Date(),
  items: lines.map(([code, qty, rate = 100]) => ({
    skuId: ctx.sku[code]._id, skuCode: code, itemName: ctx.sku[code].name, unit: ctx.sku[code].unit,
    quantity: qty, receivedQty: 0, pendingQty: qty, rate, gstRate: 18,
  })),
  ...extra,
});

/** GRN items for create(): `{ code: [receivedQty, batchNo] }` against the PO's lines; codes not named are 0. */
const grnItems = (po, recv) => po.items.map((p) => {
  const [qty = 0, batchNo = ''] = recv[p.skuCode] || [];
  return { poItemId: String(p._id), itemName: p.itemName, skuCode: p.skuCode, invoiceQty: qty, receivedQty: qty, batchNo };
});

const sign = (grnId) => GoodsReceiptNote.updateOne({ _id: grnId }, { $set: { approvalStatus: 'MD_APPROVED' } });
const movementsOf = (grnId) => InventoryMovement.find({ refType: 'GRN', refId: grnId }).sort('createdAt').lean();
const onHand = async (code, warehouse, ctx) => r2((await InventoryStock.findOne({ skuId: ctx.sku[code]._id, warehouse }).lean())?.qtyOnHand || 0);
const lineOf = (grn, code) => grn.items.find((l) => l.skuCode === code);
const qcLinesFor = (qc, split) => qc.items.map((it) => {
  const [accepted, rejected = 0, rework = 0] = split[it.skuCode] || [it.receivedQty, 0, 0];
  return { grnItemId: String(it.grnItemId), itemName: it.itemName, receivedQty: it.receivedQty, acceptedQty: accepted, rejectedQty: rejected, reworkQty: rework };
});
const txnsInForce = async () => {
  try { const h = await mongoose.connection.db.admin().command({ hello: 1 }); return Boolean(h.setName); } catch { return false; }
};

/** Ledger reconciliation: every stock row equals the sum of its movements. */
const reconcile = async () => {
  const rows = await InventoryStock.find({}).lean();
  const sums = new Map((await InventoryMovement.aggregate([
    { $group: { _id: { s: '$skuId', w: '$warehouse' }, q: { $sum: '$qtyDelta' } } },
  ])).map((r) => [`${r._id.s}|${r._id.w}`, r2(r.q)]));
  const bad = rows.filter((r) => r2(r.qtyOnHand) !== (sums.get(`${r.skuId}|${r.warehouse}`) || 0));
  return { rows: rows.length, bad: bad.map((r) => `${r.skuCode}@${r.warehouse} ${r.qtyOnHand}≠${sums.get(`${r.skuId}|${r.warehouse}`)}`) };
};

/** A GRN as the PREVIOUS code completed it: no posting stage, every line posted as GRN_IN at completion. */
const mkLegacyGrn = async (ctx, svc, tag, lines, { addToRmStock = true, rmLocation = null, qcDone = false } = {}) => {
  const po = await mkPo(ctx, tag, lines.map(([code, qty]) => [code, qty]));
  const grn = await GoodsReceiptNote.create({
    grnNumber: `GRN-QG-${tag}`, poId: po._id, poNumber: po.poNumber, poIds: [po._id], poNumbers: [po.poNumber],
    vendorId: ctx.vendorId, vendorName: 'E2E Vendor Pvt Ltd', warehouse: 'MAIN',
    grnStatus: 'FULLY_RECEIVED', qcStatus: qcDone ? 'PASSED' : 'PENDING', stockPosted: true, approvalStatus: 'MD_APPROVED',
    addToRmStock, rmReceivedAtLocation: rmLocation, inventoryType: null, completedAt: new Date('2026-09-01'),
    items: po.items.map((p, i) => ({
      poItemId: p._id, poId: po._id, poNumber: po.poNumber, skuId: p.skuId, skuCode: p.skuCode, itemName: p.itemName,
      unit: p.unit, orderedQty: p.quantity, receivedQty: p.quantity, invoiceQty: p.quantity, rate: p.rate, batchNo: lines[i][2] || '',
    })),
    totalReceivedQty: lines.reduce((t, l) => t + l[1], 0),
  });
  for (const line of grn.items) {
    const isRm = ['RAW_MATERIAL', 'CIRCLE'].includes(ctx.sku[line.skuCode].itemType);
    if (isRm && !addToRmStock) continue; // the old opt-out: RM line received, never stocked
    const { movement } = await svc.inventoryService.increaseStock({
      skuId: line.skuId, skuCode: line.skuCode, skuName: line.itemName, unit: line.unit,
      warehouse: isRm ? rmLocation : 'MAIN', quantity: line.receivedQty, unitCost: line.rate,
      txnType: 'GRN_IN', sourceModule: 'PURCHASE_FMS', refType: 'GRN', refId: grn._id, refNumber: grn.grnNumber,
      batchNo: line.batchNo, poId: po._id, poNumber: po.poNumber, movementDate: new Date('2026-09-01'),
    });
    line.movementId = movement._id; line.movementNumber = movement.movementNumber;
  }
  await grn.save();
  await VendorPurchaseOrder.updateOne({ _id: po._id }, { $set: { poStatus: 'FULLY_RECEIVED', 'items.$[].pendingQty': 0 } });
  return { grn: await GoodsReceiptNote.findById(grn._id).lean(), po };
};

// ═════════════════════════════════════════════════════════════════════════════
const runApi = async () => {
  await connect();
  await seedBase();
  const ctx = await ctxLoad();
  const svc = await services();
  const { grnService: G, incomingQcService: Q } = svc;
  const user = ctx.user;
  const txns = await txnsInForce();
  console.log(`\n[qc-gated] database ${mongoose.connection.name} · transactions ${txns ? 'IN FORCE (replica set)' : 'NOT available (standalone)'}`);

  // A legacy GRN that is fully done (QC passed) — must be byte-for-byte untouched by everything below.
  const legacyDone = await mkLegacyGrn(ctx, svc, 'LEGACY-DONE', [['E2E-TAPE', 7]], { qcDone: true });
  const legacyDoneBefore = JSON.stringify(await movementsOf(legacyDone.grn._id));
  const legacyDoneGrnBefore = JSON.stringify(await GoodsReceiptNote.findById(legacyDone.grn._id).lean());

  // ── S1 mixed PO, partial receipt, full QC-gated lifecycle ──────────────────
  section('S1 mixed PO: RM + consumable + packing + ink + spare, partial receipt');
  const po1 = await mkPo(ctx, 'MIX', [['E2E-COIL', 1000, 90], ['E2E-BRUSH', 50, 20], ['E2E-BOX', 200, 5], ['E2E-INK', 10, 300], ['E2E-SPARE', 5, 150]]);
  const recv1 = { 'E2E-COIL': [600, 'C-MIX-1'], 'E2E-BRUSH': [50], 'E2E-INK': [10], 'E2E-SPARE': [5] };
  await expectReject('RM line without Received At is refused at save',
    G.create({ poId: String(po1._id), items: grnItems(po1, recv1) }, user), /Received At is required — "E2E Coil 1250mm" is Raw Material/);
  await expectReject('a retired manual Inventory Type cannot force RM into C&P (it is ignored; Received At still required)',
    G.create({ poId: String(po1._id), inventoryType: 'CONSUMABLE_PACKAGING', items: grnItems(po1, recv1) }, user), /Received At is required/);
  const g1 = await G.create({ poId: String(po1._id), rmReceivedAtLocation: 'JW001', items: grnItems(po1, recv1) }, user);
  check('mixed GRN saved as one draft (no separate GRN per type)', g1.grnStatus === 'DRAFT' && g1.inventoryType === null);
  check('draft lines show their server-derived destination',
    lineOf(g1, 'E2E-COIL').inventoryDestination === 'RM_IMS' && lineOf(g1, 'E2E-COIL').stockWarehouse === 'JW001'
    && lineOf(g1, 'E2E-BRUSH').inventoryDestination === 'CP_IMS' && lineOf(g1, 'E2E-BRUSH').stockWarehouse === 'MAIN'
    && lineOf(g1, 'E2E-INK').inventoryDestination === 'MAIN_STORE' && lineOf(g1, 'E2E-SPARE').inventoryDestination === 'MAIN_STORE'
    && lineOf(g1, 'E2E-BOX').inventoryDestination === null, 'box receives 0 → no destination');

  const movBefore = await InventoryMovement.countDocuments();
  const completed1 = await G.complete(String(g1._id), {}, user);
  check('Complete GRN posts NO stock movement', (await InventoryMovement.countDocuments()) === movBefore);
  check('…and marks the GRN QC-gated, every received line AWAITING_QC',
    completed1.stockPostingStage === 'QC_COMPLETION' && completed1.stockPosted === true
    && completed1.items.filter((l) => l.receivedQty > 0).every((l) => l.stockStatus === 'AWAITING_QC'));
  check('…completion summary says nothing was posted', completed1.$locals.rmSummary.rmPostedCount === 0
    && completed1.$locals.rmSummary.awaitingQcLineCount === 4, JSON.stringify(completed1.$locals.rmSummary.destinations));
  const po1After = await VendorPurchaseOrder.findById(po1._id).lean();
  const coilPoLine = po1After.items.find((i) => i.skuCode === 'E2E-COIL');
  check('PO quantities roll at GRN completion (coil received 600, pending 400) → PARTIAL_RECEIVED',
    coilPoLine.receivedQty === 600 && coilPoLine.pendingQty === 400 && po1After.poStatus === 'PARTIAL_RECEIVED');

  const aw = await svc.awaitingQcBySku([ctx.sku['E2E-COIL']._id, ctx.sku['E2E-BRUSH']._id]);
  check('Awaiting QC: coil 600, brush 50', aw.get(String(ctx.sku['E2E-COIL']._id))?.qty === 600 && aw.get(String(ctx.sku['E2E-BRUSH']._id))?.qty === 50);
  const rmRow = (await svc.rmImsService.getOverview({})).docs.find((r) => r.skuCode === 'E2E-COIL');
  check('RM IMS: on hand 0, in transit 400, awaiting QC 600 — nothing counted twice, nothing lost',
    rmRow.onHand === 0 && rmRow.inTransit === 400 && rmRow.awaitingQc === 600, `onHand ${rmRow.onHand} inTransit ${rmRow.inTransit} awaiting ${rmRow.awaitingQc}`);
  check('RM IMS: projected available = on hand + in transit + awaiting QC − booked', rmRow.projectedAvailable === r2(rmRow.onHand + rmRow.inTransit + rmRow.awaitingQc - rmRow.booked));
  const cpRow = (await svc.imsService.getOverview({})).docs.find((r) => r.skuCode === 'E2E-BRUSH');
  check('C&P IMS: brush on hand 0, awaiting QC 50', cpRow.onHand === 0 && cpRow.awaitingQc === 50 && cpRow.projectedAvailable === 50);

  await expectReject('QC cannot start before the MD signs', Q.create({ grnId: String(g1._id) }, user), /MD Approved/);
  await sign(g1._id);
  const qc1 = await Q.create({ grnId: String(g1._id) }, user);
  check('QC lines come from the GRN (4 received lines, default all accepted)', qc1.items.length === 4 && qc1.items.every((i) => i.acceptedQty === i.receivedQty));
  const forged = qcLinesFor(qc1, { 'E2E-COIL': [999] }).map((l) => (l.itemName.includes('Coil') ? { ...l, receivedQty: 999 } : l));
  const qc1f = await Q.update(String(qc1._id), { items: forged }, user);
  check('a forged received qty is re-anchored on the GRN (600, not 999)', qc1f.items.find((i) => i.skuCode === 'E2E-COIL').receivedQty === 600);
  await expectReject('a QC that leaves a received line uninspected is refused',
    Q.update(String(qc1._id), { items: qcLinesFor(qc1, {}).filter((l) => !l.itemName.includes('Brush')) }, user), /has not been inspected/);
  await Q.update(String(qc1._id), {
    items: qcLinesFor(qc1, { 'E2E-COIL': [550, 30, 20], 'E2E-BRUSH': [45, 5], 'E2E-INK': [10, 0], 'E2E-SPARE': [0, 5] }),
  }, user);

  const tBefore = Date.now();
  const qc1done = await Q.complete(String(qc1._id), {}, user);
  const mv1 = await movementsOf(g1._id);
  const byCode = Object.fromEntries(mv1.map((m) => [m.skuCode, m]));
  check('QC completion posts accepted qty only: coil 550, brush 45, ink 10 — spare (all rejected) nothing',
    mv1.length === 3 && byCode['E2E-COIL']?.quantity === 550 && byCode['E2E-BRUSH']?.quantity === 45 && byCode['E2E-INK']?.quantity === 10 && !byCode['E2E-SPARE'],
    mv1.map((m) => `${m.skuCode}:${m.quantity}@${m.warehouse}`).join(', '));
  check('…coil at its Received At (JW001) with its batch; brush and ink at MAIN',
    byCode['E2E-COIL']?.warehouse === 'JW001' && byCode['E2E-COIL']?.batchNo === 'C-MIX-1'
    && byCode['E2E-BRUSH']?.warehouse === 'MAIN' && byCode['E2E-INK']?.warehouse === 'MAIN');
  check('…as GRN_IN referencing the GRN (the RM IMS / Cut Coils contract)', mv1.every((m) => m.txnType === 'GRN_IN' && m.refType === 'GRN' && m.refNumber === g1.grnNumber));
  check('…dated at QC completion, not at GRN date',
    mv1.every((m) => Math.abs(new Date(m.movementDate) - new Date(qc1done.completedAt)) < 5 && new Date(m.movementDate).getTime() >= tBefore - 1000),
    `movementDate ${mv1[0]?.movementDate?.toISOString?.()} · qc.completedAt ${new Date(qc1done.completedAt).toISOString()}`);
  check('rejected and rework never touch stock (no QC_REJECT_OUT for a QC-gated GRN)',
    (await InventoryMovement.countDocuments({ refType: 'INCOMING_QC', refId: qc1._id })) === 0);
  check('balances: coil JW001 550, brush MAIN 45, ink MAIN 10, spare none',
    (await onHand('E2E-COIL', 'JW001', ctx)) === 550 && (await onHand('E2E-BRUSH', 'MAIN', ctx)) === 45
    && (await onHand('E2E-INK', 'MAIN', ctx)) === 10 && (await onHand('E2E-SPARE', 'MAIN', ctx)) === 0);
  const g1After = await GoodsReceiptNote.findById(g1._id).lean();
  check('GRN lines: POSTED with movement + qty; spare NOT_POSTED; GRN QC PARTIAL',
    lineOf(g1After, 'E2E-COIL').stockStatus === 'POSTED' && lineOf(g1After, 'E2E-COIL').postedQty === 550
    && String(lineOf(g1After, 'E2E-COIL').movementId) === String(byCode['E2E-COIL']._id)
    && lineOf(g1After, 'E2E-SPARE').stockStatus === 'NOT_POSTED' && !lineOf(g1After, 'E2E-SPARE').movementId
    && g1After.qcStatus === 'PARTIAL');
  check('QC lines carry the stock-in movement number', qc1done.items.find((i) => i.skuCode === 'E2E-COIL').stockInMovementNumber === byCode['E2E-COIL'].movementNumber);
  const aw2 = await svc.awaitingQcBySku([ctx.sku['E2E-COIL']._id]);
  check('Awaiting QC cleared once QC completed', !aw2.get(String(ctx.sku['E2E-COIL']._id)));
  const cpRows = (await svc.imsService.getOverview({})).docs;
  check('C&P IMS lists the brush (45) but not ink / spare — listing scope unchanged',
    cpRows.find((r) => r.skuCode === 'E2E-BRUSH')?.onHand === 45 && !cpRows.find((r) => ['E2E-INK', 'E2E-SPARE'].includes(r.skuCode)));
  const coils = await svc.rmImsService.listReceivedCoils({ grnOnly: true, limit: 50 });
  check('Cut Coils receipt list finds the QC-posted coil batch', (coils.docs || []).some((d) => (d.batchNo || '') === 'C-MIX-1'),
    (coils.docs || []).map((d) => d.batchNo).join(','));
  const inv = await svc.vendorInvoiceService.getInvoiceableQcs({});
  const invQc = inv.find((q) => String(q._id) === String(qc1._id));
  check('invoice eligibility unchanged: QC invoiceable on its accepted qty (550+45+10+0)', invQc?.totalAccepted === 605, `totalAccepted ${invQc?.totalAccepted}`);

  section('S1b second GRN for the remainder (coil 400 at PLG01 + box 200)');
  const po1b = await VendorPurchaseOrder.findById(po1._id);
  const g1b = await G.create({ poId: String(po1._id), rmReceivedAtLocation: 'PLG01', items: grnItems(po1b, { 'E2E-COIL': [400, 'C-MIX-2'], 'E2E-BOX': [200] }).filter((i) => i.receivedQty > 0) }, user);
  check('second GRN loads only what is pending (coil 400 / box 200)', lineOf(g1b, 'E2E-COIL').pendingBeforeGrn === 400 && lineOf(g1b, 'E2E-BOX').pendingBeforeGrn === 200);
  await G.complete(String(g1b._id), {}, user);
  check('PO now FULLY_RECEIVED', (await VendorPurchaseOrder.findById(po1._id).lean()).poStatus === 'FULLY_RECEIVED');
  await sign(g1b._id);
  const qc1b = await Q.create({ grnId: String(g1b._id) }, user);
  await Q.complete(String(qc1b._id), {}, user);
  check('remainder posted: coil PLG01 400, box MAIN 200; coil JW001 still 550',
    (await onHand('E2E-COIL', 'PLG01', ctx)) === 400 && (await onHand('E2E-BOX', 'MAIN', ctx)) === 200 && (await onHand('E2E-COIL', 'JW001', ctx)) === 550);

  // ── S2 refusals ─────────────────────────────────────────────────────────────
  section('S2 Service / Job Work / Finished Goods / unclassified are refused before anything moves');
  const po2 = await mkPo(ctx, 'BLOCK', [['E2E-BRUSH', 10], ['E2E-SVC', 1], ['E2E-JW', 1], ['E2E-ODD', 3]]);
  await expectReject('Service line refused on a material GRN', G.create({ poId: String(po2._id), items: grnItems(po2, { 'E2E-BRUSH': [10], 'E2E-SVC': [1] }) }, user), /"E2E Polishing Service" is Service \/ Job Work/);
  await expectReject('Job Work line refused on a material GRN', G.create({ poId: String(po2._id), items: grnItems(po2, { 'E2E-JW': [1] }) }, user), /Job Work, not material/);
  await expectReject('an itemType with no destination is refused, never guessed', G.create({ poId: String(po2._id), items: grnItems(po2, { 'E2E-ODD': [3] }) }, user), /classified as "GADGET"/);
  const g2 = await G.create({ poId: String(po2._id), items: grnItems(po2, { 'E2E-BRUSH': [10] }) }, user);
  check('the same PO is receivable once the service lines are at 0', g2.items.filter((l) => l.receivedQty > 0).length === 1);
  const poFg = await mkPo(ctx, 'FG', [['E2E-JAR', 5]]);
  await expectReject('Finished Goods stay blocked from vendor GRNs', G.create({ poId: String(poFg._id), items: grnItems(poFg, { 'E2E-JAR': [5] }) }, user), /Finished Goods cannot be processed/);
  // A draft that slipped a Service line in before the rule existed: completion refuses and hands it back.
  await GoodsReceiptNote.updateOne({ _id: g2._id, 'items.skuCode': 'E2E-SVC' }, { $set: { 'items.$.receivedQty': 1, 'items.$.invoiceQty': 1 } });
  const movB = await InventoryMovement.countDocuments();
  await expectReject('completion refuses a stale draft carrying a Service line', G.complete(String(g2._id), {}, user), /Service \/ Job Work/);
  const g2After = await GoodsReceiptNote.findById(g2._id).lean();
  const po2After = await VendorPurchaseOrder.findById(po2._id).lean();
  check('…and leaves it an editable draft with nothing posted and the PO untouched',
    g2After.grnStatus === 'DRAFT' && !g2After.stockPosted && (await InventoryMovement.countDocuments()) === movB && po2After.items.every((i) => !i.receivedQty));
  // RM draft that lost its Received At.
  const po2r = await mkPo(ctx, 'NOLOC', [['E2E-COIL', 50]]);
  const g2r = await G.create({ poId: String(po2r._id), rmReceivedAtLocation: 'PLG01', items: grnItems(po2r, { 'E2E-COIL': [50, 'C-NOLOC'] }) }, user);
  await GoodsReceiptNote.updateOne({ _id: g2r._id }, { $set: { rmReceivedAtLocation: null } });
  await expectReject('completion refuses Raw Material without Received At (no default location)', G.complete(String(g2r._id), {}, user), /Received At is required/);
  check('…claim released (still a draft)', (await GoodsReceiptNote.findById(g2r._id).lean()).stockPosted === false);
  const g2rDone = await G.complete(String(g2r._id), { rmReceivedAtLocation: 'jw001' }, user);
  check('…and completes once Received At is chosen at completion', g2rDone.rmReceivedAtLocation === 'JW001' && lineOf(g2rDone, 'E2E-COIL').stockWarehouse === 'JW001');

  // ── S3 duplicate GRN completion ─────────────────────────────────────────────
  section('S3 five simultaneous Complete GRN clicks');
  const po3 = await mkPo(ctx, 'DUPGRN', [['E2E-BRUSH', 30]]);
  const g3 = await G.create({ poId: String(po3._id), items: grnItems(po3, { 'E2E-BRUSH': [30] }) }, user);
  const r3 = await Promise.allSettled(Array.from({ length: 5 }, () => G.complete(String(g3._id), {}, user)));
  check('exactly one completes, four are refused', r3.filter((r) => r.status === 'fulfilled').length === 1,
    r3.filter((r) => r.status === 'rejected').map((r) => r.reason.message.slice(0, 50)).join(' | '));
  check('PO received exactly once (30, not 60+)', (await VendorPurchaseOrder.findById(po3._id).lean()).items[0].receivedQty === 30);

  // ── S4 duplicate QC completion ──────────────────────────────────────────────
  section('S4 five simultaneous Complete QC clicks');
  await sign(g3._id);
  const qc3 = await Q.create({ grnId: String(g3._id) }, user);
  const r4 = await Promise.allSettled(Array.from({ length: 5 }, () => Q.complete(String(qc3._id), {}, user)));
  check('exactly one QC completion succeeds', r4.filter((r) => r.status === 'fulfilled').length === 1,
    r4.filter((r) => r.status === 'rejected').map((r) => r.reason.message.slice(0, 50)).join(' | '));
  const mv3 = await movementsOf(g3._id);
  check('one movement, 30 in stock — never duplicated', mv3.length === 1 && mv3[0].quantity === 30 && (await onHand('E2E-BRUSH', 'MAIN', ctx)) === 45 + 30);

  // ── S5 a second QC on the same line ─────────────────────────────────────────
  section('S5 a stale second QC can never post the same line again');
  const po5 = await mkPo(ctx, 'DUPQC', [['E2E-BOX', 40]]);
  const g5 = await G.create({ poId: String(po5._id), items: grnItems(po5, { 'E2E-BOX': [40] }) }, user);
  await G.complete(String(g5._id), {}, user); await sign(g5._id);
  const qcA = await Q.create({ grnId: String(g5._id) }, user);
  const qcBdoc = (await IncomingQC.findById(qcA._id).lean());
  const qcB = await IncomingQC.create({ ...qcBdoc, _id: undefined, qcNumber: `${qcBdoc.qcNumber}-DUP`, items: qcBdoc.items.map(({ _id, ...i }) => i) });
  const r5 = await Promise.allSettled([Q.complete(String(qcA._id), {}, user), Q.complete(String(qcB._id), {}, user)]);
  check('two QCs of one single-PO GRN racing: one completes, the other is refused as a duplicate',
    r5.filter((r) => r.status === 'fulfilled').length === 1 && /duplicate|already/.test(r5.find((r) => r.status === 'rejected')?.reason?.message || ''),
    r5.find((r) => r.status === 'rejected')?.reason?.message?.slice(0, 90));
  check('…box posted once (40)', (await movementsOf(g5._id)).length === 1 && (await onHand('E2E-BOX', 'MAIN', ctx)) === 240);
  // Layer 2 alone: bypass the duplicate guard with a stale GRN snapshot taken before posting.
  const qcC = await IncomingQC.create({ ...qcBdoc, _id: undefined, qcNumber: `${qcBdoc.qcNumber}-STALE`, qcStatus: 'DRAFT', stockPosted: false, items: qcBdoc.items.map(({ _id, ...i }) => i) });
  const staleGrn = { ...(await GoodsReceiptNote.findById(g5._id).lean()) };
  staleGrn.items = staleGrn.items.map((l) => ({ ...l, stockStatus: 'AWAITING_QC', movementId: null }));
  const qcCdoc = await IncomingQC.findById(qcC._id);
  await expectReject('per-line claim refuses a line already posted, even past the duplicate guard',
    Q._completeGatedGrnQcLocked(qcCdoc, staleGrn, {}, user, { qcStatus: 'PASSED', overallResult: 'PASS' }), /already been posted to stock/);
  const qcCafter = await IncomingQC.findById(qcC._id).lean();
  check('…nothing posted for it and its claim released', (await movementsOf(g5._id)).length === 1 && qcCafter.stockPosted === false && qcCafter.qcStatus === 'DRAFT');

  // ── S6 multi-PO GRN ─────────────────────────────────────────────────────────
  section('S6 multi-PO GRN: one QC per PO, both complete (bug fix)');
  const po6a = await mkPo(ctx, 'MPO-A', [['E2E-BRUSH', 12]]);
  const po6b = await mkPo(ctx, 'MPO-B', [['E2E-COIL', 70]]);
  const g6 = await G.create({
    poIds: [String(po6a._id), String(po6b._id)], rmReceivedAtLocation: 'PLG01',
    items: [...grnItems(po6a, { 'E2E-BRUSH': [12] }), ...grnItems(po6b, { 'E2E-COIL': [70, 'C-MPO'] })],
  }, user);
  await G.complete(String(g6._id), {}, user); await sign(g6._id);
  const qc6a = await Q.create({ grnId: String(g6._id), poId: String(po6a._id) }, user);
  const qc6b = await Q.create({ grnId: String(g6._id), poId: String(po6b._id) }, user);
  check('each PO\'s QC inspects only its own lines', qc6a.items.length === 1 && qc6a.items[0].skuCode === 'E2E-BRUSH' && qc6b.items[0].skuCode === 'E2E-COIL');
  await Q.complete(String(qc6a._id), {}, user);
  let okB = true; let msgB = '';
  try { await Q.complete(String(qc6b._id), {}, user); } catch (e) { okB = false; msgB = e.message; }
  check('the second PO\'s QC completes after the first (was refused as a "duplicate" before the fix)', okB, msgB);
  const g6After = await GoodsReceiptNote.findById(g6._id).lean();
  check('both POs\' stock posted (brush MAIN +12, coil PLG01 +70) and GRN QC PASSED',
    (await movementsOf(g6._id)).length === 2 && g6After.qcStatus === 'PASSED');
  const dupB = await IncomingQC.create({ ...(await IncomingQC.findById(qc6b._id).lean()), _id: undefined, qcNumber: 'QC-DUP-6B', qcStatus: 'DRAFT', stockPosted: false, completedAt: null });
  await expectReject('a duplicate QC for the same PO is still refused', Q.complete(String(dupB._id), {}, user), /PO PO-QG-MPO-B already has a completed QC/);

  // ── S7 atomic rollback ──────────────────────────────────────────────────────
  section('S7 a failure mid-posting leaves nothing behind');
  const po7 = await mkPo(ctx, 'ATOMIC', [['E2E-BRUSH', 8], ['E2E-BOX', 9]]);
  const g7 = await G.create({ poId: String(po7._id), items: grnItems(po7, { 'E2E-BRUSH': [8], 'E2E-BOX': [9] }) }, user);
  await G.complete(String(g7._id), {}, user); await sign(g7._id);
  const qc7 = await Q.create({ grnId: String(g7._id) }, user);
  const brushBefore = await onHand('E2E-BRUSH', 'MAIN', ctx);
  const real = svc.inventoryService.increaseStock;
  let calls = 0;
  svc.inventoryService.increaseStock = async (...a) => { calls += 1; if (calls === 2) throw new Error('simulated failure on the 2nd line'); return real(...a); };
  // The same promise — "a failure mid-posting leaves nothing behind" — is kept
  // two different ways, because only one of them is available to each database.
  // WITH transactions the failure is injected into the second line and rolled
  // back. WITHOUT them there is nothing to roll back, so the posting is refused
  // before it starts (the harness's scratch-DB opt-out is cleared here, which
  // is how a real deployment is always configured) and the injected failure
  // never gets to write a first line. Either way the ledger is untouched.
  let saved7;
  if (!txns) { saved7 = process.env.INVENTORY_ALLOW_NON_ATOMIC; delete process.env.INVENTORY_ALLOW_NON_ATOMIC; }
  await expectReject(
    txns ? 'QC completion fails on the 2nd line' : 'standalone: the completion is refused before a single line is written',
    Q.complete(String(qc7._id), {}, user),
    txns ? /simulated failure/ : /written as one unit|replica set/,
  );
  if (!txns) process.env.INVENTORY_ALLOW_NON_ATOMIC = saved7;
  svc.inventoryService.increaseStock = real;
  const g7After = await GoodsReceiptNote.findById(g7._id).lean();
  const qc7After = await IncomingQC.findById(qc7._id).lean();
  check(`${txns ? 'rolled back' : 'never started'}: no movement, brush balance unchanged, lines still AWAITING_QC, QC still open`,
    (await movementsOf(g7._id)).length === 0 && (await onHand('E2E-BRUSH', 'MAIN', ctx)) === brushBefore
    && g7After.items.every((l) => l.stockStatus === 'AWAITING_QC' && !l.postedQcId) && !qc7After.stockPosted && ['DRAFT', 'IN_PROGRESS'].includes(qc7After.qcStatus));
  await Q.complete(String(qc7._id), {}, user);
  check('…and the corrected retry posts exactly once (brush +8, box +9)', (await movementsOf(g7._id)).length === 2 && (await onHand('E2E-BRUSH', 'MAIN', ctx)) === brushBefore + 8);

  // ── S8 legacy GRNs ──────────────────────────────────────────────────────────
  section('S8 legacy GRNs awaiting QC finish under the legacy rule');
  const leg = await mkLegacyGrn(ctx, svc, 'LEGACY-QC', [['E2E-BRUSH', 20], ['E2E-COIL', 300, 'C-LEG-OFF']], { addToRmStock: false });
  check('legacy GRN posted at completion (brush GRN_IN only; RM opted out)', (await movementsOf(leg.grn._id)).length === 1);
  const awLeg = await svc.awaitingQcBySku([ctx.sku['E2E-BRUSH']._id]);
  check('legacy stock is NOT counted as Awaiting QC (it is already on hand)', !(awLeg.get(String(ctx.sku['E2E-BRUSH']._id))?.grnNumbers || []).includes('GRN-QG-LEGACY-QC'));
  const qcL = await Q.create({ grnId: String(leg.grn._id) }, user);
  await Q.update(String(qcL._id), { items: qcLinesFor(qcL, { 'E2E-BRUSH': [17, 3], 'E2E-COIL': [290, 10] }) }, user);
  const brushB = await onHand('E2E-BRUSH', 'MAIN', ctx);
  await Q.complete(String(qcL._id), {}, user);
  const outs = await InventoryMovement.find({ refType: 'INCOMING_QC', refId: qcL._id }).lean();
  check('legacy QC: rejected 3 brush moved OUT of MAIN (QC_REJECT_OUT); the never-stocked coil moves nothing',
    outs.length === 1 && outs[0].txnType === 'QC_REJECT_OUT' && outs[0].quantity === 3 && outs[0].warehouse === 'MAIN' && (await onHand('E2E-BRUSH', 'MAIN', ctx)) === brushB - 3);
  check('legacy QC posts no new GRN_IN', (await movementsOf(leg.grn._id)).length === 1);
  check('legacy GRN keeps no posting stage', !(await GoodsReceiptNote.findById(leg.grn._id).lean()).stockPostingStage);
  check('a fully-done legacy GRN and its ledger rows are byte-for-byte unchanged',
    JSON.stringify(await movementsOf(legacyDone.grn._id)) === legacyDoneBefore
    && JSON.stringify(await GoodsReceiptNote.findById(legacyDone.grn._id).lean()) === legacyDoneGrnBefore);

  // ── S9 GRN without PO ───────────────────────────────────────────────────────
  section('S9 GRN without a PO follows the same routing');
  const g9 = await G.create({
    isWithoutPo: true, vendorId: String(ctx.vendorId), vendorName: 'Walk-in Supplier', rmReceivedAtLocation: 'PLG01',
    items: [
      { itemName: 'E2E Coil 1250mm', skuId: String(ctx.sku['E2E-COIL']._id), skuCode: 'E2E-COIL', receivedQty: 25, rate: 90, batchNo: 'C-WOPO' },
      { itemName: 'E2E Packing Box', skuId: String(ctx.sku['E2E-BOX']._id), skuCode: 'E2E-BOX', receivedQty: 15, rate: 5 },
    ],
  }, user);
  await G.complete(String(g9._id), {}, user); await sign(g9._id);
  const qc9 = await Q.create({ grnId: String(g9._id) }, user);
  await Q.complete(String(qc9._id), {}, user);
  const mv9 = await movementsOf(g9._id);
  check('W/O PO: coil → PLG01, box → MAIN, after QC', mv9.length === 2 && mv9.find((m) => m.skuCode === 'E2E-COIL').warehouse === 'PLG01' && mv9.find((m) => m.skuCode === 'E2E-BOX').warehouse === 'MAIN');

  // ── S10 open draft that still carries the retired manual Inventory Type ─────
  section('S10 a draft saved with the old manual Inventory Type');
  const po10 = await mkPo(ctx, 'OLDDRAFT', [['E2E-COIL', 60], ['E2E-BRUSH', 6]]);
  const g10 = await G.create({ poId: String(po10._id), rmReceivedAtLocation: 'JW001', items: grnItems(po10, { 'E2E-COIL': [60, 'C-OLD'], 'E2E-BRUSH': [6] }) }, user);
  await GoodsReceiptNote.updateOne({ _id: g10._id }, { $set: { inventoryType: 'CONSUMABLE_PACKAGING', addToRmStock: false } });
  const g10Done = await G.complete(String(g10._id), {}, user);
  check('old Inventory Type is ignored: coil routed to RM IMS at JW001, field cleared, timeline says so',
    lineOf(g10Done, 'E2E-COIL').inventoryDestination === 'RM_IMS' && g10Done.inventoryType === null && g10Done.addToRmStock === true
    && /manual Inventory Type "Consumable & Packaging" ignored/.test(g10Done.activityTimeline.at(-1).description));

  // ── S11 destination fixed at receipt ────────────────────────────────────────
  section('S11 reclassifying a SKU after GRN completion does not move its pending stock');
  const po11 = await mkPo(ctx, 'RECLASS', [['E2E-SPARE', 4]]);
  const g11 = await G.create({ poId: String(po11._id), items: grnItems(po11, { 'E2E-SPARE': [4] }) }, user);
  await G.complete(String(g11._id), {}, user); await sign(g11._id);
  await SKU.updateOne({ _id: ctx.sku['E2E-SPARE']._id }, { $set: { itemType: 'CONSUMABLE' } });
  const qc11 = await Q.create({ grnId: String(g11._id) }, user);
  await Q.complete(String(qc11._id), {}, user);
  const mv11 = await movementsOf(g11._id);
  check('posted to the warehouse fixed at receipt (MAIN), from the line\'s recorded destination', mv11.length === 1 && mv11[0].warehouse === 'MAIN'
    && lineOf(await GoodsReceiptNote.findById(g11._id).lean(), 'E2E-SPARE').inventoryDestination === 'MAIN_STORE');
  await SKU.updateOne({ _id: ctx.sku['E2E-SPARE']._id }, { $set: { itemType: 'SPARE_PART' } });

  // ── S12 Service QC + indents keep working ───────────────────────────────────
  section('S12 internal-service indent and Service QC are unaffected');
  let svcOk = true;
  try { await svc.assertPurchasable([{ skuId: ctx.sku['E2E-SVC']._id }, { skuId: ctx.sku['E2E-JW']._id }]); } catch { svcOk = false; }
  check('Service / Job Work SKUs still pass the shared purchase guard (indents, POs)', svcOk);
  const ind = await PurchaseIndent.create({
    indentNumber: 'IND-QG-SVC', requestType: 'INTERNAL_SERVICE', overallStatus: 'SERVICE_PENDING', raisedBy: 'E2E', department: 'Stores',
    items: [{ itemName: 'E2E Polishing Service', skuId: ctx.sku['E2E-SVC']._id, skuCode: 'E2E-SVC', unit: 'Nos', quantity: 1, approvedQuantity: 1 }],
  });
  const movS = await InventoryMovement.countDocuments();
  const sqc = await Q.create({ indentId: String(ind._id) }, user);
  const sdone = await Q.complete(String(sqc._id), { overallResult: 'PASS' }, user);
  check('Service QC completes PASS with no inventory movement', sdone.qcStatus === 'PASSED' && (await InventoryMovement.countDocuments()) === movS);

  // ── S14 replay safety: one record per action, wherever the work re-ran ─────
  section('S14 every completion recorded once (timelines, PO, QC)');
  const gatedGrns = await GoodsReceiptNote.find({ stockPostingStage: 'QC_COMPLETION' }).lean();
  const multiComplete = gatedGrns.filter((g) => g.activityTimeline.filter((t) => t.action === 'COMPLETE').length !== 1).map((g) => g.grnNumber);
  check('each QC-gated GRN has exactly one COMPLETE entry', multiComplete.length === 0, multiComplete.join(','));
  const doubled = [];
  for (const po of await VendorPurchaseOrder.find({}).lean()) {
    const seen = new Map();
    for (const t of po.activityTimeline.filter((x) => x.action === 'GRN_RECEIVED')) {
      const k = (t.description || '').split(' ')[0];
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    for (const [k, n] of seen) if (n > 1) doubled.push(`${po.poNumber}:${k}×${n}`);
  }
  check('no PO records the same GRN receipt twice (GRN_RECEIVED)', doubled.length === 0, doubled.join(','));
  const doneQcs = await IncomingQC.find({ qcStatus: { $in: ['PASSED', 'PARTIAL', 'FAILED'] }, grnId: { $ne: null } }).lean();
  const qcDoubled = doneQcs.filter((q) => q.activityTimeline.filter((t) => t.action === 'COMPLETE').length !== 1).map((q) => q.qcNumber);
  check('each completed QC has exactly one COMPLETE entry', qcDoubled.length === 0, qcDoubled.join(','));

  // ── S15 a transient abort mid-transaction (replica set only) ───────────────
  section('S15 transaction replay after a transient abort');
  if (!txns) {
    check('skipped — needs a replica set (transactions)', true, 'standalone run');
  } else {
    const transientOnce = (Model) => {
      const orig = Model.prototype.save;
      let injected = 0;
      Model.prototype.save = async function patched(...args) {
        const out = await orig.apply(this, args);
        const s = args[0]?.session;
        if (s && s.inTransaction() && injected === 0) {
          injected += 1;
          throw new mongoose.mongo.MongoServerError({ message: 'E2E injected transient abort', code: 112, errorLabels: ['TransientTransactionError'] });
        }
        return out;
      };
      return { restore: () => { Model.prototype.save = orig; }, count: () => injected };
    };
    const po15 = await mkPo(ctx, 'REPLAY', [['E2E-BRUSH', 11], ['E2E-BOX', 13]]);
    const g15 = await G.create({ poId: String(po15._id), items: grnItems(po15, { 'E2E-BRUSH': [11], 'E2E-BOX': [13] }) }, user);
    let inj = transientOnce(VendorPurchaseOrder);
    let err15 = null;
    try { await G.complete(String(g15._id), {}, user); } catch (e) { err15 = e; }
    inj.restore();
    check('GRN completion: one transient abort injected after the PO save, completion still succeeds', inj.count() === 1 && !err15, err15?.message);
    const po15After = await VendorPurchaseOrder.findById(po15._id).lean();
    const g15After = await GoodsReceiptNote.findById(g15._id).lean();
    check('…PO received once (11 / 13), ONE GRN_RECEIVED; GRN ONE COMPLETE',
      po15After.items.map((i) => i.receivedQty).join('/') === '11/13'
      && po15After.activityTimeline.filter((t) => t.action === 'GRN_RECEIVED').length === 1
      && g15After.activityTimeline.filter((t) => t.action === 'COMPLETE').length === 1);
    await sign(g15._id);
    const qc15 = await Q.create({ grnId: String(g15._id) }, user);
    const brushB15 = await onHand('E2E-BRUSH', 'MAIN', ctx);
    inj = transientOnce(IncomingQC);
    let errQ = null;
    try { await Q.complete(String(qc15._id), {}, user); } catch (e) { errQ = e; }
    inj.restore();
    check('QC completion: one transient abort injected after the QC save, completion still succeeds', inj.count() === 1 && !errQ, errQ?.message);
    const qc15After = await IncomingQC.findById(qc15._id).lean();
    check('…one GRN_IN per line, brush +11 once, QC ONE COMPLETE',
      (await movementsOf(g15._id)).length === 2 && (await onHand('E2E-BRUSH', 'MAIN', ctx)) === brushB15 + 11
      && qc15After.activityTimeline.filter((t) => t.action === 'COMPLETE').length === 1);
  }

  // ── S16 coils awaiting QC can be neither stocked by hand nor cut ───────────
  section('S16 RM: a coil awaiting QC is not usable — then works at JW001 once QC posts it');
  const { rmConvertSchema } = await import('../modules/inventory/rmIms.validation.js');
  const ManualCoil = (await import('../modules/inventory/manualCoil.model.js')).default;
  const convert = (payload) => {
    const { error, value } = rmConvertSchema.validate(payload, { abortEarly: false, stripUnknown: true });
    if (error) throw new Error(error.message);
    return svc.rmImsService.convert(value, user);
  };
  const coilJ = ctx.sku['JSL204-08']; const circJ = ctx.sku['JSL204-08-850'];
  const po16 = await mkPo(ctx, 'AWAIT-JW', [['JSL204-08', 500, 190]]);
  const g16 = await G.create({ poId: String(po16._id), rmReceivedAtLocation: 'JW001', items: grnItems(po16, { 'JSL204-08': [500, 'B-AWAIT-1'] }) }, user);
  await G.complete(String(g16._id), {}, user);
  await expectReject('RM Stock In of a batch awaiting QC is refused',
    svc.rmImsService.receive({ items: [{ skuId: String(coilJ._id), quantity: 10, batchNo: 'B-AWAIT-1' }], warehouse: 'JW001', reason: 'CORRECTION_ADJUSTMENT' }, user),
    /B-AWAIT-1 was received on .* awaiting Incoming QC/);
  const lk = await svc.rmImsService.lookupManualCoil({ batchNo: 'b-await-1' });
  check('the Cut Coils lookup reports it as QC-pending (case-insensitive)', lk.qcPending?.stockStatus === 'AWAITING_QC' && !lk.grnReceipt, JSON.stringify(lk.qcPending));
  await expectReject('entering it as a MANUAL coil to cut it is refused',
    convert({ clientRequestId: 'qg-await-1', manualCoil: { batchNo: 'B-AWAIT-1', totalWeightKg: 500 }, coilSkuId: String(coilJ._id), coilWeightKg: 100, cuttingType: 'PARTIAL', warehouse: 'JW001', circles: [{ circleSkuId: String(circJ._id), pcs: 300, weightKg: 90 }] }),
    /awaiting Incoming QC/);
  check('…no manual coil, no movement carries the batch', !(await ManualCoil.exists({ batchNo: 'B-AWAIT-1' })) && (await InventoryMovement.countDocuments({ batchNo: 'B-AWAIT-1' })) === 0);
  await sign(g16._id);
  const qc16 = await Q.create({ grnId: String(g16._id) }, user);
  await Q.update(String(qc16._id), { items: qcLinesFor(qc16, { 'JSL204-08': [480, 20] }) }, user);
  await Q.complete(String(qc16._id), {}, user);
  const receipt16 = await InventoryMovement.findOne({ batchNo: 'B-AWAIT-1', txnType: 'GRN_IN' }).lean();
  check('after MD + QC: the accepted 480 kg is a JW001 receipt', receipt16?.quantity === 480 && receipt16?.warehouse === 'JW001');
  const coilsList = await svc.rmImsService.listReceivedCoils({ grnOnly: true, limit: 50 });
  check('Cut Coils now offers it', (coilsList.docs || []).some((d) => d.batchNo === 'B-AWAIT-1'), (coilsList.docs || []).map((d) => d.batchNo).join(','));
  let cutOk = true; let cutMsg = '';
  try {
    await convert({ clientRequestId: 'qg-await-cut', batchNo: 'B-AWAIT-1', coilReceiptId: String(receipt16._id), coilSkuId: String(coilJ._id), warehouse: 'JW001', scrapVerified: 'PENDING', coilWeightKg: 100, cuttingType: 'PARTIAL', circles: [{ circleSkuId: String(circJ._id), pcs: 300, weightKg: 90 }] });
  } catch (e) { cutOk = false; cutMsg = e.message; }
  check('the direct-to-job-worker coil is cut at JW001 once its QC posted it', cutOk, cutMsg);
  check('…JW001 coil balance 480 − 100 = 380', (await onHand('JSL204-08', 'JW001', ctx)) === 380);
  const po16r = await mkPo(ctx, 'REJ-JW', [['JSL204-08', 200, 190]]);
  const g16r = await G.create({ poId: String(po16r._id), rmReceivedAtLocation: 'JW001', items: grnItems(po16r, { 'JSL204-08': [200, 'B-REJ-1'] }) }, user);
  await G.complete(String(g16r._id), {}, user); await sign(g16r._id);
  const qc16r = await Q.create({ grnId: String(g16r._id) }, user);
  await Q.update(String(qc16r._id), { items: qcLinesFor(qc16r, { 'JSL204-08': [0, 200] }) }, user);
  await Q.complete(String(qc16r._id), {}, user);
  await expectReject('a coil the QC rejected entirely cannot be stocked in by hand either',
    svc.rmImsService.receive({ items: [{ skuId: String(coilJ._id), quantity: 200, batchNo: 'B-REJ-1' }], warehouse: 'JW001', reason: 'CORRECTION_ADJUSTMENT' }, user),
    /accepted none of it/);

  // ── S17 forecasts include Awaiting QC from the next day ────────────────────
  section('S17 forecasts: Awaiting QC joins the projection on day 1, never day 0');
  const po17 = await mkPo(ctx, 'AWAIT-FC', [['E2E-BRUSH', 30], ['E2E-COIL', 70]]);
  const g17 = await G.create({ poId: String(po17._id), rmReceivedAtLocation: 'PLG01', items: grnItems(po17, { 'E2E-BRUSH': [30], 'E2E-COIL': [70, 'B-AWAIT-FC'] }) }, user);
  await G.complete(String(g17._id), {}, user);
  // Awaiting QC sums EVERY open GRN of a SKU (S2 / S10 left some open too), so
  // expectations come from the service total, and this GRN must be part of it.
  const awBrush = (await svc.awaitingQcBySku([ctx.sku['E2E-BRUSH']._id])).get(String(ctx.sku['E2E-BRUSH']._id));
  const awCoil = (await svc.awaitingQcBySku([ctx.sku['E2E-COIL']._id])).get(String(ctx.sku['E2E-COIL']._id));
  check('this GRN is part of the Awaiting QC totals (brush, coil)', awBrush?.grnNumbers.includes(g17.grnNumber) && awCoil?.grnNumbers.includes(g17.grnNumber),
    `brush ${awBrush?.qty} · coil ${awCoil?.qty}`);
  const fcC = await svc.imsService.getForecast(String(ctx.sku['E2E-BRUSH']._id), 7);
  check('C&P forecast: Awaiting QC not on day 0, added on day 1', fcC.metrics.awaitingQc === awBrush.qty && fcC.awaitingQcDay === 1
    && fcC.series[0].projected === fcC.metrics.onHand && fcC.series[1].projected === r2(fcC.metrics.onHand + awBrush.qty - fcC.metrics.adc),
  `onHand ${fcC.metrics.onHand} · awaiting ${awBrush.qty} · d0 ${fcC.series[0].projected} · d1 ${fcC.series[1].projected}`);
  const fcR = await svc.rmImsService.getForecast(String(ctx.sku['E2E-COIL']._id), 7);
  check('RM forecast: Awaiting QC not on day 0, added on day 1', fcR.metrics.awaitingQc === awCoil.qty
    && fcR.series[0].projected === fcR.metrics.onHand && fcR.series[1].projected === r2(fcR.metrics.onHand + awCoil.qty - fcR.metrics.adc),
  `onHand ${fcR.metrics.onHand} · awaiting ${awCoil.qty} · d0 ${fcR.series[0].projected} · d1 ${fcR.series[1].projected}`);
  const detR = await svc.rmImsService.getItemDetail(String(ctx.sku['E2E-COIL']._id));
  check('RM item page shows the same Awaiting QC and its GRNs', detR.metrics.awaitingQc === awCoil.qty && detR.metrics.awaitingQcGrnNumbers.includes(g17.grnNumber));
  const cpRow17 = (await svc.imsService.getOverview({})).docs.find((r) => r.skuCode === 'E2E-BRUSH');
  check('C&P list row: Awaiting QC counted in projected available, not in on hand', cpRow17.awaitingQc === awBrush.qty
    && cpRow17.projectedAvailable === r2(cpRow17.onHand + cpRow17.inTransit + awBrush.qty) && cpRow17.onHand === fcC.metrics.onHand);

  // ── S18 a vendor receipt cannot be typed in around the GRN ────────────────
  section('S18 Stock In: the vendor-receipt bypass is closed, adjustments still work');
  const brush18 = ctx.sku['E2E-BRUSH']; const coil18 = ctx.sku['E2E-COIL'];
  const cpBefore = await onHand('E2E-BRUSH', 'MAIN', ctx);
  const rmBefore = await onHand('E2E-COIL', 'PLG01', ctx);
  await expectReject('C&P Stock In as a vendor receipt is refused and points at the GRN route',
    svc.imsService.receive({ items: [{ skuId: String(brush18._id), quantity: 5 }], warehouse: 'MAIN', reason: 'VENDOR_RECEIPT' }, user),
    /not a Stock In reason any more[\s\S]*GRN/);
  await expectReject('…the older VENDOR code is refused the same way (no older client can slip past)',
    svc.imsService.receive({ items: [{ skuId: String(brush18._id), quantity: 5 }], warehouse: 'MAIN', reason: 'VENDOR' }, user),
    /not a Stock In reason any more/);
  await expectReject('…and an omitted reason, which used to mean "vendor receipt", is refused too',
    svc.imsService.receive({ items: [{ skuId: String(brush18._id), quantity: 5 }], warehouse: 'MAIN' }, user),
    /not a Stock In reason any more/);
  await expectReject('RM Stock In as a vendor receipt is refused as well',
    svc.rmImsService.receive({ items: [{ skuId: String(coil18._id), quantity: 5, batchNo: 'B-S18-NEW' }], warehouse: 'PLG01', reason: 'VENDOR_RECEIPT' }, user),
    /not a Stock In reason any more/);
  check('…nothing was added to either store by the refused entries',
    (await onHand('E2E-BRUSH', 'MAIN', ctx)) === cpBefore && (await onHand('E2E-COIL', 'PLG01', ctx)) === rmBefore
    && (await InventoryMovement.countDocuments({ batchNo: 'B-S18-NEW' })) === 0);
  // The legitimate reasons are untouched — this is a correction, not a receipt.
  await svc.imsService.receive({ items: [{ skuId: String(brush18._id), quantity: 3 }], warehouse: 'MAIN', reason: 'CORRECTION_ADJUSTMENT', clientRequestId: 'qg-s18-corr' }, user);
  await svc.rmImsService.receive({ items: [{ skuId: String(coil18._id), quantity: 7, batchNo: 'B-S18-OPENING' }], warehouse: 'PLG01', reason: 'OPENING_STOCK', clientRequestId: 'qg-s18-open' }, user);
  await svc.imsService.receive({ items: [{ skuId: String(brush18._id), quantity: 2 }], warehouse: 'MAIN', reason: 'OTHER', customReason: 'Returned unused from the line', clientRequestId: 'qg-s18-other' }, user);
  check('a correction, an opening stock and an OTHER entry still post normally',
    (await onHand('E2E-BRUSH', 'MAIN', ctx)) === r2(cpBefore + 5) && (await onHand('E2E-COIL', 'PLG01', ctx)) === r2(rmBefore + 7),
    `brush ${await onHand('E2E-BRUSH', 'MAIN', ctx)} · coil ${await onHand('E2E-COIL', 'PLG01', ctx)}`);
  const openingMv = await InventoryMovement.findOne({ batchNo: 'B-S18-OPENING' }).lean();
  check('…and they keep their existing movement types (OPENING / ADJUST_IN)', openingMv?.txnType === 'OPENING'
    && (await InventoryMovement.findOne({ clientRequestId: 'qg-s18-corr' }).lean())?.txnType === 'ADJUST_IN');
  // History: a vendor receipt posted BEFORE the rule (written through the stock
  // engine directly, the way the old Stock In did). It must survive untouched
  // and keep rendering its label — only NEW entries are refused.
  const tape18 = ctx.sku['E2E-TAPE'];
  const tapeBefore = await onHand('E2E-TAPE', 'MAIN', ctx);
  const legacyIn = await svc.inventoryService.increaseStock({
    skuId: String(tape18._id), quantity: 12, warehouse: 'MAIN', txnType: 'ADJUST_IN',
    sourceModule: 'IMS', refType: 'IMS_RECEIPT', reason: 'VENDOR_RECEIPT',
    remarks: 'Vendor receipt · posted before the rule', performedBy: user, movementDate: new Date(),
  }, {});
  const tapeAfterLegacy = await onHand('E2E-TAPE', 'MAIN', ctx);
  const histVendor = await InventoryMovement.findOne({ _id: legacyIn.movement._id }).lean();
  check('a vendor receipt already in History keeps its reason, its label and its balance',
    histVendor?.reason === 'VENDOR_RECEIPT' && STOCK_IN_REASONS.VENDOR_RECEIPT === 'Vendor receipt' && tapeAfterLegacy === r2(tapeBefore + 12),
    `${histVendor?.movementNumber} · ${histVendor?.reason} · tape ${tapeAfterLegacy}`);
  await expectReject('…but the same reason cannot be used for a new entry on that very item',
    svc.imsService.receive({ items: [{ skuId: String(tape18._id), quantity: 1 }], warehouse: 'MAIN', reason: 'VENDOR_RECEIPT' }, user),
    /not a Stock In reason any more/);
  check('…and the refusal left that balance alone', (await onHand('E2E-TAPE', 'MAIN', ctx)) === tapeAfterLegacy);

  // ── S19 posting refuses to run where it cannot be atomic ──────────────────
  section('S19 QC posting without transactions: refused, never half-written');
  if (txns) {
    check('skipped — this database HAS transactions, so the refusal cannot trigger', true, 'replica set run');
  } else {
    const po19 = await mkPo(ctx, 'NOTXN', [['E2E-BRUSH', 9], ['E2E-BOX', 4]]);
    const g19 = await G.create({ poId: String(po19._id), items: grnItems(po19, { 'E2E-BRUSH': [9], 'E2E-BOX': [4] }) }, user);
    await G.complete(String(g19._id), {}, user);
    await sign(g19._id);
    const qc19 = await Q.create({ grnId: String(g19._id) }, user);
    const brushBefore19 = await onHand('E2E-BRUSH', 'MAIN', ctx);
    // The harness allows the non-atomic fallback for scratch databases (see
    // e2eSafety). Cleared here, this is exactly how a real deployment behaves.
    const saved = process.env.INVENTORY_ALLOW_NON_ATOMIC;
    delete process.env.INVENTORY_ALLOW_NON_ATOMIC;
    let err19 = null;
    try { await Q.complete(String(qc19._id), {}, user); } catch (e) { err19 = e; }
    process.env.INVENTORY_ALLOW_NON_ATOMIC = saved;
    check('the QC completion is refused with 503, naming the replica-set requirement',
      err19?.statusCode === 503 && /replica set/i.test(err19.message), err19 ? `${err19.statusCode} ${err19.message.slice(0, 90)}` : 'it was ACCEPTED');
    const qc19After = await IncomingQC.findById(qc19._id).lean();
    const g19After = await GoodsReceiptNote.findById(g19._id).lean();
    check('…NOTHING was posted: no movement, no balance change, no line marked POSTED',
      (await movementsOf(g19._id)).length === 0 && (await onHand('E2E-BRUSH', 'MAIN', ctx)) === brushBefore19
      && g19After.items.every((l) => l.stockStatus === 'AWAITING_QC' && !l.postedQcId));
    check('…and the QC is handed back complete-able (claim released, still a draft)',
      qc19After.stockPosted !== true && ['DRAFT', 'IN_PROGRESS'].includes(qc19After.qcStatus), `${qc19After.qcStatus} / stockPosted=${qc19After.stockPosted}`);
    // With the fallback allowed again (scratch DB), the same QC completes.
    await Q.complete(String(qc19._id), {}, user);
    check('…the very same QC then completes once the database can do it', (await movementsOf(g19._id)).length === 2
      && (await onHand('E2E-BRUSH', 'MAIN', ctx)) === r2(brushBefore19 + 9));
  }

  // ── S20 what Awaiting QC counts, and what it must never count ─────────────
  // in transit  = ordered − received   ·   awaiting QC = received, QC open
  // on hand     = posted movements     ·   the three never overlap.
  section('S20 Awaiting QC: partial receipts, several lines, completed QC, legacy, both IMS modules');
  const awOf = async (code) => (await svc.awaitingQcBySku([ctx.sku[code]._id])).get(String(ctx.sku[code]._id)) || { qty: 0, lineCount: 0, grnNumbers: [] };
  const s20Rm = async (code) => svc.rmImsService.getItemDetail(String(ctx.sku[code]._id));
  const s20Cp = async (code) => (await svc.imsService.getOverview({})).docs.find((r) => r.skuCode === code);
  check('a SKU with nothing received is not Awaiting QC at all', (await awOf('E2E-AW-RM')).qty === 0 && (await awOf('E2E-AW-CP')).qty === 0);

  // ── a PARTIAL receipt: 40 of 100 arrive, so 60 are still in transit ──
  const po20 = await mkPo(ctx, 'AWAIT-SPLIT', [['E2E-AW-RM', 100, 80], ['E2E-AW-CP', 50, 12]]);
  const g20a = await G.create({ poId: String(po20._id), rmReceivedAtLocation: 'PLG01', items: grnItems(po20, { 'E2E-AW-RM': [40, 'B-AW-1'], 'E2E-AW-CP': [20] }) }, user);
  await G.complete(String(g20a._id), {}, user);
  const rm20 = await s20Rm('E2E-AW-RM');
  const cp20 = await s20Cp('E2E-AW-CP');
  check('partial receipt: RM 40 awaiting QC, 60 still in transit, 0 on hand — none of them double-counted',
    rm20.metrics.awaitingQc === 40 && rm20.metrics.inTransit === 60 && rm20.metrics.onHand === 0
    && rm20.metrics.projectedAvailable === r2(0 + 60 + 40 - (rm20.metrics.booked || 0)),
    `onHand ${rm20.metrics.onHand} · inTransit ${rm20.metrics.inTransit} · awaiting ${rm20.metrics.awaitingQc}`);
  // C&P's "in transit" is the figure a planner types on the item (it has no
  // open-PO feed of its own, unlike RM) — unchanged by any of this. What must
  // hold here is the same non-overlap: the 20 received are Awaiting QC, not on
  // hand, and they are counted once in what is available to plan with.
  check('…and the same holds for the C&P line of the very same GRN (20 of 50 received)',
    cp20.awaitingQc === 20 && cp20.onHand === 0
    && cp20.projectedAvailable === r2(cp20.onHand + cp20.inTransit + 20),
    `onHand ${cp20.onHand} · inTransit ${cp20.inTransit} (typed, not from the PO) · awaiting ${cp20.awaitingQc}`);
  check('…the GRN is named on both items, counted once each', (await awOf('E2E-AW-RM')).lineCount === 1
    && (await awOf('E2E-AW-RM')).grnNumbers.length === 1 && (await awOf('E2E-AW-CP')).grnNumbers[0] === g20a.grnNumber);

  // ── SEVERAL open GRNs for one SKU: the rest of the PO arrives on a second ──
  const g20b = await G.create({ poId: String(po20._id), rmReceivedAtLocation: 'JW001', items: grnItems(po20, { 'E2E-AW-RM': [60, 'B-AW-2'], 'E2E-AW-CP': [30] }) }, user);
  await G.complete(String(g20b._id), {}, user);
  const rm20b = await s20Rm('E2E-AW-RM');
  check('two open GRNs for one SKU add up (40 + 60) and nothing is left in transit',
    rm20b.metrics.awaitingQc === 100 && rm20b.metrics.inTransit === 0 && rm20b.metrics.onHand === 0
    && (await awOf('E2E-AW-RM')).lineCount === 2 && rm20b.metrics.awaitingQcGrnNumbers.length === 2,
    `awaiting ${rm20b.metrics.awaitingQc} · inTransit ${rm20b.metrics.inTransit}`);
  check('…the two receipts are at DIFFERENT places (PLG01 and JW001) and both are still only Awaiting QC',
    (await onHand('E2E-AW-RM', 'PLG01', ctx)) === 0 && (await onHand('E2E-AW-RM', 'JW001', ctx)) === 0
    && lineOf(await GoodsReceiptNote.findById(g20a._id).lean(), 'E2E-AW-RM').stockWarehouse === 'PLG01'
    && lineOf(await GoodsReceiptNote.findById(g20b._id).lean(), 'E2E-AW-RM').stockWarehouse === 'JW001');

  // ── QC completes on ONE of them: only that GRN leaves Awaiting QC ──
  await sign(g20a._id);
  const qc20a = await Q.create({ grnId: String(g20a._id) }, user);
  await Q.update(String(qc20a._id), { items: qcLinesFor(qc20a, { 'E2E-AW-RM': [35, 5], 'E2E-AW-CP': [18, 1, 1] }) }, user);
  await Q.complete(String(qc20a._id), {}, user);
  const rm20c = await s20Rm('E2E-AW-RM');
  const cp20c = await s20Cp('E2E-AW-CP');
  check('after QC: the ACCEPTED 35 is on hand at PLG01, the other GRN\'s 60 is still awaiting',
    rm20c.metrics.onHand === 35 && rm20c.metrics.awaitingQc === 60 && (await onHand('E2E-AW-RM', 'PLG01', ctx)) === 35,
    `onHand ${rm20c.metrics.onHand} · awaiting ${rm20c.metrics.awaitingQc}`);
  check('…the rejected 5 is in NEITHER figure — it never became stock and is no longer awaiting',
    rm20c.metrics.onHand + rm20c.metrics.awaitingQc === 95 && (await movementsOf(g20a._id)).every((m) => m.txnType === 'GRN_IN'));
  check('…C&P the same: 18 accepted on hand, 1 rejected and 1 rework in neither, 30 still awaiting',
    cp20c.onHand === 18 && cp20c.awaitingQc === 30, `onHand ${cp20c.onHand} · awaiting ${cp20c.awaitingQc}`);
  check('…and the completed GRN has dropped out of the Awaiting QC list entirely',
    !(await awOf('E2E-AW-RM')).grnNumbers.includes(g20a.grnNumber) && (await awOf('E2E-AW-RM')).grnNumbers.includes(g20b.grnNumber));

  // ── the direct-to-job-worker route finishes the same way, at JW001 ──
  await sign(g20b._id);
  const qc20b = await Q.create({ grnId: String(g20b._id) }, user);
  await Q.update(String(qc20b._id), { items: qcLinesFor(qc20b, { 'E2E-AW-RM': [60, 0], 'E2E-AW-CP': [30, 0] }) }, user);
  await Q.complete(String(qc20b._id), {}, user);
  const rm20d = await s20Rm('E2E-AW-RM');
  check('the JW001 receipt posts to JW001 (not the plant), and Awaiting QC is now empty',
    (await onHand('E2E-AW-RM', 'JW001', ctx)) === 60 && (await onHand('E2E-AW-RM', 'PLG01', ctx)) === 35
    && rm20d.metrics.awaitingQc === 0 && rm20d.metrics.onHand === 95,
    `PLG01 35 · JW001 ${await onHand('E2E-AW-RM', 'JW001', ctx)} · awaiting ${rm20d.metrics.awaitingQc}`);
  check('…both warehouses are listed on the item, so nothing was lost from reconciliation',
    r2((rm20d.locations || []).reduce((t, w) => t + (w.qtyOnHand || 0), 0)) === 95
    && (rm20d.locations || []).some((w) => w.warehouse === 'JW001' && w.qtyOnHand === 60),
    JSON.stringify((rm20d.locations || []).map((w) => [w.warehouse, w.qtyOnHand])));

  // ── a LEGACY GRN of the same item is never Awaiting QC ──
  const leg20 = await mkLegacyGrn(ctx, svc, 'AWAIT-LEG', [['E2E-AW-CP', 11]]);
  const cp20e = await s20Cp('E2E-AW-CP');
  check('a legacy GRN posts at completion and is never counted as Awaiting QC',
    (await movementsOf(leg20.grn._id)).length === 1 && cp20e.awaitingQc === 0 && cp20e.onHand === r2(18 + 30 + 11),
    `onHand ${cp20e.onHand} · awaiting ${cp20e.awaitingQc}`);
  const qcLeg20 = await Q.create({ grnId: String(leg20.grn._id) }, user);
  await Q.complete(String(qcLeg20._id), {}, user);
  check('…and finishing its QC under the legacy rule still posts no second receipt',
    (await movementsOf(leg20.grn._id)).length === 1 && (await s20Cp('E2E-AW-CP')).awaitingQc === 0);

  // ── S21 reclassifying a SKU cannot reroute material already received ──────
  section('S21 a SKU reclassified between GRN completion and QC keeps its line where it landed');
  const po21 = await mkPo(ctx, 'RECLASS', [['E2E-AW-RM', 20, 70]]);
  const g21 = await G.create({ poId: String(po21._id), rmReceivedAtLocation: 'PLG01', items: grnItems(po21, { 'E2E-AW-RM': [20, 'B-RECLASS'] }) }, user);
  await G.complete(String(g21._id), {}, user);
  const line21 = lineOf(await GoodsReceiptNote.findById(g21._id).lean(), 'E2E-AW-RM');
  check('received as Raw Material → RM IMS · PLG01, fixed on the line at completion',
    line21.itemTypeAtReceipt === 'RAW_MATERIAL' && line21.inventoryDestination === 'RM_IMS' && line21.stockWarehouse === 'PLG01');
  // Someone with masters.editSku now reclassifies the item in the master.
  await SKU.updateOne({ _id: ctx.sku['E2E-AW-RM']._id }, { $set: { itemType: 'CONSUMABLE' } });
  await sign(g21._id);
  const qc21 = await Q.create({ grnId: String(g21._id) }, user);
  await Q.complete(String(qc21._id), {}, user);
  const mv21 = await movementsOf(g21._id);
  check('QC posts it where the GRN said, NOT where the new classification would send it',
    mv21.length === 1 && mv21[0].warehouse === 'PLG01' && mv21[0].quantity === 20,
    mv21.map((m) => `${m.skuCode}:${m.quantity}@${m.warehouse}`).join(', '));
  const line21b = lineOf(await GoodsReceiptNote.findById(g21._id).lean(), 'E2E-AW-RM');
  check('…and the line still records what it WAS when it was received',
    line21b.itemTypeAtReceipt === 'RAW_MATERIAL' && line21b.inventoryDestination === 'RM_IMS' && line21b.stockStatus === 'POSTED');
  await SKU.updateOne({ _id: ctx.sku['E2E-AW-RM']._id }, { $set: { itemType: 'RAW_MATERIAL' } });

  // ── S13 reconciliation ──────────────────────────────────────────────────────
  section('S13 ledger reconciliation');
  const rec = await reconcile();
  check(`every stock row equals the sum of its movements (${rec.rows} rows)`, rec.bad.length === 0, rec.bad.join('; '));
  const gated = await GoodsReceiptNote.find({ stockPostingStage: 'QC_COMPLETION' }).lean();
  const badGrn = [];
  for (const g of gated) {
    const posted = r2((await movementsOf(g._id)).reduce((s, m) => s + m.quantity, 0));
    const accepted = r2(g.items.reduce((s, l) => s + (l.postedQty || 0), 0));
    if (posted !== accepted) badGrn.push(`${g.grnNumber} posted ${posted} vs accepted ${accepted}`);
  }
  check(`QC-gated GRNs: stock posted == accepted qty (${gated.length} GRNs)`, badGrn.length === 0, badGrn.join('; '));
  // Completed without a QC yet: the S2 coil that got its Received At late, the S10 draft, and S17.
  const awaitingLeft = (await GoodsReceiptNote.find({ 'items.stockStatus': 'AWAITING_QC' }).select('grnNumber poNumber').lean()).map((g) => g.poNumber).sort();
  check('only GRNs whose QC is still open remain Awaiting QC', JSON.stringify(awaitingLeft) === JSON.stringify(['PO-QG-AWAIT-FC', 'PO-QG-NOLOC', 'PO-QG-OLDDRAFT']), awaitingLeft.join(', '));

  await mongoose.disconnect();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n[qc-gated] ${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join(' | ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
};

// ═════════════════════════════════════════════════════════════════════════════
// Browser run (frontend/e2e/qcGatedGrn.e2e.mjs)
const seedUi = async () => {
  await connect();
  await seedBase();
  const ctx = await ctxLoad();
  const svc = await services();
  // The PO the browser receives: a coil and a brush (mixed), and a service line it must not receive.
  await mkPo(ctx, 'UI-MIX', [['E2E-COIL', 500, 90], ['E2E-BRUSH', 40, 20], ['E2E-SVC', 1, 500]]);
  // A legacy GRN (stock posted at completion, QC passed) that must stay viewable and untouched.
  await mkLegacyGrn(ctx, svc, 'UI-LEGACY', [['E2E-BOX', 12]], { qcDone: true });
  console.log(JSON.stringify({ ok: true, db: mongoose.connection.name }));
  await mongoose.disconnect();
};

const verifyUi = async () => {
  await connect();
  const ctx = await ctxLoad();
  const grn = await GoodsReceiptNote.findOne({ poNumber: 'PO-QG-UI-MIX' }).lean();
  check('browser: one GRN raised for PO-QG-UI-MIX', !!grn, grn?.grnNumber);
  if (grn) {
    const qcs = await IncomingQC.find({ grnId: grn._id }).lean();
    const mv = await movementsOf(grn._id);
    const coil = mv.find((m) => m.skuCode === 'E2E-COIL');
    const brush = mv.find((m) => m.skuCode === 'E2E-BRUSH');
    check('browser: GRN QC-gated, signed, QC completed', grn.stockPostingStage === 'QC_COMPLETION' && grn.approvalStatus === 'MD_APPROVED' && qcs.filter((q) => q.qcStatus === 'PARTIAL').length === 1);
    check('browser: exactly two GRN_IN movements (coil, brush) despite double clicks', mv.length === 2, mv.map((m) => `${m.skuCode}:${m.quantity}`).join(','));
    check('browser: coil accepted 480 at JW001, brush accepted 36 at MAIN', coil?.quantity === 480 && coil?.warehouse === 'JW001' && brush?.quantity === 36 && brush?.warehouse === 'MAIN');
    check('browser: movements dated at QC completion', mv.every((m) => Math.abs(new Date(m.movementDate) - new Date(qcs[0].completedAt)) < 5));
    check('browser: no rejected qty in stock (no QC_REJECT_OUT, balances = accepted)',
      (await InventoryMovement.countDocuments({ txnType: 'QC_REJECT_OUT' })) === 0
      && (await onHand('E2E-COIL', 'JW001', ctx)) === 480 && (await onHand('E2E-BRUSH', 'MAIN', ctx)) === 36);
    check('browser: Service line was never received', !grn.items.some((l) => l.skuCode === 'E2E-SVC' && l.receivedQty > 0));
  }
  const legacy = await GoodsReceiptNote.findOne({ grnNumber: 'GRN-QG-UI-LEGACY' }).lean();
  check('browser: legacy GRN untouched (no stage, one movement)', !legacy.stockPostingStage && (await movementsOf(legacy._id)).length === 1);
  const rec = await reconcile();
  check('browser: ledger reconciles', rec.bad.length === 0, rec.bad.join('; '));
  await mongoose.disconnect();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n[qc-gated ui] ${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
};

if (isEntry(import.meta.url)) {
  const run = { api: runApi, 'seed-ui': seedUi, 'verify-ui': verifyUi }[MODE];
  if (!run) { console.error(`Unknown mode --${MODE}`); process.exit(2); }
  run().catch(async (e) => {
    console.error(`[qc-gated] crashed: ${e.stack || e.message}`);
    try { await mongoose.disconnect(); } catch { /* noop */ }
    process.exit(1);
  });
}
