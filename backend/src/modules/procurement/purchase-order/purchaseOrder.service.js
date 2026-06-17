import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import VendorPurchaseOrder, {
  PO_APPROVAL_STATUS,
  PO_RELEASE_STATUS,
  PO_STATUS,
  PO_FOLLOWUP_STATUS,
  PO_PI_STATUS,
  PO_ADVANCE_PAYMENT_STATUS,
} from './purchaseOrder.model.js';
import GoodsReceiptNote from '../grn/grn.model.js';
import PurchaseIndent, { INDENT_OVERALL_STATUS } from '../indent/indent.model.js';
import Party from '../../clients/party.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generateVendorPoNumber } from '../../../utils/docNumberGenerator.js';
import { assertPurchasable } from '../purchase-item-guard.js';
import { s3Enabled, buildKey, uploadBuffer } from '../../../common/uploads/s3.service.js';
import { logger } from '../../../utils/logger.js';
import env from '../../../config/env.js';

const SERVER_BASE = (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');

// Indent states that allow PO creation. PO_READY covers re-creation after a
// cancelled PO (the indent was already moved forward).
const PO_CREATABLE_INDENT_STATES = [
  INDENT_OVERALL_STATUS.QUOTATION_APPROVED,
  INDENT_OVERALL_STATUS.PO_READY,
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Extract the day count from a free-text lead time like "7 days" / "10". */
export const parseLeadDays = (leadTime) => {
  const m = String(leadTime || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
};

/** Server-authoritative line + total computation. */
const computeLines = (items = []) => {
  const lines = items.map((it) => {
    const quantity = Number(it.quantity) || 0;
    const rate = Number(it.rate) || 0;
    const gstRate = Number(it.gstRate) || 0;
    const taxableAmount = round2(quantity * rate);
    const taxAmount = round2(taxableAmount * gstRate / 100);
    const receivedQty = Number(it.receivedQty) || 0;
    return {
      itemName: it.itemName,
      skuCode: it.skuCode || '',
      skuId: it.skuId || undefined,
      quantity, unit: it.unit || 'Pcs', rate, gstRate,
      taxableAmount, taxAmount,
      totalAmount: round2(taxableAmount + taxAmount),
      receivedQty,
      pendingQty: Math.max(0, round2(quantity - receivedQty)),
    };
  });
  const totalTaxableValue = round2(lines.reduce((s, l) => s + l.taxableAmount, 0));
  const totalGSTAmount = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
  return { lines, totals: { totalTaxableValue, totalGSTAmount, grandTotal: round2(totalTaxableValue + totalGSTAmount) } };
};

/** Snapshot vendor fields from the Party master, keeping any explicit overrides. */
const vendorSnapshot = (party, data = {}) => ({
  vendorName:    data.vendorName    || party?.name || '',
  vendorGST:     data.vendorGST     || party?.gstNo || '',
  vendorPAN:     data.vendorPAN     || party?.panNo || '',
  vendorAddress: data.vendorAddress || party?.location || party?.address || '',
  vendorEmail:   data.vendorEmail   || party?.email || '',
  vendorPhone:   data.vendorPhone   || party?.phone || '',
  creditPeriod:  data.creditPeriod ?? party?.creditPeriodDays ?? 0,
});

const findOrThrow = async (id) => {
  const po = await VendorPurchaseOrder.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!po) throw new AppError('Purchase Order not found', 404);
  return po;
};

// ─────────────────────────────────────────────────────────────
// PDF — professional A4 purchase order
// ─────────────────────────────────────────────────────────────
const PAGE = { w: 595.28, h: 841.89, m: 40 };
const INR = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export const buildPoPdfBuffer = (po, company = {}) => new Promise((resolve, reject) => {
  try {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.m });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const W = PAGE.w - PAGE.m * 2; // usable width
    const navy = '#0b2545';
    const blue = '#1d4ed8';
    const line = '#dbe4f3';

    // ── Header band ──
    doc.rect(0, 0, PAGE.w, 86).fill(navy);
    doc.fill('#ffffff').font('Helvetica-Bold').fontSize(18).text(company.name || env.COMPANY_NAME, PAGE.m, 18);
    doc.font('Helvetica').fontSize(8.5).fill('#cdd9f0');
    const headerBits = [company.address || env.COMPANY_ADDRESS, company.gstin ? `GSTIN: ${company.gstin}` : '', company.email || env.COMPANY_EMAIL, company.phone || env.COMPANY_PHONE]
      .filter(Boolean).join('   •   ');
    doc.text(headerBits || ' ', PAGE.m, 44, { width: W - 150 });
    doc.font('Helvetica-Bold').fontSize(15).fill('#ffffff').text('PURCHASE ORDER', PAGE.m, 40, { width: W, align: 'right' });

    let y = 104;

    // ── PO info + vendor blocks ──
    // Content is drawn first so the bordered boxes can size to the taller column
    // (long addresses / emails wrap instead of overflowing a fixed-height box).
    const half = W / 2 - 8;
    const boxTop = y;
    const leftX = PAGE.m;
    const rightBoxX = PAGE.m + half + 16;
    const leftInnerX = leftX + 10;
    const rightInnerX = rightBoxX + 10;
    const innerW = half - 20;

    // LEFT — PO DETAILS
    let ly = boxTop + 10;
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('PO DETAILS', leftInnerX, ly); ly += 14;
    doc.font('Helvetica-Bold').fontSize(11).fill(navy).text(po.poNumber || '', leftInnerX, ly, { width: innerW }); ly += 17;
    doc.font('Helvetica').fontSize(8.5).fill(navy);
    [
      `PO Date: ${fmtDate(po.poDate)}`,
      `Indent No: ${po.indentNumber || '—'}`,
      `Lead Time: ${po.leadTime || '—'}`,
      `Credit Period: ${po.creditPeriod ? `${po.creditPeriod} days` : '—'}`,
    ].forEach((t) => { doc.text(t, leftInnerX, ly, { width: innerW }); ly += 13; });
    const leftBottom = ly;

    // RIGHT — VENDOR / SUPPLIER (fixed label column, wrapping values)
    const vLabelW = 52;       // fixed-width label column → colons + values align
    const vValX = rightInnerX + vLabelW + 8;
    const vValW = innerW - vLabelW - 8;
    let ry = boxTop + 10;
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('VENDOR / SUPPLIER', rightInnerX, ry); ry += 14;
    doc.font('Helvetica-Bold').fontSize(10.5).fill(navy);
    const vNameH = doc.heightOfString(po.vendorName || '—', { width: innerW });
    doc.text(po.vendorName || '—', rightInnerX, ry, { width: innerW }); ry += vNameH + 6;

    // One label:value row; value wraps within its column, row height auto-adjusts.
    const vRow = (label, value) => {
      doc.font('Helvetica').fontSize(8.5);
      doc.fill('#475a8a').text(label, rightInnerX, ry, { width: vLabelW, lineBreak: false });
      doc.fill('#475a8a').text(':', rightInnerX + vLabelW, ry);
      const vh = doc.fill(navy).heightOfString(value || '—', { width: vValW });
      doc.text(value || '—', vValX, ry, { width: vValW });
      ry += Math.max(11, vh) + 2;
    };
    vRow('GST No.', po.vendorGST || '—');
    vRow('PAN No.', po.vendorPAN || '—');
    ry += 4;
    vRow('Address', po.vendorAddress || '—');
    ry += 4;
    vRow('Phone No.', po.vendorPhone || '—');
    vRow('Email', po.vendorEmail || '—');
    const rightBottom = ry;

    // Borders sized to the taller of the two columns.
    const boxH = Math.max(leftBottom, rightBottom) - boxTop + 10;
    doc.roundedRect(leftX, boxTop, half, boxH, 6).stroke(line);
    doc.roundedRect(rightBoxX, boxTop, half, boxH, 6).stroke(line);

    y = boxTop + boxH + 14;

    // ── Terms strip ──
    doc.roundedRect(PAGE.m, y, W, 30, 6).fill('#f5f8ff');
    doc.font('Helvetica').fontSize(8.5).fill(navy)
      .text(`Delivery Terms: ${po.deliveryTerms || '—'}`, PAGE.m + 10, y + 6, { width: W / 2 - 20 })
      .text(`Payment Terms: ${po.paymentTerms || '—'}`, PAGE.m + W / 2, y + 6, { width: W / 2 - 10 });
    y += 44;

    // ── Items table ──
    const cols = [
      { key: 'sr',      label: 'SR',                w: 24,  align: 'center' },
      { key: 'name',    label: 'DESCRIPTION OF GOODS', w: 150, align: 'left' },
      { key: 'qty',     label: 'QTY',               w: 44,  align: 'right' },
      { key: 'unit',    label: 'UNIT',              w: 34,  align: 'center' },
      { key: 'rate',    label: 'RATE',              w: 52,  align: 'right' },
      { key: 'taxable', label: 'TAXABLE',           w: 62,  align: 'right' },
      { key: 'gst',     label: 'GST %',             w: 34,  align: 'center' },
      { key: 'tax',     label: 'TAX AMT',           w: 52,  align: 'right' },
      { key: 'total',   label: 'AMOUNT',            w: 63,  align: 'right' },
    ];
    const drawHeaderRow = () => {
      doc.rect(PAGE.m, y, W, 20).fill(navy);
      let x = PAGE.m;
      doc.font('Helvetica-Bold').fontSize(7).fill('#ffffff');
      cols.forEach((c) => { doc.text(c.label, x + 3, y + 6.5, { width: c.w - 6, align: c.align }); x += c.w; });
      y += 20;
    };
    drawHeaderRow();

    const nameCol = cols.find((c) => c.key === 'name');
    const PADY = 5; // top/bottom cell padding
    (po.items || []).forEach((it, i) => {
      // Measure the description cell: item name (primary) + optional SKU line
      // (secondary). Row height auto-adjusts so long names wrap cleanly.
      const nameStr = it.itemName || '';
      const skuStr = it.skuCode ? `SKU: ${it.skuCode}` : '';
      doc.font('Helvetica').fontSize(8);
      const nameH = doc.heightOfString(nameStr, { width: nameCol.w - 6 });
      const skuH = skuStr ? 10 : 0;
      const rowH = Math.max(18, nameH + skuH + PADY * 2 - 2);

      if (y + rowH > PAGE.h - 150) { doc.addPage(); y = PAGE.m; drawHeaderRow(); }

      if (i % 2 === 1) doc.rect(PAGE.m, y, W, rowH).fill('#f8fafc');

      const cells = {
        sr: String(i + 1),
        qty: String(it.quantity), unit: it.unit || 'Pcs',
        rate: Number(it.rate || 0).toFixed(2), taxable: Number(it.taxableAmount || 0).toFixed(2),
        gst: `${it.gstRate || 0}%`, tax: Number(it.taxAmount || 0).toFixed(2),
        total: Number(it.totalAmount || 0).toFixed(2),
      };
      let x = PAGE.m;
      cols.forEach((c) => {
        if (c.key === 'name') {
          doc.font('Helvetica').fontSize(8).fill(navy).text(nameStr, x + 3, y + PADY, { width: c.w - 6 });
          if (skuStr) {
            doc.font('Helvetica').fontSize(7).fill('#64748b')
              .text(skuStr, x + 9, y + PADY + nameH + 1, { width: c.w - 12 });
          }
        } else {
          doc.font('Helvetica').fontSize(8).fill(navy)
            .text(cells[c.key], x + 3, y + PADY, { width: c.w - 6, align: c.align, ellipsis: true });
        }
        x += c.w;
      });
      doc.moveTo(PAGE.m, y + rowH).lineTo(PAGE.m + W, y + rowH).strokeColor(line).lineWidth(0.5).stroke();
      y += rowH;
    });

    // ── Totals block ──
    y += 10;
    const totX = PAGE.m + W - 220;
    const totRow = (label, value, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8.5).fill(navy);
      doc.text(label, totX, y, { width: 120, align: 'right' });
      doc.text(value, totX + 124, y, { width: 96, align: 'right' });
      y += bold ? 18 : 14;
    };
    totRow('Total Taxable Value:', INR(po.totalTaxableValue));
    totRow('Total GST:', INR(po.totalGSTAmount));
    doc.moveTo(totX, y).lineTo(PAGE.m + W, y).strokeColor(navy).lineWidth(1).stroke(); y += 5;
    totRow('GRAND TOTAL:', INR(po.grandTotal), true);

    // ── Terms & signature footer ──
    y += 12;
    if (y > PAGE.h - 150) { doc.addPage(); y = PAGE.m; }
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('TERMS & CONDITIONS', PAGE.m, y); y += 12;
    doc.font('Helvetica').fontSize(7.5).fill(navy).text(
      po.remarks ||
      '1. Please mention PO number on all invoices, challans and correspondence.\n' +
      '2. Material must conform to approved quotation/specifications; rejections will be returned at supplier cost.\n' +
      '3. Delivery within the agreed lead time; delays must be communicated in advance.',
      PAGE.m, y, { width: W - 200 },
    );

    doc.font('Helvetica-Bold').fontSize(9).fill(navy)
      .text(`For ${company.name || env.COMPANY_NAME}`, PAGE.m + W - 180, y + 6, { width: 180, align: 'center' });
    doc.font('Helvetica').fontSize(8)
      .text('Authorized Signatory', PAGE.m + W - 180, y + 58, { width: 180, align: 'center' });

    doc.end();
  } catch (err) { reject(err); }
});

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────
export const purchaseOrderService = {
  async create(data, user) {
    // Rule: PO only from Approved Indent + Approved Quotation.
    const indent = await PurchaseIndent.findOne({ _id: data.indentId, isDeleted: { $ne: true } });
    if (!indent) throw new AppError('Indent not found', 404);
    if (!PO_CREATABLE_INDENT_STATES.includes(indent.overallStatus)) {
      throw new AppError('Purchase Order can only be created after the quotation is approved (Step 1.3)', 400);
    }

    // Rule: one active PO per indent — only a CANCELLED PO frees the indent to
    // create another. Draft/approved/released/received POs all block re-creation.
    const activePo = await VendorPurchaseOrder.findOne({
      indentId: indent._id,
      isDeleted: { $ne: true },
      poStatus: { $ne: PO_STATUS.CANCELLED },
    }).select('poNumber poStatus').lean();
    if (activePo) {
      throw new AppError(`Indent ${indent.indentNumber} already has an active PO (${activePo.poNumber}). Cancel it before creating a new one.`, 400);
    }

    const party = await Party.findOne({ _id: data.vendorId, isDeleted: { $ne: true } }).lean();
    if (!party) throw new AppError('Vendor (Party) not found', 404);

    // Finished Goods are sell-side only — never purchasable.
    await assertPurchasable(data.items);

    const { lines, totals } = computeLines(data.items);
    const poNumber = await generateVendorPoNumber(data.poDate || new Date());

    const po = await VendorPurchaseOrder.create({
      poNumber,
      poDate: data.poDate || new Date(),
      indentId: indent._id,
      indentNumber: indent.indentNumber,
      vendorId: party._id,
      ...vendorSnapshot(party, data),
      deliveryTerms: data.deliveryTerms || '',
      paymentTerms: data.paymentTerms || '',
      leadTime: data.leadTime || '',
      remarks: data.remarks || '',
      items: lines,
      ...totals,
      approvalStatus: PO_APPROVAL_STATUS.DRAFT,
      releaseStatus: PO_RELEASE_STATUS.NOT_RELEASED,
      poStatus: PO_STATUS.DRAFT,
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `PO created from ${indent.indentNumber}`, actorId: user?._id }],
    });

    // Move the indent forward (linkage for future Follow-up / GRN). Non-fatal.
    try {
      await PurchaseIndent.updateOne(
        { _id: indent._id },
        { $set: { overallStatus: INDENT_OVERALL_STATUS.PO_READY }, $push: { activityTimeline: { action: 'PO_CREATED', description: `PO ${poNumber} created`, actorId: user?._id, timestamp: new Date() } } },
      );
    } catch (err) { logger.error(`[po] indent status update failed: ${err.message}`); }

    return po;
  },

  async getAll(query) {
    const features = new ApiFeatures(
      VendorPurchaseOrder.find({ isDeleted: { $ne: true } }),
      query,
    )
      .filter()
      .search(['poNumber', 'indentNumber', 'vendorName'])
      .sort()
      .select()
      .paginate()
      .populateRefs([{ path: 'createdBy', select: 'name' }]);
    return features.exec();
  },

  async getById(id) {
    const po = await VendorPurchaseOrder.findOne({ _id: id, isDeleted: { $ne: true } })
      .populate('createdBy', 'name')
      .populate('vendorId', 'name code suppliedProducts')
      .lean();
    if (!po) throw new AppError('Purchase Order not found', 404);
    return po;
  },

  async getStats() {
    const rows = await VendorPurchaseOrder.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total:           { $sum: 1 },
          approved:        { $sum: { $cond: [{ $eq: ['$approvalStatus', PO_APPROVAL_STATUS.APPROVED] }, 1, 0] } },
          released:        { $sum: { $cond: [{ $eq: ['$releaseStatus', PO_RELEASE_STATUS.RELEASED] }, 1, 0] } },
          partialReceived: { $sum: { $cond: [{ $eq: ['$poStatus', PO_STATUS.PARTIAL_RECEIVED] }, 1, 0] } },
          fullyReceived:   { $sum: { $cond: [{ $eq: ['$poStatus', PO_STATUS.FULLY_RECEIVED] }, 1, 0] } },
          totalValue:      { $sum: '$grandTotal' },
        },
      },
    ]);
    return rows[0] || { total: 0, approved: 0, released: 0, partialReceived: 0, fullyReceived: 0, totalValue: 0 };
  },

  async update(id, data, user) {
    const po = await findOrThrow(id);
    if (po.approvalStatus !== PO_APPROVAL_STATUS.DRAFT) {
      throw new AppError('Only draft purchase orders can be edited', 400);
    }
    if (data.vendorId && String(data.vendorId) !== String(po.vendorId)) {
      const party = await Party.findOne({ _id: data.vendorId, isDeleted: { $ne: true } }).lean();
      if (!party) throw new AppError('Vendor (Party) not found', 404);
      Object.assign(po, { vendorId: party._id }, vendorSnapshot(party, data));
    }
    const { vendorId: _v, items, ...rest } = data;
    Object.assign(po, rest);
    if (items) {
      await assertPurchasable(items);
      const { lines, totals } = computeLines(items);
      po.items = lines;
      Object.assign(po, totals);
    }
    po.updatedBy = user?._id;
    po.activityTimeline.push({ action: 'UPDATE', description: 'Draft PO updated', actorId: user?._id });
    return po.save();
  },

  async approve(id, data, user) {
    const po = await findOrThrow(id);
    if (po.approvalStatus !== PO_APPROVAL_STATUS.DRAFT) {
      throw new AppError('Only draft purchase orders can be approved/rejected', 400);
    }
    const approved = data.decision !== 'REJECTED';
    po.approvalStatus = approved ? PO_APPROVAL_STATUS.APPROVED : PO_APPROVAL_STATUS.REJECTED;
    po.poStatus = approved ? PO_STATUS.APPROVED : PO_STATUS.DRAFT;
    po.approval = {
      decidedBy: user?.name || '',
      decidedById: user?._id,
      decidedAt: new Date(),
      remarks: data.remarks || '',
    };
    po.updatedBy = user?._id;
    po.activityTimeline.push({ action: approved ? 'APPROVE' : 'REJECT', description: `PO ${approved ? 'approved' : 'rejected'}`, actorId: user?._id });
    return po.save();
  },

  /** Generate the PO PDF, store to S3 (or local fallback) and persist its URL. */
  async generatePdf(id) {
    const po = await VendorPurchaseOrder.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!po) throw new AppError('Purchase Order not found', 404);

    // Best-effort company GSTIN from the pricing CompanySettings singleton.
    let company = {};
    try {
      const CompanySettings = (await import('../../pricing/company-settings.model.js')).default;
      const s = await CompanySettings.findOne().lean();
      if (s) company = { name: s.companyName, address: s.companyAddress, gstin: s.companyGstin, phone: s.companyPhone, email: s.companyEmail };
    } catch { /* fall back to env */ }

    const buffer = await buildPoPdfBuffer(po, company);
    const fileName = `${String(po.poNumber || 'PO').replace(/[^\w.-]/g, '_')}.pdf`;

    let poPdfUrl;
    if (s3Enabled) {
      const key = buildKey('purchase-orders', fileName);
      await uploadBuffer({ buffer, key, contentType: 'application/pdf' });
      poPdfUrl = `${SERVER_BASE}/api/v1/uploads/file?key=${encodeURIComponent(key)}`;
    } else {
      const dir = path.resolve(process.cwd(), 'uploads', 'purchase-orders');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fp = path.join(dir, `${Date.now()}-${fileName}`);
      fs.writeFileSync(fp, buffer);
      poPdfUrl = `${SERVER_BASE}/uploads/purchase-orders/${path.basename(fp)}`;
    }
    await VendorPurchaseOrder.updateOne({ _id: id }, { $set: { poPdfUrl, poPdfFileName: fileName } });
    return { poPdfUrl, poPdfFileName: fileName };
  },

  async release(id, data, user) {
    const po = await findOrThrow(id);
    if (po.approvalStatus !== PO_APPROVAL_STATUS.APPROVED) {
      throw new AppError('PO must be approved before it can be released', 400);
    }
    if (po.releaseStatus === PO_RELEASE_STATUS.RELEASED) {
      throw new AppError('PO is already released', 400);
    }

    po.releaseStatus = PO_RELEASE_STATUS.RELEASED;
    po.poStatus = PO_STATUS.RELEASED_TO_VENDOR;
    po.releasedBy = user?.name || '';
    po.releasedById = user?._id;
    po.releasedAt = new Date();
    // Step 1.5 — open the material follow-up window.
    po.followUpStatus = PO_FOLLOWUP_STATUS.PENDING;
    const leadDays = parseLeadDays(po.leadTime);
    if (leadDays > 0) {
      po.expectedDeliveryDate = new Date(po.releasedAt.getTime() + leadDays * 86400000);
    }
    if (data.sendEmail) {
      po.supplierEmailSent = true;
      po.supplierEmailSentAt = new Date();
    }
    if (data.supplierAcknowledgement) po.supplierAcknowledgement = data.supplierAcknowledgement;
    if (data.remarks) po.remarks = data.remarks;
    po.updatedBy = user?._id;
    po.activityTimeline.push({ action: 'RELEASE', description: 'PO released to vendor', actorId: user?._id });
    await po.save();

    // Generate + store the PDF (non-fatal — release stands even if PDF fails).
    try {
      const { poPdfUrl, poPdfFileName } = await this.generatePdf(id);
      po.poPdfUrl = poPdfUrl;
      po.poPdfFileName = poPdfFileName;
    } catch (err) { logger.error(`[po] PDF generation failed for ${po.poNumber}: ${err.message}`); }

    return po;
  },

  /**
   * Mark PI as Not Required — the audited "PI is optional" path.
   * Only valid for a RELEASED PO that has no PI in progress and no GRN yet.
   * Records reason/remarks/who/when forever and advances the PI gate so a GRN
   * can proceed without a proforma invoice or advance payment.
   */
  async markPiNotRequired(id, data, user) {
    const po = await findOrThrow(id);

    if (po.poStatus !== PO_STATUS.RELEASED_TO_VENDOR) {
      throw new AppError('PI can only be marked Not Required after the PO is released to the vendor', 400);
    }
    if (po.piStatus === PO_PI_STATUS.PI_NOT_REQUIRED) {
      throw new AppError('PI is already marked as Not Required', 400);
    }
    // A PI already exists / is in progress → cannot skip it.
    if (po.piStatus !== PO_PI_STATUS.NOT_RECEIVED || po.piId) {
      throw new AppError('A proforma invoice already exists for this PO — it cannot be marked Not Required', 400);
    }
    // No downstream document may exist yet (GRN is the gateway to QC/Invoice/Voucher).
    const grnCount = await GoodsReceiptNote.countDocuments({ poId: po._id, isDeleted: { $ne: true } });
    if (grnCount > 0) {
      throw new AppError('A GRN already exists for this PO — PI cannot be marked Not Required', 400);
    }

    po.piStatus = PO_PI_STATUS.PI_NOT_REQUIRED;
    po.advancePaymentStatus = PO_ADVANCE_PAYMENT_STATUS.NOT_REQUIRED;
    po.piNotRequiredReason = data.reason;
    po.piNotRequiredRemarks = data.remarks || '';
    po.piNotRequiredBy = user?._id;
    po.piNotRequiredByName = user?.name || '';
    po.piNotRequiredAt = new Date();
    po.updatedBy = user?._id;
    po.activityTimeline.push({
      action: 'PI_NOT_REQUIRED',
      description: `PI marked as Not Required. Reason: ${data.reason}${data.remarks ? ` | Remarks: ${data.remarks}` : ''}`,
      actorId: user?._id,
    });
    return po.save();
  },

  async cancel(id, data, user) {
    const po = await findOrThrow(id);
    if ([PO_STATUS.FULLY_RECEIVED, PO_STATUS.CLOSED, PO_STATUS.CANCELLED].includes(po.poStatus)) {
      throw new AppError(`Cannot cancel a PO in ${po.poStatus} state`, 400);
    }
    po.poStatus = PO_STATUS.CANCELLED;
    if (data.remarks) po.remarks = data.remarks;
    po.updatedBy = user?._id;
    po.activityTimeline.push({ action: 'CANCEL', description: 'PO cancelled', actorId: user?._id });
    return po.save();
  },
};
