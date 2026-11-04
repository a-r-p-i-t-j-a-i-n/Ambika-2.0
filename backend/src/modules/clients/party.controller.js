import asyncHandler from '../../middleware/asyncHandler.js';
import { partyService } from './party.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const partyController = {
  create: asyncHandler(async (req, res) => {
    const party = await partyService.create(req.body, req.user?._id);
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
    const party = await partyService.update(req.params.id, req.body, req.user?._id);
    res.json(ApiResponse.ok('Party updated', party));
  }),

  remove: asyncHandler(async (req, res) => {
    await partyService.remove(req.params.id, req.user?._id);
    res.json(ApiResponse.ok('Party deleted'));
  }),

  addOrderedSkus: asyncHandler(async (req, res) => {
    const { party, added, linked, already } = await partyService.addOrderedSkus(req.params.id, req.body.skuIds, req.user?._id);
    const done = added.length + linked.length;
    const message = done
      ? `${done} SKU${done === 1 ? '' : 's'} added${already.length ? ` · ${already.length} already on the list` : ''}`
      : 'Those SKUs are already on the list';
    res.json(ApiResponse.ok(message, party));
  }),

  removeOrderedSku: asyncHandler(async (req, res) => {
    const { party, removed } = await partyService.removeOrderedSku(req.params.id, req.params.itemId, req.user?._id);
    res.json(ApiResponse.ok(`${removed} removed`, party));
  }),
};
