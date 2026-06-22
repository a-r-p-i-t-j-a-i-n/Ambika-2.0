import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import IncomingQC, { QC_STATUS, QC_RESULT, QC_SOURCE_TYPE } from './incomingQc.model.js';
import GoodsReceiptNote, { GRN_STATUS, GRN_QC_STATUS } from '../grn/grn.model.js';
import ServiceCompletion, { SERVICE_COMPLETION_STATUS, SERVICE_QC_STATUS } from '../service-completion/serviceCompletion.model.js';
import PurchaseIndent, { INDENT_OVERALL_STATUS } from '../indent/indent.model.js';
import { inventoryService } from '../../inventory/inventory.service.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generateQcNumber } from '../../../utils/docNumberGenerator.js';
import { s3Enabled, buildKey, uploadBuffer } from '../../../common/uploads/s3.service.js';
import { logger } from '../../../utils/logger.js';
import env from '../../../config/env.js';

const SERVER_BASE = (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const GRN_QC_ELIGIBLE = [GRN_STATUS.RECEIVED, GRN_STATUS.PARTIAL_RECEIVED, GRN_STATUS.FULLY_RECEIVED];

const findOrThrow = async (id) => {
  const qc = await IncomingQC.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!qc) throw new AppError('Incoming QC not found', 404);
  return qc;
};

const computeTotals = (items = []) => {
  const lines = items.map((it) => ({
    ...it,
    receivedQty: round2(it.receivedQty),
    acceptedQty: round2(it.acceptedQty),
    rejectedQty: round2(it.rejectedQty),
    reworkQty: round2(it.reworkQty),
  }));
  return {
    lines,
    totals: {
      totalReceived: round2(lines.reduce((s, l) => s + l.receivedQty, 0)),
      totalAccepted: round2(lines.reduce((s, l) => s + l.acceptedQty, 0)),
      totalRejected: round2(lines.reduce((s, l) => s + l.rejectedQty, 0)),
      totalRework:   round2(lines.reduce((s, l) => s + l.reworkQty, 0)),
    },
  };
};

/** Derive QC status + overall result from the line splits. */
const deriveResult = (items = []) => {
  const allAccepted = items.every((it) => round2(it.acceptedQty) === round2(it.receivedQty) && round2(it.rejectedQty) === 0 && round2(it.reworkQty) === 0);
  const allRejected = items.every((it) => round2(it.rejectedQty) === round2(it.receivedQty) && round2(it.acceptedQty) === 0);
  if (allAccepted) return { qcStatus: QC_STATUS.PASSED, overallResult: QC_RESULT.PASS };
  if (allRejected) return { qcStatus: QC_STATUS.FAILED, overallResult: QC_RESULT.FAIL };
  return { qcStatus: QC_STATUS.PARTIAL, overallResult: QC_RESULT.PARTIAL_PASS };
};

