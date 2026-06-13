import asyncHandler from '../../../middleware/asyncHandler.js';
import { tallyEntryService } from './tallyEntry.service.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

export const tallyEntryController = {
  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await tallyEntryService.getAll(req.query);
    res.json(ApiResponse.ok('Tally entries retrieved', docs, pagination));
  }),

  getStats: asyncHandler(async (_req, res) => {
    const stats = await tallyEntryService.getStats();
    res.json(ApiResponse.ok('Tally entry stats', stats));
  }),

  getByVoucher: asyncHandler(async (req, res) => {
    const rows = await tallyEntryService.getByVoucher(req.params.voucherId);
    res.json(ApiResponse.ok('Tally entries for voucher', rows));
  }),

  getById: asyncHandler(async (req, res) => {
    const t = await tallyEntryService.getById(req.params.id);
    res.json(ApiResponse.ok('Tally entry retrieved', t));
  }),

  create: asyncHandler(async (req, res) => {
    const t = await tallyEntryService.create(req.body, req.user);
    res.status(201).json(ApiResponse.created('Tally entry created', t));
  }),

  update: asyncHandler(async (req, res) => {
    const t = await tallyEntryService.update(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Tally entry updated', t));
  }),

  complete: asyncHandler(async (req, res) => {
    const t = await tallyEntryService.complete(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Tally entry processed', t));
  }),

  cancel: asyncHandler(async (req, res) => {
    const t = await tallyEntryService.cancel(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Tally entry cancelled', t));
  }),
};
