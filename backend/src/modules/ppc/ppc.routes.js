import PPCEntry from './ppc.model.js';
import SalesOrder from '../order/order.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { Router } from 'express';

// ── Service ─────────────────────────────────────────────────
export const ppcService = {
  async create(data) { return PPCEntry.create(data); },

  async getAll(query) {
    const features = new ApiFeatures(PPCEntry.find(), query)
      .filter().search(['soNumber', 'skuName', 'skuCode', 'partyName']).sort().select().paginate();
    return features.exec();
  },

  async getById(id) {
    const doc = await PPCEntry.findById(id).lean();
    if (!doc) throw new AppError('PPC Entry not found', 404);
    return doc;
  },

  async getByMonthYear(month, year) {
    return PPCEntry.find({ month, year })
      .populate('partyId', 'name code')
      .populate('skuId', 'name code')
      .sort('soNumber skuCode')
      .lean();
  },

  async update(id, data) {
    const doc = await PPCEntry.findByIdAndUpdate(id, data, { new: true, runValidators: true }).lean();
    if (!doc) throw new AppError('PPC Entry not found', 404);
    return doc;
  },

  async upsert(filter, data) {
    return PPCEntry.findOneAndUpdate(filter, data, { new: true, upsert: true, runValidators: true }).lean();
  },

  async updateDailyPlan(data) {
    const planDate = data.date || data.planDate || data.plannedDate;
    if (!planDate) throw new AppError('Plan date is required', 422);

    const d = new Date(planDate);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();

    let order = null;
    if (data.orderId) order = await SalesOrder.findById(data.orderId);
    if (!order && data.soNumber) order = await SalesOrder.findOne({ soNumber: data.soNumber });

    const skuRef = String(data.skuCode || data.skuId || data.skuName || '').trim().toLowerCase();
    const orderItem = order?.items?.find((item) => (
      String(item.skuCode || '').toLowerCase() === skuRef
      || String(item.skuName || '').toLowerCase() === skuRef
      || String(item.skuId || '') === String(data.skuId || '')
      || String(item._id || '') === String(data.orderItemId || '')
    ));

    const soNumber = data.soNumber || order?.soNumber;
    const skuCode = data.skuCode || orderItem?.skuCode;
    if (!soNumber || !skuCode) throw new AppError('SO number and SKU code are required', 422);

    const quantity = Number(data.quantity || data.plannedQty || data.actualQty || 0);
    if (quantity <= 0) throw new AppError('Quantity must be greater than zero', 422);

    const entry = await PPCEntry.findOneAndUpdate(
      { month, year, soNumber, skuCode },
      {
        $setOnInsert: {
          month,
          year,
          soNumber,
          partyId: order?.partyId || data.partyId,
          partyName: order?.partyName || data.partyName,
          skuId: orderItem?.skuId || data.skuId,
          skuCode,
          skuName: orderItem?.skuName || data.skuName,
          orderQty: orderItem?.orderQty || data.orderQty || 0,
        },
      },
      { new: true, upsert: true },
    );

    const dayKey = new Date(d);
    dayKey.setHours(0, 0, 0, 0);
    const existingDay = entry.dailyPlan.find((plan) => {
      const current = new Date(plan.date);
      current.setHours(0, 0, 0, 0);
      return current.getTime() === dayKey.getTime();
    });

    const isActual = String(data.planType || '').toUpperCase().includes('ACTUAL');
    if (existingDay) {
      if (isActual) existingDay.dispActual = quantity;
      else existingDay.dispPlan = quantity;
    } else {
      entry.dailyPlan.push({
        date: dayKey,
        dispPlan: isActual ? 0 : quantity,
        dispActual: isActual ? quantity : 0,
      });
    }

    entry.markModified('dailyPlan');
    await entry.save();
    return entry.toObject();
  },

  async remove(id) {
    const doc = await PPCEntry.findByIdAndDelete(id);
    if (!doc) throw new AppError('PPC Entry not found', 404);
    return doc;
  },
};

// ── Controller ──────────────────────────────────────────────
export const ppcController = {
  create:  asyncHandler(async (req, res) => { res.status(201).json(ApiResponse.created('PPC Entry created', await ppcService.create(req.body))); }),
  getAll:  asyncHandler(async (req, res) => { const { docs, pagination } = await ppcService.getAll(req.query); res.json(ApiResponse.ok('PPC Entries retrieved', docs, pagination)); }),
  getById: asyncHandler(async (req, res) => { res.json(ApiResponse.ok('PPC Entry retrieved', await ppcService.getById(req.params.id))); }),
  getByMonthYear: asyncHandler(async (req, res) => {
    const { month, year } = req.params;
    const docs = await ppcService.getByMonthYear(Number(month), Number(year));
    res.json(ApiResponse.ok('PPC Entries retrieved', docs));
  }),
  updateDailyPlan: asyncHandler(async (req, res) => {
    const doc = await ppcService.updateDailyPlan(req.body);
    res.json(ApiResponse.ok('PPC daily plan updated', doc));
  }),
  update:  asyncHandler(async (req, res) => { res.json(ApiResponse.ok('PPC Entry updated', await ppcService.update(req.params.id, req.body))); }),
  remove:  asyncHandler(async (req, res) => { await ppcService.remove(req.params.id); res.json(ApiResponse.ok('PPC Entry deleted')); }),
};

// ── Routes ──────────────────────────────────────────────────
const router = Router();
router.route('/').get(ppcController.getAll).post(ppcController.create);
router.post('/plan/daily', ppcController.updateDailyPlan);
router.get('/month/:year/:month', ppcController.getByMonthYear);
router.route('/:id').get(ppcController.getById).put(ppcController.update).delete(ppcController.remove);
export default router;
