import asyncHandler from '../../middleware/asyncHandler.js';
import { rmImsService } from './rmIms.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const rmImsController = {
  getOverview: asyncHandler(async (req, res) => {
    const { docs, summary } = await rmImsService.getOverview(req.query);
    res.json(ApiResponse.ok('RM IMS overview', docs, summary));
  }),

  getDashboard: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('RM IMS dashboard', await rmImsService.getDashboard()));
  }),

  getForecast: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Stock forecast', await rmImsService.getForecast(req.params.skuId, req.query.days)));
  }),

  getReorderList: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Reorder list', await rmImsService.getReorderList(req.query)));
  }),

  getPolicy: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Item policy', await rmImsService.getPolicy(req.params.skuId)));
  }),

  upsertPolicy: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Item policy saved', await rmImsService.upsertPolicy(req.params.skuId, req.body, req.user)));
  }),

  receive: asyncHandler(async (req, res) => {
    res.status(201).json(ApiResponse.created('Stock added', await rmImsService.receive(req.body, req.user)));
  }),

  issue: asyncHandler(async (req, res) => {
    res.status(201).json(ApiResponse.created('Stock issued', await rmImsService.issue(req.body, req.user)));
  }),

  convert: asyncHandler(async (req, res) => {
    res.status(201).json(ApiResponse.created('Coil converted to circles', await rmImsService.convert(req.body, req.user)));
  }),

  getConversions: asyncHandler(async (req, res) => {
    const { docs, totals } = await rmImsService.listConversions(req.query);
    res.json(ApiResponse.ok('Coil conversions', docs, totals));
  }),

  getMovements: asyncHandler(async (req, res) => {
    const { docs, pagination } = await rmImsService.getMovements(req.query);
    res.json(ApiResponse.ok('RM IMS movements', docs, pagination));
  }),
};
