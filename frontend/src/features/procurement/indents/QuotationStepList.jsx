import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem, Chip, Menu, ListItemIcon, ListItemText,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Hourglass, FileText, FileCheck2, CircleSlash, ClipboardList, ExternalLink, ShoppingBag, Pencil, Eye,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetIndentsQuery, useGetIndentStatsQuery } from '../../../store/api/procurementApi';
import { serialColumn } from '../components/serialNumber';
import { stepTimingColumns } from '../components/stepTimingColumns';
import StatusChip, { TONES } from '../components/StatusChip';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';
import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
import { DEPARTMENTS, REQUEST_TYPES, fileHref, itemRef, isItemEligibleForQuote } from './indentMeta';
import RowActionsCell from '../components/RowActionsCell';
import { rowActionsColumn, rowActionsWidth, rowActionsGridProps, rowActionsGridSx } from '../components/rowActionsColumn';
import IndentQuickViewDialog from './IndentQuickViewDialog';
import QuoteComparativeDialog from './QuoteComparativeDialog';
import QuotationApprovalDialog from './QuotationApprovalDialog';
import PurchaseOrderFormDrawer from '../purchase-orders/PurchaseOrderFormDrawer';

/**
 * Step 1.2 (Receive Quote & Make Comparative) and Step 1.3 (Approved Quotation)
 * as their own Purchase FMS steps. The rows are indents — both steps are stored
 * on the indent — listed by the server with the same filters the doer tasks use
 * (backend indent/quotationSteps.js). The actions open the exact dialogs the
 * Purchase Indents screen and Indent Detail already use; nothing is duplicated.
 *
 * States: PENDING (waiting for this step), DONE (quote received / quotation
 * approved) and NOT_REQUIRED ("Quote Not Required" at Step 1.2, which skips
 * Step 1.3). The tiles count each state and double as the filter.
 */

// Same statuses as the backend's isDownstreamOfQuotation — past these the
// quotation steps can no longer be changed.
const DOWNSTREAM = ['PARTIAL_PO_CREATED', 'PO_READY', 'SERVICE_COMPLETED', 'SERVICE_QC_PASSED', 'SERVICE_QC_FAILED', 'SERVICE_QC_PARTIAL', 'CLOSED'];

const isQuoteNotRequired = (r) => r.quoteComparativeStep?.statusDone === 'QUOTE_NOT_REQUIRED'
  || !!r.quotationApprovalStep?.skipped
  || (!r.quoteComparativeStep?.statusDone && r.quoteStep?.status === 'NOT_REQUIRED');

// Client-side mirror of the server's state filters, for the row's own chip.
const STEPS = {
  QUOTE_COMPARATIVE: {
    code: '1.02',
    title: 'Receive Quote & Make Comparative',
    subtitle: 'Collect vendor quotations for approved indents, or mark the quotation as not required',
    stateOf: (r) => {
      if (r.overallStatus === 'QUOTE_PENDING') return 'PENDING';
      return isQuoteNotRequired(r) ? 'NOT_REQUIRED' : 'DONE';
    },
    chip: {
      PENDING: { status: 'QUOTE_PENDING' },
      DONE: { status: 'QUOTE_RECEIVED' },
      NOT_REQUIRED: { status: 'QUOTE_NOT_REQUIRED', label: 'Quote Not Required' },
    },
    tiles: { PENDING: 'Quote Pending', DONE: 'Quote Received', NOT_REQUIRED: 'Quote Not Required', ALL: 'All Approved Indents' },
    statusHeader: 'Quote Status',
  },
  QUOTATION_APPROVAL: {
    code: '1.03',
    title: 'Approved Quotation',
    subtitle: 'Review the received quotations and approve them before a purchase order is raised',
    stateOf: (r) => {
      if (r.quotationApprovalStep?.skipped) return 'NOT_REQUIRED';
      if (['QUOTE_RECEIVED', 'QUOTE_NOT_REQUIRED'].includes(r.overallStatus)) return 'PENDING';
      return 'DONE';
    },
    chip: {
      PENDING: { status: 'PENDING', label: 'Approval Pending' },
      DONE: { status: 'YES', label: 'Quotation Approved' },
      NOT_REQUIRED: { status: 'NOT_REQUIRED', label: 'Skipped (Not Required)' },
    },
    tiles: { PENDING: 'Approval Pending', DONE: 'Quotation Approved', NOT_REQUIRED: 'Skipped (Not Required)', ALL: 'All Quoted Indents' },
    statusHeader: 'Approval Status',
  },
};

