import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

export const listQuerySchema = Joi.object({
  status:    Joi.string().valid('pending', 'restoring', 'restored').default('pending'),
  q:         Joi.string().trim().max(200).allow(''),
  module:    Joi.string().trim().max(300).allow(''),
  type:      Joi.string().trim().max(600).allow(''),
  deletedBy: Joi.string().trim().max(2600).allow(''),
  from:      Joi.date().iso(),
  to:        Joi.date().iso(),
  cursor:    Joi.string().trim().max(60).allow(''),
  limit:     Joi.number().integer().min(1).max(100).default(50),
});

export const idsSchema = Joi.object({
  ids: Joi.array().items(objectId.required()).min(1).max(100).unique().required(),
});

export const settingsSchema = Joi.object({
  retentionDays: Joi.number().integer().min(1).max(365).required(),
});
