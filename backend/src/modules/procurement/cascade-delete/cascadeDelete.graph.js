/**
 * Purchase FMS cascade delete — the dependency map. Pure: no models, no DB.
 *
 * Deleting a step takes that step and everything that rests on it, and leaves
 * every earlier step as it was. "Rests on" is the real link between records,
 * not the step number — a later step that does not need this record is not
 * touched:
 *
 *   Indent 1.1 ─ Receive Quote 1.2 ─ Quotation Approval 1.3 ─┬─ PO 1.4 ─┬─ Follow-up 1.5
 *                                                           │          ├─ PI 1.6 ─ Advance Payment 1.7
 *                                                           │          ├─ GRN 1.8 ─ Incoming QC 1.9 ─ Vendor Invoice 1.10
 *                                                           │          │                     ─ Voucher 1.11 ─ Tally 1.12 / Final Payment 1.13
 *                                                           │          └─ Expense voucher (Against PO) 1.11
 *                                                           └─ Service QC 1.9 (internal-service indents)
 *
 * Not dependents, on purpose:
 *   - A follow-up is a tracking note: deleting one never deletes a GRN. While
 *     it is the one that made the PO ready for GRN and GRNs exist, it is
 *     blocked instead (the GRNs are named).
 *   - A vendor invoice belongs to the goods side (GRN → QC). Deleting a PI
 *     never deletes it; an invoice that adjusts the PI's advance blocks the PI.
 *   - Master data (vendors, SKUs, rates) and the append-only histories
 *     (rate-change history, MD approval history, stock movements) are never
 *     deleted.
 *
 * Downstream records that hold money, stock or a signature are never deleted
 * as a side effect — they BLOCK the cascade and say what has to happen first
 * (`blockOf`). Neither is a record that also belongs to another indent / PO /
 * GRN that is not being deleted (`sharedRefsOf`).
 */

export const STEP_TYPES = {
  INDENT:             { code: '1.1',  label: 'Purchase Indent',                  permission: 'procurement.deleteIndent', numberOf: (d) => d.indentNumber },
  QUOTE_COMPARATIVE:  { code: '1.2',  label: 'Receive Quote & Make Comparative', permission: 'procurement.deleteIndent', numberOf: (d) => d.indentNumber },
  QUOTATION_APPROVAL: { code: '1.3',  label: 'Quotation Approval',               permission: 'procurement.deleteIndent', numberOf: (d) => d.indentNumber },
  PO:                 { code: '1.4',  label: 'Purchase Order',                   permission: 'procurement.deletePurchaseOrder', numberOf: (d) => d.poNumber || d.draftNumber },
  FOLLOW_UP:          { code: '1.5',  label: 'Material Follow-up',               permission: 'procurement.deleteFollowUp', numberOf: (d) => d.followUpNumber },
  PI:                 { code: '1.6',  label: 'Proforma Invoice',                 permission: 'procurement.deleteProformaInvoice', numberOf: (d) => d.piNumber },
  ADVANCE_PAYMENT:    { code: '1.7',  label: 'Advance Payment',                  permission: 'procurement.deleteAdvancePayment', numberOf: (d) => d.paymentNumber },
  GRN:                { code: '1.8',  label: 'GRN',                              permission: 'procurement.deleteGrn', numberOf: (d) => d.grnNumber },
  SERVICE_COMPLETION: { code: '1.8A', label: 'Service Completion (retired step)', permission: 'procurement.deleteIncomingQc', numberOf: (d) => d.scNumber },
  INCOMING_QC:        { code: '1.9',  label: 'Incoming QC',                      permission: 'procurement.deleteIncomingQc', numberOf: (d) => d.qcNumber },
  VENDOR_INVOICE:     { code: '1.10', label: 'Vendor Invoice',                   permission: 'procurement.deleteVendorInvoice', numberOf: (d) => d.invoiceNumber },
  VOUCHER:            { code: '1.11', label: 'Bill Passing / Voucher',           permission: 'procurement.deleteVoucher', numberOf: (d) => d.voucherNumber },
  TALLY_ENTRY:        { code: '1.12', label: 'Tally Purchase Entry',             permission: 'procurement.deleteTallyEntry', numberOf: (d) => d.entryNumber },
  FINAL_PAYMENT:      { code: '1.13', label: 'Final Payment',                    permission: 'procurement.deleteFinalPayment', numberOf: (d) => d.paymentNumber },
};

/** Workflow order — groups are listed in it, and "earlier step" means lower here. */
export const STEP_ORDER = Object.keys(STEP_TYPES);
export const stepRank = (type) => {
  // The three indent-document steps are one record: refs to an indent are in
  // scope for any of them.
  if (['QUOTE_COMPARATIVE', 'QUOTATION_APPROVAL'].includes(type)) return 0;
  return STEP_ORDER.indexOf(type);
};

