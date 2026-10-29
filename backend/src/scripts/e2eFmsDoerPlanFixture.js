/**
 * Fixture + oracle for Purchase FMS Doer Assignment working like O2D's:
 *   - the plan grid (lead time · main doers · buddies per step), saved together
 *     (GET/PUT /fms-doers/plan/PURCHASE, POST …/apply-open);
 *   - tasks that snapshot several doers + buddies and a due date;
 *   - My / All FMS Tasks rows that link to the record their step is done on,
 *     worked out and checked on the server (fmsTaskLinks.js).
 *
 *   node src/scripts/e2eFmsDoerPlanFixture.js --seed   idempotent upserts (NEVER drops)
 *   node src/scripts/e2eFmsDoerPlanFixture.js --api    HTTP checks (API_URL, default :5099);
 *                                                      re-runnable — every run makes its own indents
 *
 * Browser side: frontend/e2e/fmsDoerPlan.e2e.mjs (run after --seed and --api).
 *
 * Seed: a manager (MD, root) and four doers with no role (so they hold no
 * permission — PO Approval's procurement.approve is missing for them), one
 * inactive user, one SKU and one vendor.
 *
 * SAFETY: pinned to a localhost scratch database behind the shared e2e guard
 * (S3 + email must be off). It never reads MONGO_URI and never drops anything.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import { FmsTask } from '../modules/fms-doers/fmsDoer.model.js';

export const DB_NAME = 'ambika_e2e_fmsdoerplan';
export const E2E_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eFmsDoerPlanFixture.js');
const PASSWORD = 'E2e@12345';
export const USERS = {
  MANAGER: { email: 'fmsplan-e2e@test.local', name: 'FP Manager', role: 'MD', roles: ['MD'], mobile: '9000000081' },
  A: { email: 'fp-asha@test.local', name: 'FP Asha', role: 'Store Manager', roles: [], mobile: '9000000082' },
  B: { email: 'fp-bala@test.local', name: 'FP Bala', role: 'Store Manager', roles: [], mobile: '9000000083' },
  C: { email: 'fp-chitra@test.local', name: 'FP Chitra', role: 'Store Manager', roles: [], mobile: '9000000084' },
  D: { email: 'fp-dev@test.local', name: 'FP Dev', role: 'Store Manager', roles: [], mobile: '9000000085' },
  OFF: { email: 'fp-off@test.local', name: 'FP Inactive', role: 'Store Manager', roles: [], mobile: '9000000086', isActive: false },
};
export const SKU_DEF = { code: 'FP-BOLT', name: 'FP Bolt M10', unit: 'PCS', itemType: 'CONSUMABLE' };
export const VENDOR = 'FP Vendor One';
const API = (process.env.API_URL || 'http://127.0.0.1:5099/api/v1').replace(/\/+$/, '');
const RUN = Date.now().toString(36).toUpperCase();

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) throw new Error('Connected to an unexpected database — aborting.');
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const finish = async () => {
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
};

// ── Seed (upserts only) ─────────────────────────────────────────────────────
const seed = async () => {
  await connect();
  for (const u of Object.values(USERS)) {
    const found = await User.findOne({ email: u.email });
    if (!found) await User.create({ ...u, password: PASSWORD, isActive: u.isActive !== false });
    else await User.updateOne({ _id: found._id }, { $set: { name: u.name, role: u.role, roles: u.roles, isActive: u.isActive !== false } });
  }
  await SKU.updateOne({ code: SKU_DEF.code }, { $set: { ...SKU_DEF, isActive: true, isDeleted: false } }, { upsert: true });
  await Vendor.updateOne({ name: VENDOR }, { $set: { name: VENDOR, isActive: true } }, { upsert: true });
  console.log(JSON.stringify({ ok: true, db: DB_NAME, login: USERS.MANAGER.email, doers: [USERS.A.email, USERS.B.email, USERS.C.email] }, null, 2));
  await mongoose.disconnect();
};

// ── HTTP helpers ────────────────────────────────────────────────────────────
const tokens = {};
const call = async (method, path, body, { as = 'MANAGER' } = {}) => {
  const t = as ? tokens[as] : '';
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, data: json?.data, meta: json?.meta, message: json?.message || '' };
};
const ok = async (method, path, body, opts) => {
  const r = await call(method, path, body, opts);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${r.message}`);
  return r.data;
};
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const ids = (list) => (list || []).map((u) => String(u?._id || u?.id || u)).sort();
const same = (a, b) => JSON.stringify(ids(a)) === JSON.stringify(ids(b));

/** Wait for the (background) task sync to open a task for this record at this step. */
const waitTask = async (stepKey, ref, { status = 'OPEN' } = {}) => {
  for (let i = 0; i < 40; i += 1) {
    const r = await call('GET', `/fms-doers/tasks?status=${status}&stepKey=${stepKey}&search=${encodeURIComponent(ref)}&limit=50`);
    const t = (r.data || []).find((x) => x.entityRef === ref);
    if (t) return t;
    if (i === 5) await call('POST', '/fms-doers/sync');
    await sleep(250);
  }
  return null;
};
const savePlan = (steps, extra = {}) => call('PUT', '/fms-doers/plan/PURCHASE', { steps, ...extra });

