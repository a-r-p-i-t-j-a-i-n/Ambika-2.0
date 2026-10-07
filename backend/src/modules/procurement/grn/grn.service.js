import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import GoodsReceiptNote, { GRN_STATUS, GRN_QC_STATUS, HOW_ITEM_RECEIVED } from './grn.model.js';
import VendorPurchaseOrder, { PO_STATUS, PO_FOLLOWUP_STATUS, PO_PI_STATUS } from '../purchase-order/purchaseOrder.model.js';
import PurchaseFollowUp from '../follow-up/followUp.model.js';
import ProformaInvoice from '../proforma-invoice/proformaInvoice.model.js';
import SKU from '../../skus/sku.model.js';
import { inventoryService } from '../../inventory/inventory.service.js';
import { assertPurchasable } from '../purchase-item-guard.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generateGrnNumber, generateGrnUniqueId } from '../../../utils/docNumberGenerator.js';
import { s3Enabled, buildKey, uploadBuffer } from '../../../common/uploads/s3.service.js';
import { logger } from '../../../utils/logger.js';
import env from '../../../config/env.js';
import { registerApprovalDocument } from '../../approvals/approval.registry.js';
import { approvalService } from '../../approvals/approval.service.js';

const SERVER_BASE = (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const findOrThrow = async (id) => {
  const grn = await GoodsReceiptNote.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!grn) throw new AppError('GRN not found', 404);
  return grn;
};

// A GRN is editable/deletable/cancellable only while it is an un-posted DRAFT.
// complete() claims a draft by flipping stockPosted first, so `stockPosted`
// also covers a GRN whose completion is in flight.
const isOpenDraft = (grn) => grn.grnStatus === GRN_STATUS.DRAFT && !grn.stockPosted;
const OPEN_DRAFT_FILTER = { grnStatus: GRN_STATUS.DRAFT, stockPosted: { $ne: true } };

/**
 * Save a draft GRN only if it is still an open draft in the database — guards
 * against an edit/delete/cancel landing after a concurrent Complete claimed it.
 */
const saveOpenDraft = async (grn) => {
  grn.$where = OPEN_DRAFT_FILTER;
  try {
    return await grn.save();
  } catch (err) {
    if (err?.name === 'DocumentNotFoundError') {
      throw new AppError('This GRN has just been completed and can no longer be changed', 409);
    }
    throw err;
  }
};

/** Derive per-line short/extra/pending + totals (server-authoritative). */
const computeLines = (items = []) => {
  const lines = items.map((it) => {
    const orderedQty = round2(it.orderedQty);
    const prev = round2(it.previouslyReceivedQty);
    const invoiceQty = round2(it.invoiceQty);
    const receivedQty = round2(it.receivedQty);
    const rate = round2(it.rate);
    const pendingAvailable = Math.max(0, round2(orderedQty - prev)); // before this GRN — read-only, PO-derived
    return {
      ...it,
      orderedQty, previouslyReceivedQty: prev, invoiceQty, receivedQty, rate,
      pendingBeforeGrn: pendingAvailable,
      shortQty: round2(invoiceQty - receivedQty),
      extraQty: Math.max(0, round2(receivedQty - pendingAvailable)),
      pendingQty: Math.max(0, round2(orderedQty - (prev + receivedQty))), // after this GRN
      amount: round2(receivedQty * rate),
    };
  });
  return {
    lines,
    totals: {
      totalOrderedQty:  round2(lines.reduce((s, l) => s + l.orderedQty, 0)),
      totalInvoiceQty:  round2(lines.reduce((s, l) => s + l.invoiceQty, 0)),
      totalReceivedQty: round2(lines.reduce((s, l) => s + l.receivedQty, 0)),
      totalShortQty:    round2(lines.reduce((s, l) => s + l.shortQty, 0)),
      totalValue:       round2(lines.reduce((s, l) => s + l.amount, 0)),
    },
  };
};

