import React from 'react';
import { Box, Paper, Typography, Stack, LinearProgress, Chip, alpha, useTheme } from '@mui/material';
import { Building2, Calendar, Truck, Hash } from 'lucide-react';
import dayjs from 'dayjs';

const Kpi = ({ label, value, color }) => {
  const theme = useTheme();
  return (
    <Box sx={{
      px: 1.5, py: 1, borderRadius: '10px',
      bgcolor: alpha(color || theme.palette.primary.main, 0.06),
      border: '1px solid', borderColor: alpha(color || theme.palette.primary.main, 0.16),
      minWidth: 110, flex: { xs: '1 1 45%', md: '0 0 auto' },
    }}>
      <Typography sx={{
        fontSize: '0.62rem', fontWeight: 700, color: 'text.secondary',
        textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>{label}</Typography>
      <Typography sx={{
        fontSize: '1.05rem', fontWeight: 800,
        color: color || theme.palette.text.primary,
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

  return (
    <Paper sx={{ p: 2, borderRadius: '14px' }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        justifyContent="space-between"
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" rowGap={0.5}>
            <Typography variant="h6" fontWeight={800} sx={{ color: 'text.primary' }} noWrap>
              {order.soNumber || '—'}
            </Typography>
            <Chip size="small" label={order.status || 'NEW'} sx={{ fontWeight: 700 }} />
            {riskCount > 0 && (
              <Chip size="small" color="error" variant="outlined" label={`${riskCount} risk${riskCount > 1 ? 's' : ''}`} />
            )}
          </Stack>
          <Stack direction="row" spacing={1.5} sx={{ mt: 0.5, color: 'text.secondary', fontSize: '0.8rem', flexWrap: 'wrap', rowGap: 0.5 }}>
            <Stack direction="row" spacing={0.5} alignItems="center"><Building2 size={12} />{order.partyName || '—'}</Stack>
            <Stack direction="row" spacing={0.5} alignItems="center"><Hash size={12} />PO {order.poNumber || '—'}</Stack>
            <Stack direction="row" spacing={0.5} alignItems="center"><Calendar size={12} />{order.orderDate ? dayjs(order.orderDate).format('DD MMM YYYY') : '—'}</Stack>
            {order.place && <Stack direction="row" spacing={0.5} alignItems="center"><Truck size={12} />{order.place}</Stack>}
          </Stack>
        </Box>

        <Stack direction="row" spacing={1.25} flexWrap="wrap" rowGap={1}>
          <Kpi label="Ordered"    value={Number(totals.orderQty || 0).toLocaleString('en-IN')} />
          <Kpi label="Planned"    value={Number(totals.plannedQty || 0).toLocaleString('en-IN')} color={theme.palette.primary.main} />
          <Kpi label="Dispatched" value={Number(totals.dispatchedQty || 0).toLocaleString('en-IN')} color={theme.palette.success.main} />
          <Kpi label="Balance"    value={Number(totals.balanceQty || 0).toLocaleString('en-IN')} color={totals.balanceQty > 0 ? theme.palette.warning.main : theme.palette.success.main} />
        </Stack>
      </Stack>

      <Box sx={{ mt: 2 }}>
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
