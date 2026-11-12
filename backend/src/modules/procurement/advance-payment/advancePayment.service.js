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
import DocumentApproval from '../../approvals/approval.model.js';
import { loadPdfCompany } from '../../pricing/company-pdf-assets.js';
import { poPaymentBlock, piPaymentBlock, isPoPayable, advanceStateOf, piPaymentStateOf, advancePaymentStatusOf } from './advancePayment.eligibility.js';
import { buildAdvancePaymentPdfBuffer } from './advancePayment.pdf.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const idStr = (v) => String(v);

/** PI payment-state filter → the PI match that selects it (mirrors piPaymentStateOf). */
const PI_STATE_MATCH = {
  PENDING:        { piStatus: PI_STATUS.READY_FOR_ADVANCE_PAYMENT, paidAmount: { $lte: 0 } },
  PARTIALLY_PAID: { piStatus: PI_STATUS.READY_FOR_ADVANCE_PAYMENT, paidAmount: { $gt: 0 } },
  FULLY_PAID:     { piStatus: PI_STATUS.PAYMENT_COMPLETED, balanceAmount: { $lte: 0.005 } },
  SHORT_CLOSED:   { piStatus: PI_STATUS.PAYMENT_COMPLETED, balanceAmount: { $gt: 0.005 } },
};

const normalizeProof = (doc) => (doc?.fileUrl
  ? { fileName: doc.fileName || '', fileUrl: doc.fileUrl, fileType: doc.fileType || '', uploadedAt: new Date() }
  : undefined);

const HISTORY_FIELDS = 'piId paymentNumber paymentDate paymentStatus paidAmount balanceAmount paymentMode paymentReferenceNumber bankReference performedByName proofDocument remarks createdAt';
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * PIs an advance can be paid against right now — the ONE eligibility the
 * Awaiting Advance queue, the "Record Advance Payment" PO selector and the
 * create check all use: PI ready for advance payment with a balance owed, on a
 * live (approved, not cancelled / closed) PO. Returns [{ pi, po }].
 */
