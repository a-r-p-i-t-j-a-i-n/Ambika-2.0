import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Stack, Typography, alpha, useTheme, ToggleButtonGroup, ToggleButton,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, InputAdornment, MenuItem, Chip, Tooltip,
  Autocomplete, IconButton, Collapse, LinearProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Divider,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Activity, Table as TableIcon, Rows3, LayoutGrid, Columns3, Search, Truck, Clock,
  ChevronDown, ChevronRight, X, Package, CalendarCheck, FileText, ArrowLeft,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend,
} from 'recharts';
import dayjs from 'dayjs';
import { useGetPhaseMatrixQuery } from '../../store/api/dispatchControlApi';
import BackButton from '../../components/BackButton';
import { O2D } from '../o2d-fms/o2dTheme';

const BRAND = '#1d4ed8';
const BRAND_DK = '#1e3a8a';
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const dd = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

// Simple, self-consistent per-phase remaining (Planned − Actual, never negative) —
// no "effective"/carry-forward jargon. Phase remainders still add up to the order
// balance, so the totals reconcile.
const remainingOf = (r) => Math.max(0, Number(r.plannedQty || 0) - Number(r.actualQty || 0));
// The date the actual dispatch(es) happened — the latest shipment against the phase.
const actualDateOf = (r) => {
  const ds = (r.shipments || []).map((s) => s.date).filter(Boolean);
  if (!ds.length) return '—';
  const latest = ds.reduce((a, b) => (dayjs(b).isAfter(dayjs(a)) ? b : a));
  return dd(latest);
};

const STATUS = {
  PLANNED:     { color: '#1d4ed8', label: 'Planned' },
  IN_PROGRESS: { color: '#b45309', label: 'In Progress' },
  DISPATCHED:  { color: '#0f766e', label: 'Dispatched' },
  DELAYED:     { color: '#be123c', label: 'Delayed' },
  CANCELLED:   { color: '#64748b', label: 'Cancelled' },
};
const st = (s) => STATUS[s] || STATUS.PLANNED;

const VIEWS = [
  { key: 'table', label: 'Table', icon: TableIcon },
  { key: 'sheet', label: 'Excel', icon: Rows3 },
  { key: 'cards', label: 'Cards', icon: LayoutGrid },
  { key: 'board', label: 'Board', icon: Columns3 },
];

// Sheet/Excel + cards reuse the same column definitions — kept deliberately simple:
// what was planned (qty + date), what shipped (qty + date), what's left, status.
const COLS = [
  { key: 'soNumber', label: 'Order' },
  { key: 'partyName', label: 'Client' },
  { key: 'skuName', label: 'SKU' },
  { key: 'phaseNo', label: 'Phase' },
  { key: 'plannedDate', label: 'Plan Date', get: (r) => dd(r.plannedDate) },
  { key: 'plannedQty', label: 'Planned', num: true },
  { key: 'actualQty', label: 'Actual', num: true },
  { key: 'actualDate', label: 'Actual Date', get: (r) => actualDateOf(r) },
  { key: 'remaining', label: 'Remaining', num: true, get: (r) => num(remainingOf(r)) },
  { key: 'status', label: 'Status', get: (r) => st(r.status).label },
];

const Kpi = ({ label, value, color }) => (
  <Box sx={{ flex: 1, minWidth: 90, textAlign: 'center', p: 1, borderRadius: 1.5, bgcolor: alpha(color, 0.07) }}>
    <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', color, lineHeight: 1.1 }}>{value}</Typography>
    <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'text.secondary' }}>{label}</Typography>
  </Box>
);

