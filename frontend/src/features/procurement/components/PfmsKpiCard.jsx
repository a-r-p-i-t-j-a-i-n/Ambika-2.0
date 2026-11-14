import React from 'react';
import { Box, Typography, ButtonBase } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Check, ListFilter } from 'lucide-react';
import { PFMS, kpiToneFor } from '../pfmsTheme';

/**
 * Shared summary/KPI card for every Purchase FMS list page (all 11 step
 * routes, the Awaiting queues, and the other procurement lists that use it).
 * One styling source, so every summary row has the same height, padding,
 * radius, type scale and alignment — a compact single row:
 *
 *   ┌───────────────────────────────┐
 *   │ [icon]  1,234             [≡] │   fixed 64px height; the row (pfmsKpiRowSx)
 *   │         Label                 │   decides the width — cards fill the row
 *   └───────────────────────────────┘
 *
 * A long label may wrap to a second line inside the same height; in a narrow
 * card the icon chip shrinks, and in a very narrow one steps aside (container
 * queries), and a currency amount scales to the card's width.
 *
 * Colour: the `color` a screen passes picks a coordinated light tone from
 * PFMS_KPI_TONES (pastel surface, hairline border, icon chip) — every card is
 * tinted, so a resting card reads as intentionally enabled, never "off".
 *
 * Optionally interactive: pass `onClick` and the card becomes a real button
 * that filters the list below it. A clickable card shows a filter glyph and
 * lifts on hover; `active` draws the selected state (solid tone border, soft
 * ring, filled icon chip and check). Cards WITHOUT `onClick` render the same
 * surface with no glyph and no hover — a summary figure, not a control.
 */
const toneOf = (color) => kpiToneFor(color) || {
  fg: color || PFMS.ink,
  bg: alpha(color || PFMS.ink, 0.04),
  border: alpha(color || PFMS.ink, 0.16),
  chip: alpha(color || PFMS.ink, 0.1),
};

const CARD_HEIGHT = 64;
// Narrow cards (content width): a smaller icon chip below COMPACT, and none
// below TIGHT — only a 6-7 card money row ever gets that narrow — so the
// figure always keeps its room.
const COMPACT = '190px';
const TIGHT = '140px';

const PfmsKpiCard = ({ icon, label, value, color, onClick, active = false }) => {
  // A pre-formatted currency string ("₹3,74,339.00") runs much longer than a
  // plain count — it scales with the card's own width (container units), so a
  // narrow card in a 7-card row still shows the whole amount on one line.
  const isMoney = typeof value === 'string' && value.trim().startsWith('₹');
  const interactive = typeof onClick === 'function';
  const tone = toneOf(color);
  const shown = value ?? 0;

  const body = (
    <>
      <Box
        aria-hidden="true"
        data-kpi-icon=""
        sx={{
          width: 32,
          height: 32,
          mr: '10px',
          borderRadius: '8px',
          display: 'grid',
          placeItems: 'center',
          bgcolor: active ? tone.fg : tone.chip,
          color: active ? '#fff' : tone.fg,
          flexShrink: 0,
          transition: 'background-color 160ms ease, color 160ms ease',
          '& svg': { width: 17, height: 17 },
          [`@container (max-width: ${COMPACT})`]: { width: 24, height: 24, mr: '7px', borderRadius: '6px', '& svg': { width: 14, height: 14 } },
          [`@container (max-width: ${TIGHT})`]: { display: 'none' },
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Typography
          component="span"
          data-kpi-value=""
          noWrap
          sx={{
            display: 'block',
            fontSize: isMoney ? 'clamp(0.8rem, 8.2cqi, 1rem)' : '1.22rem',
            fontWeight: 800,
            lineHeight: 1.15,
            color: PFMS.ink,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.01em',
          }}
        >
          {shown}
        </Typography>
        <Typography
          component="span"
          data-kpi-label=""
          sx={{
            fontSize: '0.71rem',
            fontWeight: 600,
            lineHeight: 1.2,
            mt: '2px',
            color: active ? tone.fg : '#475569',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
          }}
        >
          {label}
        </Typography>
      </Box>
      {interactive && (
        <Box
          className="pfms-kpi-filter"
          aria-hidden="true"
          sx={{
            width: 20,
            height: 20,
            ml: '6px',
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            bgcolor: active ? tone.fg : 'transparent',
            color: active ? '#fff' : alpha(tone.fg, 0.55),
            transition: 'background-color 160ms ease, color 160ms ease',
          }}
        >
          {active ? <Check size={13} strokeWidth={3} /> : <ListFilter size={14} />}
        </Box>
      )}
    </>
  );

  const shellSx = {
    height: CARD_HEIGHT,
    boxSizing: 'border-box',
    borderRadius: '10px',
    border: `1px solid ${active ? tone.fg : tone.border}`,
    bgcolor: active ? tone.chip : tone.bg,
    boxShadow: active ? `0 0 0 3px ${alpha(tone.fg, 0.14)}` : `0 1px 2px ${alpha('#0f172a', 0.04)}`,
    px: 1.25,
    py: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
    minWidth: 0,
    overflow: 'hidden',
    textAlign: 'left',
    fontFamily: 'inherit',
    containerType: 'inline-size', // lets the icon/amount respond to this card's width
  };

  if (!interactive) {
    return (
      <Box data-kpi-card="" title={`${label}: ${shown}`} sx={shellSx}>
        {body}
      </Box>
    );
  }

  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={active}
      title={active ? `Showing: ${label} (${shown}) — click again to clear` : `Filter by: ${label} (${shown})`}
      data-kpi-card=""
      data-kpi-clickable="true"
      sx={{
        ...shellSx,
        cursor: 'pointer',
        transition: 'border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
        '&:hover': {
          borderColor: active ? tone.fg : alpha(tone.fg, 0.45),
          boxShadow: active ? `0 0 0 3px ${alpha(tone.fg, 0.18)}` : `0 4px 12px ${alpha(tone.fg, 0.12)}`,
          transform: 'translateY(-1px)',
        },
        '&:hover .pfms-kpi-filter': { color: active ? '#fff' : tone.fg },
        '&:active': { transform: 'translateY(0)' },
        '&.Mui-focusVisible': { outline: `2px solid ${tone.fg}`, outlineOffset: '2px' },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
      }}
    >
      {body}
    </ButtonBase>
  );
};

export default PfmsKpiCard;
