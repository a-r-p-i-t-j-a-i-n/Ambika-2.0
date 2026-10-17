import PurchaseFollowUp, { FOLLOWUP_STATUS, FOLLOWUP_TYPE } from './followUp.model.js';
import VendorPurchaseOrder, { PO_STATUS, PO_FOLLOWUP_STATUS } from '../purchase-order/purchaseOrder.model.js';
import { parseLeadDays } from '../purchase-order/purchaseOrder.service.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generateFollowUpNumber } from '../../../utils/docNumberGenerator.js';
import { logger } from '../../../utils/logger.js';

/** Minutes late: actualAt − plannedAt, 0 when on time or early. */
const computeDelayMinutes = (plannedAt, actualAt) => {
  if (!plannedAt || !actualAt) return 0;
  const diff = Math.round((new Date(actualAt).getTime() - new Date(plannedAt).getTime()) / 60000);
  return Math.max(0, diff);
};

const findOrThrow = async (id) => {
  const fu = await PurchaseFollowUp.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!fu) throw new AppError('Follow-up not found', 404);
  return fu;
};

const logEntry = (type, message, user) => ({
  type: type || FOLLOWUP_TYPE.CALL,
  message: message || '',
  timestamp: new Date(),
  by: user?._id,
  byName: user?.name || '',
});

/** Keep the PO's followUpStatus mirror in sync (non-fatal). */
const setPoFollowUpStatus = async (poId, patch) => {
  try { await VendorPurchaseOrder.updateOne({ _id: poId }, { $set: patch }); }
  catch (err) { logger.error(`[follow-up] PO sync failed for ${poId}: ${err.message}`); }
};

