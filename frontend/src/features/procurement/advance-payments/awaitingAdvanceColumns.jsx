import React from 'react';
import { Typography } from '@mui/material';
import StatusChip from '../components/StatusChip';
import { stepTimingColumns } from '../components/stepTimingColumns';
import { fmtINR } from './apMeta';

/**
 * Extra columns for the "Awaiting Advance" queue (StepQueueGrid): the advance
 * breakdown straight from the PI (the advance IS the PI value), the payment
 * status, and the planned date / assigned doer of the PI's Step 1.7 task.
 * Rows come from GET /procurement/step-queues/ADVANCE_PAYMENT.
 */
const money = (field, headerName, extra = {}) => ({
  field, headerName, width: 130, align: 'right', headerAlign: 'right', sortable: false,
  renderCell: (p) => (
    <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', ...extra }}>{fmtINR(p.value)}</Typography>
  ),
});

export const awaitingAdvanceColumns = [
  money('piAmount', 'PI Amount'),
  money('advanceRequired', 'Advance Required'),
  money('paidAmount', 'Already Paid', { color: '#0f766e' }),
  money('remainingAmount', 'Remaining Advance', { color: '#b45309' }),
  { field: 'paymentStatus', headerName: 'Payment Status', width: 140, sortable: false,
    renderCell: (p) => <StatusChip status={p.value} /> },
  // Planned date + assigned doer only: nothing is performed while a PI is awaiting.
  ...stepTimingColumns().filter((c) => c.field !== 'stepActualAt'),
];
