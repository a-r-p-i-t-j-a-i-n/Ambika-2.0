/**
 * Machine ↔ Operator assignment — the authoritative many-to-many relationship.
 *
 * A machine can have many operators (HYP02 has 7, C05 has 8) and an operator can
 * run many machines (Appoo runs DAP01 and HYP04), so the link is its own record
 * rather than an array on either master. That gives every assignment an id,
 * timestamps and the standard createdBy/deletedBy audit stamps.
 *
 * Removing an assignment never touches either master: an operator who leaves a
 * machine keeps existing, and a machine that is retired keeps its identity and
 * its history (see MACHINE_STATUSES.SCRAP).
 *
 * `machineCode` is denormalised off the machine so the DPR-shaped lookups that
 * work in codes don't need a join; machine.service keeps it in step when a code
 * is edited.
 */
import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

const MachineOperatorAssignmentSchema = new Schema({
  ...baseSchemaFields,

  machineId:   { type: Schema.Types.ObjectId, ref: 'Machine', required: true },
  operatorId:  { type: Schema.Types.ObjectId, ref: 'Operator', required: true },
  machineCode: { type: String, required: true, uppercase: true, trim: true },

  assignedAt: { type: Date, default: Date.now },
}, baseSchemaOptions);

/**
 * One live assignment per (machine, operator). Partial on isDeleted:false so a
 * pair can be unassigned and later re-assigned without tripping the index —
 * the soft-deleted row stays as history.
 */
MachineOperatorAssignmentSchema.index(
  { machineId: 1, operatorId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
MachineOperatorAssignmentSchema.index({ machineId: 1, isDeleted: 1 });
MachineOperatorAssignmentSchema.index({ operatorId: 1, isDeleted: 1 });
MachineOperatorAssignmentSchema.index({ machineCode: 1 });
MachineOperatorAssignmentSchema.index({ companyId: 1 });

const MachineOperatorAssignment = model('MachineOperatorAssignment', MachineOperatorAssignmentSchema);
export default MachineOperatorAssignment;
