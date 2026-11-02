/**
 * Purchase FMS tasks on My FMS Tasks — the button(s) each waiting record gets.
 *
 * Every action opens, right on My FMS Tasks, the same form the record's own
 * page uses, already holding that record (PurchaseTaskRunner); OPEN goes to the
 * record's page instead. The first action is the main one. `approve` marks an
 * approval — shown only to someone who can approve (see canApproveTask).
 * The server still checks everything on save.
 */

const A = (key, label, title, extra = {}) => ({ key, label, title, ...extra });

// `${stepKey}:${entityType}` (fmsCatalog.js sources) → actions.
const ACTIONS = {
  'INDENT_CREATE:INDENT': [
    A('INDENT_SUBMIT', 'Submit Indent', 'Submit the indent for approval'),
    A('INDENT_EDIT', 'Edit Indent', 'Edit the draft indent'),
  ],
  'INDENT_APPROVAL:INDENT': [A('INDENT_APPROVE', 'Approve Indent', 'Approve or reject the indent', { approve: true })],
  'QUOTE_COMPARATIVE:INDENT': [A('QUOTE_COMPARATIVE', 'Quote & Comparative', 'Receive quotes & make the comparative')],
  'QUOTATION_APPROVAL:INDENT': [A('QUOTATION_APPROVE', 'Approve Quotation', 'Approve the quotation', { approve: true })],
  'PO_CREATE:INDENT': [A('PO_CREATE', 'Create PO', 'Create the purchase order from this indent')],
  'PO_APPROVAL:PO': [A('PO_APPROVE', 'Approve PO', 'Approve or reject the purchase order', { approve: true })],
  'PO_RELEASE:PO': [A('PO_RELEASE', 'Release PO', 'Release the purchase order to the vendor')],
  'MATERIAL_FOLLOWUP:PO': [
    A('FOLLOW_UP', 'Update Follow-up', 'Record the vendor follow-up (or mark Ready for GRN) — as on the PO page'),
    A('OPEN', 'Open PO', 'Open the PO and its follow-up history'),
  ],
  'PROFORMA_INVOICE:PI': [
    A('PI_APPROVE', 'Approve PI', 'Approve the proforma invoice', { approve: true }),
    A('PI_EDIT', 'Edit PI', 'Edit the PI or upload its document'),
  ],
  'ADVANCE_PAYMENT:PI': [A('ADVANCE_PAYMENT', 'Record Advance', 'Record the advance payment')],
  'GRN:PO': [A('GRN_CREATE', 'Create GRN', 'Create the goods receipt note')],
  'INCOMING_QC:GRN': [A('GRN_QC', 'Do QC', 'Incoming QC for this GRN')],
  'INCOMING_QC:INDENT': [A('SERVICE_QC', 'Start Service QC', 'Start the service QC (opens the QC page)')],
  'VENDOR_INVOICE:QC': [A('INVOICE_CREATE', 'Create Invoice', 'Create the vendor invoice')],
  'VENDOR_INVOICE:INVOICE': [
    A('INVOICE_APPROVE', 'Approve Invoice', 'Approve the vendor invoice', { approve: true }),
    A('INVOICE_EDIT', 'Edit Invoice', 'Edit the invoice or upload its document'),
  ],
  'BILL_PASSING:INVOICE': [A('VOUCHER_CREATE', 'Create Voucher', 'Create the passing voucher')],
  'BILL_PASSING:VOUCHER': [A('VOUCHER_POST', 'Post Voucher', 'Review and post the voucher')],
  'TALLY_ENTRY:VOUCHER': [A('TALLY_ENTRY', 'Tally Entry', 'Record the Tally purchase entry')],
  'FINAL_PAYMENT:VOUCHER': [A('FINAL_PAYMENT', 'Record Payment', 'Record the final payment')],
};

/** The open task's buttons; approvals only for someone who can approve. */
export const purchaseActionsFor = (task, { canApprove = false } = {}) =>
  (ACTIONS[`${task.stepKey}:${task.entityType}`] || []).filter((a) => !a.approve || canApprove);

/**
 * Who can approve a task: the people it is assigned to (Doer Assignment names
 * them for that step), the MD, and anyone holding procurement.approve.
 */
export const canApproveTask = ({ isMine, isRoot, can }) => Boolean(isMine || isRoot || can('procurement.approve'));

// Purchase FMS step → its Purchase hub step (the lock icon's step switches).
export const PURCHASE_HUB_STEP = {
  INDENT_CREATE: 'purchase-indents',
  INDENT_APPROVAL: 'purchase-indents',
  QUOTE_COMPARATIVE: 'receive-quotes',
  QUOTATION_APPROVAL: 'approved-quotations',
  PO_CREATE: 'purchase-orders',
  PO_APPROVAL: 'purchase-orders',
  PO_RELEASE: 'purchase-orders',
  MATERIAL_FOLLOWUP: 'follow-ups',
  PROFORMA_INVOICE: 'pi-forms',
  ADVANCE_PAYMENT: 'advance-payments',
  GRN: 'grn',
  INCOMING_QC: 'grn',
  VENDOR_INVOICE: 'invoices-payments',
  BILL_PASSING: 'invoices-payments',
  TALLY_ENTRY: 'tally-entries',
  FINAL_PAYMENT: 'final-payments',
};

export const ENTITY_LABELS = {
  INDENT: 'Indent',
  PO: 'PO',
  PI: 'PI',
  GRN: 'GRN',
  QC: 'QC',
  INVOICE: 'Invoice',
  VOUCHER: 'Voucher',
  SERVICE_COMPLETION: 'Service Completion',
};
