/**
 * Advance Payment routes (Purchase FMS — Step 1.7).
 * Base path: /api/v1/procurement/advance-payments
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import { requirePermission } from '../../../middleware/permission.middleware.js';
import validate from '../../../middleware/validate.js';
import { advancePaymentController as c } from './advancePayment.controller.js';
import {
  createPaymentSchema,
  paymentQuerySchema,
  mongoIdParamSchema,
  piIdParamSchema,
  eligiblePosQuerySchema,
  pdfQuerySchema,
} from './advancePayment.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(paymentQuerySchema, 'query'), c.getAll)
  .post(validate(createPaymentSchema), c.create);

// Static paths BEFORE /:id.
router.get('/stats', c.getStats);
router.get('/candidates', validate(eligiblePosQuerySchema, 'query'), c.getCandidates);
router.get('/eligible-pos', validate(eligiblePosQuerySchema, 'query'), c.getEligiblePos);
router.get('/by-pi/:piId', validate(piIdParamSchema, 'params'), c.getByPi);

router.get('/:id/detail', validate(mongoIdParamSchema, 'params'), c.getDetail);
router.get('/:id/pdf', validate(mongoIdParamSchema, 'params'), validate(pdfQuerySchema, 'query'), c.getPdf);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .delete(requirePermission('procurement.deleteAdvancePayment'), validate(mongoIdParamSchema, 'params'), c.remove);

export default router;
