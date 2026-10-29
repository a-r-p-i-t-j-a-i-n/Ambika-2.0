/**
 * Database oracle for SKU purchase-unit conversion (1 BOX = 25 PCS).
 *
 *   node src/scripts/e2eUnitConversionFixture.js --api
 *
 * Runs the REAL services — SKU Master, the indent SKU binder, PO draft edit,
 * GRN create / complete, Incoming QC, IMS issue / receive, stock correction,
 * the IMS overview and item ledger — against a scratch database, and checks
 * after every step what was stored and what reached stock:
 *
 *   SKU 1 BOX = 25 PCS · PO 5 BOX · GRN 5 BOX · QC → +125 PCS · issue 10 → 115
 *
 * plus different factors per SKU, same-unit and legacy SKUs, invalid factors,
 * incompatible units, inexact fractions, valuation, duplicate completion and
 * factor / stock-unit edits after the fact.
 *
 * DATABASE: its own scratch DB, ambika_e2e_unitconv (default :27017; override
 * with E2E_UC_URI). Each run CLEARS that database's documents with deleteMany —
 * never dropDatabase, which leaves drop-pending idents spamming mongod.log on
 * this Windows install — and refuses to touch any other database name.
 *
 * SAFETY: the shared e2e guard runs before anything connects — localhost only,
 * database name must contain "e2e", S3 and email must be off. It never reads
 * MONGO_URI, so it cannot reach Atlas. On a standalone mongod it lets the QC
 * posting run without a transaction (assertE2ESafe sets
 * INVENTORY_ALLOW_NON_ATOMIC); the per-line claims still guard duplicates.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote from '../modules/procurement/grn/grn.model.js';
import IncomingQC from '../modules/procurement/incoming-qc/incomingQc.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';

const DB = 'ambika_e2e_unitconv';
export const E2E_URI = process.env.E2E_UC_URI || `mongodb://127.0.0.1:27017/${DB}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eUnitConversionFixture.js');
export const E2E_USER = { email: 'unitconv-e2e@test.local', password: 'E2e@12345', name: 'Unit Conversion E2E', role: 'MD' };

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
    check(name, re.test(e.message), e.message.slice(0, 200));
  }
};
const section = (t) => console.log(`\n── ${t} ──`);

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB) throw new Error(`Connected to ${mongoose.connection.name}, expected ${DB} — aborting.`);
};

/** Empty THIS scratch database's collections (documents only — no drop). */
const clearDb = async () => {
  if (mongoose.connection.name !== DB) throw new Error('refusing to clear a database that is not the unit-conversion scratch DB');
  const cols = await mongoose.connection.db.listCollections().toArray();
  for (const c of cols) {
    if (!c.name.startsWith('system.')) await mongoose.connection.db.collection(c.name).deleteMany({});
  }
};

const services = async () => ({
  sku: await import('../modules/skus/sku.service.js'),
  bindIndentItemsToSkuMaster: (await import('../modules/procurement/indent/itemSku.js')).bindIndentItemsToSkuMaster,
  assertPurchaseUnits: (await import('../modules/procurement/purchase-item-guard.js')).assertPurchaseUnits,
  poService: (await import('../modules/procurement/purchase-order/purchaseOrder.service.js')).purchaseOrderService,
  grnService: (await import('../modules/procurement/grn/grn.service.js')).grnService,
  qcService: (await import('../modules/procurement/incoming-qc/incomingQc.service.js')).incomingQcService,
  imsService: (await import('../modules/inventory/ims.service.js')).imsService,
  stockCorrectionService: (await import('../modules/inventory/stockCorrection.service.js')).stockCorrectionService,
  awaitingQcBySku: (await import('../modules/inventory/awaitingQc.service.js')).awaitingQcBySku,
});

const vendorId = new mongoose.Types.ObjectId('6ac09965f1c61c40fa20bb01');

/** A PO eligible for a GRN (READY_FOR_GRN, PI not required, material date set). */
const mkPo = async (tag, lines) => VendorPurchaseOrder.create({
  poNumber: `PO-UC-${tag}`, vendorId, vendorName: 'E2E Unit Vendor', indentId: new mongoose.Types.ObjectId(),
  poStatus: 'RELEASED_TO_VENDOR', approvalStatus: 'APPROVED',
  followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_NOT_REQUIRED', readyForGrnAt: new Date(), finalMaterialDate: new Date(),
  items: lines.map(({ sku, unit, qty, rate }) => ({
    skuId: sku._id, skuCode: sku.code, itemName: sku.name, unit,
    quantity: qty, receivedQty: 0, pendingQty: qty, rate, gstRate: 18,
    taxableAmount: r2(qty * rate),
  })),
});