const api = async () => {
  await connect();
  for (const k of ['MANAGER', 'A', 'B', 'C', 'D']) {
    const r = await call('POST', '/auth/login', { email: USERS[k].email, password: PASSWORD }, { as: null });
    tokens[k] = r.data?.token || '';
  }
  check('everyone logs in', Object.values(tokens).every(Boolean));
  const U = Object.fromEntries(await Promise.all(Object.entries(USERS).map(async ([k, u]) => [k, String((await User.findOne({ email: u.email }).lean())._id)])));
  const sku = await SKU.findOne({ code: SKU_DEF.code }).lean();
  const vendor = await Vendor.findOne({ name: VENDOR }).lean();

  // ── Plan grid ──
  const plan0 = await call('GET', '/fms-doers/plan/PURCHASE');
  const steps0 = plan0.data?.steps || [];
  check('plan lists every Purchase step with lead time / doers / buddies', plan0.status === 200 && steps0.length === 16
    && steps0.every((s) => 'leadTime' in s && Array.isArray(s.doers) && Array.isArray(s.buddies) && s.openTasks), `${steps0.length} steps`);
  const users = await call('GET', '/fms-doers/plan/PURCHASE/users');
  const userD = (users.data || []).find((u) => u.id === U.D);
  check('people list = active ERP users, with the step permissions they lack',
    users.status === 200 && userD && !(users.data || []).some((u) => u.id === U.OFF)
    && (userD.missingByStep?.PO_APPROVAL || []).includes('procurement.approve'));

  check('doers cannot open the setup (fms.manageDoers)', (await call('GET', '/fms-doers/plan/PURCHASE', null, { as: 'A' })).status === 403);
  check('overlap main doer / buddy → 400', (await savePlan([{ stepKey: 'INDENT_CREATE', doerIds: [U.A], buddyIds: [U.A] }])).status === 400);
  check('inactive person → 400', (await savePlan([{ stepKey: 'INDENT_CREATE', doerIds: [U.OFF] }])).status === 400);
  check('unknown step → 400', (await savePlan([{ stepKey: 'NOT_A_STEP', doerIds: [U.A] }])).status === 400);
  check('lead time 0 → 422', (await savePlan([{ stepKey: 'INDENT_CREATE', doerIds: [U.A], leadTime: { value: 0, unit: 'HOURS' } }])).status === 422);
  check('O2D cannot be saved through the Purchase plan', (await call('PUT', '/fms-doers/plan/O2D', { steps: [{ stepKey: 'X', doerIds: [] }] })).status === 400);
  const noPerm = await savePlan([{ stepKey: 'PO_APPROVAL', doerIds: [U.D] }]);
  check('a doer lacking the step permission needs confirming (409)', noPerm.status === 409 && /procurement\.approve/.test(noPerm.message), noPerm.message);
  const acked = await savePlan([{ stepKey: 'PO_APPROVAL', doerIds: [U.D], leadTime: { value: 3, unit: 'HOURS' } }], { acknowledgeMissingPermission: true });
  check('…and saves once confirmed', acked.status === 200);

  const saved = await savePlan([
    { stepKey: 'INDENT_CREATE', doerIds: [U.A, U.B], buddyIds: [U.C], leadTime: { value: 2, unit: 'HOURS' } },
    { stepKey: 'INDENT_APPROVAL', doerIds: [U.A], buddyIds: [], leadTime: { value: 1, unit: 'DAYS' } },
  ]);
  check('plan saves several steps in one go', saved.status === 200);
  const plan1 = (await call('GET', '/fms-doers/plan/PURCHASE')).data?.steps || [];
  const create = plan1.find((s) => s.stepKey === 'INDENT_CREATE');
  check('saved setup reads back (doers, buddy, lead time)', same(create?.doers, [U.A, U.B]) && same(create?.buddies, [U.C])
    && create?.leadTime?.value === 2 && create?.leadTime?.unit === 'HOURS');
  const hist = await call('GET', '/fms-doers/assignments/PURCHASE/INDENT_CREATE/history');
  check('the change is in the step history with the whole setup', /Main doers: FP Asha, FP Bala · Buddies: FP Chitra · Lead time: 2 hours/.test(hist.data?.[0]?.detail || ''), hist.data?.[0]?.detail);
  const resave = await savePlan([{ stepKey: 'INDENT_CREATE', doerIds: [U.B, U.A], buddyIds: [U.C] }]);
  check('saving the same setup changes nothing', resave.status === 200 && (resave.data?.changedSteps || []).length === 0);

  // ── A new item takes the plan ──
  const ind = await ok('POST', '/procurement/indents', { department: 'Stores', remarks: `fms-plan ${RUN}`, items: [{ skuId: String(sku._id), skuCode: sku.code, itemName: sku.name, quantity: 5 }] });
  const t1 = await waitTask('INDENT_CREATE', ind.indentNumber);
  check('new draft indent opens a 1.1 task', !!t1, ind.indentNumber);
  check('task has both main doers and the buddy', t1 && same(t1.doers, [U.A, U.B]) && same(t1.buddies, [U.C]));
  const due = t1 ? new Date(t1.plannedAt) - new Date(t1.openedAt) : 0;
  check('due date = opened + 2 h lead time', Math.abs(due - 2 * 3600e3) < 5000, `${due} ms`);
  check('task links to its own indent with the task id', t1?.link === `/procurement/indents/${ind._id}?fmsTask=${t1?._id}`, t1?.link);
  const recIndent = await call('GET', `/procurement/indents/${ind._id}`);
  check('the linked record is that indent', recIndent.status === 200 && recIndent.data?.indentNumber === ind.indentNumber);

  const mine = async (who) => ((await call('GET', '/fms-doers/tasks/mine', null, { as: who })).data || []).find((t) => String(t._id) === String(t1?._id));
  const mA = await mine('A'); const mB = await mine('B'); const mC = await mine('C'); const mD = await mine('D');
  check('main doer A sees it (not as buddy)', mA && mA.asBuddy === false && mA.link === t1.link);
  check('main doer B sees it', mB && mB.asBuddy === false);
  check('buddy C sees it as buddy', mC && mC.asBuddy === true);
  check('someone else does not see it', !mD);
  check('my tasks need a login', (await call('GET', '/fms-doers/tasks/mine', null, { as: null })).status === 401);

  // ── Moving on: done, next step, no duplicates ──
  await ok('POST', `/procurement/indents/${ind._id}/submit`, {});
  const t2 = await waitTask('INDENT_APPROVAL', ind.indentNumber);
  const t1done = await waitTask('INDENT_CREATE', ind.indentNumber, { status: 'DONE' });
  check('submitting completes 1.1 (done by the manager)', t1done?.completedById?.name === USERS.MANAGER.name);
  check('…and opens 1.1A for doer A with a 1-day due date', t2 && same(t2.doers, [U.A])
    && Math.abs(new Date(t2.plannedAt) - new Date(t2.openedAt) - 864e5) < 5000);
  const doneA = ((await call('GET', '/fms-doers/tasks/mine', null, { as: 'A' })).data || []).find((t) => String(t._id) === String(t1?._id));
  check('A\'s Completed list has the done 1.1 task, still linked', doneA?.status === 'DONE' && doneA.link === t1.link);
  await call('POST', '/fms-doers/sync'); await sleep(800);
  const dupes = await FmsTask.aggregate([
    { $match: { status: 'OPEN' } },
    { $group: { _id: { s: '$stepKey', t: '$entityType', e: '$entityId' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  check('no item has two open tasks at one step (after repeated syncs)', dupes.length === 0, `${dupes.length}`);

  // ── Overdue ──
  await FmsTask.updateOne({ _id: t2._id }, { $set: { plannedAt: new Date(Date.now() - 3600e3) } });
  const late = await waitTask('INDENT_APPROVAL', ind.indentNumber);
  check('past due date → overdue', late?.isOverdue === true);

  // ── Reassign one task ──
  const re = await call('PATCH', `/fms-doers/tasks/${t2._id}/reassign`, { doerUserIds: [U.B, U.C], reason: 'cover' });
  check('reassign one task to two doers', re.status === 200 && same(re.data?.task?.doers, [U.B, U.C]));
  check('…persists', same((await waitTask('INDENT_APPROVAL', ind.indentNumber))?.doers, [U.B, U.C]));
  check('reassigning to the same doers → 400', (await call('PATCH', `/fms-doers/tasks/${t2._id}/reassign`, { doerUserIds: [U.C, U.B] })).status === 400);
  check('older single-doer reassign still works', (await call('PATCH', `/fms-doers/tasks/${t2._id}/reassign`, { doerUserId: U.B })).status === 200);
  check('reassign needs fms.manageDoers', (await call('PATCH', `/fms-doers/tasks/${t2._id}/reassign`, { doerUserId: U.A }, { as: 'A' })).status === 403);

  // ── Plan change vs items already pending ──
  await savePlan([{ stepKey: 'INDENT_APPROVAL', doerIds: [U.C] }], { applyToOpenTasks: false });
  check('save without "also update pending" leaves the waiting item alone', same((await waitTask('INDENT_APPROVAL', ind.indentNumber))?.doers, [U.B]));
  const pend = (await call('GET', '/fms-doers/plan/PURCHASE')).data?.steps?.find((s) => s.stepKey === 'INDENT_APPROVAL');
  check('the grid counts it as "not on this setup"', pend?.openTasks?.notOnPlan >= 1);
  const ap = await call('POST', '/fms-doers/plan/PURCHASE/apply-open', {});
  check('"Update pending items" moves it to the plan', ap.status === 200 && same((await waitTask('INDENT_APPROVAL', ind.indentNumber))?.doers, [U.C]));
  const both = await savePlan([{ stepKey: 'INDENT_APPROVAL', doerIds: [U.A, U.B] }], { applyToOpenTasks: true });
  check('save with "also update pending" moves it straight away', both.data?.openTasksUpdated >= 1
    && same((await waitTask('INDENT_APPROVAL', ind.indentNumber))?.doers, [U.A, U.B]));
  const t2raw = await FmsTask.findById(t2._id).lean();
  check('every move is in the task history', t2raw.history.filter((h) => h.action === 'REASSIGNED').length >= 4);
  const list = await call('GET', `/procurement/indents?search=${encodeURIComponent(ind.indentNumber)}`);
  const row = (list.data || []).find((r) => r.indentNumber === ind.indentNumber);
  check('Purchase list "Assigned Doer" shows both main doers', row?.stepTiming?.assignedDoerName === 'FP Asha, FP Bala', row?.stepTiming?.assignedDoerName);
  check('filter All Tasks by doer finds multi-doer tasks', ((await call('GET', `/fms-doers/tasks?doerId=${U.B}&search=${ind.indentNumber}`)).data || []).some((t) => String(t._id) === String(t2._id)));

  // ── Existing tasks without the new fields ──
  await FmsTask.updateOne({ _id: t2._id }, {
    $unset: { assignedDoerIds: '', buddyIds: '', plannedAt: '' },
    $set: { assignedDoerId: new mongoose.Types.ObjectId(U.A), entityLink: '/procurement/indents' },
  });
  const legacy = ((await call('GET', '/fms-doers/tasks/mine', null, { as: 'A' })).data || []).find((t) => String(t._id) === String(t2._id));
  check('legacy task (only assignedDoerId) is still in the doer\'s list', !!legacy && same(legacy.doers, [U.A]) && legacy.isOverdue === false);
  check('…and links to its record, not its stale stored link', legacy?.link === `/procurement/indents/${ind._id}?fmsTask=${t2._id}`, legacy?.link);
  check('legacy task found by doer filter', ((await call('GET', `/fms-doers/tasks?doerId=${U.A}&search=${ind.indentNumber}`)).data || []).some((t) => String(t._id) === String(t2._id)));
  const byEnt = await call('GET', `/fms-doers/tasks/by-entity?entityType=INDENT&entityId=${ind._id}`);
  check('detail-page card reads the legacy task', same(byEnt.data?.open?.[0]?.doers, [U.A]));

  // ── Missing / deleted record ──
  const ghost = await FmsTask.create({
    fmsKey: 'PURCHASE', stepKey: 'INDENT_APPROVAL', stepCode: '1.1A', stepLabel: 'Indent Approval', sequence: 2,
    entityType: 'INDENT', entityId: new mongoose.Types.ObjectId(), entityRef: `GHOST-${RUN}`, entityLink: '/procurement/indents/gone',
    status: 'DONE', assignedDoerId: new mongoose.Types.ObjectId(U.A), completedAt: new Date(), openedAt: new Date(),
  });
  const g = ((await call('GET', `/fms-doers/tasks?status=ALL&search=GHOST-${RUN}`)).data || [])[0];
  check('deleted record → no link, and says why', g && g.link === null && /deleted/i.test(g.linkIssue), g?.linkIssue);
  const gMine = ((await call('GET', '/fms-doers/tasks/mine', null, { as: 'A' })).data || []).find((t) => String(t._id) === String(ghost._id));
  check('…same in My Tasks', gMine && gMine.link === null);

  // ── PO stage: link goes to the PO, not the indent ──
  await ok('POST', `/procurement/indents/${ind._id}/approve`, {
    items: ind.items.map((it) => ({ _id: it._id, revisedQuantity: it.quantity, approvalStatus: 'APPROVED' })),
  });
  await ok('POST', `/procurement/indents/${ind._id}/quote-comparative`, { statusDone: 'QUOTE_NOT_REQUIRED' });
  const approved = await ok('GET', `/procurement/indents/${ind._id}`);
  const po = await ok('POST', '/procurement/purchase-orders/create-from-items', {
    vendorId: String(vendor._id), expectedDeliveryDate: new Date(Date.now() + 7 * 864e5).toISOString(),
    items: approved.items.map((it) => ({
      indentId: ind._id, indentItemId: it._id, itemName: it.itemName, skuCode: it.skuCode, skuId: String(it.skuId),
      quantity: it.approvedQuantity || it.quantity, unit: it.unit, rate: 10, gstRate: 18,
    })),
  });
  const ref = po.poNumber || po.draftNumber;
  const tPo = await waitTask('PO_APPROVAL', ref);
  check('draft PO opens a 1.4A task for the planned doer (3 h due)', tPo && same(tPo.doers, [U.D])
    && Math.abs(new Date(tPo.plannedAt) - new Date(tPo.openedAt) - 3 * 3600e3) < 5000, ref);
  check('PO task links to that PO', tPo?.link === `/procurement/purchase-orders/${po._id}?fmsTask=${tPo?._id}`, tPo?.link);
  check('…and its action text says what to do there', tPo?.linkAction === 'Approve the PO' && tPo?.linkLabel === 'Purchase Order');
  check('the linked PO exists', (await call('GET', `/procurement/purchase-orders/${po._id}`)).status === 200);
  const dPerm = ((await call('GET', '/fms-doers/tasks/mine', null, { as: 'D' })).data || []).find((t) => String(t._id) === String(tPo?._id));
  check('D is warned they lack the step permission', (dPerm?.missingPermissions || []).includes('procurement.approve'));

  // ── O2D untouched ──
  const o2d = await call('GET', '/o2d-fms/doer-plan');
  check('O2D doer plan endpoint still answers in its own shape', o2d.status === 200 && Array.isArray(o2d.data?.steps));

  await finish();
};

if (isEntry(import.meta.url)) {
  const run = { '--seed': seed, '--api': api }[process.argv[2]];
  if (!run) { console.error('Usage: e2eFmsDoerPlanFixture.js --seed | --api'); process.exit(2); }
  run().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => {}); process.exit(1); });
}
