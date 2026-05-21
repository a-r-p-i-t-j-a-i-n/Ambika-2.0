/**
 * PPC routes — Production Planning & Control.
 *
 *   GET   /api/v1/ppc/board?year=&month=   the Production Board (+ KPIs + WIP)
 *   POST  /api/v1/ppc/generate             auto-create plans for SKUs with demand
 *   PATCH /api/v1/ppc/plan/:id             update demand inputs / daily targets
 *   POST  /api/v1/ppc/daily-entry          record daily produced quantities
 *   POST  /api/v1/ppc/wip/move             move a batch between shop-floor stages
 */

import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import { ppcController as c } from './ppc.controller.js';

const router = Router();
router.use(protect);

router.get('/board', c.board);
router.post('/generate', c.generate);
router.post('/daily-entry', c.dailyEntry);
router.post('/wip/move', c.wipMove);
router.patch('/plan/:id', c.updatePlan);

export default router;
