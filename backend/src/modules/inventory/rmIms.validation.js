import Joi from 'joi';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

export const rmOverviewQuerySchema = Joi.object({
  search:   Joi.string().max(120).allow('', null),
  category: Joi.string().max(120).allow('', null),
  itemType: Joi.string().valid('RAW_MATERIAL', 'CIRCLE'),
  kind:     Joi.string().valid('COIL', 'CIRCLE'),
  status:   Joi.string().valid('OK', 'LOW', 'REORDER', 'OUT_OF_STOCK', 'OVERSTOCK'),
  limit:    Joi.number().integer().min(1).max(8000),
}).unknown(true);

export const rmForecastQuerySchema = Joi.object({
  days: Joi.number().integer().min(7).max(120),
}).unknown(true);

export const rmSkuParamSchema = Joi.object({ skuId: objectId.required() });

export const rmPolicySchema = Joi.object({
  adcLow:    Joi.number().min(0),
  adcNormal: Joi.number().min(0),
  adcPeak:   Joi.number().min(0),
  consumptionMode: Joi.string().valid('LOW', 'NORMAL', 'PEAK'),
  averageDailyConsumption: Joi.number().min(0),
  leadDays:        Joi.number().min(0),
  safetyFactor:    Joi.number().min(0),
  moq:             Joi.number().min(0),
  maxLevel:        Joi.number().min(0),
  materialInTransit: Joi.number().min(0),
  bookedQty:       Joi.number().min(0),
  openingStock:    Joi.number().min(0),
  vendorName:      Joi.string().trim().max(200).allow('', null),
  rate:            Joi.number().min(0),
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

export const rmReceiveSchema = Joi.object({
  date:      Joi.date(),
  reason:    Joi.string().valid('VENDOR', 'OPENING', 'CORRECTION').default('VENDOR'),
  reference: Joi.string().trim().max(120).allow('', null),
  warehouse: Joi.string().trim().max(40).allow('', null),
  items:     Joi.array().items(lineItem).min(1).required(),
});

export const rmIssueSchema = Joi.object({
  date:        Joi.date(),
  purpose:     Joi.string().trim().max(200).allow('', null),
  issuedTo:    Joi.string().trim().max(120).allow('', null),
  department:  Joi.string().trim().max(120).allow('', null),
  reference:   Joi.string().trim().max(120).allow('', null),
  warehouse:   Joi.string().trim().max(40).allow('', null),
  allowNegative: Joi.boolean().default(false),
  items:       Joi.array().items(lineItem).min(1).required(),
});

export const rmConvertSchema = Joi.object({
  conversionDate: Joi.date(),
  batchNo:    Joi.string().trim().max(60).allow('', null),
  coilSkuId:  objectId.required(),
  coilWeightKg: Joi.number().greater(0).required(),
  rate:       Joi.number().min(0),
  warehouse:  Joi.string().trim().max(40).allow('', null),
  allowNegative: Joi.boolean().default(false),
  scrapVerified: Joi.string().valid('PENDING', 'JOB_WORK', 'DONE'),
  remarks:    Joi.string().trim().max(1000).allow('', null),
  circles: Joi.array().items(Joi.object({
    circleSkuId: objectId.required(),
    sizeLabel:   Joi.string().trim().max(120).allow('', null),
    pcs:         Joi.number().min(0),
    weightKg:    Joi.number().greater(0).required(),
  })).min(1).required(),
});

export const rmMovementQuerySchema = Joi.object({
  search:  Joi.string().max(120).allow('', null),
  txnType: Joi.string().max(40).allow('', null),
  page:    Joi.number().integer().min(1),
  limit:   Joi.number().integer().min(1).max(200),
}).unknown(true);

export const rmConversionsQuerySchema = Joi.object({
  search: Joi.string().max(120).allow('', null),
  limit:  Joi.number().integer().min(1).max(500),
}).unknown(true);
