/**
 * One-time repair for the O2D FMS "process silently not created" bug.
 *
 * Cause: the live `salesOrderId_1` index was unique but NOT sparse (and even
 * sparse indexes include explicit nulls). Both salesOrderId and intakeId
 * default to null, so the SECOND intake-only process (salesOrderId: null)
 * hit E11000 and the non-fatal hook swallowed it — intake saved, FMS never
 * started.
 *
 * This script:
 *   1. Replaces both indexes with PARTIAL unique indexes (only real ObjectIds).
 *   2. Backfills processes for intakes that missed theirs (NEW + CONVERTED),
 *      seeding from the current default template, and re-links converted ones
 *      to their Sales Order (advancing ORDER_INTAKE / ORDER_ENTRY).
 *   3. Backfills processes for Sales Orders without any process.
 *
 * Run:  node scripts/fix_o2dfms_indexes_and_backfill.js
 */
import mongoose from 'mongoose';
import env from '../src/config/env.js';

await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
const { O2DProcess } = await import('../src/modules/o2d-fms/o2d-fms.model.js');
const { o2dFmsService } = await import('../src/modules/o2d-fms/o2d-fms.service.js');
const { default: OrderIntake } = await import('../src/modules/order-intake/order-intake.model.js');
const { default: SalesOrder } = await import('../src/modules/order/order.model.js');

const col = mongoose.connection.db.collection('o2dprocesses');

// ── 1. Fix the indexes ───────────────────────────────────────────────────────
const existing = (await col.indexes()).map((i) => i.name);
for (const name of ['salesOrderId_1', 'intakeId_1']) {
  if (existing.includes(name)) {
    await col.dropIndex(name);
    console.log(`dropped bad index ${name}`);
  }
}
await col.createIndex({ salesOrderId: 1 }, { unique: true, partialFilterExpression: { salesOrderId: { $type: 'objectId' } } });
await col.createIndex({ intakeId: 1 },     { unique: true, partialFilterExpression: { intakeId: { $type: 'objectId' } } });
console.log('created partial unique indexes on salesOrderId / intakeId');

// ── 2. Backfill intakes that have no process ─────────────────────────────────
const intakes = await OrderIntake.find({ isDeleted: { $ne: true }, intakeStatus: { $in: ['NEW', 'CONVERTED'] } }).lean();
let made = 0, linked = 0;
for (const intake of intakes) {
  const has = await O2DProcess.findOne({ intakeId: intake._id }).select('_id salesOrderId').lean();
  if (!has) {
    const proc = await o2dFmsService.buildProcessForIntake(intake);
    if (proc) { made += 1; console.log(`backfilled process for ${intake.intakeNo} (${intake.partyName})`); }
  }
  // Converted but the process isn't linked to the SO yet → link + advance ORDER_ENTRY.
  if (intake.intakeStatus === 'CONVERTED' && intake.linkedSalesOrderId) {
    const proc = await O2DProcess.findOne({ intakeId: intake._id }).select('salesOrderId').lean();
    if (proc && !proc.salesOrderId) {
      const order = await SalesOrder.findById(intake.linkedSalesOrderId).lean();
      if (order) {
        await o2dFmsService.linkIntakeProcessToOrder(intake._id, order);
        linked += 1;
        console.log(`linked ${intake.intakeNo} → ${order.soNumber}`);
      }
    }
  }
}

// ── 3. Backfill Sales Orders that have no process at all ────────────────────
const orders = await SalesOrder.find({ isDeleted: { $ne: true } }).lean();
let soMade = 0;
for (const order of orders) {
  const has = await O2DProcess.findOne({ salesOrderId: order._id }).select('_id').lean();
  if (!has) {
    const proc = await o2dFmsService.buildProcessForOrder(order);
    if (proc) {
      // The order is already entered in the system — advance its ORDER_ENTRY step.
      try { await o2dFmsService.advanceByTrigger({ processId: proc._id }, 'ORDER_ENTRY', order.createdBy ? { _id: order.createdBy } : null); } catch { /* non-fatal */ }
      soMade += 1;
      console.log(`backfilled process for SO ${order.soNumber} (${order.partyName})`);
    }
  }
}

console.log(`\nDone. intake processes created: ${made}, linked to SO: ${linked}, SO processes created: ${soMade}`);
await mongoose.disconnect();
