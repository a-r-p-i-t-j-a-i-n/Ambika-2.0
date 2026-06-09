/**
 * Seed the O2D FMS StepDefinition catalog (the "Who / What / How / When" layer).
 *
 * Idempotent — upserts by stepCode, so re-running updates the catalog in place.
 * Owners are resolved by role key at runtime (see o2d-fms.service.resolveOwner),
 * so we seed `defaultOwnerRole`; a per-order override is still possible in the UI.
 *
 * Run:  node src/scripts/seed_o2d_fms_steps.js
 */

import mongoose from 'mongoose';
import env from '../config/env.js';
import { StepDefinition } from '../modules/o2d-fms/o2d-fms.model.js';

// Mapped from the client's O2D FMS Google Sheet. Execution / post-dispatch steps
// mirror the 13-step lifecycle already modelled on the order. SLAs in minutes.
// defaultOwnerRole uses the v2 Role.key set (see access-control/role.seed.js):
// PLANNER, SALES_EXEC, DISPATCH_SUPERVISOR, FINANCE, VIEWER, MD.
const STEPS = [
  // ── Pre-production ──────────────────────────────────────────────
  { stepCode: '1.01', name: 'Order Received (Call / Email / WhatsApp)', sequence: 1, phase: 'PRE_PRODUCTION', tool: 'Order Intake',
    defaultOwnerRole: 'SALES_EXEC',          slaMinutes: 0,   slaFrom: 'ORDER_RECEIVED', triggerKey: 'ORDER_INTAKE' },
  { stepCode: '2.02', name: 'Sales Order Entry (Tally & Dispatch vs PO)', sequence: 2, phase: 'PRE_PRODUCTION', tool: 'Excel & Tally',
    defaultOwnerRole: 'SALES_EXEC',          slaMinutes: 60,  slaFrom: 'PREV_ACTUAL', triggerKey: 'ORDER_ENTRY' },
  { stepCode: '2.03', name: 'Check Inventory',           sequence: 3,  phase: 'PRE_PRODUCTION',
    defaultOwnerRole: 'DISPATCH_SUPERVISOR', slaMinutes: 60,  slaFrom: 'PREV_ACTUAL', triggerKey: 'MANUAL' },
  { stepCode: '2.04', name: 'Payment / Credit Check',    sequence: 4,  phase: 'PRE_PRODUCTION',
    defaultOwnerRole: 'FINANCE',             slaMinutes: 120, slaFrom: 'PREV_ACTUAL', triggerKey: 'MANUAL' },

  // ── Planning ────────────────────────────────────────────────────
  { stepCode: '2.05', name: 'Create Dispatch Scheduler & Generate PDF', sequence: 5, phase: 'PLANNING',
    defaultOwnerRole: 'PLANNER',             slaMinutes: 120, slaFrom: 'PREV_ACTUAL', requiresLink: true, triggerKey: 'DISPATCH_PLAN' },
  { stepCode: '2.06', name: 'Email Dispatch Schedule',   sequence: 6,  phase: 'PLANNING',
    defaultOwnerRole: 'PLANNER',             slaMinutes: 60,  slaFrom: 'PREV_ACTUAL', triggerKey: 'MANUAL' },

  // ── Execution ───────────────────────────────────────────────────
  { stepCode: '3.01', name: 'Production Follow-up',      sequence: 7,  phase: 'EXECUTION',
    defaultOwnerRole: 'PLANNER',             slaMinutes: 1440, slaFrom: 'PREV_ACTUAL', triggerKey: 'MANUAL' },
  { stepCode: '3.02', name: 'Loading Advice',            sequence: 8,  phase: 'EXECUTION',
    defaultOwnerRole: 'DISPATCH_SUPERVISOR', slaMinutes: 240,  slaFrom: 'PREV_ACTUAL', triggerKey: 'MANUAL' },
  { stepCode: '3.03', name: 'Loading Follow-up',         sequence: 9,  phase: 'EXECUTION',
    defaultOwnerRole: 'DISPATCH_SUPERVISOR', slaMinutes: 240,  slaFrom: 'PREV_ACTUAL', triggerKey: 'MANUAL' },
  { stepCode: '3.04', name: 'Invoicing',                 sequence: 10, phase: 'EXECUTION', tool: 'Tally',
    defaultOwnerRole: 'FINANCE',             slaMinutes: 120,  slaFrom: 'PREV_ACTUAL', requiresLink: true, triggerKey: 'INVOICE' },
  { stepCode: '3.05', name: 'Dispatch Details (Vehicle/LR)', sequence: 11, phase: 'EXECUTION',
    defaultOwnerRole: 'DISPATCH_SUPERVISOR', slaMinutes: 120,  slaFrom: 'PREV_ACTUAL', triggerKey: 'ACTUAL_DISPATCH' },

  // ── Post-dispatch ───────────────────────────────────────────────
  { stepCode: '4.01', name: 'POD Follow-up',             sequence: 12, phase: 'POST_DISPATCH',
    defaultOwnerRole: 'DISPATCH_SUPERVISOR', slaMinutes: 4320, slaFrom: 'PREV_ACTUAL', triggerKey: 'POD' },
  { stepCode: '4.02', name: 'Payment Follow-up',         sequence: 13, phase: 'POST_DISPATCH',
    defaultOwnerRole: 'FINANCE',             slaMinutes: 4320, slaFrom: 'PREV_ACTUAL', triggerKey: 'PAYMENT' },
];

const run = async () => {
  await mongoose.connect(env.MONGO_URI);
  let created = 0;
  let updated = 0;
  for (const step of STEPS) {
    const res = await StepDefinition.updateOne(
      { stepCode: step.stepCode },
      { $set: { ...step, isActive: true } },
      { upsert: true },
    );
    if (res.upsertedCount) created += 1;
    else if (res.modifiedCount) updated += 1;
  }
  console.log(`✅ O2D FMS step catalog seeded — ${created} created, ${updated} updated, ${STEPS.length} total.`);
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('❌ Seed failed:', err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
