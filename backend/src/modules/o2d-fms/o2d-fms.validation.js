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
  assignees: Joi.array().items(objectId).default([]),
  buddies:   Joi.array().items(objectId).default([]),
  userId:    objectId.allow(null), // legacy single (mapped to assignees)
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
  triggerKey:  Joi.string().valid('MANUAL', 'ORDER_INTAKE', 'ORDER_ENTRY', 'DISPATCH_PLAN', 'ACTUAL_DISPATCH', 'INVOICE', 'POD', 'PAYMENT').default('MANUAL'),
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
  // Requirement types beyond the checklist.
  verifications: Joi.array().items(Joi.object({ question: Joi.string().trim().required() })).default([]),
  formFields: Joi.array().items(Joi.object({
    label:     Joi.string().trim().required(),
    fieldType: Joi.string().valid('TEXT', 'NUMBER', 'DATE').default('TEXT'),
    required:  Joi.boolean().default(true),
  })).default([]),
  proof: Joi.object({
    required: Joi.boolean().default(false),
    minCount: Joi.number().integer().min(1).default(1),
  }).allow(null),
  approval: Joi.object({
    required:    Joi.boolean().default(false),
    approverIds: Joi.array().items(objectId).default([]),
  }).allow(null),
  actionLink: Joi.string().trim().allow('', null),
  leadTime:     leadTimeJoi.default({ unit: 'HOURS' }),
  assigneeRole:   Joi.string().trim().allow('', null),
  assigneeUserIds: Joi.array().items(objectId).default([]),
  buddyUserIds:    Joi.array().items(objectId).default([]),
  assigneeUserId: objectId.allow(null), // legacy single
  buddyUserId:    objectId.allow(null), // legacy single
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

export const verificationAnswerSchema = Joi.object({
  answer: Joi.string().valid('YES', 'NO').allow(null).required(),
  remark: Joi.string().trim().max(1000).allow('', null),
});
export const formFieldValueSchema = Joi.object({
  value: Joi.alternatives().try(Joi.string().max(2000), Joi.number(), Joi.date()).allow('', null),
});

export const attachmentsSchema = Joi.object({
  attachments: Joi.array().items(Joi.object({
    fileName: Joi.string().required(),
    fileUrl:  Joi.string().required(),
    fileKey:  Joi.string().allow('', null),
    fileType: Joi.string().allow('', null),
    sizeBytes: Joi.number().min(0).default(0),
    kind: Joi.string().valid('file', 'audio', 'video', 'image'),
  })).min(1).required(),
});

export const attachmentParamSchema = Joi.object({
  id: objectId.required(),
  stepCode: Joi.string().trim().required(),
  attachmentId: objectId.required(),
});

export const planOrderSchema = Joi.object({
  steps: Joi.array().items(Joi.object({
    stepCode:     Joi.string().trim().required(),
    taskTitle:    Joi.string().allow('', null),
    instructions: Joi.string().allow('', null),
    assignees:    Joi.array().items(objectId),
    buddies:      Joi.array().items(objectId),
    assignedTo:   objectId.allow(null), // legacy single
    buddyUserId:  objectId.allow(null), // legacy single
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
