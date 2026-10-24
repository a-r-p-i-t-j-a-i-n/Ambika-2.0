import React, { useMemo, useState } from 'react';
import { Box, Typography, Paper, TextField, InputAdornment, Button } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Plus } from 'lucide-react';
import { serialColumn } from '../components/serialNumber';
import StatusChip from '../components/StatusChip';
import { PFMS, pfmsCardSx, pfmsFieldLabelSx } from '../pfmsTheme';
import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';

/**
 * "Pending for PO" view of the Purchase Orders step — the approved indent items
 * not yet on an active (non-cancelled) PO. Rows come straight from
 * GET /procurement/purchase-orders/approved-items (the same list the Create PO
 * drawer's item picker uses), so eligibility is never re-derived here. Search
 * is client-side over that already-loaded list.
 */
const PendingForPoGrid = ({ items = [], loading = false, onCreatePo }) => {
  const rowNav = useRowNavigation({ to: (r) => `/procurement/indents/${r.indentId}` });
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((o) => [o.indentItemDisplayNumber, o.indentNumber, o.itemName, o.skuCode]
      .some((f) => String(f || '').toLowerCase().includes(q)));
  }, [items, search]);

  const columns = [
    serialColumn(),
    { field: 'indentItemDisplayNumber', headerName: 'ITEM REF', width: 150,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value || '—'}</Typography> },
    { field: 'indentNumber', headerName: 'INDENT NO', width: 140,
      renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography> },
    { field: 'itemName', headerName: 'ITEM', flex: 1, minWidth: 200,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    { field: 'skuCode', headerName: 'SKU', width: 140,
      renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography> },
    { field: 'approvedQuantity', headerName: 'APPROVED QTY', width: 140, align: 'right', headerAlign: 'right',
      renderCell: (p) => (
        <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {p.value} {p.row.unit || ''}
        </Typography>
      ) },
    { field: 'quoteNotRequired', headerName: 'QUOTATION', width: 140, sortable: false,
      renderCell: (p) => <StatusChip status={p.value ? 'QUOTE_NOT_REQUIRED' : 'YES'} /> },
    { field: '__actions', headerName: '', width: 130, sortable: false, filterable: false,
      disableColumnMenu: true, align: 'right', headerAlign: 'right',
      renderCell: (p) => (
        <Button size="small" variant="outlined" startIcon={<Plus size={14} />}
          onClick={(e) => { e.stopPropagation(); onCreatePo?.(p.row); }}
          sx={{ py: 0.25, fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
          Create PO
        </Button>
      ) },
  ];

  return (
    <>
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <Box sx={{ maxWidth: { xs: '100%', sm: 360 } }}>
          <Typography component="label" htmlFor="po-pending-search" sx={pfmsFieldLabelSx}>Search</Typography>
          <TextField id="po-pending-search" size="small" fullWidth placeholder="Search indent / item ref / item / SKU…"
            value={search} onChange={(e) => { setSearch(e.target.value); setPaginationModel((m) => ({ ...m, page: 0 })); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
        </Box>
      </Paper>

      <Paper sx={{ ...pfmsCardSx, flexGrow: 1, minHeight: 420, overflow: 'hidden' }}>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(r) => r.indentItemId}
          loading={loading}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          {...rowNav.gridProps}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={50}
          columnHeaderHeight={44}
          localeText={{ noRowsLabel: search ? 'No pending items match your search' : 'No approved items are pending for PO' }}
          sx={[{ border: 0 }, rowNavigationGridSx]}
        />
      </Paper>
    </>
  );
};

export default PendingForPoGrid;
