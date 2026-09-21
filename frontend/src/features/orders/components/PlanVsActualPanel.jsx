import React, { useMemo } from 'react';
import { Box, Paper, Stack, Typography, Chip, Tooltip, alpha, useTheme, LinearProgress } from '@mui/material';
import { Activity, CheckCircle2, AlertCircle, ArrowRightCircle, Clock } from 'lucide-react';
import dayjs from 'dayjs';

const fmt = (v) => Number(v || 0).toLocaleString('en-IN');

const RISK_LABEL = {
  OVERDUE_PLAN: 'Overdue',
  UNPLANNED_DISPATCH: 'Unplanned',
  OVER_DISPATCH: 'Over-dispatch',
  BALANCE_NOT_PLANNED: 'Unplanned balance',
};

// One phase block in the per-SKU chain — Plan vs Actual only (no carry / effective).
const PhaseBlock = ({ phase, theme }) => {
  const planned   = Number(phase.plannedQty || 0);
  const actual    = Number(phase.actualQty || 0);
  const delayDays = Number(phase.delayDays || 0);
  // Cancelled dispatches were reversed out of the plan — exclude them here too.
  const shipments = (phase.actualDispatches || []).filter((d) => !d.cancelled);
  const pct = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : 0;
  const tone = pct >= 100 ? theme.palette.success.main
             : actual > 0 ? theme.palette.warning.main
             : theme.palette.primary.main;
  return (
    <Tooltip
      arrow
      title={(
        <Box>
          <Typography variant="caption" fontWeight={800}>{phase.phaseNo} · {dayjs(phase.plannedDate).format('DD MMM YYYY')}{delayDays > 0 && ` · ${delayDays}d late`}</Typography><br/>
          <Typography variant="caption">Plan {fmt(planned)} · Actual {fmt(actual)}</Typography>
          {shipments.length > 0 && <><br/><Typography variant="caption" fontWeight={700}>Shipped:</Typography></>}
          {shipments.map((d, i) => (
            <React.Fragment key={i}>
              <br/><Typography variant="caption">· {fmt(d.qty)} on {dayjs(d.date).format('DD MMM')}{d.invoiceNo ? ` (Inv ${d.invoiceNo})` : ''}</Typography>
            </React.Fragment>
          ))}
        </Box>
      )}
    >
      <Box sx={{
        flex: '0 0 auto', minWidth: 130, p: 1, mr: 0.75, mb: 0.75,
        borderRadius: '10px',
        border: '1px solid', borderColor: alpha(delayDays > 0 ? theme.palette.error.main : tone, 0.3),
        bgcolor: alpha(tone, 0.05),
      }}>
        <Typography variant="caption" sx={{ fontWeight: 800, color: tone, fontSize: '0.62rem', letterSpacing: '0.06em' }}>
          {phase.phaseNo} · {pct}%
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 800, color: 'text.primary', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
          {fmt(actual)} <Typography component="span" variant="caption" color="text.secondary"> / {fmt(planned)}</Typography>
        </Typography>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.25 }}>
          <Typography variant="caption" color="text.secondary">
            {phase.plannedDate ? dayjs(phase.plannedDate).format('DD MMM') : ''}
          </Typography>
          {delayDays > 0 && (
            <Chip size="small" icon={<Clock size={9} />} label={`${delayDays}d late`}
              sx={{ height: 16, fontSize: '0.55rem', fontWeight: 800, bgcolor: alpha(theme.palette.error.main, 0.10), color: 'error.main', '& .MuiChip-icon': { color: theme.palette.error.main, ml: '3px' } }} />
          )}
        </Stack>
      </Box>
    </Tooltip>
  );
};

