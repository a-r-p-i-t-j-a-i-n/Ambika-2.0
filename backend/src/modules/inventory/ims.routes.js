/**
 * IMS routes — Packaging & Consumables inventory.
 * Base path: /api/v1/ims  (built on the shared inventory stock engine)
 */
import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import validate from '../../middleware/validate.js';
import { imsController as c } from './ims.controller.js';
import { movementQuerySchema, itemLedgerQuerySchema } from './inventory.validation.js';
import {
  overviewQuerySchema, forecastQuerySchema, historyQuerySchema, skuParamSchema,
  policySchema, receiveSchema, issueSchema,
} from './ims.validation.js';

const router = Router();
router.use(protect);

router.get('/overview', validate(overviewQuerySchema, 'query'), c.getOverview);
router.get('/dashboard', c.getDashboard);
router.get('/reorder', validate(overviewQuerySchema, 'query'), c.getReorderList);
router.get('/forecast/:skuId', validate(skuParamSchema, 'params'), validate(forecastQuerySchema, 'query'), c.getForecast);
router.get('/history/:skuId', validate(skuParamSchema, 'params'), validate(historyQuerySchema, 'query'), c.getStockHistory);
router.get('/movements', validate(movementQuerySchema, 'query'), c.getMovements);
// One item's history, newest first, with its in/out totals.
router.get('/ledger/:skuId', validate(skuParamSchema, 'params'), validate(itemLedgerQuerySchema, 'query'), c.getItemLedger);

router.get('/policy/:skuId', validate(skuParamSchema, 'params'), c.getPolicy);
router.put('/policy/:skuId', validate(skuParamSchema, 'params'), validate(policySchema), c.upsertPolicy);

router.post('/receive', validate(receiveSchema), c.receive);
router.post('/issue', validate(issueSchema), c.issue);

export default router;
