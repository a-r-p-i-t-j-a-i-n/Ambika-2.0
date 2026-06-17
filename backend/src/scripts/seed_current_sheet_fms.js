/**
 * Seed the "Current Sheet FMS" (fmsKey = 'CURRENT_SHEET') — an exact mirror of
 * the 13-step flow the client runs in their live Google Sheet.
 *
 * Also performs the one-time migration that makes multi-FMS possible:
 *   1. Stamps every existing StepDefinition / TaskTemplate with fmsKey 'V1'
 *      (so "FMS 1.0" keeps showing its steps after the schema change).
 *   2. Syncs indexes — drops the old global `stepCode_1` unique index and builds
 *      the per-FMS compound unique index { fmsKey, stepCode }.
 *
 * Idempotent — re-running upserts by (fmsKey, stepCode). Safe to run repeatedly.
 *
 * Run:  node src/scripts/seed_current_sheet_fms.js
 */

import mongoose from 'mongoose';
import env from '../config/env.js';
import { StepDefinition, TaskTemplate } from '../modules/o2d-fms/o2d-fms.model.js';

const FMS_KEY = 'CURRENT_SHEET';

// Auto-advance triggers: when these real actions happen in the app, the matching
// step is picked up by the FMS bridge (advanceByTrigger) and surfaced in the
// tracker — so entries made directly in the modules still flow into the FMS.
const TRIGGERS = {
  '1.01': 'ORDER_INTAKE',     // order received / intake
  '2.02': 'ORDER_ENTRY',      // PO recd entry in Tally = sales order punch-in
  '2.04': 'DISPATCH_PLAN',    // create dispatch scheduler
  '2.06': 'ACTUAL_DISPATCH',  // create delivery challan
  '2.07': 'INVOICE',          // create invoice & e-way
  '2.09': 'POD',              // track delivery
  '2.11': 'PAYMENT',          // receive payment
};

// Mapped 1:1 from the client's sheet (Who / What / How / When per step).
// triggerKey stays MANUAL throughout — this catalog is tracked by hand and must
// NOT hook into V1's auto-advance bridges. SLAs are in minutes.
const STEPS = [
  { stepCode: '1.01', name: 'Order Received', sequence: 1, phase: 'PRE_PRODUCTION',
    ownerName: 'Upasana', ownerEmail: 'pc@msambikaglobal.in', tool: 'Order Form',
    whenText: 'Whenever Received', slaMinutes: 0, slaFrom: 'ORDER_RECEIVED' },

  { stepCode: '2.02', name: 'Purchase Order Recd Entry in Tally & Dispatch Vs PO', sequence: 2, phase: 'PRE_PRODUCTION',
    ownerName: 'Upasana', ownerEmail: 'pc@msambikaglobal.in', tool: 'Excel & Tally', slaMinutes: 60 },

  { stepCode: '2.03', name: 'Check Inventory', sequence: 3, phase: 'PRE_PRODUCTION',
    ownerName: 'Aarti', ownerEmail: 'imp@msambikaglobal.in', slaMinutes: 60 },

  { stepCode: '2.04', name: 'Create Dispatch Scheduler & Generate PDF', sequence: 4, phase: 'PLANNING',
    ownerName: 'Aarti', ownerEmail: 'imp@msambikaglobal.in', slaMinutes: 120, requiresLink: true },

  { stepCode: '2.05', name: 'Email Dispatch Schedule', sequence: 5, phase: 'PLANNING',
    ownerName: 'Aarti', ownerEmail: 'imp@msambikaglobal.in', tool: 'Mail', slaMinutes: 60 },

  { stepCode: '2.06', name: 'Final Qty to be dispatched (Create Delivery Challan)', sequence: 6, phase: 'EXECUTION',
    ownerName: 'Nidhi', ownerEmail: 'accounts@msambikaglobal.in', whenText: '10 days', slaMinutes: 14400 },

  { stepCode: '2.07', name: 'Create Invoice & Eway Bill', sequence: 7, phase: 'EXECUTION',
    ownerName: 'Upasana', ownerEmail: 'pc@msambikaglobal.in', tool: 'Tally', slaMinutes: 60, requiresLink: true },

  { stepCode: '2.08', name: 'Email Invoice & Eway Bill to Clients', sequence: 8, phase: 'EXECUTION',
    ownerName: 'Aarti', ownerEmail: 'imp@msambikaglobal.in', tool: 'Mail', slaMinutes: 60 },

  { stepCode: '2.09', name: 'Track delivery', sequence: 9, phase: 'POST_DISPATCH',
    ownerName: 'Upasana', ownerEmail: 'pc@msambikaglobal.in', slaMinutes: 1440 },

  { stepCode: '2.10', name: 'Follow up for Payment', sequence: 10, phase: 'POST_DISPATCH',
    ownerName: 'Upasana', ownerEmail: 'pc@msambikaglobal.in', tool: 'Telecommunication / Mail',
    whenText: 'After 1 day of delivery · 30-day credit', slaMinutes: 43200 },

  { stepCode: '2.11', name: 'Payment confirmation along with Tally Entry', sequence: 11, phase: 'POST_DISPATCH',
    ownerName: 'Bikeshwar / Tejaswini', ownerEmail: 'accounts@msambikaglobal.in', tool: 'Tally', slaMinutes: 60 },

  { stepCode: '2.12', name: 'Receive Transportation Bill', sequence: 12, phase: 'POST_DISPATCH',
    ownerName: 'Upasana', ownerEmail: 'pc@msambikaglobal.in', tool: 'Tally', slaMinutes: 60 },

  { stepCode: '2.13', name: 'Payment status for transportation bill', sequence: 13, phase: 'POST_DISPATCH',
    ownerName: 'Tejaswini', ownerEmail: 'accounts@msambikaglobal.in', tool: 'Tally', slaMinutes: 60 },
];

const run = async () => {
  await mongoose.connect(env.MONGO_URI);

  // 1. Migrate existing rows to the V1 catalog so FMS 1.0 keeps its steps.
  const defMig = await StepDefinition.updateMany({ fmsKey: { $exists: false } }, { $set: { fmsKey: 'V1' } });
  const tplMig = await TaskTemplate.updateMany({ fmsKey: { $exists: false } }, { $set: { fmsKey: 'V1' } });
  console.log(`↪︎  Migrated to V1 — ${defMig.modifiedCount} step defs, ${tplMig.modifiedCount} templates.`);

  // 2. Align indexes with the schema (drops global stepCode_1, builds {fmsKey,stepCode}).
  try {
    await StepDefinition.syncIndexes();
    await TaskTemplate.syncIndexes();
    console.log('↪︎  Indexes synced (per-FMS unique stepCode).');
  } catch (e) {
    console.warn('⚠️  syncIndexes warning:', e.message);
  }

  // 3. Upsert the Current Sheet FMS steps.
  let created = 0;
  let updated = 0;
  for (const step of STEPS) {
    const res = await StepDefinition.updateOne(
      { fmsKey: FMS_KEY, stepCode: step.stepCode },
      { $set: { ...step, fmsKey: FMS_KEY, triggerKey: TRIGGERS[step.stepCode] || 'MANUAL', isActive: true } },
      { upsert: true },
    );
    if (res.upsertedCount) created += 1;
    else if (res.modifiedCount) updated += 1;
  }

  console.log(`✅ Current Sheet FMS seeded — ${created} created, ${updated} updated, ${STEPS.length} total.`);
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('❌ Seed failed:', err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
