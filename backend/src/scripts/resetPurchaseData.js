/**
 * PURCHASE RESET — wipes every Purchase FMS record and restarts the purchase
 * number series at 001 (IND, PO, GRN, PI, ADV, PV, TLY, PAY, QC, SC, FU …).
 *
 *   node src/scripts/resetPurchaseData.js            CHECK  — reads only, prints what would go
 *   node src/scripts/resetPurchaseData.js --confirm  DELETE — no backup is taken; cannot be undone
 *
 * What goes:
 *   • every record of every Purchase FMS step (indent → final payment), soft-deleted ones too
 *   • their MD approvals, Purchase FMS tasks, PO-based vendor pricing history,
 *     purchase notifications and purchase Recycle Bin items
 *   • the stock GRNs brought into IMS: each purchase stock movement is taken
 *     back off its SKU's on-hand, then the movement is removed
 *   • RM conversions cut from those GRN coils, with their stock (coil out,
 *     circles in, scrap in) undone the same way and their scrap records removed
 *   • the purchase counters, so the next number of each series is 001
 * What stays: vendors, SKUs, parties and every other master; Purchase FMS doer
 * assignments; O2D, production plans, other IMS stock and movements; every
 * other number series (SO, DC, TI, MOV, RMC …); audit logs.
 *
 * DELETE refuses to run (nothing is changed) when taking the stock back would
 * push a SKU below zero (that stock was already used) — re-run with
 * --floor-at-zero to stop those SKUs at 0.
 * Everything runs in one transaction: it all happens, or none of it does.
 */
import dns from 'dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import PurchaseIndent from '../modules/procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import ProformaInvoice from '../modules/procurement/proforma-invoice/proformaInvoice.model.js';
import AdvancePayment from '../modules/procurement/advance-payment/advancePayment.model.js';
import GoodsReceiptNote from '../modules/procurement/grn/grn.model.js';
import IncomingQC from '../modules/procurement/incoming-qc/incomingQc.model.js';
import VendorInvoice from '../modules/procurement/vendor-invoice/vendorInvoice.model.js';
import VendorVoucher from '../modules/procurement/voucher/voucher.model.js';
import PurchaseTallyEntry from '../modules/procurement/tally-entry/tallyEntry.model.js';
import VendorFinalPayment from '../modules/procurement/final-payment/finalPayment.model.js';
import PurchaseFollowUp from '../modules/procurement/follow-up/followUp.model.js';
import RateChangeRequest from '../modules/procurement/rate-change/rateChange.model.js';
import RateChangeHistory from '../modules/procurement/rate-change/rateChangeHistory.model.js';
import ServiceCompletion from '../modules/procurement/service-completion/serviceCompletion.model.js';
import PurchaseCascadeDeletion from '../modules/procurement/cascade-delete/cascadeDelete.model.js';
import DocumentApproval, { APPROVAL_DOCUMENT_TYPE } from '../modules/approvals/approval.model.js';
import { FmsTask } from '../modules/fms-doers/fmsDoer.model.js';
import PricingHistory, { PRICING_SOURCE } from '../modules/vendors/pricingHistory.model.js';
import Notification from '../modules/notifications/notification.model.js';
import { RecycleBinItem } from '../modules/recycle-bin/recycleBin.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';

dotenv.config();

// Atlas `mongodb+srv://` needs an SRV lookup that some ISP resolvers refuse
// (querySrv ECONNREFUSED) — same public-resolver fix as config/db.js.
try {
  dns.setServers([...new Set(['1.1.1.1', '8.8.8.8', ...dns.getServers()])]);
} catch {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
}

const CONFIRM = process.argv.includes('--confirm');
const FLOOR_AT_ZERO = process.argv.includes('--floor-at-zero');

// Every row of these is purchase data.
const WHOLE = [
  PurchaseIndent, VendorPurchaseOrder, ProformaInvoice, AdvancePayment, GoodsReceiptNote, IncomingQC,
  VendorInvoice, VendorVoucher, PurchaseTallyEntry, VendorFinalPayment, PurchaseFollowUp,
  RateChangeRequest, RateChangeHistory, ServiceCompletion, PurchaseCascadeDeletion,
];

