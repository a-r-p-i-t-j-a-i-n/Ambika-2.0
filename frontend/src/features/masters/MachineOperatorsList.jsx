/**
 * Master Data → Machine Operators.
 *
 * Mirror of the Machines list. The status filter is Active / Inactive only —
 * the source sheet gives operators no status of their own, so nothing richer is
 * invented.
 */
import React, { useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, Paper, Stack, TextField, Tooltip, Typography, alpha,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Cpu, Edit3, HardHat, LayoutGrid, Plus, Search, Trash2, UserCheck, UserX,
} from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetMachineOperatorListQuery,
  useDeleteMachineOperatorMutation,
} from '../../store/api/machineOperatorApi';
import { usePermission } from '../../hooks/usePermission';
import {
  O2D, BRAND, BRAND_DK, NAVY, DANGER, O2D_TIP,
  Pill, Empty, CellText, PageHeading, NoRows, TipCell, headerTip,
  gridSx, pageSx, panelSx, fieldSx, btnSx, withSno, SNO_COLUMN,
} from './components/masterUi';
import OperatorFormDrawer from './OperatorFormDrawer';
import { operatorStatusMeta, countTone, OPERATOR_FIELD_HELP as HELP } from './machineMeta';

const STATUS_FILTERS = [
  { key: '',      label: 'All Operators', icon: LayoutGrid, tip: 'Every operator on record, active or not.' },
  { key: 'true',  label: 'Active',        icon: UserCheck,  tip: 'Currently on the floor. Only active operators appear in the assignment pickers.' },
  { key: 'false', label: 'Inactive',      icon: UserX,      tip: 'Switched off — they have left the floor. Their history and past assignments are kept.' },
];

