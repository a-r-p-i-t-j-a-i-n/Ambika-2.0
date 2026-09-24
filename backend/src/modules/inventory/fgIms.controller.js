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

  // A replay of a submission already recorded writes nothing and is answered
  // with 200 + what the first request did, so a double-click reads as success
  // rather than silently moving the stock a second time.
  produce: asyncHandler(async (req, res) => {
    const out = await fgImsService.produce(req.body, req.user);
    if (out.duplicate) return res.json(ApiResponse.ok('Already recorded — this entry was submitted twice.', out));
    return res.status(201).json(ApiResponse.created('Production recorded — stock updated', out));
  }),

  dispatch: asyncHandler(async (req, res) => {
    const out = await fgImsService.dispatch(req.body, req.user);
    if (out.duplicate) return res.json(ApiResponse.ok('Already recorded — this entry was submitted twice.', out));
    return res.status(201).json(ApiResponse.created('Dispatch recorded — stock updated', out));
  }),

  getMovements: asyncHandler(async (req, res) => {
    const { docs, pagination } = await fgImsService.getMovements(req.query);
    res.json(ApiResponse.ok('FG IMS movements', docs, pagination));
  }),
};
