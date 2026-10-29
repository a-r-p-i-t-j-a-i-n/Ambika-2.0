import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { fmsDoerService as svc } from './fmsDoer.service.js';

export const fmsDoerController = {
  catalogs: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('FMS catalogs', svc.listCatalogs()));
  }),

  assignments: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Doer assignments', await svc.listAssignments(req.params.fmsKey)));
  }),

  assignableUsers: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Assignable users', await svc.assignableUsers(req.params.fmsKey, req.params.stepKey)));
  }),

  setAssignment: asyncHandler(async (req, res) => {
    const out = await svc.setAssignment(req.params.fmsKey, req.params.stepKey, req.body, req.user);
    res.json(ApiResponse.ok('Doer assignment saved', out));
  }),

  history: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Assignment history', await svc.assignmentHistory(req.params.fmsKey, req.params.stepKey)));
  }),

  applyToOpenTasks: asyncHandler(async (req, res) => {
    const out = await svc.applyConfigToOpenTasks(req.params.fmsKey, req.params.stepKey, req.body, req.user);
    res.json(ApiResponse.ok(`${out.reassigned} open task(s) reassigned`, out));
  }),

  plan: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Doer plan', await svc.getPlan(req.params.fmsKey)));
  }),

  planUsers: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Assignable people', await svc.planUsers(req.params.fmsKey)));
  }),

  savePlan: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Doer plan saved', await svc.savePlan(req.params.fmsKey, req.body, req.user)));
  }),

  applyPlan: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Pending items updated', await svc.applyPlanToOpenTasks(req.params.fmsKey, req.body, req.user)));
  }),

  myTasks: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('My FMS tasks', await svc.myTasks(req.user)));
  }),

  listTasks: asyncHandler(async (req, res) => {
    const { docs, pagination } = await svc.listTasks(req.query);
    res.json(ApiResponse.ok('FMS tasks', docs, pagination));
  }),

  byEntity: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('FMS tasks for item', await svc.tasksByEntity(req.query.entityType, req.query.entityId)));
  }),

  reassignTask: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Task reassigned', await svc.reassignTask(req.params.id, req.body, req.user)));
  }),

  sync: asyncHandler(async (req, res) => {
    // Manual reconcile — attributes nothing to the caller (they didn't move any item).
    await svc.enqueueSync({ actor: null, notify: true, openedVia: 'SYNC' });
    res.json(ApiResponse.ok('FMS tasks synced', { ok: true }));
  }),
};
