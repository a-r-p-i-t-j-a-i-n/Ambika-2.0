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

// ── Dispatch Plan ────────────────────────────────────────────────────────────
const planNum = (n) => Number(n || 0).toLocaleString('en-IN');
const planDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const phaseSort = (p) => parseInt(String(p ?? '').replace(/\D/g, ''), 10) || 0;

// Draws the dispatch plan. `data` is the getSchedule() shape: { order, items }.
const drawDispatchPlan = (doc, data) => {
  const order = data.order || data;
  const items = data.items || [];
  const L = 50, R = 545; // page content bounds

  // Letterhead
  doc.font('Helvetica-Bold').fontSize(20).text(env.COMPANY_NAME || 'M/s Ambika Global', { align: 'center' });
  doc.font('Helvetica').fontSize(9);
  if (env.COMPANY_ADDRESS) doc.text(env.COMPANY_ADDRESS, { align: 'center' });
  doc.text(`Phone: ${env.COMPANY_PHONE || '-'} | Email: ${env.COMPANY_EMAIL || '-'}`, { align: 'center' });
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(15).text('DISPATCH PLAN', { align: 'center', underline: true });
  doc.moveDown(0.8);

  // Meta
  doc.font('Helvetica').fontSize(10);
  doc.text(`Party: ${order.partyName || '-'}`, L, doc.y, { continued: true });
  doc.text(`Date: ${planDate(new Date())}`, { align: 'right' });
  doc.text(`SO No: ${order.soNumber || '-'}`, L, doc.y, { continued: true });
  doc.text(`PO No: ${order.poNumber || '-'}`, { align: 'right' });
  doc.moveDown(0.8);

  // Group every SKU phase by phase number.
  const phaseMap = new Map();
  items.forEach((it) => (it.phases || []).forEach((ph) => {
    const g = phaseMap.get(ph.phaseNo) || { phaseNo: ph.phaseNo, date: ph.plannedDate, rows: [], total: 0 };
    if (ph.plannedDate && (!g.date || new Date(ph.plannedDate) < new Date(g.date))) g.date = ph.plannedDate;
    g.rows.push({ skuCode: it.skuCode, skuName: it.skuName, qty: ph.plannedQty, status: ph.status });
    g.total += Number(ph.plannedQty || 0);
    phaseMap.set(ph.phaseNo, g);
  }));
  const phases = [...phaseMap.values()].sort((a, b) => phaseSort(a.phaseNo) - phaseSort(b.phaseNo));

  // Column layout for the plan table.
  const cols = { ph: L, date: 95, sku: 190, qty: 400, status: 470 };
  const drawHeadRow = (y) => {
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('PHASE', cols.ph, y);
    doc.text('PLANNED DATE', cols.date, y);
    doc.text('SKU', cols.sku, y);
    doc.text('QTY', cols.qty, y, { width: 60, align: 'right' });
    doc.text('STATUS', cols.status, y);
    doc.moveTo(L, y + 13).lineTo(R, y + 13).stroke();
  };

  let y = doc.y;
  drawHeadRow(y);
  y += 20;
  let grand = 0;
  doc.font('Helvetica').fontSize(9.5);
  phases.forEach((p) => {
    grand += p.total;
    p.rows.forEach((r, idx) => {
      if (y > 760) { doc.addPage(); y = 60; drawHeadRow(y); y += 20; doc.font('Helvetica').fontSize(9.5); }
      doc.text(idx === 0 ? String(p.phaseNo) : '', cols.ph, y);
      doc.text(idx === 0 ? planDate(p.date) : '', cols.date, y);
      doc.text(`${r.skuName || ''}${r.skuCode ? ` (${r.skuCode})` : ''}`, cols.sku, y, { width: cols.qty - cols.sku - 8 });
      doc.text(planNum(r.qty), cols.qty, y, { width: 60, align: 'right' });
      doc.text(String(r.status || 'Planned'), cols.status, y, { width: R - cols.status });
      y += 18;
    });
    // Phase subtotal
    doc.font('Helvetica-Bold').fontSize(9);
    doc.moveTo(L, y - 3).lineTo(R, y - 3).stroke();
    doc.text(`Phase ${p.phaseNo} total`, cols.sku, y);
    doc.text(planNum(p.total), cols.qty, y, { width: 60, align: 'right' });
    doc.font('Helvetica').fontSize(9.5);
    y += 22;
  });
  if (!phases.length) { doc.font('Helvetica-Oblique').fontSize(10).text('No planned phases in this dispatch schedule.', L, y); y += 20; }

  // Grand total
  doc.moveTo(L, y).lineTo(R, y).stroke();
  y += 8;
  doc.font('Helvetica-Bold').fontSize(11);
  doc.text('Total Planned Quantity', cols.sku, y);
  doc.text(`${planNum(grand)} pcs`, cols.qty, y, { width: 100, align: 'right' });

  // Footer
  doc.font('Helvetica').fontSize(8).fillColor('#666')
    .text(`Generated by ${env.COMPANY_NAME || 'Ambika Global'} on ${planDate(new Date())} · Dispatch Planning Execution System`, L, 800, { align: 'center', width: R - L });
  doc.fillColor('#000');
};

export const pdfService = {
  /** Generate the dispatch-plan PDF as an in-memory Buffer (for email attach). */
  async generateDispatchPlanBuffer(scheduleData) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      drawDispatchPlan(doc, scheduleData || {});
      doc.end();
    });
  },

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
