/**
 * printCalculatorQuote
 * --------------------
 * Builds a print-friendly HTML quotation in a new tab and opens the browser's
 * print dialog. From there the user can "Save as PDF" via the print dialog
 * destination — no PDF library required.
 *
 * Why a new tab and not an in-page modal:
 *   - Print stylesheets that target the whole document are easier to scope.
 *   - The Pricing Hub navigation, sidebar, etc. would otherwise need
 *     `@media print { display: none }` overrides we'd have to maintain.
 *   - A new tab also lets the user keep the calculator open while reviewing
 *     the print preview.
 */

import dayjs from 'dayjs';

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const fmtINR = (n) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(n));
};

export function printCalculatorQuote({
  company = {},
  party,
  poRef,
  asOfDate,
  lines = [],         // [{ code, name, qty, unitPrice, lineSubtotal }]
  priceType = 'SELLING',
  gstRate = 18,
  subtotal = 0,
  gstAmount = 0,
  grandTotal = 0,
  viewMode = 'with_gst',
}) {
  // 'inclusive' is a retired mode kept in this test only so a quote saved before
  // it was removed still prints with its GST section instead of silently losing it.
  const includeGst = viewMode !== 'basic';
  const today = dayjs().format('DD MMM YYYY');

  // Sum of the quantity column, shown as a footer total in the items table.
  const totalQty = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  const fmtQty = (n) => new Intl.NumberFormat('en-IN').format(Number(n) || 0);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Quotation — ${escape(party?.name || 'Customer')} · ${today}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; color: #0f172a; }
  .sheet { width: 210mm; min-height: 297mm; margin: 12mm auto; padding: 14mm 16mm; background: #fff; box-shadow: 0 6px 20px rgba(15,23,42,0.08); }
  header { border-bottom: 2px solid #1e3a8a; padding-bottom: 14px; margin-bottom: 22px; display: flex; justify-content: space-between; align-items: flex-start; }
  .brand h1 { margin: 0; font-size: 20pt; color: #1e3a8a; letter-spacing: -0.02em; }
  .brand p { margin: 2px 0 0 0; font-size: 9pt; color: #64748b; line-height: 1.4; }
  .doc-meta { text-align: right; }
  .doc-meta h2 { margin: 0; font-size: 16pt; color: #0f172a; letter-spacing: 0.06em; }
  .doc-meta p { margin: 2px 0; font-size: 9pt; color: #64748b; }
  .doc-meta strong { color: #0f172a; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 18px; }
  .meta-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
  .meta-card .label { font-size: 7.5pt; font-weight: 800; color: #64748b; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }
  .meta-card .value { font-size: 10.5pt; font-weight: 600; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  thead th { background: #1e3a8a; color: #fff; font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 8px 10px; text-align: left; }
  thead th.num { text-align: right; }
  tbody td { padding: 9px 10px; border-bottom: 1px solid #e2e8f0; font-size: 9.5pt; }
  tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody td.code { font-family: 'Courier New', ui-monospace, monospace; font-weight: 700; color: #1e3a8a; }
  tbody td.desc { color: #475569; font-size: 8.5pt; }
  tbody td.qty { font-weight: 700; color: #0f172a; }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  tfoot td { padding: 9px 10px; border-top: 2px solid #1e3a8a; font-size: 9.5pt; }
  tfoot td.foot-label { text-align: right; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; font-size: 8.5pt; color: #475569; }
  tfoot td.foot-total { font-weight: 800; color: #1e3a8a; }
  .totals { margin-top: 18px; display: flex; justify-content: flex-end; }
  .totals-box { width: 280px; }
  .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 10pt; }
  .totals-row.subtotal { color: #475569; }
  .totals-row.gst { color: #b45309; }
  .totals-row.total { border-top: 2px solid #1e3a8a; padding-top: 10px; margin-top: 6px; font-size: 13pt; font-weight: 800; color: #1e3a8a; }
  .totals-row .value { font-variant-numeric: tabular-nums; font-weight: 700; }
  footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 8.5pt; color: #64748b; line-height: 1.5; }
  footer .terms { margin-bottom: 8px; }
  .stamp { display: inline-block; padding: 4px 10px; border: 1.5px dashed #94a3b8; border-radius: 6px; font-size: 8pt; font-weight: 700; color: #64748b; letter-spacing: 0.06em; text-transform: uppercase; margin-top: 8px; }

  .print-bar { position: fixed; top: 0; left: 0; right: 0; background: #1e3a8a; color: #fff; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 1000; }
  .print-bar h3 { margin: 0; font-size: 11pt; }
  .print-bar p { margin: 0; font-size: 9pt; opacity: 0.85; }
  .print-bar button { background: #fff; color: #1e3a8a; border: none; padding: 8px 16px; font-weight: 700; border-radius: 6px; cursor: pointer; font-size: 10pt; }
  .print-bar button + button { margin-left: 8px; background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.4); }
  body { padding-top: 56px; }

  @media print {
    .print-bar { display: none !important; }
    body { padding-top: 0; background: #fff; }
    .sheet { margin: 0; box-shadow: none; width: auto; min-height: 0; }
    @page { size: A4; margin: 10mm; }
  }
</style>
</head>
<body>
  <div class="print-bar">
    <div>
      <h3>Quotation Preview</h3>
      <p>Choose <strong>Save as PDF</strong> as the destination in the print dialog.</p>
    </div>
    <div>
      <button onclick="window.print()">Print / Save PDF</button>
      <button onclick="window.close()">Close</button>
    </div>
  </div>

  <div class="sheet">
    <header>
      <div class="brand">
        <h1>${escape(company.companyName || 'Ambika Global')}</h1>
        <p>${escape(company.companyAddress || '')}</p>
        ${company.companyPhone ? `<p>Phone: ${escape(company.companyPhone)}</p>` : ''}
        ${company.companyEmail ? `<p>Email: ${escape(company.companyEmail)}</p>` : ''}
        ${company.companyGstin ? `<p>GSTIN: ${escape(company.companyGstin)}</p>` : ''}
      </div>
      <div class="doc-meta">
        <h2>QUOTATION</h2>
        <p><strong>Date:</strong> ${escape(today)}</p>
        ${asOfDate ? `<p><strong>Prices as of:</strong> ${escape(dayjs(asOfDate).format('DD MMM YYYY'))}</p>` : ''}
        ${poRef ? `<p><strong>Reference:</strong> ${escape(poRef)}</p>` : ''}
      </div>
    </header>

    <div class="meta-grid">
      <div class="meta-card">
        <div class="label">Quote to</div>
        <div class="value">${escape(party?.name || 'Walk-in Customer')}</div>
      </div>
      <div class="meta-card">
        <div class="label">Price stream</div>
        <div class="value">${priceType === 'SELLING' ? 'Selling Prices' : 'Raw Material Costs'}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 32px;">#</th>
          <th>SKU / Description</th>
          <th class="num" style="width: 80px;">Qty</th>
          <th class="num" style="width: 100px;">Unit ₹</th>
          <th class="num" style="width: 120px;">Amount ₹</th>
        </tr>
      </thead>
      <tbody>
        ${lines.length === 0 ? `
          <tr><td colspan="5" style="text-align:center; padding: 22px; color:#94a3b8; font-style: italic;">No items in this quotation.</td></tr>
        ` : lines.map((l, i) => `
          <tr>
            <td class="num" style="color:#94a3b8;">${i + 1}</td>
            <td>
              <div class="code">${escape(l.code)}</div>
              <div class="desc">${escape(l.name)}</div>
            </td>
            <td class="num qty">${fmtQty(l.qty)}</td>
            <td class="num">${fmtINR(l.unitPrice)}</td>
            <td class="num"><strong>${fmtINR(l.lineSubtotal)}</strong></td>
          </tr>
        `).join('')}
      </tbody>
      ${lines.length === 0 ? '' : `
      <tfoot>
        <tr>
          <td></td>
          <td class="foot-label">Total Quantity</td>
          <td class="num qty foot-total">${fmtQty(totalQty)}</td>
          <td></td>
          <td></td>
        </tr>
      </tfoot>`}
    </table>

    <div class="totals">
      <div class="totals-box">
        <div class="totals-row subtotal">
          <span>Subtotal</span>
          <span class="value">${fmtINR(subtotal)}</span>
        </div>
        ${includeGst ? `
        <div class="totals-row gst">
          <span>GST @ ${gstRate}%</span>
          <span class="value">${fmtINR(gstAmount)}</span>
        </div>` : ''}
        <div class="totals-row total">
          <span>${includeGst ? 'Grand Total' : 'Total'}</span>
          <span class="value">${fmtINR(includeGst ? grandTotal : subtotal)}</span>
        </div>
      </div>
    </div>

    <footer>
      <div class="terms">
        <strong>Terms &amp; Conditions:</strong>
        ${escape(company.quoteTerms || 'Prices indicative based on current master rates. Subject to change without notice. Delivery and payment terms to be confirmed in PO.')}
      </div>
      ${company.quoteValidityDays ? `<div>This quotation is valid for ${company.quoteValidityDays} days from the date of issue.</div>` : ''}
      <div class="stamp">For ${escape(company.companyName || 'Ambika Global')} · Authorised Signatory</div>
    </footer>
  </div>

  <script>
    // Auto-trigger print dialog after fonts settle.
    setTimeout(() => { try { window.focus(); } catch (e) {} }, 100);
  </script>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) {
    alert('Pop-up blocked. Please allow pop-ups for this site so the quote preview can open.');
    return false;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
