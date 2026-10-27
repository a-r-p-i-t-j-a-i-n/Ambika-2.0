/**
 * Vendor Purchase Order routes (Purchase FMS — Step 1.4).
 * Base path: /api/v1/procurement/purchase-orders
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import { requirePermission, attachUserPermissions } from '../../../middleware/permission.middleware.js';
import validate from '../../../middleware/validate.js';
import { purchaseOrderController as c } from './purchaseOrder.controller.js';
import {
  createPoSchema,
  createFromItemsSchema,
  setItemVendorSchema,
  revisePoSchema,
  previewPoSchema,
  updatePoSchema,
  approvePoSchema,
  releasePoSchema,
  bulkReleasePoSchema,
  releasePreviewSchema,
  cancelPoSchema,
  piNotRequiredSchema,
  poQuerySchema,
  mongoIdParamSchema,
} from './purchaseOrder.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(poQuerySchema, 'query'), c.getAll)
  // attachUserPermissions — the controller checks procurement.approve for "Save PO Directly".
  .post(attachUserPermissions, validate(createPoSchema), c.create);

// Item-wise PO from the New PO form's "Approved Item(s)" picker (one vendor,
// hand-picked approved items; source indents derived server-side).
router.post('/create-from-items', attachUserPermissions, validate(createFromItemsSchema), c.createFromItems);

// Preview a PO PDF from draft form data — no DB save.
router.post('/preview-pdf', validate(previewPoSchema), c.previewPdf);

router.get('/stats', c.getStats);

// Global approved-item picker (all PO-creatable indents) for the New PO form's
// Approved Item(s) dropdown. Declared before '/:id' so it isn't shadowed.
router.get('/approved-items', c.getAllApprovedItems);
// Pending for PO — fix the vendor for one approved item (quotation not required),
// or confirm the approved vendor of an older approved quotation.
router.patch('/approved-items/vendor', validate(setItemVendorSchema), c.setItemVendor);

// Bulk release multiple approved, not-yet-released POs — declared before
// '/:id' routes so it isn't shadowed.
router.post('/bulk-release', validate(bulkReleasePoSchema), c.bulkRelease);

// Read-only preview of the recipients/subject/attachment a bulk release would
// send — no DB writes, no emails sent. Declared before '/:id' for the same reason.
router.post('/release-preview', validate(releasePreviewSchema), c.getReleasePreview);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .patch(validate(mongoIdParamSchema, 'params'), validate(updatePoSchema), c.update)
  .delete(requirePermission('procurement.deletePurchaseOrder'), validate(mongoIdParamSchema, 'params'), c.remove);

router.post('/:id/pdf', validate(mongoIdParamSchema, 'params'), c.generatePdf);
router.post('/:id/approve', validate(mongoIdParamSchema, 'params'), validate(approvePoSchema), c.approve);
router.post('/:id/release', validate(mongoIdParamSchema, 'params'), validate(releasePoSchema), c.release);
router.post('/:id/cancel',  validate(mongoIdParamSchema, 'params'), validate(cancelPoSchema), c.cancel);
router.post('/:id/revise',  validate(mongoIdParamSchema, 'params'), validate(revisePoSchema), c.revise);

// PI is optional but never silently skipped — gated on procurement approval rights.
router.post('/:id/pi-not-required',
  requirePermission('procurement.markPiNotRequired', 'procurement.approve'),
  validate(mongoIdParamSchema, 'params'),
  validate(piNotRequiredSchema),
  c.piNotRequired);

export default router;
