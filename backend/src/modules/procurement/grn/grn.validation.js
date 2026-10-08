import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { GRN_STATUS, HOW_ITEM_RECEIVED } from './grn.model.js';
import { RM_RECEIVED_AT_LOCATIONS, DEFAULT_RM_RECEIVED_AT } from '../../inventory/inventoryStock.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

/**
 * "Received At" — where the Raw Material on this GRN physically landed.
 *
 * The same two-value list and the same vocabulary the RM Stock In screen
 * validates against, imported rather than restated, so the two modules cannot
 * drift. It is NOT the GRN's own `warehouse` (MAIN) and NOT `receivedAt` (the
 * completion timestamp) — three different fields that read alike.
 *
 * Written as an explicit `when` with both branches spelled out rather than a
 * base schema plus `.when().then()`: concatenating `allow(null)` with
 * `required()` leaves null acceptable, which would let an opted-in GRN save
 * with no location at all.
 */
const rmReceivedAtOnSave = Joi.any().when('addToRmStock', {
  is: true,
  then: Joi.string().trim().uppercase().valid(...RM_RECEIVED_AT_LOCATIONS).required()
    .messages({
      'any.required': 'Received At is required when "Add to RM Stock" is ticked.',
      'any.only': `Received At must be one of: ${RM_RECEIVED_AT_LOCATIONS.join(', ')}`,
    }),
  otherwise: Joi.string().trim().uppercase().valid(...RM_RECEIVED_AT_LOCATIONS).allow(null, '').optional()
    .messages({ 'any.only': `Received At must be one of: ${RM_RECEIVED_AT_LOCATIONS.join(', ')}` }),
});

const grnDocumentSchema = Joi.object({
  fileName:   Joi.string().trim().max(300).allow('', null),
  fileUrl:    Joi.string().trim().max(1000).allow('', null),
  fileType:   Joi.string().trim().max(120).allow('', null),
  uploadedAt: Joi.date().optional(),
});

const grnItemSchema = Joi.object({
  _id:         Joi.string().optional(),
  poItemId:    objectId.allow('', null),
  skuId:       objectId.allow('', null),
  skuCode:     Joi.string().trim().max(60).allow('', null),
  itemName:    Joi.string().trim().min(1).max(300).required(),
  unit:        Joi.string().trim().max(30).allow('', null).default('Pcs'),
  orderedQty:  Joi.number().min(0).default(0),
  previouslyReceivedQty: Joi.number().min(0).default(0),
  invoiceQty:  Joi.number().min(0).default(0),
  receivedQty: Joi.number().min(0).required(),
  rate:        Joi.number().min(0).default(0),
  batchNo:     Joi.string().trim().max(60).allow('', null),
  remarks:     Joi.string().trim().max(500).allow('', null),
});

export const createGrnSchema = Joi.object({
  poId:            objectId.required(),
  grnDate:         Joi.date().optional(),
  challanNumber:   Joi.string().trim().max(120).allow('', null),
  invoiceNumber:   Joi.string().trim().max(120).allow('', null),
  invoiceDate:     Joi.date().allow('', null),
  vehicleNumber:   Joi.string().trim().max(60).allow('', null),
  receivedBy:      Joi.string().trim().max(120).allow('', null),
  preparedBy:      Joi.string().trim().max(120).allow('', null),
  warehouse:       Joi.string().trim().max(40).allow('', null),
  // The operator's RM choice, captured when the GRN is raised. Both are
  // optional so a GRN that has nothing to do with Raw Material saves unchanged.
  addToRmStock:         Joi.boolean(),
  rmReceivedAtLocation: rmReceivedAtOnSave,
  howItemReceived: Joi.string().valid(...Object.values(HOW_ITEM_RECEIVED)).default(HOW_ITEM_RECEIVED.FULL_MATERIAL_RECEIVED),
  challanDocument: grnDocumentSchema.default(null),
  invoiceDocument: grnDocumentSchema.default(null),
  remarks:         Joi.string().trim().max(1000).allow('', null),
  items:           Joi.array().items(grnItemSchema).min(1).optional(),
});

