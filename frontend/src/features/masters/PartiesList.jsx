import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, CircularProgress,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Plus, Pencil, Package, Trash2, Users } from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import { useGetPartiesQuery, useDeletePartyMutation } from '../../store/api/partyApi';
import { usePermission } from '../../hooks/usePermission';
import { useMasterRights } from '../../utils/embed';
import PartyFormDrawer from './PartyFormDrawer';
import {
  O2D, BRAND, BRAND_DK, NAVY, DANGER,
  Pill, Empty, CellText, PageHeading, NoRows,
  gridSx, pageSx, panelSx, fieldSx, btnSx, withSno, SNO_COLUMN,
} from './components/masterUi';

const PartiesList = () => {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchTerm, setSearchTerm] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editParty, setEditParty] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // party pending confirmation

  const { data, isLoading } = useGetPartiesQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: searchTerm || undefined,
  });
  const [deleteParty, { isLoading: isDeleting }] = useDeletePartyMutation();
  // Inside the Delegation Suite, its lock icon can switch Edit off and Delete
  // on for this person (Parties); delete needs masters.deleteParty.
  const rights = useMasterRights('parties');
  const canEdit = rights.canEdit;
  const canDelete = usePermission('masters.deleteParty') && rights.canDelete;

  const openCreate = () => { setEditParty(null); setDrawerOpen(true); };
  const openEdit = (party) => { setEditParty(party); setDrawerOpen(true); };

  const confirmDelete = async () => {
    if (!deleteTarget?._id) return;
    try {
      await deleteParty(deleteTarget._id).unwrap();
      enqueueSnackbar(`"${deleteTarget.name}" deleted.`, { variant: 'success' });
      setDeleteTarget(null);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not delete this party.', { variant: 'error' });
    }
  };

  const columns = [
    SNO_COLUMN,
    { field: 'code', headerName: 'Code', width: 145,
      renderCell: (p) => <CellText mono weight={700} color={BRAND}>{p.value}</CellText>
    },
    { field: 'name', headerName: 'Party name', flex: 1, minWidth: 250,
      renderCell: (p) => <CellText weight={700} color={NAVY}>{p.value}</CellText>
    },
    { field: 'location', headerName: 'Location', width: 190,
      renderCell: (p) => (
        (p.value || p.row.address) ? <CellText color={O2D.sub}>{p.value || p.row.address}</CellText> : <Empty />
      )
    },
    { field: 'creditPeriodDays', headerName: 'Credit period', width: 135, align: 'center', headerAlign: 'center',
      renderCell: (p) => (p.value ? <Pill color={BRAND}>{p.value} days</Pill> : <Empty />)
    },
    { field: 'approxDays', headerName: 'Approx days', width: 135, align: 'center', headerAlign: 'center',
      renderCell: (p) => {
        const d = p.value || p.row.leadTimeDays || 0;
        return d ? <Pill color="#7c3aed">{d} days</Pill> : <Empty />;
      }
    },
    { field: 'orderedSkus', headerName: 'SKUs', width: 110, align: 'center', headerAlign: 'center', sortable: false,
      renderCell: (p) => {
        const ordered = Array.isArray(p.row.orderedSkus) ? p.row.orderedSkus.length : 0;
        const supplied = Array.isArray(p.row.suppliedProducts) ? p.row.suppliedProducts.length : 0;
        const n = ordered || supplied;
        if (!n) return <Empty />;
        return (
          <Pill color="#b45309" icon={<Package size={12} />}
            title={ordered ? `${ordered} ordered SKU(s)` : `${supplied} supplied product(s)`}>
            {n}
          </Pill>
        );
      }
    },
    ...(canEdit || canDelete ? [{ field: '__actions', headerName: '', width: canEdit && canDelete ? 100 : 64, align: 'center', headerAlign: 'center', sortable: false, filterable: false,
      renderCell: (p) => (
        <Box sx={{ display: 'inline-flex', gap: 0.25, alignSelf: 'center' }}>
          {canEdit && (
            <Tooltip title="Edit vendor / party">
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); openEdit(p.row); }}
                sx={{ color: BRAND, '&:hover': { bgcolor: alpha(BRAND, 0.1) } }}>
                <Pencil size={15} />
              </IconButton>
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip title="Delete party">
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); setDeleteTarget(p.row); }}
                sx={{ color: DANGER, '&:hover': { bgcolor: alpha(DANGER, 0.1) } }}>
                <Trash2 size={15} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )
    }] : []),
  ];

  const handleRowClick = (params) => {
    navigate(`/parties/${params.id}`);
  };

  return (
    <Box sx={pageSx}>
      {/* Header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 1.75 }}>
        <PageHeading title="Parties Master" subtitle="Manage customer directory and credit terms" />
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center', gap: 1, width: { xs: '100%', md: 'auto' } }}>
          <TextField size="small" placeholder="Search parties…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ ...fieldSx, width: { xs: '100%', sm: 260 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} color={O2D.faint} /></InputAdornment> }}
          />
          <Button variant="contained" startIcon={<Plus size={15} />} onClick={openCreate}
            sx={{ ...btnSx, width: { xs: '100%', sm: 'auto' }, bgcolor: BRAND, '&:hover': { bgcolor: BRAND_DK } }}>
            Add Party
          </Button>
        </Box>
      </Box>

      {/* Data Grid */}
      <Paper sx={panelSx}>
        <DataGrid
          rows={withSno(data?.data, paginationModel)}
          columns={columns}
          getRowId={(row) => row._id}
          loading={isLoading}
          paginationMode="server"
          rowCount={data?.meta?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          onRowClick={handleRowClick}
          pageSizeOptions={[10, 25, 50]}
          disableRowSelectionOnClick
          disableColumnMenu
          rowHeight={46}
          columnHeaderHeight={42}
          slots={{
            noRowsOverlay: () => (
              <NoRows icon={Users} title="No parties yet"
                hint="Clear the search, or add a party to get started." />
            ),
          }}
          sx={{ ...gridSx, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Paper>

      <PartyFormDrawer
        open={drawerOpen}
        party={editParty}
        onClose={() => { setDrawerOpen(false); setEditParty(null); }}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => !isDeleting && setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Delete party?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            <b>{deleteTarget?.name}</b> will be removed from the parties list. This won't affect existing
            orders or records that already reference it, and it can be restored by an administrator.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteTarget(null)} disabled={isDeleting} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button onClick={confirmDelete} variant="contained" color="error" disabled={isDeleting}
            startIcon={isDeleting ? <CircularProgress size={14} color="inherit" /> : <Trash2 size={15} />}
            sx={{ textTransform: 'none', fontWeight: 700 }}>
            {isDeleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PartiesList;
