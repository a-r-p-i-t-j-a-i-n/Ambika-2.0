import { Router } from 'express';
import { skuController } from './sku.controller.js';
import validate from '../../middleware/validate.js';
import { createSkuSchema, updateSkuSchema, skuQuerySchema, mongoIdParamSchema } from './sku.validation.js';

const router = Router();

router.route('/')
  .get(validate(skuQuerySchema, 'query'), skuController.getAll)
  .post(validate(createSkuSchema), skuController.create);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), skuController.getById)
  .put(validate(mongoIdParamSchema, 'params'), validate(updateSkuSchema), skuController.update)
  .delete(validate(mongoIdParamSchema, 'params'), skuController.remove);

export default router;
