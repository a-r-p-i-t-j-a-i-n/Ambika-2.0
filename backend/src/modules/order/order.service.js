import SalesOrder from './order.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import { generateDocNumber, generateO2DId } from '../../utils/docNumberGenerator.js';
import { getFiscalYear } from '../../utils/fiscalYear.js';

export const orderService = {
  /**
   * Create a new Sales Order with auto-generated SO number and workflow steps.
   */
  async create(data) {
    // Auto-generate SO number if not provided
    if (!data.soNumber) {
      data.soNumber = await generateDocNumber('SALES_ORDER', data.orderDate || new Date());
    }
    // Auto-set fiscal year
    if (!data.financialYear) {
      data.financialYear = getFiscalYear(data.orderDate || new Date());
    }
    // Auto-generate O2D unique ID
    data.uniqueO2DId = await generateO2DId();

    // Auto-set workflow planned dates based on receivedAt + SLA
    const received = new Date(data.receivedAt || Date.now());
    const addHours = (d, h) => new Date(d.getTime() + h * 3600000);
    const addDays  = (d, days) => new Date(d.getTime() + days * 86400000);

    data.poEntry        = { planned: addHours(received, 1), status: 'PENDING' };
    data.inventoryCheck = { planned: addHours(received, 2), status: 'PENDING' };
    data.scheduling     = { planned: addDays(received, 2),  status: 'PENDING' };
    data.emailSchedule  = { planned: addDays(received, 2),  status: 'PENDING' };

    return SalesOrder.create(data);
  },

  /**
   * Get paginated list of all orders with search, filter, sort.
   */
  async getAll(query) {
    const features = new ApiFeatures(SalesOrder.find(), query)
      .filter()
      .search(['soNumber', 'poNumber', 'partyName', 'location'])
      .sort()
      .select()
      .paginate()
      .populateRefs([
        { path: 'partyId', select: 'name code location creditPeriodDays' },
      ]);
    return features.exec();
  },

  /**
   * Get single order by ID with full population.
   */
  async getById(id) {
    const order = await SalesOrder.findById(id)
      .populate('partyId', 'name code location email phone creditPeriodDays leadTimeDays addresses')
      .populate('items.skuId', 'name code pcsPerBox weightPerPc')
      .lean();
    if (!order) throw new AppError('Sales Order not found', 404);
    return order;
  },

  /**
   * Get all orders for a specific party (Client-wise view).
   */
  async getByParty(partyId, query = {}) {
    const filter = { partyId };
    if (query.status) filter.status = query.status;

    const features = new ApiFeatures(SalesOrder.find(filter), query)
      .sort()
      .select()
      .paginate()
      .populateRefs([
        { path: 'partyId', select: 'name code location' },
      ]);
    return features.exec();
  },

  async getBySoNumber(soNumber) {
    return SalesOrder.findOne({ soNumber }).lean();
  },

  /**
   * Update an existing order.
   */
  async update(id, data) {
    const order = await SalesOrder.findById(id);
    if (!order) throw new AppError('Sales Order not found', 404);

    // Merge updates
    Object.keys(data).forEach((key) => {
      if (key === 'items' && data.items) {
        order.items = data.items;
      } else if (['poEntry', 'inventoryCheck', 'scheduling', 'emailSchedule'].includes(key)) {
        // Merge workflow step fields
        if (!order[key]) order[key] = {};
        Object.assign(order[key], data[key]);
      } else {
        order[key] = data[key];
      }
    });

    await order.save(); // triggers pre-save hooks
    return order.toObject();
  },

  /**
   * Update a specific workflow step.
   */
  async updateWorkflowStep(id, step, stepData) {
    const validSteps = ['poEntry', 'inventoryCheck', 'scheduling', 'emailSchedule'];
    if (!validSteps.includes(step)) throw new AppError(`Invalid workflow step: ${step}`, 400);

    const update = {};
    Object.keys(stepData).forEach((key) => {
      update[`${step}.${key}`] = stepData[key];
    });

    const order = await SalesOrder.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!order) throw new AppError('Sales Order not found', 404);
    return order;
  },

  /**
   * Update dispatch quantity for a specific SKU in an order (called by Challan module).
   */
  async updateDispatchQty(soNumber, skuCode, additionalQty) {
    const order = await SalesOrder.findOne({ soNumber });
    if (!order) throw new AppError(`Sales Order ${soNumber} not found`, 404);

    const item = order.items.find((i) => i.skuCode === skuCode);
    if (!item) throw new AppError(`SKU ${skuCode} not found in order ${soNumber}`, 404);

    item.dispatchedQty = (item.dispatchedQty || 0) + additionalQty;
    item.balanceQty = item.orderQty - item.dispatchedQty;

    await order.save(); // pre-save recalculates totals & status
    return order.toObject();
  },

  /**
   * Delete an order.
   */
  async remove(id) {
    const order = await SalesOrder.findByIdAndDelete(id);
    if (!order) throw new AppError('Sales Order not found', 404);
    return order;
  },

  /**
   * Get comprehensive order statistics for the dashboard.
   */
  async getStats() {
    const [statusStats, totals] = await Promise.all([
      SalesOrder.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalOrderQty: { $sum: '$totalOrderQty' },
            totalDispatchedQty: { $sum: '$totalDispatchedQty' },
            totalBalanceQty: { $sum: '$totalBalanceQty' },
          },
        },
      ]),
      SalesOrder.aggregate([
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalOrderQty: { $sum: '$totalOrderQty' },
            totalDispatchedQty: { $sum: '$totalDispatchedQty' },
            totalBalanceQty: { $sum: '$totalBalanceQty' },
            totalSkuLines: { $sum: { $size: '$items' } },
          },
        },
      ]),
    ]);

    return {
      byStatus: statusStats,
      summary: totals[0] || {
        totalOrders: 0,
        totalOrderQty: 0,
        totalDispatchedQty: 0,
        totalBalanceQty: 0,
        totalSkuLines: 0,
      },
    };
  },
};
