/**
 * Seed the DEFAULT Task Template for the Current Sheet FMS (fmsKey CURRENT_SHEET).
 *
 * Builds one template step per catalog step with: a task title, instructions, a
 * focused checklist, the connected system-action link (so the doer does the real
 * entry first, then returns to auto-tick the checklist), and the doer resolved
 * from the step's ownerEmail (when that person exists as a system user).
 *
 * Idempotent — re-running updates the same template in place and keeps it the
 * sole default for this FMS. Run AFTER seed_current_sheet_fms.js:
 *   node src/scripts/seed_current_sheet_fms_template.js
 */
import mongoose from 'mongoose';
import env from '../config/env.js';
import { StepDefinition, TaskTemplate } from '../modules/o2d-fms/o2d-fms.model.js';
import User from '../modules/auth/auth.model.js';

const FMS_KEY = 'CURRENT_SHEET';
const TEMPLATE_NAME = 'Current Sheet — Standard Flow';

// The sheet's owners as login accounts, so the FMS can auto-assign them and they
// receive tasks. Created idempotently by email; default password below.
const OWNER_PASSWORD = '123456';
const OWNER_USERS = {
  'pc@msambikaglobal.in':       { name: 'Upasana',       mobile: '9000000011', roles: ['SALES_EXEC'],          role: 'Process Coordinator' },
  'imp@msambikaglobal.in':      { name: 'Aarti',         mobile: '9000000012', roles: ['DISPATCH_SUPERVISOR'], role: 'Process Coordinator' },
  'accounts@msambikaglobal.in': { name: 'Accounts Team', mobile: '9000000013', roles: ['FINANCE'],             role: 'Accountant' },
};

// Per-step task config: connected system-action link(s) (registry keys in
// actionLinks.js) + checklist. A step may carry SEVERAL links — each renders its
// own "Do it now" on the task and is tracked done independently (none mandatory).
const STEP_CONFIG = {
  '1.01': { actionLinks: ['ORDER_ENTRY'],     checklist: ['Confirm PO number & party', 'Verify ordered quantities', 'Save the order form / link'] },
  '2.02': { actionLinks: ['ORDER_ENTRY'],     checklist: ['Enter the PO in Tally', 'Reconcile dispatch vs PO'] },
  '2.03': { actionLinks: ['PPC'],             checklist: ['Check finished-goods stock', 'Confirm availability or flag shortfall'] },
  // Two connected screens: plan it in Dispatch Planning, then generate the PDF.
  '2.04': { actionLinks: ['DISPATCH_PLAN', 'DISPATCH_PLAN_PDF'], checklist: ['Create the dispatch schedule', 'Generate the dispatch plan PDF'] },
  '2.05': { actionLinks: ['EMAIL_DISPATCH_SCHEDULE'], checklist: ['Email the dispatch schedule to the client'] },
  '2.06': { actionLinks: ['CHALLAN_PDF'],     checklist: ['Confirm final dispatch quantity', 'Create the delivery challan', 'Generate the challan PDF'] },
  '2.07': { actionLinks: ['INVOICE_ENTRY'],   checklist: ['Create the tax invoice in Tally', 'Generate the e-way bill', 'Attach invoice, e-way & PDIR'] },
  '2.08': { actionLinks: ['INVOICE_EMAIL'],   checklist: ['Email invoice & e-way bill to the client'] },
  '2.09': { actionLinks: ['TRACK_DELIVERY'],  checklist: ['Confirm delivery / POD', 'Record the delivery date'] },
  '2.10': { actionLinks: ['PAYMENT_FOLLOWUP'],       checklist: ['Follow up with the client for payment'] },
  '2.11': { actionLinks: ['PAYMENT_RECEIPT'],        checklist: ['Confirm payment received', 'Enter the receipt in Tally'] },
  '2.12': { actionLinks: ['TRANSPORT_BILL_RECEIVE'], checklist: ['Receive the transporter bill', 'Attach the transport invoice'] },
  '2.13': { actionLinks: ['TRANSPORT_BILL_STATUS'],  checklist: ['Confirm the transporter payment status'] },
};

const run = async () => {
  await mongoose.connect(env.MONGO_URI);

  const defs = await StepDefinition.find({ fmsKey: FMS_KEY, isDeleted: { $ne: true } }).sort({ sequence: 1 }).lean();
  if (!defs.length) {
    console.error('❌ No CURRENT_SHEET steps found. Run seed_current_sheet_fms.js first.');
    await mongoose.connection.close();
    process.exit(1);
  }

  // Ensure the sheet's owners exist as login accounts (idempotent by email).
  let createdUsers = 0;
  for (const [email, meta] of Object.entries(OWNER_USERS)) {
    const existing = await User.findOne({ email });
    if (existing) continue;
    try {
      await User.create({ ...meta, email, password: OWNER_PASSWORD, isActive: true });
      createdUsers += 1;
    } catch (e) {
      console.warn(`   ⚠️  Could not create user ${email}: ${e.message}`);
    }
  }

  // Resolve each step's owner email → system user (so doers get the task live).
  let assigned = 0;
  let unresolved = [];
  const steps = [];
  for (const def of defs) {
    const cfg = STEP_CONFIG[def.stepCode] || { actionLinks: [], checklist: [] };
    let assigneeUserIds = [];
    if (def.ownerEmail) {
      const u = await User.findOne({ email: new RegExp(`^${def.ownerEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('_id').lean();
      if (u) { assigneeUserIds = [u._id]; assigned += 1; }
      else unresolved.push(`${def.stepCode} (${def.ownerEmail})`);
    }
    steps.push({
      stepCode: def.stepCode,
      taskTitle: def.name,
      instructions: `${def.name}${def.tool ? ` — via ${def.tool}` : ''}. Owner: ${def.ownerName || def.ownerEmail || '—'}.`,
      checklist: cfg.checklist.map((text) => ({ text })),
      actionLinks: cfg.actionLinks || [],
      actionLink: (cfg.actionLinks || [])[0] || null, // legacy single mirror
      assigneeUserIds,
      buddyUserIds: [],
    });
  }

  // Upsert + make it the sole default for this FMS.
  await TaskTemplate.updateMany({ fmsKey: FMS_KEY, isDefault: true }, { $set: { isDefault: false } });
  const existing = await TaskTemplate.findOne({ fmsKey: FMS_KEY, name: TEMPLATE_NAME });
  if (existing) {
    existing.steps = steps; existing.isDefault = true; existing.isActive = true;
    existing.description = 'Auto-built standard flow for the Current Sheet FMS.';
    await existing.save();
    console.log(`↻  Updated template "${TEMPLATE_NAME}".`);
  } else {
    await TaskTemplate.create({
      fmsKey: FMS_KEY, name: TEMPLATE_NAME, description: 'Auto-built standard flow for the Current Sheet FMS.',
      isDefault: true, isActive: true, steps,
    });
    console.log(`✅ Created template "${TEMPLATE_NAME}".`);
  }

  console.log(`   ${steps.length} steps · ${assigned} doers auto-assigned · ${createdUsers} owner account(s) created.`);
  if (createdUsers) console.log(`   Owner logins (password ${OWNER_PASSWORD}): ${Object.keys(OWNER_USERS).join(', ')}`);
  if (unresolved.length) console.log(`   ⚠️  No system user for: ${unresolved.join(', ')} — assign them in Task Templates or create those users.`);
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('❌ Seed failed:', err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
