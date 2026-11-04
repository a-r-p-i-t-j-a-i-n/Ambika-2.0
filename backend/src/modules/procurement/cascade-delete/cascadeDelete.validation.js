import Joi from 'joi';
import { STEP_ORDER } from './cascadeDelete.graph.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);
const ROOT_TYPES = STEP_ORDER.filter((t) => t !== 'SERVICE_COMPLETION');

export const cascadeParamsSchema = Joi.object({
  type: Joi.string().valid(...ROOT_TYPES).required(),
  id:   objectId.required(),
});

/** The confirmation: the reason, the ticked acknowledgement and the plan the user saw. */
export const cascadeExecuteSchema = Joi.object({
  reason:       Joi.string().trim().max(500).allow('', null).default(''),
  acknowledged: Joi.boolean().valid(true).required()
    .messages({ 'any.only': 'Tick "I have read and understood…" to confirm', 'any.required': 'Tick "I have read and understood…" to confirm' }),
  planToken:    Joi.string().trim().max(100).required(),
});

export const cascadeHistoryQuerySchema = Joi.object({
  recordId: objectId,
  limit:    Joi.number().integer().min(1).max(100).default(20),
});
