/**
 * FMS step catalogs for the Doer Assignment system.
 *
 * Purchase FMS has no stored step catalog or per-transaction "current step"
 * record — each step is its own document (Indent, PO, PI, GRN, …) and progress
 * is carried by that document's existing status fields. This file is the single
 * backend source of truth that names the steps and, for each one, says which
 * existing statuses mean "an item is waiting at this step". It only READS
 * workflow documents; it never changes them.
 *
 * O2D FMS already has its own admin-editable catalog + doer config
 * (StepDefinition / TaskTemplate in modules/o2d-fms) and its own runtime tasks,
 * so it is exposed here read-only and configured in its existing screens.
 */
import PurchaseIndent from '../procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../procurement/purchase-order/purchaseOrder.model.js';
import ProformaInvoice from '../procurement/proforma-invoice/proformaInvoice.model.js';
import GoodsReceiptNote from '../procurement/grn/grn.model.js';
import ServiceCompletion from '../procurement/service-completion/serviceCompletion.model.js';
import IncomingQC from '../procurement/incoming-qc/incomingQc.model.js';
import VendorInvoice from '../procurement/vendor-invoice/vendorInvoice.model.js';
import VendorVoucher from '../procurement/voucher/voucher.model.js';
import { vendorInvoiceService } from '../procurement/vendor-invoice/vendorInvoice.service.js';
import { QUOTE_COMPARATIVE_PENDING, QUOTATION_APPROVAL_PENDING } from '../procurement/indent/quotationSteps.js';

const live = { isDeleted: { $ne: true } };

/**
 * Workflow item types a task can point at. `terminated` = the item left the
 * workflow without completing the step (deleted / cancelled / rejected), so its
 * open task is CLOSED rather than DONE.
 */
export const ENTITY_TYPES = {
  INDENT: {
    label: 'Indent', model: PurchaseIndent,
    ref: (d) => d.indentNumber || '',
    summary: (d) => d.department || d.raisedBy || '',
    link: (d) => `/procurement/indents/${d._id}`,
    terminated: (d) => d.isDeleted || d.approvalStatus === 'REJECTED' || ['CLOSED', 'QUOTATION_NOT_APPROVED'].includes(d.overallStatus),
  },
  PO: {
    label: 'Purchase Order', model: VendorPurchaseOrder,
    ref: (d) => d.poNumber || d.draftNumber || '',
    summary: (d) => d.vendorName || '',
    link: (d) => `/procurement/purchase-orders/${d._id}`,
    terminated: (d) => d.isDeleted || d.poStatus === 'CANCELLED',
  },
  PI: {
    label: 'Proforma Invoice', model: ProformaInvoice,
    ref: (d) => d.piNumber || '',
    summary: (d) => d.vendorName || '',
    link: (d) => `/procurement/proforma-invoices/${d._id}`,
    terminated: (d) => d.isDeleted || d.piStatus === 'CANCELLED',
  },
  GRN: {
    label: 'GRN', model: GoodsReceiptNote,
    ref: (d) => d.grnNumber || '',
    summary: (d) => d.vendorName || '',
    link: (d) => `/procurement/grns/${d._id}`,
    terminated: (d) => d.isDeleted || d.grnStatus === 'CANCELLED',
  },
  // Retired step — kept so existing tasks pointing at Service Completions resolve.
  SERVICE_COMPLETION: {
    label: 'Service Completion', model: ServiceCompletion,
    ref: (d) => d.scNumber || '',
    summary: (d) => d.vendorName || '',
    link: () => '/procurement/service-completions',
    terminated: (d) => d.isDeleted || d.status === 'CANCELLED',
  },
  QC: {
    label: 'Incoming QC', model: IncomingQC,
    ref: (d) => [d.qcNumber, d.grnNumber && `GRN ${d.grnNumber}`].filter(Boolean).join(' · '),
    summary: (d) => d.vendorName || '',
    link: (d) => `/procurement/incoming-qc/${d._id}`,
    terminated: (d) => d.isDeleted || d.qcStatus === 'CANCELLED',
  },
  INVOICE: {
    label: 'Vendor Invoice', model: VendorInvoice,
    ref: (d) => d.invoiceNumber || '',
    summary: (d) => d.vendorName || '',
    link: (d) => `/procurement/vendor-invoices/${d._id}`,
    terminated: (d) => d.isDeleted || d.invoiceStatus === 'REJECTED',
  },
  VOUCHER: {
    label: 'Voucher', model: VendorVoucher,
    ref: (d) => d.voucherNumber || '',
    summary: (d) => d.vendorName || d.partyName || '',
    link: (d) => `/procurement/vouchers/${d._id}`,
    terminated: (d) => d.isDeleted || d.voucherStatus === 'CANCELLED',
  },
};

