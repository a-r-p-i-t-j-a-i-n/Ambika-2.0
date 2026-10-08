import Joi from 'joi';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);
// Step keys: Purchase uses UPPER_SNAKE (GRN, PO_APPROVAL); O2D uses dotted codes (2.01).
const key = Joi.string().trim().max(60).regex(/^[A-Za-z0-9_.]+$/);

export const fmsParamSchema = Joi.object({ fmsKey: key.required() });
export const stepParamSchema = Joi.object({ fmsKey: key.required(), stepKey: key.required() });
export const mongoIdParamSchema = Joi.object({ id: objectId.required() });

export const setAssignmentSchema = Joi.object({
  doerUserId: objectId.allow(null).required(), // null = leave the step unassigned
  reason: Joi.string().trim().max(500).allow('', null),
  acknowledgeMissingPermission: Joi.boolean().default(false),
});

export const reassignTaskSchema = Joi.object({
  doerUserId: objectId.required(),
  reason: Joi.string().trim().max(500).allow('', null),
});

export const applyConfigSchema = Joi.object({
  reason: Joi.string().trim().max(500).allow('', null),
});

export const taskQuerySchema = Joi.object({
  fmsKey: key, stepKey: key,
  status: Joi.string().valid('OPEN', 'DONE', 'CLOSED', 'ALL'),
  doerId: Joi.alternatives().try(objectId, Joi.string().valid('none')),
  search: Joi.string().trim().max(100).allow(''),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(500),
});

export const entityQuerySchema = Joi.object({
  entityType: Joi.string().trim().max(40).required(),
  entityId: objectId.required(),
});
