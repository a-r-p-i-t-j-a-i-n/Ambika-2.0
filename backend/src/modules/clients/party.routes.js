import { Router } from 'express';
import { partyController } from './party.controller.js';
import validate from '../../middleware/validate.js';
import { protect } from '../../middleware/auth.middleware.js';
import { attachUserPermissions, requirePermission, unlessSessionDenies } from '../../middleware/permission.middleware.js';
import {
  createPartySchema, updatePartySchema, partyQuerySchema, mongoIdParamSchema,
  addOrderedSkusSchema, orderedSkuParamSchema,
} from './party.validation.js';

const router = Router();

// Signed-in users only. Editing is open to them unless the Delegation Suite
// switched it off for this person; deleting needs masters.deleteParty (MD, or
// Delete switched on for them in the Suite's lock icon).
router.use(protect);

router.route('/')
  .get(validate(partyQuerySchema, 'query'), partyController.getAll)
  .post(validate(createPartySchema), partyController.create);

router.route('/:id')
  .get(validate(mongoIdParamSchema, 'params'), partyController.getById)
  .put(validate(mongoIdParamSchema, 'params'), unlessSessionDenies('masters.editParty'), validate(updatePartySchema), partyController.update)
  .delete(validate(mongoIdParamSchema, 'params'), attachUserPermissions, requirePermission('masters.deleteParty'), partyController.remove);

// Party → Ordered SKUs: add from the SKU master / remove one — same right as
// editing the party.
router.post('/:id/ordered-skus',
  validate(mongoIdParamSchema, 'params'), unlessSessionDenies('masters.editParty'),
  validate(addOrderedSkusSchema), partyController.addOrderedSkus);
router.delete('/:id/ordered-skus/:itemId',
  validate(orderedSkuParamSchema, 'params'), unlessSessionDenies('masters.editParty'),
  partyController.removeOrderedSku);

export default router;
