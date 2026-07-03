/**
 * Shared export helpers for the O2D data screens (Master Data, Calendar).
 *   - exportRowsToExcel : one sheet, every visible column, filtered rows.
 *   - printTablePdf     : a branded, print-ready A4 table (opens a tab → Save as PDF).
 * Both take the same (columns, rows, displayVal) shape used by the grids so the
 * export always matches exactly what's on screen after filtering.
 */
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Build plain objects keyed by column header → cell text, ready for XLSX.
const toObjects = (columns, rows, displayVal) => rows.map((r) => {
  const o = {};
  columns.forEach((c) => { o[c.headerName] = displayVal(c, r); });
  return o;
});

export function exportRowsToExcel({ columns, rows, displayVal, sheetName = 'Data', fileName = 'export.xlsx' }) {
  const ws = XLSX.utils.json_to_sheet(toObjects(columns, rows, displayVal));
  // Auto-ish column widths from header + longest value.
  ws['!cols'] = columns.map((c) => {
    const maxLen = rows.reduce((m, r) => Math.max(m, String(displayVal(c, r)).length), c.headerName.length);
    return { wch: Math.min(48, Math.max(10, maxLen + 2)) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 28) || 'Data');
  XLSX.writeFile(wb, fileName);
}

export function printTablePdf({ title, subtitle, columns, rows, displayVal, landscape = true }) {
  const head = columns.map((c) => `<th>${esc(c.headerName)}</th>`).join('');
  const body = rows.length
    ? rows.map((r, i) => `<tr><td class="n">${i + 1}</td>${columns.map((c) => `<td>${esc(displayVal(c, r))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length + 1}" style="text-align:center;padding:20px;color:#888">No records</td></tr>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups to export the PDF.'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #0b2545; margin: 0; padding: 22px; }
    .hd { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1d4ed8; padding-bottom:10px; }
    .hd h1 { font-size:18px; margin:0; color:#1e3a8a; }
    .hd .sub { font-size:11px; color:#475569; margin-top:3px; max-width:640px; }
    .meta { font-size:10px; color:#64748b; text-align:right; white-space:nowrap; }
    table { width:100%; border-collapse:collapse; margin-top:14px; font-size:10px; }
    th { background:#eef2ff; color:#1e3a8a; text-align:left; padding:6px 7px; border:1px solid #cbd5e1; font-weight:700; }
    td { padding:5px 7px; border:1px solid #e2e8f0; vertical-align:top; }
    td.n { color:#94a3b8; width:26px; }
    tr:nth-child(even) td { background:#f8fafc; }
    .ft { margin-top:14px; font-size:9px; color:#94a3b8; text-align:center; }
    @media print { body { padding:0; } }
  </style></head><body>
    <div class="hd">
      <div><h1>${esc(title)}</h1>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}</div>
      <div class="meta"><b>M/s AMBIKA GLOBAL</b><br/>Generated ${dayjs().format('DD MMM YYYY, hh:mm A')}<br/>${rows.length} record(s)</div>
    </div>
    <table><thead><tr><th>#</th>${head}</tr></thead><tbody>${body}</tbody></table>
    <div class="ft">AGL ERP · O2D — generated report</div>
    <script>window.onload=function(){setTimeout(function(){window.print();},350);};</script>
  </body></html>`);
  w.document.close();
}
