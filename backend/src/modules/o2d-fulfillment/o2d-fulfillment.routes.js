/**
 * O2D Fulfillment — post-dispatch step entries (2.9–2.13), one mounted module:
 *   2.9  Track delivery            → updates the Delivery Challan
 *   2.10 Follow up for payment     → Payment.followUp
 *   2.11 Receive payment + Tally   → Payment.confirmation (+ Invoice received/balance)
 *   2.12 Receive transport bill    → TransportBill.receipt
 *   2.13 Transport bill payment    → TransportBill.payment
 *
 * Mounted at /api/v1/o2d-fulfillment.
 */
import { Router } from 'express';
import DeliveryChallan from '../challan/challan.model.js';
import Payment from '../payment/payment.model.js';
import TransportBill from '../transport/transport.model.js';
import Invoice from '../invoice/invoice.model.js';
import { ApiResponse, AppError } from '../../utils/apiResponse.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { protect } from '../../middleware/auth.middleware.js';
import { attachUserPermissions } from '../../middleware/permission.middleware.js';
import { STEP_STATUS, DC_STATUS, PAYMENT_TYPE, INVOICE_STATUS } from '../../config/constants.js';
import { o2dFmsService } from '../o2d-fms/o2d-fms.service.js';
import { logger } from '../../utils/logger.js';

// Best-effort: surface an entry into the FMS tracker via its trigger.
const advance = async (soNumber, trigger) => {
  if (!soNumber) return;
  try { await o2dFmsService.advanceByTrigger({ soNumber }, trigger, null); }
  catch (e) { logger.error(`[o2d-fulfillment] ${trigger} advance failed: ${e.message}`); }
};

// Best-effort: record WHO did this step for THIS challan (per-consignment audit).
const logStep = async (soNumber, dcId, dcNumber, stepCode, actor, status = 'DONE') => {
  if (!soNumber || !dcId) return;
  try { await o2dFmsService.recordConsignmentStep({ soNumber, dcId, dcNumber, stepCode, actor, status }); }
  catch (e) { logger.error(`[o2d-fulfillment] log ${stepCode} failed: ${e.message}`); }
};

// Yes/Done → DONE, Cancelled → SKIPPED, No → PENDING.
const toStep = (s) => {
  const v = String(s || '').toUpperCase();
  if (['YES', 'DONE'].includes(v)) return STEP_STATUS.DONE;
  if (v === 'CANCELLED') return STEP_STATUS.SKIPPED;
  return STEP_STATUS.PENDING;
};

