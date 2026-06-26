/**
 * Rebuild every dispatch schedule's per-phase actuals from the source-of-truth
 * Delivery Challans. Repairs schedules whose phase `totalActualQty` drifted out
 * of sync with the challans (seeded/imported dispatches, legacy data).
 *
 * Safe & idempotent — replays each challan's qty across its phaseRefs
 * earliest-first, the same rule the live dispatch uses.
 *
 * Usage:
 *   node src/scripts/reconcile_schedule_actuals.js                 # all orders
 *   node src/scripts/reconcile_schedule_actuals.js "AGL/SO-040/26-27"  # one SO
 */

import mongoose from 'mongoose';
import env from '../config/env.js';
import { dispatchControlService } from '../modules/dispatch-control/dispatch-control.service.js';

const SO = process.argv[2] || null;

const run = async () => {
  await mongoose.connect(env.MONGO_URI);
  const res = await dispatchControlService.reconcileScheduleActuals(SO);
  console.log(`✅ Reconciled ${res.schedulesFixed} schedule(s) · applied ${res.challansApplied} challan(s)${SO ? ` for ${SO}` : ''}.`);
  await mongoose.connection.close();
  process.exit(0);
};
run().catch(async (e) => { console.error('❌ Reconcile failed:', e); await mongoose.connection.close().catch(() => {}); process.exit(1); });
