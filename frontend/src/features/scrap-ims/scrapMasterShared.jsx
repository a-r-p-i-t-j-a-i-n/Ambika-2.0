import React from 'react';
import {
  Box, Typography, Tooltip, Chip,
} from '@mui/material';
import dayjs from 'dayjs';
import {
  yieldBand, YIELD_GOOD_PCT, YIELD_HIGH_PCT, YIELD_LOW_PCT, kg, O2D, O2D_TIP, num,
} from './scrapImsMeta';

/**
 * What Scrap master data (one row per coil SKU) and a coil SKU's own page
 * (every cut of it) show the same way: the yield with how it was worked out,
 * the circle SKUs a cut or a grade produced, and the yield month by month.
 */

const monthText = (m) => (m ? dayjs(`${m}-01`).format('MMM YYYY') : 'No date');
const BAND_NOTE = `Green ${YIELD_GOOD_PCT}–${YIELD_HIGH_PCT}% is normal · amber below ${YIELD_LOW_PCT}% (a lot went to scrap) · red above ${YIELD_HIGH_PCT}% (more than a coil can give — check the weights).`;

/**
 * The yield, colour-coded by the client's bands, with how it was worked out
 * in its tooltip: circles ÷ coil, over all the kilograms, and — for a coil
 * SKU — the yield of each month.
 */
export const OverallYield = ({
  pct, circlesKg, coilKg, months = [], label = 'Overall yield', testId = 'master-yield',
}) => {
  const b = yieldBand(pct);
  if (!b) return <Box component="span" sx={{ color: O2D.faint }}>—</Box>;
  return (
    <Tooltip arrow slotProps={O2D_TIP} title={(
      <Box sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
        <b>{label} {num(pct)}%</b>
        <br />
        = circles {kg(circlesKg)} ÷ coil {kg(coilKg)} × 100
        {months.length > 0 && (
          <>
            <br /><br /><b>By month</b>
            {months.map((m) => (
              <Box key={m.month || 'none'}>{monthText(m.month)} — {m.yieldPct != null ? `${num(m.yieldPct)}%` : '—'} ({num(m.cuts)} cut{m.cuts === 1 ? '' : 's'})</Box>
            ))}
            <br />Worked out over the kilograms, so a bigger month counts for more.
          </>
        )}
        <br />{BAND_NOTE}
      </Box>
    )}>
      <Chip size="small" label={`${num(pct)}%`} data-testid={testId}
        sx={{
          height: 22, fontWeight: 800, fontSize: '0.7rem', borderRadius: '999px', cursor: 'help',
          bgcolor: `${b.color}14`, color: b.color, border: `1px solid ${b.color}55`, '& .MuiChip-label': { px: 0.9 },
        }} />
    </Tooltip>
  );
};

/** Circle SKUs — the first, code over name, and "+N more"; every one in the tooltip. */
export const CircleSkus = ({ list = [] }) => {
  if (!list.length) return <Box sx={{ textAlign: 'center', color: O2D.faint }}>—</Box>;
  const [first, ...rest] = list;
  return (
    <Tooltip arrow slotProps={O2D_TIP} title={(
      <Box sx={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
        {list.map((c) => <Box key={c.code}>{c.code}{c.name ? ` — ${c.name}` : ''} · {num(c.pcs)} pcs · {kg(c.kg)}</Box>)}
      </Box>
    )}>
      <Box sx={{ minWidth: 0, cursor: 'help' }}>
        <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#4338ca' }}>
          {first.code}
          {rest.length > 0 && <Box component="span" sx={{ fontWeight: 600, color: O2D.sub, fontSize: '0.66rem' }}> +{rest.length} more</Box>}
        </Typography>
        <Typography noWrap sx={{ fontSize: '0.66rem', color: O2D.sub }}>{first.name || '—'}</Typography>
      </Box>
    </Tooltip>
  );
};

/** The yield of each month as a coloured chip — how the grade moved over time. */
export const MonthYields = ({ months = [] }) => months.map((m) => {
  const b = yieldBand(m.yieldPct);
  return (
    <Tooltip key={m.month || 'none'} arrow slotProps={O2D_TIP}
      title={`${num(m.cuts)} cut${m.cuts === 1 ? '' : 's'} · coil ${kg(m.coilKg)} · circles ${kg(m.circlesKg)} · scrap ${kg(m.scrapKg)}`}>
      <Chip size="small" label={`${monthText(m.month)} · ${m.yieldPct != null ? `${num(m.yieldPct)}%` : '—'}`}
        sx={{
          height: 22, fontSize: '0.66rem', fontWeight: 700, borderRadius: '999px', cursor: 'help',
          bgcolor: b ? `${b.color}10` : O2D.surfaceAlt, color: b?.color || O2D.sub, border: `1px solid ${b ? `${b.color}40` : O2D.line}`,
        }} />
    </Tooltip>
  );
});
