import DispatchSchedule from './schedule.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import { recycleBinService } from '../recycle-bin/recycleBin.service.js';
import { binPlan } from '../recycle-bin/recycleBin.restore.js';

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

  /** Erase a schedule — a full copy goes to the Recycle Bin first. */
  async remove(id) {
    const doc = await DispatchSchedule.findById(id).lean();
    if (!doc) throw new AppError('Dispatch Schedule not found', 404);
    await recycleBinService.capture('dispatchSchedule', {
      recordId: doc._id,
      title: `Dispatch schedule · ${doc.soNumber}`,
      subtitle: [doc.partyName, doc.poNumber && `PO ${doc.poNumber}`].filter(Boolean).join(' · '),
      keywords: [doc.soNumber, (doc.items || []).map((i) => [i.skuName, i.skuCode])],
      openPath: `/dispatch-planning?so=${encodeURIComponent(doc.soNumber || '')}`,
      plan: { steps: [binPlan.reinsert(DispatchSchedule.modelName, doc)] },
    }, () => DispatchSchedule.deleteOne({ _id: doc._id }));
    return doc;
  },
};

// ── Controller ──────────────────────────────────────────────
export const scheduleController = {
  create:  asyncHandler(async (req, res) => { res.status(201).json(ApiResponse.created('Schedule created', await scheduleService.create(req.body))); }),
  getAll:  asyncHandler(async (req, res) => { const { docs, pagination } = await scheduleService.getAll(req.query); res.json(ApiResponse.ok('Schedules retrieved', docs, pagination)); }),
  getById: asyncHandler(async (req, res) => { res.json(ApiResponse.ok('Schedule retrieved', await scheduleService.getById(req.params.id))); }),
  getBySoNumber: asyncHandler(async (req, res) => { 
    const docs = await scheduleService.getBySoNumber(req.params.soNumber); 
    res.json(ApiResponse.ok('Schedules retrieved', docs)); 
  }),
  update:  asyncHandler(async (req, res) => { res.json(ApiResponse.ok('Schedule updated', await scheduleService.update(req.params.id, req.body))); }),
  remove:  asyncHandler(async (req, res) => { await scheduleService.remove(req.params.id); res.json(ApiResponse.ok('Schedule deleted')); }),
};

// ── Routes ──────────────────────────────────────────────────
// Signed-in users only.
const router = Router();
router.use(protect);
router.route('/').get(scheduleController.getAll).post(scheduleController.create);
router.get('/by-so/:soNumber', scheduleController.getBySoNumber);
router.route('/:id').get(scheduleController.getById).put(scheduleController.update).delete(scheduleController.remove);
export default router;
