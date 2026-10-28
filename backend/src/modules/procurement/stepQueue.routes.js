/**
 * Purchase FMS "Awaiting this step" queues (read-only) — see stepQueue.js.
 * Base path: /api/v1/procurement/step-queues
 */
import { Router } from 'express';
import Joi from 'joi';
import { protect } from '../../middleware/auth.middleware.js';
import validate from '../../middleware/validate.js';
import asyncHandler from '../../middleware/asyncHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { PAGINATION } from '../../config/constants.js';
import { stepQueueService } from './stepQueue.js';
import { QUEUE_KEYS, QUEUE_STATES } from './stepQueue.rules.js';

const queueParamSchema = Joi.object({
  queue: Joi.string().valid(...QUEUE_KEYS).required(),
});

const queueQuerySchema = Joi.object({
  page:   Joi.number().integer().min(1),
  limit:  Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  search: Joi.string().max(120).allow(''),
  vendor: Joi.string().max(200).allow(''),
  state:  Joi.string().valid(...QUEUE_STATES).allow(''),
  from:   Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(''),
  to:     Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(''),
});

const router = Router();
router.use(protect);

router.get('/:queue', validate(queueParamSchema, 'params'), validate(queueQuerySchema, 'query'), asyncHandler(async (req, res) => {
  const { docs, pagination, ...meta } = await stepQueueService.list(req.params.queue, req.query);
  res.json(ApiResponse.ok(meta.label, { rows: docs, ...meta }, pagination));
}));

export default router;
