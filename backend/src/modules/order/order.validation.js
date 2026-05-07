import Joi from 'joi';
import { PAGINATION } from '../../config/constants.js';

const orderItemJoi = Joi.object({
  skuId:         Joi.string().required(),
  skuName:       Joi.string().required().max(200),
  skuCode:       Joi.string().required().max(30),
  orderQty:      Joi.number().integer().min(1).required(),
  dispatchedQty: Joi.number().integer().min(0).default(0),
  asnCode:       Joi.string().max(50).allow('', null),
  remark:        Joi.string().max(200).allow('', null),
});

const workflowStepJoi = Joi.object({
  planned:   Joi.date().allow(null),
  actual:    Joi.date().allow(null),
  status:    Joi.string().valid('PENDING','YES','DONE','DELAYED','SKIPPED'),
  link:      Joi.string().uri().allow('', null),
  timeDelay: Joi.string().allow('', null),
});

export const createOrderSchema = Joi.object({
  soNumber:       Joi.string().trim(), // optional — auto-generated if blank
  poNumber:       Joi.string().trim().required(),
  poDate:         Joi.date().allow(null),
  partyId:        Joi.string().required(),
  partyName:      Joi.string().trim().max(200),
  location:       Joi.string().trim().max(100).allow('', null),
  orderDate:      Joi.date().required(),
  receivedAt:     Joi.date().default(Date.now),
  financialYear:  Joi.string().trim(),
  transport:      Joi.string().trim().max(50).default('Road'),
  partyGroup:     Joi.string().trim().max(100).allow('', null),
  orderDocument:  Joi.string().allow('', null),
  leadTimeDays:   Joi.number().integer().min(0).default(7),
  status:         Joi.string().valid('RECEIVED','PLANNING','IN_PROGRESS','COMPLETED','SHORT_CLOSED','CANCELLED'),
  items:          Joi.array().items(orderItemJoi).min(1).required(),
  saleOrderLink:  Joi.string().allow('', null),
});

export const updateOrderSchema = Joi.object({
  poNumber:       Joi.string().trim(),
  poDate:         Joi.date().allow(null),
  partyName:      Joi.string().trim().max(200),
  location:       Joi.string().trim().max(100).allow('', null),
  transport:      Joi.string().trim().max(50),
  partyGroup:     Joi.string().trim().max(100).allow('', null),
  orderDocument:  Joi.string().allow('', null),
  status:         Joi.string().valid('RECEIVED','PLANNING','IN_PROGRESS','COMPLETED','SHORT_CLOSED','CANCELLED'),
  items:          Joi.array().items(orderItemJoi),
  leadTimeDays:   Joi.number().integer().min(0),
  saleOrderLink:  Joi.string().allow('', null),
  remark:         Joi.string().allow('', null, '—'),
  // Workflow step updates
  poEntry:        workflowStepJoi,
  inventoryCheck: workflowStepJoi,
  paymentCheck:   workflowStepJoi,
  ocEntry:        workflowStepJoi,
  scheduling:     workflowStepJoi.append({ cancelLink: Joi.string().allow('', null) }),
  emailSchedule:  workflowStepJoi.append({
    pdfLink:       Joi.string().allow('', null),
    emailStatus:   Joi.string().allow('', null),
    printableLink: Joi.string().allow('', null),
  }),
  productionFollowUp: workflowStepJoi,
  loadingAdvice:      workflowStepJoi,
  loadingFollowUp:    workflowStepJoi,
  invoicing:          workflowStepJoi,
  dispatchDetails:    workflowStepJoi,
  podFollowUp:        workflowStepJoi,
  paymentFollowUp:    workflowStepJoi,
}).min(1).unknown(true);

export const mongoIdParamSchema = Joi.object({
  id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

export const partyIdParamSchema = Joi.object({
  partyId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});

export const orderQuerySchema = Joi.object({
  page:           Joi.number().integer().min(1),
  limit:          Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:           Joi.string(),
  fields:         Joi.string(),
  search:         Joi.string().max(100),
  searchFields:   Joi.string(),
  status:         Joi.string(),
  partyId:        Joi.string(),
  financialYear:  Joi.string(),
  month:          Joi.string(),
  populate:       Joi.string(),
  'orderDate[gte]': Joi.date(),
  'orderDate[lte]': Joi.date(),
}).unknown(true);