const TILE_STYLE = {
  PENDING: { icon: <Hourglass size={18} />, color: '#b45309' },
  DONE: { icon: <FileCheck2 size={18} />, color: '#16a34a' },
  NOT_REQUIRED: { icon: <CircleSlash size={18} />, color: '#64748b' },
  ALL: { icon: <ClipboardList size={18} />, color: '#2563eb' },
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

// Step 1.2 files (item-wise first, then the flat / legacy single upload).
const quotationDocsOf = (r) => {
  const s = r.quoteComparativeStep || {};
  const itemDocs = (s.itemQuotations || []).flatMap((iq) => iq.quotationDocuments || []);
  if (itemDocs.length) return [...itemDocs, ...(s.legacyQuotationDocuments || [])];
  if (s.quotationDocuments?.length) return s.quotationDocuments;
  return s.quotationUploaded?.fileUrl ? [s.quotationUploaded] : [];
};

const approvedDocsOf = (r) => {
  const s = r.quotationApprovalStep || {};
  if (s.approvedQuotationDocuments?.length) return s.approvedQuotationDocuments;
  return s.approvedQuotation?.fileUrl ? [s.approvedQuotation] : [];
};

const FilesCell = ({ docs, emptyText = '—' }) => {
  const files = (docs || []).filter((d) => d?.fileUrl);
  if (!files.length) return <Typography variant="caption" sx={{ color: PFMS.faint }}>{emptyText}</Typography>;
  return (
    <Button size="small" startIcon={<ExternalLink size={14} />} href={fileHref(files[0].fileUrl)} target="_blank" rel="noopener"
      onClick={(e) => e.stopPropagation()} sx={{ fontSize: '0.74rem' }}>
      {files.length > 1 ? `${files.length} files` : 'View'}
    </Button>
  );
};

const QuotationStepList = ({ step }) => {
  const cfg = STEPS[step];
  const navigate = useNavigate();
  const rowNav = useRowNavigation({ to: (r) => `/procurement/indents/${r._id}` });

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search] = useDebouncedSearch('');
  // Opens on every indent that reached the step, each with its own state chip
  // (pending / done / not required) — opening on PENDING alone showed an empty
  // table whenever nothing was waiting. The Pending tile narrows to the queue.
  const [stepState, setStepState] = useState('ALL');
  const [department, setDepartment] = useState('');
  const [requestType, setRequestType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };

  const [activeIndent, setActiveIndent] = useState(null);
  const [dialog, setDialog] = useState(null); // 'quote' | 'approval' | 'po'
  const open = (kind, row) => { setActiveIndent(row); setDialog(kind); };
  const close = () => { setDialog(null); setActiveIndent(null); };
  const [quickIndent, setQuickIndent] = useState(null); // row whose quick view is open
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };

  const { data, isLoading, isFetching } = useGetIndentsQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    sort: '-createdAt',
    fmsStep: step,
    stepState: stepState === 'ALL' ? undefined : stepState,
    search: search || undefined,
    department: department || undefined,
    requestType: requestType || undefined,
    ...(from ? { 'timestamp[gte]': `${from}T00:00:00` } : {}),
    ...(to ? { 'timestamp[lte]': `${to}T23:59:59` } : {}),
  });
  const { data: statsRes } = useGetIndentStatsQuery();
  const counts = statsRes?.data?.quotationSteps?.[step] || {};
  const rows = data?.data || [];
  const total = data?.meta?.total || 0;

  // One primary action per row, in the step's own terms — the same rules the
  // Purchase Indents menu and Indent Detail apply.
  const actionFor = (r) => {
    const state = cfg.stateOf(r);
    const isMaterial = r.requestType !== 'INTERNAL_SERVICE';
    if (step === 'QUOTE_COMPARATIVE') {
      if (state === 'PENDING') {
        return { label: 'Receive Quote', icon: <FileText size={14} />, variant: 'contained', fn: () => open('quote', r) };
      }
      const hasPo = DOWNSTREAM.includes(r.overallStatus)
        || (r.items || []).some((it) => it.procurementStatus === 'PO_CREATED' || it.poId);
      if (r.approvalStatus === 'APPROVED' && !hasPo) {
        return { label: 'Edit', icon: <Pencil size={14} />, variant: 'outlined', fn: () => open('quote', r) };
      }
      return null;
    }
    if (state === 'PENDING') {
      return { label: 'Approve Quotation', icon: <FileCheck2 size={14} />, variant: 'contained', color: 'success', fn: () => open('approval', r) };
    }
    if (r.overallStatus === 'QUOTATION_APPROVED' && isMaterial) {
      return { label: 'Create PO', icon: <ShoppingBag size={14} />, variant: 'outlined', fn: () => open('po', r) };
    }
    return null;
  };

  const columns = [
    serialColumn({ field: 'serial', width: 70 }),
    { field: 'indentNumber', headerName: 'Indent No', width: 132,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'timestamp', headerName: 'Indent Date', width: 104,
      renderCell: (p) => <Typography variant="body2" sx={{ color: PFMS.sub }}>{fmtDate(p.value)}</Typography> },
    { field: 'requestType', headerName: 'Type', width: 100, sortable: false,
      renderCell: (p) => (p.value === 'INTERNAL_SERVICE'
        ? <Chip size="small" label="Service" sx={{ bgcolor: TONES.teal.bg, color: TONES.teal.fg, fontWeight: 700 }} />
        : <Chip size="small" label="Material" sx={{ bgcolor: TONES.blue.bg, color: TONES.blue.fg, fontWeight: 700 }} />) },
    { field: 'products', headerName: 'Approved Items', flex: 1, minWidth: 240, sortable: false,
      renderCell: (p) => {
        const items = (p.row.items || []).filter((it) => isItemEligibleForQuote(p.row, it));
        if (!items.length) return <Typography variant="body2" sx={{ color: PFMS.ink }}>{p.row.productNameRevised || '—'}</Typography>;
        return (
          <Box sx={{ py: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25, width: '100%' }}>
            {items.map((it, i) => (
              <Box key={it._id || i} sx={{ display: 'flex', gap: 0.5, alignItems: 'baseline', flexWrap: 'wrap', lineHeight: 1.25 }}>
                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {itemRef(p.row.indentNumber, it)}
                </Typography>
                <Typography variant="caption" sx={{ color: PFMS.sub }}>
                  — {it.itemName || '—'} · {it.approvedQuantity || it.quantity || 0} {it.unit || ''}
                </Typography>
              </Box>
            ))}
          </Box>
        );
      } },
    { field: 'department', headerName: 'Dept', width: 110,
      renderCell: (p) => <Typography variant="body2" sx={{ color: PFMS.sub }}>{p.value || '—'}</Typography> },
    { field: 'raisedBy', headerName: 'Raised By', width: 120,
      renderCell: (p) => <Typography variant="body2" sx={{ color: PFMS.sub }} noWrap>{p.value || '—'}</Typography> },
    { field: 'stepStatus', headerName: cfg.statusHeader, width: 200, sortable: false,
      valueGetter: (_v, row) => cfg.stateOf(row),
      renderCell: (p) => <StatusChip {...cfg.chip[p.value]} /> },
    { field: 'quotations', headerName: step === 'QUOTE_COMPARATIVE' ? 'Quotations Uploaded' : 'Quotations (Step 1.02)', width: 160, sortable: false,
      renderCell: (p) => <FilesCell docs={quotationDocsOf(p.row)} /> },
    ...(step === 'QUOTATION_APPROVAL' ? [
      { field: 'approvedFiles', headerName: 'Approved Quotation', width: 160, sortable: false,
        renderCell: (p) => <FilesCell docs={approvedDocsOf(p.row)} /> },
    ] : []),
    ...stepTimingColumns(),
    // The step's own action stays a visible button, left of the eye (quick
    // view) and ⋮ (View → full indent page); those two never move.
    rowActionsColumn((p) => {
      const a = actionFor(p.row);
      return (
        <RowActionsCell rowId={p.row._id} label={p.row.indentNumber}
          onQuickView={() => setQuickIndent(p.row)}
          onMenu={(e) => { setMenuAnchor(e.currentTarget); setMenuRow(p.row); }}>
          {a && (
            <Button size="small" variant={a.variant} color={a.color || 'primary'} disableElevation startIcon={a.icon}
              onClick={(e) => { e.stopPropagation(); a.fn(); }}
              aria-label={`${a.label} for ${p.row.indentNumber}`}
              sx={{ px: 1, py: 0.25, minHeight: 30, fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {a.label}
            </Button>
          )}
        </RowActionsCell>
      );
    }, { width: rowActionsWidth(140) }),
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, ...pfmsPageSx }}>
      <Box>
        <Typography sx={pfmsTitleSx}>
          {cfg.title} — Step {cfg.code} ({total})
        </Typography>
        <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>{cfg.subtitle}</Typography>
      </Box>

      {/* State tiles — also the filter. */}
      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }}>
        {['PENDING', 'DONE', 'NOT_REQUIRED', 'ALL'].map((key) => (
          <PfmsKpiCard
            key={key}
            icon={TILE_STYLE[key].icon}
            label={cfg.tiles[key]}
            value={counts[key]}
            color={TILE_STYLE[key].color}
            active={stepState === key}
            onClick={() => { setStepState(key); resetPage(); }}
          />
        ))}
      </Box>

      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <AdaptiveFilterBar
          pinned={[
            { key: 'search', minWidth: 180, node: (
              <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 180px' }, minWidth: 0 }}>
                <Typography component="label" htmlFor={`${step}-search`} sx={pfmsFieldLabelSx}>Search</Typography>
                <TextField id={`${step}-search`} size="small" fullWidth placeholder="Search indents…" value={searchInput}
                  onChange={(e) => { setSearchInput(e.target.value); resetPage(); }}
                  InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
              </Box>
            ) },
          ]}
          items={[
            { key: 'department', width: 142, active: Boolean(department), node: (
              <Box sx={{ flex: '0 1 140px', minWidth: 118 }}>
                <Typography component="label" htmlFor={`${step}-department`} sx={pfmsFieldLabelSx}>Department</Typography>
                <TextField id={`${step}-department`} size="small" select fullWidth value={department} SelectProps={ALL_WHEN_UNSET}
                  onChange={(e) => onFilterChange(setDepartment)(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {DEPARTMENTS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                </TextField>
              </Box>
            ) },
            { key: 'type', width: 124, active: Boolean(requestType), node: (
              <Box sx={{ flex: '0 1 120px', minWidth: 104 }}>
                <Typography component="label" htmlFor={`${step}-type`} sx={pfmsFieldLabelSx}>Type</Typography>
                <TextField id={`${step}-type`} size="small" select fullWidth value={requestType} SelectProps={ALL_WHEN_UNSET}
                  onChange={(e) => onFilterChange(setRequestType)(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {REQUEST_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                </TextField>
              </Box>
            ) },
            { key: 'from', width: 146, active: Boolean(from), node: (
              <Box sx={{ flex: '0 1 142px', minWidth: 132 }}>
                <Typography component="span" sx={pfmsFieldLabelSx}>From</Typography>
                <DateInputDDMMYYYY value={from} onChange={onFilterChange(setFrom)} sx={{ width: '100%' }} />
              </Box>
            ) },
            { key: 'to', width: 146, active: Boolean(to), node: (
              <Box sx={{ flex: '0 1 142px', minWidth: 132 }}>
                <Typography component="span" sx={pfmsFieldLabelSx}>To</Typography>
                <DateInputDDMMYYYY value={to} onChange={onFilterChange(setTo)} sx={{ width: '100%' }} />
              </Box>
            ) },
          ]}
        />
      </Paper>

      <Paper sx={{ ...pfmsCardSx, flexGrow: 1, minHeight: 360, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(r) => r._id}
          loading={isLoading || isFetching}
          paginationMode="server"
          rowCount={total}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50, 100]}
          {...rowNav.gridProps}
          {...rowActionsGridProps}
          disableRowSelectionOnClick
          getRowHeight={() => 'auto'}
          columnHeaderHeight={42}
          localeText={{ noRowsLabel: stepState === 'PENDING' ? `Nothing pending at Step ${cfg.code}`
            : stepState === 'ALL' ? `No indents have reached Step ${cfg.code} yet` : `No indents in “${cfg.tiles[stepState]}”` }}
          sx={[{
            border: 0,
            flexGrow: 1,
            '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center', py: 0.5 },
          }, rowNavigationGridSx, rowActionsGridSx]}
        />
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && (
          <MenuItem onClick={() => { const id = menuRow._id; closeMenu(); navigate(`/procurement/indents/${id}`); }}>
            <ListItemIcon><Eye size={16} /></ListItemIcon>
            <ListItemText>View</ListItemText>
          </MenuItem>
        )}
      </Menu>
      <IndentQuickViewDialog indent={quickIndent} onClose={() => setQuickIndent(null)} />

      <QuoteComparativeDialog open={dialog === 'quote'} indent={activeIndent} onClose={close} />
      <QuotationApprovalDialog open={dialog === 'approval'} indent={activeIndent} onClose={close} />
      <PurchaseOrderFormDrawer open={dialog === 'po'} presetIndent={dialog === 'po' ? activeIndent : null} onClose={close} />
    </Box>
  );
};

export default QuotationStepList;
