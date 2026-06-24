import Joi from 'joi';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

export const overviewQuerySchema = Joi.object({
  search:   Joi.string().max(120).allow('', null),
  category: Joi.string().max(120).allow('', null),
  itemType: Joi.string().valid('CONSUMABLE', 'PACKING', 'PACKAGING'),
  status:   Joi.string().valid('OK', 'LOW', 'REORDER', 'OUT_OF_STOCK', 'OVERSTOCK'),
  limit:    Joi.number().integer().min(1).max(5000),
}).unknown(true);

export const forecastQuerySchema = Joi.object({
  days: Joi.number().integer().min(7).max(120),
}).unknown(true);

export const skuParamSchema = Joi.object({
  skuId: objectId.required(),
});

export const policySchema = Joi.object({
  averageDailyConsumption: Joi.number().min(0),
  leadDays:        Joi.number().min(0),
  safetyFactor:    Joi.number().min(0),
  moq:             Joi.number().min(0),
  maxLevel:        Joi.number().min(0),
  materialInTransit: Joi.number().min(0),
  openingStock:    Joi.number().min(0),
  convertedItemName: Joi.string().trim().max(200).allow('', null),
  remarks:         Joi.string().trim().max(1000).allow('', null),
}).min(1);

const lineItem = Joi.object({
  skuId:    objectId.required(),
  skuCode:  Joi.string().trim().max(60).allow('', null),
  quantity: Joi.number().greater(0).required(),
  unitCost: Joi.number().min(0),
  batchNo:  Joi.string().trim().max(60).allow('', null),
  remarks:  Joi.string().trim().max(500).allow('', null),
});

export const receiveSchema = Joi.object({
  date:      Joi.date(),
  reason:    Joi.string().valid('VENDOR', 'OPENING', 'CORRECTION').default('VENDOR'),
  reference: Joi.string().trim().max(120).allow('', null),
  warehouse: Joi.string().trim().max(40).allow('', null),
  items:     Joi.array().items(lineItem).min(1).required(),
});

export const issueSchema = Joi.object({
  date:        Joi.date(),
  purpose:     Joi.string().trim().max(200).allow('', null),
  issuedTo:    Joi.string().trim().max(120).allow('', null),
  department:  Joi.string().trim().max(120).allow('', null),
  reference:   Joi.string().trim().max(120).allow('', null),
  warehouse:   Joi.string().trim().max(40).allow('', null),
  allowNegative: Joi.boolean().default(false),
  items:       Joi.array().items(lineItem).min(1).required(),
});