/** Types that live on the indent document itself (no record of their own). */
export const INDENT_STEP_TYPES = ['QUOTE_COMPARATIVE', 'QUOTATION_APPROVAL'];
export const isRootType = (type) => Object.prototype.hasOwnProperty.call(STEP_TYPES, type) && type !== 'SERVICE_COMPLETION';

const inr = (n) => `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN')}`;
const idStr = (v) => (v == null ? '' : String(v._id || v));
const uniq = (list) => [...new Set(list.map(idStr).filter(Boolean))];

/**
 * Why a DOWNSTREAM record cannot go with the cascade — { reason, action } — or
 * null when it can. (The record being deleted itself follows its own step's
 * delete rules instead; see cascadeDelete.service rootCheck.)
 */
export const blockOf = (type, d) => {
  switch (type) {
    case 'ADVANCE_PAYMENT':
      if (d.paymentStatus !== 'CANCELLED') {
        return {
          reason: `${inr(d.paidAmount)} is recorded as paid to the vendor (${d.paymentStatus}).`,
          action: 'Money already paid is never deleted as a side effect. Recover or re-allocate it, then delete this payment on its own from Advance Payments (latest payment first).',
        };
      }
      return null;
    case 'FINAL_PAYMENT':
      if (d.paymentStatus !== 'CANCELLED') {
        return {
          reason: `${inr(d.paidAmount)} is recorded as paid to the vendor (${d.paymentStatus}).`,
          action: 'Cancel this payment on Final Payments first (its amount goes back onto the voucher balance).',
        };
      }
      return null;
    case 'TALLY_ENTRY':
      if (d.tallyEntryStatus === 'COMPLETED') {
        return {
          reason: 'Already entered in Tally.',
          action: 'Reverse the entry in Tally, then cancel or delete this Tally entry on its own first.',
        };
      }
      return null;
    case 'VOUCHER':
      if (d.approvalStatus === 'MD_APPROVED') {
        return { reason: 'Signed by the MD.', action: 'A signed voucher stays. Remove the MD signature (Approvals) or delete the voucher on its own first.' };
      }
      if (['POSTED', 'PARTIALLY_PAID', 'FULLY_PAID', 'SHORT_CLOSED'].includes(d.voucherStatus)) {
        return { reason: `Posted to accounts (${d.voucherStatus}).`, action: 'Cancel or delete this voucher on its own first.' };
      }
      return null;
    case 'VENDOR_INVOICE':
      if (d.invoiceStatus === 'PAYMENT_COMPLETED') {
        return { reason: 'The vendor has been paid in full for this invoice.', action: 'Payments are never deleted as a side effect — reverse the final payments first.' };
      }
      return null;
    case 'INCOMING_QC':
      if (['PASSED', 'FAILED', 'PARTIAL'].includes(d.qcStatus)) {
        return {
          reason: `QC completed (${d.qcStatus}) — its accepted quantity is already in stock.`,
          action: 'Stock cannot be reversed from Purchase FMS. A completed QC stays; correct the stock with an inventory adjustment if needed.',
        };
      }
      return null;
    case 'GRN':
      if (d.approvalStatus === 'MD_APPROVED') {
        return { reason: 'Signed by the MD.', action: 'A signed GRN stays. Remove the MD signature (Approvals) first.' };
      }
      // stockMovements: the GRN's own stock movements, looked up by the service (older GRNs posted at receipt).
      if (d.stockPosted || d.stockMovements > 0 || (d.items || []).some((l) => l.stockStatus === 'POSTED' || l.movementId)) {
        return {
          reason: 'Stock was already posted from this GRN.',
          action: 'Stock cannot be reversed from Purchase FMS. Correct it with an inventory adjustment; the GRN stays.',
        };
      }
      return null;
    default:
      return null;
  }
};

/** Notes shown next to a record that CAN go — what the user should know. */
export const warningsOf = (type, d) => {
  const w = [];
  if (type === 'PO' && (d.releaseStatus === 'RELEASED' || d.poStatus === 'RELEASED_TO_VENDOR')) w.push('Already released to the vendor — tell them it is withdrawn');
  if (type === 'PI' && d.mdApprovalStatus === 'MD_APPROVED') w.push('MD-approved — the approval history is kept');
  if (type === 'GRN' && ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'].includes(d.grnStatus)
    && !d.stockPosted && !(d.items || []).some((l) => l.stockStatus === 'POSTED' || l.movementId)) w.push('Completed receipt — no stock was posted yet (awaiting QC)');
  if (['ADVANCE_PAYMENT', 'FINAL_PAYMENT'].includes(type) && d.paymentStatus === 'CANCELLED') w.push('Cancelled entry — no money is recorded on it');
  return w;
};

/**
 * Other workflow records a record belongs to — { type, id }. A downstream
 * record that also belongs to a record at the deleted step (or below) which
 * is NOT being deleted is shared, and blocks the cascade.
 */
