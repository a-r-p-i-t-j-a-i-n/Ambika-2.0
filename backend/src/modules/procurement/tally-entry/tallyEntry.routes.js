/**
 * Purchase Tally Entry routes (Purchase FMS — Step 1.12).
 * Base path: /api/v1/procurement/tally-entries
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import validate from '../../../middleware/validate.js';
import { tallyEntryController as c } from './tallyEntry.controller.js';
import {
  createTallyEntrySchema,
  updateTallyEntrySchema,
  completeTallyEntrySchema,
  cancelTallyEntrySchema,
  tallyEntryQuerySchema,
  mongoIdParamSchema,
  voucherIdParamSchema,
} from './tallyEntry.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(tallyEntryQuerySchema, 'query'), c.getAll)
  .post(validate(createTallyEntrySchema), c.create);

router.get('/stats', c.getStats);
router.get('/by-voucher/:voucherId', validate(voucherIdParamSchema, 'params'), c.getByVoucher);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .patch(validate(mongoIdParamSchema, 'params'), validate(updateTallyEntrySchema), c.update);

router.post('/:id/complete', validate(mongoIdParamSchema, 'params'), validate(completeTallyEntrySchema), c.complete);
router.post('/:id/cancel',   validate(mongoIdParamSchema, 'params'), validate(cancelTallyEntrySchema), c.cancel);

export default router;
