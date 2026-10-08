import asyncHandler from '../../../middleware/asyncHandler.js';
import { machineOperatorService } from './machineOperator.service.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

export const machineOperatorController = {
  create: asyncHandler(async (req, res) => {
    const operator = await machineOperatorService.create(req.body, req.user?._id);
    res.status(201).json(ApiResponse.created('Machine operator created', operator));
  }),

  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await machineOperatorService.getAll(req.query);
    res.json(ApiResponse.ok('Machine operators retrieved', docs, pagination));
  }),

  getById: asyncHandler(async (req, res) => {
    const operator = await machineOperatorService.getById(req.params.id);
    res.json(ApiResponse.ok('Machine operator retrieved', operator));
  }),

  update: asyncHandler(async (req, res) => {
    const operator = await machineOperatorService.update(req.params.id, req.body, req.user?._id);
    res.json(ApiResponse.ok('Machine operator updated', operator));
  }),

  remove: asyncHandler(async (req, res) => {
    await machineOperatorService.remove(req.params.id, req.user?._id);
    res.json(ApiResponse.ok('Machine operator deleted'));
  }),

  lookup: asyncHandler(async (req, res) => {
    const operators = await machineOperatorService.lookup(req.query);
    res.json(ApiResponse.ok('Machine operator lookup', operators));
  }),

  // ── Assigned machines ───────────────────────────────────────────
  getMachines: asyncHandler(async (req, res) => {
    const machines = await machineOperatorService.getMachines(req.params.id);
    res.json(ApiResponse.ok('Assigned machines retrieved', machines));
  }),

  assignMachine: asyncHandler(async (req, res) => {
    const assignment = await machineOperatorService.assignMachine(
      req.params.id, req.body.machineId, req.user?._id,
    );
    res.status(201).json(ApiResponse.created('Machine assigned', assignment));
  }),

  unassignMachine: asyncHandler(async (req, res) => {
    const result = await machineOperatorService.unassignMachine(
      req.params.id, req.params.machineId, req.user?._id,
    );
    res.json(ApiResponse.ok('Machine unassigned', result));
  }),
};

export default machineOperatorController;
