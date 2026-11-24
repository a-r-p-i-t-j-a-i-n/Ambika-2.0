// ── Dispatch calendar: month navigation and the day grid (Mon → Sun) ─────────
import React, { useState } from 'react';
import { Box, ButtonBase, Popover, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { clock, startOfDay } from '../dashboardModel';
import { T } from '../dashTheme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const navBtnSx = {
  width: 26, height: 26, borderRadius: '6px', color: T.heading, border: `1px solid ${T.borderSoft}`, bgcolor: '#fff',
  '&:hover': { bgcolor: '#f3f6fb' },
};

const shiftMonth = ({ year, month }, delta) => {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
};

/** ‹ November 2026 ▾ › Today — clicking the month opens a month / year picker. */
export const CalendarNav = ({ value, onChange }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [pickYear, setPickYear] = useState(value.year);
  const close = () => setAnchorEl(null);
  const title = new Date(value.year, value.month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const today = () => { const n = new Date(); onChange({ year: n.getFullYear(), month: n.getMonth() }); };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mx: 'auto' }}>
      <ButtonBase sx={navBtnSx} aria-label="Previous month" onClick={() => onChange(shiftMonth(value, -1))}><ChevronLeft size={13} /></ButtonBase>
      <ButtonBase
        onClick={(e) => { setPickYear(value.year); setAnchorEl(e.currentTarget); }}
        sx={{ fontSize: 13, fontWeight: 700, color: T.heading, minWidth: 130, px: 0.75, py: 0.25, borderRadius: '6px', '&:hover': { bgcolor: '#f3f6fb' } }}
      >
        {title} ▾
      </ButtonBase>
      <ButtonBase sx={navBtnSx} aria-label="Next month" onClick={() => onChange(shiftMonth(value, 1))}><ChevronRight size={13} /></ButtonBase>
      <ButtonBase
        onClick={today}
        sx={{ fontSize: 11.5, fontWeight: 600, color: T.heading, border: `1px solid ${T.borderSoft}`, bgcolor: '#fff', px: 1.25, py: '3px', borderRadius: 999, '&:hover': { bgcolor: '#f3f6fb' } }}
      >
        Today
      </ButtonBase>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        PaperProps={{ sx: { width: 230, p: 1.25, borderRadius: '12px', mt: 0.75 } }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <ButtonBase sx={navBtnSx} aria-label="Previous year" onClick={() => setPickYear((y) => y - 1)}><ChevronLeft size={13} /></ButtonBase>
          <Typography sx={{ fontWeight: 700, color: T.heading, fontSize: 14 }}>{pickYear}</Typography>
          <ButtonBase sx={navBtnSx} aria-label="Next year" onClick={() => setPickYear((y) => y + 1)}><ChevronRight size={13} /></ButtonBase>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.75 }}>
          {MONTHS.map((m, i) => {
            const on = i === value.month && pickYear === value.year;
            return (
              <ButtonBase
                key={m}
                onClick={() => { onChange({ year: pickYear, month: i }); close(); }}
                sx={{
                  py: 0.9, borderRadius: '8px', fontSize: 12.5, color: on ? '#fff' : T.heading, fontWeight: on ? 700 : 400,
                  bgcolor: on ? T.pick : 'transparent', '&:hover': { bgcolor: on ? T.pick : '#f3f6fb' },
                }}
              >
                {m}
              </ButtonBase>
            );
          })}
        </Box>
      </Popover>
    </Box>
  );
};

/**
 * The month grid. `eventsOf(dayStart)` → [{ key, label, fg, bg }]; the first
 * two show in the cell, the rest as "+n more". Clicking a day calls onDay.
 */
export const CalendarGrid = ({ value, eventsOf, selectedDay, onDay, big }) => {
  const { year, month } = value;
  const offset = (new Date(year, month, 1).getDay() + 6) % 7; // Monday first
  const days = new Date(year, month + 1, 0).getDate();
  const today = startOfDay(clock());
  const cells = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 0.5, textAlign: 'center' }}>
      {WEEKDAYS.map((w) => (
        <Typography key={w} sx={{ fontSize: 10, fontWeight: 700, color: T.muted, py: 0.25 }}>{w}</Typography>
      ))}
      {cells.map((d, i) => {
        if (!d) return <Box key={`blank-${i}`} />;
        const ts = new Date(year, month, d).getTime();
        const events = eventsOf(ts);
        const sel = selectedDay === ts;
        const isToday = ts === today;
        return (
          <ButtonBase
            key={ts}
            onClick={() => onDay(ts)}
            sx={{
              minHeight: big ? 84 : 58, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column',
              alignItems: 'stretch', justifyContent: 'flex-start', gap: '2px', px: '5px', py: '4px',
              border: `1px solid ${sel ? T.brand : T.border}`, borderRadius: '8px',
              boxShadow: sel ? `inset 0 0 0 1px ${T.brand}` : 'none',
              '&:hover': { bgcolor: T.surface2 },
            }}
          >
            <Box
              sx={{
                alignSelf: 'center', fontSize: big ? 13 : 11, fontWeight: 600,
                ...(isToday
                  ? { color: '#fff', bgcolor: T.brand, borderRadius: 999, width: 20, height: 20, display: 'grid', placeItems: 'center' }
                  : { color: T.text2 }),
              }}
            >
              {d}
            </Box>
            {events.slice(0, 2).map((e) => (
              <Box
                key={e.key}
                component="span"
                title={e.title || e.label}
                sx={{
                  display: 'block', fontSize: big ? 11 : 9.5, lineHeight: 1.3, px: 0.5, py: '1px', borderRadius: '4px',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: e.fg, bgcolor: e.bg,
                }}
              >
                {e.label}
              </Box>
            ))}
            {events.length > 2 && (
              <Typography component="span" sx={{ fontSize: 9.5, color: T.muted }}>+{events.length - 2} more</Typography>
            )}
          </ButtonBase>
        );
      })}
    </Box>
  );
};
