/**
 * Purchase FMS cascade delete — delete a step with everything resting on it.
 * Base path: /api/v1/procurement/cascade-delete
 *
 *   GET  /history?recordId=        audit of past cascade deletions
 *   GET  /:type/:id/preview        what goes, what blocks it, what stays
 *   POST /:type/:id                { reason, acknowledged: true, planToken } — carry it out
 *
 * Each step's delete permission is checked by the service for the selected
 * record and for every downstream record (MD has all).
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import { attachUserPermissions } from '../../../middleware/permission.middleware.js';
import validate from '../../../middleware/validate.js';
import { cascadeDeleteController as c } from './cascadeDelete.controller.js';
import { cascadeParamsSchema, cascadeExecuteSchema, cascadeHistoryQuerySchema } from './cascadeDelete.validation.js';

const router = Router();
router.use(protect, attachUserPermissions);

router.get('/history', validate(cascadeHistoryQuerySchema, 'query'), c.history);
router.get('/:type/:id/preview', validate(cascadeParamsSchema, 'params'), c.preview);
router.post('/:type/:id', validate(cascadeParamsSchema, 'params'), validate(cascadeExecuteSchema), c.execute);

export default router;
