import PurchaseTallyEntry, { TALLY_ENTRY_STATUS, STATUS_DONE, CHECKLIST_KEYS } from './tallyEntry.model.js';
import VendorVoucher, { VOUCHER_STATUS } from '../voucher/voucher.model.js';

// The voucher tracks tally status as a plain string enum ('PENDING'|'COMPLETED'|'CANCELLED').
const VOUCHER_TALLY_COMPLETED = 'COMPLETED';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generateTallyEntryNumber } from '../../../utils/docNumberGenerator.js';
import { logger } from '../../../utils/logger.js';

// Voucher states from which a Tally Entry may be raised (i.e. the voucher is posted).
const POSTED_STATES = [VOUCHER_STATUS.POSTED, VOUCHER_STATUS.PARTIALLY_PAID, VOUCHER_STATUS.FULLY_PAID, VOUCHER_STATUS.SHORT_CLOSED];

const allChecklistChecked = (cl = {}) => CHECKLIST_KEYS.every((k) => cl[k] === true);

const findOrThrow = async (id) => {
  const t = await PurchaseTallyEntry.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!t) throw new AppError('Tally entry not found', 404);
  return t;
};

export const tallyEntryService = {
  // Rules 1-3: only from a posted voucher, no standalone, one active per voucher.
  async create(data, user) {
    const v = await VendorVoucher.findOne({ _id: data.voucherId, isDeleted: { $ne: true } });
    if (!v) throw new AppError('Voucher not found', 404);
    if (!POSTED_STATES.includes(v.voucherStatus)) {
      throw new AppError('Tally Entry can only be created from a posted voucher', 400);
    }
    // MD Digital Approval gate: the voucher must be MD Approved before a Tally
    // Entry (and, transitively, Final Payment) can proceed.
    if (v.approvalStatus !== 'MD_APPROVED') {
      throw new AppError('Voucher must be MD Approved before a Tally Entry can be created', 400);
    }
    const existing = await PurchaseTallyEntry.findOne({
      voucherId: v._id, isDeleted: { $ne: true }, tallyEntryStatus: { $ne: TALLY_ENTRY_STATUS.CANCELLED },
    }).lean();
    if (existing) throw new AppError(`A Tally Entry (${existing.entryNumber}) already exists for this voucher`, 400);

    const entryNumber = await generateTallyEntryNumber(new Date());

    // Planned Date, Tally Voucher No. and Tally Ledger Name are all derived
    // from the source (posted, MD-approved) voucher rather than typed by the
    // user: Tally Voucher No. is the same as the Bill Passing Voucher No.,
    // Tally Ledger Name mirrors the voucher's Vendor Name, and Planned Date
    // defaults to the date the voucher was posted (falling back to the
    // voucher date if, for any reason, postedAt isn't set).
    const entry = await PurchaseTallyEntry.create({
      entryNumber,
      voucherId: v._id, voucherNumber: v.voucherNumber,
      invoiceId: v.invoiceId, invoiceNumber: v.invoiceNumber,
      poId: v.poId, poNumber: v.poNumber, grnId: v.grnId,
      vendorId: v.vendorId, vendorName: v.vendorName,
      plannedAt: v.postedAt || v.voucherDate || new Date(),
      statusDone: data.statusDone || STATUS_DONE.NO,
      checklist: data.checklist || {},
      tallyVoucherNumber: v.voucherNumber,
      tallyLedgerName: v.vendorName,
      remarks: data.remarks || '',
      tallyEntryStatus: TALLY_ENTRY_STATUS.PENDING,
      performedBy: user?._id || null,
      performedByName: user?.name || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `Tally entry created for ${v.voucherNumber}`, actorId: user?._id }],
    });
    return entry;
  },

  async getAll(query) {
    const features = new ApiFeatures(PurchaseTallyEntry.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['entryNumber', 'voucherNumber', 'invoiceNumber', 'vendorName'])
      .sort().select().paginate();
    return features.exec();
  },

  async getById(id) {
    const t = await PurchaseTallyEntry.findOne({ _id: id, isDeleted: { $ne: true } }).populate('createdBy', 'name').lean();
    if (!t) throw new AppError('Tally entry not found', 404);
    return t;
  },

  async getByVoucher(voucherId) {
    return PurchaseTallyEntry.find({ voucherId, isDeleted: { $ne: true } }).sort('-createdAt').lean();
  },

  async getStats() {
    const rows = await PurchaseTallyEntry.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total:     { $sum: 1 },
          pending:   { $sum: { $cond: [{ $eq: ['$tallyEntryStatus', TALLY_ENTRY_STATUS.PENDING] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$tallyEntryStatus', TALLY_ENTRY_STATUS.COMPLETED] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$tallyEntryStatus', TALLY_ENTRY_STATUS.CANCELLED] }, 1, 0] } },
        },
      },
    ]);
    return rows[0] || { total: 0, pending: 0, completed: 0, cancelled: 0 };
  },

  async update(id, data, user) {
    const t = await findOrThrow(id);
    if (t.tallyEntryStatus !== TALLY_ENTRY_STATUS.PENDING) throw new AppError('Only pending tally entries can be edited', 400);
    // plannedAt, tallyVoucherNumber and tallyLedgerName are system-derived from
    // the source voucher at creation time and stay read-only thereafter.
    const { checklist, plannedAt, tallyVoucherNumber, tallyLedgerName, ...rest } = data;
    Object.assign(t, rest);
    if (checklist) t.checklist = { ...t.checklist.toObject?.() ?? t.checklist, ...checklist };
    t.updatedBy = user?._id;
    t.activityTimeline.push({ action: 'UPDATE', description: 'Tally entry updated', actorId: user?._id });
    return t.save();
  },

  // Rules 4-7: complete requires statusDone=YES + all checklist items; if NO, stay PENDING (remarks required).
  async complete(id, data, user) {
    const t = await findOrThrow(id);
    if (t.tallyEntryStatus === TALLY_ENTRY_STATUS.CANCELLED) throw new AppError('Cancelled tally entry cannot be completed', 400);
    if (t.tallyEntryStatus === TALLY_ENTRY_STATUS.COMPLETED) throw new AppError('Tally entry is already completed', 400);

    // merge incoming payload
    const statusDone = data.statusDone || t.statusDone;
    const checklist = { ...(t.checklist.toObject?.() ?? t.checklist), ...(data.checklist || {}) };
    if (data.tallyVoucherNumber !== undefined) t.tallyVoucherNumber = data.tallyVoucherNumber;
    if (data.tallyLedgerName !== undefined) t.tallyLedgerName = data.tallyLedgerName;
    if (data.remarks !== undefined) t.remarks = data.remarks;
    t.statusDone = statusDone;
    t.checklist = checklist;

    // Rule 5: statusDone = NO → keep PENDING, remarks required.
    if (statusDone !== STATUS_DONE.YES) {
      if (!t.remarks?.trim()) throw new AppError('Remarks are required when status is "No"', 400);
      t.updatedBy = user?._id;
      t.activityTimeline.push({ action: 'PENDING', description: 'Status marked No — entry kept pending', actorId: user?._id });
      return t.save();
    }

    // Rule 4: statusDone = YES requires the full checklist.
    if (!allChecklistChecked(checklist)) {
      throw new AppError('All checklist items must be verified to complete the tally entry', 400);
    }

    // Rule 6: complete.
    t.tallyEntryStatus = TALLY_ENTRY_STATUS.COMPLETED;
    t.actualAt = data.actualAt || t.actualAt || new Date();
    t.completedAt = new Date();
    t.performedBy = user?._id || t.performedBy;
    t.performedByName = user?.name || t.performedByName;
    t.updatedBy = user?._id;
    t.activityTimeline.push({ action: 'COMPLETE', description: 'Tally entry completed', actorId: user?._id });
    await t.save();

    // Rule 6: reflect onto the voucher (no payment here — Rule 7).
    try {
      await VendorVoucher.updateOne(
        { _id: t.voucherId },
        {
          $set: { tallyEntryStatus: VOUCHER_TALLY_COMPLETED, tallyEntryId: t._id, tallyEntryNumber: t.entryNumber },
          $push: { activityTimeline: { action: 'TALLY_ENTRY', description: `Tally entry ${t.entryNumber} completed`, actorId: user?._id } },
        },
      );
    } catch (err) { logger.error(`[tally-entry] voucher update failed for ${t.voucherId}: ${err.message}`); }

    return t;
  },

  async cancel(id, data, user) {
    const t = await findOrThrow(id);
    if (t.tallyEntryStatus === TALLY_ENTRY_STATUS.COMPLETED) throw new AppError('A completed tally entry cannot be cancelled', 400);
    if (t.tallyEntryStatus === TALLY_ENTRY_STATUS.CANCELLED) throw new AppError('Tally entry is already cancelled', 400);
    t.tallyEntryStatus = TALLY_ENTRY_STATUS.CANCELLED;
    t.cancelledAt = new Date();
    if (data.remarks) t.remarks = data.remarks;
    t.updatedBy = user?._id;
    t.activityTimeline.push({ action: 'CANCEL', description: 'Tally entry cancelled', actorId: user?._id });
    return t.save();
  },
};
