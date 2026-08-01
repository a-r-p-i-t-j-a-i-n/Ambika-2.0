import dayjs from 'dayjs';
import { groupDayByParty } from './dispatchCalendarGrouping';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const num = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '-');

// Mirrors the on-screen shortener so the PDF reads exactly like the calendar:
// drop legal suffixes and, if still long, keep the first word.
const shortParty = (name) => {
  const raw = String(name || '-').trim();
  const cleaned = raw
    .replace(/(pvt|private|ltd|limited|llp|inc|co|company|technologies|industries|enterprises|works)\.?/gi, '')
    .replace(/[.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean);
  if (!words.length) return raw;
  const two = words.slice(0, 2).join(' ');
  return two.length > 14 ? words[0] : two;
};
const shortSo = (so) => String(so || '').replace(/^AGL\//, '').replace(/\/\d{2}-\d{2}$/, '');

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

  const gridStart = startOfPrintGrid(monthStart);
  const days = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
  const calendarCells = days.map((day) => {
    const key = day.format('YYYY-MM-DD');
    const list = byDate.get(key) || [];
    // Same rule as the screen: one card PER PARTY (orders merged), items merged,
    // and NO sales-order number on the print.
    const groups = groupDayByParty(list);
    const inMonth = day.isSame(monthStart, 'month');
    const chips = groups.slice(0, 2).map((g) => {
      const type = TYPE[g.eventType] || TYPE.scheduled;
      const colour = g.isDelayed ? '#be123c' : type.color;
      const isActual = g.eventType === 'actual';
      const skuLines = (g.skus || [])
        .filter((sku) => Number(isActual ? sku.actualQty : sku.plannedQty) > 0)
        .map((sku) => `
          <div class="skuRow">
            <span class="skuName">${esc(sku.skuName || '-')}</span>
            <span class="skuQty">${num(isActual ? sku.actualQty : sku.plannedQty)}</span>
          </div>`).join('');
      return `
        <div class="chip${g.isDelayed ? ' delayed' : ''}" style="border-left-color:${colour}">
          <div class="chipHead">
            <span class="party">${esc(shortParty(g.partyName))}</span>
            <span class="tag" style="color:${colour}">${esc(type.short)}</span>
            ${g.orderCount > 1 ? `<span class="so">&times;${g.orderCount}</span>` : ''}
          </div>
          ${skuLines}
          <div class="tot" style="border-top-color:${colour}">
            <span>TOTAL</span><span class="totQty" style="color:${colour}">${num(g.totalQty)} pcs</span>
          </div>
        </div>`;
    }).join('');
    const more = groups.length > 2 ? `<div class="more">+${groups.length - 2} more</div>` : '';
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


  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Dispatch Calendar - ${esc(monthLabel)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e9e7e1; color: #1c1e21; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { padding-top: 48px; }
  .print-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 10; background: #fff; border-bottom: 1px solid #e4e1d9; padding: 9px 16px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
  .print-bar button { border: 0; border-radius: 4px; background: #0b2545; color: #fff; padding: 7px 14px; font-weight: 800; cursor: pointer; }
  .print-bar button + button { margin-left: 8px; background: #fff; color: #0f172a; border: 1px solid #94a3b8; }
  .sheet { width: 297mm; max-width: 100%; min-height: 210mm; margin: 12px auto; background: #fff; padding: 11mm; }
  .lh { border-bottom: 2.5px solid #0b2545; padding-bottom: 8px; margin-bottom: 2px; }
  .company { color: #0b2545; font-size: 30px; font-weight: 900; letter-spacing: 0.05em; line-height: 1.05; text-align: center; }
  .title { text-align: center; color: #16305a; font-size: 13px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; margin-top: 5px; }
  .month { text-align: center; color: #1c1e21; font-size: 15px; font-weight: 800; letter-spacing: 0.04em; margin-top: 6px; }
  .calendar { margin-top: 12px; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; padding-top: 7px; }
  h1 { margin: 0; color: #16305a; font-size: 14px; font-weight: 800; line-height: 1.2; }
  .filters { margin-top: 4px; color: #6b7280; font-size: 10.5px; }
  .meta { text-align: right; color: #6b7280; font-size: 10px; white-space: nowrap; }
  .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; margin: 10px 0; }
  .stat { border: 1px solid #e4e1d9; padding: 7px 9px; background: #f7f6f2; }
  .stat b { display: block; font-size: 15px; color: #1c1e21; }
  .stat span { display: block; margin-top: 1px; font-size: 8.5px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 800; }
  table { border-collapse: collapse; width: 100%; }
  .calendar th { background: #16305a; color: #fff; border: 1px solid #16305a; font-size: 9px; padding: 5px; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 800; }
  .calendar td { width: 14.28%; height: 30mm; vertical-align: top; border: 1px solid #e4e1d9; padding: 3px; }
  .calendar td.muted { background: #f7f6f2; color: #9ca3af; }
  .date { font-size: 10px; font-weight: 800; color: #1c1e21; margin-bottom: 2px; }
  .chip { border-left: 3px solid #1d4ed8; background: #f7f6f2; margin-bottom: 2px; padding: 2px 4px; overflow: hidden; }
  .chip.delayed { background: #fff1f2; }
  .chipHead { display: flex; align-items: center; gap: 3px; }
  .tag { font-size: 6.5px; font-weight: 900; flex: 0 0 auto; }
  .so { font-size: 6.5px; font-weight: 700; color: #9ca3af; flex: 0 0 auto; }
  .party { font-size: 8px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; color: #1c1e21; }
  .skuRow { display: flex; align-items: center; gap: 4px; }
  .skuName { font-size: 7px; color: #3f4650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
  .skuQty { font-size: 7px; font-weight: 800; color: #1c1e21; flex: 0 0 auto; font-variant-numeric: tabular-nums; }
  .tot { display: flex; align-items: center; justify-content: space-between; margin-top: 1px; padding-top: 1px; border-top: 1px solid #cbd5e1; font-size: 6.5px; font-weight: 800; color: #9ca3af; letter-spacing: 0.05em; }
  .totQty { font-size: 7.5px; font-weight: 900; font-variant-numeric: tabular-nums; }
  .empty { color: #cbd5e1; font-size: 7.5px; margin-top: 8px; text-align: center; }
  .more { color: #0b2545; font-size: 8px; font-weight: 800; margin-top: 2px; }
  .ft { margin-top: 10px; color: #9ca3af; text-align: center; font-size: 8px; border-top: 1px solid #e4e1d9; padding-top: 6px; }
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
    <div class="lh">
      <div class="company">${esc(companyName)}</div>
      <div class="title">Dispatch Planning Calendar</div>
      <div class="month">${esc(monthLabel)}</div>
    </div>
    <table class="calendar">
      <thead><tr>${WEEKDAYS.map((day) => `<th>${day}</th>`).join('')}</tr></thead>
      <tbody>${gridRows}</tbody>
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
