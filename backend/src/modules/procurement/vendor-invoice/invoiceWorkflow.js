/**
 * Vendor Invoices & Payments list — the combined invoice + voucher workflow
 * filters (the list's workflow chips), resolved on the server so the page,
 * its pagination and its counts all describe the same filtered set. Pure.
 *
 * An invoice's voucher is its newest live voucher (not deleted, not
 * cancelled) — the same one the list's Voucher column shows.
 */
import { INVOICE_STATUS } from './vendorInvoice.model.js';

export const INVOICE_WORKFLOWS = {
  AWAITING_INVOICE:     { invoiceStatus: [INVOICE_STATUS.DRAFT, INVOICE_STATUS.RECEIVED] },
  AWAITING_VOUCHER:     { invoiceStatus: [INVOICE_STATUS.PAYMENT_PENDING], voucher: (v) => !v },
  AWAITING_MD_APPROVAL: { invoiceStatus: [INVOICE_STATUS.PAYMENT_PENDING], voucher: (v) => v?.approvalStatus === 'READY_FOR_MD_APPROVAL' },
  VOUCHER_POSTED:       { invoiceStatus: [INVOICE_STATUS.PAYMENT_PENDING], voucher: (v) => v?.approvalStatus === 'MD_APPROVED' },
  PARTIALLY_PAID:       { invoiceStatus: [INVOICE_STATUS.PAYMENT_PENDING], voucher: (v) => v?.voucherStatus === 'PARTIALLY_PAID' },
};

export const INVOICE_WORKFLOW_KEYS = Object.keys(INVOICE_WORKFLOWS);

/**
 * Mongo filter for `workflow`, given `liveVouchers` = [{ invoiceId, voucherStatus,
 * approvalStatus }] (the newest live voucher per invoice) for the candidate
 * invoices. Null for an unknown workflow.
 */
export const invoiceWorkflowFilter = (workflow, liveVouchers = []) => {
  const def = INVOICE_WORKFLOWS[workflow];
  if (!def) return null;
  const filter = { invoiceStatus: { $in: def.invoiceStatus } };
  if (!def.voucher) return filter;
  if (def.voucher(null)) {
    // "No voucher yet" — every candidate except those that have one.
    filter._id = { $nin: liveVouchers.map((v) => v.invoiceId) };
  } else {
    filter._id = { $in: liveVouchers.filter((v) => def.voucher(v)).map((v) => v.invoiceId) };
  }
  return filter;
};
