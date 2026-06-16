import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Autocomplete, TextField, Button, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, alpha, useTheme, Skeleton,
} from '@mui/material';
import { FileText, Download, CalendarRange, PackageSearch } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useGetOrdersQuery } from '../../store/api/orderApi';
import { useGetScheduleQuery } from '../../store/api/dispatchControlApi';
import { printDispatchPlan } from '../../utils/printDispatchPlan';

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
  const [order, setOrder] = useState(null);
  const { data: ordersRes, isFetching: loadingOrders } = useGetOrdersQuery({ limit: 500, sort: '-orderDate' });
  const orders = useMemo(() => ordersRes?.data || [], [ordersRes]);

  const soNumber = order?.soNumber || null;
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
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Hero */}
      <Box sx={{
        color: '#fff', px: { xs: 3, md: 5 }, pt: { xs: 4, md: 5 }, pb: { xs: 5, md: 7 },
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
      }}>
        <Stack direction="row" spacing={2.5} alignItems="center">
          <Box sx={{ width: 52, height: 52, borderRadius: 2.5, display: 'grid', placeItems: 'center',
            background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
            <FileText size={26} color="#fff" />
          </Box>
          <Box>
            <Typography sx={{ color: '#fff', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 800, letterSpacing: '-0.02em' }}>
              Generate Dispatch Plan PDF
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.95rem', mt: 0.5 }}>
              Pick an order — its dispatch schedule auto-fills. Preview and download a professional plan PDF.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
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
              onClick={handleDownload} disabled={!hasPlan}
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
          <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
            <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}`, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
              <Box>
                <Typography sx={{ fontWeight: 800 }}>{schedule.partyName || order?.partyName || '—'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {schedule.soNumber || order?.soNumber || '—'}{(schedule.poNumber || order?.poNumber) ? ` · PO ${schedule.poNumber || order?.poNumber}` : ''} · {(schedule.items || []).length} SKU(s)
                </Typography>
              </Box>
              <Chip label={`Total planned: ${num(totalPlanned)}`} sx={{ fontWeight: 800, bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.dark }} />
            </Box>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 760 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                    {['SKU', 'PO Qty', 'Dispatched', 'Balance', 'Phase', 'Planned Date', 'Planned Qty', 'Status'].map((h, i) => (
                      <TableCell key={h} align={[1, 2, 3, 6].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {phaseRows.map((r, i) => (
                    <TableRow key={i} hover>
                      {(r.first || !r.phase) ? (
                        <>
                          <TableCell rowSpan={r.phase ? (r.it.phases || []).length : 1}>
                            <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: '0.78rem', color: theme.palette.primary.dark }}>{r.it.skuCode}</Typography>
                            <Typography variant="caption" color="text.secondary">{r.it.skuName}</Typography>
                          </TableCell>
                          <TableCell align="right" rowSpan={r.phase ? (r.it.phases || []).length : 1}>{num(r.it.poQty)}</TableCell>
                          <TableCell align="right" rowSpan={r.phase ? (r.it.phases || []).length : 1}>{num(r.it.dispatchedQty)}</TableCell>
                          <TableCell align="right" rowSpan={r.phase ? (r.it.phases || []).length : 1} sx={{ fontWeight: 700 }}>{num(r.it.balanceQty)}</TableCell>
                        </>
                      ) : null}
                      <TableCell>{r.phase ? <Chip size="small" label={r.phase.phaseNo} sx={{ fontWeight: 800, height: 20 }} /> : <Typography variant="caption" color="text.disabled">—</Typography>}</TableCell>
                      <TableCell>{r.phase ? fmtDate(r.phase.plannedDate) : <Typography variant="caption" color="text.disabled">no plan</Typography>}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 800 }}>{r.phase ? num(r.phase.plannedQty) : '—'}</TableCell>
                      <TableCell>{r.phase ? <Chip size="small" color={STATUS_COLOR[r.phase.status] || 'default'} variant="outlined" label={r.phase.status} sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700 }} /> : null}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        )}
      </Box>
    </Box>
  );
};

export default GenerateDispatchPlanPdf;
