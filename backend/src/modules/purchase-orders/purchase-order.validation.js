import Joi from 'joi';

const poLineSchema = Joi.object({
  skuId: Joi.string().required(),
  orderedQty: Joi.number().min(1).required(),
  expectedDispatchDate: Joi.date().optional(),
  priority: Joi.string().valid('LOW', 'NORMAL', 'HIGH', 'URGENT').default('NORMAL'),
  remarks: Joi.string().allow('', null)
});

export const createPoSchema = Joi.object({
  clientId: Joi.string().required(),
  poNumber: Joi.string().required(),
  poDate: Joi.date().required(),
  location: Joi.string().allow('', null),
  leadTimeDays: Joi.number().min(0).optional(),
  orderLines: Joi.array().items(poLineSchema).min(1).required()
}).unknown(true);

export const updatePoSchema = createPoSchema.fork(
  ['clientId', 'poNumber', 'poDate', 'orderLines'],
  (schema) => schema.optional()
);
