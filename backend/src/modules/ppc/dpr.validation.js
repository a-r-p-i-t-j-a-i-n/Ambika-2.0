import Joi from 'joi';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);
const ymd = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}/); // accept date or datetime prefix
const hhmm = Joi.string().pattern(/^\d{1,2}:\d{2}$/).allow('', null);

const hourly = Joi.object({
  slot: Joi.string().required(),
  qty: Joi.number().min(0).default(0),
});
const reasonMinutes = Joi.object({
  reason: Joi.string().required(),
  minutes: Joi.number().min(0).default(0),
});
const defect = Joi.object({
  type: Joi.string().required(),
  qty: Joi.number().min(0).default(0),
});

// Shared body shape for create + update (update merges onto the existing doc).
const dprBody = {
  date: ymd,
  shift: Joi.string().max(4).allow('', null),
  machineCode: Joi.string().max(40).allow('', null),
  machineType: Joi.string().max(80).allow('', null),
  operatorName: Joi.string().max(120).allow('', null),
  skuCode: Joi.string().max(60).allow('', null),
  skuName: Joi.string().max(160).allow('', null),
  operationNo: Joi.number().min(0).allow(null),
  operationName: Joi.string().max(120).allow('', null),
  operationLabel: Joi.string().max(160).allow('', null),
  isLastOperation: Joi.boolean(),
  dieNo: Joi.string().max(120).allow('', null),
  coilNo: Joi.string().max(120).allow('', null),
  circleSize: Joi.string().max(120).allow('', null),
  startTime: hhmm,
  stopTime: hhmm,
  availableMinutes: Joi.number().min(0).allow(null),
  hourly: Joi.array().items(hourly),
  strokes: Joi.number().min(0),
  toolBreakdownMinutes: Joi.number().min(0),
  plannedItems: Joi.array().items(reasonMinutes),
  downtimeItems: Joi.array().items(reasonMinutes),
  defectItems: Joi.array().items(defect),
  reworkQty: Joi.number().min(0),
  spm: Joi.number().min(0).allow(null),
  cavity: Joi.number().min(1).allow(null),
  partRate: Joi.number().min(0).allow(null),
  rmConsumedKg: Joi.number().min(0),
  circleWeightKg: Joi.number().min(0),
  materialGrade: Joi.string().max(120).allow('', null),
  remarks: Joi.string().max(1000).allow('', null),
};

export const dprCreateSchema = Joi.object({
  ...dprBody,
  machineCode: Joi.string().max(40).required(),
  skuCode: Joi.string().max(60).required(),
  date: ymd.required(),
}).unknown(true);

export const dprUpdateSchema = Joi.object(dprBody).min(1).unknown(true);

export const dprListQuerySchema = Joi.object({
  from: ymd, to: ymd,
  machineCode: Joi.string().max(40).allow('', null),
  operatorName: Joi.string().max(120).allow('', null),
  skuCode: Joi.string().max(60).allow('', null),
  shift: Joi.string().max(4).allow('', null),
  search: Joi.string().max(120).allow('', null),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(1000),
}).unknown(true);

export const dprIdParamSchema = Joi.object({ id: objectId.required() });

// Masters
export const masterKindParamSchema = Joi.object({
  kind: Joi.string().valid('machine', 'operator', 'processRoute', 'die').required(),
});
export const masterKindIdParamSchema = Joi.object({
  kind: Joi.string().valid('machine', 'operator', 'processRoute', 'die').required(),
  id: objectId.required(),
});
export const masterListQuerySchema = Joi.object({
  search: Joi.string().max(120).allow('', null),
  skuCode: Joi.string().max(60).allow('', null),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(2000),
}).unknown(true);
