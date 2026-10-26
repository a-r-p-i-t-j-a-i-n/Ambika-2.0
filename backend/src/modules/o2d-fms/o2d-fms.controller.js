import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { o2dFmsService } from './o2d-fms.service.js';

// Privileged = root or has act/manage. Assignees/buddies can act regardless (checked in the service).
const isPriv = (req) => !!(req.userIsRoot || req.userPermissions?.has('o2dfms.act') || req.userPermissions?.has('o2dfms.manage'));

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

  // Step Board: every Delivery Challan across all orders, with invoice figures.
  listBoardConsignments: asyncHandler(async (req, res) => {
    const rows = await o2dFmsService.listBoardConsignments();
    res.json(ApiResponse.ok('Board consignments retrieved', rows));
  }),

  getProcessByOrder: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.getProcessByOrder(req.params.orderId);
    res.json(ApiResponse.ok('O2D process retrieved', process));
  }),

  getConsignments: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Consignments', await o2dFmsService.getConsignments(req.params.id)));
  }),

  myTasks: asyncHandler(async (req, res) => {
    const tasks = await o2dFmsService.getMyTasks(req.user, req.query);
    res.json(ApiResponse.ok('My tasks retrieved', tasks));
  }),

  activeTask: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Active task', await o2dFmsService.getActiveTask(req.query)));
  }),

  // Sequential gate — may the caller perform `action` on this order yet?
  actionGate: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Action gate', await o2dFmsService.getActionGate(req.query)));
  }),

  allTasks: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('All tasks retrieved', await o2dFmsService.getAllTasks()));
  }),

  dashboard: asyncHandler(async (req, res) => {
    const data = await o2dFmsService.getDashboard();
    res.json(ApiResponse.ok('O2D FMS dashboard', data));
  }),

  scores: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('Doer scores', await o2dFmsService.getDoerScores()));
  }),

  misScores: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('MIS scores', await o2dFmsService.getMisScores()));
  }),

  doerProfile: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Doer profile', await o2dFmsService.getDoerProfile(req.params.userId)));
  }),

  completeStep: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.completeStep(req.params.id, req.params.stepCode, req.body, req.user, { privileged: isPriv(req) });
    res.json(ApiResponse.ok(`Step '${req.params.stepCode}' completed`, process));
  }),

  skipStep: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.skipStep(req.params.id, req.params.stepCode, req.body, req.user, { privileged: isPriv(req) });
    res.json(ApiResponse.ok(`Step '${req.params.stepCode}' skipped`, process));
  }),

  // FMS → Doer Assignment (O2D)
  getDoerPlan: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('O2D doer assignment', await o2dFmsService.getDoerPlan()));
  }),
  doerPlanUsers: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('Assignable people', await o2dFmsService.listDoerPlanUsers()));
  }),
  saveDoerPlan: asyncHandler(async (req, res) => {
    const plan = await o2dFmsService.saveDoerPlan(req.body.steps, req.user, { applyToOpenOrders: req.body.applyToOpenOrders === true });
    res.json(ApiResponse.ok('O2D doer assignment saved', plan));
  }),

  applyDoerPlanToOpenOrders: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Running orders updated', await o2dFmsService.applyDoerPlanToOpenOrders(req.user)));
  }),

  markActionDone: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.markActionDone(
      req.params.id, req.params.stepCode, { actionKey: req.body.actionKey, link: req.body.link }, req.user, isPriv(req));
    res.json(ApiResponse.ok('Action marked done', process));
  }),

  assignStep: asyncHandler(async (req, res) => {
    const { assignees, buddies, userId } = req.body;
    const payload = {
      assignees: assignees?.length ? assignees : (userId ? [userId] : []),
      buddies: buddies || [],
    };
    const process = await o2dFmsService.assignStep(req.params.id, req.params.stepCode, payload, req.user);
    res.json(ApiResponse.ok(`Step '${req.params.stepCode}' reassigned`, process));
  }),

  toggleChecklist: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.toggleChecklistItem(
      req.params.id, req.params.stepCode, req.params.itemId, req.body.done, req.user, isPriv(req));
    res.json(ApiResponse.ok('Checklist updated', process));
  }),

  setConsignmentPayment: asyncHandler(async (req, res) => {
    const consignments = await o2dFmsService.setConsignmentPayment(
      req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Payment status saved', consignments));
  }),

  setChecklistProof: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.setChecklistProof(
      req.params.id, req.params.stepCode, req.params.itemId, req.body, req.user, isPriv(req));
    res.json(ApiResponse.ok(req.body.clear ? 'Proof removed' : 'Proof attached', process));
  }),

  answerVerification: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.answerVerification(
      req.params.id, req.params.stepCode, req.params.itemId, req.body.answer, req.body.remark, req.user, isPriv(req));
    res.json(ApiResponse.ok('Verification updated', process));
  }),

  fillFormField: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.fillFormField(
      req.params.id, req.params.stepCode, req.params.itemId, req.body.value, req.user, isPriv(req));
    res.json(ApiResponse.ok('Field saved', process));
  }),

  approveStep: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.approveStep(req.params.id, req.params.stepCode, req.user, isPriv(req));
    res.json(ApiResponse.ok('Step approved', process));
  }),

  addComment: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.addComment(req.params.id, req.params.stepCode, req.body.text, req.user, isPriv(req));
    res.json(ApiResponse.ok('Comment added', process));
  }),

  addAttachments: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.addAttachments(req.params.id, req.params.stepCode, req.body.attachments, req.user, isPriv(req));
    res.json(ApiResponse.ok('Attachments added', process));
  }),

  removeAttachment: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.removeAttachment(req.params.id, req.params.stepCode, req.params.attachmentId, req.user, isPriv(req));
    res.json(ApiResponse.ok('Attachment removed', process));
  }),

  planOrder: asyncHandler(async (req, res) => {
    const process = await o2dFmsService.planOrder(req.params.id, req.body.steps, req.user);
    res.json(ApiResponse.ok('Order plan updated', process));
  }),

  // ── Task templates ─────────────────────────────────────────
  listTemplates: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Templates retrieved', await o2dFmsService.listTemplates(req.query.fmsKey)));
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
  listDefinitions: asyncHandler(async (req, res) => {
    const defs = await o2dFmsService.listDefinitions(req.query.fmsKey);
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
