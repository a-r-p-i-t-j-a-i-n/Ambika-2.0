import PDFDocument from 'pdfkit';
import { PAGE, drawHeader, infoRows, totalsBlock, signature } from '../voucher/voucher.pdf.js';

/**
 * Advance Payment Approval sheet for a Proforma Invoice — the document the MD
 * signs (Digital Approval engine, documentType PROFORMA_INVOICE) before any
 * advance is paid against the PI. Same header / signature block as the voucher
 * PDFs; the vendor's own uploaded PI document stays untouched (piDocument).
 */
const navy = '#0b2545';
const blue = '#1d4ed8';
const line = '#dbe4f3';
const INR = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export const buildPiApprovalPdfBuffer = (pi, company = {}, mdSig = null) => new Promise((resolve, reject) => {
  try {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.m });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const W = PAGE.w - PAGE.m * 2;

    let y = drawHeader(doc, company, 'ADVANCE PAYMENT APPROVAL');
    const half = W / 2 - 8;
    const lY = infoRows(doc, PAGE.m, y, half, [
      ['PI No', pi.piNumber], ['PI Date', fmtDate(pi.piDate)],
      ['PO No', pi.poNumber], ['Indent No', pi.indentNumber],
    ]);
    const rY = infoRows(doc, PAGE.m + half + 16, y, half, [
      ['Vendor', pi.vendorName], ['GSTIN', pi.vendorGST], ['PI Approved', fmtDate(pi.approvedAt)],
    ]);
    const boxH = Math.max(lY, rY) - y + 6;
    doc.roundedRect(PAGE.m, y, half, boxH, 6).stroke(line);
    doc.roundedRect(PAGE.m + half + 16, y, half, boxH, 6).stroke(line);
    y += boxH + 20;

    // Lines.
    const cols = [
      ['Item', 0, W - 300, 'left'], ['Qty', W - 300, 70, 'right'], ['Rate', W - 230, 70, 'right'],
      ['GST %', W - 160, 50, 'right'], ['Amount', W - 110, 110, 'right'],
    ];
    const head = () => {
      doc.rect(PAGE.m, y, W, 18).fill('#f5f8ff');
      doc.font('Helvetica-Bold').fontSize(8).fill(blue);
      cols.forEach(([t, x, w, align]) => doc.text(t, PAGE.m + x + 4, y + 5, { width: w - 8, align }));
      y += 22;
    };
    head();
    (pi.items || []).forEach((it) => {
      const h = Math.max(14, doc.font('Helvetica').fontSize(8.5).heightOfString(it.itemName || '—', { width: W - 308 }) + 4);
      if (y + h > PAGE.h - 230) { doc.addPage(); y = PAGE.m; head(); }
      doc.font('Helvetica').fontSize(8.5).fill(navy);
      doc.text(it.itemName || '—', PAGE.m + 4, y, { width: W - 308 });
      doc.text(`${it.quantity ?? 0} ${it.unit || ''}`.trim(), PAGE.m + W - 296, y, { width: 62, align: 'right' });
      doc.text(INR(it.rate), PAGE.m + W - 226, y, { width: 62, align: 'right' });
      doc.text(`${it.gstRate ?? 0}%`, PAGE.m + W - 156, y, { width: 42, align: 'right' });
      doc.text(INR(it.lineAmount), PAGE.m + W - 106, y, { width: 102, align: 'right' });
      y += h;
      doc.moveTo(PAGE.m, y - 2).lineTo(PAGE.m + W, y - 2).strokeColor(line).lineWidth(0.5).stroke();
    });
    y += 14;

    totalsBlock(doc, y, [
      ['PI Total (incl. GST)', INR(pi.totalValue)],
      ['Advance Already Paid', INR(pi.paidAmount)],
      ['Balance Payable', INR(pi.balanceAmount), true],
    ]);

    signature(doc, company, mdSig, 'Advance payment against this PI is released only after MD approval.');
    doc.end();
  } catch (err) { reject(err); }
});
