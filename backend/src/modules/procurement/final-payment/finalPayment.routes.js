/**
 * Vendor Final Payment routes (Purchase FMS — Step 1.13, Make Payment).
 * Base path: /api/v1/procurement/final-payments
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import validate from '../../../middleware/validate.js';
import { finalPaymentController as c } from './finalPayment.controller.js';
import {
  createFinalPaymentSchema,
  updateFinalPaymentSchema,
  cancelFinalPaymentSchema,
  finalPaymentQuerySchema,
  mongoIdParamSchema,
  voucherIdParamSchema,
} from './finalPayment.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(finalPaymentQuerySchema, 'query'), c.getAll)
  .post(validate(createFinalPaymentSchema), c.create);

router.get('/stats', c.getStats);
router.get('/by-voucher/:voucherId', validate(voucherIdParamSchema, 'params'), c.getByVoucher);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .patch(validate(mongoIdParamSchema, 'params'), validate(updateFinalPaymentSchema), c.update);

router.post('/:id/cancel', validate(mongoIdParamSchema, 'params'), validate(cancelFinalPaymentSchema), c.cancel);

export default router;
