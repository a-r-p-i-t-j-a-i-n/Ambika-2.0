import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { FOLLOWUP_STATUS, FOLLOWUP_TYPE } from './followUp.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);
const followUpType = Joi.string().valid(...Object.values(FOLLOWUP_TYPE));

// ── Create (only for RELEASED_TO_VENDOR POs — service guards) ──
export const createFollowUpSchema = Joi.object({
  poId:         objectId.required(),
  plannedAt:    Joi.date().optional(), // defaults to PO expectedDeliveryDate / releasedAt + leadTime
  followUpType: followUpType.default(FOLLOWUP_TYPE.CALL),
  remarks:      Joi.string().trim().max(1000).allow('', null),
  formLink:     Joi.string().trim().max(1000).allow('', null),
});

// ── Update (PENDING only — service guards) ──
export const updateFollowUpSchema = Joi.object({
  plannedAt:    Joi.date(),
  followUpType: followUpType,
  remarks:      Joi.string().trim().max(1000).allow('', null),
  formLink:     Joi.string().trim().max(1000).allow('', null),
}).min(1);

// ── Mark done ──
export const markDoneSchema = Joi.object({
  actualAt:          Joi.date().optional(), // defaults to now
  followUpType:      followUpType,
  remarks:           Joi.string().trim().max(1000).allow('', null),
  nextFollowUpDate:  Joi.date().allow('', null),
  finalMaterialDate: Joi.date().allow('', null),
  message:           Joi.string().trim().max(2000).allow('', null), // communication log entry
});

// ── Reschedule ──
export const rescheduleSchema = Joi.object({
  nextFollowUpDate: Joi.date().required(),
  followUpType:     followUpType,
  remarks:          Joi.string().trim().max(1000).allow('', null),
  message:          Joi.string().trim().max(2000).allow('', null),
});

// ── Ready for GRN ──
export const readyForGrnSchema = Joi.object({
  finalMaterialDate: Joi.date().allow('', null),
  remarks:           Joi.string().trim().max(1000).allow('', null),
});

// ── List query ──
export const followUpQuerySchema = Joi.object({
  page:           Joi.number().integer().min(1),
  limit:          Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:           Joi.string(),
  fields:         Joi.string(),
  search:         Joi.string().max(120),
  searchFields:   Joi.string(),
  vendorId:       objectId,
  poId:           objectId,
  followUpStatus: Joi.string(), // single or comma-separated (ApiFeatures $in)
  populate:       Joi.string(),
  plannedAt:      Joi.object().unknown(true), // plannedAt[gte]/[lte] range
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

export const poIdParamSchema = Joi.object({
  poId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
