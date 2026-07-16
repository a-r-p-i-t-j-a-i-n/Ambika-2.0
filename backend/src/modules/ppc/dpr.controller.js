import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { dprService } from './dpr.service.js';
import { dprMasterService } from './dprMaster.service.js';

export const dprController = {
  // ── DPR entries ────────────────────────────────────────────────────────────
  create: asyncHandler(async (req, res) => {
    res.status(201).json(ApiResponse.created('DPR entry saved', await dprService.create(req.body, req.user)));
  }),
  update: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('DPR entry updated', await dprService.update(req.params.id, req.body, req.user)));
  }),
  remove: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('DPR entry deleted', await dprService.remove(req.params.id)));
  }),
  getById: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('DPR entry', await dprService.getById(req.params.id)));
  }),
  list: asyncHandler(async (req, res) => {
    const { docs, pagination, summary } = await dprService.list(req.query);
    res.json(ApiResponse.ok('DPR register', docs, { pagination, summary }));
  }),

  // ── Dashboards ─────────────────────────────────────────────────────────────
  machineDashboard: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Machine dashboard', await dprService.machineDashboard(req.query)));
  }),
  productionDashboard: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Production dashboard', await dprService.productionDashboard(req.query)));
  }),
  operatorDashboard: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Operator dashboard', await dprService.operatorDashboard(req.query)));
  }),
  misScoring: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('MIS scoring', await dprService.misScoring(req.query)));
  }),

  // ── Masters / form options ─────────────────────────────────────────────────
  formOptions: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('DPR form options', await dprMasterService.getFormOptions()));
  }),
  operations: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Operations', await dprMasterService.getOperations(req.query.skuCode)));
  }),
  dies: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Dies', await dprMasterService.getDies(req.query.skuCode, req.query.operationDesc)));
  }),
  masterStats: asyncHandler(async (_req, res) => {
    res.json(ApiResponse.ok('Master stats', await dprMasterService.masterStats()));
  }),
  listMaster: asyncHandler(async (req, res) => {
    const { docs, pagination } = await dprMasterService.listMaster(req.params.kind, req.query);
    res.json(ApiResponse.ok('Master list', docs, { pagination }));
  }),
  createMaster: asyncHandler(async (req, res) => {
    res.status(201).json(ApiResponse.created('Record created', await dprMasterService.createMaster(req.params.kind, req.body, req.user)));
  }),
  updateMaster: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Record updated', await dprMasterService.updateMaster(req.params.kind, req.params.id, req.body, req.user)));
  }),
  deleteMaster: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Record deleted', await dprMasterService.deleteMaster(req.params.kind, req.params.id)));
  }),
};

export default dprController;
