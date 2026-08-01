/**
 * Dispatch Plan PDF (client-ready, print-to-tab → Save as PDF).
 * ------------------------------------------------------------------
 * ONE "By Date" template — a TRANSPOSED grid: dispatch dates run down the rows
 * and every SKU is a column across the top, so a SKU that ships across several
 * dispatches is never repeated and long 4–5 week plans grow down the page.
 *
 * Two variants of the SAME template:
 *   • variant 'client'   — shows the item NAME only (what the customer receives).
 *   • variant 'internal' — shows the item name AND the SKU code (internal copy).
 *
 * Input is a DispatchSchedule document (see schedule.model.js):
 *   { companyHeader, soNumber, poNumber, partyName, poDate,
 *     items: [{ skuCode, skuName, poQty, phases: [{ phaseNo, plannedDate, plannedQty }] }] }
 */

import dayjs from 'dayjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const num = (n) => (Number(n || 0)).toLocaleString('en-IN');
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
const dateKey = (d) => (d ? dayjs(d).format('YYYY-MM-DD') : 'UNSCHEDULED');

/** Compute the shared plan model (columns = dispatch dates, rows = SKUs). */
function buildPlanModel(schedule = {}) {
  const company = schedule.companyHeader || {};
  const rawName = company.name || 'Ambika Global';
  const brandName = /^m\/s/i.test(rawName) ? rawName : `M/s ${rawName}`;
  const today = dayjs().format('DD MMM YYYY');
  const items = schedule.items || [];

  const colMap = new Map();
  items.forEach((it) => {
    (it.phases || []).forEach((ph) => {
      const key = dateKey(ph.plannedDate);
      const col = colMap.get(key) || { key, date: ph.plannedDate || null, planned: 0 };
      col.planned += Number(ph.plannedQty || 0);
      if (!col.date && ph.plannedDate) col.date = ph.plannedDate;
      colMap.set(key, col);
    });
  });
  const columns = [...colMap.values()].sort((a, b) => {
    if (a.key === 'UNSCHEDULED') return 1;
    if (b.key === 'UNSCHEDULED') return -1;
    return new Date(a.date) - new Date(b.date);
  });
  let n = 0;
  columns.forEach((c) => { c.label = c.key === 'UNSCHEDULED' ? 'Unscheduled' : `Dispatch ${(n += 1)}`; });

  const rows = items.map((it) => {
    const byCol = {};
    let itemTotal = 0;
    (it.phases || []).forEach((ph) => {
      const key = dateKey(ph.plannedDate);
      byCol[key] = (byCol[key] || 0) + Number(ph.plannedQty || 0);
      itemTotal += Number(ph.plannedQty || 0);
    });
    return { it, byCol, itemTotal };
  });

  const colTotal = (key) => rows.reduce((s, r) => s + (r.byCol[key] || 0), 0);
  const totalPlanned = rows.reduce((s, r) => s + r.itemTotal, 0);

  return { schedule, company, brandName, today, items, columns, rows, colTotal, totalPlanned };
}

const PRINT_BAR = `
  <div class="print-bar">
    <div><strong>Dispatch Plan Preview</strong> — choose “Save as PDF” in the print dialog.</div>
    <div><button onclick="window.print()">Print / Save PDF</button><button onclick="window.close()">Close</button></div>
  </div>`;

