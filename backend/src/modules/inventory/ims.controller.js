import asyncHandler from '../../middleware/asyncHandler.js';
import { imsService } from './ims.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const imsController = {
  getOverview: asyncHandler(async (req, res) => {
    const { docs, summary } = await imsService.getOverview(req.query);
    res.json(ApiResponse.ok('IMS overview', docs, summary));
  }),

  getDashboard: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('IMS dashboard', await imsService.getDashboard()));
  }),

  getForecast: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Stock forecast', await imsService.getForecast(req.params.skuId, req.query.days)));
  }),

  getStockHistory: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Stock history', await imsService.getStockHistory(req.params.skuId, req.query)));
  }),

  getReorderList: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Reorder list', await imsService.getReorderList(req.query)));
  }),

  getPolicy: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Item policy', await imsService.getPolicy(req.params.skuId)));
  }),

  upsertPolicy: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Item policy saved', await imsService.upsertPolicy(req.params.skuId, req.body, req.user)));
  }),

  // A replay of a submission already recorded writes nothing and is answered
  // with 200 + what the first request did, so a double-click reads as success
  // rather than silently adding the stock a second time.
  receive: asyncHandler(async (req, res) => {
    const out = await imsService.receive(req.body, req.user);
    if (out.duplicate) return res.json(ApiResponse.ok('Already recorded — this entry was submitted twice.', out));
    return res.status(201).json(ApiResponse.created('Stock added', out));
  }),

  issue: asyncHandler(async (req, res) => {
    const out = await imsService.issue(req.body, req.user);
    if (out.duplicate) return res.json(ApiResponse.ok('Already recorded — this entry was submitted twice.', out));
    return res.status(201).json(ApiResponse.created('Stock issued', out));
  }),

  getMovements: asyncHandler(async (req, res) => {
    const { docs, pagination } = await imsService.getMovements(req.query);
    res.json(ApiResponse.ok('IMS movements', docs, pagination));
  }),
};
