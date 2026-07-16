import asyncHandler from '../../middleware/asyncHandler.js';
import { fgImsService } from './fgIms.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const fgImsController = {
  getOverview: asyncHandler(async (req, res) => {
    const { docs, summary } = await fgImsService.getOverview(req.query);
    res.json(ApiResponse.ok('FG IMS overview', docs, summary));
  }),

  getDashboard: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('FG IMS dashboard', await fgImsService.getDashboard()));
  }),

  getForecast: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Stock forecast', await fgImsService.getForecast(req.params.skuId, req.query.days)));
  }),

  getStockHistory: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Stock history', await fgImsService.getStockHistory(req.params.skuId, req.query)));
  }),

  getReplenishList: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Production plan', await fgImsService.getReplenishList(req.query)));
  }),

  getPolicy: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Item policy', await fgImsService.getPolicy(req.params.skuId)));
  }),

  upsertPolicy: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Item policy saved', await fgImsService.upsertPolicy(req.params.skuId, req.body, req.user)));
  }),

  produce: asyncHandler(async (req, res) => {
    res.status(201).json(ApiResponse.created('Production recorded — stock updated', await fgImsService.produce(req.body, req.user)));
  }),

  dispatch: asyncHandler(async (req, res) => {
    res.status(201).json(ApiResponse.created('Dispatch recorded — stock updated', await fgImsService.dispatch(req.body, req.user)));
  }),

  getMovements: asyncHandler(async (req, res) => {
    const { docs, pagination } = await fgImsService.getMovements(req.query);
    res.json(ApiResponse.ok('FG IMS movements', docs, pagination));
  }),
};
