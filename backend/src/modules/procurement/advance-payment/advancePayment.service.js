import AdvancePayment, { PAYMENT_STATUS } from './advancePayment.model.js';
import ProformaInvoice, { PI_STATUS } from '../proforma-invoice/proformaInvoice.model.js';
import VendorPurchaseOrder, { PO_PI_STATUS } from '../purchase-order/purchaseOrder.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generateAdvancePaymentNumber } from '../../../utils/docNumberGenerator.js';
import { logger } from '../../../utils/logger.js';
import { invoicesHoldingAdvance, withPiAdvanceLock } from '../vendor-invoice/piAdvance.js';
import { paymentApprovalBlock } from '../../approvals/approval.policy.js';
import { raisePiMdApproval } from '../proforma-invoice/proformaInvoice.service.js';
import { registerRestoreHook, binPlan } from '../../recycle-bin/recycleBin.restore.js';
import { binDeleted, advanceRestoreBlock, advanceRestorePatch, asUser, refuse, inr } from '../recycleBin.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Keep the PO's PI mirror in sync (non-fatal). */
const setPoPiStatus = async (poId, patch) => {
  try { await VendorPurchaseOrder.updateOne({ _id: poId }, { $set: patch }); }
  catch (err) { logger.error(`[advance-payment] PO sync failed for ${poId}: ${err.message}`); }
};

