/**
 * Machine master service. Follows the parties pattern: object literal, ApiFeatures
 * for list/search/sort/paginate, AppError for operational failures, soft delete
 * filtered as { isDeleted: { $ne: true } }.
 */
import Machine, { MACHINE_STATUSES, deriveMachineFields } from './machine.model.js';
import { machineTypeFromCode } from './machineType.js';
import assignmentService from '../machine-operators/assignment.service.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';

const live = { isDeleted: { $ne: true } };

const normalizeCode = (code) => String(code || '').trim().toUpperCase();

/**
 * Machine Code is the natural key the whole floor works in, so a friendly 400
 * is raised before the driver's duplicate-key error can surface.
 */
const assertCodeFree = async (code, excludeId = null) => {
  const filter = { code: normalizeCode(code), ...live };
  if (excludeId) filter._id = { $ne: excludeId };
  const clash = await Machine.findOne(filter).select('_id code').lean();
  if (clash) throw new AppError(`Machine code '${normalizeCode(code)}' already exists`, 400);
};

export const machineService = {
  async create(data, userId) {
    const code = normalizeCode(data.code);
    if (!code) throw new AppError('Machine code is required', 400);
    await assertCodeFree(code);

    const machine = new Machine({
      ...data,
      code,
      machineType: data.machineType || machineTypeFromCode(code),
      createdBy: userId,
      updatedBy: userId,
      activityTimeline: [{ action: 'CREATE', description: 'Machine created', actorId: userId }],
    });
    await machine.save();   // pre-save derives uid / machineType / isActive / capacity parse

    if (data.operatorIds?.length) {
      await assignmentService.setOperatorsForMachine(machine._id, data.operatorIds, userId);
    }
    return this.getById(machine._id);
  },

  /**
   * List with the standard query contract, plus a statusCounts block the list
   * screen uses to drive its filter chips (mirrors itemTypeCounts on SKUs).
   */
  async getAll(query = {}) {
    const features = new ApiFeatures(Machine.find(live), query)
      .filter()
      .search(['code', 'name', 'uid', 'department', 'machineType', 'make'])
      .sort()
      .select()
      .paginate();

    const { docs, pagination } = await features.exec();

    const counts = await Machine.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $group: { _id: '$machineStatus', count: { $sum: 1 } } },
    ]);
    const statusCounts = Object.fromEntries(MACHINE_STATUSES.map((s) => [s, 0]));
    counts.forEach((c) => { if (c._id) statusCounts[c._id] = c.count; });

    const operatorCounts = await assignmentService.countsByMachine(docs.map((d) => d._id));
    const withCounts = docs.map((d) => ({ ...d, operatorCount: operatorCounts[String(d._id)] || 0 }));

    return {
      docs: withCounts,
      pagination: { ...pagination, statusCounts, allTotal: Object.values(statusCounts).reduce((a, b) => a + b, 0) },
    };
  },

  async getById(id) {
    const machine = await Machine.findOne({ _id: id, ...live }).lean();
    if (!machine) throw new AppError('Machine not found', 404);
    const operators = await assignmentService.listOperatorsForMachine(machine._id);
    return { ...machine, operators, operatorCount: operators.length };
  },

  /**
   * Every detail is editable. Changing the code carries into the denormalised
   * assignment column, and assignments are never dropped by an edit.
   */
  async update(id, data, userId) {
    const machine = await Machine.findOne({ _id: id, ...live });
    if (!machine) throw new AppError('Machine not found', 404);

    const codeChanged = data.code !== undefined && normalizeCode(data.code) !== machine.code;
    if (codeChanged) await assertCodeFree(data.code, machine._id);

    const { operatorIds, ...fields } = data;
    Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) machine[k] = v; });
    if (data.code !== undefined) machine.code = normalizeCode(data.code);
    machine.updatedBy = userId;
    Object.assign(machine, deriveMachineFields(machine.toObject()));
    machine.activityTimeline.push({ action: 'UPDATE', description: 'Machine updated', actorId: userId });
    await machine.save();

    if (codeChanged) await assignmentService.propagateMachineCode(machine._id, machine.code);
    if (operatorIds !== undefined) {
      await assignmentService.setOperatorsForMachine(machine._id, operatorIds, userId);
    }
    return this.getById(machine._id);
  },

  /**
   * Soft delete. The machine keeps its identity and its DPR history; only its
   * live operator links are detached.
   */
  async remove(id, userId) {
    const machine = await Machine.findOne({ _id: id, ...live });
    if (!machine) throw new AppError('Machine not found', 404);

    machine.isDeleted = true;
    machine.isActive = false;
    machine.deletedAt = new Date();
    machine.deletedBy = userId;
    machine.activityTimeline.push({ action: 'DELETE', description: 'Machine soft-deleted', actorId: userId });
    await machine.save({ validateBeforeSave: false });

    await assignmentService.detachMachine(machine._id, userId);
    return { ok: true, code: machine.code, name: machine.name };
  },

  /** Lightweight dropdown source (mirrors getSkuLookup). */
  async lookup(query = {}) {
    const filter = { ...live };
    if (query.includeInactive !== 'true') filter.machineStatus = 'IN_USE';
    if (query.search) {
      const rx = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ code: rx }, { name: rx }, { department: rx }];
    }
    return Machine.find(filter)
      .select('code name uid machineType department machineStatus')
      .sort({ code: 1 })
      .limit(Math.min(parseInt(query.limit, 10) || 500, 2000))
      .lean();
  },

  /** Operators on a machine — the detail panel and the assign dialog both read this. */
  async getOperators(id) {
    await assignmentService.mustFindMachine(id);
    return assignmentService.listOperatorsForMachine(id);
  },

  assignOperator(id, operatorId, userId) {
    return assignmentService.assign(id, operatorId, userId);
  },

  unassignOperator(id, operatorId, userId) {
    return assignmentService.unassign(id, operatorId, userId);
  },
};

export default machineService;
