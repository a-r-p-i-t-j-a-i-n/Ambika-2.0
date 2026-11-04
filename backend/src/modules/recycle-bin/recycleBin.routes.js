import { Router } from 'express';
import validate from '../../middleware/validate.js';
import { protect } from '../../middleware/auth.middleware.js';
import { attachUserPermissions } from '../../middleware/permission.middleware.js';
import { recycleBinController } from './recycleBin.controller.js';
import { listQuerySchema, idsSchema, settingsSchema } from './recycleBin.validation.js';

// Recycle Bin (shown on the Suite's Recycle Bin page). Each action checks its
// own switch — see binAccessOf.
const router = Router();

router.use(protect, attachUserPermissions);

router.get('/', validate(listQuerySchema, 'query'), recycleBinController.list);
router.get('/summary', recycleBinController.summary);
router.post('/restore', validate(idsSchema), recycleBinController.restore);
router.post('/purge', validate(idsSchema), recycleBinController.purge);
router.put('/settings', validate(settingsSchema), recycleBinController.setSettings);

export default router;
