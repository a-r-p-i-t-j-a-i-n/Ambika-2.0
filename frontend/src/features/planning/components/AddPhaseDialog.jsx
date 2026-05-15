import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Stack, TextField, Button,
  Typography, IconButton, Switch, FormControlLabel, alpha, useTheme, CircularProgress, Tooltip,
} from '@mui/material';
import { X, Calendar, Wand2, Save, Info } from 'lucide-react';
import dayjs from 'dayjs';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

// Carry-in is provided by the server via scheduleItem.runningCarryQty.
// Unplanned balance = orderQty − sum(plannedQty across existing phases).
// Suggested plan for this new phase per SKU = unplannedBalance + max(0, carryIn).
const suggestedPlanForSku = (item) => {
  const balance = Number(item.unplannedBalanceQty || 0);
  const carry = Number(item.runningCarryQty || 0);
  return Math.max(0, balance + Math.max(0, carry));
};

const SignedDelta = ({ value, theme }) => {
  const n = Number(value || 0);
  if (n === 0) return <Typography variant="caption" color="text.disabled" sx={{ fontVariantNumeric: 'tabular-nums' }}>—</Typography>;
  const isShort = n > 0;
  const color = isShort ? theme.palette.error.main : theme.palette.success.main;
  return (
    <Typography
      variant="body2"
      sx={{ fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}
      title={isShort ? 'Short — should be made up here' : 'Surplus — can reduce this phase'}
    >
      {isShort ? '+' : '−'}{fmt(Math.abs(n))}
    </Typography>
  );
};

const AddPhaseDialog = ({
  open,
  onClose,
  scheduleItems = [],
  onSubmit,
  isSaving = false,
  prefillFor = null,        // optional { skuCode, qty } from carry-forward
}) => {
  const theme = useTheme();
  const [plannedDate, setPlannedDate] = useState(dayjs().add(7, 'day').format('YYYY-MM-DD'));
  const [notes, setNotes] = useState('');
  const [allowOverPlan, setAllowOverPlan] = useState(false);
  const [autoFill, setAutoFill] = useState(true);
  const [lines, setLines] = useState([]);

  // Initialise lines whenever the dialog opens (or upstream items change).
  useEffect(() => {
    if (!open) return;
    setPlannedDate(dayjs().add(7, 'day').format('YYYY-MM-DD'));
    setNotes('');
    setAllowOverPlan(false);
    setAutoFill(true);
    setLines(scheduleItems.map((it) => ({
      scheduleItemId: it.scheduleItemId,
      orderItemId: it.scheduleItemId,
      skuCode: it.skuCode,
      skuName: it.skuName,
      orderQty: it.orderQty,
      unplannedBalanceQty: Number(it.unplannedBalanceQty || 0),
      runningCarryQty: Number(it.runningCarryQty || 0),
      suggested: suggestedPlanForSku(it),
      plannedQty: suggestedPlanForSku(it),
    })));
  }, [open, scheduleItems]);

  // Apply prefill suggestion (overrides only the matching SKU) — e.g. from Risk Rail.
  useEffect(() => {
    if (!open || !prefillFor) return;
    setLines((prev) => prev.map((l) => (
      l.skuCode === prefillFor.skuCode ? { ...l, plannedQty: prefillFor.qty } : l
    )));
  }, [open, prefillFor]);

  const totals = useMemo(() => lines.reduce((acc, l) => {
    acc.plan += Number(l.plannedQty || 0);
    acc.carry += Number(l.runningCarryQty || 0);
    acc.effective += Math.max(0, Number(l.plannedQty || 0) + Number(l.runningCarryQty || 0));
    return acc;
  }, { plan: 0, carry: 0, effective: 0 }), [lines]);

  const handleAutoFillToggle = (next) => {
    setAutoFill(next);
    if (next) setLines((prev) => prev.map((l) => ({ ...l, plannedQty: l.suggested })));
  };

  const updateLine = (idx, plannedQty) => {
    setAutoFill(false);
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, plannedQty } : l)));
  };

  const handleSubmit = () => {
    const payloadLines = lines
      .filter((l) => Number(l.plannedQty) > 0)
      .map((l) => ({
        orderItemId: l.scheduleItemId,    // server normalises via SKU code anyway
        skuCode: l.skuCode,
        skuName: l.skuName,
        plannedQty: Number(l.plannedQty),
      }));
    onSubmit?.({
      plannedDate,
      notes: notes.trim() || null,
      autoFillFromBalance: autoFill && !payloadLines.length,
      allowOverPlan,
      lines: payloadLines,
    });
  };

  const anyOverPlan = lines.some((l) => Number(l.plannedQty || 0) > Number(l.unplannedBalanceQty || 0) + Math.max(0, Number(l.runningCarryQty || 0)));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{
            width: 32, height: 32, borderRadius: '10px',
            background: `linear-gradient(135deg, ${theme.palette.primary.light}, ${theme.palette.primary.dark})`,
            color: 'common.white', display: 'grid', placeItems: 'center',
          }}>
            <Calendar size={14} />
          </Box>
          <Box>
            <Typography variant="subtitle1" fontWeight={800}>Add Dispatch Phase</Typography>
            <Typography variant="caption" color="text.secondary">Carry-in from prior phases auto-included</Typography>
          </Box>
        </Stack>
        <IconButton onClick={onClose} size="small"><X size={16} /></IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 2.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
          <TextField
            label="Planned date *"
            type="date"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 180 }}
          />
          <TextField
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. dispatch only after MD approval"
            sx={{ flex: 1, minWidth: 200 }}
          />
          <FormControlLabel
            control={<Switch size="small" checked={autoFill} onChange={(_, v) => handleAutoFillToggle(v)} />}
            label={<Typography variant="caption" fontWeight={700}>Auto = balance + carry</Typography>}
          />
        </Stack>

        {/* Empty-state when the order has no SKUs at all */}
        {lines.length === 0 ? (
          <Box sx={{
            p: 3, textAlign: 'center', border: '1px dashed', borderColor: 'divider', borderRadius: '12px',
            color: 'text.secondary',
          }}>
            <Typography variant="body2">This order has no SKU lines yet. Add SKUs to the order before planning a dispatch.</Typography>
          </Box>
        ) : (
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '12px', overflow: 'hidden' }}>
            <Box sx={{
              display: 'grid', gridTemplateColumns: '1.8fr 0.8fr 0.85fr 0.85fr 1fr 0.95fr',
              px: 1.5, py: 1, bgcolor: alpha(theme.palette.primary.main, 0.04),
              fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              <Box>SKU</Box>
              <Box sx={{ textAlign: 'right' }}>Order</Box>
              <Box sx={{ textAlign: 'right' }}>Unplanned</Box>
              <Box sx={{ textAlign: 'right' }}>Carry-in</Box>
              <Box sx={{ textAlign: 'right' }}>Plan this phase</Box>
              <Box sx={{ textAlign: 'right' }}>Effective</Box>
            </Box>
            {lines.map((l, idx) => {
              const carry = Number(l.runningCarryQty || 0);
              const entered = Number(l.plannedQty || 0);
              const effective = Math.max(0, entered + carry);
              const headroom = Number(l.unplannedBalanceQty || 0) + Math.max(0, carry);
              const isOver = entered > headroom;
              return (
                <Box key={l.scheduleItemId || l.skuCode} sx={{
                  display: 'grid', gridTemplateColumns: '1.8fr 0.8fr 0.85fr 0.85fr 1fr 0.95fr',
                  px: 1.5, py: 1, alignItems: 'center',
                  borderTop: '1px solid', borderColor: 'divider',
                }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} noWrap>{l.skuName}</Typography>
                    <Typography variant="caption" color="text.secondary">{l.skuCode}</Typography>
                  </Box>
                  <Typography sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {fmt(l.orderQty)}
                  </Typography>
                  <Typography sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: l.unplannedBalanceQty > 0 ? 'warning.main' : 'success.main' }}>
                    {fmt(l.unplannedBalanceQty)}
                  </Typography>
                  <Box sx={{ textAlign: 'right' }}>
                    <SignedDelta value={carry} theme={theme} />
                  </Box>
                  <TextField
                    size="small"
                    type="number"
                    value={l.plannedQty}
                    onChange={(e) => updateLine(idx, e.target.value)}
                    inputProps={{ style: { textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }, min: 0 }}
                    error={isOver && !allowOverPlan}
                  />
                  <Tooltip arrow title="Plan + Carry-in. This is what should actually leave the dock this phase.">
                    <Typography sx={{
                      textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                      color: carry !== 0 ? 'warning.dark' : 'text.primary',
                    }}>
                      {fmt(effective)}
                    </Typography>
                  </Tooltip>
                </Box>
              );
            })}
          </Box>
        )}

        <Stack direction="row" spacing={2} justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
          <Stack direction="row" spacing={2}>
            <Typography variant="caption" color="text.secondary">
              Total plan: <strong style={{ color: theme.palette.primary.main, fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.plan)}</strong>
            </Typography>
            {totals.carry !== 0 && (
              <Typography variant="caption" color="text.secondary">
                Carry-in: <strong style={{ color: totals.carry > 0 ? theme.palette.error.main : theme.palette.success.main, fontVariantNumeric: 'tabular-nums' }}>
                  {totals.carry > 0 ? '+' : '−'}{fmt(Math.abs(totals.carry))}
                </strong>
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              Effective: <strong style={{ color: theme.palette.warning.dark, fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.effective)}</strong>
            </Typography>
          </Stack>
          {anyOverPlan && (
            <FormControlLabel
              control={<Switch size="small" checked={allowOverPlan} onChange={(_, v) => setAllowOverPlan(v)} />}
              label={<Typography variant="caption" color="warning.main" fontWeight={700}>Allow over-plan</Typography>}
            />
          )}
        </Stack>

        <Box sx={{
          mt: 1.5, p: 1, borderRadius: '10px',
          bgcolor: alpha(theme.palette.info.main, 0.04),
          border: `1px dashed ${alpha(theme.palette.info.main, 0.2)}`,
          display: 'flex', gap: 1, alignItems: 'flex-start',
        }}>
          <Info size={14} color={theme.palette.info.main} style={{ marginTop: 2 }} />
          <Typography variant="caption" color="text.secondary">
            <strong>Carry-in</strong> is the running short / surplus from earlier phases of the same SKU.
            <strong> +red</strong> means earlier dispatches fell short and this phase should make it up; <strong>−green</strong> means earlier dispatches over-shipped and this phase can reduce by that much.
          </Typography>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={isSaving || totals.plan <= 0}
          startIcon={isSaving ? <CircularProgress size={14} color="inherit" /> : <Save size={14} />}
        >
          Create Phase
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddPhaseDialog;