export const fulfillmentService = {
  // ── 2.9 Track delivery ────────────────────────────────────
  async trackDelivery({ dcId, status, deliveryDate, newTrackDate }, actor) {
    const dc = await DeliveryChallan.findById(dcId);
    if (!dc) throw new AppError('Delivery Challan not found', 404);
    dc.deliveryStatus = status || dc.deliveryStatus;
    if (status === 'Delivered') { dc.status = DC_STATUS.DELIVERED; dc.deliveryDate = deliveryDate || new Date(); }
    else if (status === 'Cancelled') { dc.status = DC_STATUS.CANCELLED; }
    // A fresh re-track date replaces the old one; clear it once delivered.
    if (newTrackDate) dc.newTrackDate = newTrackDate;
    if (status === 'Delivered') dc.newTrackDate = null;
    await dc.save();
    if (status === 'Delivered') {
      await advance(dc.soNumber, 'POD'); // reflect in FMS tracker
    }
    // Logged for every recorded outcome, not just delivery: the doer performed
    // the task either way, so the action shows "Do again" with who/when instead
    // of staying on "Not done for this consignment yet".
    if (status) await logStep(dc.soNumber, dc._id, dc.dcNumber, '2.09', actor);
    return dc.toObject();
  },

  // Upsert the client Payment row for an invoice, carrying context.
  async _payment(invoiceId, dcId) {
    if (!invoiceId) throw new AppError('No invoice selected for this consignment — pick its invoice first.', 400);
    let pay = await Payment.findOne({ invoiceId, type: PAYMENT_TYPE.CLIENT_PAYMENT });
    if (!pay) {
      const inv = invoiceId ? await Invoice.findById(invoiceId).lean() : null;
      pay = new Payment({
        invoiceId, dcId: dcId || inv?.dcId, dcNumber: inv?.dcNumber,
        partyId: inv?.partyId, partyName: inv?.partyName, type: PAYMENT_TYPE.CLIENT_PAYMENT,
      });
    }
    return pay;
  },

  // ── 2.10 Follow up for payment ────────────────────────────
  async paymentFollowUp({ invoiceId, dcId, status }, actor) {
    const pay = await this._payment(invoiceId, dcId);
    pay.set('followUp.actual', new Date());
    pay.set('followUp.status', toStep(status));
    await pay.save();
    const inv = invoiceId ? await Invoice.findById(invoiceId).select('soNumber dcNumber dcId').lean() : null;
    await logStep(inv?.soNumber, dcId || pay.dcId || inv?.dcId, pay.dcNumber || inv?.dcNumber, '2.10', actor);
    return pay.toObject();
  },

  // ── 2.11 Receive payment + Tally entry ────────────────────
  async paymentReceipt({ invoiceId, dcId, status, receivedDate, receivedAmount }, actor) {
    const pay = await this._payment(invoiceId, dcId);
    pay.set('confirmation.actual', new Date());
    pay.set('confirmation.receivedDate', receivedDate || new Date());
    pay.set('confirmation.receivedAmount', Number(receivedAmount) || 0);
    pay.set('confirmation.status', toStep(status));
    await pay.save();

    // Reflect on the invoice's received/balance + status.
    if (invoiceId && status !== 'Cancelled') {
      const inv = await Invoice.findById(invoiceId);
      if (inv) {
        // SET, never +=. The Payment record holds what has been received for this
        // invoice, so re-saving 2.11 (a correction, or a retry after an error)
        // restates the figure instead of adding it again. The old `+=` is how a
        // ₹3,000 invoice reached ₹120,000 received.
        const received = Number(pay.confirmation?.receivedAmount) || 0;
        const amount = Number(inv.invoiceAmount) || 0;
        inv.amountReceived = received;
        inv.status = received >= amount && amount > 0 ? INVOICE_STATUS.PAID : INVOICE_STATUS.PARTIAL;
        // The receipt itself is already saved on the Payment record; mirroring it
        // onto the invoice is a SIDE-EFFECT and must never fail the step. A legacy
        // invoice missing a required field (invoiceNo / invoiceDate) would make
        // full-document validation throw, and the doer would just see a 422 on a
        // form they filled correctly. Fall back to writing only the three derived
        // fields, which skips validation of the rest of the document.
        try {
          await inv.save(); // pre-save recomputes balance
        } catch (err) {
          logger.error(`[o2d-fulfillment] invoice ${inv.invoiceNo || invoiceId} amount sync failed: ${err.message}`);
          await Invoice.updateOne(
            { _id: inv._id },
            { $set: { amountReceived: received, balance: Math.max(0, amount - received), status: inv.status } },
          ).catch((e) => logger.error(`[o2d-fulfillment] invoice amount fallback failed: ${e.message}`));
        }
        await advance(inv.soNumber, 'PAYMENT'); // reflect in FMS tracker
        await logStep(inv.soNumber, inv.dcId || dcId || pay.dcId, inv.dcNumber || pay.dcNumber, '2.11', actor);
      }
    }
    return pay.toObject();
  },

  // Upsert the TransportBill row for a challan.
  async _transport(dcId) {
    if (!dcId) throw new AppError('No delivery challan selected for this transport bill.', 400);
    let tb = await TransportBill.findOne({ dcId });
    if (!tb) {
      const dc = await DeliveryChallan.findById(dcId).lean();
      tb = new TransportBill({ dcId, dcNumber: dc?.dcNumber });
    }
    return tb;
  },

  // ── 2.12 Receive transport bill ───────────────────────────
  async transportReceive({ dcId, status, attachment }, actor) {
    const tb = await this._transport(dcId);
    tb.set('receipt.actual', new Date());
    tb.set('receipt.status', toStep(status));
    if (attachment) tb.set('receipt.attachment', attachment);
    await tb.save();
    const dc = await DeliveryChallan.findById(dcId).select('soNumber dcNumber').lean();
    await logStep(dc?.soNumber, dcId, dc?.dcNumber || tb.dcNumber, '2.12', actor);
    return tb.toObject();
  },

  // ── 2.13 Transport bill payment status ────────────────────
  async transportPayment({ dcId, status }, actor) {
    const tb = await this._transport(dcId);
    tb.set('payment.actual', new Date());
    tb.set('payment.status', toStep(status));
    await tb.save();
    const dc = await DeliveryChallan.findById(dcId).select('soNumber dcNumber').lean();
    await logStep(dc?.soNumber, dcId, dc?.dcNumber || tb.dcNumber, '2.13', actor);
    return tb.toObject();
  },

  // ── Master-data lists ─────────────────────────────────────
  async listPayments() {
    return Payment.find().populate('partyId', 'name code').sort({ updatedAt: -1 }).limit(2000).lean();
  },
  async listTransportBills() {
    return TransportBill.find().sort({ updatedAt: -1 }).limit(2000).lean();
  },
};

const wrap = (fn, msg) => asyncHandler(async (req, res) => res.json(ApiResponse.ok(msg, await fn(req.body, req.user))));

const router = Router();
router.use(protect, attachUserPermissions);
router.get('/payments',        asyncHandler(async (_req, res) => res.json(ApiResponse.ok('Payments', await fulfillmentService.listPayments()))));
router.get('/transport-bills', asyncHandler(async (_req, res) => res.json(ApiResponse.ok('Transport bills', await fulfillmentService.listTransportBills()))));
router.post('/track-delivery',          wrap((b, u) => fulfillmentService.trackDelivery(b, u), 'Delivery updated'));
router.post('/payment-followup',        wrap((b, u) => fulfillmentService.paymentFollowUp(b, u), 'Payment follow-up saved'));
router.post('/payment-receipt',         wrap((b, u) => fulfillmentService.paymentReceipt(b, u), 'Payment receipt saved'));
router.post('/transport-bill-receive',  wrap((b, u) => fulfillmentService.transportReceive(b, u), 'Transport bill receipt saved'));
router.post('/transport-bill-payment',  wrap((b, u) => fulfillmentService.transportPayment(b, u), 'Transport bill payment saved'));

export default router;
