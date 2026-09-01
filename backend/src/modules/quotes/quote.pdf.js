/**
 * Server-rendered branded quote — printable HTML.
 *
 * Why HTML and not a true PDF binary:
 *   - No new runtime dependency (puppeteer is heavyweight; pdfkit is fiddly
 *     for tables). Browsers print HTML to PDF perfectly using the user's
 *     own "Save as PDF" — same A4 output, zero new infra.
 *   - The page uses @page CSS so it paginates cleanly on print.
 *   - If we add puppeteer later, the same HTML can be piped through
 *     `page.pdf()` without any layout rework.
 */

import dayjs from 'dayjs';
import Quote from './quote.model.js';
import CompanySettings from '../pricing/company-settings.model.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { AppError } from '../../utils/apiResponse.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[c]));

const inr = (n) => '₹ ' + (Number(n || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n) => (Number(n || 0)).toLocaleString('en-IN');

export const renderQuotePdf = asyncHandler(async (req, res) => {
  const quote = await Quote.findById(req.params.id).lean();
  if (!quote) throw new AppError('Quote not found', 404);
  const settings = await CompanySettings.getSingleton();

  // GST columns/totals are shown only when the quote was saved "with GST".
  const showGst = quote.pdfIncludeGst !== false;
  const totalQty = quote.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);

  // Keep the line table lean & professional: code + name, qty, rate, GST%, amount.
  // Per-line GST value / running totals live in the summary box, not the table.
  const linesHtml = quote.lines.map((l, i) => `
    <tr>
      <td class="num idx">${i + 1}</td>
      <td><strong>${esc(l.skuCode)}</strong><br/><span class="muted">${esc(l.skuName)}</span></td>
      <td class="num qty">${qtyFmt(l.qty)}</td>
      <td class="num">${inr(l.unitPrice)}</td>
      ${showGst ? `<td class="num">${l.gstRate}%</td>` : ''}
      <td class="num bold">${inr(l.lineSubtotal)}</td>
    </tr>
  `).join('');

  const totalRow = `
    <tr class="total-row">
      <td></td>
      <td class="foot-label">Total Quantity</td>
      <td class="num qty bold">${qtyFmt(totalQty)}</td>
      <td colspan="${showGst ? 3 : 2}"></td>
    </tr>`;

  const gstBreakdown = !showGst ? '' : Object.entries(quote.gstBreakdown || {}).map(([rate, amt]) => `
    <div class="gst-row"><span>GST @ ${rate}%</span><span>${inr(amt)}</span></div>
  `).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(quote.quoteNumber)} · ${esc(settings.companyName)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #eef2f9; }
    body { font-family: -apple-system, "Segoe UI", Inter, system-ui, sans-serif; color: #0b2545; }
    /* On-screen: render as a centred A4 page so it reads like a document, not a
       full-width web table (which is what made the preview look oversized). */
    .sheet { width: 210mm; max-width: 100%; min-height: 297mm; margin: 16px auto; background: #fff;
             padding: 16mm 16mm; box-shadow: 0 8px 30px rgba(15, 23, 42, 0.12); }
    .head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 2px solid #1d4ed8; }
    .head .brand { font-size: 20px; font-weight: 800; color: #1e3a8a; }
    .head .meta  { text-align: right; font-size: 11px; color: #475a8a; }
    /* With the "QUOTATION" banner gone, the quote number carries the top-right
       weight so the letterhead still reads as a balanced pair. */
    .head .quote-no { font-size: 16px; font-weight: 800; color: #1e3a8a; letter-spacing: .02em; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 16px 0 4px; }
    .box  { padding: 10px 12px; border: 1px solid #dbe4f3; border-radius: 8px; background: #f7f9ff; }
    .box .label { font-size: 9.5px; letter-spacing: 0.08em; font-weight: 800; text-transform: uppercase; color: #64748b; }
    .box .value { font-size: 12px; font-weight: 600; margin-top: 3px; color: #0b2545; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; table-layout: fixed; }
    th, td { padding: 7px 9px; font-size: 11px; overflow: hidden; }
    th { background: #1e3a8a; color: #fff; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.05em; font-weight: 700; }
    tbody tr:nth-child(even) td { background: #f9fbff; }
    td { border-bottom: 1px solid #eaf0fb; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .idx { color: #94a3b8; }
    .qty { font-weight: 700; }
    .bold { font-weight: 800; }
    .muted { color: #64748b; font-size: 10px; }
    tfoot td { border-top: 2px solid #1d4ed8; border-bottom: none; background: #fff !important; padding-top: 9px; }
    tfoot .foot-label { text-align: right; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 800; font-size: 10px; color: #475a8a; }
    .totals { margin-top: 16px; margin-left: auto; max-width: 300px; font-size: 12px; }
    .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
    .totals .grand { font-size: 17px; font-weight: 800; color: #1d4ed8; border-top: 2px solid #1d4ed8; margin-top: 6px; padding-top: 8px; }
    .gst-row { display: flex; justify-content: space-between; font-size: 10.5px; color: #64748b; margin-left: 12px; }
    .terms { margin-top: 24px; padding: 11px 13px; background: #f7f9ff; border-left: 4px solid #1d4ed8; border-radius: 4px; font-size: 10.5px; color: #475a8a; line-height: 1.5; }
    .footer { margin-top: 20px; font-size: 9.5px; color: #94a3b8; text-align: center; }
    .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
    .pill-draft { background: #f1f5f9; color: #475569; }
    .pill-sent  { background: #dbeafe; color: #1e3a8a; }
    .pill-accepted { background: #d1fae5; color: #115e59; }
    .pill-expired { background: #fef3c7; color: #92400e; }
    .pill-converted { background: #e9d5ff; color: #6b21a8; }
    .print-btn { position: fixed; top: 12px; right: 12px; padding: 8px 14px; border-radius: 8px; background: #1d4ed8; color: #fff; border: 0; font-weight: 700; cursor: pointer; font-size: 12px; z-index: 10; }
    @media print {
      html, body { background: #fff; }
      .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
      .print-btn { display: none; }
    }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Save as PDF</button>

  <div class="sheet">
  <div class="head">
    <div>
      <div class="brand">${esc(settings.companyName)}</div>
      <div class="muted">${esc(settings.companyAddress)}</div>
      ${settings.companyGstin ? `<div class="muted">GSTIN: ${esc(settings.companyGstin)}</div>` : ''}
      ${settings.companyPhone ? `<div class="muted">${esc(settings.companyPhone)} · ${esc(settings.companyEmail || '')}</div>` : ''}
    </div>
    <div class="meta">
      <!-- No "QUOTATION" banner: the quote number and its status already say what
           this sheet is, and the letterhead is the company's, not a form title. -->
      <div class="quote-no">${esc(quote.quoteNumber)}</div>
      <div class="pill pill-${quote.status.toLowerCase().replace('_', '-')}" style="margin-top: 6px;">${esc(quote.status)}</div>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <div class="label">Quoted to</div>
      <div class="value">${esc(quote.partyName || '—')}</div>
      ${quote.poReference ? `<div class="muted" style="margin-top: 4px;">PO Ref: ${esc(quote.poReference)}</div>` : ''}
    </div>
    <div class="box">
      <div class="label">Quote dates</div>
      <div class="value">As of: ${dayjs(quote.asOfDate).format('DD MMM YYYY')}</div>
      <div class="value">Valid until: ${dayjs(quote.validUntil).format('DD MMM YYYY')}</div>
    </div>
  </div>

  <table>
    <colgroup>
      <col style="width: 28px;" />
      <col />
      <col style="width: 64px;" />
      <col style="width: 78px;" />
      ${showGst ? '<col style="width: 50px;" />' : ''}
      <col style="width: 104px;" />
    </colgroup>
    <thead>
      <tr>
        <th class="num">#</th>
        <th style="text-align:left;">SKU / Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit ₹</th>
        ${showGst ? '<th class="num">GST</th>' : ''}
        <th class="num">Amount ₹</th>
      </tr>
    </thead>
    <tbody>${linesHtml}</tbody>
    <tfoot>${totalRow}</tfoot>
  </table>

  <div class="totals">
    ${showGst ? `
    <div class="row"><span>Subtotal</span><span>${inr(quote.totals.subtotal)}</span></div>
    ${gstBreakdown}
    <div class="row"><span>GST total</span><span>${inr(quote.totals.gstTotal)}</span></div>
    <div class="row grand"><span>Grand Total</span><span>${inr(quote.totals.grandTotal)}</span></div>
    ` : `
    <div class="row grand"><span>Total</span><span>${inr(quote.totals.subtotal)}</span></div>
    `}
  </div>

  ${settings.quoteTerms ? `<div class="terms"><strong>Terms & conditions:</strong><br/>${esc(settings.quoteTerms).replace(/\n/g, '<br/>')}</div>` : ''}

  <div class="footer">
    Generated by ${esc(settings.companyName)} on ${dayjs().format('DD MMM YYYY · HH:mm')}
    ${quote.createdByName ? ` by ${esc(quote.createdByName)}` : ''}.
  </div>
  </div>
</body>
</html>`;

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});
