import React, { useState } from 'react';
import { Dialog } from '@mui/material';
import { Trash2 } from 'lucide-react';
import RecordDeleteDialog from './RecordDeleteDialog';

/**
 * Delete for any Purchase FMS list — one confirm dialog, the same everywhere.
 *
 *   const del = useRecordDelete({
 *     what: 'PI', numberOf: (r) => r.piNumber,
 *     remove: deleteProformaInvoice,                 // the RTK mutation trigger
 *     needsReason: (r) => r.approvalStatus === 'APPROVED',
 *     consequence: (r) => 'The PO goes back to "no PI".',
 *   });
 *   if (can('procurement.deleteProformaInvoice')) a.push(del.action(row));   // in actionsFor
 *   {del.dialog}                                                             // once, in the page
 *
 * The server decides: a completed record goes only while no later step rests
 * on it, and its refusal (naming those records) is shown in the dialog.
 */
export const useRecordDelete = ({ what, numberOf, remove, needsReason = () => false, consequence = () => '' }) => {
  // The row stays while the dialog fades out, so its content never jumps.
  const [{ row, open }, setState] = useState({ row: null, open: false });
  const close = () => setState((s) => ({ ...s, open: false }));
  return {
    /** The ⋮ menu item — red, last. */
    action: (r, extra = {}) => ({
      key: 'delete', label: `Delete ${what}`, icon: <Trash2 size={16} />, danger: true, divider: true,
      fn: () => setState({ row: r, open: true }), ...extra,
    }),
    dialog: (
      <Dialog open={open} onClose={close} maxWidth="xs" fullWidth
        TransitionProps={{ onExited: () => setState({ row: null, open: false }) }}>
        {row && (
          <RecordDeleteDialog key={row._id} row={row} what={what} number={numberOf(row) || ''} remove={remove}
            needsReason={Boolean(needsReason(row))} consequence={consequence(row)} onClose={close} />
        )}
      </Dialog>
    ),
  };
};

export default useRecordDelete;
