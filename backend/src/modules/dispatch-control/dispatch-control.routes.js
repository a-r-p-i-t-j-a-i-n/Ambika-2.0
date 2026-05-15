import { Router } from 'express';
import validate from '../../middleware/validate.js';
import { dispatchControlController } from './dispatch-control.controller.js';
import {
  actualDispatchSchema,
  createPhaseSchema,
  dashboardQuerySchema,
  normalizeRowsSchema,
  orderEntrySchema,
  phaseParamSchema,
  planDispatchSchema,
  soNumberParamSchema,
  updatePhaseSchema,
} from './dispatch-control.validation.js';

const router = Router();

// ── Reads ────────────────────────────────────────────────────
router.get('/dashboard', validate(dashboardQuerySchema, 'query'), dispatchControlController.getDashboard);

router.get('/orders/:soNumber/summary',                 validate(soNumberParamSchema, 'params'), dispatchControlController.getOrderControlTower);
router.get('/orders/:soNumber/comparison',              validate(soNumberParamSchema, 'params'), dispatchControlController.getComparison);
router.get('/orders/:soNumber/schedule',                validate(soNumberParamSchema, 'params'), dispatchControlController.getSchedule);
router.get('/orders/:soNumber/dispatchable-phases',     validate(soNumberParamSchema, 'params'), dispatchControlController.getDispatchablePhases);

// ── Writes ───────────────────────────────────────────────────
router.post('/order-entry',                             validate(orderEntrySchema),    dispatchControlController.createOrderEntry);
router.post('/dispatch-plans',                          validate(planDispatchSchema),  dispatchControlController.planDispatch);
router.post('/actual-dispatches',                       validate(actualDispatchSchema),dispatchControlController.createActualDispatch);

// Phase-level CRUD (the planner manages individual phases here).
router.post('/orders/:soNumber/phases',                 validate(soNumberParamSchema, 'params'), validate(createPhaseSchema), dispatchControlController.createPhase);
router.patch('/orders/:soNumber/phases/:phaseId',       validate(phaseParamSchema, 'params'),    validate(updatePhaseSchema), dispatchControlController.updatePhase);
router.delete('/orders/:soNumber/phases/:phaseId',      validate(phaseParamSchema, 'params'),    dispatchControlController.deletePhase);

router.post('/sheet-rows/normalize',                    validate(normalizeRowsSchema), dispatchControlController.normalizeSheetRows);

export default router;
