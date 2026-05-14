import express from 'express';
import * as skuController from './sku.controller.js';
import validate from '../../middleware/validate.js';
import { bulkUpsertSkuSchema, createSkuSchema, updateSkuSchema } from './sku.validation.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { auditMiddleware } from '../../middlewares/audit.middleware.js';

const router = express.Router();

router.use(auditMiddleware('SKU', 'skus'));

router.post('/', validate(createSkuSchema), asyncHandler(skuController.createSku));
router.get('/', asyncHandler(skuController.getSkus));
router.get('/lookup/list', asyncHandler(skuController.getSkuLookup));
router.post('/bulk-upsert', validate(bulkUpsertSkuSchema), asyncHandler(skuController.bulkUpsertSkus));
router.get('/:id', asyncHandler(skuController.getSkuById));
router.put('/:id', validate(updateSkuSchema), asyncHandler(skuController.updateSku));
router.patch('/:id', validate(updateSkuSchema), asyncHandler(skuController.updateSku));

export default router;
