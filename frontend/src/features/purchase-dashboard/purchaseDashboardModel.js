/**
 * Purchase Dashboard — the numbers behind every panel. Same idea as the O2D
 * Dashboard (o2d-dashboard/dashboardModel.js): everything is worked out in the
 * browser from one load, so a tile, a donut slice, a bar or a calendar day
 * narrows every panel the same way. Pure functions, no React (node:test).
 *
 *   Company view — one row per purchase indent, joined from the existing
 *                  Purchase FMS lists (indents, POs, follow-ups, PIs, GRNs,
 *                  QCs, vendor invoices, vouchers, Tally entries, final
 *                  payments, service completions, rate-change requests) and
 *                  the open Purchase doer tasks (GET /fms-doers/tasks).
 *   My view      — this person's own Purchase doer tasks (GET
 *                  /fms-doers/tasks/mine), shaped like the O2D task rows so the
 *                  O2D my-view rules (taskState, myKpis, …) apply unchanged.
 *
 * Nothing here is invented: every figure is a count or a sum of those records.
 */
import { pctOf, stagePeriod, startOfDay } from '../o2d-dashboard/dashboardModel.js';

const ms = (d) => (d ? new Date(d).getTime() : null);
const num = (v) => Number(v) || 0;
const idOf = (v) => (v ? String(v._id || v) : null);
const uniq = (list) => [...new Set(list.filter(Boolean))];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ── Purchase FMS steps (codes and names as in the doer-task catalog,
//    backend fms-doers/fmsCatalog.js — the codes every Purchase task carries) ──
export const PURCHASE_STEPS = [
  { code: '1.1', name: 'Generate Purchase Indent' },
  { code: '1.1A', name: 'Indent Approval' },
  { code: '1.2', name: 'Receive Quote & Comparative' },
  { code: '1.3', name: 'Approved Quotation' },
  { code: '1.4', name: 'Create PO' },
  { code: '1.4A', name: 'PO Approval' },
  { code: '1.4B', name: 'Release PO' },
  { code: '1.5', name: 'Material Follow-up' },
  { code: '1.6', name: 'PI (Proforma Invoice)' },
  { code: '1.7', name: 'Advance Payment' },
  { code: '1.8', name: 'GRN' },
  { code: '1.9', name: 'Incoming QC' },
  { code: '1.10', name: 'Vendor Invoice' },
  { code: '1.11', name: 'Bill Passing / Voucher' },
  { code: '1.12', name: 'Tally Purchase Entry' },
  { code: '1.13', name: 'Final Payment' },
];
const STEP_NAME = new Map(PURCHASE_STEPS.map((s) => [s.code, s.name]));

// Record states (the backend enums).
const RELEASED = ['RELEASED_TO_VENDOR', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED', 'CLOSED'];
const AWAITING_RECEIPT = ['RELEASED_TO_VENDOR', 'PARTIAL_RECEIVED'];
const RECEIVED_PO = ['PARTIAL_RECEIVED', 'FULLY_RECEIVED', 'CLOSED'];
const PAID_FINAL = ['FULL_PAYMENT', 'SHORT_PAYMENT_COMPLETED'];
const QUOTE_WAIT = ['INDENT_APPROVED', 'QUOTE_PENDING', 'QUOTE_RECEIVED'];
const QUOTES_IN = ['QUOTE_RECEIVED', 'QUOTE_NOT_REQUIRED', 'QUOTATION_APPROVED', 'PARTIAL_PO_CREATED', 'PO_READY', 'CLOSED',
  'SERVICE_PENDING', 'SERVICE_COMPLETED', 'SERVICE_QC_PASSED', 'SERVICE_QC_FAILED', 'SERVICE_QC_PARTIAL'];
const QUOTE_APPROVED = QUOTES_IN.filter((s) => s !== 'QUOTE_RECEIVED');
const FOLLOWUP_LIVE = ['PENDING', 'RESCHEDULED'];
const FOLLOWUP_DONE = ['DONE', 'READY_FOR_GRN', 'CLOSED'];
const QC_DONE = ['PASSED', 'FAILED', 'PARTIAL'];
const VOUCHER_OPEN = ['POSTED', 'PARTIALLY_PAID'];

const isLivePo = (po) => po.poStatus !== 'CANCELLED';
const vendorKeyOf = (po) => (po ? (idOf(po.vendorId) || po.vendorName || '') : '');
const poPending = (po) => (po.items || []).reduce((a, it) => a + Math.max(0, num(it.quantity) - num(it.receivedQty)), 0);

// ══ Company view ══════════════════════════════════════════════════════════

/**
 * One row per indent.
 *
 * `group` — how the indent is counted everywhere on the dashboard:
 *   CANCELLED  indent rejected, quotation not approved, or every PO cancelled
 *   COMPLETED  indent closed, or every live PO closed / finally paid (and no
 *              Purchase step still open on it)
 *   OVERDUE    an open step is past its planned time, a released PO is past
 *              its expected delivery date, or a follow-up is past its date
 *   OPEN       anything else
 */
export const buildPurchaseBoard = (src, now = Date.now()) => {
  const list = (k) => (Array.isArray(src?.[k]) ? src[k] : []);
  const indents = list('indents');
  const pos = list('pos');

  const poById = new Map(pos.map((p) => [idOf(p), p]));
  const poByNumber = new Map(pos.filter((p) => p.poNumber).map((p) => [p.poNumber, p]));
  const indentsOfPo = (po) => (po
    ? uniq([idOf(po.indentId), ...(po.indentIds || []).map(idOf), ...(po.items || []).map((it) => idOf(it.indentId))])
    : []);
  const posOf = (rec) => uniq([
    idOf(rec.poId), ...(rec.poIds || []).map(idOf), rec.poNumber ? idOf(poByNumber.get(rec.poNumber)) : null,
  ]).map((id) => poById.get(id)).filter(Boolean);
  const indentsOf = (rec) => uniq([idOf(rec.indentId), ...posOf(rec).flatMap(indentsOfPo)]);

  // indent id → its records; record id → its indents (for the doer tasks).
  const KEYS = ['followUps', 'pis', 'grns', 'qcs', 'invoices', 'vouchers', 'tallies', 'finals', 'services', 'rateChanges'];
  const bucket = new Map(indents.map((i) => [idOf(i), Object.fromEntries([['pos', []], ['tasks', []], ...KEYS.map((k) => [k, []])])]));
  const entityIndents = new Map(indents.map((i) => [idOf(i), [idOf(i)]]));
  pos.forEach((po) => {
    const ids = indentsOfPo(po);
    entityIndents.set(idOf(po), ids);
    ids.forEach((id) => bucket.get(id)?.pos.push(po));
  });
  KEYS.forEach((k) => list(k).forEach((rec) => {
    const ids = indentsOf(rec);
    if (k !== 'rateChanges') entityIndents.set(idOf(rec), ids);
    ids.forEach((id) => bucket.get(id)?.[k].push(rec));
  }));
  // Final payments per PO — "every live PO finally paid".
  const finalsByPo = new Map();
  list('finals').forEach((f) => posOf(f).forEach((po) => {
    const id = idOf(po);
    if (!finalsByPo.has(id)) finalsByPo.set(id, []);
    finalsByPo.get(id).push(f);
  }));

  const openTasks = list('tasks').filter((t) => t.status === 'OPEN');
  openTasks.forEach((t) => (entityIndents.get(idOf(t.entityId)) || []).forEach((id) => bucket.get(id)?.tasks.push(t)));

  // Most urgent open step first: the oldest planned time, unplanned last (as O2D).
  const currentOf = (open) => {
    if (!open.length) return null;
    const t = [...open].sort((a, b) => (ms(a.plannedAt) ?? Infinity) - (ms(b.plannedAt) ?? Infinity))[0];
    const planned = ms(t.plannedAt);
    const owner = (t.doers || [])[0] || null;
    return {
      code: t.stepCode,
      name: t.stepLabel || STEP_NAME.get(t.stepCode) || t.stepCode,
      plannedAt: t.plannedAt || null,
      ref: t.entityRef || null,
      link: t.link || null,
      ownerName: owner?.name || null,
      overdueMins: planned != null && planned < now ? Math.round((now - planned) / 60000) : 0,
    };
  };

  const rows = indents.map((ind) => {
    const b = bucket.get(idOf(ind));
    const livePos = b.pos.filter(isLivePo);
    const approval = ind.approvalStatus;
    const overall = ind.overallStatus;

    const items = livePos.length
      ? livePos.flatMap((po) => (po.items || []).map((it) => ({
        sku: it.skuCode || it.itemName || '', name: it.itemName || it.skuCode || '—', unit: it.unit || '',
        qty: num(it.quantity), received: num(it.receivedQty), rate: num(it.rate), poNumber: po.poNumber || po.draftNumber || '',
      })))
      : (ind.items || []).map((it) => ({
        sku: it.skuCode || it.itemName || '', name: it.itemName || it.skuCode || '—', unit: it.unit || '',
        qty: num(it.quantity), received: 0, rate: 0, poNumber: '',
      }));

    // Released POs still to be received, with their expected delivery date.
    const plan = livePos
      .filter((po) => AWAITING_RECEIPT.includes(po.poStatus) && po.expectedDeliveryDate)
      .map((po) => ({
        date: po.expectedDeliveryDate,
        poId: idOf(po),
        poNumber: po.poNumber || po.draftNumber || '—',
        vendor: po.vendorName || '—',
        vendorKey: vendorKeyOf(po),
        pending: poPending(po),
        items: (po.items || []).map((it) => ({
          sku: it.skuCode || it.itemName || '', name: it.itemName || it.skuCode || '—', unit: it.unit || '',
          qty: Math.max(0, num(it.quantity) - num(it.receivedQty)),
        })).filter((it) => it.qty > 0),
      }))
      .filter((p) => p.pending > 0);
    const receipts = b.grns
      .filter((g) => !['DRAFT', 'CANCELLED'].includes(g.grnStatus))
      .flatMap((g) => (g.items || []).map((it) => ({
        date: g.grnDate || g.createdAt, sku: it.skuCode || it.itemName || '', name: it.itemName || it.skuCode || '—', qty: num(it.receivedQty),
        vendorKey: vendorKeyOf(posOf(g)[0]),
      })));

    const taskLate = b.tasks.some((t) => t.plannedAt && ms(t.plannedAt) < now);
    const deliveryLate = plan.some((p) => ms(p.date) < now);
    const followUpLate = b.followUps.some((f) => FOLLOWUP_LIVE.includes(f.followUpStatus) && f.plannedAt && ms(f.plannedAt) < now);

    const cancelled = approval === 'REJECTED' || overall === 'QUOTATION_NOT_APPROVED'
      || (b.pos.length > 0 && !livePos.length && !b.tasks.length);
    const completed = overall === 'CLOSED' || (livePos.length > 0 && !b.tasks.length
      && livePos.every((po) => po.poStatus === 'CLOSED' || (finalsByPo.get(idOf(po)) || []).some((f) => PAID_FINAL.includes(f.paymentStatus))));
    let group;
    if (cancelled) group = 'CANCELLED';
    else if (completed) group = 'COMPLETED';
    else if (taskLate || deliveryLate || followUpLate) group = 'OVERDUE';
    else group = 'OPEN';

    // Which steps the records show as done. A later step done means the
    // earlier ones are behind it too (an optional step such as PI may be skipped).
    const done = {
      1.1: true,
      '1.1A': approval === 'APPROVED',
      1.2: QUOTES_IN.includes(overall),
      1.3: QUOTE_APPROVED.includes(overall),
      1.4: livePos.length > 0,
      '1.4A': livePos.some((po) => po.approvalStatus === 'APPROVED' || RELEASED.includes(po.poStatus)),
      '1.4B': livePos.some((po) => RELEASED.includes(po.poStatus)),
      1.5: livePos.some((po) => RECEIVED_PO.includes(po.poStatus)) || b.followUps.some((f) => FOLLOWUP_DONE.includes(f.followUpStatus)),
      1.6: livePos.some((po) => po.piStatus && po.piStatus !== 'NOT_RECEIVED') || b.pis.some((p) => p.piStatus !== 'CANCELLED'),
      1.7: livePos.some((po) => ['COMPLETED', 'NOT_REQUIRED'].includes(po.advancePaymentStatus)),
      1.8: b.grns.some((g) => !['DRAFT', 'CANCELLED'].includes(g.grnStatus)),
      1.9: b.qcs.some((q) => QC_DONE.includes(q.qcStatus)) || b.grns.some((g) => QC_DONE.includes(g.qcStatus)),
      '1.10': b.invoices.some((i) => i.invoiceStatus !== 'CANCELLED'),
      1.11: b.vouchers.some((v) => !['DRAFT', 'CANCELLED'].includes(v.voucherStatus)),
      1.12: b.tallies.some((t) => t.tallyEntryStatus === 'COMPLETED'),
      1.13: b.finals.some((f) => PAID_FINAL.includes(f.paymentStatus)),
    };
    const openCodes = new Set(b.tasks.map((t) => t.stepCode));
    let later = group === 'COMPLETED';
    const steps = [...PURCHASE_STEPS].reverse().map((s) => {
      later = later || !!done[s.code];
      const task = b.tasks.find((t) => t.stepCode === s.code);
      let status = 'PENDING';
      if (openCodes.has(s.code)) status = task?.plannedAt && ms(task.plannedAt) < now ? 'OVERDUE' : 'IN_PROGRESS';
      else if (later) status = 'DONE';
      return { ...s, status, plannedAt: task?.plannedAt || null, ownerName: task?.doers?.[0]?.name || null };
    }).reverse();
    const doneCount = steps.filter((s) => s.status === 'DONE').length;

    const pisDue = b.pis.filter((p) => p.piStatus === 'READY_FOR_ADVANCE_PAYMENT' && num(p.balanceAmount) > 0);
    const payables = b.vouchers.filter((v) => VOUCHER_OPEN.includes(v.voucherStatus) && num(v.balanceAmount) > 0);
    const current = group === 'OPEN' || group === 'OVERDUE' ? currentOf(b.tasks) : null;
    const vendorMap = new Map();
    livePos.forEach((po) => { const k = vendorKeyOf(po); if (k && !vendorMap.has(k)) vendorMap.set(k, po.vendorName || '—'); });

    return {
      id: idOf(ind),
      indentNumber: ind.indentNumber || '—',
      department: ind.department || '',
      requestType: ind.requestType || '',
      vendorName: [...vendorMap.values()].join(', ') || '—',
      vendorKeys: [...vendorMap.keys()],
      vendors: [...vendorMap].map(([key, name]) => ({ key, name })),
      poNumbers: uniq(livePos.map((po) => po.poNumber || po.draftNumber)),
      receivedAt: ind.timestamp || ind.createdAt || null,
      approvalStatus: approval,
      overallStatus: overall,
      group,
      current,
      openSteps: b.tasks.length,
      steps,
      progress: group === 'COMPLETED' ? 100 : Math.round((doneCount / PURCHASE_STEPS.length) * 100),
      value: livePos.reduce((a, po) => a + num(po.grandTotal), 0),
      orderedQty: items.reduce((a, it) => a + it.qty, 0),
      receivedQty: items.reduce((a, it) => a + it.received, 0),
      items,
      lines: livePos.flatMap((po) => (po.items || []).map((it) => ({
        date: po.poDate || po.createdAt, vendorKey: vendorKeyOf(po), sku: it.skuCode || it.itemName || '', name: it.itemName || it.skuCode || '—',
        pending: Math.max(0, num(it.quantity) - num(it.receivedQty)),
      }))),
      plan,
      receipts,
      late: { task: taskLate, delivery: deliveryLate, followUp: followUpLate },
      flags: {
        pendingApproval: approval === 'PENDING_APPROVAL',
        quotePending: approval === 'APPROVED' && QUOTE_WAIT.includes(overall) && !livePos.length,
        poReleased: livePos.some((po) => RELEASED.includes(po.poStatus)),
        grnPending: livePos.some((po) => AWAITING_RECEIPT.includes(po.poStatus)),
        advanceDue: pisDue.length > 0,
        rateChange: b.rateChanges.length > 0,
        overdueTasks: taskLate,
        posPastDue: deliveryLate,
        payables: payables.length > 0,
      },
    };
  });

  rows.sort((a, b) => (ms(b.receivedAt) || 0) - (ms(a.receivedAt) || 0));
  return { rows, steps: PURCHASE_STEPS };
};

const isLive = (r) => r.group !== 'CANCELLED';
export const isPendingRow = (r) => r.group === 'OPEN' || r.group === 'OVERDUE';

/**
 * Tile figures. Counts of indents come from the rows; the money and the
 * record counts (rate changes, tasks, POs) straight from the lists, so they
 * match what each Purchase step shows.
 */
export const purchaseKpis = (rows, src, now = Date.now()) => {
  const list = (k) => (Array.isArray(src?.[k]) ? src[k] : []);
  const n = (pred) => rows.filter(pred).length;
  return {
    totalIndents: n(isLive),
    pendingApproval: n((r) => r.flags.pendingApproval),
    quotePending: n((r) => isLive(r) && r.flags.quotePending),
    poReleased: n((r) => isLive(r) && r.flags.poReleased),
    grnPending: n((r) => isLive(r) && r.flags.grnPending),
    delayed: n((r) => r.group === 'OVERDUE'),
    completed: n((r) => r.group === 'COMPLETED'),
    cancelled: n((r) => r.group === 'CANCELLED'),
    advanceDue: list('pis').filter((p) => p.piStatus === 'READY_FOR_ADVANCE_PAYMENT')
      .reduce((a, p) => a + Math.max(0, num(p.balanceAmount)), 0),
    pendingRateChanges: list('rateChanges').filter((r) => !r.status || r.status === 'PENDING').length,
    overdueTasks: list('tasks').filter((t) => t.status === 'OPEN' && t.plannedAt && ms(t.plannedAt) < now).length,
    posPastDue: list('pos').filter((po) => AWAITING_RECEIPT.includes(po.poStatus) && po.expectedDeliveryDate
      && ms(po.expectedDeliveryDate) < now && poPending(po) > 0).length,
    payables: list('vouchers').filter((v) => VOUCHER_OPEN.includes(v.voucherStatus))
      .reduce((a, v) => a + Math.max(0, num(v.balanceAmount)), 0),
  };
};

// dayIndents — the indents behind the calendar events of the picked day.
export const EMPTY_INDENT_FILTER = { group: '', kpi: '', step: '', sku: '', day: null, dayIndents: null };

/**
 * Indents in the current view.
 *   group — PENDING (open + delayed) | OPEN | OVERDUE | COMPLETED | CANCELLED
 *   kpi   — a tile's flag (see row.flags)
 *   step  — current step code · sku — has that item · day — a PO due that day
 */
export const filterIndents = (rows, f, { skipSku = false } = {}) => rows.filter((r) =>
  (!f.group || (f.group === 'PENDING' ? isPendingRow(r) : r.group === f.group))
  && (!f.kpi || (r.flags[f.kpi] && (f.kpi === 'pendingApproval' || isLive(r))))
  && (!f.step || r.current?.code === f.step)
  && (skipSku || !f.sku || r.items.some((it) => it.sku === f.sku))
  && (f.day == null || (Array.isArray(f.dayIndents)
    ? f.dayIndents.includes(r.id)
    : r.plan.some((p) => startOfDay(p.date) === f.day))));

export const indentSplit = (rows) => {
  const n = (g) => rows.filter((r) => r.group === g).length;
  return { live: rows.filter(isLive).length, open: n('OPEN'), overdue: n('OVERDUE'), completed: n('COMPLETED') };
};

/** "# …" lines under the donut. */
export const purchaseInsights = (allRows, view, kpis) => {
  const overdue = view.filter((r) => r.group === 'OVERDUE');
  const lines = [`${plural(overdue.length, 'indent is', 'indents are')} past the planned time right now.`];

  const queue = new Map();
  allRows.forEach((r) => {
    if (!isPendingRow(r) || !r.current) return;
    const q = queue.get(r.current.code) || { code: r.current.code, name: r.current.name, n: 0 };
    q.n += 1;
    queue.set(r.current.code, q);
  });
  const top = [...queue.values()].sort((a, b) => b.n - a.n)[0];
  if (top) lines.push(`Biggest queue is at ${top.code} ${top.name} with ${plural(top.n, 'indent', 'indents')}.`);

  const ordered = allRows.filter((r) => isLive(r) && r.poNumbers.length && r.orderedQty > 0);
  if (ordered.length) {
    const avg = ordered.reduce((a, r) => a + Math.min(1, r.receivedQty / r.orderedQty), 0) / ordered.length;
    lines.push(`Average receipt across indents with a PO is ${Math.round(avg * 100)}%.`);
  }
  if (kpis?.posPastDue) lines.push(`${plural(kpis.posPastDue, 'released PO is', 'released POs are')} past the expected delivery date.`);

  const worst = allRows.filter((r) => r.group === 'OVERDUE' && r.current?.overdueMins)
    .sort((a, b) => b.current.overdueMins - a.current.overdueMins)[0];
  if (worst) lines.push(`Longest delay: ${worst.indentNumber}, ${durOf(worst.current.overdueMins)} late at ${worst.current.code}.`);
  return lines;
};
const durOf = (mins) => {
  const m = Math.max(0, Math.round(mins || 0));
  if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
};

export const PURCHASE_STAGE_MODES = [
  { value: 'pending', label: '1. Pending Qty' },
  { value: 'received', label: '2. Received Qty' },
  { value: 'upcoming', label: '3. Upcoming Qty' },
];

/**
 * Quantity by item, biggest first (top 10). Each measure is dated its own way:
 *   pending  — ordered minus received on the PO lines of running indents, by PO date
 *   received — received on GRNs, by GRN date
 *   upcoming — still to come on released POs, by expected delivery date
 */
export const purchaseStageBars = (rows, opts, now = Date.now()) => {
  const [from, to] = stagePeriod(opts, now);
  const inPeriod = (d) => { const t = ms(d); return t != null && t >= from && t < to; };
  const byItem = new Map();
  const add = (key, name, value) => {
    if (!value) return;
    const bar = byItem.get(key) || { key, name, value: 0 };
    bar.value += value;
    byItem.set(key, bar);
  };
  rows.forEach((r) => {
    if (opts.indent && r.id !== opts.indent) return;
    // The vendor applies per PO: one indent can have POs with several vendors.
    const ofVendor = (e) => !opts.vendor || e.vendorKey === opts.vendor;
    if (opts.mode === 'received') {
      r.receipts.forEach((g) => { if (ofVendor(g) && inPeriod(g.date)) add(g.sku, g.name, g.qty); });
      return;
    }
    if (r.group === 'CANCELLED') return;
    if (opts.mode === 'upcoming') {
      r.plan.forEach((p) => { if (ofVendor(p) && inPeriod(p.date)) p.items.forEach((it) => add(it.sku, it.name, it.qty)); });
      return;
    }
    if (r.group === 'COMPLETED') return;
    r.lines.forEach((l) => { if (ofVendor(l) && inPeriod(l.date)) add(l.sku, l.name, l.pending); });
  });
  return [...byItem.values()].sort((a, b) => b.value - a.value).slice(0, 10);
};

export const purchaseStageEmptyText = ({ mode, time }, hasRows) => {
  if (!hasRows) return 'No indents in this view.';
  const all = time === 'all';
  if (mode === 'received') return `Nothing received in this period.${all ? '' : ' Choose "All time" to look further back.'}`;
  if (mode === 'upcoming') return `No deliveries expected in this period.${all ? '' : ' Choose "All time" to see every open PO.'}`;
  return all
    ? 'Nothing pending — every PO line of the running indents is received.'
    : 'Nothing pending on POs dated in this period. Choose "All time" to see every running indent.';
};

/** Vendors on the live POs, for the Stage analysis select. */
export const vendorOptions = (rows) => {
  const seen = new Map();
  rows.forEach((r) => r.vendors.forEach((v) => { if (!seen.has(v.key)) seen.set(v.key, v.name); }));
  return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
};

/** Expected deliveries in one month: day start → [{ row, po }]. */
export const monthDeliveries = (rows, year, month) => {
  const start = new Date(year, month, 1).getTime();
  const end = new Date(year, month + 1, 1).getTime();
  const byDay = new Map();
  rows.forEach((r) => {
    if (r.group === 'CANCELLED') return;
    r.plan.forEach((p) => {
      const at = ms(p.date);
      if (at == null || at < start || at >= end) return;
      const day = startOfDay(at);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push({ row: r, po: p });
    });
  });
  return byDay;
};

export { pctOf };

// ══ My view ═══════════════════════════════════════════════════════════════

/**
 * The person's Purchase doer tasks in the shape the O2D my-view rules read:
 * key · state ('open' | 'done') · plannedAt · doneAt · stepCode · stepName ·
 * soNumber (the record's number) · partyName (the task's note) · stepPath.
 * Tasks where they are only the buddy are left out, as in O2D.
 */
export const myPurchaseTasks = (tasks) => (Array.isArray(tasks) ? tasks : [])
  .filter((t) => t.fmsKey === 'PURCHASE' && !t.asBuddy && (t.status === 'OPEN' || t.status === 'DONE'))
  .map((t) => ({
    key: idOf(t),
    state: t.status === 'DONE' ? 'done' : 'open',
    plannedAt: t.plannedAt || null,
    doneAt: t.completedAt || null,
    stepCode: t.stepCode || '',
    stepName: t.stepLabel || STEP_NAME.get(t.stepCode) || '',
    soNumber: t.entityRef || '',
    partyName: t.summary || '',
    dcNumber: null,
    stepPath: t.link || null,
  }));

// ══ Item Delivery Calendar ════════════════════════════════════════════════

export const DELIVERY_STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'DELIVERED', label: 'Delivered' },
];
const GRN_LIVE = (g) => !['DRAFT', 'CANCELLED'].includes(g.grnStatus);

