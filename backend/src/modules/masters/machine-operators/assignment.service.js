/**
 * Machine ↔ Operator assignment service.
 *
 * Both sides of the relationship route through here — POST /machines/:id/operators
 * and POST /machine-operators/:id/machines call the same assign(), so there is
 * one duplicate check and one mirror-sync no matter which screen initiated it.
 *
 * The mirror: Operator.machineCodes is a read-only projection of this collection
 * that PPC's DPR form depends on (dprMaster.service.getFormOptions filters
 * operators by it). syncOperatorMachineCodes() is the ONLY writer of that field.
 */
import mongoose from 'mongoose';
import Machine from '../machines/machine.model.js';
import Operator from './machineOperator.model.js';
import MachineOperatorAssignment from './machineOperatorAssignment.model.js';
import { AppError } from '../../../utils/apiResponse.js';

const live = { isDeleted: { $ne: true } };

/** Recompute an operator's machineCodes mirror from its live assignments. */
export const syncOperatorMachineCodes = async (operatorId) => {
  const rows = await MachineOperatorAssignment
    .find({ operatorId, isDeleted: { $ne: true } })
    .select('machineCode')
    .sort({ machineCode: 1 })
    .lean();
  const codes = [...new Set(rows.map((r) => r.machineCode).filter(Boolean))];
  await Operator.updateOne({ _id: operatorId }, { $set: { machineCodes: codes } });
  return codes;
};

/** Resolve-or-throw helpers, so both route families produce identical errors. */
const mustFindMachine = async (machineId) => {
  if (!mongoose.isValidObjectId(machineId)) throw new AppError('Invalid machine id', 422);
  const machine = await Machine.findOne({ _id: machineId, ...live });
  if (!machine) throw new AppError('Machine not found', 404);
  return machine;
};

const mustFindOperator = async (operatorId) => {
  if (!mongoose.isValidObjectId(operatorId)) throw new AppError('Invalid operator id', 422);
  const operator = await Operator.findOne({ _id: operatorId, ...live });
  if (!operator) throw new AppError('Machine operator not found', 404);
  return operator;
};

