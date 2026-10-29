import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Autocomplete, TextField, Button, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, alpha, useTheme, Skeleton,
  ToggleButton, ToggleButtonGroup, Popover, Checkbox, Divider, FormControlLabel,
} from '@mui/material';
import { FileText, Download, CalendarRange, PackageSearch, Zap, CheckCircle2, ArrowRight, ChevronDown } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGetOrdersQuery } from '../../store/api/orderApi';
import { useGetScheduleQuery } from '../../store/api/dispatchControlApi';
import { printDispatchPlanByDate } from '../../utils/printDispatchPlan';
import { useFmsGate, FmsGateBanner, FmsGateDialog } from '../o2d-fms/FmsGate';
import { O2D } from '../o2d-fms/o2dTheme';

const num = (n) => (Number(n || 0)).toLocaleString('en-IN');
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

const STATUS_COLOR = {
  PLANNED: 'default', IN_PROGRESS: 'info', DISPATCHED: 'success', DELAYED: 'warning', CANCELLED: 'error',
};

/**
 * Generate Dispatch Plan PDF
 * --------------------------
 * Pick a Sales Order → its dispatch schedule auto-loads → preview the planned
 * phases on screen → open a branded, print-ready PDF (Save as PDF / download).
 * Route: /dispatch-planning/generate-pdf
 */
