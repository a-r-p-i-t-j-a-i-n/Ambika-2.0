import asyncHandler from '../../../middleware/asyncHandler.js';
import { machineService } from './machine.service.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

export const machineController = {
  create: asyncHandler(async (req, res) => {
    const machine = await machineService.create(req.body, req.user?._id);
    res.status(201).json(ApiResponse.created('Machine created', machine));
  }),

  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await machineService.getAll(req.query);
    res.json(ApiResponse.ok('Machines retrieved', docs, pagination));
  }),

  getById: asyncHandler(async (req, res) => {
    const machine = await machineService.getById(req.params.id);
    res.json(ApiResponse.ok('Machine retrieved', machine));
  }),

  update: asyncHandler(async (req, res) => {
    const machine = await machineService.update(req.params.id, req.body, req.user?._id);
    res.json(ApiResponse.ok('Machine updated', machine));
  }),

  remove: asyncHandler(async (req, res) => {
    await machineService.remove(req.params.id, req.user?._id);
    res.json(ApiResponse.ok('Machine deleted'));
  }),

  lookup: asyncHandler(async (req, res) => {
    const machines = await machineService.lookup(req.query);
    res.json(ApiResponse.ok('Machine lookup', machines));
  }),

  // ── Assigned operators ──────────────────────────────────────────
  getOperators: asyncHandler(async (req, res) => {
    const operators = await machineService.getOperators(req.params.id);
    res.json(ApiResponse.ok('Assigned operators retrieved', operators));
  }),

  assignOperator: asyncHandler(async (req, res) => {
    const assignment = await machineService.assignOperator(
      req.params.id, req.body.operatorId, req.user?._id,
    );
    res.status(201).json(ApiResponse.created('Operator assigned', assignment));
  }),

  unassignOperator: asyncHandler(async (req, res) => {
    const result = await machineService.unassignOperator(
      req.params.id, req.params.operatorId, req.user?._id,
    );
    res.json(ApiResponse.ok('Operator unassigned', result));
  }),
};

export default machineController;
