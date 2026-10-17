/** Purchase FMS workflow step resolver.
 *  Returns an ordered step array for the full GRN & QC → Invoice → Voucher → Tally → Payment pipeline.
 *  GRN and Incoming QC are ONE step: the QC is entered on the GRN page, directly under the GRN.
 *  Each caller passes the single entity it is currently displaying; prior steps are inferred as completed.
 */

const STEPS_TEMPLATE = () => [
  { key: 'grnqc',   label: 'GRN & QC',       state: 'pending', sublabel: '' },
  { key: 'invoice', label: 'Vendor Invoice', state: 'pending', sublabel: '' },
  { key: 'voucher', label: 'Voucher',        state: 'pending', sublabel: '' },
  { key: 'tally',   label: 'Tally Entry',   state: 'pending', sublabel: '' },
  { key: 'payment', label: 'Final Payment', state: 'pending', sublabel: '' },
];

const grnState = (status) => {
  if (!status) return 'pending';
  if (status === 'CANCELLED') return 'error';
  // RECEIVED = a W/O PO GRN's terminal status (no PO to be "partial"/"full" against).
  if (['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'].includes(status)) return 'completed';
  return 'active';
};

const qcState = (status) => {
  if (!status) return 'pending';
  if (status === 'CANCELLED') return 'error';
  if (status === 'FAILED') return 'warning';
  if (['PASSED', 'PARTIAL'].includes(status)) return 'completed';
  if (['DRAFT', 'IN_PROGRESS'].includes(status)) return 'active';
  return 'pending';
};

const invoiceState = (status) => {
  if (!status) return 'pending';
  if (status === 'REJECTED') return 'error';
  if (['APPROVED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED'].includes(status)) return 'completed';
  if (['DRAFT', 'RECEIVED'].includes(status)) return 'active';
  return 'pending';
};

const voucherState = (status) => {
  if (!status) return 'pending';
  if (status === 'CANCELLED') return 'error';
  if (['POSTED', 'PARTIALLY_PAID', 'FULLY_PAID', 'SHORT_CLOSED'].includes(status)) return 'completed';
  return 'active';
};

const tallyState = (status) => {
  if (!status) return 'pending';
  if (status === 'CANCELLED') return 'error';
  if (status === 'COMPLETED') return 'completed';
  return 'active';
};

/**
 * The combined GRN & QC step: done only once the GRN is completed AND its QC is
 * done. Until the GRN is completed it follows the GRN; after that, the QC (a
 * still-pending QC keeps the step active).
 */
const grnQcState = (grnStatus, qcStatus) => {
  const g = grnState(grnStatus);
  if (g !== 'completed') return g;
  const q = qcState(qcStatus);
  return q === 'pending' ? 'active' : q;
};

export function resolveWorkflowSteps({ grn, qc, invoice, voucher, tallyEntry } = {}) {
  const steps = STEPS_TEMPLATE();

  if (grn) {
    steps[0].state = grnQcState(grn.grnStatus, grn.qcStatus);
    steps[0].sublabel = grn.grnNumber || '';
    return steps;
  }

  if (qc) {
    steps[0].state = qcState(qc.qcStatus) === 'pending' ? 'active' : qcState(qc.qcStatus);
    steps[0].sublabel = qc.grnNumber || qc.qcNumber || '';
    return steps;
  }

  if (invoice) {
    steps[0].state = 'completed';
    steps[1].state = invoiceState(invoice.invoiceStatus);
    steps[1].sublabel = invoice.invoiceNumber || '';
    return steps;
  }

  if (voucher) {
    steps[0].state = 'completed';
    steps[1].state = 'completed';
    steps[2].state = voucherState(voucher.voucherStatus);
    steps[2].sublabel = voucher.voucherNumber || '';
    if (voucher.tallyEntryStatus) {
      steps[3].state = tallyState(voucher.tallyEntryStatus);
    }
    return steps;
  }

  if (tallyEntry) {
    steps[0].state = 'completed';
    steps[1].state = 'completed';
    steps[2].state = 'completed';
    steps[3].state = tallyState(tallyEntry.tallyEntryStatus);
    steps[3].sublabel = tallyEntry.entryNumber || '';
    // Once the tally entry is done, the pipeline's final step becomes active —
    // previously left at its 'pending' default, so it never lit up here.
    if (steps[3].state === 'completed') steps[4].state = 'active';
    return steps;
  }

  return steps;
}
