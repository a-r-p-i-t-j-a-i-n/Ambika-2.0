import Joi from 'joi';
import { ymdDate, clientRequestIdField } from './ims.validation.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

export const fgOverviewQuerySchema = Joi.object({
  search:   Joi.string().max(120).allow('', null),
  category: Joi.string().max(120).allow('', null),
  status:   Joi.string().valid('OK', 'LOW', 'REORDER', 'OUT_OF_STOCK', 'OVERSTOCK'),
  limit:    Joi.number().integer().min(1).max(8000),
}).unknown(true);

export const fgForecastQuerySchema = Joi.object({
  days: Joi.number().integer().min(7).max(120),
}).unknown(true);

// Kept as plain YYYY-MM-DD strings (no Joi date coercion) so the service can
// bucket them on the IST calendar itself. The calendar check is shared with the
// Consumables IMS — the shape alone let "2026-13-45" through to a 500.
export const fgHistoryQuerySchema = Joi.object({
  from:      ymdDate,
  to:        ymdDate,
  warehouse: Joi.string().trim().max(40).allow('', null),
}).unknown(true);

export const fgSkuParamSchema = Joi.object({ skuId: objectId.required() });

export const fgPolicySchema = Joi.object({
  adcLow:    Joi.number().min(0),
  adcNormal: Joi.number().min(0),
  adcPeak:   Joi.number().min(0),
  consumptionMode: Joi.string().valid('LOW', 'NORMAL', 'PEAK'),
  averageDailyConsumption: Joi.number().min(0),
  leadDays:        Joi.number().min(0),
  // Deliberately NOT bounded to the 1.0–5.0 / 0.1-step range the Consumables IMS
  // enforces: finished-goods planning needs a wider range for seasonal cover, and
  // ims.validation.js records that RM/FG write this shared collection with their
  // own wider ranges. Left as-is on purpose — only "0 or more" is enforced.
  safetyFactor:    Joi.number().min(0).messages({
    'number.base': 'safetyFactor must be a number.',
    'number.min':  'safetyFactor must be 0 or greater.',
  }),
  moq:             Joi.number().min(0),
  maxLevel:        Joi.number().min(0),
  // AUTO   → Max Level follows Average Daily Demand × Lead Time × Safety Factor.
  // MANUAL → the stored maxLevel is a deliberate override and the formula is ignored.
  maxLevelMode:    Joi.string().valid('AUTO', 'MANUAL'),
  materialInTransit: Joi.number().min(0),  // in-production (WIP)
  bookedQty:       Joi.number().min(0),    // committed to orders
  openingStock:    Joi.number().min(0),
  rate:            Joi.number().min(0),
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

export const fgProduceSchema = Joi.object({
  date:       Joi.date(),
  clientRequestId: clientRequestIdField,
  reason:     Joi.string().valid('PRODUCTION', 'OPENING', 'SALES_RETURN', 'CORRECTION').default('PRODUCTION'),
  reference:  Joi.string().trim().max(120).allow('', null),
  shift:      Joi.string().trim().max(60).allow('', null),
  line:       Joi.string().trim().max(60).allow('', null),
  supervisor: Joi.string().trim().max(120).allow('', null),
  warehouse:  Joi.string().trim().max(40).allow('', null),
  items:      Joi.array().items(lineItem).min(1).required(),
});

export const fgDispatchSchema = Joi.object({
  date:        Joi.date(),
  clientRequestId: clientRequestIdField,
  customer:    Joi.string().trim().max(160).allow('', null),
  orderNo:     Joi.string().trim().max(120).allow('', null),
  vehicleNo:   Joi.string().trim().max(60).allow('', null),
  reference:   Joi.string().trim().max(120).allow('', null),
  warehouse:   Joi.string().trim().max(40).allow('', null),
  allowNegative: Joi.boolean().default(false),
  items:       Joi.array().items(lineItem).min(1).required(),
});

export const fgMovementQuerySchema = Joi.object({
  search:       Joi.string().max(120).allow('', null),
  txnType:      Joi.string().max(40).allow('', null),
  movementType: Joi.string().valid('IN', 'OUT'),
  skuId:        objectId,
  sort:         Joi.string().max(60).allow('', null),
  page:         Joi.number().integer().min(1),
  limit:        Joi.number().integer().min(1).max(500),
}).unknown(true);