// Preview-only: render the PDF from current form data without saving. Lenient by
// design (works for both new + edit forms); the service derives totals/vendor itself.
export const previewGrnPdfSchema = Joi.object({
  poId:            objectId.allow('', null),
  poNumber:        Joi.string().trim().max(60).allow('', null),
  grnNumber:       Joi.string().trim().max(60).allow('', null),
  grnDate:         Joi.date().optional(),
  challanNumber:   Joi.string().trim().max(120).allow('', null),
  invoiceNumber:   Joi.string().trim().max(120).allow('', null),
  invoiceDate:     Joi.date().allow('', null),
  vehicleNumber:   Joi.string().trim().max(60).allow('', null),
  receivedBy:      Joi.string().trim().max(120).allow('', null),
  preparedBy:      Joi.string().trim().max(120).allow('', null),
  warehouse:       Joi.string().trim().max(40).allow('', null),
  howItemReceived: Joi.string().valid(...Object.values(HOW_ITEM_RECEIVED)),
  remarks:         Joi.string().trim().max(1000).allow('', null),
  vendorName:      Joi.string().trim().max(300).allow('', null),
  vendorGST:       Joi.string().trim().max(60).allow('', null),
  vendorAddress:   Joi.string().trim().max(500).allow('', null),
  items:           Joi.array().items(grnItemSchema).min(1).required(),
}).unknown(true);

export const updateGrnSchema = Joi.object({
  grnDate:         Joi.date(),
  challanNumber:   Joi.string().trim().max(120).allow('', null),
  invoiceNumber:   Joi.string().trim().max(120).allow('', null),
  invoiceDate:     Joi.date().allow('', null),
  vehicleNumber:   Joi.string().trim().max(60).allow('', null),
  receivedBy:      Joi.string().trim().max(120).allow('', null),
  preparedBy:      Joi.string().trim().max(120).allow('', null),
  howItemReceived: Joi.string().valid(...Object.values(HOW_ITEM_RECEIVED)),
  // No default on either: a PATCH that does not mention them must leave the
  // saved choice alone rather than silently resetting it to "not opted in".
  addToRmStock:         Joi.boolean(),
  rmReceivedAtLocation: rmReceivedAtOnSave,
  challanDocument: grnDocumentSchema,
  invoiceDocument: grnDocumentSchema,
  remarks:         Joi.string().trim().max(1000).allow('', null),
  items:           Joi.array().items(grnItemSchema).min(1),
}).min(1);

// Extra-receipt remarks are enforced in the service (needs PO context).
//
// NOTE - validate.js runs every schema with `stripUnknown: true`, so a field the
// dialog sends but this schema does not name is dropped silently before the
// controller ever sees it. Both fields below are therefore declared HERE, not
// only on the model.
export const completeGrnSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),

  // Explicit consent to receive beyond the PO's current pending qty.
  allowOverReceipt: Joi.boolean().default(false),

  // Opt-in: Raw Material / Circle lines post to inventory only when this is
  // true.
  //
  // Deliberately NOT defaulted. Both fields can now be chosen when the GRN is
  // raised, so "the request did not mention it" and "the operator turned it
  // off" are different answers: a default here would overwrite the saved choice
  // with false for any caller that omits the field. The service resolves the
  // fallback against the stored GRN instead.
  addToRmStock: Joi.boolean(),

  // "Received At" for those RM lines — the same list the RM Stock In screen
  // validates against, imported rather than restated. Not defaulted, for the
  // same reason; the service falls back to the GRN's own value, then to
  // DEFAULT_RM_RECEIVED_AT.
  rmReceivedAtLocation: Joi.string().trim().uppercase()
    .valid(...RM_RECEIVED_AT_LOCATIONS)
    .allow(null, '')
    .messages({
      'any.only': `Received At must be one of: ${RM_RECEIVED_AT_LOCATIONS.join(', ')}`,
    }),
});

export const cancelGrnSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),
});

export const grnQuerySchema = Joi.object({
  page:         Joi.number().integer().min(1),
  limit:        Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:         Joi.string(),
  fields:       Joi.string(),
  search:       Joi.string().max(120),
  searchFields: Joi.string(),
  vendorId:     objectId,
  poId:         objectId,
  poNumber:     Joi.string().max(60),
  grnStatus:    Joi.string().valid(...Object.values(GRN_STATUS)),
  populate:     Joi.string(),
  grnDate:      Joi.object().unknown(true),
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

export const poIdParamSchema = Joi.object({
  poId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
