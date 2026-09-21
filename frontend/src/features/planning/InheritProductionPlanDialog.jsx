import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, IconButton, Stack, TextField, Tooltip, Typography, alpha,
} from '@mui/material';
import {
  Factory, X, AlertTriangle, CheckCircle2, CalendarDays, ArrowRight, RotateCcw, Info, History,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useSnackbar } from 'notistack';
import {
  usePreviewInheritPlanQuery,
  useApplyInheritPlanMutation,
} from '../../store/api/dispatchControlApi';
import { O2D, O2D_TIP } from '../o2d-fms/o2dTheme';

const BRAND = '#1d4ed8';
const NAVY = '#0b2545';
const OK = '#0f766e';
const WARN = '#b45309';
const BAD = '#be123c';
const PAST = '#64748b';

const num = (v) => Number(v || 0).toLocaleString('en-IN');

/**
 * Spread each SKU's outstanding need across the SELECTED plan dates,
 * earliest-first, capped by each date's free capacity.
 *
 * Runs on every tick of a checkbox, so the planner sees the split change live.
 * Deliberately client-side: the server hands over capacity, not a decision.
 */
function allocate(plans, needs, selectedIds) {
  const left = new Map(needs.map((n) => [n.orderItemId, n.need]));
  const out = new Map();

  plans
    .filter((p) => selectedIds.includes(p.planId))
    .forEach((plan) => {
      const lines = [];
      plan.items.forEach((item) => {
        const remaining = left.get(item.orderItemId);
        if (!remaining || remaining <= 0) return;
        const give = Math.min(item.free, remaining);
        if (give <= 0) return;
        left.set(item.orderItemId, remaining - give);
        // `capacity` keeps the plan's own figure; `plannedQty` becomes the
        // amount this order takes, so the row can show both.
        lines.push({ ...item, capacity: item.plannedQty, plannedQty: give });
      });
      if (lines.length) out.set(plan.planId, lines);
    });

  return { byPlan: out, shortfall: left };
}

/**
 * "You already have a production plan for this party — inherit it?"
 *
 * Shows EVERY plan date for the party. Future dates are ticked by default; past
 * dates are shown faded and unticked (the stock exists, but you cannot promise a
 * dispatch on a day that has gone) — tick one deliberately to draw on it.
 */
