/**
 * O2D Dashboard (full view) — one row per order for the whole company.
 *
 * Pure: o2d-dashboard.js reads the collections and hands them here, so the
 * rules below can be tested without a database.
 *
 * An order's current step and its owner come from the open My FMS Tasks rows
 * of that order (o2d-fms-tasks.js) — the most urgent one when several are
 * open, as after dispatch each challan walks its own steps — so the dashboard
 * never disagrees with anybody's task list.
 *
 * `group` — how the order is counted everywhere on the dashboard:
 *   CANCELLED  the sales order is cancelled
 *   COMPLETED  every O2D step is closed (an order with no O2D record:
 *              the sales order is completed or short-closed)
 *   OVERDUE    an open step is past its planned time
 *   OPEN       anything else
 */
import { SO_STATUS } from '../../config/constants.js';

const DONE = ['DONE', 'DELAYED'];
const ms = (d) => (d ? new Date(d).getTime() : null);
const num = (v) => Number(v) || 0;
const idOf = (v) => (v ? String(v._id || v) : null);

// The app reads only the newest dispatch schedule of a sales order (see
// dispatch-control.service.js), so older copies must not add to the plan.
const latestSchedules = (schedules) => {
  const bySo = new Map();
  schedules.forEach((s) => {
    const key = s.soNumber || idOf(s.orderId);
    if (!key) return;
    const prev = bySo.get(key);
    if (!prev || (ms(s.createdAt) || 0) > (ms(prev.createdAt) || 0)) bySo.set(key, s);
  });
  return [...bySo.values()];
};

// Dispatch plan lines of one schedule: one per planned phase.
const planLines = (schedule) => {
  const lines = [];
  (schedule.items || []).forEach((it) => (it.phases || []).forEach((ph) => {
    if (ph.status === 'CANCELLED' || !ph.plannedDate || !num(ph.plannedQty)) return;
    lines.push({
      sku: it.skuCode || it.skuName || '',
      name: it.skuName || it.skuCode || '—',
      date: ph.plannedDate,
      qty: num(ph.plannedQty),
      done: num(ph.totalActualQty),
    });
  }));
  return lines;
};

// Today's challans are picked in the viewer's own time zone, so the last two
// days are sent with their totals.
const RECENT_CHALLAN_MS = 2 * 24 * 60 * 60 * 1000;

const challanQty = (c) => num(c.totalQuantityPcs) || (c.items || []).reduce((a, it) => a + num(it.quantityPcs), 0);

/**
 * `challans` — every live (not cancelled) delivery challan. Each order gets
 * its own as `dispatches` (one line per SKU, dated), so "Dispatched" in Stage
 * analysis counts what went out in the chosen period.
 */
