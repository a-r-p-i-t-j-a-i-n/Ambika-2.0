/**
 * Purchase FMS task → the record page where that step's work is done.
 *
 * O2D tasks open their order's step (/o2d-fms/task/:processId/:stepCode) and
 * carry fromTask / fromStep to the work screen. Purchase has no per-step task
 * page: each step's actions live on the waiting document's own detail page
 * (Indent, PO, PI, GRN, QC, Invoice, Voucher). So a Purchase task opens that
 * record, carrying ?fmsTask=<task id> so the page can say which task sent
 * the doer there.
 *
 * The link is worked out when the task is read — never from the stored
 * `entityLink` text — so tasks saved before this existed get the same link,
 * and a route is built only from a known entity type and a valid ObjectId.
 * Pure: no models, no DB.
 */

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
export const isObjectId = (v) => OBJECT_ID.test(String(v ?? ''));

/** Detail route of each workflow record type a Purchase task can wait on. */
export const ENTITY_ROUTES = {
  INDENT:  { path: '/procurement/indents',           label: 'Indent' },
  PO:      { path: '/procurement/purchase-orders',   label: 'Purchase Order' },
  PI:      { path: '/procurement/proforma-invoices', label: 'Proforma Invoice' },
  GRN:     { path: '/procurement/grns',              label: 'GRN' },
  QC:      { path: '/procurement/incoming-qc',       label: 'Incoming QC' },
  INVOICE: { path: '/procurement/vendor-invoices',   label: 'Vendor Invoice' },
  VOUCHER: { path: '/procurement/vouchers',          label: 'Voucher' },
};

/**
 * Step → record types that wait there, and what the doer does on that page.
 * Mirrors the `sources` of each step in fmsCatalog.js (a test keeps the two in
 * step). Each page below hosts that step's action:
 *   Indent detail  — submit, approve, quote/comparative, quotation approval, Create PO, service QC
 *   PO detail      — approve, release, follow-ups, Create GRN
 *   PI detail      — approve PI, advance payment
 *   GRN detail     — QC
 *   QC detail      — Create vendor invoice
 *   Invoice detail — approve invoice, voucher (VoucherPanel)
 *   Voucher detail — post, Tally entry, final payment (VoucherPanel)
 */
export const PURCHASE_STEP_LINKS = {
  INDENT_CREATE:      { INDENT: 'Complete & submit the indent' },
  INDENT_APPROVAL:    { INDENT: 'Approve the indent' },
  QUOTE_COMPARATIVE:  { INDENT: 'Add quotes & comparative' },
  QUOTATION_APPROVAL: { INDENT: 'Approve the quotation' },
  PO_CREATE:          { INDENT: 'Create the PO' },
  PO_APPROVAL:        { PO: 'Approve the PO' },
  PO_RELEASE:         { PO: 'Release the PO' },
  MATERIAL_FOLLOWUP:  { PO: 'Follow up with the vendor' },
  PROFORMA_INVOICE:   { PI: 'Approve the PI' },
  ADVANCE_PAYMENT:    { PI: 'Record the advance payment' },
  GRN:                { PO: 'Create the GRN' },
  INCOMING_QC:        { GRN: 'Do the QC', INDENT: 'Do the service QC' },
  VENDOR_INVOICE:     { QC: 'Create the vendor invoice', INVOICE: 'Approve the invoice' },
  BILL_PASSING:       { INVOICE: 'Create the voucher', VOUCHER: 'Post the voucher' },
  TALLY_ENTRY:        { VOUCHER: 'Record the Tally entry' },
  FINAL_PAYMENT:      { VOUCHER: 'Record the final payment' },
};

/**
 * → { to, label, action } or null when no safe link exists.
 *   task  — { _id, stepKey, entityType, entityId }
 *   opts.serviceCompletionIndentId — for tasks on the retired Service
 *         Completion step: the indent that completion belongs to (it has no
 *         detail page of its own).
 */
export const purchaseTaskLink = (task, { serviceCompletionIndentId = null } = {}) => {
  if (!task) return null;
  let type = task.entityType;
  let id = task.entityId;
  if (type === 'SERVICE_COMPLETION') {
    type = 'INDENT';
    id = serviceCompletionIndentId;
  }
  const route = ENTITY_ROUTES[type];
  if (!route || !isObjectId(id)) return null;
  const query = isObjectId(task._id) ? `?fmsTask=${String(task._id)}` : '';
  return {
    to: `${route.path}/${String(id)}${query}`,
    label: route.label,
    action: PURCHASE_STEP_LINKS[task.stepKey]?.[type] || '',
  };
};
