import Joi from 'joi';
import { PAGINATION } from '../../config/constants.js';

export const createSkuSchema = Joi.object({
  code:        Joi.string().required().uppercase().trim().max(30),
  name:        Joi.string().required().trim().min(2).max(200),
  category:    Joi.string().trim().max(100).default('General'),
  pcsPerBox:   Joi.number().integer().min(1).default(100),
  weightPerPc: Joi.number().min(0).default(0),
  fgStock:     Joi.number().integer().min(0).default(0),
  wipStock:    Joi.number().integer().min(0).default(0),
  bufferFG:    Joi.number().integer().min(0).default(0),
  bufferWIP:   Joi.number().integer().min(0).default(0),
  isActive:    Joi.boolean().default(true),
});

export const updateSkuSchema = createSkuSchema.fork(
  ['code', 'name'],
  (s) => s.optional(),
);

export const skuQuerySchema = Joi.object({
  page:         Joi.number().integer().min(1),
  limit:        Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:         Joi.string(),
  fields:       Joi.string(),
  search:       Joi.string().max(100),
  searchFields: Joi.string(),
  isActive:     Joi.boolean(),
  category:     Joi.string(),
  populate:     Joi.string(),
});

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
