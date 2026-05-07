import asyncHandler from '../../middleware/asyncHandler.js';
import { skuService } from './sku.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const skuController = {
  create: asyncHandler(async (req, res) => {
    const sku = await skuService.create(req.body);
    res.status(201).json(ApiResponse.created('SKU created', sku));
  }),

  getAll: asyncHandler(async (req, res) => {
    const { docs, pagination } = await skuService.getAll(req.query);
    res.json(ApiResponse.ok('SKUs retrieved', docs, pagination));
  }),

  getById: asyncHandler(async (req, res) => {
    const sku = await skuService.getById(req.params.id);
    res.json(ApiResponse.ok('SKU retrieved', sku));
  }),

  update: asyncHandler(async (req, res) => {
    const sku = await skuService.update(req.params.id, req.body);
    res.json(ApiResponse.ok('SKU updated', sku));
  }),

  remove: asyncHandler(async (req, res) => {
    await skuService.remove(req.params.id);
    res.json(ApiResponse.ok('SKU deleted'));
  }),
};
