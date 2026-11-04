import PDFDocument from 'pdfkit';
import { PAGE, drawHeader, infoRows, totalsBlock, signature } from '../voucher/voucher.pdf.js';

/**
 * Advance Payment advice — one payment against a Proforma Invoice, with the
 * payments made before it and where the advance stands after it. Built only
 * from the records passed in (see advancePaymentService.getDetail); nothing is
 * hardcoded. Same header / signature block as the voucher and PI PDFs.
 */
const navy = '#0b2545';
const blue = '#1d4ed8';
const line = '#dbe4f3';
const INR = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const label = (s) => String(s || '—').replace(/_/g, ' ');

/** @param detail { payment, pi, po, previous: [payments before this one], mdApproval } */
export const buildAdvancePaymentPdfBuffer = (detail, company = {}) => new Promise((resolve, reject) => {
  try {
    const { payment: p, pi = {}, po = {}, previous = [], mdApproval = null } = detail;
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.m });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const W = PAGE.w - PAGE.m * 2;

    let y = drawHeader(doc, company, 'ADVANCE PAYMENT');
    const half = W / 2 - 8;
    const lY = infoRows(doc, PAGE.m, y, half, [
      ['Payment No', p.paymentNumber], ['Payment Date', fmtDate(p.paymentDate)],
      ['PO No', p.poNumber || po.poNumber], ['PI No', p.piNumber || pi.piNumber || 'Not applicable'],
      ['Indent No', p.indentNumber || po.indentNumber], ['Status', label(p.paymentStatus)],
    ]);
    const rY = infoRows(doc, PAGE.m + half + 16, y, half, [
      ['Vendor', p.vendorName || pi.vendorName], ['GSTIN', pi.vendorGST], ['Address', pi.vendorAddress],
      ['Mode', label(p.paymentMode)], ['Reference / UTR', p.paymentReferenceNumber], ['Bank', p.bankReference],
    ]);
    const boxH = Math.max(lY, rY) - y + 6;
    doc.roundedRect(PAGE.m, y, half, boxH, 6).stroke(line);
    doc.roundedRect(PAGE.m + half + 16, y, half, boxH, 6).stroke(line);
    y += boxH + 18;

    // Previous payments.
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text(`PREVIOUS PAYMENTS (${previous.length})`, PAGE.m, y); y += 12;
    const cols = [['Payment No', 0, 130, 'left'], ['Date', 130, 90, 'left'], ['Mode', 220, 110, 'left'], ['Reference', 330, 100, 'left'], ['Amount', 430, W - 430, 'right']];
    const head = () => {
      doc.rect(PAGE.m, y, W, 16).fill('#f5f8ff');
      doc.font('Helvetica-Bold').fontSize(8).fill(blue);
      cols.forEach(([t, x, w, align]) => doc.text(t, PAGE.m + x + 4, y + 4, { width: w - 8, align }));
      y += 20;
    };
    head();
    if (!previous.length) {
      doc.font('Helvetica').fontSize(8.5).fill('#94a3b8').text('No earlier payments against this advance.', PAGE.m + 4, y); y += 16;
    }
    previous.forEach((h) => {
      if (y + 16 > PAGE.h - 240) { doc.addPage(); y = PAGE.m; head(); }
      doc.font('Helvetica').fontSize(8.5).fill(navy);
      doc.text(h.paymentNumber || '—', PAGE.m + 4, y, { width: 122, lineBreak: false });
      doc.text(fmtDate(h.paymentDate), PAGE.m + 134, y, { width: 82, lineBreak: false });
      doc.text(label(h.paymentMode), PAGE.m + 224, y, { width: 102, lineBreak: false });
      doc.text(h.paymentReferenceNumber || '—', PAGE.m + 334, y, { width: 92, lineBreak: false });
      doc.text(INR(h.paidAmount), PAGE.m + 434, y, { width: W - 438, align: 'right', lineBreak: false });
      y += 15;
      doc.moveTo(PAGE.m, y - 2).lineTo(PAGE.m + W, y - 2).strokeColor(line).lineWidth(0.5).stroke();
    });
    y += 12;

    if (y > PAGE.h - 330) { doc.addPage(); y = PAGE.m; }
    const prevPaid = previous.reduce((s, h) => s + (h.paymentStatus === 'CANCELLED' ? 0 : Number(h.paidAmount) || 0), 0);
    const current = p.paymentStatus === 'CANCELLED' ? 0 : Number(p.paidAmount) || 0;
    y = totalsBlock(doc, y, [
      ['Advance Required (PI value)', INR(pi.totalValue)],
      ['Previously Paid', INR(prevPaid)],
      ['This Payment', INR(current)],
      ['Total Paid', INR(prevPaid + current)],
      ['Remaining Balance', INR(p.balanceAmount), true],
    ]);

    y += 12;
    doc.font('Helvetica').fontSize(8).fill(navy);
    doc.text(`PI approval: ${pi.approvalStatus ? label(pi.approvalStatus) : '—'}${pi.approvedBy ? ` by ${pi.approvedBy}` : ''}${pi.approvedAt ? ` on ${fmtDate(pi.approvedAt)}` : ''}`, PAGE.m, y, { width: W - 200 });
    y += 12;
    doc.text(`MD approval: ${mdApproval?.status ? label(mdApproval.status) : label(pi.mdApprovalStatus)}${mdApproval?.signedByName ? ` by ${mdApproval.signedByName}` : ''}${mdApproval?.signedAt ? ` on ${fmtDate(mdApproval.signedAt)}` : ''}`, PAGE.m, y, { width: W - 200 });
    y += 12;
    doc.text(`Recorded by: ${p.performedByName || '—'}`, PAGE.m, y, { width: W - 200 }); y += 14;
    if (p.remarks) {
      doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('REMARKS', PAGE.m, y); y += 11;
      doc.font('Helvetica').fontSize(8).fill(navy).text(p.remarks, PAGE.m, y, { width: W - 200 });
    }

    signature(doc, company, mdApproval?.status === 'APPROVED' ? mdApproval : null, 'This is a computer generated advance payment advice.');
    doc.end();
  } catch (err) { reject(err); }
});
