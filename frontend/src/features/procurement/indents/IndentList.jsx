import React, { useState, useMemo, useEffect, useRef } from 'react';
import { serialColumn } from '../components/serialNumber';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Tooltip, Chip, Pagination,
  Select, Checkbox, Divider,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, MoreVertical, Eye, Pencil, Send, CheckCircle2, CheckCheck,
  FileText, FileCheck2, ClipboardList, Hourglass, BadgeCheck, Quote, ExternalLink, ShoppingBag,
  Columns3,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetIndentsQuery,
  useGetIndentStatsQuery,
  useSubmitIndentMutation,
} from '../../../store/api/procurementApi';
import {
  ApprovalChip, QuoteChip, QuotationChip, APPROVAL_STATUSES, DEPARTMENTS, REQUEST_TYPES,
  fileHref, itemRef,
} from './indentMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';
import { TONES } from '../components/StatusChip';
import IndentFormDrawer from './IndentFormDrawer';
import IndentApprovalDialog from './IndentApprovalDialog';
import QuoteComparativeDialog from './QuoteComparativeDialog';
import QuotationApprovalDialog from './QuotationApprovalDialog';
import BulkIndentApprovalDialog from './BulkIndentApprovalDialog';
import { useStartServiceQc, canStartServiceQc } from './useStartServiceQc';
import PurchaseOrderFormDrawer from '../purchase-orders/PurchaseOrderFormDrawer';

import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
// Map the Step-1.2 statusDone (or legacy quoteStep) to a chip state.
const quoteStateOf = (row) => {
  const sd = row.quoteComparativeStep?.statusDone;
  if (sd === 'YES') return 'RECEIVED';
  if (sd === 'QUOTE_NOT_REQUIRED') return 'NOT_REQUIRED';
  return row.quoteStep?.status || 'PENDING';
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

// Human summary of an indent's items (falls back to the legacy single product).
const itemsSummary = (row) => {
  const items = row.items || [];
  if (!items.length) return row.productNameRevised || '—';
  const first = items[0]?.itemName || '—';
  return items.length > 1 ? `${first} +${items.length - 1} more` : first;
};

// ── Column visibility ───────────────────────────────────────────────────────
// Every column the screen has ever had is still defined and still reachable.
// The six quote-workflow columns are simply OFF by default, because they are
// only meaningful between Step 1.2 and Step 1.3 and they were what pushed the
// table into permanent horizontal scrolling. The Columns menu turns any of them
// back on and the choice is remembered per browser. No field was deleted.
const COLUMNS_STORAGE_KEY = 'pfms.indents.columnVisibility.v1';
const DEFAULT_HIDDEN_COLUMNS = {
  quoteStatus: false,
  quotationUploaded: false,
  quoteActualDate: false,
  approvedQuotationStatus: false,
  approvedQuotationFile: false,
  approvedQuotationDate: false,
};
// Columns the user may not hide — without these the row loses its identity or
// its way into the record.
const LOCKED_COLUMNS = new Set(['serial', 'indentNumber', '__actions']);

const readStoredColumns = () => {
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return DEFAULT_HIDDEN_COLUMNS;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : DEFAULT_HIDDEN_COLUMNS;
  } catch {
    // Private mode / blocked storage — fall back to the defaults rather than
    // breaking the grid.
    return DEFAULT_HIDDEN_COLUMNS;
  }
};

// ── Footer ──────────────────────────────────────────────────────────────────
// Replaces the DataGrid's default "1–25 of 140 ‹ ›" strip with the reference's
// numbered pager. Still driven entirely by the SERVER pagination model — this
// is presentation only.
const GridFooter = ({ page, pageSize, total, pageSizeOptions, onPageChange, onPageSizeChange }) => {
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        px: 1.5,
        py: 1,
        borderTop: `1px solid ${PFMS.line}`,
        bgcolor: PFMS.surfaceAlt,
      }}
    >
      <Typography sx={{ fontSize: '0.75rem', color: PFMS.sub, fontWeight: 600 }}>
        Showing {from} to {to} of {total} indent{total === 1 ? '' : 's'}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Pagination
          size="small"
          shape="rounded"
          color="primary"
          count={pageCount}
          page={page + 1}
          onChange={(_e, p) => onPageChange(p - 1)}
          siblingCount={0}
          boundaryCount={1}
        />
        <Select
          size="small"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          inputProps={{ 'aria-label': 'Rows per page' }}
          sx={{ fontSize: '0.75rem', height: 30, bgcolor: PFMS.surface }}
        >
          {pageSizeOptions.map((n) => (
            <MenuItem key={n} value={n} sx={{ fontSize: '0.75rem' }}>{n} / page</MenuItem>
          ))}
        </Select>
      </Box>
    </Box>
  );
};

