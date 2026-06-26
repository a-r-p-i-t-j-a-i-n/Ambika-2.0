import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { dispatchControlService } from './dispatch-control.service.js';

// Build an actor context the service can audit-log against without leaking
// req plumbing into the service layer.
const buildActor = (req) => ({
  _id: req.user?._id,
  userId: req.user?._id,
  companyId: req.user?.companyId,
  ipAddress: req.ip,
  userAgent: req.headers?.['user-agent'],
});

export const dispatchControlController = {
  createOrderEntry: asyncHandler(async (req, res) => {
    const order = await dispatchControlService.createOrderEntry(req.body);
    res.status(201).json(ApiResponse.created('Order entry saved successfully', order));
  }),

  planDispatch: asyncHandler(async (req, res) => {
    const comparison = await dispatchControlService.planDispatch(req.body, buildActor(req));
    res.status(201).json(ApiResponse.created('Dispatch plan saved successfully', comparison));
  }),

  createActualDispatch: asyncHandler(async (req, res) => {
    const result = await dispatchControlService.createActualDispatch(req.body, buildActor(req));
    res.status(201).json(ApiResponse.created('Actual dispatch and challan saved successfully', result));
  }),

  emailSchedule: asyncHandler(async (req, res) => {
    const result = await dispatchControlService.emailSchedule(req.body);
    res.json(ApiResponse.ok('Dispatch schedule email processed', result));
  }),

  getComparison: asyncHandler(async (req, res) => {
    const comparison = await dispatchControlService.getComparison(req.params.soNumber);
    res.json(ApiResponse.ok('Plan vs actual comparison retrieved', comparison));
  }),

  getSchedule: asyncHandler(async (req, res) => {
    const schedule = await dispatchControlService.getSchedule(req.params.soNumber);
    res.json(ApiResponse.ok('Schedule retrieved', schedule));
  }),

  getDispatchablePhases: asyncHandler(async (req, res) => {
    const phases = await dispatchControlService.getDispatchablePhases(req.params.soNumber);
    res.json(ApiResponse.ok('Dispatchable phases retrieved', phases));
  }),

  createPhase: asyncHandler(async (req, res) => {
    const result = await dispatchControlService.createPhase(req.params.soNumber, req.body, buildActor(req));
    res.status(201).json(ApiResponse.created('Phase created', result));
  }),

  updatePhase: asyncHandler(async (req, res) => {
    const result = await dispatchControlService.updatePhase(req.params.soNumber, req.params.phaseId, req.body, buildActor(req));
    res.json(ApiResponse.ok('Phase updated', result));
  }),

  deletePhase: asyncHandler(async (req, res) => {
    const result = await dispatchControlService.deletePhase(req.params.soNumber, req.params.phaseId, buildActor(req));
    res.json(ApiResponse.ok('Phase removed', result));
  }),

  getOrderControlTower: asyncHandler(async (req, res) => {
    const controlTower = await dispatchControlService.getOrderControlTower(req.params.soNumber);
    res.json(ApiResponse.ok('Order control tower retrieved', controlTower));
  }),

  getDashboard: asyncHandler(async (req, res) => {
    const dashboard = await dispatchControlService.getDashboard(req.query);
    res.json(ApiResponse.ok('Dispatch dashboard retrieved', dashboard));
  }),

  getPhaseMatrix: asyncHandler(async (_req, res) => {
    const rows = await dispatchControlService.getPhaseMatrix();
    res.json(ApiResponse.ok('Phase matrix retrieved', rows));
  }),

  normalizeSheetRows: asyncHandler(async (req, res) => {
    const rows = await dispatchControlService.normalizeSheetRows(req.body);
    res.json(ApiResponse.ok('Sheet rows normalized', rows));
  }),
};
