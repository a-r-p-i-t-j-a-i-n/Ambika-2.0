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

  // Global approved-item picker for the New PO form (all PO-creatable indents).
  getAllApprovedItems: asyncHandler(async (_req, res) => {
    const data = await purchaseOrderService.getAllApprovedItems();
    res.json(ApiResponse.ok('Approved items retrieved', data));
  }),

  createFromItems: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.createFromItems(req.body, req.user);
    res.status(201).json(ApiResponse.created('Purchase order created', po));
  }),

  create: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.create(req.body, req.user);
    res.status(201).json(ApiResponse.created('Purchase order created', po));
  }),

  // Render a temporary PO PDF from form data — no DB save. Returns a raw PDF buffer.
  previewPdf: asyncHandler(async (req, res) => {
    const buffer = await purchaseOrderService.previewPdf(req.body);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="po-preview.pdf"');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }),

  // Generate/refresh the PDF for a saved PO on demand (same generatePdf() the
  // release flow already uses) — lets a PO be previewed before it's released.
  generatePdf: asyncHandler(async (req, res) => {
    const result = await purchaseOrderService.generatePdf(req.params.id);
    res.json(ApiResponse.ok('Purchase order PDF generated', result));
  }),

  update: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.update(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Purchase order updated', po));
  }),

  remove: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.remove(req.params.id, req.user);
    res.json(ApiResponse.ok('Purchase order deleted', po));
  }),

  approve: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.approve(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok(`Purchase order ${req.body.decision === 'REJECTED' ? 'rejected' : 'approved'}`, po));
  }),

  release: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.release(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Purchase order released to vendor', po));
  }),

  bulkRelease: asyncHandler(async (req, res) => {
    const result = await purchaseOrderService.bulkRelease(req.body, req.user);
    res.json(ApiResponse.ok(`${result.released} of ${result.total} PO(s) released`, result));
  }),

  getReleasePreview: asyncHandler(async (req, res) => {
    const data = await purchaseOrderService.getReleasePreview(req.body);
    res.json(ApiResponse.ok('Release preview', data));
  }),

  piNotRequired: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.markPiNotRequired(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('PI marked as Not Required', po));
  }),

  cancel: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.cancel(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Purchase order cancelled', po));
  }),

  // Revise a cancelled PO → new draft PO (linked back via revisedFromPoId).
  revise: asyncHandler(async (req, res) => {
    const po = await purchaseOrderService.revise(req.params.id, req.body, req.user);
    res.status(201).json(ApiResponse.created('Revised purchase order created', po));
  }),
};
