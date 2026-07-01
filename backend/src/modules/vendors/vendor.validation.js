import Joi from 'joi';
import { PAGINATION } from '../../config/constants.js';

export const createVendorSchema = Joi.object({
  code:             Joi.string().uppercase().trim().max(20),
  name:             Joi.string().required().trim().min(2).max(200),
  contactPerson:    Joi.string().trim().max(100).allow('', null),
  phone:            Joi.string().trim().max(30).allow('', null),
  // Plain string (not strict .email()) — vendors legitimately store multiple
  // comma-separated contact emails (e.g. "a@x.com,b@x.com").
  email:            Joi.string().trim().max(200).allow('', null),
  address:          Joi.string().trim().max(500).allow('', null),
  location:         Joi.string().trim().max(150).allow('', null),
  state:            Joi.string().trim().max(50).allow('', null),

  gstNo:            Joi.string().trim().max(20).allow('', null),
  panNo:            Joi.string().trim().max(20).allow('', null),
  gstRate:          Joi.number().min(0).max(100).default(0),
  tdsRate:          Joi.number().min(0).max(100).default(0),
  creditPeriodDays: Joi.number().integer().min(0).max(365).default(0),

  toEmails:         Joi.array().items(Joi.string().trim().lowercase()).default([]),
  ccEmails:         Joi.array().items(Joi.string().trim().lowercase()).default([]),
  bccEmails:        Joi.array().items(Joi.string().trim().lowercase()).default([]),

  products: Joi.array().items(Joi.object({
    _id:         Joi.string().optional(),
    skuId:       Joi.string().regex(/^[0-9a-fA-F]{24}$/).allow('', null),
    productName: Joi.string().trim().max(200).allow('', null),
    skuCode:     Joi.string().trim().max(50).allow('', null),
    unit:        Joi.string().trim().max(20).allow('', null).default('Pcs'),
    rate:        Joi.number().min(0).default(0),
    gstRate:     Joi.number().min(0).max(100).default(0),
    hsn:         Joi.string().trim().max(20).allow('', null),
    notes:       Joi.string().trim().max(200).allow('', null),
  })).default([]),

  isActive: Joi.boolean().default(true),
});

export const updateVendorSchema = createVendorSchema.fork(['name'], (schema) => schema.optional());

export const vendorQuerySchema = Joi.object({
  page:         Joi.number().integer().min(1),
  limit:        Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:         Joi.string(),
  fields:       Joi.string(),
  search:       Joi.string().max(100),
  searchFields: Joi.string(),
  isActive:     Joi.boolean(),
  populate:     Joi.string(),
});

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

// Add / upsert a single product on a vendor's catalog (POST /vendors/:id/products).
// Used by the New PO "Add Vendor for this Item" flow — ensures the SKU exists on
// the vendor and records pricing history when the rate/GST is new or changed.
export const addVendorProductSchema = Joi.object({
  skuId:       Joi.string().regex(/^[0-9a-fA-F]{24}$/).allow('', null),
  skuCode:     Joi.string().trim().max(50).required(),
  productName: Joi.string().trim().max(200).required(),
  unit:        Joi.string().trim().max(20).required(),
  rate:        Joi.number().min(0).required(),
  gstRate:     Joi.number().min(0).max(100).required(),
  hsn:         Joi.string().trim().max(20).allow('', null),
  notes:       Joi.string().trim().max(300).allow('', null),
  remarks:     Joi.string().trim().max(300).allow('', null),
  effectiveDate: Joi.date().optional(),
});

// Manual Vendor-Master rate change (POST /vendors/:id/pricing-history).
export const addPricingHistorySchema = Joi.object({
  skuId:    Joi.string().regex(/^[0-9a-fA-F]{24}$/).allow('', null),
  skuCode:  Joi.string().trim().max(50).allow('', null),
  itemName: Joi.string().trim().max(200).allow('', null),
  rate:     Joi.number().min(0),
  gstRate:  Joi.number().min(0).max(100),
  hsn:      Joi.string().trim().max(20).allow('', null),
  unit:     Joi.string().trim().max(20).allow('', null),
  effectiveDate: Joi.date().optional(),
  remarks:  Joi.string().trim().max(300).allow('', null),
}).or('rate', 'gstRate').or('skuCode', 'skuId');
