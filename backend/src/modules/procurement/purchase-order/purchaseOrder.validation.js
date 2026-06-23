import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { PO_APPROVAL_STATUS, PO_STATUS } from './purchaseOrder.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const poItemSchema = Joi.object({
  _id:      Joi.string().optional(),
  // Per-line source indent (multi-indent PO). Optional for single-indent POs.
  indentId:     objectId.allow('', null),
  indentNumber: Joi.string().trim().max(60).allow('', null),
  // itemName optional — JSL items are described by grade/width/finish instead.
  itemName: Joi.string().trim().max(300).allow('', null),
  skuCode:  Joi.string().trim().max(60).allow('', null),
  skuId:    objectId.allow('', null),
  quantity: Joi.number().min(0.0001).required(),
  unit:     Joi.string().trim().max(30).allow('', null).default('Pcs'),
  rate:     Joi.number().min(0).default(0),
  gstRate:  Joi.number().min(0).max(100).default(0),
  // Client-side computed amounts are accepted but recomputed server-side.
  taxableAmount: Joi.number().min(0).optional(),
  taxAmount:     Joi.number().min(0).optional(),
  totalAmount:   Joi.number().min(0).optional(),
  // JSL-format fields (optional — ignored for OTHER).
  grade:           Joi.string().trim().max(120).allow('', null),
  width:           Joi.string().trim().max(60).allow('', null),
  finish:          Joi.string().trim().max(120).allow('', null),
  baseRate:        Joi.number().min(0).optional(),
  upfrontDiscount: Joi.number().min(0).optional(),
  bonanzaDiscount: Joi.number().min(0).optional(),
  finalPrice:      Joi.number().optional(),
  value:           Joi.number().optional(),
});

const poFormatType = Joi.string().valid('JSL', 'OTHER').default('OTHER');

// ── Create (saved as DRAFT; only from an approved-quotation indent) ──
export const createPoSchema = Joi.object({
  indentId:      objectId.required(),
  vendorId:      objectId.required(),
  poFormatType:  poFormatType,
  poDate:        Joi.date().optional(),
  vendorName:    Joi.string().trim().max(200).allow('', null),
  vendorGST:     Joi.string().trim().max(20).allow('', null),
  vendorPAN:     Joi.string().trim().max(20).allow('', null),
  vendorAddress: Joi.string().trim().max(500).allow('', null),
  vendorEmail:   Joi.string().email().trim().allow('', null),
  vendorPhone:   Joi.string().trim().max(20).allow('', null),
  deliveryTerms: Joi.string().trim().max(300).allow('', null),
  paymentTerms:  Joi.string().trim().max(300).allow('', null),
  leadTime:      Joi.string().trim().max(60).allow('', null),
  creditPeriod:  Joi.number().integer().min(0).max(365).default(0),
  remarks:       Joi.string().trim().max(1000).allow('', null),
  items:         Joi.array().items(poItemSchema).min(1).required(),
});

// ── Create multi-indent (one vendor, items from one or more approved indents) ──
export const createMultiPoSchema = Joi.object({
  indentIds:     Joi.array().items(objectId).min(1).required(),
  vendorId:      objectId.required(),
  poFormatType:  poFormatType,
  poDate:        Joi.date().optional(),
  vendorName:    Joi.string().trim().max(200).allow('', null),
  vendorGST:     Joi.string().trim().max(20).allow('', null),
  vendorPAN:     Joi.string().trim().max(20).allow('', null),
  vendorAddress: Joi.string().trim().max(500).allow('', null),
  vendorEmail:   Joi.string().email().trim().allow('', null),
  vendorPhone:   Joi.string().trim().max(20).allow('', null),
  deliveryTerms: Joi.string().trim().max(300).allow('', null),
  paymentTerms:  Joi.string().trim().max(300).allow('', null),
  leadTime:      Joi.string().trim().max(60).allow('', null),
  creditPeriod:  Joi.number().integer().min(0).max(365).default(0),
  remarks:       Joi.string().trim().max(1000).allow('', null),
  // Each item must carry its source indentId so the server can link it back.
  items:         Joi.array().items(poItemSchema.keys({ indentId: objectId.required() })).min(1).required(),
});

