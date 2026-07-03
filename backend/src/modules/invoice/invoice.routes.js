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
import { o2dFmsService } from '../o2d-fms/o2d-fms.service.js';
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
        data.soNumber = data.soNumber || dc.soNumber;
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
    // Reflect into the FMS tracker — advance the order's "Create Invoice" step.
    if (inv.soNumber && data.status !== 'CANCELLED') {
      try { await o2dFmsService.advanceByTrigger({ soNumber: inv.soNumber }, 'INVOICE', actor); }
      catch (e) { logger.error(`[invoice] FMS advance failed: ${e.message}`); }
    }
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

  /** Step 2.8 — email the invoice + e-way bill to the client.
   *  `attachments` (optional): the exact set the sender chose — selected invoice
   *  documents plus any files uploaded from their computer. When provided we honor
   *  it exactly; when omitted we fall back to ALL of the invoice's stored docs. */
  async sendToClient(id, { to, cc, subject, message, attachments: chosen }) {
    const inv = await Invoice.findById(id).populate('partyId', 'name email').lean();
    if (!inv) throw new AppError('Invoice not found', 404);
    const recipient = to || inv.partyId?.email;
    if (!recipient) throw new AppError('No recipient email — add one to send.', 400);
    const ccList = (Array.isArray(cc) ? cc : String(cc || '').split(',')).map((e) => String(e).trim()).filter((e) => e.includes('@'));

    // Build real file attachments (nodemailer streams each URL) AND keep links in
    // the body as a fallback, so the client always gets the documents.
    const tagged = (Array.isArray(chosen)
      ? chosen.map((a, i) => (typeof a === 'string'
        ? { url: a, name: `Attachment-${i + 1}`, label: 'Document' }
        : { url: a.url || a.fileUrl, name: a.name || a.fileName || `Attachment-${i + 1}`, label: a.label || 'Document' }))
      : [
        ...(inv.invoiceUrls || []).map((u, i) => ({ url: u, name: `Invoice-${i + 1}`, label: 'Invoice' })),
        ...(inv.ewayBillUrls || []).map((u, i) => ({ url: u, name: `EwayBill-${i + 1}`, label: 'E-way Bill' })),
        ...(inv.pdirUrls || []).map((u, i) => ({ url: u, name: `PDIR-${i + 1}`, label: 'PDIR' })),
      ]
    ).filter((a) => a.url);
    // Resolve stored URLs → fetchable signed URLs so the files actually attach.
    const attachments = await emailService.resolveStoredAttachments(
      tagged.map((a) => ({ filename: a.name, url: a.url })),
    );
    // A clean, professional HTML email — NO raw URLs in the body. The documents
    // ride along as real attachments; we just list their names for reference.
    const bodyHtml = message || `<p>Dear ${inv.partyName || 'Customer'},</p><p>Please find your tax invoice <b>${inv.invoiceNo}</b> and supporting documents attached.</p>`;
    const docListHtml = tagged.length
      ? `<tr><td style="padding:14px 24px 4px;font:600 13px Arial,Helvetica,sans-serif;color:#334155;">Attached documents</td></tr>`
        + `<tr><td style="padding:0 24px 18px;">`
        + tagged.map((a) => `<span style="display:inline-block;margin:4px 6px 0 0;padding:5px 11px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;font:600 12px Arial,Helvetica,sans-serif;color:#0f172a;">📎 ${a.name}</span>`).join('')
        + `</td></tr>`
      : '';
    const html = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
        <tr><td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <tr><td style="background:#0f172a;padding:20px 24px;">
              <span style="font:700 18px Arial,Helvetica,sans-serif;color:#ffffff;letter-spacing:.3px;">M/s AMBIKA GLOBAL</span>
            </td></tr>
            <tr><td style="padding:24px;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:#1e293b;">${bodyHtml}</td></tr>
            ${docListHtml ? `<tr><td><div style="border-top:1px solid #eef2f6;"></div></td></tr>${docListHtml}` : ''}
            <tr><td style="background:#f8fafc;border-top:1px solid #eef2f6;padding:16px 24px;font:400 12px Arial,Helvetica,sans-serif;color:#94a3b8;">
              This is a system-generated email from Ambika Global. Please do not reply to this message.
            </td></tr>
          </table>
        </td></tr>
      </table>`;
    let emailStatus = 'SENT';
    try {
      await emailService.sendEmail({
        to: recipient,
        cc: ccList,
        subject: subject || `Invoice ${inv.invoiceNo} — ${inv.partyName || ''}`,
        html,
        attachments,
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
