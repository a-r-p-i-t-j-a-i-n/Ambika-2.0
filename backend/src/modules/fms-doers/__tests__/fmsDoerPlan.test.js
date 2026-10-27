import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FMS_CATALOG } from '../fmsCatalog.js';
import { purchaseTaskLink, PURCHASE_STEP_LINKS, ENTITY_ROUTES, isObjectId } from '../fmsTaskLinks.js';
import {
  leadTimeMs, plannedAtFor, isTaskOverdue, stepPlanOf, taskDoerIds, taskBuddyIds,
  normalizePlanRow, sameIds, describePlan,
} from '../fmsPlan.rules.js';
import { resolveStepTiming } from '../../procurement/stepTiming.rules.js';

const ID = (n) => String(n).padStart(24, '0');
const TASK = ID(77);

// ── Task links ──────────────────────────────────────────────────────────────
test('every Purchase step source has a link to that record type', () => {
  for (const step of FMS_CATALOG.PURCHASE.steps) {
    for (const src of step.sources) {
      assert.ok(ENTITY_ROUTES[src.entityType], `${step.key}: no route for ${src.entityType}`);
      assert.ok(PURCHASE_STEP_LINKS[step.key]?.[src.entityType], `${step.key}: no action text for ${src.entityType}`);
    }
  }
  // …and the mapping names no step the catalog does not have.
  const keys = new Set(FMS_CATALOG.PURCHASE.steps.map((s) => s.key));
  Object.keys(PURCHASE_STEP_LINKS).forEach((k) => assert.ok(keys.has(k), `stale mapping ${k}`));
});

test('each stage opens its own record with the task id as context', () => {
  const cases = [
    ['INDENT_CREATE', 'INDENT', '/procurement/indents/'],
    ['QUOTE_COMPARATIVE', 'INDENT', '/procurement/indents/'],
    ['PO_CREATE', 'INDENT', '/procurement/indents/'],
    ['PO_APPROVAL', 'PO', '/procurement/purchase-orders/'],
    ['MATERIAL_FOLLOWUP', 'PO', '/procurement/purchase-orders/'],
    ['GRN', 'PO', '/procurement/purchase-orders/'],
    ['PROFORMA_INVOICE', 'PI', '/procurement/proforma-invoices/'],
    ['ADVANCE_PAYMENT', 'PI', '/procurement/proforma-invoices/'],
    ['INCOMING_QC', 'GRN', '/procurement/grns/'],
    ['INCOMING_QC', 'INDENT', '/procurement/indents/'],
    ['VENDOR_INVOICE', 'QC', '/procurement/incoming-qc/'],
    ['VENDOR_INVOICE', 'INVOICE', '/procurement/vendor-invoices/'],
    ['BILL_PASSING', 'INVOICE', '/procurement/vendor-invoices/'],
    ['BILL_PASSING', 'VOUCHER', '/procurement/vouchers/'],
    ['TALLY_ENTRY', 'VOUCHER', '/procurement/vouchers/'],
    ['FINAL_PAYMENT', 'VOUCHER', '/procurement/vouchers/'],
  ];
  for (const [stepKey, entityType, base] of cases) {
    const link = purchaseTaskLink({ _id: TASK, stepKey, entityType, entityId: ID(5) });
    assert.equal(link.to, `${base}${ID(5)}?fmsTask=${TASK}`, `${stepKey}/${entityType}`);
    assert.ok(link.action, `${stepKey}/${entityType} action`);
  }
});

test('the record id, not anything else on the task, decides the link', () => {
  // A stale stored entityLink is ignored.
  const link = purchaseTaskLink({ _id: TASK, stepKey: 'PO_APPROVAL', entityType: 'PO', entityId: ID(9), entityLink: '/procurement/indents/abc' });
  assert.equal(link.to, `/procurement/purchase-orders/${ID(9)}?fmsTask=${TASK}`);
});

test('no link from a bad id or an unknown record type', () => {
  assert.equal(purchaseTaskLink({ _id: TASK, stepKey: 'GRN', entityType: 'PO', entityId: '../admin' }), null);
  assert.equal(purchaseTaskLink({ _id: TASK, stepKey: 'GRN', entityType: 'PO', entityId: null }), null);
  assert.equal(purchaseTaskLink({ _id: TASK, stepKey: 'X', entityType: 'SALES_ORDER', entityId: ID(1) }), null);
  assert.equal(purchaseTaskLink(null), null);
  assert.equal(isObjectId('zz'.repeat(12)), false);
});

test('legacy tasks: no task id → plain record link; unknown step → record still opens', () => {
  assert.equal(purchaseTaskLink({ stepKey: 'GRN', entityType: 'PO', entityId: ID(3) }).to, `/procurement/purchase-orders/${ID(3)}`);
  const old = purchaseTaskLink({ _id: TASK, stepKey: 'SOME_OLD_STEP', entityType: 'GRN', entityId: ID(4) });
  assert.equal(old.to, `/procurement/grns/${ID(4)}?fmsTask=${TASK}`);
  assert.equal(old.action, '');
});

test('retired Service Completion tasks open their indent, or nothing', () => {
  const t = { _id: TASK, stepKey: 'SERVICE_COMPLETION', entityType: 'SERVICE_COMPLETION', entityId: ID(6) };
  assert.equal(purchaseTaskLink(t, { serviceCompletionIndentId: ID(8) }).to, `/procurement/indents/${ID(8)}?fmsTask=${TASK}`);
  assert.equal(purchaseTaskLink(t), null);
});

