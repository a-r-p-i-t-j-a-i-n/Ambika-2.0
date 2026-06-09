import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { o2dFmsService } from './o2d-fms.service.js';

export const o2dFmsController = {
  // ── Processes ──────────────────────────────────────────────
  listProcesses: asyncHandler(async (req, res) => {
    const { docs, pagination } = await o2dFmsService.listProcesses(req.query);
    res.json(ApiResponse.ok('O2D processes retrieved', docs, pagination));
  }),

  getProcess: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.getProcessById(req.params.id);
    res.json(ApiResponse.ok('O2D process retrieved', process));
  }),

  getProcessByOrder: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.getProcessByOrder(req.params.orderId);
    res.json(ApiResponse.ok('O2D process retrieved', process));
  }),

  myTasks: asyncHandler(async (req, res) => {
    const tasks = await o2dFmsService.getMyTasks(req.user, req.query);
    res.json(ApiResponse.ok('My tasks retrieved', tasks));
  }),

  dashboard: asyncHandler(async (req, res) => {
    const data = await o2dFmsService.getDashboard();
    res.json(ApiResponse.ok('O2D FMS dashboard', data));
  }),

  scores: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('Doer scores', await o2dFmsService.getDoerScores()));
  }),

  completeStep: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.completeStep(req.params.id, req.params.stepCode, req.body, req.user);
    res.json(ApiResponse.ok(`Step '${req.params.stepCode}' completed`, process));
  }),

  assignStep: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.assignStep(req.params.id, req.params.stepCode, req.body.userId, req.user);
    res.json(ApiResponse.ok(`Step '${req.params.stepCode}' reassigned`, process));
  }),

  toggleChecklist: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.toggleChecklistItem(
      req.params.id, req.params.stepCode, req.params.itemId, req.body.done, req.user);
    res.json(ApiResponse.ok('Checklist updated', process));
  }),

  addComment: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.addComment(req.params.id, req.params.stepCode, req.body.text, req.user);
    res.json(ApiResponse.ok('Comment added', process));
  }),

  addAttachments: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.addAttachments(req.params.id, req.params.stepCode, req.body.attachments, req.user);
    res.json(ApiResponse.ok('Attachments added', process));
  }),

  removeAttachment: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.removeAttachment(req.params.id, req.params.stepCode, req.params.attachmentId);
    res.json(ApiResponse.ok('Attachment removed', process));
  }),

  planOrder: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.planOrder(req.params.id, req.body.steps, req.user);
    res.json(ApiResponse.ok('Order plan updated', process));
  }),

  // ── Task templates ─────────────────────────────────────────
  listTemplates: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('Templates retrieved', await o2dFmsService.listTemplates()));
  }),
  getTemplate: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Template retrieved', await o2dFmsService.getTemplate(req.params.id)));
  }),
  createTemplate: asyncHandler(async (req, res) => {
    res.status(201).json(ApiResponse.created('Template created', await o2dFmsService.createTemplate(req.body, req.user)));
  }),
  updateTemplate: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Template updated', await o2dFmsService.updateTemplate(req.params.id, req.body, req.user)));
  }),
  setDefaultTemplate: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Default template set', await o2dFmsService.setDefaultTemplate(req.params.id)));
  }),
  deleteTemplate: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Template deleted', await o2dFmsService.deleteTemplate(req.params.id)));
  }),

  // ── Step definitions (config) ──────────────────────────────
  listDefinitions: asyncHandler(async (_req, res) => {
    const defs = await o2dFmsService.listDefinitions();
    res.json(ApiResponse.ok('Step definitions retrieved', defs));
  }),

  createDefinition: asyncHandler(async (req, res) => {
    const def = await o2dFmsService.createDefinition(req.body, req.user);
    res.status(201).json(ApiResponse.created('Step definition created', def));
  }),

  updateDefinition: asyncHandler(async (req, res) => {
    const def = await o2dFmsService.updateDefinition(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Step definition updated', def));
  }),

  reorderDefinitions: asyncHandler(async (req, res) => {
    const defs = await o2dFmsService.reorderDefinitions(req.body.order, req.user);
    res.json(ApiResponse.ok('Step definitions reordered', defs));
  }),

  deactivateDefinition: asyncHandler(async (req, res) => {
    const def = await o2dFmsService.deactivateDefinition(req.params.id, req.user);
    res.json(ApiResponse.ok('Step definition deactivated', def));
  }),
};

export default o2dFmsController;
