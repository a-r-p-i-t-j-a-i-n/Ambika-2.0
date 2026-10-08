import React from 'react';
import { Tooltip, Box } from '@mui/material';
import StatusChip from '../procurement/components/StatusChip';

/** Shared display helpers for FMS Doer Assignment screens. */

export const fmtDateTime = (d) => (d
  ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—');

// Assignment state of a step (config).
const ASSIGNMENT = {
  ASSIGNED:      ['Assigned', 'green'],
  UNASSIGNED:    ['Unassigned', 'amber'],
  DOER_INACTIVE: ['Doer inactive', 'red'],
};
export const AssignmentStatusChip = ({ status }) => {
  const [label, tone] = ASSIGNMENT[status] || [status, 'neutral'];
  return <StatusChip status={status} label={label} tone={tone} />;
};

// Task state (runtime).
const TASK = {
  OPEN:   ['Pending', 'amber'],
  DONE:   ['Completed', 'green'],
  CLOSED: ['Closed', 'neutral'],
};
export const TaskStatusChip = ({ status }) => {
  const [label, tone] = TASK[status] || [status, 'neutral'];
  return <StatusChip status={status} label={label} tone={tone} />;
};

/**
 * Permission status of a doer for a step:
 *   OK        — holds the step's declared permission(s)
 *   MISSING   — lacks one (tooltip lists it)
 *   NOT_GATED — the step has no permission in the current RBAC (any logged-in user)
 */
export const PermissionStatusChip = ({ status, missing = [] }) => {
  if (!status) return <Box component="span" sx={{ color: 'text.secondary' }}>—</Box>;
  const map = {
    OK:        ['Has permission', 'green', 'User holds the permission this step declares.'],
    MISSING:   ['Missing permission', 'red', `This user does not currently have permission to perform this step (${missing.join(', ')}).`],
    NOT_GATED: ['Open to all users', 'neutral', 'This step is not permission-gated in the current RBAC — any logged-in user can perform it.'],
  };
  const [label, tone, tip] = map[status] || [status, 'neutral', ''];
  return (
    <Tooltip title={tip} arrow>
      <Box component="span"><StatusChip status={status} label={label} tone={tone} /></Box>
    </Tooltip>
  );
};

export const userName = (u) => (u?.name ? `${u.name}${u.isActive === false ? ' (inactive)' : ''}` : '');
