/**
 * Recycle Bin catalog — every kind of record the ERP can put in the bin: its
 * module, its name, the screen it is normally deleted from and where it can
 * be opened again after a restore.
 *
 * Paths are ERP screen paths; the Suite shows them under /delegation/erp.
 */

export const MODULES = Object.freeze({
  o2d:        'O2D',
  purchase:   'Purchase',
  masters:    'Master Data',
  production: 'Production',
  settings:   'Settings',
});

const at = (label, path) => ({ label, path });

export const TYPES = Object.freeze({
  // ── O2D / Sales ───────────────────────────────────────────────
  salesOrder:       { module: 'o2d', label: 'Sales Order',       from: at('Sales › Sales Orders', '/orders'),                open: (id) => `/orders/${id}` },
  challan:          { module: 'o2d', label: 'Delivery Challan',  from: at('O2D › Step Board', '/o2d-fms/steps'),             open: (id) => `/challans/${id}` },
  dispatchPhase:    { module: 'o2d', label: 'Dispatch Phase',    from: at('Sales › Dispatch Planning', '/dispatch-planning') },
  dispatchSchedule: { module: 'o2d', label: 'Dispatch Schedule', from: at('Sales › Dispatch Planning', '/dispatch-planning') },
  orderIntake:      { module: 'o2d', label: 'Order Intake',      from: at('Sales › Order Intake', '/order-intake') },
  quote:            { module: 'o2d', label: 'Quote',             from: at('Sales › Quotes', '/quotes'),                      open: (id) => `/quotes/${id}` },
  o2dTemplate:      { module: 'o2d', label: 'Task Template',     from: at('O2D › Task Templates', '/o2d-fms/templates') },
  o2dStep:          { module: 'o2d', label: 'O2D Step',          from: at('O2D › Step Builder', '/o2d-fms/config') },
  o2dProof:         { module: 'o2d', label: 'Step Proof File',   from: at('O2D › Step task', '/o2d-fms') },

  // ── Master Data ───────────────────────────────────────────────
  party:             { module: 'masters', label: 'Party',              from: at('Master Data › Parties', '/parties'),                 open: (id) => `/parties/${id}` },
  partySku:          { module: 'masters', label: 'Party SKU',          from: at('Master Data › Parties', '/parties') },
  sku:               { module: 'masters', label: 'SKU',                from: at('Master Data › SKU Master', '/skus') },
  vendor:            { module: 'masters', label: 'Vendor',             from: at('Master Data › Vendor Details', '/procurement/vendors'), open: (id) => `/procurement/vendors/${id}` },
  transporter:       { module: 'masters', label: 'Transporter',        from: at('O2D › Transporter Master', '/o2d-fms/transporters') },
  machine:           { module: 'masters', label: 'Machine',            from: at('Master Data › Machines', '/machines'),               open: (id) => `/machines/${id}` },
  operator:          { module: 'masters', label: 'Machine Operator',   from: at('Master Data › Machine Operators', '/machine-operators'), open: (id) => `/machine-operators/${id}` },
  machineAssignment: { module: 'masters', label: 'Machine Assignment', from: at('Master Data › Machines', '/machines') },

  // ── Production ────────────────────────────────────────────────
  dprEntry:       { module: 'production', label: 'DPR Entry',       from: at('PPC › DPR Register', '/ppc/dpr/register') },
  dprMaster:      { module: 'production', label: 'DPR Master',      from: at('PPC › DPR Masters', '/ppc/dpr/masters') },
  productionPlan: { module: 'production', label: 'Production Plan', from: at('Planning › Production Plan', '/production-planning') },

  // ── Purchase FMS ──────────────────────────────────────────────
  indent:          { module: 'purchase', label: 'Purchase Indent',    from: at('Purchase FMS › Purchase Indents', '/purchase-fms/purchase-indents'), open: (id) => `/procurement/indents/${id}` },
  quotationStep:   { module: 'purchase', label: 'Quotation Step',     from: at('Purchase FMS › Purchase Indents', '/purchase-fms/purchase-indents'), open: (id) => `/procurement/indents/${id}` },
  purchaseOrder:   { module: 'purchase', label: 'Purchase Order',     from: at('Purchase FMS › Purchase Orders', '/purchase-fms/purchase-orders'),   open: (id) => `/procurement/purchase-orders/${id}` },
  followUp:        { module: 'purchase', label: 'Material Follow-up', from: at('Purchase FMS › Follow-ups', '/purchase-fms/follow-ups'),             open: (id) => `/procurement/follow-ups/${id}` },
  proformaInvoice: { module: 'purchase', label: 'Proforma Invoice',   from: at('Purchase FMS › PI Forms', '/purchase-fms/pi-forms'),                 open: (id) => `/procurement/proforma-invoices/${id}` },
  advancePayment:  { module: 'purchase', label: 'Advance Payment',    from: at('Purchase › Advance Payments', '/procurement/advance-payments') },
  grn:             { module: 'purchase', label: 'GRN',                from: at('Purchase FMS › GRN', '/purchase-fms/grn'),                           open: (id) => `/procurement/grns/${id}` },
  incomingQc:      { module: 'purchase', label: 'Incoming QC',        from: at('Purchase FMS › Incoming QC', '/purchase-fms/incoming-qc'),           open: (id) => `/procurement/incoming-qc/${id}` },
  vendorInvoice:   { module: 'purchase', label: 'Vendor Invoice',     from: at('Purchase FMS › Vendor Invoices', '/purchase-fms/vendor-invoices'),   open: (id) => `/procurement/vendor-invoices/${id}` },
  voucher:         { module: 'purchase', label: 'Payment Voucher',    from: at('Purchase FMS › Payment Vouchers', '/purchase-fms/payment-vouchers'), open: (id) => `/procurement/vouchers/${id}` },
  tallyEntry:      { module: 'purchase', label: 'Tally Entry',        from: at('Purchase FMS › Tally Entries', '/purchase-fms/tally-entries'),       open: (id) => `/procurement/tally-entries/${id}` },
  finalPayment:    { module: 'purchase', label: 'Final Payment',      from: at('Purchase FMS › Final Payments', '/purchase-fms/final-payments'),     open: (id) => `/procurement/final-payments/${id}` },

  // ── Settings ──────────────────────────────────────────────────
  pdfAsset: { module: 'settings', label: 'Signature / Stamp', from: at('Settings › Company Settings', '/company-settings') },
  role:     { module: 'settings', label: 'Role',              from: at('Access Control › Roles', '/access-control') },
});

