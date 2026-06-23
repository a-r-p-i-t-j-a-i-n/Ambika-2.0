/**
 * Vendor Purchase Order routes (Purchase FMS — Step 1.4).
 * Base path: /api/v1/procurement/purchase-orders
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import { requirePermission } from '../../../middleware/permission.middleware.js';
import validate from '../../../middleware/validate.js';
import { purchaseOrderController as c } from './purchaseOrder.controller.js';
import {
  createPoSchema,
  createMultiPoSchema,
  previewPoSchema,
  updatePoSchema,
  approvePoSchema,
  releasePoSchema,
  cancelPoSchema,
  piNotRequiredSchema,
  poQuerySchema,
  mongoIdParamSchema,
} from './purchaseOrder.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(poQuerySchema, 'query'), c.getAll)
  .post(validate(createPoSchema), c.create);

// Multi-indent PO (one vendor, items grouped from several approved indents).
router.post('/multi', validate(createMultiPoSchema), c.createMulti);

// Preview a PO PDF from draft form data — no DB save.
router.post('/preview-pdf', validate(previewPoSchema), c.previewPdf);

router.get('/stats', c.getStats);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .patch(validate(mongoIdParamSchema, 'params'), validate(updatePoSchema), c.update);

router.post('/:id/approve', validate(mongoIdParamSchema, 'params'), validate(approvePoSchema), c.approve);
router.post('/:id/release', validate(mongoIdParamSchema, 'params'), validate(releasePoSchema), c.release);
router.post('/:id/cancel',  validate(mongoIdParamSchema, 'params'), validate(cancelPoSchema), c.cancel);

// PI is optional but never silently skipped — gated on procurement approval rights.
router.post('/:id/pi-not-required',
  requirePermission('procurement.markPiNotRequired', 'procurement.approve'),
  validate(mongoIdParamSchema, 'params'),
  validate(piNotRequiredSchema),
  c.piNotRequired);

export default router;
