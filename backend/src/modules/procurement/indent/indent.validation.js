import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import {
  INDENT_APPROVAL_STATUS,
  INDENT_OVERALL_STATUS,
  QUOTE_STEP_STATUS,
  QUOTATION_APPROVAL_STATUS,
  VENDOR_QUOTE_STATUS,
  ITEM_APPROVAL_STATUS,
} from './indent.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

// Reusable uploaded-document shape.
const uploadedFile = Joi.object({
  fileName:   Joi.string().trim().max(300).allow('', null),
  fileUrl:    Joi.string().trim().max(1000).allow('', null),
  fileType:   Joi.string().trim().max(120).allow('', null),
  uploadedAt: Joi.date().optional(),
});

// ── Indent line item ─────────────────────────────────────────
const indentItem = Joi.object({
  _id:              Joi.string().optional(),
  skuId:            objectId.allow('', null),
  skuCode:          Joi.string().trim().max(60).allow('', null),
  itemName:         Joi.string().trim().min(1).max(300).required(),
  quantity:         Joi.number().min(0).required(),
  unit:             Joi.string().trim().max(30).allow('', null).default('Pcs'),
  revisedQuantity:  Joi.number().min(0).default(0),
  approvedQuantity: Joi.number().min(0).default(0),
  remarks:          Joi.string().trim().max(500).allow('', null),
});

// ── Create (saved as DRAFT) ──────────────────────────────────
// Accepts the multi-item shape; legacy single-product fields are still allowed
// for backward compatibility (the service synthesises one item from them).
export const createIndentSchema = Joi.object({
  items:              Joi.array().items(indentItem).min(1),
  raisedBy:           Joi.string().trim().max(120).allow('', null),
  department:         Joi.string().trim().max(80).allow('', null),
  requestType:        Joi.string().valid('MATERIAL_PURCHASE', 'INTERNAL_SERVICE').default('MATERIAL_PURCHASE'),
  remarks:            Joi.string().trim().max(1000).allow('', null),
  timestamp:          Joi.date().optional(),
  // legacy single-product (back-compat)
  productNameRevised: Joi.string().trim().min(1).max(300),
  skuCode:            Joi.string().trim().max(60).allow('', null),
  skuId:              objectId.allow('', null),
  quantity:           Joi.number().min(0),
  unit:               Joi.string().trim().max(30),
}).or('items', 'productNameRevised');

// ── Update (only meaningful while DRAFT; service guards that) ──
export const updateIndentSchema = Joi.object({
  items:              Joi.array().items(indentItem).min(1),
  raisedBy:           Joi.string().trim().max(120).allow('', null),
  department:         Joi.string().trim().max(80).allow('', null),
  requestType:        Joi.string().valid('MATERIAL_PURCHASE', 'INTERNAL_SERVICE'),
  remarks:            Joi.string().trim().max(1000).allow('', null),
  // legacy single-product (back-compat)
  productNameRevised: Joi.string().trim().min(1).max(300),
  skuCode:            Joi.string().trim().max(60).allow('', null),
  skuId:              objectId.allow('', null),
  quantity:           Joi.number().min(0),
  unit:               Joi.string().trim().max(30),
}).min(1);

// ── Approve ──────────────────────────────────────────────────
// Revised Qty is the only quantity the client edits — Approved Qty always
// mirrors it server-side (indentService.approve), so it's accepted here only
// for backward compatibility with older clients and is otherwise ignored.
export const approveIndentSchema = Joi.object({
  items: Joi.array().items(Joi.object({
    _id:              Joi.string().optional(),
    itemName:         Joi.string().trim().max(300).allow('', null),
    skuCode:          Joi.string().trim().max(60).allow('', null),
    revisedQuantity:  Joi.number().min(0).default(0),
    approvedQuantity: Joi.number().min(0).default(0),
    // Per-item decision — defaults to APPROVED so older clients that never send
    // this field keep behaving exactly as before.
    approvalStatus:   Joi.string().valid(...Object.values(ITEM_APPROVAL_STATUS)).default(ITEM_APPROVAL_STATUS.APPROVED),
    rejectionReason:  Joi.string().trim().max(500).allow('', null)
      .when('approvalStatus', { is: ITEM_APPROVAL_STATUS.REJECTED, then: Joi.string().trim().min(1).required().messages({
        'string.empty': 'Rejection reason is required',
        'any.required': 'Rejection reason is required',
      }) }),
  })),
  revisedQuantity:  Joi.number().min(0),
  approvedQuantity: Joi.number().min(0),
  approvedBy:       Joi.string().trim().max(120).allow('', null),
  remarks:          Joi.string().trim().max(1000).allow('', null),
}).or('items', 'revisedQuantity', 'approvedQuantity');