// ─────────────────────────────────────────────────────────────
// PDF — Incoming QC Report
// ─────────────────────────────────────────────────────────────
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export const buildQcPdfBuffer = (qc, company = {}) => new Promise((resolve, reject) => {
  try {
    const M = 40;
    const doc = new PDFDocument({ size: 'A4', margin: M });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const W = 595.28 - M * 2;
    const navy = '#0b2545'; const blue = '#1d4ed8'; const line = '#dbe4f3';

    doc.rect(0, 0, 595.28, 78).fill(navy);
    doc.fill('#ffffff').font('Helvetica-Bold').fontSize(17).text(company.name || env.COMPANY_NAME, M, 16);
    doc.font('Helvetica').fontSize(8.5).fill('#cdd9f0')
      .text([company.address || env.COMPANY_ADDRESS, company.gstin ? `GSTIN: ${company.gstin}` : ''].filter(Boolean).join('   •   '), M, 40, { width: W - 170 });
    doc.font('Helvetica-Bold').fontSize(13).fill('#ffffff').text('INCOMING QC REPORT', M, 36, { width: W, align: 'right' });

    let y = 96;
    doc.roundedRect(M, y, W, 56, 6).stroke(line);
    doc.font('Helvetica-Bold').fontSize(11).fill(navy).text(qc.qcNumber || '', M + 10, y + 9);
    doc.font('Helvetica').fontSize(8.5).fill(navy)
      .text(`Date: ${fmtDate(qc.qcDate)}    GRN: ${qc.grnNumber || '—'}    PO: ${qc.poNumber || '—'}`, M + 10, y + 26)
      .text(`Supplier: ${qc.vendorName || '—'}`, M + 10, y + 39);
    y += 70;

    const cols = [
      { key: 'name', label: 'ITEM', w: 150, align: 'left' },
      { key: 'recd', label: 'RECD', w: 50, align: 'right' },
      { key: 'acc', label: 'ACCEPTED', w: 65, align: 'right' },
      { key: 'rej', label: 'REJECTED', w: 65, align: 'right' },
      { key: 'rew', label: 'REWORK', w: 55, align: 'right' },
      { key: 'defect', label: 'DEFECT', w: 70, align: 'left' },
      { key: 'sev', label: 'SEVERITY', w: W - 150 - 50 - 65 - 65 - 55 - 70, align: 'center' },
    ];
    const drawHead = () => {
      doc.rect(M, y, W, 20).fill(navy);
      let x = M; doc.font('Helvetica-Bold').fontSize(7).fill('#ffffff');
      cols.forEach((c) => { doc.text(c.label, x + 4, y + 6.5, { width: c.w - 8, align: c.align }); x += c.w; });
      y += 20;
    };
    drawHead();
    doc.font('Helvetica').fontSize(8).fill(navy);
    (qc.items || []).forEach((it, i) => {
      if (y > 720) { doc.addPage(); y = M; drawHead(); doc.font('Helvetica').fontSize(8).fill(navy); }
      const rowH = 18;
      if (i % 2 === 1) doc.rect(M, y, W, rowH).fill('#f8fafc');
      doc.fill(navy);
      let x = M;
      const cells = { name: it.itemName, recd: String(it.receivedQty || 0), acc: String(it.acceptedQty || 0), rej: String(it.rejectedQty || 0), rew: String(it.reworkQty || 0), defect: it.defectType || '—', sev: it.defectSeverity || '—' };
      cols.forEach((c) => { doc.text(cells[c.key], x + 4, y + 5, { width: c.w - 8, align: c.align, ellipsis: true }); x += c.w; });
      doc.moveTo(M, y + rowH).lineTo(M + W, y + rowH).strokeColor(line).lineWidth(0.5).stroke();
      y += rowH;
    });

    y += 16;
    if (y > 700) { doc.addPage(); y = M; }
    doc.font('Helvetica-Bold').fontSize(10).fill(navy).text(`Overall Result: ${(qc.overallResult || '').replace(/_/g, ' ') || '—'}`, M, y);
    doc.font('Helvetica').fontSize(8.5).text(`Accepted ${qc.totalAccepted} · Rejected ${qc.totalRejected} · Rework ${qc.totalRework} of ${qc.totalReceived} received`, M, y + 16);
    if (qc.remarks) doc.text(`Remarks: ${qc.remarks}`, M, y + 30, { width: W - 180 });
    doc.font('Helvetica-Bold').fontSize(9).text(`Checked By: ${qc.checkedByName || '—'}`, M + W - 180, y + 8, { width: 180, align: 'center' });
    doc.font('Helvetica').fontSize(8).text(`Prepared By: ${qc.preparedBy || '—'}`, M + W - 180, y + 30, { width: 180, align: 'center' });

    doc.end();
  } catch (err) { reject(err); }
});

