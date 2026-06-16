/**
 * printDispatchPlan
 * -----------------
 * Opens a clean, professional BLACK & WHITE dispatch plan in a new tab
 * (preview + Save as PDF). Phase-first layout: each phase (P1, P2, …) shows its
 * planned date and the SKU line items planned for it, then an order summary and
 * the grand total. Pure greyscale, crisp ruled borders — print-ready on any
 * mono printer.
 *
 * Input is a DispatchSchedule document (see schedule.model.js):
 *   { companyHeader, soNumber, poNumber, partyName, poDate,
 *     items: [{ skuCode, skuName, poQty, dispatchedQty, balanceQty,
 *               phases: [{ phaseNo, plannedDate, plannedQty, status }] }] }
 */

import dayjs from 'dayjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const num = (n) => (Number(n || 0)).toLocaleString('en-IN');
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const phaseNum = (p) => parseInt(String(p || '').replace(/\D/g, ''), 10) || 0;

export function printDispatchPlan(schedule = {}) {
  const company = schedule.companyHeader || {};
  const today = dayjs().format('DD MMM YYYY');
  const items = schedule.items || [];

  // Group every SKU phase by phase number → { phaseNo, date, rows[], total }.
  const phaseMap = new Map();
  items.forEach((it) => {
    (it.phases || []).forEach((ph) => {
      const g = phaseMap.get(ph.phaseNo) || { phaseNo: ph.phaseNo, date: ph.plannedDate, rows: [], total: 0 };
      if (ph.plannedDate && (!g.date || new Date(ph.plannedDate) < new Date(g.date))) g.date = ph.plannedDate;
      g.rows.push({ skuCode: it.skuCode, skuName: it.skuName, qty: ph.plannedQty, status: ph.status });
      g.total += Number(ph.plannedQty || 0);
      phaseMap.set(ph.phaseNo, g);
    });
  });
  const phases = [...phaseMap.values()].sort((a, b) => phaseNum(a.phaseNo) - phaseNum(b.phaseNo));
  const totalPlanned = phases.reduce((s, p) => s + p.total, 0);

  const phaseSections = phases.length === 0
    ? `<p class="empty">No planned phases in this dispatch schedule.</p>`
    : phases.map((p) => `
      <table class="grid phase">
        <thead>
          <tr class="phase-head">
            <th colspan="2" class="phase-title">${esc(p.phaseNo)} &nbsp;·&nbsp; ${fmtDate(p.date)}</th>
            <th colspan="2" class="phase-meta">${p.rows.length} item${p.rows.length > 1 ? 's' : ''} · ${num(p.total)} pcs planned</th>
          </tr>
          <tr class="cols">
            <th style="width:28px;">#</th><th>SKU</th><th class="num" style="width:120px;">Planned Qty</th><th style="width:100px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${p.rows.map((r, i) => `
            <tr>
              <td class="idx">${i + 1}</td>
              <td><span class="code">${esc(r.skuCode || '')}</span>&nbsp; <span class="name">${esc(r.skuName || '')}</span></td>
              <td class="num bold">${num(r.qty)}</td>
              <td class="status">${titleCase(r.status || 'Planned')}</td>
            </tr>`).join('')}
          <tr class="subtotal">
            <td colspan="2">Phase ${esc(p.phaseNo)} total</td>
            <td class="num">${num(p.total)}</td><td></td>
          </tr>
        </tbody>
      </table>`).join('');

  const summaryRows = items.map((it, i) => `
    <tr>
      <td class="idx">${i + 1}</td>
      <td><span class="code">${esc(it.skuCode || '')}</span>&nbsp; <span class="name">${esc(it.skuName || '')}</span></td>
      <td class="num">${num(it.poQty)}</td>
      <td class="num">${num(it.dispatchedQty)}</td>
      <td class="num bold">${num(it.balanceQty)}</td>
    </tr>`).join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Dispatch Plan — ${esc(schedule.soNumber || '')}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e9e9e9; font-family: "Segoe UI", Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: 210mm; max-width: 100%; min-height: 297mm; margin: 16px auto; background: #fff; padding: 16mm; }
  /* ── Letterhead ── */
  .head { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 10px; border-bottom: 2px solid #000; }
  .brand { font-size: 20px; font-weight: 800; letter-spacing: 0.01em; }
  .sub { color: #444; font-size: 10px; margin-top: 2px; }
  .doc { text-align: right; }
  .doc h2 { margin: 0; font-size: 15px; letter-spacing: 0.12em; font-weight: 800; }
  .doc p { margin: 3px 0 0; font-size: 10px; color: #333; }
  /* ── Meta ── */
  .meta { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; border-top: none; margin: 14px 0 6px; }
  .meta .cell { padding: 7px 12px; border-top: 1px solid #000; }
  .meta .cell + .cell { border-left: 1px solid #000; }
  .meta .label { font-size: 8.5px; letter-spacing: 0.1em; font-weight: 700; text-transform: uppercase; color: #555; }
  .meta .value { font-size: 12px; font-weight: 700; margin-top: 2px; }
  .section-title { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; margin: 18px 0 7px; border-bottom: 1px solid #000; padding-bottom: 3px; }

  /* ── Tables (shared) ── */
  table.grid { width: 100%; border-collapse: collapse; border: 1px solid #000; }
  table.grid th, table.grid td { padding: 6px 10px; font-size: 11px; text-align: left; border: 1px solid #000; }
  table.grid thead .cols th, table.summary thead th { background: #ececec; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 800; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .idx { color: #555; }
  .code { font-family: "Courier New", monospace; font-weight: 700; }
  .name { color: #333; font-size: 10.5px; }
  .bold { font-weight: 800; }
  .status { color: #333; font-size: 10.5px; }
  .empty { color: #777; font-style: italic; text-align: center; padding: 16px; border: 1px solid #000; }

  /* ── Phase block ── */
  table.phase { margin-bottom: 12px; }
  .phase-head th { background: #edeef0; color: #000; border-color: #000; }
  .phase-title { font-size: 12px; font-weight: 800; letter-spacing: 0.03em; }
  .phase-meta { font-size: 10px; font-weight: 600; text-align: right; color: #333; }
  tr.subtotal td { background: #f4f4f4; font-weight: 800; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }

  table.summary { width: 100%; border-collapse: collapse; border: 1px solid #000; }
  table.summary th, table.summary td { padding: 6px 10px; font-size: 11px; text-align: left; border: 1px solid #000; }

  .grand { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding: 9px 14px; border: 2px solid #000; }
  .grand .l { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
  .grand .v { font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .footer { margin-top: 20px; font-size: 8.5px; color: #777; text-align: center; border-top: 1px solid #ccc; padding-top: 8px; }

  .print-bar { position: fixed; top: 0; left: 0; right: 0; background: #fff; color: #111; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; z-index: 10; font-size: 12px; border-bottom: 2px solid #111; }
  .print-bar button { background: #374151; color: #fff; border: 0; padding: 7px 15px; font-weight: 800; border-radius: 4px; cursor: pointer; }
  .print-bar button + button { margin-left: 8px; background: #fff; color: #111; border: 1px solid #111; }
  body { padding-top: 50px; }
  @media print { .print-bar { display: none !important; } body { padding-top: 0; background: #fff; } .sheet { margin: 0; width: auto; min-height: 0; padding: 0; } @page { size: A4; margin: 12mm; } }
</style></head>
<body>
  <div class="print-bar">
    <div><strong>Dispatch Plan Preview</strong> — choose “Save as PDF” in the print dialog.</div>
    <div><button onclick="window.print()">Print / Save PDF</button><button onclick="window.close()">Close</button></div>
  </div>

  <div class="sheet">
    <div class="head">
      <div>
        <div class="brand">${esc(company.name || 'Ambika Global')}</div>
        ${company.address ? `<div class="sub">${esc(company.address)}</div>` : ''}
        ${company.phone ? `<div class="sub">Phone: ${esc(company.phone)}</div>` : ''}
      </div>
      <div class="doc">
        <h2>DISPATCH PLAN</h2>
        <p><strong>Date:</strong> ${esc(today)}</p>
        ${schedule.poDate ? `<p><strong>PO Date:</strong> ${fmtDate(schedule.poDate)}</p>` : ''}
      </div>
    </div>

    <div class="meta">
      <div class="cell"><div class="label">Party</div><div class="value">${esc(schedule.partyName || '—')}</div></div>
      <div class="cell"><div class="label">SO / PO</div><div class="value">${esc(schedule.soNumber || '—')}${schedule.poNumber ? ` · PO ${esc(schedule.poNumber)}` : ''}</div></div>
    </div>

    <div class="section-title">Phase-wise Plan</div>
    ${phaseSections}

    ${items.length ? `
    <div class="section-title">Order Summary</div>
    <table class="summary">
      <thead><tr><th style="width:28px;">#</th><th>SKU</th><th class="num">PO Qty</th><th class="num">Dispatched</th><th class="num">Balance</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>` : ''}

    <div class="grand">
      <span class="l">Total Planned Quantity</span>
      <span class="v">${num(totalPlanned)} pcs</span>
    </div>

    <div class="footer">Generated by ${esc(company.name || 'Ambika Global')} on ${esc(today)} · Dispatch Planning Execution System</div>
  </div>
  <script>setTimeout(() => { try { window.focus(); } catch (e) {} }, 100);</script>
</body></html>`;

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
