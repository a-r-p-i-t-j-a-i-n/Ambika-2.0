import express from 'express';
import * as poController from './purchase-order.controller.js';
import validate from '../../middleware/validate.js';
import { createPoSchema } from './purchase-order.validation.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { auditMiddleware } from '../../middlewares/audit.middleware.js';

const router = express.Router();

router.use(auditMiddleware('PurchaseOrder', 'purchase-orders'));

router.post('/', validate(createPoSchema), asyncHandler(poController.createPurchaseOrder));
router.get('/', asyncHandler(poController.getPurchaseOrders));
router.get('/:id', asyncHandler(poController.getPurchaseOrderById));

// Custom route to generate SO from PO
router.post('/:id/generate-so', asyncHandler(poController.generateSalesOrder));

export default router;
