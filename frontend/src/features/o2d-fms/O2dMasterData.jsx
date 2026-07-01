import React, { useState, useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Tabs, Tab, Chip, alpha, useTheme,
  ToggleButtonGroup, ToggleButton, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, MenuItem, InputAdornment,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Database, Table as TableIcon, Rows3, LayoutGrid, Columns3, Search } from 'lucide-react';
import dayjs from 'dayjs';
import { useGetOrderIntakesQuery } from '../../store/api/orderIntakeApi';
import { useGetOrdersQuery } from '../../store/api/orderApi';
import { useGetChallansQuery, useGetSchedulesQuery } from '../../store/api/dispatchControlApi';
import { useGetSalesInvoicesQuery } from '../../store/api/salesInvoiceApi';
import { useGetPaymentsQuery, useGetTransportBillsQuery } from '../../store/api/o2dFulfillmentApi';

const num = (n) => (Number(n || 0)).toLocaleString('en-IN');
const dt = (d) => (d ? dayjs(d).format('DD MMM YYYY · hh:mm A') : '—');
const dd = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
const col = (field, headerName, extra = {}) => ({ field, headerName, flex: 1, minWidth: 120, sortable: true, ...extra });

// One column set per O2D step (mirrors the client's sheet tabs).
const COLUMNS = {
  intake: [
    col('createdAt', 'Timestamp', { minWidth: 180, valueGetter: (v, r) => dt(r.createdAt) }),
    col('partyName', "Party's Name", { minWidth: 180 }),
    col('channel', 'Channel', { minWidth: 110 }),
    col('contactName', 'Contact', { minWidth: 120, valueGetter: (v, r) => r.contactName || '—' }),
    col('items', 'Items', { minWidth: 220, sortable: false, valueGetter: (v, r) => (r.items || []).map((i) => `${i.skuName} (${num(i.qty)})`).join(', ') || '—' }),
    col('intakeStatus', 'Status', { minWidth: 110 }),
    col('createdByName', 'Logged By', { minWidth: 130, valueGetter: (v, r) => r.createdByName || r.createdBy?.name || 'System' }),
  ],
  so: [
    col('soNumber', 'SO Number', { minWidth: 150 }),
    col('poNumber', 'PO Number', { minWidth: 130 }),
    col('partyName', 'Party', { minWidth: 170 }),
    col('location', 'Location', { minWidth: 120 }),
    col('orderDate', 'Order Date', { minWidth: 120, valueGetter: (v, r) => dd(r.orderDate) }),
    col('totalOrderQty', 'Order Qty', { minWidth: 100, type: 'number', valueGetter: (v, r) => Number(r.totalOrderQty || 0) }),
    col('totalDispatchedQty', 'Dispatched', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.totalDispatchedQty || 0) }),
    col('totalBalanceQty', 'Balance', { minWidth: 100, type: 'number', valueGetter: (v, r) => Number(r.totalBalanceQty || 0) }),
    col('status', 'Status', { minWidth: 120 }),
  ],
  plan: [
    col('soNumber', 'SO Number', { minWidth: 150 }),
    col('poNumber', 'PO Number', { minWidth: 130 }),
    col('partyName', 'Party', { minWidth: 170 }),
    col('skuCount', 'SKUs', { minWidth: 80, type: 'number', valueGetter: (v, r) => (r.items || []).length }),
    col('phaseCount', 'Phases', { minWidth: 80, type: 'number', valueGetter: (v, r) => (r.items || []).reduce((s, it) => s + (it.phases || []).length, 0) }),
    col('totalPlanned', 'Planned Qty', { minWidth: 110, type: 'number', valueGetter: (v, r) => (r.items || []).reduce((s, it) => s + (it.phases || []).reduce((p, ph) => p + Number(ph.plannedQty || 0), 0), 0) }),
    col('poDate', 'PO Date', { minWidth: 120, valueGetter: (v, r) => dd(r.poDate) }),
    col('status', 'Status', { minWidth: 110 }),
  ],
  dispatch: [
    col('dcNumber', 'DC Number', { minWidth: 150 }),
    col('dcDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.dcDate) }),
    col('partyName', 'Party', { minWidth: 160 }),
    col('soNumber', 'SO / PO', { minWidth: 150, valueGetter: (v, r) => `${r.soNumber || '—'}${r.poNumber ? ` / ${r.poNumber}` : ''}` }),
    col('phase', 'Phase', { minWidth: 100, valueGetter: (v, r) => (
      r.isUnplanned
        ? 'Unplanned'
        : ([...new Set((r.phaseRefs || []).map((x) => x.phaseNo).filter(Boolean))].join(', ') || r.phaseRef?.phaseNo || '—')
    ) }),
    col('totalQuantityPcs', 'Qty (pcs)', { minWidth: 100, type: 'number', valueGetter: (v, r) => Number(r.totalQuantityPcs || 0) }),
    col('totalBoxes', 'Boxes', { minWidth: 80, type: 'number', valueGetter: (v, r) => Number(r.totalBoxes || 0) }),
    col('transporterName', 'Transporter', { minWidth: 140, valueGetter: (v, r) => r.transporterName || '—' }),
    col('invoiceNo', 'Invoice No', { minWidth: 130, valueGetter: (v, r) => r.invoiceNo || '—' }),
    col('status', 'Status', { minWidth: 110 }),
  ],
  invoice: [
    col('invoiceNo', 'Invoice No', { minWidth: 150 }),
    col('invoiceDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.invoiceDate) }),
    col('partyName', 'Party', { minWidth: 160 }),
    col('invoiceAmount', 'Amount ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.invoiceAmount || 0) }),
    col('amountReceived', 'Received ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.amountReceived || 0) }),
    col('balance', 'Balance ₹', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.balance || 0) }),
    col('dcNumber', 'DC No', { minWidth: 130, valueGetter: (v, r) => r.dcNumber || '—' }),
    col('transporterName', 'Transporter', { minWidth: 140, valueGetter: (v, r) => r.transporterName || '—' }),
    col('status', 'Status', { minWidth: 110 }),
  ],
  // 2.10 — Payment Follow-up (Payment.followUp)
  paymentFollowup: [
    col('partyName', 'Party', { minWidth: 170 }),
    col('dcNumber', 'DC No', { minWidth: 130, valueGetter: (v, r) => r.dcNumber || '—' }),
    col('type', 'Type', { minWidth: 140, valueGetter: (v, r) => r.type || '—' }),
    col('followUpStatus', 'Follow-up', { minWidth: 120, valueGetter: (v, r) => r.followUp?.status || 'PENDING' }),
    col('followedOn', 'Followed On', { minWidth: 130, valueGetter: (v, r) => dd(r.followUp?.actual) }),
    col('followDelay', 'Delay', { minWidth: 100, valueGetter: (v, r) => r.followUp?.timeDelay || '—' }),
  ],
  // 2.11 — Receive Payment & Tally (Payment.confirmation)
  paymentReceipt: [
    col('partyName', 'Party', { minWidth: 170 }),
    col('dcNumber', 'DC No', { minWidth: 130, valueGetter: (v, r) => r.dcNumber || '—' }),
    col('receivedAmount', 'Received ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.confirmation?.receivedAmount || 0) }),
    col('receivedDate', 'Received On', { minWidth: 130, valueGetter: (v, r) => dd(r.confirmation?.receivedDate) }),
    col('confirmation', 'Confirmed', { minWidth: 120, valueGetter: (v, r) => r.confirmation?.status || 'PENDING' }),
  ],
  // 2.12 — Receive Transport Bill (TransportBill.receipt)
  transportReceipt: [
    col('dcNumber', 'DC No', { minWidth: 150, valueGetter: (v, r) => r.dcNumber || '—' }),
    col('receiptStatus', 'Bill Received', { minWidth: 140, valueGetter: (v, r) => r.receipt?.status || 'PENDING' }),
    col('receiptOn', 'Received On', { minWidth: 170, valueGetter: (v, r) => dt(r.receipt?.actual) }),
  ],
  // 2.13 — Transport Bill Payment (TransportBill.payment)
  transportPayment: [
    col('dcNumber', 'DC No', { minWidth: 150, valueGetter: (v, r) => r.dcNumber || '—' }),
    col('paymentStatus', 'Bill Paid', { minWidth: 130, valueGetter: (v, r) => r.payment?.status || 'PENDING' }),
    col('paymentOn', 'Paid On', { minWidth: 170, valueGetter: (v, r) => dt(r.payment?.actual) }),
  ],
};

const TABS = [
  { key: 'intake', label: 'Order Intake · 1.01' },
  { key: 'so', label: 'Sales Orders · 2.02' },
  { key: 'plan', label: 'Dispatch Plans · 2.04' },
  { key: 'dispatch', label: 'Actual Dispatch · 2.06' },
  { key: 'invoice', label: 'Invoices · 2.07' },
  { key: 'paymentFollowup', label: 'Payment Follow-up · 2.10' },
  { key: 'paymentReceipt', label: 'Receive Payment · 2.11' },
  { key: 'transportReceipt', label: 'Transport Bill · 2.12' },
  { key: 'transportPayment', label: 'Transport Payment · 2.13' },
];

// Compute a column's display value for the non-grid views (sheet / cards / board).
const displayVal = (c, row) => {
  const raw = c.valueGetter ? c.valueGetter(undefined, row) : row[c.field];
  return typeof raw === 'number' ? num(raw) : (raw ?? '—');
};
// Status accessor per step — used to group records in the Board view.
const statusOf = (tab, row) => ({
  intake: row.intakeStatus,
  so: row.status, plan: row.status, dispatch: row.status, invoice: row.status,
  paymentFollowup: row.followUp?.status,
  paymentReceipt: row.confirmation?.status,
  transportReceipt: row.receipt?.status,
  transportPayment: row.payment?.status,
}[tab]) || 'PENDING';

const VIEWS = [
  { key: 'table', label: 'Table', icon: TableIcon },
  { key: 'sheet', label: 'Sheet', icon: Rows3 },
  { key: 'cards', label: 'Cards', icon: LayoutGrid },
  { key: 'board', label: 'Board', icon: Columns3 },
];

/**
 * O2D Master Data — a per-step data view (one tab per O2D step) mirroring the
 * client's sheet tabs: every entry shown with its full columns (who/what/when).
 * Switch between Table / Sheet / Cards / Board views. Read-only.
 */
const O2dMasterData = () => {
  const theme = useTheme();
  const [tab, setTab] = useState('intake');
  const [view, setView] = useState('table');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const switchTab = (t) => { setTab(t); setSearch(''); setStatusFilter(''); };

  // Only the active tab fetches (skip the rest) — fast and cache-friendly.
  const intakeQ = useGetOrderIntakesQuery({ limit: 500, sort: '-createdAt' }, { skip: tab !== 'intake' });
  const soQ = useGetOrdersQuery({ limit: 1000, sort: '-orderDate' }, { skip: tab !== 'so' });
  const planQ = useGetSchedulesQuery({ limit: 1000, sort: '-updatedAt' }, { skip: tab !== 'plan' });
  const dcQ = useGetChallansQuery({ limit: 1000, sort: '-dcDate' }, { skip: tab !== 'dispatch' });
  const invQ = useGetSalesInvoicesQuery({ limit: 1000, sort: '-invoiceDate' }, { skip: tab !== 'invoice' });
  const payQ = useGetPaymentsQuery(undefined, { skip: tab !== 'paymentFollowup' && tab !== 'paymentReceipt' });
  const tbQ = useGetTransportBillsQuery(undefined, { skip: tab !== 'transportReceipt' && tab !== 'transportPayment' });

  const current = {
    intake: intakeQ, so: soQ, plan: planQ, dispatch: dcQ, invoice: invQ,
    paymentFollowup: payQ, paymentReceipt: payQ,
    transportReceipt: tbQ, transportPayment: tbQ,
  }[tab];
  const columns = COLUMNS[tab];
  const rawRows = useMemo(() => current?.data?.data || [], [current]);

  // Distinct statuses present (for the status filter dropdown).
  const statuses = useMemo(() => [...new Set(rawRows.map((r) => statusOf(tab, r)).filter(Boolean))], [rawRows, tab]);

  // Apply status filter + free-text search (matches any visible column).
  const rows = useMemo(() => {
    let list = rawRows;
    if (statusFilter) list = list.filter((r) => statusOf(tab, r) === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => columns.some((c) => String(displayVal(c, r)).toLowerCase().includes(q)));
    return list;
  }, [rawRows, statusFilter, search, tab, columns]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Hero (compact) */}
      <Box sx={{ color: '#fff', px: { xs: 2, md: 3 }, pt: { xs: 1.75, md: 2 }, pb: { xs: 2.5, md: 3 },
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)' }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ width: 36, height: 36, borderRadius: 2, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
            <Database size={18} color="#fff" />
          </Box>
          <Box>
            <Typography sx={{ color: '#fff', fontSize: { xs: '1.05rem', md: '1.2rem' }, fontWeight: 800, lineHeight: 1.1 }}>O2D Master Data</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.72rem' }}>
              Every entry, step by step — who filled what, when. One tab per O2D step.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.5, md: 3 }, mt: { xs: -1.5, md: -1.75 }, position: 'relative', pb: 6 }}>
        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Tabs value={tab} onChange={(_, v) => switchTab(v)} variant="scrollable" scrollButtons="auto"
            sx={{ borderBottom: `1px solid ${theme.palette.divider}`, minHeight: 36, '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', fontSize: '0.72rem', minHeight: 36, py: 0.25, minWidth: 'auto', px: 1.5 } }}>
            {TABS.map((t) => <Tab key={t.key} value={t.key} label={t.label} />)}
          </Tabs>

          {/* Compact toolbar: search · status · count · view */}
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, flexWrap: 'wrap', borderBottom: `1px solid ${theme.palette.divider}` }}>
            <TextField
              size="small" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              sx={{ width: { xs: '100%', sm: 240 }, '& .MuiInputBase-root': { height: 34 } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> }}
            />
            <TextField
              select size="small" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              sx={{ width: 150, '& .MuiInputBase-root': { height: 34 } }} displayEmpty
              SelectProps={{ displayEmpty: true, renderValue: (v) => (v || 'All statuses') }}
            >
              <MenuItem value="">All statuses</MenuItem>
              {statuses.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
              {rows.length}{statusFilter || search ? ` / ${rawRows.length}` : ''} record{rows.length === 1 ? '' : 's'}
            </Typography>
            <Box sx={{ flex: 1 }} />
            {/* Icon-only view switcher — compact */}
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
              {VIEWS.map((vw) => (
                <ToggleButton key={vw.key} value={vw.key} title={vw.label} sx={{ px: 1, py: 0.4 }}>
                  <vw.icon size={15} />
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>

          {/* ── Table view (DataGrid) ── */}
          {view === 'table' && (
            <Box sx={{ px: 1.5, pb: 1.5 }}>
              <DataGrid
                rows={rows} columns={columns} getRowId={(r) => r._id} loading={current?.isFetching}
                autoHeight density="compact"
                initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                pageSizeOptions={[25, 50, 100]} disableRowSelectionOnClick
                sx={{ border: 0, '& .MuiDataGrid-columnHeaders': { bgcolor: alpha(theme.palette.primary.main, 0.04) } }}
              />
            </Box>
          )}

          {/* ── Sheet view (dense spreadsheet) ── */}
          {view === 'sheet' && (
            <Box sx={{ px: 1.5, pb: 1.5, overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 720, '& td, & th': { border: `1px solid ${theme.palette.divider}`, fontSize: '0.78rem', px: 1, py: 0.6, whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.06) }}>
                    <TableCell sx={{ fontWeight: 800 }}>#</TableCell>
                    {columns.map((c) => <TableCell key={c.field} sx={{ fontWeight: 800 }}>{c.headerName}</TableCell>)}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={row._id} hover>
                      <TableCell sx={{ color: 'text.disabled' }}>{i + 1}</TableCell>
                      {columns.map((c) => <TableCell key={c.field}>{displayVal(c, row)}</TableCell>)}
                    </TableRow>
                  ))}
                  {rows.length === 0 && <TableRow><TableCell colSpan={columns.length + 1} sx={{ textAlign: 'center', color: 'text.disabled', py: 3 }}>No records.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </Box>
          )}

          {/* ── Cards view ── */}
          {view === 'cards' && (
            <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 1.5 }}>
              {rows.map((row) => (
                <Paper key={row._id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '0.85rem', color: theme.palette.primary.dark, mb: 0.75 }}>
                    {displayVal(columns[0], row)}
                  </Typography>
                  <Stack spacing={0.4}>
                    {columns.slice(1).map((c) => (
                      <Stack key={c.field} direction="row" justifyContent="space-between" spacing={1}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{c.headerName}</Typography>
                        <Typography variant="caption" sx={{ fontWeight: 700, textAlign: 'right' }}>{displayVal(c, row)}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Paper>
              ))}
              {rows.length === 0 && <Typography variant="body2" color="text.disabled" sx={{ p: 2 }}>No records.</Typography>}
            </Box>
          )}

          {/* ── Board view (grouped by status) ── */}
          {view === 'board' && (
            <Box sx={{ p: 1.5, display: 'flex', gap: 1.5, overflowX: 'auto' }}>
              {(() => {
                const groups = {};
                rows.forEach((r) => { const s = statusOf(tab, r); (groups[s] = groups[s] || []).push(r); });
                const keys = Object.keys(groups);
                if (!keys.length) return <Typography variant="body2" color="text.disabled" sx={{ p: 2 }}>No records.</Typography>;
                return keys.map((s) => (
                  <Box key={s} sx={{ minWidth: 260, flex: '0 0 260px' }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, px: 0.5 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s}</Typography>
                      <Chip size="small" label={groups[s].length} sx={{ height: 18, fontSize: '0.62rem' }} />
                    </Stack>
                    <Stack spacing={1}>
                      {groups[s].map((row) => (
                        <Paper key={row._id} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
                          <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', color: theme.palette.primary.dark }}>{displayVal(columns[0], row)}</Typography>
                          {columns.slice(1, 4).map((c) => (
                            <Typography key={c.field} variant="caption" display="block" color="text.secondary">
                              {c.headerName}: <b style={{ color: theme.palette.text.primary }}>{displayVal(c, row)}</b>
                            </Typography>
                          ))}
                        </Paper>
                      ))}
                    </Stack>
                  </Box>
                ));
              })()}
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  );
};

export default O2dMasterData;