export const buildBoard = ({
  orders = [], processes = [], schedules = [], challans = [], tasks = [], defs = [], now = Date.now(),
}) => {
  const defByCode = new Map(defs.map((d) => [d.stepCode, d]));

  const processByOrder = new Map();
  processes.forEach((p) => { if (p.salesOrderId) processByOrder.set(idOf(p.salesOrderId), p); });

  const openByProcess = new Map();
  tasks.forEach((t) => {
    if (t.state !== 'open') return;
    const key = String(t.processId);
    if (!openByProcess.has(key)) openByProcess.set(key, []);
    openByProcess.get(key).push(t);
  });

  const planByOrder = new Map();
  const planBySo = new Map();
  latestSchedules(schedules).forEach((s) => {
    const lines = planLines(s);
    if (s.orderId) planByOrder.set(idOf(s.orderId), lines);
    if (s.soNumber) planBySo.set(s.soNumber, lines);
  });

  const dispatchesByOrder = new Map();
  const dispatchesBySo = new Map();
  challans.forEach((c) => {
    const lines = (c.items || [])
      .filter((it) => num(it.quantityPcs))
      .map((it) => ({ sku: it.skuCode || it.skuName || '', name: it.skuName || it.skuCode || '—', date: c.dcDate, qty: num(it.quantityPcs) }));
    if (!lines.length) return;
    const [map, key] = c.orderId ? [dispatchesByOrder, idOf(c.orderId)] : [dispatchesBySo, c.soNumber];
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(...lines);
  });

  // Most urgent open step first: the oldest planned time, unplanned last.
  const currentOf = (open) => {
    if (!open.length) return null;
    const t = [...open].sort((a, b) => (ms(a.plannedAt) ?? Infinity) - (ms(b.plannedAt) ?? Infinity))[0];
    const planned = ms(t.plannedAt);
    const owner = (t.doers || [])[0] || null;
    return {
      code: t.stepCode,
      name: t.stepName || defByCode.get(t.stepCode)?.name || t.stepCode,
      plannedAt: t.plannedAt || null,
      dcNumber: t.dcNumber || null,
      ownerId: owner?.id || null,
      ownerName: owner?.name || null,
      overdueMins: planned != null && planned < now ? Math.round((now - planned) / 60000) : 0,
    };
  };

  const progressOf = (process) => {
    const steps = (process?.steps || []).filter((s) => s.status !== 'SKIPPED');
    return steps.length ? Math.round((steps.filter((s) => DONE.includes(s.status)).length / steps.length) * 100) : 0;
  };

  const rowOf = (order, process) => {
    const open = process ? openByProcess.get(String(process._id)) || [] : [];
    const status = order?.status || null;
    let group;
    if (status === SO_STATUS.CANCELLED) group = 'CANCELLED';
    else if (process ? process.isCompleted : [SO_STATUS.COMPLETED, SO_STATUS.SHORT_CLOSED].includes(status)) group = 'COMPLETED';
    else if (open.some((t) => t.plannedAt && ms(t.plannedAt) < now)) group = 'OVERDUE';
    else group = 'OPEN';

    const items = (order?.items || []).map((it) => ({
      sku: it.skuCode || it.skuName || '',
      name: it.skuName || it.skuCode || '—',
      qty: num(it.orderQty),
      dispatched: num(it.dispatchedQty),
      rate: num(it.rate),
    }));
    const current = group === 'OPEN' || group === 'OVERDUE' ? currentOf(open) : null;

    return {
      id: order ? String(order._id) : `intake:${process._id}`,
      salesOrderId: order ? String(order._id) : null,
      processId: process ? String(process._id) : null,
      soNumber: order?.soNumber || process?.soNumber || null,
      poNumber: order?.poNumber || null,
      partyId: idOf(order?.partyId),
      partyName: order?.partyName || process?.partyName || '—',
      receivedAt: order?.orderDate || process?.createdAt || null,
      soStatus: status,
      group,
      phase: current ? defByCode.get(current.code)?.phase || null : null,
      current,
      openSteps: open.length,
      progress: group === 'COMPLETED' ? 100 : progressOf(process),
      value: items.reduce((a, it) => a + it.qty * it.rate, 0),
      orderedQty: num(order?.totalOrderQty) || items.reduce((a, it) => a + it.qty, 0),
      dispatchedQty: num(order?.totalDispatchedQty) || items.reduce((a, it) => a + it.dispatched, 0),
      items,
      plan: order ? planByOrder.get(String(order._id)) || planBySo.get(order.soNumber) || [] : [],
      dispatches: order
        ? [...(dispatchesByOrder.get(String(order._id)) || []), ...(dispatchesBySo.get(order.soNumber) || [])]
        : [],
    };
  };

  const rows = orders.map((order) => rowOf(order, processByOrder.get(String(order._id)) || null));
  // Orders logged from a call / mail / WhatsApp, not yet punched as a sales order.
  processes
    .filter((p) => !p.salesOrderId && p.source === 'INTAKE')
    .forEach((process) => rows.push(rowOf(null, process)));
  rows.sort((a, b) => (ms(b.receivedAt) || 0) - (ms(a.receivedAt) || 0));

  return {
    generatedAt: new Date(now).toISOString(),
    steps: [...defs]
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .map((d) => ({ code: d.stepCode, name: d.name || d.stepCode, phase: d.phase || null })),
    orders: rows,
    challans: challans
      .filter((c) => (ms(c.dcDate) || 0) >= now - RECENT_CHALLAN_MS)
      .map((c) => ({
        salesOrderId: idOf(c.orderId),
        soNumber: c.soNumber || null,
        dcNumber: c.dcNumber || null,
        dcDate: c.dcDate,
        qty: challanQty(c),
      })),
  };
};

// ── KPI tiles only (the Delegation Suite's Dashboard) ───────────────────────
// The same numbers as the O2D Dashboard's tiles, by the same rules, so the two
// never disagree. "Today" is the viewer's day: `tzOffset` is the browser's
// Date#getTimezoneOffset() (−330 in India).

const DAY_MS = 24 * 60 * 60 * 1000;
const dayStartOf = (now, tzOffset = 0) => {
  const shift = tzOffset * 60000;
  return Math.floor((now - shift) / DAY_MS) * DAY_MS + shift;
};

/** Company tiles from buildBoard's result. */
export const summarizeBoard = (board, { now = Date.now(), tzOffset = 0 } = {}) => {
  const start = dayStartOf(now, tzOffset);
  const orders = board?.orders || [];
  const count = (g) => orders.filter((r) => r.group === g).length;
  const today = (board?.challans || []).filter((c) => {
    const t = ms(c.dcDate);
    return t != null && t >= start && t < start + DAY_MS;
  });
  return {
    scope: 'company',
    salesOrders: orders.filter((r) => r.group !== 'CANCELLED').length,
    pending: count('OPEN') + count('OVERDUE'),
    challansToday: today.length,
    dispatchToday: today.reduce((a, c) => a + num(c.qty), 0),
    dispatched: orders.filter((r) => r.group !== 'CANCELLED').reduce((a, r) => a + num(r.dispatchedQty), 0),
    delayed: count('OVERDUE'),
    completed: count('COMPLETED'),
    cancelled: count('CANCELLED'),
  };
};

/** One person's tiles from their My FMS Tasks rows (buddy rows left out). */
export const summarizeTasks = (tasks, { now = Date.now(), tzOffset = 0 } = {}) => {
  const start = dayStartOf(now, tzOffset);
  const out = { scope: 'mine', open: 0, dueToday: 0, delayed: 0, done: 0, late: 0, onTimePct: null };
  (tasks || []).filter((t) => !t.asBuddy).forEach((t) => {
    const planned = ms(t.plannedAt);
    if (t.state === 'done') {
      out.done += 1;
      if (planned != null && ms(t.doneAt) > planned) out.late += 1;
      return;
    }
    out.open += 1;
    if (planned != null && planned < now) out.delayed += 1;
    else if (planned != null && planned >= start && planned < start + DAY_MS) out.dueToday += 1;
  });
  if (out.done) out.onTimePct = Math.round(((out.done - out.late) / out.done) * 100);
  return out;
};

export default buildBoard;
