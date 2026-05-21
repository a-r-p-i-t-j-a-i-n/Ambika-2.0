import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Typography, Stack, Chip, IconButton, Tooltip, TextField, Button,
  Collapse, alpha, useTheme, CircularProgress, Menu, MenuItem,
} from '@mui/material';
import { ChevronDown, ChevronUp, Edit3, Trash2, Save, X, MoreVertical, Wand2, ArrowDownRight } from 'lucide-react';
import dayjs from 'dayjs';

const STATUS_STYLE = (theme, status) => ({
  PLANNED:     { bg: alpha(theme.palette.primary.main, 0.08), fg: theme.palette.primary.main, label: 'Planned' },
  IN_PROGRESS: { bg: alpha(theme.palette.warning.main, 0.10), fg: theme.palette.warning.main, label: 'In Progress' },
  DISPATCHED:  { bg: alpha(theme.palette.success.main, 0.10), fg: theme.palette.success.main, label: 'Dispatched' },
  DELAYED:     { bg: alpha(theme.palette.error.main, 0.10),   fg: theme.palette.error.main,   label: 'Delayed' },
  CANCELLED:   { bg: alpha(theme.palette.text.disabled, 0.10),fg: theme.palette.text.disabled,label: 'Cancelled' },
}[status] || { bg: alpha(theme.palette.primary.main, 0.08), fg: theme.palette.primary.main, label: status });

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

