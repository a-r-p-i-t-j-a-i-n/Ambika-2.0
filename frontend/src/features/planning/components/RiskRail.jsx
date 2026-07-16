import React from 'react';
import { Box, Paper, Typography, Stack, Chip, alpha, useTheme, Tooltip } from '@mui/material';
import { ShieldAlert, ShieldCheck, ArrowRightCircle, AlertTriangle, Clock } from 'lucide-react';

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
  const flatRisks = rows.flatMap((r) =>
    (r.risks || []).map((risk) => ({ ...risk, skuCode: r.skuCode, skuName: r.skuName, orderItemId: r.orderItemId })),
  );

  const allClear = !flatRisks.length && !carryForwardRows.length;

  return (
    <Paper sx={{ p: 2, borderRadius: '14px', position: 'sticky', top: 16 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
        {allClear
          ? <ShieldCheck size={14} color={theme.palette.success.main} />
          : <ShieldAlert  size={14} color={theme.palette.error.main} />}
        <Typography variant="subtitle2" fontWeight={800}>
          {allClear ? 'No risks detected' : `Risks (${flatRisks.length})`}
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
                px: 1, py: 0.75, borderRadius: '10px',
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
                    p: 1, borderRadius: '10px', cursor: 'pointer',
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
