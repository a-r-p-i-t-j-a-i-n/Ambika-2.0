import React from 'react';
import StatusChip from '../components/StatusChip';
import { awaitsSubmission, awaitsApproval } from './poSubmission';

/** Approval chip that tells an unsubmitted draft from one awaiting approval. */
const PoApprovalStateChip = ({ po, ...rest }) => {
  if (awaitsSubmission(po)) return <StatusChip status="DRAFT" label="Draft — not submitted" {...rest} />;
  if (awaitsApproval(po)) return <StatusChip status="PENDING_APPROVAL" label="Awaiting Approval" {...rest} />;
  return <StatusChip status={po?.approvalStatus} {...rest} />;
};

export default PoApprovalStateChip;