export const advancePaymentService = {
  /**
   * Record a payment event (Step 1.7).
   *   PART_PAYMENT             → post amount, PI stays payable
   *   FULL_PAYMENT             → amount must clear the balance → PI PAYMENT_COMPLETED
   *   SHORT_PAYMENT_COMPLETED  → post amount, balance stays > 0, order closed short → PI PAYMENT_COMPLETED
   *   CANCELLED                → record only, nothing posted
   */
  async create(data, user) {
    const pi = await ProformaInvoice.findOne({ _id: data.piId, isDeleted: { $ne: true } });
    if (!pi) throw new AppError('Proforma Invoice not found', 404);

    const isCancelledEntry = data.paymentStatus === PAYMENT_STATUS.CANCELLED;
    if (!isCancelledEntry && pi.piStatus !== PI_STATUS.READY_FOR_ADVANCE_PAYMENT) {
      throw new AppError('Payments can only be recorded for a PI that is ready for advance payment', 400);
    }

    // MD approval is the one mandatory gate in Purchase FMS: no advance is paid
    // until the MD has approved the PI. A CANCELLED entry posts nothing, so it
    // is not held back. A PI approved before this rule existed has no MD
    // approval yet — raise it now, so it reaches the MD's queue.
    if (!isCancelledEntry) {
      const blocked = paymentApprovalBlock(pi.mdApprovalStatus, 'Proforma Invoice');
      if (blocked) {
        if (pi.mdApprovalStatus !== 'READY_FOR_MD_APPROVAL' && await raisePiMdApproval(pi, user)) {
          throw new AppError('Payment cannot be processed until the MD approves this Proforma Invoice — it has now been sent to the MD for approval', 400);
        }
        throw new AppError(blocked, 400);
      }
    }

    const previousBalance = round2(pi.balanceAmount);
    const amount = round2(data.paidAmount || 0);

    // ── Per-status posting rules ──
    let newBalance = previousBalance;
    if (!isCancelledEntry) {
      if (amount > previousBalance) {
        throw new AppError(`Paid amount (${amount}) exceeds the PI balance (${previousBalance})`, 400);
      }
      if (data.paymentStatus === PAYMENT_STATUS.FULL_PAYMENT && round2(amount) !== previousBalance) {
        throw new AppError(`Full payment must clear the balance — enter ${previousBalance} or use Part Payment`, 400);
      }
      if (data.paymentStatus === PAYMENT_STATUS.SHORT_PAYMENT_COMPLETED && round2(previousBalance - amount) <= 0) {
        throw new AppError('Short payment must leave a balance — use Full Payment instead', 400);
      }
      newBalance = round2(previousBalance - amount);
    }

    const paymentNumber = await generateAdvancePaymentNumber(data.paymentDate || new Date());
    const payment = await AdvancePayment.create({
      paymentNumber,
      piId: pi._id,
      piNumber: pi.piNumber,
      poId: pi.poId,
      poNumber: pi.poNumber,
      indentNumber: pi.indentNumber,
      vendorId: pi.vendorId,
      vendorName: pi.vendorName,
      paymentStatus: data.paymentStatus,
      paymentDate: data.paymentDate,
      paidAmount: isCancelledEntry ? 0 : amount,
      paymentMode: data.paymentMode,
      paymentReferenceNumber: data.paymentReferenceNumber || '',
      remarks: data.remarks || '',
      previousBalance,
      balanceAmount: newBalance,
      performedByName: user?.name || '',
      createdBy: user?._id,
      activityTimeline: [{
        action: 'PAYMENT_RECORDED',
        description: `Advance payment recorded — ${data.paymentMode || ''} ${data.paymentReferenceNumber || ''} ₹${isCancelledEntry ? 0 : amount}`.trim(),
        actorId: user?._id,
      }],
    });

    // ── Integration: post onto the PI (skip for CANCELLED) ──
    if (!isCancelledEntry) {
      pi.paidAmount = round2((pi.paidAmount || 0) + amount);
      pi.balanceAmount = round2(pi.totalValue - pi.paidAmount);

      const closesPayment =
        pi.balanceAmount === 0 ||
        data.paymentStatus === PAYMENT_STATUS.SHORT_PAYMENT_COMPLETED;
      if (closesPayment) {
        pi.piStatus = PI_STATUS.PAYMENT_COMPLETED;
      }
      pi.updatedBy = user?._id;
      pi.activityTimeline.push({
        action: 'ADVANCE_PAYMENT',
        description: `${payment.paymentNumber} — ${data.paymentStatus} ₹${amount} via ${data.paymentMode || '—'} (ref ${data.paymentReferenceNumber || '—'}) by ${user?.name || '—'}`,
        actorId: user?._id,
      });
      await pi.save();

      if (closesPayment && pi.poId) {
        await setPoPiStatus(pi.poId, { piStatus: PO_PI_STATUS.PAYMENT_COMPLETED });
      }
    } else {
      pi.activityTimeline.push({
        action: 'PAYMENT_CANCELLED_ENTRY',
        description: `${payment.paymentNumber} recorded as CANCELLED — nothing posted`,
        actorId: user?._id,
      });
      await pi.save();
    }

    return payment;
  },

  async getAll(query) {
    const features = new ApiFeatures(
      AdvancePayment.find({ isDeleted: { $ne: true } }),
      query,
    )
      .filter()
      .search(['paymentNumber', 'piNumber', 'poNumber', 'vendorName', 'paymentReferenceNumber'])
      .sort()
      .select()
      .paginate();
    return features.exec();
  },

  /**
   * Delete reverses whatever this payment posted onto the PI (using the
   * `previousBalance` snapshot taken at posting time, not recomputation) and
   * restores the PO's PI-status mirror if this payment had closed it. Only the
   * most-recently-created payment for a PI may be deleted, keeping the
   * previousBalance chain reversible in strict LIFO order. A CANCELLED entry
   * never posted anything, so it just soft-deletes.
   */
  async remove(id, user) {
    const found = await AdvancePayment.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!found) throw new AppError('Payment not found', 404);
    // A CANCELLED entry never posted any advance — nothing to guard.
    if (found.paymentStatus === PAYMENT_STATUS.CANCELLED) return this._removeLocked(id, user);
    // Reversing a posted advance runs under the same per-PI lock the vendor
    // invoice takes while allocating that advance, so the two can't interleave.
    return withPiAdvanceLock(found.piId, () => this._removeLocked(id, user));
  },

  async _removeLocked(id, user) {
    const payment = await AdvancePayment.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!payment) throw new AppError('Payment not found', 404);

    // There is no advance-reversal / refund workflow, so an advance that vendor
    // invoices have already adjusted cannot be reversed — that would leave the
    // invoices (and their vouchers / payments) deducting money that was never paid.
    if (payment.paymentStatus !== PAYMENT_STATUS.CANCELLED) {
      const holding = await invoicesHoldingAdvance(payment.piId);
      if (holding.length) {
        const allocated = round2(holding.reduce((s, i) => s + (i.advancePaid || 0), 0));
        throw new AppError(
          `Advance payment cannot be cancelled because ₹${allocated.toLocaleString('en-IN')} has already been allocated to Vendor Invoices `
          + `(${holding.map((i) => i.invoiceNumber).join(', ')}).`,
          409,
        );
      }
    }

    const latest = await AdvancePayment.findOne({ piId: payment.piId, isDeleted: { $ne: true } }).sort('-createdAt');
    if (!latest || String(latest._id) !== String(payment._id)) {
      throw new AppError('Only the most recent payment for this PI can be deleted', 400);
    }

    if (payment.paymentStatus !== PAYMENT_STATUS.CANCELLED) {
      const pi = await ProformaInvoice.findOne({ _id: payment.piId, isDeleted: { $ne: true } });
      if (pi) {
        const wasClosed = pi.piStatus === PI_STATUS.PAYMENT_COMPLETED;
        const reversed = round2(payment.paidAmount);

        pi.paidAmount = round2(Math.max(0, (pi.paidAmount || 0) - reversed));
        pi.balanceAmount = round2(payment.previousBalance);
        if (wasClosed) pi.piStatus = PI_STATUS.READY_FOR_ADVANCE_PAYMENT;
        pi.updatedBy = user?._id;
        pi.activityTimeline.push({
          action: 'ADVANCE_PAYMENT_DELETED',
          description: `${payment.paymentNumber} deleted — ₹${reversed} reversed`,
          actorId: user?._id,
        });
        await pi.save();

        if (wasClosed && pi.poId) {
          await setPoPiStatus(pi.poId, { piStatus: PO_PI_STATUS.READY_FOR_ADVANCE_PAYMENT });
        }
      }
    }

    payment.isDeleted = true;
    payment.deletedAt = new Date();
    payment.deletedBy = user?._id;
    payment.activityTimeline.push({ action: 'DELETE', description: 'Advance payment deleted', actorId: user?._id });
    const saved = await payment.save();
    // Restore posts the amount back onto the PI — only while that is exact.
    const posted = payment.paymentStatus !== PAYMENT_STATUS.CANCELLED;
    await binDeleted('advancePayment', AdvancePayment, payment, {
      title: payment.paymentNumber || 'Advance payment',
      subtitle: [payment.piNumber && `PI ${payment.piNumber}`, payment.vendorName, posted ? inr(payment.paidAmount) : 'cancelled entry'].filter(Boolean).join(' · '),
      keywords: [payment.poNumber, payment.paymentReferenceNumber, payment.indentNumber],
      user,
      before: [binPlan.hook('procurement.advance.check', { paymentId: payment._id })],
      ...(posted ? { after: [binPlan.hook('procurement.advance.repost', { paymentId: payment._id })] } : {}),
    });
    return saved;
  },

  async getById(id) {
    const payment = await AdvancePayment.findOne({ _id: id, isDeleted: { $ne: true } })
      .populate('createdBy', 'name')
      .lean();
    if (!payment) throw new AppError('Payment not found', 404);
    return payment;
  },

  async getByPi(piId) {
    return AdvancePayment.find({ piId, isDeleted: { $ne: true } }).sort('-createdAt').lean();
  },

  /** Dashboard KPIs: payments + PI-side pending/outstanding amounts. */
  async getStats() {
    const [payRows, piRows] = await Promise.all([
      AdvancePayment.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        {
          $group: {
            _id: null,
            totalPayments: { $sum: 1 },
            paidAmount:    { $sum: { $cond: [{ $ne: ['$paymentStatus', PAYMENT_STATUS.CANCELLED] }, '$paidAmount', 0] } },
            cancelled:     { $sum: { $cond: [{ $eq: ['$paymentStatus', PAYMENT_STATUS.CANCELLED] }, 1, 0] } },
          },
        },
      ]),
      ProformaInvoice.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        {
          $group: {
            _id: null,
            // Pending = PIs still awaiting payment.
            pendingAmount: { $sum: { $cond: [{ $eq: ['$piStatus', PI_STATUS.READY_FOR_ADVANCE_PAYMENT] }, '$balanceAmount', 0] } },
            // Outstanding = short-closed balances that will never be paid.
            outstandingAmount: { $sum: { $cond: [{ $and: [
              { $eq: ['$piStatus', PI_STATUS.PAYMENT_COMPLETED] },
              { $gt: ['$balanceAmount', 0] },
            ] }, '$balanceAmount', 0] } },
            paymentCompleted: { $sum: { $cond: [{ $eq: ['$piStatus', PI_STATUS.PAYMENT_COMPLETED] }, 1, 0] } },
          },
        },
      ]),
    ]);
    const p = payRows[0] || { totalPayments: 0, paidAmount: 0, cancelled: 0 };
    const q = piRows[0] || { pendingAmount: 0, outstandingAmount: 0, paymentCompleted: 0 };
    return { ...p, ...q };
  },
};

