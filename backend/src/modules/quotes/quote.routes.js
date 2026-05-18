import { Router } from 'express';
import { protect } from '../../middleware/auth.middleware.js';
import { attachUserPermissions, requirePermission } from '../../middleware/permission.middleware.js';
import validate from '../../middleware/validate.js';
import { quoteController as c } from './quote.controller.js';
import {
  createQuoteSchema, updateQuoteSchema, rejectQuoteSchema, listQuoteQuerySchema,
} from './quote.validation.js';
import { renderQuotePdf } from './quote.pdf.js';

const router = Router();
router.use(protect, attachUserPermissions);

router.get('/', requirePermission('quotes.view'), validate(listQuoteQuerySchema, 'query'), c.list);
router.get('/:id', requirePermission('quotes.view'), c.get);
router.get('/:id/pdf', requirePermission('quotes.exportPdf', 'quotes.view'), renderQuotePdf);

router.post('/', requirePermission('quotes.create'), validate(createQuoteSchema), c.create);
router.patch('/:id', requirePermission('quotes.edit', 'quotes.create'), validate(updateQuoteSchema), c.update);
router.post('/:id/send', requirePermission('quotes.send', 'quotes.create'), c.send);
router.post('/:id/accept', requirePermission('quotes.edit', 'quotes.create'), c.accept);
router.post('/:id/reject', requirePermission('quotes.edit', 'quotes.create'), validate(rejectQuoteSchema), c.reject);
router.delete('/:id', requirePermission('quotes.delete'), c.delete);

export default router;
