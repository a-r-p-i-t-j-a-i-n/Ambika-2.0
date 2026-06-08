import { Router } from 'express';
import { orderController } from './order.controller.js';
import validate from '../../middleware/validate.js';
import { protect } from '../../middleware/auth.middleware.js';
import { attachUserPermissions, requirePermission } from '../../middleware/permission.middleware.js';
import { createOrderSchema, updateOrderSchema, orderQuerySchema, mongoIdParamSchema, partyIdParamSchema } from './order.validation.js';

const router = Router();

router.route('/')
  .get(validate(orderQuerySchema, 'query'), orderController.getAll)
  .post(validate(createOrderSchema), orderController.create);

router.get('/stats', orderController.getStats);
router.get('/by-party/:partyId', validate(partyIdParamSchema, 'params'), validate(orderQuerySchema, 'query'), orderController.getByParty);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), orderController.getById)
  .put(validate(mongoIdParamSchema, 'params'), validate(updateOrderSchema), orderController.update)
  // Delete is restricted: only users with `orders.delete` (MD/root) may remove an order.
  .delete(protect, attachUserPermissions, requirePermission('orders.delete'),
    validate(mongoIdParamSchema, 'params'), orderController.remove);

router.patch('/:id/workflow/:step', validate(mongoIdParamSchema, 'params'), orderController.updateWorkflowStep);

export default router;