function openHtml(html) {
  const w = window.open('', '_blank');
  if (!w) {
    alert('Pop-up blocked. Please allow pop-ups so the dispatch plan preview can open.');
    return false;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

/**
 * The "By Date" dispatch plan.
 * @param {object} schedule  DispatchSchedule document
 * @param {object} [opts]    { variant: 'client' | 'internal' }
 *   'client'   — item name only (customer copy).
 *   'internal' — item name + SKU code (internal copy, marked "Internal Copy").
 */
export function printDispatchPlanByDate(schedule = {}, opts = {}) {
  const variant = opts.variant === 'internal' ? 'internal' : 'client';
  const isInternal = variant === 'internal';
  // Optional period subtitle — set when the user exports a single month's plan.
  const periodLabel = opts.periodLabel ? String(opts.periodLabel) : '';
  const m = buildPlanModel(schedule);
  const { company, brandName, today } = m;
  const s = schedule;

  // SKUs become columns; dates become rows → wide only in the SKU count.
  const skuCount = m.rows.length;
  const wide = skuCount > 6;

  const skuHead = (r) => `<th class="c-sku"><span class="sname">${esc(r.it.skuName || r.it.skuCode || '')}</span>${isInternal && r.it.skuCode ? `<span class="scode">${esc(r.it.skuCode)}</span>` : ''}</th>`;

  const headRow = `
    <tr class="cols">
      <th class="c-date">Dispatch Date</th>
      ${m.rows.map(skuHead).join('')}
      <th class="c-tot">Total Per Date</th>
    </tr>`;
  const dateRow = (col) => {
    const isUn = col.key === 'UNSCHEDULED';
    return `
    <tr>
      <td class="date"><span class="d">${isUn ? 'Unscheduled' : esc(fmtDate(col.date))}</span>${isUn ? '' : `<span class="dn">(${esc(col.label)})</span>`}</td>
      ${m.rows.map((r) => { const v = r.byCol[col.key] || 0; return `<td class="qty ${v ? '' : 'zero'}">${v ? num(v) : '–'}</td>`; }).join('')}
      <td class="qty datetot">${num(m.colTotal(col.key))}</td>
    </tr>`;
  };

  const table = m.columns.length === 0
    ? `<p class="empty">No planned dispatches in this schedule yet.</p>`
    : `
    <table class="grid bydate">
      <thead>${headRow}</thead>
      <tbody>${m.columns.map(dateRow).join('')}</tbody>
      <tfoot>
        <tr class="skutot">
          <td class="date">Total Per SKU</td>
          ${m.rows.map((r) => `<td class="qty">${num(r.itemTotal)}</td>`).join('')}
          <td class="qty grand-cell">${num(m.totalPlanned)}</td>
        </tr>
      </tfoot>
    </table>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Dispatch Plan${isInternal ? ' (Internal)' : ''} — ${esc(s.soNumber || '')}</title>
<style>
  :root { --navy:#0b2545; --navy2:#16305a; --blue:#1d4ed8; --ink:#1a2438; --line:#c9d2e2; --soft:#eef2fb; --muted:#6a7690; }
  * { box-sizing:border-box; }
  html, body { margin:0; padding:0; background:#e7ebf3; font-family:"Georgia","Segoe UI",serif; color:var(--ink); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .sheet { width:${wide ? '297mm' : '210mm'}; max-width:100%; min-height:${wide ? '210mm' : '297mm'}; margin:16px auto; background:#fff; padding:15mm 16mm; box-shadow:0 6px 30px rgba(11,37,69,0.12); }

  /* Centred classic letterhead with a double rule. */
  .lh { text-align:center; padding-bottom:12px; border-bottom:3px double var(--navy); }
  .lh .brand { font-size:26px; font-weight:800; color:var(--navy); letter-spacing:0.02em; }
  .lh .sub { font-family:"Segoe UI",Arial,sans-serif; font-size:10px; color:var(--muted); margin-top:4px; }
  .title-wrap { text-align:center; margin:14px 0 4px; }
  .title-wrap h1 { margin:0; font-size:15px; letter-spacing:0.32em; font-weight:800; color:var(--navy); text-transform:uppercase; }
  .title-wrap .copytag { font-family:"Segoe UI",Arial,sans-serif; font-size:9px; letter-spacing:0.16em; text-transform:uppercase; color:#b45309; font-weight:800; margin-top:5px; }
  .title-wrap .period { font-family:"Segoe UI",Arial,sans-serif; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:var(--blue); font-weight:800; margin-top:5px; }

  .meta { font-family:"Segoe UI",Arial,sans-serif; width:100%; border-collapse:collapse; margin:16px 0 6px; }
  .meta td { border:1px solid var(--line); padding:8px 12px; font-size:11px; vertical-align:top; width:25%; }
  .meta .k { font-size:8px; letter-spacing:0.1em; text-transform:uppercase; color:var(--muted); font-weight:800; display:block; }
  .meta .v { font-size:12px; font-weight:700; color:var(--navy); margin-top:2px; display:block; }

  .intro { font-family:"Segoe UI",Arial,sans-serif; font-size:11px; color:#3a4560; margin:14px 0 8px; }
  .section-title { font-family:"Segoe UI",Arial,sans-serif; font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:var(--navy); border-bottom:2px solid var(--navy); padding:0 0 5px; margin:0 0 8px; }

  /* Transposed table — filled navy header, zebra rows, numbers centred. */
  table.grid { font-family:"Segoe UI",Arial,sans-serif; width:100%; border-collapse:collapse; border:1px solid var(--line); }
  table.grid th, table.grid td { padding:9px 9px; font-size:10.5px; text-align:center; border:1px solid var(--line); }
  table.grid thead .cols th { background:var(--navy2); color:#fff; font-size:8.5px; text-transform:uppercase; letter-spacing:0.05em; font-weight:800; border-color:var(--navy2); vertical-align:middle; }
  .c-date, td.date { text-align:left !important; }
  .c-date { width:34mm; }
  .c-sku .sname { display:block; font-weight:700; font-size:10px; color:#fff; text-transform:none; letter-spacing:0; line-height:1.25; }
  .c-sku .scode { display:block; font-family:ui-monospace,"Consolas",monospace; font-size:7.5px; font-weight:600; color:#cfd9ee; margin-top:2px; text-transform:none; letter-spacing:0; }
  tbody tr:nth-child(even) td { background:var(--soft); }
  td.date .d { display:block; font-weight:800; color:var(--navy); font-size:11px; }
  td.date .dn { display:block; font-size:8.5px; font-weight:600; color:var(--muted); margin-top:1px; }
  td.qty { font-weight:700; color:var(--ink); font-variant-numeric:tabular-nums; }
  td.qty.zero { color:#b6c0d4; }
  td.datetot { font-weight:800; color:var(--navy); }
  tfoot .skutot td { background:var(--soft); color:var(--navy); font-weight:800; font-size:10px; text-transform:uppercase; letter-spacing:0.03em; }
  tfoot .skutot .grand-cell { background:var(--navy); color:#fff; font-size:12px; }
  .empty { color:#7a869c; font-style:italic; text-align:center; padding:18px; border:1px solid var(--line); border-radius:6px; }

  .grand { font-family:"Segoe UI",Arial,sans-serif; display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding:13px 18px; border-radius:8px; background:var(--navy); color:#fff; }
  .grand .l { font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; }
  .grand .v { font-size:19px; font-weight:800; font-variant-numeric:tabular-nums; }
  .note { font-family:"Segoe UI",Arial,sans-serif; font-size:9px; color:#6a7690; margin-top:16px; }
  .footer { font-family:"Segoe UI",Arial,sans-serif; margin-top:14px; font-size:8.5px; color:#9aa4b8; text-align:center; border-top:1px solid #e2e7f0; padding-top:9px; }

  .print-bar { font-family:"Segoe UI",Arial,sans-serif; position:fixed; top:0; left:0; right:0; background:var(--navy); color:#fff; padding:10px 18px; display:flex; justify-content:space-between; align-items:center; z-index:10; font-size:12px; }
  .print-bar button { background:var(--blue); color:#fff; border:0; padding:7px 16px; font-weight:800; border-radius:5px; cursor:pointer; }
  .print-bar button + button { margin-left:8px; background:transparent; color:#fff; border:1px solid rgba(255,255,255,0.6); }
  body { padding-top:50px; }
  @media print {
    .print-bar { display:none !important; }
    body { padding-top:0; background:#fff; }
    .sheet { margin:0; width:auto; min-height:0; padding:0; box-shadow:none; }
    thead { display:table-header-group; }
    tr { break-inside:avoid; }
    @page { size:A4 ${wide ? 'landscape' : 'portrait'}; margin:14mm; }
  }
</style></head>
<body>
  ${PRINT_BAR}
  <div class="sheet">
    <div class="lh">
      <div class="brand">${esc(brandName)}</div>
      ${company.address ? `<div class="sub">${esc(company.address)}</div>` : ''}
      ${company.phone ? `<div class="sub">Phone: ${esc(company.phone)}</div>` : ''}
    </div>
    <div class="title-wrap"><h1>Dispatch Plan</h1>${periodLabel ? `<div class="period">${esc(periodLabel)}</div>` : ''}${isInternal ? '<div class="copytag">Internal Copy</div>' : ''}</div>

    <table class="meta">
      <tr>
        <td><span class="k">Party</span><span class="v">${esc(s.partyName || '—')}</span></td>
        <td><span class="k">Sales Order</span><span class="v">${esc(s.soNumber || '—')}</span></td>
        <td><span class="k">PO No</span><span class="v">${esc(s.poNumber || '—')}</span></td>
        <td><span class="k">Plan Date</span><span class="v">${esc(today)}</span></td>
      </tr>
    </table>

    <p class="intro">We plan to dispatch your order as per the item-wise schedule below. Each dispatch date is shown as a row against every item.</p>

    <div class="section-title">Planned Dispatch Schedule (By Date)</div>
    ${table}

    <div class="grand"><span class="l">Total Planned Quantity</span><span class="v">${num(m.totalPlanned)} pcs</span></div>

    <div class="note">This dispatch plan is indicative and subject to confirmation. Quantities and dates may be revised on mutual agreement.</div>
    <div class="footer">Generated by ${esc(brandName)} on ${esc(today)} · Dispatch Planning Execution System</div>
  </div>
  <script>setTimeout(() => { try { window.focus(); } catch (e) {} }, 100);</script>
</body></html>`;

  return openHtml(html);
}

export default printDispatchPlanByDate;
