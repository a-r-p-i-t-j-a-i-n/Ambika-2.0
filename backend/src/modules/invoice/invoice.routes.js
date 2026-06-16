/**
 * Sales Invoice (O2D Step 2.7 "Create Invoice & Eway Bill" + 2.8 email) API.
 *
 * Mirrors the client's invoice Google-form: status, invoice no/date/amount,
 * Invoice / E-way / PDIR attachments, transport details, remarks — linked to a
 * Delivery Challan so party / SO / PO / SKU summary auto-fill.
 *
 * Mounted at /api/v1/sales-invoices.
 */
import { Router } from 'express';
import Invoice from './invoice.model.js';
import DeliveryChallan from '../challan/challan.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { ApiResponse, AppError } from '../../utils/apiResponse.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { protect } from '../../middleware/auth.middleware.js';
import { attachUserPermissions } from '../../middleware/permission.middleware.js';
import { INVOICE_STATUS, STEP_STATUS } from '../../config/constants.js';
import { emailService } from '../../services/email.service.js';
import { logger } from '../../utils/logger.js';

// "Done"/"Yes" → DONE; "Cancelled" → SKIPPED; else keep as given.
const mapStepStatus = (s) => {
  const v = String(s || '').toUpperCase();
  if (['DONE', 'YES'].includes(v)) return STEP_STATUS.DONE;
  if (v === 'CANCELLED') return STEP_STATUS.SKIPPED;
  return STEP_STATUS.PENDING;
};

export const invoiceService = {
  async create(data, actor) {
    const exists = await Invoice.findOne({ invoiceNo: data.invoiceNo });
    if (exists) throw new AppError(`Invoice '${data.invoiceNo}' already exists`, 409);

    // Auto-fill context from the linked challan when one is chosen.
    if (data.dcId) {
      const dc = await DeliveryChallan.findById(data.dcId).lean();
      if (dc) {
        data.dcNumber = data.dcNumber || dc.dcNumber;
        data.poNumber = data.poNumber || dc.poNumber;
        data.partyId = data.partyId || dc.partyId;
        data.partyName = data.partyName || dc.partyName;
        data.skuSummary = data.skuSummary || (dc.items || []).map((i) => i.skuName).filter(Boolean).join(' / ');
        data.dispatchQtySummary = data.dispatchQtySummary || (dc.items || []).map((i) => i.quantityPcs).join(' / ');
        data.transporterName = data.transporterName || dc.transporterName;
        data.transportType = data.transportType || dc.dispatchedThrough;
      }
    }

    data.invoiceUrl = (data.invoiceUrls || [])[0] || data.invoiceUrl;
    data.ewayBillUrl = (data.ewayBillUrls || [])[0] || data.ewayBillUrl;
    data.creation = {
      planned: data.creation?.planned || null,
      actual: new Date(),
      status: mapStepStatus(data.status === 'CANCELLED' ? 'CANCELLED' : 'DONE'),
    };
    data.status = data.status === 'CANCELLED' ? INVOICE_STATUS.CANCELLED : INVOICE_STATUS.CREATED;
    data.createdBy = actor?._id;

    const inv = await Invoice.create(data);
    return inv.toObject();
  },

  async getAll(query) {
    const features = new ApiFeatures(Invoice.find(), query)
      .filter().search(['invoiceNo', 'dcNumber', 'partyName', 'poNumber']).sort().select().paginate()
      .populateRefs([{ path: 'partyId', select: 'name code email' }]);
    return features.exec();
  },

  async getById(id) {
    const doc = await Invoice.findById(id).populate('partyId', 'name code email').populate('dcId', 'dcNumber').lean();
    if (!doc) throw new AppError('Invoice not found', 404);
    return doc;
  },

  async update(id, data) {
    const inv = await Invoice.findById(id);
    if (!inv) throw new AppError('Invoice not found', 404);
    if (data.invoiceUrls) data.invoiceUrl = data.invoiceUrls[0] || inv.invoiceUrl;
    if (data.ewayBillUrls) data.ewayBillUrl = data.ewayBillUrls[0] || inv.ewayBillUrl;
    Object.assign(inv, data);
    await inv.save();
    return inv.toObject();
  },

  /** Step 2.8 — email the invoice + e-way bill to the client. */
  async sendToClient(id, { to, subject, message }) {
    const inv = await Invoice.findById(id).populate('partyId', 'name email').lean();
    if (!inv) throw new AppError('Invoice not found', 404);
    const recipient = to || inv.partyId?.email;
    if (!recipient) throw new AppError('No recipient email — add one to send.', 400);

    const attachmentUrls = [...(inv.invoiceUrls || []), ...(inv.ewayBillUrls || []), ...(inv.pdirUrls || [])].filter(Boolean);
    let emailStatus = 'SENT';
    try {
      await emailService.sendEmail({
        to: recipient,
        subject: subject || `Invoice ${inv.invoiceNo} — ${inv.partyName || ''}`,
        html: message || `<p>Dear ${inv.partyName || 'Customer'},</p><p>Please find your invoice <b>${inv.invoiceNo}</b> and supporting documents attached/linked below.</p>`
          + attachmentUrls.map((u) => `<p><a href="${u}">${u}</a></p>`).join(''),
      });
    } catch (err) {
      logger.error(`[invoice] email failed for ${inv.invoiceNo}: ${err.message}`);
      emailStatus = `FAILED: ${err.message}`;
    }
    await Invoice.updateOne({ _id: id }, {
      $set: {
        status: emailStatus === 'SENT' ? INVOICE_STATUS.SENT : inv.status,
        'emailToClient.actual': new Date(),
        'emailToClient.status': emailStatus === 'SENT' ? STEP_STATUS.DONE : STEP_STATUS.PENDING,
        'emailToClient.emailStatus': emailStatus,
      },
    });
    return { emailStatus, recipient };
  },
};

const c = {
  create:  asyncHandler(async (req, res) => { res.status(201).json(ApiResponse.created('Invoice created', await invoiceService.create(req.body, req.user))); }),
  getAll:  asyncHandler(async (req, res) => { const { docs, pagination } = await invoiceService.getAll(req.query); res.json(ApiResponse.ok('Invoices retrieved', docs, pagination)); }),
  getById: asyncHandler(async (req, res) => { res.json(ApiResponse.ok('Invoice retrieved', await invoiceService.getById(req.params.id))); }),
  update:  asyncHandler(async (req, res) => { res.json(ApiResponse.ok('Invoice updated', await invoiceService.update(req.params.id, req.body))); }),
  send:    asyncHandler(async (req, res) => { res.json(ApiResponse.ok('Invoice email processed', await invoiceService.sendToClient(req.params.id, req.body))); }),
};

const router = Router();
router.use(protect, attachUserPermissions);
router.route('/').get(c.getAll).post(c.create);
router.route('/:id').get(c.getById).put(c.update);
router.post('/:id/send', c.send);

export default router;
