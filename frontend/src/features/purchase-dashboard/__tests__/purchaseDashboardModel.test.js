/**
 * Purchase Dashboard — the join of the Purchase lists into one row per indent,
 * the tile figures and the page-wide filters. Plain node:test:
 *
 *   node --test src/features/purchase-dashboard/__tests__/purchaseDashboardModel.test.js
 *
 * The records below are minimal test inputs for the rules (not app data).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDeliveryEvents, buildPurchaseBoard, deliveryItemOptions, deliveryVendorOptions, EMPTY_INDENT_FILTER, filterDeliveryEvents, monthEventsByDay, filterIndents, indentSplit, monthDeliveries, myPurchaseTasks,
  purchaseInsights, purchaseKpis, purchaseStageBars, vendorOptions,
} from '../purchaseDashboardModel.js';

const NOW = new Date('2026-11-20T10:00:00').getTime();
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString();

const src = () => ({
  indents: [
    { _id: 'i1', indentNumber: 'IND-1', approvalStatus: 'APPROVED', overallStatus: 'PO_READY', timestamp: iso(NOW - 9 * DAY), items: [] },
    { _id: 'i2', indentNumber: 'IND-2', approvalStatus: 'PENDING_APPROVAL', overallStatus: 'INDENT_GENERATED', timestamp: iso(NOW - 2 * DAY), items: [{ itemName: 'Bolt', quantity: 5 }] },
    { _id: 'i3', indentNumber: 'IND-3', approvalStatus: 'REJECTED', overallStatus: 'INDENT_GENERATED', timestamp: iso(NOW - 3 * DAY), items: [] },
    { _id: 'i4', indentNumber: 'IND-4', approvalStatus: 'APPROVED', overallStatus: 'PO_READY', timestamp: iso(NOW - 20 * DAY), items: [] },
    { _id: 'i5', indentNumber: 'IND-5', approvalStatus: 'APPROVED', overallStatus: 'QUOTE_PENDING', timestamp: iso(NOW - 1 * DAY), items: [] },
  ],
  pos: [
    // i1: released, due yesterday, half received → delivery late
    { _id: 'p1', poNumber: 'PO-1', indentId: 'i1', vendorId: 'v1', vendorName: 'Steel Co', poStatus: 'PARTIAL_RECEIVED', approvalStatus: 'APPROVED',
      poDate: iso(NOW - 5 * DAY), expectedDeliveryDate: iso(NOW - DAY), grandTotal: 1180, items: [{ itemName: 'Coil', skuCode: 'C1', quantity: 10, receivedQty: 5, rate: 100 }] },
    // i4: closed out with a full final payment
    { _id: 'p4', poNumber: 'PO-4', indentIds: ['i4'], vendorId: 'v2', vendorName: 'Pipe Co', poStatus: 'FULLY_RECEIVED', approvalStatus: 'APPROVED',
      poDate: iso(NOW - 15 * DAY), expectedDeliveryDate: iso(NOW - 10 * DAY), grandTotal: 500, items: [{ itemName: 'Pipe', skuCode: 'P1', quantity: 4, receivedQty: 4, rate: 125 }] },
  ],
  grns: [{ _id: 'g1', poId: 'p1', grnStatus: 'PARTIAL_RECEIVED', grnDate: iso(NOW - DAY), items: [{ itemName: 'Coil', skuCode: 'C1', receivedQty: 5 }] }],
  pis: [{ _id: 'pi1', poNumber: 'PO-1', piStatus: 'READY_FOR_ADVANCE_PAYMENT', balanceAmount: 300 }],
  finals: [{ _id: 'f4', poId: 'p4', paymentStatus: 'FULL_PAYMENT' }],
  vouchers: [{ _id: 'vo4', poId: 'p4', voucherStatus: 'FULLY_PAID', balanceAmount: 0 }, { _id: 'vo1', poId: 'p1', voucherStatus: 'POSTED', balanceAmount: 250 }],
  rateChanges: [{ _id: 'rc1', poId: 'p1', status: 'PENDING' }],
  tasks: [
    // i2's approval task, planned 2 h ago → overdue; owner Asha
    { _id: 't1', fmsKey: 'PURCHASE', status: 'OPEN', stepCode: '1.1A', stepLabel: 'Indent Approval', entityType: 'INDENT', entityId: 'i2', entityRef: 'IND-2',
      plannedAt: iso(NOW - 2 * 3600000), doers: [{ name: 'Asha' }] },
    // i1's GRN step, through its PO, not planned
    { _id: 't2', fmsKey: 'PURCHASE', status: 'OPEN', stepCode: '1.8', stepLabel: 'GRN', entityType: 'PO', entityId: 'p1', entityRef: 'PO-1', plannedAt: null, doers: [] },
  ],
});

test('one row per indent, joined through POs (indentId and indentIds) and their records', () => {
  const { rows } = buildPurchaseBoard(src(), NOW);
  assert.equal(rows.length, 5);
  const r1 = rows.find((r) => r.id === 'i1');
  assert.deepEqual(r1.poNumbers, ['PO-1']);
  assert.equal(r1.vendorName, 'Steel Co');
  assert.equal(r1.value, 1180);
  assert.equal(r1.orderedQty, 10);
  assert.equal(r1.receivedQty, 5);
  assert.equal(r1.current.code, '1.8');
  assert.equal(rows.find((r) => r.id === 'i4').poNumbers[0], 'PO-4');
});

test('groups: rejected → cancelled, final-paid → completed, late delivery / task → delayed', () => {
  const g = Object.fromEntries(buildPurchaseBoard(src(), NOW).rows.map((r) => [r.id, r.group]));
  assert.deepEqual(g, { i1: 'OVERDUE', i2: 'OVERDUE', i3: 'CANCELLED', i4: 'COMPLETED', i5: 'OPEN' });
  const r1 = buildPurchaseBoard(src(), NOW).rows.find((r) => r.id === 'i1');
  assert.deepEqual(r1.late, { task: false, delivery: true, followUp: false });
});

test('the current step is the most urgent open task, with its owner and delay', () => {
  const r2 = buildPurchaseBoard(src(), NOW).rows.find((r) => r.id === 'i2');
  assert.equal(r2.current.code, '1.1A');
  assert.equal(r2.current.ownerName, 'Asha');
  assert.equal(r2.current.overdueMins, 120);
});

test('step list: later steps done mark the earlier ones done; open step shown in progress', () => {
  const r1 = buildPurchaseBoard(src(), NOW).rows.find((r) => r.id === 'i1');
  const st = Object.fromEntries(r1.steps.map((s) => [s.code, s.status]));
  assert.equal(st['1.1'], 'DONE');
  assert.equal(st['1.4B'], 'DONE');
  assert.equal(st['1.8'], 'IN_PROGRESS');
  assert.equal(st['1.13'], 'PENDING');
  assert.equal(buildPurchaseBoard(src(), NOW).rows.find((r) => r.id === 'i4').progress, 100);
});

test('tile figures come from the rows and the lists — nothing else', () => {
  const s = src();
  const { rows } = buildPurchaseBoard(s, NOW);
  const k = purchaseKpis(rows, s, NOW);
  assert.equal(k.totalIndents, 4);           // i3 rejected
  assert.equal(k.pendingApproval, 1);        // i2
  assert.equal(k.quotePending, 1);           // i5
  assert.equal(k.poReleased, 2);             // i1, i4
  assert.equal(k.grnPending, 1);             // i1
  assert.equal(k.delayed, 2);
  assert.equal(k.completed, 1);
  assert.equal(k.cancelled, 1);
  assert.equal(k.advanceDue, 300);
  assert.equal(k.pendingRateChanges, 1);
  assert.equal(k.overdueTasks, 1);
  assert.equal(k.posPastDue, 1);
  assert.equal(k.payables, 250);
});

test('filters: group, tile flag, step, item and calendar day', () => {
  const { rows } = buildPurchaseBoard(src(), NOW);
  const ids = (f) => filterIndents(rows, { ...EMPTY_INDENT_FILTER, ...f }).map((r) => r.id).sort();
  assert.deepEqual(ids({ group: 'PENDING' }), ['i1', 'i2', 'i5']);
  assert.deepEqual(ids({ kpi: 'posPastDue' }), ['i1']);
  assert.deepEqual(ids({ kpi: 'rateChange' }), ['i1']);
  assert.deepEqual(ids({ step: '1.1A' }), ['i2']);
  assert.deepEqual(ids({ sku: 'P1' }), ['i4']);
  const due = new Date(NOW - DAY); due.setHours(0, 0, 0, 0);
  assert.deepEqual(ids({ day: due.getTime() }), ['i1']);
  assert.deepEqual(indentSplit(rows), { live: 4, open: 1, overdue: 2, completed: 1 });
});

test('stage analysis: pending by PO date, received by GRN date, upcoming by delivery date', () => {
  const { rows } = buildPurchaseBoard(src(), NOW);
  const all = { time: 'all', indent: '', vendor: '' };
  assert.deepEqual(purchaseStageBars(rows, { ...all, mode: 'pending' }, NOW), [{ key: 'C1', name: 'Coil', value: 5 }]);
  assert.deepEqual(purchaseStageBars(rows, { ...all, mode: 'received' }, NOW), [{ key: 'C1', name: 'Coil', value: 5 }]);
  assert.deepEqual(purchaseStageBars(rows, { ...all, mode: 'upcoming' }, NOW), [{ key: 'C1', name: 'Coil', value: 5 }]);
  assert.deepEqual(purchaseStageBars(rows, { ...all, mode: 'pending', vendor: 'v2' }, NOW), []);
  assert.deepEqual(vendorOptions(rows).map((v) => v.label), ['Pipe Co', 'Steel Co']);
  // The vendor applies per PO, not per indent (an indent can have several vendors).
  const two = src();
  two.pos.push({ _id: 'p6', poNumber: 'PO-6', indentId: 'i1', vendorId: 'v3', vendorName: 'Wire Co', poStatus: 'RELEASED_TO_VENDOR',
    poDate: iso(NOW - 4 * DAY), expectedDeliveryDate: iso(NOW + 3 * DAY), grandTotal: 236, items: [{ itemName: 'Wire', skuCode: 'W4', quantity: 20, receivedQty: 0, rate: 10 }] });
  const rows2 = buildPurchaseBoard(two, NOW).rows;
  assert.deepEqual(purchaseStageBars(rows2, { ...all, mode: 'pending', vendor: 'v3' }, NOW), [{ key: 'W4', name: 'Wire', value: 20 }]);
  assert.deepEqual(purchaseStageBars(rows2, { ...all, mode: 'upcoming', vendor: 'v1' }, NOW), [{ key: 'C1', name: 'Coil', value: 5 }]);
  assert.deepEqual(purchaseStageBars(rows2, { ...all, mode: 'received', vendor: 'v3' }, NOW), []);
});

test('calendar: released POs still to receive, on their expected delivery day', () => {
  const { rows } = buildPurchaseBoard(src(), NOW);
  const d = new Date(NOW - DAY);
  const byDay = monthDeliveries(rows, d.getFullYear(), d.getMonth());
  const items = [...byDay.values()].flat();
  assert.equal(items.length, 1);
  assert.equal(items[0].po.poNumber, 'PO-1');
  assert.equal(items[0].po.pending, 5);
});

test('insights read the same rows', () => {
  const s = src();
  const { rows } = buildPurchaseBoard(s, NOW);
  const lines = purchaseInsights(rows, rows, purchaseKpis(rows, s, NOW));
  assert.equal(lines[0], '2 indents are past the planned time right now.');
  assert.ok(lines.some((l) => l.startsWith('Biggest queue is at')));
  assert.ok(lines.includes('1 released PO is past the expected delivery date.'));
  assert.ok(lines.includes('Longest delay: IND-2, 2h 0m late at 1.1A.'));
});

test('my tasks: Purchase rows only, own work only, in the O2D task shape', () => {
  const mine = myPurchaseTasks([
    { _id: 'a', fmsKey: 'PURCHASE', status: 'OPEN', stepCode: '1.5', stepLabel: 'Material Follow-up', entityRef: 'PO-9', summary: 'Steel Co', plannedAt: iso(NOW), link: '/x' },
    { _id: 'b', fmsKey: 'PURCHASE', status: 'DONE', stepCode: '1.8', stepLabel: 'GRN', entityRef: 'PO-8', completedAt: iso(NOW) },
    { _id: 'c', fmsKey: 'PURCHASE', status: 'OPEN', asBuddy: true, stepCode: '1.6' },
    { _id: 'd', fmsKey: 'O2D', status: 'OPEN', stepCode: '2.05' },
  ]);
  assert.deepEqual(mine.map((t) => [t.key, t.state, t.stepCode, t.soNumber]), [['a', 'open', '1.5', 'PO-9'], ['b', 'done', '1.8', 'PO-8']]);
  assert.equal(mine[0].stepPath, '/x');
  assert.equal(mine[1].doneAt, iso(NOW));
});

test('item delivery events: released lines still to receive are Scheduled, fully received lines Delivered', () => {
  const ev = buildDeliveryEvents(src());
  const sched = ev.filter((e) => e.status === 'SCHEDULED');
  const deliv = ev.filter((e) => e.status === 'DELIVERED');
  // p1 (partly received, due yesterday): 5 Coil still to come, on its expected date
  assert.deepEqual(sched.map((e) => [e.poNumber, e.item, e.qty, e.date]), [['PO-1', 'Coil', 5, iso(NOW - DAY)]]);
  // p4 (fully received): 4 Pipe delivered; no GRN for p4 here → no date → left out
  assert.equal(deliv.length, 0);
  const withGrn = src();
  withGrn.grns.push({ _id: 'g4', poId: 'p4', grnStatus: 'FULLY_RECEIVED', grnDate: iso(NOW - 11 * DAY), items: [{ itemName: 'Pipe', skuCode: 'P1', receivedQty: 4 }] });
  const ev2 = buildDeliveryEvents(withGrn);
  assert.deepEqual(ev2.filter((e) => e.status === 'DELIVERED').map((e) => [e.poNumber, e.item, e.qty, e.date, e.indentIds]), [['PO-4', 'Pipe', 4, iso(NOW - 11 * DAY), ['i4']]]);
  // filters: status, item, vendor — and the per-day count follows them
  assert.equal(filterDeliveryEvents(ev2, { status: 'DELIVERED', item: '', vendor: '' }).length, 1);
  assert.equal(filterDeliveryEvents(ev2, { status: '', item: 'C1', vendor: '' }).length, 1);
  assert.equal(filterDeliveryEvents(ev2, { status: '', item: '', vendor: 'v2' })[0].item, 'Pipe');
  assert.equal(filterDeliveryEvents(ev2, { status: 'SCHEDULED', item: 'P1', vendor: '' }).length, 0);
  const d = new Date(NOW - DAY);
  const byDay = monthEventsByDay(filterDeliveryEvents(ev2, { status: 'SCHEDULED', item: '', vendor: '' }), d.getFullYear(), d.getMonth());
  assert.equal([...byDay.values()].flat().length, 1);
  assert.deepEqual(deliveryItemOptions(ev2).map((o) => o.label), ['Coil', 'Pipe']);
  assert.deepEqual(deliveryVendorOptions(ev2).map((o) => o.label), ['Pipe Co', 'Steel Co']);
});

test('a calendar day narrows the table to the indents behind that day', () => {
  const { rows } = buildPurchaseBoard(src(), NOW);
  const ids = filterIndents(rows, { ...EMPTY_INDENT_FILTER, day: 1, dayIndents: ['i4'] }).map((r) => r.id);
  assert.deepEqual(ids, ['i4']);
});
