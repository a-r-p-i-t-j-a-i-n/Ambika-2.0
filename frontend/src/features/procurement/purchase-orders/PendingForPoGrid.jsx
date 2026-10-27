import React, { useMemo, useState } from 'react';
import { Box, Typography, Paper, TextField, InputAdornment, Button, Tooltip } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Plus, Building2 } from 'lucide-react';
import { serialColumn } from '../components/serialNumber';
import StatusChip from '../components/StatusChip';
import { PFMS, pfmsCardSx, pfmsFieldLabelSx } from '../pfmsTheme';
import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
import ItemVendorDialog from './ItemVendorDialog';
import ItemVendorCell from './ItemVendorCell';
import { itemVendorBlock } from './itemVendor';

/**
 * "Pending for PO" view of the Purchase Orders step — the approved indent items
 * not yet on an active (non-cancelled) PO. Rows come straight from
 * GET /procurement/purchase-orders/approved-items (the same list the Create PO
 * drawer's item picker uses), so eligibility is never re-derived here. Search
 * is client-side over that already-loaded list.
 *
 * Vendor: each row shows the vendor its PO must use (approved quotation, or the
 * pick made here when no quotation was required). 'Select Vendor' fixes it for a
 * not-required item; 'Confirm Vendor' records the approved vendor of an older
 * approval — Create PO stays disabled until then.
 */
const PendingForPoGrid = ({ items = [], loading = false, onCreatePo }) => {
  const rowNav = useRowNavigation({ to: (r) => `/procurement/indents/${r.indentId}` });
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [vendorRow, setVendorRow] = useState(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((o) => [o.indentItemDisplayNumber, o.indentNumber, o.itemName, o.skuCode, o.vendorName]
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
    { field: 'vendorName', headerName: 'VENDOR', width: 210,
      renderCell: (p) => <ItemVendorCell row={p.row} /> },
    { field: '__actions', headerName: '', width: 300, sortable: false, filterable: false,
      disableColumnMenu: true, align: 'right', headerAlign: 'right',
      renderCell: (p) => {
        const r = p.row;
        const block = itemVendorBlock(r);
        // A vendor fixed by the Step 1.3 approval is locked; otherwise it can be set here.
        const vendorAction = r.quotationPath === 'NOT_REQUIRED'
          ? (r.vendorState === 'SET' ? 'Change Vendor' : 'Select Vendor')
          : (r.vendorState === 'MISSING' ? 'Confirm Vendor' : '');
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, justifyContent: 'flex-end', width: '100%' }}>
            {vendorAction ? (
              <Button size="small" variant={r.vendorState === 'MISSING' ? 'contained' : 'text'}
                color={r.vendorState === 'MISSING' ? 'warning' : 'primary'} startIcon={<Building2 size={14} />}
                onClick={(e) => { e.stopPropagation(); setVendorRow(r); }}
                sx={{ py: 0.25, fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {vendorAction}
              </Button>
            ) : null}
            <Tooltip title={block}>
              <span>
                <Button size="small" variant="outlined" startIcon={<Plus size={14} />} disabled={!!block}
                  onClick={(e) => { e.stopPropagation(); onCreatePo?.(r); }}
                  sx={{ py: 0.25, fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  Create PO
                </Button>
              </span>
            </Tooltip>
          </Box>
        );
      } },
  ];

  return (
    <>
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <Box sx={{ maxWidth: { xs: '100%', sm: 360 } }}>
          <Typography component="label" htmlFor="po-pending-search" sx={pfmsFieldLabelSx}>Search</Typography>
          <TextField id="po-pending-search" size="small" fullWidth placeholder="Search indent / item ref / item / SKU / vendor…"
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
      <ItemVendorDialog key={vendorRow?.indentItemId || 'none'} open={!!vendorRow} row={vendorRow} onClose={() => setVendorRow(null)} />
    </>
  );
};

export default PendingForPoGrid;
