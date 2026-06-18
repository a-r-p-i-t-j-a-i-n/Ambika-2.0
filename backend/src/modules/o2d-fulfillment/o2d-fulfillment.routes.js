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

// Yes/Done → DONE, Cancelled → SKIPPED, No → PENDING.
const toStep = (s) => {
  const v = String(s || '').toUpperCase();
  if (['YES', 'DONE'].includes(v)) return STEP_STATUS.DONE;
  if (v === 'CANCELLED') return STEP_STATUS.SKIPPED;
  return STEP_STATUS.PENDING;
};

export const fulfillmentService = {
  // ── 2.9 Track delivery ────────────────────────────────────
  async trackDelivery({ dcId, status, deliveryDate, newTrackDate }) {
    const dc = await DeliveryChallan.findById(dcId);
    if (!dc) throw new AppError('Delivery Challan not found', 404);
    dc.deliveryStatus = status || dc.deliveryStatus;
    if (status === 'Delivered') { dc.status = DC_STATUS.DELIVERED; dc.deliveryDate = deliveryDate || new Date(); }
    else if (status === 'Cancelled') { dc.status = DC_STATUS.CANCELLED; }
    if (newTrackDate) dc.newTrackDate = newTrackDate;
    await dc.save();
    if (status === 'Delivered') await advance(dc.soNumber, 'POD'); // reflect in FMS tracker
    return dc.toObject();
  },

  // Upsert the client Payment row for an invoice, carrying context.
  async _payment(invoiceId, dcId) {
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
  async paymentFollowUp({ invoiceId, dcId, status }) {
    const pay = await this._payment(invoiceId, dcId);
    pay.followUp = { ...pay.followUp, actual: new Date(), status: toStep(status) };
    await pay.save();
    return pay.toObject();
  },

  // ── 2.11 Receive payment + Tally entry ────────────────────
  async paymentReceipt({ invoiceId, dcId, status, receivedDate, receivedAmount }) {
    const pay = await this._payment(invoiceId, dcId);
    pay.confirmation = {
      ...pay.confirmation,
      actual: new Date(),
      receivedDate: receivedDate || new Date(),
      receivedAmount: Number(receivedAmount) || 0,
      status: toStep(status),
    };
    await pay.save();

    // Reflect on the invoice's received/balance + status.
    if (invoiceId && status !== 'Cancelled') {
      const inv = await Invoice.findById(invoiceId);
      if (inv) {
        inv.amountReceived = (inv.amountReceived || 0) + (Number(receivedAmount) || 0);
        inv.status = inv.amountReceived >= (inv.invoiceAmount || 0) && inv.invoiceAmount > 0
          ? INVOICE_STATUS.PAID : INVOICE_STATUS.PARTIAL;
        await inv.save(); // pre-save recomputes balance
        await advance(inv.soNumber, 'PAYMENT'); // reflect in FMS tracker
      }
    }
    return pay.toObject();
  },

  // Upsert the TransportBill row for a challan.
  async _transport(dcId) {
    let tb = await TransportBill.findOne({ dcId });
    if (!tb) {
      const dc = await DeliveryChallan.findById(dcId).lean();
      tb = new TransportBill({ dcId, dcNumber: dc?.dcNumber });
    }
    return tb;
  },

  // ── 2.12 Receive transport bill ───────────────────────────
  async transportReceive({ dcId, status, attachment }) {
    const tb = await this._transport(dcId);
    tb.receipt = { ...tb.receipt, actual: new Date(), status: toStep(status), attachment: attachment || tb.receipt?.attachment };
    await tb.save();
    return tb.toObject();
  },

  // ── 2.13 Transport bill payment status ────────────────────
  async transportPayment({ dcId, status }) {
    const tb = await this._transport(dcId);
    tb.payment = { ...tb.payment, actual: new Date(), status: toStep(status) };
    await tb.save();
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

const wrap = (fn, msg) => asyncHandler(async (req, res) => res.json(ApiResponse.ok(msg, await fn(req.body))));

const router = Router();
router.use(protect, attachUserPermissions);
router.get('/payments',        asyncHandler(async (_req, res) => res.json(ApiResponse.ok('Payments', await fulfillmentService.listPayments()))));
router.get('/transport-bills', asyncHandler(async (_req, res) => res.json(ApiResponse.ok('Transport bills', await fulfillmentService.listTransportBills()))));
router.post('/track-delivery',          wrap((b) => fulfillmentService.trackDelivery(b), 'Delivery updated'));
router.post('/payment-followup',        wrap((b) => fulfillmentService.paymentFollowUp(b), 'Payment follow-up saved'));
router.post('/payment-receipt',         wrap((b) => fulfillmentService.paymentReceipt(b), 'Payment receipt saved'));
router.post('/transport-bill-receive',  wrap((b) => fulfillmentService.transportReceive(b), 'Transport bill receipt saved'));
router.post('/transport-bill-payment',  wrap((b) => fulfillmentService.transportPayment(b), 'Transport bill payment saved'));

export default router;
