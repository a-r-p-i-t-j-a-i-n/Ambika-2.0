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
    doc.text(`${item.skuName || item.skuCode || ''}`, 80, rowY, { width: 260 });
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

// ── Dispatch Plan ("By Date" client copy) ────────────────────────────────────
const planNum = (n) => Number(n || 0).toLocaleString('en-IN');
const planDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const planDateKey = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'UNSCHEDULED');

const NAVY = '#0b2545';
const NAVY2 = '#16305a';
const SOFT = '#eef2fb';
const LINE = '#c9d2e2';
const INK = '#1a2438';
const MUTED = '#6a7690';

const companyName = () => {
  const raw = env.COMPANY_NAME || 'Ambika Global';
  return /^m\/s/i.test(raw) ? raw : `M/s ${raw}`;
};

/**
 * Draws the "By Date" dispatch plan — a TRANSPOSED grid: dispatch dates run down
 * the rows, every SKU is a column across the top. This is the CLIENT copy, so it
 * shows item NAMES only (no SKU codes). Matches the on-screen client PDF.
 * `data` is the DispatchSchedule shape: { partyName, soNumber, poNumber, items }.
 */
const drawDispatchPlan = (doc, data) => {
  const order = data.order || data;
  const items = data.items || [];
  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;
  const bottom = doc.page.height - doc.page.margins.bottom;

  // ── Letterhead (centred, double rule) ──
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(22).text(companyName(), L, doc.page.margins.top, { align: 'center', width: W });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5);
  if (env.COMPANY_ADDRESS) doc.text(env.COMPANY_ADDRESS, L, doc.y, { align: 'center', width: W });
  doc.text(`Phone: ${env.COMPANY_PHONE || '-'}  |  Email: ${env.COMPANY_EMAIL || '-'}`, L, doc.y, { align: 'center', width: W });
  let y = doc.y + 6;
  doc.lineWidth(1.5).strokeColor(NAVY).moveTo(L, y).lineTo(R, y).stroke();
  doc.lineWidth(0.6).moveTo(L, y + 3).lineTo(R, y + 3).stroke();
  doc.lineWidth(1);
  y += 15;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(14).text('DISPATCH PLAN', L, y, { align: 'center', width: W, characterSpacing: 3 });
  y = doc.y + 12;

  // ── Meta band (Party | Sales Order | PO No | Plan Date) ──
  const metaH = 32;
  const metaW = W / 4;
  const metaCells = [
    ['PARTY', order.partyName || '-'],
    ['SALES ORDER', order.soNumber || '-'],
    ['PO NO', order.poNumber || '-'],
    ['PLAN DATE', planDate(new Date())],
  ];
  doc.rect(L, y, W, metaH).strokeColor(LINE).lineWidth(1).stroke();
  metaCells.forEach(([k, v], i) => {
    const cx = L + i * metaW;
    if (i > 0) doc.strokeColor(LINE).moveTo(cx, y).lineTo(cx, y + metaH).stroke();
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6.5).text(String(k), cx + 7, y + 6, { width: metaW - 12 });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text(String(v), cx + 7, y + 15, { width: metaW - 12, height: 12, ellipsis: true });
  });
  y += metaH + 14;

  // ── Intro + section title ──
  doc.fillColor('#3a4560').font('Helvetica').fontSize(9)
    .text('We plan to dispatch your order as per the item-wise schedule below. Each dispatch date is shown as a row against every item.', L, y, { width: W });
  y = doc.y + 10;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('PLANNED DISPATCH SCHEDULE (BY DATE)', L, y, { characterSpacing: 0.5 });
  y = doc.y + 3;
  doc.lineWidth(1.5).strokeColor(NAVY).moveTo(L, y).lineTo(R, y).stroke();
  doc.lineWidth(1);
  y += 8;

  // ── Build the transposed model: columns = dispatch dates, rows = SKUs ──
  const colMap = new Map();
  items.forEach((it) => (it.phases || []).forEach((ph) => {
    const key = planDateKey(ph.plannedDate);
    const c = colMap.get(key) || { key, date: ph.plannedDate || null };
    if (!c.date && ph.plannedDate) c.date = ph.plannedDate;
    colMap.set(key, c);
  }));
  const columns = [...colMap.values()].sort((a, b) => {
    if (a.key === 'UNSCHEDULED') return 1;
    if (b.key === 'UNSCHEDULED') return -1;
    return new Date(a.date) - new Date(b.date);
  });
  let dn = 0;
  columns.forEach((c) => { c.label = c.key === 'UNSCHEDULED' ? 'Unscheduled' : `Dispatch ${(dn += 1)}`; });

  const rows = items.map((it) => {
    const byCol = {};
    let itemTotal = 0;
    (it.phases || []).forEach((ph) => {
      const key = planDateKey(ph.plannedDate);
      byCol[key] = (byCol[key] || 0) + Number(ph.plannedQty || 0);
      itemTotal += Number(ph.plannedQty || 0);
    });
    return { name: it.skuName || it.skuCode || '', byCol, itemTotal };
  });
  const colTotal = (key) => rows.reduce((s, r) => s + (r.byCol[key] || 0), 0);
  const grand = rows.reduce((s, r) => s + r.itemTotal, 0);

  if (!columns.length || !rows.length) {
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(10).text('No planned dispatches in this schedule yet.', L, y, { width: W });
    doc.fillColor('#000');
    return;
  }

  // ── Table geometry ──
  const dateW = 92;
  const totalW = 64;
  const skuCount = rows.length;
  const skuW = (W - dateW - totalW) / skuCount;
  const colX = (i) => L + dateW + i * skuW; // left x of SKU column i
  const totalX = L + dateW + skuCount * skuW;

  // Header height fits the longest wrapped SKU name.
  doc.font('Helvetica-Bold').fontSize(7.5);
  let nameH = 8;
  rows.forEach((r) => { nameH = Math.max(nameH, doc.heightOfString(r.name, { width: skuW - 8, align: 'center' })); });
  const headH = Math.max(24, nameH + 12);
  const rowH = 26;
  const footH = 22;

  const drawHead = (yy) => {
    doc.rect(L, yy, W, headH).fill(NAVY2);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7.5);
    doc.text('DISPATCH DATE', L + 6, yy + (headH - 8) / 2, { width: dateW - 10 });
    rows.forEach((r, i) => doc.text(r.name, colX(i) + 4, yy + 6, { width: skuW - 8, align: 'center' }));
    doc.text('TOTAL PER DATE', totalX + 4, yy + (headH - 16) / 2, { width: totalW - 8, align: 'center' });
    doc.fillColor(INK);
    return yy + headH;
  };

  // Vertical grid lines for one row band.
  const drawVerticals = (yy, h) => {
    doc.strokeColor(LINE).lineWidth(0.7);
    doc.moveTo(L + dateW, yy).lineTo(L + dateW, yy + h).stroke();
    for (let i = 1; i <= skuCount; i += 1) doc.moveTo(colX(i), yy).lineTo(colX(i), yy + h).stroke();
    doc.lineWidth(1);
  };

  y = drawHead(y);

  columns.forEach((col, ci) => {
    if (y + rowH > bottom - 90) { doc.addPage(); y = doc.page.margins.top; y = drawHead(y); }
    if (ci % 2 === 1) doc.rect(L, y, W, rowH).fill(SOFT);
    doc.rect(L, y, W, rowH).strokeColor(LINE).lineWidth(0.7).stroke();
    doc.lineWidth(1);
    // Date + (Dispatch N)
    const isUn = col.key === 'UNSCHEDULED';
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text(isUn ? 'Unscheduled' : planDate(col.date), L + 6, y + 5, { width: dateW - 10 });
    if (!isUn) doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(`(${col.label})`, L + 6, y + 16, { width: dateW - 10 });
    // Quantities
    doc.font('Helvetica-Bold').fontSize(9);
    rows.forEach((r, i) => {
      const v = r.byCol[col.key] || 0;
      doc.fillColor(v ? INK : '#b6c0d4').text(v ? planNum(v) : '-', colX(i) + 2, y + (rowH - 10) / 2, { width: skuW - 4, align: 'center' });
    });
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text(planNum(colTotal(col.key)), totalX + 2, y + (rowH - 10) / 2, { width: totalW - 4, align: 'center' });
    drawVerticals(y, rowH);
    y += rowH;
  });

  // ── Total Per SKU row ──
  if (y + footH > bottom - 80) { doc.addPage(); y = doc.page.margins.top; y = drawHead(y); }
  doc.rect(L, y, W, footH).fill(SOFT);
  doc.rect(L, y, W, footH).strokeColor(LINE).lineWidth(0.7).stroke();
  doc.lineWidth(1);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8).text('TOTAL PER SKU', L + 6, y + 7, { width: dateW - 10 });
  doc.fontSize(9);
  rows.forEach((r, i) => doc.fillColor(NAVY).text(planNum(r.itemTotal), colX(i) + 2, y + 6, { width: skuW - 4, align: 'center' }));
  doc.rect(totalX, y, totalW, footH).fill(NAVY);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9).text(planNum(grand), totalX + 2, y + 6, { width: totalW - 4, align: 'center' });
  drawVerticals(y, footH);
  y += footH + 14;

  // ── Grand-total bar ──
  const barH = 30;
  if (y + barH > bottom - 30) { doc.addPage(); y = doc.page.margins.top; }
  doc.rect(L, y, W, barH).fill(NAVY);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11).text('TOTAL PLANNED QUANTITY', L + 14, y + 10);
  doc.fontSize(14).text(`${planNum(grand)} pcs`, R - 170, y + 8, { width: 156, align: 'right' });
  y += barH + 12;

  // ── Note + footer ──
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
    .text('This dispatch plan is indicative and subject to confirmation. Quantities and dates may be revised on mutual agreement.', L, y, { width: W });
  doc.fillColor('#9aa4b8').font('Helvetica').fontSize(7.5)
    .text(`Generated by ${companyName()} on ${planDate(new Date())} · Dispatch Planning Execution System`, L, bottom - 12, { align: 'center', width: W });
  doc.fillColor('#000');
};

export const pdfService = {
  /** Generate the dispatch-plan PDF as an in-memory Buffer (for email attach).
   *  Switches to landscape when there are many SKU columns so the transposed
   *  "By Date" grid stays readable. */
  async generateDispatchPlanBuffer(scheduleData) {
    return new Promise((resolve, reject) => {
      const skuCount = (scheduleData?.items || []).length;
      const doc = new PDFDocument({ margin: 40, size: 'A4', layout: skuCount > 6 ? 'landscape' : 'portrait' });
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
