import Joi from 'joi';
import { PAGINATION } from '../../config/constants.js';
import { MOVEMENT_TYPE, TXN_TYPE } from './inventoryMovement.model.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

// Manual stock adjustment.
export const adjustStockSchema = Joi.object({
  skuId:        objectId.required(),
  skuCode:      Joi.string().trim().max(60).allow('', null),
  skuName:      Joi.string().trim().max(200).allow('', null),
  warehouse:    Joi.string().trim().max(40).allow('', null),
  movementType: Joi.string().valid(...Object.values(MOVEMENT_TYPE)).default(MOVEMENT_TYPE.IN),
  quantity:     Joi.number().greater(0).required(),
  unitCost:     Joi.number().min(0).default(0),
  batchNo:      Joi.string().trim().max(60).allow('', null),
  remarks:      Joi.string().trim().max(1000).allow('', null),
});

export const stockQuerySchema = Joi.object({
  page:      Joi.number().integer().min(1),
  limit:     Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:      Joi.string(),
  fields:    Joi.string(),
  search:    Joi.string().max(120),
  skuId:     objectId,
  warehouse: Joi.string().max(40),
}).unknown(true);

export const movementQuerySchema = Joi.object({
  page:         Joi.number().integer().min(1),
  limit:        Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:         Joi.string(),
  fields:       Joi.string(),
  search:       Joi.string().max(120),
  skuId:        objectId,
  warehouse:    Joi.string().max(40),
  txnType:      Joi.string().valid(...Object.values(TXN_TYPE)),
  sourceModule: Joi.string().max(40),
  refType:      Joi.string().max(40),
  refId:        objectId,
  movementDate: Joi.object().unknown(true),
}).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

export const refParamSchema = Joi.object({
  refType: Joi.string().max(40).required(),
  refId:   Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

/** One item's history page (/ims/ledger/:skuId, /fg-ims/ledger/:skuId). */
export const itemLedgerQuerySchema = Joi.object({
  page:  Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(200),
}).unknown(true);
