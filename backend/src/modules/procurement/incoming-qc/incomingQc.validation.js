import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { QC_STATUS, QC_RESULT, DEFECT_SEVERITY } from './incomingQc.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const qcDocumentSchema = Joi.object({
  fileName:   Joi.string().trim().max(300).allow('', null),
  fileUrl:    Joi.string().trim().max(1000).allow('', null),
  fileType:   Joi.string().trim().max(120).allow('', null),
  uploadedAt: Joi.date().optional(),
});

const qcItemSchema = Joi.object({
  _id:         Joi.string().optional(),
  grnItemId:   objectId.allow('', null),
  skuId:       objectId.allow('', null),
  skuCode:     Joi.string().trim().max(60).allow('', null),
  itemName:    Joi.string().trim().min(1).max(300).required(),
  unit:        Joi.string().trim().max(30).allow('', null).default('Pcs'),
  batchNo:     Joi.string().trim().max(60).allow('', null),
  receivedQty: Joi.number().min(0).required(),
  acceptedQty: Joi.number().min(0).default(0),
  rejectedQty: Joi.number().min(0).default(0),
  reworkQty:   Joi.number().min(0).default(0),
  shortQty:    Joi.number().default(0),
  defectType:     Joi.string().trim().max(120).allow('', null),
  defectSeverity: Joi.string().valid('', ...Object.values(DEFECT_SEVERITY)).allow('', null),
  defectRemarks:  Joi.string().trim().max(500).allow('', null),
  qcRemarks:      Joi.string().trim().max(500).allow('', null),
});

// QC is created from EITHER a GRN (goods) OR an approved internal-service indent
// (indentId; serviceCompletionId for legacy Service Completion records). Exactly
// one source id is required.
export const createQcSchema = Joi.object({
  grnId:               objectId,
  // Which PO's items to inspect — required only when grnId's GRN covers more
  // than one PO (a single-PO or W/O PO GRN resolves it on its own).
  poId:                objectId.allow('', null),
  indentId:            objectId,
  serviceCompletionId: objectId,
  qcDate:           Joi.date().optional(),
  checkedByName:    Joi.string().trim().max(120).allow('', null),
  preparedBy:       Joi.string().trim().max(120).allow('', null),
  qcReportDocument: qcDocumentSchema.default(null),
  photos:           Joi.array().items(Joi.string().trim().max(1000)).default([]),
  remarks:          Joi.string().trim().max(1000).allow('', null),
  items:            Joi.array().items(qcItemSchema).min(1).optional(),
}).xor('grnId', 'indentId', 'serviceCompletionId');

export const updateQcSchema = Joi.object({
  qcDate:           Joi.date(),
  checkedByName:    Joi.string().trim().max(120).allow('', null),
  preparedBy:       Joi.string().trim().max(120).allow('', null),
  qcReportDocument: qcDocumentSchema,
  photos:           Joi.array().items(Joi.string().trim().max(1000)),
  remarks:          Joi.string().trim().max(1000).allow('', null),
  items:            Joi.array().items(qcItemSchema).min(1),
}).min(1);

export const completeQcSchema = Joi.object({
  // For service QC (no item splits) the result is supplied directly.
  overallResult: Joi.string().valid(...Object.values(QC_RESULT)),
  remarks: Joi.string().trim().max(1000).allow('', null),
  // Service QC: optional service report.
  qcReportDocument: qcDocumentSchema,
});

export const cancelQcSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),
});

export const qcQuerySchema = Joi.object({
  page:          Joi.number().integer().min(1),
  limit:         Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:          Joi.string(),
  fields:        Joi.string(),
  search:        Joi.string().max(120),
  searchFields:  Joi.string(),
  vendorId:      objectId,
  grnId:         objectId,
  qcStatus:      Joi.string().valid(...Object.values(QC_STATUS)),
  overallResult: Joi.string().valid(...Object.values(QC_RESULT)),
  populate:      Joi.string(),
  qcDate:        Joi.object().unknown(true),
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

export const grnIdParamSchema = Joi.object({
  grnId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
