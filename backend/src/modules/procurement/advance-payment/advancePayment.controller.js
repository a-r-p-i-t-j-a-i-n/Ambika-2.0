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

  // Record Advance Payment selector: every approved, live PO with where its advance stands.
  getCandidates: asyncHandler(async (req, res) => {
    const rows = await advancePaymentService.getAdvanceCandidates(req.query);
    res.json(ApiResponse.ok('Purchase Orders and their advance status', rows));
  }),

  // Old endpoint: only the POs an advance can be recorded against right now.
  getEligiblePos: asyncHandler(async (req, res) => {
    const rows = await advancePaymentService.getEligiblePos(req.query);
    res.json(ApiResponse.ok('Purchase Orders eligible for an advance payment', rows));
  }),

  getDetail: asyncHandler(async (req, res) => {
    const detail = await advancePaymentService.getDetail(req.params.id);
    res.json(ApiResponse.ok('Payment details retrieved', detail));
  }),

  // Streams the payment's PDF (inline for the preview, attachment with ?download=true).
  getPdf: asyncHandler(async (req, res) => {
    const { buffer, fileName } = await advancePaymentService.buildPdf(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
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
