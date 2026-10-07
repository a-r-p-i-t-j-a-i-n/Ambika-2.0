import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';
import { MACHINE_STATUSES, YES_NO } from './machine.model.js';
import { MACHINE_TYPES } from './machineType.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

/**
 * Installation years in the source run 2010–2026. The upper bound is "this
 * year" — a machine cannot be installed in the future — with 1900 as a floor.
 */
const currentYear = () => new Date().getFullYear();

export const createMachineSchema = Joi.object({
  code: Joi.string().required().uppercase().trim().max(40),
  name: Joi.string().required().trim().min(2).max(200),

  machineType: Joi.string().valid(...MACHINE_TYPES),   // omitted → derived from the code prefix
  department:  Joi.string().trim().max(100).allow('', null),
  make:        Joi.string().trim().max(100).allow('', null),

  capacity:         Joi.string().trim().max(60).allow('', null),
  installationYear: Joi.number().integer().min(1900).max(currentYear()).allow(null),

  machineStatus: Joi.string().valid(...MACHINE_STATUSES).default('IN_USE'),

  amc:                   Joi.string().valid(...YES_NO).allow(null).default(''),
  maintenanceManual:     Joi.string().valid(...YES_NO).allow(null).default(''),
  maintenanceManualType: Joi.string().trim().max(120).allow('', null),
  dailyClitSheet:        Joi.boolean().default(false),
  dailyClitLink:         Joi.string().trim().uri().max(600).allow('', null),
  halfYearlyPm:          Joi.boolean().default(false),
  halfYearlyPmLink:      Joi.string().trim().uri().max(600).allow('', null),

  defaultSpm: Joi.number().min(0).default(0),

  remarks: Joi.string().trim().max(1000).allow('', null),
  notes:   Joi.string().trim().max(1000).allow('', null),

  /** Optional: assign operators at create/edit time, in one round trip. */
  operatorIds: Joi.array().items(objectId),
});

export const updateMachineSchema = createMachineSchema.fork(
  ['code', 'name'],
  (schema) => schema.optional(),
);

export const machineQuerySchema = Joi.object({
  page:          Joi.number().integer().min(1),
  limit:         Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:          Joi.string(),
  fields:        Joi.string(),
  search:        Joi.string().max(100),
  searchFields:  Joi.string(),
  machineStatus: Joi.string().valid(...MACHINE_STATUSES),
  machineType:   Joi.string().valid(...MACHINE_TYPES),
  department:    Joi.string(),
  isActive:      Joi.boolean(),
  populate:      Joi.string(),
});

export const machineLookupQuerySchema = Joi.object({
  search:          Joi.string().max(100),
  limit:           Joi.number().integer().min(1).max(2000),
  includeInactive: Joi.string().valid('true', 'false'),
});

export const assignOperatorSchema = Joi.object({
  operatorId: objectId.required(),
});

export const mongoIdParamSchema = Joi.object({
  id: objectId.required(),
});

export const machineOperatorParamSchema = Joi.object({
  id: objectId.required(),
  operatorId: objectId.required(),
});