// ─────────────────────────────────────────────────────────────
// PDF — Goods Receiving & Inspection Report (A4)
// ─────────────────────────────────────────────────────────────
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export const buildGrnPdfBuffer = (grn, company = {}, signature = null) => new Promise((resolve, reject) => {
  try {
    const M = 40;
    const doc = new PDFDocument({ size: 'A4', margin: M });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const W = 595.28 - M * 2;
    const navy = '#0b2545'; const blue = '#1d4ed8'; const line = '#dbe4f3';

    // ── Header band: two fixed columns — company info (left ~58%), title (right) ──
    // The band is measured first so the company address wraps within the left
    // column and never overlaps the right-aligned report title.
    const PW = 595.28;
    const leftX = M;
    const leftW = 300;                       // left column (company) — wraps here only
    const titleX = M + 312;                  // 12px gutter after the left column
    const titleW = PW - M - titleX;          // right column (title) — wraps here only
    const padTop = 16;

    const nameStr = company.name || env.COMPANY_NAME || '';
    const addrStr = company.address || env.COMPANY_ADDRESS || '';
    const gstStr = company.gstin ? `GSTIN: ${company.gstin}` : '';
    const emailStr = company.email || env.COMPANY_EMAIL || '';
    const TITLE = 'GOODS RECEIVING & INSPECTION REPORT';

    const nameH = doc.font('Helvetica-Bold').fontSize(16).heightOfString(nameStr, { width: leftW });
    doc.font('Helvetica').fontSize(8.5);
    const addrH = addrStr ? doc.heightOfString(addrStr, { width: leftW }) : 0;
    const titleH = doc.font('Helvetica-Bold').fontSize(14).heightOfString(TITLE, { width: titleW, align: 'right' });

    let leftBottom = padTop + nameH + 4 + addrH;
    if (gstStr) leftBottom += 12;
    if (emailStr) leftBottom += 12;
    const HEADER_H = Math.max(90, leftBottom, padTop + titleH) + 12;

    doc.rect(0, 0, PW, HEADER_H).fill(navy);
    // Left column — name + wrapping address + gstin + email.
    doc.fill('#ffffff').font('Helvetica-Bold').fontSize(16).text(nameStr, leftX, padTop, { width: leftW });
    let hy = padTop + nameH + 4;
    doc.font('Helvetica').fontSize(8.5).fill('#cdd9f0');
    if (addrStr)  { doc.text(addrStr, leftX, hy, { width: leftW }); hy += addrH; }
    if (gstStr)   { doc.text(gstStr, leftX, hy, { width: leftW }); hy += 12; }
    if (emailStr) { doc.text(emailStr, leftX, hy, { width: leftW }); hy += 12; }
    // Right column — report title (right-aligned, vertically centred in the band).
    doc.font('Helvetica-Bold').fontSize(14).fill('#ffffff')
      .text(TITLE, titleX, Math.max(padTop, (HEADER_H - titleH) / 2), { width: titleW, align: 'right' });

    let y = HEADER_H + 16;
    const half = W / 2 - 8;
    // ── GRN details + supplier cards — both sized to the taller column so the
    // supplier address can wrap fully instead of being clipped. ──
    const cardTop = y;
    const liX = M + 10;
    const riX = M + half + 16 + 10;
    const cardInnerW = half - 20;

    // Measure the supplier (right) column — vendor name + wrapping address.
    const vNameH = doc.font('Helvetica-Bold').fontSize(10.5).heightOfString(grn.vendorName || '—', { width: cardInnerW });
    doc.font('Helvetica').fontSize(8.5);
    const vAddrStr = grn.vendorAddress || '';
    const vAddrH = vAddrStr ? doc.heightOfString(vAddrStr, { width: cardInnerW - 42 }) : 11;

    const leftBottomY = 66 + 13;                                  // last GRN line bottom
    const rightBottomY = 22 + vNameH + 4 + 12 + Math.max(11, vAddrH);
    const cardH = Math.max(86, leftBottomY, rightBottomY) + 8;

    doc.roundedRect(M, cardTop, half, cardH, 6).stroke(line);
    doc.roundedRect(M + half + 16, cardTop, half, cardH, 6).stroke(line);

    // LEFT — GRN DETAILS
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('GRN DETAILS', liX, cardTop + 9);
    doc.font('Helvetica-Bold').fontSize(11).fill(navy).text(grn.grnNumber || '', liX, cardTop + 22, { width: cardInnerW });
    doc.font('Helvetica').fontSize(8.5).fill(navy)
      .text(`Date: ${fmtDate(grn.grnDate)}`, liX, cardTop + 40)
      .text(`PO No: ${grn.poNumber || '—'}`, liX, cardTop + 53)
      .text(`Challan No: ${grn.challanNumber || '—'}`, liX, cardTop + 66);

    // RIGHT — SUPPLIER (fixed label column → labels + values align, address wraps)
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('SUPPLIER', riX, cardTop + 9);
    let ry = cardTop + 22;
    doc.font('Helvetica-Bold').fontSize(10.5).fill(navy).text(grn.vendorName || '—', riX, ry, { width: cardInnerW }); ry += vNameH + 4;
    const sLabelW = 42, sValX = riX + sLabelW, sValW = cardInnerW - sLabelW;
    doc.font('Helvetica').fontSize(8.5);
    doc.fill('#475a8a').text('GST', riX, ry); doc.fill(navy).text(grn.vendorGST || '—', sValX, ry, { width: sValW }); ry += 12;
    doc.fill('#475a8a').text('Address', riX, ry); doc.fill(navy).text(vAddrStr || '—', sValX, ry, { width: sValW });

    y = cardTop + cardH + 14;

    // Items table.
    const cols = [
      { key: 'sr', label: 'SR', w: 26, align: 'center' },
      { key: 'name', label: 'DESCRIPTION OF GOODS', w: 220, align: 'left' },
      { key: 'invoice', label: 'INVOICE QTY', w: 80, align: 'right' },
      { key: 'received', label: 'RECEIVED QTY', w: 90, align: 'right' },
      { key: 'unit', label: 'UNIT', w: W - 26 - 220 - 80 - 90, align: 'center' },
    ];
    const drawHead = () => {
      doc.rect(M, y, W, 20).fill(navy);
      let x = M; doc.font('Helvetica-Bold').fontSize(7.5).fill('#ffffff');
      cols.forEach((c) => { doc.text(c.label, x + 4, y + 6.5, { width: c.w - 8, align: c.align }); x += c.w; });
      y += 20;
    };
    drawHead();
    const nameCol = cols.find((c) => c.key === 'name');
    const PADY = 5;
    (grn.items || []).forEach((it, i) => {
      // Measure the description: item name (primary) + optional batch line
      // (secondary). Row height auto-adjusts so long names wrap cleanly.
      const itemName = it.itemName || '';
      const batchStr = it.batchNo ? `Batch: ${it.batchNo}` : '';
      doc.font('Helvetica').fontSize(8.5);
      const nameH = doc.heightOfString(itemName, { width: nameCol.w - 8 });
      const batchH = batchStr ? 10 : 0;
      const rowH = Math.max(18, nameH + batchH + PADY * 2 - 2);

      if (y + rowH > 770) { doc.addPage(); y = M; drawHead(); }
      if (i % 2 === 1) doc.rect(M, y, W, rowH).fill('#f8fafc');

      const cells = { sr: String(i + 1), invoice: String(it.invoiceQty || 0), received: String(it.receivedQty || 0), unit: it.unit || 'Pcs' };
      let x = M;
      cols.forEach((c) => {
        if (c.key === 'name') {
          doc.font('Helvetica').fontSize(8.5).fill(navy).text(itemName, x + 4, y + PADY, { width: c.w - 8 });
          if (batchStr) {
            doc.font('Helvetica').fontSize(7).fill('#64748b').text(batchStr, x + 8, y + PADY + nameH + 1, { width: c.w - 12 });
          }
        } else {
          doc.font('Helvetica').fontSize(8.5).fill(navy).text(cells[c.key], x + 4, y + PADY, { width: c.w - 8, align: c.align, ellipsis: true });
        }
        x += c.w;
      });
      doc.moveTo(M, y + rowH).lineTo(M + W, y + rowH).strokeColor(line).lineWidth(0.5).stroke();
      y += rowH;
    });

    y += 16;
    if (y > 700) { doc.addPage(); y = M; }
    const invoiceReceived = grn.invoiceNumber ? 'Yes' : 'No';
    doc.font('Helvetica-Bold').fontSize(8.5).fill(navy).text(`Invoice Received: ${invoiceReceived}`, M, y);
    doc.font('Helvetica').fontSize(8.5).text(`Invoice No: ${grn.invoiceNumber || '—'}   How Received: ${(grn.howItemReceived || '').replace(/_/g, ' ')}`, M, y + 14);
    doc.font('Helvetica-Bold').fontSize(8.5).text('Remarks:', M, y + 34);
    doc.font('Helvetica').fontSize(8.5).text(grn.remarks || '—', M, y + 47, { width: W - 180 });

    doc.font('Helvetica-Bold').fontSize(9).fill(navy).text(`For ${company.name || env.COMPANY_NAME}`, M + W - 180, y + 30, { width: 180, align: 'center' });
    doc.font('Helvetica').fontSize(8).text(`Prepared By: ${grn.preparedBy || grn.receivedBy || '—'}`, M + W - 180, y + 70, { width: 180, align: 'center' });

    // ── MD Approval block (Digital Approval & Signature engine) — always
    // rendered so the unsigned PDF shows exactly where the signature will
    // land; a signature image fills the placeholder once signed. ──
    let ay = y + 100;
    if (ay + 110 > 780) { doc.addPage(); ay = M; }
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('APPROVED BY (MD)', M, ay);
    if (signature?.imageBuffer) {
      doc.image(signature.imageBuffer, M, ay + 14, { width: 140, height: 50, fit: [140, 50] });
    } else {
      doc.roundedRect(M, ay + 14, 140, 50, 4).dash(3, { space: 2 }).stroke(line).undash();
      doc.font('Helvetica').fontSize(7).fill('#94a3b8').text('Signature will appear here', M + 8, ay + 34, { width: 124 });
    }
    doc.font('Helvetica-Bold').fontSize(9).fill(navy).text(signature?.signedByName || '—', M, ay + 70);
    doc.font('Helvetica').fontSize(8).fill('#475a8a').text(signature?.designation || 'Managing Director', M, ay + 83);
    if (signature?.signedAt) {
      const t = new Date(signature.signedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      doc.font('Helvetica').fontSize(7.5).fill('#475a8a').text(`${fmtDate(signature.signedAt)} · ${t}`, M, ay + 95);
    }

    doc.end();
  } catch (err) { reject(err); }
});

/** Resolve the company profile once, for the approval engine's PDF adapter. */
const resolveCompanyForApproval = async () => {
  try {
    const CompanySettings = (await import('../../pricing/company-settings.model.js')).default;
    const s = await CompanySettings.findOne().lean();
    if (s) return { name: s.companyName, address: s.companyAddress, gstin: s.companyGstin, email: s.companyEmail };
  } catch { /* env fallback */ }
  return {};
};

// Wire GRN into the generic Digital Approval & Signature engine (see
// modules/approvals) — the engine calls back into this adapter, it never
// contains GRN-specific logic itself.
registerApprovalDocument('GRN', {
  model: GoodsReceiptNote,
  numberField: 'grnNumber',
  mirrorStatusField: 'approvalStatus',
  pdfUrlField: 'grnPdfUrl',
  pdfFileNameField: 'grnPdfFileName',
  uploadFolder: 'grns',
  buildPdfBuffer: async (grn, opts) => {
    const company = await resolveCompanyForApproval();
    return buildGrnPdfBuffer(grn, company, opts?.signature || null);
  },
});

export const grnService = {
  async create(data, user) {
    const po = await VendorPurchaseOrder.findOne({ _id: data.poId, isDeleted: { $ne: true } });
    if (!po) throw new AppError('Purchase Order not found', 404);

    // Rule 1: gate — material followed up to READY_FOR_GRN AND the PI step is
    // settled: either advance payment completed, or PI explicitly marked Not Required.
    const piSettled = [PO_PI_STATUS.PAYMENT_COMPLETED, PO_PI_STATUS.PI_NOT_REQUIRED].includes(po.piStatus);
    if (po.followUpStatus !== PO_FOLLOWUP_STATUS.READY_FOR_GRN || !piSettled) {
      throw new AppError('GRN can only be created when the PO is READY_FOR_GRN and its PI is completed or marked Not Required', 400);
    }

    // Rule 1b: material delivery must be confirmed — the PO must have reached the
    // ready-for-GRN gate AND carry a Final Material Date (on the PO, or on the
    // latest completed follow-up for back-compat). A PO already partially received
    // is exempt so in-flight receiving is never blocked.
    if (po.poStatus !== PO_STATUS.PARTIAL_RECEIVED) {
      let hasFinalMaterialDate = !!(po.readyForGrnAt && po.finalMaterialDate);
      if (po.readyForGrnAt && !po.finalMaterialDate) {
        const fu = await PurchaseFollowUp.findOne({
          poId: po._id, isDeleted: { $ne: true }, finalMaterialDate: { $ne: null },
        }).sort('-updatedAt').select('finalMaterialDate').lean();
        hasFinalMaterialDate = !!fu?.finalMaterialDate;
      }
      if (!hasFinalMaterialDate) {
        throw new AppError('Final Material Date is required before creating a GRN.', 400);
      }
    }

    if (po.poStatus === PO_STATUS.FULLY_RECEIVED) {
      throw new AppError('This PO is already fully received', 400);
    }

    // Rule 2: auto-load lines from the PO (pending only).
    const sourceItems = data.items?.length ? data.items : (po.items || [])
      .filter((it) => round2((it.quantity || 0) - (it.receivedQty || 0)) > 0)
      .map((it) => {
        const pending = round2((it.quantity || 0) - (it.receivedQty || 0));
        return {
          // For JSL, itemName is the "Grade Width Finish" label that should be
          // shown as the Item Description; itemDescription only holds the raw
          // indent item name and is not used for display.
          poItemId: it._id, skuId: it.skuId, skuCode: it.skuCode, itemName: it.itemName, unit: it.unit,
          orderedQty: it.quantity, previouslyReceivedQty: it.receivedQty || 0,
          invoiceQty: pending, receivedQty: pending, rate: it.rate, batchNo: '', remarks: '',
        };
      });
    if (!sourceItems.length) throw new AppError('Nothing left to receive on this PO', 400);

    await assertPurchasable(sourceItems);
    const { lines, totals } = computeLines(sourceItems);

    const grnNumber = await generateGrnNumber(data.grnDate || new Date());
    const uniqueId = await generateGrnUniqueId();

    const grn = await GoodsReceiptNote.create({
      grnNumber, uniqueId,
      grnDate: data.grnDate || new Date(),
      poId: po._id, poNumber: po.poNumber,
      piId: po.piId || undefined, piNumber: po.piNumber || '',
      indentId: po.indentId, indentNumber: po.indentNumber,
      vendorId: po.vendorId, vendorName: po.vendorName, vendorGST: po.vendorGST,
      vendorAddress: po.vendorAddress, vendorPhone: po.vendorPhone,
      challanNumber: data.challanNumber || '',
      invoiceNumber: data.invoiceNumber || '',
      invoiceDate: data.invoiceDate || null,
      vehicleNumber: data.vehicleNumber || '',
      receivedBy: data.receivedBy || user?.name || '',
      preparedBy: data.preparedBy || user?.name || '',
      warehouse: data.warehouse || 'MAIN',
      howItemReceived: data.howItemReceived || HOW_ITEM_RECEIVED.FULL_MATERIAL_RECEIVED,
      challanDocument: data.challanDocument?.fileUrl ? { ...data.challanDocument, uploadedAt: new Date() } : undefined,
      invoiceDocument: data.invoiceDocument?.fileUrl ? { ...data.invoiceDocument, uploadedAt: new Date() } : undefined,
      items: lines,
      ...totals,
      grnStatus: GRN_STATUS.DRAFT,
      qcStatus: GRN_QC_STATUS.PENDING,
      remarks: data.remarks || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `GRN created for ${po.poNumber}`, actorId: user?._id }],
    });
    return grn;
  },

  async getAll(query) {
    const features = new ApiFeatures(GoodsReceiptNote.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['grnNumber', 'poNumber', 'vendorName', 'invoiceNumber', 'uniqueId'])
      .sort().select().paginate();
    return features.exec();
  },

  async getById(id) {
    const grn = await GoodsReceiptNote.findOne({ _id: id, isDeleted: { $ne: true } })
      .populate('createdBy', 'name').lean();
    if (!grn) throw new AppError('GRN not found', 404);
    return grn;
  },

  async getByPo(poId) {
    return GoodsReceiptNote.find({ poId, isDeleted: { $ne: true } }).sort('-createdAt').lean();
  },

  async getStats() {
    const rows = await GoodsReceiptNote.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total:           { $sum: 1 },
          partialReceived: { $sum: { $cond: [{ $eq: ['$grnStatus', GRN_STATUS.PARTIAL_RECEIVED] }, 1, 0] } },
          fullyReceived:   { $sum: { $cond: [{ $eq: ['$grnStatus', GRN_STATUS.FULLY_RECEIVED] }, 1, 0] } },
          draft:           { $sum: { $cond: [{ $eq: ['$grnStatus', GRN_STATUS.DRAFT] }, 1, 0] } },
          cancelled:       { $sum: { $cond: [{ $eq: ['$grnStatus', GRN_STATUS.CANCELLED] }, 1, 0] } },
          receivedQty:     { $sum: { $cond: [{ $ne: ['$grnStatus', GRN_STATUS.CANCELLED] }, '$totalReceivedQty', 0] } },
          pendingQty:      { $sum: { $cond: [{ $ne: ['$grnStatus', GRN_STATUS.CANCELLED] }, { $subtract: ['$totalOrderedQty', '$totalReceivedQty'] }, 0] } },
        },
      },
    ]);
    return rows[0] || { total: 0, partialReceived: 0, fullyReceived: 0, draft: 0, cancelled: 0, receivedQty: 0, pendingQty: 0 };
  },

  async update(id, data, user) {
    const grn = await findOrThrow(id);
    if (grn.approvalStatus === 'MD_APPROVED') {
      grn.activityTimeline.push({ action: 'EDIT_BLOCKED', description: 'Edit blocked — GRN is MD-signed and locked', actorId: user?._id });
      await grn.save();
      throw new AppError('This GRN has been digitally signed by the MD and is locked for editing', 400);
    }
    if (!isOpenDraft(grn)) throw new AppError('Only draft GRNs can be edited', 400);
    const { items, challanDocument, invoiceDocument, ...rest } = data;
    Object.assign(grn, rest);
    if (challanDocument) grn.challanDocument = challanDocument.fileUrl ? { ...challanDocument, uploadedAt: new Date() } : {};
    if (invoiceDocument) grn.invoiceDocument = invoiceDocument.fileUrl ? { ...invoiceDocument, uploadedAt: new Date() } : {};
    if (items) {
      await assertPurchasable(items);
      const { lines, totals } = computeLines(items);
      grn.items = lines;
      Object.assign(grn, totals);
    }
    grn.updatedBy = user?._id;
    grn.activityTimeline.push({ action: 'UPDATE', description: 'Draft GRN updated', actorId: user?._id });
    return saveOpenDraft(grn);
  },

  async remove(id, user) {
    const grn = await findOrThrow(id);
    if (!isOpenDraft(grn)) {
      throw new AppError('Only draft GRNs can be deleted', 400);
    }
    grn.isDeleted = true;
    grn.deletedAt = new Date();
    grn.deletedBy = user?._id;
    grn.activityTimeline.push({ action: 'DELETE', description: 'GRN deleted', actorId: user?._id });
    return saveOpenDraft(grn);
  },

  /**
   * Complete a GRN: post stock via inventoryService, update PO + PI quantities,
   * roll receipt status, generate the GRN PDF, and leave qcStatus PENDING for
   * Step 1.9 Incoming QC. Idempotent: the draft is claimed atomically (DRAFT +
   * stockPosted:false → stockPosted:true) before anything is posted, so of two
   * concurrent/double-submitted completes only one can ever post stock.
   */
  async complete(id, data, user) {
    const grn = await GoodsReceiptNote.findOneAndUpdate(
      { _id: id, isDeleted: { $ne: true }, ...OPEN_DRAFT_FILTER },
      { $set: { stockPosted: true } },
      { new: true },
    );
    if (!grn) {
      const current = await findOrThrow(id);
      if (current.grnStatus !== GRN_STATUS.DRAFT) throw new AppError('Only draft GRNs can be completed', 400);
      throw new AppError('Stock already posted for this GRN', 400);
    }
    // Hand the draft back (still DRAFT, editable) when completion fails before
    // any stock landed, so the user can correct it and complete again.
    const releaseClaim = () => GoodsReceiptNote.updateOne(
      { _id: grn._id, grnStatus: GRN_STATUS.DRAFT },
      { $set: { stockPosted: false } },
    );

    const existing = await inventoryService.getMovementsByRef('GRN', grn._id);
    if (existing.length) throw new AppError('Inventory movements already exist for this GRN', 400);

    let po; let pi; let receivedLines;
    try {
      po = await VendorPurchaseOrder.findOne({ _id: grn.poId, isDeleted: { $ne: true } });
      if (!po) throw new AppError('Linked Purchase Order not found', 404);

      receivedLines = grn.items.filter((it) => round2(it.receivedQty) > 0);
      if (!receivedLines.length) throw new AppError('Enter a received quantity on at least one item', 400);

      // Rule 6: extra receipt requires remarks.
      const extraNoRemarks = receivedLines.find((l) => round2(l.extraQty) > 0 && !(l.remarks || data.remarks || grn.remarks));
      if (extraNoRemarks) {
        throw new AppError(`"${extraNoRemarks.itemName}" was received over the ordered qty — remarks are required for extra receipt`, 400);
      }

      // Every received line must resolve to a SKU (stock cannot be posted otherwise).
      for (const line of receivedLines) {
        if (!line.skuId && line.skuCode) {
          const sku = await SKU.findOne({ code: String(line.skuCode).trim().toUpperCase() }).select('_id').lean();
          if (sku) line.skuId = sku._id;
        }
        if (!line.skuId) throw new AppError(`"${line.itemName}" is not linked to a SKU — add it to the SKU master before receiving`, 400);
      }

      pi = grn.piId ? await ProformaInvoice.findOne({ _id: grn.piId, isDeleted: { $ne: true } }) : null;
    } catch (err) {
      await releaseClaim();
      throw err;
    }

    // ── 1) Post stock — strictly through inventoryService, all lines or none ──
    try {
      await inventoryService.runAtomically(async (session) => {
        for (const line of receivedLines) {
          const { movement } = await inventoryService.increaseStock({
            skuId: line.skuId, skuCode: line.skuCode, skuName: line.itemName, unit: line.unit,
            warehouse: grn.warehouse,
            quantity: round2(line.receivedQty),
            unitCost: round2(line.rate),
            txnType: 'GRN_IN', sourceModule: 'PURCHASE_FMS',
            refType: 'GRN', refId: grn._id, refNumber: grn.grnNumber,
            batchNo: line.batchNo || '',
            vendorId: grn.vendorId, vendorName: grn.vendorName,
            poId: grn.poId, poNumber: grn.poNumber, piId: grn.piId, piNumber: grn.piNumber,
            remarks: 'Stock added from Purchase GRN',
            performedBy: user, movementDate: grn.grnDate,
          }, { session });
          line.movementId = movement._id;
          line.movementNumber = movement.movementNumber;
        }
      });
    } catch (err) {
      // Rolled back (or nothing written) → release the claim. If movements did
      // land (deployment without transactions), keep the GRN locked so a retry
      // can never post the same stock twice.
      const posted = await inventoryService.getMovementsByRef('GRN', grn._id).catch(() => [{}]);
      if (!posted.length) await releaseClaim();
      else logger.error(`[grn] ${grn.grnNumber}: stock posting failed part-way (${posted.length} movement(s) written) — GRN left locked: ${err.message}`);
      throw err;
    }

    for (const line of receivedLines) {
      // ── 2) PO line: receivedQty / pendingQty ──
      const poItem = po.items.find((p) => String(p._id) === String(line.poItemId))
        || po.items.find((p) => p.skuCode && line.skuCode && p.skuCode === line.skuCode);
      if (poItem) {
        poItem.receivedQty = round2((poItem.receivedQty || 0) + line.receivedQty);
        poItem.pendingQty = Math.max(0, round2((poItem.quantity || 0) - poItem.receivedQty));
      }

      // ── 3) PI line: receivedQty / balanceQty ──
      if (pi) {
        const piItem = pi.items.find((p) => p.skuCode && line.skuCode && p.skuCode === line.skuCode)
          || pi.items.find((p) => p.itemName === line.itemName);
        if (piItem) {
          piItem.receivedQty = round2((piItem.receivedQty || 0) + line.receivedQty);
          piItem.balanceQty = Math.max(0, round2((piItem.quantity || 0) - piItem.receivedQty));
        }
      }
    }

    // ── 4) Roll PO status (Rules 4 & 5) ──
    const poFullyReceived = po.items.every((p) => round2((p.quantity || 0) - (p.receivedQty || 0)) <= 0);
    po.poStatus = poFullyReceived ? PO_STATUS.FULLY_RECEIVED : PO_STATUS.PARTIAL_RECEIVED;
    po.updatedBy = user?._id;
    po.activityTimeline.push({ action: 'GRN_RECEIVED', description: `${grn.grnNumber} received (${grn.totalReceivedQty})`, actorId: user?._id });
    await po.save();
    if (pi) { pi.updatedBy = user?._id; await pi.save(); }

    // ── 5) Finalize GRN + QC handoff ──
    grn.grnStatus = poFullyReceived ? GRN_STATUS.FULLY_RECEIVED : GRN_STATUS.PARTIAL_RECEIVED;
    grn.qcStatus = GRN_QC_STATUS.PENDING; // ready for Step 1.9 Incoming QC
    grn.stockPosted = true;
    grn.receivedAt = new Date();
    grn.completedAt = new Date();
    grn.completedBy = user?.name || '';
    if (data.remarks) grn.remarks = data.remarks;
    grn.updatedBy = user?._id;
    grn.activityTimeline.push({ action: 'COMPLETE', description: `GRN completed — stock posted (${grn.grnStatus})`, actorId: user?._id });
    await grn.save();

    // ── 6) PDF (non-fatal) ──
    try {
      const { grnPdfUrl, grnPdfFileName } = await this.generatePdf(id);
      grn.grnPdfUrl = grnPdfUrl;
      grn.grnPdfFileName = grnPdfFileName;
    } catch (err) { logger.error(`[grn] PDF generation failed for ${grn.grnNumber}: ${err.message}`); }

    // ── 7) Ready for MD Approval (non-fatal) ──
    try {
      await approvalService.ensureReady({ documentType: 'GRN', documentId: grn._id, documentNumber: grn.grnNumber }, user);
    } catch (err) { logger.error(`[grn] approval ensureReady failed for ${grn.grnNumber}: ${err.message}`); }

    return grn;
  },

  /**
   * Render the GRN PDF from in-memory form data for an on-screen preview.
   * Pure read: resolves the PO only for the vendor snapshot + PO number, computes
   * the same lines/totals as create(), and returns the PDF buffer. Saves NOTHING —
   * no record, no status change, no inventory, no PDF upload. Mirrors create()'s
   * data assembly so the preview matches the final document.
   */
  async previewPdf(data, user) {
    let vendor = {
      vendorName: data.vendorName || '',
      vendorGST: data.vendorGST || '',
      vendorAddress: data.vendorAddress || '',
    };
    let poNumber = data.poNumber || '';
    if (data.poId) {
      const po = await VendorPurchaseOrder.findOne({ _id: data.poId, isDeleted: { $ne: true } }).lean();
      if (po) {
        vendor = { vendorName: po.vendorName, vendorGST: po.vendorGST, vendorAddress: po.vendorAddress, vendorPhone: po.vendorPhone };
        poNumber = po.poNumber || poNumber;
      }
    }

    const { lines, totals } = computeLines(data.items || []);
    const grnLike = {
      grnNumber: data.grnNumber || '(draft — generated on completion)',
      grnDate: data.grnDate || new Date(),
      poNumber,
      challanNumber: data.challanNumber || '',
      invoiceNumber: data.invoiceNumber || '',
      howItemReceived: data.howItemReceived || HOW_ITEM_RECEIVED.FULL_MATERIAL_RECEIVED,
      receivedBy: data.receivedBy || user?.name || '',
      preparedBy: data.preparedBy || user?.name || '',
      remarks: data.remarks || '',
      ...vendor,
      items: lines,
      ...totals,
    };

    let company = {};
    try {
      const CompanySettings = (await import('../../pricing/company-settings.model.js')).default;
      const s = await CompanySettings.findOne().lean();
      if (s) company = { name: s.companyName, address: s.companyAddress, gstin: s.companyGstin, email: s.companyEmail };
    } catch { /* env fallback */ }

    return buildGrnPdfBuffer(grnLike, company);
  },

  async generatePdf(id) {
    const grn = await GoodsReceiptNote.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!grn) throw new AppError('GRN not found', 404);

    // MD-signed GRNs are locked — the signed PDF lives in DocumentApproval and is
    // mirrored onto grnPdfUrl/grnPdfFileName by the approval engine. Never
    // re-render an unsigned copy over it; just hand back what's already stored.
    if (grn.approvalStatus === 'MD_APPROVED') {
      return { grnPdfUrl: grn.grnPdfUrl, grnPdfFileName: grn.grnPdfFileName };
    }

    let company = {};
    try {
      const CompanySettings = (await import('../../pricing/company-settings.model.js')).default;
      const s = await CompanySettings.findOne().lean();
      if (s) company = { name: s.companyName, address: s.companyAddress, gstin: s.companyGstin, email: s.companyEmail };
    } catch { /* env fallback */ }

    const buffer = await buildGrnPdfBuffer(grn, company);
    const fileName = `${String(grn.grnNumber || 'GRN').replace(/[^\w.-]/g, '_')}.pdf`;
    let grnPdfUrl;
    if (s3Enabled) {
      const key = buildKey('grns', fileName);
      await uploadBuffer({ buffer, key, contentType: 'application/pdf' });
      grnPdfUrl = `${SERVER_BASE}/api/v1/uploads/file?key=${encodeURIComponent(key)}`;
    } else {
      const dir = path.resolve(process.cwd(), 'uploads', 'grns');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fp = path.join(dir, `${Date.now()}-${fileName}`);
      fs.writeFileSync(fp, buffer);
      grnPdfUrl = `${SERVER_BASE}/uploads/grns/${path.basename(fp)}`;
    }
    await GoodsReceiptNote.updateOne({ _id: id }, { $set: { grnPdfUrl, grnPdfFileName: fileName } });
    return { grnPdfUrl, grnPdfFileName: fileName };
  },

  async cancel(id, data, user) {
    const grn = await findOrThrow(id);
    if (grn.approvalStatus === 'MD_APPROVED') {
      grn.activityTimeline.push({ action: 'EDIT_BLOCKED', description: 'Cancel blocked — GRN is MD-signed and locked', actorId: user?._id });
      await grn.save();
      throw new AppError('This GRN has been digitally signed by the MD and cannot be cancelled', 400);
    }
    if ([GRN_STATUS.PARTIAL_RECEIVED, GRN_STATUS.FULLY_RECEIVED].includes(grn.grnStatus) || grn.stockPosted) {
      throw new AppError('A completed GRN cannot be cancelled (stock already posted)', 400);
    }
    if (grn.grnStatus === GRN_STATUS.CANCELLED) throw new AppError('GRN is already cancelled', 400);
    grn.grnStatus = GRN_STATUS.CANCELLED;
    if (data.remarks) grn.remarks = data.remarks;
    grn.updatedBy = user?._id;
    grn.activityTimeline.push({ action: 'CANCEL', description: 'GRN cancelled', actorId: user?._id });
    return saveOpenDraft(grn);
  },
};
