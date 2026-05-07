import DeliveryChallan from './challan.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import { generateDocNumber } from '../../utils/docNumberGenerator.js';
import { orderService } from '../order/order.service.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { Router } from 'express';

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
          const skuCode = item.skuName; // fallback if skuCode not available
          await orderService.updateDispatchQty(dc.soNumber, skuCode, item.quantityPcs);
        } catch (_) { /* skip if order not found */ }
      }
    }
    return dc;
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
      .populate('items.skuId', 'name code').lean();
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
};

// ── Routes ──────────────────────────────────────────────────
const router = Router();
router.route('/').get(challanController.getAll).post(challanController.create);
router.route('/:id').get(challanController.getById).put(challanController.update).delete(challanController.remove);
export default router;