const MachineOperatorsList = () => {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteOperator, { isLoading: isDeleting }] = useDeleteMachineOperatorMutation();
  const canDelete = usePermission('masters.deleteOperator');

  const { data, isLoading } = useGetMachineOperatorListQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: searchTerm || undefined,
    ...(activeFilter ? { isActive: activeFilter } : {}),
    sort: 'name',
  });

  const counts = data?.meta?.statusCounts || {};
  const allCount = data?.meta?.allTotal ?? 0;

  const handleFilter = (key) => {
    setActiveFilter(key);
    setPaginationModel((p) => ({ ...p, page: 0 }));
  };

  const handleAdd = () => { setSelected(null); setDrawerOpen(true); };
  const handleEdit = (operator) => { setSelected(operator); setDrawerOpen(true); };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget?._id) return;
    try {
      await deleteOperator(deleteTarget._id).unwrap();
      enqueueSnackbar(`Operator "${deleteTarget.name}" deleted`, { variant: 'success' });
      setDeleteTarget(null);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to delete operator', { variant: 'error' });
    }
  };

  const columns = [
    SNO_COLUMN,
    {
      field: 'name', headerName: 'Operator name', flex: 1, minWidth: 200,
      renderHeader: headerTip('Operator name', HELP.name),
      renderCell: (p) => (
        <TipCell title={p.value}>
          <CellText weight={700} color={NAVY}>{p.value}</CellText>
        </TipCell>
      ),
    },
    {
      field: 'code', headerName: 'Code', width: 110,
      renderHeader: headerTip('Code', HELP.code),
      renderCell: (p) => (p.value
        ? <TipCell title={p.value}><CellText mono weight={700} color={BRAND}>{p.value}</CellText></TipCell>
        : <TipCell title="No operator code — the source sheet does not give operators one."><Empty /></TipCell>),
    },
    {
      field: 'department', headerName: 'Department', flex: 0.8, minWidth: 165,
      renderHeader: headerTip('Department', HELP.department),
      renderCell: (p) => {
        if (!p.value) return <TipCell title="No department recorded for this operator."><Empty /></TipCell>;
        const extra = (p.row.departments || []).filter((d) => d !== p.value);
        return (
          <TipCell title={extra.length ? `${p.value} — also recorded under ${extra.join(', ')}` : p.value}>
            <CellText color={O2D.sub}>{p.value}</CellText>
          </TipCell>
        );
      },
    },
    {
      field: 'machineCodes', headerName: 'Assigned machines', flex: 1, minWidth: 220, sortable: false,
      renderHeader: headerTip('Assigned machines', HELP.machineCodes),
      renderCell: (p) => {
        const codes = p.value || [];
        if (!codes.length) {
          return <TipCell title="Not assigned to any machine yet."><Empty /></TipCell>;
        }
        const shown = codes.slice(0, 5);
        const full = codes.join(', ');
        return (
          <TipCell title={`Runs ${codes.length} machine${codes.length > 1 ? 's' : ''}: ${full}`}>
            <Stack direction="row" spacing={0.4} sx={{ overflow: 'hidden' }}>
              {shown.map((c) => (
                <Chip
                  key={c} size="small" label={c}
                  sx={{
                    height: 20, fontSize: '0.66rem', fontWeight: 800,
                    fontFamily: 'ui-monospace, monospace',
                    bgcolor: alpha(BRAND, 0.08), color: BRAND, border: `1px solid ${alpha(BRAND, 0.2)}`,
                  }}
                />
              ))}
              {codes.length > shown.length ? (
                <Chip
                  size="small" label={`+${codes.length - shown.length}`}
                  sx={{ height: 20, fontSize: '0.66rem', fontWeight: 800, bgcolor: alpha(NAVY, 0.06), color: O2D.sub }}
                />
              ) : null}
            </Stack>
          </TipCell>
        );
      },
    },
    {
      field: 'machineCount', headerName: 'Machines', width: 100, align: 'center', headerAlign: 'center',
      sortable: false,
      renderHeader: headerTip('Machines', HELP.machineCount),
      renderCell: (p) => {
        const n = p.value || 0;
        return (
          <TipCell title={n
            ? `Runs ${n} machine${n > 1 ? 's' : ''}. Open the operator to manage the list.`
            : 'No machine assigned to this operator yet.'}
          >
            <Pill color={countTone(n)} minWidth={54}>
              <Cpu size={11} style={{ marginRight: 3 }} />{n}
            </Pill>
          </TipCell>
        );
      },
    },
    {
      field: 'isActive', headerName: 'Status', width: 104,
      renderHeader: headerTip('Status', HELP.isActive),
      renderCell: (p) => {
        const m = operatorStatusMeta(p.value);
        return (
          <TipCell title={p.value !== false
            ? 'Active — appears in the assignment pickers.'
            : 'Inactive — hidden from the pickers, but their history and assignments are kept.'}
          >
            <Pill color={m.color} minWidth={64}>{m.label}</Pill>
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
          <Tooltip title="Edit operator">
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); handleEdit(p.row); }}
              sx={{ color: BRAND, '&:hover': { bgcolor: alpha(BRAND, 0.1) } }}
            >
              <Edit3 size={15} />
            </IconButton>
          </Tooltip>
          {canDelete && (
            <Tooltip title="Delete operator">
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
        <PageHeading title="Machine Operators" subtitle="Shop-floor workers and the machines they run" />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: { xs: '100%', md: 'auto' } }}>
          <TextField
            size="small" placeholder="Search name or department" value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPaginationModel((p) => ({ ...p, page: 0 })); }}
            sx={{ ...fieldSx, width: { xs: '100%', sm: 260 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} color={O2D.faint} /></InputAdornment> }}
          />
          <Button
            variant="contained" startIcon={<Plus size={15} />} onClick={handleAdd}
            sx={{ ...btnSx, bgcolor: BRAND, '&:hover': { bgcolor: BRAND_DK }, width: { xs: '100%', sm: 'auto' } }}
          >
            Add Operator
          </Button>
        </Stack>
      </Box>

      <Stack direction="row" spacing={0.85} flexWrap="wrap" useFlexGap>
        {STATUS_FILTERS.map((f) => {
          const Icon = f.icon;
          const selectedChip = activeFilter === f.key;
          const count = f.key === '' ? allCount : (f.key === 'true' ? (counts.ACTIVE || 0) : (counts.INACTIVE || 0));
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
          onRowClick={(params) => navigate(`/machine-operators/${params.id}`)}
          disableRowSelectionOnClick
          disableColumnMenu
          rowHeight={46}
          columnHeaderHeight={42}
          slots={{
            noRowsOverlay: () => (
              <NoRows icon={HardHat} title="No operators here" hint="Clear the search, switch status, or add an operator." />
            ),
          }}
          sx={{ ...gridSx, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Paper>

      <OperatorFormDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} operator={selected} />

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
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem' }}>Delete this operator?</Typography>
            <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
              They will be soft-deleted and hidden from all lists.
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ px: 3 }}>
          {deleteTarget && (
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: alpha(DANGER, 0.04), border: `1px solid ${alpha(DANGER, 0.18)}` }}>
              <Typography sx={{ fontWeight: 900, fontSize: '0.95rem', color: DANGER }}>{deleteTarget.name}</Typography>
              <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary', mt: 0.25 }}>
                {deleteTarget.department || 'No department'}
                {deleteTarget.machineCount ? ` · runs ${deleteTarget.machineCount} machine(s)` : ''}
              </Typography>
            </Box>
          )}
          <Typography sx={{ mt: 2, fontSize: '0.82rem', color: 'text.secondary' }}>
            Their machine assignments are removed, but no machine is deleted. If someone has simply left a machine,
            unassign them on the detail page instead — and if they have left the floor, switch them to
            <strong> Inactive</strong> rather than deleting.
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
            {isDeleting ? 'Deleting…' : 'Delete Operator'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MachineOperatorsList;
