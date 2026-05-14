import { Router } from 'express';
import { partyController } from './party.controller.js';
import validate from '../../middleware/validate.js';
import { createPartySchema, updatePartySchema, partyQuerySchema, mongoIdParamSchema } from './party.validation.js';

const router = Router();

router.route('/')
  .get(validate(partyQuerySchema, 'query'), partyController.getAll)
  .post(validate(createPartySchema), partyController.create);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), partyController.getById)
  .put(validate(mongoIdParamSchema, 'params'), validate(updatePartySchema), partyController.update)
  .delete(validate(mongoIdParamSchema, 'params'), partyController.remove);

export default router;