// Render a small signed delta — "+50" red (short), "−50" green (surplus), "—" muted.
const SignedDelta = ({ value, theme, dim = false }) => {
  const n = Number(value || 0);
  if (n === 0) return <Typography variant="caption" color="text.disabled" sx={{ fontVariantNumeric: 'tabular-nums' }}>—</Typography>;
  const isShort = n > 0;
  const color = dim ? theme.palette.text.secondary : (isShort ? theme.palette.error.main : theme.palette.success.main);
  return (
    <Typography
      variant="body2"
      sx={{ fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}
      title={isShort ? 'Short — must be made up in next phase' : 'Surplus — can reduce next phase'}
    >
      {isShort ? '+' : '−'}{fmt(Math.abs(n))}
    </Typography>
  );
};

// A "phase" in the UI is the bucket of all per-SKU phases sharing the same phaseNo.
const PhaseCard = ({
  phaseNo,
  items = [],                // [{ scheduleItemId, skuCode, skuName, orderQty, phaseRow }]
  plannedDate,
  status,
  defaultOpen = false,
  isSaving = false,
  onSave,                    // ({ plannedDate, status, notes, lines }) => void
  onDelete,                  // () => void
}) => {
  const theme = useTheme();
  const style = STATUS_STYLE(theme, status);
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [draftDate, setDraftDate] = useState(plannedDate ? dayjs(plannedDate).format('YYYY-MM-DD') : '');
  const [draftStatus, setDraftStatus] = useState(status || 'PLANNED');
  const [draftLines, setDraftLines] = useState(() => items.map((it) => ({
    orderItemId: it.orderItemId,
    skuCode: it.skuCode,
    skuName: it.skuName,
    plannedQty: it.phaseRow?.plannedQty ?? 0,
  })));
  const [menuAnchor, setMenuAnchor] = useState(null);

  // Open automatically when the page deep-links to this phase (?phase=P1).
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);

  useEffect(() => {
    setDraftDate(plannedDate ? dayjs(plannedDate).format('YYYY-MM-DD') : '');
    setDraftStatus(status || 'PLANNED');
    setDraftLines(items.map((it) => ({
      orderItemId: it.orderItemId,
      skuCode: it.skuCode,
      skuName: it.skuName,
      plannedQty: it.phaseRow?.plannedQty ?? 0,
    })));
  }, [items, plannedDate, status, editing]);

  // Aggregate totals using *effective* numbers so the doer sees the carry-aware truth.
  const totals = useMemo(() => items.reduce((acc, it) => {
    acc.planned   += Number(it.phaseRow?.plannedQty || 0);
    acc.carryIn   += Number(it.phaseRow?.carryInQty || 0);
    acc.effective += Number(it.phaseRow?.effectivePlannedQty || 0);
    acc.actual    += Number(it.phaseRow?.actualQty || 0);
    acc.variance  += Number(it.phaseRow?.varianceQty || 0);
    return acc;
  }, { planned: 0, carryIn: 0, effective: 0, actual: 0, variance: 0 }), [items]);

  const draftPlanned = useMemo(() => draftLines.reduce((s, l) => s + Number(l.plannedQty || 0), 0), [draftLines]);

  const updateDraftLine = (idx, plannedQty) => {
    setDraftLines((prev) => prev.map((l, i) => (i === idx ? { ...l, plannedQty } : l)));
  };

  // Auto-fill: fill plannedQty so this phase clears whatever short carry-in came in.
  // If a SKU already has a carryIn of 50 (short), we suggest plannedQty=50; if surplus, we suggest 0.
  const autoFillFromCarry = () => {
    setDraftLines((prev) => prev.map((l, i) => {
      const row = items[i].phaseRow;
      const carry = Number(row?.carryInQty || 0);
      // If carry-in is positive (short), plan to make it up; if negative (surplus), plan 0 (let surplus absorb).
      return { ...l, plannedQty: Math.max(0, carry) };
    }));
  };

  const handleSubmit = () => {
    onSave?.({
      plannedDate: draftDate,
      status: draftStatus,
      lines: draftLines
        .filter((l) => Number(l.plannedQty) >= 0 && l.skuCode)
        .map((l) => ({ orderItemId: l.orderItemId, skuCode: l.skuCode, skuName: l.skuName, plannedQty: Number(l.plannedQty || 0) })),
    });
    setEditing(false);
  };

  const fulfilmentPct = totals.effective > 0 ? Math.round((totals.actual / totals.effective) * 100) : 0;
  const hasCarry = totals.carryIn !== 0;

  return (
    <Paper sx={{ borderRadius: '14px', overflow: 'hidden' }}>
      {/* Header bar */}
      <Box sx={{
        px: 2, py: 1.25,
        display: 'flex', alignItems: 'center', gap: 1.5,
        bgcolor: alpha(style.fg, 0.04),
        borderBottom: open ? '1px solid' : 'none', borderColor: 'divider',
      }}>
        <Box sx={{
          width: 36, height: 36, borderRadius: '10px',
          bgcolor: alpha(style.fg, 0.10), color: style.fg,
          display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: '0.85rem',
        }}>{phaseNo}</Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" rowGap={0.5}>
            <Typography variant="subtitle1" fontWeight={800} color="text.primary">
              {plannedDate ? dayjs(plannedDate).format('DD MMM YYYY') : 'No date'}
            </Typography>
            <Chip
              size="small"
              label={style.label}
              sx={{ bgcolor: style.bg, color: style.fg, fontWeight: 700, border: `1px solid ${alpha(style.fg, 0.18)}` }}
            />
            <Chip size="small" variant="outlined" label={`${items.length} SKU${items.length > 1 ? 's' : ''}`} />
            {hasCarry && (
              <Tooltip arrow title={totals.carryIn > 0 ? `Brought ${fmt(totals.carryIn)} short qty into this phase` : `Brought ${fmt(Math.abs(totals.carryIn))} surplus qty into this phase`}>
                <Chip
                  size="small"
                  icon={<ArrowDownRight size={11} />}
                  label={`Carry-in ${totals.carryIn > 0 ? '+' : '−'}${fmt(Math.abs(totals.carryIn))}`}
                  sx={{
                    bgcolor: alpha(totals.carryIn > 0 ? theme.palette.error.main : theme.palette.success.main, 0.10),
                    color: totals.carryIn > 0 ? 'error.main' : 'success.main',
                    fontWeight: 700, height: 22,
                  }}
                />
              </Tooltip>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            Plan {fmt(totals.planned)}
            {hasCarry && <> · Carry {totals.carryIn > 0 ? '+' : '−'}{fmt(Math.abs(totals.carryIn))}</>}
            {' · '}<strong style={{ color: theme.palette.primary.main }}>Effective {fmt(totals.effective)}</strong>
            {' · Actual '}<strong style={{ color: theme.palette.success.main }}>{fmt(totals.actual)}</strong>
            {' · '}{fulfilmentPct}%
          </Typography>
        </Box>

        {!editing && (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Edit phase"><IconButton size="small" onClick={() => { setOpen(true); setEditing(true); }}><Edit3 size={14} /></IconButton></Tooltip>
            <IconButton size="small" onClick={(e) => setMenuAnchor(e.currentTarget)}><MoreVertical size={14} /></IconButton>
            <Menu open={Boolean(menuAnchor)} anchorEl={menuAnchor} onClose={() => setMenuAnchor(null)}>
              <MenuItem onClick={() => { setMenuAnchor(null); onDelete?.(); }} sx={{ color: 'error.main', gap: 1 }}>
                <Trash2 size={14} /> {totals.actual > 0 ? 'Cancel phase' : 'Delete phase'}
              </MenuItem>
            </Menu>
            <IconButton size="small" onClick={() => setOpen((v) => !v)}>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</IconButton>
          </Stack>
        )}
      </Box>

      <Collapse in={open}>
        <Box sx={{ p: 2 }}>
          {editing && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
              <TextField
                size="small"
                type="date"
                label="Plan date"
                value={draftDate}
                onChange={(e) => setDraftDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 180 }}
              />
              <TextField
                size="small"
                select
                label="Status"
                value={draftStatus}
                onChange={(e) => setDraftStatus(e.target.value)}
                SelectProps={{ native: true }}
                sx={{ minWidth: 150 }}
              >
                {['PLANNED', 'IN_PROGRESS', 'DISPATCHED', 'DELAYED', 'CANCELLED'].map((s) =>
                  <option key={s} value={s}>{s}</option>
                )}
              </TextField>
              <Tooltip arrow title="Set plan to whatever was short-fall'd into this phase">
                <Button size="small" variant="outlined" startIcon={<Wand2 size={13} />} onClick={autoFillFromCarry}>
                  Fill from carry-in
                </Button>
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              <Button size="small" startIcon={<X size={13} />} onClick={() => setEditing(false)}>Cancel</Button>
              <Button
                size="small"
                variant="contained"
                startIcon={isSaving ? <CircularProgress size={13} color="inherit" /> : <Save size={13} />}
                disabled={isSaving}
                onClick={handleSubmit}
              >
                Save phase
              </Button>
            </Stack>
          )}

          {/* Per-SKU table — full carry-forward chain visible */}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(180px, 1.8fr) 0.8fr 0.8fr 1fr 0.95fr 0.95fr 0.95fr',
            gap: 0,
            border: '1px solid', borderColor: 'divider', borderRadius: '12px', overflow: 'hidden',
          }}>
            {/* Header */}
            {['SKU', 'Order', 'Carry-in', 'Plan Qty', 'Effective', 'Actual', 'Carry-out'].map((h, i) => (
              <Box
                key={h}
                sx={{
                  px: 1.25, py: 1, bgcolor: alpha(theme.palette.primary.main, 0.04),
                  fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
                  color: 'text.secondary', letterSpacing: '0.06em',
                  textAlign: i === 0 ? 'left' : 'right',
                }}
              >{h}</Box>
            ))}

            {items.map((it, idx) => {
              const row = it.phaseRow || {};
              const enteredPlan = editing ? Number(draftLines[idx]?.plannedQty || 0) : Number(row.plannedQty || 0);
              const carryIn = Number(row.carryInQty || 0);
              const effective = Math.max(0, enteredPlan + carryIn);
              const actual = Number(row.actualQty || 0);
              const carryOut = row.isClosed
                ? (effective - actual)
                : (editing ? null : Number(row.carryOutQty || 0));
              return (
                <React.Fragment key={(it.scheduleItemId || idx) + (row.phaseId || idx)}>
                  <Box sx={{ px: 1.25, py: 1, borderTop: '1px solid', borderColor: 'divider', minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} color="text.primary" noWrap>{it.skuName}</Typography>
                    <Typography variant="caption" color="text.secondary">{it.skuCode}</Typography>
                  </Box>
                  <Box sx={{ px: 1.25, py: 1, borderTop: '1px solid', borderColor: 'divider', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {fmt(it.orderQty)}
                  </Box>
                  <Box sx={{ px: 1.25, py: 1, borderTop: '1px solid', borderColor: 'divider', textAlign: 'right' }}>
                    <SignedDelta value={carryIn} theme={theme} />
                  </Box>
                  <Box sx={{ px: 1.25, py: 1, borderTop: '1px solid', borderColor: 'divider', textAlign: 'right' }}>
                    {editing ? (
                      <TextField
                        size="small"
                        type="number"
                        value={draftLines[idx]?.plannedQty ?? 0}
                        onChange={(e) => updateDraftLine(idx, e.target.value)}
                        inputProps={{
                          style: { textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
                          min: 0,
                        }}
                        sx={{ width: '100%', minWidth: 90 }}
                      />
                    ) : (
                      <Typography sx={{ fontWeight: 700, color: 'primary.main', fontVariantNumeric: 'tabular-nums' }}>
                        {fmt(row.plannedQty)}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ px: 1.25, py: 1, borderTop: '1px solid', borderColor: 'divider', textAlign: 'right' }}>
                    <Tooltip arrow title="Effective = Plan + Carry-in. This is what should actually ship this phase.">
                      <Typography sx={{
                        fontWeight: 800,
                        fontVariantNumeric: 'tabular-nums',
                        color: carryIn !== 0 ? 'warning.dark' : 'text.primary',
                      }}>
                        {fmt(effective)}
                      </Typography>
                    </Tooltip>
                  </Box>
                  <Box sx={{ px: 1.25, py: 1, borderTop: '1px solid', borderColor: 'divider', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'success.main', fontWeight: 700 }}>
                    {fmt(row.actualQty)}
                  </Box>
                  <Box sx={{ px: 1.25, py: 1, borderTop: '1px solid', borderColor: 'divider', textAlign: 'right' }}>
                    {carryOut === null
                      ? <Typography variant="caption" color="text.disabled">pending</Typography>
                      : <SignedDelta value={carryOut} theme={theme} />}
                  </Box>
                </React.Fragment>
              );
            })}
          </Box>

          {/* Helper line for doers */}
          <Box sx={{
            mt: 1.25, p: 1.25, borderRadius: '10px',
            bgcolor: alpha(theme.palette.info.main, 0.04),
            border: `1px dashed ${alpha(theme.palette.info.main, 0.2)}`,
            fontSize: '0.74rem', color: 'text.secondary',
          }}>
            <strong>How to read this:</strong> Plan + Carry-in = Effective (what must ship).
            After dispatch, <span style={{ color: theme.palette.error.main, fontWeight: 700 }}>+short</span> rolls
            into the next phase as carry-in. <span style={{ color: theme.palette.success.main, fontWeight: 700 }}>−surplus</span> reduces the next phase.
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
};

export default PhaseCard;
