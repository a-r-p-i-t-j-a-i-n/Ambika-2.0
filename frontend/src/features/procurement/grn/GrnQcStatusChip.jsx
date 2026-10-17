import React from 'react';
import StatusChip from '../components/StatusChip';

/** The GRN's Incoming QC status (from resolveGrnQcStage), e.g. "Awaiting MD Signature". */
const GrnQcStatusChip = ({ stage }) => (stage?.label ? <StatusChip label={stage.label} tone={stage.tone} /> : null);

export default GrnQcStatusChip;
