import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Stack, TextField, Button,
  Typography, IconButton, Switch, FormControlLabel, alpha, useTheme, CircularProgress,
} from '@mui/material';
import { X, Calendar, Save } from 'lucide-react';
import dayjs from 'dayjs';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

// Remaining to plan for a SKU = orderQty − sum(plannedQty across existing phases).
// The server provides this as scheduleItem.unplannedBalanceQty. Simple, client-clear:
// each new phase just plans whatever is still left — no carry-in / effective maths.
const remainingOf = (item) => Math.max(0, Number(item.unplannedBalanceQty || 0));

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
  // Default "Plan this phase" = the remaining balance for that SKU.
  useEffect(() => {
    if (!open) return;
    setPlannedDate(dayjs().add(7, 'day').format('YYYY-MM-DD'));
    setNotes('');
    setAllowOverPlan(false);
    setAutoFill(true);
    setLines(scheduleItems.map((it) => {
      const remaining = remainingOf(it);
      return {
        scheduleItemId: it.scheduleItemId,
        orderItemId: it.scheduleItemId,
        skuCode: it.skuCode,
        skuName: it.skuName,
        orderQty: it.orderQty,
        remaining,
        plannedQty: remaining,
      };
    }));
  }, [open, scheduleItems]);

  // Apply prefill suggestion (overrides only the matching SKU) — e.g. from Risk Rail.
  useEffect(() => {
    if (!open || !prefillFor) return;
    setLines((prev) => prev.map((l) => (
      l.skuCode === prefillFor.skuCode ? { ...l, plannedQty: prefillFor.qty } : l
    )));
  }, [open, prefillFor]);

  const totalPlan = useMemo(() => lines.reduce((s, l) => s + Number(l.plannedQty || 0), 0), [lines]);

  const handleAutoFillToggle = (next) => {
    setAutoFill(next);
    if (next) setLines((prev) => prev.map((l) => ({ ...l, plannedQty: l.remaining })));
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

  // Over-plan = planning more than what's still remaining for that SKU.
  const anyOverPlan = lines.some((l) => Number(l.plannedQty || 0) > Number(l.remaining || 0));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
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
            <Typography variant="caption" color="text.secondary">Plan how much of the remaining quantity ships in this phase</Typography>
          </Box>
        </Stack>
        <IconButton onClick={onClose} size="small"><X size={16} /></IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: '24px !important' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mt: 0.5, mb: 2 }}>
          <TextField
            label="Planned date"
            type="date"
            size="small"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: { xs: '100%', sm: 190 } }}
          />
          <TextField
            label="Notes (optional)"
            size="small"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. dispatch only after MD approval"
            sx={{ flex: 1, minWidth: 200 }}
          />
          <FormControlLabel
            sx={{ m: 0, whiteSpace: 'nowrap' }}
            control={<Switch size="small" checked={autoFill} onChange={(_, v) => handleAutoFillToggle(v)} />}
            label={<Typography variant="caption" fontWeight={700}>Auto-fill remaining</Typography>}
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
              display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.3fr',
              px: 1.5, py: 1, bgcolor: alpha(theme.palette.primary.main, 0.04),
              fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              <Box>SKU</Box>
              <Box sx={{ textAlign: 'right' }}>Ordered</Box>
              <Box sx={{ textAlign: 'right' }}>Remaining</Box>
              <Box sx={{ textAlign: 'right' }}>Plan this phase</Box>
            </Box>
            {lines.map((l, idx) => {
              const entered = Number(l.plannedQty || 0);
              const isOver = entered > Number(l.remaining || 0);
              // Remaining ticks DOWN live as you type the plan — order 120, plan 60
              // ⇒ 60 left — and turns green once this SKU is fully planned (0 left).
              const liveRemaining = Math.max(0, Number(l.remaining || 0) - entered);
              return (
                <Box key={l.scheduleItemId || l.skuCode} sx={{
                  display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.3fr',
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
                  <Typography sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: liveRemaining > 0 ? 'warning.main' : 'success.main' }}>
                    {fmt(liveRemaining)}
                  </Typography>
                  <TextField
                    size="small"
                    type="number"
                    value={l.plannedQty}
                    onChange={(e) => updateLine(idx, e.target.value)}
                    inputProps={{ style: { textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }, min: 0 }}
                    error={isOver && !allowOverPlan}
                    helperText={isOver && !allowOverPlan ? 'more than remaining' : ''}
                    sx={{ '& .MuiFormHelperText-root': { m: 0, fontSize: '0.6rem', textAlign: 'right' } }}
                  />
                </Box>
              );
            })}
          </Box>
        )}

        <Stack direction="row" spacing={2} justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Total planned this phase: <strong style={{ color: theme.palette.primary.main, fontVariantNumeric: 'tabular-nums' }}>{fmt(totalPlan)}</strong> pcs
          </Typography>
          {anyOverPlan && (
            <FormControlLabel
              control={<Switch size="small" checked={allowOverPlan} onChange={(_, v) => setAllowOverPlan(v)} />}
              label={<Typography variant="caption" color="warning.main" fontWeight={700}>Allow over-plan</Typography>}
            />
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={isSaving || totalPlan <= 0}
          startIcon={isSaving ? <CircularProgress size={14} color="inherit" /> : <Save size={14} />}
        >
          Create Phase
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddPhaseDialog;
