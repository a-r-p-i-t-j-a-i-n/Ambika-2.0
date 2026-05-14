import Joi from 'joi';

export const createClientSchema = Joi.object({
  companyName: Joi.string().required(),
  code: Joi.string().required(),
  gstNo: Joi.string().allow('', null),
  contacts: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      phone: Joi.string().allow('', null),
      role: Joi.string().allow('', null),
      isPrimary: Joi.boolean().default(false)
    })
  ).optional(),
  emails: Joi.array().items(Joi.string().email()).optional(),
  addresses: Joi.array().items(
    Joi.object({
      label: Joi.string().default('Billing'),
      line1: Joi.string().required(),
      line2: Joi.string().allow('', null),
      city: Joi.string().required(),
      state: Joi.string().required(),
      pin: Joi.string().required(),
      country: Joi.string().default('India')
    })
  ).optional(),
  paymentTerms: Joi.string().allow('', null),
  creditPeriodDays: Joi.number().min(0).default(30),
  logisticsPreferences: Joi.string().allow('', null)
}).unknown(true);

export const updateClientSchema = createClientSchema.fork(
  ['companyName', 'code'], 
  (schema) => schema.optional()
);
