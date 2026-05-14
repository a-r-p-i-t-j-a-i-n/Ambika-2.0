import Joi from 'joi';

export const createSkuSchema = Joi.object({
  clientId: Joi.string().allow('', null),
  name: Joi.string().required(),
  code: Joi.string().required(),
  category: Joi.string().allow('', null),
  aliases: Joi.array().items(Joi.string().trim()).default([]),
  unit: Joi.string().default('PCS'),
  pcsPerBox: Joi.number().min(1).default(1),
  weightPerBox: Joi.number().min(0).default(0),
  weightPerPc: Joi.number().min(0).default(0),
  leadDays: Joi.number().min(0).default(7),
  sellingPrice: Joi.number().min(0).default(0),
  dimensions: Joi.object({
    length: Joi.number(),
    width: Joi.number(),
    height: Joi.number(),
    unit: Joi.string().default('CM')
  }).optional(),
  packingDetails: Joi.string().allow('', null)
}).unknown(true);

export const updateSkuSchema = createSkuSchema.fork(
  ['name', 'code'],
  (schema) => schema.optional()
);

export const bulkUpsertSkuSchema = Joi.object({
  items: Joi.array().items(createSkuSchema).min(1).required(),
});
