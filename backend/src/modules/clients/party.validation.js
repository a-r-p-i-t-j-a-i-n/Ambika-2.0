import Joi from 'joi';
import { PAGINATION } from '../../config/constants.js';

export const createPartySchema = Joi.object({
  code:              Joi.string().uppercase().trim().max(20),
  name:              Joi.string().required().trim().min(2).max(200),
  location:          Joi.string().trim().max(100).allow('', null),
  state:             Joi.string().trim().max(50).allow('', null),
  gstNo:             Joi.string().trim().max(20).allow('', null),
  contactPerson:     Joi.string().trim().max(100).allow('', null),
  email:             Joi.string().email().trim().allow('', null),
  phone:             Joi.string().trim().max(20).allow('', null),

  // Tax & financial (vendor)
  panNo:             Joi.string().trim().max(20).allow('', null),
  gstRate:           Joi.number().min(0).max(100).default(0),
  tdsRate:           Joi.number().min(0).max(100).default(0),

  toEmails:          Joi.array().items(Joi.string().email().lowercase().trim()).default([]),
  ccEmails:          Joi.array().items(Joi.string().email().lowercase().trim()).default([]),
  bccEmails:         Joi.array().items(Joi.string().email().lowercase().trim()).default([]),

  creditPeriodDays:  Joi.number().integer().min(0).max(365).default(30),
  leadTimeDays:      Joi.number().integer().min(0).max(90).default(7),
  addresses: Joi.array().items(Joi.object({
    label: Joi.string().max(50).default('Primary'),
    line1: Joi.string().max(300).allow('', null),
    line2: Joi.string().max(300).allow('', null),
    city:  Joi.string().max(100).allow('', null),
    state: Joi.string().max(50).allow('', null),
    pin:   Joi.string().max(10).allow('', null),
  })).default([]),

  // Procurement: products this party (vendor) supplies. Optional at the API
  // level for backward compatibility (parties are also auto-created by order
  // entry); the vendor form enforces "at least one product" on the client.
  suppliedProducts: Joi.array().items(Joi.object({
    _id:         Joi.string().optional(),
    skuId:       Joi.string().regex(/^[0-9a-fA-F]{24}$/).allow('', null),
    productName: Joi.string().trim().max(200).allow('', null),
    skuCode:     Joi.string().trim().max(50).allow('', null),
    rate:        Joi.number().min(0).default(0),
    unit:        Joi.string().trim().max(20).allow('', null).default('Pcs'),
  })).default([]),

  isActive: Joi.boolean().default(true),
});

export const updatePartySchema = createPartySchema.fork(
  ['name'],
  (schema) => schema.optional(),
);

export const partyQuerySchema = Joi.object({
  page:         Joi.number().integer().min(1),
  limit:        Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:         Joi.string(),
  fields:       Joi.string(),
  search:       Joi.string().max(100),
  searchFields: Joi.string(),
  isActive:     Joi.boolean(),
  location:     Joi.string(),
  state:        Joi.string(),
  populate:     Joi.string(),
});

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
