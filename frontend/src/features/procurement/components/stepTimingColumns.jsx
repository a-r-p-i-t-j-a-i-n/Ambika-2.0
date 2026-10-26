import { Box, Typography } from '@mui/material';
import dayjs from 'dayjs';
import { PFMS } from '../pfmsTheme';

/**
 * Planned Date / Actual Date & Time (+ "By <name>") / Assigned Doer for every
 * Purchase FMS list — the O2D step-board convention. Reads `row.stepTiming`,
 * which the list APIs attach from fields the workflow already records
 * (backend: modules/procurement/stepTiming.rules.js). Never invents a value:
 * anything missing renders "—".
 *
 *   const columns = [serialColumn(), ..., ...stepTimingColumns(), statusCol, actionsCol];
 */

// A value at exactly UTC midnight is a date the user picked, not a moment —
// show the date only so it never reads as a fake "05:30 AM" (same rule as O2D).
const isDateOnly = (d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "26 Oct 2026, 03:45 PM" (browser-local, like O2D) — or "26 Oct 2026" for a picked date. */
export const fmtStepDateTime = (v) => {
  const d = toDate(v);
  if (!d) return '—';
  return dayjs(d).format(isDateOnly(d) ? 'DD MMM YYYY' : 'DD MMM YYYY, hh:mm A');
};

// Overdue / late compare against the stored planned instant — the same rule as
// O2D's delayMins and the Purchase modules' own Time Delay / isDelayed.
const timingOf = (row) => {
  const t = row?.stepTiming || {};
  const planned = toDate(t.plannedAt);
  const actual = t.done ? toDate(t.actualAt) : null;
  return {
    t,
    planned,
    actual,
    overdue: !t.done && !!planned && planned < new Date(),
    late: !!planned && !!actual && actual > planned,
  };
};

const cellSx = { display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', minWidth: 0, lineHeight: 1.25 };
const mainSx = { fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const capSx = { fontSize: '0.68rem', color: PFMS.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const dash = <Typography sx={{ ...mainSx, color: PFMS.faint }}>—</Typography>;

/** Plain-text values for non-grid views (sheet / cards / board / export). */
export const stepTimingText = (row) => {
  const { t, planned, actual } = timingOf(row);
  return {
    planned: planned ? fmtStepDateTime(planned) : '—',
    actual: actual ? fmtStepDateTime(actual) : '—',
    doneBy: (t.done && t.doneByName) || '—',
    doer: t.assignedDoerName || '—',
    step: t.multiStep && t.stepLabel ? [t.stepCode, t.stepLabel].filter(Boolean).join(' ') : '',
  };
};

/**
 * planned / doer: false drops that column (e.g. MD Approvals has neither).
 * titleCase: header style for grids that use Title Case instead of UPPERCASE.
 */
export const stepTimingColumns = ({ planned = true, doer = true, titleCase = false } = {}) => {
  const header = (upper, title) => (titleCase ? title : upper);
  const cols = [
    { field: 'stepPlannedAt', headerName: header('PLANNED DATE', 'Planned Date'), width: 150, sortable: false,
      valueGetter: (_v, row) => row?.stepTiming?.plannedAt || null,
      renderCell: (p) => {
        const { planned, overdue } = timingOf(p.row);
        if (!planned) return <Box sx={cellSx}>{dash}</Box>;
        return (
          <Box sx={cellSx}>
            <Typography sx={{ ...mainSx, color: overdue ? '#dc2626' : PFMS.body, fontWeight: overdue ? 700 : 400 }}>
              {fmtStepDateTime(planned)}
            </Typography>
            {overdue && <Typography sx={{ ...capSx, color: '#dc2626' }}>Overdue</Typography>}
          </Box>
        );
      } },
    { field: 'stepActualAt', headerName: header('ACTUAL DATE & TIME', 'Actual Date & Time'), width: 170, sortable: false,
      valueGetter: (_v, row) => (row?.stepTiming?.done ? row.stepTiming.actualAt || null : null),
      renderCell: (p) => {
        const { t, actual, late } = timingOf(p.row);
        const by = t.done ? t.doneByName : null;
        if (!actual && !by) return <Box sx={cellSx}>{dash}</Box>;
        return (
          <Box sx={cellSx}>
            {actual
              ? <Typography sx={{ ...mainSx, fontWeight: 700, color: late ? '#b45309' : '#15803d' }}>{fmtStepDateTime(actual)}</Typography>
              : dash}
            {by && <Typography sx={capSx} title={`By ${by}`}>By {by}</Typography>}
          </Box>
        );
      } },
  ].filter((c) => planned || c.field !== 'stepPlannedAt');
  if (doer) {
    cols.push({ field: 'stepDoer', headerName: header('ASSIGNED DOER', 'Assigned Doer'), width: 160, sortable: false,
      valueGetter: (_v, row) => row?.stepTiming?.assignedDoerName || '',
      renderCell: (p) => {
        const { step } = stepTimingText(p.row);
        const name = p.row?.stepTiming?.assignedDoerName;
        return (
          <Box sx={cellSx}>
            {name ? <Typography sx={{ ...mainSx, color: PFMS.ink, fontWeight: 600 }} title={name}>{name}</Typography> : dash}
            {step && <Typography sx={capSx} title={step}>{step}</Typography>}
          </Box>
        );
      } });
  }
  return cols;
};