export const incomingQcService = {
  // QC from a completed internal service — no goods, no inventory, quality only.
  async createFromService(data, user) {
    const sc = await ServiceCompletion.findOne({ _id: data.serviceCompletionId, isDeleted: { $ne: true } });
    if (!sc) throw new AppError('Service completion not found', 404);
    if (sc.status !== SERVICE_COMPLETION_STATUS.COMPLETED) {
      throw new AppError('Incoming QC can only be created for a completed service', 400);
    }
    if (sc.qcStatus !== SERVICE_QC_STATUS.PENDING) {
      throw new AppError('This service has already been QC-checked', 400);
    }
    const existing = await IncomingQC.findOne({ serviceCompletionId: sc._id, isDeleted: { $ne: true }, qcStatus: { $ne: QC_STATUS.CANCELLED } }).lean();
    if (existing) throw new AppError(`A QC (${existing.qcNumber}) already exists for this service`, 400);

    // Load the indent's items so the inspection table is populated (no goods, no
    // inventory — these are the requested service line items, all accepted by default).
    const indent = await PurchaseIndent.findOne({ _id: sc.indentId, isDeleted: { $ne: true } }).lean();
    const indentItems = indent?.items?.length
      ? indent.items
      : (indent?.productNameRevised
        ? [{ itemName: indent.productNameRevised, skuCode: indent.skuCode, skuId: indent.skuId, unit: indent.unit, quantity: indent.quantity, approvedQuantity: indent.approvedQuantity }]
        : []);
    const sourceItems = indentItems.map((it) => {
      const qty = round2(it.approvedQuantity || it.revisedQuantity || it.quantity || 0);
      return {
        skuId: it.skuId || undefined,
        skuCode: it.skuCode || '',
        itemName: it.itemName || 'Service',
        unit: it.unit || 'Pcs',
        receivedQty: qty,        // requested qty (label "Requested" in the UI for service)
        acceptedQty: qty,        // default all accepted
        rejectedQty: 0, reworkQty: 0,
        defectType: '', defectSeverity: '', qcRemarks: '',
      };
    });
    const { lines, totals } = computeTotals(sourceItems);

    const qcNumber = await generateQcNumber(data.qcDate || new Date());
    const qc = await IncomingQC.create({
      qcNumber,
      qcDate: data.qcDate || new Date(),
      sourceType: QC_SOURCE_TYPE.SERVICE,
      serviceCompletionId: sc._id, serviceCompletionNumber: sc.scNumber,
      indentId: sc.indentId, indentNumber: sc.indentNumber,
      vendorId: sc.vendorId, vendorName: sc.vendorName,
      checkedBy: user?._id, checkedByName: data.checkedByName || user?.name || '',
      preparedBy: data.preparedBy || user?.name || '',
      qcStatus: QC_STATUS.DRAFT,
      qcReportDocument: data.qcReportDocument?.fileUrl ? { ...data.qcReportDocument, uploadedAt: new Date() } : undefined,
      photos: data.photos || [],
      items: lines,
      ...totals,
      remarks: data.remarks || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `Service QC created for ${sc.scNumber}`, actorId: user?._id }],
    });
    return qc;
  },

  async create(data, user) {
    // Route to the service-source path when a service completion is referenced.
    if (data.serviceCompletionId) return this.createFromService(data, user);

    const grn = await GoodsReceiptNote.findOne({ _id: data.grnId, isDeleted: { $ne: true } });
    if (!grn) throw new AppError('GRN not found', 404);

    // Rule 1 & 2: only from a completed GRN that is still QC-pending; no standalone QC.
    if (!GRN_QC_ELIGIBLE.includes(grn.grnStatus) || grn.qcStatus !== GRN_QC_STATUS.PENDING) {
      throw new AppError('Incoming QC can only be created for a completed GRN with QC pending', 400);
    }
    const existing = await IncomingQC.findOne({ grnId: grn._id, isDeleted: { $ne: true }, qcStatus: { $ne: QC_STATUS.CANCELLED } }).lean();
    if (existing) throw new AppError(`A QC (${existing.qcNumber}) already exists for this GRN`, 400);

    // Rule 3: auto-load received lines from the GRN (default all accepted).
    const sourceItems = data.items?.length ? data.items : (grn.items || [])
      .filter((it) => round2(it.receivedQty) > 0)
      .map((it) => ({
        grnItemId: it._id, skuId: it.skuId, skuCode: it.skuCode, itemName: it.itemName, unit: it.unit,
        batchNo: it.batchNo || '', receivedQty: it.receivedQty, shortQty: it.shortQty || 0,
        acceptedQty: it.receivedQty, rejectedQty: 0, reworkQty: 0,
      }));
    if (!sourceItems.length) throw new AppError('This GRN has no received items to inspect', 400);

    const { lines, totals } = computeTotals(sourceItems);
    const qcNumber = await generateQcNumber(data.qcDate || new Date());

    const qc = await IncomingQC.create({
      qcNumber,
      qcDate: data.qcDate || new Date(),
      grnId: grn._id, grnNumber: grn.grnNumber,
      poId: grn.poId, poNumber: grn.poNumber,
      piId: grn.piId, piNumber: grn.piNumber,
      indentId: grn.indentId, indentNumber: grn.indentNumber,
      vendorId: grn.vendorId, vendorName: grn.vendorName,
      warehouse: grn.warehouse || 'MAIN',
      checkedBy: user?._id, checkedByName: data.checkedByName || user?.name || '',
      preparedBy: data.preparedBy || user?.name || '',
      qcStatus: QC_STATUS.DRAFT,
      qcReportDocument: data.qcReportDocument?.fileUrl ? { ...data.qcReportDocument, uploadedAt: new Date() } : undefined,
      photos: data.photos || [],
      items: lines,
      ...totals,
      remarks: data.remarks || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `QC created for ${grn.grnNumber}`, actorId: user?._id }],
    });
    return qc;
  },

  async getAll(query) {
    const features = new ApiFeatures(IncomingQC.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['qcNumber', 'grnNumber', 'poNumber', 'vendorName'])
      .sort().select().paginate();
    return features.exec();
  },

  async getById(id) {
    const qc = await IncomingQC.findOne({ _id: id, isDeleted: { $ne: true } }).populate('createdBy', 'name').lean();
    if (!qc) throw new AppError('Incoming QC not found', 404);
    return qc;
  },

  async getByGrn(grnId) {
    return IncomingQC.find({ grnId, isDeleted: { $ne: true } }).sort('-createdAt').lean();
  },

  async getStats() {
    const rows = await IncomingQC.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total:   { $sum: 1 },
          pending: { $sum: { $cond: [{ $in: ['$qcStatus', [QC_STATUS.DRAFT, QC_STATUS.IN_PROGRESS]] }, 1, 0] } },
          passed:  { $sum: { $cond: [{ $eq: ['$qcStatus', QC_STATUS.PASSED] }, 1, 0] } },
          failed:  { $sum: { $cond: [{ $eq: ['$qcStatus', QC_STATUS.FAILED] }, 1, 0] } },
          partial: { $sum: { $cond: [{ $eq: ['$qcStatus', QC_STATUS.PARTIAL] }, 1, 0] } },
        },
      },
    ]);
    return rows[0] || { total: 0, pending: 0, passed: 0, failed: 0, partial: 0 };
  },

  async update(id, data, user) {
    const qc = await findOrThrow(id);
    if (![QC_STATUS.DRAFT, QC_STATUS.IN_PROGRESS].includes(qc.qcStatus)) {
      throw new AppError('Only draft / in-progress QC can be edited', 400);
    }
    const { items, qcReportDocument, ...rest } = data;
    Object.assign(qc, rest);
    if (qcReportDocument) qc.qcReportDocument = qcReportDocument.fileUrl ? { ...qcReportDocument, uploadedAt: new Date() } : {};
    if (items) {
      const { lines, totals } = computeTotals(items);
      qc.items = lines;
      Object.assign(qc, totals);
      if (qc.qcStatus === QC_STATUS.DRAFT) qc.qcStatus = QC_STATUS.IN_PROGRESS;
    }
    qc.updatedBy = user?._id;
    qc.activityTimeline.push({ action: 'UPDATE', description: 'QC updated', actorId: user?._id });
    return qc.save();
  },

  /**
   * Complete QC: validate qty splits, derive result, move rejected qty OUT of
   * stock via inventoryService, update the GRN qcStatus, generate the report.
   * Idempotent (status guard + stockPosted + movement check).
   */
  async complete(id, data, user) {
    const qc = await findOrThrow(id);
    // Rule 9: cannot complete twice.
    if ([QC_STATUS.PASSED, QC_STATUS.FAILED, QC_STATUS.PARTIAL].includes(qc.qcStatus) || qc.stockPosted) {
      throw new AppError('QC is already completed', 400);
    }
    if (qc.qcStatus === QC_STATUS.CANCELLED) throw new AppError('Cannot complete a cancelled QC', 400);

    // Service QC — quality validation only. No goods, no inventory movement, no
    // item-balance. The result MUST be chosen by the user (no silent default).
    if (qc.sourceType === QC_SOURCE_TYPE.SERVICE) {
      const result = data.overallResult;
      if (!result) throw new AppError('Service QC result (Pass / Fail / Partial) is required', 400);

      const completedAt = new Date();
      qc.qcStatus = result === QC_RESULT.PASS ? QC_STATUS.PASSED
        : result === QC_RESULT.FAIL ? QC_STATUS.FAILED
        : QC_STATUS.PARTIAL;
      qc.overallResult = result;
      qc.stockPosted = true; // terminal marker — nothing to post for a service
      qc.completedAt = completedAt;
      if (data.remarks) qc.remarks = data.remarks;
      qc.updatedBy = user?._id;
      qc.activityTimeline.push({ action: 'COMPLETE', description: `Service QC completed — ${result}`, actorId: user?._id });
      await qc.save();

      // Mirror onto the service completion.
      const scQc = result === QC_RESULT.PASS ? SERVICE_QC_STATUS.PASSED
        : result === QC_RESULT.FAIL ? SERVICE_QC_STATUS.FAILED
        : SERVICE_QC_STATUS.PARTIAL;
      try {
        await ServiceCompletion.updateOne({ _id: qc.serviceCompletionId }, { $set: { qcStatus: scQc, qcId: qc._id, qcNumber: qc.qcNumber, qcCompletedAt: completedAt } });
      } catch (err) { logger.error(`[qc] service-completion update failed: ${err.message}`); }

      // Reflect the QC verdict on the indent.
      const indentStatus = result === QC_RESULT.PASS ? INDENT_OVERALL_STATUS.SERVICE_QC_PASSED
        : result === QC_RESULT.FAIL ? INDENT_OVERALL_STATUS.SERVICE_QC_FAILED
        : INDENT_OVERALL_STATUS.SERVICE_QC_PARTIAL;
      try {
        await PurchaseIndent.updateOne(
          { _id: qc.indentId },
          { $set: { overallStatus: indentStatus }, $push: { activityTimeline: { action: 'SERVICE_QC', description: `Service QC ${result}`, actorId: user?._id, timestamp: new Date() } } },
        );
      } catch (err) { logger.error(`[qc] indent status update failed: ${err.message}`); }

      try {
        const { qcPdfUrl, qcPdfFileName } = await this.generatePdf(id);
        qc.qcPdfUrl = qcPdfUrl;
        qc.qcPdfFileName = qcPdfFileName;
      } catch (err) { logger.error(`[qc] PDF generation failed for ${qc.qcNumber}: ${err.message}`); }

      return qc;
    }

    // Rule 4: accepted + rejected + rework must equal receivedQty per item.
    for (const it of qc.items) {
      const sum = round2(round2(it.acceptedQty) + round2(it.rejectedQty) + round2(it.reworkQty));
      if (sum !== round2(it.receivedQty)) {
        throw new AppError(`"${it.itemName}": accepted + rejected + rework (${sum}) must equal received (${it.receivedQty})`, 400);
      }
    }

    const existing = await inventoryService.getMovementsByRef('INCOMING_QC', qc._id);
    if (existing.length) throw new AppError('Inventory movements already exist for this QC', 400);

    // Rule 5: derive result.
    const { qcStatus, overallResult } = deriveResult(qc.items);

    // Rule 6 & 7: rejected qty → decreaseStock (accepted stays; rework held).
    for (const it of qc.items) {
      const rejected = round2(it.rejectedQty);
      if (rejected > 0 && it.skuId) {
        const { movement } = await inventoryService.decreaseStock({
          skuId: it.skuId, skuCode: it.skuCode, skuName: it.itemName, unit: it.unit,
          warehouse: qc.warehouse,
          quantity: rejected,
          txnType: 'QC_REJECT_OUT', sourceModule: 'PURCHASE_FMS',
          refType: 'INCOMING_QC', refId: qc._id, refNumber: qc.qcNumber,
          batchNo: it.batchNo || '',
          vendorId: qc.vendorId, vendorName: qc.vendorName,
          poId: qc.poId, poNumber: qc.poNumber, piId: qc.piId, piNumber: qc.piNumber,
          remarks: 'Stock moved out due to incoming QC rejection',
          performedBy: user, movementDate: qc.qcDate,
        }, { allowNegative: true });
        it.inventoryMovementId = movement._id;
        it.inventoryMovementNumber = movement.movementNumber;
      }
    }

    qc.qcStatus = qcStatus;
    qc.overallResult = overallResult;
    qc.stockPosted = true;
    qc.completedAt = new Date();
    if (data.remarks) qc.remarks = data.remarks;
    qc.updatedBy = user?._id;
    qc.activityTimeline.push({ action: 'COMPLETE', description: `QC completed — ${overallResult}`, actorId: user?._id });
    await qc.save();

    // Rule 8: update the GRN qcStatus + linkage.
    const grnQcStatus = qcStatus === QC_STATUS.PASSED ? GRN_QC_STATUS.PASSED
      : qcStatus === QC_STATUS.FAILED ? GRN_QC_STATUS.FAILED
      : GRN_QC_STATUS.PARTIAL;
    try {
      await GoodsReceiptNote.updateOne(
        { _id: qc.grnId },
        { $set: { qcStatus: grnQcStatus, qcId: qc._id, qcNumber: qc.qcNumber, qcCompletedAt: new Date() } },
      );
    } catch (err) { logger.error(`[qc] GRN update failed for ${qc.grnId}: ${err.message}`); }

    // PDF (non-fatal).
    try {
      const { qcPdfUrl, qcPdfFileName } = await this.generatePdf(id);
      qc.qcPdfUrl = qcPdfUrl;
      qc.qcPdfFileName = qcPdfFileName;
    } catch (err) { logger.error(`[qc] PDF generation failed for ${qc.qcNumber}: ${err.message}`); }

    return qc;
  },

  async generatePdf(id) {
    const qc = await IncomingQC.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!qc) throw new AppError('Incoming QC not found', 404);
    let company = {};
    try {
      const CompanySettings = (await import('../../pricing/company-settings.model.js')).default;
      const s = await CompanySettings.findOne().lean();
      if (s) company = { name: s.companyName, address: s.companyAddress, gstin: s.companyGstin };
    } catch { /* env fallback */ }

    const buffer = await buildQcPdfBuffer(qc, company);
    const fileName = `${String(qc.qcNumber || 'QC').replace(/[^\w.-]/g, '_')}.pdf`;
    let qcPdfUrl;
    if (s3Enabled) {
      const key = buildKey('incoming-qc', fileName);
      await uploadBuffer({ buffer, key, contentType: 'application/pdf' });
      qcPdfUrl = `${SERVER_BASE}/api/v1/uploads/file?key=${encodeURIComponent(key)}`;
    } else {
      const dir = path.resolve(process.cwd(), 'uploads', 'incoming-qc');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fp = path.join(dir, `${Date.now()}-${fileName}`);
      fs.writeFileSync(fp, buffer);
      qcPdfUrl = `${SERVER_BASE}/uploads/incoming-qc/${path.basename(fp)}`;
    }
    await IncomingQC.updateOne({ _id: id }, { $set: { qcPdfUrl, qcPdfFileName: fileName } });
    return { qcPdfUrl, qcPdfFileName: fileName };
  },

  async cancel(id, data, user) {
    const qc = await findOrThrow(id);
    if (![QC_STATUS.DRAFT, QC_STATUS.IN_PROGRESS].includes(qc.qcStatus)) {
      throw new AppError('Only draft / in-progress QC can be cancelled', 400);
    }
    qc.qcStatus = QC_STATUS.CANCELLED;
    qc.cancelledAt = new Date();
    if (data.remarks) qc.remarks = data.remarks;
    qc.updatedBy = user?._id;
    qc.activityTimeline.push({ action: 'CANCEL', description: 'QC cancelled', actorId: user?._id });
    return qc.save();
  },
};
