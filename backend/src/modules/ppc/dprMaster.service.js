/**
 * DPR master service — powers the dropdowns of the DPR entry form and the
 * "Masters" management screen (Machines / Operators / Process Routes / Dies).
 *
 * The form is dependent-dropdown driven:
 *   Machine → filters Operators (machineCodes) and shows machineType
 *   SKU     → lists its Operations (Process Route) with SPM/cavity auto-fill
 *   SKU+Op  → filters Dies to the exact tool that ran the pieces
 */
import Machine from './machine.model.js';
import Operator from './operator.model.js';
import ProcessRoute from './processRoute.model.js';
import Die from './die.model.js';
import SKU from '../skus/sku.model.js';
import { AppError } from '../../utils/apiResponse.js';
import {
  HOUR_SLOTS, PLANNED_REASONS, DOWNTIME_REASONS, DEFECT_TYPES, SHIFTS, MACHINE_TYPES,
} from './dpr.constants.js';

const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const notDeleted = { isDeleted: { $ne: true } };

export const dprMasterService = {
  /**
   * One call the DPR form makes on mount: every list it needs to render the
   * top-of-form dropdowns. Operations/dies are fetched lazily per-SKU below.
   */
  async getFormOptions() {
    const [machines, operators, routes] = await Promise.all([
      Machine.find({ ...notDeleted, active: { $ne: false } }).sort({ code: 1 }).lean(),
      Operator.find({ ...notDeleted, active: { $ne: false } }).sort({ name: 1 }).lean(),
      ProcessRoute.find(notDeleted).select('skuCode skuName').lean(),
    ]);

    // Distinct SKU list from the routing (only SKUs we can actually run).
    const skuMap = new Map();
    for (const r of routes) {
      if (!skuMap.has(r.skuCode)) skuMap.set(r.skuCode, { skuCode: r.skuCode, skuName: r.skuName || '' });
    }

    return {
      machines: machines.map((m) => ({
        _id: m._id, code: m.code, name: m.name, machineType: m.machineType, defaultSpm: m.defaultSpm,
      })),
      operators: operators.map((o) => ({
        _id: o._id, name: o.name, machineCodes: o.machineCodes || [],
      })),
      skus: [...skuMap.values()].sort((a, b) => a.skuCode.localeCompare(b.skuCode)),
      shifts: SHIFTS,
      machineTypes: MACHINE_TYPES,
      hourSlots: HOUR_SLOTS,
      plannedReasons: PLANNED_REASONS,
      downtimeReasons: DOWNTIME_REASONS,
      defectTypes: DEFECT_TYPES,
    };
  },

  /** Operations (routing steps) for a SKU, ordered — each carries SPM/cavity. */
  async getOperations(skuCode) {
    if (!skuCode) return [];
    const routes = await ProcessRoute.find({ ...notDeleted, skuCode: String(skuCode).toUpperCase() })
      .sort({ operationNo: 1 }).lean();
    return routes.map((r) => ({
      operationNo: r.operationNo,
      operationName: r.operationName,
      operationLabel: r.operationLabel || `${r.operationNo} - ${r.operationName}`,
      operationDesc: r.operationDesc,
      machineType: r.machineType,
      spm: r.spm,
      cavity: r.cavity || 1,
      partRate: r.partRate || 0,
      isLastOperation: r.isLastOperation,
    }));
  },

  /** Dies for a SKU (optionally narrowed to one operation description). */
  async getDies(skuCode, operationDesc) {
    if (!skuCode) return [];
    const filter = { ...notDeleted, skuCode: String(skuCode).toUpperCase() };
    if (operationDesc) filter.operationDesc = operationDesc;
    const dies = await Die.find(filter).sort({ completeDieNo: 1 }).lean();
    return dies.map((d) => ({
      completeDieNo: d.completeDieNo, rackNo: d.rackNo, opCode: d.opCode,
      operationDesc: d.operationDesc, toolLifeShots: d.toolLifeShots,
    }));
  },

  // ── Generic master list + CRUD (for the Masters management screen) ──────────
  _models: { machine: Machine, operator: Operator, processRoute: ProcessRoute, die: Die },

  _searchFields: {
    machine: ['code', 'name', 'machineType', 'department'],
    operator: ['name', 'code', 'department', 'shift'],
    processRoute: ['skuCode', 'skuName', 'operationName', 'operationDesc', 'machineType'],
    die: ['completeDieNo', 'dieName', 'rackNo', 'opCode', 'operationDesc', 'skuCode'],
  },

  _sort: {
    machine: { code: 1 },
    operator: { name: 1 },
    processRoute: { skuCode: 1, operationNo: 1 },
    die: { completeDieNo: 1 },
  },

  _resolve(kind) {
    const Model = this._models[kind];
    if (!Model) throw new AppError(`Unknown master type: ${kind}`, 400);
    return Model;
  },

  async listMaster(kind, query = {}) {
    const Model = this._resolve(kind);
    const filter = { ...notDeleted };
    if (query.search) {
      const r = rx(query.search);
      filter.$or = this._searchFields[kind].map((f) => ({ [f]: r }));
    }
    if (kind === 'processRoute' && query.skuCode) filter.skuCode = String(query.skuCode).toUpperCase();
    if (kind === 'die' && query.skuCode) filter.skuCode = String(query.skuCode).toUpperCase();

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Number(query.limit) || 100, 2000);
    const [docs, total] = await Promise.all([
      Model.find(filter).sort(this._sort[kind]).skip((page - 1) * limit).limit(limit).lean(),
      Model.countDocuments(filter),
    ]);
    return { docs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  },

  async createMaster(kind, body, user) {
    const Model = this._resolve(kind);
    const doc = await Model.create({ ...body, createdBy: user?._id, updatedBy: user?._id });
    return doc.toObject();
  },

  async updateMaster(kind, id, body, user) {
    const Model = this._resolve(kind);
    const doc = await Model.findByIdAndUpdate(
      id,
      { $set: { ...body, updatedBy: user?._id } },
      { new: true, runValidators: true },
    ).lean();
    if (!doc) throw new AppError('Record not found', 404);
    return doc;
  },

  async deleteMaster(kind, id) {
    const Model = this._resolve(kind);
    const doc = await Model.findByIdAndUpdate(id, { $set: { isDeleted: true } }, { new: true }).lean();
    if (!doc) throw new AppError('Record not found', 404);
    return { _id: id, deleted: true };
  },

  /** Counts for the Masters screen header + a data-health check. */
  async masterStats() {
    const [machines, operators, routes, dies, skus] = await Promise.all([
      Machine.countDocuments(notDeleted),
      Operator.countDocuments(notDeleted),
      ProcessRoute.countDocuments(notDeleted),
      Die.countDocuments(notDeleted),
      SKU.countDocuments({ isDeleted: { $ne: true } }),
    ]);
    return { machines, operators, processRoutes: routes, dies, skus };
  },
};

export default dprMasterService;
