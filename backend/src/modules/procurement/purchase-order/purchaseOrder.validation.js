import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { PO_APPROVAL_STATUS, PO_STATUS } from './purchaseOrder.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const poItemSchema = Joi.object({
  _id:      Joi.string().optional(),
  itemName: Joi.string().trim().min(1).max(300).required(),
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
});

// ── Create (saved as DRAFT; only from an approved-quotation indent) ──
export const createPoSchema = Joi.object({
  indentId:      objectId.required(),
  vendorId:      objectId.required(),
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

// ── Update (DRAFT only — service guards) ──
export const updatePoSchema = Joi.object({
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
