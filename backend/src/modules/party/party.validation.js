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
