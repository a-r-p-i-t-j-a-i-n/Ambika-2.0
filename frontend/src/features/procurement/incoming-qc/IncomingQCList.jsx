import React, { useState } from 'react';
import { serialColumn } from '../components/serialNumber';
import { stepTimingColumns } from '../components/stepTimingColumns';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Grid, Tooltip, Autocomplete,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, MoreVertical, Eye, Pencil, ClipboardCheck, Ban, FileDown,
  ShieldCheck, Hourglass, BadgeCheck, ShieldX, ShieldAlert,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetIncomingQcsQuery,
  useGetIncomingQcStatsQuery,
  useCancelIncomingQcMutation,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { QcStatusChip, QcResultChip, QC_STATUSES, QC_RESULTS, fmtDate } from './qcMeta';
import IncomingQCFormDialog from './IncomingQCFormDialog';
import IncomingQCCompleteDialog from './IncomingQCCompleteDialog';
import { resolveFileUrl } from '../../../utils/fileUrl';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';

import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
const sumQty = (items, key) => (items || []).reduce((s, it) => s + (Number(it[key]) || 0), 0);

const IncomingQCList = () => {
  const navigate = useNavigate();
  const rowNav = useRowNavigation({ to: (r) => `/procurement/incoming-qc/${r._id}` });
  const { enqueueSnackbar } = useSnackbar();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };

  // "Filters" covers Vendor, Result and the date range — QC Status stays
  // always visible.
  const secondaryCount = [vendorFilter, resultFilter, from, to].filter(Boolean).length;
  const clearSecondary = () => { setVendorFilter(null); setResultFilter(''); setFrom(''); setTo(''); resetPage(); };
  const anyFilterActive = Boolean(search || statusFilter || secondaryCount);
  const clearAll = () => { resetSearch(); setStatusFilter(''); clearSecondary(); };

  const [formOpen, setFormOpen] = useState(false);
  const [editQc, setEditQc] = useState(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [activeQc, setActiveQc] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

  const queryArgs = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    sort: '-createdAt',
    search: search || undefined,
    vendorId: vendorFilter?._id || undefined,
    qcStatus: statusFilter || undefined,
    overallResult: resultFilter || undefined,
    ...(from ? { 'qcDate[gte]': `${from}T00:00:00` } : {}),
    ...(to ? { 'qcDate[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetIncomingQcsQuery(queryArgs);
  const { data: statsRes } = useGetIncomingQcStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });
  const [cancelQc] = useCancelIncomingQcMutation();

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };

  const onView = (r) => { navigate(`/procurement/incoming-qc/${r._id}`); closeMenu(); };
  const onEdit = (r) => { setEditQc(r); setFormOpen(true); closeMenu(); };
  const onComplete = (r) => { setActiveQc(r); setCompleteOpen(true); closeMenu(); };
  const onPdf = (r) => { window.open(resolveFileUrl(r.qcPdfUrl), '_blank'); closeMenu(); };
  const onCancel = async (r) => {
    closeMenu();
    try { await cancelQc({ id: r._id }).unwrap(); enqueueSnackbar('QC cancelled', { variant: 'info' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  // A GRN's QC is entered on the GRN page (directly under the GRN), so a GRN
  // draft is resumed there; service QCs (no GRN) keep editing from here.
  const onResumeOnGrn = (r) => { navigate(`/procurement/grns/${r.grnId}#qc`); closeMenu(); };

  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    if (['DRAFT', 'IN_PROGRESS'].includes(r.qcStatus)) {
      if (r.grnId) {
        a.push({ key: 'resume', label: 'Resume on GRN page', icon: <ClipboardCheck size={16} />, fn: () => onResumeOnGrn(r) });
      } else {
        a.push({ key: 'edit', label: 'Edit', icon: <Pencil size={16} />, fn: () => onEdit(r) });
        a.push({ key: 'complete', label: 'Complete QC', icon: <ClipboardCheck size={16} />, fn: () => onComplete(r) });
      }
      a.push({ key: 'cancel', label: 'Cancel', icon: <Ban size={16} />, fn: () => onCancel(r) });
    }
    if (r.qcPdfUrl) a.push({ key: 'pdf', label: 'Download QC Report', icon: <FileDown size={16} />, fn: () => onPdf(r) });
    return a;
  };

  const columns = [
    serialColumn(),
    { field: 'qcNumber', headerName: 'QC NUMBER', width: 140, renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'qcDate', headerName: 'QC DATE', width: 95, renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'grnNumber', headerName: 'GRN NUMBER', width: 140, renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography> },
    { field: 'poNumber', headerName: 'PO NUMBER', width: 130,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.row.grnId && !p.value ? 'Without PO' : (p.value || '—')}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 150, renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    { field: 'items', headerName: 'ITEMS', width: 70, align: 'right', headerAlign: 'right', sortable: false, valueGetter: (_v, row) => (row.items || []).length },
    { field: 'totalReceived', headerName: 'RECEIVED', width: 95, align: 'right', headerAlign: 'right' },
    { field: 'totalAccepted', headerName: 'ACCEPTED', width: 95, align: 'right', headerAlign: 'right', renderCell: (p) => <Typography variant="body2" sx={{ color: '#0f766e', fontWeight: 700 }}>{p.value}</Typography> },
    { field: 'totalRejected', headerName: 'REJECTED', width: 95, align: 'right', headerAlign: 'right', renderCell: (p) => <Typography variant="body2" sx={{ color: p.value > 0 ? '#be123c' : 'text.secondary', fontWeight: p.value > 0 ? 700 : 400 }}>{p.value}</Typography> },
    { field: 'overallResult', headerName: 'RESULT', width: 125, renderCell: (p) => <QcResultChip result={p.value} /> },
    { field: 'qcStatus', headerName: 'STATUS', width: 125, renderCell: (p) => <QcStatusChip status={p.value} /> },
    ...stepTimingColumns(),
    { field: '__actions', headerName: '', width: 60, sortable: false, filterable: false, align: 'center',
      renderCell: (p) => <Tooltip title="Actions"><IconButton size="small" onClick={(e) => openMenu(e, p.row)}><MoreVertical size={16} /></IconButton></Tooltip> },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, ...pfmsPageSx }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={pfmsTitleSx}>QC Records ({stats.total || 0})</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>
            A GRN&apos;s QC is done on the GRN page, under the GRN · service QCs start from the indent
          </Typography>
        </Box>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<ShieldCheck size={20} />} label="Total QC"    value={stats.total}   color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Hourglass size={20} />}   label="Pending QC"  value={stats.pending} color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<BadgeCheck size={20} />}  label="Passed"      value={stats.passed}  color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<ShieldX size={20} />}     label="Failed"      value={stats.failed}  color="#be123c" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<ShieldAlert size={20} />} label="Partial"     value={stats.partial} color="#c2410c" /></Grid>
      </Grid>

      {/* Filters — Search + QC Status stay visible; Vendor, Result and the
          date range move into Filters, which only counts those as active. */}
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <AdaptiveFilterBar
          pinned={[
            { key: 'search', minWidth: 220, node: (
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 220px' }, minWidth: 0 }}>
                <Typography component="label" htmlFor="qc-search" sx={pfmsFieldLabelSx}>Search</Typography>
                <TextField id="qc-search" size="small" fullWidth placeholder="Search QC / GRN / vendor…"
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
              </Box>
            ) },
            { key: 'status', minWidth: 150, node: (
              <Box sx={{ flex: '0 1 150px', minWidth: 130 }}>
                <Typography component="label" htmlFor="qc-status" sx={pfmsFieldLabelSx}>QC Status</Typography>
                <TextField id="qc-status" size="small" select fullWidth value={statusFilter}
                  SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setStatusFilter)(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {QC_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
                </TextField>
              </Box>
            ) },
          ]}
          items={[
            {
              key: 'vendor', width: 200, active: Boolean(vendorFilter),
              node: (
                <Box sx={{ flex: '0 1 200px', minWidth: 180 }}>
                  <Autocomplete
                    size="small" fullWidth
                    options={partiesRes?.data || []}
                    value={vendorFilter}
                    getOptionLabel={(o) => o?.name || ''}
                    isOptionEqualToValue={(o, v) => o._id === v._id}
                    onChange={(_e, v) => onFilterChange(setVendorFilter)(v)}
                    renderInput={(params) => <TextField {...params} label="Vendor" />}
                  />
                </Box>
              ),
            },
            {
              key: 'result', width: 150, active: Boolean(resultFilter),
              node: (
                <Box sx={{ flex: '0 1 150px', minWidth: 130 }}>
                  <TextField size="small" select fullWidth label="Result" value={resultFilter}
                    InputLabelProps={{ shrink: true }}
                    SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setResultFilter)(e.target.value)}>
                    <MenuItem value="">All</MenuItem>
                    {QC_RESULTS.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
                  </TextField>
                </Box>
              ),
            },
            {
              key: 'from', width: 150, active: Boolean(from),
              node: (
                <Box sx={{ flex: '0 1 150px', minWidth: 132 }}>
                  <DateInputDDMMYYYY size="small" label="From" fullWidth value={from} onChange={onFilterChange(setFrom)} sx={{ width: '100%' }} />
                </Box>
              ),
            },
            {
              key: 'to', width: 150, active: Boolean(to),
              node: (
                <Box sx={{ flex: '0 1 150px', minWidth: 132 }}>
                  <DateInputDDMMYYYY size="small" label="To" fullWidth value={to} onChange={onFilterChange(setTo)} sx={{ width: '100%' }} />
                </Box>
              ),
            },
          ]}
          onClearSecondary={clearSecondary}
          onClearAll={clearAll}
          anyActive={anyFilterActive}
        />
      </Paper>

      <Paper sx={{ ...pfmsCardSx, flexGrow: 1, minHeight: 420, overflow: 'hidden' }}>
        <DataGrid
          rows={data?.data || []}
          columns={columns}
          getRowId={(r) => r._id}
          loading={isLoading || isFetching}
          paginationMode="server"
          rowCount={data?.meta?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          {...rowNav.gridProps}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={50}
          columnHeaderHeight={44}
          sx={[{ border: 0 }, rowNavigationGridSx]}
        />
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && actionsFor(menuRow).map((a) => (
          <MenuItem key={a.key} onClick={a.fn}>
            <ListItemIcon>{a.icon}</ListItemIcon>
            <ListItemText>{a.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      <IncomingQCFormDialog open={formOpen} qc={editQc} onClose={() => { setFormOpen(false); setEditQc(null); }} />
      <IncomingQCCompleteDialog open={completeOpen} qc={activeQc} onClose={() => { setCompleteOpen(false); setActiveQc(null); }} />
    </Box>
  );
};

export default IncomingQCList;
