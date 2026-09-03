/**
 * Goods Receipt Note routes (Purchase FMS — Step 1.8).
 * Base path: /api/v1/procurement/grns
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import { requirePermission } from '../../../middleware/permission.middleware.js';
import validate from '../../../middleware/validate.js';
import { grnController as c } from './grn.controller.js';
import {
  createGrnSchema,
  previewGrnPdfSchema,
  updateGrnSchema,
  completeGrnSchema,
  cancelGrnSchema,
  grnQuerySchema,
  mongoIdParamSchema,
  poIdParamSchema,
} from './grn.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(grnQuerySchema, 'query'), c.getAll)
  .post(validate(createGrnSchema), c.create);

router.post('/preview-pdf', validate(previewGrnPdfSchema), c.previewPdf);

router.get('/stats', c.getStats);
router.get('/by-po/:poId', validate(poIdParamSchema, 'params'), c.getByPo);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .patch(validate(mongoIdParamSchema, 'params'), validate(updateGrnSchema), c.update)
  .delete(requirePermission('procurement.deleteGrn'), validate(mongoIdParamSchema, 'params'), c.remove);

router.post('/:id/complete', validate(mongoIdParamSchema, 'params'), validate(completeGrnSchema), c.complete);
router.post('/:id/cancel',   validate(mongoIdParamSchema, 'params'), validate(cancelGrnSchema), c.cancel);

export default router;
