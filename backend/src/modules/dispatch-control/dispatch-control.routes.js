import { Router } from 'express';
import validate from '../../middleware/validate.js';
import { dispatchControlController } from './dispatch-control.controller.js';
import {
  actualDispatchSchema,
  dashboardQuerySchema,
  normalizeRowsSchema,
  orderEntrySchema,
  planDispatchSchema,
  soNumberParamSchema,
} from './dispatch-control.validation.js';

const router = Router();

router.get('/dashboard', validate(dashboardQuerySchema, 'query'), dispatchControlController.getDashboard);

router.post('/order-entry', validate(orderEntrySchema), dispatchControlController.createOrderEntry);
router.post('/dispatch-plans', validate(planDispatchSchema), dispatchControlController.planDispatch);
router.post('/actual-dispatches', validate(actualDispatchSchema), dispatchControlController.createActualDispatch);
router.post('/sheet-rows/normalize', validate(normalizeRowsSchema), dispatchControlController.normalizeSheetRows);

router.get('/orders/:soNumber/summary', validate(soNumberParamSchema, 'params'), dispatchControlController.getOrderControlTower);
router.get('/orders/:soNumber/comparison', validate(soNumberParamSchema, 'params'), dispatchControlController.getComparison);

export default router;
