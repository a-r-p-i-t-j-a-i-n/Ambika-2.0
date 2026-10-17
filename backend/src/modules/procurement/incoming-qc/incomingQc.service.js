import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import IncomingQC, { QC_STATUS, QC_RESULT, QC_SOURCE_TYPE } from './incomingQc.model.js';
import GoodsReceiptNote, { GRN_STATUS, GRN_QC_STATUS } from '../grn/grn.model.js';
import ServiceCompletion, { SERVICE_COMPLETION_STATUS, SERVICE_QC_STATUS } from '../service-completion/serviceCompletion.model.js';
import PurchaseIndent, { INDENT_OVERALL_STATUS, INDENT_REQUEST_TYPE } from '../indent/indent.model.js';
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

// ── Per-GRN QC lock ──────────────────────────────────────────────────────────
// Creating a QC was "is there one already? → create": two requests arriving
// together both saw "no" and both created. Completing two different QCs of one
// GRN (historical duplicates) had the same gap. Both now run while holding a
// short-lived lock on the GRN — the same pattern as the PO's grnPostingLockAt
// and the PI's advanceAllocationLockAt. The lock expires on its own, so a crash
// mid-request can never strand the GRN.
const GRN_QC_LOCK_TTL_MS = 2 * 60 * 1000;
const GRN_QC_LOCK_WAIT_MS = 3000;
const GRN_QC_LOCK_POLL_MS = 150;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Take the GRN's QC lock, waiting briefly for a concurrent holder. Returns the lock stamp, or null. */
export const acquireGrnQcLock = async (grnId, { waitMs = GRN_QC_LOCK_WAIT_MS } = {}) => {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const now = new Date();
    const res = await GoodsReceiptNote.updateOne(
      {
        _id: grnId,
        $or: [{ qcLockAt: null }, { qcLockAt: { $lt: new Date(now.getTime() - GRN_QC_LOCK_TTL_MS) } }],
      },
      { $set: { qcLockAt: now } },
    );
    if (res.modifiedCount === 1) return now;
    if (Date.now() >= deadline) return null;
    await sleep(GRN_QC_LOCK_POLL_MS);
  }
};

/** Release only the lock this request took (a stale one may have been re-taken by someone else). */
export const releaseGrnQcLock = (grnId, lockedAt) => GoodsReceiptNote.updateOne(
  { _id: grnId, qcLockAt: lockedAt },
  { $set: { qcLockAt: null } },
).catch((err) => logger.error(`[qc] failed to release QC lock on GRN ${grnId}: ${err.message}`));

const withGrnQcLock = async (grnId, work) => {
  const lockedAt = await acquireGrnQcLock(grnId);
  if (!lockedAt) throw new AppError('A QC for this GRN is being saved by another request right now. Please try again in a moment.', 409);
  try {
    return await work();
  } finally {
    await releaseGrnQcLock(grnId, lockedAt);
  }
};

const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const sameBatch = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();

/**
 * Where each REJECTED QC line's stock actually is. Pure.
 *
 * The rejection must leave from the stock the GRN actually posted — the line's
 * own GRN_IN receipt — never from the GRN's nominal store. The chain is:
 *
 *   QC line ─grnItemId→ GRN line ─movementId→ GRN_IN movement (warehouse, batch)
 *
 * A GRN line with no receipt posted no stock (e.g. Raw Material with "Add to RM
 * Stock" unticked), so its rejection has nothing to move out. Anything that
 * cannot be matched with certainty is reported as an error rather than guessed.
 *
 * @param qcItems   QC lines (rejectedQty, grnItemId, skuId, batchNo, itemName)
 * @param grnItems  the GRN's lines (_id, skuId, batchNo, movementId)
 * @param receipts  the GRN's GRN_IN movements (_id, skuId, batchNo, warehouse)
 * @returns {{ steps: object[], errors: string[] }}
 *   steps: { item, post: true, skuId, warehouse, batchNo, receiptId } | { item, post: false, reason: 'NOT_POSTED' }
 */
