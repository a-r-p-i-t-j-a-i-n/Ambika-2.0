/**
 * Vendor Invoice routes (Purchase FMS — Step 1.10).
 * Base path: /api/v1/procurement/vendor-invoices
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import { attachUserPermissions, requirePermission } from '../../../middleware/permission.middleware.js';
import validate from '../../../middleware/validate.js';
import { vendorInvoiceController as c } from './vendorInvoice.controller.js';
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  approveInvoiceSchema,
  rejectInvoiceSchema,
  invoiceQuerySchema,
  mongoIdParamSchema,
  qcIdParamSchema,
  advancePositionQuerySchema,
} from './vendorInvoice.validation.js';

const router = Router();
router.use(protect);
router.use(attachUserPermissions); // so the excess-override check can read permissions

router.route('/')
  .get(validate(invoiceQuerySchema, 'query'), c.getAll)
  .post(validate(createInvoiceSchema), c.create);

router.get('/stats', c.getStats);
router.get('/invoiceable-qcs', c.getInvoiceableQcs);
router.get('/invoiceable-grns', c.getInvoiceableGrns); // Step 1.10 — GRN-first invoice creation
router.get('/advance-position', validate(advancePositionQuerySchema, 'query'), c.getAdvancePosition); // PI advance paid / allocated / available
router.get('/by-qc/:qcId', validate(qcIdParamSchema, 'params'), c.getByQc);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .patch(validate(mongoIdParamSchema, 'params'), validate(updateInvoiceSchema), c.update)
  .delete(requirePermission('procurement.deleteVendorInvoice'), validate(mongoIdParamSchema, 'params'), c.remove);

router.post('/:id/approve', validate(mongoIdParamSchema, 'params'), validate(approveInvoiceSchema), c.approve);
router.post('/:id/reject',  validate(mongoIdParamSchema, 'params'), validate(rejectInvoiceSchema), c.reject);

export default router;
