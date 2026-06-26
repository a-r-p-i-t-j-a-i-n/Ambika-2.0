import { Router } from 'express';
import { vendorController } from './vendor.controller.js';
import validate from '../../middleware/validate.js';
import { createVendorSchema, updateVendorSchema, vendorQuerySchema, mongoIdParamSchema, addPricingHistorySchema } from './vendor.validation.js';

const router = Router();

router.route('/')
  .get(validate(vendorQuerySchema, 'query'), vendorController.getAll)
  .post(validate(createVendorSchema), vendorController.create);

// Vendor pricing history (audit of every SKU rate / GST change).
router.route('/:id/pricing-history')
  .get(validate(mongoIdParamSchema, 'params'), vendorController.getPricingHistory)
  .post(validate(mongoIdParamSchema, 'params'), validate(addPricingHistorySchema), vendorController.addPricingHistory);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), vendorController.getById)
  .put(validate(mongoIdParamSchema, 'params'), validate(updateVendorSchema), vendorController.update)
  .delete(validate(mongoIdParamSchema, 'params'), vendorController.remove);

export default router;
