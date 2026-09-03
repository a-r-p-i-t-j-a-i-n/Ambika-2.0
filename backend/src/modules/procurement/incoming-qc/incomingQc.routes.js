/**
 * Incoming QC routes (Purchase FMS — Step 1.9).
 * Base path: /api/v1/procurement/incoming-qc
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import { requirePermission } from '../../../middleware/permission.middleware.js';
import validate from '../../../middleware/validate.js';
import { incomingQcController as c } from './incomingQc.controller.js';
import {
  createQcSchema,
  updateQcSchema,
  completeQcSchema,
  cancelQcSchema,
  qcQuerySchema,
  mongoIdParamSchema,
  grnIdParamSchema,
} from './incomingQc.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(qcQuerySchema, 'query'), c.getAll)
  .post(validate(createQcSchema), c.create);

router.get('/stats', c.getStats);
router.get('/by-grn/:grnId', validate(grnIdParamSchema, 'params'), c.getByGrn);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .patch(validate(mongoIdParamSchema, 'params'), validate(updateQcSchema), c.update)
  .delete(requirePermission('procurement.deleteIncomingQc'), validate(mongoIdParamSchema, 'params'), c.remove);

router.post('/:id/complete', validate(mongoIdParamSchema, 'params'), validate(completeQcSchema), c.complete);
router.post('/:id/cancel',   validate(mongoIdParamSchema, 'params'), validate(cancelQcSchema), c.cancel);

export default router;
