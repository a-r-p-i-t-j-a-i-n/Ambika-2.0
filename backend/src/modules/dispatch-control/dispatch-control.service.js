import mongoose from 'mongoose';
import SalesOrder from '../order/order.model.js';
import Party from '../clients/party.model.js';
import SKU from '../skus/sku.model.js';
import DispatchSchedule from '../schedule/schedule.model.js';
import DeliveryChallan from '../challan/challan.model.js';
import PPCEntry from '../ppc/ppc.model.js';
import AuditLog from '../audit-logs/audit-log.model.js';
import { AppError } from '../../utils/apiResponse.js';
import { generateDocNumber, generateO2DId } from '../../utils/docNumberGenerator.js';
import { getFiscalYear } from '../../utils/fiscalYear.js';
import { logger } from '../../utils/logger.js';
import { o2dFmsService } from '../o2d-fms/o2d-fms.service.js';
import { challanService } from '../challan/challan.routes.js';

const PLAN_LABEL_PREFIX = 'Dispatch Plan';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Transactional helper ────────────────────────────────────
// Mongo transactions require a replica set. In dev (standalone mongod) the
// session.withTransaction call throws — we degrade gracefully so devs aren't
// blocked, but log clearly so prod runs with txn semantics.
const withMaybeTransaction = async (fn) => {
  let session = null;
  try {
    session = await mongoose.startSession();
  } catch (err) {
    logger?.warn?.('Mongo sessions unavailable, running without transaction:', err.message);
    return fn(null);
  }
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    // Standalone mongod throws a specific MongoServerError code 20.
    if (err?.code === 20 || /Transaction numbers are only allowed/.test(err?.message || '')) {
      logger?.warn?.('Replica set not available — falling back to non-transactional write');
      return fn(null);
    }
    throw err;
  } finally {
    session?.endSession?.();
  }
};

// ── Audit log helper ────────────────────────────────────────
const writeAudit = async ({ entityName, entityId, action, oldValue, newValue, actor, session }) => {
  try {
    const doc = {
      entityName,
      entityId,
      action,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
      updatedBy: actor?._id || actor?.userId || null,
      module: 'dispatch-control',
      ipAddress: actor?.ipAddress || null,
      userAgent: actor?.userAgent || null,
      companyId: actor?.companyId || null,
    };
    if (session) {
      await AuditLog.create([doc], { session });
    } else {
      await AuditLog.create(doc);
    }
  } catch (err) {
    // Audit logging must never break the main flow.
    logger?.error?.('Audit log write failed:', err.message);
  }
};

// Project a minimal phase snapshot for audit diffs (avoids dumping the entire schedule).
const projectPhaseForAudit = (item, phase) => ({
  scheduleItemSkuCode: item?.skuCode,
  phaseId: String(phase?._id || ''),
  phaseNo: phase?.phaseNo,
  plannedDate: phase?.plannedDate,
  plannedQty: phase?.plannedQty,
  totalActualQty: phase?.totalActualQty,
  status: phase?.status,
  notes: phase?.notes,
});

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeKey = (value) => String(value || '').trim().toLowerCase();

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const monthName = (date) => (
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date(date).getMonth()]
);

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const phaseNumberFromLabel = (label, fallbackIndex = 1) => {
  const match = String(label || '').match(/(\d+)/);
  return match ? Number(match[1]) : fallbackIndex;
};

const phaseNoFromLine = (line, fallbackIndex = 1) => {
  if (line.phaseNo) return String(line.phaseNo).toUpperCase().startsWith('P') ? String(line.phaseNo).toUpperCase() : `P${line.phaseNo}`;
  if (line.planType) return `P${phaseNumberFromLabel(line.planType, fallbackIndex)}`;
  if (line.dispatchPlanType) return `P${phaseNumberFromLabel(line.dispatchPlanType, fallbackIndex)}`;
  return `P${fallbackIndex}`;
};

const findOrderLine = (order, line) => {
  const skuCode = normalizeKey(line.skuCode);
  const skuName = normalizeKey(line.skuName || line.itemName);
  const itemId = String(line.orderItemId || line.itemId || '');

  return order.items.find((item) => (
    (skuCode && normalizeKey(item.skuCode) === skuCode)
    || (skuName && normalizeKey(item.skuName) === skuName)
    || (itemId && String(item._id) === itemId)
  ));
};

const calculateBoxes = (quantityPcs, pcsPerBox) => {
  const boxSize = Number(pcsPerBox) > 0 ? Number(pcsPerBox) : 100;
  return Math.ceil(Number(quantityPcs || 0) / boxSize);
};

const calculateWeight = (quantityPcs, sku, line) => {
  if (line.weightKg !== undefined && line.weightKg !== null) return Number(line.weightKg);
  if (line.weightKgs !== undefined && line.weightKgs !== null) return Number(line.weightKgs);
  if (sku?.weightPerBox && sku?.pcsPerBox) {
    return Number(((Number(quantityPcs || 0) / sku.pcsPerBox) * sku.weightPerBox).toFixed(2));
  }
  if (sku?.weightPerPc) {
    return Number((Number(quantityPcs || 0) * sku.weightPerPc).toFixed(2));
  }
  return 0;
};

const ensureParty = async (data) => {
  if (data.partyId && isObjectId(data.partyId)) {
    const party = await Party.findById(data.partyId);
    if (!party) throw new AppError('Party not found', 404);
    return party;
  }

  const partyName = data.partyName || data.clientName || data.customerName;
  if (!partyName) throw new AppError('Party name is required', 422);

  const existing = await Party.findOne({ name: new RegExp(`^${escapeRegex(partyName)}$`, 'i') });
  if (existing) return existing;

  return Party.create({
    name: partyName,
    location: data.location,
    state: data.state,
    email: data.clientEmail || data.email,
    phone: data.phone,
    contactPerson: data.contactPerson,
    gstNo: data.gstNo,
    creditPeriodDays: data.creditPeriodDays,
    leadTimeDays: data.leadTimeDays,
    addresses: data.addresses || [],
  });
};

const findSku = async (line) => {
  if (line.skuId && isObjectId(line.skuId)) return SKU.findById(line.skuId);
  if (line.skuCode) return SKU.findOne({ code: new RegExp(`^${escapeRegex(line.skuCode)}$`, 'i') });
  if (line.skuName || line.itemName) return SKU.findOne({ name: new RegExp(`^${escapeRegex(line.skuName || line.itemName)}$`, 'i') });
  return null;
};

const orderLinePayload = async (line) => {
  const sku = await findSku(line);
  const skuName = line.skuName || line.itemName || sku?.name;
  const skuCode = line.skuCode || sku?.code;

  if (!skuName || !skuCode) {
    throw new AppError('Each order item needs SKU name and SKU code', 422);
  }

  return {
    skuId: sku?._id,
    skuName,
    skuCode,
    orderQty: Number(line.orderQty || line.quantity || 0),
    dispatchedQty: Number(line.dispatchedQty || line.totalDispatchQty || 0),
    asnCode: line.asnCode || line.fciCode || line.asnFciCode,
    remark: line.remark || line.remarks,
  };
};

const recalculateScheduleItem = (scheduleItem, orderItem) => {
  const actualQty = (scheduleItem.phases || []).reduce((sum, phase) => sum + Number(phase.totalActualQty || 0), 0);
  scheduleItem.dispatchedQty = actualQty;
  scheduleItem.poQty = Number(orderItem?.orderQty || scheduleItem.poQty || 0);
  scheduleItem.balanceQty = Math.max(0, scheduleItem.poQty - actualQty);
};

