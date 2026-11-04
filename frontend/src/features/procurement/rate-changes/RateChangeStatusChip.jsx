import React from 'react';
import { Chip } from '@mui/material';
import { RATE_STATUS } from './rateChangeMeta';

const RateChangeStatusChip = ({ status, size = 'small', label }) => {
  const meta = RATE_STATUS[status] || { label: status || '—', color: '#475569', bg: '#e2e8f0' };
  return (
    <Chip size={size} label={label || meta.label} data-status={status}
      sx={{ height: 22, fontSize: '0.68rem', fontWeight: 800, color: meta.color, bgcolor: meta.bg }} />
  );
};

export default RateChangeStatusChip;