// ── Plan rules ──────────────────────────────────────────────────────────────
test('lead time → due date', () => {
  assert.equal(leadTimeMs({ value: 2, unit: 'HOURS' }), 2 * 3600e3);
  assert.equal(leadTimeMs({ value: 1.5, unit: 'DAYS' }), 36 * 3600e3);
  assert.equal(leadTimeMs({ value: 0, unit: 'DAYS' }), null);
  assert.equal(leadTimeMs({ value: 3, unit: 'WEEKS' }), null);
  assert.equal(leadTimeMs(null), null);
  assert.equal(plannedAtFor('2026-10-27T10:00:00Z', { value: 1, unit: 'DAYS' }).toISOString(), '2026-10-28T10:00:00.000Z');
  assert.equal(plannedAtFor('2026-10-27T10:00:00Z', null), null);
});

test('overdue only while open and past the due date', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  assert.equal(isTaskOverdue({ status: 'OPEN', plannedAt: '2026-10-27T11:00:00Z' }, now), true);
  assert.equal(isTaskOverdue({ status: 'OPEN', plannedAt: '2026-10-27T13:00:00Z' }, now), false);
  assert.equal(isTaskOverdue({ status: 'DONE', plannedAt: '2026-10-27T11:00:00Z' }, now), false);
  assert.equal(isTaskOverdue({ status: 'OPEN', plannedAt: null }, now), false);
});

test('legacy single-doer rows and tasks read as one main doer', () => {
  assert.deepEqual(stepPlanOf({ doerUserId: ID(1) }), { doerIds: [ID(1)], buddyIds: [], leadTime: null });
  assert.deepEqual(stepPlanOf(null), { doerIds: [], buddyIds: [], leadTime: null });
  const plan = stepPlanOf({ doerUserId: ID(1), doerUserIds: [ID(1), ID(2)], backupUserIds: [ID(2), ID(3)], leadTime: { value: 4, unit: 'HOURS' } });
  assert.deepEqual(plan, { doerIds: [ID(1), ID(2)], buddyIds: [ID(3)], leadTime: { value: 4, unit: 'HOURS' } });

  assert.deepEqual(taskDoerIds({ assignedDoerId: ID(1) }), [ID(1)]);
  assert.deepEqual(taskDoerIds({ assignedDoerId: { _id: ID(1), name: 'A' }, assignedDoerIds: [] }), [ID(1)]);
  assert.deepEqual(taskDoerIds({ assignedDoerId: ID(1), assignedDoerIds: [{ _id: ID(1) }, { _id: ID(2) }] }), [ID(1), ID(2)]);
  assert.deepEqual(taskDoerIds({}), []);
  assert.deepEqual(taskBuddyIds({ buddyIds: [{ _id: ID(5) }] }), [ID(5)]);
  assert.equal(sameIds([ID(2), ID(1)], [ID(1), ID(2), ID(1)]), true);
});

test('plan rows: overlap refused, lead time unchanged / cleared / checked', () => {
  assert.match(normalizePlanRow({ stepKey: 'grn', doerIds: [ID(1)], buddyIds: [ID(1)] }).error, /both a main doer and a buddy/);
  const same = normalizePlanRow({ stepKey: 'grn', doerIds: [ID(1), ID(1)], buddyIds: [] });
  assert.equal(same.stepKey, 'GRN');
  assert.deepEqual(same.doerIds, [ID(1)]);
  assert.equal('leadTime' in same, false);
  assert.equal(normalizePlanRow({ stepKey: 'GRN', leadTime: null }).leadTime, null);
  assert.deepEqual(normalizePlanRow({ stepKey: 'GRN', leadTime: { value: '2', unit: 'DAYS' } }).leadTime, { value: 2, unit: 'DAYS' });
  assert.match(normalizePlanRow({ stepKey: 'GRN', leadTime: { value: -1, unit: 'DAYS' } }).error, /lead time/);
  assert.equal(describePlan({ doers: ['A', 'B'], buddies: [], leadTime: { value: 1, unit: 'DAYS' } }), 'Main doers: A, B · Buddies: none · Lead time: 1 day');
});

// ── Purchase list "Assigned Doer" column ────────────────────────────────────
test('step timing shows every main doer, and still reads legacy tasks', () => {
  const def = { steps: [{ key: 'GRN', done: () => false }], entities: (d) => [{ entityType: 'PO', entityId: d._id }] };
  const doc = { _id: ID(1) };
  const base = { stepKey: 'GRN', entityType: 'PO', entityId: ID(1), status: 'OPEN', openedAt: new Date() };
  const multi = resolveStepTiming(doc, def, { tasks: [{ ...base, assignedDoerId: { name: 'Asha' }, assignedDoerIds: [{ name: 'Asha' }, { name: 'Ravi' }] }] });
  assert.equal(multi.assignedDoerName, 'Asha, Ravi');
  const legacy = resolveStepTiming(doc, def, { tasks: [{ ...base, assignedDoerId: { name: 'Asha' } }] });
  assert.equal(legacy.assignedDoerName, 'Asha');
});
