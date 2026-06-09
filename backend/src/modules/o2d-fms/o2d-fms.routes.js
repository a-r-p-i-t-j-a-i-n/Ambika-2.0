import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import { attachUserPermissions, requirePermission } from '../../middleware/permission.middleware.js';
import validate from '../../middleware/validate.js';
import { o2dFmsController as c } from './o2d-fms.controller.js';
import {
  mongoIdParamSchema,
  processStepParamSchema,
  completeStepSchema,
  assignStepSchema,
  stepDefinitionSchema,
  stepDefinitionUpdateSchema,
  reorderSchema,
  listQuerySchema,
  taskTemplateSchema,
  taskTemplateUpdateSchema,
  checklistToggleSchema,
  checklistParamSchema,
  commentSchema,
  planOrderSchema,
  attachmentsSchema,
  attachmentParamSchema,
} from './o2d-fms.validation.js';

const router = Router();
router.use(protect, attachUserPermissions);

// ── Step definitions (config) ────────────────────────────────
router.get('/step-definitions',
  requirePermission('o2dfms.view', 'o2dfms.config'), c.listDefinitions);

router.post('/step-definitions',
  requirePermission('o2dfms.config'), validate(stepDefinitionSchema), c.createDefinition);

router.patch('/step-definitions/reorder',
  requirePermission('o2dfms.config'), validate(reorderSchema), c.reorderDefinitions);

router.patch('/step-definitions/:id',
  requirePermission('o2dfms.config'),
  validate(mongoIdParamSchema, 'params'), validate(stepDefinitionUpdateSchema), c.updateDefinition);

router.delete('/step-definitions/:id',
  requirePermission('o2dfms.config'),
  validate(mongoIdParamSchema, 'params'), c.deactivateDefinition);

// ── Doer + views ─────────────────────────────────────────────
router.get('/my-tasks',
  requirePermission('o2dfms.view'), c.myTasks);

router.get('/dashboard',
  requirePermission('o2dfms.view'), c.dashboard);

router.get('/scores',
  requirePermission('o2dfms.view'), c.scores);

router.get('/processes',
  requirePermission('o2dfms.view'), validate(listQuerySchema, 'query'), c.listProcesses);

router.get('/processes/by-order/:orderId',
  requirePermission('o2dfms.view'), c.getProcessByOrder);

router.get('/processes/:id',
  requirePermission('o2dfms.view'), validate(mongoIdParamSchema, 'params'), c.getProcess);

// Act-on-a-step endpoints are gated at view-level; the service then enforces
// that the caller is the assignee/buddy or a privileged user.
router.patch('/processes/:id/steps/:stepCode/complete',
  requirePermission('o2dfms.view'),
  validate(processStepParamSchema, 'params'), validate(completeStepSchema), c.completeStep);

router.patch('/processes/:id/steps/:stepCode/assign',
  requirePermission('o2dfms.manage'),
  validate(processStepParamSchema, 'params'), validate(assignStepSchema), c.assignStep);

router.patch('/processes/:id/steps/:stepCode/checklist/:itemId',
  requirePermission('o2dfms.view'),
  validate(checklistParamSchema, 'params'), validate(checklistToggleSchema), c.toggleChecklist);

router.post('/processes/:id/steps/:stepCode/comment',
  requirePermission('o2dfms.view'),
  validate(processStepParamSchema, 'params'), validate(commentSchema), c.addComment);

router.post('/processes/:id/steps/:stepCode/attachments',
  requirePermission('o2dfms.view'),
  validate(processStepParamSchema, 'params'), validate(attachmentsSchema), c.addAttachments);

router.delete('/processes/:id/steps/:stepCode/attachments/:attachmentId',
  requirePermission('o2dfms.view'),
  validate(attachmentParamSchema, 'params'), c.removeAttachment);

router.patch('/processes/:id/plan',
  requirePermission('o2dfms.manage'),
  validate(mongoIdParamSchema, 'params'), validate(planOrderSchema), c.planOrder);

// ── Task templates (config) ──────────────────────────────────
router.get('/templates',
  requirePermission('o2dfms.view', 'o2dfms.config'), c.listTemplates);
router.post('/templates',
  requirePermission('o2dfms.config'), validate(taskTemplateSchema), c.createTemplate);
router.get('/templates/:id',
  requirePermission('o2dfms.view', 'o2dfms.config'), validate(mongoIdParamSchema, 'params'), c.getTemplate);
router.patch('/templates/:id',
  requirePermission('o2dfms.config'), validate(mongoIdParamSchema, 'params'), validate(taskTemplateUpdateSchema), c.updateTemplate);
router.patch('/templates/:id/default',
  requirePermission('o2dfms.config'), validate(mongoIdParamSchema, 'params'), c.setDefaultTemplate);
router.delete('/templates/:id',
  requirePermission('o2dfms.config'), validate(mongoIdParamSchema, 'params'), c.deleteTemplate);

export default router;
