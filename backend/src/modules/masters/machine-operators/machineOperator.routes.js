/**
 * Machine Operator master routes — /api/v1/machine-operators
 *
 *   GET    /                      list (search / filter / sort / paginate)
 *   POST   /                      create
 *   GET    /lookup/list           lightweight dropdown source
 *   GET    /:id                   detail, with assigned machines
 *   PUT    /:id   PATCH /:id      update
 *   DELETE /:id                   soft delete (permission-gated)
 *   GET    /:id/machines          assigned machines
 *   POST   /:id/machines          assign one machine
 *   DELETE /:id/machines/:machineId   unassign one machine
 */
import { Router } from 'express';
import { machineOperatorController } from './machineOperator.controller.js';
import validate from '../../../middleware/validate.js';
import { protect } from '../../../middleware/auth.middleware.js';
import { attachUserPermissions, requirePermission, unlessSessionDenies } from '../../../middleware/permission.middleware.js';
import { auditMiddleware } from '../../../middlewares/audit.middleware.js';
import {
  createMachineOperatorSchema,
  updateMachineOperatorSchema,
  machineOperatorQuerySchema,
  machineOperatorLookupQuerySchema,
  assignMachineSchema,
  mongoIdParamSchema,
  operatorMachineParamSchema,
} from './machineOperator.validation.js';

const router = Router();

// Editing an operator (details and assigned machines) is open to signed-in
// users unless the Delegation Suite switched it off for this person (lock icon).
const editOperator = unlessSessionDenies('masters.editOperator');

router.use(protect);
router.use(auditMiddleware('MachineOperator', 'masters'));

// Static path before /:id so "lookup" is never read as an id.
router.get('/lookup/list', validate(machineOperatorLookupQuerySchema, 'query'), machineOperatorController.lookup);

router.route('/')
  .get(validate(machineOperatorQuerySchema, 'query'), machineOperatorController.getAll)
  .post(validate(createMachineOperatorSchema), machineOperatorController.create);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), machineOperatorController.getById)
  .put(validate(mongoIdParamSchema, 'params'), editOperator, validate(updateMachineOperatorSchema), machineOperatorController.update)
  .patch(validate(mongoIdParamSchema, 'params'), editOperator, validate(updateMachineOperatorSchema), machineOperatorController.update)
  .delete(
    validate(mongoIdParamSchema, 'params'),
    attachUserPermissions,
    requirePermission('masters.deleteOperator'),
    machineOperatorController.remove,
  );

router.route('/:id/machines')
  .get(validate(mongoIdParamSchema, 'params'), machineOperatorController.getMachines)
  .post(validate(mongoIdParamSchema, 'params'), editOperator, validate(assignMachineSchema), machineOperatorController.assignMachine);

router.delete(
  '/:id/machines/:machineId',
  validate(operatorMachineParamSchema, 'params'),
  editOperator,
  machineOperatorController.unassignMachine,
);

export default router;
