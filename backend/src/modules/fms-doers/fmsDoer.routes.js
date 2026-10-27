/**
 * FMS step-wise Doer Assignment.
 * Base path: /api/v1/fms-doers
 *
 * Config + oversight endpoints require `fms.manageDoers`; a user's own task
 * list and the per-item responsibility view are open to any logged-in user.
 */
import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import { attachUserPermissions, requirePermission } from '../../middleware/permission.middleware.js';
import validate from '../../middleware/validate.js';
import { fmsDoerController as c } from './fmsDoer.controller.js';
import {
  fmsParamSchema, stepParamSchema, mongoIdParamSchema,
  setAssignmentSchema, reassignTaskSchema, applyConfigSchema, savePlanSchema,
  taskQuerySchema, entityQuerySchema,
} from './fmsDoer.validation.js';

const router = Router();
router.use(protect, attachUserPermissions);
const manage = requirePermission('fms.manageDoers');

// ── Config ──
router.get('/catalogs', manage, c.catalogs);
router.get('/assignments/:fmsKey', manage, validate(fmsParamSchema, 'params'), c.assignments);
router.get('/assignments/:fmsKey/:stepKey/users', manage, validate(stepParamSchema, 'params'), c.assignableUsers);
router.get('/assignments/:fmsKey/:stepKey/history', manage, validate(stepParamSchema, 'params'), c.history);
router.put('/assignments/:fmsKey/:stepKey', manage, validate(stepParamSchema, 'params'), validate(setAssignmentSchema), c.setAssignment);
router.post('/assignments/:fmsKey/:stepKey/apply-to-open-tasks', manage, validate(stepParamSchema, 'params'), validate(applyConfigSchema), c.applyToOpenTasks);

// ── Doer plan (O2D-style grid: lead time · main doers · buddies per step) ──
router.get('/plan/:fmsKey', manage, validate(fmsParamSchema, 'params'), c.plan);
router.get('/plan/:fmsKey/users', manage, validate(fmsParamSchema, 'params'), c.planUsers);
router.put('/plan/:fmsKey', manage, validate(fmsParamSchema, 'params'), validate(savePlanSchema), c.savePlan);
router.post('/plan/:fmsKey/apply-open', manage, validate(fmsParamSchema, 'params'), validate(applyConfigSchema), c.applyPlan);

// ── Tasks ──
router.get('/tasks/mine', c.myTasks);
router.get('/tasks/by-entity', validate(entityQuerySchema, 'query'), c.byEntity);
router.get('/tasks', manage, validate(taskQuerySchema, 'query'), c.listTasks);
router.patch('/tasks/:id/reassign', manage, validate(mongoIdParamSchema, 'params'), validate(reassignTaskSchema), c.reassignTask);
router.post('/sync', manage, c.sync);

export default router;
