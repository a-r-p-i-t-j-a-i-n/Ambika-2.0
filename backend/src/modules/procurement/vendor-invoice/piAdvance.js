import mongoose from 'mongoose';
import VendorInvoice, { INVOICE_STATUS } from './vendorInvoice.model.js';
import ProformaInvoice from '../proforma-invoice/proformaInvoice.model.js';
import { AppError } from '../../../utils/apiResponse.js';
import { logger } from '../../../utils/logger.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── PI advance allocation ────────────────────────────────────────────
// A PI's advance (PI.paidAmount) is consumed by its invoices: each invoice's
// `advancePaid` is the share allocated to it. Every live invoice holds its share
// — the same states that hold invoiced quantity (see invoicedQtyMap): anything
// not deleted and not REJECTED. Deleting a draft or rejecting frees the share.
// Shared by Vendor Invoice (allocation) and Advance Payment (reversal guard).

const liveInvoiceMatch = (piId) => ({
  piId: new mongoose.Types.ObjectId(String(piId)),
  isDeleted: { $ne: true },
  invoiceStatus: { $ne: INVOICE_STATUS.REJECTED },
});

/** Advance already allocated to a PI's live invoices (optionally excluding one). */
const advanceAllocatedOnPi = async (piId, excludeInvoiceId = null) => {
  const match = liveInvoiceMatch(piId);
  if (excludeInvoiceId) match._id = { $ne: new mongoose.Types.ObjectId(String(excludeInvoiceId)) };
  const rows = await VendorInvoice.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$advancePaid' } } }]);
  return round2(rows[0]?.total || 0);
};

/** Paid / already-allocated / still-available advance on a PI (server-authoritative). */
export const getAdvancePosition = async (piId, excludeInvoiceId = null) => {
  if (!piId) return { advancePaid: 0, advanceAllocated: 0, advanceAvailable: 0 };
  const pi = await ProformaInvoice.findById(piId).select('paidAmount').lean();
  const advancePaid = round2(pi?.paidAmount || 0);
  const advanceAllocated = await advanceAllocatedOnPi(piId, excludeInvoiceId);
  return { advancePaid, advanceAllocated, advanceAvailable: Math.max(0, round2(advancePaid - advanceAllocated)) };
};

/** Live invoices currently holding a share of a PI's advance. */
export const invoicesHoldingAdvance = (piId) => VendorInvoice.find({ ...liveInvoiceMatch(piId), advancePaid: { $gt: 0 } })
  .select('invoiceNumber advancePaid invoiceStatus voucherNumber').sort({ createdAt: 1 }).lean();

const PI_LOCK_TTL_MS = 2 * 60 * 1000;

/**
 * Run `work` holding the per-PI advance lock, so the PI's advance can't be
 * allocated (invoice) and reversed (advance payment deletion) — or allocated
 * twice — at the same time. A concurrent caller gets a clean 409.
 */
export const withPiAdvanceLock = async (piId, work) => {
  if (!piId) return work();
  const now = new Date();
  const res = await ProformaInvoice.updateOne(
    {
      _id: piId,
      $or: [{ advanceAllocationLockAt: null }, { advanceAllocationLockAt: { $lt: new Date(now.getTime() - PI_LOCK_TTL_MS) } }],
    },
    { $set: { advanceAllocationLockAt: now } },
  );
  if (res.matchedCount === 0) {
    const exists = await ProformaInvoice.exists({ _id: piId });
    if (!exists) return work(); // PI gone — nothing to allocate (advance = 0)
    throw new AppError('This PI\'s advance is being updated by another request right now. Please try again in a moment.', 409);
  }
  try {
    return await work();
  } finally {
    await ProformaInvoice.updateOne({ _id: piId, advanceAllocationLockAt: now }, { $set: { advanceAllocationLockAt: null } })
      .catch((err) => logger.error(`[pi-advance] failed to release PI advance lock ${piId}: ${err.message}`));
  }
};
