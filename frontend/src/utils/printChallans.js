import dayjs from 'dayjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

// One delivery-challan block — a HALF-page card. Two of these stack on one A4 page.
const challanBlock = (dc, companyName, company = {}) => {
  const items = dc.items || [];
  const rows = items.map((it, i) => `
    <tr${i % 2 ? ' class="alt"' : ''}>
      <td class="c">${i + 1}</td>
      <td>${esc(it.skuName || it.skuCode || '-')}${it.skuName && it.skuCode ? `<span class="code"> · ${esc(it.skuCode)}</span>` : ''}</td>
      <td class="r">${num(it.quantityPcs)}</td>
      <td class="r">${num(it.noOfBoxes)}</td>
      <td class="r">${Number(it.weightKg || 0).toFixed(2)}</td>
    </tr>`).join('');

  // Mirrors the server-rendered challan exactly (pdf.service.js → "Meta band 2"):
  // Vehicle · Transporter · L.R. No, and only when at least one is present.
  // Invoice No is deliberately NOT here — a delivery challan travels with the
  // goods before the invoice exists, so it printed as a permanent empty "-".
  const meta2 = (dc.vehicleNo || dc.transporterName || dc.lrNo)
    ? `<div class="meta">
         <div><span>Vehicle No</span>${esc(dc.vehicleNo || '-')}</div>
         <div><span>Transporter</span>${esc(dc.transporterName || '-')}</div>
         <div><span>L.R. No</span>${esc(dc.lrNo || '-')}</div>
       </div>` : '';

  // Letterhead, band labels, DELIVER TO block and the DISPATCH DETAILS rule all
  // mirror drawDeliveryChallan() in backend/src/services/pdf.service.js, so this
  // print sheet and the server's Preview/Download PDF read as the same document.
  const contact = [
    company.companyPhone ? `Phone: ${esc(company.companyPhone)}` : '',
    company.companyEmail ? `Email: ${esc(company.companyEmail)}` : '',
  ].filter(Boolean).join(' &nbsp;|&nbsp; ');

  return `
  <section class="challan">
    <div class="lh">${esc(company.companyName || companyName)}</div>
    ${company.companyAddress ? `<div class="lhSub">${esc(company.companyAddress)}</div>` : ''}
    ${contact ? `<div class="lhSub">${contact}</div>` : ''}
    <div class="title">DELIVERY CHALLAN</div>
    <div class="meta">
      <div><span>Delivery Challan No</span>${esc(dc.dcNumber || '-')}</div>
      <div><span>Date</span>${fmtDate(dc.dcDate)}</div>
      <div><span>Sales Order</span>${esc(dc.soNumber || '-')}</div>
      <div><span>PO No</span>${esc(dc.poNumber || '-')}</div>
    </div>
    ${meta2}
    <!-- Party name on its own line with the address as a block beneath it. It
         used to run inline after an em-dash, which wrapped into an unreadable
         ribbon for multi-line delivery addresses. -->
    <div class="to">
      <div class="toCap">Deliver To</div>
      <div class="toName">${esc(dc.partyName || '-')}</div>
      ${dc.deliveryAddress ? `<div class="toAddr">${esc(dc.deliveryAddress)}</div>` : ''}
    </div>
    <div class="sect">Dispatch Details</div>
    <table>
      <thead>
        <tr><th class="c">SR</th><th>SKU Description</th><th class="r">QTY (PCS)</th><th class="r">BOXES</th><th class="r">WEIGHT (KG)</th></tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="5" class="empty">No items</td></tr>'}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2">TOTAL</td>
          <td class="r">${num(dc.totalQuantityPcs)}</td>
          <td class="r">${num(dc.totalBoxes)}</td>
          <td class="r">${Number(dc.totalWeightKg || 0).toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
    ${dc.remark ? `<div class="remark"><span>Remarks</span>${esc(dc.remark)}</div>` : ''}
    <div class="sign">
      <div>Receiver's Signature</div>
      <div class="right">For ${esc(company.companyName || companyName)}</div>
    </div>
  </section>`;
};

/**
 * Open a print-ready A4 document with TWO delivery challans per page. A 3rd challan
 * flows onto page 2, a 5th onto page 3, and so on. The browser's own print dialog
 * then lets the user choose colour / black-&-white, one-sided / both-sides, etc.
 */