const Metric = ({ label, value, color }) => (
  <Box sx={{ textAlign: 'right', minWidth: 62 }}>
    <Typography sx={{ fontWeight: 800, fontSize: '0.82rem', color }}>{value}</Typography>
    <Typography sx={{ fontSize: '0.54rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>{label}</Typography>
  </Box>
);

// Planned-vs-Actual drill-down for ONE order: KPIs, a per-phase bar chart, and a
// phase-by-phase breakdown where each phase expands to its actual dispatches
// (challan qty · date · invoice) — so you see what was planned, and exactly what
// shipped and when.
const OrderFocusPanel = ({ soNumber, phases, onClear }) => {
  const theme = useTheme();
  const [openId, setOpenId] = useState(null);
  const party = phases[0]?.partyName || '';
  const po = phases[0]?.poNumber || '';
  const planned = phases.reduce((s, r) => s + Number(r.plannedQty || 0), 0);
  const actual = phases.reduce((s, r) => s + Number(r.actualQty || 0), 0);
  const remaining = phases.reduce((s, r) => s + remainingOf(r), 0);
  const pct = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : 0;
  const chartData = phases.map((r) => ({
    // Full SKU name + phase — the old label kept only the first word ("Value P1"),
    // which made the bars impossible to tell apart.
    name: `${r.skuName || '—'} · ${r.phaseNo}`,
    skuCode: r.skuCode,
    Planned: Number(r.plannedQty || 0),
    Actual: Number(r.actualQty || 0),
  }));
  const bySku = useMemo(() => {
    const m = new Map();
    phases.forEach((r) => { const k = `${r.skuName} (${r.skuCode})`; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return [...m.entries()];
  }, [phases]);

  return (
    <Paper variant="outlined" sx={{ borderRadius: '8px', overflow: 'hidden', borderColor: O2D.line, bgcolor: O2D.surface }}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ p: 1.25, bgcolor: O2D.surfaceAlt, borderBottom: `1px solid ${O2D.line}` }}>
        <Box sx={{ width: 36, height: 36, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(BRAND, 0.12), color: BRAND }}><Package size={18} /></Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, color: BRAND_DK }}>{soNumber}</Typography>
          <Typography variant="caption" color="text.secondary">{party}{po ? ` · PO ${po}` : ''}</Typography>
        </Box>
        <Chip size="small" label={`${phases.length} phase${phases.length === 1 ? '' : 's'}`} sx={{ fontWeight: 700 }} />
        <IconButton size="small" onClick={onClear} title="Back to all orders"><X size={18} /></IconButton>
      </Stack>

      <Box sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1.25} sx={{ mb: 1.25, flexWrap: 'wrap', rowGap: 1 }}>
          <Kpi label="Planned" value={num(planned)} color={BRAND_DK} />
          <Kpi label="Dispatched" value={num(actual)} color="#0f766e" />
          <Kpi label="Remaining" value={num(remaining)} color="#b45309" />
          <Kpi label="Progress" value={`${pct}%`} color={BRAND} />
        </Stack>
        <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 5, mb: 2, bgcolor: alpha(BRAND, 0.12), '& .MuiLinearProgress-bar': { bgcolor: '#0f766e' } }} />

        {bySku.map(([sku, prs]) => (
          <Box key={sku} sx={{ mt: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>{sku}</Typography>
            <Stack spacing={0.75}>
              {prs.map((r) => {
                const open = openId === r.id;
                const rem = remainingOf(r);
                const s = st(r.status);
                const hasShip = (r.shipments || []).length > 0;
                return (
                  <Box key={r.id} sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1.5, overflow: 'hidden' }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1, cursor: hasShip ? 'pointer' : 'default', flexWrap: 'wrap', rowGap: 0.5 }}
                      onClick={() => hasShip && setOpenId(open ? null : r.id)}>
                      <Chip size="small" label={r.phaseNo} sx={{ fontWeight: 800, bgcolor: alpha(BRAND, 0.1), color: BRAND }} />
                      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 118 }}>
                        <CalendarCheck size={13} color={theme.palette.text.secondary} />
                        <Typography variant="caption" color="text.secondary">Plan: {dd(r.plannedDate)}</Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 118 }}>
                        <Truck size={13} color={hasShip ? '#0f766e' : theme.palette.text.disabled} />
                        <Typography variant="caption" sx={{ fontWeight: hasShip ? 700 : 400, color: hasShip ? '#0f766e' : 'text.disabled' }}>
                          Actual: {actualDateOf(r)}
                        </Typography>
                      </Stack>
                      <Box sx={{ flex: 1 }} />
                      <Metric label="Planned" value={num(r.plannedQty)} color={BRAND_DK} />
                      <Metric label="Actual" value={num(r.actualQty)} color="#0f766e" />
                      <Metric label="Remaining" value={rem > 0 ? num(rem) : '—'} color={rem > 0 ? '#b45309' : '#94a3b8'} />
                      <Chip size="small" label={s.label} sx={{ fontWeight: 700, bgcolor: alpha(s.color, 0.1), color: s.color }} />
                      {hasShip && (open ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
                    </Stack>
                    {hasShip && (
                      <Collapse in={open} timeout={180} unmountOnExit>
                        <Box sx={{ px: 1.25, pb: 1.25, pt: 0.5, bgcolor: alpha(theme.palette.text.primary, 0.02) }}>
                          <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4 }}>Actual dispatches</Typography>
                          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                            {r.shipments.map((sh, i) => (
                              <Stack key={i} direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
                                <Truck size={13} color="#0f766e" />
                                <Typography variant="caption" sx={{ fontWeight: 800, color: '#0f766e' }}>{num(sh.qty)} pcs</Typography>
                                <Box sx={{ flex: 1 }} />
                                <Typography variant="caption" color="text.secondary">{dd(sh.date)}</Typography>
                                {sh.invoiceNo && <Chip size="small" icon={<FileText size={11} />} label={sh.invoiceNo} sx={{ height: 18, fontSize: '0.6rem', '& .MuiChip-icon': { ml: 0.5 } }} />}
                              </Stack>
                            ))}
                          </Stack>
                        </Box>
                      </Collapse>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Box>
        ))}

        {/* Chart LAST — the per-phase detail above is what the doer reads first;
            the graph is the visual summary underneath it. */}
        <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${O2D.line}` }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1, fontSize: '0.8rem' }}>Planned vs Dispatched — by SKU &amp; phase</Typography>
          <Box sx={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 6, right: 12, left: -12, bottom: 72 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={O2D.line} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: O2D.sub }} interval={0} angle={-30} textAnchor="end" height={80} />
                <YAxis tick={{ fontSize: 10, fill: O2D.sub }} />
                <RTooltip
                  formatter={(v) => num(v)}
                  labelFormatter={(label, payload) => {
                    const code = payload?.[0]?.payload?.skuCode;
                    return code ? `${label}  (${code})` : label;
                  }}
                  contentStyle={{ borderRadius: 6, border: `1px solid ${O2D.line}`, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Planned" fill={BRAND} radius={[3, 3, 0, 0]} maxBarSize={34} />
                <Bar dataKey="Actual" fill="#0f766e" radius={[3, 3, 0, 0]} maxBarSize={34} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
};

// One phase, explained in plain words: what was planned, what actually shipped and
// when (each delivery challan), and what's still left. Opening this instead of
// navigating away keeps the user in context.
const RowDetailDialog = ({ row, onClose, onOpenOrder }) => {
  const theme = useTheme();
  if (!row) return null;
  const planned = Number(row.plannedQty || 0);
  const actual = Number(row.actualQty || 0);
  const remaining = remainingOf(row);
  const over = Math.max(0, actual - planned);
  const pct = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : (actual > 0 ? 100 : 0);
  const s = st(row.status);
  const shipments = (row.shipments || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  // +ve = shipped after the plan date (late), -ve = early.
  const driftDays = (d) => (row.plannedDate && d
    ? dayjs(d).startOf('day').diff(dayjs(row.plannedDate).startOf('day'), 'day') : null);
  const driftText = (n) => (n == null ? '' : n === 0 ? 'on the planned date' : n > 0 ? `${n} day${n === 1 ? '' : 's'} late` : `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} early`);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={row.phaseNo} sx={{ fontWeight: 800, bgcolor: alpha(BRAND, 0.1), color: BRAND }} />
          <Typography sx={{ fontWeight: 800, color: BRAND_DK }}>{row.soNumber}</Typography>
          <Chip size="small" label={s.label} sx={{ fontWeight: 700, bgcolor: alpha(s.color, 0.12), color: s.color }} />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {row.partyName} · {row.skuName} ({row.skuCode})
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {/* Headline numbers */}
        <Stack direction="row" spacing={1.25} sx={{ mb: 1.25, flexWrap: 'wrap', rowGap: 1 }}>
          <Kpi label="Planned" value={num(planned)} color={BRAND_DK} />
          <Kpi label="Shipped" value={num(actual)} color="#0f766e" />
          <Kpi label={over > 0 ? 'Extra sent' : 'Remaining'} value={over > 0 ? `+${num(over)}` : num(remaining)} color={over > 0 ? '#b45309' : (remaining > 0 ? '#b45309' : '#64748b')} />
        </Stack>
        <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 5, mb: 2, bgcolor: alpha(BRAND, 0.12), '& .MuiLinearProgress-bar': { bgcolor: '#0f766e' } }} />

        {/* Plan */}
        <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>What was planned</Typography>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5, mb: 1.75, p: 1.25, borderRadius: 1.5, border: `1px solid ${theme.palette.divider}` }}>
          <CalendarCheck size={15} color={BRAND} />
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{num(planned)} pcs</Typography>
          <Typography variant="body2" color="text.secondary">· due {dd(row.plannedDate)}</Typography>
        </Stack>

        {/* Actual */}
        <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>What actually shipped</Typography>
        {shipments.length === 0 ? (
          <Box sx={{ mt: 0.5, p: 1.5, borderRadius: 1.5, border: `1px dashed ${theme.palette.divider}`, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">Nothing shipped against this phase yet.</Typography>
          </Box>
        ) : (
          <Stack spacing={0.75} sx={{ mt: 0.5 }}>
            {shipments.map((sh, i) => {
              const dr = driftDays(sh.date);
              return (
                <Stack key={i} direction="row" alignItems="center" spacing={1} sx={{ p: 1.25, borderRadius: 1.5, border: `1px solid ${theme.palette.divider}`, flexWrap: 'wrap', rowGap: 0.5 }}>
                  <Truck size={15} color="#0f766e" />
                  <Typography variant="body2" sx={{ fontWeight: 800, color: '#0f766e' }}>{num(sh.qty)} pcs</Typography>
                  <Typography variant="body2" color="text.secondary">on {dd(sh.date)}</Typography>
                  {dr != null && (
                    <Chip size="small" label={driftText(dr)}
                      sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700,
                        bgcolor: alpha(dr > 0 ? '#be123c' : '#0f766e', 0.1), color: dr > 0 ? '#be123c' : '#0f766e' }} />
                  )}
                  <Box sx={{ flex: 1 }} />
                  {sh.invoiceNo && <Chip size="small" icon={<FileText size={11} />} label={sh.invoiceNo} sx={{ height: 20, fontSize: '0.65rem' }} />}
                </Stack>
              );
            })}
          </Stack>
        )}

        {/* Plain-words summary */}
        <Divider sx={{ my: 1.75 }} />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {remaining > 0
            ? <>Planned <b>{num(planned)}</b>, shipped <b>{num(actual)}</b> — <b style={{ color: '#b45309' }}>{num(remaining)} still to go</b> on this phase.</>
            : over > 0
              ? <>Planned <b>{num(planned)}</b>, shipped <b>{num(actual)}</b> — <b style={{ color: '#b45309' }}>{num(over)} extra</b>, covering a shortfall carried in from an earlier phase.</>
              : <>Fully shipped — planned <b>{num(planned)}</b>, shipped <b>{num(actual)}</b>.</>}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onOpenOrder(row)} sx={{ mr: 'auto' }}>Open order</Button>
        <Button onClick={onClose} variant="contained">Close</Button>
      </DialogActions>
    </Dialog>
  );
};

const PlanVsActualMaster = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [view, setView] = useState('table');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [soFilter, setSoFilter] = useState(null);
  const [poFilter, setPoFilter] = useState(null);
  // Clicking a row explains that phase in place — it no longer navigates away.
  const [detailRow, setDetailRow] = useState(null);

  const { data, isLoading, isFetching } = useGetPhaseMatrixQuery();
  const rawRows = useMemo(() => data?.data || [], [data]);

  // Distinct Order (SO) and PO lists for the dropdown pickers.
  const soOptions = useMemo(() => {
    const m = new Map();
    rawRows.forEach((r) => { if (r.soNumber && !m.has(r.soNumber)) m.set(r.soNumber, { soNumber: r.soNumber, partyName: r.partyName, poNumber: r.poNumber }); });
    return [...m.values()].sort((a, b) => a.soNumber.localeCompare(b.soNumber));
  }, [rawRows]);
  const poOptions = useMemo(() => [...new Set(rawRows.map((r) => r.poNumber).filter(Boolean))].sort(), [rawRows]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawRows.filter((r) => {
      if (soFilter && r.soNumber !== soFilter) return false;
      if (poFilter && r.poNumber !== poFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (q && !(`${r.soNumber} ${r.partyName} ${r.skuName} ${r.skuCode} ${r.phaseNo}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rawRows, search, statusFilter, soFilter, poFilter]);

  // When exactly one order is selected, show the rich drill-down for it.
  const focusPhases = useMemo(() => (soFilter ? rows.slice() : []), [soFilter, rows]);

  const totals = useMemo(() => rows.reduce((a, r) => {
    a.planned += Number(r.plannedQty || 0);
    a.actual += Number(r.actualQty || 0);
    a.pending += remainingOf(r);
    if (r.delayDays > 0) a.delayed += 1;
    return a;
  }, { planned: 0, actual: 0, pending: 0, delayed: 0 }), [rows]);

  const goOrder = (r) => navigate(`/orders?so=${encodeURIComponent(r.soNumber)}`);
  const openDetail = (r) => setDetailRow(r);

  const gridColumns = [
    { field: 'soNumber', headerName: 'Order', minWidth: 150, flex: 1, renderCell: (p) => <Typography variant="body2" fontWeight={800} color={BRAND}>{p.value}</Typography> },
    { field: 'partyName', headerName: 'Client', minWidth: 150, flex: 1 },
    { field: 'skuName', headerName: 'SKU', minWidth: 160, flex: 1, valueGetter: (v, r) => `${r.skuName} (${r.skuCode})` },
    { field: 'phaseNo', headerName: 'Phase', width: 80, renderCell: (p) => <Chip size="small" label={p.value} sx={{ fontWeight: 800, bgcolor: alpha(BRAND, 0.08), color: BRAND }} /> },
    { field: 'plannedDate', headerName: 'Plan Date', width: 120, valueGetter: (v, r) => dd(r.plannedDate) },
    { field: 'plannedQty', headerName: 'Planned', width: 100, type: 'number', valueGetter: (v, r) => Number(r.plannedQty || 0),
      renderCell: (p) => <Typography variant="body2" fontWeight={700}>{num(p.value)}</Typography> },
    { field: 'actualQty', headerName: 'Actual', width: 95, type: 'number', valueGetter: (v, r) => Number(r.actualQty || 0),
      renderCell: (p) => <Typography variant="body2" fontWeight={800} color={p.value > 0 ? '#0f766e' : 'text.disabled'}>{num(p.value)}</Typography> },
    { field: 'actualDate', headerName: 'Actual Date', width: 120, valueGetter: (v, r) => actualDateOf(r),
      renderCell: (p) => <Typography variant="body2" color={p.value === '—' ? 'text.disabled' : 'text.primary'}>{p.value}</Typography> },
    { field: 'remaining', headerName: 'Remaining', width: 125, type: 'number', valueGetter: (v, r) => remainingOf(r),
      renderCell: (p) => {
        if (p.value > 0) return <Typography variant="body2" fontWeight={700} color="#b45309">{num(p.value)}</Typography>;
        // Shipped MORE than this phase's own plan — it absorbed a shortfall carried
        // in from an earlier phase (FIFO). Label it so the row reads correctly.
        const extra = Math.max(0, Number(p.row.actualQty || 0) - Number(p.row.plannedQty || 0));
        if (extra > 0) {
          return (
            <Tooltip arrow title="Shipped more than this phase's plan — it covered a shortfall carried in from an earlier phase.">
              <Chip size="small" label={`+${num(extra)} extra`}
                sx={{ height: 20, fontSize: '0.65rem', fontWeight: 800, bgcolor: alpha('#b45309', 0.12), color: '#b45309' }} />
            </Tooltip>
          );
        }
        return <Typography variant="body2" color="text.disabled">—</Typography>;
      } },
    { field: 'status', headerName: 'Status', width: 130, valueGetter: (v, r) => st(r.status).label,
      renderCell: (p) => <Chip size="small" label={p.value} sx={{ fontWeight: 800, bgcolor: alpha(st(p.row.status).color, 0.1), color: st(p.row.status).color }} /> },
  ];

  return (
    <Box sx={{ p: { xs: 1.25, sm: 1.75 }, minHeight: '100vh', bgcolor: O2D.canvas }}>
      {/* Header + summary */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5} sx={{ mb: 2, px: 0.5, flexWrap: 'wrap', rowGap: 1 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          {/* While an order is focused, Back returns to the Plan vs Actual list —
              it must NOT jump to whatever page came before (e.g. Actual Dispatch). */}
          {soFilter ? (
            <IconButton size="small" onClick={() => setSoFilter(null)} title="Back to Plan vs Actual"
              sx={{ border: `1px solid ${O2D.line}`, borderRadius: '6px', color: O2D.body }}>
              <ArrowLeft size={18} />
            </IconButton>
          ) : (
            <BackButton iconOnly color="primary" sx={{ border: `1px solid ${O2D.line}`, borderRadius: '6px' }} />
          )}
          <Box sx={{ width: 32, height: 32, borderRadius: '6px', display: 'grid', placeItems: 'center', bgcolor: alpha(BRAND, 0.1), color: BRAND }}>
            <Activity size={18} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: { xs: '1.05rem', sm: '1.15rem' }, fontWeight: 800, color: O2D.ink, lineHeight: 1.2 }}>Plan vs Actual</Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
              Every phase — what was planned, what actually shipped &amp; when, and what&apos;s still left.
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={2.5}>
          {[
            { k: 'Planned', v: num(totals.planned), c: BRAND_DK },
            { k: 'Actual', v: num(totals.actual), c: '#0f766e' },
            { k: 'Remaining', v: num(totals.pending), c: '#b45309' },
            { k: 'Delayed', v: num(totals.delayed), c: '#be123c' },
          ].map((s) => (
            <Box key={s.k} sx={{ textAlign: 'right' }}>
              <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: s.c, lineHeight: 1 }}>{s.v}</Typography>
              <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary' }}>{s.k}</Typography>
            </Box>
          ))}
        </Stack>
      </Stack>

      <Paper sx={{ borderRadius: 2.5, overflow: 'hidden', border: `1px solid ${theme.palette.divider}` }}>
        {/* Toolbar */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, flexWrap: 'wrap', rowGap: 1, borderBottom: `1px solid ${theme.palette.divider}` }}>
          <Autocomplete size="small" options={soOptions} value={soOptions.find((o) => o.soNumber === soFilter) || null}
            onChange={(_e, v) => setSoFilter(v?.soNumber || null)}
            getOptionLabel={(o) => o.soNumber || ''} isOptionEqualToValue={(a, b) => a.soNumber === b.soNumber}
            sx={{ width: { xs: '100%', sm: 240 } }}
            renderOption={(props, o) => (
              <li {...props} key={o.soNumber}>
                <Box><Typography variant="body2" fontWeight={700}>{o.soNumber}</Typography>
                  <Typography variant="caption" color="text.secondary">{o.partyName}</Typography></Box>
              </li>
            )}
            renderInput={(p) => <TextField {...p} placeholder="Select Order (SO)…"
              InputProps={{ ...p.InputProps, startAdornment: <>{p.InputProps.startAdornment}</> }}
              sx={{ '& .MuiInputBase-root': { minHeight: 34 } }} />} />
          <Autocomplete size="small" options={poOptions} value={poFilter}
            onChange={(_e, v) => setPoFilter(v || null)}
            sx={{ width: { xs: '100%', sm: 160 } }}
            renderInput={(p) => <TextField {...p} placeholder="PO…" sx={{ '& .MuiInputBase-root': { minHeight: 34 } }} />} />
          <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU / phase…"
            sx={{ width: { xs: '100%', sm: 200 }, '& .MuiInputBase-root': { height: 34 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> }} />
          <TextField select size="small" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ width: 150, '& .MuiInputBase-root': { height: 34 } }}
            SelectProps={{ displayEmpty: true, renderValue: (v) => (v ? st(v).label : 'All statuses') }}>
            <MenuItem value="">All statuses</MenuItem>
            {Object.keys(STATUS).map((s) => <MenuItem key={s} value={s}>{STATUS[s].label}</MenuItem>)}
          </TextField>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
            {rows.length}{statusFilter || search ? ` / ${rawRows.length}` : ''} phase{rows.length === 1 ? '' : 's'}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
            {VIEWS.map((vw) => (
              <ToggleButton key={vw.key} value={vw.key} title={vw.label} sx={{ px: 1, py: 0.4 }}><vw.icon size={15} /></ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>

        {/* ── Focused order drill-down (KPIs + chart + per-phase dispatches) ── */}
        {soFilter && (
          <Box sx={{ p: 1.5 }}>
            <OrderFocusPanel soNumber={soFilter} phases={focusPhases} onClear={() => setSoFilter(null)} />
          </Box>
        )}
        {/* ── Table ── */}
        {!soFilter && view === 'table' && (
          <Box sx={{ px: 1.5, pb: 1.5 }}>
            <DataGrid rows={rows} columns={gridColumns} getRowId={(r) => r.id} loading={isFetching || isLoading}
              autoHeight density="compact" onRowClick={(p) => openDetail(p.row)}
              initialState={{ pagination: { paginationModel: { pageSize: 25 } } }} pageSizeOptions={[25, 50, 100]}
              disableRowSelectionOnClick
              sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' }, '& .MuiDataGrid-columnHeaders': { bgcolor: alpha(BRAND, 0.04) } }} />
          </Box>
        )}

        {/* ── Excel / Sheet ── */}
        {!soFilter && view === 'sheet' && (
          <Box sx={{ px: 1.5, pb: 1.5, overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 1200, '& td, & th': { border: `1px solid ${theme.palette.divider}`, fontSize: '0.76rem', px: 1, py: 0.55, whiteSpace: 'nowrap' } }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(BRAND, 0.06) }}>
                  <TableCell sx={{ fontWeight: 800 }}>#</TableCell>
                  {COLS.map((c) => <TableCell key={c.key} sx={{ fontWeight: 800 }} align={c.num ? 'right' : 'left'}>{c.label}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => openDetail(r)}>
                    <TableCell sx={{ color: 'text.disabled' }}>{i + 1}</TableCell>
                    {COLS.map((c) => (
                      <TableCell key={c.key} align={c.num ? 'right' : 'left'}>
                        {c.get ? c.get(r) : c.num ? num(r[c.key]) : (r[c.key] || '—')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {rows.length === 0 && <TableRow><TableCell colSpan={COLS.length + 1} align="center" sx={{ py: 3, color: 'text.disabled' }}>No phases.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* ── Cards ── */}
        {!soFilter && view === 'cards' && (
          <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 1.5 }}>
            {rows.map((r) => {
              const s = st(r.status);
              return (
                <Paper key={r.id} variant="outlined" onClick={() => openDetail(r)} sx={{ p: 1.5, borderRadius: 2, cursor: 'pointer', borderLeft: `4px solid ${s.color}`, '&:hover': { boxShadow: 3 } }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                        <Chip size="small" label={r.phaseNo} sx={{ height: 20, fontWeight: 800, bgcolor: alpha(s.color, 0.1), color: s.color }} />
                        <Typography sx={{ fontWeight: 800, fontSize: '0.85rem' }}>{r.soNumber}</Typography>
                        {r.delayDays > 0 && <Chip size="small" icon={<Clock size={10} />} label={`${r.delayDays}d late`} sx={{ height: 18, fontSize: '0.6rem', fontWeight: 800, bgcolor: alpha('#be123c', 0.1), color: '#be123c', '& .MuiChip-icon': { color: '#be123c' } }} />}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">{r.partyName} · {r.skuName}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: 'text.secondary', whiteSpace: 'nowrap' }}>{dd(r.plannedDate)}</Typography>
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
                    {[
                      { k: 'Plan', v: num(r.plannedQty), c: BRAND_DK },
                      { k: 'Actual', v: num(r.actualQty), c: '#0f766e' },
                      { k: 'Remain', v: num(remainingOf(r)), c: remainingOf(r) > 0 ? '#b45309' : '#64748b' },
                    ].map((x) => (
                      <Box key={x.k} sx={{ flex: 1, minWidth: 60, textAlign: 'center', p: 0.5, borderRadius: 1, bgcolor: alpha(x.c, 0.06) }}>
                        <Typography sx={{ fontWeight: 800, fontSize: '0.85rem', color: x.c }}>{x.v}</Typography>
                        <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>{x.k}</Typography>
                      </Box>
                    ))}
                  </Stack>
                  {(r.shipments || []).length > 0 && (
                    <Box sx={{ mt: 0.75, pt: 0.75, borderTop: `1px dashed ${theme.palette.divider}` }}>
                      <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', mb: 0.25 }}>Shipped</Typography>
                      {r.shipments.map((sh, i) => (
                        <Stack key={i} direction="row" justifyContent="space-between">
                          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#0f766e' }}><Truck size={10} style={{ marginRight: 3 }} />{num(sh.qty)}</Typography>
                          <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>{dd(sh.date)}{sh.invoiceNo ? ` · Inv ${sh.invoiceNo}` : ''}</Typography>
                        </Stack>
                      ))}
                    </Box>
                  )}
                </Paper>
              );
            })}
            {rows.length === 0 && <Typography color="text.disabled" sx={{ p: 2 }}>No phases.</Typography>}
          </Box>
        )}

        {/* ── Board (grouped by status) ── */}
        {!soFilter && view === 'board' && (
          <Box sx={{ p: 1.5, display: 'flex', gap: 1.5, overflowX: 'auto' }}>
            {Object.keys(STATUS).map((sKey) => {
              const group = rows.filter((r) => r.status === sKey);
              if (!group.length) return null;
              const s = STATUS[sKey];
              return (
                <Box key={sKey} sx={{ minWidth: 280, flex: '0 0 280px' }}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, px: 0.5 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: s.color }} />
                    <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</Typography>
                    <Chip size="small" label={group.length} sx={{ height: 18, fontSize: '0.62rem' }} />
                  </Stack>
                  <Stack spacing={1}>
                    {group.map((r) => (
                      <Paper key={r.id} variant="outlined" onClick={() => openDetail(r)} sx={{ p: 1.25, borderRadius: 2, cursor: 'pointer', borderLeft: `3px solid ${s.color}` }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography sx={{ fontWeight: 800, fontSize: '0.78rem', color: BRAND_DK }}>{r.soNumber} · {r.phaseNo}</Typography>
                          {r.delayDays > 0 && <Chip size="small" label={`${r.delayDays}d`} sx={{ height: 16, fontSize: '0.58rem', fontWeight: 800, bgcolor: alpha('#be123c', 0.1), color: '#be123c' }} />}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" display="block" noWrap>{r.partyName} · {r.skuName}</Typography>
                        <Typography sx={{ fontSize: '0.7rem', mt: 0.5 }}>
                          <b style={{ color: '#0f766e' }}>{num(r.actualQty)}</b> / {num(r.plannedQty)} · rem <b style={{ color: remainingOf(r) > 0 ? '#b45309' : '#64748b' }}>{num(remainingOf(r))}</b> · {dd(r.plannedDate)}
                        </Typography>
                      </Paper>
                    ))}
                  </Stack>
                </Box>
              );
            })}
            {rows.length === 0 && <Typography color="text.disabled" sx={{ p: 2 }}>No phases.</Typography>}
          </Box>
        )}
      </Paper>

      {/* Row click → explain this phase in place (plan → actual → what's left). */}
      <RowDetailDialog
        row={detailRow}
        onClose={() => setDetailRow(null)}
        onOpenOrder={(r) => { setDetailRow(null); goOrder(r); }}
      />
    </Box>
  );
};

export default PlanVsActualMaster;
