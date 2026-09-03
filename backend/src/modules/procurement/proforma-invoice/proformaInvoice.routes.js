/**
 * Proforma Invoice routes (Purchase FMS — Step 1.6).
 * Base path: /api/v1/procurement/proforma-invoices
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import { requirePermission } from '../../../middleware/permission.middleware.js';
import validate from '../../../middleware/validate.js';
import { proformaInvoiceController as c } from './proformaInvoice.controller.js';
import {
  createPiSchema,
  updatePiSchema,
  approvePiSchema,
  rejectPiSchema,
  cancelPiSchema,
  piQuerySchema,
  mongoIdParamSchema,
  poIdParamSchema,
} from './proformaInvoice.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(piQuerySchema, 'query'), c.getAll)
  .post(validate(createPiSchema), c.create);

// Static paths BEFORE /:id.
router.get('/stats', c.getStats);
router.get('/by-po/:poId', validate(poIdParamSchema, 'params'), c.getByPo);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .patch(validate(mongoIdParamSchema, 'params'), validate(updatePiSchema), c.update)
  .delete(requirePermission('procurement.deleteProformaInvoice'), validate(mongoIdParamSchema, 'params'), c.remove);

router.post('/:id/approve', validate(mongoIdParamSchema, 'params'), validate(approvePiSchema), c.approve);
router.post('/:id/reject',  validate(mongoIdParamSchema, 'params'), validate(rejectPiSchema), c.reject);
router.post('/:id/cancel',  validate(mongoIdParamSchema, 'params'), validate(cancelPiSchema), c.cancel);

export default router;
