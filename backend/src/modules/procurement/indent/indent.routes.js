/**
 * Purchase Indent routes (Purchase FMS).
 * Base path: /api/v1/procurement/indents
 */
import { Router } from 'express';
import { protect } from '../../../middleware/auth.middleware.js';
import { requirePermission } from '../../../middleware/permission.middleware.js';
import validate from '../../../middleware/validate.js';
import { indentController as c } from './indent.controller.js';
import {
  createIndentSchema,
  updateIndentSchema,
  approveIndentSchema,
  rejectIndentSchema,
  bulkApproveSchema,
  bulkRejectSchema,
  receiveQuoteSchema,
  quoteComparativeSchema,
  approveQuotationSchema,
  indentQuerySchema,
  mongoIdParamSchema,
} from './indent.validation.js';

const router = Router();
router.use(protect);

router.route('/')
  .get(validate(indentQuerySchema, 'query'), c.getAll)
  .post(validate(createIndentSchema), c.create);

router.get('/stats', c.getStats);

// Bulk actions — declared before '/:id' routes so they aren't shadowed.
router.post('/bulk-approve', validate(bulkApproveSchema), c.bulkApprove);
router.post('/bulk-reject',  validate(bulkRejectSchema),  c.bulkReject);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), c.getById)
  .patch(validate(mongoIdParamSchema, 'params'), validate(updateIndentSchema), c.update)
  .delete(requirePermission('procurement.deleteIndent'), validate(mongoIdParamSchema, 'params'), c.remove);

router.post('/:id/submit',             validate(mongoIdParamSchema, 'params'), c.submit);
router.post('/:id/approve',            validate(mongoIdParamSchema, 'params'), validate(approveIndentSchema), c.approve);
router.post('/:id/reject',             validate(mongoIdParamSchema, 'params'), validate(rejectIndentSchema), c.reject);
router.post('/:id/receive-quote',      validate(mongoIdParamSchema, 'params'), validate(receiveQuoteSchema), c.receiveQuote);
router.post('/:id/quote-comparative',  validate(mongoIdParamSchema, 'params'), validate(quoteComparativeSchema), c.quoteComparative);
router.post('/:id/approve-quotation',  validate(mongoIdParamSchema, 'params'), validate(approveQuotationSchema), c.approveQuotation);

export default router;
