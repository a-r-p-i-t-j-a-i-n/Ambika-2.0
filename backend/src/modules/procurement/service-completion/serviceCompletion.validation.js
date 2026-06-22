import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { SERVICE_COMPLETION_STATUS } from './serviceCompletion.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const uploadedFile = Joi.object({
  fileName:   Joi.string().trim().max(300).allow('', null),
  fileUrl:    Joi.string().trim().max(1000).allow('', null),
  fileType:   Joi.string().trim().max(120).allow('', null),
  uploadedAt: Joi.date().optional(),
});

// ── Create (records completion; status defaults to COMPLETED) ──
export const createServiceCompletionSchema = Joi.object({
  indentId:              objectId.required(),
  vendorId:              objectId.allow('', null),
  vendorName:            Joi.string().trim().max(200).allow('', null),
  status:                Joi.string().valid('PENDING', 'COMPLETED').default('COMPLETED'),
  serviceCompletionDate: Joi.date().allow('', null),
  completionRemarks:     Joi.string().trim().max(2000).allow('', null),
  completionDocuments:   Joi.array().items(uploadedFile).default([]),
  serviceReportDocument: uploadedFile.default(null),
  invoiceDocument:       uploadedFile.default(null),
});

// ── Update (only while PENDING) ──
export const updateServiceCompletionSchema = Joi.object({
  vendorId:              objectId.allow('', null),
  vendorName:            Joi.string().trim().max(200).allow('', null),
  serviceCompletionDate: Joi.date().allow('', null),
  completionRemarks:     Joi.string().trim().max(2000).allow('', null),
  completionDocuments:   Joi.array().items(uploadedFile),
  serviceReportDocument: uploadedFile,
  invoiceDocument:       uploadedFile,
}).min(1);

// ── Complete (PENDING → COMPLETED) ──
export const completeServiceCompletionSchema = Joi.object({
  serviceCompletionDate: Joi.date().allow('', null),
  completionRemarks:     Joi.string().trim().max(2000).allow('', null),
  serviceReportDocument: uploadedFile.default(null),
  invoiceDocument:       uploadedFile.default(null),
});

export const cancelServiceCompletionSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),
});

export const serviceCompletionQuerySchema = Joi.object({
  page:   Joi.number().integer().min(1),
  limit:  Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:   Joi.string(),
  fields: Joi.string(),
  search: Joi.string().max(120),
  searchFields: Joi.string(),
  status: Joi.string().valid(...Object.values(SERVICE_COMPLETION_STATUS)),
  indentId: objectId,
  populate: Joi.string(),
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