export const planRejectStockOut = ({ qcItems = [], grnItems = [], receipts = [] }) => {
  const steps = [];
  const errors = [];
  const claimedReceiptIds = new Set(grnItems.map((g) => g.movementId).filter(Boolean).map(String));

  for (const item of qcItems) {
    if (!(round2(item.rejectedQty) > 0)) continue;
    const name = item.itemName || item.skuCode || 'item';

    // 1) The GRN line this QC line inspected.
    let grnItem = grnItems.find((g) => sameId(g._id, item.grnItemId));
    if (!grnItem && !item.grnItemId) {
      const bySku = grnItems.filter((g) => sameId(g.skuId, item.skuId) && sameBatch(g.batchNo, item.batchNo));
      if (bySku.length === 1) [grnItem] = bySku;
    }
    if (!grnItem) { errors.push(`"${name}": cannot be matched to a line of its GRN`); continue; }

    // 2) That line's own receipt.
    let receipt = null;
    if (grnItem.movementId) {
      receipt = receipts.find((m) => sameId(m._id, grnItem.movementId));
      if (!receipt) { errors.push(`"${name}": its stock receipt (${grnItem.movementNumber || grnItem.movementId}) was not found`); continue; }
    } else {
      // Lines that predate the movementId link: find the receipt by SKU + batch,
      // among receipts no other line already owns. None → the line never posted.
      const candidates = receipts.filter((m) => !claimedReceiptIds.has(String(m._id))
        && sameId(m.skuId, grnItem.skuId) && sameBatch(m.batchNo, grnItem.batchNo));
      if (candidates.length > 1) { errors.push(`"${name}": more than one stock receipt matches — cannot tell which one to reverse`); continue; }
      [receipt] = candidates;
    }

    if (!receipt) { steps.push({ item, post: false, reason: 'NOT_POSTED' }); continue; }
    if (item.skuId && !sameId(receipt.skuId, item.skuId)) { errors.push(`"${name}": the SKU differs from its stock receipt`); continue; }
    // The receipt is the stock being reversed, so its SKU / store / batch are used as-is.
    steps.push({
      item, post: true, skuId: receipt.skuId, warehouse: receipt.warehouse, batchNo: receipt.batchNo || '', receiptId: receipt._id,
    });
  }
  return { steps, errors };
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

// Internal-service indents become QC-eligible once the quotation is approved
// (SERVICE_PENDING). SERVICE_COMPLETED is the legacy state left by the retired
// Service Completion step (1.8A) — still eligible so those indents can proceed.
export const SERVICE_QC_ELIGIBLE_INDENT_STATUSES = [
  INDENT_OVERALL_STATUS.SERVICE_PENDING,
  INDENT_OVERALL_STATUS.SERVICE_COMPLETED,
];

/** Why an indent cannot start a service QC, or null when it can. Pure. */
export const serviceQcBlocker = (indent, existingQc = null) => {
  if (!indent) return 'Indent not found';
  if (indent.requestType !== INDENT_REQUEST_TYPE.INTERNAL_SERVICE) return 'Service QC is only for internal-service indents';
  if (!SERVICE_QC_ELIGIBLE_INDENT_STATUSES.includes(indent.overallStatus)) return 'Approve the quotation before starting the service QC';
  if (existingQc) return `A QC (${existingQc.qcNumber}) already exists for this service`;
  return null;
};

export const incomingQcService = {
  // QC for an internal service — no goods, no inventory, quality only. Started
  // directly from the approved indent; a legacy Service Completion id is still
  // accepted and resolves to its indent.
  async createFromService(data, user) {
    let sc = null;
    let indentId = data.indentId;
    if (data.serviceCompletionId) {
      sc = await ServiceCompletion.findOne({ _id: data.serviceCompletionId, isDeleted: { $ne: true } });
      if (!sc) throw new AppError('Service completion not found', 404);
      if (sc.status !== SERVICE_COMPLETION_STATUS.COMPLETED) {
        throw new AppError('Incoming QC can only be created for a completed service', 400);
      }
      if (sc.qcStatus !== SERVICE_QC_STATUS.PENDING) {
        throw new AppError('This service has already been QC-checked', 400);
      }
      indentId = sc.indentId;
    }

    const indent = await PurchaseIndent.findOne({ _id: indentId, isDeleted: { $ne: true } }).lean();
    const existing = indent && await IncomingQC.findOne({
      indentId: indent._id, sourceType: QC_SOURCE_TYPE.SERVICE,
      isDeleted: { $ne: true }, qcStatus: { $ne: QC_STATUS.CANCELLED },
    }).lean();
    const blocker = serviceQcBlocker(indent, existing);
    if (blocker) throw new AppError(blocker, indent ? 400 : 404);

    // Keep the link to a legacy Service Completion recorded for this indent, if any.
    if (!sc) {
      sc = await ServiceCompletion.findOne({
        indentId: indent._id, isDeleted: { $ne: true }, status: { $ne: SERVICE_COMPLETION_STATUS.CANCELLED },
      });
    }

    // Load the indent's items so the inspection table is populated (no goods, no
    // inventory — these are the requested service line items, all accepted by default).
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

    // Service provider: legacy SC's provider, else the indent's vendor, else the
    // vendor approved on the quotation (Step 1.3).
    const approvedVendor = indent.quotationApprovalStep?.approvedVendors?.[0];
    const vendorId = sc?.vendorId || indent.vendorId || approvedVendor?.vendorId || undefined;
    const vendorName = sc?.vendorName || indent.vendorName || approvedVendor?.vendorName || '';

    const qcNumber = await generateQcNumber(data.qcDate || new Date());
    const qc = await IncomingQC.create({
      qcNumber,
      qcDate: data.qcDate || new Date(),
      sourceType: QC_SOURCE_TYPE.SERVICE,
      serviceCompletionId: sc?._id, serviceCompletionNumber: sc?.scNumber || '',
      indentId: indent._id, indentNumber: indent.indentNumber,
      vendorId, vendorName,
      checkedBy: user?._id, checkedByName: data.checkedByName || user?.name || '',
      preparedBy: data.preparedBy || user?.name || '',
      qcStatus: QC_STATUS.DRAFT,
      qcReportDocument: data.qcReportDocument?.fileUrl ? { ...data.qcReportDocument, uploadedAt: new Date() } : undefined,
      photos: data.photos || [],
      items: lines,
      ...totals,
      remarks: data.remarks || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `Service QC created for ${sc?.scNumber || indent.indentNumber}`, actorId: user?._id }],
    });
    return qc;
  },

  async create(data, user) {
    // Route to the service-source path for an internal-service indent (or a legacy service completion).
    if (data.indentId || data.serviceCompletionId) return this.createFromService(data, user);

    const grn = await GoodsReceiptNote.findOne({ _id: data.grnId, isDeleted: { $ne: true } });
    if (!grn) throw new AppError('GRN not found', 404);

    // Rule 1 & 2: only from a completed GRN that is still QC-pending; no standalone QC.
    if (!GRN_QC_ELIGIBLE.includes(grn.grnStatus) || grn.qcStatus !== GRN_QC_STATUS.PENDING) {
      throw new AppError('Incoming QC can only be created for a completed GRN with QC pending', 400);
    }
    // MD Digital Approval gate: the GRN must be MD Approved before QC can start.
    if (grn.approvalStatus !== 'MD_APPROVED') {
      throw new AppError('GRN must be MD Approved before Incoming QC can be created', 400);
    }

    // One QC per GRN: the duplicate check and the insert run under the GRN's QC
    // lock, so a concurrent request waits and then finds this QC instead of
    // creating a second one. Released on success and on failure alike.
    return withGrnQcLock(grn._id, () => this._createForGrnLocked(grn, data, user));
  },

  /** create() for a GRN — runs holding the GRN's QC lock. */
  async _createForGrnLocked(grn, data, user) {
    const existing = await IncomingQC.findOne({ grnId: grn._id, isDeleted: { $ne: true }, qcStatus: { $ne: QC_STATUS.CANCELLED } }).lean();
    if (existing) throw new AppError(`A QC (${existing.qcNumber}) already exists for this GRN`, 409);

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

  async remove(id, user) {
    const qc = await findOrThrow(id);
    if (![QC_STATUS.DRAFT, QC_STATUS.IN_PROGRESS].includes(qc.qcStatus)) {
      throw new AppError('Only draft or in-progress QC records can be deleted', 400);
    }
    qc.isDeleted = true;
    qc.deletedAt = new Date();
    qc.deletedBy = user?._id;
    qc.activityTimeline.push({ action: 'DELETE', description: 'Incoming QC deleted', actorId: user?._id });
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
      // Service report (evidence the work was done) — replaces the retired Service Completion upload.
      if (data.qcReportDocument?.fileUrl) qc.qcReportDocument = { ...data.qcReportDocument, uploadedAt: new Date() };
      qc.updatedBy = user?._id;
      qc.activityTimeline.push({ action: 'COMPLETE', description: `Service QC completed — ${result}`, actorId: user?._id });
      await qc.save();

      // Mirror onto the legacy service completion, when this QC has one.
      if (qc.serviceCompletionId) {
        const scQc = result === QC_RESULT.PASS ? SERVICE_QC_STATUS.PASSED
          : result === QC_RESULT.FAIL ? SERVICE_QC_STATUS.FAILED
          : SERVICE_QC_STATUS.PARTIAL;
        try {
          await ServiceCompletion.updateOne({ _id: qc.serviceCompletionId }, { $set: { qcStatus: scQc, qcId: qc._id, qcNumber: qc.qcNumber, qcCompletedAt: completedAt } });
        } catch (err) { logger.error(`[qc] service-completion update failed: ${err.message}`); }
      }

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

    if (!qc.grnId) throw new AppError('This QC is not linked to a GRN', 400);
    // Held through the GRN update, so two QCs of one GRN cannot complete together.
    await withGrnQcLock(qc.grnId, () => this._completeGrnQcLocked(qc, data, user, { qcStatus, overallResult }));

    // PDF (non-fatal).
    try {
      const { qcPdfUrl, qcPdfFileName } = await this.generatePdf(id);
      qc.qcPdfUrl = qcPdfUrl;
      qc.qcPdfFileName = qcPdfFileName;
    } catch (err) { logger.error(`[qc] PDF generation failed for ${qc.qcNumber}: ${err.message}`); }

    return qc;
  },

  /** complete() for a GRN QC — runs holding the GRN's QC lock. */
  async _completeGrnQcLocked(qc, data, user, { qcStatus, overallResult }) {
    // A GRN gets one QC result. A second (historical duplicate) draft must not
    // complete on top of it and move the rejected stock out again.
    const done = await IncomingQC.findOne({
      grnId: qc.grnId, _id: { $ne: qc._id }, isDeleted: { $ne: true },
      qcStatus: { $in: [QC_STATUS.PASSED, QC_STATUS.FAILED, QC_STATUS.PARTIAL] },
    }).select('qcNumber').lean();
    if (done) {
      throw new AppError(`This GRN already has a completed QC (${done.qcNumber}). ${qc.qcNumber} is a duplicate — cancel it instead of completing it.`, 409);
    }

    // Where each rejected line's stock really is: its own GRN_IN receipt.
    const grn = await GoodsReceiptNote.findById(qc.grnId).select('grnNumber items').lean();
    if (!grn) throw new AppError('The GRN for this QC was not found', 404);
    const receipts = (await inventoryService.getMovementsByRef('GRN', grn._id))
      .filter((m) => m.txnType === 'GRN_IN' && m.movementType === 'IN');
    const { steps, errors } = planRejectStockOut({ qcItems: qc.items, grnItems: grn.items || [], receipts });
    if (errors.length) {
      throw new AppError(`Cannot complete QC — the rejected stock cannot be traced to its receipt: ${errors.join('; ')}`, 409);
    }

    // Claim the completion atomically (same pattern as GRN complete): only the
    // request that flips stockPosted false→true posts the rejected-qty movements.
    // A double-click, retry or second tab is told it is already completed instead
    // of passing the checks above at the same moment and posting the stock-out twice.
    const claim = await IncomingQC.updateOne(
      { _id: qc._id, stockPosted: { $ne: true }, qcStatus: { $in: [QC_STATUS.DRAFT, QC_STATUS.IN_PROGRESS] } },
      { $set: { stockPosted: true } },
    );
    if (!claim.modifiedCount) throw new AppError('QC is already completed', 400);

    try {
      // Rule 6 & 7: rejected qty → decreaseStock (accepted stays; rework held),
      // from the store + batch its receipt posted to. Lines whose receipt never
      // posted (e.g. RM not added to RM stock) have no stock to move out.
      const notes = [];
      for (const step of steps) {
        const it = step.item;
        const rejected = round2(it.rejectedQty);
        if (!step.post) {
          notes.push(`${it.itemName}: ${rejected} rejected — no stock-out, the GRN never added this line to stock`);
          continue;
        }
        const { movement } = await inventoryService.decreaseStock({
          skuId: step.skuId, skuCode: it.skuCode, skuName: it.itemName, unit: it.unit,
          warehouse: step.warehouse,
          quantity: rejected,
          txnType: 'QC_REJECT_OUT', sourceModule: 'PURCHASE_FMS',
          refType: 'INCOMING_QC', refId: qc._id, refNumber: qc.qcNumber,
          batchNo: step.batchNo,
          vendorId: qc.vendorId, vendorName: qc.vendorName,
          poId: qc.poId, poNumber: qc.poNumber, piId: qc.piId, piNumber: qc.piNumber,
          remarks: 'Stock moved out due to incoming QC rejection',
          performedBy: user, movementDate: qc.qcDate,
        }, { allowNegative: true }); // unchanged policy for QC rejects — see below
        it.inventoryMovementId = movement._id;
        it.inventoryMovementNumber = movement.movementNumber;
        // Negative is still allowed (existing QC-reject rule), but never silent:
        // it means the material was used from that store before QC rejected it.
        if (round2(movement.balanceAfter) < 0) {
          notes.push(`${it.itemName}: stock at ${step.warehouse} went negative (${movement.balanceAfter}) — material was issued before QC`);
        }
      }

      qc.qcStatus = qcStatus;
      qc.overallResult = overallResult;
      qc.stockPosted = true;
      qc.completedAt = new Date();
      if (data.remarks) qc.remarks = data.remarks;
      qc.updatedBy = user?._id;
      qc.activityTimeline.push({ action: 'COMPLETE', description: `QC completed — ${overallResult}`, actorId: user?._id });
      for (const note of notes) qc.activityTimeline.push({ action: 'STOCK_NOTE', description: note, actorId: user?._id });
      await qc.save();
    } catch (err) {
      // Nothing posted → hand the QC back (still draft) so it can be completed
      // again. Movements written → keep it claimed so a retry can't post twice.
      const posted = await inventoryService.getMovementsByRef('INCOMING_QC', qc._id).catch(() => [{}]);
      if (!posted.length) {
        await IncomingQC.updateOne(
          { _id: qc._id, qcStatus: { $in: [QC_STATUS.DRAFT, QC_STATUS.IN_PROGRESS] } },
          { $set: { stockPosted: false } },
        ).catch(() => {});
      } else {
        logger.error(`[qc] ${qc.qcNumber}: completion failed part-way (${posted.length} movement(s) written) — QC left claimed: ${err.message}`);
      }
      throw err;
    }

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
