/**
 * The Dispatch Calendar's month grid and legend line, shared so any calendar
 * that shows "who + what + how much per day" looks exactly like it. Moved out
 * of DispatchCalendar.jsx unchanged — DispatchCalendar renders through it with
 * the defaults below, so its page is identical; the Purchase Item Delivery
 * Calendar passes its own labels (tag, total suffix, card colour).
 *
 *   <CalendarLegend types statuses note />
 *   <CalendarMonthGrid gridDays cursor today groupedByDate selectedDate compact
 *     weekCols metaOf onOpenDay onDayClick tagOf totalSuffix cardTitle partyLabel />
 */
import React from 'react';
import { Box, Divider, Stack, Tooltip, Typography, alpha } from '@mui/material';
import { ChevronRight as MoreIcon } from 'lucide-react';
import { O2D } from '../o2d-fms/o2dTheme';
import { shortParty } from './calendarGridUtils';

const BRAND = '#1d4ed8';
const BRAND_DK = '#1e3a8a';
const GRID = O2D.line; // warm hairline
const IN_PROGRESS = '#b45309'; // Dispatch STATUS.IN_PROGRESS — the "several cards" badge
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const num = (n) => Number(n || 0).toLocaleString('en-IN');

// Dispatch defaults.
const dispatchTag = (g) => (g.eventType === 'actual' ? 'ACT' : 'SCH');
const dispatchTitle = (g) => `${g.partyName} · ${g.orderCount} order${g.orderCount > 1 ? 's' : ''} · ${num(g.totalQty)} pcs · ${g.eventType === 'actual' ? 'Actual' : 'Scheduled'}`;

/** The legend line under the calendar toolbar. */
export const CalendarLegend = ({ types = [], statuses = [], note }) => (
  <Stack data-testid="calendar-legend" direction="row" spacing={1.75} sx={{ px: { xs: 1.25, sm: 1.75 }, py: 0.5, flexWrap: 'wrap', rowGap: 0.4, borderBottom: `1px solid ${GRID}`, bgcolor: O2D.surfaceAlt }}>
    {types.map((v) => (
      <Stack key={v.label} direction="row" spacing={0.5} alignItems="center">
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: v.color }} />
        <Typography sx={{ fontSize: '0.64rem', fontWeight: 800, color: 'text.secondary' }}>{v.label}</Typography>
      </Stack>
    ))}
    {statuses.length > 0 && <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />}
    {statuses.map((v) => (
      <Stack key={v.label} direction="row" spacing={0.5} alignItems="center">
        <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: v.color }} />
        <Typography sx={{ fontSize: '0.64rem', fontWeight: 700, color: 'text.secondary' }}>{v.label}</Typography>
      </Stack>
    ))}
    <Box sx={{ flex: 1 }} />
    <Typography sx={{ fontSize: '0.64rem', color: O2D.faint, whiteSpace: 'nowrap' }}>
      {note}
    </Typography>
  </Stack>
);

