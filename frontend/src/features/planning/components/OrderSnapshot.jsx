import React from 'react';
import { Box, Paper, Typography, Stack, LinearProgress, Chip, alpha, useTheme } from '@mui/material';
import { Building2, Calendar, Truck, Hash } from 'lucide-react';
import dayjs from 'dayjs';

// Aligned KPI tile — square corners, fills its grid cell so the row stays even.
const Kpi = ({ label, value, color, solid = false }) => {
  const theme = useTheme();
  const c = color || theme.palette.primary.main;
  return (
    <Box sx={{
      px: 1, py: 0.85, borderRadius: '6px', minWidth: 0,
      bgcolor: solid ? c : alpha(c, 0.05),
      border: '1px solid', borderColor: solid ? c : alpha(c, 0.16),
    }}>
      <Typography noWrap sx={{
        fontSize: '0.55rem', fontWeight: 800,
        color: solid ? alpha('#fff', 0.92) : 'text.secondary',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>{label}</Typography>
      <Typography noWrap sx={{
        fontSize: '1rem', fontWeight: 800, lineHeight: 1.2,
        color: solid ? '#fff' : (color || theme.palette.text.primary),
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</Typography>
    </Box>
  );
};

const OrderSnapshot = ({ schedule, comparison }) => {
  const theme = useTheme();
  const order = schedule?.order || {};
  const totals = schedule?.totals || {};
  const riskCount = comparison?.totals?.riskCount || 0;
  const fulfilment = totals.fulfilmentPct ?? 0;
  const coverage   = totals.planCoveragePct ?? 0;
  // Unplanned = ordered qty that has NOT yet been placed into any dispatch phase.
  // Backend exposes this as totals.unplannedBalanceQty; fall back to a local calc.
  const unplannedQty = totals.unplannedBalanceQty != null
    ? Number(totals.unplannedBalanceQty)
    : Math.max(0, Number(totals.orderQty || 0) - Number(totals.plannedQty || 0));
  // Planned MORE than ordered — the case the client flagged (planned 14,000 on a
  // 5,000 order). Shown as its own tile so the mismatch is impossible to miss.
  const overPlannedQty = Math.max(0, Number(totals.plannedQty || 0) - Number(totals.orderQty || 0));
  // Balance now follows the PLAN, not the sales order: planned minus dispatched.
  // So an order planned above its SO quantity still shows the real work left.
  const planBalanceQty = totals.planBalanceQty != null
    ? Number(totals.planBalanceQty)
    : Math.max(0, Number(totals.plannedQty || 0) - Number(totals.dispatchedQty ?? totals.actualQty ?? 0));

  return (
    <Paper elevation={0} sx={{ p: 2, borderRadius: '8px', border: '1px solid', borderColor: 'divider' }}>
      {/* Identity row */}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" rowGap={0.5}>
        <Typography variant="h6" fontWeight={800} sx={{ color: 'text.primary', fontSize: '1.05rem' }} noWrap>
          {order.soNumber || '—'}
        </Typography>
        <Chip size="small" label={order.status || 'NEW'} sx={{ fontWeight: 700, height: 20, fontSize: '0.66rem', borderRadius: '4px' }} />
        {riskCount > 0 && (
          <Chip size="small" color="error" variant="outlined" label={`${riskCount} risk${riskCount > 1 ? 's' : ''}`} sx={{ height: 20, fontSize: '0.66rem', borderRadius: '4px' }} />
        )}
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ mt: 0.5, color: 'text.secondary', fontSize: '0.78rem', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Stack direction="row" spacing={0.5} alignItems="center"><Building2 size={12} />{order.partyName || '—'}</Stack>
        <Stack direction="row" spacing={0.5} alignItems="center"><Hash size={12} />PO {order.poNumber || '—'}</Stack>
        <Stack direction="row" spacing={0.5} alignItems="center"><Calendar size={12} />{order.orderDate ? dayjs(order.orderDate).format('DD MMM YYYY') : '—'}</Stack>
        {order.place && <Stack direction="row" spacing={0.5} alignItems="center"><Truck size={12} />{order.place}</Stack>}
      </Stack>

      {/* KPI grid — always an even, aligned row (wraps cleanly on narrow widths) */}
      <Box sx={{ mt: 1.5, display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(6, 1fr)' }, gap: 0.75 }}>
        <Kpi label="Ordered"    value={Number(totals.orderQty || 0).toLocaleString('en-IN')} />
        <Kpi label="Planned"    value={Number(totals.plannedQty || 0).toLocaleString('en-IN')} color={theme.palette.primary.main} />
        <Kpi label="Unplanned"  value={Number(unplannedQty).toLocaleString('en-IN')} color={unplannedQty > 0 ? theme.palette.warning.main : theme.palette.success.main} />
        <Kpi label="Dispatched" value={Number(totals.dispatchedQty || 0).toLocaleString('en-IN')} color={theme.palette.success.main} />
        <Kpi label="Balance"    value={Number(planBalanceQty).toLocaleString('en-IN')} color={planBalanceQty > 0 ? theme.palette.warning.main : theme.palette.success.main} />
        <Kpi
          label="Over Planned"
          value={Number(overPlannedQty).toLocaleString('en-IN')}
          color={overPlannedQty > 0 ? theme.palette.error.main : theme.palette.success.main}
          solid={overPlannedQty > 0}
        />
      </Box>

      <Box sx={{ mt: 1.75 }}>
        <Stack direction="row" spacing={2} justifyContent="space-between" sx={{ mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
            Plan Coverage {coverage}% · Fulfilment {fulfilment}%
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {Number(totals.dispatchedQty || 0).toLocaleString('en-IN')} / {Number(totals.orderQty || 0).toLocaleString('en-IN')}
          </Typography>
        </Stack>
        <Box sx={{ position: 'relative', height: 8, borderRadius: 999, bgcolor: alpha(theme.palette.primary.main, 0.08), overflow: 'hidden' }}>
          {/* coverage (plan) */}
          <Box sx={{
            position: 'absolute', inset: 0,
            width: `${Math.min(100, coverage)}%`,
            bgcolor: alpha(theme.palette.primary.main, 0.25),
          }} />
          {/* fulfilment (actual) */}
          <Box sx={{
            position: 'absolute', inset: 0,
            width: `${Math.min(100, fulfilment)}%`,
            background: `linear-gradient(90deg, ${theme.palette.success.light}, ${theme.palette.success.main})`,
          }} />
        </Box>
      </Box>
    </Paper>
  );
};

export default OrderSnapshot;
