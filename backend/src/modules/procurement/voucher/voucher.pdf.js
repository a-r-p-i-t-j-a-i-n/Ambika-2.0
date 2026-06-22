import PDFDocument from 'pdfkit';
import env from '../../../config/env.js';

const PAGE = { w: 595.28, h: 841.89, m: 40 };
const navy = '#0b2545';
const blue = '#1d4ed8';
const line = '#dbe4f3';
const INR = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// Shared header band + return the starting Y for body content.
const drawHeader = (doc, company, title) => {
  const W = PAGE.w - PAGE.m * 2;
  doc.rect(0, 0, PAGE.w, 86).fill(navy);
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(18).text(company.name || env.COMPANY_NAME, PAGE.m, 18);
  doc.font('Helvetica').fontSize(8.5).fill('#cdd9f0');
  const bits = [company.address || env.COMPANY_ADDRESS, company.gstin ? `GSTIN: ${company.gstin}` : '', company.email || env.COMPANY_EMAIL, company.phone || env.COMPANY_PHONE]
    .filter(Boolean).join('   •   ');
  doc.text(bits || ' ', PAGE.m, 44, { width: W - 150 });
  doc.font('Helvetica-Bold').fontSize(14).fill('#ffffff').text(title, PAGE.m, 40, { width: W, align: 'right' });
  return 104;
};

// Two-column key/value info box.
const infoRows = (doc, x, yStart, w, rows) => {
  let y = yStart + 10;
  rows.forEach(([label, value]) => {
    doc.font('Helvetica').fontSize(8.5).fill('#475a8a').text(`${label}:`, x + 10, y, { width: 90, lineBreak: false });
    doc.fill(navy).text(value || '—', x + 100, y, { width: w - 110 });
    y += 14;
  });
  return y;
};

const totalsBlock = (doc, yStart, rows) => {
  const W = PAGE.w - PAGE.m * 2;
  let y = yStart;
  const totX = PAGE.m + W - 240;
  rows.forEach(([label, value, bold]) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 9).fill(navy);
    doc.text(label, totX, y, { width: 150, align: 'right' });
    doc.text(value, totX + 154, y, { width: 86, align: 'right' });
    if (bold) { doc.moveTo(totX, y - 4).lineTo(PAGE.m + W, y - 4).strokeColor(navy).lineWidth(1).stroke(); }
    y += bold ? 20 : 15;
  });
  return y;
};

const signature = (doc, company) => {
  const W = PAGE.w - PAGE.m * 2;
  doc.font('Helvetica-Bold').fontSize(9).fill(navy)
    .text(`For ${company.name || env.COMPANY_NAME}`, PAGE.m + W - 180, PAGE.h - 110, { width: 180, align: 'center' });
  doc.font('Helvetica').fontSize(8).text('Authorized Signatory', PAGE.m + W - 180, PAGE.h - 60, { width: 180, align: 'center' });
  doc.font('Helvetica').fontSize(7.5).fill('#475a8a')
    .text('This is a computer generated voucher.', PAGE.m, PAGE.h - 48, { width: W, align: 'center' });
};

