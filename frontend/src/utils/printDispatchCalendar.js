import dayjs from 'dayjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const num = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '-');

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TYPE = {
  scheduled: { label: 'Scheduled', short: 'SCH', color: '#1d4ed8' },
  actual: { label: 'Actual', short: 'ACT', color: '#0f766e' },
};

const startOfPrintGrid = (month) => dayjs(month).startOf('month').day(0);

const eventQty = (event) => (
  event.eventType === 'actual'
    ? Number(event.actualQty || 0)
    : Number(event.plannedQty || 0)
);

const eventStatus = (event) => {
  if (event.isDelayed) return 'Delayed';
  if (event.eventType === 'actual') return 'Actual';
  return String(event.status || 'PLANNED').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
};

export function printDispatchCalendar({
  month,
  events = [],
  filters = {},
  companyName = 'M/s AMBIKA GLOBAL',
} = {}) {
  const monthStart = dayjs(month).startOf('month');
  const monthLabel = monthStart.format('MMMM YYYY');
  const generated = dayjs().format('DD MMM YYYY, hh:mm A');
  const visibleEvents = events
    .filter((event) => event?.dateKey && dayjs(event.dateKey).isSame(monthStart, 'month'))
    .sort((a, b) => (
      String(a.dateKey).localeCompare(String(b.dateKey))
      || String(a.partyName || '').localeCompare(String(b.partyName || ''))
      || String(a.phaseNo || '').localeCompare(String(b.phaseNo || ''))
    ));

  const byDate = new Map();
  visibleEvents.forEach((event) => {
    const list = byDate.get(event.dateKey) || [];
    list.push(event);
    byDate.set(event.dateKey, list);
  });

  const scheduledEvents = visibleEvents.filter((event) => event.eventType !== 'actual');
  const actualEvents = visibleEvents.filter((event) => event.eventType === 'actual');
  const delayedEvents = visibleEvents.filter((event) => event.isDelayed);
  const totals = {
    entries: visibleEvents.length,
    planned: scheduledEvents.reduce((sum, event) => sum + Number(event.plannedQty || 0), 0),
    actual: actualEvents.length
      ? actualEvents.reduce((sum, event) => sum + Number(event.actualQty || 0), 0)
      : scheduledEvents.reduce((sum, event) => sum + Number(event.actualQty || 0), 0),
    pending: scheduledEvents.reduce((sum, event) => sum + Number(event.pendingQty || 0), 0),
    delayed: delayedEvents.length,
  };

  const filterText = [
    `Content: ${filters.contentLabel || 'All dispatches'}`,
    `Parties: ${filters.partyLabel || 'All parties'}`,
    `Status: ${filters.statusLabel || 'All statuses'}`,
    filters.search ? `Search: ${filters.search}` : null,
  ].filter(Boolean).join(' | ');

  const gridStart = startOfPrintGrid(monthStart);
  const days = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
  const calendarCells = days.map((day) => {
    const key = day.format('YYYY-MM-DD');
    const list = byDate.get(key) || [];
    const inMonth = day.isSame(monthStart, 'month');
    const chips = list.slice(0, 5).map((event) => {
      const type = TYPE[event.eventType] || TYPE.scheduled;
      const qty = eventQty(event);
      const delayedClass = event.isDelayed ? ' delayed' : '';
      return `
        <div class="chip${delayedClass}" style="border-left-color:${type.color}">
          <span class="tag" style="color:${type.color}">${esc(type.short)}</span>
          <span class="party">${esc(event.partyName || '-')}</span>
          <span class="qty">${num(qty)}</span>
        </div>`;
    }).join('');
    const more = list.length > 5 ? `<div class="more">+${list.length - 5} more</div>` : '';
    return `
      <td class="${inMonth ? '' : 'muted'}">
        <div class="date">${day.date()}</div>
        ${chips || '<div class="empty">No dispatch</div>'}
        ${more}
      </td>`;
  });

  const gridRows = Array.from({ length: 6 }, (_, row) => (
    `<tr>${calendarCells.slice(row * 7, (row + 1) * 7).join('')}</tr>`
  )).join('');

  const detailRows = visibleEvents.length
    ? visibleEvents.map((event, index) => {
      const type = TYPE[event.eventType] || TYPE.scheduled;
      const skuText = (event.skus || [])
        .map((sku) => `${sku.skuCode || ''} ${sku.skuName || ''}`.trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(', ');
      const moreSkus = (event.skus || []).length > 4 ? ` +${event.skus.length - 4} more` : '';
      return `
        <tr>
          <td class="n">${index + 1}</td>
          <td>${fmtDate(event.date)}</td>
          <td><span class="type" style="color:${type.color};border-color:${type.color}">${esc(type.label)}</span></td>
          <td>${esc(event.partyName || '-')}</td>
          <td>${esc(event.soNumber || '-')}${event.poNumber ? `<br><span class="sub">PO ${esc(event.poNumber)}</span>` : ''}</td>
          <td>${esc(event.phaseNo || '-')}</td>
          <td>${esc(skuText || '-')}${moreSkus ? `<span class="sub">${esc(moreSkus)}</span>` : ''}</td>
          <td class="num">${num(event.plannedQty)}</td>
          <td class="num">${num(event.actualQty)}</td>
          <td class="num">${num(event.pendingQty)}</td>
          <td>${esc(eventStatus(event))}${event.delayDays > 0 ? `<br><span class="late">${event.delayDays}d late</span>` : ''}</td>
        </tr>`;
    }).join('')
    : '<tr><td colspan="11" class="none">No dispatch entries match the current filters.</td></tr>';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Dispatch Calendar - ${esc(monthLabel)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e5e7eb; color: #0f172a; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { padding-top: 48px; }
  .print-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 10; background: #fff; border-bottom: 2px solid #0b2545; padding: 9px 16px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
  .print-bar button { border: 0; border-radius: 4px; background: #1d4ed8; color: #fff; padding: 7px 14px; font-weight: 800; cursor: pointer; }
  .print-bar button + button { margin-left: 8px; background: #fff; color: #0f172a; border: 1px solid #94a3b8; }
  .sheet { width: 297mm; max-width: 100%; min-height: 210mm; margin: 12px auto; background: #fff; padding: 11mm; }
  .head { display: flex; justify-content: space-between; gap: 20px; border-bottom: 2px solid #1d4ed8; padding-bottom: 9px; }
  h1 { margin: 0; color: #1e3a8a; font-size: 22px; line-height: 1.1; }
  .company { color: #0b2545; font-size: 11px; font-weight: 800; letter-spacing: 0.04em; margin-bottom: 3px; }
  .filters { margin-top: 4px; color: #475569; font-size: 10.5px; }
  .meta { text-align: right; color: #475569; font-size: 10px; white-space: nowrap; }
  .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; margin: 10px 0; }
  .stat { border: 1px solid #cbd5e1; padding: 7px 9px; background: #f8fafc; }
  .stat b { display: block; font-size: 15px; color: #0b2545; }
  .stat span { display: block; margin-top: 1px; font-size: 8.5px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 800; }
  table { border-collapse: collapse; width: 100%; }
  .calendar th { background: #eef2ff; color: #1e3a8a; border: 1px solid #aab8d4; font-size: 9px; padding: 5px; text-transform: uppercase; letter-spacing: 0.07em; }
  .calendar td { width: 14.28%; height: 25mm; vertical-align: top; border: 1px solid #aab8d4; padding: 4px; }
  .calendar td.muted { background: #f8fafc; color: #94a3b8; }
  .date { font-size: 10px; font-weight: 800; color: #0f172a; margin-bottom: 3px; }
  .chip { display: flex; align-items: center; gap: 3px; border-left: 3px solid #1d4ed8; background: #f8fafc; margin-bottom: 2px; padding: 2px 4px; min-height: 14px; overflow: hidden; }
  .chip.delayed { background: #fff1f2; }
  .tag { font-size: 7px; font-weight: 900; flex: 0 0 auto; }
  .party { font-size: 8.2px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; color: #334155; }
  .qty { font-size: 8px; font-weight: 900; color: #0f172a; flex: 0 0 auto; font-variant-numeric: tabular-nums; }
  .empty { color: #cbd5e1; font-size: 8px; margin-top: 8px; text-align: center; }
  .more { color: #1d4ed8; font-size: 8px; font-weight: 800; margin-top: 2px; }
  .section { margin: 12px 0 6px; font-size: 10px; color: #0b2545; font-weight: 900; letter-spacing: 0.09em; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
  .details th { background: #eef2ff; color: #1e3a8a; border: 1px solid #cbd5e1; text-align: left; font-size: 8.5px; padding: 5px 6px; text-transform: uppercase; letter-spacing: 0.05em; }
  .details td { border: 1px solid #e2e8f0; padding: 5px 6px; vertical-align: top; font-size: 9px; }
  .details tr:nth-child(even) td { background: #f8fafc; }
  .n { color: #94a3b8; width: 24px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .type { border: 1px solid; border-radius: 999px; padding: 1px 5px; font-size: 8px; font-weight: 900; white-space: nowrap; }
  .sub { color: #64748b; font-size: 8px; }
  .late { color: #be123c; font-weight: 900; font-size: 8px; }
  .none { text-align: center; color: #94a3b8; padding: 18px !important; }
  .ft { margin-top: 10px; color: #94a3b8; text-align: center; font-size: 8px; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  @media print {
    body { padding-top: 0; background: #fff; }
    .print-bar { display: none !important; }
    .sheet { margin: 0; width: auto; min-height: 0; padding: 0; }
  }
</style></head>
<body>
  <div class="print-bar">
    <div><strong>Dispatch Calendar Preview</strong> - choose Save as PDF in the print dialog.</div>
    <div><button onclick="window.print()">Print / Save PDF</button><button onclick="window.close()">Close</button></div>
  </div>
  <div class="sheet">
    <div class="head">
      <div>
        <div class="company">${esc(companyName)}</div>
        <h1>Dispatch Calendar - ${esc(monthLabel)}</h1>
        <div class="filters">${esc(filterText)}</div>
      </div>
      <div class="meta"><strong>Generated</strong><br>${esc(generated)}<br>${visibleEvents.length} visible entry(s)</div>
    </div>
    <div class="stats">
      <div class="stat"><b>${num(totals.entries)}</b><span>Entries</span></div>
      <div class="stat"><b>${num(totals.planned)}</b><span>Scheduled Qty</span></div>
      <div class="stat"><b>${num(totals.actual)}</b><span>Actual Qty</span></div>
      <div class="stat"><b>${num(totals.pending)}</b><span>Pending Qty</span></div>
      <div class="stat"><b>${num(totals.delayed)}</b><span>Delayed</span></div>
    </div>
    <table class="calendar">
      <thead><tr>${WEEKDAYS.map((day) => `<th>${day}</th>`).join('')}</tr></thead>
      <tbody>${gridRows}</tbody>
    </table>
    <div class="section">Date-wise Dispatch Details</div>
    <table class="details">
      <thead>
        <tr>
          <th>#</th><th>Date</th><th>Type</th><th>Party</th><th>SO / PO</th><th>Phase</th>
          <th>SKU</th><th class="num">Scheduled</th><th class="num">Actual</th><th class="num">Pending</th><th>Status</th>
        </tr>
      </thead>
      <tbody>${detailRows}</tbody>
    </table>
    <div class="ft">Generated from Dispatch Planning Execution System</div>
  </div>
  <script>setTimeout(function(){ try { window.focus(); } catch (e) {} }, 100);</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) {
    alert('Pop-up blocked. Please allow pop-ups so the dispatch calendar PDF preview can open.');
    return false;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
