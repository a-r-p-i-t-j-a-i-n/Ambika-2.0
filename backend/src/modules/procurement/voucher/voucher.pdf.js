import PDFDocument from 'pdfkit';
import env from '../../../config/env.js';
import { EXPENSE_TYPE, expenseTypeOf } from './voucher.model.js';

export const PAGE = { w: 595.28, h: 841.89, m: 40 };
const navy = '#0b2545';
const blue = '#1d4ed8';
const line = '#dbe4f3';
const INR = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// Shared header band + return the starting Y for body content.
export const drawHeader = (doc, company, title) => {
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
export const infoRows = (doc, x, yStart, w, rows) => {
  let y = yStart + 10;
  rows.forEach(([label, value]) => {
    doc.font('Helvetica').fontSize(8.5).fill('#475a8a').text(`${label}:`, x + 10, y, { width: 90, lineBreak: false });
    doc.fill(navy).text(value || '—', x + 100, y, { width: w - 110 });
    // Long values (e.g. several GRN numbers) wrap — advance past the wrapped height.
    y += Math.max(14, doc.heightOfString(value || '—', { width: w - 110 }) + 3);
  });
  return y;
};

export const totalsBlock = (doc, yStart, rows) => {
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

export const signature = (doc, company, mdSig, footer = 'This is a computer generated voucher.') => {
  // This block is bottom-anchored via absolute PAGE.h-relative coordinates —
  // it's deliberately positioned to fit within the physical page. PDFKit's
  // auto-page-break checks against the MARGIN-constrained maxY (page height
  // minus bottom margin) rather than the true page height, so text this close
  // to the bottom silently overflowed onto a spurious, near-empty second page.
  // Zeroing the bottom margin for this trailing block gives PDFKit the full
  // physical page to check against; genuinely long content above (remarks,
  // long item tables) still paginates normally since it's drawn before this
  // margin change and flows against the normal margin.
  doc.page.margins.bottom = 0;
  const W = PAGE.w - PAGE.m * 2;
  doc.font('Helvetica-Bold').fontSize(9).fill(navy)
    .text(`For ${company.name || env.COMPANY_NAME}`, PAGE.m + W - 180, PAGE.h - 110, { width: 180, align: 'center' });
  doc.font('Helvetica').fontSize(8).text('Authorized Signatory', PAGE.m + W - 180, PAGE.h - 60, { width: 180, align: 'center' });
  doc.font('Helvetica').fontSize(7.5).fill('#475a8a')
    .text(footer, PAGE.m, PAGE.h - 48, { width: W, align: 'center' });

  // ── MD Approval block (Digital Approval & Signature engine) — always
  // rendered (left column) so the unsigned PDF shows exactly where the
  // signature will land; a signature image fills the placeholder once signed.
  const ax = PAGE.m;
  const ay = PAGE.h - 150;
  doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('APPROVED BY (MD)', ax, ay);
  if (mdSig?.imageBuffer) {
    doc.image(mdSig.imageBuffer, ax, ay + 14, { width: 140, height: 50, fit: [140, 50] });
  } else {
    doc.roundedRect(ax, ay + 14, 140, 50, 4).dash(3, { space: 2 }).stroke(line).undash();
    doc.font('Helvetica').fontSize(7).fill('#94a3b8').text('Signature will appear here', ax + 8, ay + 34, { width: 124 });
  }
  doc.font('Helvetica-Bold').fontSize(9).fill(navy).text(mdSig?.signedByName || '—', ax, ay + 70);
  doc.font('Helvetica').fontSize(8).fill('#475a8a').text(mdSig?.designation || 'Managing Director', ax, ay + 83);
  if (mdSig?.signedAt) {
    const t = new Date(mdSig.signedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    doc.font('Helvetica').fontSize(7.5).fill('#475a8a').text(`${fmtDate(mdSig.signedAt)} · ${t}`, ax, ay + 95);
  }
};

// ── Purchase Voucher (AGL/PUR) ──
export const buildPurchaseVoucherPdfBuffer = (v, company = {}, mdSig = null) => new Promise((resolve, reject) => {
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
      ['Invoice No', v.invoiceNumber], ['PO No', v.poNumber],
      ['GRN No', (v.grnNumbers || []).join(', ')], ['Payment Terms', v.paymentTerms],
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
    signature(doc, company, mdSig);
    doc.end();
  } catch (err) { reject(err); }
});

// ── Expense Voucher (AGL/EXP) ──
export const buildExpenseVoucherPdfBuffer = (v, company = {}, mdSig = null) => new Promise((resolve, reject) => {
  try {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.m });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const W = PAGE.w - PAGE.m * 2;

    let y = drawHeader(doc, company, 'EXPENSE VOUCHER');
    const half = W / 2 - 8;
    const leftRows = [
      ['Voucher No', v.voucherNumber], ['Voucher Date', fmtDate(v.voucherDate)],
      ['Expense Category', v.expenseCategory], ['Party Name', v.partyName || v.vendorName],
    ];
    if (v.vendorId) leftRows.push(['Vendor (Master)', v.vendorName]);
    const lY = infoRows(doc, PAGE.m, y, half, leftRows);
    const expenseType = expenseTypeOf(v);
    const rY = infoRows(doc, PAGE.m + half + 16, y, half, [
      ...(expenseType === EXPENSE_TYPE.AGAINST_PO
        ? [['Reference', 'Expense Against PO — Without GRN'], ['PO No', v.poNumber]]
        : expenseType === EXPENSE_TYPE.AGAINST_GRN
          ? [['Reference', 'Expense Against GRN — Without PO'], ['GRN No', (v.grnNumbers || []).join(', ')]]
          : [['Reference', 'Direct Bill — Without PO / GRN']]),
      ['Vendor Bill No', v.expenseInvoiceNo], ['Bill Date', fmtDate(v.expenseInvoiceDate)],
      ['Payment Terms', v.paymentTerms], ['Due Date', fmtDate(v.dueDate)],
    ]);
    const boxH = Math.max(lY, rY) - y + 6;
    doc.roundedRect(PAGE.m, y, half, boxH, 6).stroke(line);
    doc.roundedRect(PAGE.m + half + 16, y, half, boxH, 6).stroke(line);
    y += boxH + 24;

    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('AMOUNT DETAILS', PAGE.m, y); y += 6;
    const taxRows = v.gstRatePercent
      ? [['Taxable Amount', INR(v.taxableAmount)], [`GST @ ${v.gstRatePercent}%`, INR(v.taxAmount)]]
      : [['Tax Amount', INR(v.taxAmount)]];
    y = totalsBlock(doc, y + 8, [
      ['Basic Value', INR(v.basicValue)],
      ['Freight Charges', INR(v.freightCharges)],
      ['Packing & Forwarding', INR(v.packingForwardingCharges)],
      ['Other Charges', INR(v.otherCharges)],
      ...taxRows,
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
    signature(doc, company, mdSig);
    doc.end();
  } catch (err) { reject(err); }
});

// Dispatch by voucher type.
export const buildVoucherPdfBuffer = (v, company = {}, mdSig = null) => (
  v?.voucherType === 'EXPENSE' ? buildExpenseVoucherPdfBuffer(v, company, mdSig) : buildPurchaseVoucherPdfBuffer(v, company, mdSig)
);
