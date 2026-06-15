import asyncHandler from '../../../middleware/asyncHandler.js';
import { purchaseOrderService } from './purchaseOrder.service.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

export const purchaseOrderController = {
  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await purchaseOrderService.getAll(req.query);
    res.json(ApiResponse.ok('Purchase orders retrieved', docs, pagination));
  }),

  getStats: asyncHandler(async (_req, res) => {
    const stats = await purchaseOrderService.getStats();
    res.json(ApiResponse.ok('Purchase order stats', stats));
  }),

  getById: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.getById(req.params.id);
    res.json(ApiResponse.ok('Purchase order retrieved', po));
  }),

  create: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.create(req.body, req.user);
    res.status(201).json(ApiResponse.created('Purchase order created', po));
  }),

  update: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.update(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Purchase order updated', po));
  }),

  approve: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.approve(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok(`Purchase order ${req.body.decision === 'REJECTED' ? 'rejected' : 'approved'}`, po));
  }),

  release: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.release(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Purchase order released to vendor', po));
  }),

  piNotRequired: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.markPiNotRequired(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('PI marked as Not Required', po));
  }),

  cancel: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.cancel(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Purchase order cancelled', po));
  }),
};
