/**
 * O2D Dashboard (Suite → FMS → O2D → O2D Dashboard), full view: every order
 * of the company. Only for people with o2dfms.dashboardAll — MD, or whoever
 * the MD switches it on for in Employees → lock icon. Everybody else's
 * dashboard is built from their own My FMS Tasks rows (/o2d-fms/fms-tasks).
 *
 * Read-only. Built once for everybody (cached briefly, cleared on any O2D
 * change), the same way o2d-fms-tasks.js builds the task rows it reuses.
 */
import SalesOrder from '../order/order.model.js';
import DispatchSchedule from '../schedule/schedule.model.js';
import DeliveryChallan from '../challan/challan.model.js';
import { DC_STATUS } from '../../config/constants.js';
import { O2DProcess, StepDefinition } from './o2d-fms.model.js';
import { o2dFmsTasks } from './o2d-fms-tasks.js';
import { o2dEvents } from './o2d-events.js';
import { buildBoard, summarizeBoard, summarizeTasks } from './o2d-dashboard.board.js';

const ACTIVE_FMS_KEY = process.env.O2D_ACTIVE_FMS || 'CURRENT_SHEET';
const CACHE_MS = 20000;

const build = async () => {
  const now = Date.now();
  const [orders, processes, schedules, challans, tasks, defs] = await Promise.all([
    SalesOrder.find({})
      .select('soNumber poNumber partyId partyName orderDate status totalOrderQty totalDispatchedQty '
        + 'items.skuCode items.skuName items.orderQty items.dispatchedQty items.rate')
      .lean(),
    O2DProcess.find({ isDeleted: { $ne: true } })
      .select('salesOrderId soNumber partyName source isCompleted createdAt steps.stepCode steps.status')
      .lean(),
    DispatchSchedule.find({})
      .select('orderId soNumber createdAt items.skuCode items.skuName '
        + 'items.phases.plannedDate items.phases.plannedQty items.phases.totalActualQty items.phases.status')
      .lean(),
    // Every live challan: its SKU lines feed "Dispatched" by date, the recent ones the KPI tiles.
    DeliveryChallan.find({ status: { $ne: DC_STATUS.CANCELLED } })
      .select('orderId soNumber dcNumber dcDate totalQuantityPcs items.skuCode items.skuName items.quantityPcs')
      .lean(),
    o2dFmsTasks.list(null, { scope: 'all' }),
    StepDefinition.find({ fmsKey: ACTIVE_FMS_KEY, isActive: { $ne: false }, isDeleted: { $ne: true } })
      .select('stepCode name phase sequence')
      .lean(),
  ]);
  return buildBoard({ orders, processes, schedules, challans, tasks, defs, now });
};

let cache = null; // { at, promise }
o2dEvents.on('changed', () => { cache = null; });

export const o2dDashboard = {
  orders() {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.promise;
    const entry = { at: Date.now(), promise: build() };
    cache = entry;
    entry.promise.catch(() => { if (cache === entry) cache = null; });
    return entry.promise;
  },

  /**
   * Just the KPI tiles, for the Delegation Suite's Dashboard: the company's
   * (`company` — MD / o2dfms.dashboardAll) or this person's own tasks, exactly
   * as their O2D Dashboard shows them.
   */
  async summary(user, { company = false, tzOffset = 0 } = {}) {
    const now = Date.now();
    if (company) return summarizeBoard(await this.orders(), { now, tzOffset });
    return summarizeTasks(await o2dFmsTasks.list(user, { scope: 'mine' }), { now, tzOffset });
  },
};

export default o2dDashboard;
