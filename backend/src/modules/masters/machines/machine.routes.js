/**
 * Machine master routes — /api/v1/machines
 *
 *   GET    /                       list (search / filter / sort / paginate)
 *   POST   /                       create
 *   GET    /lookup/list            lightweight dropdown source
 *   GET    /:id                    detail, with assigned operators
 *   PUT    /:id   PATCH /:id       update
 *   DELETE /:id                    soft delete (permission-gated)
 *   GET    /:id/operators          assigned operators
 *   POST   /:id/operators          assign one operator
 *   DELETE /:id/operators/:operatorId   unassign one operator
 *
 * Auth follows the strictest existing master (SKUs): the whole router is behind
 * `protect`, and destructive deletion additionally needs masters.deleteMachine.
 */
import { Router } from 'express';
import { machineController } from './machine.controller.js';
import validate from '../../../middleware/validate.js';
import { protect } from '../../../middleware/auth.middleware.js';
import { attachUserPermissions, requirePermission, unlessSessionDenies } from '../../../middleware/permission.middleware.js';
import { auditMiddleware } from '../../../middlewares/audit.middleware.js';
import {
  createMachineSchema,
  updateMachineSchema,
  machineQuerySchema,
  machineLookupQuerySchema,
  assignOperatorSchema,
  mongoIdParamSchema,
  machineOperatorParamSchema,
} from './machine.validation.js';

const router = Router();

// Editing a machine (its details and its operators) is open to signed-in users
// unless the Delegation Suite switched it off for this person (lock icon).
const editMachine = unlessSessionDenies('masters.editMachine');

router.use(protect);
router.use(auditMiddleware('Machine', 'masters'));

// Static path before /:id so "lookup" is never read as an id.
router.get('/lookup/list', validate(machineLookupQuerySchema, 'query'), machineController.lookup);

router.route('/')
  .get(validate(machineQuerySchema, 'query'), machineController.getAll)
  .post(validate(createMachineSchema), machineController.create);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), machineController.getById)
  .put(validate(mongoIdParamSchema, 'params'), editMachine, validate(updateMachineSchema), machineController.update)
  .patch(validate(mongoIdParamSchema, 'params'), editMachine, validate(updateMachineSchema), machineController.update)
  .delete(
    validate(mongoIdParamSchema, 'params'),
    attachUserPermissions,
    requirePermission('masters.deleteMachine'),
    machineController.remove,
  );

router.route('/:id/operators')
  .get(validate(mongoIdParamSchema, 'params'), machineController.getOperators)
  .post(validate(mongoIdParamSchema, 'params'), editMachine, validate(assignOperatorSchema), machineController.assignOperator);

router.delete(
  '/:id/operators/:operatorId',
  validate(machineOperatorParamSchema, 'params'),
  editMachine,
  machineController.unassignOperator,
);

export default router;
