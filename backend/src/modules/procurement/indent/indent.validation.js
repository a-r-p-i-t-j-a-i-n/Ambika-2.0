import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import {
  INDENT_APPROVAL_STATUS,
  INDENT_OVERALL_STATUS,
  QUOTE_STEP_STATUS,
  QUOTATION_APPROVAL_STATUS,
} from './indent.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

// ── Create (saved as DRAFT) ──────────────────────────────────
export const createIndentSchema = Joi.object({
  productNameRevised: Joi.string().trim().min(1).max(300).required(),
  skuCode:            Joi.string().trim().max(60).allow('', null),
  skuId:              objectId.allow('', null),
  quantity:           Joi.number().min(0).required(),
  unit:               Joi.string().trim().max(30).required(),
  raisedBy:           Joi.string().trim().max(120).allow('', null),
  department:         Joi.string().trim().max(80).allow('', null),
  timestamp:          Joi.date().optional(),
});

// ── Update (only meaningful while DRAFT; service guards that) ──
export const updateIndentSchema = Joi.object({
  productNameRevised: Joi.string().trim().min(1).max(300),
  skuCode:            Joi.string().trim().max(60).allow('', null),
  skuId:              objectId.allow('', null),
  quantity:           Joi.number().min(0),
  unit:               Joi.string().trim().max(30),
  raisedBy:           Joi.string().trim().max(120).allow('', null),
  department:         Joi.string().trim().max(80).allow('', null),
}).min(1);

// ── Approve ──────────────────────────────────────────────────
export const approveIndentSchema = Joi.object({
  revisedQuantity:  Joi.number().min(0).default(0),
  approvedQuantity: Joi.number().min(0).required(),
  approvedBy:       Joi.string().trim().max(120).allow('', null),
  remarks:          Joi.string().trim().max(1000).allow('', null),
});

// ── Reject ───────────────────────────────────────────────────
export const rejectIndentSchema = Joi.object({
  remarks:    Joi.string().trim().max(1000).allow('', null),
  approvedBy: Joi.string().trim().max(120).allow('', null),
});

// ── Receive quote ────────────────────────────────────────────
export const receiveQuoteSchema = Joi.object({
  status:            Joi.string().valid(...Object.values(QUOTE_STEP_STATUS)).default(QUOTE_STEP_STATUS.RECEIVED),
  quotationUploaded: Joi.boolean().default(false),
  formLink:          Joi.string().trim().max(1000).allow('', null),
  actualAt:          Joi.date().allow('', null),
  vendorId:          objectId.allow('', null),
  vendorName:        Joi.string().trim().max(200).allow('', null),
  remarks:           Joi.string().trim().max(1000).allow('', null),
});

// ── Step 1.2 — Receive Quote & Make Comparative ──────────────
export const quoteComparativeSchema = Joi.object({
  stepNo:     Joi.string().trim().max(20).allow('', null),
  statusDone: Joi.string().valid('YES', 'QUOTE_NOT_REQUIRED').required(),
  quotationUploaded: Joi.object({
    fileName:   Joi.string().trim().max(300).allow('', null),
    fileUrl:    Joi.string().trim().max(1000).allow('', null),
    fileType:   Joi.string().trim().max(120).allow('', null),
    uploadedAt: Joi.date().optional(),
  }).default(null),
  actualAt:   Joi.date().allow('', null),
  remarks:    Joi.string().trim().max(1000).allow('', null),
});

// ── Step 1.3 — Approved Quotation ────────────────────────────
export const approveQuotationSchema = Joi.object({
  stepNo:     Joi.string().trim().max(20).allow('', null),
  statusDone: Joi.string().valid('YES', 'QUOTATION_NOT_APPROVED').required(),
  approvedQuotation: Joi.object({
    fileName:   Joi.string().trim().max(300).allow('', null),
    fileUrl:    Joi.string().trim().max(1000).allow('', null),
    fileType:   Joi.string().trim().max(120).allow('', null),
    uploadedAt: Joi.date().optional(),
  }).default(null),
  actualAt:   Joi.date().allow('', null),
  remarks:    Joi.string().trim().max(1000).allow('', null),
});

// ── List query ───────────────────────────────────────────────
export const indentQuerySchema = Joi.object({
  page:           Joi.number().integer().min(1),
  limit:          Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:           Joi.string(),
  fields:         Joi.string(),
  search:         Joi.string().max(120),
  searchFields:   Joi.string(),
  approvalStatus: Joi.string().valid(...Object.values(INDENT_APPROVAL_STATUS)),
  overallStatus:  Joi.string().valid(...Object.values(INDENT_OVERALL_STATUS)),
  department:     Joi.string().max(80),
  populate:       Joi.string(),
  timestamp:      Joi.object().unknown(true), // supports timestamp[gte]/[lte] date range
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
