import ProformaInvoice, { PI_APPROVAL_STATUS, PI_STATUS } from './proformaInvoice.model.js';
import VendorPurchaseOrder, { PO_STATUS, PO_FOLLOWUP_STATUS, PO_PI_STATUS } from '../purchase-order/purchaseOrder.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generatePiNumber, generatePiUniqueCode } from '../../../utils/docNumberGenerator.js';
import { assertPurchasable } from '../purchase-item-guard.js';
import { logger } from '../../../utils/logger.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Server-authoritative line + total computation. lineAmount is GST-inclusive. */
const computeLines = (items = []) => {
  const lines = items.map((it) => {
    const quantity = Number(it.quantity) || 0;
    const rate = Number(it.rate) || 0;
    const gstRate = Number(it.gstRate) || 0;
    const receivedQty = Number(it.receivedQty) || 0; // GRN owns this; defaults to 0
    return {
      itemName: it.itemName,
      skuCode: it.skuCode || '',
      skuId: it.skuId || undefined,
      quantity, unit: it.unit || 'Pcs',
      receivedQty,
      balanceQty: Math.max(0, round2(quantity - receivedQty)),
      rate, gstRate,
      lineAmount: round2(quantity * rate * (1 + gstRate / 100)),
    };
  });
  const totalValue = round2(lines.reduce((s, l) => s + l.lineAmount, 0));
  return { lines, totalValue };
};

const normalizeDocument = (doc) => (doc?.fileUrl
  ? { fileName: doc.fileName || '', fileUrl: doc.fileUrl, fileType: doc.fileType || '', uploadedAt: new Date() }
  : { fileName: '', fileUrl: '', fileType: '', uploadedAt: null });

const findOrThrow = async (id) => {
  const pi = await ProformaInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!pi) throw new AppError('Proforma Invoice not found', 404);
  return pi;
};

/** Keep the PO's PI mirror in sync (non-fatal). */
const setPoPiStatus = async (poId, patch) => {
  try { await VendorPurchaseOrder.updateOne({ _id: poId }, { $set: patch }); }
  catch (err) { logger.error(`[pi] PO sync failed for ${poId}: ${err.message}`); }
};