// ── Reject ───────────────────────────────────────────────────
export const rejectIndentSchema = Joi.object({
  remarks:    Joi.string().trim().max(1000).allow('', null),
  approvedBy: Joi.string().trim().max(120).allow('', null),
});

// ── Bulk approve (multiple indents, item-wise quantities) ────
// Same rule as single approve: Revised Qty is the only editable field —
// approvedQuantity is accepted for backward compatibility but ignored server-side.
export const bulkApproveSchema = Joi.object({
  indents: Joi.array().min(1).items(Joi.object({
    indentId: objectId.required(),
    items: Joi.array().items(Joi.object({
      itemId:           objectId.allow('', null),
      _id:              Joi.string().optional(),
      revisedQuantity:  Joi.number().min(0).default(0),
      approvedQuantity: Joi.number().min(0).default(0),
      approvalStatus:   Joi.string().valid(...Object.values(ITEM_APPROVAL_STATUS)).default(ITEM_APPROVAL_STATUS.APPROVED),
      rejectionReason:  Joi.string().trim().max(500).allow('', null)
        .when('approvalStatus', { is: ITEM_APPROVAL_STATUS.REJECTED, then: Joi.string().trim().min(1).required().messages({
          'string.empty': 'Rejection reason is required',
          'any.required': 'Rejection reason is required',
        }) }),
    })).default([]),
    remarks:    Joi.string().trim().max(1000).allow('', null),
    approvedBy: Joi.string().trim().max(120).allow('', null),
  })).required(),
});

// ── Bulk reject (multiple indents) ───────────────────────────
export const bulkRejectSchema = Joi.object({
  indentIds:  Joi.array().min(1).items(objectId.required()).required(),
  // Rejection remarks are mandatory for the audit trail.
  remarks:    Joi.string().trim().min(1).max(1000).required().messages({
    'string.empty': 'Rejection remarks are required',
    'any.required': 'Rejection remarks are required',
  }),
  approvedBy: Joi.string().trim().max(120).allow('', null),
});

// ── Receive quote ────────────────────────────────────────────
export const receiveQuoteSchema = Joi.object({
  status:            Joi.string().valid(...Object.values(QUOTE_STEP_STATUS)).default(QUOTE_STEP_STATUS.RECEIVED),
  quotationUploaded: Joi.boolean().default(false),
  formLink:          Joi.string().trim().max(1000).allow('', null),
  actualAt:          Joi.date().allow('', null),
  vendorId:          objectId.allow('', null),
  vendorName:        Joi.string().trim().max(200).allow('', null),
  remarks:           Joi.string().trim().max(1000).allow('', null),
});

// ── Step 1.2 — per-vendor quoted line item ───────────────────
const vendorQuoteItem = Joi.object({
  skuId:        objectId.allow('', null),
  skuCode:      Joi.string().trim().max(60).allow('', null),
  itemName:     Joi.string().trim().max(300).allow('', null),
  unit:         Joi.string().trim().max(30).allow('', null).default('Pcs'),
  requestedQty: Joi.number().min(0).default(0),
  quotedRate:   Joi.number().min(0).default(0),
  gstRate:      Joi.number().min(0).max(100).default(0),
  deliveryDays: Joi.number().min(0).default(0),
  paymentTerms: Joi.string().trim().max(200).allow('', null),
  remarks:      Joi.string().trim().max(500).allow('', null),
  // Accepted but recomputed server-side.
  totalAmount:  Joi.number().min(0).optional(),
});

// ── Step 1.2 — one vendor's quotation ────────────────────────
const vendorQuote = Joi.object({
  _id:             Joi.string().optional(),
  vendorId:        objectId.required(),
  vendorName:      Joi.string().trim().max(200).allow('', null),
  vendorEmail:     Joi.string().trim().max(200).allow('', null),
  vendorPhone:     Joi.string().trim().max(40).allow('', null),
  quotationStatus: Joi.string().valid(...Object.values(VENDOR_QUOTE_STATUS)).default(VENDOR_QUOTE_STATUS.PENDING),
  quotationDocument: uploadedFile.default(null),
  items:               Joi.array().items(vendorQuoteItem).default([]),
  totalQuotationValue: Joi.number().min(0).optional(),
  remarks:             Joi.string().trim().max(1000).allow('', null),
});

// ── Step 1.2 — per-indent-item quotation upload ──────────────
const itemQuotation = Joi.object({
  itemId:    objectId.allow('', null),
  skuId:     objectId.allow('', null),
  skuCode:   Joi.string().trim().max(60).allow('', null),
  itemName:  Joi.string().trim().max(300).allow('', null),
  statusDone: Joi.string().valid('YES', 'QUOTE_NOT_REQUIRED').default('YES'),
  quotationDocuments: Joi.array().items(uploadedFile).default([]),
  actualAt:  Joi.date().allow('', null),
  remarks:   Joi.string().trim().max(1000).allow('', null),
});

