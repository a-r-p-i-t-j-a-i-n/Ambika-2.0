import PDFDocument from 'pdfkit';
import fs from 'fs';
import env from '../config/env.js';

// Shared drawing routine so the file and buffer generators stay identical.
const drawDeliveryChallan = (doc, dcData) => {
  // Header
  doc.fontSize(20).text(env.COMPANY_NAME || 'M/s Ambika Global', { align: 'center', underline: true });
  doc.fontSize(10).text(env.COMPANY_ADDRESS || '', { align: 'center' });
  doc.text(`Phone: ${env.COMPANY_PHONE || ''} | Email: ${env.COMPANY_EMAIL || ''}`, { align: 'center' });
  doc.moveDown();

  doc.fontSize(16).text('DELIVERY CHALLAN', { align: 'center', underline: true });
  doc.moveDown();

  // DC details
  doc.fontSize(11);
  doc.text(`DC No: ${dcData.dcNumber || '-'}`, { continued: true });
  doc.text(`Date: ${dcData.dcDate ? new Date(dcData.dcDate).toLocaleDateString('en-IN') : '-'}`, { align: 'right' });
  doc.text(`SO No: ${dcData.soNumber || '-'}`, { continued: true });
  doc.text(`PO No: ${dcData.poNumber || '-'}`, { align: 'right' });
  if (dcData.vehicleNo || dcData.transporterName) {
    doc.text(`Vehicle: ${dcData.vehicleNo || '-'}`, { continued: true });
    doc.text(`Transporter: ${dcData.transporterName || '-'}`, { align: 'right' });
  }
  doc.moveDown();

  // Party
  doc.font('Helvetica-Bold').text('Bill To:', { underline: true });
  doc.font('Helvetica').text(dcData.partyName || '');
  if (dcData.deliveryAddress) doc.text(dcData.deliveryAddress);
  doc.moveDown();

  // Table header
  const tableTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text('Sr.', 50, tableTop);
  doc.text('SKU Description', 80, tableTop);
  doc.text('Qty (Pcs)', 350, tableTop, { width: 60, align: 'right' });
  doc.text('Boxes', 420, tableTop, { width: 60, align: 'right' });
  doc.text('Weight (Kg)', 490, tableTop, { width: 60, align: 'right' });
  doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

  // Rows
  doc.font('Helvetica');
  let rowY = tableTop + 25;
  (dcData.items || []).forEach((item, index) => {
    doc.text(index + 1, 50, rowY);
    doc.text(`${item.skuName || ''}${item.skuCode ? ` (${item.skuCode})` : ''}`, 80, rowY, { width: 260 });
    doc.text(item.quantityPcs ?? 0, 350, rowY, { width: 60, align: 'right' });
    doc.text(item.noOfBoxes ?? 0, 420, rowY, { width: 60, align: 'right' });
    doc.text(Number(item.weightKg || 0).toFixed(2), 490, rowY, { width: 60, align: 'right' });
    rowY += 20;
  });

  doc.moveTo(50, rowY).lineTo(550, rowY).stroke();
  rowY += 10;

  // Totals
  doc.font('Helvetica-Bold');
  doc.text('TOTAL', 80, rowY);
  doc.text(dcData.totalQuantityPcs ?? 0, 350, rowY, { width: 60, align: 'right' });
  doc.text(dcData.totalBoxes ?? 0, 420, rowY, { width: 60, align: 'right' });
  doc.text(Number(dcData.totalWeightKg || 0).toFixed(2), 490, rowY, { width: 60, align: 'right' });

  if (dcData.remark) { doc.moveDown(2); doc.font('Helvetica').fontSize(9).text(`Remarks: ${dcData.remark}`, 50); }

  // Footer
  doc.moveDown(4);
  doc.font('Helvetica').fontSize(10);
  doc.text("Receiver's Signature", 50, doc.y, { continued: true });
  doc.text(`For ${env.COMPANY_NAME || 'M/s Ambika Global'}`, { align: 'right' });
};

export const pdfService = {
  /** Write the challan PDF to a path (legacy). */
  async generateDeliveryChallan(dcData, outputPath) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      drawDeliveryChallan(doc, dcData);
      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    });
  },

  /** Generate the challan PDF as an in-memory Buffer (for S3 upload). */
  async generateDeliveryChallanBuffer(dcData) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      drawDeliveryChallan(doc, dcData);
      doc.end();
    });
  },
};
