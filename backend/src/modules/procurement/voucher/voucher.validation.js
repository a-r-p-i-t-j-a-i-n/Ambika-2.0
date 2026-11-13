import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { VOUCHER_STATUS, PAYMENT_MODE, VOUCHER_TYPE, EXPENSE_TYPE } from './voucher.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const paymentProofSchema = Joi.object({
  fileUrl:  Joi.string().trim().allow('', null),
  fileName: Joi.string().trim().allow('', null),
}).allow(null);

const LINKED = Joi.valid(EXPENSE_TYPE.AGAINST_PO, EXPENSE_TYPE.AGAINST_GRN);

// Expense voucher amount + header fields (shared by create/update).
const expenseFields = {
  // DIRECT (no PO/GRN) · AGAINST_PO (no GRN) · AGAINST_GRN (W/O-PO GRN, no PO).
  // The service checks the linked document; update re-checks the merged state.
  expenseType:        Joi.string().valid(...Object.values(EXPENSE_TYPE)),
  poId:               objectId.allow('', null),
  grnId:              objectId.allow('', null),
  expenseCategory:    Joi.string().trim().max(120),
  partyName:          Joi.string().trim().max(200),
  // Vendor-master link (Direct Bill Passing) — optional; a payee not in the
  // master can still be entered as free-text partyName.
  vendorId:           objectId.allow('', null),
  expenseInvoiceNo:   Joi.string().trim().max(120).allow('', null)
    // Required once this is a vendor-master-linked bill.
    .when('vendorId', { is: objectId.required(), then: Joi.required() }),
  expenseInvoiceDate: Joi.date().allow('', null),
  invoiceDocument:    Joi.object({ fileUrl: Joi.string().allow('', null), fileName: Joi.string().allow('', null) }).allow(null),
  basicValue:               Joi.number().min(0),
  freightCharges:           Joi.number().min(0),
  packingForwardingCharges: Joi.number().min(0),
  otherCharges:             Joi.number().min(0),
  taxAmount:                Joi.number().min(0),
  // Explicit GST breakout — when both are given, the backend derives taxAmount.
  taxableAmount:            Joi.number().min(0),
  gstRatePercent:           Joi.number().min(0).max(100),
  tcsAmount:                Joi.number().min(0),
  tdsAmount:                Joi.number().min(0),
  advanceAmount:            Joi.number().min(0),
  otherReason:  Joi.string().trim().max(500).allow('', null),
  paymentTerms: Joi.string().trim().max(200).allow('', null),
  dueDate:      Joi.date().allow('', null),
  preparedBy:   Joi.string().trim().max(120).allow('', null),
};

// Direct Purchase Voucher line (voucherType DIRECT_PURCHASE). Only the SKU id
// and the user's own figures are taken — name / code / unit come from the SKU
// Master, every amount is computed by the service (directPurchase.js).
const directPurchaseItem = Joi.object({
  _id:            objectId.allow('', null),
  skuId:          objectId.required().messages({ 'any.required': 'Pick each item from the SKU Master list', 'string.pattern.base': 'Pick each item from the SKU Master list' }),
  description:    Joi.string().trim().max(500).allow('', null),
  hsn:            Joi.string().trim().max(20).allow('', null),
  quantity:       Joi.number().greater(0).required(),
  rate:           Joi.number().min(0).required(),
  discountAmount: Joi.number().min(0).default(0),
  gstRate:        Joi.number().min(0).max(100).required(),
});

const directPurchaseFields = {
  vendorId:        objectId,
  invoiceNumber:   Joi.string().trim().max(120),
  invoiceDate:     Joi.date(),
  invoiceDocument: Joi.object({ fileUrl: Joi.string().allow('', null), fileName: Joi.string().allow('', null) }).allow(null),
  items:           Joi.array().items(directPurchaseItem).min(1).max(200),
  paymentTerms:    Joi.string().trim().max(200).allow('', null),
  dueDate:         Joi.date().allow('', null),
};

// DIRECT_PURCHASE create: vendor, invoice and at least one item. No PO / GRN /
// invoice link and no expense fields — anything else is stripped.
const createDirectPurchaseSchema = Joi.object({
  voucherType: Joi.string().valid(VOUCHER_TYPE.DIRECT_PURCHASE).required(),
  voucherDate: Joi.date().optional(),
  remarks:     Joi.string().trim().max(1000).allow('', null),
  ...directPurchaseFields,
  vendorId:      directPurchaseFields.vendorId.required().messages({ 'any.required': 'Select the vendor from the Vendor Master' }),
  invoiceNumber: directPurchaseFields.invoiceNumber.required().messages({ 'any.required': 'Vendor Invoice Number is required', 'string.empty': 'Vendor Invoice Number is required' }),
  invoiceDate:   directPurchaseFields.invoiceDate.required().messages({ 'any.required': 'Invoice Date is required' }),
  items:         directPurchaseFields.items.required().messages({ 'any.required': 'Add at least one purchase item', 'array.min': 'Add at least one purchase item' }),
});

