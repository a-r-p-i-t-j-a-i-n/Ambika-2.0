import fs from 'fs';
import path from 'path';
import DeliveryChallan from './challan.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import { generateDocNumber } from '../../utils/docNumberGenerator.js';
import { orderService } from '../order/order.service.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { Router } from 'express';
import { pdfService } from '../../services/pdf.service.js';
import { s3Enabled, buildKey, uploadBuffer } from '../../common/uploads/s3.service.js';
import { logger } from '../../utils/logger.js';

// Absolute base for this API (so PDF links work from the different-origin frontend
// and from email/WhatsApp). Override with SERVER_URL in production.
const SERVER_BASE = (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');

// ── Service ─────────────────────────────────────────────────
export const challanService = {
  async create(data) {
    if (!data.dcNumber) {
      data.dcNumber = await generateDocNumber('DELIVERY_CHALLAN', data.dcDate || new Date());
    }
    const dc = await DeliveryChallan.create(data);

    // Auto-update dispatched qty on sales order
    if (dc.soNumber && dc.items) {
      for (const item of dc.items) {
        try {
          const skuCode = item.skuCode || item.skuName;
          await orderService.updateDispatchQty(dc.soNumber, skuCode, item.quantityPcs);
        } catch (_) { /* skip if order not found */ }
      }
    }
    // Auto-generate the delivery-challan PDF (non-fatal).
    try { const { pdfUrl } = await challanService.generatePdf(dc._id); dc.pdfUrl = pdfUrl; }
    catch (err) { logger.error(`[challan] PDF generation failed for ${dc.dcNumber}: ${err.message}`); }
    return dc;
  },

  /**
   * Build the challan PDF buffer from the LIVE record — no upload, no save.
   * Used by the preview/download endpoint so the document always reflects the
   * current dispatch and nothing is persisted.
   */
  async renderBuffer(id) {
    const dc = await DeliveryChallan.findById(id)
      .populate('partyId', 'name location email addresses').lean();
    if (!dc) throw new AppError('Delivery Challan not found', 404);

    // Best-effort delivery address from the party if the DC didn't capture one.
    if (!dc.deliveryAddress && dc.partyId) {
      const a = (dc.partyId.addresses || [])[0];
      dc.deliveryAddress = a
        ? [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ')
        : (dc.partyId.location || '');
    }

    const buffer = await pdfService.generateDeliveryChallanBuffer(dc);
    const fileName = `${String(dc.dcNumber || 'DC').replace(/[^\w.-]/g, '_')}.pdf`;
    return { buffer, fileName };
  },

  /** Generate (or regenerate) the challan PDF, store it (S3 or local) and save pdfUrl. */
  async generatePdf(id) {
    const { buffer, fileName } = await challanService.renderBuffer(id);

    let pdfUrl;
    if (s3Enabled) {
      const key = buildKey('challans', fileName);
      await uploadBuffer({ buffer, key, contentType: 'application/pdf' });
      pdfUrl = `${SERVER_BASE}/api/v1/uploads/file?key=${encodeURIComponent(key)}`;
    } else {
      const dir = path.resolve(process.cwd(), 'uploads', 'challans');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fp = path.join(dir, `${Date.now()}-${fileName}`);
      fs.writeFileSync(fp, buffer);
      pdfUrl = `${SERVER_BASE}/uploads/challans/${path.basename(fp)}`;
    }
    await DeliveryChallan.updateOne({ _id: id }, { $set: { pdfUrl } });
    return { pdfUrl };
  },

  async getAll(query) {
    const features = new ApiFeatures(DeliveryChallan.find(), query)
      .filter().search(['dcNumber', 'soNumber', 'partyName']).sort().select().paginate()
      .populateRefs([{ path: 'partyId', select: 'name code' }]);
    return features.exec();
  },

  async getById(id) {
    const doc = await DeliveryChallan.findById(id)
      .populate('partyId', 'name code location email phone addresses')
      .populate('items.skuId', 'name code')
      .populate('createdBy', 'name email')
      .lean();
    if (!doc) throw new AppError('Delivery Challan not found', 404);
    return doc;
  },

  async update(id, data) {
    const doc = await DeliveryChallan.findById(id);
    if (!doc) throw new AppError('Delivery Challan not found', 404);
    Object.assign(doc, data);
    await doc.save();
    return doc.toObject();
  },

  async remove(id) {
    const doc = await DeliveryChallan.findByIdAndDelete(id);
    if (!doc) throw new AppError('Delivery Challan not found', 404);
    return doc;
  },
};

// ── Controller ──────────────────────────────────────────────
export const challanController = {
  create:  asyncHandler(async (req, res) => { res.status(201).json(ApiResponse.created('DC created', await challanService.create(req.body))); }),
  getAll:  asyncHandler(async (req, res) => { const { docs, pagination } = await challanService.getAll(req.query); res.json(ApiResponse.ok('DCs retrieved', docs, pagination)); }),
  getById: asyncHandler(async (req, res) => { res.json(ApiResponse.ok('DC retrieved', await challanService.getById(req.params.id))); }),
  update:  asyncHandler(async (req, res) => { res.json(ApiResponse.ok('DC updated', await challanService.update(req.params.id, req.body))); }),
  remove:  asyncHandler(async (req, res) => { await challanService.remove(req.params.id); res.json(ApiResponse.ok('DC deleted')); }),
  generatePdf: asyncHandler(async (req, res) => { res.json(ApiResponse.ok('PDF generated', await challanService.generatePdf(req.params.id))); }),
  // Inline, always-fresh preview — streams the PDF bytes, saves nothing.
  previewPdf: asyncHandler(async (req, res) => {
    const { buffer, fileName } = await challanService.renderBuffer(req.params.id);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(buffer);
  }),
};

// ── Routes ──────────────────────────────────────────────────
const router = Router();
router.route('/').get(challanController.getAll).post(challanController.create);
router.post('/:id/pdf', challanController.generatePdf);
router.get('/:id/pdf/preview', challanController.previewPdf); // inline, no-save preview/download
router.route('/:id').get(challanController.getById).put(challanController.update).delete(challanController.remove);
export default router;
