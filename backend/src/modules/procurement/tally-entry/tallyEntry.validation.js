import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { TALLY_ENTRY_STATUS, STATUS_DONE } from './tallyEntry.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const checklistSchema = Joi.object({
  companyGstDetails:         Joi.boolean(),
  invoiceQtyMatchesPoAndGrn: Joi.boolean(),
  invoiceRateMatchesPo:      Joi.boolean(),
  gstRateApplicable:         Joi.boolean(),
  tdsDeductedIfApplicable:   Joi.boolean(),
  totalCalculationVerified:  Joi.boolean(),
});

export const createTallyEntrySchema = Joi.object({
  voucherId:          objectId.required(),
  plannedAt:          Joi.date().allow('', null),
  statusDone:         Joi.string().valid(...Object.values(STATUS_DONE)).default(STATUS_DONE.NO),
  checklist:          checklistSchema,
  tallyVoucherNumber: Joi.string().trim().max(120).allow('', null),
  tallyLedgerName:    Joi.string().trim().max(160).allow('', null),
  remarks:            Joi.string().trim().max(1000).allow('', null),
});

export const updateTallyEntrySchema = Joi.object({
  plannedAt:          Joi.date().allow('', null),
  statusDone:         Joi.string().valid(...Object.values(STATUS_DONE)),
  checklist:          checklistSchema,
  tallyVoucherNumber: Joi.string().trim().max(120).allow('', null),
  tallyLedgerName:    Joi.string().trim().max(160).allow('', null),
  remarks:            Joi.string().trim().max(1000).allow('', null),
}).min(1);

export const completeTallyEntrySchema = Joi.object({
  statusDone:         Joi.string().valid(...Object.values(STATUS_DONE)).default(STATUS_DONE.YES),
  checklist:          checklistSchema,
  tallyVoucherNumber: Joi.string().trim().max(120).allow('', null),
  tallyLedgerName:    Joi.string().trim().max(160).allow('', null),
  actualAt:           Joi.date().allow('', null),
  remarks:            Joi.string().trim().max(1000).allow('', null),
});

export const cancelTallyEntrySchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),
});

export const tallyEntryQuerySchema = Joi.object({
  page:             Joi.number().integer().min(1),
  limit:            Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:             Joi.string(),
  fields:           Joi.string(),
  search:           Joi.string().max(120),
  searchFields:     Joi.string(),
  vendorId:         objectId,
  voucherId:        objectId,
  tallyEntryStatus: Joi.string().valid(...Object.values(TALLY_ENTRY_STATUS)),
  statusDone:       Joi.string().valid(...Object.values(STATUS_DONE)),
  populate:         Joi.string(),
  plannedAt:        Joi.object().unknown(true),
  actualAt:         Joi.object().unknown(true),
  createdAt:        Joi.object().unknown(true),
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

export const voucherIdParamSchema = Joi.object({
  voucherId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
