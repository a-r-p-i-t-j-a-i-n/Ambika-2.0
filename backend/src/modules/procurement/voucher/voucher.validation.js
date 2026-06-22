import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { VOUCHER_STATUS, PAYMENT_MODE, VOUCHER_TYPE } from './voucher.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const paymentProofSchema = Joi.object({
  fileUrl:  Joi.string().trim().allow('', null),
  fileName: Joi.string().trim().allow('', null),
}).allow(null);

// Expense voucher amount + header fields (shared by create/update).
const expenseFields = {
  expenseCategory:    Joi.string().trim().max(120),
  partyName:          Joi.string().trim().max(200),
  expenseInvoiceNo:   Joi.string().trim().max(120).allow('', null),
  expenseInvoiceDate: Joi.date().allow('', null),
  invoiceDocument:    Joi.object({ fileUrl: Joi.string().allow('', null), fileName: Joi.string().allow('', null) }).allow(null),
  basicValue:               Joi.number().min(0),
  freightCharges:           Joi.number().min(0),
  packingForwardingCharges: Joi.number().min(0),
  otherCharges:             Joi.number().min(0),
  taxAmount:                Joi.number().min(0),
  tcsAmount:                Joi.number().min(0),
  tdsAmount:                Joi.number().min(0),
  advanceAmount:            Joi.number().min(0),
  otherReason:  Joi.string().trim().max(500).allow('', null),
  paymentTerms: Joi.string().trim().max(200).allow('', null),
  dueDate:      Joi.date().allow('', null),
  preparedBy:   Joi.string().trim().max(120).allow('', null),
};

export const createVoucherSchema = Joi.object({
  voucherType: Joi.string().valid('PURCHASE', 'EXPENSE').default('PURCHASE'),
  voucherDate: Joi.date().optional(),
  remarks:     Joi.string().trim().max(1000).allow('', null),

  // PURCHASE — created from an approved vendor invoice.
  invoiceId: objectId.when('voucherType', { is: 'EXPENSE', then: Joi.forbidden(), otherwise: objectId.required() }),

  // EXPENSE — direct; category + party required.
  ...expenseFields,
  expenseCategory: expenseFields.expenseCategory.when('voucherType', { is: 'EXPENSE', then: Joi.required(), otherwise: Joi.optional().allow('', null) }),
  partyName:       expenseFields.partyName.when('voucherType', { is: 'EXPENSE', then: Joi.required(), otherwise: Joi.optional().allow('', null) }),
});

export const updateVoucherSchema = Joi.object({
  voucherDate:     Joi.date(),
  paymentMode:     Joi.string().valid(...Object.values(PAYMENT_MODE)),
  remarks:         Joi.string().trim().max(1000).allow('', null),
  ...expenseFields,
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
  voucherType:      Joi.string().valid(...Object.values(VOUCHER_TYPE)),
  expenseCategory:  Joi.string().max(120),
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
