import express from 'express';
import * as clientController from './client.controller.js';
import validate from '../../middleware/validate.js';
import { createClientSchema, updateClientSchema } from './client.validation.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { auditMiddleware } from '../../middlewares/audit.middleware.js';

const router = express.Router();

// Audit Middleware is applied to automatically log mutations
router.use(auditMiddleware('Client', 'clients'));

router.post('/', validate(createClientSchema), asyncHandler(clientController.createClient));
router.get('/', asyncHandler(clientController.getClients));
router.get('/:id', asyncHandler(clientController.getClientById));
router.put('/:id', validate(updateClientSchema), asyncHandler(clientController.updateClient));

export default router;
