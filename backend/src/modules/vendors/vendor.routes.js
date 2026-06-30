import { Router } from 'express';
import { vendorController } from './vendor.controller.js';
import validate from '../../middleware/validate.js';
import { protect } from '../../middleware/auth.middleware.js';
import { createVendorSchema, updateVendorSchema, vendorQuerySchema, mongoIdParamSchema, addPricingHistorySchema, addVendorProductSchema } from './vendor.validation.js';

const router = Router();

// All vendor routes require an authenticated user — this also stamps req.user so
// pricing-history writes capture who changed a rate (Updated By).
router.use(protect);

router.route('/')
  .get(validate(vendorQuerySchema, 'query'), vendorController.getAll)
  .post(validate(createVendorSchema), vendorController.create);

// Add / upsert a product on the vendor catalog (New PO "Add Vendor for this Item").
router.post('/:id/products', validate(mongoIdParamSchema, 'params'), validate(addVendorProductSchema), vendorController.addProduct);

// Vendor pricing history (audit of every SKU rate / GST change).
router.route('/:id/pricing-history')
  .get(validate(mongoIdParamSchema, 'params'), vendorController.getPricingHistory)
  .post(validate(mongoIdParamSchema, 'params'), validate(addPricingHistorySchema), vendorController.addPricingHistory);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), vendorController.getById)
  .put(validate(mongoIdParamSchema, 'params'), validate(updateVendorSchema), vendorController.update)
  .delete(validate(mongoIdParamSchema, 'params'), vendorController.remove);

export default router;