/** GRN items for create(): every PO line received in full; `unitOverride` is what a client might send. */
const grnItems = (po, { unitOverride = null, qty = {} } = {}) => po.items.map((p) => ({
  poItemId: String(p._id), itemName: p.itemName, skuCode: p.skuCode,
  unit: unitOverride || p.unit, rate: p.rate, // the GRN form sends the PO line's rate
  invoiceQty: qty[p.skuCode] ?? p.quantity, receivedQty: qty[p.skuCode] ?? p.quantity,
}));

const lineOf = (grn, code) => grn.items.find((l) => l.skuCode === code);
const movesOf = (grnId) => InventoryMovement.find({ refType: 'GRN', refId: grnId }).sort('createdAt').lean();
const stockOf = async (sku, warehouse = 'MAIN') => InventoryStock.findOne({ skuId: sku._id, warehouse }).lean();
const onHand = async (sku) => r2((await stockOf(sku))?.qtyOnHand || 0);
const reconcile = async () => {
  const rows = await InventoryStock.find({}).lean();
  const sums = new Map((await InventoryMovement.aggregate([
    { $group: { _id: { s: '$skuId', w: '$warehouse' }, q: { $sum: '$qtyDelta' } } },
  ])).map((r) => [`${r._id.s}|${r._id.w}`, r2(r.q)]));
  return rows.filter((r) => r2(r.qtyOnHand) !== (sums.get(`${r.skuId}|${r.warehouse}`) || 0))
    .map((r) => `${r.skuCode}@${r.warehouse}`);
};
const qcSplit = (qc, split = {}) => qc.items.map((it) => {
  const [accepted, rejected = 0] = split[it.skuCode] || [it.receivedQty, 0];
  return { grnItemId: String(it.grnItemId), itemName: it.itemName, receivedQty: it.receivedQty, acceptedQty: accepted, rejectedQty: rejected, reworkQty: 0 };
});
/** Complete a GRN through MD sign + QC (accept all unless `split`). */
const throughQc = async (svc, user, grnId, split = null) => {
  await GoodsReceiptNote.updateOne({ _id: grnId }, { $set: { approvalStatus: 'MD_APPROVED' } });
  const qc = await svc.qcService.create({ grnId: String(grnId) }, user);
  if (split) await svc.qcService.update(String(qc._id), { items: qcSplit(qc, split) }, user);
  return svc.qcService.complete(String(qc._id), {}, user);
};

