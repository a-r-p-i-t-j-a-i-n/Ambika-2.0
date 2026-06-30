import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Autocomplete, TextField, Button, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, alpha, useTheme, Skeleton,
} from '@mui/material';
import { FileText, Download, CalendarRange, PackageSearch, Zap, CheckCircle2, ArrowRight } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGetOrdersQuery } from '../../store/api/orderApi';
import { useGetScheduleQuery } from '../../store/api/dispatchControlApi';
import { printDispatchPlan } from '../../utils/printDispatchPlan';
import { useFmsGate, FmsGateBanner, FmsGateDialog } from '../o2d-fms/FmsGate';

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
  const soFromTask = params.get('so') || '';
  const cameFromTask = !!(fromTask && fromStep);

  const [order, setOrder] = useState(null);
  const { data: ordersRes, isFetching: loadingOrders } = useGetOrdersQuery({ limit: 500, sort: '-orderDate' });
  const orders = useMemo(() => ordersRes?.data || [], [ordersRes]);

  // Came from a task → auto-select the order it was raised for, once orders load.
  useEffect(() => {
    if (!cameFromTask || order || !soFromTask || !orders.length) return;
    const match = orders.find((o) => o.soNumber === soFromTask);
    if (match) setOrder(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameFromTask, soFromTask, orders]);

  // Return to the FMS step that sent us here. ?entryDone=1 auto-ticks its checklist
  // so the doer only reviews & submits — that's what records it in the FMS Tracker.
  const backToTask = () => {
    if (!cameFromTask) return;
    navigate(`/o2d-fms/task/${fromTask}/${encodeURIComponent(fromStep)}?entryDone=1`);
  };

  const soNumber = order?.soNumber || null;
  const gate = useFmsGate({ soNumber, action: 'DISPATCH_PLAN_PDF' });
  const [gateOpen, setGateOpen] = useState(false);
  const { data: schedRes, isFetching: loadingSched, isError } = useGetScheduleQuery(soNumber, { skip: !soNumber });
  const schedule = schedRes?.data || null;

  const phaseRows = useMemo(() => {
    const rows = [];
    (schedule?.items || []).forEach((it) => {
      const phases = (it.phases || []).slice().sort((a, b) => (a.phaseNo > b.phaseNo ? 1 : -1));
      if (!phases.length) rows.push({ it, phase: null });
      else phases.forEach((ph, i) => rows.push({ it, phase: ph, first: i === 0 }));
    });
    return rows;
  }, [schedule]);

  const totalPlanned = useMemo(
    () => (schedule?.items || []).reduce((s, it) => s + (it.phases || []).reduce((p, ph) => p + Number(ph.plannedQty || 0), 0), 0),
    [schedule],
  );

  const hasPlan = schedule && (schedule.items || []).length > 0;

  const handleDownload = () => {
    if (gate.blocked) { setGateOpen(true); return; }
    if (!hasPlan) {
      enqueueSnackbar('No dispatch plan to export for this order yet.', { variant: 'warning' });
      return;
    }
    // The schedule's denormalised party/SO/PO can be blank — fall back to the
    // selected order so the PDF header is always populated.
    const ctx = {
      ...schedule,
      partyName: schedule.partyName || order?.partyName || '',
      soNumber: schedule.soNumber || order?.soNumber || '',
      poNumber: schedule.poNumber || order?.poNumber || '',
      poDate: schedule.poDate || order?.poDate || null,
    };
    const ok = printDispatchPlan(ctx);
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
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Hero */}
      <Box sx={{
        color: '#fff', px: { xs: 2.5, md: 3.5 }, pt: { xs: 2.75, md: 3.25 }, pb: { xs: 3.5, md: 4.25 },
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
      }}>
        <Stack direction="row" spacing={1.75} alignItems="center">
          <Box sx={{ width: 42, height: 42, borderRadius: 2, display: 'grid', placeItems: 'center', flexShrink: 0,
            background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
            <FileText size={20} color="#fff" />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: '#fff', fontSize: { xs: '1rem', md: '1.15rem' }, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.15 }}>
              Generate Dispatch Plan PDF
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.75rem', mt: 0.3 }}>
              Pick an order — its dispatch schedule auto-fills. Preview and download a professional plan PDF.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.5, md: 3 }, mt: { xs: -2.5, md: -3 }, position: 'relative', zIndex: 1, pb: 6, maxWidth: 1240, mx: 'auto' }}>
        {gate.blocked && <FmsGateBanner gate={gate.gate} onOpen={() => setGateOpen(true)} />}
        {/* Came from an FMS step — the plan PDF opens automatically; this banner
            brings the doer straight back to the step to submit. */}
        {cameFromTask && (
          <Paper elevation={0} sx={{
            p: { xs: 1.25, md: 1.5 }, borderRadius: 2.5, mb: 2, display: 'flex', alignItems: 'center',
            gap: 1.25, flexWrap: 'wrap',
            // Solid card (NOT translucent) so the dark hero never bleeds through it.
            bgcolor: 'background.paper',
            border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
            boxShadow: '0 6px 20px rgba(30,58,138,0.08)',
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
        <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <Autocomplete
              sx={{ flex: 1, minWidth: 300 }}
              options={orders}
              loading={loadingOrders}
              value={order}
              onChange={(_, v) => setOrder(v)}
              getOptionLabel={(o) => (o ? `${o.soNumber} — ${o.partyName} (PO ${o.poNumber || '—'})` : '')}
              isOptionEqualToValue={(a, b) => a._id === b._id}
              renderInput={(p) => <TextField {...p} label="Select Sales Order / PO" placeholder="Search SO / PO / party…" size="small" />}
            />
            <Button
              variant="contained" startIcon={<Download size={16} />}
              onClick={handleDownload} disabled={!hasPlan || gate.blocked}
              sx={{ fontWeight: 700, px: 3, whiteSpace: 'nowrap' }}
            >
              Open / Download PDF
            </Button>
          </Stack>
        </Paper>

        {/* States */}
        {!order && (
          <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 3, color: 'text.disabled' }}>
            <PackageSearch size={34} style={{ opacity: 0.4, marginBottom: 8 }} />
            <Typography sx={{ fontWeight: 700 }}>Choose an order to begin</Typography>
            <Typography sx={{ fontSize: '0.85rem' }}>Its dispatch plan will load here for preview & PDF export.</Typography>
          </Paper>
        )}

        {order && loadingSched && <Skeleton variant="rounded" height={280} sx={{ borderRadius: 3 }} />}

        {order && !loadingSched && !hasPlan && (
          <Paper sx={{ p: 5, textAlign: 'center', borderRadius: 3, color: 'text.secondary' }}>
            <CalendarRange size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
            <Typography sx={{ fontWeight: 700 }}>No dispatch plan found for {order.soNumber}</Typography>
            <Typography sx={{ fontSize: '0.85rem' }}>
              {isError ? 'Could not load the schedule.' : 'Create the schedule in Dispatch Planning first, then come back to export it.'}
            </Typography>
          </Paper>
        )}

        {/* Preview */}
        {hasPlan && (
          <Paper sx={{ borderRadius: 3, overflow: 'hidden', border: `1px solid ${theme.palette.divider}` }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${theme.palette.divider}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }} noWrap>{schedule.partyName || order?.partyName || '—'}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.72rem' }}>
                  {schedule.soNumber || order?.soNumber || '—'}{(schedule.poNumber || order?.poNumber) ? ` · PO ${schedule.poNumber || order?.poNumber}` : ''} · {(schedule.items || []).length} SKU(s)
                </Typography>
              </Box>
              <Chip size="small" label={`Total planned: ${num(totalPlanned)}`} sx={{ fontWeight: 700, fontSize: '0.72rem', bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.dark }} />
            </Box>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{
                minWidth: 720,
                '& td, & th': { fontSize: '0.76rem', py: 0.6, px: 1.25, borderColor: theme.palette.divider },
              }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                    {['SKU', 'PO Qty', 'Dispatched', 'Balance', 'Phase', 'Planned Date', 'Planned Qty', 'Status'].map((h, i) => (
                      <TableCell key={h} align={[1, 2, 3, 6].includes(i) ? 'right' : 'left'}
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
                            <TableCell align="right" rowSpan={span} sx={{ verticalAlign: 'top', fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>{num(r.it.dispatchedQty)}</TableCell>
                            <TableCell align="right" rowSpan={span} sx={{ verticalAlign: 'top', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: Number(r.it.balanceQty) > 0 ? theme.palette.warning.dark : 'text.primary' }}>{num(r.it.balanceQty)}</TableCell>
                          </>
                        ) : null}
                        <TableCell>{r.phase ? <Chip size="small" label={r.phase.phaseNo} sx={{ fontWeight: 700, height: 18, fontSize: '0.6rem', bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.dark }} /> : <Typography variant="caption" color="text.disabled">—</Typography>}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{r.phase ? fmtDate(r.phase.plannedDate) : <Typography variant="caption" color="text.disabled">no plan</Typography>}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: theme.palette.primary.dark }}>{r.phase ? num(r.phase.plannedQty) : '—'}</TableCell>
                        <TableCell>{r.phase ? <Chip size="small" color={STATUS_COLOR[r.phase.status] || 'default'} variant="outlined" label={r.phase.status} sx={{ height: 18, fontSize: '0.56rem', fontWeight: 700 }} /> : null}</TableCell>
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
