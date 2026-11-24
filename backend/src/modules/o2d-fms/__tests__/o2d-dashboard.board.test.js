/**
 * O2D Dashboard (full view) — how each order is counted, its current step and
 * owner, progress, quantities and dispatch plan.
 *
 * DB-less: plain objects only.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBoard, summarizeBoard, summarizeTasks } from '../o2d-dashboard.board.js';

const NOW = new Date('2026-11-20T10:00:00Z').getTime();
const HOUR = 3600000;
const at = (offsetHours) => new Date(NOW + offsetHours * HOUR);

const order = (id, extra = {}) => ({
  _id: id, soNumber: `SO-${id}`, partyId: `p-${id}`, partyName: `Party ${id}`,
  orderDate: at(-24), status: 'IN_PROGRESS',
  items: [{ skuCode: 'MA1500', skuName: 'MA Wet Jar', orderQty: 100, dispatchedQty: 40, rate: 10 }],
  totalOrderQty: 100, totalDispatchedQty: 40,
  ...extra,
});
const process = (id, orderId, steps, extra = {}) => ({
  _id: id, salesOrderId: orderId, source: 'SALES_ORDER', isCompleted: false, steps, ...extra,
});
const task = (processId, stepCode, plannedAt, extra = {}) => ({
  processId, stepCode, stepName: `Step ${stepCode}`, state: 'open', plannedAt,
  doers: [{ id: 'u1', name: 'Sneha Patil' }], ...extra,
});
const DEFS = [
  { stepCode: '2.06', name: 'Delivery Challan', phase: 'EXECUTION', sequence: 6 },
  { stepCode: '2.03', name: 'Check Inventory', phase: 'PRE_PRODUCTION', sequence: 3 },
];

test('an open step past its planned time makes the order Delayed, with that step as current', () => {
  const board = buildBoard({
    orders: [order('o1')],
    processes: [process('p1', 'o1', [{ stepCode: '2.03', status: 'DONE' }, { stepCode: '2.06', status: 'IN_PROGRESS' }])],
    tasks: [task('p1', '2.06', at(-5))],
    defs: DEFS,
    now: NOW,
  });
  const [row] = board.orders;
  assert.equal(row.group, 'OVERDUE');
  assert.equal(row.current.code, '2.06');
  assert.equal(row.current.ownerName, 'Sneha Patil');
  assert.equal(row.current.overdueMins, 300);
  assert.equal(row.phase, 'EXECUTION');
  assert.equal(row.progress, 50);
  assert.equal(row.value, 1000);
  assert.equal(row.orderedQty, 100);
  assert.equal(row.dispatchedQty, 40);
});

test('with several open steps (one per challan) the most urgent one is current', () => {
  const board = buildBoard({
    orders: [order('o1')],
    processes: [process('p1', 'o1', [])],
    tasks: [
      task('p1', '2.09', at(10), { dcNumber: 'DC-2' }),
      task('p1', '2.07', at(-2), { dcNumber: 'DC-1' }),
      task('p1', '2.08', null),
    ],
    now: NOW,
  });
  assert.equal(board.orders[0].current.code, '2.07');
  assert.equal(board.orders[0].current.dcNumber, 'DC-1');
  assert.equal(board.orders[0].openSteps, 3);
});

test('open steps still in time leave the order In progress; done rows are ignored', () => {
  const board = buildBoard({
    orders: [order('o1')],
    processes: [process('p1', 'o1', [])],
    tasks: [task('p1', '2.06', at(5)), task('p1', '2.03', at(-50), { state: 'done' })],
    now: NOW,
  });
  assert.equal(board.orders[0].group, 'OPEN');
  assert.equal(board.orders[0].current.code, '2.06');
  assert.equal(board.orders[0].current.overdueMins, 0);
});

test('cancelled beats everything; a closed O2D record is Completed at 100%', () => {
  const board = buildBoard({
    orders: [order('o1', { status: 'CANCELLED' }), order('o2', { status: 'COMPLETED' })],
    processes: [
      process('p1', 'o1', [], { isCompleted: false }),
      process('p2', 'o2', [{ stepCode: '2.03', status: 'DONE' }, { stepCode: '2.06', status: 'PENDING' }], { isCompleted: true }),
    ],
    tasks: [task('p1', '2.06', at(-5))],
    now: NOW,
  });
  const byId = Object.fromEntries(board.orders.map((r) => [r.id, r]));
  assert.equal(byId.o1.group, 'CANCELLED');
  assert.equal(byId.o1.current, null);
  assert.equal(byId.o2.group, 'COMPLETED');
  assert.equal(byId.o2.progress, 100);
});

test('a completed sales order still waiting on payment steps is not Completed', () => {
  const board = buildBoard({
    orders: [order('o1', { status: 'COMPLETED' })],
    processes: [process('p1', 'o1', [])],
    tasks: [task('p1', '2.10', at(-1))],
    now: NOW,
  });
  assert.equal(board.orders[0].group, 'OVERDUE');
});

test('an order with no O2D record follows its sales order status', () => {
  const board = buildBoard({
    orders: [order('o1', { status: 'SHORT_CLOSED' }), order('o2', { status: 'RECEIVED' })],
    now: NOW,
  });
  const byId = Object.fromEntries(board.orders.map((r) => [r.id, r]));
  assert.equal(byId.o1.group, 'COMPLETED');
  assert.equal(byId.o2.group, 'OPEN');
  assert.equal(byId.o2.current, null);
});

test('skipped steps do not count towards progress', () => {
  const board = buildBoard({
    orders: [order('o1')],
    processes: [process('p1', 'o1', [
      { stepCode: 'a', status: 'DONE' }, { stepCode: 'b', status: 'DELAYED' },
      { stepCode: 'c', status: 'SKIPPED' }, { stepCode: 'd', status: 'PENDING' },
    ])],
    now: NOW,
  });
  assert.equal(board.orders[0].progress, 67);
});

test('only the newest dispatch schedule of an order is read, without cancelled phases', () => {
  const phase = (date, qty, done, status = 'PLANNED') => ({ plannedDate: date, plannedQty: qty, totalActualQty: done, status });
  const board = buildBoard({
    orders: [order('o1')],
    schedules: [
      { orderId: 'o1', soNumber: 'SO-o1', createdAt: at(-100), items: [{ skuCode: 'OLD', skuName: 'Old', phases: [phase(at(1), 999, 0)] }] },
      { orderId: 'o1', soNumber: 'SO-o1', createdAt: at(-10), items: [{ skuCode: 'MA1500', skuName: 'MA Wet Jar', phases: [
        phase(at(24), 60, 0), phase(at(48), 40, 0, 'CANCELLED'),
      ] }] },
    ],
    now: NOW,
  });
  const { plan } = board.orders[0];
  assert.equal(plan.length, 1);
  assert.deepEqual({ sku: plan[0].sku, qty: plan[0].qty, done: plan[0].done }, { sku: 'MA1500', qty: 60, done: 0 });
});

test('each order gets its challans as dated SKU lines; only recent challans go to the KPI list', () => {
  const board = buildBoard({
    orders: [order('o1'), order('o2')],
    challans: [
      { orderId: 'o1', soNumber: 'SO-o1', dcNumber: 'DC-1', dcDate: at(-24 * 40), totalQuantityPcs: 70,
        items: [{ skuCode: 'MA1500', skuName: 'MA Wet Jar', quantityPcs: 50 }, { skuCode: 'GJ', skuName: 'Grinder Jar', quantityPcs: 20 }] },
      { orderId: null, soNumber: 'SO-o2', dcNumber: 'DC-2', dcDate: at(-3), items: [{ skuCode: 'GJ', skuName: 'Grinder Jar', quantityPcs: 15 }] },
    ],
    now: NOW,
  });
  const byId = Object.fromEntries(board.orders.map((r) => [r.id, r]));
  assert.deepEqual(byId.o1.dispatches.map((d) => [d.sku, d.qty]), [['MA1500', 50], ['GJ', 20]]);
  assert.deepEqual(byId.o2.dispatches.map((d) => [d.sku, d.qty]), [['GJ', 15]]); // matched by SO number
  assert.deepEqual(board.challans.map((c) => [c.dcNumber, c.qty]), [['DC-2', 15]]); // 40 days ago is left out
});

test('orders logged from an intake (no sales order yet) are listed too', () => {
  const board = buildBoard({
    processes: [{ _id: 'p9', salesOrderId: null, source: 'INTAKE', partyName: 'Gomti Traders', isCompleted: false, createdAt: at(-3), steps: [] }],
    tasks: [task('p9', '1.01', at(-1))],
    now: NOW,
  });
  const [row] = board.orders;
  assert.equal(row.id, 'intake:p9');
  assert.equal(row.salesOrderId, null);
  assert.equal(row.partyName, 'Gomti Traders');
  assert.equal(row.group, 'OVERDUE');
});

test('newest order first; steps catalogue in flow order; challan quantity falls back to its lines', () => {
  const board = buildBoard({
    orders: [order('old', { orderDate: at(-200) }), order('new', { orderDate: at(-2) })],
    challans: [{ orderId: 'new', soNumber: 'SO-new', dcNumber: 'DC-9', dcDate: at(-1), items: [{ quantityPcs: 30 }, { quantityPcs: 20 }] }],
    defs: DEFS,
    now: NOW,
  });
  assert.deepEqual(board.orders.map((r) => r.id), ['new', 'old']);
  assert.deepEqual(board.steps.map((s) => s.code), ['2.03', '2.06']);
  assert.equal(board.challans[0].qty, 50);
  assert.equal(board.challans[0].salesOrderId, 'new');
});

// ── KPI tiles for the Delegation Suite's Dashboard ──
// NOW is 20 Nov 10:00 UTC = 15:30 in India; India's day runs 19 Nov 18:30 → 20 Nov 18:30 UTC.
const IST = -330;

test('company tiles: the O2D Dashboard numbers, today in the viewer\'s time zone', () => {
  const board = {
    orders: [
      { group: 'OVERDUE', dispatchedQty: 40 }, { group: 'OPEN', dispatchedQty: 0 },
      { group: 'COMPLETED', dispatchedQty: 100 }, { group: 'CANCELLED', dispatchedQty: 10 },
    ],
    challans: [
      { dcDate: new Date('2026-11-19T19:00:00Z'), qty: 30 }, // 20 Nov 00:30 in India → today
      { dcDate: new Date('2026-11-20T09:00:00Z'), qty: 20 },
      { dcDate: new Date('2026-11-19T18:00:00Z'), qty: 99 }, // 19 Nov 23:30 in India → yesterday
    ],
  };
  assert.deepEqual(summarizeBoard(board, { now: NOW, tzOffset: IST }), {
    scope: 'company', salesOrders: 3, pending: 2, challansToday: 2, dispatchToday: 50,
    dispatched: 140, delayed: 1, completed: 1, cancelled: 1,
  });
  // In UTC the 19th 19:00 challan is yesterday.
  assert.equal(summarizeBoard(board, { now: NOW, tzOffset: 0 }).challansToday, 1);
});

test('my tiles: open, due today, delayed, done and on-time from my own task rows', () => {
  const t = (state, plannedAt, extra = {}) => ({ state, plannedAt, ...extra });
  const tasks = [
    t('open', '2026-11-20T08:00:00Z'),                       // late
    t('open', '2026-11-20T12:00:00Z'),                       // due later today (India)
    t('open', '2026-11-21T06:00:00Z'),                       // tomorrow
    t('open', null),
    t('done', '2026-11-10T10:00:00Z', { doneAt: '2026-11-10T09:00:00Z' }),
    t('done', '2026-11-10T10:00:00Z', { doneAt: '2026-11-11T09:00:00Z' }), // late
    t('open', '2026-11-19T08:00:00Z', { asBuddy: true }),    // buddy rows left out
  ];
  assert.deepEqual(summarizeTasks(tasks, { now: NOW, tzOffset: IST }), {
    scope: 'mine', open: 4, dueToday: 1, delayed: 1, done: 2, late: 1, onTimePct: 50,
  });
  assert.equal(summarizeTasks([], { now: NOW }).onTimePct, null);
});