/** The month grid: weekday header row + one cell per day, at most 2 cards then "+N more parties". */
export const CalendarMonthGrid = ({
  gridDays, cursor, today, groupedByDate, selectedDate = null, compact = false, weekCols,
  metaOf, onOpenDay, onDayClick, tagOf = dispatchTag, totalSuffix = ' pcs', cardTitle = dispatchTitle,
  partyLabel = shortParty,
}) => (
  <Box sx={{ overflowX: 'auto' }}>
    <Box sx={{ minWidth: compact ? 0 : 700 }}>
      {/* Weekday header */}
      <Box sx={{ display: 'grid', gridTemplateColumns: weekCols, borderBottom: `1px solid ${GRID}`, bgcolor: O2D.surfaceAlt }}>
        {WEEKDAYS.map((w) => (
          <Typography key={w} sx={{ py: 0.5, textAlign: 'center', fontWeight: 800, fontSize: '0.66rem', color: BRAND_DK, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {w}
          </Typography>
        ))}
      </Box>

      {/* Day grid */}
      <Box data-testid="calendar-month-grid" sx={{ display: 'grid', gridTemplateColumns: weekCols }}>
        {gridDays.map((day) => {
          const key = day.format('YYYY-MM-DD');
          const inMonth = day.isSame(cursor, 'month');
          // Prev/next-month cells → blank (only the selected month is shown).
          if (!inMonth) {
            return (
              <Box key={key} sx={{
                minHeight: compact ? 60 : { xs: 72, md: 88 },
                borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}`,
                bgcolor: O2D.surfaceAlt,
              }} />
            );
          }
          const groups = groupedByDate.get(key) || [];
          const isToday = day.isSame(today, 'day');
          const shown = groups.slice(0, 2);
          const more = groups.length - shown.length;
          return (
            <Box
              key={key}
              data-day={day.date()}
              data-count={groups.reduce((s, g) => s + (g.events?.length || 0), 0)}
              onClick={() => { if (groups.length) { onOpenDay?.(key); onDayClick?.(key); } }}
              sx={{
                // Rows grow to fit the item lines, but a day never shows more
                // than 2 dispatches (the rest collapse to "+N more"), so the
                // month still reads as a calendar instead of a long scroll.
                minHeight: compact ? 60 : { xs: 72, md: 88 }, p: 0.5,
                borderRight: `1px solid ${GRID}`,
                borderBottom: `1px solid ${GRID}`,
                boxShadow: selectedDate === key ? `inset 0 0 0 2px ${BRAND}` : 'none',
                bgcolor: isToday ? alpha(BRAND, 0.06) : (inMonth ? O2D.surface : O2D.surfaceAlt),
                cursor: groups.length ? 'pointer' : 'default',
                transition: 'background .15s',
                '&:hover': groups.length ? { bgcolor: alpha(BRAND, 0.07) } : {},
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.4 }}>
                <Box sx={{
                  width: 19, height: 19, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  fontSize: '0.68rem', fontWeight: 800,
                  bgcolor: isToday ? BRAND : 'transparent',
                  color: isToday ? '#fff' : (inMonth ? 'text.primary' : '#94a3b8'),
                }}>
                  {day.date()}
                </Box>
                {groups.length > 1 && (
                  <Box sx={{
                    width: 15, height: 15, borderRadius: '50%', display: 'grid', placeItems: 'center',
                    fontSize: '0.54rem', fontWeight: 900, bgcolor: IN_PROGRESS, color: '#fff',
                  }}>{groups.length}</Box>
                )}
              </Stack>

              {/* One card PER PARTY (orders merged), with each item merged into a
                  single line and a party total. No SO number — the client reads
                  this day-wise as "who + what + how much". */}
              <Stack spacing={0.4}>
                {shown.map((g) => {
                  const m = metaOf(g);
                  const isActual = g.eventType === 'actual';
                  const rows = (g.skus || []).filter((sk) => (isActual ? sk.actualQty : sk.plannedQty) > 0);
                  return (
                    <Tooltip key={g.id} title={cardTitle(g)} disableInteractive>
                      <Box data-testid="calendar-card" data-type={g.eventType} sx={{
                        borderLeft: `3px solid ${m.color}`, bgcolor: alpha(m.color, 0.07),
                        borderRadius: '3px', px: 0.5, py: 0.3,
                      }}>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <Typography noWrap sx={{ fontSize: '0.6rem', fontWeight: 800, color: O2D.ink, flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                            {partyLabel(g.partyName)}
                          </Typography>
                          {/* Compact panel: the card colour already tells the status. */}
                          {!compact && (
                          <Typography sx={{ fontSize: '0.46rem', fontWeight: 900, color: m.color, flexShrink: 0 }}>
                            {tagOf(g)}
                          </Typography>
                          )}
                          {!compact && g.orderCount > 1 && (
                            <Typography sx={{ fontSize: '0.46rem', fontWeight: 800, color: O2D.faint, flexShrink: 0 }}>
                              ×{g.orderCount}
                            </Typography>
                          )}
                        </Stack>
                        {/* Compact (dashboard panel): party + total only — the day dialog lists the SKUs. */}
                        {!compact && rows.map((sk, i) => (
                          <Stack key={i} direction="row" alignItems="center" spacing={0.5}>
                            <Typography noWrap sx={{ fontSize: '0.54rem', color: O2D.body, flex: 1, minWidth: 0, lineHeight: 1.35 }}>
                              {sk.skuName}
                            </Typography>
                            <Typography sx={{ fontSize: '0.54rem', fontWeight: 800, color: O2D.ink, flexShrink: 0, fontVariantNumeric: 'tabular-nums', lineHeight: 1.35 }}>
                              {num(isActual ? sk.actualQty : sk.plannedQty)}
                            </Typography>
                          </Stack>
                        ))}
                        <Stack direction="row" alignItems="center" spacing={0.5}
                          sx={{ mt: 0.2, pt: 0.2, borderTop: `1px solid ${alpha(m.color, 0.22)}` }}>
                          <Typography sx={{ fontSize: '0.44rem', fontWeight: 800, color: O2D.faint, textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1 }}>
                            {compact ? '' : 'Total'}
                          </Typography>
                          <Typography sx={{ fontSize: '0.56rem', fontWeight: 900, color: m.color, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                            {num(g.totalQty)}{totalSuffix}
                          </Typography>
                        </Stack>
                      </Box>
                    </Tooltip>
                  );
                })}
                {more > 0 && (
                  <Box onClick={(ev) => { ev.stopPropagation(); onOpenDay?.(key); }}
                    sx={{ mt: 0.1, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 0.25,
                      px: 0.6, py: 0.15, borderRadius: '4px', cursor: 'pointer',
                      bgcolor: alpha(BRAND, 0.1), color: BRAND, '&:hover': { bgcolor: alpha(BRAND, 0.2) } }}>
                    <Typography sx={{ fontSize: '0.54rem', fontWeight: 800, lineHeight: 1.3 }}>
                      +{more} more {more === 1 ? 'party' : 'parties'}
                    </Typography>
                    <MoreIcon size={9} />
                  </Box>
                )}
              </Stack>
            </Box>
          );
        })}
      </Box>
    </Box>
  </Box>
);

export default CalendarMonthGrid;
