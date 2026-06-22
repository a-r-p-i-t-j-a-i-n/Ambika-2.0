/**
 * Vendor Voucher routes (Purchase FMS — Step 1.11).
 * Base path: /api/v1/procurement/vouchers
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import validate from '../../../middleware/validate.js';
import { voucherController as c } from './voucher.controller.js';
import {
  createVoucherSchema,
  updateVoucherSchema,
  postVoucherSchema,
  cancelVoucherSchema,
  voucherQuerySchema,
  mongoIdParamSchema,
  invoiceIdParamSchema,
} from './voucher.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(voucherQuerySchema, 'query'), c.getAll)
  .post(validate(createVoucherSchema), c.create);

router.get('/stats', c.getStats);
router.get('/by-invoice/:invoiceId', validate(invoiceIdParamSchema, 'params'), c.getByInvoice);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .patch(validate(mongoIdParamSchema, 'params'), validate(updateVoucherSchema), c.update);

router.post('/:id/post',   validate(mongoIdParamSchema, 'params'), validate(postVoucherSchema), c.post);
router.post('/:id/cancel', validate(mongoIdParamSchema, 'params'), validate(cancelVoucherSchema), c.cancel);
router.post('/:id/pdf',    validate(mongoIdParamSchema, 'params'), c.generatePdf);

export default router;
