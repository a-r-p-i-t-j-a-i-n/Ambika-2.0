/**
 * PO Rate Change Approvals (Purchase FMS).
 * Base path: /api/v1/procurement/rate-changes
 *
 * Reading is open to signed-in users (as every Purchase FMS list is), so a doer
 * can follow their request. Approving / rejecting needs
 * procurement.approveRateChange OR procurement.approve, or being a designated
 * approver (the MD, or the purchase approver found by e-mail —
 * approvers/purchaseApprovers.js); requests are raised only by saving a PO,
 * never through this API. Either designated approver may decide alone: the first
 * decision wins atomically and the other gets a 409 naming who decided.
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import { attachUserPermissions } from '../../../middleware/permission.middleware.js';
import { requirePermissionOrDesignated } from '../approvers/purchaseApprovers.js';
import validate from '../../../middleware/validate.js';
import { rateChangeController as c } from './rateChange.controller.js';
import { RATE_APPROVER_PERMISSIONS } from './rateChange.service.js';
import {
  mongoIdParamSchema, listRateChangesSchema, rateHistorySchema, vendorRateQuerySchema,
  approveRateChangeSchema, rejectRateChangeSchema, listPoApprovalsSchema,
} from './rateChange.validation.js';

const router = Router();
router.use(protect, attachUserPermissions);

router.get('/', validate(listRateChangesSchema, 'query'), c.list);
router.get('/history', validate(rateHistorySchema, 'query'), c.history);
// New-vendor POs awaiting / past the MD's or purchase approver's decision (read-only here;
// the decision itself is the PO's own approve / reject — purchase-orders/:id/approve).
router.get('/po-approvals', validate(listPoApprovalsSchema, 'query'), c.poApprovals);
router.get('/po-approvals/:id', validate(mongoIdParamSchema, 'params'), c.poApproval);
// The authoritative vendor rate a PO line fetches (vendor + SKU + unit).
router.get('/vendor-rate', validate(vendorRateQuerySchema, 'query'), c.vendorRate);
router.get('/:id', validate(mongoIdParamSchema, 'params'), c.getById);

router.post('/:id/approve',
  requirePermissionOrDesignated(...RATE_APPROVER_PERMISSIONS),
  validate(mongoIdParamSchema, 'params'),
  validate(approveRateChangeSchema),
  c.approve);
router.post('/:id/reject',
  requirePermissionOrDesignated(...RATE_APPROVER_PERMISSIONS),
  validate(mongoIdParamSchema, 'params'),
  validate(rejectRateChangeSchema),
  c.reject);

export default router;
