import asyncHandler from '../../../middleware/asyncHandler.js';
import { incomingQcService } from './incomingQc.service.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

export const incomingQcController = {
  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await incomingQcService.getAll(req.query);
    res.json(ApiResponse.ok('Incoming QC retrieved', docs, pagination));
  }),

  getStats: asyncHandler(async (_req, res) => {
    const stats = await incomingQcService.getStats();
    res.json(ApiResponse.ok('Incoming QC stats', stats));
  }),

  getByGrn: asyncHandler(async (req, res) => {
    const rows = await incomingQcService.getByGrn(req.params.grnId);
    res.json(ApiResponse.ok('QC for GRN', rows));
  }),

  getById: asyncHandler(async (req, res) => {
    const qc = await incomingQcService.getById(req.params.id);
    res.json(ApiResponse.ok('Incoming QC retrieved', qc));
  }),

  create: asyncHandler(async (req, res) => {
    const qc = await incomingQcService.create(req.body, req.user);
    res.status(201).json(ApiResponse.created('Incoming QC created', qc));
  }),

  update: asyncHandler(async (req, res) => {
    const qc = await incomingQcService.update(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Incoming QC updated', qc));
  }),

  remove: asyncHandler(async (req, res) => {
    const qc = await incomingQcService.remove(req.params.id, req.user);
    res.json(ApiResponse.ok('Incoming QC deleted', qc));
  }),

  complete: asyncHandler(async (req, res) => {
    const qc = await incomingQcService.complete(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Incoming QC completed', qc));
  }),

  cancel: asyncHandler(async (req, res) => {
    const qc = await incomingQcService.cancel(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Incoming QC cancelled', qc));
  }),
};
