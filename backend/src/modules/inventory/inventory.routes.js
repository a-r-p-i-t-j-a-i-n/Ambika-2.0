/**
 * Inventory routes — shared stock-movement foundation.
 * Base path: /api/v1/inventory
 *
 * Reused by GRN (and future modules) via `inventory.service` directly; these
 * HTTP endpoints serve reads (stock + ledger) and manual adjustments.
 */
import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import validate from '../../middleware/validate.js';
import { inventoryController as c } from './inventory.controller.js';
import {
  adjustStockSchema,
  stockQuerySchema,
  movementQuerySchema,
  mongoIdParamSchema,
  refParamSchema,
} from './inventory.validation.js';

const router = Router();
router.use(protect);

router.get('/stats', c.getStats);

router.get('/stock', validate(stockQuerySchema, 'query'), c.getStock);
router.get('/stock/:id', validate(mongoIdParamSchema, 'params'), c.getStockBySku);

router.get('/movements', validate(movementQuerySchema, 'query'), c.getMovements);
router.get('/movements/by-ref/:refType/:refId', validate(refParamSchema, 'params'), c.getMovementsByRef);

router.post('/adjust', validate(adjustStockSchema), c.adjust);

export default router;
