import { Router } from 'express';
import { orderController } from './order.controller.js';
import validate from '../../middleware/validate.js';
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
  .delete(validate(mongoIdParamSchema, 'params'), orderController.remove);

router.patch('/:id/workflow/:step', validate(mongoIdParamSchema, 'params'), orderController.updateWorkflowStep);

export default router;