export default function InheritProductionPlanDialog({ open, soNumber, onClose, onApplied }) {
  const { enqueueSnackbar } = useSnackbar();
  const { data: res, isFetching } = usePreviewInheritPlanQuery(soNumber, {
    skip: !open || !soNumber,
    refetchOnMountOrArgChange: true,
  });
  const [applyInherit, { isLoading: applying }] = useApplyInheritPlanMutation();

  const preview = res?.data || res || null;
  const plans = useMemo(() => preview?.plans || [], [preview]);
  const needs = useMemo(() => preview?.needs || [], [preview]);

  const [selected, setSelected] = useState([]);
  const [edits, setEdits] = useState({});          // `${planId}:${orderItemId}` -> string

  const defaultSelection = useMemo(
    () => plans.filter((p) => !p.isPast && p.freeTotal > 0).map((p) => p.planId),
    [plans],
  );

  useEffect(() => {
    if (!open) return;
    setSelected(defaultSelection);
    setEdits({});
  }, [open, defaultSelection]);

  const { byPlan } = useMemo(
    () => allocate(plans, needs, selected),
    [plans, needs, selected],
  );

  const qtyOf = (planId, line) => {
    const k = `${planId}:${line.orderItemId}`;
    return edits[k] !== undefined ? edits[k] : String(line.plannedQty);
  };
  const setQty = (planId, orderItemId, v) => setEdits((p) => ({ ...p, [`${planId}:${orderItemId}`]: v }));

  const toggle = (planId) => setSelected((prev) => (
    prev.includes(planId) ? prev.filter((x) => x !== planId) : [...prev, planId]
  ));

  // Final numbers = the suggestion, overridden by anything the planner typed.
  const finalDays = useMemo(() => plans
    .filter((p) => selected.includes(p.planId) && byPlan.has(p.planId))
    .map((p) => ({
      planId: p.planId,
      planNo: p.planNo,
      plannedDate: p.plannedDate,
      lines: byPlan.get(p.planId)
        .map((l) => ({ ...l, plannedQty: Number(qtyOf(p.planId, l)) || 0 }))
        .filter((l) => l.plannedQty > 0),
    }))
    .filter((d) => d.lines.length), [plans, selected, byPlan, edits]);

  const totalChosen = finalDays.reduce((s, d) => s + d.lines.reduce((t, l) => t + l.plannedQty, 0), 0);

  // Per-SKU coverage against what the order still needs — this is what tells the
  // planner the production plan is short before they commit.
  const coverage = useMemo(() => needs.map((n) => {
    const got = finalDays.reduce((s, d) => s + d.lines
      .filter((l) => l.orderItemId === n.orderItemId)
      .reduce((t, l) => t + l.plannedQty, 0), 0);
    return { ...n, allocated: got, short: Math.max(0, n.need - got), over: Math.max(0, got - n.need) };
  }), [needs, finalDays]);

  const shortTotal = coverage.reduce((s, c) => s + c.short, 0);
  const overTotal = coverage.reduce((s, c) => s + c.over, 0);
  const overCapacity = finalDays.flatMap((d) => d.lines.filter((l) => l.plannedQty > l.free));

  const handleApply = async () => {
    if (!finalDays.length) return enqueueSnackbar('Tick at least one date to inherit.', { variant: 'warning' });
    try {
      const out = await applyInherit({
        soNumber,
        days: finalDays.map((d) => ({
          planId: d.planId,
          planNo: d.planNo,
          plannedDate: d.plannedDate,
          allowOverPlan: overTotal > 0,
          lines: d.lines.map((l) => ({
            orderItemId: l.orderItemId,
            skuId: l.skuId,
            skuCode: l.skuCode,
            skuName: l.skuName,
            plannedQty: l.plannedQty,
          })),
        })),
      }).unwrap();
      const data = out?.data || out;
      const sf = data?.shortfalls || [];
      enqueueSnackbar(
        sf.length
          ? `${data.phases.length} phase(s) created, but some plan capacity had already been taken — re-check the plan.`
          : `${data.phases.length} phase(s) created from the production plan.`,
        { variant: sf.length ? 'warning' : 'success' },
      );
      onApplied?.();
      onClose?.();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not inherit the production plan.', { variant: 'error' });
    }
  };

  const nothing = !isFetching && preview && !plans.length;

  return (
    <Dialog open={open} onClose={applying ? undefined : onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { borderRadius: '12px', border: `1px solid ${O2D.line}`, height: '88vh' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25, pb: 1.25 }}>
        <Box sx={{
          width: 34, height: 34, borderRadius: 1.5, display: 'grid', placeItems: 'center',
          bgcolor: alpha(BRAND, 0.1), color: BRAND, border: `1px solid ${alpha(BRAND, 0.2)}`,
        }}>
          <Factory size={18} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.2 }}>
            Inherit from the production plan
          </Typography>
          <Typography noWrap sx={{ fontSize: '0.74rem', color: O2D.sub, fontWeight: 600 }}>
            {preview?.partyName ? `${preview.partyName} · ` : ''}{soNumber}
            {preview?.poNumber ? ` · PO ${preview.poNumber}` : ''}
          </Typography>
        </Box>
        <Tooltip arrow slotProps={O2D_TIP} title="Reset ticks and quantities">
          <span>
            <IconButton size="small" disabled={applying || isFetching}
              onClick={() => { setSelected(defaultSelection); setEdits({}); }}>
              <RotateCcw size={15} />
            </IconButton>
          </span>
        </Tooltip>
        <IconButton size="small" onClick={onClose} disabled={applying}><X size={16} /></IconButton>
      </DialogTitle>
      <Divider />

      <DialogContent sx={{ bgcolor: O2D.surfaceAlt, pt: 2 }}>
        {isFetching && (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress size={24} />
            <Typography sx={{ mt: 1.5, fontSize: '0.82rem', color: O2D.sub }}>Reading the production plan…</Typography>
          </Stack>
        )}

        {nothing && (
          <Stack alignItems="center" sx={{ py: 5, px: 3, textAlign: 'center' }}>
            <Info size={26} color={O2D.faint} />
            <Typography sx={{ mt: 1.5, fontSize: '0.88rem', fontWeight: 700, color: O2D.ink }}>
              No production plan covers this order
            </Typography>
            <Typography sx={{ mt: 0.5, fontSize: '0.78rem', color: O2D.sub, maxWidth: 420 }}>
              This party has no open plan for these SKUs. Add phases manually instead.
            </Typography>
          </Stack>
        )}

        {!isFetching && plans.length > 0 && (
          <>
            <Box sx={{
              mb: 1.75, px: 1.25, py: 0.9, borderRadius: '8px',
              bgcolor: alpha(BRAND, 0.06), border: `1px solid ${alpha(BRAND, 0.2)}`,
            }}>
              <Typography sx={{ fontSize: '0.74rem', color: O2D.body, fontWeight: 600 }}>
                Every planned date for this party is listed. <b>Future dates are ticked</b>; past dates
                are shown faded and unticked — the stock was made, so tick one if you still want to draw
                on it. The split fills <b>earliest ticked date first</b> and every number stays editable.
              </Typography>
            </Box>

            <Stack spacing={1.25}>
              {plans.map((p) => {
                const on = selected.includes(p.planId);
                const lines = byPlan.get(p.planId) || [];
                const dayTotal = lines.reduce((s, l) => s + (Number(qtyOf(p.planId, l)) || 0), 0);
                const tone = p.isPast ? PAST : BRAND;
                return (
                  <Box key={p.planId} sx={{
                    borderRadius: '10px', overflow: 'hidden', bgcolor: O2D.surface,
                    border: `1px solid ${on ? alpha(tone, 0.32) : O2D.line}`,
                    opacity: on ? 1 : 0.62,
                  }}>
                    <Stack direction="row" alignItems="center" spacing={0.75}
                      sx={{ px: 1, py: 0.9, bgcolor: alpha(tone, on ? 0.07 : 0.02) }}>
                      <Checkbox
                        size="small" checked={on} onChange={() => toggle(p.planId)}
                        disabled={p.freeTotal <= 0}
                        sx={{ p: 0.5 }}
                      />
                      <CalendarDays size={15} color={tone} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" alignItems="center" spacing={0.75}>
                          <Typography sx={{ fontSize: '0.86rem', fontWeight: 800, color: p.isPast ? PAST : NAVY }}>
                            {dayjs(p.plannedDate).format('DD MMM YYYY')}
                          </Typography>
                          {p.isPast && (
                            <Tooltip arrow slotProps={O2D_TIP}
                              title="This date has passed. The production was planned for it, so the stock exists — tick it only if you intend to dispatch that stock.">
                              <Chip size="small" icon={<History size={10} />} label="Past"
                                sx={{ height: 18, fontSize: '0.58rem', fontWeight: 800, bgcolor: alpha(PAST, 0.12), color: PAST, '& .MuiChip-icon': { color: 'inherit' } }} />
                            </Tooltip>
                          )}
                          {p.consumedTotal > 0 && (
                            <Chip size="small" label={`${num(p.consumedTotal)} already used`}
                              sx={{ height: 18, fontSize: '0.58rem', fontWeight: 800, bgcolor: alpha('#7c3aed', 0.12), color: '#7c3aed' }} />
                          )}
                        </Stack>
                        <Typography sx={{ fontSize: '0.66rem', color: O2D.sub, fontWeight: 600 }}>
                          {p.planNo} · {num(p.freeTotal)} pcs free of {num(p.plannedTotal)} planned
                        </Typography>
                      </Box>
                      {on && (
                        <Chip size="small" label={`${num(dayTotal)} pcs`}
                          sx={{ height: 22, fontWeight: 800, fontSize: '0.7rem', bgcolor: alpha(tone, 0.12), color: tone }} />
                      )}
                    </Stack>

                    {on && lines.length > 0 && (
                      <Stack spacing={0.75} sx={{ px: 1.5, py: 1.25 }}>
                        {lines.map((l) => {
                          const v = qtyOf(p.planId, l);
                          const over = Number(v || 0) > l.free;
                          return (
                            <Stack key={l.orderItemId} direction="row" alignItems="center" spacing={1}>
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink }}>
                                  {l.skuName}
                                </Typography>
                                <Typography sx={{ fontSize: '0.64rem', color: O2D.sub }}>
                                  plan {num(l.capacity)} · used {num(l.consumedQty)} · free {num(l.free)}
                                </Typography>
                              </Box>
                              <TextField
                                size="small" type="number" value={v}
                                onChange={(e) => setQty(p.planId, l.orderItemId, e.target.value)}
                                error={over}
                                helperText={over ? `over free (${num(l.free)})` : ''}
                                inputProps={{ style: { textAlign: 'right', fontWeight: 700 }, min: 0 }}
                                sx={{ width: 130, '& .MuiFormHelperText-root': { m: 0, fontSize: '0.6rem' } }}
                              />
                            </Stack>
                          );
                        })}
                      </Stack>
                    )}

                    {on && !lines.length && (
                      <Typography sx={{ px: 1.5, py: 1, fontSize: '0.72rem', color: O2D.faint }}>
                        Nothing left for this order to take from this date.
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Stack>

            {/* Coverage — the answer to "does my plan actually cover this PO?" */}
            <Box sx={{ mt: 1.75, px: 1.25, py: 1, borderRadius: '8px', bgcolor: O2D.surface, border: `1px solid ${O2D.line}` }}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: O2D.sub, mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Coverage against this order
              </Typography>
              <Stack spacing={0.4}>
                {coverage.map((c) => (
                  <Stack key={c.orderItemId} direction="row" alignItems="center" spacing={1}>
                    <Typography noWrap sx={{ flex: 1, fontSize: '0.74rem', fontWeight: 700, color: O2D.ink }}>{c.skuName}</Typography>
                    <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, fontVariantNumeric: 'tabular-nums' }}>
                      need {num(c.need)} · taking {num(c.allocated)}
                    </Typography>
                    {c.short > 0
                      ? <Chip size="small" label={`short ${num(c.short)}`} sx={{ height: 19, fontSize: '0.6rem', fontWeight: 800, bgcolor: alpha(WARN, 0.14), color: WARN }} />
                      : <Chip size="small" label="covered" sx={{ height: 19, fontSize: '0.6rem', fontWeight: 800, bgcolor: alpha(OK, 0.14), color: OK }} />}
                  </Stack>
                ))}
              </Stack>
            </Box>

            {shortTotal > 0 && (
              <Box sx={{ mt: 1.25, px: 1.25, py: 1, borderRadius: '8px', bgcolor: alpha(WARN, 0.08), border: `1px solid ${alpha(WARN, 0.3)}` }}>
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <AlertTriangle size={14} color={WARN} />
                  <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: WARN }}>
                    The production plan is <b>{num(shortTotal)} pcs short</b> of this order. Tick a past
                    date to use stock already made, or add the remaining phases by hand after this.
                  </Typography>
                </Stack>
              </Box>
            )}

            {overTotal > 0 && (
              <Box sx={{ mt: 1.25, px: 1.25, py: 1, borderRadius: '8px', bgcolor: alpha(BAD, 0.07), border: `1px solid ${alpha(BAD, 0.28)}` }}>
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <AlertTriangle size={14} color={BAD} />
                  <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: BAD }}>
                    You are planning <b>{num(overTotal)} pcs more</b> than this order needs. That is allowed,
                    but Plan vs Actual will show it as over-planned.
                  </Typography>
                </Stack>
              </Box>
            )}
          </>
        )}
      </DialogContent>

      <Divider />
      <DialogActions sx={{ px: 2, py: 1.25, gap: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mr: 'auto', pl: 0.5 }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: O2D.ink }}>
            {finalDays.length} date{finalDays.length === 1 ? '' : 's'} · {num(totalChosen)} pcs
          </Typography>
          {overCapacity.length > 0 && (
            <Chip size="small" icon={<AlertTriangle size={12} />} label={`${overCapacity.length} over free capacity`}
              sx={{ height: 22, fontWeight: 800, fontSize: '0.66rem', bgcolor: alpha(BAD, 0.1), color: BAD, '& .MuiChip-icon': { color: 'inherit' } }} />
          )}
        </Stack>
        <Button onClick={onClose} disabled={applying} sx={{ fontWeight: 700, textTransform: 'none' }}>Cancel</Button>
        <Button
          variant="contained" onClick={handleApply}
          disabled={applying || isFetching || !finalDays.length}
          startIcon={applying ? <CircularProgress size={14} color="inherit" /> : <CheckCircle2 size={15} />}
          endIcon={!applying ? <ArrowRight size={14} /> : null}
          sx={{ fontWeight: 800, textTransform: 'none', borderRadius: '8px', boxShadow: 'none' }}
        >
          {applying ? 'Creating…' : `Create ${finalDays.length} phase${finalDays.length === 1 ? '' : 's'}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
