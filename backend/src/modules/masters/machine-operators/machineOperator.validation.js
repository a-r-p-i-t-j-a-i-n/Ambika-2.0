import Joi from 'joi';
import { PAGINATION } from '../../../config/constants.js';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

/**
 * The source sheet gives operators a name and a department and nothing else —
 * no employee code, no shift, no status. `code` and `shift` are carried because
 * the pre-existing Operator model already had them and the DPR screen writes
 * them; neither is invented here and both stay optional.
 *
 * `machineCodes` is deliberately absent: it is a derived mirror of the
 * assignment collection, and the service discards any inbound value.
 */
export const createMachineOperatorSchema = Joi.object({
  name:        Joi.string().required().trim().min(2).max(120),
  code:        Joi.string().uppercase().trim().max(40).allow('', null),
  department:  Joi.string().trim().max(100).allow('', null),
  departments: Joi.array().items(Joi.string().trim().max(100)),
  shift:       Joi.string().trim().max(40).allow('', null),
  isActive:    Joi.boolean().default(true),

  remarks: Joi.string().trim().max(1000).allow('', null),
  notes:   Joi.string().trim().max(1000).allow('', null),

  /** Optional: assign machines at create/edit time, in one round trip. */
  machineIds: Joi.array().items(objectId),
});

export const updateMachineOperatorSchema = createMachineOperatorSchema.fork(
  ['name'],
  (schema) => schema.optional(),
);

export const machineOperatorQuerySchema = Joi.object({
  page:         Joi.number().integer().min(1),
  limit:        Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT),
  sort:         Joi.string(),
  fields:       Joi.string(),
  search:       Joi.string().max(100),
  searchFields: Joi.string(),
  department:   Joi.string(),
  shift:        Joi.string(),
  isActive:     Joi.boolean(),
  populate:     Joi.string(),
});

export const machineOperatorLookupQuerySchema = Joi.object({
  search:          Joi.string().max(100),
  limit:           Joi.number().integer().min(1).max(2000),
  includeInactive: Joi.string().valid('true', 'false'),
});

export const assignMachineSchema = Joi.object({
  machineId: objectId.required(),
});

export const mongoIdParamSchema = Joi.object({
  id: objectId.required(),
});

export const operatorMachineParamSchema = Joi.object({
  id: objectId.required(),
  machineId: objectId.required(),
});
