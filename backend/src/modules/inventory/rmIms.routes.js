/**
 * RM IMS routes — Raw Material (Coil + Circle) inventory.
 * Base path: /api/v1/rm-ims  (built on the shared inventory stock engine)
 */
import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import validate from '../../middleware/validate.js';
import { rmImsController as c } from './rmIms.controller.js';
import {
  rmOverviewQuerySchema, rmForecastQuerySchema, rmSkuParamSchema,
  rmPolicySchema, rmReceiveSchema, rmIssueSchema, rmConvertSchema,
  rmMovementQuerySchema, rmConversionsQuerySchema,
} from './rmIms.validation.js';

const router = Router();
router.use(protect);

router.get('/overview', validate(rmOverviewQuerySchema, 'query'), c.getOverview);
router.get('/dashboard', c.getDashboard);
router.get('/reorder', validate(rmOverviewQuerySchema, 'query'), c.getReorderList);
router.get('/forecast/:skuId', validate(rmSkuParamSchema, 'params'), validate(rmForecastQuerySchema, 'query'), c.getForecast);
router.get('/movements', validate(rmMovementQuerySchema, 'query'), c.getMovements);
router.get('/conversions', validate(rmConversionsQuerySchema, 'query'), c.getConversions);

router.get('/policy/:skuId', validate(rmSkuParamSchema, 'params'), c.getPolicy);
router.put('/policy/:skuId', validate(rmSkuParamSchema, 'params'), validate(rmPolicySchema), c.upsertPolicy);

router.post('/receive', validate(rmReceiveSchema), c.receive);
router.post('/issue', validate(rmIssueSchema), c.issue);
router.post('/convert', validate(rmConvertSchema), c.convert);

export default router;
