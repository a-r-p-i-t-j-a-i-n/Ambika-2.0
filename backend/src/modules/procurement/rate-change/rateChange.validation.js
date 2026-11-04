import Joi from 'joi';
import { RATE_CHANGE_STATUS } from './rateChange.model.js';
import { RATE_CHANGE_EVENT } from './rateChangeHistory.model.js';
import { REJECTION_REASON_MIN } from './rateChange.rules.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

export const mongoIdParamSchema = Joi.object({ id: objectId.required() });

export const listRateChangesSchema = Joi.object({
  page:  Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(200),
  status: Joi.string().valid(...Object.values(RATE_CHANGE_STATUS)).allow(''),
  vendorId:    objectId.allow(''),
  requestedBy: objectId.allow(''),
  poId:        objectId.allow(''),
  skuCode: Joi.string().trim().max(60).allow(''),
  search:  Joi.string().trim().max(120).allow(''),
  from: Joi.date().allow(''),
  to:   Joi.date().allow(''),
});

export const rateHistorySchema = Joi.object({
  page:  Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(500),
  event:  Joi.string().valid(...Object.values(RATE_CHANGE_EVENT)).allow(''),
  status: Joi.string().valid(...Object.values(RATE_CHANGE_STATUS)).allow(''),
  vendorId:    objectId.allow(''),
  requestedBy: objectId.allow(''),
  requestId:   objectId.allow(''),
  skuCode: Joi.string().trim().max(60).allow(''),
  search:  Joi.string().trim().max(120).allow(''),
  from: Joi.date().allow(''),
  to:   Joi.date().allow(''),
  order: Joi.string().valid('asc', 'desc'),
});

export const vendorRateQuerySchema = Joi.object({
  vendorId: objectId.required(),
  skuId:    objectId.allow(''),
  skuCode:  Joi.string().trim().max(60).allow(''),
  itemName: Joi.string().trim().max(300).allow(''),
  unit:     Joi.string().trim().max(30).allow(''),
}).or('skuId', 'skuCode', 'itemName');

export const approveRateChangeSchema = Joi.object({
  remarks: Joi.string().trim().max(500).allow('', null),
  // The vendor rate the approver reviewed (required to approve once it moved).
  expectedVendorRate: Joi.number().min(0).allow(null),
  acknowledgeRateChange: Joi.boolean().default(false),
});

export const rejectRateChangeSchema = Joi.object({
  reason: Joi.string().trim().min(REJECTION_REASON_MIN).max(500).required().label('Rejection reason'),
});
