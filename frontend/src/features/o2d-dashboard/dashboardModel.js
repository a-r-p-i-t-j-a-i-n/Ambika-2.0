/**
 * O2D Dashboard — the numbers behind every panel. Worked out in the browser
 * from one load, so every panel narrows the same rows: in the client's design
 * clicking a tile, a donut slice, a bar or a calendar day filters the page.
 * Pure functions, no React (tested with node:test).
 *
 *   Company view — rows from GET /o2d-fms/dashboard/orders, one per order.
 *   My view      — rows from GET /o2d-fms/fms-tasks, the person's own
 *                  My FMS Tasks (open ones, plus those done in the last 30 days).
 */

export const DAY_MS = 86400000;
export const clock = () => Date.now();
export const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const pad2 = (n) => String(n).padStart(2, '0');
/** Local day ⇄ 'YYYY-MM-DD', the Dispatch Calendar's day key. */
export const toDayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
export const fromDayKey = (key) => { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const ms = (d) => (d ? new Date(d).getTime() : null);
const sum = (list, pick) => list.reduce((a, x) => a + (Number(pick(x)) || 0), 0);
export const pctOf = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtIn = (n) => Math.round(n).toLocaleString('en-IN');

/** "3d 4h" · "5h 20m" · "45m" */
export const durLabel = (mins) => {
  const m = Math.max(0, Math.round(mins || 0));
  if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
};

// ══ Company view ══════════════════════════════════════════════════════════

export const isLive = (r) => r.group !== 'CANCELLED';
export const isPending = (r) => r.group === 'OPEN' || r.group === 'OVERDUE';
const isClosedOrder = (r) => r.group === 'CANCELLED' || ['SHORT_CLOSED', 'COMPLETED'].includes(r.soStatus);
export const partyKey = (r) => r.partyId || r.partyName || '';
export const orderLabel = (r) => r.soNumber || (r.salesOrderId ? '—' : 'Intake');

/** Challans dated today (viewer's day): totals, and per order id. */
export const todayChallans = (challans, orders, now = Date.now()) => {
  const today = startOfDay(now);
  const idBySo = new Map(orders.filter((o) => o.soNumber).map((o) => [o.soNumber, o.id]));
  const byOrder = new Map();
  let count = 0;
  let qty = 0;
  (challans || []).forEach((c) => {
    if (!c.dcDate || startOfDay(c.dcDate) !== today) return;
    count += 1;
    qty += c.qty || 0;
    const id = c.salesOrderId || idBySo.get(c.soNumber);
    if (!id) return;
    const prev = byOrder.get(id) || { count: 0, qty: 0 };
    byOrder.set(id, { count: prev.count + 1, qty: prev.qty + (c.qty || 0) });
  });
  return { count, qty, byOrder };
};

export const companyKpis = (orders, today) => {
  const n = (g) => orders.filter((r) => r.group === g).length;
  return {
    salesOrders: orders.filter(isLive).length,
    pending: orders.filter(isPending).length,
    challansToday: today.count,
    dispatchToday: today.qty,
    dispatched: sum(orders.filter(isLive), (r) => r.dispatchedQty),
    delayed: n('OVERDUE'),
    completed: n('COMPLETED'),
    cancelled: n('CANCELLED'),
  };
};

export const EMPTY_ORDER_FILTER = { group: '', kpi: '', step: '', sku: '', day: null };

/**
 * Orders in the current view.
 *   group — PENDING (open + delayed) | OPEN | OVERDUE | COMPLETED | CANCELLED
 *   kpi   — challan / dispatchToday (a challan today) | dispatched (anything sent)
 *   step  — current step code · sku — has that SKU · day — a dispatch planned that day
 */
export const filterOrders = (orders, f, today, { skipSku = false } = {}) => orders.filter((r) =>
  (!f.group || (f.group === 'PENDING' ? isPending(r) : r.group === f.group))
  && (!(f.kpi === 'challan' || f.kpi === 'dispatchToday') || today.byOrder.has(r.id))
  && (f.kpi !== 'dispatched' || r.dispatchedQty > 0)
  && (!f.step || r.current?.code === f.step)
  && (skipSku || !f.sku || r.items.some((it) => it.sku === f.sku))
  && (f.day == null || r.plan.some((ph) => startOfDay(ph.date) === f.day)));

export const delaySplit = (rows) => {
  const n = (g) => rows.filter((r) => r.group === g).length;
  return { live: rows.filter(isLive).length, open: n('OPEN'), overdue: n('OVERDUE'), completed: n('COMPLETED') };
};

/** "# …" lines under the donut. */
export const companyInsights = (allOrders, view) => {
  const overdue = view.filter((r) => r.group === 'OVERDUE');
  const lines = [`${plural(overdue.length, 'order is', 'orders are')} past the planned time right now.`];

  const queue = new Map();
  allOrders.forEach((r) => {
    if (!isPending(r) || !r.current) return;
    const q = queue.get(r.current.code) || { code: r.current.code, name: r.current.name, n: 0 };
    q.n += 1;
    queue.set(r.current.code, q);
  });
  const top = [...queue.values()].sort((a, b) => b.n - a.n)[0];
  if (top) lines.push(`Biggest queue is at ${top.code} ${top.name} with ${plural(top.n, 'order', 'orders')}.`);

  const live = allOrders.filter((r) => isLive(r) && r.orderedQty > 0);
  if (live.length) {
    const avg = live.reduce((a, r) => a + Math.min(1, r.dispatchedQty / r.orderedQty), 0) / live.length;
    lines.push(`Average fulfilment across live orders is ${Math.round(avg * 100)}%.`);
  }

  const worst = allOrders.filter((r) => r.group === 'OVERDUE' && r.current)
    .sort((a, b) => b.current.overdueMins - a.current.overdueMins)[0];
  if (worst) lines.push(`Longest delay: ${orderLabel(worst)}, ${durLabel(worst.current.overdueMins)} late at ${worst.current.code}.`);
  return lines;
};

export const STAGE_MODES = [
  { value: 'pending', label: '1. Pending SKU' },
  { value: 'dispatched', label: '2. Dispatched' },
  { value: 'plan', label: '3. Dispatch plan' },
];
export const STAGE_TIMES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Custom' },
  { value: 'all', label: 'All time' },
];

