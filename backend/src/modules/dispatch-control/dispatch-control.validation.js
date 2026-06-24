import Joi from 'joi';
import { PAGINATION } from '../../config/constants.js';

const optionalString = Joi.string().trim().allow('', null);

const orderItemSchema = Joi.object({
  skuId: optionalString,
  skuName: optionalString,
  itemName: optionalString,
  skuCode: optionalString,
  orderQty: Joi.number().min(0),
  quantity: Joi.number().min(0),
  dispatchedQty: Joi.number().min(0).default(0),
  totalDispatchQty: Joi.number().min(0),
  asnCode: optionalString,
  fciCode: optionalString,
  asnFciCode: optionalString,
  remark: optionalString,
  remarks: optionalString,
}).or('skuName', 'itemName', 'skuCode').or('orderQty', 'quantity');

const planLineSchema = Joi.object({
  orderItemId: optionalString,
  itemId: optionalString,
  skuCode: optionalString,
  skuName: optionalString,
  itemName: optionalString,
  phaseId: optionalString,           // edit-existing-phase support
  phaseNo: optionalString,
  planType: optionalString,
  dispatchPlanType: optionalString,
  plannedDate: Joi.date(),
  planDate: Joi.date(),
  date: Joi.date(),
  plannedQty: Joi.number().min(0),
  planQty: Joi.number().min(0),
  qty: Joi.number().min(0),
  notes: optionalString,
}).or('skuCode', 'skuName', 'itemName', 'orderItemId', 'itemId').or('plannedDate', 'planDate', 'date').or('plannedQty', 'planQty', 'qty');

const dispatchItemSchema = Joi.object({
  orderItemId: optionalString,
  itemId: optionalString,
  skuCode: optionalString,
  skuName: optionalString,
  itemName: optionalString,
  quantityPcs: Joi.number().min(0),
  actualQty: Joi.number().min(0),
  dispatchQty: Joi.number().min(0),
  qty: Joi.number().min(0),
  noOfBoxes: Joi.number().min(0),
  pcsPerBox: Joi.number().min(1),
  weightKg: Joi.number().min(0),
  weightKgs: Joi.number().min(0),
}).or('skuCode', 'skuName', 'itemName', 'orderItemId', 'itemId').or('quantityPcs', 'actualQty', 'dispatchQty', 'qty');

const objectIdString = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const phaseRefSchema = Joi.object({
  scheduleId: objectIdString,
  itemId:     objectIdString,
  phaseId:    objectIdString.required(),
  phaseNo:    optionalString,
});

// Multi-phase: a DC may fulfil several plan phases. Each ref needs at least a
// phaseNo (the cross-SKU group) — phaseId is optional since matching is by phaseNo.
const phaseRefMultiSchema = Joi.object({
  phaseId: objectIdString,
  phaseNo: Joi.string().trim().required(),
});

export const orderEntrySchema = Joi.object({
  soNumber: optionalString,
  poNumber: Joi.string().trim().required(),
  poDate: Joi.date().allow(null),
  partyId: optionalString,
  partyName: optionalString,
  clientName: optionalString,
  customerName: optionalString,
  location: optionalString,
  place: optionalString,
  state: optionalString,
  email: optionalString,
  clientEmail: optionalString,
  phone: optionalString,
  contactPerson: optionalString,
  gstNo: optionalString,
  orderDate: Joi.date().default(Date.now),
  receivedAt: Joi.date(),
  financialYear: optionalString,
  transport: optionalString,
  transportMode: optionalString,
  partyGroup: optionalString,
  orderDocument: optionalString,
  orderDocumentUrl: optionalString,
  orderDocumentName: optionalString,
  leadTimeDays: Joi.number().integer().min(0),
  creditPeriodDays: Joi.number().integer().min(0),
  status: optionalString,
  remark: optionalString,
  remarks: optionalString,
  addresses: Joi.array().items(Joi.object().unknown(true)),
  items: Joi.array().items(orderItemSchema).min(1).required(),
  intakeId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).allow(null), // set when converting from an Order Intake
}).or('partyId', 'partyName', 'clientName', 'customerName');

export const planDispatchSchema = Joi.object({
  soNumber: Joi.string().trim().required(),
  status: optionalString,
  pdfUrl: optionalString,
  allowOverPlan: Joi.boolean().default(false),
  planLines: Joi.array().items(planLineSchema).min(1),
  items: Joi.array().items(planLineSchema).min(1),
}).or('planLines', 'items');

export const actualDispatchSchema = Joi.object({
  soNumber: Joi.string().trim().required(),
  dcNumber: optionalString,
  dcDate: Joi.date(),
  challanDate: Joi.date(),
  poNumber: optionalString,
  partyName: optionalString,
  vehicleNo: optionalString,
  vehicleNumber: optionalString,
  transportMode: optionalString,
  transporterName: optionalString,
  clientEmail: optionalString,
  invoiceNo: optionalString,
  dispatchedThrough: optionalString,
  deliveryAddress: optionalString,
  pdfUrl: optionalString,
  sendEmail: Joi.boolean(),
  emailStatus: optionalString,
  remark: optionalString,
  remarks: optionalString,
  status: optionalString,
  // The dispatcher MUST pick a phase (single phaseRef OR multiple phaseRefs) OR
  // explicitly flag the DC as unplanned.
  phaseRef: phaseRefSchema,
  phaseRefs: Joi.array().items(phaseRefMultiSchema),
  isUnplanned: Joi.boolean().default(false),
  items: Joi.array().items(dispatchItemSchema).min(1).required(),
}).or('phaseRef', 'phaseRefs', 'isUnplanned');

export const soNumberParamSchema = Joi.object({
  soNumber: Joi.string().trim().required(),
});

// Email the dispatch schedule to the client (Step 2.5).
export const emailScheduleSchema = Joi.object({
  soNumber: optionalString,
  to:       Joi.string().trim().required(),
  subject:  optionalString,
  message:  Joi.string().allow('', null),
  attachments: Joi.array().items(Joi.object({
    fileName: optionalString,
    fileUrl:  optionalString,
    fileKey:  optionalString,
  }).unknown(true)).default([]),
});

export const dashboardQuerySchema = Joi.object({
  from: Joi.date(),
  to: Joi.date(),
  partyId: optionalString,
  status: optionalString,
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
}).unknown(true);

export const normalizeRowsSchema = Joi.object({
  rows: Joi.array().items(Joi.object().unknown(true)).required(),
});

const phaseSkuLineSchema = Joi.object({
  orderItemId: optionalString,
  skuCode: optionalString,
  skuName: optionalString,
  plannedQty: Joi.number().min(0).required(),
});

export const createPhaseSchema = Joi.object({
  plannedDate: Joi.date().required(),
  notes: optionalString,
  status: Joi.string().valid('PLANNED', 'IN_PROGRESS', 'DISPATCHED', 'DELAYED', 'CANCELLED'),
  // Either provide explicit lines OR ask the server to auto-fill from balance.
  autoFillFromBalance: Joi.boolean().default(false),
  allowOverPlan: Joi.boolean().default(false),
  lines: Joi.array().items(phaseSkuLineSchema),
});

export const updatePhaseSchema = Joi.object({
  plannedDate: Joi.date(),
  notes: optionalString,
  status: Joi.string().valid('PLANNED', 'IN_PROGRESS', 'DISPATCHED', 'DELAYED', 'CANCELLED'),
  allowOverPlan: Joi.boolean().default(false),
  lines: Joi.array().items(phaseSkuLineSchema),
}).min(1);

export const phaseParamSchema = Joi.object({
  soNumber: Joi.string().trim().required(),
  phaseId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
});
