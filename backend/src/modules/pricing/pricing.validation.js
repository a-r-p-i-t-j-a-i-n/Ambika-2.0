import Joi from 'joi';

const priceType = Joi.string().valid('SELLING', 'RM_COST');

export const submitRevisionSchema = Joi.object({
  skuId:               Joi.string().hex().length(24).required(),
  priceType:           priceType.default('SELLING'),
  newPrice:            Joi.number().min(0).required(),
  effectiveFrom:       Joi.date().required(),
  reason:              Joi.string().allow('').max(500),
  remarks:             Joi.string().allow('').max(2000),
  attachmentUrl:       Joi.string().allow('').max(1000),
  attachmentName:      Joi.string().allow('').max(300),
  acceptMarginBreach:  Joi.boolean().default(false),
});

export const correctRevisionSchema = Joi.object({
  correctedPrice:      Joi.number().min(0).required(),
  note:                Joi.string().allow('').max(1000),
  attachmentUrl:       Joi.string().allow('').max(1000),
  attachmentName:      Joi.string().allow('').max(300),
});

export const rejectRevisionSchema = Joi.object({
  reason: Joi.string().min(2).max(500).required(),
});

export const masterQuerySchema = Joi.object({
  priceType:     priceType.default('SELLING'),
  search:        Joi.string().allow('').max(120).default(''),
  status:        Joi.string().valid('', 'changed', 'stable', 'stale', 'unpriced', 'pending').default(''),
  // Phase-1 filters
  effectiveFrom: Joi.date().allow('', null),
  effectiveTo:   Joi.date().allow('', null),
  revisedBy:     Joi.string().allow('').max(160).default(''),
});

export const updateSkuRemarksSchema = Joi.object({
  remarks: Joi.string().allow('').max(500).required(),
});

export const exportQuerySchema = Joi.object({
  priceType: priceType.default('SELLING'),
});

export const documentsQuerySchema = Joi.object({
  category:  Joi.string().valid('', 'CUSTOMER', 'SUPPLIER_RM', 'APPROVED').default(''),
  priceType: Joi.string().valid('', 'SELLING', 'RM_COST').default(''),
  search:    Joi.string().allow('').max(160).default(''),
  from:      Joi.date().allow('', null),
  to:        Joi.date().allow('', null),
  uploader:  Joi.string().allow('').max(120).default(''),
});

export const analyticsQuerySchema = Joi.object({
  priceType: priceType.default('SELLING'),
  months:    Joi.number().integer().min(3).max(24).default(12),
});

export const historyQuerySchema = Joi.object({
  priceType: priceType.default('SELLING'),
});

export const priceAsOfQuerySchema = Joi.object({
  date:      Joi.date(),
  priceType: priceType.default('SELLING'),
});

export const calculatorPreviewSchema = Joi.object({
  asOfDate:  Joi.date(),
  priceType: priceType.default('SELLING'),
  lines: Joi.array().items(Joi.object({
    skuId:       Joi.string().hex().length(24).required(),
    qty:         Joi.number().min(0).required(),
    manualPrice: Joi.number().min(0).allow(null, ''),
  })).max(500).required(),
});

export const settingsPatchSchema = Joi.object({
  approvalThresholdPercent: Joi.number().min(0).max(100),
  futureDateApprovalDays:   Joi.number().min(0),
  defaultGstRate:           Joi.number().min(0).max(28),
  marginFloorDefault:       Joi.number().min(0),
  quoteValidityDays:        Joi.number().min(1).max(180),
  quoteSeriesPrefix:        Joi.string().max(8),
  companyName:              Joi.string().max(160),
  companyAddress:           Joi.string().allow('').max(500),
  companyGstin:             Joi.string().allow('').max(40),
  companyPhone:             Joi.string().allow('').max(40),
  companyEmail:             Joi.string().email().allow(''),
  quoteTerms:               Joi.string().allow('').max(2000),
}).min(1);
