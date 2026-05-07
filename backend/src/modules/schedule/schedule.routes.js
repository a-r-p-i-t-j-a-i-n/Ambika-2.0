import DispatchSchedule from './schedule.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { Router } from 'express';

// ── Service ─────────────────────────────────────────────────
export const scheduleService = {
  async create(data) { return DispatchSchedule.create(data); },

  async getAll(query) {
    const features = new ApiFeatures(DispatchSchedule.find(), query)
      .filter().search(['soNumber', 'poNumber', 'partyName']).sort().select().paginate()
      .populateRefs([{ path: 'partyId', select: 'name code' }]);
    return features.exec();
  },

  async getById(id) {
    const doc = await DispatchSchedule.findById(id)
      .populate('partyId', 'name code location email phone addresses')
      .populate('items.skuId', 'name code pcsPerBox weightPerPc').lean();
    if (!doc) throw new AppError('Dispatch Schedule not found', 404);
    return doc;
  },

  async getBySoNumber(soNumber) {
    return DispatchSchedule.find({ soNumber }).populate('partyId', 'name code').lean();
  },

  async update(id, data) {
    const doc = await DispatchSchedule.findByIdAndUpdate(id, data, { new: true, runValidators: true }).lean();
    if (!doc) throw new AppError('Dispatch Schedule not found', 404);
    return doc;
  },

  async remove(id) {
    const doc = await DispatchSchedule.findByIdAndDelete(id);
    if (!doc) throw new AppError('Dispatch Schedule not found', 404);
    return doc;
  },
};

// ── Controller ──────────────────────────────────────────────
export const scheduleController = {
  create:  asyncHandler(async (req, res) => { res.status(201).json(ApiResponse.created('Schedule created', await scheduleService.create(req.body))); }),
  getAll:  asyncHandler(async (req, res) => { const { docs, pagination } = await scheduleService.getAll(req.query); res.json(ApiResponse.ok('Schedules retrieved', docs, pagination)); }),
  getById: asyncHandler(async (req, res) => { res.json(ApiResponse.ok('Schedule retrieved', await scheduleService.getById(req.params.id))); }),
  update:  asyncHandler(async (req, res) => { res.json(ApiResponse.ok('Schedule updated', await scheduleService.update(req.params.id, req.body))); }),
  remove:  asyncHandler(async (req, res) => { await scheduleService.remove(req.params.id); res.json(ApiResponse.ok('Schedule deleted')); }),
};

// ── Routes ──────────────────────────────────────────────────
const router = Router();
router.route('/').get(scheduleController.getAll).post(scheduleController.create);
router.route('/:id').get(scheduleController.getById).put(scheduleController.update).delete(scheduleController.remove);
export default router;