const upsertPpcDailyPlan = async ({ order, orderItem, date, plannedQty = 0, actualQty = 0 }) => {
  const d = new Date(date);
  const month = d.getMonth() + 1;
  const year = d.getFullYear();

  const entry = await PPCEntry.findOneAndUpdate(
    { month, year, soNumber: order.soNumber, skuCode: orderItem.skuCode },
    {
      $setOnInsert: {
        month,
        year,
        soNumber: order.soNumber,
        partyId: order.partyId,
        partyName: order.partyName,
        skuId: orderItem.skuId,
        skuCode: orderItem.skuCode,
        skuName: orderItem.skuName,
        orderQty: orderItem.orderQty,
      },
    },
    { new: true, upsert: true },
  );

  const day = startOfDay(d).toISOString();
  const existingDay = entry.dailyPlan.find((plan) => startOfDay(plan.date).toISOString() === day);
  if (existingDay) {
    existingDay.dispPlan = Number(existingDay.dispPlan || 0) + Number(plannedQty || 0);
    existingDay.dispActual = Number(existingDay.dispActual || 0) + Number(actualQty || 0);
  } else {
    entry.dailyPlan.push({ date: startOfDay(d), dispPlan: Number(plannedQty || 0), dispActual: Number(actualQty || 0) });
  }

  entry.dispatchedQty = Math.max(0, Number(entry.dispatchedQty || 0) + Number(actualQty || 0));
  entry.dispatchPct = entry.orderQty > 0 ? Math.min(100, Number(((entry.dispatchedQty / entry.orderQty) * 100).toFixed(2))) : 0;
  entry.balanceProductionQty = Math.max(0, Number(entry.orderQty || 0) - Number(entry.producedQtyTillDate || 0));
  entry.markModified('dailyPlan');
  await entry.save();
};

const getOrCreateSchedule = async (order, session = null) => {
  const findQuery = DispatchSchedule.findOne({ soNumber: order.soNumber }).sort({ createdAt: -1 });
  if (session) findQuery.session(session);
  let schedule = await findQuery;
  if (schedule) return schedule;

  schedule = new DispatchSchedule({
    soNumber: order.soNumber,
    poNumber: order.poNumber,
    partyId: order.partyId,
    partyName: order.partyName,
    orderId: order._id,
    poDate: order.poDate,
    status: 'ACTIVE',
    items: order.items.map((item) => ({
      skuId: item.skuId,
      skuName: item.skuName,
      skuCode: item.skuCode,
      poQty: item.orderQty,
      dispatchedQty: item.dispatchedQty || 0,
      balanceQty: item.balanceQty,
      phases: [],
    })),
  });

  return schedule;
};

// Find a scheduleItem either by its _id or by SKU match.
const findScheduleItem = (schedule, { itemId, skuCode, skuName }) => {
  if (itemId) {
    const byId = schedule.items.id(itemId);
    if (byId) return byId;
  }
  return schedule.items.find((item) => (
    (skuCode && normalizeKey(item.skuCode) === normalizeKey(skuCode))
    || (skuName && normalizeKey(item.skuName) === normalizeKey(skuName))
  ));
};

// Find a phase by its Mongo _id across all items in a schedule.
const findPhaseById = (schedule, phaseId) => {
  for (const item of schedule.items) {
    const phase = item.phases.id(phaseId);
    if (phase) return { item, phase };
  }
  return { item: null, phase: null };
};

// ── Carry-forward arithmetic per SKU ─────────────────────────
// Business rule (operator's mental model):
//   • A phase is "closed" once it has any actual OR its planned date has passed.
//   • Variance of a closed phase = (plannedQty + carryIn) - actualQty.
//     positive = SHORT — owe this many pcs in subsequent dispatches.
//     negative = SURPLUS — over-shipped, future plans can be reduced by |variance|.
//   • That variance carries forward to the next phase's carryIn.
//   • Future phases (not yet closed) still show the running carryIn from
//     prior closed phases so the planner sees the truth.
//
// We DO NOT mutate plannedQty on the schedule. The plannedQty is the planner's
// intent; the carry is a derived display.
const enrichPhasesWithCarryForward = (item, today = startOfDay(new Date())) => {
  const phases = [...(item?.phases || [])].sort((a, b) => (
    new Date(a.plannedDate || 0) - new Date(b.plannedDate || 0)
  ));
  let carryIn = 0;
  const enriched = phases.map((p) => {
    const planned   = Number(p.plannedQty || 0);
    const actual    = Number(p.totalActualQty || 0);
    const effective = planned + carryIn;            // what this phase *should* deliver
    const variance  = effective - actual;           // +ve = still short, -ve = over-shipped
    const closed    = actual > 0 || (p.plannedDate && startOfDay(p.plannedDate) < today);
    const carryOut  = closed ? variance : 0;        // future phases keep prior carryIn
    const out = {
      ...p,
      carryInQty: carryIn,
      effectivePlannedQty: Math.max(0, effective),  // never show negative
      effectiveRaw: effective,                      // signed (for surplus display)
      varianceQty: closed ? variance : 0,
      isClosed: closed,
      carryOutQty: carryOut,
    };
    if (closed) carryIn = variance;
    return out;
  });
  // running balance after the last closed phase = what a NEW phase would carry-in
  return { enrichedPhases: enriched, runningCarryQty: carryIn };
};

// Roll an item's phase statuses based on current totals & today.
const refreshPhaseLifecycle = (phase, today = startOfDay(new Date())) => {
  const planned = Number(phase.plannedQty || 0);
  const actual  = Number(phase.totalActualQty || 0);
  const date    = phase.plannedDate ? startOfDay(phase.plannedDate) : null;

  if (phase.status === 'CANCELLED') return;
  if (planned > 0 && actual >= planned) {
    phase.status = 'DISPATCHED';
  } else if (actual > 0 && actual < planned) {
    phase.status = date && date < today ? 'DELAYED' : 'IN_PROGRESS';
  } else if (planned > 0 && actual === 0 && date && date < today) {
    phase.status = 'DELAYED';
  } else {
    phase.status = 'PLANNED';
  }
};

// Apply DC items against an explicit plan phase (phaseRef-driven).
// If isUnplanned=true, the DC contributes to actuals on the matching SKU but
// is NOT bound to a phase; the schedule items still get their totals recalculated.
const applyActualToSchedule = async ({ order, challan, phaseRef, isUnplanned, session }) => {
  const findQuery = DispatchSchedule.findOne({ soNumber: order.soNumber }).sort({ createdAt: -1 });
  if (session) findQuery.session(session);
  const schedule = await findQuery;
  if (!schedule) return null;

  for (const dcItem of challan.items) {
    const scheduleItem = findScheduleItem(schedule, {
      skuCode: dcItem.skuCode,
      skuName: dcItem.skuName,
    });
    if (!scheduleItem) continue;

    if (!isUnplanned && phaseRef?.phaseId) {
      const phase = scheduleItem.phases.id(phaseRef.phaseId);
      if (phase) {
        phase.actualDispatches = [...(phase.actualDispatches || []), {
          date: challan.dcDate,
          qty: Number(dcItem.quantityPcs || 0),
          invoiceNo: challan.invoiceNo,
          invoiceDate: challan.dcDate,
          invoiceDoc: challan.pdfUrl,
        }];
        phase.totalActualQty = Number(phase.totalActualQty || 0) + Number(dcItem.quantityPcs || 0);
        refreshPhaseLifecycle(phase);
      }
    }

    const orderItem = order.items.find((it) => (
      normalizeKey(it.skuCode) === normalizeKey(scheduleItem.skuCode)
      || normalizeKey(it.skuName) === normalizeKey(scheduleItem.skuName)
    ));
    recalculateScheduleItem(scheduleItem, orderItem);
  }

  if (session) await schedule.save({ session });
  else await schedule.save();
  return schedule;
};

