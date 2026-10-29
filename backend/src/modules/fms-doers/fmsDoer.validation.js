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

// One or more main doers (doerUserIds); doerUserId is the older single-doer form.
export const reassignTaskSchema = Joi.object({
  doerUserId: objectId,
  doerUserIds: Joi.array().items(objectId).min(1).max(20),
  reason: Joi.string().trim().max(500).allow('', null),
}).xor('doerUserId', 'doerUserIds');

const leadTime = Joi.object({
  value: Joi.number().positive().max(10000).required(),
  unit: Joi.string().valid('HOURS', 'DAYS').required(),
});

// O2D-style plan save: only the changed steps. leadTime omitted = unchanged,
// null = no lead time (no due date).
export const savePlanSchema = Joi.object({
  steps: Joi.array().items(Joi.object({
    stepKey: key.required(),
    leadTime: leadTime.allow(null),
    doerIds: Joi.array().items(objectId).max(20).default([]),
    buddyIds: Joi.array().items(objectId).max(20).default([]),
  })).min(1).max(100).required(),
  applyToOpenTasks: Joi.boolean().default(false),
  acknowledgeMissingPermission: Joi.boolean().default(false),
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
