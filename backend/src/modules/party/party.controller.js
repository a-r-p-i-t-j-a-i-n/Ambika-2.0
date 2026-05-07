import asyncHandler from '../../middleware/asyncHandler.js';
import { partyService } from './party.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const partyController = {
  create: asyncHandler(async (req, res) => {
    const party = await partyService.create(req.body);
    res.status(201).json(ApiResponse.created('Party created', party));
  }),

  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await partyService.getAll(req.query);
    res.json(ApiResponse.ok('Parties retrieved', docs, pagination));
  }),

  getById: asyncHandler(async (req, res) => {
    const party = await partyService.getById(req.params.id);
    res.json(ApiResponse.ok('Party retrieved', party));
  }),

  update: asyncHandler(async (req, res) => {
    const party = await partyService.update(req.params.id, req.body);
    res.json(ApiResponse.ok('Party updated', party));
  }),

  remove: asyncHandler(async (req, res) => {
    await partyService.remove(req.params.id);
    res.json(ApiResponse.ok('Party deleted'));
  }),
};
