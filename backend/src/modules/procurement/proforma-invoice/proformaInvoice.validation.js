import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { PI_APPROVAL_STATUS, PI_STATUS } from './proformaInvoice.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const piItemSchema = Joi.object({
  _id:      Joi.string().optional(),
  itemName: Joi.string().trim().min(1).max(300).required(),
  skuCode:  Joi.string().trim().max(60).allow('', null),
  skuId:    objectId.allow('', null),
  quantity: Joi.number().min(0.0001).required(),
  unit:     Joi.string().trim().max(30).allow('', null).default('Pcs'),
  rate:     Joi.number().min(0).default(0),
  gstRate:  Joi.number().min(0).max(100).default(0),
  // Computed fields accepted but recomputed server-side.
  receivedQty: Joi.number().min(0).optional(),
  balanceQty:  Joi.number().min(0).optional(),
  lineAmount:  Joi.number().min(0).optional(),
});

const piDocumentSchema = Joi.object({
  fileName:   Joi.string().trim().max(300).allow('', null),
  fileUrl:    Joi.string().trim().max(1000).allow('', null),
  fileType:   Joi.string().trim().max(120).allow('', null),
  uploadedAt: Joi.date().optional(),
});

// ── Create (PO linkage mandatory; items default from the PO) ──
export const createPiSchema = Joi.object({
  poId:       objectId.required(),
  piDate:     Joi.date().optional(),
  piDocument: piDocumentSchema.default(null),
  items:      Joi.array().items(piItemSchema).min(1).optional(), // omitted → pulled from PO
  remarks:    Joi.string().trim().max(1000).allow('', null),
});

// ── Update (DRAFT / RECEIVED only — service guards) ──
export const updatePiSchema = Joi.object({
  piDate:     Joi.date(),
  piDocument: piDocumentSchema,
  items:      Joi.array().items(piItemSchema).min(1),
  remarks:    Joi.string().trim().max(1000).allow('', null),
}).min(1);

// ── Approve / reject / cancel ──
export const approvePiSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),
});

export const rejectPiSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),
});

export const cancelPiSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),
});

// ── List query ──
export const piQuerySchema = Joi.object({
  page:           Joi.number().integer().min(1),
  limit:          Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:           Joi.string(),
  fields:         Joi.string(),
  search:         Joi.string().max(120),
  searchFields:   Joi.string(),
  vendorId:       objectId,
  poId:           objectId,
  piStatus:       Joi.string().valid(...Object.values(PI_STATUS)),
  approvalStatus: Joi.string().valid(...Object.values(PI_APPROVAL_STATUS)),
  populate:       Joi.string(),
  piDate:         Joi.object().unknown(true), // piDate[gte]/[lte] range
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

export const poIdParamSchema = Joi.object({
  poId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
