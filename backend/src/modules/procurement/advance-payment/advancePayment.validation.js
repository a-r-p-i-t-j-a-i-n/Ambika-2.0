import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { PAYMENT_STATUS, PAYMENT_MODE } from './advancePayment.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

/**
 * Record-payment schema — mirrors the Google form:
 *   paidAmount  > 0 required for posting statuses, optional for CANCELLED.
 *   remarks     required for SHORT_PAYMENT_COMPLETED, optional otherwise.
 */
export const createPaymentSchema = Joi.object({
  piId:          objectId.required(),
  paymentStatus: Joi.string().valid(...Object.values(PAYMENT_STATUS)).required(),
  paymentDate:   Joi.date().required(),
  paidAmount:    Joi.alternatives().conditional('paymentStatus', {
    is: PAYMENT_STATUS.CANCELLED,
    then: Joi.number().min(0).default(0),
    otherwise: Joi.number().greater(0).required()
      .messages({ 'number.greater': 'Paid amount must be greater than zero' }),
  }),
  paymentMode:            Joi.string().valid(...Object.values(PAYMENT_MODE)).default(PAYMENT_MODE.E_FUND_TRANSFER),
  paymentReferenceNumber: Joi.string().trim().max(120).allow('', null),
  remarks: Joi.alternatives().conditional('paymentStatus', {
    is: PAYMENT_STATUS.SHORT_PAYMENT_COMPLETED,
    then: Joi.string().trim().min(3).max(1000).required()
      .messages({ 'any.required': 'Remarks are required for short payment completion', 'string.empty': 'Remarks are required for short payment completion' }),
    otherwise: Joi.string().trim().max(1000).allow('', null),
  }),
});

// ── List query ──
export const paymentQuerySchema = Joi.object({
  page:          Joi.number().integer().min(1),
  limit:         Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:          Joi.string(),
  fields:        Joi.string(),
  search:        Joi.string().max(120),
  searchFields:  Joi.string(),
  vendorId:      objectId,
  piId:          objectId,
  poId:          objectId,
  paymentStatus: Joi.string().valid(...Object.values(PAYMENT_STATUS)),
  paymentMode:   Joi.string().valid(...Object.values(PAYMENT_MODE)),
  populate:      Joi.string(),
  paymentDate:   Joi.object().unknown(true), // paymentDate[gte]/[lte] range
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

export const piIdParamSchema = Joi.object({
  piId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
