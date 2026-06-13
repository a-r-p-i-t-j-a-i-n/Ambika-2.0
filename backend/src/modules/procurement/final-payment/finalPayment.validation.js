import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { FINAL_PAYMENT_STATUS, PAYMENT_MODE } from './finalPayment.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const proofSchema = Joi.object({
  fileName: Joi.string().trim().allow('', null),
  fileUrl:  Joi.string().trim().allow('', null),
  fileType: Joi.string().trim().allow('', null),
}).allow(null);

export const createFinalPaymentSchema = Joi.object({
  voucherId:              objectId.required(),
  paymentStatus:          Joi.string().valid(...Object.values(FINAL_PAYMENT_STATUS)).required(),
  paymentDate:            Joi.date().allow('', null),
  paidAmount:             Joi.number().min(0).required(),
  paymentMode:            Joi.string().valid(...Object.values(PAYMENT_MODE)).default(PAYMENT_MODE.NEFT),
  paymentReferenceNumber: Joi.string().trim().max(120).allow('', null),
  proofDocument:          proofSchema,
  remarks:                Joi.string().trim().max(1000).allow('', null),
})
  // Short payment must carry a reason.
  .when(Joi.object({ paymentStatus: Joi.valid(FINAL_PAYMENT_STATUS.SHORT_PAYMENT_COMPLETED) }).unknown(), {
    then: Joi.object({ remarks: Joi.string().trim().min(1).required().messages({ 'any.required': 'Remarks are required for Short Payment & Completed' }) }),
  });

export const updateFinalPaymentSchema = Joi.object({
  paymentDate:            Joi.date().allow('', null),
  paymentMode:            Joi.string().valid(...Object.values(PAYMENT_MODE)),
  paymentReferenceNumber: Joi.string().trim().max(120).allow('', null),
  proofDocument:          proofSchema,
  remarks:                Joi.string().trim().max(1000).allow('', null),
}).min(1);

export const cancelFinalPaymentSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),
});

export const finalPaymentQuerySchema = Joi.object({
  page:          Joi.number().integer().min(1),
  limit:         Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:          Joi.string(),
  fields:        Joi.string(),
  search:        Joi.string().max(120),
  searchFields:  Joi.string(),
  vendorId:      objectId,
  voucherId:     objectId,
  invoiceId:     objectId,
  paymentStatus: Joi.string().valid(...Object.values(FINAL_PAYMENT_STATUS)),
  paymentMode:   Joi.string().valid(...Object.values(PAYMENT_MODE)),
  populate:      Joi.string(),
  paymentDate:   Joi.object().unknown(true),
  createdAt:     Joi.object().unknown(true),
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

export const voucherIdParamSchema = Joi.object({
  voucherId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