// ── Step 1.2 — Receive Quote & Make Comparative ──────────────
// `itemQuotations[]` is the item-wise upload; `vendors[]` is the multi-vendor
// comparative; `quotationUploaded` is the legacy single-quote path. Any may be
// supplied (back-compat).
export const quoteComparativeSchema = Joi.object({
  stepNo:     Joi.string().trim().max(20).allow('', null),
  statusDone: Joi.string().valid('YES', 'QUOTE_NOT_REQUIRED').required(),
  quotationUploaded:  uploadedFile.default(null),
  quotationDocuments: Joi.array().items(uploadedFile).default([]),
  itemQuotations: Joi.array().items(itemQuotation).default([]),
  vendors:    Joi.array().items(vendorQuote).default([]),
  actualAt:   Joi.date().allow('', null),
  remarks:    Joi.string().trim().max(1000).allow('', null),
});

// ── Step 1.3 — per-vendor approved line item ─────────────────
const approvedVendorItem = Joi.object({
  skuId:       objectId.allow('', null),
  skuCode:     Joi.string().trim().max(60).allow('', null),
  itemName:    Joi.string().trim().max(300).allow('', null),
  unit:        Joi.string().trim().max(30).allow('', null).default('Pcs'),
  approvedQty: Joi.number().min(0).default(0),
  approvedRate:Joi.number().min(0).default(0),
  gstRate:     Joi.number().min(0).max(100).default(0),
  totalAmount: Joi.number().min(0).optional(),
});

// ── Step 1.3 — one approved vendor ───────────────────────────
const approvedVendor = Joi.object({
  _id:        Joi.string().optional(),
  vendorId:   objectId.required(),
  vendorName: Joi.string().trim().max(200).allow('', null),
  items:      Joi.array().items(approvedVendorItem).min(1).required(),
  approvedQuotationDocument: uploadedFile.default(null),
  approvalRemarks: Joi.string().trim().max(1000).allow('', null),
});

// ── Step 1.3 — per-indent-item approved quotation upload ─────
const itemApprovedQuotation = Joi.object({
  itemId:    objectId.allow('', null),
  skuId:     objectId.allow('', null),
  skuCode:   Joi.string().trim().max(60).allow('', null),
  itemName:  Joi.string().trim().max(300).allow('', null),
  statusDone: Joi.string().valid('YES', 'QUOTATION_NOT_APPROVED', 'QUOTE_NOT_REQUIRED').default('YES'),
  approvedQuotationDocuments: Joi.array().items(uploadedFile).default([]),
  actualAt:  Joi.date().allow('', null),
  remarks:   Joi.string().trim().max(1000).allow('', null),
});

// ── Step 1.3 — Approved Quotation ────────────────────────────
// `itemApprovedQuotations[]` is the item-wise upload; `approvedVendors[]` is the
// multi-vendor approval; `approvedQuotation` is the legacy single-quote path.
// Any may be supplied (back-compat).
export const approveQuotationSchema = Joi.object({
  stepNo:     Joi.string().trim().max(20).allow('', null),
  // Optional — Step 1.3 carries its status from Step 1.2 (the service derives it).
  // Kept for back-compat with older clients that still send it.
  statusDone: Joi.string().valid('YES', 'QUOTATION_NOT_APPROVED').allow('', null),
  approvedQuotation:          uploadedFile.default(null),
  approvedQuotationDocuments: Joi.array().items(uploadedFile).default([]),
  itemApprovedQuotations: Joi.array().items(itemApprovedQuotation).default([]),
  approvedVendors: Joi.array().items(approvedVendor).default([]),
  actualAt:   Joi.date().allow('', null),
  remarks:    Joi.string().trim().max(1000).allow('', null),
});

// ── List query ───────────────────────────────────────────────
export const indentQuerySchema = Joi.object({
  page:           Joi.number().integer().min(1),
  limit:          Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:           Joi.string(),
  fields:         Joi.string(),
  search:         Joi.string().max(120),
  searchFields:   Joi.string(),
  approvalStatus: Joi.string().valid(...Object.values(INDENT_APPROVAL_STATUS)),
  overallStatus:  Joi.string().valid(...Object.values(INDENT_OVERALL_STATUS)),
  department:     Joi.string().max(80),
  populate:       Joi.string(),
  timestamp:      Joi.object().unknown(true), // supports timestamp[gte]/[lte] date range
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
