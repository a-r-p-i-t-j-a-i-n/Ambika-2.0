import asyncHandler from '../../../middleware/asyncHandler.js';
import { vendorInvoiceService } from './vendorInvoice.service.js';
import { userHasPermission } from '../../../middleware/permission.middleware.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

// May the user invoice more than the QC-accepted (excess) qty?
const canOverrideExcess = (req) =>
  userHasPermission(req, 'procurement.invoiceExcess') || userHasPermission(req, 'procurement.approve');

export const vendorInvoiceController = {
  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await vendorInvoiceService.getAll(req.query);
    res.json(ApiResponse.ok('Vendor invoices retrieved', docs, pagination));
  }),

  getStats: asyncHandler(async (_req, res) => {
    const stats = await vendorInvoiceService.getStats();
    res.json(ApiResponse.ok('Vendor invoice stats', stats));
  }),

  getByQc: asyncHandler(async (req, res) => {
    const rows = await vendorInvoiceService.getByQc(req.params.qcId);
    res.json(ApiResponse.ok('Invoices for QC', rows));
  }),

  getInvoiceableQcs: asyncHandler(async (req, res) => {
    const rows = await vendorInvoiceService.getInvoiceableQcs(req.query);
    res.json(ApiResponse.ok('Invoiceable QCs', rows));
  }),

  getById: asyncHandler(async (req, res) => {
    const inv = await vendorInvoiceService.getById(req.params.id);
    res.json(ApiResponse.ok('Vendor invoice retrieved', inv));
  }),

  create: asyncHandler(async (req, res) => {
    const inv = await vendorInvoiceService.create(req.body, req.user, { allowExcess: canOverrideExcess(req) });
    res.status(201).json(ApiResponse.created('Vendor invoice created', inv));
  }),

  update: asyncHandler(async (req, res) => {
    const inv = await vendorInvoiceService.update(req.params.id, req.body, req.user, { allowExcess: canOverrideExcess(req) });
    res.json(ApiResponse.ok('Vendor invoice updated', inv));
  }),

  approve: asyncHandler(async (req, res) => {
    const inv = await vendorInvoiceService.approve(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Vendor invoice approved', inv));
  }),

  reject: asyncHandler(async (req, res) => {
    const inv = await vendorInvoiceService.reject(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Vendor invoice rejected', inv));
  }),
};
