import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Stack, Typography, alpha, useTheme, ToggleButtonGroup, ToggleButton,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, InputAdornment, MenuItem, Chip, Tooltip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Activity, Table as TableIcon, Rows3, LayoutGrid, Columns3, Search, Truck, Clock,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useGetPhaseMatrixQuery } from '../../store/api/dispatchControlApi';

const BRAND = '#1d4ed8';
const BRAND_DK = '#1e3a8a';
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const dd = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

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

// Carry chip: short (+, red) carries forward; surplus (−, green).
const Carry = ({ v }) => {
  const n = Number(v || 0);
  if (!n) return <Typography component="span" sx={{ color: 'text.disabled' }}>—</Typography>;
  const short = n > 0;
  return <Typography component="span" sx={{ fontWeight: 800, color: short ? '#be123c' : '#0f766e' }}>{short ? '+' : '−'}{num(Math.abs(n))}</Typography>;
};

// Sheet/Excel + cards reuse the same column definitions.
const COLS = [
  { key: 'soNumber', label: 'Order' },
  { key: 'partyName', label: 'Client' },
  { key: 'skuName', label: 'SKU' },
  { key: 'phaseNo', label: 'Phase' },
  { key: 'plannedDate', label: 'Plan Date', get: (r) => dd(r.plannedDate) },
  { key: 'plannedQty', label: 'Planned', num: true },
  { key: 'carryInQty', label: 'Carry-in', num: true },
  { key: 'effectivePlannedQty', label: 'Effective', num: true },
  { key: 'actualQty', label: 'Actual', num: true },
  { key: 'pendingQty', label: 'Remaining', num: true },
  { key: 'carryOutQty', label: 'Carries →', num: true },
  { key: 'delayDays', label: 'Delay', get: (r) => (r.delayDays > 0 ? `${r.delayDays}d` : '—') },
  { key: 'achievementPct', label: 'Done %', get: (r) => `${r.achievementPct || 0}%` },
  { key: 'status', label: 'Status', get: (r) => st(r.status).label },
];