// Shared collections — only their purchase rows.
const PARTS = [
  { model: DocumentApproval, label: 'MD approvals', filter: { documentType: { $in: Object.values(APPROVAL_DOCUMENT_TYPE) } } },
  { model: FmsTask, label: 'Purchase FMS tasks', filter: { fmsKey: 'PURCHASE' } },
  {
    model: PricingHistory,
    label: 'Vendor pricing from POs / rate changes',
    filter: { source: { $in: [PRICING_SOURCE.PURCHASE_ORDER, PRICING_SOURCE.RATE_CHANGE_APPROVAL] } },
  },
  { model: Notification, label: 'Purchase notifications', filter: { link: { $regex: /^\/(procurement|purchase-fms)(\/|\?|$)/ } } },
  { model: RecycleBinItem, label: 'Purchase Recycle Bin items', filter: { module: 'purchase' } },
];

// Stock the purchase side posted into IMS (Incoming QC posts a GRN's stock).
const MOVEMENT_FILTER = { $or: [{ sourceModule: 'PURCHASE_FMS' }, { refType: { $in: ['GRN', 'INCOMING_QC'] } }] };

// The purchase number series (utils/docNumberGenerator.js), every financial year.
const COUNTER_FILTER = {
  _id: { $regex: /^((IND|AGL\/PO|AGL\/PO_DRAFT|RATE_CHANGE|FU|PI|ADV|PV|PUR|EXP|DPV|TLY|PAY|QC|SC|GRN)_\d{2}-\d{2}|PI_UNIQUE|GRN_UNIQUE)$/ },
};

