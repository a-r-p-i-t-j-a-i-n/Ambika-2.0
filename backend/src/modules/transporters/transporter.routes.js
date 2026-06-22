import { Router } from 'express';
import { transporterController } from './transporter.controller.js';
import validate from '../../middleware/validate.js';
import { createTransporterSchema, updateTransporterSchema, transporterQuerySchema, mongoIdParamSchema } from './transporter.validation.js';

const router = Router();

router.route('/')
  .get(validate(transporterQuerySchema, 'query'), transporterController.getAll)
  .post(validate(createTransporterSchema), transporterController.create);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), transporterController.getById)
  .put(validate(mongoIdParamSchema, 'params'), validate(updateTransporterSchema), transporterController.update)
  .delete(validate(mongoIdParamSchema, 'params'), transporterController.remove);

export default router;
