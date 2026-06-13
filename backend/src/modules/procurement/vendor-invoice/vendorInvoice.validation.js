import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { INVOICE_STATUS } from './vendorInvoice.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const docSchema = Joi.object({
  fileName:   Joi.string().trim().max(300).allow('', null),
  fileUrl:    Joi.string().trim().max(1000).allow('', null),
  fileType:   Joi.string().trim().max(120).allow('', null),
  uploadedAt: Joi.date().optional(),
});

export const createInvoiceSchema = Joi.object({
  qcId:                objectId.required(),
  invoiceNumber:       Joi.string().trim().min(1).max(120).required(),
  invoiceDate:         Joi.date().allow('', null),
  invoiceReceivedDate: Joi.date().optional(),
  invoiceAmount:       Joi.number().min(0).required(),
  taxableAmount:       Joi.number().min(0).default(0),
  gstAmount:           Joi.number().min(0).default(0),
  tdsAmount:           Joi.number().min(0).default(0),
  otherCharges:        Joi.number().default(0),
  invoiceDocument:     docSchema.default(null),
  debitNoteRequired:   Joi.boolean().default(false),
  debitNoteNumber:     Joi.string().trim().max(120).allow('', null),
  debitNoteAmount:     Joi.number().min(0).default(0),
  debitNoteReason:     Joi.string().trim().max(500).allow('', null),
  debitNoteDocument:   docSchema.default(null),
  remarks:             Joi.string().trim().max(1000).allow('', null),
});

export const updateInvoiceSchema = Joi.object({
  invoiceNumber:       Joi.string().trim().min(1).max(120),
  invoiceDate:         Joi.date().allow('', null),
  invoiceReceivedDate: Joi.date(),
  invoiceAmount:       Joi.number().min(0),
  taxableAmount:       Joi.number().min(0),
  gstAmount:           Joi.number().min(0),
  tdsAmount:           Joi.number().min(0),
  otherCharges:        Joi.number(),
  invoiceDocument:     docSchema,
  debitNoteRequired:   Joi.boolean(),
  debitNoteNumber:     Joi.string().trim().max(120).allow('', null),
  debitNoteAmount:     Joi.number().min(0),
  debitNoteReason:     Joi.string().trim().max(500).allow('', null),
  debitNoteDocument:   docSchema,
  remarks:             Joi.string().trim().max(1000).allow('', null),
}).min(1);

export const approveInvoiceSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),
});

export const rejectInvoiceSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),
});

export const invoiceQuerySchema = Joi.object({
  page:          Joi.number().integer().min(1),
  limit:         Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:          Joi.string(),
  fields:        Joi.string(),
  search:        Joi.string().max(120),
  searchFields:  Joi.string(),
  vendorId:      objectId,
  qcId:          objectId,
  invoiceStatus: Joi.string().valid(...Object.values(INVOICE_STATUS)),
  populate:      Joi.string(),
  invoiceDate:   Joi.object().unknown(true),
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

export const qcIdParamSchema = Joi.object({
  qcId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
