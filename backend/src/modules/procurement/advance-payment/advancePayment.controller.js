import asyncHandler from '../../../middleware/asyncHandler.js';
import { advancePaymentService } from './advancePayment.service.js';
import { attachStepTiming } from '../stepTiming.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

export const advancePaymentController = {
  getAll: asyncHandler(async (req, res) => {
    const { docs: rows, pagination } = await advancePaymentService.getAll(req.query);
    const docs = await attachStepTiming('ADVANCE_PAYMENT', rows);
    res.json(ApiResponse.ok('Payments retrieved', docs, pagination));
  }),

  getStats: asyncHandler(async (_req, res) => {
    const stats = await advancePaymentService.getStats();
    res.json(ApiResponse.ok('Payment stats', stats));
  }),

  getByPi: asyncHandler(async (req, res) => {
    const payments = await advancePaymentService.getByPi(req.params.piId);
    res.json(ApiResponse.ok('Payments for PI', payments));
  }),

  getById: asyncHandler(async (req, res) => {
    const payment = await advancePaymentService.getById(req.params.id);
    res.json(ApiResponse.ok('Payment retrieved', payment));
  }),

  create: asyncHandler(async (req, res) => {
    const payment = await advancePaymentService.create(req.body, req.user);
    res.status(201).json(ApiResponse.created('Advance payment recorded', payment));
  }),

  remove: asyncHandler(async (req, res) => {
    const payment = await advancePaymentService.remove(req.params.id, req.user);
    res.json(ApiResponse.ok('Advance payment deleted', payment));
  }),
};
