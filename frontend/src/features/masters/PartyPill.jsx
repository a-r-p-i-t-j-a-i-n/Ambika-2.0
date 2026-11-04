import React from 'react';
import { Box } from '@mui/material';
import { alpha } from '@mui/material/styles';

/** Small tinted pill (status, unit, code, label) — Party detail page. */
const PartyPill = ({ color, children, dot = false, icon, sx }) => {
  const Icon = icon;
  return (
    <Box component="span" sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5, height: 22, px: 0.9, borderRadius: '6px',
      bgcolor: alpha(color, 0.1), border: `1px solid ${alpha(color, 0.22)}`, color,
      fontSize: '0.7rem', fontWeight: 800, whiteSpace: 'nowrap', lineHeight: 1,
      ...sx,
    }}>
      {dot && <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color }} />}
      {Icon && <Icon size={12} />}
      {children}
    </Box>
  );
};

export default PartyPill;
