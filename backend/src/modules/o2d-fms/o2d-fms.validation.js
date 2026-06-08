import Joi from 'joi';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message('Invalid id');

export const mongoIdParamSchema = Joi.object({ id: objectId.required() });

export const processStepParamSchema = Joi.object({
  id: objectId.required(),
  stepCode: Joi.string().trim().required(),
});

const attachmentJoi = Joi.object({
  fileName: Joi.string().required(),
  fileUrl:  Joi.string().required(),
  fileType: Joi.string().allow('', null),
});

export const completeStepSchema = Joi.object({
  link:        Joi.string().uri().allow('', null),
  remarks:     Joi.string().max(1000).allow('', null),
  attachments: Joi.array().items(attachmentJoi).default([]),
});

export const assignStepSchema = Joi.object({
  userId: objectId.allow(null),
});

export const stepDefinitionSchema = Joi.object({
  stepCode:    Joi.string().trim().required(),
  name:        Joi.string().trim().required(),
  description: Joi.string().allow('', null),
  defaultOwnerUserId: objectId.allow(null),
  defaultOwnerRole:   Joi.string().trim().allow('', null),
  tool:        Joi.string().trim().allow('', null),
  slaMinutes:  Joi.number().integer().min(0).default(60),
  slaFrom:     Joi.string().valid('PREV_ACTUAL', 'ORDER_RECEIVED').default('PREV_ACTUAL'),
  sequence:    Joi.number().integer().min(1).required(),
  phase:       Joi.string().valid('PRE_PRODUCTION', 'PLANNING', 'EXECUTION', 'POST_DISPATCH').default('PRE_PRODUCTION'),
  triggerKey:  Joi.string().valid('MANUAL', 'ORDER_ENTRY', 'DISPATCH_PLAN', 'ACTUAL_DISPATCH', 'INVOICE', 'POD', 'PAYMENT').default('MANUAL'),
  requiresLink:       Joi.boolean().default(false),
  requiresAttachment: Joi.boolean().default(false),
  allowIncompleteChecklist: Joi.boolean().default(false),
  isActive:    Joi.boolean().default(true),
});

const leadTimeJoi = Joi.object({
  value: Joi.number().min(0).allow(null),
  unit:  Joi.string().valid('MINUTES', 'HOURS', 'DAYS', 'WEEKS', 'MONTHS').default('HOURS'),
});

const templateStepJoi = Joi.object({
  stepCode:     Joi.string().trim().required(),
  taskTitle:    Joi.string().allow('', null),
  instructions: Joi.string().allow('', null),
  checklist:    Joi.array().items(Joi.object({ text: Joi.string().trim().required() })).default([]),
  leadTime:     leadTimeJoi.default({ unit: 'HOURS' }),
  assigneeRole:   Joi.string().trim().allow('', null),
  assigneeUserId: objectId.allow(null),
  buddyUserId:    objectId.allow(null),
});

export const taskTemplateSchema = Joi.object({
  name:        Joi.string().trim().required(),
  description: Joi.string().allow('', null),
  isDefault:   Joi.boolean().default(false),
  isActive:    Joi.boolean().default(true),
  steps:       Joi.array().items(templateStepJoi).default([]),
});

export const taskTemplateUpdateSchema = taskTemplateSchema.fork(['name'], (s) => s.optional());

export const checklistToggleSchema = Joi.object({ done: Joi.boolean().required() });
export const commentSchema = Joi.object({ text: Joi.string().trim().min(1).max(2000).required() });

export const planOrderSchema = Joi.object({
  steps: Joi.array().items(Joi.object({
    stepCode:     Joi.string().trim().required(),
    taskTitle:    Joi.string().allow('', null),
    instructions: Joi.string().allow('', null),
    assignedTo:   objectId.allow(null),
    buddyUserId:  objectId.allow(null),
    leadTime:     leadTimeJoi,
    checklist:    Joi.array().items(Joi.object({ text: Joi.string().trim().required() })),
  })).min(1).required(),
});

export const checklistParamSchema = Joi.object({
  id: objectId.required(),
  stepCode: Joi.string().trim().required(),
  itemId: objectId.required(),
});

export const stepDefinitionUpdateSchema = stepDefinitionSchema.fork(
  ['stepCode', 'name', 'sequence'], (s) => s.optional(),
);

export const reorderSchema = Joi.object({
  order: Joi.array().items(Joi.object({
    id: objectId.required(),
    sequence: Joi.number().integer().min(1).required(),
  })).min(1).required(),
});

export const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(1000),
  sort: Joi.string(),
  search: Joi.string().allow('', null),
  isCompleted: Joi.boolean(),
  currentStepCode: Joi.string(),
}).unknown(true);