export const followUpService = {
  async create(data, user) {
    // Rule 1: follow-ups exist only for released POs with outstanding material —
    // a partial receipt still has pending quantity to chase, so it stays
    // eligible; a full receipt does not (no GRN/receipt logic changes here,
    // this only gates which POs this module will create a new follow-up for).
    const po = await VendorPurchaseOrder.findOne({ _id: data.poId, isDeleted: { $ne: true } });
    if (!po) throw new AppError('Purchase Order not found', 404);
    if (![PO_STATUS.RELEASED_TO_VENDOR, PO_STATUS.PARTIAL_RECEIVED].includes(po.poStatus)) {
      throw new AppError('Follow-ups can only be created for a released PO with outstanding material', 400);
    }

    // Rule 2: at most one active (PENDING/RESCHEDULED) follow-up per PO. A
    // concluded cycle (DONE/READY_FOR_GRN/CLOSED) does not block a fresh one,
    // but an already-active cycle must be continued (mark-done/reschedule),
    // not duplicated — this is the server-side guarantee behind the UI's own
    // "update the existing one instead of creating a new one" rule, so it
    // holds even against a double-click race or a caller that skips that check.
    const existingActive = await PurchaseFollowUp.findOne({
      poId: po._id, isDeleted: { $ne: true },
      followUpStatus: { $in: [FOLLOWUP_STATUS.PENDING, FOLLOWUP_STATUS.RESCHEDULED] },
    }).select('followUpNumber').lean();
    if (existingActive) {
      throw new AppError(`An active follow-up (${existingActive.followUpNumber}) already exists for this PO — update it instead of creating a new one`, 400);
    }

    // Rule 3: plannedAt defaults to expectedDeliveryDate (releasedAt + leadTime).
    let plannedAt = data.plannedAt ? new Date(data.plannedAt) : null;
    if (!plannedAt) {
      plannedAt = po.expectedDeliveryDate
        || (po.releasedAt && parseLeadDays(po.leadTime) > 0
          ? new Date(new Date(po.releasedAt).getTime() + parseLeadDays(po.leadTime) * 86400000)
          : new Date());
    }

    const followUpNumber = await generateFollowUpNumber();
    let fu;
    try {
      fu = await PurchaseFollowUp.create({
        followUpNumber,
        poId: po._id,
        poNumber: po.poNumber,
        indentId: po.indentId,
        indentNumber: po.indentNumber,
        vendorId: po.vendorId,
        vendorName: po.vendorName,
        vendorEmail: po.vendorEmail,
        vendorPhone: po.vendorPhone,
        plannedAt,
        followUpType: data.followUpType || FOLLOWUP_TYPE.CALL,
        remarks: data.remarks || '',
        formLink: data.formLink || '',
        isActiveFollowUp: true,
        performedBy: user?._id,
        performedByName: user?.name || '',
        createdBy: user?._id,
        activityTimeline: [{ action: 'CREATE', description: `Follow-up created for ${po.poNumber}`, actorId: user?._id }],
      });
    } catch (err) {
      // The findOne check above is a fast, friendly pre-check — it cannot by
      // itself prevent a race between two concurrent requests (classic
      // check-then-create TOCTOU). The partial unique index on
      // { poId, isActiveFollowUp: true } is the actual atomic guarantee: if
      // another request's create() won that race in between, this insert is
      // rejected by MongoDB itself (E11000) rather than both succeeding.
      if (err?.code === 11000 && err?.keyPattern?.poId) {
        const winner = await PurchaseFollowUp.findOne({
          poId: po._id, isDeleted: { $ne: true }, isActiveFollowUp: true,
        }).select('followUpNumber').lean();
        throw new AppError(
          `An active follow-up (${winner?.followUpNumber || 'another one'}) already exists for this PO — update it instead of creating a new one`,
          400,
        );
      }
      throw err;
    }

    // PO mirror: follow-up cycle is now actively running.
    await setPoFollowUpStatus(po._id, { followUpStatus: PO_FOLLOWUP_STATUS.IN_PROGRESS });
    return fu;
  },

  async getAll(query) {
    const features = new ApiFeatures(
      PurchaseFollowUp.find({ isDeleted: { $ne: true } }),
      query,
    )
      .filter()
      .search(['followUpNumber', 'poNumber', 'indentNumber', 'vendorName'])
      .sort()
      .select()
      .paginate();
    return features.exec();
  },

  async getById(id) {
    const fu = await PurchaseFollowUp.findOne({ _id: id, isDeleted: { $ne: true } })
      .populate('performedBy', 'name')
      .lean();
    if (!fu) throw new AppError('Follow-up not found', 404);
    return fu;
  },

  async getByPo(poId) {
    return PurchaseFollowUp.find({ poId, isDeleted: { $ne: true } }).sort('-createdAt').lean();
  },

  async getStats() {
    const now = new Date();
    const rows = await PurchaseFollowUp.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total:       { $sum: 1 },
          pending:     { $sum: { $cond: [{ $in: ['$followUpStatus', [FOLLOWUP_STATUS.PENDING, FOLLOWUP_STATUS.RESCHEDULED]] }, 1, 0] } },
          done:        { $sum: { $cond: [{ $eq: ['$followUpStatus', FOLLOWUP_STATUS.DONE] }, 1, 0] } },
          delayed:     { $sum: { $cond: [{ $and: [
            { $in: ['$followUpStatus', [FOLLOWUP_STATUS.PENDING, FOLLOWUP_STATUS.RESCHEDULED]] },
            { $lt: ['$plannedAt', now] },
          ] }, 1, 0] } },
          readyForGrn: { $sum: { $cond: [{ $eq: ['$followUpStatus', FOLLOWUP_STATUS.READY_FOR_GRN] }, 1, 0] } },
        },
      },
    ]);
    return rows[0] || { total: 0, pending: 0, done: 0, delayed: 0, readyForGrn: 0 };
  },

  async update(id, data, user) {
    const fu = await findOrThrow(id);
    if (![FOLLOWUP_STATUS.PENDING, FOLLOWUP_STATUS.RESCHEDULED].includes(fu.followUpStatus)) {
      throw new AppError('Only pending follow-ups can be edited', 400);
    }
    Object.assign(fu, data);
    fu.updatedBy = user?._id;
    fu.activityTimeline.push({ action: 'UPDATE', description: 'Follow-up updated', actorId: user?._id });
    return fu.save();
  },

  async remove(id, user) {
    const fu = await findOrThrow(id);
    if (![FOLLOWUP_STATUS.PENDING, FOLLOWUP_STATUS.RESCHEDULED].includes(fu.followUpStatus)) {
      throw new AppError('Only pending or rescheduled follow-ups can be deleted', 400);
    }
    fu.isDeleted = true;
    fu.deletedAt = new Date();
    fu.deletedBy = user?._id;
    // The partial unique index only inspects isActiveFollowUp, not isDeleted —
    // without this, a soft-deleted active record would still block a new one.
    fu.isActiveFollowUp = false;
    fu.activityTimeline.push({ action: 'DELETE', description: 'Follow-up deleted', actorId: user?._id });
    return fu.save();
  },

  // Rule 4: record a follow-up cycle.
  //
  // Outcome is driven by which date the user provides (mutually exclusive):
  //  • Final Material Date  → delivery confirmed → READY_FOR_GRN (statusDone=YES),
  //    mirror the PO so the GRN flow unlocks.
  //  • Next Follow-up Date  → still chasing the vendor → RESCHEDULED (statusDone=NO);
  //    the follow-up stays active so the user can "Follow-up Again" later and only
  //    then enter the Final Material Date. (Eliminates the old dead-end.)
  // The communication log + activity timeline accumulate across every cycle.
  async markDone(id, data, user) {
    const fu = await findOrThrow(id);
    if (![FOLLOWUP_STATUS.PENDING, FOLLOWUP_STATUS.RESCHEDULED].includes(fu.followUpStatus)) {
      throw new AppError('Only pending/rescheduled follow-ups can be updated', 400);
    }
    const actualAt = data.actualAt ? new Date(data.actualAt) : new Date();
    const hasFinal = !!data.finalMaterialDate;
    const hasNext = !hasFinal && !!data.nextFollowUpDate;

    fu.actualAt = actualAt;
    fu.timeDelayMinutes = computeDelayMinutes(fu.plannedAt, actualAt);
    if (data.followUpType) fu.followUpType = data.followUpType;
    if (data.remarks) fu.remarks = data.remarks;
    fu.performedBy = user?._id;
    fu.performedByName = user?.name || fu.performedByName;
    if (data.message) fu.communicationLog.push(logEntry(data.followUpType || fu.followUpType, data.message, user));
    fu.updatedBy = user?._id;

    if (hasFinal) {
      // Delivery date confirmed → ready for GRN.
      fu.statusDone = 'YES';
      fu.followUpStatus = FOLLOWUP_STATUS.READY_FOR_GRN;
      fu.finalMaterialDate = new Date(data.finalMaterialDate);
      fu.nextFollowUpDate = null;
      fu.isActiveFollowUp = false; // cycle concluded — frees the PO for a future follow-up, if ever needed
      fu.activityTimeline.push({ action: 'READY_FOR_GRN', description: 'Final Material Date confirmed — ready for GRN', actorId: user?._id });
      await fu.save();
      // PO mirror — unlocks the GRN gate.
      await setPoFollowUpStatus(fu.poId, {
        followUpStatus: PO_FOLLOWUP_STATUS.READY_FOR_GRN,
        readyForGrnAt: new Date(),
        finalMaterialDate: fu.finalMaterialDate,
      });
      return fu;
    }

    if (hasNext) {
      // Vendor not yet confirmed → keep the follow-up active for the next cycle.
      fu.statusDone = 'NO';
      fu.followUpStatus = FOLLOWUP_STATUS.RESCHEDULED;
      fu.nextFollowUpDate = new Date(data.nextFollowUpDate);
      fu.plannedAt = fu.nextFollowUpDate; // the next planned contact
      fu.isActiveFollowUp = true; // still the active cycle for this PO
      fu.activityTimeline.push({ action: 'RESCHEDULED', description: `Follow-up continued — next on ${fu.nextFollowUpDate.toDateString()}`, actorId: user?._id });
      return fu.save();
    }

    // Neither date (legacy / unexpected) → close the cycle as done.
    fu.statusDone = 'YES';
    fu.followUpStatus = FOLLOWUP_STATUS.DONE;
    fu.isActiveFollowUp = false; // cycle concluded — frees the PO for a future follow-up
    fu.activityTimeline.push({ action: 'DONE', description: 'Follow-up marked done', actorId: user?._id });
    return fu.save();
  },

  // Rule 5: reschedule to a new date.
  async reschedule(id, data, user) {
    const fu = await findOrThrow(id);
    if ([FOLLOWUP_STATUS.READY_FOR_GRN, FOLLOWUP_STATUS.CLOSED].includes(fu.followUpStatus)) {
      throw new AppError(`Cannot reschedule a ${fu.followUpStatus} follow-up`, 400);
    }
    fu.followUpStatus = FOLLOWUP_STATUS.RESCHEDULED;
    fu.nextFollowUpDate = new Date(data.nextFollowUpDate);
    fu.isActiveFollowUp = true; // still the active cycle for this PO
    if (data.followUpType) fu.followUpType = data.followUpType;
    if (data.remarks) fu.remarks = data.remarks;
    fu.communicationLog.push(logEntry(data.followUpType || fu.followUpType, data.message || `Rescheduled to ${new Date(data.nextFollowUpDate).toDateString()}`, user));
    fu.updatedBy = user?._id;
    fu.activityTimeline.push({ action: 'RESCHEDULE', description: 'Follow-up rescheduled', actorId: user?._id });
    return fu.save();
  },

  // Rule 6: material confirmed — hand over to (future) GRN. No stock here.
  async markReadyForGrn(id, data, user) {
    const fu = await findOrThrow(id);

    // Allowed only after at least one follow-up for this PO is DONE.
    const anyDone = fu.followUpStatus === FOLLOWUP_STATUS.DONE
      || await PurchaseFollowUp.exists({ poId: fu.poId, followUpStatus: FOLLOWUP_STATUS.DONE, isDeleted: { $ne: true } });
    if (!anyDone) {
      throw new AppError('Mark at least one follow-up as DONE before declaring material ready for GRN', 400);
    }

    // Rule: material delivery must be CONFIRMED — a Final Material Date is
    // required (from the payload or already captured on the follow-up). A pending
    // Next Follow-up Date does not confirm delivery and cannot unlock GRN.
    const finalMaterialDate = data.finalMaterialDate || fu.finalMaterialDate;
    if (!finalMaterialDate) {
      throw new AppError('Final Material Date is required before marking Ready for GRN.', 400);
    }

    fu.followUpStatus = FOLLOWUP_STATUS.READY_FOR_GRN;
    fu.finalMaterialDate = new Date(finalMaterialDate);
    fu.isActiveFollowUp = false; // cycle concluded — frees the PO for a future follow-up, if ever needed
    if (data.remarks) fu.remarks = data.remarks;
    fu.updatedBy = user?._id;
    fu.activityTimeline.push({ action: 'READY_FOR_GRN', description: 'Material declared ready for GRN', actorId: user?._id });
    await fu.save();

    // PO mirror — the GRN module keys off these.
    await setPoFollowUpStatus(fu.poId, {
      followUpStatus: PO_FOLLOWUP_STATUS.READY_FOR_GRN,
      readyForGrnAt: new Date(),
      finalMaterialDate: fu.finalMaterialDate,
    });

    return fu;
  },
};