const GenerateDispatchPlanPdf = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // FMS task context — set when the doer arrived here via "Do it now" on the
  // dispatch-plan step.
  const fromTask = params.get('fromTask');
  const fromStep = params.get('fromStep');
  const fromAction = params.get('fromAction'); // which connected action this was for
  const soFromTask = params.get('so') || '';
  const cameFromTask = !!(fromTask && fromStep);

  const [order, setOrder] = useState(null);
  const [audience, setAudience] = useState('client'); // 'client' | 'internal'
  // Period scope for the export — a set of months (multi-select) OR a free date
  // range. Empty months + empty range = the whole plan ("All months").
  const [periodMode, setPeriodMode] = useState('months'); // 'months' | 'range'
  const [selectedMonths, setSelectedMonths] = useState([]); // ['YYYY-MM', …] — empty = all
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [periodEl, setPeriodEl] = useState(null); // period Popover anchor
  const { data: ordersRes, isFetching: loadingOrders } = useGetOrdersQuery({ limit: 500, sort: '-orderDate' });
  const orders = useMemo(() => ordersRes?.data || [], [ordersRes]);

  // ?so=… names the order (set by a task's "Do it now" AND by the Step Board's
  // Plan PDF button) → auto-select it once orders load, however we got here.
  useEffect(() => {
    if (order || !soFromTask || !orders.length) return;
    const match = orders.find((o) => o.soNumber === soFromTask);
    if (match) setOrder(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soFromTask, orders]);

  // Return to the FMS step that sent us here. ?entryDone=1 auto-ticks its checklist
  // so the doer only reviews & submits — that's what records it in the FMS Tracker.
  const backToTask = () => {
    if (!cameFromTask) return;
    // Carry doneAction so the task marks THIS action done → it flips to "Do again".
    const q = new URLSearchParams({ entryDone: '1' });
    if (fromAction) q.set('doneAction', fromAction);
    // Replace this page: Back from the step must not land here again (it would
    // generate the PDF once more and come straight back — a loop).
    navigate(`/o2d-fms/task/${fromTask}/${encodeURIComponent(fromStep)}?${q.toString()}`, { replace: true });
  };

  const soNumber = order?.soNumber || null;
  const gate = useFmsGate({ soNumber, action: 'DISPATCH_PLAN_PDF' });
  const [gateOpen, setGateOpen] = useState(false);
  const { data: schedRes, isFetching: loadingSched, isError } = useGetScheduleQuery(soNumber, { skip: !soNumber });
  const schedule = schedRes?.data || null;

  // The month checkboxes ALWAYS list January–December (of every year the plan
  // touches, else the current year), whether or not a month has dispatches — the
  // client picks freely; an empty month just exports an empty plan. Each option
  // also carries its planned-qty so months with a plan are marked.
  const monthOptions = useMemo(() => {
    const totals = new Map(); // 'YYYY-MM' → planned qty
    let minYear = null; let maxYear = null;
    (schedule?.items || []).forEach((it) => (it.phases || []).forEach((ph) => {
      if (!ph.plannedDate) return;
      const d = dayjs(ph.plannedDate);
      const ym = d.format('YYYY-MM');
      totals.set(ym, (totals.get(ym) || 0) + Number(ph.plannedQty || 0));
      const y = d.year();
      minYear = minYear === null ? y : Math.min(minYear, y);
      maxYear = maxYear === null ? y : Math.max(maxYear, y);
    }));
    if (minYear === null) { minYear = dayjs().year(); maxYear = minYear; }
    const out = [];
    for (let y = minYear; y <= maxYear; y += 1) {
      for (let mo = 0; mo < 12; mo += 1) {
        const ym = `${y}-${String(mo + 1).padStart(2, '0')}`;
        out.push({ value: ym, label: dayjs(`${ym}-01`).format('MMMM YYYY'), planned: totals.get(ym) || 0 });
      }
    }
    return out;
  }, [schedule]);

  // A newly picked order resets the period scope back to the whole plan.
  useEffect(() => { setPeriodMode('months'); setSelectedMonths([]); setRangeFrom(''); setRangeTo(''); }, [soNumber]);

  // "All" = no month ticked AND no date bound → the entire plan.
  const isAllScope = (periodMode === 'months' && selectedMonths.length === 0)
    || (periodMode === 'range' && !rangeFrom && !rangeTo);

  // The plan actually exported/previewed — the whole schedule, or only the phases
  // that fall in the chosen months / date range. Items with nothing in scope are
  // dropped so a scoped PDF shows only what ships in that window.
  const filteredSchedule = useMemo(() => {
    if (!schedule) return null;
    if (isAllScope) return schedule;
    const within = (plannedDate) => {
      if (!plannedDate) return false;
      const d = dayjs(plannedDate);
      if (periodMode === 'range') {
        if (rangeFrom && d.isBefore(dayjs(rangeFrom), 'day')) return false;
        if (rangeTo && d.isAfter(dayjs(rangeTo), 'day')) return false;
        return true;
      }
      return selectedMonths.includes(d.format('YYYY-MM'));
    };
    const items = (schedule.items || [])
      .map((it) => ({ ...it, phases: (it.phases || []).filter((ph) => within(ph.plannedDate)) }))
      .filter((it) => (it.phases || []).length > 0);
    return { ...schedule, items };
  }, [schedule, isAllScope, periodMode, rangeFrom, rangeTo, selectedMonths]);

  // Human summary of the current scope — button label, preview chip, PDF subtitle.
  const periodSummary = useMemo(() => {
    if (isAllScope) return 'All months';
    if (periodMode === 'range') {
      const f = rangeFrom ? dayjs(rangeFrom).format('DD MMM YYYY') : 'Start';
      const t = rangeTo ? dayjs(rangeTo).format('DD MMM YYYY') : 'End';
      return `${f} – ${t}`;
    }
    if (selectedMonths.length === 1) return dayjs(`${selectedMonths[0]}-01`).format('MMMM YYYY');
    return `${selectedMonths.length} months`;
  }, [isAllScope, periodMode, rangeFrom, rangeTo, selectedMonths]);

  const toggleMonth = (ym) => setSelectedMonths((prev) => (prev.includes(ym) ? prev.filter((m) => m !== ym) : [...prev, ym]));
  const clearPeriod = () => { setSelectedMonths([]); setRangeFrom(''); setRangeTo(''); };

  const phaseRows = useMemo(() => {
    const rows = [];
    (filteredSchedule?.items || []).forEach((it) => {
      const phases = (it.phases || []).slice().sort((a, b) => (a.phaseNo > b.phaseNo ? 1 : -1));
      if (!phases.length) rows.push({ it, phase: null });
      else phases.forEach((ph, i) => rows.push({ it, phase: ph, first: i === 0 }));
    });
    return rows;
  }, [filteredSchedule]);

  const totalPlanned = useMemo(
    () => (filteredSchedule?.items || []).reduce((s, it) => s + (it.phases || []).reduce((p, ph) => p + Number(ph.plannedQty || 0), 0), 0),
    [filteredSchedule],
  );

  // The order has a plan at all (any month) vs. the current filter actually has rows.
  const hasPlan = schedule && (schedule.items || []).length > 0;
  const hasFilteredPlan = filteredSchedule && (filteredSchedule.items || []).length > 0;

  const handleDownload = () => {
    if (gate.blocked) { setGateOpen(true); return; }
    if (!hasFilteredPlan) {
      enqueueSnackbar(isAllScope
        ? 'No dispatch plan to export for this order yet.'
        : `No dispatches planned for ${periodSummary}.`, { variant: 'warning' });
      return;
    }
    // The schedule's denormalised party/SO/PO can be blank — fall back to the
    // selected order so the PDF header is always populated. We export the FILTERED
    // schedule so a chosen period yields a scoped plan; "All months" is unchanged.
    const ctx = {
      ...filteredSchedule,
      partyName: filteredSchedule.partyName || order?.partyName || '',
      soNumber: filteredSchedule.soNumber || order?.soNumber || '',
      poNumber: filteredSchedule.poNumber || order?.poNumber || '',
      poDate: filteredSchedule.poDate || order?.poDate || null,
    };
    const ok = printDispatchPlanByDate(ctx, {
      variant: audience,
      periodLabel: isAllScope ? '' : periodSummary,
    });
    if (ok) enqueueSnackbar('Dispatch plan opened — print or Save as PDF from the new tab.', { variant: 'success' });
    return ok;
  };

  // Auto-open the plan PDF once the schedule for the task's order has loaded.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!cameFromTask || autoOpenedRef.current || !hasPlan || loadingSched || gate.blocked) return;
    autoOpenedRef.current = true;
    handleDownload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameFromTask, hasPlan, loadingSched]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: O2D.canvas }}>
      {/* Flush warm top bar — matches the O2D design system */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 5, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}`, px: { xs: 1.5, md: 2 }, py: 1 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ width: 30, height: 30, borderRadius: '6px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: alpha(O2D.brand, 0.1), color: O2D.brand }}>
            <FileText size={16} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: O2D.ink, fontSize: { xs: '1rem', md: '1.1rem' }, fontWeight: 800, lineHeight: 1.2 }}>
              Generate Dispatch Plan PDF
            </Typography>
            <Typography noWrap sx={{ color: O2D.sub, fontSize: '0.72rem' }}>
              Pick an order — its dispatch schedule auto-fills. Preview &amp; download a professional plan PDF.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.25, md: 1.75 }, py: 1.5, pb: 6, maxWidth: 1240, mx: 'auto' }}>
        {gate.blocked && <FmsGateBanner gate={gate.gate} onOpen={() => setGateOpen(true)} />}
        {/* Came from an FMS step — the plan PDF opens automatically; this banner
            brings the doer straight back to the step to submit. */}
        {cameFromTask && (
          <Paper elevation={0} sx={{
            p: { xs: 1.25, md: 1.5 }, borderRadius: '8px', mb: 1.5, display: 'flex', alignItems: 'center',
            gap: 1.25, flexWrap: 'wrap',
            bgcolor: O2D.surfaceAlt,
            border: `1px solid ${alpha(O2D.brand, 0.3)}`,
          }}>
            <Box sx={{ p: 0.85, borderRadius: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main', display: 'flex', flexShrink: 0 }}>
              <Zap size={16} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 200 }}>
              <Typography sx={{ fontWeight: 800, color: 'primary.dark', fontSize: '0.86rem', lineHeight: 1.2 }}>
                Generate Dispatch Plan{soFromTask ? ` — ${soFromTask}` : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.72rem' }}>
                The plan PDF opens in a new tab — review it, then “Back to task” to mark the step done.
              </Typography>
            </Box>
            <Button size="small" variant="contained" endIcon={<ArrowRight size={14} />} startIcon={<CheckCircle2 size={14} />}
              onClick={backToTask} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
              Back to task
            </Button>
          </Paper>
        )}

        {/* Order picker */}
        <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', mb: 1.5, border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <Autocomplete
              sx={{ flex: 1, minWidth: 260 }}
              options={orders}
              loading={loadingOrders}
              value={order}
              onChange={(_, v) => setOrder(v)}
              getOptionLabel={(o) => (o ? `${o.soNumber} — ${o.partyName} (PO ${o.poNumber || '—'})` : '')}
              isOptionEqualToValue={(a, b) => a._id === b._id}
              renderInput={(p) => <TextField {...p} label="Select Sales Order / PO" placeholder="Search SO / PO / party…" size="small" />}
            />
            {/* Period scope — export the whole plan, any set of months, or a custom
                date range (e.g. share only August, or 17–31 Aug, with the party). */}
            <Button
              variant="outlined" size="small" onClick={(e) => setPeriodEl(e.currentTarget)} disabled={!hasPlan}
              startIcon={<CalendarRange size={15} />} endIcon={<ChevronDown size={15} />}
              sx={{ minWidth: 190, justifyContent: 'space-between', textTransform: 'none', fontWeight: 700,
                color: O2D.body, borderColor: O2D.line, whiteSpace: 'nowrap', bgcolor: O2D.surface, '&:hover': { borderColor: O2D.line, bgcolor: O2D.surfaceAlt } }}
            >
              {periodSummary}
            </Button>
            <Popover
              open={Boolean(periodEl)} anchorEl={periodEl} onClose={() => setPeriodEl(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              transformOrigin={{ vertical: 'top', horizontal: 'left' }}
              PaperProps={{ sx: { p: 1.5, width: 300, borderRadius: '10px', border: `1px solid ${O2D.line}` } }}
            >
              <ToggleButtonGroup size="small" exclusive fullWidth value={periodMode} onChange={(_, v) => v && setPeriodMode(v)} sx={{ mb: 1.25 }}>
                <ToggleButton value="months" sx={{ textTransform: 'none', fontWeight: 700 }}>By month</ToggleButton>
                <ToggleButton value="range" sx={{ textTransform: 'none', fontWeight: 700 }}>Date range</ToggleButton>
              </ToggleButtonGroup>

              {periodMode === 'months' ? (
                <Box>
                  <FormControlLabel
                    sx={{ ml: 0, display: 'flex' }}
                    control={<Checkbox size="small" checked={selectedMonths.length === 0} onChange={() => setSelectedMonths([])} sx={{ py: 0.25 }} />}
                    label={<Typography sx={{ fontSize: '0.82rem', fontWeight: 700 }}>All months</Typography>}
                  />
                  <Divider sx={{ my: 0.5 }} />
                  <Box sx={{ maxHeight: 240, overflowY: 'auto' }}>
                    {monthOptions.map((m) => (
                      <FormControlLabel key={m.value}
                        sx={{ ml: 0, mr: 0, width: '100%', '& .MuiFormControlLabel-label': { flex: 1 } }}
                        control={<Checkbox size="small" checked={selectedMonths.includes(m.value)} onChange={() => toggleMonth(m.value)} sx={{ py: 0.25 }} />}
                        label={(
                          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ flex: 1 }}>
                            <Typography sx={{ fontSize: '0.82rem', fontWeight: m.planned ? 700 : 400, color: m.planned ? O2D.ink : O2D.sub }}>{m.label}</Typography>
                            {m.planned > 0
                              ? <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: O2D.brand, whiteSpace: 'nowrap' }}>{num(m.planned)} pcs</Typography>
                              : <Typography sx={{ fontSize: '0.62rem', color: O2D.faint }}>—</Typography>}
                          </Stack>
                        )}
                      />
                    ))}
                  </Box>
                  <Typography sx={{ fontSize: '0.66rem', color: O2D.faint, mt: 0.5 }}>
                    Tick any months (Jan–Dec). Months with a plan show their quantity; an empty month simply exports an empty plan — use “Date range” for an exact window.
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={1.25}>
                  <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
                  <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
                  <Typography sx={{ fontSize: '0.66rem', color: O2D.faint }}>Leave a field blank for open-ended (everything before / after).</Typography>
                </Stack>
              )}

              <Divider sx={{ my: 1 }} />
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Button size="small" onClick={clearPeriod} sx={{ textTransform: 'none', fontWeight: 700 }}>Clear</Button>
                <Button size="small" variant="contained" onClick={() => setPeriodEl(null)} sx={{ textTransform: 'none', fontWeight: 700 }}>Done</Button>
              </Stack>
            </Popover>
            <ToggleButtonGroup
              size="small" exclusive value={audience}
              onChange={(_, v) => v && setAudience(v)}
              aria-label="PDF audience"
            >
              <ToggleButton value="client" sx={{ textTransform: 'none', fontWeight: 700, px: 1.5 }}>Client</ToggleButton>
              <ToggleButton value="internal" sx={{ textTransform: 'none', fontWeight: 700, px: 1.5 }}>Internal</ToggleButton>
            </ToggleButtonGroup>
            <Button
              variant="contained" startIcon={<Download size={16} />}
              onClick={handleDownload} disabled={!hasFilteredPlan || gate.blocked}
              sx={{ fontWeight: 700, px: 3, whiteSpace: 'nowrap' }}
            >
              Open / Download PDF
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Same dispatch-plan template, two versions: <b>Client</b> — item names only (to share). &nbsp;·&nbsp; <b>Internal</b> — item names + SKU codes (to keep).
            &nbsp;·&nbsp; Use <b>Period</b> to share a scope — one or more <b>months</b> or a custom <b>date range</b>; <b>All months</b> exports the full plan. The emailed copy always stays the full plan.
          </Typography>
        </Paper>

        {/* States */}
        {!order && (
          <Paper elevation={0} sx={{ p: 6, textAlign: 'center', borderRadius: '8px', color: 'text.disabled', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
            <PackageSearch size={34} style={{ opacity: 0.4, marginBottom: 8 }} />
            <Typography sx={{ fontWeight: 700 }}>Choose an order to begin</Typography>
            <Typography sx={{ fontSize: '0.85rem' }}>Its dispatch plan will load here for preview & PDF export.</Typography>
          </Paper>
        )}

        {order && loadingSched && <Skeleton variant="rounded" height={280} sx={{ borderRadius: '8px' }} />}

        {order && !loadingSched && !hasPlan && (
          <Paper elevation={0} sx={{ p: 5, textAlign: 'center', borderRadius: '8px', color: 'text.secondary', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
            <CalendarRange size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
            <Typography sx={{ fontWeight: 700 }}>No dispatch plan found for {order.soNumber}</Typography>
            <Typography sx={{ fontSize: '0.85rem' }}>
              {isError ? 'Could not load the schedule.' : 'Create the schedule in Dispatch Planning first, then come back to export it.'}
            </Typography>
          </Paper>
        )}

        {/* Scope chosen but nothing ships in it */}
        {hasPlan && !hasFilteredPlan && (
          <Paper elevation={0} sx={{ p: 5, textAlign: 'center', borderRadius: '8px', color: 'text.secondary', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
            <CalendarRange size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
            <Typography sx={{ fontWeight: 700 }}>No dispatches planned for {periodSummary}</Typography>
            <Typography sx={{ fontSize: '0.85rem' }}>Pick a different period, or choose “All months” to export the full plan.</Typography>
          </Paper>
        )}

        {/* Preview */}
        {hasFilteredPlan && (
          <Paper elevation={0} sx={{ borderRadius: '8px', overflow: 'hidden', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
            <Box sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${O2D.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }} noWrap>{schedule.partyName || order?.partyName || '—'}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.72rem' }}>
                  {schedule.soNumber || order?.soNumber || '—'}{(schedule.poNumber || order?.poNumber) ? ` · PO ${schedule.poNumber || order?.poNumber}` : ''} · {(filteredSchedule.items || []).length} SKU(s)
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                {!isAllScope && (
                  <Chip size="small" icon={<CalendarRange size={13} />} label={periodSummary} sx={{ fontWeight: 700, fontSize: '0.72rem', bgcolor: alpha(O2D.brand, 0.1), color: O2D.brand, '& .MuiChip-icon': { color: O2D.brand } }} />
                )}
                <Chip size="small" label={`Total planned: ${num(totalPlanned)}`} sx={{ fontWeight: 700, fontSize: '0.72rem', bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.dark }} />
              </Stack>
            </Box>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{
                minWidth: 720,
                '& td, & th': { fontSize: '0.76rem', py: 0.6, px: 1.25, borderColor: O2D.lineSoft }, '& tbody tr:hover': { bgcolor: O2D.surfaceAlt },
              }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: O2D.surfaceAlt }}>
                    {['Item', 'PO Qty', 'To Plan', 'Dispatch', 'Planned Date', 'Planned Qty'].map((h, i) => (
                      <TableCell key={h} align={[1, 2, 5].includes(i) ? 'right' : 'left'}
                        sx={{ fontWeight: 700, fontSize: '0.64rem !important', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'text.secondary', whiteSpace: 'nowrap' }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {phaseRows.map((r, i) => {
                    const isNewSku = r.first || !r.phase;
                    const span = r.phase ? (r.it.phases || []).length : 1;
                    return (
                      <TableRow key={i} hover sx={{ '& td': { borderTop: isNewSku && i > 0 ? `1px solid ${theme.palette.divider}` : 'none' } }}>
                        {isNewSku ? (
                          <>
                            <TableCell rowSpan={span} sx={{ verticalAlign: 'top', borderRight: `1px solid ${alpha(theme.palette.divider, 0.7)}` }}>
                              <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: '0.74rem', color: theme.palette.primary.dark, lineHeight: 1.3 }}>{r.it.skuCode}</Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.66rem' }}>{r.it.skuName}</Typography>
                            </TableCell>
                            <TableCell align="right" rowSpan={span} sx={{ verticalAlign: 'top', fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>{num(r.it.poQty)}</TableCell>
                            <TableCell align="right" rowSpan={span} sx={{ verticalAlign: 'top', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: Number(r.it.balanceQty) > 0 ? theme.palette.warning.dark : 'text.primary' }}>{num(r.it.balanceQty)}</TableCell>
                          </>
                        ) : null}
                        <TableCell>{r.phase ? <Chip size="small" label={r.phase.phaseNo} sx={{ fontWeight: 700, height: 18, fontSize: '0.6rem', bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.dark }} /> : <Typography variant="caption" color="text.disabled">—</Typography>}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{r.phase ? fmtDate(r.phase.plannedDate) : <Typography variant="caption" color="text.disabled">no plan</Typography>}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: theme.palette.primary.dark }}>{r.phase ? num(r.phase.plannedQty) : '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        )}
      </Box>
      <FmsGateDialog gate={gate.gate} open={gateOpen} onClose={() => setGateOpen(false)} />
    </Box>
  );
};

export default GenerateDispatchPlanPdf;
