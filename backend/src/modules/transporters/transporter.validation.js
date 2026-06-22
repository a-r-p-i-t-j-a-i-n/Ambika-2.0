import Joi from 'joi';
import { PAGINATION } from '../../config/constants.js';

export const createTransporterSchema = Joi.object({
  code:          Joi.string().uppercase().trim().max(20),
  name:          Joi.string().required().trim().min(2).max(200),
  contactPerson: Joi.string().trim().max(100).allow('', null),
  phone:         Joi.string().trim().max(30).allow('', null),
  altPhone:      Joi.string().trim().max(30).allow('', null),
  email:         Joi.string().email({ tlds: false }).trim().allow('', null),
  address:       Joi.string().trim().max(500).allow('', null),
  city:          Joi.string().trim().max(100).allow('', null),
  state:         Joi.string().trim().max(50).allow('', null),
  pin:           Joi.string().trim().max(10).allow('', null),
  gstNo:         Joi.string().trim().max(20).allow('', null),
  panNo:         Joi.string().trim().max(20).allow('', null),
  modes:         Joi.array().items(Joi.string().trim().max(40)).default([]),
  vehicleTypes:  Joi.array().items(Joi.string().trim().max(40)).default([]),
  serviceArea:   Joi.string().trim().max(200).allow('', null),
  remarks:       Joi.string().trim().max(500).allow('', null),
  isActive:      Joi.boolean().default(true),
});

export const updateTransporterSchema = createTransporterSchema.fork(['name'], (s) => s.optional());

export const transporterQuerySchema = Joi.object({
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
