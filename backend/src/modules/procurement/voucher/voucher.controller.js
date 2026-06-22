import asyncHandler from '../../../middleware/asyncHandler.js';
import { voucherService } from './voucher.service.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

export const voucherController = {
  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await voucherService.getAll(req.query);
    res.json(ApiResponse.ok('Vouchers retrieved', docs, pagination));
  }),

  getStats: asyncHandler(async (_req, res) => {
    const stats = await voucherService.getStats();
    res.json(ApiResponse.ok('Voucher stats', stats));
  }),

  getByInvoice: asyncHandler(async (req, res) => {
    const rows = await voucherService.getByInvoice(req.params.invoiceId);
    res.json(ApiResponse.ok('Vouchers for invoice', rows));
  }),

  getById: asyncHandler(async (req, res) => {
    const v = await voucherService.getById(req.params.id);
    res.json(ApiResponse.ok('Voucher retrieved', v));
  }),

  create: asyncHandler(async (req, res) => {
    const v = await voucherService.create(req.body, req.user);
    res.status(201).json(ApiResponse.created('Voucher created', v));
  }),

  update: asyncHandler(async (req, res) => {
    const v = await voucherService.update(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Voucher updated', v));
  }),

  post: asyncHandler(async (req, res) => {
    const v = await voucherService.post(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Voucher posted', v));
  }),

  cancel: asyncHandler(async (req, res) => {
    const v = await voucherService.cancel(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Voucher cancelled', v));
  }),

  generatePdf: asyncHandler(async (req, res) => {
    const out = await voucherService.generatePdf(req.params.id);
    res.json(ApiResponse.ok('Voucher PDF generated', out));
  }),
};