const getOrderActualsMap = async (soNumber) => {
  const challans = await DeliveryChallan.find({ soNumber }).lean();
  const actualsBySku = new Map();

  challans.forEach((challan) => {
    (challan.items || []).forEach((item) => {
      const key = normalizeKey(item.skuCode || item.skuName);
      const existing = actualsBySku.get(key) || {
        skuCode: item.skuCode,
        skuName: item.skuName,
        actualQty: 0,
        challans: [],
      };
      existing.actualQty += Number(item.quantityPcs || 0);
      existing.challans.push({
        dcNumber: challan.dcNumber,
        dcDate: challan.dcDate,
        quantityPcs: item.quantityPcs,
        vehicleNo: challan.vehicleNo,
        transporterName: challan.transporterName,
      });
      actualsBySku.set(key, existing);
    });
  });

  return { challans, actualsBySku };
};

const buildComparison = async (soNumber) => {
  const order = await SalesOrder.findOne({ soNumber })
    .populate('partyId', 'name code location email phone addresses')
    .lean();
  if (!order) throw new AppError(`Sales Order ${soNumber} not found`, 404);

  const schedules = await DispatchSchedule.find({ soNumber }).lean();
  const { challans, actualsBySku } = await getOrderActualsMap(soNumber);
  const today = startOfDay(new Date());

  const rows = order.items.map((orderItem) => {
    const scheduleItem = schedules
      .flatMap((schedule) => schedule.items || [])
      .find((item) => normalizeKey(item.skuCode || item.skuName) === normalizeKey(orderItem.skuCode || orderItem.skuName));

    // Enrich with carry-forward chain so risks/totals reflect the running balance.
    const { enrichedPhases, runningCarryQty } = enrichPhasesWithCarryForward(scheduleItem || { phases: [] }, today);
    const phases = enrichedPhases;
    const plannedQty = phases.reduce((sum, phase) => sum + Number(phase.plannedQty || 0), 0);
    const futurePlannedQty = phases.reduce((sum, phase) => {
      if (!phase.plannedDate || startOfDay(phase.plannedDate) < today) return sum;
      return sum + Math.max(0, Number(phase.effectivePlannedQty || 0) - Number(phase.totalActualQty || 0));
    }, 0);
    const actual = actualsBySku.get(normalizeKey(orderItem.skuCode)) || actualsBySku.get(normalizeKey(orderItem.skuName));
    const actualQty = Number(actual?.actualQty || orderItem.dispatchedQty || 0);
    const balanceQty = Math.max(0, Number(orderItem.orderQty || 0) - actualQty);
    const pendingPlannedQty = Math.max(0, plannedQty - actualQty);
    const unplannedBalanceQty = Math.max(0, balanceQty - futurePlannedQty);
    const overduePlannedQty = phases.reduce((sum, phase) => {
      if (!phase.plannedDate || startOfDay(phase.plannedDate) >= today) return sum;
      return sum + Math.max(0, Number(phase.effectivePlannedQty || 0) - Number(phase.totalActualQty || 0));
    }, 0);

    const risks = [];
    if (overduePlannedQty > 0) risks.push({ type: 'OVERDUE_PLAN', severity: 'HIGH', qty: overduePlannedQty });
    if (actualQty > plannedQty && actualQty > 0) risks.push({ type: 'UNPLANNED_DISPATCH', severity: 'MEDIUM', qty: actualQty - plannedQty });
    if (actualQty > Number(orderItem.orderQty || 0)) risks.push({ type: 'OVER_DISPATCH', severity: 'HIGH', qty: actualQty - Number(orderItem.orderQty || 0) });
    if (unplannedBalanceQty > 0) risks.push({ type: 'BALANCE_NOT_PLANNED', severity: 'MEDIUM', qty: unplannedBalanceQty });

    // Carry-forward suggestion: include both unplanned balance AND any short-fall
    // still sitting on the running carry from prior closed phases.
    const carryForwardSuggestionQty = Math.max(0, unplannedBalanceQty + Math.max(0, runningCarryQty));

    return {
      orderItemId: orderItem._id,
      skuCode: orderItem.skuCode,
      skuName: orderItem.skuName,
      orderQty: orderItem.orderQty,
      plannedQty,
      actualQty,
      balanceQty,
      pendingPlannedQty,
      runningCarryQty,                        // +ve = behind plan, -ve = ahead of plan
      remainingToPlanQty: Math.max(0, Number(orderItem.orderQty || 0) - plannedQty),
      carryForwardSuggestionQty,
      fulfillmentPct: orderItem.orderQty > 0 ? Number(((actualQty / orderItem.orderQty) * 100).toFixed(2)) : 0,
      planAchievementPct: plannedQty > 0 ? Number(((actualQty / plannedQty) * 100).toFixed(2)) : 0,
      risks,
      phases: phases.map((phase) => ({
        phaseId: phase._id ? String(phase._id) : null,
        phaseNo: phase.phaseNo,
        planType: `${PLAN_LABEL_PREFIX} ${phaseNumberFromLabel(phase.phaseNo)}`,
        plannedDate: phase.plannedDate,
        plannedQty: Number(phase.plannedQty || 0),
        carryInQty: Number(phase.carryInQty || 0),
        effectivePlannedQty: Number(phase.effectivePlannedQty || 0),
        actualQty: Number(phase.totalActualQty || 0),
        varianceQty: Number(phase.varianceQty || 0),
        carryOutQty: Number(phase.carryOutQty || 0),
        isClosed: Boolean(phase.isClosed),
        status: phase.status || 'PLANNED',
      })),
      challans: actual?.challans || [],
    };
  });

  const totals = rows.reduce((acc, row) => {
    acc.orderQty += Number(row.orderQty || 0);
    acc.plannedQty += Number(row.plannedQty || 0);
    acc.actualQty += Number(row.actualQty || 0);
    acc.balanceQty += Number(row.balanceQty || 0);
    acc.riskCount += row.risks.length;
    acc.carryForwardQty += Number(row.carryForwardSuggestionQty || 0);
    return acc;
  }, { orderQty: 0, plannedQty: 0, actualQty: 0, balanceQty: 0, riskCount: 0, carryForwardQty: 0 });

  totals.fulfillmentPct = totals.orderQty > 0 ? Number(((totals.actualQty / totals.orderQty) * 100).toFixed(2)) : 0;
  totals.planAchievementPct = totals.plannedQty > 0 ? Number(((totals.actualQty / totals.plannedQty) * 100).toFixed(2)) : 0;

  return { order, schedules, challans, totals, rows };
};

