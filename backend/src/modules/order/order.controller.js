import asyncHandler from '../../middleware/asyncHandler.js';
import { orderService } from './order.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const orderController = {
  create: asyncHandler(async (req, res) => {
    const order = await orderService.create(req.body);
    res.status(201).json(ApiResponse.created('Sales Order created', order));
  }),

  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await orderService.getAll(req.query);
    res.json(ApiResponse.ok('Sales Orders retrieved', docs, pagination));
  }),

  getById: asyncHandler(async (req, res) => {
    console.log(`[ORDER_CONTROLLER] Fetching order by ID: ${req.params.id}`);
    const order = await orderService.getById(req.params.id);
    res.json(ApiResponse.ok('Sales Order retrieved', order));
  }),

  getByParty: asyncHandler(async (req, res) => {
    const { docs, pagination } = await orderService.getByParty(req.params.partyId, req.query);
    res.json(ApiResponse.ok('Party orders retrieved', docs, pagination));
  }),

  update: asyncHandler(async (req, res) => {
    const order = await orderService.update(req.params.id, req.body);
    res.json(ApiResponse.ok('Sales Order updated', order));
  }),

  updateWorkflowStep: asyncHandler(async (req, res) => {
    const { step } = req.params;
    const order = await orderService.updateWorkflowStep(req.params.id, step, req.body);
    res.json(ApiResponse.ok(`Workflow step '${step}' updated`, order));
  }),

  remove: asyncHandler(async (req, res) => {
    await orderService.remove(req.params.id);
    res.json(ApiResponse.ok('Sales Order deleted'));
  }),

  getStats: asyncHandler(async (req, res) => {
    const stats = await orderService.getStats();
    res.json(ApiResponse.ok('Order statistics', stats));
  }),
};
