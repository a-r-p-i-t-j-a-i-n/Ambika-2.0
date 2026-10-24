import Joi from 'joi';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).messages({ 'string.pattern.base': 'Not a valid item id' });

/** Finding items to correct: all of them, by code or name, by module, or exactly by id. */
export const stockCorrectionSkuQuerySchema = Joi.object({
  search: Joi.string().trim().max(120).allow('', null),
  module: Joi.string().trim().uppercase().valid('RM', 'CP', 'FG', 'SCRAP').allow('', null),
  skuIds: Joi.string().trim().max(2600).allow('', null),
  limit:  Joi.number().integer().min(1).max(5000),
}).unknown(true);

/**
 * One stock correction. Each line is one item at one location: the figure the
 * form showed (`systemQty`, checked against the stock when saving) and the
 * physical count. The reason is optional; who and when are recorded by the
 * server, never sent.
 *
 * `kind` SCRAP is a coil SKU's scrap at a cutting location (PLG01 / JW001), in
 * kg — Scrap master data's figure; STOCK (the default) is an item's stock.
 */
export const stockCorrectionSchema = Joi.object({
  clientRequestId: Joi.string().trim().max(80).allow('', null),
  reason: Joi.string().trim().max(300).allow('', null),
  lines: Joi.array().items(Joi.object({
    kind: Joi.string().trim().uppercase().valid('STOCK', 'SCRAP').default('STOCK'),
    skuId: objectId.required(),
    warehouse: Joi.string().trim().uppercase().max(40).required(),
    systemQty: Joi.number().required(),
    physicalQty: Joi.number().min(0).required().messages({
      'number.min': 'A physical count cannot be below zero.',
      'any.required': 'Enter the physical count for every item.',
    }),
  })).min(1).max(200).required().messages({ 'array.min': 'Add at least one item to correct.' }),
});
