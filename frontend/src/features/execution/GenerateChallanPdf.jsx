import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, Button, Chip, InputAdornment,
  Table, TableBody, TableCell, TableHead, TableRow, alpha, useTheme, Skeleton, CircularProgress,
  Autocomplete, Checkbox, Tooltip,
} from '@mui/material';
import { Truck, Eye, Search, FileText, Zap, CheckCircle2, ArrowRight, Printer } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGetChallansQuery } from '../../store/api/dispatchControlApi';
import { useFmsGate, FmsGateBanner, FmsGateDialog } from '../o2d-fms/FmsGate';
import { O2D } from '../o2d-fms/o2dTheme';
import BackButton from '../../components/BackButton';
import { printChallans } from '../../utils/printChallans';
import { useGetCompanySettingsQuery } from '../../store/api/pricingApi';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';

const num = (n) => (Number(n || 0)).toLocaleString('en-IN');
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

const STATUS_COLOR = {
  CREATED: 'default', DISPATCHED: 'info', DELIVERED: 'success', CANCELLED: 'error',
};

/**
 * Generate Delivery Challan PDF
 * -----------------------------
 * Lists actual-dispatch challans → pick a row → generate a fresh, professional
 * delivery-challan PDF (PDFKit, server-side) and open it for preview / download.
 * Route: /challans/generate-pdf
 */
