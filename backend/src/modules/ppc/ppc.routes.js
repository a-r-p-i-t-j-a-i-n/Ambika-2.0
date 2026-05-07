import PPCEntry from './ppc.model.js';
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
  update:  asyncHandler(async (req, res) => { res.json(ApiResponse.ok('PPC Entry updated', await ppcService.update(req.params.id, req.body))); }),
  remove:  asyncHandler(async (req, res) => { await ppcService.remove(req.params.id); res.json(ApiResponse.ok('PPC Entry deleted')); }),
};

// ── Routes ──────────────────────────────────────────────────
const router = Router();
router.route('/').get(ppcController.getAll).post(ppcController.create);
router.get('/month/:year/:month', ppcController.getByMonthYear);
router.route('/:id').get(ppcController.getById).put(ppcController.update).delete(ppcController.remove);
export default router;
