import React from 'react';
import { Tooltip, Typography } from '@mui/material';

/**
 * "+50 awaiting QC" — material received on a completed GRN whose Incoming QC
 * has not completed yet (awaitingQc.service on the server). It is no longer in
 * transit (the PO counts it received) and not yet on hand (nothing is usable
 * until QC accepts it), so without this line it would vanish from the screen.
 * Shown under Material In Transit in both the RM and the Consumables lists,
 * which also count it toward Projected Available, exactly like in-transit.
 */
const AwaitingQcNote = ({ qty, grnNumbers = [], fmt = (n) => n }) => {
  if (!(Number(qty) > 0)) return null;
  const title = `${fmt(qty)} received on ${grnNumbers.length ? grnNumbers.join(', ') : 'a GRN'} and waiting for Incoming QC. `
    + 'Not usable until the QC accepts it; only the accepted quantity is added to stock. '
    + 'Counted toward Projected Available like material in transit.';
  return (
    <Tooltip arrow title={title}>
      <Typography component="span" data-testid="ims-awaiting-qc"
        sx={{ display: 'block', cursor: 'help', fontSize: '0.6rem', fontWeight: 800, color: '#b45309', whiteSpace: 'nowrap' }}>
        +{fmt(qty)} awaiting QC
      </Typography>
    </Tooltip>
  );
};

export default AwaitingQcNote;
