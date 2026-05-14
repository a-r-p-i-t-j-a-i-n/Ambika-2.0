import PurchaseOrder from './purchase-order.model.js';
import SalesOrder from '../order/order.model.js';
import Sku from '../skus/sku.model.js';
import { AppError } from '../../utils/apiResponse.js';
import { generateDocNumber } from '../../utils/docNumberGenerator.js';
import { getFiscalYear } from '../../utils/fiscalYear.js';
import { appEvents, EVENTS } from '../../events/index.js';

export const createPurchaseOrder = async (data, userId) => {
  const existingPo = await PurchaseOrder.findOne({ clientId: data.clientId, poNumber: data.poNumber });
  if (existingPo) {
    throw new AppError(`PO Number '${data.poNumber}' already exists for this client`, 400);
  }
  
  const po = new PurchaseOrder({
    ...data,
    createdBy: userId
  });
  
  return await po.save();
};

export const getPurchaseOrders = async (query = {}) => {
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 10;
  const skip = (page - 1) * limit;
  
  const filter = { isDeleted: false };
  if (query.clientId) filter.clientId = query.clientId;
  if (query.poStatus) filter.poStatus = query.poStatus;
  
  const [data, total] = await Promise.all([
    PurchaseOrder.find(filter)
      .populate('clientId', 'companyName code')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }),
    PurchaseOrder.countDocuments(filter)
  ]);
  
  return { data, meta: { total, page, limit } };
};

export const getPurchaseOrderById = async (id) => {
  const po = await PurchaseOrder.findOne({ _id: id, isDeleted: false })
    .populate('clientId', 'companyName code')
    .populate('orderLines.skuId', 'name code unit');
  if (!po) throw new AppError('Purchase Order not found', 404);
  return po;
};

// Auto-generates a Sales Order from a valid Purchase Order
export const generateSalesOrder = async (poId, userId) => {
  const po = await PurchaseOrder.findOne({ _id: poId, isDeleted: false });
  if (!po) throw new AppError('Purchase Order not found', 404);
  
  if (po.poStatus === 'SO_GENERATED' && po.salesOrderId) {
    throw new AppError('Sales Order already generated for this PO', 400);
  }
  
  const soNumber = await generateDocNumber('SALES_ORDER', new Date());
  
  const orderItems = [];
  for (const line of po.orderLines) {
    const sku = await Sku.findById(line.skuId);
    if (!sku) continue;

    orderItems.push({
      skuId: sku._id,
      skuName: sku.name,
      skuCode: sku.code,
      orderQty: line.orderedQty,
      dispatchedQty: 0,
      balanceQty: line.orderedQty,
      remark: line.remarks
    });
  }

  const receivedAt = new Date();
  const addHours = (d, h) => new Date(d.getTime() + h * 3600000);
  const addDays  = (d, days) => new Date(d.getTime() + days * 86400000);

  const so = new SalesOrder({
    partyId: po.clientId,
    partyName: po.partyName,
    purchaseOrderId: po._id,
    poNumber: po.poNumber,
    poDate: po.poDate,
    soNumber: soNumber,
    orderDate: new Date(),
    receivedAt: receivedAt,
    items: orderItems,
    financialYear: getFiscalYear(new Date()),
    createdBy: userId,
    // Initialize workflow
    poEntry:        { planned: addHours(receivedAt, 1), status: 'PENDING' },
    inventoryCheck: { planned: addHours(receivedAt, 2), status: 'PENDING' },
    scheduling:     { planned: addDays(receivedAt, 2),  status: 'PENDING' },
    emailSchedule:  { planned: addDays(receivedAt, 2),  status: 'PENDING' },
  });
  
  await so.save();
  
  po.poStatus = 'SO_GENERATED';
  po.salesOrderId = so._id;
  await po.save();
  
  // Emit event to kick off the Workflow Engine (Step 2.01)
  appEvents.emit(EVENTS.ORDER_CREATED, { salesOrderId: so._id, clientId: so.clientId });
  
  return so;
};
