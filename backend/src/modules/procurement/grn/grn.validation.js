import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { GRN_STATUS, HOW_ITEM_RECEIVED } from './grn.model.js';
import { RM_RECEIVED_AT_LOCATIONS } from '../../inventory/inventoryStock.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

/**
 * "Received At" — where the Raw Material on this GRN physically landed.
 *
 * The same two-value list and the same vocabulary the RM Stock In screen
 * validates against, imported rather than restated, so the two modules cannot
 * drift. It is NOT the GRN's own `warehouse` (MAIN) and NOT `receivedAt` (the
 * completion timestamp) — three different fields that read alike.
 *
 * Only the VALUE is checked here. Whether it is required depends on the item
 * types of the received lines, which only the SKU master knows, so the service
 * enforces "required whenever a Raw Material line is received" — explicitly,
 * with no default location standing in.
 *
 * The retired fields (`inventoryType`, `addToRmStock`) are no longer named by
 * any schema: validate.js runs with stripUnknown, so an older client that still
 * sends them is accepted and the fields are dropped — the destination is
 * derived from the SKU master and never taken from the request.
 */
const rmReceivedAtField = Joi.string().trim().uppercase().valid(...RM_RECEIVED_AT_LOCATIONS).allow(null, '')
  .messages({ 'any.only': `Received At must be one of: ${RM_RECEIVED_AT_LOCATIONS.join(', ')}` });

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
  // Material Receipt Type of this line. Left out (an older client), the
  // service gives the line the request's header howItemReceived instead.
  howItemReceived: Joi.string().valid(...Object.values(HOW_ITEM_RECEIVED)).allow('', null)
    .messages({ 'any.only': `Material Receipt Type must be one of: ${Object.values(HOW_ITEM_RECEIVED).join(', ')}` }),
});

export const createGrnSchema = Joi.object({
  // A GRN raised with no PO behind it at all — vendor + items are entered by
  // hand instead of sourced from a PO. See grn.model.js's isWithoutPo.
  isWithoutPo:     Joi.boolean().default(false),
  // One PO (legacy) OR many POs (multi-PO GRN, same vendor — enforced in the
  // service, which needs DB-loaded vendor data). At least one is required
  // unless isWithoutPo. Mirrors createInvoiceSchema's qcId/qcIds precedent.
  poId: Joi.when('isWithoutPo', {
    is: true,
    then: objectId.allow('', null).optional(),
    otherwise: objectId.optional(),
  }),
  poIds: Joi.when('isWithoutPo', {
    is: true,
    then: Joi.array().items(objectId).optional(),
    otherwise: Joi.array().items(objectId).min(1).optional(),
  }),
  // Vendor snapshot — sourced from the PO on a normal GRN; entered by hand (and
  // required) when there is no PO to source it from.
  vendorId: Joi.when('isWithoutPo', {
    is: true,
    then: objectId.required().messages({ 'any.required': 'Select a vendor for this GRN' }),
    otherwise: objectId.allow('', null).optional(),
  }),
  vendorName: Joi.when('isWithoutPo', {
    is: true,
    then: Joi.string().trim().min(1).max(300).required().messages({ 'any.required': 'Vendor name is required' }),
    otherwise: Joi.string().trim().max(300).allow('', null),
  }),
  vendorGST:       Joi.string().trim().max(60).allow('', null),
  vendorAddress:   Joi.string().trim().max(500).allow('', null),
  vendorPhone:     Joi.string().trim().max(30).allow('', null),
  grnDate:         Joi.date().optional(),
  challanNumber:   Joi.string().trim().max(120).allow('', null),
  invoiceNumber:   Joi.string().trim().max(120).allow('', null),
  invoiceDate:     Joi.date().allow('', null),
  vehicleNumber:   Joi.string().trim().max(60).allow('', null),
  receivedBy:      Joi.string().trim().max(120).allow('', null),
  preparedBy:      Joi.string().trim().max(120).allow('', null),
  warehouse:       Joi.string().trim().max(40).allow('', null),
  // Required (by the service) whenever a Raw Material line is received.
  rmReceivedAtLocation: rmReceivedAtField,
  // Header Material Receipt Type — only the fallback for a line that names
  // none (an older client); each line carries its own items[].howItemReceived.
  howItemReceived: Joi.string().valid(...Object.values(HOW_ITEM_RECEIVED)).default(HOW_ITEM_RECEIVED.FULL_MATERIAL_RECEIVED),
  challanDocument: grnDocumentSchema.default(null),
  invoiceDocument: grnDocumentSchema.default(null),
  remarks:         Joi.string().trim().max(1000).allow('', null),
  // Auto-loaded from the PO when omitted on a normal GRN; a W/O PO GRN has no PO
  // to load from, so its items must be entered explicitly.
  items: Joi.when('isWithoutPo', {
    is: true,
    then: Joi.array().items(grnItemSchema).min(1).required().messages({ 'array.min': 'Add at least one item to receive' }),
    otherwise: Joi.array().items(grnItemSchema).min(1).optional(),
  }),
}).custom((value, helpers) => {
  if (!value.isWithoutPo && !value.poId && !(value.poIds && value.poIds.length)) {
    return helpers.message('Select at least one Purchase Order');
  }
  return value;
}, 'at least one PO unless W/O PO');

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
  // Editable only on a W/O PO draft (the service ignores these on a PO-backed
  // GRN, whose vendor snapshot always comes from the PO).
  vendorId:        objectId.allow('', null),
  vendorName:      Joi.string().trim().max(300).allow('', null),
  vendorGST:       Joi.string().trim().max(60).allow('', null),
  vendorAddress:   Joi.string().trim().max(500).allow('', null),
  vendorPhone:     Joi.string().trim().max(30).allow('', null),
  grnDate:         Joi.date(),
  challanNumber:   Joi.string().trim().max(120).allow('', null),
  invoiceNumber:   Joi.string().trim().max(120).allow('', null),
  invoiceDate:     Joi.date().allow('', null),
  vehicleNumber:   Joi.string().trim().max(60).allow('', null),
  receivedBy:      Joi.string().trim().max(120).allow('', null),
  preparedBy:      Joi.string().trim().max(120).allow('', null),
  howItemReceived: Joi.string().valid(...Object.values(HOW_ITEM_RECEIVED)),
  // No default: a PATCH that does not mention it leaves the saved value alone.
  rmReceivedAtLocation: rmReceivedAtField,
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

  // "Received At" for the RM lines, confirmed at completion. Not defaulted: the
  // service falls back to the GRN's saved value and, when there is none and a
  // Raw Material line is received, refuses — no location is ever assumed.
  rmReceivedAtLocation: rmReceivedAtField,
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
  isWithoutPo:  Joi.boolean(),
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
