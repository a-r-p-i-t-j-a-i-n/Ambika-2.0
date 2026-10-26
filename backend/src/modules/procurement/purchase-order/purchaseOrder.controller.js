import asyncHandler from '../../../middleware/asyncHandler.js';
import { purchaseOrderService } from './purchaseOrder.service.js';
import { userHasPermission } from '../../../middleware/permission.middleware.js';
import { attachStepTiming } from '../stepTiming.js';
import { ApiResponse, AppError } from '../../../utils/apiResponse.js';
import { logger } from '../../../utils/logger.js';

// "Save PO Directly" is only allowed when PO approval is not required — i.e. the
// creator already holds PO approval authority (procurement.approve; root/MD
// included). Everyone else must save a draft and go through the approval step.
const assertDirectSaveAllowed = (req) => {
  if (req.body.saveMode === 'DIRECT' && !userHasPermission(req, 'procurement.approve')) {
    throw new AppError('PO approval is required — save as draft and send it for approval', 403);
  }
};

// Direct save = the normal draft create followed by the existing approve() path,
// so the final poNumber, indent sync and activity log match a manual approval.
// If the approval step fails the draft still stands (approve it from PO detail).
const approveIfDirect = async (req, po) => {
  if (req.body.saveMode !== 'DIRECT') return po;
  try {
    return await purchaseOrderService.approve(po._id, {
      decision: 'APPROVED',
      remarks: 'Saved directly — approval not required (creator holds PO approval rights)',
    }, req.user);
  } catch (err) {
    logger.error(`[po] direct save approval failed for ${po.draftNumber}: ${err.message}`);
    return po;
  }
};

const createdMessage = (po) => (po.approvalStatus === 'APPROVED'
  ? `Purchase order ${po.poNumber} created and approved`
  : 'Purchase order created');

export const purchaseOrderController = {
  getAll: asyncHandler(async (req, res) => {
    const { docs: rows, pagination } = await purchaseOrderService.getAll(req.query);
    const docs = await attachStepTiming('PO', rows);
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
    assertDirectSaveAllowed(req);
    const draft = await purchaseOrderService.createFromItems(req.body, req.user);
    const po = await approveIfDirect(req, draft);
    res.status(201).json(ApiResponse.created(createdMessage(po), po));
  }),

  create: asyncHandler(async (req, res) => {
    assertDirectSaveAllowed(req);
    const draft = await purchaseOrderService.create(req.body, req.user);
    const po = await approveIfDirect(req, draft);
    res.status(201).json(ApiResponse.created(createdMessage(po), po));
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
