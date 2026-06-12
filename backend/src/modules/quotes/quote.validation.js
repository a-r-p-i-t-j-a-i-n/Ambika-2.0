import Joi from 'joi';

const lineSchema = Joi.object({
  skuId:       Joi.string().hex().length(24).required(),
  qty:         Joi.number().min(0).required(),
  manualPrice: Joi.number().min(0).allow(null, ''),
});

export const createQuoteSchema = Joi.object({
  asOfDate:    Joi.date(),
  validUntil:  Joi.date(),
  priceType:   Joi.string().valid('SELLING', 'RM_COST').default('SELLING'),
  partyId:     Joi.string().hex().length(24).allow(null),
  partyName:   Joi.string().allow('').max(200),
  poReference: Joi.string().allow('').max(120),
  lines:       Joi.array().items(lineSchema).min(1).required(),
  notes:       Joi.string().allow('').max(2000),
  pdfIncludeGst: Joi.boolean().default(true),
  send:        Joi.boolean().default(false),
});

export const updateQuoteSchema = Joi.object({
  asOfDate:    Joi.date(),
  validUntil:  Joi.date(),
  priceType:   Joi.string().valid('SELLING', 'RM_COST'),
  partyId:     Joi.string().hex().length(24).allow(null),
  partyName:   Joi.string().allow('').max(200),
  poReference: Joi.string().allow('').max(120),
  lines:       Joi.array().items(lineSchema),
  notes:       Joi.string().allow('').max(2000),
  pdfIncludeGst: Joi.boolean(),
}).min(1);

export const rejectQuoteSchema = Joi.object({
  reason: Joi.string().allow('').max(500),
});

export const listQuoteQuerySchema = Joi.object({
  status:  Joi.string().valid('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED_TO_SO'),
  partyId: Joi.string().hex().length(24),
  from:    Joi.date(),
  to:      Joi.date(),
});
