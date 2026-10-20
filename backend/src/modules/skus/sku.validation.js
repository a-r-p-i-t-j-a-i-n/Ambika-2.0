import Joi from 'joi';
import { ITEM_TYPES } from './sku.model.js';

export const createSkuSchema = Joi.object({
  clientId: Joi.string().allow('', null),
  name: Joi.string().required(),
  code: Joi.string().required(),
  // Required on CREATE, and never defaulted. The Mongoose schema still defaults
  // to FINISHED_GOOD, which is a blocked destination: a SKU created without a
  // type used to become a finished good silently, and its first GRN line could
  // then not be routed at all. The type decides where purchased stock is
  // posted (inventoryDestinationOf), so it is always an explicit choice.
  // `updateSkuSchema` forks this back to optional — a PATCH that omits the
  // field must leave the stored classification alone, never reclassify it.
  itemType: Joi.string().valid(...ITEM_TYPES).required().messages({
    'any.required': 'Item Type is required — it decides which inventory the purchased stock is posted to (Raw Material / Circle → RM IMS; Consumable / Packing / Packaging → C&P IMS; Chemical, Ink, Spare Part and the rest → Main Store).',
    'any.only': 'Item Type {{#value}} is not a supported classification. Pick one of: ' + ITEM_TYPES.join(', ') + '.',
    'string.empty': 'Item Type is required — pick the classification that decides where this item\'s purchased stock is posted.',
  }),
  category: Joi.string().allow('', null),
  aliases: Joi.array().items(Joi.string().trim()).default([]),
  // "Converted Item Name (For Resale)" — optional, no default, so a PATCH that
  // omits it leaves the stored value alone rather than blanking it.
  convertedItemNameForResale: Joi.string().trim().max(200).allow('', null),
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
  ['name', 'code', 'itemType'],
  (schema) => schema.optional()
);

/**
 * One row of a bulk import. Item Type is OPTIONAL here, unlike on create: an
 * import that only refreshes prices or pack sizes of SKUs that already exist
 * must keep working, and an omitted field is not written, so it cannot
 * reclassify them either. A row that would INSERT a NEW SKU does need one —
 * enforced in the service, which is what knows whether the code exists.
 */
export const bulkUpsertSkuRowSchema = createSkuSchema.fork(
  ['itemType'],
  (schema) => schema.optional()
);

export const bulkUpsertSkuSchema = Joi.object({
  items: Joi.array().items(bulkUpsertSkuRowSchema).min(1).required(),
});
