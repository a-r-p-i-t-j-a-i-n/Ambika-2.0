/**
 * Master Data → Machines.
 *
 * Same shape as SKU Master: DataGrid with server-side pagination, a search box,
 * a segmented status filter driven by counts from the API, and a right-hand
 * drawer for add/edit. Clicking a row opens the detail page, where operators
 * are assigned.
 */
import React, { useState } from 'react';
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, Paper, Stack, TextField, Tooltip, Typography, alpha,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CircleSlash, Cpu, Edit3, LayoutGrid, Plus, Search, Trash2, Users, Wrench,
} from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useGetMachinesQuery, useDeleteMachineMutation } from '../../store/api/machineApi';
import { usePermission } from '../../hooks/usePermission';
import {
  O2D, BRAND, BRAND_DK, NAVY, DANGER,
  Pill, Empty, CellText, PageHeading, NoRows, TipCell, headerTip, O2D_TIP,
  gridSx, pageSx, panelSx, fieldSx, btnSx, withSno, SNO_COLUMN,
} from './components/masterUi';
import MachineFormDrawer from './MachineFormDrawer';
import {
  MACHINE_STATUS_META, MACHINE_STATUS_PILL_WIDTH,
  MACHINE_TYPE_PILL_WIDTH, machineTypeMeta, countTone, MACHINE_FIELD_HELP as HELP,
} from './machineMeta';

const STATUS_FILTERS = [
  { key: '',           label: 'All Machines', icon: LayoutGrid,   tip: 'Every machine on the floor, whatever its status.' },
  { key: 'IN_USE',     label: 'In Use',       icon: Cpu,          tip: MACHINE_STATUS_META.IN_USE.meaning },
  { key: 'NOT_IN_USE', label: 'Not In Use',   icon: Wrench,       tip: MACHINE_STATUS_META.NOT_IN_USE.meaning },
  { key: 'SCRAP',      label: 'Scrap / Dead', icon: CircleSlash,  tip: MACHINE_STATUS_META.SCRAP.meaning },
];

