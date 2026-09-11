import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Grid, Tooltip, Autocomplete,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, MoreVertical, Eye, Pencil, CheckCircle2, FileDown,
  ReceiptText, Hourglass, BadgeCheck, Wallet, CheckCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useGetVendorInvoicesQuery,
  useGetVendorInvoiceStatsQuery,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { InvoiceStatusChip, INVOICE_STATUSES, fmtINR, fmtDate } from './invoiceMeta';
import VendorInvoiceFormDialog from './VendorInvoiceFormDialog';
import VendorInvoiceApprovalDialog from './VendorInvoiceApprovalDialog';
import { resolveFileUrl } from '../../../utils/fileUrl';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx } from '../pfmsTheme';

const VendorInvoiceList = () => {
  const navigate = useNavigate();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editInv, setEditInv] = useState(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [activeInv, setActiveInv] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

  const queryArgs = {
    page: paginationModel.page + 1, limit: paginationModel.pageSize, sort: '-createdAt',
    search: search || undefined, vendorId: vendorFilter?._id || undefined, invoiceStatus: statusFilter || undefined,
    ...(from ? { 'invoiceDate[gte]': `${from}T00:00:00` } : {}), ...(to ? { 'invoiceDate[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetVendorInvoicesQuery(queryArgs);
  const { data: statsRes } = useGetVendorInvoiceStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };
  const onView = (r) => { navigate(`/procurement/vendor-invoices/${r._id}`); closeMenu(); };
  const onEdit = (r) => { setEditInv(r); setFormOpen(true); closeMenu(); };
  const onApprove = (r) => { setActiveInv(r); setApprovalOpen(true); closeMenu(); };
  const onDoc = (r) => { window.open(resolveFileUrl(r.invoiceDocument), '_blank', 'noopener,noreferrer'); closeMenu(); };

  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    if (['DRAFT', 'RECEIVED', 'APPROVED', 'PAYMENT_PENDING'].includes(r.invoiceStatus)) {
      a.push({ key: 'edit', label: 'Edit', icon: <Pencil size={16} />, fn: () => onEdit(r) });
    }
    if (['DRAFT', 'RECEIVED'].includes(r.invoiceStatus)) {
      a.push({ key: 'approve', label: 'Approve / Reject', icon: <CheckCircle2 size={16} />, fn: () => onApprove(r) });
    }
    if (r.invoiceDocument?.fileUrl) a.push({ key: 'doc', label: 'View Document', icon: <FileDown size={16} />, fn: () => onDoc(r) });
    return a;
  };

  const columns = [
    { field: 'invoiceNumber', headerName: 'INVOICE NO', width: 140, renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'invoiceDate', headerName: 'DATE', width: 95, renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'grnNumber', headerName: 'GRN', width: 150, sortable: false,
      renderCell: (p) => {
        const list = (p.row.grnNumbers?.length ? p.row.grnNumbers : [p.row.grnNumber]).filter(Boolean);
        if (!list.length) return <Typography variant="body2" color="text.disabled">—</Typography>;
        return (
          <Typography variant="body2" fontWeight={600} noWrap>
            {list[0]}{list.length > 1 ? <Typography component="span" variant="caption" color="text.secondary"> +{list.length - 1} more</Typography> : null}
          </Typography>
        );
      } },
    { field: 'poNumber', headerName: 'PO', width: 130, renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value || '—'}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 150, renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    { field: 'invoiceAmount', headerName: 'INVOICE AMT', width: 120, align: 'right', headerAlign: 'right', renderCell: (p) => fmtINR(p.value) },
    { field: 'advancePaid', headerName: 'ADVANCE', width: 110, align: 'right', headerAlign: 'right', renderCell: (p) => <Typography variant="body2" sx={{ color: '#0f766e' }}>{fmtINR(p.value)}</Typography> },
    { field: 'netPayableAmount', headerName: 'NET PAYABLE', width: 125, align: 'right', headerAlign: 'right', renderCell: (p) => <Typography variant="body2" fontWeight={700} sx={{ color: '#b45309' }}>{fmtINR(p.value)}</Typography> },
    { field: 'invoiceStatus', headerName: 'STATUS', width: 160, renderCell: (p) => <InvoiceStatusChip status={p.value} /> },
    { field: '__actions', headerName: '', width: 60, sortable: false, filterable: false, align: 'center', renderCell: (p) => <Tooltip title="Actions"><IconButton size="small" onClick={(e) => openMenu(e, p.row)}><MoreVertical size={16} /></IconButton></Tooltip> },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, ...pfmsPageSx }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={pfmsTitleSx}>Vendor Invoices ({stats.total || 0})</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>Step 1.10 · Invoice / Debit Note received — only after QC PASSED / PARTIAL</Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => { setEditInv(null); setFormOpen(true); }}>New Invoice</Button>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<ReceiptText size={20} />} label="Total"            value={stats.total}            color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Hourglass size={20} />}   label="Pending Approval" value={stats.pendingApproval}  color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<BadgeCheck size={20} />}  label="Approved"         value={stats.approved}         color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Wallet size={20} />}      label="Payment Pending"  value={stats.paymentPending}   color="#0e7490" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<CheckCheck size={20} />}  label="Payment Done"     value={stats.paymentCompleted} color="#16a34a" /></Grid>
      </Grid>

      <Paper sx={{ ...pfmsCardSx, p: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search invoice / GRN / vendor…" value={search} onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 240 } }} InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
        <Autocomplete size="small" sx={{ minWidth: 190 }} options={partiesRes?.data || []} value={vendorFilter}
          getOptionLabel={(o) => o?.name || ''} isOptionEqualToValue={(o, v) => o._id === v._id} onChange={(_e, v) => setVendorFilter(v)} renderInput={(params) => <TextField {...params} label="Vendor" />} />
        <TextField size="small" select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 170 }}>
          <MenuItem value="">All</MenuItem>
          {INVOICE_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
        </TextField>
        <DateInputDDMMYYYY size="small" label="From" value={from} onChange={setFrom} />
        <DateInputDDMMYYYY size="small" label="To" value={to} onChange={setTo} />
      </Paper>

      <Paper sx={{ ...pfmsCardSx, flexGrow: 1, minHeight: 420, overflow: 'hidden' }}>
        <DataGrid rows={data?.data || []} columns={columns} getRowId={(r) => r._id} loading={isLoading || isFetching}
          paginationMode="server" rowCount={data?.meta?.total || 0} paginationModel={paginationModel} onPaginationModelChange={setPaginationModel}
          onRowClick={(p) => navigate(`/procurement/vendor-invoices/${p.id}`)} pageSizeOptions={[10, 25, 50, 100]} disableRowSelectionOnClick
          rowHeight={50} columnHeaderHeight={44} sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }} />
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && actionsFor(menuRow).map((a) => (
          <MenuItem key={a.key} onClick={a.fn}><ListItemIcon>{a.icon}</ListItemIcon><ListItemText>{a.label}</ListItemText></MenuItem>
        ))}
      </Menu>

      <VendorInvoiceFormDialog open={formOpen} invoice={editInv} onClose={() => { setFormOpen(false); setEditInv(null); }} />
      <VendorInvoiceApprovalDialog open={approvalOpen} invoice={activeInv} onClose={() => { setApprovalOpen(false); setActiveInv(null); }} />
    </Box>
  );
};

export default VendorInvoiceList;