export function printChallans({ challans = [], company = {}, companyName = 'M/s AMBIKA GLOBAL' } = {}) {
  const list = (challans || []).filter(Boolean);
  if (!list.length) return false;

  // Group into pages of TWO.
  const pages = [];
  for (let i = 0; i < list.length; i += 2) pages.push(list.slice(i, i + 2));
  const pagesHtml = pages.map((pair) => `
    <div class="page">${pair.map((dc) => challanBlock(dc, companyName, company)).join('')}</div>`).join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Delivery Challans — print</title>
<style>
  @page { size: A4 portrait; margin: 9mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e9e7e1; color: #1a2438; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { padding-top: 46px; }
  .bar { position: fixed; top: 0; left: 0; right: 0; z-index: 10; background: #fff; border-bottom: 1px solid #c9d2e2; padding: 8px 16px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
  .bar button { border: 0; border-radius: 5px; background: #0b2545; color: #fff; padding: 7px 14px; font-weight: 800; cursor: pointer; }
  .bar button + button { margin-left: 8px; background: #fff; color: #0f172a; border: 1px solid #94a3b8; }
  /* A true A4 sheet on screen, so the preview matches the paper exactly.
     Wider side padding (14mm) pulls the challan in from the paper edge — at 9mm
     it ran nearly edge-to-edge and read as a wall of ink. */
  .page { width: 210mm; height: 297mm; margin: 8px auto; background: #fff; padding: 9mm 14mm; display: flex; flex-direction: column; gap: 6mm; }

  /* Each challan is locked to HALF the page — not sized by its content. Two short
     challans therefore fill the sheet instead of leaving a void at the bottom, and
     a lone trailing challan still occupies only the top half rather than stretching. */
  .challan { flex: 0 0 calc((100% - 6mm) / 2); display: flex; flex-direction: column; overflow: hidden;
             border: 1px solid #0b2545; border-radius: 3px; padding: 6mm 6mm 5mm; }
  .lh { text-align: center; color: #0b2545; font-size: 20px; font-weight: 900; letter-spacing: 0.04em; line-height: 1.1; }
  .lhSub { text-align: center; color: #6a7690; font-size: 7px; line-height: 1.45; }
  .title { text-align: center; color: #16305a; font-size: 10.5px; font-weight: 800; letter-spacing: 0.22em; margin: 5px 0 6px; border-top: 2px solid #0b2545; border-bottom: 2px solid #0b2545; padding: 5px 0; }
  .meta { display: flex; border: 1px solid #c9d2e2; border-radius: 3px; margin-bottom: 4px; overflow: hidden; }
  .meta > div { flex: 1; min-width: 0; padding: 4px 8px; font-size: 9.5px; font-weight: 800; color: #0b2545; border-left: 1px solid #c9d2e2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta > div:first-child { border-left: 0; }
  .meta > div span { display: block; font-size: 6.5px; font-weight: 800; color: #6a7690; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 1px; white-space: nowrap; }
  /* DELIVER TO — caption, party name, then the address as its own block. */
  .to { margin: 6px 0 7px; }
  .toCap { font-size: 6.5px; font-weight: 800; color: #6a7690; text-transform: uppercase; letter-spacing: 0.04em; }
  .toName { font-size: 11px; font-weight: 800; color: #0b2545; line-height: 1.25; margin-top: 1px; }
  .toAddr { font-size: 8.5px; color: #3a4560; line-height: 1.4; white-space: pre-line; margin-top: 1px; }
  .sect { font-size: 8.5px; font-weight: 800; color: #0b2545; text-transform: uppercase; letter-spacing: 0.05em; padding-bottom: 3px; border-bottom: 1.5px solid #0b2545; margin-bottom: 6px; }
  table { border-collapse: collapse; width: 100%; }
  th { background: #16305a; color: #fff; font-size: 7.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; padding: 4px 6px; text-align: left; }
  td { font-size: 9px; padding: 3px 6px; border-bottom: 1px solid #e6ebf3; }
  tr.alt td { background: #eef2fb; }
  .c { text-align: center; }
  .r { text-align: right; font-variant-numeric: tabular-nums; }
  .code { color: #6a7690; font-size: 7.5px; }
  .empty { text-align: center; color: #9aa6bd; padding: 8px; }
  tfoot td { background: #0b2545; color: #fff; font-weight: 800; font-size: 9.5px; border: 0; }
  .remark { font-size: 9px; color: #3a4560; margin-top: 5px; }
  .remark span { font-size: 6.5px; font-weight: 800; color: #6a7690; text-transform: uppercase; letter-spacing: 0.04em; margin-right: 6px; }
  /* margin-top:auto pins the signature line to the foot of its half — the slack in a
     short challan sits between the totals and the signature, where it reads as
     deliberate space for the receiver to sign. */
  .sign { display: flex; justify-content: space-between; margin-top: auto; padding-top: 10px; font-size: 9.5px; color: #1a2438; }
  .sign .right { color: #0b2545; font-weight: 800; }

  @media print {
    body { padding-top: 0; background: #fff; }
    .bar { display: none !important; }
    /* @page already reserves the 9mm margin, so the printed page box is 192 × 279mm.
       277mm leaves 2mm of rounding slack — an exact 279 can tip into a blank page.
       The extra 5mm each side matches the on-screen padding so the printed challan
       is inset from the paper edge instead of running into it. */
    .page { width: auto; height: 277mm; margin: 0; padding: 0 5mm; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .challan { page-break-inside: avoid; }
  }
</style></head>
<body>
  <div class="bar">
    <div>
      <strong>${list.length} delivery challan(s)</strong> · 2 per A4 page · ${pages.length} page${pages.length === 1 ? '' : 's'}
      <span style="color:#6a7690">— in the print dialog set <b>Scale 100%</b>, <b>Margins: Default</b>, <b>Headers and footers OFF</b> and <b>Background graphics ON</b>.</span>
    </div>
    <div><button onclick="window.print()">Print / Save PDF</button><button onclick="window.close()">Close</button></div>
  </div>
  ${pagesHtml}
  <script>setTimeout(function(){ try { window.focus(); } catch (e) {} }, 100);</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) {
    alert('Pop-up blocked. Please allow pop-ups so the challan print preview can open.');
    return false;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