/**
 * The days a measure counts, as [from, to): this calendar month; this week
 * (Monday to Sunday, the dispatch calendar's rows); custom dates (yyyy-mm-dd);
 * or all.
 */
export const stagePeriod = ({ time, from, to }, now = Date.now()) => {
  const today = startOfDay(now);
  if (time === 'all') return [-Infinity, Infinity];
  if (time === 'weekly') {
    const d = new Date(today);
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
    return [monday, new Date(monday).setDate(new Date(monday).getDate() + 7)];
  }
  if (time === 'custom') {
    return [
      from ? new Date(`${from}T00:00:00`).getTime() : -Infinity,
      to ? new Date(`${to}T00:00:00`).getTime() + DAY_MS : Infinity,
    ];
  }
  const d = new Date(now);
  return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()];
};

/**
 * Quantity by SKU, biggest first (top 10). Each measure is dated its own way:
 *   pending    — ordered minus dispatched on running orders received in the period
 *   dispatched — what went out on challans dated in the period
 *   plan       — planned on dispatch-plan phases dated in the period (the same
 *                figures as the Dispatch calendar); `note` adds sent / left
 */
export const stageBars = (rows, opts, now = Date.now()) => {
  const [from, to] = stagePeriod(opts, now);
  const inPeriod = (d) => { const t = ms(d); return t != null && t >= from && t < to; };
  const bySku = new Map();
  const add = (key, name, value, sent = 0) => {
    if (!value) return;
    const bar = bySku.get(key) || { key, name, value: 0, sent: 0 };
    bar.value += value;
    bar.sent += sent;
    bySku.set(key, bar);
  };
  rows.forEach((r) => {
    if (opts.so && r.id !== opts.so) return;
    if (opts.party && partyKey(r) !== opts.party) return;
    if (opts.mode === 'dispatched') {
      (r.dispatches || []).forEach((d) => { if (inPeriod(d.date)) add(d.sku, d.name, d.qty); });
      return;
    }
    if (opts.mode === 'plan') {
      if (r.group === 'CANCELLED') return;
      r.plan.forEach((ph) => { if (inPeriod(ph.date)) add(ph.sku, ph.name, ph.qty, Math.min(ph.qty, ph.done)); });
      return;
    }
    if (isClosedOrder(r) || !inPeriod(r.receivedAt)) return;
    r.items.forEach((it) => add(it.sku, it.name, Math.max(0, it.qty - it.dispatched)));
  });
  return [...bySku.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map(({ sent, ...bar }) => (opts.mode === 'plan'
      ? { ...bar, note: `planned ${fmtIn(bar.value)} · sent ${fmtIn(sent)} · left ${fmtIn(Math.max(0, bar.value - sent))}` }
      : bar));
};

/** What an empty Stage analysis says — and how to see more. */
export const stageEmptyText = ({ mode, time }, hasOrders) => {
  if (!hasOrders) return 'No orders in this view.';
  const all = time === 'all';
  if (mode === 'dispatched') return `Nothing dispatched in this period.${all ? '' : ' Choose "All time" to look further back.'}`;
  if (mode === 'plan') return `Nothing planned for dispatch in this period.${all ? '' : ' Choose "All time" to see the whole plan.'}`;
  return all
    ? 'Nothing pending — every running order is fully dispatched.'
    : 'Nothing pending on orders received in this period. Choose "All time" to see every running order.';
};

/** Open orders for Quick Overview: the most overdue current step first. */
export const upcomingOrders = (rows, limit = 14) => rows
  .filter((r) => r.current && isPending(r))
  .sort((a, b) => (ms(a.current.plannedAt) ?? ms(a.receivedAt) ?? 0) - (ms(b.current.plannedAt) ?? ms(b.receivedAt) ?? 0))
  .slice(0, limit);

export const partyOptions = (rows) => {
  const seen = new Map();
  rows.forEach((r) => { const k = partyKey(r); if (k && !seen.has(k)) seen.set(k, r.partyName); });
  return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
};

// ══ My view ═══════════════════════════════════════════════════════════════

/** OPEN · DUE_TODAY · OVERDUE for open rows; DONE · DONE_LATE for finished ones. */
export const taskState = (t, now = Date.now()) => {
  const planned = ms(t.plannedAt);
  if (t.state === 'done') return planned != null && ms(t.doneAt) > planned ? 'DONE_LATE' : 'DONE';
  if (planned != null && planned < now) return 'OVERDUE';
  if (planned != null && startOfDay(planned) === startOfDay(now)) return 'DUE_TODAY';
  return 'OPEN';
};
const OPEN_STATES = ['OPEN', 'DUE_TODAY', 'OVERDUE'];
const DONE_STATES = ['DONE', 'DONE_LATE'];

/** The day a task sits on in the calendar: when it is due, or when it was done. */
export const taskDay = (t) => (t.state === 'done' ? t.doneAt : t.plannedAt);

export const myKpis = (tasks, now = Date.now()) => {
  const states = tasks.map((t) => taskState(t, now));
  const n = (...list) => states.filter((s) => list.includes(s)).length;
  const done = n(...DONE_STATES);
  return {
    open: n(...OPEN_STATES),
    dueToday: n('DUE_TODAY'),
    overdue: n('OVERDUE'),
    done,
    late: n('DONE_LATE'),
    onTimePct: done ? pctOf(n('DONE'), done) : null,
  };
};

export const EMPTY_TASK_FILTER = { status: '', step: '', day: null };

/**
 * status — OPEN (every open task) | ON_TRACK (open, not late) | OVERDUE |
 *          DUE_TODAY | DONE (every finished task) | DONE_LATE
 */
export const filterTasks = (tasks, f, now = Date.now()) => tasks.filter((t) => {
  const s = taskState(t, now);
  if (f.status === 'OPEN' && !OPEN_STATES.includes(s)) return false;
  if (f.status === 'ON_TRACK' && !['OPEN', 'DUE_TODAY'].includes(s)) return false;
  if (f.status === 'DONE' && !DONE_STATES.includes(s)) return false;
  if (['OVERDUE', 'DUE_TODAY', 'DONE_LATE'].includes(f.status) && s !== f.status) return false;
  if (f.step && t.stepCode !== f.step) return false;
  if (f.day != null && (!taskDay(t) || startOfDay(taskDay(t)) !== f.day)) return false;
  return true;
});

export const MY_STEP_MODES = [
  { value: 'open', label: 'Open tasks' },
  { value: 'overdue', label: 'Delayed' },
  { value: 'done', label: 'Done · 30 days' },
];

/** Task count per step, biggest first. */
export const myStepBars = (tasks, mode, now = Date.now()) => {
  const want = mode === 'done' ? DONE_STATES : mode === 'overdue' ? ['OVERDUE'] : OPEN_STATES;
  const byStep = new Map();
  tasks.forEach((t) => {
    if (!want.includes(taskState(t, now))) return;
    const bar = byStep.get(t.stepCode) || { key: t.stepCode, name: `${t.stepCode} ${t.stepName || ''}`.trim(), value: 0 };
    bar.value += 1;
    byStep.set(t.stepCode, bar);
  });
  return [...byStep.values()].sort((a, b) => b.value - a.value || a.key.localeCompare(b.key, undefined, { numeric: true }));
};

export const myInsights = (tasks, now = Date.now()) => {
  const k = myKpis(tasks, now);
  const lines = [];
  lines.push(k.overdue
    ? `${k.overdue} of your ${plural(k.open, 'open task', 'open tasks')} ${k.overdue === 1 ? 'is' : 'are'} past the planned time.`
    : k.open ? `None of your ${plural(k.open, 'open task', 'open tasks')} is late.` : 'You have no open tasks right now.');
  const open = tasks.filter((t) => OPEN_STATES.includes(taskState(t, now)));
  const [top] = myStepBars(open, 'open', now);
  if (top && k.open > 1) lines.push(`Most of your open work is at ${top.name} (${top.value}).`);
  if (k.done) lines.push(`You finished ${k.onTimePct}% of your ${plural(k.done, 'task', 'tasks')} on time in the last 30 days.`);
  if (k.dueToday) lines.push(`${plural(k.dueToday, 'task is', 'tasks are')} due later today.`);
  const worst = open.filter((t) => taskState(t, now) === 'OVERDUE')
    .sort((a, b) => ms(a.plannedAt) - ms(b.plannedAt))[0];
  if (worst) {
    const late = Math.round((now - ms(worst.plannedAt)) / 60000);
    lines.push(`Longest delay: ${worst.soNumber || 'an order'} at ${worst.stepCode}, ${durLabel(late)} late.`);
  }
  return lines;
};

/** Open tasks for Quick Overview: the most overdue first, unplanned last. */
export const upcomingTasks = (tasks, now = Date.now(), limit = 14) => tasks
  .filter((t) => OPEN_STATES.includes(taskState(t, now)))
  .sort((a, b) => (ms(a.plannedAt) ?? Infinity) - (ms(b.plannedAt) ?? Infinity))
  .slice(0, limit);

/** Tasks on each day of a month (due, or done that day): day start → tasks. */
export const monthTasks = (tasks, year, month) => {
  const start = new Date(year, month, 1).getTime();
  const end = new Date(year, month + 1, 1).getTime();
  const byDay = new Map();
  tasks.forEach((t) => {
    const at = ms(taskDay(t));
    if (at == null || at < start || at >= end) return;
    const day = startOfDay(at);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(t);
  });
  return byDay;
};
