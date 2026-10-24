import React from 'react';
import { Box, Card, Typography, ButtonBase } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { PFMS } from '../pfmsTheme';

/**
 * Shared summary/KPI card for every Purchase FMS list page — icon chip, big
 * number, label. Replaces the near-identical local `KpiCard` that used to be
 * redefined per module; one styling source keeps every module's summary row
 * visually identical (O2D-style hairline border + 8px radius, not the app's
 * default 14-16px card radius).
 *
 * Optionally interactive: pass `onClick` and the card becomes a real button
 * that filters the list below it, with `active` drawing the selected ring.
 * This is what lets the summary row double as a status filter instead of
 * repeating counts the filter dropdown already offers. Cards WITHOUT `onClick`
 * render exactly as before — a plain, non-focusable Card — so the eleven other
 * modules using this component are unaffected.
 */
const PfmsKpiCard = ({ icon, label, value, color, onClick, active = false }) => {
  // A pre-formatted currency string ("₹3,74,339.00") runs much longer than a
  // plain count — shrink it and force one line so it never wraps/clips inside
  // the fixed-height card (this mirrors the `money` prop every module's old
  // local KpiCard used to take).
  const isMoney = typeof value === 'string' && value.trim().startsWith('₹');
  const interactive = typeof onClick === 'function';

  const body = (
    <>
      <Box
        sx={{
          width: 34,
          height: 34,
          borderRadius: '8px',
          display: 'grid',
          placeItems: 'center',
          bgcolor: alpha(color, 0.1),
          color,
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0, textAlign: 'left' }}>
        <Typography
          noWrap
          sx={{ fontSize: isMoney ? '0.95rem' : '1.2rem', fontWeight: 800, lineHeight: 1.15, color: PFMS.ink }}
        >
          {value ?? 0}
        </Typography>
        <Typography noWrap sx={{ fontSize: '0.7rem', fontWeight: 600, color: PFMS.sub }}>
          {label}
        </Typography>
      </Box>
    </>
  );

  const shellSx = {
    borderRadius: '8px',
    border: `1px solid ${active ? color : PFMS.line}`,
    bgcolor: active ? alpha(color, 0.05) : PFMS.surface,
    boxShadow: active ? `inset 0 0 0 1px ${color}` : 'none',
    p: 1.25,
    display: 'flex',
    alignItems: 'center',
    gap: 1.25,
    width: '100%',
    minWidth: 0,
    overflow: 'hidden',
  };

  if (!interactive) return <Card sx={shellSx}>{body}</Card>;

  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={active}
      sx={{
        ...shellSx,
        justifyContent: 'flex-start',
        textAlign: 'left',
        transition: 'border-color 150ms ease, background-color 150ms ease',
        '&:hover': { borderColor: color, bgcolor: alpha(color, 0.04) },
        '&.Mui-focusVisible': { outline: `2px solid ${color}`, outlineOffset: '1px' },
      }}
    >
      {body}
    </ButtonBase>
  );
};

export default PfmsKpiCard;
