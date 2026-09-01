import React from 'react';
import { Box, Card, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { PFMS } from '../pfmsTheme';

/**
 * Shared summary/KPI card for every Purchase FMS list page — icon chip, big
 * number, label. Replaces the near-identical local `KpiCard` that used to be
 * redefined per module; one styling source keeps every module's summary row
 * visually identical (O2D-style hairline border + 8px radius, not the app's
 * default 14-16px card radius).
 */
const PfmsKpiCard = ({ icon, label, value, color }) => {
  // A pre-formatted currency string ("₹3,74,339.00") runs much longer than a
  // plain count — shrink it and force one line so it never wraps/clips inside
  // the fixed-height card (this mirrors the `money` prop every module's old
  // local KpiCard used to take).
  const isMoney = typeof value === 'string' && value.trim().startsWith('₹');
  return (
    <Card sx={{ ...{ borderRadius: '8px', border: `1px solid ${PFMS.line}` }, p: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{ width: 42, height: 42, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.1), color, flexShrink: 0 }}>
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: isMoney ? '1.05rem' : '1.35rem', fontWeight: 800, lineHeight: 1.1, color: PFMS.ink }}>{value ?? 0}</Typography>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: PFMS.sub }}>{label}</Typography>
      </Box>
    </Card>
  );
};

export default PfmsKpiCard;
