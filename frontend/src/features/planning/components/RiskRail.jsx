import React from 'react';
import { Box, Paper, Typography, Stack, Chip, alpha, useTheme, Tooltip } from '@mui/material';
import { ShieldAlert, ShieldCheck, ArrowRightCircle, AlertTriangle, Clock, TrendingUp } from 'lucide-react';

const RISK_META = {
  OVERDUE_PLAN:        { label: 'Overdue Plan',        icon: Clock,         tone: 'error'   },
  UNPLANNED_DISPATCH:  { label: 'Unplanned Dispatch',  icon: AlertTriangle, tone: 'warning' },
  OVER_DISPATCH:       { label: 'Over-Dispatch',       icon: AlertTriangle, tone: 'error'   },
  BALANCE_NOT_PLANNED: { label: 'Unplanned Balance',   icon: AlertTriangle, tone: 'warning' },
};

const RiskRail = ({ comparison, onCarryForward }) => {
  const theme = useTheme();
  const rows = comparison?.rows || [];
  const totals = comparison?.totals || {};

  const carryForwardRows = rows.filter((r) => Number(r.carryForwardSuggestionQty || 0) > 0);

  // Which SKUs were planned BEYOND what was ordered, and by how much. The header
  // tile gives the one total; this says where it came from, so the planner can go
  // straight to the offending phase instead of hunting for it.
  const overPlannedRows = rows
    .map((r) => ({
      orderItemId: r.orderItemId,
      skuName: r.skuName,
      skuCode: r.skuCode,
      orderQty: Number(r.orderQty || 0),
      plannedQty: Number(r.plannedQty || 0),
      overQty: Math.max(0, Number(r.plannedQty || 0) - Number(r.orderQty || 0)),
    }))
    .filter((r) => r.overQty > 0)
    .sort((a, b) => b.overQty - a.overQty);
  const overPlannedTotal = overPlannedRows.reduce((sum, r) => sum + r.overQty, 0);
  const flatRisks = rows.flatMap((r) =>
    (r.risks || []).map((risk) => ({ ...risk, skuCode: r.skuCode, skuName: r.skuName, orderItemId: r.orderItemId })),
  );

  const allClear = !flatRisks.length && !carryForwardRows.length && !overPlannedRows.length;

  return (
    <Paper elevation={0} sx={{ p: 2, borderRadius: '8px', border: '1px solid', borderColor: 'divider', position: 'sticky', top: 16 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
        {allClear
          ? <ShieldCheck size={14} color={theme.palette.success.main} />
          : <ShieldAlert  size={14} color={theme.palette.error.main} />}
        <Typography variant="subtitle2" fontWeight={800}>
          {/* Over-planned SKUs count as risks here even though the API has no such
              risk type — otherwise the header reads "Risks (0)" on an order that is
              planned at 280% of what was sold, which is exactly what was reported. */}
          {allClear ? 'No risks detected' : `Risks (${flatRisks.length + overPlannedRows.length})`}
        </Typography>
      </Stack>

      {allClear && (
        <Typography variant="caption" color="text.secondary">
          Order is fully covered and on track. Nothing to action.
        </Typography>
      )}

      {flatRisks.length > 0 && (
        <Stack spacing={0.75} sx={{ mb: 2 }}>
          {flatRisks.map((risk, i) => {
            const meta = RISK_META[risk.type] || { label: risk.type, icon: AlertTriangle, tone: 'warning' };
            const palette = theme.palette[meta.tone] || theme.palette.warning;
            const Icon = meta.icon;
            return (
              <Box key={`${risk.type}-${i}`} sx={{
                px: 1, py: 0.75, borderRadius: '6px',
                bgcolor: alpha(palette.main, 0.06),
                border: '1px solid', borderColor: alpha(palette.main, 0.18),
              }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Icon size={13} color={palette.main} />
                  <Typography variant="caption" sx={{ fontWeight: 700, color: palette.main, flex: 1 }}>
                    {meta.label}
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {Number(risk.qty || 0).toLocaleString('en-IN')}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                  {risk.skuName} · {risk.skuCode}
                </Typography>
              </Box>
            );
          })}
        </Stack>
      )}

      {overPlannedRows.length > 0 && (
        <>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.75 }}>
            <TrendingUp size={12} color={theme.palette.error.main} />
            <Typography variant="caption" sx={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'error.main', flex: 1 }}>
              Planned over order
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 800, color: 'error.main', fontVariantNumeric: 'tabular-nums' }}>
              +{overPlannedTotal.toLocaleString('en-IN')}
            </Typography>
          </Stack>
          <Stack spacing={0.75} sx={{ mb: 2 }}>
            {overPlannedRows.map((r) => (
              <Box key={r.orderItemId || r.skuCode} sx={{
                p: 1, borderRadius: '6px',
                bgcolor: alpha(theme.palette.error.main, 0.07),
                border: '1px solid', borderColor: alpha(theme.palette.error.main, 0.28),
              }}>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Typography variant="caption" sx={{ fontWeight: 700, flex: 1 }} noWrap>
                    {r.skuName}
                  </Typography>
                  <Chip
                    size="small"
                    label={`+${r.overQty.toLocaleString('en-IN')}`}
                    sx={{
                      height: 18, borderRadius: '4px', fontSize: '0.64rem', fontWeight: 800,
                      bgcolor: theme.palette.error.main, color: '#fff',
                      '& .MuiChip-label': { px: 0.6 },
                    }}
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, fontVariantNumeric: 'tabular-nums' }}>
                  Planned {r.plannedQty.toLocaleString('en-IN')} vs ordered {r.orderQty.toLocaleString('en-IN')}
                </Typography>
              </Box>
            ))}
          </Stack>
        </>
      )}

      {carryForwardRows.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 0.75, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Plan remaining balance
          </Typography>
          <Stack spacing={0.75}>
            {carryForwardRows.map((r) => (
              <Tooltip key={r.orderItemId} title="Click to create a new phase pre-filled with this balance" arrow>
                <Box
                  onClick={() => onCarryForward?.(r)}
                  sx={{
                    p: 1, borderRadius: '6px', cursor: 'pointer',
                    bgcolor: alpha(theme.palette.primary.main, 0.04),
                    border: '1px dashed', borderColor: alpha(theme.palette.primary.main, 0.3),
                    transition: 'all 160ms',
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.08),
                      borderColor: theme.palette.primary.main,
                    },
                  }}
                >
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <ArrowRightCircle size={13} color={theme.palette.primary.main} />
                    <Typography variant="caption" sx={{ fontWeight: 700, flex: 1 }} noWrap>
                      {r.skuName}
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 800, color: 'primary.main', fontVariantNumeric: 'tabular-nums' }}>
                      +{Number(r.carryForwardSuggestionQty).toLocaleString('en-IN')}
                    </Typography>
                  </Stack>
                </Box>
              </Tooltip>
            ))}
          </Stack>
        </>
      )}

      {Boolean(totals.riskCount || totals.carryForwardQty) && (
        <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px dashed', borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} justifyContent="space-between">
            <Typography variant="caption" color="text.secondary">Achievement</Typography>
            <Typography variant="caption" fontWeight={700}>{totals.planAchievementPct || 0}%</Typography>
          </Stack>
          <Stack direction="row" spacing={1} justifyContent="space-between">
            <Typography variant="caption" color="text.secondary">Fulfilment</Typography>
            <Typography variant="caption" fontWeight={700}>{totals.fulfillmentPct || 0}%</Typography>
          </Stack>
        </Box>
      )}
    </Paper>
  );
};

export default RiskRail;
