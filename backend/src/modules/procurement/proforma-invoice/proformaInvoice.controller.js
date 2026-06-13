import asyncHandler from '../../../middleware/asyncHandler.js';
import { proformaInvoiceService } from './proformaInvoice.service.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

export const proformaInvoiceController = {
  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await proformaInvoiceService.getAll(req.query);
    res.json(ApiResponse.ok('Proforma invoices retrieved', docs, pagination));
  }),

  getStats: asyncHandler(async (_req, res) => {
    const stats = await proformaInvoiceService.getStats();
    res.json(ApiResponse.ok('Proforma invoice stats', stats));
  }),

  getByPo: asyncHandler(async (req, res) => {
    const pis = await proformaInvoiceService.getByPo(req.params.poId);
    res.json(ApiResponse.ok('Proforma invoices for PO', pis));
  }),

  getById: asyncHandler(async (req, res) => {
    const pi = await proformaInvoiceService.getById(req.params.id);
    res.json(ApiResponse.ok('Proforma invoice retrieved', pi));
  }),

  create: asyncHandler(async (req, res) => {
    const pi = await proformaInvoiceService.create(req.body, req.user);
    res.status(201).json(ApiResponse.created('Proforma invoice created', pi));
  }),

  update: asyncHandler(async (req, res) => {
    const pi = await proformaInvoiceService.update(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Proforma invoice updated', pi));
  }),

  approve: asyncHandler(async (req, res) => {
    const pi = await proformaInvoiceService.approve(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Proforma invoice approved — ready for advance payment', pi));
  }),

  reject: asyncHandler(async (req, res) => {
    const pi = await proformaInvoiceService.reject(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Proforma invoice rejected', pi));
  }),

  cancel: asyncHandler(async (req, res) => {
    const pi = await proformaInvoiceService.cancel(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Proforma invoice cancelled', pi));
  }),
};
