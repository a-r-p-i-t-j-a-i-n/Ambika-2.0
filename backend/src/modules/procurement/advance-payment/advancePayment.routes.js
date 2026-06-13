/**
 * Advance Payment routes (Purchase FMS — Step 1.7).
 * Base path: /api/v1/procurement/advance-payments
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import validate from '../../../middleware/validate.js';
import { advancePaymentController as c } from './advancePayment.controller.js';
import {
  createPaymentSchema,
  paymentQuerySchema,
  mongoIdParamSchema,
  piIdParamSchema,
} from './advancePayment.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(paymentQuerySchema, 'query'), c.getAll)
  .post(validate(createPaymentSchema), c.create);

// Static paths BEFORE /:id.
router.get('/stats', c.getStats);
router.get('/by-pi/:piId', validate(piIdParamSchema, 'params'), c.getByPi);

router.get('/:id', validate(mongoIdParamSchema, 'params'), c.getById);

export default router;