// ── Purchase Voucher (AGL/PUR) ──
export const buildPurchaseVoucherPdfBuffer = (v, company = {}) => new Promise((resolve, reject) => {
  try {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.m });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const W = PAGE.w - PAGE.m * 2;

    let y = drawHeader(doc, company, 'PURCHASE VOUCHER');
    const half = W / 2 - 8;
    const lY = infoRows(doc, PAGE.m, y, half, [
      ['Voucher No', v.voucherNumber], ['Voucher Date', fmtDate(v.voucherDate)],
      ['Invoice No', v.invoiceNumber], ['PO No', v.poNumber], ['Payment Terms', v.paymentTerms],
    ]);
    const rY = infoRows(doc, PAGE.m + half + 16, y, half, [
      ['Vendor', v.vendorName], ['Due Date', fmtDate(v.dueDate)],
    ]);
    const boxH = Math.max(lY, rY) - y + 6;
    doc.roundedRect(PAGE.m, y, half, boxH, 6).stroke(line);
    doc.roundedRect(PAGE.m + half + 16, y, half, boxH, 6).stroke(line);
    y += boxH + 24;

    y = totalsBlock(doc, y, [
      ['Invoice Amount', INR(v.invoiceAmount)],
      ['Less Advance Paid', INR(v.advancePaid)],
      ['Less Debit Note', INR(v.debitNoteAmount)],
      ['Total Amount Payable', INR(v.netPayableAmount), true],
    ]);

    if (v.remarks) {
      y += 16;
      doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('REMARKS', PAGE.m, y); y += 12;
      doc.font('Helvetica').fontSize(8).fill(navy).text(v.remarks, PAGE.m, y, { width: W - 200 });
    }
    signature(doc, company);
    doc.end();
  } catch (err) { reject(err); }
});

// ── Expense Voucher (AGL/EXP) ──
export const buildExpenseVoucherPdfBuffer = (v, company = {}) => new Promise((resolve, reject) => {
  try {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.m });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const W = PAGE.w - PAGE.m * 2;

    let y = drawHeader(doc, company, 'EXPENSE VOUCHER');
    const half = W / 2 - 8;
    const lY = infoRows(doc, PAGE.m, y, half, [
      ['Voucher No', v.voucherNumber], ['Voucher Date', fmtDate(v.voucherDate)],
      ['Expense Category', v.expenseCategory], ['Party Name', v.partyName || v.vendorName],
    ]);
    const rY = infoRows(doc, PAGE.m + half + 16, y, half, [
      ['Invoice No', v.expenseInvoiceNo], ['Invoice Date', fmtDate(v.expenseInvoiceDate)],
      ['Payment Terms', v.paymentTerms], ['Due Date', fmtDate(v.dueDate)],
    ]);
    const boxH = Math.max(lY, rY) - y + 6;
    doc.roundedRect(PAGE.m, y, half, boxH, 6).stroke(line);
    doc.roundedRect(PAGE.m + half + 16, y, half, boxH, 6).stroke(line);
    y += boxH + 24;

    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('AMOUNT DETAILS', PAGE.m, y); y += 6;
    y = totalsBlock(doc, y + 8, [
      ['Basic Value', INR(v.basicValue)],
      ['Freight Charges', INR(v.freightCharges)],
      ['Packing & Forwarding', INR(v.packingForwardingCharges)],
      ['Other Charges', INR(v.otherCharges)],
      ['Tax Amount', INR(v.taxAmount)],
      ['Add TCS', INR(v.tcsAmount)],
      ['Less TDS', INR(v.tdsAmount)],
      ['Less Advance Payment', INR(v.advanceAmount)],
      ['Total Amount Payable', INR(v.totalAmountPayable), true],
    ]);

    y += 14;
    if (v.otherReason) { doc.font('Helvetica').fontSize(8).fill(navy).text(`Other: ${v.otherReason}`, PAGE.m, y, { width: W - 200 }); y += 14; }
    if (v.preparedBy) { doc.font('Helvetica').fontSize(8).fill(navy).text(`Prepared By: ${v.preparedBy}`, PAGE.m, y, { width: W - 200 }); y += 14; }
    if (v.remarks) {
      doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('REMARKS', PAGE.m, y); y += 12;
      doc.font('Helvetica').fontSize(8).fill(navy).text(v.remarks, PAGE.m, y, { width: W - 200 });
    }
    signature(doc, company);
    doc.end();
  } catch (err) { reject(err); }
});

// Dispatch by voucher type.
export const buildVoucherPdfBuffer = (v, company = {}) => (
  v?.voucherType === 'EXPENSE' ? buildExpenseVoucherPdfBuffer(v, company) : buildPurchaseVoucherPdfBuffer(v, company)
);
