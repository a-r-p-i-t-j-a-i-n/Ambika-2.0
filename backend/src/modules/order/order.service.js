import SalesOrder from './order.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import { generateDocNumber, generateO2DId } from '../../utils/docNumberGenerator.js';
import { getFiscalYear } from '../../utils/fiscalYear.js';
import { SO_STATUS } from '../../config/constants.js';
import { o2dFmsService } from '../o2d-fms/o2d-fms.service.js';
import { partyService } from '../clients/party.service.js';
import { logger } from '../../utils/logger.js';

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

    const intakeId = data.intakeId || null;
    const order = await SalesOrder.create(data);

    // Start / advance the O2D FMS. Non-fatal: order creation must never fail.
    try {
      if (intakeId) {
        // Converted from an Order Intake — reuse that process, link the SO, advance ORDER_ENTRY.
        await o2dFmsService.linkIntakeProcessToOrder(intakeId, order);
      } else {
        await o2dFmsService.buildProcessForOrder(order);
        await o2dFmsService.advanceByTrigger({ salesOrderId: order._id }, 'ORDER_ENTRY');
      }
    } catch (err) {
      logger.error(`[O2D-FMS] Failed to start/advance process for SO ${order.soNumber}: ${err.message}`);
    }

    return order;
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
      .populate('createdBy', 'name email')
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
  async update(id, data, actor = null) {
    const order = await SalesOrder.findById(id);
    if (!order) throw new AppError('Sales Order not found', 404);

    // ── Amending the items (e.g. customer revises Dome Jar 100 → 2000) ──
    // The incoming list REPLACES order.items, so we must carry the already
    // dispatched quantity across per SKU. Without this, an amend would reset
    // dispatchedQty to 0 and wipe the real dispatch history (challans already
    // shipped), corrupting balances, the tracker and every consignment.
    if (data.items) {
      const prevByKey = new Map();
      (order.items || []).forEach((it) => {
        if (it.skuId) prevByKey.set(String(it.skuId), it);
        if (it.skuCode) prevByKey.set(`code:${String(it.skuCode).toLowerCase()}`, it);
      });
      const prevOf = (it) => prevByKey.get(String(it.skuId))
        || prevByKey.get(`code:${String(it.skuCode || '').toLowerCase()}`)
        || null;

      // Human-readable diff for the amendment log (before we overwrite items).
      const changes = [];
      data.items.forEach((it) => {
        const prev = prevOf(it);
        const newQty = Number(it.orderQty || 0);
        if (!prev) changes.push(`${it.skuName} (${it.skuCode}): added — ${newQty} pcs`);
        else if (Number(prev.orderQty || 0) !== newQty) {
          changes.push(`${it.skuName} (${it.skuCode}): ${Number(prev.orderQty || 0)} → ${newQty} pcs`);
        }
      });
      (order.items || []).forEach((prev) => {
        const stillThere = data.items.some((it) => (
          String(it.skuId) === String(prev.skuId)
          || String(it.skuCode || '').toLowerCase() === String(prev.skuCode || '').toLowerCase()
        ));
        if (!stillThere) changes.push(`${prev.skuName} (${prev.skuCode}): removed`);
      });

      data.items = data.items.map((it) => {
        const prev = prevOf(it);
        return {
          ...it,
          // Never trust an incoming dispatchedQty of 0 over what was really shipped.
          dispatchedQty: Math.max(Number(it.dispatchedQty || 0), Number(prev?.dispatchedQty || 0)),
        };
      });

      if (changes.length) {
        order.revisionNo = Number(order.revisionNo || 0) + 1;
        order.amendments.push({
          at: new Date(),
          byName: actor?.name || null,
          reason: data.amendReason || '',
          changes,
        });
      }
    }

    // ── Cancellation audit ──
    if (data.status === SO_STATUS.CANCELLED && order.status !== SO_STATUS.CANCELLED) {
      order.cancelledAt = new Date();
      order.cancelledBy = actor?._id || null;
      order.cancelReason = data.cancelReason || order.cancelReason || '';
    }
    // Re-opening a cancelled order clears the cancellation stamp.
    if (data.status && data.status !== SO_STATUS.CANCELLED && order.status === SO_STATUS.CANCELLED) {
      order.cancelledAt = null;
      order.cancelledBy = null;
      order.cancelReason = '';
    }

    // Merge updates
    Object.keys(data).forEach((key) => {
      if (key === 'amendReason') return; // log-only, not a stored field
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

    // Keep the party's saved catalog in step with any edited items/prices
    // (learn new SKUs, append changed prices). Non-fatal.
    if (data.items && order.partyId) {
      try {
        await partyService.syncOrderedSkus(order.partyId, order.items, { soNumber: order.soNumber, source: 'ORDER' });
      } catch (err) {
        logger.error(`[catalog-sync] SO ${order.soNumber}: ${err.message}`);
      }
    }

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
  async updateDispatchQty(soNumber, skuRef, additionalQty) {
    const order = await SalesOrder.findOne({ soNumber });
    if (!order) throw new AppError(`Sales Order ${soNumber} not found`, 404);

    const normalizedRef = String(skuRef || '').trim().toLowerCase();
    const item = order.items.find((i) => (
      String(i.skuCode || '').trim().toLowerCase() === normalizedRef
      || String(i.skuName || '').trim().toLowerCase() === normalizedRef
      || String(i._id || '') === String(skuRef || '')
    ));
    if (!item) throw new AppError(`SKU ${skuRef} not found in order ${soNumber}`, 404);

    item.dispatchedQty = (item.dispatchedQty || 0) + additionalQty;
    item.balanceQty = Math.max(0, item.orderQty - item.dispatchedQty);
    item.extraSentQty = Math.max(0, item.dispatchedQty - item.orderQty);

    await order.save(); // pre-save recalculates totals & status
    return order.toObject();
  },

  /**
   * Delete an order.
   */
  async remove(id) {
    const order = await SalesOrder.findByIdAndDelete(id);
    if (!order) throw new AppError('Sales Order not found', 404);
    // Cascade: remove the order's O2D FMS process so no orphan tracker remains.
    try {
      const { O2DProcess } = await import('../o2d-fms/o2d-fms.model.js');
      await O2DProcess.deleteOne({ salesOrderId: order._id });
    } catch (err) {
      logger.error(`[order.remove] failed to clean O2D process for ${order.soNumber}: ${err.message}`);
    }
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