const line = (label, n) => console.log(`   ${String(n).padStart(7)}  ${label}`);
const h = (title) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 62 - title.length))}`);
const round = (n) => Math.round(n * 1000) / 1000;

/** GRN stock to take back, per SKU + warehouse, against today's on-hand. */
async function stockPlan(movements) {
  const byStock = new Map();
  for (const m of movements) {
    const key = `${m.skuId}|${m.warehouse || 'MAIN'}`;
    if (!byStock.has(key)) {
      byStock.set(key, { skuId: m.skuId, warehouse: m.warehouse || 'MAIN', skuCode: m.skuCode, skuName: m.skuName, qty: 0, kg: 0 });
    }
    const s = byStock.get(key);
    s.qty += Number(m.qtyDelta || 0);
    if (m.qtyKgDelta != null) s.kg += Number(m.qtyKgDelta);
  }
  const rows = [...byStock.values()];
  const stocks = await InventoryStock.find({ skuId: { $in: rows.map((r) => r.skuId) } })
    .select('skuId warehouse qtyOnHand qtyOnHandKg').lean();
  for (const r of rows) {
    const st = stocks.find((x) => String(x.skuId) === String(r.skuId) && (x.warehouse || 'MAIN') === r.warehouse);
    r.stockId = st?._id || null;
    r.onHand = Number(st?.qtyOnHand || 0);
    r.onHandKg = Number(st?.qtyOnHandKg || 0);
    r.after = round(r.onHand - r.qty);
    r.afterKg = round(r.onHandKg - r.kg);
  }
  return rows;
}

const run = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set — nothing to reset.');
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log(`\nPURCHASE RESET  ·  ${CONFIRM ? 'DELETE' : 'CHECK (nothing is changed)'}  ·  database "${mongoose.connection.name}"`);

  h('Purchase records (all rows)');
  // Empty ones are left alone — RateChangeHistory, an append-only audit trail,
  // refuses even an empty delete.
  const toClear = [];
  for (const m of WHOLE) {
    const n = await m.countDocuments({});
    line(m.modelName, n);
    if (n) toClear.push(m);
  }

  h('Purchase rows in shared collections');
  for (const p of PARTS) line(p.label, await p.model.countDocuments(p.filter));

  h('Number series that restart at 001');
  const counters = mongoose.connection.collection('counters');
  const counterRows = await counters.find(COUNTER_FILTER).toArray();
  if (!counterRows.length) console.log('   (none yet)');
  counterRows.forEach((c) => line(c._id, `at ${c.seq}`));

  const MOVEMENT_FIELDS = 'skuId skuCode skuName warehouse qtyDelta qtyKgDelta';
  const grnMovements = await InventoryMovement.find(MOVEMENT_FILTER).select(MOVEMENT_FIELDS).lean();
  const grnIds = grnMovements.map((m) => m._id);

  // RM conversions cut from those GRN coils go too. Every stock row a
  // conversion wrote (coil out, circles in, scrap in) carries its number.
  h('RM conversions cut from GRN coils (deleted with them)');
  const conversions = grnIds.length
    ? await CoilConversion.find({ $or: [{ coilMovementId: { $in: grnIds } }, { coilReceiptId: { $in: grnIds } }] })
      .select('conversionNumber').lean()
    : [];
  const conversionIds = conversions.map((c) => c._id);
  const conversionMovements = conversions.length
    ? await InventoryMovement.find({
      refType: 'RM_CONVERSION',
      $or: [{ refNumber: { $in: conversions.map((c) => c.conversionNumber) } }, { refId: { $in: conversionIds } }],
    }).select(MOVEMENT_FIELDS).lean()
    : [];
  const scrapFilter = { conversionId: { $in: conversionIds } };
  if (!conversions.length) console.log('   none');
  else {
    console.log(`   ${conversions.map((c) => c.conversionNumber).join(', ')}`);
    line('conversion stock movements to remove', conversionMovements.length);
    line('scrap records to remove', await ScrapRecord.countDocuments(scrapFilter));
  }

  h('IMS stock taken back (GRNs + those conversions)');
  const movements = [...grnMovements, ...conversionMovements];
  const ids = movements.map((m) => m._id);
  line('stock movements to remove', movements.length);
  const plan = await stockPlan(movements);
  const negative = plan.filter((r) => r.after < 0);
  plan.forEach((r) => {
    const kg = r.kg ? `  ·  kg ${r.onHandKg} → ${r.afterKg}` : '';
    const mark = r.after < 0 ? '  ← BELOW ZERO (already used)' : r.stockId ? '' : '  ← no stock row';
    console.log(`   ${(r.skuCode || r.skuName || r.skuId).toString().padEnd(22)} ${r.warehouse.padEnd(8)} on hand ${r.onHand} − ${round(r.qty)} → ${r.after}${kg}${mark}`);
  });

  h('Blockers');
  if (negative.length) {
    console.log(`   ${negative.length} SKU(s) would go below zero${FLOOR_AT_ZERO ? ' — will stop at 0 (--floor-at-zero)' : ' — re-run with --floor-at-zero to stop them at 0'}`);
  } else console.log('   none');

  if (!CONFIRM) {
    console.log('\nCHECK only — nothing was changed. Re-run with --confirm to delete.\n');
    await mongoose.disconnect();
    return;
  }
  if (negative.length && !FLOOR_AT_ZERO) {
    console.log('\nREFUSED — nothing was changed. Clear the blockers above first.\n');
    await mongoose.disconnect();
    process.exit(1);
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const r of plan) {
        if (!r.stockId) continue;
        const update = r.after < 0
          ? { $set: { qtyOnHand: 0, qtyOnHandKg: Math.max(0, r.afterKg) } }
          : { $inc: { qtyOnHand: -r.qty, ...(r.kg ? { qtyOnHandKg: -r.kg } : {}) } };
        await InventoryStock.updateOne({ _id: r.stockId }, update, { session });
      }
      await InventoryMovement.deleteMany({ _id: { $in: ids } }, { session });
      if (conversionIds.length) {
        await ScrapRecord.deleteMany(scrapFilter, { session });
        await CoilConversion.deleteMany({ _id: { $in: conversionIds } }, { session });
      }
      for (const m of toClear) await m.deleteMany({}, { session });
      for (const p of PARTS) await p.model.deleteMany(p.filter, { session });
      await counters.deleteMany(COUNTER_FILTER, { session });
    });
  } finally {
    await session.endSession();
  }
  console.log(`\nDONE — purchase data deleted, GRN stock taken back${conversionIds.length ? `, ${conversionIds.length} RM conversion(s) undone` : ''}, purchase numbers restart at 001.\n`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  // Changes are made only inside the transaction, which a failure rolls back.
  console.error('\nFAILED — nothing was changed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