const createPurchaseOrExpenseSchema = Joi.object({
  voucherType: Joi.string().valid('PURCHASE', 'EXPENSE').default('PURCHASE'),
  voucherDate: Joi.date().optional(),
  remarks:     Joi.string().trim().max(1000).allow('', null),

  // PURCHASE — created from an approved vendor invoice.
  invoiceId: objectId.when('voucherType', { is: 'EXPENSE', then: Joi.forbidden(), otherwise: objectId.required() }),

  // EXPENSE — category required; party required unless the PO / GRN supplies the vendor.
  ...expenseFields,
  expenseCategory: expenseFields.expenseCategory.when('voucherType', { is: 'EXPENSE', then: Joi.required(), otherwise: Joi.optional().allow('', null) }),
  partyName:       expenseFields.partyName.when('expenseType', {
    is: LINKED.required(),
    then: Joi.optional().allow('', null),
    otherwise: Joi.when('voucherType', { is: 'EXPENSE', then: Joi.required(), otherwise: Joi.optional().allow('', null) }),
  }),
  expenseType:     expenseFields.expenseType.when('voucherType', { is: 'EXPENSE', then: Joi.any().default(EXPENSE_TYPE.DIRECT), otherwise: Joi.forbidden() }),
  poId:            objectId.when('expenseType', { is: EXPENSE_TYPE.AGAINST_PO, then: Joi.required(), otherwise: Joi.forbidden() })
    .messages({ 'any.required': 'Select the Purchase Order this expense is against', 'any.unknown': 'poId is only allowed for an Expense Against PO' }),
  grnId:           objectId.when('expenseType', { is: EXPENSE_TYPE.AGAINST_GRN, then: Joi.required(), otherwise: Joi.forbidden() })
    .messages({ 'any.required': 'Select the GRN this expense is against', 'any.unknown': 'grnId is only allowed for an Expense Against GRN' }),
  // A PO / GRN bill is always a vendor bill — its number is required.
  expenseInvoiceNo: expenseFields.expenseInvoiceNo.when('expenseType', { is: LINKED.required(), then: Joi.required().invalid('', null) }),
});

// PURCHASE / EXPENSE requests validate exactly as before; only a request that
// says voucherType DIRECT_PURCHASE takes the direct purchase schema.
export const createVoucherSchema = Joi.alternatives().conditional(
  Joi.object({ voucherType: Joi.valid(VOUCHER_TYPE.DIRECT_PURCHASE).required() }).unknown(),
  { then: createDirectPurchaseSchema, otherwise: createPurchaseOrExpenseSchema },
);

const updatePurchaseOrExpenseSchema = Joi.object({
  voucherDate:     Joi.date(),
  paymentMode:     Joi.string().valid(...Object.values(PAYMENT_MODE)),
  remarks:         Joi.string().trim().max(1000).allow('', null),
  ...expenseFields,
}).min(1);

// Direct purchase draft edit — the request says voucherType DIRECT_PURCHASE
// (the service refuses it for a voucher of another type). No expense fields.
const updateDirectPurchaseSchema = Joi.object({
  voucherType: Joi.string().valid(VOUCHER_TYPE.DIRECT_PURCHASE).required(),
  voucherDate: Joi.date(),
  paymentMode: Joi.string().valid(...Object.values(PAYMENT_MODE)),
  remarks:     Joi.string().trim().max(1000).allow('', null),
  ...directPurchaseFields,
}).min(2);

// PURCHASE / EXPENSE edits validate exactly as before.
export const updateVoucherSchema = Joi.alternatives().conditional(
  Joi.object({ voucherType: Joi.valid(VOUCHER_TYPE.DIRECT_PURCHASE).required() }).unknown(),
  { then: updateDirectPurchaseSchema, otherwise: updatePurchaseOrExpenseSchema },
);

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

export const expenseLinkQuerySchema = Joi.object({
  type:             Joi.string().valid('PO', 'GRN').required(),
  search:           Joi.string().trim().max(120).allow(''),
  excludeVoucherId: objectId,
});

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

export const invoiceIdParamSchema = Joi.object({
  invoiceId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
