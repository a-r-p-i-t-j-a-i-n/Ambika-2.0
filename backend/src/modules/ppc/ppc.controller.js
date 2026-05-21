import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import * as svc from './ppc.service.js';

export const ppcController = {
  board: asyncHandler(async (req, res) => {
    const data = await svc.getBoard(req.query);
    res.json(ApiResponse.ok('Production board', data));
  }),

  generate: asyncHandler(async (req, res) => {
    const data = await svc.generatePlans(req.body, req.user?._id);
    res.json(ApiResponse.ok(
      data.created > 0
        ? `${data.created} production plan(s) generated`
        : 'No new plans needed — every SKU with demand is already planned',
      data,
    ));
  }),

  updatePlan: asyncHandler(async (req, res) => {
    const data = await svc.updatePlan(req.params.id, req.body, req.user?._id);
    res.json(ApiResponse.ok('Production plan updated', data));
  }),

  dailyEntry: asyncHandler(async (req, res) => {
    const data = await svc.recordDailyProduction(req.body, req.user?._id);
    res.json(ApiResponse.ok('Daily production saved', data));
  }),

  wipMove: asyncHandler(async (req, res) => {
    const data = await svc.moveWip(req.body, req.user?._id);
    res.json(ApiResponse.ok('Stage updated', data));
  }),
};
