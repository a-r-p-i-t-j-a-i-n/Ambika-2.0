/**
 * FG IMS routes — Finished Goods inventory.
 * Base path: /api/v1/fg-ims  (built on the shared inventory stock engine)
 *
 * Stock rises via Production In (DPR) and falls via Dispatch Out. This module is
 * standalone — it is NOT yet auto-wired to the Dispatch / DPR modules.
 */
import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import validate from '../../middleware/validate.js';
import { fgImsController as c } from './fgIms.controller.js';
import {
  fgOverviewQuerySchema, fgForecastQuerySchema, fgHistoryQuerySchema, fgSkuParamSchema,
  fgPolicySchema, fgProduceSchema, fgDispatchSchema, fgMovementQuerySchema,
} from './fgIms.validation.js';

const router = Router();
router.use(protect);

router.get('/overview', validate(fgOverviewQuerySchema, 'query'), c.getOverview);
router.get('/dashboard', c.getDashboard);
router.get('/replenish', validate(fgOverviewQuerySchema, 'query'), c.getReplenishList);
router.get('/forecast/:skuId', validate(fgSkuParamSchema, 'params'), validate(fgForecastQuerySchema, 'query'), c.getForecast);
router.get('/history/:skuId', validate(fgSkuParamSchema, 'params'), validate(fgHistoryQuerySchema, 'query'), c.getStockHistory);
router.get('/movements', validate(fgMovementQuerySchema, 'query'), c.getMovements);

router.get('/policy/:skuId', validate(fgSkuParamSchema, 'params'), c.getPolicy);
router.put('/policy/:skuId', validate(fgSkuParamSchema, 'params'), validate(fgPolicySchema), c.upsertPolicy);

router.post('/produce', validate(fgProduceSchema), c.produce);
router.post('/dispatch', validate(fgDispatchSchema), c.dispatch);

export default router;
