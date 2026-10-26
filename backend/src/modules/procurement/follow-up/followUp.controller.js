import asyncHandler from '../../../middleware/asyncHandler.js';
import { followUpService } from './followUp.service.js';
import { attachStepTiming } from '../stepTiming.js';
import { ApiResponse } from '../../../utils/apiResponse.js';

export const followUpController = {
  getAll: asyncHandler(async (req, res) => {
    const { docs: rows, pagination } = await followUpService.getAll(req.query);
    const docs = await attachStepTiming('FOLLOW_UP', rows);
    res.json(ApiResponse.ok('Follow-ups retrieved', docs, pagination));
  }),

  getStats: asyncHandler(async (_req, res) => {
    const stats = await followUpService.getStats();
    res.json(ApiResponse.ok('Follow-up stats', stats));
  }),

  getByPo: asyncHandler(async (req, res) => {
    const followUps = await followUpService.getByPo(req.params.poId);
    res.json(ApiResponse.ok('Follow-ups for PO', followUps));
  }),

  getById: asyncHandler(async (req, res) => {
    const fu = await followUpService.getById(req.params.id);
    res.json(ApiResponse.ok('Follow-up retrieved', fu));
  }),

  create: asyncHandler(async (req, res) => {
    const fu = await followUpService.create(req.body, req.user);
    res.status(201).json(ApiResponse.created('Follow-up created', fu));
  }),

  update: asyncHandler(async (req, res) => {
    const fu = await followUpService.update(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Follow-up updated', fu));
  }),

  remove: asyncHandler(async (req, res) => {
    const fu = await followUpService.remove(req.params.id, req.user);
    res.json(ApiResponse.ok('Follow-up deleted', fu));
  }),

  markDone: asyncHandler(async (req, res) => {
    const fu = await followUpService.markDone(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Follow-up marked done', fu));
  }),

  reschedule: asyncHandler(async (req, res) => {
    const fu = await followUpService.reschedule(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Follow-up rescheduled', fu));
  }),

  markReadyForGrn: asyncHandler(async (req, res) => {
    const fu = await followUpService.markReadyForGrn(req.params.id, req.body, req.user);
    res.json(ApiResponse.ok('Material marked ready for GRN', fu));
  }),
};
