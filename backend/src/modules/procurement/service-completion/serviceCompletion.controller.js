import asyncHandler from '../../../middleware/asyncHandler.js';
import { serviceCompletionService } from './serviceCompletion.service.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

export const serviceCompletionController = {
  create: asyncHandler(async (req, res) => {
    const sc = await serviceCompletionService.create(req.body, req.user);
    res.status(201).json(ApiResponse.ok('Service completion recorded', sc));
  }),

  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await serviceCompletionService.getAll(req.query);
    res.json(ApiResponse.ok('Service completions retrieved', docs, pagination));
  }),

  getStats: asyncHandler(async (req, res) => {
    const stats = await serviceCompletionService.getStats();
    res.json(ApiResponse.ok('Service completion stats', stats));
  }),

  getById: asyncHandler(async (req, res) => {
    const sc = await serviceCompletionService.getById(req.params.id);
    res.json(ApiResponse.ok('Service completion retrieved', sc));
  }),

  update: asyncHandler(async (req, res) => {
    const sc = await serviceCompletionService.update(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Service completion updated', sc));
  }),

  complete: asyncHandler(async (req, res) => {
    const sc = await serviceCompletionService.complete(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Service marked completed', sc));
  }),

  cancel: asyncHandler(async (req, res) => {
    const sc = await serviceCompletionService.cancel(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Service completion cancelled', sc));
  }),
};
