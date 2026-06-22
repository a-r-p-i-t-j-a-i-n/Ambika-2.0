import { Router } from 'express';
import { vendorController } from './vendor.controller.js';
import validate from '../../middleware/validate.js';
import { createVendorSchema, updateVendorSchema, vendorQuerySchema, mongoIdParamSchema } from './vendor.validation.js';

const router = Router();

router.route('/')
  .get(validate(vendorQuerySchema, 'query'), vendorController.getAll)
  .post(validate(createVendorSchema), vendorController.create);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), vendorController.getById)
  .put(validate(mongoIdParamSchema, 'params'), validate(updateVendorSchema), vendorController.update)
  .delete(validate(mongoIdParamSchema, 'params'), vendorController.remove);

export default router;
