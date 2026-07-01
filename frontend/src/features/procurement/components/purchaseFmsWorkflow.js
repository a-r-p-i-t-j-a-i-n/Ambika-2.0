/** Purchase FMS workflow step resolver.
 *  Returns an ordered step array for the full GRN → QC → Invoice → Voucher → Tally → Payment pipeline.
 *  Each caller passes the single entity it is currently displaying; prior steps are inferred as completed.
 */

const STEPS_TEMPLATE = () => [
  { key: 'grn',     label: 'GRN',            state: 'pending', sublabel: '' },
  { key: 'qc',      label: 'Incoming QC',    state: 'pending', sublabel: '' },
  { key: 'invoice', label: 'Vendor Invoice', state: 'pending', sublabel: '' },
  { key: 'voucher', label: 'Voucher',        state: 'pending', sublabel: '' },
  { key: 'tally',   label: 'Tally Entry',   state: 'pending', sublabel: '' },
  { key: 'payment', label: 'Final Payment', state: 'pending', sublabel: '' },
];

const grnState = (status) => {
  if (!status) return 'pending';
  if (status === 'CANCELLED') return 'error';
  if (['PARTIAL_RECEIVED', 'FULLY_RECEIVED'].includes(status)) return 'completed';
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

export function resolveWorkflowSteps({ grn, qc, invoice, voucher, tallyEntry } = {}) {
  const steps = STEPS_TEMPLATE();

  if (grn) {
    steps[0].state = grnState(grn.grnStatus);
    steps[0].sublabel = grn.grnNumber || '';
    if (grn.qcStatus) {
      steps[1].state = qcState(grn.qcStatus);
    }
    return steps;
  }

  if (qc) {
    steps[0].state = 'completed';
    steps[1].state = qcState(qc.qcStatus);
    steps[1].sublabel = qc.qcNumber || '';
    return steps;
  }

  if (invoice) {
    steps[0].state = 'completed';
    steps[1].state = 'completed';
    steps[2].state = invoiceState(invoice.invoiceStatus);
    steps[2].sublabel = invoice.invoiceNumber || '';
    return steps;
  }

  if (voucher) {
    steps[0].state = 'completed';
    steps[1].state = 'completed';
    steps[2].state = 'completed';
    steps[3].state = voucherState(voucher.voucherStatus);
    steps[3].sublabel = voucher.voucherNumber || '';
    if (voucher.tallyEntryStatus) {
      steps[4].state = tallyState(voucher.tallyEntryStatus);
    }
    return steps;
  }

  if (tallyEntry) {
    steps[0].state = 'completed';
    steps[1].state = 'completed';
    steps[2].state = 'completed';
    steps[3].state = 'completed';
    steps[4].state = tallyState(tallyEntry.tallyEntryStatus);
    steps[4].sublabel = tallyEntry.entryNumber || '';
    return steps;
  }

  return steps;
}