const PlanVsActualMaster = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [view, setView] = useState('table');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, isFetching } = useGetPhaseMatrixQuery();
  const rawRows = useMemo(() => data?.data || [], [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawRows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (q && !(`${r.soNumber} ${r.partyName} ${r.skuName} ${r.skuCode} ${r.phaseNo}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rawRows, search, statusFilter]);

  const totals = useMemo(() => rows.reduce((a, r) => {
    a.planned += Number(r.effectivePlannedQty || 0);
    a.actual += Number(r.actualQty || 0);
    a.pending += Number(r.pendingQty || 0);
    if (r.delayDays > 0) a.delayed += 1;
    return a;
  }, { planned: 0, actual: 0, pending: 0, delayed: 0 }), [rows]);

  const goOrder = (r) => navigate(`/orders?so=${encodeURIComponent(r.soNumber)}`);

  const gridColumns = [
    { field: 'soNumber', headerName: 'Order', minWidth: 150, flex: 1, renderCell: (p) => <Typography variant="body2" fontWeight={800} color={BRAND}>{p.value}</Typography> },
    { field: 'partyName', headerName: 'Client', minWidth: 150, flex: 1 },
    { field: 'skuName', headerName: 'SKU', minWidth: 160, flex: 1, valueGetter: (v, r) => `${r.skuName} (${r.skuCode})` },
    { field: 'phaseNo', headerName: 'Phase', width: 80, renderCell: (p) => <Chip size="small" label={p.value} sx={{ fontWeight: 800, bgcolor: alpha(BRAND, 0.08), color: BRAND }} /> },
    { field: 'plannedDate', headerName: 'Plan Date', width: 120, valueGetter: (v, r) => dd(r.plannedDate) },
    { field: 'plannedQty', headerName: 'Planned', width: 95, type: 'number', valueGetter: (v, r) => Number(r.plannedQty || 0) },
    { field: 'effectivePlannedQty', headerName: 'Effective', width: 100, type: 'number', valueGetter: (v, r) => Number(r.effectivePlannedQty || 0),
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color={p.row.carryInQty ? '#b45309' : 'inherit'}>{num(p.value)}</Typography> },
    { field: 'actualQty', headerName: 'Actual', width: 95, type: 'number', valueGetter: (v, r) => Number(r.actualQty || 0),
      renderCell: (p) => <Typography variant="body2" fontWeight={800} color="#0f766e">{num(p.value)}</Typography> },
    { field: 'pendingQty', headerName: 'Remaining', width: 100, type: 'number', valueGetter: (v, r) => Number(r.pendingQty || 0),
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color={p.value > 0 ? '#b45309' : 'text.disabled'}>{p.value > 0 ? num(p.value) : '—'}</Typography> },
    { field: 'carryOutQty', headerName: 'Carries →', width: 100, type: 'number', valueGetter: (v, r) => Number(r.carryOutQty || 0), renderCell: (p) => <Carry v={p.value} /> },
    { field: 'delayDays', headerName: 'Delay', width: 90, type: 'number', valueGetter: (v, r) => Number(r.delayDays || 0),
      renderCell: (p) => (p.value > 0
        ? <Chip size="small" icon={<Clock size={11} />} label={`${p.value}d`} sx={{ fontWeight: 800, bgcolor: alpha('#be123c', 0.1), color: '#be123c', '& .MuiChip-icon': { color: '#be123c' } }} />
        : <Typography variant="body2" color="text.disabled">—</Typography>) },
    { field: 'status', headerName: 'Status', width: 120, valueGetter: (v, r) => st(r.status).label,
      renderCell: (p) => <Chip size="small" label={p.value} sx={{ fontWeight: 800, bgcolor: alpha(st(p.row.status).color, 0.1), color: st(p.row.status).color }} /> },
  ];

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2.5 }, minHeight: '100vh' }}>
      {/* Header + summary */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5} sx={{ mb: 2, px: 0.5, flexWrap: 'wrap', rowGap: 1 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(BRAND, 0.1), color: BRAND, border: `1px solid ${alpha(BRAND, 0.2)}` }}>
            <Activity size={21} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.35rem' }, fontWeight: 800, color: BRAND_DK, lineHeight: 1.1 }}>Plan vs Actual</Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
              Every phase: what was planned, what shipped &amp; when, what&apos;s left, the delay &amp; how it carries forward.
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
          <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order / SKU / phase…"
            sx={{ width: { xs: '100%', sm: 280 }, '& .MuiInputBase-root': { height: 34 } }}
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

        {/* ── Table ── */}
        {view === 'table' && (
          <Box sx={{ px: 1.5, pb: 1.5 }}>
            <DataGrid rows={rows} columns={gridColumns} getRowId={(r) => r.id} loading={isFetching || isLoading}
              autoHeight density="compact" onRowClick={(p) => goOrder(p.row)}
              initialState={{ pagination: { paginationModel: { pageSize: 25 } } }} pageSizeOptions={[25, 50, 100]}
              disableRowSelectionOnClick
              sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' }, '& .MuiDataGrid-columnHeaders': { bgcolor: alpha(BRAND, 0.04) } }} />
          </Box>
        )}

        {/* ── Excel / Sheet ── */}
        {view === 'sheet' && (
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
                  <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => goOrder(r)}>
                    <TableCell sx={{ color: 'text.disabled' }}>{i + 1}</TableCell>
                    {COLS.map((c) => (
                      <TableCell key={c.key} align={c.num ? 'right' : 'left'}>
                        {c.key === 'carryOutQty' ? <Carry v={r.carryOutQty} />
                          : c.get ? c.get(r)
                          : c.num ? num(r[c.key]) : (r[c.key] || '—')}
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
        {view === 'cards' && (
          <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 1.5 }}>
            {rows.map((r) => {
              const s = st(r.status);
              return (
                <Paper key={r.id} variant="outlined" onClick={() => goOrder(r)} sx={{ p: 1.5, borderRadius: 2, cursor: 'pointer', borderLeft: `4px solid ${s.color}`, '&:hover': { boxShadow: 3 } }}>
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
                      { k: 'Plan', v: num(r.effectivePlannedQty), c: BRAND_DK },
                      { k: 'Actual', v: num(r.actualQty), c: '#0f766e' },
                      { k: 'Remain', v: num(r.pendingQty), c: r.pendingQty > 0 ? '#b45309' : '#64748b' },
                    ].map((x) => (
                      <Box key={x.k} sx={{ flex: 1, minWidth: 60, textAlign: 'center', p: 0.5, borderRadius: 1, bgcolor: alpha(x.c, 0.06) }}>
                        <Typography sx={{ fontWeight: 800, fontSize: '0.85rem', color: x.c }}>{x.v}</Typography>
                        <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>{x.k}</Typography>
                      </Box>
                    ))}
                  </Stack>
                  {Number(r.carryOutQty || 0) !== 0 && (
                    <Typography sx={{ mt: 0.75, fontSize: '0.68rem', fontWeight: 700 }}>
                      Carries forward: <Carry v={r.carryOutQty} />
                    </Typography>
                  )}
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
        {view === 'board' && (
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
                      <Paper key={r.id} variant="outlined" onClick={() => goOrder(r)} sx={{ p: 1.25, borderRadius: 2, cursor: 'pointer', borderLeft: `3px solid ${s.color}` }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography sx={{ fontWeight: 800, fontSize: '0.78rem', color: BRAND_DK }}>{r.soNumber} · {r.phaseNo}</Typography>
                          {r.delayDays > 0 && <Chip size="small" label={`${r.delayDays}d`} sx={{ height: 16, fontSize: '0.58rem', fontWeight: 800, bgcolor: alpha('#be123c', 0.1), color: '#be123c' }} />}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" display="block" noWrap>{r.partyName} · {r.skuName}</Typography>
                        <Typography sx={{ fontSize: '0.7rem', mt: 0.5 }}>
                          <b style={{ color: '#0f766e' }}>{num(r.actualQty)}</b> / {num(r.effectivePlannedQty)} · rem <b style={{ color: r.pendingQty > 0 ? '#b45309' : '#64748b' }}>{num(r.pendingQty)}</b> · {dd(r.plannedDate)}
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
    </Box>
  );
};

export default PlanVsActualMaster;