export const dispatchControlService = {
  async createOrderEntry(data) {
    const party = await ensureParty(data);
    const items = await Promise.all((data.items || []).map(orderLinePayload));
    if (!items.length) throw new AppError('At least one order item is required', 422);

    if (data.soNumber) {
      const duplicate = await SalesOrder.findOne({ soNumber: data.soNumber });
      if (duplicate) throw new AppError(`SO number ${data.soNumber} already exists`, 409);
    }

    const orderDate = data.orderDate || new Date();
    const receivedAt = data.receivedAt || new Date();
    const addHours = (date, hours) => new Date(new Date(date).getTime() + hours * 60 * 60 * 1000);
    const addDays = (date, days) => new Date(new Date(date).getTime() + days * MS_PER_DAY);
    const order = await SalesOrder.create({
      soNumber: data.soNumber || await generateDocNumber('SALES_ORDER', orderDate),
      poNumber: data.poNumber,
      poDate: data.poDate,
      partyId: party._id,
      partyName: party.name,
      location: data.location || party.location,
      orderDate,
      receivedAt,
      financialYear: data.financialYear || getFiscalYear(orderDate),
      transport: data.transport || data.transportMode || 'Road',
      partyGroup: data.partyGroup,
      orderDocument: data.orderDocument || data.orderDocumentUrl,
      leadTimeDays: data.leadTimeDays || party.leadTimeDays || 7,
      status: data.status || 'RECEIVED',
      remark: data.remark || data.remarks,
      uniqueO2DId: await generateO2DId(),
      poEntry: { planned: addHours(receivedAt, 1), status: 'PENDING' },
      inventoryCheck: { planned: addHours(receivedAt, 2), status: 'PENDING' },
      scheduling: { planned: addDays(receivedAt, 2), status: 'PENDING' },
      emailSchedule: { planned: addDays(receivedAt, 2), status: 'PENDING' },
      items,
    });

    // Build the O2D FMS process (config-driven step tracker) for this order, then
    // auto-complete the "order received / entry" step. Non-fatal: order entry must
    // never fail if the catalog is empty/misconfigured.
    try {
      await o2dFmsService.buildProcessForOrder(order);
      await o2dFmsService.advanceByTrigger({ salesOrderId: order._id }, 'ORDER_ENTRY');
    } catch (err) {
      logger.error(`[O2D-FMS] Failed to build/advance process for SO ${order.soNumber}: ${err.message}`);
    }

    return order.populate('partyId', 'name code location email phone addresses');
  },

  async planDispatch(data, actor = null) {
    const result = await withMaybeTransaction(async (session) => {
      const orderQ = SalesOrder.findOne({ soNumber: data.soNumber });
      if (session) orderQ.session(session);
      const order = await orderQ;
      if (!order) throw new AppError(`Sales Order ${data.soNumber} not found`, 404);

      const schedule = await getOrCreateSchedule(order, session);
      const planLines = data.planLines || data.items || [];
      if (!planLines.length) throw new AppError('At least one plan line is required', 422);

      const auditDiffs = [];

      for (const [index, line] of planLines.entries()) {
        const orderItem = findOrderLine(order, line);
        if (!orderItem) throw new AppError(`SKU ${line.skuCode || line.skuName || line.itemName} not found in ${order.soNumber}`, 404);

        let scheduleItem = findScheduleItem(schedule, {
          itemId: line.scheduleItemId,
          skuCode: orderItem.skuCode,
          skuName: orderItem.skuName,
        });

        if (!scheduleItem) {
          schedule.items.push({
            skuId: orderItem.skuId,
            skuName: orderItem.skuName,
            skuCode: orderItem.skuCode,
            poQty: orderItem.orderQty,
            dispatchedQty: orderItem.dispatchedQty || 0,
            balanceQty: orderItem.balanceQty,
            phases: [],
          });
          scheduleItem = schedule.items[schedule.items.length - 1];
        }

        const phaseNo = phaseNoFromLine(line, index + 1);
        const plannedDate = line.plannedDate || line.planDate || line.date;
        const plannedQty = Number(line.plannedQty || line.planQty || line.qty || 0);
        if (!plannedDate || plannedQty <= 0) throw new AppError('Each plan line needs plan date and positive quantity', 422);

        // Prefer edit-by-id when a phaseId is provided; otherwise upsert by phaseNo.
        const existingPhase = line.phaseId
          ? scheduleItem.phases.id(line.phaseId)
          : scheduleItem.phases.find((phase) => phase.phaseNo === phaseNo);

        const alreadyPlannedExcludingThis = scheduleItem.phases.reduce((sum, phase) => (
          (existingPhase && String(phase._id) === String(existingPhase._id)) ? sum : sum + Number(phase.plannedQty || 0)
        ), 0);
        if (!data.allowOverPlan && alreadyPlannedExcludingThis + plannedQty > Number(orderItem.orderQty || 0)) {
          throw new AppError(`Plan exceeds order quantity for ${orderItem.skuCode}. Enable allowOverPlan to override.`, 422);
        }

        if (existingPhase) {
          const before = projectPhaseForAudit(scheduleItem, existingPhase);
          existingPhase.plannedDate = new Date(plannedDate);
          existingPhase.plannedQty = plannedQty;
          if (line.notes !== undefined) existingPhase.notes = line.notes;
          refreshPhaseLifecycle(existingPhase);
          auditDiffs.push({ action: 'UPDATE', before, after: projectPhaseForAudit(scheduleItem, existingPhase) });
        } else {
          scheduleItem.phases.push({
            phaseNo,
            plannedDate: new Date(plannedDate),
            plannedQty,
            notes: line.notes || null,
            actualDispatches: [],
            totalActualQty: 0,
            status: 'PLANNED',
          });
          const created = scheduleItem.phases[scheduleItem.phases.length - 1];
          auditDiffs.push({ action: 'CREATE', before: null, after: projectPhaseForAudit(scheduleItem, created) });
        }

        recalculateScheduleItem(scheduleItem, orderItem);
        await upsertPpcDailyPlan({ order, orderItem, date: plannedDate, plannedQty });
      }

      schedule.status = data.status || schedule.status || 'ACTIVE';
      schedule.pdfUrl = data.pdfUrl || schedule.pdfUrl;
      if (session) await schedule.save({ session });
      else await schedule.save();

      if (order.status === 'RECEIVED') {
        order.status = 'PLANNING';
        if (session) await order.save({ session });
        else await order.save();
      }

      // Best-effort audit (non-fatal if it fails).
      for (const diff of auditDiffs) {
        await writeAudit({
          entityName: 'DispatchSchedulePhase',
          entityId: schedule._id,
          action: diff.action,
          oldValue: diff.before,
          newValue: diff.after,
          actor,
          session,
        });
      }

      return buildComparison(order.soNumber);
    });

    // Auto-advance the FMS "Dispatch Planning" step (non-fatal, post-commit).
    try {
      await o2dFmsService.advanceByTrigger({ soNumber: data.soNumber }, 'DISPATCH_PLAN', actor);
    } catch (err) {
      logger.error(`[O2D-FMS] DISPATCH_PLAN advance failed for ${data.soNumber}: ${err.message}`);
    }

    return result;
  },

  async createActualDispatch(data, actor = null) {
    // Strict contract: caller must either provide a phaseRef (linking this DC
    // to a specific plan phase) OR explicitly flag isUnplanned. The Joi schema
    // enforces this at the API edge; we re-check here for service-layer callers.
    const isUnplanned = Boolean(data.isUnplanned);
    if (!isUnplanned && !data.phaseRef?.phaseId) {
      throw new AppError('phaseRef.phaseId is required unless isUnplanned is true', 422);
    }

    const result = await withMaybeTransaction(async (session) => {
      const orderQ = SalesOrder.findOne({ soNumber: data.soNumber });
      if (session) orderQ.session(session);
      const order = await orderQ;
      if (!order) throw new AppError(`Sales Order ${data.soNumber} not found`, 404);

      // Resolve and validate the phase the operator picked.
      let resolvedPhaseRef = null;
      if (!isUnplanned) {
        const schedQ = DispatchSchedule.findOne({ soNumber: order.soNumber }).sort({ createdAt: -1 });
        if (session) schedQ.session(session);
        const schedule = await schedQ;
        if (!schedule) throw new AppError(`No dispatch plan found for ${order.soNumber}`, 404);

        const { item: schedItem, phase } = findPhaseById(schedule, data.phaseRef.phaseId);
        if (!phase) throw new AppError(`Plan phase ${data.phaseRef.phaseId} not found on this order's schedule`, 404);
        if (phase.status === 'CANCELLED') throw new AppError(`Phase ${phase.phaseNo} is cancelled — cannot dispatch against it`, 409);

        resolvedPhaseRef = {
          scheduleId: schedule._id,
          itemId:     schedItem._id,
          phaseId:    phase._id,
          phaseNo:    phase.phaseNo,
        };
      }

      const dcDate = data.dcDate || data.challanDate || new Date();
      const items = [];

      for (const [index, line] of (data.items || []).entries()) {
        const orderItem = findOrderLine(order, line);
        if (!orderItem) throw new AppError(`SKU ${line.skuCode || line.skuName || line.itemName} not found in ${order.soNumber}`, 404);
        const sku = await findSku({ skuId: orderItem.skuId, skuCode: orderItem.skuCode, skuName: orderItem.skuName });
        const quantityPcs = Number(line.quantityPcs || line.actualQty || line.dispatchQty || line.qty || 0);
        if (quantityPcs <= 0) throw new AppError('Each dispatch item needs positive quantity', 422);

        items.push({
          srNo: line.srNo || index + 1,
          orderItemId: orderItem._id,
          skuId: orderItem.skuId,
          skuName: orderItem.skuName,
          skuCode: orderItem.skuCode,
          quantityPcs,
          noOfBoxes: line.noOfBoxes || calculateBoxes(quantityPcs, line.pcsPerBox || sku?.pcsPerBox),
          pcsPerBox: line.pcsPerBox || sku?.pcsPerBox || 100,
          weightKg: calculateWeight(quantityPcs, sku, line),
        });

        orderItem.dispatchedQty = Number(orderItem.dispatchedQty || 0) + quantityPcs;
        orderItem.balanceQty = Math.max(0, Number(orderItem.orderQty || 0) - Number(orderItem.dispatchedQty || 0));
        orderItem.extraSentQty = Math.max(0, Number(orderItem.dispatchedQty || 0) - Number(orderItem.orderQty || 0));
        await upsertPpcDailyPlan({ order, orderItem, date: dcDate, actualQty: quantityPcs });
      }

      const challanPayload = {
        dcNumber: data.dcNumber || await generateDocNumber('DELIVERY_CHALLAN', dcDate),
        soNumber: order.soNumber,
        poNumber: data.poNumber || order.poNumber,
        orderId: order._id,
        partyId: order.partyId,
        partyName: data.partyName || order.partyName,
        dcDate,
        items,
        dispatchedThrough: data.dispatchedThrough || 'Freight Paid',
        vehicleNo: data.vehicleNo || data.vehicleNumber,
        transportMode: data.transportMode || order.transport || 'Road',
        transporterName: data.transporterName,
        clientEmail: data.clientEmail,
        invoiceNo: data.invoiceNo,
        deliveryAddress: data.deliveryAddress,
        pdfUrl: data.pdfUrl,
        sendEmail: Boolean(data.sendEmail),
        emailStatus: data.emailStatus,
        remark: data.remark || data.remarks,
        status: data.status || 'DISPATCHED',
        phaseRef: resolvedPhaseRef,
        isUnplanned,
      };

      const [challan] = await DeliveryChallan.create([challanPayload], { session: session || undefined });

      if (session) await order.save({ session });
      else await order.save();

      const updatedSchedule = await applyActualToSchedule({
        order,
        challan,
        phaseRef: resolvedPhaseRef,
        isUnplanned,
        session,
      });

      await writeAudit({
        entityName: 'DeliveryChallan',
        entityId: challan._id,
        action: 'CREATE',
        oldValue: null,
        newValue: {
          dcNumber: challan.dcNumber,
          soNumber: challan.soNumber,
          phaseRef: resolvedPhaseRef,
          isUnplanned,
          totalQuantityPcs: challan.totalQuantityPcs,
        },
        actor,
        session,
      });

      return {
        challan,
        schedule: updatedSchedule,
        comparison: await buildComparison(order.soNumber),
      };
    });

    // Generate the delivery-challan PDF (S3) — non-fatal, post-commit.
    try {
      if (result?.challan?._id) {
        const { pdfUrl } = await challanService.generatePdf(result.challan._id);
        if (result.challan.toObject) result.challan = { ...result.challan.toObject(), pdfUrl };
        else result.challan.pdfUrl = pdfUrl;
      }
    } catch (err) {
      logger.error(`[challan] PDF generation failed: ${err.message}`);
    }

    // Auto-advance the FMS "Actual Dispatch" step (non-fatal, post-commit).
    try {
      await o2dFmsService.advanceByTrigger({ soNumber: data.soNumber }, 'ACTUAL_DISPATCH', actor);
    } catch (err) {
      logger.error(`[O2D-FMS] ACTUAL_DISPATCH advance failed for ${data.soNumber}: ${err.message}`);
    }

    return result;
  },

  async getComparison(soNumber) {
    return buildComparison(soNumber);
  },

  /**
   * Return the schedule for an SO with phases serialized for the UI.
   * If no schedule exists yet, items are seeded from the order so the UI
   * can show every SKU with its balance (and the planner can start adding
   * phases on a fresh order). Phases are enriched with carry-forward fields.
   */
  async getSchedule(soNumber) {
    const order = await SalesOrder.findOne({ soNumber }).lean();
    if (!order) throw new AppError(`Sales Order ${soNumber} not found`, 404);

    const schedule = await DispatchSchedule.findOne({ soNumber }).sort({ createdAt: -1 }).lean();
    const today = startOfDay(new Date());

    // Build the items list. If the schedule has no items yet (fresh order),
    // synthesise stub items from the order so the UI is never empty.
    const sourceItems = (schedule?.items && schedule.items.length)
      ? schedule.items
      : (order.items || []).map((oi) => ({
          _id: oi._id,
          skuId: oi.skuId,
          skuName: oi.skuName,
          skuCode: oi.skuCode,
          poQty: oi.orderQty,
          dispatchedQty: oi.dispatchedQty || 0,
          balanceQty: Math.max(0, Number(oi.orderQty || 0) - Number(oi.dispatchedQty || 0)),
          phases: [],
        }));

    const items = sourceItems.map((item) => {
      const { enrichedPhases, runningCarryQty } = enrichPhasesWithCarryForward(item, today);
      const totalPlanned = enrichedPhases.reduce((s, p) => s + Number(p.plannedQty || 0), 0);
      const totalActual  = enrichedPhases.reduce((s, p) => s + Number(p.totalActualQty || 0), 0);
      const orderQty     = Number(item.poQty || item.orderQty || 0);
      // unplannedBalance = ordered qty minus everything already on the plan.
      // This is the qty a new phase should consider when auto-filling.
      const unplannedBalanceQty = Math.max(0, orderQty - totalPlanned);

      const phases = enrichedPhases.map((phase) => ({
        phaseId: phase._id ? String(phase._id) : null,
        phaseNo: phase.phaseNo,
        plannedDate: phase.plannedDate,
        plannedQty: Number(phase.plannedQty || 0),
        actualQty:  Number(phase.totalActualQty || 0),
        // Carry-forward chain
        carryInQty: Number(phase.carryInQty || 0),
        effectivePlannedQty: Number(phase.effectivePlannedQty || 0),
        effectiveRaw: Number(phase.effectiveRaw || 0),
        varianceQty: Number(phase.varianceQty || 0),
        carryOutQty: Number(phase.carryOutQty || 0),
        isClosed: Boolean(phase.isClosed),
        // pendingQty for dispatch desk = effective minus actual
        pendingQty: Math.max(0, Number(phase.effectivePlannedQty || 0) - Number(phase.totalActualQty || 0)),
        status: phase.status || 'PLANNED',
        overdue: phase.plannedDate && startOfDay(phase.plannedDate) < today && (Number(phase.effectivePlannedQty || 0) - Number(phase.totalActualQty || 0)) > 0,
        notes: phase.notes || null,
      }));

      return {
        scheduleItemId: String(item._id),
        skuId:    item.skuId,
        skuCode:  item.skuCode,
        skuName:  item.skuName,
        orderQty,
        dispatchedQty: Number(item.dispatchedQty || 0),
        balanceQty: Number(item.balanceQty || 0),
        totalPlanned,
        totalActual,
        unplannedBalanceQty,
        // What a new phase would carry-in from prior closed phases.
        runningCarryQty: Number(runningCarryQty || 0),
        phases,
      };
    });

    const totals = items.reduce((acc, it) => {
      acc.orderQty += it.orderQty;
      acc.dispatchedQty += it.dispatchedQty;
      acc.balanceQty += it.balanceQty;
      acc.plannedQty += it.phases.reduce((s, p) => s + p.plannedQty, 0);
      acc.actualQty  += it.phases.reduce((s, p) => s + p.actualQty, 0);
      acc.unplannedBalanceQty += it.unplannedBalanceQty;
      acc.runningCarryQty += it.runningCarryQty;
      return acc;
    }, { orderQty: 0, dispatchedQty: 0, balanceQty: 0, plannedQty: 0, actualQty: 0, unplannedBalanceQty: 0, runningCarryQty: 0 });

    totals.planCoveragePct = totals.orderQty > 0
      ? Number(((totals.plannedQty / totals.orderQty) * 100).toFixed(1))
      : 0;
    totals.fulfilmentPct = totals.orderQty > 0
      ? Number(((totals.dispatchedQty / totals.orderQty) * 100).toFixed(1))
      : 0;

    // Build a flat list of phase chips ordered by date (for the timeline strip).
    const phaseChips = [];
    items.forEach((it) => {
      it.phases.forEach((p) => phaseChips.push({
        phaseId: p.phaseId,
        phaseNo: p.phaseNo,
        skuCode: it.skuCode,
        skuName: it.skuName,
        plannedDate: p.plannedDate,
        plannedQty: p.plannedQty,
        effectivePlannedQty: p.effectivePlannedQty,
        actualQty: p.actualQty,
        carryInQty: p.carryInQty,
        carryOutQty: p.carryOutQty,
        status: p.status,
      }));
    });
    phaseChips.sort((a, b) => new Date(a.plannedDate || 0) - new Date(b.plannedDate || 0));

    return {
      order: {
        _id: order._id,
        soNumber: order.soNumber,
        poNumber: order.poNumber,
        partyId: order.partyId,
        partyName: order.partyName,
        place: order.place || order.location,
        orderDate: order.orderDate,
        leadTimeDays: order.leadTimeDays,
        status: order.status,
      },
      scheduleId: schedule?._id ? String(schedule._id) : null,
      status: schedule?.status || 'DRAFT',
      updatedAt: schedule?.updatedAt || null,
      items,
      phaseChips,
      totals,
    };
  },

  /**
   * Dispatcher-facing: list every phase across this SO that still has pending
   * qty, grouped per SKU. Feeds the PhasePicker dropdown on the DC form.
   * Uses *effective* planned qty (includes carry-forward from prior shorts).
   */
  async getDispatchablePhases(soNumber) {
    const sched = await this.getSchedule(soNumber);
    const phases = [];
    sched.items.forEach((it) => {
      it.phases.forEach((p) => {
        if (p.status === 'CANCELLED') return;
        phases.push({
          phaseId: p.phaseId,
          phaseNo: p.phaseNo,
          plannedDate: p.plannedDate,
          plannedQty: p.plannedQty,                 // planner's input
          effectivePlannedQty: p.effectivePlannedQty, // after carry-forward
          carryInQty: p.carryInQty,
          actualQty: p.actualQty,
          pendingQty: p.pendingQty,                 // = effective - actual
          status: p.status,
          scheduleItemId: it.scheduleItemId,
          skuId: it.skuId,
          skuCode: it.skuCode,
          skuName: it.skuName,
          orderQty: it.orderQty,
        });
      });
    });

    // Group by phaseNo so the dropdown shows "P1 (30 Dec) — 4 SKUs, 4,700 pending".
    const groupedMap = new Map();
    for (const p of phases) {
      const key = p.phaseNo;
      const g = groupedMap.get(key) || {
        phaseNo: key,
        plannedDate: p.plannedDate,
        skuCount: 0,
        totalPlanned: 0,
        totalEffective: 0,
        totalCarryIn: 0,
        totalActual: 0,
        totalPending: 0,
        skus: [],
      };
      g.skuCount += 1;
      g.totalPlanned   += p.plannedQty;
      g.totalEffective += p.effectivePlannedQty;
      g.totalCarryIn   += p.carryInQty;
      g.totalActual    += p.actualQty;
      g.totalPending   += p.pendingQty;
      // Use the earliest plannedDate as the phase date.
      if (p.plannedDate && (!g.plannedDate || new Date(p.plannedDate) < new Date(g.plannedDate))) {
        g.plannedDate = p.plannedDate;
      }
      g.skus.push(p);
      groupedMap.set(key, g);
    }
    const grouped = [...groupedMap.values()].sort((a, b) => new Date(a.plannedDate || 0) - new Date(b.plannedDate || 0));

    return { order: sched.order, grouped, phases };
  },

  /**
   * Create a new phase across one or many SKUs in one go. The UI calls this
   * when the planner clicks "+ Add Phase" — it picks a date and optionally
   * fills line qtys, or asks the server to auto-fill from balance.
   */
  async createPhase(soNumber, data, actor = null) {
    return withMaybeTransaction(async (session) => {
      const orderQ = SalesOrder.findOne({ soNumber });
      if (session) orderQ.session(session);
      const order = await orderQ;
      if (!order) throw new AppError(`Sales Order ${soNumber} not found`, 404);

      const schedule = await getOrCreateSchedule(order, session);
      const nextPhaseNoSeq = (() => {
        const used = new Set();
        schedule.items.forEach((it) => it.phases.forEach((p) => used.add(p.phaseNo)));
        for (let i = 1; i <= 99; i += 1) if (!used.has(`P${i}`)) return `P${i}`;
        return `P${used.size + 1}`;
      })();

      let lines = data.lines || [];
      if (data.autoFillFromBalance && lines.length === 0) {
        // Compute pending = orderQty − (existing planned + actual)
        lines = order.items.map((oi) => {
          const si = findScheduleItem(schedule, { skuCode: oi.skuCode, skuName: oi.skuName });
          const alreadyPlanned = (si?.phases || []).reduce((s, p) => s + Number(p.plannedQty || 0), 0);
          const remaining = Math.max(0, Number(oi.orderQty || 0) - alreadyPlanned);
          return remaining > 0 ? { orderItemId: oi._id, skuCode: oi.skuCode, skuName: oi.skuName, plannedQty: remaining } : null;
        }).filter(Boolean);
      }
      if (!lines.length) throw new AppError('Phase needs at least one SKU line (or set autoFillFromBalance:true)', 422);

      const auditDiffs = [];
      for (const line of lines) {
        const orderItem = findOrderLine(order, line);
        if (!orderItem) throw new AppError(`SKU ${line.skuCode || line.skuName} not found on ${soNumber}`, 404);

        let si = findScheduleItem(schedule, { skuCode: orderItem.skuCode, skuName: orderItem.skuName });
        if (!si) {
          schedule.items.push({
            skuId: orderItem.skuId,
            skuName: orderItem.skuName,
            skuCode: orderItem.skuCode,
            poQty: orderItem.orderQty,
            dispatchedQty: orderItem.dispatchedQty || 0,
            balanceQty: orderItem.balanceQty,
            phases: [],
          });
          si = schedule.items[schedule.items.length - 1];
        }

        const plannedQty = Number(line.plannedQty || 0);
        if (plannedQty <= 0) continue;
        const alreadyPlanned = si.phases.reduce((s, p) => s + Number(p.plannedQty || 0), 0);
        if (!data.allowOverPlan && alreadyPlanned + plannedQty > Number(orderItem.orderQty || 0)) {
          throw new AppError(`Plan exceeds order quantity for ${orderItem.skuCode}. Pass allowOverPlan to override.`, 422);
        }

        si.phases.push({
          phaseNo: nextPhaseNoSeq,
          plannedDate: new Date(data.plannedDate),
          plannedQty,
          notes: data.notes || null,
          actualDispatches: [],
          totalActualQty: 0,
          status: 'PLANNED',
        });
        const created = si.phases[si.phases.length - 1];
        recalculateScheduleItem(si, orderItem);
        await upsertPpcDailyPlan({ order, orderItem, date: data.plannedDate, plannedQty });
        auditDiffs.push({ before: null, after: projectPhaseForAudit(si, created) });
      }

      if (session) await schedule.save({ session });
      else await schedule.save();

      if (order.status === 'RECEIVED') {
        order.status = 'PLANNING';
        if (session) await order.save({ session });
        else await order.save();
      }

      for (const diff of auditDiffs) {
        await writeAudit({
          entityName: 'DispatchSchedulePhase',
          entityId: schedule._id,
          action: 'CREATE',
          oldValue: diff.before,
          newValue: diff.after,
          actor,
          session,
        });
      }

      return this.getSchedule(soNumber);
    });
  },

  /**
   * Update a single phase by phaseId. Supports rescheduling and qty changes.
   * If `lines` is passed, qtys are updated per matching SKU phase; otherwise
   * only the date/notes/status of the named phase are changed.
   */
  async updatePhase(soNumber, phaseId, data, actor = null) {
    return withMaybeTransaction(async (session) => {
      const orderQ = SalesOrder.findOne({ soNumber });
      if (session) orderQ.session(session);
      const order = await orderQ;
      if (!order) throw new AppError(`Sales Order ${soNumber} not found`, 404);

      const schedQ = DispatchSchedule.findOne({ soNumber }).sort({ createdAt: -1 });
      if (session) schedQ.session(session);
      const schedule = await schedQ;
      if (!schedule) throw new AppError(`No schedule found for ${soNumber}`, 404);

      const { item, phase } = findPhaseById(schedule, phaseId);
      if (!phase) throw new AppError('Phase not found', 404);

      const targetPhaseNo = phase.phaseNo;
      const auditDiffs = [];

      // Group all phases with the same phaseNo (across SKUs) — a "phase" in
      // the UI is the multi-SKU bucket sharing one phaseNo + planning date.
      const peers = [];
      schedule.items.forEach((it) => {
        it.phases.forEach((p) => {
          if (p.phaseNo === targetPhaseNo) peers.push({ item: it, phase: p });
        });
      });

      for (const peer of peers) {
        const before = projectPhaseForAudit(peer.item, peer.phase);
        if (data.plannedDate) peer.phase.plannedDate = new Date(data.plannedDate);
        if (data.notes !== undefined) peer.phase.notes = data.notes;
        if (data.status) peer.phase.status = data.status;
        refreshPhaseLifecycle(peer.phase);
        auditDiffs.push({ before, after: projectPhaseForAudit(peer.item, peer.phase) });
      }

      // Optional per-SKU qty updates.
      if (Array.isArray(data.lines)) {
        for (const line of data.lines) {
          const orderItem = findOrderLine(order, line);
          if (!orderItem) continue;
          const si = findScheduleItem(schedule, { skuCode: orderItem.skuCode, skuName: orderItem.skuName });
          if (!si) continue;
          let p = si.phases.find((x) => x.phaseNo === targetPhaseNo);
          const plannedQty = Number(line.plannedQty || 0);
          if (!p && plannedQty > 0) {
            si.phases.push({
              phaseNo: targetPhaseNo,
              plannedDate: data.plannedDate ? new Date(data.plannedDate) : phase.plannedDate,
              plannedQty,
              actualDispatches: [],
              totalActualQty: 0,
              status: 'PLANNED',
            });
            p = si.phases[si.phases.length - 1];
            auditDiffs.push({ before: null, after: projectPhaseForAudit(si, p) });
          } else if (p) {
            const before = projectPhaseForAudit(si, p);
            const alreadyPlannedExcl = si.phases.reduce((s, x) => (x === p ? s : s + Number(x.plannedQty || 0)), 0);
            if (!data.allowOverPlan && alreadyPlannedExcl + plannedQty > Number(orderItem.orderQty || 0)) {
              throw new AppError(`Plan exceeds order quantity for ${orderItem.skuCode}. Pass allowOverPlan to override.`, 422);
            }
            p.plannedQty = plannedQty;
            refreshPhaseLifecycle(p);
            auditDiffs.push({ before, after: projectPhaseForAudit(si, p) });
          }
          recalculateScheduleItem(si, orderItem);
        }
      }

      if (session) await schedule.save({ session });
      else await schedule.save();

      for (const diff of auditDiffs) {
        await writeAudit({
          entityName: 'DispatchSchedulePhase',
          entityId: schedule._id,
          action: 'UPDATE',
          oldValue: diff.before,
          newValue: diff.after,
          actor,
          session,
        });
      }

      return this.getSchedule(soNumber);
    });
  },

  /**
   * Cancel-or-delete a phase. If any actuals are attached we soft-cancel
   * (status=CANCELLED) — we never silently destroy data with history.
   */
  async deletePhase(soNumber, phaseId, actor = null) {
    return withMaybeTransaction(async (session) => {
      const schedQ = DispatchSchedule.findOne({ soNumber }).sort({ createdAt: -1 });
      if (session) schedQ.session(session);
      const schedule = await schedQ;
      if (!schedule) throw new AppError(`No schedule found for ${soNumber}`, 404);

      const { phase } = findPhaseById(schedule, phaseId);
      if (!phase) throw new AppError('Phase not found', 404);

      const targetPhaseNo = phase.phaseNo;
      const auditDiffs = [];
      let hardDeletedAny = false;
      let softCancelledAny = false;

      // Operate on all sibling phases with the same phaseNo across SKUs.
      schedule.items.forEach((it) => {
        const survivors = [];
        for (const p of it.phases) {
          if (p.phaseNo !== targetPhaseNo) { survivors.push(p); continue; }
          const before = projectPhaseForAudit(it, p);
          if (Number(p.totalActualQty || 0) > 0) {
            p.status = 'CANCELLED';
            survivors.push(p);
            softCancelledAny = true;
            auditDiffs.push({ action: 'UPDATE', before, after: projectPhaseForAudit(it, p) });
          } else {
            hardDeletedAny = true;
            auditDiffs.push({ action: 'DELETE', before, after: null });
            // omit from survivors → effectively deleted
          }
        }
        it.phases = survivors;
      });

      if (session) await schedule.save({ session });
      else await schedule.save();

      for (const diff of auditDiffs) {
        await writeAudit({
          entityName: 'DispatchSchedulePhase',
          entityId: schedule._id,
          action: diff.action,
          oldValue: diff.before,
          newValue: diff.after,
          actor,
          session,
        });
      }

      return {
        ...(await this.getSchedule(soNumber)),
        outcome: { hardDeletedAny, softCancelledAny },
      };
    });
  },

  async getOrderControlTower(soNumber) {
    const comparison = await buildComparison(soNumber);
    const nextActions = [];

    comparison.rows.forEach((row) => {
      if (row.carryForwardSuggestionQty > 0) {
        nextActions.push({
          type: 'CREATE_NEXT_PLAN',
          skuCode: row.skuCode,
          skuName: row.skuName,
          qty: row.carryForwardSuggestionQty,
          message: `${row.carryForwardSuggestionQty} pcs should be added to the next dispatch plan.`,
        });
      }
      row.risks.forEach((risk) => {
        nextActions.push({
          type: risk.type,
          skuCode: row.skuCode,
          skuName: row.skuName,
          qty: risk.qty,
          severity: risk.severity,
        });
      });
    });

    return { ...comparison, nextActions };
  },

  async getDashboard(query = {}) {
    const match = {};
    if (query.from || query.to) {
      match.orderDate = {};
      if (query.from) match.orderDate.$gte = new Date(query.from);
      if (query.to) match.orderDate.$lte = new Date(query.to);
    }
    if (query.partyId) match.partyId = new mongoose.Types.ObjectId(query.partyId);
    if (query.status) match.status = query.status;

    const [orders, schedules, challans] = await Promise.all([
      SalesOrder.find(match).lean(),
      DispatchSchedule.find({}).lean(),
      DeliveryChallan.find(query.from || query.to ? {
        dcDate: {
          ...(query.from ? { $gte: new Date(query.from) } : {}),
          ...(query.to ? { $lte: new Date(query.to) } : {}),
        },
      } : {}).lean(),
    ]);

    // Only schedules/challans tied to a LIVE order count toward the KPIs.
    // Orphan schedules (order deleted, or never created) must never inflate
    // overdue / planned / upcoming numbers.
    const orderSoSet = new Set(orders.map((o) => o.soNumber));
    const liveSchedules = schedules.filter((s) => orderSoSet.has(s.soNumber));
    const liveChallans = challans.filter((c) => orderSoSet.has(c.soNumber));

    const orderTotals = orders.reduce((acc, order) => {
      acc.totalOrders += 1;
      acc.totalOrderQty += Number(order.totalOrderQty || 0);
      acc.totalDispatchedQty += Number(order.totalDispatchedQty || 0);
      acc.totalBalanceQty += Number(order.totalBalanceQty || 0);
      if (order.status === 'COMPLETED') acc.completedOrders += 1;
      if (order.status !== 'COMPLETED' && order.status !== 'CANCELLED') acc.openOrders += 1;
      return acc;
    }, {
      totalOrders: 0,
      openOrders: 0,
      completedOrders: 0,
      totalOrderQty: 0,
      totalDispatchedQty: 0,
      totalBalanceQty: 0,
    });

    orderTotals.fulfillmentPct = orderTotals.totalOrderQty > 0
      ? Number(((orderTotals.totalDispatchedQty / orderTotals.totalOrderQty) * 100).toFixed(2))
      : 0;

    const monthlyMap = new Map();
    liveSchedules.forEach((schedule) => {
      (schedule.items || []).forEach((item) => {
        (item.phases || []).forEach((phase) => {
          if (!phase.plannedDate) return;
          const key = new Date(phase.plannedDate).toISOString().slice(0, 7);
          const row = monthlyMap.get(key) || { month: key, plannedQty: 0, actualQty: 0 };
          row.plannedQty += Number(phase.plannedQty || 0);
          row.actualQty += Number(phase.totalActualQty || 0);
          monthlyMap.set(key, row);
        });
      });
    });

    liveChallans.forEach((challan) => {
      const key = new Date(challan.dcDate).toISOString().slice(0, 7);
      const row = monthlyMap.get(key) || { month: key, plannedQty: 0, actualQty: 0 };
      if (!row.actualQtyFromChallans) row.actualQtyFromChallans = 0;
      row.actualQtyFromChallans += Number(challan.totalQuantityPcs || 0);
      monthlyMap.set(key, row);
    });

    const clientMap = new Map();
    orders.forEach((order) => {
      const key = String(order.partyId || order.partyName);
      const row = clientMap.get(key) || {
        partyId: order.partyId,
        partyName: order.partyName,
        orderQty: 0,
        dispatchedQty: 0,
        balanceQty: 0,
        openOrders: 0,
      };
      row.orderQty += Number(order.totalOrderQty || 0);
      row.dispatchedQty += Number(order.totalDispatchedQty || 0);
      row.balanceQty += Number(order.totalBalanceQty || 0);
      if (order.status !== 'COMPLETED' && order.status !== 'CANCELLED') row.openOrders += 1;
      clientMap.set(key, row);
    });

    const today = startOfDay(new Date());
    const upcomingDispatches = [];
    let overduePlanCount = 0;
    let overduePlanQty = 0;

    liveSchedules.forEach((schedule) => {
      (schedule.items || []).forEach((item) => {
        (item.phases || []).forEach((phase) => {
          const plannedDate = phase.plannedDate ? startOfDay(phase.plannedDate) : null;
          const varianceQty = Math.max(0, Number(phase.plannedQty || 0) - Number(phase.totalActualQty || 0));
          if (!plannedDate || varianceQty <= 0) return;

          if (plannedDate < today) {
            overduePlanCount += 1;
            overduePlanQty += varianceQty;
          }

          if (plannedDate >= today && plannedDate <= new Date(today.getTime() + 7 * MS_PER_DAY)) {
            upcomingDispatches.push({
              soNumber: schedule.soNumber,
              poNumber: schedule.poNumber,
              partyName: schedule.partyName,
              skuCode: item.skuCode,
              skuName: item.skuName,
              phaseNo: phase.phaseNo,
              plannedDate: phase.plannedDate,
              plannedQty: phase.plannedQty,
              remainingQty: varianceQty,
            });
          }
        });
      });
    });

    return {
      summary: orderTotals,
      planHealth: {
        overduePlanCount,
        overduePlanQty,
        upcomingPlanCount: upcomingDispatches.length,
      },
      monthlyTrend: [...monthlyMap.values()]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((row) => ({
          ...row,
          actualQty: row.actualQty || row.actualQtyFromChallans || 0,
          achievementPct: row.plannedQty > 0 ? Number((((row.actualQty || row.actualQtyFromChallans || 0) / row.plannedQty) * 100).toFixed(2)) : 0,
        })),
      clientBalanceRisk: [...clientMap.values()]
        .sort((a, b) => b.balanceQty - a.balanceQty)
        .slice(0, 10),
      upcomingDispatches: upcomingDispatches.sort((a, b) => new Date(a.plannedDate) - new Date(b.plannedDate)).slice(0, 20),
    };
  },

  async normalizeSheetRows(data) {
    const rows = data.rows || [];
    return rows.map((row) => ({
      soNumber: row['Order Number'] || row['SO Number'] || row.soNumber,
      orderDate: row['Order Date'] || row.orderDate,
      poDate: row['PO Date'] || row.poDate,
      poNumber: row['PO Number'] || row.poNumber,
      partyName: row['Party Name'] || row.partyName,
      skuName: row['SKU (Item Name)'] || row['SKU (Item Name)                '] || row.skuName,
      skuCode: row['SKU Code'] || row.skuCode,
      orderQty: Number(row['Order Qty'] || row.orderQty || 0),
      location: row.Location || row.location,
      asnCode: row['ASN Code/FCI Code'] || row.asnCode,
      partyGroup: row['Party Group'] || row.partyGroup,
      transport: row.Transport || row.transport || 'Road',
      remarks: row.Remarks || row.remarks,
      totalDispatchQty: Number(row['Total Dispatch Qty'] || row.totalDispatchQty || 0),
      balanceQty: Number(row['Balance Qty'] || row.balanceQty || 0),
      orderStatus: row['Order Status'] || row.orderStatus,
      orderDocument: row['Order Document'] || row.orderDocument,
    }));
  },
};
