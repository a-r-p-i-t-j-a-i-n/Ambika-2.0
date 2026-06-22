/**
 * Service Completion routes (Purchase FMS — Step 1.8A).
 * Base path: /api/v1/procurement/service-completions
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import validate from '../../../middleware/validate.js';
import { serviceCompletionController as c } from './serviceCompletion.controller.js';
import {
  createServiceCompletionSchema,
  updateServiceCompletionSchema,
  completeServiceCompletionSchema,
  cancelServiceCompletionSchema,
  serviceCompletionQuerySchema,
  mongoIdParamSchema,
} from './serviceCompletion.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(serviceCompletionQuerySchema, 'query'), c.getAll)
  .post(validate(createServiceCompletionSchema), c.create);

router.get('/stats', c.getStats);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .patch(validate(mongoIdParamSchema, 'params'), validate(updateServiceCompletionSchema), c.update);

router.post('/:id/complete', validate(mongoIdParamSchema, 'params'), validate(completeServiceCompletionSchema), c.complete);
router.post('/:id/cancel',   validate(mongoIdParamSchema, 'params'), validate(cancelServiceCompletionSchema),   c.cancel);

export default router;
