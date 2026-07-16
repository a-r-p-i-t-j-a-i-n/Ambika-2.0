/**
 * DPR / OEE routes — the shop-floor Daily Production Report and the dashboards
 * derived from it. Base path: /api/v1/dpr
 *
 *   Entry        POST/PATCH/DELETE/GET  /entries[/:id]
 *   Register     GET   /entries
 *   Dashboards   GET   /dashboard/{machine|production|operator|mis}
 *   Form options GET   /options, /operations, /dies
 *   Masters      GET/POST/PATCH/DELETE  /masters/:kind[/:id]
 */
import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import validate from '../../middleware/validate.js';
import { dprController as c } from './dpr.controller.js';
import {
  dprCreateSchema, dprUpdateSchema, dprListQuerySchema, dprIdParamSchema,
  masterKindParamSchema, masterKindIdParamSchema, masterListQuerySchema,
} from './dpr.validation.js';

const router = Router();
router.use(protect);

// Form dropdown data (must precede /entries/:id style params — different path).
router.get('/options', c.formOptions);
router.get('/operations', c.operations);
router.get('/dies', c.dies);

// Dashboards
router.get('/dashboard/machine', c.machineDashboard);
router.get('/dashboard/production', c.productionDashboard);
router.get('/dashboard/operator', c.operatorDashboard);
router.get('/dashboard/mis', c.misScoring);

// Masters management
router.get('/masters/stats', c.masterStats);
router.get('/masters/:kind', validate(masterKindParamSchema, 'params'), validate(masterListQuerySchema, 'query'), c.listMaster);
router.post('/masters/:kind', validate(masterKindParamSchema, 'params'), c.createMaster);
router.patch('/masters/:kind/:id', validate(masterKindIdParamSchema, 'params'), c.updateMaster);
router.delete('/masters/:kind/:id', validate(masterKindIdParamSchema, 'params'), c.deleteMaster);

// DPR entries
router.get('/entries', validate(dprListQuerySchema, 'query'), c.list);
router.post('/entries', validate(dprCreateSchema), c.create);
router.get('/entries/:id', validate(dprIdParamSchema, 'params'), c.getById);
router.patch('/entries/:id', validate(dprIdParamSchema, 'params'), validate(dprUpdateSchema), c.update);
router.delete('/entries/:id', validate(dprIdParamSchema, 'params'), c.remove);

export default router;