// ═════════════════════════════════════════════════════════════════════════════
const runApi = async () => {
  await connect();
  await clearDb();
  for (const m of [InventoryMovement, InventoryStock, GoodsReceiptNote, IncomingQC, VendorPurchaseOrder, SKU]) {
    await m.createCollection().catch(() => {});
  }
  const svc = await services();
  const user = await User.create({ ...E2E_USER, mobile: '9000000071', isActive: true, roles: ['MD'] });
  const S = svc.sku;
  console.log(`\n[unit-conversion] database ${mongoose.connection.name}`);

  // ── 1. SKU Master ───────────────────────────────────────────────────────────
  section('1 SKU Master: configure, validate');
  const glove = await S.createSku({ code: 'UC-GLOVE', name: 'UC Nitrile Gloves', itemType: 'CONSUMABLE', unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: 25 }, user._id);
  const mask = await S.createSku({ code: 'UC-MASK', name: 'UC Face Mask', itemType: 'CONSUMABLE', unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: '24' }, user._id);
  const brush = await S.createSku({ code: 'UC-BRUSH', name: 'UC Brush 5in', itemType: 'CONSUMABLE', unit: 'PCS' }, user._id);
  const half = await S.createSku({ code: 'UC-WIPE', name: 'UC Wipes', itemType: 'PACKAGING', unit: 'PCS', purchaseUnit: 'PACK', purchaseConversionFactor: 2.5 }, user._id);
  // A SKU saved before the fields existed: written around the model, no purchase fields at all.
  await SKU.collection.insertOne({
    code: 'UC-LEGACY', name: 'UC Legacy Tape', itemType: 'PACKING', unit: 'Nos',
    isDeleted: false, isActive: true, createdAt: new Date(), updatedAt: new Date(),
  });
  const legacy = await SKU.findOne({ code: 'UC-LEGACY' }).lean();
  check('1 BOX = 25 PCS stored per SKU', glove.purchaseUnit === 'BOX' && glove.purchaseConversionFactor === 25 && glove.unit === 'PCS');
  check('a second SKU has its own factor (1 BOX = 24 PCS, sent as text)', mask.purchaseConversionFactor === 24);
  check('a same-unit SKU stores no conversion', brush.purchaseUnit === '' && brush.purchaseConversionFactor === null);
  check('a legacy SKU has neither field', legacy.purchaseUnit === undefined && legacy.purchaseConversionFactor === undefined);
  for (const [label, bad] of [['missing', undefined], ['zero', 0], ['negative', -5], ['text', 'abc'], ['non-finite', 'Infinity'], ['too precise', 1.23456]]) {
    await expectReject(`a ${label} factor is refused`,
      S.createSku({ code: `UC-BAD-${label.replace(/\W/g, '')}`, name: 'x', itemType: 'CONSUMABLE', unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: bad }, user._id),
      /Conversion factor/);
  }
  await expectReject('purchase unit = stock unit with a factor other than 1 is refused',
    S.createSku({ code: 'UC-BAD-SAME', name: 'x', itemType: 'CONSUMABLE', unit: 'PCS', purchaseUnit: 'pcs', purchaseConversionFactor: 25 }, user._id),
    /same as the Stock Unit/);
  await expectReject('a factor without a purchase unit is refused',
    S.createSku({ code: 'UC-BAD-NOUNIT', name: 'x', itemType: 'CONSUMABLE', unit: 'PCS', purchaseConversionFactor: 25 }, user._id),
    /Pick the Purchase Unit/);
  check('no refused SKU was saved', (await SKU.countDocuments({ code: /^UC-BAD-/ })) === 0);
  await expectReject('an edit that zeroes the factor is refused', S.updateSku(String(mask._id), { purchaseConversionFactor: 0 }, user._id), /greater than zero/);
  check('…and the stored factor is untouched', (await SKU.findById(mask._id).lean()).purchaseConversionFactor === 24);
  const brushEdited = await S.updateSku(String(brush._id), { sellingPrice: 12 }, user._id);
  check('an edit that does not mention units leaves them alone', brushEdited.unit === 'PCS' && brushEdited.purchaseUnit === '');

  // ── 2. Indent ──────────────────────────────────────────────────────────────
  section('2 Indent items take the purchase unit');
  const bound = await svc.bindIndentItemsToSkuMaster([
    { skuId: String(glove._id), quantity: 5, unit: 'Pcs' },
    { skuId: String(mask._id), quantity: 5 },
    { skuId: String(brush._id), quantity: 50 },
    { skuId: String(legacy._id), quantity: 4 },
  ]);
  check('glove and mask are indented in BOX; brush PCS; legacy keeps Nos; quantities as entered',
    JSON.stringify(bound.map((i) => [i.unit, i.quantity])) === JSON.stringify([['BOX', 5], ['BOX', 5], ['PCS', 50], ['Nos', 4]]),
    JSON.stringify(bound.map((i) => [i.unit, i.quantity])));

  // ── 3. PO ──────────────────────────────────────────────────────────────────
  section('3 PO keeps the purchase unit and the commercial value');
  await expectReject('a PO line in a unit the SKU cannot convert (KGS) is refused',
    svc.assertPurchaseUnits([{ skuId: glove._id, itemName: glove.name, unit: 'KGS' }]), /is in KGS, but SKU Master buys it in BOX \(1 BOX = 25 PCS\)/);
  await svc.assertPurchaseUnits([
    { skuId: glove._id, unit: 'Box' }, { skuId: glove._id, unit: 'Pcs' }, { skuId: brush._id, unit: 'KGS' }, { skuId: legacy._id, unit: 'PCS' },
  ]);
  check('BOX / PCS lines of a converting SKU, and any unit of a same-unit or legacy SKU, are accepted', true);
  const draftPo = await VendorPurchaseOrder.create({
    draftNumber: 'PO-UC-DRAFT', vendorId, vendorName: 'E2E Unit Vendor', approvalStatus: 'DRAFT', poStatus: 'DRAFT', poFormatType: 'OTHER',
    indentId: new mongoose.Types.ObjectId(),
    items: [{ skuId: glove._id, skuCode: glove.code, itemName: glove.name, unit: 'BOX', quantity: 5, rate: 250, gstRate: 18 }],
  });
  await expectReject('PO draft edit to an incompatible unit is refused by the PO service',
    svc.poService.update(String(draftPo._id), { items: [{ skuId: String(glove._id), skuCode: glove.code, itemName: glove.name, unit: 'KGS', quantity: 5, rate: 250, gstRate: 18 }] }, user),
    /buys it in BOX/);
  const poEdited = await svc.poService.update(String(draftPo._id), {
    items: [{ skuId: String(glove._id), skuCode: glove.code, itemName: glove.name, unit: 'BOX', quantity: 5, rate: 250, gstRate: 18 }],
  }, user);
  check('PO stays 5 BOX × ₹250 = ₹1250 taxable — never multiplied to PCS',
    poEdited.items[0].unit === 'BOX' && poEdited.items[0].quantity === 5 && poEdited.items[0].rate === 250 && poEdited.totalTaxableValue === 1250,
    `${poEdited.items[0].quantity} ${poEdited.items[0].unit} @ ${poEdited.items[0].rate} = ${poEdited.totalTaxableValue}`);
  const pdf = await svc.poService.previewPdf({ vendorName: 'E2E Unit Vendor', poFormatType: 'OTHER', items: poEdited.items.map((i) => ({ ...i.toObject?.() ?? i })) }).catch((e) => e);
  check('PO preview PDF renders for a BOX line', Buffer.isBuffer(pdf) && pdf.length > 1000,
    pdf instanceof Error ? pdf.message : `${typeof pdf} ${pdf?.constructor?.name} ${pdf?.length ?? ''}`);

  // ── 4. GRN ─────────────────────────────────────────────────────────────────
  section('4 GRN records BOX and freezes the conversion');
  const po1 = await mkPo('MAIN', [
    { sku: glove, unit: 'BOX', qty: 5, rate: 250 },
    { sku: mask, unit: 'BOX', qty: 5, rate: 100 },
    { sku: brush, unit: 'PCS', qty: 50, rate: 20 },
    { sku: legacy, unit: 'Nos', qty: 4, rate: 10 },
  ]);
  const g1 = await svc.grnService.create({ poId: String(po1._id), items: grnItems(po1, { unitOverride: 'Pcs' }) }, user);
  check('the PO line unit wins over a client-sent unit (GRN says BOX, not Pcs)', lineOf(g1, 'UC-GLOVE').unit === 'BOX' && lineOf(g1, 'UC-MASK').unit === 'BOX');
  check('draft lines carry the conversion: glove 5 BOX → 125 PCS (×25), mask 5 BOX → 120 PCS (×24)',
    lineOf(g1, 'UC-GLOVE').stockQty === 125 && lineOf(g1, 'UC-GLOVE').conversionFactor === 25 && lineOf(g1, 'UC-GLOVE').stockUnit === 'PCS'
    && lineOf(g1, 'UC-MASK').stockQty === 120 && lineOf(g1, 'UC-MASK').conversionFactor === 24);
  check('same-unit and legacy lines carry no conversion',
    [lineOf(g1, 'UC-BRUSH'), lineOf(g1, 'UC-LEGACY')].every((l) => l.conversionFactor == null && l.stockQty == null));
  check('GRN quantities, rate and value stay in BOX (5 × ₹250 = ₹1250)',
    lineOf(g1, 'UC-GLOVE').receivedQty === 5 && lineOf(g1, 'UC-GLOVE').rate === 250 && lineOf(g1, 'UC-GLOVE').amount === 1250);
  const movBefore = await InventoryMovement.countDocuments();
  const c1 = await svc.grnService.complete(String(g1._id), {}, user);
  check('GRN completion posts no stock', (await InventoryMovement.countDocuments()) === movBefore);
  check('…and freezes the conversion on each received line',
    lineOf(c1, 'UC-GLOVE').conversionFactor === 25 && lineOf(c1, 'UC-GLOVE').stockQty === 125 && lineOf(c1, 'UC-GLOVE').stockStatus === 'AWAITING_QC');
  const po1After = await VendorPurchaseOrder.findById(po1._id).lean();
  check('the PO is received in BOX (5 of 5), not PCS', po1After.items.find((i) => i.skuCode === 'UC-GLOVE').receivedQty === 5);
  const aw = await svc.awaitingQcBySku([glove._id, brush._id]);
  check('Awaiting QC is reported in the stock unit: glove 125 PCS, brush 50',
    aw.get(String(glove._id))?.qty === 125 && aw.get(String(brush._id))?.qty === 50, `${aw.get(String(glove._id))?.qty} / ${aw.get(String(brush._id))?.qty}`);
  await expectReject('completing the GRN again is refused', svc.grnService.complete(String(g1._id), {}, user), /already|Only draft|completed/i);

  // ── 5. Factor edited after receipt ─────────────────────────────────────────
  section('5 A factor edit after GRN completion does not reach it');
  await S.updateSku(String(glove._id), { purchaseConversionFactor: 30 }, user._id);
  check('SKU now says 1 BOX = 30 PCS', (await SKU.findById(glove._id).lean()).purchaseConversionFactor === 30);
  check('the completed GRN still says ×25', lineOf(await GoodsReceiptNote.findById(g1._id).lean(), 'UC-GLOVE').conversionFactor === 25);

  // ── 6. QC: the one conversion point ────────────────────────────────────────
  section('6 Incoming QC posts accepted BOX × frozen factor, once');
  await GoodsReceiptNote.updateOne({ _id: g1._id }, { $set: { approvalStatus: 'MD_APPROVED' } });
  const qc1 = await svc.qcService.create({ grnId: String(g1._id) }, user);
  check('QC lines show BOX with the frozen conversion', qc1.items.find((i) => i.skuCode === 'UC-GLOVE').unit === 'BOX'
    && qc1.items.find((i) => i.skuCode === 'UC-GLOVE').conversionFactor === 25 && qc1.items.find((i) => i.skuCode === 'UC-GLOVE').stockUnit === 'PCS');
  const done1 = await svc.qcService.complete(String(qc1._id), {}, user);
  const mv = Object.fromEntries((await movesOf(g1._id)).map((m) => [m.skuCode, m]));
  check('5 BOX → +125 PCS (frozen ×25, not the new ×30)', mv['UC-GLOVE']?.quantity === 125 && mv['UC-GLOVE']?.unit === 'PCS', `${mv['UC-GLOVE']?.quantity} ${mv['UC-GLOVE']?.unit}`);
  check('…the movement keeps the receipt figure: 5 BOX × 25',
    mv['UC-GLOVE']?.enteredQty === 5 && mv['UC-GLOVE']?.enteredUom === 'BOX' && mv['UC-GLOVE']?.conversionFactor === 25);
  check('…valued at exactly 5 × ₹250 = ₹1250 (₹10 per PCS)', mv['UC-GLOVE']?.lineValue === 1250 && mv['UC-GLOVE']?.unitCost === 10);
  check('mask: 5 BOX → +120 PCS at ₹4.166667, value exactly ₹500',
    mv['UC-MASK']?.quantity === 120 && mv['UC-MASK']?.unitCost === 4.166667 && mv['UC-MASK']?.lineValue === 500,
    `${mv['UC-MASK']?.quantity} @ ${mv['UC-MASK']?.unitCost} = ${mv['UC-MASK']?.lineValue}`);
  const maskStock = await stockOf(mask);
  check('mask stock value = on hand × avg cost = ₹500.00', r2(maskStock.qtyOnHand * maskStock.avgCost) === 500, `${maskStock.qtyOnHand} × ${maskStock.avgCost}`);
  check('brush (same unit) posts 50 PCS at ₹20, unchanged behaviour',
    mv['UC-BRUSH']?.quantity === 50 && mv['UC-BRUSH']?.unitCost === 20 && mv['UC-BRUSH']?.enteredQty == null && mv['UC-BRUSH']?.conversionFactor == null);
  check('legacy SKU posts 4 Nos 1:1', mv['UC-LEGACY']?.quantity === 4 && mv['UC-LEGACY']?.unit === 'Nos');
  const g1Done = await GoodsReceiptNote.findById(g1._id).lean();
  check('GRN line records posted 5 BOX = 125 PCS', lineOf(g1Done, 'UC-GLOVE').postedQty === 5 && lineOf(g1Done, 'UC-GLOVE').postedStockQty === 125);
  check('QC line records 125 PCS stocked', done1.items.find((i) => i.skuCode === 'UC-GLOVE').stockInQty === 125);
  check('glove on hand 125 PCS', (await onHand(glove)) === 125);

  const movCount = await InventoryMovement.countDocuments();
  await expectReject('completing the same QC again is refused', svc.qcService.complete(String(qc1._id), {}, user), /already completed|already exist/i);
  await expectReject('a second QC on the same GRN is refused', svc.qcService.create({ grnId: String(g1._id) }, user), /already exists|already has|QC pending/i);
  check('…and nothing was posted twice', (await InventoryMovement.countDocuments()) === movCount && (await onHand(glove)) === 125);

  // ── 7. IMS issue ───────────────────────────────────────────────────────────
  section('7 IMS issues in PCS');
  await svc.imsService.issue({ items: [{ skuId: String(glove._id), skuCode: glove.code, quantity: 10 }], reason: 'PRODUCTION_ISSUE' }, user);
  check('issue 10 PCS from 125 leaves 115', (await onHand(glove)) === 115);
  const row = (await svc.imsService.getOverview({})).docs.find((r) => r.skuCode === 'UC-GLOVE');
  check('IMS overview: on hand 115, awaiting QC 0, value 115 × ₹10 = ₹1150',
    row?.onHand === 115 && row?.awaitingQc === 0 && row?.stockValue === 1150, `${row?.onHand} / ${row?.awaitingQc} / ${row?.stockValue}`);
  await expectReject('issuing more than on hand is refused (in PCS)',
    svc.imsService.issue({ items: [{ skuId: String(glove._id), skuCode: glove.code, quantity: 116 }], reason: 'PRODUCTION_ISSUE' }, user), /Not enough stock/);

  // ── 8. A new receipt uses the new factor; history does not move ────────────
  section('8 A receipt after the edit uses ×30; earlier rows unchanged');
  const historyBefore = JSON.stringify(await movesOf(g1._id));
  const po2 = await mkPo('AFTER', [{ sku: glove, unit: 'BOX', qty: 2, rate: 300 }]);
  const g2 = await svc.grnService.create({ poId: String(po2._id), items: grnItems(po2) }, user);
  check('draft: 2 BOX → 60 PCS (×30)', lineOf(g2, 'UC-GLOVE').stockQty === 60 && lineOf(g2, 'UC-GLOVE').conversionFactor === 30);
  await svc.grnService.complete(String(g2._id), {}, user);
  await throughQc(svc, user, g2._id);
  check('+60 PCS → 175', (await onHand(glove)) === 175);
  check('the first GRN\'s movements are byte-for-byte unchanged', JSON.stringify(await movesOf(g1._id)) === historyBefore);
  const gloveStock = await stockOf(glove);
  check('avg cost stays consistent: (115 × ₹10 + 60 × ₹10) / 175 = ₹10', gloveStock.avgCost === 10, String(gloveStock.avgCost));

  // ── 9. Partial acceptance ──────────────────────────────────────────────────
  section('9 Partial acceptance converts only the accepted boxes');
  const po3 = await mkPo('PART', [{ sku: mask, unit: 'BOX', qty: 5, rate: 100 }]);
  const g3 = await svc.grnService.create({ poId: String(po3._id), items: grnItems(po3) }, user);
  await svc.grnService.complete(String(g3._id), {}, user);
  await throughQc(svc, user, g3._id, { 'UC-MASK': [3, 2] });
  const m3 = (await movesOf(g3._id))[0];
  check('3 of 5 BOX accepted → +72 PCS, value 3 × ₹100 = ₹300', m3?.quantity === 72 && m3?.lineValue === 300 && m3?.enteredQty === 3);
  const maskAfter = await stockOf(mask);
  check('mask: 192 PCS valued ₹800.00', maskAfter.qtyOnHand === 192 && r2(maskAfter.qtyOnHand * maskAfter.avgCost) === 800, `${maskAfter.qtyOnHand} × ${maskAfter.avgCost}`);

  // ── 10. Same-unit PO line for a converting SKU ─────────────────────────────
  section('10 A PO raised in the stock unit receives 1:1');
  const po4 = await mkPo('PCSLINE', [{ sku: glove, unit: 'PCS', qty: 40, rate: 9 }]);
  const g4 = await svc.grnService.create({ poId: String(po4._id), items: grnItems(po4) }, user);
  check('a PCS line of a BOX SKU carries no conversion', lineOf(g4, 'UC-GLOVE').conversionFactor == null);
  await svc.grnService.complete(String(g4._id), {}, user);
  await throughQc(svc, user, g4._id);
  check('+40 PCS → 215', (await onHand(glove)) === 215);

  // ── 11. Refusals at the GRN ────────────────────────────────────────────────
  section('11 Incompatible units and inexact fractions are refused at the GRN');
  const wopo = (sku, unit, qty) => svc.grnService.create({
    isWithoutPo: true, vendorId: String(vendorId), vendorName: 'E2E Unit Vendor',
    items: [{ skuId: String(sku._id), skuCode: sku.code, itemName: sku.name, unit, receivedQty: qty, invoiceQty: qty, rate: 10 }],
  }, user);
  await expectReject('W/O PO GRN for gloves in KGS is refused', wopo(glove, 'KGS', 3), /is in KGS, but SKU Master buys it in BOX/);
  await expectReject('0.33 PACK × 2.5 = 0.825 PCS is refused (would need rounding)', wopo(half, 'PACK', 0.33), /0\.825 PCS/);
  const gHalf = await wopo(half, 'PACK', 2);
  check('2 PACK × 2.5 = 5 PCS is accepted', lineOf(gHalf, 'UC-WIPE').stockQty === 5);
  await svc.grnService.complete(String(gHalf._id), {}, user);
  await expectReject('QC accepting 1.01 PACK (2.525 PCS) is refused at posting',
    throughQc(svc, user, gHalf._id, { 'UC-WIPE': [1.01, 0.99] }), /2\.525 PCS/);
  check('…nothing posted for it', (await InventoryMovement.countDocuments({ refId: gHalf._id })) === 0);

  // ── 12. Stock unit edits ───────────────────────────────────────────────────
  section('12 The stock unit cannot be relabelled under existing stock');
  await expectReject('glove stock unit PCS → BOX is refused while 215 PCS are held', S.updateSku(String(glove._id), { unit: 'BOX' }, user._id), /Stock Unit cannot change from PCS to BOX/);
  const relabel = await S.updateSku(String(glove._id), { unit: 'pcs' }, user._id);
  check('a spelling of the same unit (pcs) is allowed', relabel.unit === 'pcs' && (await onHand(glove)) === 215);
  await S.updateSku(String(glove._id), { unit: 'PCS' }, user._id);
  // Awaiting QC counts as stock for this rule.
  const brick = await S.createSku({ code: 'UC-BRICK', name: 'UC Brick', itemType: 'CONSUMABLE', unit: 'BOX' }, user._id);
  const po5 = await mkPo('BRICK', [{ sku: brick, unit: 'BOX', qty: 3, rate: 40 }]);
  const g5 = await svc.grnService.create({ poId: String(po5._id), items: grnItems(po5) }, user);
  await svc.grnService.complete(String(g5._id), {}, user);
  await expectReject('a SKU with goods awaiting QC cannot change its stock unit',
    S.updateSku(String(brick._id), { unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: 10 }, user._id), /awaiting Incoming QC/);

  // ── 13. Adjustment, return, ledger ─────────────────────────────────────────
  section('13 Adjustment, return to store and the item ledger are in PCS');
  await svc.stockCorrectionService.correct({ lines: [{ skuId: String(glove._id), warehouse: 'MAIN', systemQty: 215, physicalQty: 212 }], reason: 'cycle count' }, user);
  check('physical count 212 → ADJUST_OUT 3 PCS', (await onHand(glove)) === 212);
  await svc.imsService.receive({ items: [{ skuId: String(glove._id), quantity: 2, unitCost: 10 }], reason: 'OTHER', customReason: 'Returned unused from line' }, user);
  check('return of 2 PCS to store → 214', (await onHand(glove)) === 214);
  const ledger = await svc.imsService.getItemLedger(String(glove._id), { limit: 50 });
  const rows = ledger.docs || ledger.data || ledger.rows || [];
  check('every glove ledger row is in PCS', rows.length >= 6 && rows.every((m) => String(m.unit).toUpperCase() === 'PCS'), `${rows.length} rows: ${[...new Set(rows.map((m) => m.unit))].join(',')}`);
  check('ledger reconciles: every stock row equals the sum of its movements', (await reconcile()).length === 0);

  // ── 14. 1 BOX = 15 PCS, and the reversed entry the old form allowed ────────
  section('14 1 BOX = 15 PCS: direction, reopen, receipt, issue; reversed entries refused');
  await expectReject('the reported mistake (Stock Unit Box, Purchase Unit PCS, 15) is refused',
    S.createSku({ code: 'UC-REV-NEW', name: 'x', itemType: 'CONSUMABLE', unit: 'Box', purchaseUnit: 'PCS', purchaseConversionFactor: 15 }, user._id),
    /wrong way round/);
  await expectReject('a box holding half a piece is refused',
    S.createSku({ code: 'UC-HALFBOX', name: 'x', itemType: 'CONSUMABLE', unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: 0.5 }, user._id),
    /at least 1 PCS/);
  const cup = await S.createSku({ code: 'UC-CUP', name: 'UC Paper Cup', itemType: 'PACKAGING', unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: 15 }, user._id);
  const cupReopened = await S.getSkuById(String(cup._id));
  check('saved and reopened as Purchase BOX, factor 15, IMS stock PCS',
    cupReopened.purchaseUnit === 'BOX' && cupReopened.purchaseConversionFactor === 15 && cupReopened.unit === 'PCS');
  const po15 = await mkPo('CUP', [{ sku: cup, unit: 'BOX', qty: 5, rate: 150 }]);
  const g15 = await svc.grnService.create({ poId: String(po15._id), items: grnItems(po15) }, user);
  check('GRN shows 5 BOX', lineOf(g15, 'UC-CUP').unit === 'BOX' && lineOf(g15, 'UC-CUP').receivedQty === 5 && lineOf(g15, 'UC-CUP').stockQty === 75);
  await svc.grnService.complete(String(g15._id), {}, user);
  await throughQc(svc, user, g15._id);
  const m15 = (await movesOf(g15._id))[0];
  check('receipt of 5 BOX → +75 PCS in IMS (5 × 15), value 5 × ₹150 = ₹750',
    m15?.quantity === 75 && m15?.unit === 'PCS' && m15?.enteredQty === 5 && m15?.enteredUom === 'BOX' && m15?.lineValue === 750);
  await svc.imsService.issue({ items: [{ skuId: String(cup._id), skuCode: cup.code, quantity: 10 }], reason: 'PRODUCTION_ISSUE' }, user);
  const cupRow = (await svc.imsService.getOverview({})).docs.find((r) => r.skuCode === 'UC-CUP');
  check('issue 10 PCS → 65 PCS remaining; IMS lists it in PCS', (await onHand(cup)) === 65 && cupRow?.onHand === 65 && /^pcs$/i.test(cupRow?.unit || ''),
    `${cupRow?.onHand} ${cupRow?.unit}`);
  check('different SKUs keep their own factors (cup 15, mask 24, gloves 30)',
    (await SKU.findById(cup._id).lean()).purchaseConversionFactor === 15 && (await SKU.findById(mask._id).lean()).purchaseConversionFactor === 24
    && (await SKU.findById(glove._id).lean()).purchaseConversionFactor === 30);

  // A SKU saved the wrong way round before this fix (written around the model,
  // as the old form could) is refused everywhere downstream, never converted.
  await SKU.collection.insertOne({
    code: 'UC-REV-OLD', name: 'UC Reversed Old', itemType: 'CONSUMABLE', unit: 'Box', purchaseUnit: 'PCS', purchaseConversionFactor: 15,
    isDeleted: false, isActive: true, createdAt: new Date(), updatedAt: new Date(),
  });
  const revOld = await SKU.findOne({ code: 'UC-REV-OLD' }).lean();
  await expectReject('a reversed SKU on a PO is refused', svc.assertPurchaseUnits([{ skuId: revOld._id, itemName: revOld.name, unit: 'PCS' }]), /wrong way round/);
  await expectReject('a reversed SKU on a GRN is refused', wopo(revOld, 'PCS', 5), /wrong way round/);
  check('…and nothing was posted for it', (await InventoryMovement.countDocuments({ skuId: revOld._id })) === 0);
  const revFixed = await S.updateSku(String(revOld._id), { unit: 'PCS', purchaseUnit: 'Box', purchaseConversionFactor: 15 }, user._id);
  check('it can be corrected to 1 Box = 15 PCS (no stock held)', revFixed.unit === 'PCS' && revFixed.purchaseUnit === 'Box');

  // "No" on the conversion question.
  const plain = await S.updateSku(String(cup._id), { purchaseUnit: '', purchaseConversionFactor: null }, user._id);
  check('answering "No" stores no conversion; stock and history untouched',
    plain.purchaseUnit === '' && plain.purchaseConversionFactor === null && (await onHand(cup)) === 65
    && (await movesOf(g15._id))[0]?.quantity === 75);
  const po15b = await mkPo('CUP-PLAIN', [{ sku: cup, unit: 'PCS', qty: 30, rate: 10 }]);
  const g15b = await svc.grnService.create({ poId: String(po15b._id), items: grnItems(po15b) }, user);
  check('…a later receipt carries no conversion', lineOf(g15b, 'UC-CUP').conversionFactor == null);

  // ── Summary ────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.pass);
  console.log(`\n[unit-conversion] ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAILED: ${f.name}`);
    process.exitCode = 1;
  }
};

if (isEntry(import.meta.url)) {
  const MODE = (process.argv.find((a) => a.startsWith('--')) || '--api').slice(2);
  (MODE === 'api' ? runApi() : Promise.reject(new Error(`unknown mode --${MODE}`)))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