// Simple "documents of type X matching filter F are waiting here" source.
const byFilter = (entityType, filter) => ({
  entityType,
  find: () => ENTITY_TYPES[entityType].model.find({ ...live, ...filter }).lean(),
});

/**
 * Permission semantics per step:
 *   permissions: [{ slug, enforced }]
 *     enforced: true  → the existing API route rejects users without it
 *     enforced: false → the registry defines it for this kind of action, but the
 *                       existing route does not check it (shown as advisory)
 *   []               → the step's actions are open to any logged-in user in the
 *                       current RBAC (no Purchase step route is permission-gated
 *                       today apart from deletes / PI-not-required / overrides).
 */
const PURCHASE_STEPS = [
  {
    key: 'INDENT_CREATE', code: '1.1', label: 'Generate Purchase Indent',
    description: 'Indent saved as draft — complete and submit it for approval.',
    permissions: [],
    sources: [byFilter('INDENT', { approvalStatus: 'DRAFT' })],
  },
  {
    key: 'INDENT_APPROVAL', code: '1.1A', label: 'Indent Approval',
    description: 'Submitted indent awaiting approval.',
    permissions: [],
    sources: [byFilter('INDENT', { approvalStatus: 'PENDING_APPROVAL' })],
  },
  {
    key: 'QUOTE_COMPARATIVE', code: '1.2', label: 'Receive Quote & Comparative',
    description: 'Approved indent awaiting vendor quotes / comparative.',
    permissions: [],
    sources: [byFilter('INDENT', QUOTE_COMPARATIVE_PENDING)],
  },
  {
    key: 'QUOTATION_APPROVAL', code: '1.3', label: 'Approved Quotation',
    description: 'Quotes received — approve the quotation.',
    permissions: [],
    sources: [byFilter('INDENT', QUOTATION_APPROVAL_PENDING)],
  },
  {
    key: 'PO_CREATE', code: '1.4', label: 'Create PO',
    description: 'Approved items awaiting a purchase order.',
    permissions: [],
    sources: [byFilter('INDENT', {
      overallStatus: { $in: ['QUOTATION_APPROVED', 'PARTIAL_PO_CREATED'] },
      requestType: { $ne: 'INTERNAL_SERVICE' },
    })],
  },
  {
    key: 'PO_APPROVAL', code: '1.4A', label: 'PO Approval',
    description: 'Draft PO awaiting approval.',
    permissions: [{ slug: 'procurement.approve', enforced: false }],
    sources: [byFilter('PO', { approvalStatus: 'DRAFT', poStatus: { $ne: 'CANCELLED' } })],
  },
  {
    key: 'PO_RELEASE', code: '1.4B', label: 'Release PO',
    description: 'Approved PO awaiting release to the vendor.',
    permissions: [],
    sources: [byFilter('PO', { approvalStatus: 'APPROVED', releaseStatus: 'NOT_RELEASED', poStatus: 'APPROVED' })],
  },
  {
    key: 'MATERIAL_FOLLOWUP', code: '1.5', label: 'Material Follow-up',
    description: 'Released PO — follow up until material is ready for GRN.',
    permissions: [],
    sources: [byFilter('PO', {
      poStatus: 'RELEASED_TO_VENDOR',
      followUpStatus: { $in: ['NOT_STARTED', 'PENDING', 'IN_PROGRESS'] },
    })],
  },
  {
    key: 'PROFORMA_INVOICE', code: '1.6', label: 'PI (Proforma Invoice)',
    description: 'A received PI awaiting approval. PI is optional, so a released PO with no PI yet is not a task on its own.',
    permissions: [],
    sources: [
      byFilter('PI', { piStatus: { $in: ['DRAFT', 'RECEIVED'] } }),
    ],
  },
  {
    key: 'ADVANCE_PAYMENT', code: '1.7', label: 'Advance Payment',
    description: 'Approved, MD-approved PI awaiting advance payment.',
    permissions: [],
    // Payment is the one step that waits for the MD (advancePayment.service.js).
    sources: [byFilter('PI', { piStatus: 'READY_FOR_ADVANCE_PAYMENT', mdApprovalStatus: 'MD_APPROVED' })],
  },
  {
    key: 'GRN', code: '1.8', label: 'GRN',
    description: 'PO ready for goods receipt.',
    permissions: [],
    // piStatus values here must match grn.service.js's isPiSettledForGrn —
    // NOT_RECEIVED (no PI, optional), an explicitly-skipped PI and any APPROVED
    // PI are settled; the advance payment / its MD approval never hold GRN back.
    // Only a PI still awaiting its ordinary approval (PI_RECEIVED) blocks.
    sources: [byFilter('PO', {
      followUpStatus: 'READY_FOR_GRN',
      piStatus: { $in: ['NOT_RECEIVED', 'PI_NOT_REQUIRED', 'PI_APPROVED', 'READY_FOR_ADVANCE_PAYMENT', 'PAYMENT_COMPLETED'] },
      poStatus: { $in: ['RELEASED_TO_VENDOR', 'PARTIAL_RECEIVED'] },
    })],
  },
  // The former Step 1.8A (Service Completion) was removed: an approved
  // internal-service indent now waits directly at Incoming QC.
  {
    key: 'INCOMING_QC', code: '1.9', label: 'Incoming QC',
    description: 'Received GRN or approved internal-service indent awaiting QC.',
    permissions: [],
    sources: [
      // The GRN's MD signature never holds QC back (only payment waits for an
      // MD approval), so every completed, QC-pending GRN waits on the QC doer.
      // RECEIVED = a W/O PO GRN's terminal status (no PO to be "partial"/"full" against).
      byFilter('GRN', { grnStatus: { $in: ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'] }, qcStatus: 'PENDING' }),
      // SERVICE_COMPLETED = legacy indents completed under the retired step, QC not done yet.
      byFilter('INDENT', { requestType: 'INTERNAL_SERVICE', overallStatus: { $in: ['SERVICE_PENDING', 'SERVICE_COMPLETED'] } }),
    ],
  },
  {
    key: 'VENDOR_INVOICE', code: '1.10', label: 'Vendor Invoice',
    description: 'QC-accepted material awaiting invoice, or an invoice awaiting approval.',
    permissions: [],
    sources: [
      // Reuses the Vendor Invoice module's own "still invoiceable" calculation.
      { entityType: 'QC', find: () => vendorInvoiceService.getInvoiceableQcs({}) },
      byFilter('INVOICE', { invoiceStatus: { $in: ['DRAFT', 'RECEIVED'] } }),
    ],
  },
  {
    key: 'BILL_PASSING', code: '1.11', label: 'Bill Passing / Voucher',
    description: 'Approved invoice awaiting a voucher, or a draft voucher awaiting posting.',
    permissions: [],
    sources: [
      {
        entityType: 'INVOICE',
        find: async () => {
          const invs = await VendorInvoice.find({ ...live, invoiceStatus: 'PAYMENT_PENDING' }).lean();
          if (!invs.length) return [];
          const withVoucher = await VendorVoucher.find({
            ...live, invoiceId: { $in: invs.map((i) => i._id) }, voucherStatus: { $ne: 'CANCELLED' },
          }).distinct('invoiceId');
          const taken = new Set(withVoucher.map(String));
          return invs.filter((i) => !taken.has(String(i._id)));
        },
      },
      byFilter('VOUCHER', { voucherStatus: 'DRAFT' }),
    ],
  },
  {
    key: 'TALLY_ENTRY', code: '1.12', label: 'Tally Purchase Entry',
    description: 'Posted voucher awaiting Tally entry.',
    permissions: [],
    sources: [byFilter('VOUCHER', {
      voucherStatus: { $in: ['POSTED', 'PARTIALLY_PAID', 'FULLY_PAID'] },
      tallyEntryStatus: 'PENDING',
    })],
  },
  {
    key: 'FINAL_PAYMENT', code: '1.13', label: 'Final Payment',
    description: 'Tally-completed, MD-approved voucher with a balance to pay.',
    permissions: [],
    sources: [byFilter('VOUCHER', {
      tallyEntryStatus: 'COMPLETED',
      // Payment is the one step that waits for the MD (finalPayment.service.js).
      approvalStatus: 'MD_APPROVED',
      voucherStatus: { $nin: ['FULLY_PAID', 'SHORT_CLOSED', 'CANCELLED'] },
      balanceAmount: { $gt: 0 },
    })],
  },
].map((s, i) => ({ ...s, sequence: i + 1 }));

export const FMS_CATALOG = {
  PURCHASE: {
    key: 'PURCHASE',
    label: 'Purchase FMS',
    editable: true,
    steps: PURCHASE_STEPS,
  },
  O2D: {
    key: 'O2D',
    label: 'O2D FMS',
    // Doers are configured in O2D's own Step Builder / Task Templates and
    // tracked by O2D's own runtime — shown read-only here.
    editable: false,
    configLinks: [
      { label: 'O2D Step Builder', path: '/o2d-fms/config' },
      { label: 'O2D Task Templates', path: '/o2d-fms/templates' },
    ],
    steps: [],
  },
};

export const getFms = (fmsKey) => FMS_CATALOG[String(fmsKey || '').toUpperCase()] || null;
export const getStep = (fmsKey, stepKey) => getFms(fmsKey)?.steps.find((s) => s.key === String(stepKey || '').toUpperCase()) || null;
