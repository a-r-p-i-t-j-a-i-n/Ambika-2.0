import express from 'express';
import * as skuController from './sku.controller.js';
import validate from '../../middleware/validate.js';
import { bulkUpsertSkuSchema, createSkuSchema, updateSkuSchema } from './sku.validation.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { auditMiddleware } from '../../middlewares/audit.middleware.js';
import { protect } from '../../middleware/auth.middleware.js';
import { attachUserPermissions, requirePermission } from '../../middleware/permission.middleware.js';

const router = express.Router();

// The whole SKU master needs a logged-in user — the convention the Machine and
// Machine Operator masters already state they copied from SKUs ("the whole
// router is behind protect"), which this router did not actually do: reads AND
// writes were open. Its only caller is the logged-in app, which always sends
// the token. A SKU's itemType also decides where purchased stock is posted
// (inventoryDestinationOf), so the master must never be writable anonymously.
router.use(protect);
router.use(auditMiddleware('SKU', 'skus'));

// Creating a SKU stays open to every logged-in user — the indent form registers
// new purchase items on the fly — but CHANGING an existing SKU's Item Type, or
// bulk-rewriting the master, needs `masters.editSku` (the type check is in the
// service, which knows the stored value).
router.post('/', validate(createSkuSchema), asyncHandler(skuController.createSku));
router.get('/', asyncHandler(skuController.getSkus));
router.get('/lookup/list', asyncHandler(skuController.getSkuLookup));
router.post(
  '/bulk-upsert',
  attachUserPermissions,
  requirePermission('masters.editSku'),
  validate(bulkUpsertSkuSchema),
  asyncHandler(skuController.bulkUpsertSkus),
);
router.get('/:id', asyncHandler(skuController.getSkuById));
router.put('/:id', attachUserPermissions, validate(updateSkuSchema), asyncHandler(skuController.updateSku));
router.patch('/:id', attachUserPermissions, validate(updateSkuSchema), asyncHandler(skuController.updateSku));

// Delete is gated by the v2 access-control system. MD has `*` (root) and
// bypasses this check; other roles need `masters.deleteSku` granted explicitly.
router.delete(
  '/:id',
  attachUserPermissions,
  requirePermission('masters.deleteSku'),
  asyncHandler(skuController.deleteSku),
);

export default router;