/**
 * Screen names by path prefix — longest match wins. The ERP pages send their
 * path with every change (x-client-page), so the bin can say exactly where
 * something was deleted.
 */
const PAGES = [
  ['/o2d-fms/steps', 'O2D › Step Board'],
  ['/o2d-fms/task', 'O2D › Step task'],
  ['/o2d-fms/process', 'O2D › Process'],
  ['/o2d-fms/all-tasks', 'O2D › All Tasks'],
  ['/o2d-fms/master-data', 'O2D › Master Data'],
  ['/o2d-fms/master', 'O2D › Master'],
  ['/o2d-fms/config', 'O2D › Step Builder'],
  ['/o2d-fms/templates', 'O2D › Task Templates'],
  ['/o2d-fms/transporters', 'O2D › Transporter Master'],
  ['/o2d-fms', 'O2D FMS'],
  ['/o2d/', 'O2D'],
  ['/orders', 'Sales › Sales Orders'],
  ['/order-intake', 'Sales › Order Intake'],
  ['/quotes', 'Sales › Quotes'],
  ['/dispatch-planning', 'Sales › Dispatch Planning'],
  ['/dispatch-control-tower', 'Dispatch Control Tower'],
  ['/challans', 'O2D › Delivery Challans'],
  ['/production-planning', 'Planning › Production Plan'],
  ['/ppc/dpr/masters', 'PPC › DPR Masters'],
  ['/ppc/dpr', 'PPC › DPR Register'],
  ['/purchase-fms/purchase-indents', 'Purchase FMS › Purchase Indents'],
  ['/purchase-fms/purchase-orders', 'Purchase FMS › Purchase Orders'],
  ['/purchase-fms/follow-ups', 'Purchase FMS › Follow-ups'],
  ['/purchase-fms/pi-forms', 'Purchase FMS › PI Forms'],
  ['/purchase-fms/grn', 'Purchase FMS › GRN'],
  ['/purchase-fms/incoming-qc', 'Purchase FMS › Incoming QC'],
  ['/purchase-fms/vendor-invoices', 'Purchase FMS › Vendor Invoices'],
  ['/purchase-fms/payment-vouchers', 'Purchase FMS › Payment Vouchers'],
  ['/purchase-fms/tally-entries', 'Purchase FMS › Tally Entries'],
  ['/purchase-fms/final-payments', 'Purchase FMS › Final Payments'],
  ['/purchase-fms/invoices-payments', 'Purchase FMS › Invoices & Payments'],
  ['/purchase-fms', 'Purchase FMS'],
  ['/procurement/master-data', 'Purchase › Master Data'],
  ['/procurement/indents', 'Purchase › Purchase Indent'],
  ['/procurement/purchase-orders', 'Purchase › Purchase Order'],
  ['/procurement/follow-ups', 'Purchase › Follow-up'],
  ['/procurement/proforma-invoices', 'Purchase › Proforma Invoice'],
  ['/procurement/advance-payments', 'Purchase › Advance Payments'],
  ['/procurement/grns', 'Purchase › GRN'],
  ['/procurement/incoming-qc', 'Purchase › Incoming QC'],
  ['/procurement/vendor-invoices', 'Purchase › Vendor Invoice'],
  ['/procurement/vouchers', 'Purchase › Payment Voucher'],
  ['/procurement/tally-entries', 'Purchase › Tally Entry'],
  ['/procurement/final-payments', 'Purchase › Final Payment'],
  ['/procurement/vendors', 'Master Data › Vendor Details'],
  ['/skus', 'Master Data › SKU Master'],
  ['/parties', 'Master Data › Parties'],
  ['/machine-operators', 'Master Data › Machine Operators'],
  ['/machines', 'Master Data › Machines'],
  ['/company-settings', 'Settings › Company Settings'],
  ['/access-control', 'Access Control'],
].sort((a, b) => b[0].length - a[0].length);

/** The page a request came from → { label, path }, or null when unknown. */
export const pageFrom = (rawPath) => {
  const path = String(rawPath || '').split(/[?#]/)[0].slice(0, 200);
  if (!path.startsWith('/')) return null;
  const hit = PAGES.find(([prefix]) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
  return hit ? { label: hit[1], path } : null;
};
