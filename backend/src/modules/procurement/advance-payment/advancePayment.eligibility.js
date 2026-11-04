/**
 * Advance payment eligibility — pure rules, no database (unit-tested on their own).
 *
 * An advance is paid against a Proforma Invoice (the advance IS the PI value),
 * but only while the Purchase Order it belongs to is still live: approved and
 * not cancelled / closed. Cancelling a PO does not touch its PI, so without
 * this rule a cancelled PO's PI would stay payable.
 */
const DEAD_PO_STATUSES = ['CANCELLED', 'CLOSED'];

/** Why a payment may not be recorded against this PO, or null when it may. */
export const poPaymentBlock = (po) => {
  if (!po || po.isDeleted) return 'The Purchase Order for this PI no longer exists';
  if (po.approvalStatus !== 'APPROVED') return `Purchase Order ${po.poNumber || ''} is not approved`.replace('  ', ' ');
  if (DEAD_PO_STATUSES.includes(po.poStatus)) return `Purchase Order ${po.poNumber || ''} is ${String(po.poStatus).toLowerCase()}`.replace('  ', ' ');
  return null;
};

export const isPoPayable = (po) => poPaymentBlock(po) === null;

/** Why a payment may not be recorded against this PI itself, or null. */
export const piPaymentBlock = (pi) => (
  pi?.piStatus === 'READY_FOR_ADVANCE_PAYMENT' ? null : 'Payments can only be recorded for a PI that is ready for advance payment'
);

/** Payment status shown for a PI that is still owed money. */
export const advancePaymentStatusOf = (pi) => (Number(pi?.paidAmount) > 0 ? 'PART_PAYMENT' : 'PENDING');

/**
 * Where a PI stands on its advance: PENDING (nothing paid), PARTIALLY_PAID,
 * FULLY_PAID (balance cleared) or SHORT_CLOSED (closed with a balance left).
 * The table, the KPI cards and the PDF all read this one function.
 */
export const piPaymentStateOf = (pi) => {
  const paid = Number(pi?.paidAmount) || 0;
  const balance = Number(pi?.balanceAmount) || 0;
  if (pi?.piStatus === 'PAYMENT_COMPLETED') return balance > 0.005 ? 'SHORT_CLOSED' : 'FULLY_PAID';
  return paid > 0 ? 'PARTIALLY_PAID' : 'PENDING';
};

/**
 * What a user sees for a PO in the Record Advance Payment picker: whether an
 * advance can be recorded now and, if not, why and what to do next.
 *   code: PO_NOT_RELEASED | NO_PI | PI_PENDING | PI_REJECTED | PI_NOT_REQUIRED |
 *         AWAITING_MD | PAYABLE | FULLY_PAID | SHORT_CLOSED
 * `payable` = the form may be submitted; AWAITING_MD stays selectable (the form
 * explains the MD gate and disables submit, like the Awaiting Advance queue).
 */
export const advanceStateOf = ({ po, pi } = {}) => {
  const out = (code, payable, reason, nextStep = '') => ({ code, payable, reason, nextStep });
  const block = poPaymentBlock(po);
  if (block) return out('PO_NOT_PAYABLE', false, block);
  if (pi && !['CANCELLED'].includes(pi.piStatus)) {
    if (pi.piStatus === 'PAYMENT_COMPLETED') {
      return piPaymentStateOf(pi) === 'SHORT_CLOSED'
        ? out('SHORT_CLOSED', false, 'The advance was closed short — nothing more to pay')
        : out('FULLY_PAID', false, 'The advance is fully paid');
    }
    if (pi.piStatus === 'READY_FOR_ADVANCE_PAYMENT') {
      if ((Number(pi.balanceAmount) || 0) <= 0) return out('FULLY_PAID', false, 'The advance is fully paid');
      if (pi.mdApprovalStatus === 'READY_FOR_MD_APPROVAL') {
        return out('AWAITING_MD', true, 'Payment cannot be processed until the MD approves the Proforma Invoice', 'Waiting for MD approval');
      }
      return out('PAYABLE', true, '');
    }
    if (pi.approvalStatus === 'REJECTED') {
      return out('PI_REJECTED', false, 'The Proforma Invoice was rejected', 'Cancel it and raise a new PI');
    }
    return out('PI_PENDING', false, 'The Proforma Invoice is not approved yet', 'Upload the PI document and approve the PI');
  }
  if (po?.piStatus === 'PI_NOT_REQUIRED') return out('PI_NOT_REQUIRED', false, 'This PO was marked "PI not required" — no advance is paid');
  if (po?.poStatus !== 'RELEASED_TO_VENDOR' && po?.releaseStatus !== 'RELEASED' && po?.poStatus !== 'PARTIAL_RECEIVED' && po?.poStatus !== 'FULLY_RECEIVED') {
    return out('PO_NOT_RELEASED', false, 'The PO is not released to the vendor yet', 'Release the PO, then create its Proforma Invoice');
  }
  return out('NO_PI', false, 'No Proforma Invoice exists for this PO — an advance is paid against an approved PI', 'Create and approve a Proforma Invoice');
};
