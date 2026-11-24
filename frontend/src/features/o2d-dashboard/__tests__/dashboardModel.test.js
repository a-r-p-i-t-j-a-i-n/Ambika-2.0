/**
 * O2D Dashboard — the panel numbers and the page-wide filters, for the company
 * view (orders) and the my-tasks view. Plain node:test (the frontend has no
 * unit-test runner):
 *
 *   node --test src/features/o2d-dashboard/__tests__/dashboardModel.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  companyInsights, companyKpis, delaySplit, durLabel, EMPTY_ORDER_FILTER, EMPTY_TASK_FILTER,
  filterOrders, filterTasks, fromDayKey, monthTasks, myInsights, myKpis, myStepBars, stageBars, stageEmptyText,
  startOfDay, taskState, toDayKey, todayChallans, upcomingOrders, upcomingTasks,
} from '../dashboardModel.js';

// 20 Nov 2026, 10:00 in the machine's own time zone — "today" is the 20th.
const NOW = new Date(2026, 10, 20, 10, 0).getTime();
const on = (day, hour = 12, month = 10) => new Date(2026, month, day, hour, 0).toISOString();

const order = (id, extra = {}) => ({
  id, salesOrderId: id, soNumber: `SO-${id}`, partyId: `p-${id}`, partyName: `Party ${id}`,
  receivedAt: on(18), soStatus: 'IN_PROGRESS', group: 'OPEN', current: null,
  orderedQty: 100, dispatchedQty: 0, value: 0,
  items: [{ sku: 'MA', name: 'MA Wet Jar', qty: 100, dispatched: 0, rate: 1 }],
  plan: [],
  ...extra,
});
const current = (code, plannedAt, overdueMins = 0) => ({ code, name: `Step ${code}`, plannedAt, overdueMins, ownerName: 'Sneha' });

const ORDERS = [
  order('a', { group: 'OVERDUE', current: current('2.06', on(19), 900), dispatchedQty: 40,
    items: [{ sku: 'MA', name: 'MA Wet Jar', qty: 100, dispatched: 40, rate: 1 }],
    plan: [{ sku: 'MA', name: 'MA Wet Jar', date: on(25), qty: 60, done: 0 }],
    dispatches: [{ sku: 'MA', name: 'MA Wet Jar', date: on(19), qty: 40 }] }),
  order('b', { group: 'OPEN', current: current('2.06', on(22)),
    items: [{ sku: 'GJ', name: 'Grinder Jar', qty: 50, dispatched: 0, rate: 1 }],
    plan: [
      { sku: 'GJ', name: 'Grinder Jar', date: on(25), qty: 50, done: 0 },
      { sku: 'GJ', name: 'Grinder Jar', date: on(17), qty: 30, done: 30 }, // earlier this week, already sent
    ] }),
  order('c', { group: 'COMPLETED', soStatus: 'COMPLETED', dispatchedQty: 100,
    items: [{ sku: 'MA', name: 'MA Wet Jar', qty: 100, dispatched: 100, rate: 1 }],
    dispatches: [{ sku: 'MA', name: 'MA Wet Jar', date: on(5, 12, 9), qty: 100 }] }), // sent in October
  order('d', { group: 'CANCELLED', soStatus: 'CANCELLED', dispatchedQty: 10,
    plan: [{ sku: 'MA', name: 'MA Wet Jar', date: on(25), qty: 30, done: 0 }],
    dispatches: [{ sku: 'MA', name: 'MA Wet Jar', date: on(15), qty: 10 }] }),
  order('e', { group: 'OPEN', receivedAt: on(2, 12, 9), current: current('2.03', null) }), // received in October
];
const CHALLANS = [
  { salesOrderId: 'a', dcDate: on(20, 9), qty: 40 },
  { soNumber: 'SO-b', dcDate: on(20, 8), qty: 5 },
  { salesOrderId: 'c', dcDate: on(19, 18), qty: 100 }, // yesterday
];

test('KPI tiles: live orders, pending, today\'s challans and dispatched quantity', () => {
  const today = todayChallans(CHALLANS, ORDERS, NOW);
  assert.equal(today.count, 2);
  assert.equal(today.qty, 45);
  assert.deepEqual([...today.byOrder.keys()].sort(), ['a', 'b']); // SO-b matched by its number
  assert.deepEqual(companyKpis(ORDERS, today), {
    salesOrders: 4, pending: 3, challansToday: 2, dispatchToday: 45,
    dispatched: 140, delayed: 1, completed: 1, cancelled: 1,
  });
});

test('page filters: group, KPI, current step, SKU and planned day combine', () => {
  const today = todayChallans(CHALLANS, ORDERS, NOW);
  const ids = (f, opts) => filterOrders(ORDERS, { ...EMPTY_ORDER_FILTER, ...f }, today, opts).map((r) => r.id);
  assert.deepEqual(ids({ group: 'PENDING' }), ['a', 'b', 'e']);
  assert.deepEqual(ids({ group: 'OVERDUE' }), ['a']);
  assert.deepEqual(ids({ kpi: 'challan' }), ['a', 'b']);
  assert.deepEqual(ids({ kpi: 'dispatched' }), ['a', 'c', 'd']);
  assert.deepEqual(ids({ step: '2.06' }), ['a', 'b']);
  assert.deepEqual(ids({ sku: 'GJ' }), ['b']);
  assert.deepEqual(ids({ sku: 'GJ' }, { skipSku: true }).length, 5);
  assert.deepEqual(ids({ day: startOfDay(on(25)) }), ['a', 'b', 'd']);
  assert.deepEqual(ids({ day: startOfDay(on(25)), group: 'PENDING' }), ['a', 'b']);
});

test('delay split and insights', () => {
  assert.deepEqual(delaySplit(ORDERS), { live: 4, open: 2, overdue: 1, completed: 1 });
  const lines = companyInsights(ORDERS, ORDERS);
  assert.equal(lines[0], '1 order is past the planned time right now.');
  assert.equal(lines[1], 'Biggest queue is at 2.06 Step 2.06 with 2 orders.');
  assert.equal(lines[2], 'Average fulfilment across live orders is 35%.'); // (40 + 0 + 100 + 0) / 4
  assert.equal(lines[3], 'Longest delay: SO-a, 15h 0m late at 2.06.');
});

test('stage analysis: each measure counts by its own date', () => {
  const opts = { mode: 'pending', time: 'monthly', from: '', to: '', so: '', party: '' };
  const bars = (o) => stageBars(ORDERS, { ...opts, ...o }, NOW).map((b) => [b.key, b.value]);
  // Pending: running orders received in the period — e came in October; c is closed; d cancelled.
  assert.deepEqual(bars({}), [['MA', 60], ['GJ', 50]]);
  assert.deepEqual(bars({ time: 'all' }), [['MA', 160], ['GJ', 50]]);
  assert.deepEqual(bars({ time: 'custom', from: '2026-10-01', to: '2026-10-31' }), [['MA', 100]]);
  // Dispatched: challans dated in the period, whenever the order came in.
  assert.deepEqual(bars({ mode: 'dispatched' }), [['MA', 50]]); // c's October challan left out
  assert.deepEqual(bars({ mode: 'dispatched', time: 'weekly' }), [['MA', 40]]); // Mon 16 – Sun 22: only the 19th
  assert.deepEqual(bars({ mode: 'dispatched', time: 'all' }), [['MA', 150]]);
  assert.deepEqual(bars({ mode: 'dispatched', time: 'all', so: 'c' }), [['MA', 100]]);
  // Plan: everything planned on phases dated in the period — past days too, as the calendar shows.
  assert.deepEqual(bars({ mode: 'plan' }), [['GJ', 80], ['MA', 60]]); // cancelled d left out
  assert.deepEqual(bars({ mode: 'plan', time: 'weekly' }), [['GJ', 30]]);
  const [gj] = stageBars(ORDERS, { ...opts, mode: 'plan' }, NOW);
  assert.equal(gj.note, 'planned 80 · sent 30 · left 50');
  assert.deepEqual(bars({ party: 'p-b' }).map(([k]) => k), ['GJ']);
  assert.equal(stageEmptyText({ mode: 'dispatched', time: 'monthly' }, true), 'Nothing dispatched in this period. Choose "All time" to look further back.');
  assert.equal(stageEmptyText({ mode: 'pending', time: 'all' }, false), 'No orders in this view.');
});

test('quick overview puts the most overdue step first; calendar day keys round-trip', () => {
  assert.deepEqual(upcomingOrders(ORDERS).map((r) => r.id), ['e', 'a', 'b']); // e has no plan date → its receipt date
  assert.equal(toDayKey(on(5, 23)), '2026-11-05');
  assert.equal(fromDayKey('2026-11-05'), startOfDay(on(5)));
  assert.equal(toDayKey(fromDayKey('2026-01-31')), '2026-01-31');
});

// ── My view ──
const TASKS = [
  { key: 1, state: 'open', stepCode: '2.06', stepName: 'Delivery Challan', soNumber: 'SO-1', plannedAt: on(19) },     // overdue
  { key: 2, state: 'open', stepCode: '2.06', stepName: 'Delivery Challan', soNumber: 'SO-2', plannedAt: on(20, 18) }, // due today
  { key: 3, state: 'open', stepCode: '2.10', stepName: 'Payment Follow-up', soNumber: 'SO-3', plannedAt: on(23) },
  { key: 4, state: 'open', stepCode: '2.10', stepName: 'Payment Follow-up', soNumber: 'SO-4', plannedAt: null },
  { key: 5, state: 'done', stepCode: '2.06', stepName: 'Delivery Challan', plannedAt: on(10), doneAt: on(9) },
  { key: 6, state: 'done', stepCode: '2.10', stepName: 'Payment Follow-up', plannedAt: on(10), doneAt: on(12) },  // late
];

test('task states and my KPI tiles', () => {
  assert.deepEqual(TASKS.map((t) => taskState(t, NOW)), ['OVERDUE', 'DUE_TODAY', 'OPEN', 'OPEN', 'DONE', 'DONE_LATE']);
  assert.deepEqual(myKpis(TASKS, NOW), { open: 4, dueToday: 1, overdue: 1, done: 2, late: 1, onTimePct: 50 });
  assert.equal(myKpis([], NOW).onTimePct, null);
});

test('my filters and step bars', () => {
  const keys = (f) => filterTasks(TASKS, { ...EMPTY_TASK_FILTER, ...f }, NOW).map((t) => t.key);
  assert.deepEqual(keys({ status: 'OPEN' }), [1, 2, 3, 4]);
  assert.deepEqual(keys({ status: 'ON_TRACK' }), [2, 3, 4]);
  assert.deepEqual(keys({ status: 'OVERDUE' }), [1]);
  assert.deepEqual(keys({ status: 'DONE' }), [5, 6]);
  assert.deepEqual(keys({ status: 'DONE_LATE' }), [6]);
  assert.deepEqual(keys({ step: '2.10', status: 'OPEN' }), [3, 4]);
  assert.deepEqual(keys({ day: startOfDay(on(12)) }), [6]); // a done task sits on the day it was done
  assert.deepEqual(myStepBars(TASKS, 'open', NOW).map((b) => [b.key, b.value]), [['2.06', 2], ['2.10', 2]]);
  assert.deepEqual(myStepBars(TASKS, 'overdue', NOW).map((b) => b.name), ['2.06 Delivery Challan']);
});

test('my overview, calendar and insights', () => {
  assert.deepEqual(upcomingTasks(TASKS, NOW).map((t) => t.key), [1, 2, 3, 4]);
  const month = monthTasks(TASKS, 2026, 10);
  assert.deepEqual(month.get(startOfDay(on(20))).map((t) => t.key), [2]);
  const lines = myInsights(TASKS, NOW);
  assert.equal(lines[0], '1 of your 4 open tasks is past the planned time.');
  assert.ok(lines.includes('You finished 50% of your 2 tasks on time in the last 30 days.'));
  assert.ok(lines.some((l) => l.startsWith('Longest delay: SO-1 at 2.06, 22h 0m late')));
});

test('duration labels', () => {
  assert.equal(durLabel(45), '45m');
  assert.equal(durLabel(320), '5h 20m');
  assert.equal(durLabel(163260), '113d 9h');
});
