/**
 * PO Rate Change Approvals (Purchase FMS).
 * Base path: /api/v1/procurement/rate-changes
 *
 * Reading is open to signed-in users (as every Purchase FMS list is), so a doer
 * can follow their request. Approving / rejecting needs
 * procurement.approveRateChange OR procurement.approve (the MD always may);
 * requests are raised only by saving a PO, never through this API.
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import { attachUserPermissions, requirePermission } from '../../../middleware/permission.middleware.js';
import validate from '../../../middleware/validate.js';
import { rateChangeController as c } from './rateChange.controller.js';
import { RATE_APPROVER_PERMISSIONS } from './rateChange.service.js';
import {
  mongoIdParamSchema, listRateChangesSchema, rateHistorySchema, vendorRateQuerySchema,
  approveRateChangeSchema, rejectRateChangeSchema,
} from './rateChange.validation.js';

const router = Router();
router.use(protect, attachUserPermissions);

router.get('/', validate(listRateChangesSchema, 'query'), c.list);
router.get('/history', validate(rateHistorySchema, 'query'), c.history);
// The authoritative vendor rate a PO line fetches (vendor + SKU + unit).
router.get('/vendor-rate', validate(vendorRateQuerySchema, 'query'), c.vendorRate);
router.get('/:id', validate(mongoIdParamSchema, 'params'), c.getById);

router.post('/:id/approve',
  requirePermission(...RATE_APPROVER_PERMISSIONS),
  validate(mongoIdParamSchema, 'params'),
  validate(approveRateChangeSchema),
  c.approve);
router.post('/:id/reject',
  requirePermission(...RATE_APPROVER_PERMISSIONS),
  validate(mongoIdParamSchema, 'params'),
  validate(rejectRateChangeSchema),
  c.reject);

export default router;
