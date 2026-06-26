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

  receive: asyncHandler(async (req, res) => {
    res.status(201).json(ApiResponse.created('Stock added', await imsService.receive(req.body, req.user)));
  }),

  issue: asyncHandler(async (req, res) => {
    res.status(201).json(ApiResponse.created('Stock issued', await imsService.issue(req.body, req.user)));
  }),

  getMovements: asyncHandler(async (req, res) => {
    const { docs, pagination } = await imsService.getMovements(req.query);
    res.json(ApiResponse.ok('IMS movements', docs, pagination));
  }),
};