export const findPayablePis = async (extraPiMatch = {}) => {
  const pis = await ProformaInvoice.find({
    isDeleted: { $ne: true }, piStatus: PI_STATUS.READY_FOR_ADVANCE_PAYMENT, balanceAmount: { $gt: 0 }, ...extraPiMatch,
  }).sort('-createdAt').lean();
  if (!pis.length) return [];
  const pos = await VendorPurchaseOrder.find({ _id: { $in: pis.map((p) => p.poId) }, isDeleted: { $ne: true } })
    .select('poNumber poDate indentNumber vendorName grandTotal totalAmount approvalStatus poStatus releaseStatus isDeleted').lean();
  const poOf = new Map(pos.map((p) => [String(p._id), p]));
  return pis.map((pi) => ({ pi, po: poOf.get(String(pi.poId)) })).filter((r) => isPoPayable(r.po));
};

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
    // A CANCELLED entry posts nothing. A posting payment runs under the per-PI
    // advance lock (the one invoice allocation and payment deletion use) and
    // reads the PI inside it, so two simultaneous submits can never both pass
    // the balance check and overpay — the second gets a clean 409.
    if (data.paymentStatus === PAYMENT_STATUS.CANCELLED) return this._create(data, user);
    return withPiAdvanceLock(data.piId, () => this._create(data, user));
  },

  async _create(data, user) {
    const pi = await ProformaInvoice.findOne({ _id: data.piId, isDeleted: { $ne: true } });
    if (!pi) throw new AppError('Proforma Invoice not found', 404);

    const isCancelledEntry = data.paymentStatus === PAYMENT_STATUS.CANCELLED;
    const piBlock = isCancelledEntry ? null : piPaymentBlock(pi);
    if (piBlock) throw new AppError(piBlock, 400);

    // A PI on a cancelled / unapproved PO is not payable (cancelling a PO leaves
    // its PI untouched, so the PO is checked here, inside the lock).
    if (!isCancelledEntry) {
      const poBlock = poPaymentBlock(await VendorPurchaseOrder.findOne({ _id: pi.poId }).select('poNumber approvalStatus poStatus isDeleted').lean());
      if (poBlock) throw new AppError(`${poBlock} — no advance can be recorded against it`, 400);
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
    const reference = String(data.paymentReferenceNumber || '').trim();

    // The same transfer must not be recorded twice against one PI. Checked here,
    // inside the per-PI lock, so two simultaneous submits cannot both pass.
    // A cash payment has no transfer reference, so only non-cash modes are checked.
    if (!isCancelledEntry && reference && data.paymentMode !== 'CASH') {
      const dup = await AdvancePayment.findOne({
        piId: pi._id, isDeleted: { $ne: true }, paymentStatus: { $ne: PAYMENT_STATUS.CANCELLED },
        paymentReferenceNumber: new RegExp(`^${escapeRegex(reference)}$`, 'i'),
      }).select('paymentNumber').lean();
      if (dup) throw new AppError(`Reference ${reference} is already recorded on ${dup.paymentNumber} for this PI`, 409);
    }

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
      paymentReferenceNumber: reference,
      bankReference: String(data.bankReference || '').trim(),
      proofDocument: normalizeProof(data.proofDocument),
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

  /**
   * Payment rows, each carrying its PI's CURRENT figures (advance required,
   * total paid, remaining, payment state) so the table shows where the whole
   * advance stands, not just this payment. One batched PI lookup per page.
   */
  async getAll(query) {
    const { piPaymentState, ...rest } = query || {};
    const base = { isDeleted: { $ne: true } };
    if (piPaymentState && PI_STATE_MATCH[piPaymentState]) {
      const ids = await ProformaInvoice.find({ isDeleted: { $ne: true }, ...PI_STATE_MATCH[piPaymentState] }).distinct('_id');
      base.piId = { $in: ids };
    }
    const features = new ApiFeatures(AdvancePayment.find(base), rest)
      .filter()
      .search(['paymentNumber', 'piNumber', 'poNumber', 'indentNumber', 'vendorName', 'paymentReferenceNumber'])
      .sort()
      .select()
      .paginate();
    const result = await features.exec();
    const piIds = [...new Set(result.docs.map((d) => idStr(d.piId)))];
    const pis = piIds.length
      ? await ProformaInvoice.find({ _id: { $in: piIds } }).select('totalValue paidAmount balanceAmount piStatus').lean()
      : [];
    const piOf = new Map(pis.map((p) => [idStr(p._id), p]));
    result.docs = result.docs.map((d) => {
      const pi = piOf.get(idStr(d.piId));
      return {
        ...d,
        advanceRequired: pi ? pi.totalValue : 0,
        totalPaid: pi ? pi.paidAmount : 0,
        remainingBalance: pi ? pi.balanceAmount : 0,
        piPaymentState: pi ? piPaymentStateOf(pi) : null,
      };
    });
    return result;
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

  /**
   * Purchase Orders an advance can be recorded against (the "Record Advance
   * Payment" selector): one row per payable PI with the PO's own details, the
   * PI figures the form needs and the PI's payment history. Read-only.
   */
  async getAdvanceCandidates({ search, onlyPayable, limit, piId } = {}) {
    const q = String(search || '').trim();
    const live = { isDeleted: { $ne: true }, approvalStatus: 'APPROVED', poStatus: { $nin: ['CANCELLED', 'CLOSED'] } };
    const poSelect = 'poNumber poDate indentNumber vendorName vendorGST vendorAddress vendorPhone grandTotal totalAmount approvalStatus poStatus releaseStatus piStatus piId isDeleted';

    let match = live;
    if (piId) {
      const one = await ProformaInvoice.findOne({ _id: piId, isDeleted: { $ne: true } }).select('poId').lean();
      match = { ...live, _id: one?.poId || null };
    } else if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      const piPoIds = await ProformaInvoice.find({ isDeleted: { $ne: true }, piNumber: re }).distinct('poId');
      match = { ...live, $or: [{ poNumber: re }, { vendorName: re }, { indentNumber: re }, { _id: { $in: piPoIds } }] };
    }
    let pos = await VendorPurchaseOrder.find(match).select(poSelect).sort('-createdAt').limit(1000).lean();
    if (!piId && !q) {
      // The newest-1000 window must never hide a PO that can actually be paid.
      const have = new Set(pos.map((p) => idStr(p._id)));
      const missing = (await findPayablePis()).map((r) => r.po).filter((p) => p && !have.has(idStr(p._id)));
      if (missing.length) pos = pos.concat(await VendorPurchaseOrder.find({ _id: { $in: missing.map((p) => p._id) } }).select(poSelect).lean());
    }
    if (!pos.length) return [];

    // The live PI of each PO: the one the PO points at, else its newest non-cancelled PI.
    const pis = await ProformaInvoice.find({
      poId: { $in: pos.map((p) => p._id) }, isDeleted: { $ne: true }, piStatus: { $ne: PI_STATUS.CANCELLED },
    }).sort('-createdAt').lean();
    const piOfPo = new Map();
    for (const pi of pis) {
      const k = idStr(pi.poId);
      const cur = piOfPo.get(k);
      const linked = pos.find((p) => idStr(p._id) === k && p.piId && idStr(p.piId) === idStr(pi._id));
      if (!cur || linked) piOfPo.set(k, pi);
    }

    let rows = pos.map((po) => {
      const pi = piOfPo.get(idStr(po._id)) || null;
      return { po, pi, state: advanceStateOf({ po, pi }) };
    });
    if (onlyPayable) rows = rows.filter((r) => r.state.payable);
    // Payable first, then the ones nearest to payable, then newest.
    const rank = { PAYABLE: 0, AWAITING_MD: 1, PI_PENDING: 2, NO_PI: 3, PO_NOT_RELEASED: 4 };
    rows.sort((a, b) => (rank[a.state.code] ?? 5) - (rank[b.state.code] ?? 5));
    rows = rows.slice(0, Math.min(Number(limit) || 100, 200));

    const history = await AdvancePayment.find({ piId: { $in: rows.filter((r) => r.pi).map((r) => r.pi._id) }, isDeleted: { $ne: true } })
      .select(HISTORY_FIELDS).sort('createdAt').lean();
    return rows.map(({ po, pi, state }) => ({
      poId: po._id,
      poNumber: po.poNumber || '',
      poDate: po.poDate,
      poTotal: po.grandTotal || po.totalAmount || 0,
      poApprovalStatus: po.approvalStatus,
      poStatus: po.poStatus,
      indentNumber: po.indentNumber || pi?.indentNumber || '',
      vendorName: po.vendorName || pi?.vendorName || '',
      vendor: {
        name: po.vendorName || pi?.vendorName || '', gst: po.vendorGST || pi?.vendorGST || '',
        address: po.vendorAddress || pi?.vendorAddress || '', phone: po.vendorPhone || pi?.vendorPhone || '',
      },
      state,
      paymentStatus: pi ? piPaymentStateOf(pi) : null,
      // The record the payment form takes — same shape as an Awaiting Advance row's `record`.
      pi: pi ? {
        _id: pi._id, piNumber: pi.piNumber, piDate: pi.piDate, poNumber: pi.poNumber || po.poNumber, vendorName: pi.vendorName || po.vendorName,
        totalValue: pi.totalValue, paidAmount: pi.paidAmount, balanceAmount: pi.balanceAmount,
        piStatus: pi.piStatus, approvalStatus: pi.approvalStatus, mdApprovalStatus: pi.mdApprovalStatus,
      } : null,
      payments: pi ? history.filter((h) => idStr(h.piId) === idStr(pi._id)) : [],
    }));
  },

  /** Kept for callers of the old endpoint: only POs an advance can be recorded against now, with its original PENDING / PART_PAYMENT status. */
  async getEligiblePos(args = {}) {
    const rows = await this.getAdvanceCandidates({ ...args, onlyPayable: true });
    return rows.map((r) => ({ ...r, paymentStatus: advancePaymentStatusOf(r.pi) }));
  },

  /**
   * Everything the Eye dialog and the PDF show for one payment: the payment,
   * its PI and PO, the MD approval, and every payment on the same PI with the
   * ones before this one split out.
   */
  async getDetail(id) {
    const payment = await AdvancePayment.findOne({ _id: id, isDeleted: { $ne: true } }).populate('createdBy', 'name').lean();
    if (!payment) throw new AppError('Payment not found', 404);
    const [pi, po, history, mdApproval] = await Promise.all([
      ProformaInvoice.findOne({ _id: payment.piId }).lean(),
      payment.poId ? VendorPurchaseOrder.findOne({ _id: payment.poId }).select(
        'poNumber poDate indentNumber vendorName grandTotal totalAmount approvalStatus poStatus releaseStatus',
      ).lean() : null,
      AdvancePayment.find({ piId: payment.piId, isDeleted: { $ne: true } }).select(HISTORY_FIELDS).sort('createdAt').lean(),
      DocumentApproval.findOne({ documentType: 'PROFORMA_INVOICE', documentId: payment.piId })
        .select('status signedByName designation signedAt').lean(),
    ]);
    const at = history.findIndex((h) => idStr(h._id) === idStr(payment._id));
    const previous = at >= 0 ? history.slice(0, at) : [];
    let running = 0;
    const withRunning = history.map((h) => {
      if (h.paymentStatus !== PAYMENT_STATUS.CANCELLED) running = round2(running + (Number(h.paidAmount) || 0));
      return { ...h, runningPaid: running };
    });
    return {
      payment, pi, po, previous, history: withRunning, mdApproval,
      summary: pi ? {
        advanceRequired: pi.totalValue, totalPaid: pi.paidAmount, remaining: pi.balanceAmount, state: piPaymentStateOf(pi),
      } : null,
    };
  },

  /** The payment's PDF, rendered fresh from the records (never a stale stored copy). */
  async buildPdf(id) {
    const detail = await this.getDetail(id);
    const company = await loadPdfCompany();
    const buffer = await buildAdvancePaymentPdfBuffer(detail, company);
    return { buffer, fileName: `${detail.payment.paymentNumber.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf` };
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

    // PO/PI-level figures: the advance owed on payable PIs plus what settled PIs
    // required, all from the PI records the payments post onto.
    const payable = (await findPayablePis()).map((r) => r.pi);
    const settled = await ProformaInvoice.find({ isDeleted: { $ne: true }, piStatus: PI_STATUS.PAYMENT_COMPLETED })
      .select('totalValue paidAmount balanceAmount piStatus').lean();
    const sum = (rows, k) => round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
    const states = [...payable, ...settled].map(piPaymentStateOf);
    return {
      ...p, ...q,
      totalAdvanceRequired: round2(sum(payable, 'totalValue') + sum(settled, 'totalValue')),
      totalPaid: p.paidAmount,
      remainingAdvance: sum(payable, 'balanceAmount'),
      partiallyPaidCount: states.filter((s) => s === 'PARTIALLY_PAID').length,
      fullyPaidCount: states.filter((s) => s === 'FULLY_PAID').length,
      shortClosedCount: states.filter((s) => s === 'SHORT_CLOSED').length,
    };
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
