import mongoose from 'mongoose';
import SalesOrder from '../order/order.model.js';
import Party from '../clients/party.model.js';
import SKU from '../skus/sku.model.js';
import DispatchSchedule from '../schedule/schedule.model.js';
import DeliveryChallan from '../challan/challan.model.js';
import PPCEntry from '../ppc/ppc.model.js';
import { AppError } from '../../utils/apiResponse.js';
import { generateDocNumber, generateO2DId } from '../../utils/docNumberGenerator.js';
import { getFiscalYear } from '../../utils/fiscalYear.js';

const PLAN_LABEL_PREFIX = 'Dispatch Plan';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

const getOrCreateSchedule = async (order) => {
  let schedule = await DispatchSchedule.findOne({ soNumber: order.soNumber }).sort({ createdAt: -1 });
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

const applyActualToSchedule = async ({ order, challan }) => {
  const schedule = await DispatchSchedule.findOne({ soNumber: order.soNumber }).sort({ createdAt: -1 });
  if (!schedule) return null;

  for (const dcItem of challan.items) {
    const orderItem = findOrderLine(order, dcItem);
    if (!orderItem) continue;

    const scheduleItem = schedule.items.find((item) => (
      normalizeKey(item.skuCode) === normalizeKey(orderItem.skuCode)
      || normalizeKey(item.skuName) === normalizeKey(orderItem.skuName)
    ));
    if (!scheduleItem) continue;

    const dispatchDate = startOfDay(challan.dcDate);
    const orderedPhases = [...scheduleItem.phases].sort((a, b) => new Date(a.plannedDate || 0) - new Date(b.plannedDate || 0));
    const exactDatePhase = orderedPhases.find((phase) => (
      phase.plannedDate
      && startOfDay(phase.plannedDate).getTime() === dispatchDate.getTime()
      && Number(phase.totalActualQty || 0) < Number(phase.plannedQty || 0)
    ));
    const openPhase = exactDatePhase || orderedPhases.find((phase) => Number(phase.totalActualQty || 0) < Number(phase.plannedQty || 0));
    const targetPhase = openPhase || orderedPhases[orderedPhases.length - 1];
    if (!targetPhase) continue;

    targetPhase.actualDates = [...(targetPhase.actualDates || []), dispatchDate];
    targetPhase.actualQtys = [...(targetPhase.actualQtys || []), Number(dcItem.quantityPcs || 0)];
    targetPhase.totalActualQty = Number(targetPhase.totalActualQty || 0) + Number(dcItem.quantityPcs || 0);

    recalculateScheduleItem(scheduleItem, orderItem);
  }

  await schedule.save();
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

    const phases = scheduleItem?.phases || [];
    const plannedQty = phases.reduce((sum, phase) => sum + Number(phase.plannedQty || 0), 0);
    const futurePlannedQty = phases.reduce((sum, phase) => {
      if (!phase.plannedDate || startOfDay(phase.plannedDate) < today) return sum;
      return sum + Math.max(0, Number(phase.plannedQty || 0) - Number(phase.totalActualQty || 0));
    }, 0);
    const actual = actualsBySku.get(normalizeKey(orderItem.skuCode)) || actualsBySku.get(normalizeKey(orderItem.skuName));
    const actualQty = Number(actual?.actualQty || orderItem.dispatchedQty || 0);
    const balanceQty = Math.max(0, Number(orderItem.orderQty || 0) - actualQty);
    const pendingPlannedQty = Math.max(0, plannedQty - actualQty);
    const unplannedBalanceQty = Math.max(0, balanceQty - futurePlannedQty);
    const overduePlannedQty = phases.reduce((sum, phase) => {
      if (!phase.plannedDate || startOfDay(phase.plannedDate) >= today) return sum;
      return sum + Math.max(0, Number(phase.plannedQty || 0) - Number(phase.totalActualQty || 0));
    }, 0);

    const risks = [];
    if (overduePlannedQty > 0) risks.push({ type: 'OVERDUE_PLAN', severity: 'HIGH', qty: overduePlannedQty });
    if (actualQty > plannedQty && actualQty > 0) risks.push({ type: 'UNPLANNED_DISPATCH', severity: 'MEDIUM', qty: actualQty - plannedQty });
    if (actualQty > Number(orderItem.orderQty || 0)) risks.push({ type: 'OVER_DISPATCH', severity: 'HIGH', qty: actualQty - Number(orderItem.orderQty || 0) });
    if (unplannedBalanceQty > 0) risks.push({ type: 'BALANCE_NOT_PLANNED', severity: 'MEDIUM', qty: unplannedBalanceQty });

    return {
      orderItemId: orderItem._id,
      skuCode: orderItem.skuCode,
      skuName: orderItem.skuName,
      orderQty: orderItem.orderQty,
      plannedQty,
      actualQty,
      balanceQty,
      pendingPlannedQty,
      remainingToPlanQty: Math.max(0, Number(orderItem.orderQty || 0) - plannedQty),
      carryForwardSuggestionQty: unplannedBalanceQty,
      fulfillmentPct: orderItem.orderQty > 0 ? Number(((actualQty / orderItem.orderQty) * 100).toFixed(2)) : 0,
      planAchievementPct: plannedQty > 0 ? Number(((actualQty / plannedQty) * 100).toFixed(2)) : 0,
      risks,
      phases: phases.map((phase) => ({
        phaseNo: phase.phaseNo,
        planType: `${PLAN_LABEL_PREFIX} ${phaseNumberFromLabel(phase.phaseNo)}`,
        plannedDate: phase.plannedDate,
        plannedQty: phase.plannedQty,
        actualQty: phase.totalActualQty || 0,
        varianceQty: Number(phase.plannedQty || 0) - Number(phase.totalActualQty || 0),
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

    return order.populate('partyId', 'name code location email phone addresses');
  },

  async planDispatch(data) {
    const order = await SalesOrder.findOne({ soNumber: data.soNumber });
    if (!order) throw new AppError(`Sales Order ${data.soNumber} not found`, 404);

    const schedule = await getOrCreateSchedule(order);
    const planLines = data.planLines || data.items || [];
    if (!planLines.length) throw new AppError('At least one plan line is required', 422);

    for (const [index, line] of planLines.entries()) {
      const orderItem = findOrderLine(order, line);
      if (!orderItem) throw new AppError(`SKU ${line.skuCode || line.skuName || line.itemName} not found in ${order.soNumber}`, 404);

      let scheduleItem = schedule.items.find((item) => (
        normalizeKey(item.skuCode) === normalizeKey(orderItem.skuCode)
        || normalizeKey(item.skuName) === normalizeKey(orderItem.skuName)
      ));

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

      const existingPhase = scheduleItem.phases.find((phase) => phase.phaseNo === phaseNo);
      const alreadyPlannedExcludingThis = scheduleItem.phases.reduce((sum, phase) => (
        phase.phaseNo === phaseNo ? sum : sum + Number(phase.plannedQty || 0)
      ), 0);
      if (!data.allowOverPlan && alreadyPlannedExcludingThis + plannedQty > Number(orderItem.orderQty || 0)) {
        throw new AppError(`Plan exceeds order quantity for ${orderItem.skuCode}. Enable allowOverPlan to override.`, 422);
      }

      if (existingPhase) {
        existingPhase.plannedDate = new Date(plannedDate);
        existingPhase.plannedQty = plannedQty;
      } else {
        scheduleItem.phases.push({
          phaseNo,
          plannedDate: new Date(plannedDate),
          plannedQty,
          actualDates: [],
          actualQtys: [],
          totalActualQty: 0,
        });
      }

      recalculateScheduleItem(scheduleItem, orderItem);
      await upsertPpcDailyPlan({ order, orderItem, date: plannedDate, plannedQty });
    }

    schedule.status = data.status || 'ACTIVE';
    schedule.pdfUrl = data.pdfUrl || schedule.pdfUrl;
    await schedule.save();

    if (order.status === 'RECEIVED') {
      order.status = 'PLANNING';
      await order.save();
    }

    return buildComparison(order.soNumber);
  },

  async createActualDispatch(data) {
    const order = await SalesOrder.findOne({ soNumber: data.soNumber });
    if (!order) throw new AppError(`Sales Order ${data.soNumber} not found`, 404);

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

    const challan = await DeliveryChallan.create({
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
    });

    await order.save();
    await applyActualToSchedule({ order, challan });

    return {
      challan,
      comparison: await buildComparison(order.soNumber),
    };
  },

  async getComparison(soNumber) {
    return buildComparison(soNumber);
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
    schedules.forEach((schedule) => {
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

    challans.forEach((challan) => {
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

    schedules.forEach((schedule) => {
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
