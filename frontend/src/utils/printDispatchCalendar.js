import dayjs from 'dayjs';
import { groupDayByParty } from './dispatchCalendarGrouping';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const num = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '-');

// Alpha tints are written as rgba(), not 8-digit hex: html2canvas (used by the
// download path) does not parse #RRGGBBAA reliably across browsers.
const rgba = (hex, a) => {
  const h = String(hex).replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

// Mirrors the on-screen shortener so the PDF reads exactly like the calendar:
// drop legal suffixes and, if still long, keep the first word.
const shortParty = (name) => {
  const raw = String(name || '-').trim();
  const cleaned = raw
    .replace(/(pvt|private|ltd|limited|llp|inc|co|company|technologies|industries|enterprises|works)\.?/gi, '')
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

// Mirrors STATUS in DispatchCalendar.jsx so the print matches the screen legend.
const STATUS_COLOR = {
  PLANNED: '#1d4ed8',
  IN_PROGRESS: '#b45309',
  DISPATCHED: '#0f766e',
  DELAYED: '#be123c',
  CANCELLED: '#64748b',
};

// The active on-screen filters, printed under the month so an exported sheet
// always says what slice of the data it represents.
const filterLine = (filters = {}) => [
  filters.contentLabel,
  filters.partyLabel,
  filters.statusLabel,
  filters.search ? `Search: "${filters.search}"` : '',
].filter(Boolean).map(esc).join(' &middot; ');

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

// ─────────────────────────────────────────────────────────────────────────────
// Output plumbing. Each sheet is built once as { css, inner } and can then be
// PRINTED (new tab + browser print dialog) or DOWNLOADED (rasterised straight
// to a .pdf file). Both consume the identical markup, so what the client sees
// in the preview is byte-for-byte what lands in their Downloads folder.
// ─────────────────────────────────────────────────────────────────────────────

// Chrome that belongs to the preview tab only — never part of the download.
const CHROME_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e9e7e1; color: #0b2545; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { padding-top: 48px; }
  .print-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 10; background: #fff; border-bottom: 1px solid #e4e1d9; padding: 9px 16px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
  .print-bar button { border: 0; border-radius: 4px; background: #0b2545; color: #fff; padding: 7px 14px; font-weight: 800; cursor: pointer; }
  .print-bar button + button { margin-left: 8px; background: #fff; color: #0f172a; border: 1px solid #94a3b8; }
  @media print {
    body { padding-top: 0; background: #fff; }
    .print-bar { display: none !important; }
    .sheet { margin: 0; width: auto; min-height: 0; padding: 0; }
  }
`;

const openPrintWindow = (html) => {
  const w = window.open('', '_blank');
  if (!w) {
    alert('Pop-up blocked. Please allow pop-ups so the dispatch PDF preview can open.');
    return false;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
};

const printSheet = (sheet, docTitle) => openPrintWindow(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>${esc(docTitle)} - ${esc(sheet.monthLabel)}</title>
<style>${CHROME_CSS}${sheet.css}</style></head>
<body>
  <div class="print-bar">
    <div><strong>${esc(docTitle)} Preview</strong> - choose Save as PDF in the print dialog.</div>
    <div><button onclick="window.print()">Print / Save PDF</button><button onclick="window.close()">Close</button></div>
  </div>
  <div class="sheet">${sheet.inner}</div>
  <script>setTimeout(function(){ try { window.focus(); } catch (e) {} }, 100);</script>
</body></html>`);

// Renders the sheet off-screen, rasterises it and saves a real .pdf — no print
// dialog. jspdf/html2canvas are imported lazily so they stay out of the main
// bundle and only load when someone actually clicks Download.
const downloadSheet = async (sheet, fileName) => {
  const host = document.createElement('div');
  // Off-screen but still laid out: html2canvas needs real geometry, so
  // display:none / visibility:hidden are not options here.
  host.setAttribute('style', `position:fixed; top:0; left:-20000px; width:${sheet.widthMm}mm; background:#ffffff;`);
  host.innerHTML = `<style>${sheet.css}</style><div class="sheet dl">${sheet.inner}</div>`;
  document.body.appendChild(host);

  try {
    const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas'),
    ]);
    const canvas = await html2canvas(host.querySelector('.sheet'), {
      scale: 2,                    // 2x so small print stays crisp
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
    });

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: sheet.orientation });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgH = (canvas.height * pageW) / canvas.width;
    const img = canvas.toDataURL('image/jpeg', 0.92);

    if (sheet.fitToPage && imgH > pageH) {
      // Scale down to a single page, centred, aspect preserved.
      const h = pageH;
      const w = (canvas.width * h) / canvas.height;
      pdf.addImage(img, 'JPEG', (pageW - w) / 2, 0, w, h);
    } else {
      // Long sheets are paged by re-placing the same image at a negative offset.
      pdf.addImage(img, 'JPEG', 0, 0, pageW, imgH);
      let remaining = imgH - pageH;
      let offset = 0;
      while (remaining > 0) {
        offset -= pageH;
        pdf.addPage();
        pdf.addImage(img, 'JPEG', 0, offset, pageW, imgH);
        remaining -= pageH;
      }
    }

    pdf.save(fileName);
    return true;
  } catch (err) {
    console.error('Dispatch PDF download failed', err);
    alert('Could not build the PDF file. Please use Export PDF and choose Save as PDF instead.');
    return false;
  } finally {
    host.remove();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Calendar sheet — the month grid, A4 landscape.
// ─────────────────────────────────────────────────────────────────────────────
function buildCalendarSheet({
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

  const css = `
  @page { size: A4 landscape; margin: 8mm; }
  /* Sized so all six week-rows + header + footer clear one A4 landscape page. */
  .sheet { width: 297mm; max-width: 100%; min-height: 210mm; margin: 12px auto; background: #fff; padding: 9mm; }
  .sheet.dl { margin: 0; min-height: 0; }
  .lh { border-bottom: 2.5px solid #0b2545; padding-bottom: 6px; margin-bottom: 2px; }
  .company { color: #0b2545; font-size: 25px; font-weight: 900; letter-spacing: 0.05em; line-height: 1.05; text-align: center; }
  .title { text-align: center; color: #16305a; font-size: 11px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; margin-top: 4px; }
  .month { text-align: center; color: #0b2545; font-size: 13px; font-weight: 800; letter-spacing: 0.04em; margin-top: 4px; }
  .filters { text-align: center; color: #6b7280; font-size: 9px; margin-top: 3px; }
  .calendar { margin-top: 8px; border: 1.5px solid #16305a; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  .calendar th { background: #16305a; color: #fff; border: 1px solid #16305a; font-size: 9px; padding: 4px; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 800; }
  .calendar td { width: 14.28%; height: 24mm; vertical-align: top; border: 1px solid #8ea0c2; padding: 3px; overflow: hidden; }
  .calendar td.muted { background: #f2f4f8; color: #9ca3af; }
  .date { font-size: 10px; font-weight: 800; color: #0b2545; margin-bottom: 2px; }
  .chip { border: 1px solid #c3cddf; border-left: 3px solid #1d4ed8; background: #f4f7fc; margin-bottom: 2px; padding: 2px 4px; overflow: hidden; }
  .chip.delayed { background: #fff1f2; }
  .chipHead { display: flex; align-items: center; gap: 3px; }
  .tag { font-size: 6.5px; font-weight: 900; flex: 0 0 auto; }
  .so { font-size: 6.5px; font-weight: 700; color: #9ca3af; flex: 0 0 auto; }
  .party { font-size: 8px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; color: #0b2545; }
  .skuRow { display: flex; align-items: center; gap: 4px; }
  .skuName { font-size: 7px; color: #3f4650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
  .skuQty { font-size: 7px; font-weight: 800; color: #0b2545; flex: 0 0 auto; font-variant-numeric: tabular-nums; }
  .tot { display: flex; align-items: center; justify-content: space-between; margin-top: 1px; padding-top: 1px; border-top: 1px solid #cbd5e1; font-size: 6.5px; font-weight: 800; color: #9ca3af; letter-spacing: 0.05em; }
  .totQty { font-size: 7.5px; font-weight: 900; font-variant-numeric: tabular-nums; }
  .empty { color: #cbd5e1; font-size: 7.5px; margin-top: 8px; text-align: center; }
  .more { color: #0b2545; font-size: 8px; font-weight: 800; margin-top: 2px; }
  .ft { margin-top: 7px; color: #9ca3af; text-align: center; font-size: 8px; border-top: 1px solid #c3cddf; padding-top: 5px; }
`;

  const inner = `
    <div class="lh">
      <div class="company">${esc(companyName)}</div>
      <div class="title">Dispatch Planning Calendar</div>
      <div class="month">${esc(monthLabel)}</div>
      ${filterLine(filters) ? `<div class="filters">${filterLine(filters)}</div>` : ''}
    </div>
    <table class="calendar">
      <thead><tr>${WEEKDAYS.map((day) => `<th>${day}</th>`).join('')}</tr></thead>
      <tbody>${gridRows}</tbody>
    </table>
    <div class="ft">Generated from Dispatch Planning Execution System</div>`;

  // fitToPage: a month grid is a single-page document by definition — if a busy
  // month pushes it a few mm over, shrink to fit rather than spill onto page 2.
  return { monthLabel, css, inner, orientation: 'landscape', widthMm: 297, fitToPage: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// List sheet — the same month + same filters as the grid, but laid out
// top-to-bottom by date the way the List tab reads on screen. A4 portrait,
// since the list is vertical and every day gets a full-width card.
// ─────────────────────────────────────────────────────────────────────────────
function buildListSheet({
  month,
  events = [],
  filters = {},
  companyName = 'M/s AMBIKA GLOBAL',
} = {}) {
  const monthStart = dayjs(month).startOf('month');
  const monthLabel = monthStart.format('MMMM YYYY');

  const inMonth = events.filter((e) => e?.dateKey && dayjs(e.dateKey).isSame(monthStart, 'month'));

  // Header roll-up — mirrors the on-screen stat strip.
  const scheduled = inMonth.filter((e) => e.eventType !== 'actual');
  const actualRows = inMonth.filter((e) => e.eventType === 'actual');
  const stats = {
    entries: inMonth.length,
    planned: scheduled.reduce((s, e) => s + Number(e.plannedQty || 0), 0),
    dispatched: actualRows.length
      ? actualRows.reduce((s, e) => s + Number(e.actualQty || 0), 0)
      : scheduled.reduce((s, e) => s + Number(e.actualQty || 0), 0),
    delayed: inMonth.filter((e) => e.isDelayed).length,
  };

  const byDate = new Map();
  inMonth.forEach((event) => {
    const list = byDate.get(event.dateKey) || [];
    list.push(event);
    byDate.set(event.dateKey, list);
  });

  // Same party-merge rule as the screen: one row per party per day.
  const dayBlocks = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, list]) => ({ dateKey, groups: groupDayByParty(list) }));

  const groupColour = (g) => {
    if (g.isDelayed) return '#be123c';
    if (g.eventType === 'actual') return '#0f766e';
    return STATUS_COLOR[g.status] || STATUS_COLOR.PLANNED;
  };
  const groupLabel = (g) => {
    if (g.isDelayed) return 'Delayed';
    if (g.eventType === 'actual') return 'Dispatched';
    return String(g.status || 'PLANNED').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const body = dayBlocks.map(({ dateKey, groups }) => {
    const d = dayjs(dateKey);
    const dayTotal = groups.reduce((s, g) => s + Number(g.totalQty || 0), 0);

    // Status ribbon across the card top — one segment per party.
    const ribbon = groups
      .map((g) => `<span style="flex:1;background:${groupColour(g)}"></span>`)
      .join('');

    const rows = groups.map((g) => {
      const colour = groupColour(g);
      const tint = rgba(colour, 0.07);   // same wash as the screen
      const edge = rgba(colour, 0.22);
      const isActual = g.eventType === 'actual';
      const tiles = (g.skus || [])
        .filter((sku) => Number(isActual ? sku.actualQty : sku.plannedQty) > 0)
        .map((sku) => `
          <div class="tile" style="background:${tint};border-color:${edge}">
            <div class="tName">${esc(sku.skuName || '-')}</div>
            <div class="tQty" style="color:${colour}">${num(isActual ? sku.actualQty : sku.plannedQty)}</div>
            <div class="tUnit">pcs</div>
          </div>`).join('');
      return `
        <div class="pRow" style="border-color:${edge}">
          <div class="pParty" style="background:${tint};border-left-color:${colour}">
            <div class="pName">${esc(g.partyName || '-')}</div>
            <div class="pSub">${g.orderCount} order${g.orderCount > 1 ? 's' : ''} &middot; ${isActual ? 'Actual' : 'Scheduled'}</div>
            <div class="pTag" style="background:${colour}">${isActual ? '&#10003;' : '&#9679;'} ${esc(groupLabel(g))}</div>
          </div>
          <div class="pSkus">${tiles || '<span class="pNone">No items</span>'}</div>
          <div class="pTot" style="background:${tint}">
            <b style="color:${colour}">${num(g.totalQty)}</b>
            <span>TOTAL PCS</span>
            ${g.delayDays > 0 ? `<em class="pLate">${g.delayDays}d late</em>` : ''}
          </div>
        </div>`;
    }).join('');

    return `
      <div class="dayBlock">
        <div class="dayNum">
          <div class="dnDay">${d.format('DD')}</div>
          <div class="dnMon">${esc(d.format('MMM').toUpperCase())}</div>
        </div>
        <div class="dayCard">
          <div class="ribbon">${ribbon}</div>
          <div class="dayHead">
            <div>
              <div class="dayName">${esc(d.format('dddd'))}</div>
              <div class="dayDate">${esc(d.format('DD MMM YYYY').toUpperCase())}</div>
            </div>
            <div class="daySpacer"></div>
            <div class="dayTotPill">
              <div class="dtBox">
                <div class="dtCap">DAY TOTAL</div>
                <div class="dtVal">${num(dayTotal)} pcs</div>
              </div>
              <div class="dtSep"></div>
              <div class="dtParties">${groups.length} part${groups.length === 1 ? 'y' : 'ies'}</div>
            </div>
          </div>
          <div class="dayBody">${rows}</div>
        </div>
      </div>`;
  }).join('');

  const css = `
  @page { size: A4 portrait; margin: 10mm; }
  .sheet { width: 210mm; max-width: 100%; min-height: 297mm; margin: 12px auto; background: #fff; padding: 11mm; }
  .sheet.dl { margin: 0; min-height: 0; }
  .lh { border-bottom: 2.5px solid #0b2545; padding-bottom: 8px; }
  .company { color: #0b2545; font-size: 26px; font-weight: 900; letter-spacing: 0.05em; line-height: 1.05; text-align: center; }
  .title { text-align: center; color: #16305a; font-size: 12px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; margin-top: 5px; }
  .month { text-align: center; color: #0b2545; font-size: 14px; font-weight: 800; letter-spacing: 0.04em; margin-top: 5px; }
  .filters { text-align: center; color: #6b7280; font-size: 9.5px; margin-top: 4px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 9px 0 11px; }
  .stat { border: 1px solid #c3cddf; padding: 6px 8px; background: #f7f6f2; }
  .stat b { display: block; font-size: 14px; color: #0b2545; font-variant-numeric: tabular-nums; }
  .stat span { display: block; margin-top: 1px; font-size: 8px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 800; }

  /* Day row = day + short month on a left rail, then the card. */
  .dayBlock { display: flex; gap: 6px; margin-bottom: 8px; page-break-inside: avoid; break-inside: avoid; }
  .dayNum { flex: 0 0 14mm; text-align: right; padding-top: 5px; }
  .dnDay { font-size: 13.5px; font-weight: 900; color: #0b2545; line-height: 1.05; font-variant-numeric: tabular-nums; }
  .dnMon { font-size: 13.5px; font-weight: 900; color: #1e3a8a; letter-spacing: 0.01em; line-height: 1.15; }
  .dayCard { flex: 1 1 auto; min-width: 0; border: 1px solid #c3cddf; border-radius: 6px; overflow: hidden; background: #fff; }
  .ribbon { display: flex; height: 3px; }
  .dayHead { display: flex; align-items: center; gap: 7px; padding: 5px 7px 4px; }
  .dayName { font-size: 8.5px; font-weight: 800; color: #0b2545; line-height: 1.15; }
  .dayDate { font-size: 8px; font-weight: 900; color: #1e3a8a; letter-spacing: 0.04em; line-height: 1.3; }
  .daySpacer { flex: 1; }
  .dayTotPill { display: flex; align-items: stretch; gap: 6px; border: 1px solid #c3cddf; border-radius: 999px; padding: 3px 9px; }
  .dtBox { text-align: right; }
  .dtCap { font-size: 5.5px; font-weight: 800; color: #9ca3af; letter-spacing: 0.09em; line-height: 1.2; }
  .dtVal { font-size: 10px; font-weight: 900; color: #0b2545; line-height: 1.15; font-variant-numeric: tabular-nums; }
  .dtSep { width: 1px; background: #c3cddf; }
  .dtParties { font-size: 7px; font-weight: 700; color: #6b7280; align-self: center; white-space: nowrap; }
  .dayBody { padding: 0 7px 7px; }

  /* Party band = party block | SKU tiles | total panel. */
  .pRow { display: flex; align-items: stretch; border: 1px solid #c3cddf; border-radius: 5px; overflow: hidden; background: #fff; margin-top: 5px; page-break-inside: avoid; break-inside: avoid; }
  .pParty { flex: 0 0 32mm; min-width: 0; padding: 5px 6px; border-left: 3px solid #1d4ed8; }
  .pName { font-size: 8.5px; font-weight: 800; color: #0b2545; line-height: 1.2; }
  .pSub { font-size: 6.5px; color: #6b7280; margin-top: 1px; margin-bottom: 4px; }
  .pTag { display: block; text-align: center; font-size: 6.5px; font-weight: 800; color: #fff; padding: 2px 3px; border-radius: 3px; }
  .pSkus { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px; padding: 5px 6px; }
  .tile { border: 1px solid #c3cddf; border-radius: 5px; padding: 3px 6px; min-width: 17mm; }
  .tName { font-size: 6.5px; font-weight: 700; color: #3f4650; margin-bottom: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 26mm; }
  .tQty { font-size: 13px; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
  .tUnit { font-size: 5.5px; font-weight: 700; color: #9ca3af; margin-top: 1px; }
  .pNone { font-size: 7.5px; color: #cbd5e1; align-self: center; }
  .pTot { flex: 0 0 20mm; padding: 5px 6px; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; }
  .pTot b { font-size: 14px; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
  .pTot span { display: block; font-size: 5.5px; font-weight: 800; color: #9ca3af; letter-spacing: 0.09em; margin-top: 2px; }
  .pLate { display: block; font-style: normal; margin-top: 3px; font-size: 6px; font-weight: 800; padding: 1px 4px; border-radius: 3px; color: #be123c; background: #fff1f2; }

  .empty { text-align: center; color: #9ca3af; font-size: 11px; padding: 26px 0; }
  .ft { margin-top: 10px; color: #9ca3af; text-align: center; font-size: 8px; border-top: 1px solid #c3cddf; padding-top: 6px; }
`;

  const inner = `
    <div class="lh">
      <div class="company">${esc(companyName)}</div>
      <div class="title">Dispatch Planning List</div>
      <div class="month">${esc(monthLabel)}</div>
      ${filterLine(filters) ? `<div class="filters">${filterLine(filters)}</div>` : ''}
    </div>
    <div class="stats">
      <div class="stat"><b>${num(stats.entries)}</b><span>Events</span></div>
      <div class="stat"><b>${num(stats.planned)}</b><span>Planned pcs</span></div>
      <div class="stat"><b>${num(stats.dispatched)}</b><span>Actual pcs</span></div>
      <div class="stat"><b>${num(stats.delayed)}</b><span>Delayed</span></div>
    </div>
    ${body || '<div class="empty">No dispatches match the current filters this month.</div>'}
    <div class="ft">Generated from Dispatch Planning Execution System &middot; ${esc(fmtDate(dayjs()))}</div>`;

  return { monthLabel, css, inner, orientation: 'portrait', widthMm: 210 };
}

const fileNameFor = (kind, month) => `Dispatch-${kind}-${dayjs(month).format('MMM-YYYY')}.pdf`;

// ── Public API ───────────────────────────────────────────────────────────────
export function printDispatchCalendar(opts = {}) {
  return printSheet(buildCalendarSheet(opts), 'Dispatch Calendar');
}

export function printDispatchList(opts = {}) {
  return printSheet(buildListSheet(opts), 'Dispatch List');
}

export function downloadDispatchCalendarPdf(opts = {}) {
  return downloadSheet(buildCalendarSheet(opts), fileNameFor('Calendar', opts.month));
}

export function downloadDispatchListPdf(opts = {}) {
  return downloadSheet(buildListSheet(opts), fileNameFor('List', opts.month));
}
