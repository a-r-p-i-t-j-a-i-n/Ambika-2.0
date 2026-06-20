import React, { useState, useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Tabs, Tab, Chip, alpha, useTheme,
  ToggleButtonGroup, ToggleButton, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, MenuItem, InputAdornment,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Database, Table as TableIcon, Rows3, LayoutGrid, Columns3, Search } from 'lucide-react';
import dayjs from 'dayjs';
import {
  useGetIndentsQuery, useGetPurchaseOrdersQuery, useGetFollowUpsQuery,
  useGetProformaInvoicesQuery, useGetAdvancePaymentsQuery, useGetGrnsQuery,
  useGetIncomingQcsQuery, useGetVendorInvoicesQuery, useGetVouchersQuery,
  useGetTallyEntriesQuery, useGetFinalPaymentsQuery,
} from '../../store/api/procurementApi';

const num = (n) => (Number(n || 0)).toLocaleString('en-IN');
const dd = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
const col = (field, headerName, extra = {}) => ({ field, headerName, flex: 1, minWidth: 120, sortable: true, ...extra });

// One column set per Purchase FMS step (mirrors the 11 procurement screens).
const COLUMNS = {
  indent: [
    col('indentNumber', 'Indent No', { minWidth: 150 }),
    col('timestamp', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.timestamp || r.createdAt) }),
    col('vendorName', 'Vendor', { minWidth: 170, valueGetter: (v, r) => r.vendorName || '—' }),
    col('items', 'Items', { minWidth: 220, sortable: false, valueGetter: (v, r) => (r.items || []).map((i) => `${i.itemName || i.productNameRevised || i.skuCode} (${num(i.quantity)})`).join(', ') || '—' }),
    col('approvalStatus', 'Approval', { minWidth: 130 }),
    col('overallStatus', 'Stage', { minWidth: 150 }),
  ],
  po: [
    col('poNumber', 'PO Number', { minWidth: 160 }),
    col('poDate', 'PO Date', { minWidth: 120, valueGetter: (v, r) => dd(r.poDate) }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('grandTotal', 'Grand Total ₹', { minWidth: 130, type: 'number', valueGetter: (v, r) => Number(r.grandTotal || 0) }),
    col('approvalStatus', 'Approval', { minWidth: 120 }),
    col('releaseStatus', 'Release', { minWidth: 110 }),
    col('poStatus', 'PO Status', { minWidth: 130 }),
    col('expectedDeliveryDate', 'Expected', { minWidth: 120, valueGetter: (v, r) => dd(r.expectedDeliveryDate) }),
  ],
  followup: [
    col('followUpNumber', 'Follow-up No', { minWidth: 150 }),
    col('poNumber', 'PO Number', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('followUpType', 'Type', { minWidth: 120, valueGetter: (v, r) => r.followUpType || '—' }),
    col('nextFollowUpDate', 'Next Follow-up', { minWidth: 130, valueGetter: (v, r) => dd(r.nextFollowUpDate) }),
    col('finalMaterialDate', 'Material Date', { minWidth: 130, valueGetter: (v, r) => dd(r.finalMaterialDate) }),
    col('followUpStatus', 'Status', { minWidth: 120 }),
    col('performedByName', 'By', { minWidth: 130, valueGetter: (v, r) => r.performedByName || '—' }),
  ],
  pi: [
    col('piNumber', 'PI Number', { minWidth: 150 }),
    col('piDate', 'PI Date', { minWidth: 120, valueGetter: (v, r) => dd(r.piDate) }),
    col('poNumber', 'PO Number', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('totalValue', 'Total ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.totalValue || 0) }),
    col('paidAmount', 'Paid ₹', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.paidAmount || 0) }),
    col('balanceAmount', 'Balance ₹', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.balanceAmount || 0) }),
    col('piStatus', 'Status', { minWidth: 130 }),
  ],
  advance: [
    col('paymentNumber', 'Payment No', { minWidth: 150 }),
    col('paymentDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.paymentDate) }),
    col('piNumber', 'PI / PO', { minWidth: 150, valueGetter: (v, r) => `${r.piNumber || '—'}${r.poNumber ? ` / ${r.poNumber}` : ''}` }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('paidAmount', 'Paid ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.paidAmount || 0) }),
    col('balanceAmount', 'Balance ₹', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.balanceAmount || 0) }),
    col('paymentMode', 'Mode', { minWidth: 110, valueGetter: (v, r) => r.paymentMode || '—' }),
    col('paymentStatus', 'Status', { minWidth: 120 }),
  ],
  grn: [
    col('grnNumber', 'GRN Number', { minWidth: 160 }),
    col('grnDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.grnDate) }),
    col('poNumber', 'PO Number', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('totalReceivedQty', 'Received Qty', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.totalReceivedQty || 0) }),
    col('totalValue', 'Value ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.totalValue || 0) }),
    col('grnStatus', 'GRN Status', { minWidth: 130 }),
    col('qcStatus', 'QC Status', { minWidth: 120, valueGetter: (v, r) => r.qcStatus || '—' }),
  ],
  qc: [
    col('qcNumber', 'QC Number', { minWidth: 150 }),
    col('qcDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.qcDate) }),
    col('grnNumber', 'GRN Number', { minWidth: 150 }),
    col('vendorName', 'Vendor', { minWidth: 160 }),
    col('totalReceived', 'Received', { minWidth: 100, type: 'number', valueGetter: (v, r) => Number(r.totalReceived || 0) }),
    col('totalAccepted', 'Accepted', { minWidth: 100, type: 'number', valueGetter: (v, r) => Number(r.totalAccepted || 0) }),
    col('totalRejected', 'Rejected', { minWidth: 100, type: 'number', valueGetter: (v, r) => Number(r.totalRejected || 0) }),
    col('overallResult', 'Result', { minWidth: 110, valueGetter: (v, r) => r.overallResult || '—' }),
    col('qcStatus', 'Status', { minWidth: 110 }),
  ],
  vendorInvoice: [
    col('invoiceNumber', 'Invoice No', { minWidth: 150 }),
    col('invoiceDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.invoiceDate) }),
    col('poNumber', 'PO Number', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('invoiceAmount', 'Invoice ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.invoiceAmount || 0) }),
    col('netPayableAmount', 'Net Payable ₹', { minWidth: 130, type: 'number', valueGetter: (v, r) => Number(r.netPayableAmount || 0) }),
    col('invoiceStatus', 'Status', { minWidth: 140 }),
  ],
  voucher: [
    col('voucherNumber', 'Voucher No', { minWidth: 150 }),
    col('voucherDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.voucherDate) }),
    col('invoiceNumber', 'Invoice No', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('netPayableAmount', 'Net Payable ₹', { minWidth: 130, type: 'number', valueGetter: (v, r) => Number(r.netPayableAmount || 0) }),
    col('paidAmount', 'Paid ₹', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.paidAmount || 0) }),
    col('balanceAmount', 'Balance ₹', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.balanceAmount || 0) }),
    col('voucherStatus', 'Status', { minWidth: 130 }),
  ],
  tally: [
    col('entryNumber', 'Entry No', { minWidth: 150 }),
    col('voucherNumber', 'Voucher No', { minWidth: 140 }),
    col('invoiceNumber', 'Invoice No', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('tallyVoucherNumber', 'Tally Voucher', { minWidth: 140, valueGetter: (v, r) => r.tallyVoucherNumber || '—' }),
    col('tallyLedgerName', 'Ledger', { minWidth: 140, valueGetter: (v, r) => r.tallyLedgerName || '—' }),
    col('tallyEntryStatus', 'Status', { minWidth: 120 }),
  ],
  final: [
    col('paymentNumber', 'Payment No', { minWidth: 150 }),
    col('paymentDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.paymentDate) }),
    col('voucherNumber', 'Voucher No', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('paidAmount', 'Paid ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.paidAmount || 0) }),
    col('balanceAfterPayment', 'Balance ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.balanceAfterPayment || 0) }),
    col('paymentMode', 'Mode', { minWidth: 110, valueGetter: (v, r) => r.paymentMode || '—' }),
    col('paymentStatus', 'Status', { minWidth: 120 }),
  ],
};

const TABS = [
  { key: 'indent',        label: 'Indents · 1.1–1.3' },
  { key: 'po',            label: 'Purchase Orders · 1.4' },
  { key: 'followup',      label: 'Follow-ups · 1.5' },
  { key: 'pi',            label: 'PI Forms · 1.6' },
  { key: 'advance',       label: 'Advance Payments · 1.7' },
  { key: 'grn',           label: 'GRN · 1.8' },
  { key: 'qc',            label: 'Incoming QC · 1.9' },
  { key: 'vendorInvoice', label: 'Vendor Invoices · 1.10' },
  { key: 'voucher',       label: 'Vouchers · 1.11' },
  { key: 'tally',         label: 'Tally Entries · 1.12' },
  { key: 'final',         label: 'Final Payments · 1.13' },
];

// Compute a column's display value for the non-grid views (sheet / cards / board).
const displayVal = (c, row) => {
  const raw = c.valueGetter ? c.valueGetter(undefined, row) : row[c.field];
  return typeof raw === 'number' ? num(raw) : (raw ?? '—');
};
// Status accessor per step — used to group records in the Board view.
const statusOf = (tab, row) => ({
  indent: row.overallStatus || row.approvalStatus,
  po: row.poStatus,
  followup: row.followUpStatus,
  pi: row.piStatus,
  advance: row.paymentStatus,
  grn: row.grnStatus,
  qc: row.qcStatus,
  vendorInvoice: row.invoiceStatus,
  voucher: row.voucherStatus,
  tally: row.tallyEntryStatus,
  final: row.paymentStatus,
}[tab]) || 'PENDING';

const VIEWS = [
  { key: 'table', label: 'Table', icon: TableIcon },
  { key: 'sheet', label: 'Sheet', icon: Rows3 },
  { key: 'cards', label: 'Cards', icon: LayoutGrid },
  { key: 'board', label: 'Board', icon: Columns3 },
];

/**
 * Purchase Master Data — a per-step data view (one tab per Purchase FMS step),
 * mirroring the O2D Master Data page: every entry shown with its full columns
 * (vendor / amounts / dates / status). Switch Table / Sheet / Cards / Board. Read-only.
 */
const PurchaseMasterData = () => {
  const theme = useTheme();
  const [tab, setTab] = useState('indent');
  const [view, setView] = useState('table');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const switchTab = (t) => { setTab(t); setSearch(''); setStatusFilter(''); };

  // Only the active tab fetches (skip the rest) — fast and cache-friendly.
  const P = { limit: 1000, sort: '-createdAt' };
  const indentQ = useGetIndentsQuery(P, { skip: tab !== 'indent' });
  const poQ = useGetPurchaseOrdersQuery(P, { skip: tab !== 'po' });
  const followQ = useGetFollowUpsQuery(P, { skip: tab !== 'followup' });
  const piQ = useGetProformaInvoicesQuery(P, { skip: tab !== 'pi' });
  const advQ = useGetAdvancePaymentsQuery(P, { skip: tab !== 'advance' });
  const grnQ = useGetGrnsQuery(P, { skip: tab !== 'grn' });
  const qcQ = useGetIncomingQcsQuery(P, { skip: tab !== 'qc' });
  const viQ = useGetVendorInvoicesQuery(P, { skip: tab !== 'vendorInvoice' });
  const vouQ = useGetVouchersQuery(P, { skip: tab !== 'voucher' });
  const tallyQ = useGetTallyEntriesQuery(P, { skip: tab !== 'tally' });
  const finalQ = useGetFinalPaymentsQuery(P, { skip: tab !== 'final' });

  const current = {
    indent: indentQ, po: poQ, followup: followQ, pi: piQ, advance: advQ, grn: grnQ,
    qc: qcQ, vendorInvoice: viQ, voucher: vouQ, tally: tallyQ, final: finalQ,
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
      {/* Hero */}
      <Box sx={{ color: '#fff', px: { xs: 3, md: 5 }, pt: { xs: 4, md: 5 }, pb: { xs: 5, md: 7 },
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)' }}>
        <Stack direction="row" spacing={2.5} alignItems="center">
          <Box sx={{ width: 52, height: 52, borderRadius: 2.5, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
            <Database size={26} color="#fff" />
          </Box>
          <Box>
            <Typography sx={{ color: '#fff', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 800 }}>Purchase Master Data</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.95rem', mt: 0.5 }}>
              Every procurement entry, step by step — vendor, amounts, dates &amp; status. One tab per Purchase FMS step.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.5, md: 3 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Tabs value={tab} onChange={(_, v) => switchTab(v)} variant="scrollable" scrollButtons="auto"
            sx={{ borderBottom: `1px solid ${theme.palette.divider}`, minHeight: 40, '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', fontSize: '0.78rem', minHeight: 40, py: 0.5 } }}>
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
              sx={{ width: 160, '& .MuiInputBase-root': { height: 34 } }} displayEmpty
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

export default PurchaseMasterData;
