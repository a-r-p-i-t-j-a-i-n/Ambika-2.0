import { Router } from 'express';
import { transporterController } from './transporter.controller.js';
import validate from '../../middleware/validate.js';
import { protect } from '../../middleware/auth.middleware.js';
import { attachUserPermissions, requirePermission, unlessSessionDenies } from '../../middleware/permission.middleware.js';
import { createTransporterSchema, updateTransporterSchema, transporterQuerySchema, mongoIdParamSchema } from './transporter.validation.js';

const router = Router();

// Signed-in users only. Editing is open to them unless the Delegation Suite
// switched it off for this person; deleting needs masters.deleteTransporter
// (MD, or Delete switched on for them in the Suite's lock icon).
router.use(protect);

router.route('/')
  .get(validate(transporterQuerySchema, 'query'), transporterController.getAll)
  .post(validate(createTransporterSchema), transporterController.create);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), transporterController.getById)
  .put(validate(mongoIdParamSchema, 'params'), unlessSessionDenies('masters.editTransporter'), validate(updateTransporterSchema), transporterController.update)
  .delete(validate(mongoIdParamSchema, 'params'), attachUserPermissions, requirePermission('masters.deleteTransporter'), transporterController.remove);

export default router;