export const assignmentService = {
  syncOperatorMachineCodes,
  mustFindMachine,
  mustFindOperator,

  /**
   * Link one operator to one machine. A duplicate is rejected with 409 rather
   * than silently creating a second row; a previously unassigned pair is revived
   * so the history stays on one record.
   */
  async assign(machineId, operatorId, userId) {
    const [machine, operator] = await Promise.all([
      mustFindMachine(machineId),
      mustFindOperator(operatorId),
    ]);

    const existing = await MachineOperatorAssignment.findOne({
      machineId: machine._id,
      operatorId: operator._id,
    });

    if (existing && existing.isDeleted !== true) {
      throw new AppError(`${operator.name} is already assigned to ${machine.code}`, 409);
    }

    let assignment;
    if (existing) {
      existing.isDeleted = false;
      existing.isActive = true;
      existing.deletedAt = null;
      existing.deletedBy = null;
      existing.machineCode = machine.code;
      existing.assignedAt = new Date();
      existing.updatedBy = userId;
      assignment = await existing.save();
    } else {
      assignment = await MachineOperatorAssignment.create({
        machineId: machine._id,
        operatorId: operator._id,
        machineCode: machine.code,
        createdBy: userId,
        updatedBy: userId,
      });
    }

    await syncOperatorMachineCodes(operator._id);
    return assignment.toObject ? assignment.toObject() : assignment;
  },

  /**
   * Break the link only. Neither master is touched — an operator who leaves a
   * machine keeps existing, and vice versa.
   */
  async unassign(machineId, operatorId, userId) {
    const [machine, operator] = await Promise.all([
      mustFindMachine(machineId),
      mustFindOperator(operatorId),
    ]);

    const assignment = await MachineOperatorAssignment.findOne({
      machineId: machine._id,
      operatorId: operator._id,
      isDeleted: { $ne: true },
    });
    if (!assignment) {
      throw new AppError(`${operator.name} is not assigned to ${machine.code}`, 404);
    }

    assignment.isDeleted = true;
    assignment.isActive = false;
    assignment.deletedAt = new Date();
    assignment.deletedBy = userId;
    await assignment.save();

    await syncOperatorMachineCodes(operator._id);
    return { machineId: machine._id, operatorId: operator._id, unassigned: true };
  },

  /** Replace a machine's whole operator set in one call (used by the edit drawer). */
  async setOperatorsForMachine(machineId, operatorIds, userId) {
    const machine = await mustFindMachine(machineId);
    const wanted = [...new Set((operatorIds || []).map(String))];

    const current = await MachineOperatorAssignment
      .find({ machineId: machine._id, isDeleted: { $ne: true } })
      .select('operatorId')
      .lean();
    const currentIds = current.map((a) => String(a.operatorId));

    const toAdd = wanted.filter((id) => !currentIds.includes(id));
    const toRemove = currentIds.filter((id) => !wanted.includes(id));

    for (const operatorId of toAdd) await this.assign(machine._id, operatorId, userId);
    for (const operatorId of toRemove) await this.unassign(machine._id, operatorId, userId);

    return { added: toAdd.length, removed: toRemove.length };
  },

  /** Replace an operator's whole machine set in one call. */
  async setMachinesForOperator(operatorId, machineIds, userId) {
    const operator = await mustFindOperator(operatorId);
    const wanted = [...new Set((machineIds || []).map(String))];

    const current = await MachineOperatorAssignment
      .find({ operatorId: operator._id, isDeleted: { $ne: true } })
      .select('machineId')
      .lean();
    const currentIds = current.map((a) => String(a.machineId));

    const toAdd = wanted.filter((id) => !currentIds.includes(id));
    const toRemove = currentIds.filter((id) => !wanted.includes(id));

    for (const machineId of toAdd) await this.assign(machineId, operator._id, userId);
    for (const machineId of toRemove) await this.unassign(machineId, operator._id, userId);

    return { added: toAdd.length, removed: toRemove.length };
  },

  /** Operators currently on a machine, shaped for the detail panel. */
  async listOperatorsForMachine(machineId) {
    const rows = await MachineOperatorAssignment
      .find({ machineId, isDeleted: { $ne: true } })
      .populate('operatorId', 'name code department shift isActive')
      .sort({ assignedAt: 1 })
      .lean();
    return rows
      .filter((r) => r.operatorId)
      .map((r) => ({
        assignmentId: r._id,
        assignedAt: r.assignedAt,
        _id: r.operatorId._id,
        name: r.operatorId.name,
        code: r.operatorId.code,
        department: r.operatorId.department,
        shift: r.operatorId.shift,
        isActive: r.operatorId.isActive,
      }));
  },

  /** Machines an operator currently runs, shaped for the detail panel. */
  async listMachinesForOperator(operatorId) {
    const rows = await MachineOperatorAssignment
      .find({ operatorId, isDeleted: { $ne: true } })
      .populate('machineId', 'code name machineType department machineStatus isActive')
      .sort({ machineCode: 1 })
      .lean();
    return rows
      .filter((r) => r.machineId)
      .map((r) => ({
        assignmentId: r._id,
        assignedAt: r.assignedAt,
        _id: r.machineId._id,
        code: r.machineId.code,
        name: r.machineId.name,
        machineType: r.machineId.machineType,
        department: r.machineId.department,
        machineStatus: r.machineId.machineStatus,
      }));
  },

  /** { machineId -> count } for a page of machines, for the list count column. */
  async countsByMachine(machineIds) {
    if (!machineIds?.length) return {};
    const ids = machineIds.map((id) => new mongoose.Types.ObjectId(String(id)));
    const rows = await MachineOperatorAssignment.aggregate([
      { $match: { machineId: { $in: ids }, isDeleted: { $ne: true } } },
      { $group: { _id: '$machineId', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [String(r._id), r.count]));
  },

  /** { operatorId -> count } for a page of operators. */
  async countsByOperator(operatorIds) {
    if (!operatorIds?.length) return {};
    const ids = operatorIds.map((id) => new mongoose.Types.ObjectId(String(id)));
    const rows = await MachineOperatorAssignment.aggregate([
      { $match: { operatorId: { $in: ids }, isDeleted: { $ne: true } } },
      { $group: { _id: '$operatorId', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [String(r._id), r.count]));
  },

  /**
   * A machine's code changed — carry it into the denormalised column and
   * refresh every affected operator's mirror.
   */
  async propagateMachineCode(machineId, newCode) {
    const code = String(newCode || '').trim().toUpperCase();
    const rows = await MachineOperatorAssignment
      .find({ machineId, isDeleted: { $ne: true } })
      .select('operatorId')
      .lean();
    if (!rows.length) return 0;
    await MachineOperatorAssignment.updateMany({ machineId }, { $set: { machineCode: code } });
    for (const r of rows) await syncOperatorMachineCodes(r.operatorId);
    return rows.length;
  },

  /**
   * A machine was soft-deleted — drop its live links so it stops appearing on
   * operator screens, while the assignment rows survive as history.
   */
  async detachMachine(machineId, userId) {
    const rows = await MachineOperatorAssignment
      .find({ machineId, isDeleted: { $ne: true } })
      .select('operatorId')
      .lean();
    if (!rows.length) return 0;
    await MachineOperatorAssignment.updateMany(
      { machineId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, isActive: false, deletedAt: new Date(), deletedBy: userId } },
    );
    for (const r of rows) await syncOperatorMachineCodes(r.operatorId);
    return rows.length;
  },

  /** An operator was soft-deleted — same treatment from the other side. */
  async detachOperator(operatorId, userId) {
    const res = await MachineOperatorAssignment.updateMany(
      { operatorId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, isActive: false, deletedAt: new Date(), deletedBy: userId } },
    );
    await syncOperatorMachineCodes(operatorId);
    return res.modifiedCount || 0;
  },
};

export default assignmentService;