// A barely-there tint on alternate rows — enough to track a long row across
// 13 columns, not enough to read as a second surface colour.
const ALT_ROW_BG = '#fbfcfe';


const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const IndentList = () => {
  const navigate = useNavigate();
  const rowNav = useRowNavigation({ to: (r) => `/procurement/indents/${r._id}` });
  const { enqueueSnackbar } = useSnackbar();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  // `searchInput` is what the user types; `search` is what the server sees.
  // Debounced so a 12-character search is one request, not twelve.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [approvalStatus, setApprovalStatus] = useState('');
  const [overallStatus, setOverallStatus] = useState('');
  const [department, setDepartment] = useState('');
  const [requestType, setRequestType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const firstSearchRun = useRef(true);
  useEffect(() => {
    if (firstSearchRun.current) { firstSearchRun.current = false; return undefined; }
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPaginationModel((m) => ({ ...m, page: 0 }));
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any filter change must return to page 1 — otherwise a narrower result set
  // can leave the grid parked on a page that no longer exists.
  const onFilterChange = (setter) => (value) => {
    setter(value);
    setPaginationModel((m) => ({ ...m, page: 0 }));
  };

  // Column visibility
  const [columnVisibilityModel, setColumnVisibilityModel] = useState(readStoredColumns);
  const [columnsAnchor, setColumnsAnchor] = useState(null);
  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columnVisibilityModel));
    } catch {
      // Storage unavailable — the grid still works, the choice just won't persist.
    }
  }, [columnVisibilityModel]);

  // Row selection — feeds the Bulk Approve dialog as a pre-selection.
  const [rowSelectionModel, setRowSelectionModel] = useState([]);

  // Dialog / drawer state
  const [formOpen, setFormOpen] = useState(false);
  const [editIndent, setEditIndent] = useState(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [comparativeOpen, setComparativeOpen] = useState(false);
  const [quotationOpen, setQuotationOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const { startServiceQc } = useStartServiceQc();
  const [poDrawerOpen, setPoDrawerOpen] = useState(false);
  const [poPresetIndent, setPoPresetIndent] = useState(null);
  const [activeIndent, setActiveIndent] = useState(null);

  // Row action menu
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

  const queryArgs = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    sort: '-createdAt',
    search: search || undefined,
    approvalStatus: approvalStatus || undefined,
    overallStatus: overallStatus || undefined,
    department: department || undefined,
    requestType: requestType || undefined,
    ...(from ? { 'timestamp[gte]': `${from}T00:00:00` } : {}),
    ...(to ? { 'timestamp[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetIndentsQuery(queryArgs);
  const { data: statsRes } = useGetIndentStatsQuery();
  const stats = statsRes?.data || {};

  const rows = useMemo(() => data?.data || [], [data]);
  // The filtered total, straight from the server. The header count used to read
  // the global stats aggregate, which ignores every filter — so narrowing the
  // list left the title and the footer disagreeing.
  const filteredTotal = data?.meta?.total;
  const headerCount = filteredTotal ?? stats.total ?? 0;

  const [submitIndent] = useSubmitIndentMutation();

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };

  const onCreate = () => { setEditIndent(null); setFormOpen(true); };
  const onEdit = (row) => { setEditIndent(row); setFormOpen(true); closeMenu(); };
  const onApprove = (row) => { setActiveIndent(row); setApprovalOpen(true); closeMenu(); };
  const onReceiveQuote = (row) => { setActiveIndent(row); setComparativeOpen(true); closeMenu(); };
  const onApproveQuotation = (row) => { setActiveIndent(row); setQuotationOpen(true); closeMenu(); };
  const onView = (row) => { navigate(`/procurement/indents/${row._id}`); closeMenu(); };

  const onSubmit = async (row) => {
    closeMenu();
    try {
      await submitIndent(row._id).unwrap();
      enqueueSnackbar('Indent submitted for approval', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to submit', { variant: 'error' });
    }
  };

  // Which actions apply to this row's state. "View Detail" is no longer here:
  // the row now carries an explicit View button (and the row itself is still
  // clickable), so repeating it in the menu would be a third way to do one
  // thing.
  const actionsFor = (r) => {
    const a = [];
    if (r.approvalStatus === 'DRAFT') {
      a.push({ key: 'edit', label: 'Edit Draft', icon: <Pencil size={16} />, fn: () => onEdit(r) });
      a.push({ key: 'submit', label: 'Submit', icon: <Send size={16} />, fn: () => onSubmit(r) });
    }
    if (r.approvalStatus === 'PENDING_APPROVAL') {
      a.push({ key: 'approve', label: 'Approve / Reject', icon: <CheckCircle2 size={16} />, fn: () => onApprove(r) });
    }
    if (r.approvalStatus === 'APPROVED' && r.quoteStep?.status === 'PENDING') {
      a.push({ key: 'quote', label: 'Receive Quote / Comparative', icon: <FileText size={16} />, fn: () => onReceiveQuote(r) });
    }
    // Approved Quotation (Step 1.3) — hidden once the step was skipped via
    // "Quote Not Required" (which moves the indent straight to QUOTATION_APPROVED).
    if (['QUOTE_RECEIVED', 'QUOTE_NOT_REQUIRED'].includes(r.overallStatus) && !r.quotationApprovalStep?.skipped) {
      a.push({ key: 'approveQuote', label: 'Approved Quotation 1.03', icon: <FileCheck2 size={16} />, fn: () => onApproveQuotation(r) });
    }
    // PO-ready material indents can raise a Vendor PO directly (covers both the
    // normal approved-quotation flow and the Quote-Not-Required skip path).
    if (r.overallStatus === 'QUOTATION_APPROVED' && r.requestType !== 'INTERNAL_SERVICE') {
      a.push({ key: 'createPo', label: 'Create Vendor PO', icon: <ShoppingBag size={16} />, fn: () => { setPoPresetIndent(r); setPoDrawerOpen(true); closeMenu(); } });
    }
    // Internal-service indents go straight to the service QC (Step 1.9) once approved.
    if (canStartServiceQc(r)) {
      a.push({ key: 'serviceQc', label: 'Start Service QC', icon: <CheckCircle2 size={16} />, fn: () => { closeMenu(); startServiceQc(r); } });
    }
    return a;
  };

  const numCellSx = { fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: PFMS.ink };

  const columns = [
    // Shared S.No. — continuous across pages, restarts when a filter resets the page.
    serialColumn({ field: 'serial', width: 70 }),
    { field: 'indentNumber', headerName: 'Indent No', width: 132, hideable: false,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'timestamp', headerName: 'Date', width: 104,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'requestType', headerName: 'Type', width: 112, sortable: false,
      renderCell: (p) => (p.value === 'INTERNAL_SERVICE'
        ? <Chip size="small" label="Service" sx={{ bgcolor: TONES.teal.bg, color: TONES.teal.fg, fontWeight: 700 }} />
        : <Chip size="small" label="Material" sx={{ bgcolor: TONES.blue.bg, color: TONES.blue.fg, fontWeight: 700 }} />) },
    { field: 'products', headerName: 'Products', flex: 1, minWidth: 240, sortable: false,
      valueGetter: (_v, row) => itemsSummary(row),
      renderCell: (p) => {
        const items = p.row.items || [];
        if (!items.length) {
          return <Typography variant="body2" fontWeight={600}>{p.row.productNameRevised || '—'}</Typography>;
        }
        return (
          <Box sx={{ py: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25, width: '100%' }}>
            {items.map((it, i) => (
              <Box key={it._id || i} sx={{ display: 'flex', gap: 0.5, alignItems: 'baseline', flexWrap: 'wrap', lineHeight: 1.25 }}>
                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {itemRef(p.row.indentNumber, it, i)}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>— {it.itemName || '—'}</Typography>
              </Box>
            ))}
          </Box>
        );
      } },
    { field: 'itemsCount', headerName: 'Items', width: 72, align: 'right', headerAlign: 'right', sortable: false,
      valueGetter: (_v, row) => (row.items?.length || (row.productNameRevised ? 1 : 0)),
      renderCell: (p) => <Typography variant="body2" sx={numCellSx}>{p.value}</Typography> },
    { field: 'raisedBy', headerName: 'Raised By', width: 124,
      renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography> },
    { field: 'department', headerName: 'Dept', width: 112,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value || '—'}</Typography> },
    { field: 'revisedQuantity', headerName: 'Revised Qty', width: 110, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" sx={numCellSx}>{p.value || '—'}</Typography> },
    { field: 'approvedQuantity', headerName: 'Approved Qty', width: 118, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" sx={numCellSx}>{p.value || '—'}</Typography> },
    { field: 'approvalStatus', headerName: 'Approval', width: 150,
      renderCell: (p) => <ApprovalChip status={p.value} /> },
    { field: 'quoteStatus', headerName: 'Quote Status', width: 134, sortable: false,
      valueGetter: (_v, row) => quoteStateOf(row),
      renderCell: (p) => <QuoteChip status={p.value} /> },
    { field: 'quotationUploaded', headerName: 'Quotation Uploaded', width: 180, sortable: false,
      renderCell: (p) => {
        const step = p.row.quoteComparativeStep;
        const docs = step?.quotationDocuments?.length
          ? step.quotationDocuments
          : (step?.quotationUploaded?.fileUrl ? [step.quotationUploaded] : []);
        if (!docs.length) return <Typography variant="caption" color="text.disabled">—</Typography>;
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Button size="small" startIcon={<ExternalLink size={14} />} href={fileHref(docs[0].fileUrl)} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
              {docs.length > 1 ? `${docs.length} files` : 'View'}
            </Button>
            {docs.length > 1 && <Typography variant="caption" color="text.secondary">+{docs.length - 1} more</Typography>}
          </Box>
        );
      } },
    { field: 'quoteActualDate', headerName: 'Quote Actual Date', width: 150, sortable: false,
      valueGetter: (_v, row) => row.quoteComparativeStep?.actualAt || row.quoteStep?.actualAt || '',
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value ? fmtDate(p.value) : '—'}</Typography> },
    { field: 'approvedQuotationStatus', headerName: 'Approved Quotation Status', width: 200, sortable: false,
      valueGetter: (_v, row) => row.quotationApprovalStep?.statusDone
        || (row.quotationApprovalStep?.skipped ? 'NOT_REQUIRED' : 'PENDING'),
      renderCell: (p) => <QuotationChip status={p.value} /> },
    { field: 'approvedQuotationFile', headerName: 'Approved Quotation File', width: 190, sortable: false,
      renderCell: (p) => {
        const step = p.row.quotationApprovalStep;
        const docs = step?.approvedQuotationDocuments?.length
          ? step.approvedQuotationDocuments
          : (step?.approvedQuotation?.fileUrl ? [step.approvedQuotation] : []);
        if (!docs.length) return <Typography variant="caption" color="text.disabled">—</Typography>;
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Button size="small" startIcon={<ExternalLink size={14} />} href={fileHref(docs[0].fileUrl)} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
              {docs.length > 1 ? `${docs.length} files` : 'View'}
            </Button>
            {docs.length > 1 && <Typography variant="caption" color="text.secondary">+{docs.length - 1} more</Typography>}
          </Box>
        );
      } },
    { field: 'approvedQuotationDate', headerName: 'Approved Quotation Date', width: 190, sortable: false,
      valueGetter: (_v, row) => row.quotationApprovalStep?.actualAt || '',
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value ? fmtDate(p.value) : '—'}</Typography> },
    { field: '__actions', headerName: 'Action', width: 118, sortable: false, filterable: false,
      disableColumnMenu: true, hideable: false, align: 'right', headerAlign: 'right',
      renderCell: (p) => {
        const actions = actionsFor(p.row);
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, justifyContent: 'flex-end', width: '100%' }}>
            <Button
              size="small"
              variant="outlined"
              onClick={(e) => { e.stopPropagation(); onView(p.row); }}
              sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: '0.72rem', fontWeight: 700 }}
            >
              View
            </Button>
            {actions.length > 0 && (
              <Tooltip title="More actions">
                <IconButton size="small" aria-label={`More actions for ${p.row.indentNumber}`} onClick={(e) => openMenu(e, p.row)}>
                  <MoreVertical size={16} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        );
      } },
  ];

  // The summary row doubles as a status filter — clicking a tile applies the
  // filter it counts, clicking it again clears it. The numbers themselves come
  // straight from the indent stats endpoint; nothing here is derived locally.
  const kpis = [
    { key: 'total', icon: <ClipboardList size={18} />, label: 'Total Indents', value: stats.total, color: '#2563eb',
      active: !approvalStatus && !overallStatus,
      apply: () => { setApprovalStatus(''); setOverallStatus(''); } },
    { key: 'pending', icon: <Hourglass size={18} />, label: 'Pending Approval', value: stats.pendingApproval, color: '#b45309',
      active: approvalStatus === 'PENDING_APPROVAL',
      apply: () => { setOverallStatus(''); setApprovalStatus((v) => (v === 'PENDING_APPROVAL' ? '' : 'PENDING_APPROVAL')); } },
    { key: 'approved', icon: <BadgeCheck size={18} />, label: 'Approved', value: stats.approved, color: '#0f766e',
      active: approvalStatus === 'APPROVED',
      apply: () => { setOverallStatus(''); setApprovalStatus((v) => (v === 'APPROVED' ? '' : 'APPROVED')); } },
    { key: 'quotePending', icon: <Quote size={18} />, label: 'Quote Pending', value: stats.quotePending, color: '#0e7490',
      active: overallStatus === 'QUOTE_PENDING',
      apply: () => { setApprovalStatus(''); setOverallStatus((v) => (v === 'QUOTE_PENDING' ? '' : 'QUOTE_PENDING')); } },
    { key: 'quotationApproved', icon: <FileCheck2 size={18} />, label: 'Quotation Approved', value: stats.quotationApproved, color: '#16a34a',
      active: overallStatus === 'QUOTATION_APPROVED',
      apply: () => { setApprovalStatus(''); setOverallStatus((v) => (v === 'QUOTATION_APPROVED' ? '' : 'QUOTATION_APPROVED')); } },
  ];

  const toggleableColumns = columns.filter((c) => !LOCKED_COLUMNS.has(c.field));
  const hiddenCount = toggleableColumns.filter((c) => columnVisibilityModel[c.field] === false).length;
  const columnsLabel = `Columns${hiddenCount ? ` (${toggleableColumns.length - hiddenCount}/${toggleableColumns.length})` : ''}`;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, ...pfmsPageSx }}>
      {/* Section header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 1.5 }}>
        <Box>
          <Typography sx={pfmsTitleSx}>Purchase Indents ({headerCount})</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>Raise, approve and track purchase requirements</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" color="success" startIcon={<CheckCheck size={16} />} onClick={() => setBulkOpen(true)}>
            Bulk Approve
          </Button>
          <Button variant="contained" disableElevation startIcon={<Plus size={16} />} onClick={onCreate}>Create Indent</Button>
        </Box>
      </Box>

      {/* Summary row — also the status filter */}
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            sm: 'repeat(3, minmax(0, 1fr))',
            lg: 'repeat(5, minmax(0, 1fr))',
          },
        }}
      >
        {kpis.map((k) => (
          <PfmsKpiCard
            key={k.key}
            icon={k.icon}
            label={k.label}
            value={k.value}
            color={k.color}
            active={k.active}
            onClick={() => { k.apply(); setPaginationModel((m) => ({ ...m, page: 0 })); }}
          />
        ))}
      </Box>

      {/* Filters */}
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-end' }}>
          <AdaptiveFilterBar
            pinned={[
              { key: 'search', minWidth: 180, node: (
                <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 180px' }, minWidth: 0 }}>
                  <Typography component="label" htmlFor="indent-search" sx={pfmsFieldLabelSx}>Search</Typography>
                  <TextField
                    id="indent-search"
                    size="small"
                    fullWidth
                    placeholder="Search indents…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }}
                  />
                </Box>
              ) },
              { key: 'approval', minWidth: 150, node: (
                <Box sx={{ flex: '0 1 150px', minWidth: 128 }}>
                  <Typography component="label" htmlFor="indent-approval" sx={pfmsFieldLabelSx}>Approval Status</Typography>
                  <TextField id="indent-approval" size="small" select fullWidth value={approvalStatus}
                    SelectProps={ALL_WHEN_UNSET}
                    onChange={(e) => onFilterChange(setApprovalStatus)(e.target.value)}>
                    <MenuItem value="">All</MenuItem>
                    {APPROVAL_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
                  </TextField>
                </Box>
              ) },
            ]}
            items={[
              {
                key: 'department', width: 142, active: Boolean(department),
                node: (
                  <Box sx={{ flex: '0 1 140px', minWidth: 118 }}>
                    <Typography component="label" htmlFor="indent-department" sx={pfmsFieldLabelSx}>Department</Typography>
                    <TextField id="indent-department" size="small" select fullWidth value={department}
                      SelectProps={ALL_WHEN_UNSET}
                      onChange={(e) => onFilterChange(setDepartment)(e.target.value)}>
                      <MenuItem value="">All</MenuItem>
                      {DEPARTMENTS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                    </TextField>
                  </Box>
                ),
              },
              {
                key: 'type', width: 124, active: Boolean(requestType),
                node: (
                  <Box sx={{ flex: '0 1 120px', minWidth: 104 }}>
                    <Typography component="label" htmlFor="indent-type" sx={pfmsFieldLabelSx}>Type</Typography>
                    <TextField id="indent-type" size="small" select fullWidth value={requestType}
                      SelectProps={ALL_WHEN_UNSET}
                      onChange={(e) => onFilterChange(setRequestType)(e.target.value)}>
                      <MenuItem value="">All</MenuItem>
                      {REQUEST_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                    </TextField>
                  </Box>
                ),
              },
              {
                key: 'from', width: 146, active: Boolean(from),
                node: (
                  <Box sx={{ flex: '0 1 142px', minWidth: 132 }}>
                    <Typography component="span" sx={pfmsFieldLabelSx}>From</Typography>
                    <DateInputDDMMYYYY value={from} onChange={onFilterChange(setFrom)} sx={{ width: '100%' }} />
                  </Box>
                ),
              },
              {
                key: 'to', width: 146, active: Boolean(to),
                node: (
                  <Box sx={{ flex: '0 1 142px', minWidth: 132 }}>
                    <Typography component="span" sx={pfmsFieldLabelSx}>To</Typography>
                    <DateInputDDMMYYYY value={to} onChange={onFilterChange(setTo)} sx={{ width: '100%' }} />
                  </Box>
                ),
              },
            ]}
          />
          <Box sx={{ flex: '0 0 auto' }}>
            <Button
              variant="outlined"
              startIcon={<Columns3 size={16} />}
              onClick={(e) => setColumnsAnchor(e.currentTarget)}
              aria-label={columnsLabel}
              aria-haspopup="menu"
              aria-expanded={Boolean(columnsAnchor) || undefined}
              sx={{
                height: 40, whiteSpace: 'nowrap', minWidth: { xs: 40, md: 64 }, px: { xs: 0, md: 2 },
                '& .MuiButton-startIcon': { ml: { xs: 0, md: '-4px' }, mr: { xs: 0, md: 1 } },
              }}
            >
              <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>{columnsLabel}</Box>
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* Column visibility menu */}
      <Menu
        anchorEl={columnsAnchor}
        open={Boolean(columnsAnchor)}
        onClose={() => setColumnsAnchor(null)}
        slotProps={{ paper: { sx: { maxHeight: 420 } } }}
      >
        <Typography sx={{ px: 2, py: 1, fontSize: '0.7rem', fontWeight: 800, color: PFMS.sub, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Show columns
        </Typography>
        <Divider />
        {toggleableColumns.map((c) => {
          const visible = columnVisibilityModel[c.field] !== false;
          return (
            <MenuItem
              key={c.field}
              dense
              onClick={() => setColumnVisibilityModel((m) => ({ ...m, [c.field]: !visible }))}
            >
              <Checkbox size="small" checked={visible} sx={{ p: 0.5, mr: 1 }} />
              <ListItemText primaryTypographyProps={{ fontSize: '0.82rem' }}>{c.headerName}</ListItemText>
            </MenuItem>
          );
        })}
        <Divider />
        <MenuItem dense onClick={() => setColumnVisibilityModel(DEFAULT_HIDDEN_COLUMNS)}>
          <ListItemText primaryTypographyProps={{ fontSize: '0.82rem', fontWeight: 700 }}>Reset to default</ListItemText>
        </MenuItem>
      </Menu>

      {/* Grid */}
      <Paper sx={{ ...pfmsCardSx, flexGrow: 1, minHeight: 360, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(r) => r._id}
          loading={isLoading || isFetching}
          paginationMode="server"
          rowCount={filteredTotal || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          {...rowNav.gridProps}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          checkboxSelection
          keepNonExistentRowsSelected
          disableRowSelectionOnClick
          rowSelectionModel={rowSelectionModel}
          onRowSelectionModelChange={setRowSelectionModel}
          columnVisibilityModel={columnVisibilityModel}
          onColumnVisibilityModelChange={setColumnVisibilityModel}
          getRowHeight={() => 'auto'}
          columnHeaderHeight={42}
          slots={{ footer: GridFooter }}
          slotProps={{
            footer: {
              page: paginationModel.page,
              pageSize: paginationModel.pageSize,
              total: filteredTotal || 0,
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              onPageChange: (page) => setPaginationModel((m) => ({ ...m, page })),
              onPageSizeChange: (pageSize) => setPaginationModel({ page: 0, pageSize }),
            },
          }}
          sx={[{
            border: 0,
            flexGrow: 1,
            // Auto row height: keep cells vertically centred with a little padding
            // so multi-item Product lists aren't cramped.
            '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center', py: 0.5 },
            '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
            '& .MuiDataGrid-row:nth-of-type(even)': { bgcolor: ALT_ROW_BG },
            '& .MuiDataGrid-row:nth-of-type(even):hover': { bgcolor: PFMS.surfaceAlt },
          }, rowNavigationGridSx]}
        />
      </Paper>

      {/* Row actions menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && actionsFor(menuRow).map((a) => (
          <MenuItem key={a.key} onClick={a.fn}>
            <ListItemIcon>{a.icon}</ListItemIcon>
            <ListItemText>{a.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      {/* Drawer + dialogs */}
      <IndentFormDrawer open={formOpen} indent={editIndent} onClose={() => { setFormOpen(false); setEditIndent(null); }} />
      <IndentApprovalDialog open={approvalOpen} indent={activeIndent} onClose={() => { setApprovalOpen(false); setActiveIndent(null); }} />
      <QuoteComparativeDialog open={comparativeOpen} indent={activeIndent} onClose={() => { setComparativeOpen(false); setActiveIndent(null); }} />
      <QuotationApprovalDialog open={quotationOpen} indent={activeIndent} onClose={() => { setQuotationOpen(false); setActiveIndent(null); }} />
      <BulkIndentApprovalDialog open={bulkOpen} preselectedIds={rowSelectionModel} onClose={() => setBulkOpen(false)}
        onReceiveQuote={(ind) => { setBulkOpen(false); setActiveIndent(ind); setComparativeOpen(true); }} />
      <PurchaseOrderFormDrawer open={poDrawerOpen} presetIndent={poPresetIndent} onClose={() => { setPoDrawerOpen(false); setPoPresetIndent(null); }} />
    </Box>
  );
};

export default IndentList;
