/**
 * Machine Operator master service. Mirrors machine.service.js so both sides of
 * the relationship behave identically.
 */
import Operator, { operatorNameKey } from './machineOperator.model.js';
import assignmentService from './assignment.service.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';

const live = { isDeleted: { $ne: true } };

/**
 * Operators have no employee code in the source, so identity is the normalized
 * name. Rejecting the clash here gives a readable message instead of a driver
 * duplicate-key error on the nameKey index.
 */
const assertNameFree = async (name, excludeId = null) => {
  const nameKey = operatorNameKey(name);
  if (!nameKey) throw new AppError('Operator name is required', 400);
  const filter = { nameKey, ...live };
  if (excludeId) filter._id = { $ne: excludeId };
  const clash = await Operator.findOne(filter).select('_id name').lean();
  if (clash) throw new AppError(`Operator '${clash.name}' already exists`, 400);
};

export const machineOperatorService = {
  async create(data, userId) {
    await assertNameFree(data.name);

    const operator = new Operator({
      ...data,
      nameKey: operatorNameKey(data.name),
      departments: data.departments?.length
        ? data.departments
        : (data.department ? [data.department] : []),
      machineCodes: [],   // derived; never accepted from the client
      createdBy: userId,
      updatedBy: userId,
      activityTimeline: [{ action: 'CREATE', description: 'Machine operator created', actorId: userId }],
    });
    await operator.save();

    if (data.machineIds?.length) {
      await assignmentService.setMachinesForOperator(operator._id, data.machineIds, userId);
    }
    return this.getById(operator._id);
  },

  async getAll(query = {}) {
    const features = new ApiFeatures(Operator.find(live), query)
      .filter()
      .search(['name', 'code', 'department', 'shift'])
      .sort()
      .select()
      .paginate();

    const { docs, pagination } = await features.exec();

    const [total, activeCount] = await Promise.all([
      Operator.countDocuments(live),
      Operator.countDocuments({ ...live, isActive: { $ne: false } }),
    ]);

    const machineCounts = await assignmentService.countsByOperator(docs.map((d) => d._id));
    const withCounts = docs.map((d) => ({ ...d, machineCount: machineCounts[String(d._id)] || 0 }));

    return {
      docs: withCounts,
      pagination: {
        ...pagination,
        statusCounts: { ACTIVE: activeCount, INACTIVE: total - activeCount },
        allTotal: total,
      },
    };
  },

  async getById(id) {
    const operator = await Operator.findOne({ _id: id, ...live }).lean();
    if (!operator) throw new AppError('Machine operator not found', 404);
    const machines = await assignmentService.listMachinesForOperator(operator._id);
    return { ...operator, machines, machineCount: machines.length };
  },

  async update(id, data, userId) {
    const operator = await Operator.findOne({ _id: id, ...live });
    if (!operator) throw new AppError('Machine operator not found', 404);

    if (data.name !== undefined && operatorNameKey(data.name) !== operator.nameKey) {
      await assertNameFree(data.name, operator._id);
    }

    // machineCodes is a derived mirror — an inbound value is always discarded.
    const { machineIds, machineCodes: _ignored, ...fields } = data;
    Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) operator[k] = v; });
    if (data.name !== undefined) operator.nameKey = operatorNameKey(data.name);
    if (data.department !== undefined && !data.departments) {
      const set = new Set([...(operator.departments || []), data.department].filter(Boolean));
      operator.departments = [...set];
    }
    operator.updatedBy = userId;
    operator.activityTimeline.push({ action: 'UPDATE', description: 'Machine operator updated', actorId: userId });
    await operator.save();

    if (machineIds !== undefined) {
      await assignmentService.setMachinesForOperator(operator._id, machineIds, userId);
    }
    return this.getById(operator._id);
  },

  /** Soft delete. Assignments are detached; the machines themselves are untouched. */
  async remove(id, userId) {
    const operator = await Operator.findOne({ _id: id, ...live });
    if (!operator) throw new AppError('Machine operator not found', 404);

    operator.isDeleted = true;
    operator.isActive = false;
    operator.deletedAt = new Date();
    operator.deletedBy = userId;
    operator.activityTimeline.push({ action: 'DELETE', description: 'Machine operator soft-deleted', actorId: userId });
    await operator.save({ validateBeforeSave: false });

    await assignmentService.detachOperator(operator._id, userId);
    return { ok: true, name: operator.name };
  },

  async lookup(query = {}) {
    const filter = { ...live };
    if (query.includeInactive !== 'true') filter.isActive = { $ne: false };
    if (query.search) {
      const rx = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { code: rx }, { department: rx }];
    }
    return Operator.find(filter)
      .select('name code department shift machineCodes')
      .sort({ name: 1 })
      .limit(Math.min(parseInt(query.limit, 10) || 500, 2000))
      .lean();
  },

  async getMachines(id) {
    await assignmentService.mustFindOperator(id);
    return assignmentService.listMachinesForOperator(id);
  },

  assignMachine(id, machineId, userId) {
    return assignmentService.assign(machineId, id, userId);
  },

  unassignMachine(id, machineId, userId) {
    return assignmentService.unassign(machineId, id, userId);
  },
};

export default machineOperatorService;
