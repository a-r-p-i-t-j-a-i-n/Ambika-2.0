/**
 * Item Delivery Calendar → the Dispatch Calendar's own month-grid print.
 *
 * The sheet is built by utils/printDispatchCalendar.js (buildCalendarSheet, via
 * its generic printPlanCalendar / downloadPlanCalendarPdf entry points) — the
 * very code that prints the Dispatch Calendar — so rows, cards and text sizes
 * are the Dispatch ones. Only the data and labels differ: delivery lines become
 * calendar events, Delivered cards are tagged DEL in green, and the titles and
 * filter line read Item Delivery.
 */
import dayjs from 'dayjs';
import { downloadPlanCalendarPdf, printPlanCalendar } from '../../utils/printDispatchCalendar';

export const DELIVERED_COLOR = '#0f7a2f';
/** The extra card type for the shared print: green DEL. */
const DELIVERY_TYPES = { delivered: { label: 'Delivered', short: 'DEL', color: DELIVERED_COLOR } };

/**
 * Delivery lines → Dispatch calendar events. Each vendor's day is one card per
 * status (groupKey), items merged, and the "orders" merged are the PO numbers.
 */
export const toCalendarEvents = (events) => (Array.isArray(events) ? events : []).map((e) => ({
  id: e.key,
  dateKey: dayjs(e.date).format('YYYY-MM-DD'),
  date: e.date,
  partyName: e.vendor,
  groupKey: `${e.vendorKey || e.vendor}|${e.status}`,
  eventType: e.status === 'DELIVERED' ? 'delivered' : 'scheduled',
  status: 'PLANNED',
  isDelayed: false,
  delayDays: 0,
  soNumber: e.poNumber,
  plannedQty: Number(e.qty) || 0,
  actualQty: 0,
  pendingQty: 0,
  skus: [{ skuName: e.item, skuCode: e.sku, plannedQty: Number(e.qty) || 0, actualQty: 0, pendingQty: 0 }],
}));

// The Dispatch filter line wording: "All statuses · All items · All vendors".
const ALL = { Status: 'All statuses', Item: 'All items', Vendor: 'All vendors' };
const labelOf = (filters, k) => { const v = (filters.find(([key]) => key === k) || [])[1]; return !v || v === 'All' ? ALL[k] : v; };

const optionsOf = (payload) => ({
  month: dayjs(new Date(payload.year, payload.month, 1)).toISOString(),
  events: toCalendarEvents(payload.events),
  filters: {
    contentLabel: labelOf(payload.filters, 'Status'),
    partyLabel: labelOf(payload.filters, 'Item'),
    statusLabel: labelOf(payload.filters, 'Vendor'),
  },
  title: 'Item Delivery Calendar',
  footer: 'Generated from Purchase FMS · Item Delivery Calendar',
  emptyCellText: 'No delivery',
  types: DELIVERY_TYPES,
  docTitle: 'Item Delivery Calendar',
  fileStem: 'Item-Delivery',
});

/** Same name the shared print gives the file: Item-Delivery-Calendar-Nov-2026.pdf. */
export const fileNameOf = (year, month) => `Item-Delivery-Calendar-${dayjs(new Date(year, month, 1)).format('MMM-YYYY')}.pdf`;

/** "Preview" — the Dispatch print-preview tab (Print / Save PDF · Close). */
export const previewDeliveryPdf = async (payload) => printPlanCalendar(optionsOf(payload));

/** "Download PDF" — the same sheet saved straight to a .pdf file. */
export const downloadDeliveryPdf = (payload) => downloadPlanCalendarPdf(optionsOf(payload));