const Stat = ({ label, value, color }) => (
  <Box sx={{ textAlign: 'right', minWidth: 70 }}>
    <Typography variant="caption" sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {label}
    </Typography>
    <Typography variant="body2" sx={{ fontWeight: 800, color: color || 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </Typography>
  </Box>
);

const PlanVsActualPanel = ({ comparison }) => {
  const theme = useTheme();
  const rows = comparison?.rows || [];
  const totals = comparison?.totals || {};

  const allDone = rows.length > 0 && totals.balanceQty === 0;

  const flatRisks = useMemo(() => rows.flatMap((r) =>
    (r.risks || []).map((risk) => ({ ...risk, skuCode: r.skuCode, skuName: r.skuName })),
  ), [rows]);

  if (!rows.length) {
    return (
      <Paper sx={{ p: 3, borderRadius: '14px', textAlign: 'center' }}>
        <Activity size={20} color={theme.palette.text.secondary} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          No plan vs actual data yet. Once you add phases and record dispatches, this view becomes live.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ borderRadius: '14px', overflow: 'hidden' }}>
      <Box sx={{
        px: 2.5, py: 1.75,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: '1px solid', borderColor: 'divider',
        bgcolor: alpha(theme.palette.primary.main, 0.03),
      }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Activity size={15} color={theme.palette.primary.main} />
          <Typography variant="subtitle1" fontWeight={800}>Plan vs Actual</Typography>
          {allDone
            ? <Chip size="small" icon={<CheckCircle2 size={11} />} label="Fulfilled" color="success" sx={{ height: 22, fontWeight: 700 }} />
            : <Chip size="small" label={`${totals.fulfillmentPct || 0}% fulfilled`} sx={{ height: 22, fontWeight: 700 }} />}
        </Stack>
        <Stack direction="row" spacing={2}>
          <Stat label="Ordered"    value={fmt(totals.orderQty)} />
          <Stat label="Planned"    value={fmt(totals.plannedQty)} color={theme.palette.primary.main} />
          <Stat label="Actual"     value={fmt(totals.actualQty)} color={theme.palette.success.main} />
          <Stat label="Balance"    value={fmt(totals.balanceQty)} color={totals.balanceQty > 0 ? theme.palette.warning.main : theme.palette.success.main} />
        </Stack>
      </Box>

      {/* Per-SKU strip */}
      <Box sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          {rows.map((row) => {
            const pct = row.orderQty > 0 ? Math.min(100, (row.actualQty / row.orderQty) * 100) : 0;
            const fulfilled = row.balanceQty === 0;
            return (
              <Box key={row.orderItemId || row.skuCode} sx={{
                p: 1.5, borderRadius: '12px',
                bgcolor: alpha(theme.palette.primary.main, 0.02),
                border: '1px solid', borderColor: 'divider',
              }}>
                <Stack direction="row" spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }} flexWrap="wrap" rowGap={1}>
                  <Box sx={{ minWidth: 0, flex: '1 1 200px' }}>
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" fontWeight={800} noWrap>{row.skuName}</Typography>
                      {fulfilled && <CheckCircle2 size={12} color={theme.palette.success.main} />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {row.skuCode} · Order {fmt(row.orderQty)} · Plan {fmt(row.plannedQty)} · Actual {fmt(row.actualQty)} · Balance <strong>{fmt(row.balanceQty)}</strong>
                    </Typography>
                  </Box>
                  <Box sx={{ width: { xs: '100%', sm: 160 } }}>
                    <LinearProgress
                      variant="determinate"
                      value={pct}
                      sx={{
                        height: 6, borderRadius: 999,
                        '& .MuiLinearProgress-bar': {
                          background: `linear-gradient(90deg, ${theme.palette.success.light}, ${theme.palette.success.main})`,
                        },
                      }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {pct.toFixed(0)}% · {(row.risks || []).length ? <span style={{ color: theme.palette.error.main, fontWeight: 700 }}>{(row.risks || []).length} risk</span> : 'Clear'}
                    </Typography>
                  </Box>
                </Stack>
                {row.phases?.length > 0 && (
                  <Box sx={{ mt: 1.25, display: 'flex', flexWrap: 'wrap' }}>
                    {row.phases.map((p, i) => <PhaseBlock key={`${p.phaseNo}-${i}`} phase={p} theme={theme} />)}
                  </Box>
                )}
              </Box>
            );
          })}
        </Stack>

        {flatRisks.length > 0 && (
          <Box sx={{ mt: 2, pt: 2, borderTop: '1px dashed', borderColor: 'divider' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <AlertCircle size={13} color={theme.palette.error.main} />
              <Typography variant="caption" fontWeight={800} color="error.main" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {flatRisks.length} risk{flatRisks.length > 1 ? 's' : ''}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" rowGap={0.75}>
              {flatRisks.slice(0, 8).map((risk, i) => (
                <Chip
                  key={i}
                  size="small"
                  icon={<ArrowRightCircle size={11} />}
                  label={`${RISK_LABEL[risk.type] || risk.type} · ${risk.skuCode} · ${fmt(risk.qty)}`}
                  sx={{ height: 22, fontSize: '0.65rem', fontWeight: 700 }}
                />
              ))}
            </Stack>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default PlanVsActualPanel;
