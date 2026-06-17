import asyncHandler from '../../../middleware/asyncHandler.js';
import { finalPaymentService } from './finalPayment.service.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

export const finalPaymentController = {
  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await finalPaymentService.getAll(req.query);
    res.json(ApiResponse.ok('Final payments retrieved', docs, pagination));
  }),

  getStats: asyncHandler(async (_req, res) => {
    const stats = await finalPaymentService.getStats();
    res.json(ApiResponse.ok('Final payment stats', stats));
  }),

  getByVoucher: asyncHandler(async (req, res) => {
    const rows = await finalPaymentService.getByVoucher(req.params.voucherId);
    res.json(ApiResponse.ok('Final payments for voucher', rows));
  }),

  getById: asyncHandler(async (req, res) => {
    const p = await finalPaymentService.getById(req.params.id);
    res.json(ApiResponse.ok('Final payment retrieved', p));
  }),

  create: asyncHandler(async (req, res) => {
    const p = await finalPaymentService.create(req.body, req.user);
    res.status(201).json(ApiResponse.created('Final payment recorded', p));
  }),

  update: asyncHandler(async (req, res) => {
    const p = await finalPaymentService.update(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Final payment updated', p));
  }),

  cancel: asyncHandler(async (req, res) => {
    const p = await finalPaymentService.cancel(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Final payment cancelled', p));
  }),

  generatePdf: asyncHandler(async (req, res) => {
    const out = await finalPaymentService.generatePdf(req.params.id);
    res.json(ApiResponse.ok('Payment receipt generated', out));
  }),
};
