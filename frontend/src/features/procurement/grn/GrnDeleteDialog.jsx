import React, { useRef } from 'react';
import CascadeDeleteDialog from '../components/CascadeDeleteDialog';

/**
 * Delete a GRN — the shared cascading-deletion confirmation (CascadeDeleteDialog):
 * the GRN goes with any draft QC / invoice / voucher resting on it, while a
 * completed QC, posted stock or a signature blocks it and is named. A
 * completed GRN's received qty comes off its PO (the GRN's own delete).
 * onClose(deleted) — deleted is true only after a successful deletion.
 */
const GrnDeleteDialog = ({ open, grn, onClose }) => {
  const deleted = useRef(false);
  return (
    <CascadeDeleteDialog open={open} type="GRN" id={grn?._id} what="GRN" number={grn?.grnNumber || ''}
      onDone={() => { deleted.current = true; }}
      onClose={() => { const done = deleted.current; deleted.current = false; onClose?.(done); }} />
  );
};

export default GrnDeleteDialog;
