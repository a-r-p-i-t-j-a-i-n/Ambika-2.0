import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import {
  attachUserPermissions,
  requirePermission,
} from '../../middleware/permission.middleware.js';
import validate from '../../middleware/validate.js';
import { pricingController as c } from './pricing.controller.js';
import {
  submitRevisionSchema,
  correctRevisionSchema,
  rejectRevisionSchema,
  masterQuerySchema,
  historyQuerySchema,
  priceAsOfQuerySchema,
  settingsPatchSchema,
  calculatorPreviewSchema,
  updateSkuRemarksSchema,
  exportQuerySchema,
  documentsQuerySchema,
  analyticsQuerySchema,
} from './pricing.validation.js';

const router = Router();
router.use(protect, attachUserPermissions);

// Master & history (view permission)
router.get('/master',
  requirePermission('pricing.view'),
  validate(masterQuerySchema, 'query'), c.master);

router.get('/skus/:id/history',
  requirePermission('pricing.view'),
  validate(historyQuerySchema, 'query'), c.history);

router.get('/skus/:id/price-as-of',
  requirePermission('pricing.view'),
  validate(priceAsOfQuerySchema, 'query'), c.priceAsOf);

// Phase-1: sticky remarks on the master row (requires the same perm as a revise,
// but doesn't go through approval — it's a metadata field, not a price change).
router.patch('/skus/:id/remarks',
  requirePermission('pricing.revise'),
  validate(updateSkuRemarksSchema), c.updateRemarks);

// Phase-1: distinct reviewer names (for the "Revised by" filter dropdown).
router.get('/reviewers',
  requirePermission('pricing.view'),
  c.reviewers);

// Phase-1: export bundle (3 sheets in one round trip).
router.get('/export',
  requirePermission('pricing.view'),
  validate(exportQuerySchema, 'query'), c.exportData);

// Phase-2: document tracker (auto-categorised proofs / attachments)
router.get('/documents',
  requirePermission('pricing.view'),
  validate(documentsQuerySchema, 'query'), c.documents);

// Phase-3: trend analytics (KPIs, monthly timeline, top movers, heatmap)
router.get('/analytics',
  requirePermission('pricing.view'),
  validate(analyticsQuerySchema, 'query'), c.analytics);

// Submission (revise permission)
router.post('/revisions',
  requirePermission('pricing.revise'),
  validate(submitRevisionSchema), c.submit);

// Corrections (delete permission to be safe — same risk surface)
router.post('/revisions/:id/correct',
  requirePermission('pricing.delete', 'pricing.approve'),
  validate(correctRevisionSchema), c.correct);

// Approval inbox + actions
router.get('/revisions',
  requirePermission('pricing.approve', 'pricing.view'),
  c.pending);

router.post('/revisions/:id/approve',
  requirePermission('pricing.approve'),
  c.approve);

router.post('/revisions/:id/reject',
  requirePermission('pricing.approve'),
  validate(rejectRevisionSchema), c.reject);

// Calculator
router.post('/calculator/preview',
  requirePermission('pricing.view'),
  validate(calculatorPreviewSchema), c.preview);

// Settings
router.get('/settings',
  requirePermission('settings.view', 'pricing.view'),
  c.getSettings);

router.patch('/settings',
  requirePermission('settings.edit'),
  validate(settingsPatchSchema), c.updateSettings);

export default router;
