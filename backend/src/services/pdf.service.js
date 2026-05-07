import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import env from '../config/env.js';

export const pdfService = {
  async generateDeliveryChallan(dcData, outputPath) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);

      doc.pipe(stream);

      // Header
      doc.fontSize(20).text(env.COMPANY_NAME, { align: 'center', underline: true });
      doc.fontSize(10).text(env.COMPANY_ADDRESS, { align: 'center' });
      doc.text(`Phone: ${env.COMPANY_PHONE} | Email: ${env.COMPANY_EMAIL}`, { align: 'center' });
      doc.moveDown();

      doc.fontSize(16).text('DELIVERY CHALLAN', { align: 'center', underline: true });
      doc.moveDown();

      // DC Details
      doc.fontSize(12);
      doc.text(`DC No: ${dcData.dcNumber}`, { continued: true });
      doc.text(`Date: ${new Date(dcData.dcDate).toLocaleDateString()}`, { align: 'right' });
      doc.text(`SO No: ${dcData.soNumber}`, { continued: true });
      doc.text(`PO No: ${dcData.poNumber || '-'}`, { align: 'right' });
      doc.moveDown();

      // Party Details
      doc.text('Bill To:', { underline: true });
      doc.text(dcData.partyName);
      doc.text(dcData.deliveryAddress || '');
      doc.moveDown();

      // Table Header
      const tableTop = doc.y;
      doc.fontSize(10);
      doc.text('Sr.', 50, tableTop);
      doc.text('SKU Description', 80, tableTop);
      doc.text('Qty (Pcs)', 350, tableTop, { width: 60, align: 'right' });
      doc.text('Boxes', 420, tableTop, { width: 60, align: 'right' });
      doc.text('Weight (Kg)', 490, tableTop, { width: 60, align: 'right' });
      
      doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

      // Table Rows
      let rowY = tableTop + 25;
      dcData.items.forEach((item, index) => {
        doc.text(index + 1, 50, rowY);
        doc.text(item.skuName, 80, rowY);
        doc.text(item.quantityPcs, 350, rowY, { width: 60, align: 'right' });
        doc.text(item.noOfBoxes, 420, rowY, { width: 60, align: 'right' });
        doc.text(item.weightKg.toFixed(2), 490, rowY, { width: 60, align: 'right' });
        rowY += 20;
      });

      doc.moveTo(50, rowY).lineTo(550, rowY).stroke();
      rowY += 10;

      // Totals
      doc.font('Helvetica-Bold');
      doc.text('TOTAL', 80, rowY);
      doc.text(dcData.totalQuantityPcs, 350, rowY, { width: 60, align: 'right' });
      doc.text(dcData.totalBoxes, 420, rowY, { width: 60, align: 'right' });
      doc.text(dcData.totalWeightKg.toFixed(2), 490, rowY, { width: 60, align: 'right' });

      // Footer
      doc.moveDown(4);
      doc.font('Helvetica');
      doc.text('Receiver\'s Signature', 50, doc.y, { continued: true });
      doc.text(`For ${env.COMPANY_NAME}`, { align: 'right' });

      doc.end();

      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    });
  },
};