/**
 * One event per released PO line (every live PO, linked to an indent or not):
 *   SCHEDULED — still to receive (ordered > received) on the PO's expected
 *               delivery date, whether that date is ahead or already past;
 *   DELIVERED — fully received: dated by the latest GRN that received the line
 *               (matched by PO line, else by item), else the PO's last GRN.
 * Lines without a date to place them on are left out.
 */
export const buildDeliveryEvents = (src) => {
  const list = (k) => (Array.isArray(src?.[k]) ? src[k] : []);
  const pos = list('pos').filter((po) => isLivePo(po) && RELEASED.includes(po.poStatus));
  const poByNumber = new Map(pos.filter((p) => p.poNumber).map((p) => [p.poNumber, idOf(p)]));
  const grnsByPo = new Map();
  list('grns').filter(GRN_LIVE).forEach((g) => {
    uniq([idOf(g.poId), ...(g.poIds || []).map(idOf), g.poNumber ? poByNumber.get(g.poNumber) : null]).forEach((id) => {
      if (!grnsByPo.has(id)) grnsByPo.set(id, []);
      grnsByPo.get(id).push(g);
    });
  });
  const events = [];
  pos.forEach((po) => {
    const poId = idOf(po);
    const grns = grnsByPo.get(poId) || [];
    const lastGrn = (pred) => grns.filter(pred).map((g) => g.grnDate || g.createdAt).filter(Boolean)
      .sort((a, b) => ms(b) - ms(a))[0] || null;
    (po.items || []).forEach((it, i) => {
      const qty = num(it.quantity);
      const received = num(it.receivedQty);
      if (!qty) return;
      const sku = it.skuCode || it.itemName || '';
      const base = {
        poId, poNumber: po.poNumber || po.draftNumber || '—', vendor: po.vendorName || '—', vendorKey: vendorKeyOf(po),
        sku, item: it.itemName || it.skuCode || '—', unit: it.unit || '', ordered: qty, received,
        indentIds: uniq([idOf(po.indentId), ...(po.indentIds || []).map(idOf), idOf(it.indentId)]),
      };
      if (received >= qty) {
        const lineId = idOf(it);
        const date = lastGrn((g) => (g.items || []).some((gi) => (lineId && idOf(gi.poItemId) === lineId)
          || (gi.skuCode && gi.skuCode === it.skuCode) || (gi.itemName && gi.itemName === it.itemName)))
          || lastGrn(() => true);
        if (date) events.push({ ...base, key: `${poId}-${i}-D`, status: 'DELIVERED', date, qty: received });
      } else if (po.expectedDeliveryDate && AWAITING_RECEIPT.includes(po.poStatus)) {
        events.push({ ...base, key: `${poId}-${i}-S`, status: 'SCHEDULED', date: po.expectedDeliveryDate, qty: qty - received });
      }
    });
  });
  return events.sort((a, b) => ms(a.date) - ms(b.date) || a.vendor.localeCompare(b.vendor));
};

export const EMPTY_DELIVERY_FILTER = { status: '', item: '', vendor: '' };

export const filterDeliveryEvents = (events, f) => events.filter((e) => (!f.status || e.status === f.status)
  && (!f.item || e.sku === f.item) && (!f.vendor || e.vendorKey === f.vendor));

/** Events in one month: day start → events. */
export const monthEventsByDay = (events, year, month) => {
  const start = new Date(year, month, 1).getTime();
  const end = new Date(year, month + 1, 1).getTime();
  const byDay = new Map();
  events.forEach((e) => {
    const at = ms(e.date);
    if (at == null || at < start || at >= end) return;
    const day = startOfDay(at);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  });
  return byDay;
};

const optionsOf = (events, key, label) => {
  const seen = new Map();
  events.forEach((e) => { if (e[key] && !seen.has(e[key])) seen.set(e[key], e[label]); });
  return [...seen.entries()].map(([value, l]) => ({ value, label: l })).sort((a, b) => a.label.localeCompare(b.label));
};
export const deliveryItemOptions = (events) => optionsOf(events, 'sku', 'item');
export const deliveryVendorOptions = (events) => optionsOf(events, 'vendorKey', 'vendor');
