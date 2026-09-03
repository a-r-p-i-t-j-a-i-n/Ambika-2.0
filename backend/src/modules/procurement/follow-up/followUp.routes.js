/**
 * Material Follow-up routes (Purchase FMS — Step 1.5).
 * Base path: /api/v1/procurement/follow-ups
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import { requirePermission } from '../../../middleware/permission.middleware.js';
import validate from '../../../middleware/validate.js';
import { followUpController as c } from './followUp.controller.js';
import {
  createFollowUpSchema,
  updateFollowUpSchema,
  markDoneSchema,
  rescheduleSchema,
  readyForGrnSchema,
  followUpQuerySchema,
  mongoIdParamSchema,
  poIdParamSchema,
} from './followUp.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(followUpQuerySchema, 'query'), c.getAll)
  .post(validate(createFollowUpSchema), c.create);

// Static paths BEFORE /:id so they don't get swallowed by the param route.
router.get('/stats', c.getStats);
router.get('/by-po/:poId', validate(poIdParamSchema, 'params'), c.getByPo);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .patch(validate(mongoIdParamSchema, 'params'), validate(updateFollowUpSchema), c.update)
  .delete(requirePermission('procurement.deleteFollowUp'), validate(mongoIdParamSchema, 'params'), c.remove);

router.post('/:id/mark-done',          validate(mongoIdParamSchema, 'params'), validate(markDoneSchema), c.markDone);
router.post('/:id/reschedule',         validate(mongoIdParamSchema, 'params'), validate(rescheduleSchema), c.reschedule);
router.post('/:id/mark-ready-for-grn', validate(mongoIdParamSchema, 'params'), validate(readyForGrnSchema), c.markReadyForGrn);

export default router;