// ── Preview PDF (no save) — lenient: render whatever the draft form has so far ──
export const previewPoSchema = Joi.object({
  indentId:      objectId.allow('', null),
  indentIds:     Joi.array().items(objectId).optional(),
  vendorId:      objectId.allow('', null),
  poFormatType:  poFormatType,
  poNumber:      Joi.string().trim().max(60).allow('', null),
  poDate:        Joi.date().optional(),
  vendorName:    Joi.string().trim().max(200).allow('', null),
  vendorGST:     Joi.string().trim().max(20).allow('', null),
  vendorPAN:     Joi.string().trim().max(20).allow('', null),
  vendorAddress: Joi.string().trim().max(500).allow('', null),
  vendorEmail:   Joi.string().trim().allow('', null),
  vendorPhone:   Joi.string().trim().max(20).allow('', null),
  deliveryTerms: Joi.string().trim().max(300).allow('', null),
  paymentTerms:  Joi.string().trim().max(300).allow('', null),
  leadTime:      Joi.string().trim().max(60).allow('', null),
  creditPeriod:  Joi.number().integer().min(0).max(365).default(0),
  remarks:       Joi.string().trim().max(1000).allow('', null),
  items:         Joi.array().items(poItemSchema).min(1).required(),
}).unknown(true);

// ── Update (DRAFT only — service guards) ──
export const updatePoSchema = Joi.object({
  poFormatType:  Joi.string().valid('JSL', 'OTHER'),
  poDate:        Joi.date(),
  vendorId:      objectId,
  vendorName:    Joi.string().trim().max(200).allow('', null),
  vendorGST:     Joi.string().trim().max(20).allow('', null),
  vendorPAN:     Joi.string().trim().max(20).allow('', null),
  vendorAddress: Joi.string().trim().max(500).allow('', null),
  vendorEmail:   Joi.string().email().trim().allow('', null),
  vendorPhone:   Joi.string().trim().max(20).allow('', null),
  deliveryTerms: Joi.string().trim().max(300).allow('', null),
  paymentTerms:  Joi.string().trim().max(300).allow('', null),
  leadTime:      Joi.string().trim().max(60).allow('', null),
  creditPeriod:  Joi.number().integer().min(0).max(365),
  remarks:       Joi.string().trim().max(1000).allow('', null),
  items:         Joi.array().items(poItemSchema).min(1),
}).min(1);

// ── Approve / reject ──
export const approvePoSchema = Joi.object({
  decision: Joi.string().valid('APPROVED', 'REJECTED').default('APPROVED'),
  remarks:  Joi.string().trim().max(1000).allow('', null),
});

// ── Release ──
export const releasePoSchema = Joi.object({
  sendEmail:               Joi.boolean().default(false),
  supplierAcknowledgement: Joi.string().trim().max(500).allow('', null),
  remarks:                 Joi.string().trim().max(1000).allow('', null),
});

// ── Cancel ──
export const cancelPoSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),
});

// ── Mark PI Not Required (reason mandatory, remarks optional) ──
export const piNotRequiredSchema = Joi.object({
  reason:  Joi.string().trim().min(1).max(500).required(),
  remarks: Joi.string().trim().max(1000).allow('', null),
});

// ── List query ──
export const poQuerySchema = Joi.object({
  page:           Joi.number().integer().min(1),
  limit:          Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:           Joi.string(),
  fields:         Joi.string(),
  search:         Joi.string().max(120),
  searchFields:   Joi.string(),
  vendorId:       objectId,
  indentId:       objectId,
  poStatus:       Joi.string().valid(...Object.values(PO_STATUS)),
  approvalStatus: Joi.string().valid(...Object.values(PO_APPROVAL_STATUS)),
  populate:       Joi.string(),
  poDate:         Joi.object().unknown(true), // poDate[gte]/[lte] range
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
