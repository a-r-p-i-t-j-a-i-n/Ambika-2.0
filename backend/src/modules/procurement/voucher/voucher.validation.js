import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { VOUCHER_STATUS, PAYMENT_MODE } from './voucher.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const paymentProofSchema = Joi.object({
  fileUrl:  Joi.string().trim().allow('', null),
  fileName: Joi.string().trim().allow('', null),
}).allow(null);

export const createVoucherSchema = Joi.object({
  invoiceId:       objectId.required(),
  voucherDate:     Joi.date().optional(),
  paidAmount:      Joi.number().min(0).default(0),
  paymentMode:     Joi.string().valid(...Object.values(PAYMENT_MODE)).default(PAYMENT_MODE.NEFT),
  referenceNumber: Joi.string().trim().max(120).allow('', null),
  bankName:        Joi.string().trim().max(120).allow('', null),
  utrNumber:       Joi.string().trim().max(120).allow('', null),
  chequeNumber:    Joi.string().trim().max(120).allow('', null),
  paymentProof:    paymentProofSchema,
  paymentDate:     Joi.date().allow('', null),
  remarks:         Joi.string().trim().max(1000).allow('', null),
});

export const updateVoucherSchema = Joi.object({
  voucherDate:     Joi.date(),
  paidAmount:      Joi.number().min(0),
  paymentMode:     Joi.string().valid(...Object.values(PAYMENT_MODE)),
  referenceNumber: Joi.string().trim().max(120).allow('', null),
  bankName:        Joi.string().trim().max(120).allow('', null),
  utrNumber:       Joi.string().trim().max(120).allow('', null),
  chequeNumber:    Joi.string().trim().max(120).allow('', null),
  paymentProof:    paymentProofSchema,
  paymentDate:     Joi.date().allow('', null),
  remarks:         Joi.string().trim().max(1000).allow('', null),
}).min(1);

// Step 1.11 post = passing / approval only (no payment captured here).
export const postVoucherSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),
});

export const cancelVoucherSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow('', null),
});

export const voucherQuerySchema = Joi.object({
  page:          Joi.number().integer().min(1),
  limit:         Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:          Joi.string(),
  fields:        Joi.string(),
  search:        Joi.string().max(120),
  searchFields:  Joi.string(),
  vendorId:         objectId,
  invoiceId:        objectId,
  voucherStatus:    Joi.string().valid(...Object.values(VOUCHER_STATUS)),
  tallyEntryStatus: Joi.string().valid('PENDING', 'COMPLETED', 'CANCELLED'),
  minBalance:       Joi.number().min(0),               // balanceAmount >= minBalance
  excludeStatus:    Joi.string(),                      // CSV of voucherStatus to exclude
  populate:         Joi.string(),
  voucherDate:      Joi.object().unknown(true),
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

export const invoiceIdParamSchema = Joi.object({
  invoiceId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
