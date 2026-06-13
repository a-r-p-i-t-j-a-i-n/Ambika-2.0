/**
 * Vendor Purchase Order routes (Purchase FMS — Step 1.4).
 * Base path: /api/v1/procurement/purchase-orders
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import validate from '../../../middleware/validate.js';
import { purchaseOrderController as c } from './purchaseOrder.controller.js';
import {
  createPoSchema,
  updatePoSchema,
  approvePoSchema,
  releasePoSchema,
  cancelPoSchema,
  poQuerySchema,
  mongoIdParamSchema,
} from './purchaseOrder.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(poQuerySchema, 'query'), c.getAll)
  .post(validate(createPoSchema), c.create);

router.get('/stats', c.getStats);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .patch(validate(mongoIdParamSchema, 'params'), validate(updatePoSchema), c.update);

router.post('/:id/approve', validate(mongoIdParamSchema, 'params'), validate(approvePoSchema), c.approve);
router.post('/:id/release', validate(mongoIdParamSchema, 'params'), validate(releasePoSchema), c.release);
router.post('/:id/cancel',  validate(mongoIdParamSchema, 'params'), validate(cancelPoSchema), c.cancel);

export default router;
