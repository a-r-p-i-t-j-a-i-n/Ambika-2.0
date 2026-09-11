/**
 * Production-plan routes — party-wise plans that do NOT require an order.
 *
 *   GET    /api/v1/production-plans?from=&to=&partyId=&search=  calendar + list feed
 *   GET    /api/v1/production-plans/party-summary?from=&to=     director's party-wise roll-up
 *   POST   /api/v1/production-plans                             create from the plan dialog
 *   PATCH  /api/v1/production-plans/:id                         edit / cancel
 *   DELETE /api/v1/production-plans/:id                         soft-cancel
 */

import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import { productionPlanController as c } from './productionPlanEntry.controller.js';

const router = Router();
router.use(protect);

router.get('/', c.list);
router.get('/party-summary', c.partySummary);
router.post('/', c.create);
router.patch('/:id', c.update);
router.delete('/:id', c.remove);

export default router;