const MachinesList = () => {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchTerm, setSearchTerm] = useState('');
  const [machineStatus, setMachineStatus] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteMachine, { isLoading: isDeleting }] = useDeleteMachineMutation();
  const canDelete = usePermission('masters.deleteMachine');

  const { data, isLoading } = useGetMachinesQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: searchTerm || undefined,
    ...(machineStatus ? { machineStatus } : {}),
    sort: 'code',
  });

  const counts = data?.meta?.statusCounts || {};
  const allCount = data?.meta?.allTotal ?? 0;

  const handleFilter = (key) => {
    setMachineStatus(key);
    setPaginationModel((p) => ({ ...p, page: 0 }));
  };

  const handleAdd = () => { setSelected(null); setDrawerOpen(true); };
  const handleEdit = (machine) => { setSelected(machine); setDrawerOpen(true); };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget?._id) return;
    try {
      await deleteMachine(deleteTarget._id).unwrap();
      enqueueSnackbar(`Machine "${deleteTarget.code}" deleted`, { variant: 'success' });
      setDeleteTarget(null);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to delete machine', { variant: 'error' });
    }
  };

  const columns = [
    SNO_COLUMN,
    {
      field: 'code', headerName: 'Machine code', width: 130,
      renderHeader: headerTip('Machine code', HELP.code),
      renderCell: (p) => (
        <TipCell title={`${p.value}${p.row.uid ? ` · ${p.row.uid}` : ''}`}>
          <CellText mono weight={700} color={BRAND}>{p.value}</CellText>
        </TipCell>
      ),
    },
    {
      field: 'name', headerName: 'Machine name', flex: 1, minWidth: 210,
      renderHeader: headerTip('Machine name', HELP.name),
      renderCell: (p) => (
        <TipCell title={p.value}>
          <CellText weight={700} color={NAVY}>{p.value}</CellText>
        </TipCell>
      ),
    },
    {
      field: 'machineType', headerName: 'Type', width: 140,
      renderHeader: headerTip('Type', HELP.machineType),
      renderCell: (p) => {
        const m = machineTypeMeta(p.value);
        // The pill shows a short label; the tooltip carries the full family name.
        return (
          <TipCell title={p.value}>
            <Pill color={m.color} minWidth={MACHINE_TYPE_PILL_WIDTH}>{m.short}</Pill>
          </TipCell>
        );
      },
    },
    {
      field: 'department', headerName: 'Department / Section', flex: 0.8, minWidth: 170,
      renderHeader: headerTip('Department / Section', HELP.department),
      renderCell: (p) => (p.value
        ? <TipCell title={p.value}><CellText color={O2D.sub}>{p.value}</CellText></TipCell>
        : <TipCell title="No department recorded for this machine."><Empty /></TipCell>),
    },
    {
      field: 'capacity', headerName: 'Capacity', width: 105,
      renderHeader: headerTip('Capacity', HELP.capacity),
      renderCell: (p) => {
        if (!p.value) return <TipCell title="No capacity recorded for this machine."><Empty /></TipCell>;
        const unit = p.row.capacityUnit;
        return (
          <TipCell title={unit ? `${p.value} (read as ${p.row.capacityValue} ${unit})` : `${p.value} — no unit given on the source sheet`}>
            <CellText weight={700} color={NAVY}>{p.value}</CellText>
          </TipCell>
        );
      },
    },
    {
      field: 'installationYear', headerName: 'Installed', width: 95, align: 'center', headerAlign: 'center',
      renderHeader: headerTip('Installed', HELP.installationYear),
      renderCell: (p) => (p.value
        ? <TipCell title={`Installed in ${p.value}`}><CellText color={O2D.sub}>{p.value}</CellText></TipCell>
        : <TipCell title="No installation year recorded."><Empty /></TipCell>),
    },
    {
      field: 'machineStatus', headerName: 'Status', width: 126,
      renderHeader: headerTip('Status', HELP.machineStatus),
      renderCell: (p) => {
        const m = MACHINE_STATUS_META[p.value] || MACHINE_STATUS_META.IN_USE;
        return (
          <TipCell title={`${m.label} — ${m.meaning}`}>
            <Pill color={m.color} minWidth={MACHINE_STATUS_PILL_WIDTH}>{m.label}</Pill>
          </TipCell>
        );
      },
    },
    {
      field: 'operatorCount', headerName: 'Operators', width: 106, align: 'center', headerAlign: 'center',
      sortable: false,
      renderHeader: headerTip('Operators', HELP.operatorCount),
      renderCell: (p) => {
        const n = p.value || 0;
        return (
          <TipCell title={n
            ? `${n} operator${n > 1 ? 's' : ''} assigned. Open the machine to see who.`
            : 'No operator assigned to this machine yet.'}
          >
            <Pill color={countTone(n)} minWidth={58}>
              <Users size={11} style={{ marginRight: 3 }} />{n}
            </Pill>
          </TipCell>
        );
      },
    },
    {
      field: 'actions', headerName: '', width: canDelete ? 104 : 68, sortable: false,
      align: 'center', headerAlign: 'center',
      // No header tooltip — the header is blank, and each button carries its own.
      renderCell: (p) => (
        <Stack direction="row" spacing={0.25} sx={{ alignSelf: 'center' }}>
          <Tooltip title="Edit machine">
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); handleEdit(p.row); }}
              sx={{ color: BRAND, '&:hover': { bgcolor: alpha(BRAND, 0.1) } }}
            >
              <Edit3 size={15} />
            </IconButton>
          </Tooltip>
          {canDelete && (
            <Tooltip title="Delete machine">
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(p.row); }}
                sx={{ color: DANGER, '&:hover': { bgcolor: alpha(DANGER, 0.1) } }}
              >
                <Trash2 size={15} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      ),
    },
  ];

  return (
    <Box sx={pageSx}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 1.75 }}>
        <PageHeading title="Machines" subtitle="Every press, spinning, cutting and buffing unit on the floor" />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: { xs: '100%', md: 'auto' } }}>
          <TextField
            size="small" placeholder="Search code, name or department" value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPaginationModel((p) => ({ ...p, page: 0 })); }}
            sx={{ ...fieldSx, width: { xs: '100%', sm: 270 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} color={O2D.faint} /></InputAdornment> }}
          />
          <Button
            variant="contained" startIcon={<Plus size={15} />} onClick={handleAdd}
            sx={{ ...btnSx, bgcolor: BRAND, '&:hover': { bgcolor: BRAND_DK }, width: { xs: '100%', sm: 'auto' } }}
          >
            Add Machine
          </Button>
        </Stack>
      </Box>

      {/* Status filter — same segmented chips as SKU Master. */}
      <Stack direction="row" spacing={0.85} flexWrap="wrap" useFlexGap>
        {STATUS_FILTERS.map((f) => {
          const Icon = f.icon;
          const selectedChip = machineStatus === f.key;
          const count = f.key === '' ? allCount : (counts[f.key] || 0);
          return (
            <Tooltip key={f.key || 'all'} arrow title={f.tip} slotProps={O2D_TIP}>
            <Box
              onClick={() => handleFilter(f.key)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0,
                height: 34, px: 1.35, borderRadius: '8px', cursor: 'pointer',
                border: `1px solid ${selectedChip ? BRAND : O2D.line}`,
                bgcolor: selectedChip ? BRAND : O2D.surface,
                transition: 'background .15s, border-color .15s',
                '&:hover': selectedChip ? { bgcolor: BRAND_DK } : { borderColor: alpha(BRAND, 0.45), bgcolor: alpha(BRAND, 0.04) },
              }}
            >
              <Icon size={14} color={selectedChip ? '#ffffff' : O2D.sub} />
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, whiteSpace: 'nowrap', color: selectedChip ? '#fff' : NAVY }}>
                {f.label}
              </Typography>
              <Box sx={{
                minWidth: 20, height: 17, px: 0.55, borderRadius: '5px',
                display: 'grid', placeItems: 'center',
                bgcolor: selectedChip ? alpha('#ffffff', 0.22) : alpha(NAVY, 0.06),
                color: selectedChip ? '#fff' : O2D.sub,
                fontSize: '0.65rem', fontWeight: 800,
              }}>
                {count}
              </Box>
            </Box>
            </Tooltip>
          );
        })}
      </Stack>

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
          pageSizeOptions={[10, 25, 50, 100]}
          onRowClick={(params) => navigate(`/machines/${params.id}`)}
          disableRowSelectionOnClick
          disableColumnMenu
          rowHeight={46}
          columnHeaderHeight={42}
          slots={{
            noRowsOverlay: () => (
              <NoRows icon={Cpu} title="No machines here" hint="Try another status, clear the search, or add a machine." />
            ),
          }}
          sx={{ ...gridSx, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Paper>

      <MachineFormDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} machine={selected} />

      <Dialog
        open={!!deleteTarget}
        onClose={() => !isDeleting && setDeleteTarget(null)}
        maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ pt: 3, px: 3, pb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(DANGER, 0.1), color: DANGER }}>
            <AlertTriangle size={20} />
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem' }}>Delete this machine?</Typography>
            <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
              It will be soft-deleted and hidden from all lists.
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ px: 3 }}>
          {deleteTarget && (
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: alpha(DANGER, 0.04), border: `1px solid ${alpha(DANGER, 0.18)}` }}>
              <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 900, fontSize: '0.95rem', color: DANGER }}>
                {deleteTarget.code}
              </Typography>
              <Typography sx={{ fontWeight: 600, fontSize: '0.86rem' }}>{deleteTarget.name}</Typography>
              <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary', mt: 0.25 }}>
                {deleteTarget.machineType}
                {deleteTarget.department ? ` · ${deleteTarget.department}` : ''}
                {deleteTarget.operatorCount ? ` · ${deleteTarget.operatorCount} operator(s) assigned` : ''}
              </Typography>
            </Box>
          )}
          <Typography sx={{ mt: 2, fontSize: '0.82rem', color: 'text.secondary' }}>
            Operators are only unassigned, never deleted. DPR history that references this machine keeps working.
            To retire a machine while keeping it visible, set its status to <strong>Scrap / Dead</strong> instead.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setDeleteTarget(null)} disabled={isDeleting} sx={{ color: 'text.secondary', fontWeight: 700 }}>
            Cancel
          </Button>
          <Button
            variant="contained" color="error" disabled={isDeleting} onClick={handleDeleteConfirm}
            startIcon={isDeleting ? <CircularProgress size={14} color="inherit" /> : <Trash2 size={14} />}
            sx={{ fontWeight: 700, px: 3 }}
          >
            {isDeleting ? 'Deleting…' : 'Delete Machine'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MachinesList;
