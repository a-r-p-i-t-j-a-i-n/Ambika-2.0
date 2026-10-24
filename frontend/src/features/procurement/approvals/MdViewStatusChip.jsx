import React from 'react';
import StatusChip from '../components/StatusChip';
import { MD_VIEW_STATUS } from './mdApprovalMeta';

/** Pending (amber) / Approved (blue) / Completed (green) — the MD Approval screen's status. */
const MdViewStatusChip = ({ status }) => {
  const meta = MD_VIEW_STATUS[status] || { label: status || '—', tone: 'neutral' };
  return <StatusChip status={status} label={meta.label} tone={meta.tone} />;
};

export default MdViewStatusChip;