const GenerateChallanPdf = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // FMS task context — set when the doer arrived here via "Do it now" on step 2.06.
  const fromTask = params.get('fromTask');
  const fromStep = params.get('fromStep');
  // Which connected action-link this entry was for — carried back so the task
  // marks exactly THIS action done and flips it to "Do again".
  const fromAction = params.get('fromAction');
  const soFromTask = params.get('so') || '';
  const cameFromTask = !!(fromTask && fromStep);

  // When opened from a task, scope the list to that order's challan(s) up front.
  const [search, setSearch] = useState(soFromTask);
  const { data, isFetching } = useGetChallansQuery({ limit: 200, sort: '-dcDate', search: search || undefined });
  // Letterhead details for the print sheet, so it carries the same address /
  // phone / email block the server-rendered Preview PDF does.
  const { data: companyRes } = useGetCompanySettingsQuery();
  const company = companyRes?.data || {};
  const [busyId, setBusyId] = useState(null);
  const [printing, setPrinting] = useState(false);
  // Gate (when arriving from the FMS step for a specific order).
  const gate = useFmsGate({ soNumber: soFromTask, action: 'CHALLAN_PDF' });
  const [gateOpen, setGateOpen] = useState(false);

  const rows = useMemo(() => data?.data || [], [data]);

  // A full (unfiltered) list just to power the Sales Order dropdown — every SO that
  // has at least one challan, most-recent first.
  const { data: allData } = useGetChallansQuery({ limit: 500, sort: '-dcDate' });
  const soOptions = useMemo(() => {
    const seen = new Map(); // soNumber → party (for the option subtitle)
    (allData?.data || []).forEach((c) => { if (c.soNumber && !seen.has(c.soNumber)) seen.set(c.soNumber, c.partyName || ''); });
    return [...seen.entries()].map(([soNumber, partyName]) => ({ soNumber, partyName }));
  }, [allData]);
  // The SO currently chosen in the dropdown (drives the list filter + the batch print).
  const [soSel, setSoSel] = useState(soFromTask || '');

  // Which challans the batch print will include. Empty = "all currently listed",
  // so the button keeps working untouched; ticking any row narrows it to exactly
  // those. Previously Print always took every row in the list with no way to say
  // "just this one of the three".
  const [selected, setSelected] = useState(() => new Set());
  const toggleRow = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Any row leaving the list (filter change) must also leave the selection, or
  // Print would silently include a challan the user can no longer see.
  const visibleIds = useMemo(() => rows.map((r) => String(r._id)), [rows]);
  const selectedVisible = useMemo(
    () => visibleIds.filter((id) => selected.has(id)),
    [visibleIds, selected],
  );
  const allChecked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const someChecked = selectedVisible.length > 0 && !allChecked;
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(visibleIds));
  // What Print will actually produce.
  const printTargets = useMemo(
    () => (selectedVisible.length ? rows.filter((r) => selected.has(String(r._id))) : rows),
    [rows, selected, selectedVisible],
  );

  // Batch print — pull the FULL challan record (items, address, totals) for every
  // targeted challan, then open a print sheet with TWO challans per A4 page.
  const printAll = async () => {
    if (!printTargets.length) { enqueueSnackbar('No challans to print — pick a sales order first.', { variant: 'info' }); return; }
    setPrinting(true);
    try {
      const token = localStorage.getItem('token');
      const full = await Promise.all(printTargets.map((r) => fetch(`${API_BASE}/challans/${r._id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() : null)).then((j) => j?.data || null).catch(() => null)));
      const challans = full.filter(Boolean);
      if (!challans.length) throw new Error('Could not load the challans to print.');
      const ok = printChallans({ challans, company });
      if (!ok) enqueueSnackbar('Allow pop-ups to open the print preview.', { variant: 'warning' });
    } catch (e) {
      enqueueSnackbar(e.message || 'Could not prepare the print.', { variant: 'error' });
    } finally {
      setPrinting(false);
    }
  };

  // Always-fresh preview: stream the PDF bytes (nothing saved) and open them in a
  // new tab — the browser's PDF viewer shows it and offers download.
  const previewPdf = async (dc) => {
    if (gate.blocked) { setGateOpen(true); return false; }
    setBusyId(dc._id);
    let blobUrl;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/challans/${dc._id}/pdf/preview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to render the challan PDF.');
      const blob = await res.blob();
      blobUrl = URL.createObjectURL(blob);
      const w = window.open(blobUrl, '_blank', 'noopener');
      if (!w) enqueueSnackbar('Allow pop-ups to view the challan PDF, then use “Back to task”.', { variant: 'warning' });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      return !!w;
    } catch (e) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      enqueueSnackbar(e.message || 'Could not preview the challan PDF.', { variant: 'error' });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  // Return to the FMS step that sent us here. Landing with ?entryDone=1 auto-ticks
  // the step's checklist so the doer only reviews & submits — that's what makes the
  // challan show up "done by X" in the FMS Tracker and Master FMS.
  const backToTask = () => {
    if (!cameFromTask) return;
    // Carry doneAction so the task marks THIS action done → it flips to "Do again".
    const q = new URLSearchParams({ entryDone: '1' });
    if (fromAction) q.set('doneAction', fromAction);
    // Replace this page: Back from the step must not land here again (it would
    // open the challan PDF once more and come straight back — a loop).
    navigate(`/o2d-fms/task/${fromTask}/${encodeURIComponent(fromStep)}?${q.toString()}`, { replace: true });
  };

  // Auto-open the challan PDF once, for the order we came from. The latest DC for
  // that SO is rows[0] (list is sorted -dcDate and already filtered to the SO).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!cameFromTask || autoOpenedRef.current || isFetching || gate.blocked) return;
    const target = rows[0];
    if (!target) return;
    autoOpenedRef.current = true;
    previewPdf(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameFromTask, isFetching, rows]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: O2D.canvas }}>
      {/* Flush warm top bar — matches the O2D design system */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 5, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}`, px: { xs: 1.5, md: 2 }, py: 1 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <BackButton iconOnly sx={{ color: O2D.body, border: `1px solid ${O2D.line}`, borderRadius: '6px', flexShrink: 0 }} />
          <Box sx={{ width: 30, height: 30, borderRadius: '6px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: alpha(O2D.brand, 0.1), color: O2D.brand }}>
            <Truck size={16} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: O2D.ink, fontSize: { xs: '1rem', md: '1.1rem' }, fontWeight: 800, lineHeight: 1.2 }}>
              Generate Delivery Challan PDF
            </Typography>
            <Typography noWrap sx={{ color: O2D.sub, fontSize: '0.72rem' }}>
              Pick an actual dispatch and generate its delivery challan — preview & download.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.25, md: 1.75 }, py: 1.5, pb: 6, maxWidth: 1240, mx: 'auto' }}>
        {gate.blocked && <FmsGateBanner gate={gate.gate} onOpen={() => setGateOpen(true)} />}
        {/* Came from FMS step 2.06 — the challan PDF opens automatically; this banner
            brings the doer straight back to the step to submit. */}
        {cameFromTask && (
          <Paper elevation={0} sx={{
            p: { xs: 1.25, md: 1.5 }, borderRadius: '8px', mb: 1.5, display: 'flex', alignItems: 'center',
            gap: 1.25, flexWrap: 'wrap',
            bgcolor: O2D.surfaceAlt, border: `1px solid ${alpha(O2D.brand, 0.3)}`,
          }}>
            <Box sx={{ p: 0.85, borderRadius: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main', display: 'flex', flexShrink: 0 }}>
              <Zap size={16} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 200 }}>
              <Typography sx={{ fontWeight: 800, color: 'primary.dark', fontSize: '0.86rem', lineHeight: 1.2 }}>
                Create Delivery Challan{soFromTask ? ` — ${soFromTask}` : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.72rem' }}>
                The challan PDF opens in a new tab — review it, then “Back to task” to mark the step done.
              </Typography>
            </Box>
            <Button size="small" variant="contained" endIcon={<ArrowRight size={14} />} startIcon={<CheckCircle2 size={14} />}
              onClick={backToTask} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
              Back to task
            </Button>
          </Paper>
        )}

        <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', mb: 1.5, border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
            {/* Pick a Sales Order → the list narrows to that order's challans, and the
                Print button batches them 2-per-A4-page. */}
            <Autocomplete
              size="small" sx={{ minWidth: 280, flex: 1 }}
              options={soOptions}
              value={soOptions.find((o) => o.soNumber === soSel) || null}
              onChange={(_, v) => { setSoSel(v?.soNumber || ''); setSearch(v?.soNumber || ''); }}
              getOptionLabel={(o) => o?.soNumber || ''}
              isOptionEqualToValue={(a, b) => a.soNumber === b?.soNumber}
              renderOption={(props, o) => (
                <li {...props} key={o.soNumber}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{o.soNumber}</Typography>
                    {o.partyName && <Typography variant="caption" color="text.secondary" noWrap>{o.partyName}</Typography>}
                  </Box>
                </li>
              )}
              renderInput={(p) => <TextField {...p} label="Sales Order" placeholder="Select an SO…" />}
            />
            <TextField
              size="small" sx={{ flex: 1.4 }} value={search}
              onChange={(e) => { setSearch(e.target.value); setSoSel(''); }}
              placeholder="…or search by DC number, SO number or party"
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }}
            />
            <Button
              variant="contained" disableElevation onClick={printAll}
              disabled={printing || !rows.length}
              startIcon={printing ? <CircularProgress size={14} color="inherit" /> : <Printer size={16} />}
              sx={{ whiteSpace: 'nowrap', fontWeight: 700, textTransform: 'none', borderRadius: '7px', bgcolor: O2D.brand, '&:hover': { bgcolor: '#1a44bf' } }}
            >
              {/* Count reflects what will actually print — the ticked rows, or the
                  whole list when nothing is ticked — so it can't over-promise. */}
              {printing
                ? 'Preparing…'
                : `Print${printTargets.length ? ` (${printTargets.length})` : ''}${selectedVisible.length ? ' selected' : ''}${printTargets.length ? ' · 2/page' : ''}`}
            </Button>
          </Stack>
          <Typography sx={{ mt: 0.75, fontSize: '0.68rem', color: O2D.sub }}>
            Print lays two delivery challans on each A4 page (a 3rd flows to the next page). Colour / black-&-white and one-sided / both-sides are chosen in your browser's print dialog.
          </Typography>
        </Paper>

        <Paper elevation={0} sx={{ borderRadius: '8px', overflow: 'hidden', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
          {isFetching ? <Skeleton variant="rounded" height={320} /> : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 820, '& td, & th': { fontSize: '0.76rem', py: 0.6, px: 1.25, borderColor: O2D.lineSoft }, '& tbody tr:hover': { bgcolor: O2D.surfaceAlt } }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: O2D.surfaceAlt }}>
                    {/* Tick rows to print just those; leave all clear to print the whole list. */}
                    <TableCell padding="checkbox">
                      <Tooltip title={allChecked ? 'Clear selection' : 'Select all listed'}>
                        <Checkbox size="small" checked={allChecked} indeterminate={someChecked} onChange={toggleAll} />
                      </Tooltip>
                    </TableCell>
                    {['DC Number', 'Date', 'Party', 'SO / PO', 'Qty (pcs)', 'Boxes', 'Status'].map((h, i) => (
                      <TableCell key={h} align={[4, 5].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 700, fontSize: '0.64rem !important', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'text.secondary', whiteSpace: 'nowrap' }}>{h}</TableCell>
                    ))}
                    <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.64rem !important', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'text.secondary', whiteSpace: 'nowrap' }}>Challan PDF</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={9} sx={{ textAlign: 'center', py: 5, color: 'text.disabled' }}>
                      <FileText size={28} style={{ opacity: 0.4 }} />
                      <Typography sx={{ fontWeight: 700, mt: 1 }}>No challans found</Typography>
                      <Typography variant="caption">Create an actual dispatch first, then generate its challan here.</Typography>
                    </TableCell></TableRow>
                  )}
                  {rows.map((dc) => (
                    <TableRow key={dc._id} hover selected={selected.has(String(dc._id))}>
                      <TableCell padding="checkbox">
                        <Checkbox size="small" checked={selected.has(String(dc._id))} onChange={() => toggleRow(String(dc._id))} />
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: '0.72rem', color: theme.palette.primary.dark, whiteSpace: 'nowrap' }}>{dc.dcNumber}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{fmtDate(dc.dcDate)}</TableCell>
                      <TableCell sx={{ maxWidth: 180 }}><Typography variant="body2" sx={{ fontSize: '0.76rem' }} noWrap title={dc.partyName}>{dc.partyName || '—'}</Typography></TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Typography sx={{ fontSize: '0.76rem', fontWeight: 600 }}>{dc.soNumber || '—'}</Typography>
                        {dc.poNumber && <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.66rem' }}>PO {dc.poNumber}</Typography>}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{num(dc.totalQuantityPcs)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>{num(dc.totalBoxes)}</TableCell>
                      <TableCell><Chip size="small" variant="outlined" color={STATUS_COLOR[dc.status] || 'default'} label={dc.status} sx={{ height: 18, fontSize: '0.56rem', fontWeight: 700 }} /></TableCell>
                      <TableCell align="right">
                        <Button
                          size="small" variant="contained"
                          startIcon={busyId === dc._id ? <CircularProgress size={13} color="inherit" /> : <Eye size={14} />}
                          disabled={busyId === dc._id}
                          onClick={() => previewPdf(dc)}
                          sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}
                        >
                          {busyId === dc._id ? 'Preparing…' : 'Preview / Download'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Paper>
      </Box>
      <FmsGateDialog gate={gate.gate} open={gateOpen} onClose={() => setGateOpen(false)} />
    </Box>
  );
};

export default GenerateChallanPdf;
