import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import * as svc from './productionPlanEntry.service.js';

export const productionPlanController = {
  list: asyncHandler(async (req, res) => {
    const data = await svc.listPlans(req.query);
    res.json(ApiResponse.ok('Production plans', data, { count: data.length }));
  }),

  partySummary: asyncHandler(async (req, res) => {
    const data = await svc.partySummary(req.query);
    res.json(ApiResponse.ok('Party-wise plan summary', data, { count: data.length }));
  }),

  create: asyncHandler(async (req, res) => {
    const data = await svc.createPlan(req.body, req.user?._id);
    res.status(201).json(ApiResponse.created(`Plan ${data.planNo} created`, data));
  }),

  update: asyncHandler(async (req, res) => {
    const data = await svc.updatePlan(req.params.id, req.body, req.user?._id);
    res.json(ApiResponse.ok('Plan updated', data));
  }),

  remove: asyncHandler(async (req, res) => {
    const data = await svc.deletePlan(req.params.id, req.user?._id);
    res.json(ApiResponse.ok('Plan cancelled', data));
  }),
};
