/**
 * Backfill O2DProcess for existing Sales Orders that don't have one yet.
 * Idempotent — buildProcessForOrder skips orders that already have a process.
 *
 * Run:  node src/scripts/backfill_o2d_fms_processes.js
 */

import mongoose from 'mongoose';
import env from '../config/env.js';
import SalesOrder from '../modules/order/order.model.js';
import { O2DProcess } from '../modules/o2d-fms/o2d-fms.model.js';
import { o2dFmsService } from '../modules/o2d-fms/o2d-fms.service.js';

const run = async () => {
  await mongoose.connect(env.MONGO_URI);

  const withProcess = await O2DProcess.distinct('salesOrderId');
  const orders = await SalesOrder.find({ _id: { $nin: withProcess } }).lean();

  let created = 0;
  for (const order of orders) {
    const proc = await o2dFmsService.buildProcessForOrder(order);
    if (proc) created += 1;
  }
  console.log(`✅ Backfill complete — ${created} process(es) created for ${orders.length} order(s) without one.`);
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('❌ Backfill failed:', err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