// ── Recycle Bin: a restored advance payment ─────────────────────────────────
// Posted back onto its PI with the same rules as recording it — refused unless
// it would again be the PI's newest payment and the PI stands exactly where the
// delete left it (advanceRestoreBlock), with the MD approval still in place and
// the PI's advance not being allocated right now.
const PI_LOCK_TTL_MS = 2 * 60 * 1000;

registerRestoreHook('procurement.advance.check', async ({ paymentId }, { session }) => {
  const payment = await AdvancePayment.findById(paymentId).session(session || null).lean();
  if (!payment) refuse('The payment no longer exists.');
  const pi = await ProformaInvoice.findOne({ _id: payment.piId, isDeleted: { $ne: true } }).session(session || null).lean();
  if (payment.paymentStatus === PAYMENT_STATUS.CANCELLED) {
    if (!pi) refuse(`PI ${payment.piNumber || ''} is deleted — restore the PI first.`.replace('  ', ' '));
    return;
  }
  const newer = await AdvancePayment.find({
    piId: payment.piId, _id: { $ne: payment._id }, isDeleted: { $ne: true },
    paymentStatus: { $ne: PAYMENT_STATUS.CANCELLED }, createdAt: { $gt: payment.createdAt },
  }).session(session || null).select('paymentNumber').lean();
  const block = advanceRestoreBlock(pi, payment, { newer, piStatus: PI_STATUS });
  if (block) refuse(block);
  const approval = paymentApprovalBlock(pi.mdApprovalStatus, 'Proforma Invoice');
  if (approval) refuse(`${approval} — the payment can't be posted back.`);
  if (pi.advanceAllocationLockAt && Date.now() - new Date(pi.advanceAllocationLockAt).getTime() < PI_LOCK_TTL_MS) {
    refuse("This PI's advance is being updated right now. Try again in a moment.");
  }
});

registerRestoreHook('procurement.advance.repost', async ({ paymentId }, { session, actor }) => {
  const opts = session ? { session } : undefined;
  const payment = await AdvancePayment.findById(paymentId).session(session || null).lean();
  const pi = await ProformaInvoice.findOne({ _id: payment.piId, isDeleted: { $ne: true } }).session(session || null);
  const { paidAmount, balanceAmount, closes, piStatus } = advanceRestorePatch(pi, payment, { piStatus: PI_STATUS, paymentStatus: PAYMENT_STATUS });
  const user = asUser(actor);
  pi.paidAmount = paidAmount;
  pi.balanceAmount = balanceAmount;
  pi.piStatus = piStatus;
  pi.updatedBy = user._id;
  pi.activityTimeline.push({
    action: 'ADVANCE_PAYMENT',
    description: `${payment.paymentNumber} restored from the Recycle Bin — ${inr(payment.paidAmount)} posted again`,
    actorId: user._id,
  });
  await pi.save(opts);
  if (closes && pi.poId) {
    // Same PO mirror as recording the payment.
    await VendorPurchaseOrder.updateOne({ _id: pi.poId }, { $set: { piStatus: PO_PI_STATUS.PAYMENT_COMPLETED } }, opts);
  }
});
