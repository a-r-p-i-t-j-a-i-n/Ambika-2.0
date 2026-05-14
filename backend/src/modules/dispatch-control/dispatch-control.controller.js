import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { dispatchControlService } from './dispatch-control.service.js';

export const dispatchControlController = {
  createOrderEntry: asyncHandler(async (req, res) => {
    const order = await dispatchControlService.createOrderEntry(req.body);
    res.status(201).json(ApiResponse.created('Order entry saved successfully', order));
  }),

  planDispatch: asyncHandler(async (req, res) => {
    const comparison = await dispatchControlService.planDispatch(req.body);
    res.status(201).json(ApiResponse.created('Dispatch plan saved successfully', comparison));
  }),

  createActualDispatch: asyncHandler(async (req, res) => {
    const result = await dispatchControlService.createActualDispatch(req.body);
    res.status(201).json(ApiResponse.created('Actual dispatch and challan saved successfully', result));
  }),

  getComparison: asyncHandler(async (req, res) => {
    const comparison = await dispatchControlService.getComparison(req.params.soNumber);
    res.json(ApiResponse.ok('Plan vs actual comparison retrieved', comparison));
  }),

  getOrderControlTower: asyncHandler(async (req, res) => {
    const controlTower = await dispatchControlService.getOrderControlTower(req.params.soNumber);
    res.json(ApiResponse.ok('Order control tower retrieved', controlTower));
  }),

  getDashboard: asyncHandler(async (req, res) => {
    const dashboard = await dispatchControlService.getDashboard(req.query);
    res.json(ApiResponse.ok('Dispatch dashboard retrieved', dashboard));
  }),

  normalizeSheetRows: asyncHandler(async (req, res) => {
    const rows = await dispatchControlService.normalizeSheetRows(req.body);
    res.json(ApiResponse.ok('Sheet rows normalized', rows));
  }),
};
