/**
 * Demo enablement for O2D FMS:
 *   1. Create one user per operational role (idempotent by email) so the step
 *      catalog's role-based owners resolve to real people.
 *   2. Re-resolve `assignedTo` on every existing O2DProcess step from the
 *      catalog defaults, so already-backfilled orders get owners too.
 *
 * Run:  node src/scripts/seed_o2d_fms_demo.js
 * Demo password for all created users: Demo@1234
 */

import mongoose from 'mongoose';
import env from '../config/env.js';
import User from '../modules/auth/auth.model.js';
import { StepDefinition, O2DProcess } from '../modules/o2d-fms/o2d-fms.model.js';

const DEMO_PASSWORD = 'Demo@1234';

// roles[] uses v2 Role.key; role is the required legacy enum (back-compat).
const DEMO_USERS = [
  { name: 'Priya Planner',      email: 'planner@demo.agl',  mobile: '9000000001', roles: ['PLANNER'],             role: 'Process Coordinator' },
  { name: 'Sanjay Sales',       email: 'sales@demo.agl',    mobile: '9000000002', roles: ['SALES_EXEC'],          role: 'EA' },
  { name: 'Deepak Dispatch',    email: 'dispatch@demo.agl', mobile: '9000000003', roles: ['DISPATCH_SUPERVISOR'], role: 'Store Manager' },
  { name: 'Farah Finance',      email: 'finance@demo.agl',  mobile: '9000000004', roles: ['FINANCE'],             role: 'Accountant' },
];

const resolveOwner = async (def) => {
  if (def.defaultOwnerUserId) return def.defaultOwnerUserId;
  if (def.defaultOwnerRole) {
    const u = await User.findOne({
      isActive: true,
      $or: [{ roles: def.defaultOwnerRole }, { role: def.defaultOwnerRole }],
    }).select('_id').lean();
    return u?._id || null;
  }
  return null;
};

const run = async () => {
  await mongoose.connect(env.MONGO_URI);

  // 1) Create demo users (password is hashed by the model pre-save hook).
  let createdUsers = 0;
  for (const u of DEMO_USERS) {
    const existing = await User.findOne({ email: u.email });
    if (existing) {
      if (!existing.roles?.length || existing.roles[0] !== u.roles[0]) {
        existing.roles = u.roles;
        await existing.save({ validateModifiedOnly: true });
      }
      continue;
    }
    await User.create({ ...u, password: DEMO_PASSWORD, isActive: true });
    createdUsers += 1;
  }

  // 2) Build stepCode -> ownerUserId map from the active catalog.
  const defs = await StepDefinition.find({ isActive: true, isDeleted: { $ne: true } }).lean();
  const ownerByStep = new Map();
  for (const def of defs) ownerByStep.set(def.stepCode, await resolveOwner(def));

  // 3) Re-resolve assignedTo on every process step.
  const processes = await O2DProcess.find({ isDeleted: { $ne: true } });
  let touched = 0;
  for (const p of processes) {
    let changed = false;
    for (const s of p.steps) {
      const owner = ownerByStep.get(s.stepCode) || null;
      if (String(s.assignedTo || '') !== String(owner || '')) { s.assignedTo = owner; changed = true; }
    }
    if (changed) { await p.save(); touched += 1; }
  }

  console.log(`✅ Demo enablement done — users created:${createdUsers}, processes re-assigned:${touched}.`);
  console.log('   Logins (password Demo@1234): planner@demo.agl, sales@demo.agl, dispatch@demo.agl, finance@demo.agl');
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('❌ Demo enablement failed:', err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
