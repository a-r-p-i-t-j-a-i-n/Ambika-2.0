/**
 * Application-wide constants for AGL DPES
 */

// ── Document Number Prefixes ────────────────────────────────
export const DOC_PREFIX = {
  SALES_ORDER:      'AGL/SO',
  DELIVERY_CHALLAN: 'AGL/DC',
  TAX_INVOICE:      'AGL/TI',
  O2D_TRACKER:      'AGL-O2D',
};

// ── Sales Order Statuses ────────────────────────────────────
export const SO_STATUS = {
  RECEIVED:     'RECEIVED',
  PLANNING:     'PLANNING',
  IN_PROGRESS:  'IN_PROGRESS',
  COMPLETED:    'COMPLETED',
  SHORT_CLOSED: 'SHORT_CLOSED',
  CANCELLED:    'CANCELLED',
};

// ── Dispatch Schedule Statuses ──────────────────────────────
export const SCHEDULE_STATUS = {
  DRAFT:     'DRAFT',
  SENT:      'SENT',
  ACTIVE:    'ACTIVE',
  COMPLETED: 'COMPLETED',
};

// ── Delivery Challan Statuses ───────────────────────────────
export const DC_STATUS = {
  CREATED:    'CREATED',
  DISPATCHED: 'DISPATCHED',
  DELIVERED:  'DELIVERED',
  CANCELLED:  'CANCELLED',
};

// ── Invoice Statuses ────────────────────────────────────────
export const INVOICE_STATUS = {
  PENDING:  'PENDING',
  CREATED:  'CREATED',
  SENT:     'SENT',
  PAID:     'PAID',
  PARTIAL:  'PARTIAL',
};

// ── Payment Types ───────────────────────────────────────────
export const PAYMENT_TYPE = {
  CLIENT_PAYMENT:    'CLIENT_PAYMENT',
  TRANSPORT_PAYMENT: 'TRANSPORT_PAYMENT',
};

// ── Workflow Step Statuses ───────────────────────────────────
export const STEP_STATUS = {
  PENDING: 'PENDING',
  YES:     'YES',
  DONE:    'DONE',
  DELAYED: 'DELAYED',
  SKIPPED: 'SKIPPED',
};

// ── Transport Types ─────────────────────────────────────────
export const TRANSPORT_TYPE = {
  FREIGHT_PAID:   'Freight Paid',
  PARTY_VEHICLE:  'Party Vehicle',
  TO_PAY:         'To Pay',
};

// ── Pagination Defaults ─────────────────────────────────────
export const PAGINATION = {
  DEFAULT_PAGE:  1,
  DEFAULT_LIMIT: 25,
  MAX_LIMIT:     1000,
};

// ── Dispatch Phase Labels ───────────────────────────────────
export const PHASE_LABELS = ['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10'];