export const sharedRefsOf = (type, d) => {
  const refs = (t, ids) => uniq(ids).map((id) => ({ type: t, id }));
  switch (type) {
    case 'PO':
      return refs('INDENT', [d.indentId, ...(d.indentIds || []), ...(d.items || []).map((l) => l.indentId)]);
    case 'GRN':
      return d.isWithoutPo ? [] : refs('PO', [d.poId, ...(d.poIds || [])]);
    case 'VENDOR_INVOICE':
      return [
        ...refs('GRN', [d.grnId, ...(d.grnIds || []), ...(d.items || []).map((l) => l.grnId)]),
        ...refs('INCOMING_QC', [d.qcId, ...(d.qcIds || []), ...(d.items || []).map((l) => l.qcId)]),
      ];
    case 'VOUCHER':
      return [...refs('VENDOR_INVOICE', [d.invoiceId]), ...refs('GRN', [d.grnId, ...(d.grnIds || [])])];
    default:
      return [];
  }
};

/**
 * The refs of a downstream record that make it shared: in scope (at the
 * deleted step or below) and not part of this deletion.
 *   deleting   Set of "TYPE:id" keys being deleted (root included)
 *   rootIndentId  for an indent-step root, the indent's id
 */
export const foreignRefs = (type, d, { rootType, deleting, rootIndentId = null }) => {
  const rootRank = stepRank(rootType);
  return sharedRefsOf(type, d).filter((r) => {
    if (stepRank(r.type) < rootRank) return false; // an earlier step — preserved, not shared
    if (r.type === 'INDENT') return String(r.id) !== String(rootIndentId);
    return !deleting.has(`${r.type}:${r.id}`);
  });
};

/** Does deleting this root need a reason? Mirrors each step's own delete rule, plus money and any cascade. */
export const reasonRequired = (rootType, d, downstreamCount) => {
  if (downstreamCount > 0) return true;
  switch (rootType) {
    case 'INDENT': return d.approvalStatus !== 'DRAFT';
    case 'QUOTE_COMPARATIVE':
    case 'QUOTATION_APPROVAL': return true;
    case 'PO': return d.approvalStatus !== 'DRAFT';
    case 'FOLLOW_UP': return !['PENDING', 'RESCHEDULED'].includes(d.followUpStatus);
    case 'PI': return !(['DRAFT', 'RECEIVED'].includes(d.piStatus) && d.approvalStatus !== 'APPROVED');
    case 'ADVANCE_PAYMENT':
    case 'FINAL_PAYMENT': return d.paymentStatus !== 'CANCELLED';
    case 'GRN': return ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'].includes(d.grnStatus);
    case 'VENDOR_INVOICE': return d.invoiceStatus !== 'DRAFT';
    case 'VOUCHER': return d.voucherStatus !== 'DRAFT';
    case 'TALLY_ENTRY': return d.tallyEntryStatus === 'COMPLETED';
    default: return false;
  }
};

/**
 * What deleting the root changes on records that STAY (they are not deleted),
 * in words for the confirmation.
 */
export const rootEffects = (rootType, d, { number = '', poNumber = '', piNumber = '', voucherNumber = '', invoiceNumber = '' } = {}) => {
  switch (rootType) {
    case 'QUOTATION_APPROVAL':
      return [`Indent ${number} goes back to Step 1.3 (Quotation Approval pending). Its Step 1.2 quotes are kept; the approved vendors set by this approval are cleared.`];
    case 'QUOTE_COMPARATIVE':
      return [`Indent ${number} goes back to Step 1.2 (Receive Quote pending). Its quotes, the quotation approval and any vendor picked for its items are cleared.`];
    case 'PO':
      return ['The indent items this PO held are free again for a new PO.'];
    case 'FOLLOW_UP':
      return [`PO ${poNumber}'s follow-up status is worked out again from its remaining follow-ups.`];
    case 'PI':
      return [`PO ${poNumber} goes back to "no PI".`];
    case 'ADVANCE_PAYMENT':
      return d.paymentStatus === 'CANCELLED' ? [] : [`${inr(d.paidAmount)} is reversed off PI ${piNumber} (its balance goes back up). This does not refund the vendor.`];
    case 'GRN':
      return ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'].includes(d.grnStatus)
        ? [`Its received quantity comes off PO ${poNumber || '(no PO)'}; the PO is back to awaiting it.`] : [];
    case 'VENDOR_INVOICE':
      return ['Its QC quantity can be invoiced again, and any advance it adjusted is free again on the PI.'];
    case 'VOUCHER':
      return invoiceNumber ? [`Invoice ${invoiceNumber} goes back to awaiting a voucher.`] : [];
    case 'TALLY_ENTRY':
      return d.tallyEntryStatus === 'COMPLETED' ? [`Voucher ${voucherNumber} goes back to "Tally pending". Reverse the entry in Tally itself as well.`] : [];
    case 'FINAL_PAYMENT':
      return d.paymentStatus === 'CANCELLED' ? [] : [`The payment is cancelled first: ${inr(d.paidAmount)} goes back onto voucher ${voucherNumber}'s balance. This does not recover money from the vendor.`];
    default:
      return [];
  }
};
