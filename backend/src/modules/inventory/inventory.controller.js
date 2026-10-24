import asyncHandler from '../../middleware/asyncHandler.js';
import { inventoryService } from './inventory.service.js';
import { stockCorrectionService } from './stockCorrection.service.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const inventoryController = {
  getStock: asyncHandler(async (req, res) => {
    const { docs, pagination } = await inventoryService.getStock(req.query);
    res.json(ApiResponse.ok('Inventory stock retrieved', docs, pagination));
  }),

  getStockBySku: asyncHandler(async (req, res) => {
    const rows = await inventoryService.getStockBySku(req.params.id);
    res.json(ApiResponse.ok('Stock for SKU', rows));
  }),

  getMovements: asyncHandler(async (req, res) => {
    const { docs, pagination } = await inventoryService.getMovements(req.query);
    res.json(ApiResponse.ok('Inventory movements retrieved', docs, pagination));
  }),

  getMovementsByRef: asyncHandler(async (req, res) => {
    const rows = await inventoryService.getMovementsByRef(req.params.refType, req.params.refId);
    res.json(ApiResponse.ok('Movements for reference', rows));
  }),

  getStats: asyncHandler(async (_req, res) => {
    const stats = await inventoryService.getStats();
    res.json(ApiResponse.ok('Inventory stats', stats));
  }),

  adjust: asyncHandler(async (req, res) => {
    const { movement, stock } = await inventoryService.adjust(req.body, req.user);
    res.status(201).json(ApiResponse.created('Stock adjusted', { movement, stock }));
  }),

  // ── Stock correction (physical count → system), any IMS item ──
  getCorrectionSkus: asyncHandler(async (req, res) => {
    res.json(ApiResponse.ok('Items to correct', await stockCorrectionService.listSkus(req.query)));
  }),

  correctStock: asyncHandler(async (req, res) => {
    const out = await stockCorrectionService.correct(req.body, req.user);
    res.status(out.duplicate ? 200 : 201).json(ApiResponse.created('Stock corrected', out));
  }),
};