export const proformaInvoiceService = {
  async create(data, user) {
    // Rules 1-2: PI only for a released PO (or one already ready for GRN).
    const po = await VendorPurchaseOrder.findOne({ _id: data.poId, isDeleted: { $ne: true } });
    if (!po) throw new AppError('Purchase Order not found', 404);
    const eligible = po.poStatus === PO_STATUS.RELEASED_TO_VENDOR
      || po.followUpStatus === PO_FOLLOWUP_STATUS.READY_FOR_GRN;
    if (!eligible) {
      throw new AppError('PI can only be created for a PO that is released to the vendor', 400);
    }
    // One live PI per PO (a cancelled PI frees the slot).
    const existing = await ProformaInvoice.findOne({
      poId: po._id, isDeleted: { $ne: true }, piStatus: { $ne: PI_STATUS.CANCELLED },
    }).lean();
    if (existing) {
      throw new AppError(`A PI (${existing.piNumber}) already exists for this PO`, 400);
    }

    // Rule 3: pull vendor + items from the PO when not supplied.
    const sourceItems = data.items?.length ? data.items : (po.items || []).map((it) => ({
      itemName: it.itemName, skuCode: it.skuCode, skuId: it.skuId,
      quantity: it.quantity, unit: it.unit, rate: it.rate, gstRate: it.gstRate,
    }));
    // Finished Goods are sell-side only — never purchasable.
    await assertPurchasable(sourceItems);
    const { lines, totalValue } = computeLines(sourceItems);

    const piNumber = await generatePiNumber(data.piDate || new Date());
    const uniqueCode = await generatePiUniqueCode();
    const piDocument = normalizeDocument(data.piDocument);
    const hasDocument = Boolean(piDocument.fileUrl);

    const pi = await ProformaInvoice.create({
      piNumber,
      uniqueCode,
      piDate: data.piDate || new Date(),
      poId: po._id,
      poNumber: po.poNumber,
      indentId: po.indentId,
      indentNumber: po.indentNumber,
      vendorId: po.vendorId,
      vendorName: po.vendorName,
      vendorGST: po.vendorGST,
      vendorPAN: po.vendorPAN,
      vendorAddress: po.vendorAddress,
      vendorEmail: po.vendorEmail,
      vendorPhone: po.vendorPhone,
      items: lines,
      totalValue,
      paidAmount: 0,
      balanceAmount: totalValue, // Rule 4
      approvalStatus: PI_APPROVAL_STATUS.PENDING,
      piStatus: hasDocument ? PI_STATUS.RECEIVED : PI_STATUS.DRAFT,
      piDocument,
      receivedAt: hasDocument ? new Date() : null,
      remarks: data.remarks || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `PI created from ${po.poNumber}`, actorId: user?._id }],
    });

    // PO mirror.
    await setPoPiStatus(po._id, {
      piStatus: PO_PI_STATUS.PI_RECEIVED,
      piId: pi._id,
      piNumber: pi.piNumber,
      piReceivedAt: new Date(),
    });

    return pi;
  },

  async getAll(query) {
    const features = new ApiFeatures(
      ProformaInvoice.find({ isDeleted: { $ne: true } }),
      query,
    )
      .filter()
      .search(['piNumber', 'poNumber', 'vendorName', 'uniqueCode'])
      .sort()
      .select()
      .paginate();
    return features.exec();
  },

  async getById(id) {
    const pi = await ProformaInvoice.findOne({ _id: id, isDeleted: { $ne: true } })
      .populate('createdBy', 'name')
      .lean();
    if (!pi) throw new AppError('Proforma Invoice not found', 404);
    return pi;
  },

  async getByPo(poId) {
    return ProformaInvoice.find({ poId, isDeleted: { $ne: true } }).sort('-createdAt').lean();
  },

  async getStats() {
    const rows = await ProformaInvoice.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total:           { $sum: 1 },
          pendingApproval: { $sum: { $cond: [{ $and: [
            { $eq: ['$approvalStatus', PI_APPROVAL_STATUS.PENDING] },
            { $ne: ['$piStatus', PI_STATUS.CANCELLED] },
          ] }, 1, 0] } },
          approved:        { $sum: { $cond: [{ $eq: ['$approvalStatus', PI_APPROVAL_STATUS.APPROVED] }, 1, 0] } },
          readyForPayment: { $sum: { $cond: [{ $eq: ['$piStatus', PI_STATUS.READY_FOR_ADVANCE_PAYMENT] }, 1, 0] } },
          cancelled:       { $sum: { $cond: [{ $eq: ['$piStatus', PI_STATUS.CANCELLED] }, 1, 0] } },
          totalValue:      { $sum: '$totalValue' },
        },
      },
    ]);
    return rows[0] || { total: 0, pendingApproval: 0, approved: 0, readyForPayment: 0, cancelled: 0, totalValue: 0 };
  },

  async update(id, data, user) {
    const pi = await findOrThrow(id);
    if (![PI_STATUS.DRAFT, PI_STATUS.RECEIVED].includes(pi.piStatus) || pi.approvalStatus === PI_APPROVAL_STATUS.APPROVED) {
      throw new AppError('Only draft/received (unapproved) PIs can be edited', 400);
    }
    if (data.piDate) pi.piDate = data.piDate;
    if (data.remarks !== undefined) pi.remarks = data.remarks || '';
    if (data.items) {
      await assertPurchasable(data.items);
      const { lines, totalValue } = computeLines(data.items);
      pi.items = lines;
      pi.totalValue = totalValue;
      pi.balanceAmount = round2(totalValue - (pi.paidAmount || 0)); // Rule 4
    }
    if (data.piDocument) {
      pi.piDocument = normalizeDocument(data.piDocument);
      if (pi.piDocument.fileUrl && pi.piStatus === PI_STATUS.DRAFT) {
        pi.piStatus = PI_STATUS.RECEIVED;
        pi.receivedAt = pi.receivedAt || new Date();
      }
    }
    pi.updatedBy = user?._id;
    pi.activityTimeline.push({ action: 'UPDATE', description: 'PI updated', actorId: user?._id });
    return pi.save();
  },

  async remove(id, user) {
    const pi = await findOrThrow(id);
    if (![PI_STATUS.DRAFT, PI_STATUS.RECEIVED].includes(pi.piStatus) || pi.approvalStatus === PI_APPROVAL_STATUS.APPROVED) {
      throw new AppError('Only a draft or received PI (not yet approved) can be deleted', 400);
    }
    pi.isDeleted = true;
    pi.deletedAt = new Date();
    pi.deletedBy = user?._id;
    pi.activityTimeline.push({ action: 'DELETE', description: 'Proforma invoice deleted', actorId: user?._id });
    return pi.save();
  },

  // Rules 5-6: approve (document mandatory) → ready for advance payment.
  async approve(id, data, user) {
    const pi = await findOrThrow(id);
    if (pi.piStatus === PI_STATUS.CANCELLED) throw new AppError('Cannot approve a cancelled PI', 400);
    if (pi.approvalStatus === PI_APPROVAL_STATUS.APPROVED) throw new AppError('PI is already approved', 400);
    if (!pi.piDocument?.fileUrl) {
      throw new AppError('Upload the PI document before approving', 400);
    }
    pi.approvalStatus = PI_APPROVAL_STATUS.APPROVED;
    pi.piStatus = PI_STATUS.READY_FOR_ADVANCE_PAYMENT;
    pi.approvedBy = user?.name || '';
    pi.approvedById = user?._id;
    pi.approvedAt = new Date();
    pi.approvalRemarks = data.remarks || '';
    pi.updatedBy = user?._id;
    pi.activityTimeline.push({ action: 'APPROVE', description: 'PI approved — ready for advance payment', actorId: user?._id });
    await pi.save();

    await setPoPiStatus(pi.poId, { piStatus: PO_PI_STATUS.READY_FOR_ADVANCE_PAYMENT });
    return pi;
  },

  // Rule 7: reject.
  async reject(id, data, user) {
    const pi = await findOrThrow(id);
    if (pi.piStatus === PI_STATUS.CANCELLED) throw new AppError('Cannot reject a cancelled PI', 400);
    if (pi.approvalStatus === PI_APPROVAL_STATUS.APPROVED) throw new AppError('PI is already approved', 400);
    pi.approvalStatus = PI_APPROVAL_STATUS.REJECTED;
    pi.rejectedBy = user?.name || '';
    pi.rejectedById = user?._id;
    pi.rejectedAt = new Date();
    pi.rejectionRemarks = data.remarks || '';
    pi.updatedBy = user?._id;
    pi.activityTimeline.push({ action: 'REJECT', description: 'PI rejected', actorId: user?._id });
    return pi.save();
  },

  // Rule 8: cancel — frees the PO slot so a fresh PI can be raised.
  async cancel(id, data, user) {
    const pi = await findOrThrow(id);
    if (pi.piStatus === PI_STATUS.CANCELLED) throw new AppError('PI is already cancelled', 400);
    pi.piStatus = PI_STATUS.CANCELLED;
    if (data.remarks) pi.remarks = data.remarks;
    pi.updatedBy = user?._id;
    pi.activityTimeline.push({ action: 'CANCEL', description: 'PI cancelled', actorId: user?._id });
    await pi.save();

    // Reset PO mirror only if this PI is the one linked.
    const po = await VendorPurchaseOrder.findOne({ _id: pi.poId, piId: pi._id }).lean();
    if (po) {
      await setPoPiStatus(pi.poId, {
        piStatus: PO_PI_STATUS.NOT_RECEIVED, piId: null, piNumber: '', piReceivedAt: null,
      });
    }
    return pi;
  },
};
