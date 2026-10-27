import React, { useEffect, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Drawer, IconButton, InputAdornment, MenuItem, Paper, Stack,
  TextField, Tooltip, Typography, alpha,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  AlertTriangle, Edit3, PackagePlus, Plus, Save, Search, Trash2, Upload, X,
  PackageCheck, Layers, Wrench, Boxes, LayoutGrid, Disc,
} from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useBulkUpsertSkusMutation,
  useCreateSkuMutation,
  useDeleteSkuMutation,
  useGetSkusQuery,
  useUpdateSkuMutation,
} from '../../store/api/skuApi';
import { usePermission } from '../../hooks/usePermission';
import {
  O2D, BRAND, BRAND_DK, NAVY, DANGER,
  Pill, Empty, CellText, PageHeading, NoRows,
  gridSx, pageSx, panelSx, fieldSx, btnSx, withSno, SNO_COLUMN,
} from './components/masterUi';

// Item-type metadata — labels and colours now live in their own module so the
// IMS stock list can share them without importing this screen.
import { TYPE_META, typeDestinationHint } from './itemTypeMeta';

const SKU_KINDS = [
  { key: '',              label: 'All Items',      icon: LayoutGrid },
  { key: 'FINISHED_GOOD', label: 'Finished Goods', icon: PackageCheck },
  { key: 'RAW_MATERIAL',  label: 'Raw Material',   icon: Layers },
  { key: 'CONSUMABLE',    label: 'Consumables',    icon: Wrench },
  { key: 'PACKING',       label: 'Packing',        icon: Boxes },
  { key: 'CIRCLE',        label: 'Circles',        icon: Disc },
];

// Every Item Type the server accepts except Scrap (created by Scrap IMS, never
// registered by hand). The Item Type decides where purchased stock is posted.
const TYPE_OPTIONS = [
  'FINISHED_GOOD', 'RAW_MATERIAL', 'CIRCLE', 'CONSUMABLE', 'PACKING', 'PACKAGING',
  'CHEMICAL', 'INK', 'BUTTER_PAPER', 'SUBLIMATION_PAPER', 'STATIONERY', 'SPARE_PART', 'WIP_MATERIAL',
  'SERVICE', 'JOB_WORK',
];

const sheetSkuItems = [
  { name: 'Dome Jar', code: 'DJ1500-204', category: 'Jar', pcsPerBox: 105, weightPerPc: 0.3307 },
  { name: 'Bowl 2.0 Ltr', code: 'BO2000-202', category: 'Bowl', pcsPerBox: 100 },
  { name: 'MG 1.1 Wet Jar Celum', code: 'MG1650-304', category: 'MG Jar', pcsPerBox: 120, aliases: ['MG 1.1 Wet Jar'] },
  { name: 'Value Flat Wet', code: 'VF1500-202', category: 'Value Flat', pcsPerBox: 120, weightPerPc: 0.266 },
  { name: 'Taper Jar - Patti 1.0 Ltr', code: 'TP1000-202', category: 'Mixer Jar', pcsPerBox: 100 },
  { name: 'Taper Jar - Bidding 1.0 Ltr', code: 'TB1000-204', category: 'Mixer Jar', pcsPerBox: 100 },
  { name: 'Taper Jar - Patti 1.5 Ltr', code: 'TP1500-202', category: 'Mixer Jar', pcsPerBox: 100 },
  { name: 'Steele 1.5 Ltr', code: 'ST1500-202', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.27 },
  { name: 'Steele 1.0 Ltr', code: 'ST1000-202', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.187 },
  { name: 'Galaxy 1.5 Ltr', code: 'GX1500-202', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.27 },
  { name: 'Galaxy 1.0 Ltr', code: 'GX1000-202', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.187 },
  { name: 'Taper Jar - Bidding 1.5 Ltr', code: 'TB1500-204', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.25 },
  { name: 'Taper Jar - Patti 0.750 Ltr', code: 'TP0750-202', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.15 },
  { name: 'PP Chutney', code: 'PP0400-202', category: 'PP Jar', pcsPerBox: 180, weightPerPc: 0.1317 },
  { name: 'Grinder Jar', code: 'GJ1000-204', category: 'Jar', pcsPerBox: 126, weightPerPc: 0.2445 },
  { name: 'Chutney Katori', code: 'CK0600-204', category: 'Katori', pcsPerBox: 144, weightPerPc: 0.1514 },
  { name: 'Flat Jar', code: 'FJ1000-204', category: 'Jar', pcsPerBox: 120, weightPerPc: 0.275 },
];

const emptyForm = {
  name: '', code: '', itemType: 'FINISHED_GOOD', category: '', unit: 'PCS',
  pcsPerBox: 1, weightPerPc: 0, weightPerBox: 0, leadDays: 7,
  aliasesText: '', packingDetails: '', convertedItemNameForResale: '',
};

const SkuDrawer = ({ open, onClose, sku, defaultType }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [form, setForm] = useState(emptyForm);
  const [createSku, { isLoading: isCreating }] = useCreateSkuMutation();
  const [updateSku, { isLoading: isUpdating }] = useUpdateSkuMutation();
  const isSaving = isCreating || isUpdating;

  useEffect(() => {
    if (!open) return;
    setForm(sku ? {
      name: sku.name || '',
      code: sku.code || '',
      itemType: sku.itemType || 'FINISHED_GOOD',
      category: sku.category || '',
      unit: sku.unit || 'PCS',
      pcsPerBox: sku.pcsPerBox || 1,
      weightPerPc: sku.weightPerPc || 0,
      weightPerBox: sku.weightPerBox || 0,
      leadDays: sku.leadDays || 7,
      aliasesText: (sku.aliases || []).join(', '),
      packingDetails: sku.packingDetails || '',
      // Missing on SKUs created before this field existed — reads as ''.
      convertedItemNameForResale: sku.convertedItemNameForResale || '',
    } : { ...emptyForm, itemType: defaultType || 'FINISHED_GOOD' });
  }, [open, sku, defaultType]);

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!form.name.trim()) return enqueueSnackbar('SKU item name is required', { variant: 'warning' });
    if (!form.code.trim()) return enqueueSnackbar('SKU code is required', { variant: 'warning' });

    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      itemType: form.itemType,
      category: form.category.trim(),
      unit: form.unit.trim() || 'PCS',
      pcsPerBox: Number(form.pcsPerBox) || 1,
      weightPerPc: Number(form.weightPerPc) || 0,
      weightPerBox: Number(form.weightPerBox) || 0,
      leadDays: Number(form.leadDays) || 0,
      aliases: form.aliasesText.split(',').map((item) => item.trim()).filter(Boolean),
      packingDetails: form.packingDetails,
      convertedItemNameForResale: form.convertedItemNameForResale.trim(),
    };

    try {
      if (sku?._id) await updateSku({ id: sku._id, ...payload }).unwrap();
      else await createSku(payload).unwrap();
      enqueueSnackbar(sku?._id ? 'SKU updated' : 'SKU registered', { variant: 'success' });
      onClose();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to save SKU', { variant: 'error' });
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 520 }, display: 'flex', flexDirection: 'column' } }}>
      <Box sx={{ p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${O2D.line}` }}>
        <Stack direction="row" spacing={1.3} alignItems="center">
          <Box sx={{ p: 1, borderRadius: '10px', bgcolor: alpha(BRAND, 0.08), display: 'flex', color: BRAND }}>
            <PackagePlus size={20} />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={900}>{sku?._id ? 'Edit SKU Item' : 'Register New SKU'}</Typography>
            <Typography variant="caption" color="text.secondary">Pick the type, enter a code &amp; name</Typography>
          </Box>
        </Stack>
        <IconButton onClick={onClose}><X size={18} /></IconButton>
      </Box>

      <Box sx={{ p: 2.5, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Item type — the first decision when registering */}
        <TextField
          select
          label="Item Type"
          value={form.itemType}
          onChange={(e) => updateField('itemType', e.target.value)}
          fullWidth
          helperText={typeDestinationHint(form.itemType)}
        >
          {TYPE_OPTIONS.map((t) => (
            <MenuItem key={t} value={t}>{TYPE_META[t]?.label || t}</MenuItem>
          ))}
        </TextField>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
          <TextField label="SKU Code" value={form.code} onChange={(e) => updateField('code', e.target.value.toUpperCase())} />
          <TextField label="Category / Sub-group" value={form.category} onChange={(e) => updateField('category', e.target.value)} />
        </Box>
        <TextField label="SKU Item Name" value={form.name} onChange={(e) => updateField('name', e.target.value)} fullWidth />
        <TextField
          label="Converted Item Name (For Resale)"
          value={form.convertedItemNameForResale}
          onChange={(e) => updateField('convertedItemNameForResale', e.target.value)}
          placeholder={'e.g. 1.75" Brush'}
          helperText="Optional — the name this item is sold on as, when it differs from the item name."
          fullWidth
        />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
          <TextField label="Unit" value={form.unit} onChange={(e) => updateField('unit', e.target.value)} />
          <TextField label="Lead Days" type="number" value={form.leadDays} onChange={(e) => updateField('leadDays', e.target.value)} />
          <TextField label="Pcs Per Box" type="number" value={form.pcsPerBox} onChange={(e) => updateField('pcsPerBox', e.target.value)} />
          <TextField label="Weight Per Pc" type="number" value={form.weightPerPc} onChange={(e) => updateField('weightPerPc', e.target.value)} />
          <TextField label="Weight Per Box" type="number" value={form.weightPerBox} onChange={(e) => updateField('weightPerBox', e.target.value)} />
        </Box>
        <TextField label="Aliases" value={form.aliasesText} onChange={(e) => updateField('aliasesText', e.target.value)} helperText="Comma separated old names or alternate codes" fullWidth />
        <TextField label="Packing Details" value={form.packingDetails} onChange={(e) => updateField('packingDetails', e.target.value)} minRows={3} multiline fullWidth />
      </Box>

      <Box sx={{ p: 2.5, borderTop: `1px solid ${O2D.line}`, display: 'flex', gap: 1.5, bgcolor: O2D.surfaceAlt }}>
        <Button variant="outlined" onClick={onClose} fullWidth>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={isSaving} startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} fullWidth>
          {sku?._id ? 'Save Changes' : 'Register SKU'}
        </Button>
      </Box>
    </Drawer>
  );
};

const SkusList = () => {
  const { enqueueSnackbar } = useSnackbar();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchTerm, setSearchTerm] = useState('');
  const [itemType, setItemType] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSku, setSelectedSku] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bulkUpsertSkus, { isLoading: isImporting }] = useBulkUpsertSkusMutation();
  const [deleteSku, { isLoading: isDeleting }] = useDeleteSkuMutation();
  const canDelete = usePermission('masters.deleteSku');

  const { data, isLoading } = useGetSkusQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: searchTerm || undefined,
    ...(itemType ? { itemType } : {}),
    sort: 'name',
  });

  const counts = data?.meta?.itemTypeCounts || {};
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);

  const handleKind = (key) => {
    setItemType(key);
    setPaginationModel((p) => ({ ...p, page: 0 }));
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget?._id) return;
    try {
      await deleteSku(deleteTarget._id).unwrap();
      enqueueSnackbar(`SKU "${deleteTarget.code}" deleted`, { variant: 'success' });
      setDeleteTarget(null);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to delete SKU', { variant: 'error' });
    }
  };

  const handleAdd = () => { setSelectedSku(null); setDrawerOpen(true); };
  const handleEdit = (sku) => { setSelectedSku(sku); setDrawerOpen(true); };

  const handleImportSheetItems = async () => {
    try {
      await bulkUpsertSkus({ items: sheetSkuItems }).unwrap();
      enqueueSnackbar('Sheet SKU items loaded into master', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to load SKU items', { variant: 'error' });
    }
  };

  const columns = [
    SNO_COLUMN,
    { field: 'name', headerName: 'SKU item name', flex: 1, minWidth: 220,
      renderCell: (p) => <CellText weight={700} color={NAVY}>{p.value}</CellText>
    },
    { field: 'code', headerName: 'SKU code', width: 165,
      renderCell: (p) => <CellText mono weight={700} color={BRAND}>{p.value}</CellText>
    },
    // Right after the name/code pair, matching the Excel master's own column
    // order — not out past Type and Group, where it sat behind a horizontal
    // scroll on a 1366px laptop and read as "missing".
    // minWidth 275 is measured, not guessed: the uppercase header at 0.64rem with
    // 0.07em tracking measures 246px and the header cell eats ~22px of padding,
    // so 230 clipped it to "CONVERTED ITEM NAME (FOR …" — the column's own identity.
    // Long values still ellipsise in the cell and show in full on hover.
    { field: 'convertedItemNameForResale', headerName: 'Converted Item Name (For Resale)', flex: 1, minWidth: 275,
      renderCell: (p) => (p.value
        ? <Tooltip title={p.value}><Box sx={{ minWidth: 0, alignSelf: 'center' }}><CellText color={O2D.sub}>{p.value}</CellText></Box></Tooltip>
        : <Empty />)
    },
    // width 150 (was 140) so "Finished Good" never wraps or clips inside its pill.
    // Every type pill is held to one width so the column reads as a single set
    // rather than a ragged edge — "Finished Good" measures ~95px, the widest of
    // the five labels, so 104 clears it with room to spare on any font stack.
    { field: 'itemType', headerName: 'Type', width: 150,
      renderCell: (p) => {
        // An unknown value is shown as itself — never relabelled as a Finished Good.
        const m = TYPE_META[p.value] || (p.value ? { label: p.value, color: '#475569' } : TYPE_META.FINISHED_GOOD);
        return <Pill color={m.color} minWidth={104}>{m.label}</Pill>;
      }
    },
    { field: 'category', headerName: 'Group', width: 150,
      renderCell: (p) => (p.value ? <CellText color={O2D.sub}>{p.value}</CellText> : <Empty />)
    },
    { field: 'pcsPerBox', headerName: 'Pcs/box', width: 100, align: 'center', headerAlign: 'center',
      renderCell: (p) => (p.value ? <CellText weight={700} color={NAVY}>{p.value}</CellText> : <Empty />)
    },
    { field: 'unit', headerName: 'Unit', width: 92, align: 'center', headerAlign: 'center',
      renderCell: (p) => <Pill color={O2D.sub}>{p.value || 'PCS'}</Pill>
    },
    { field: 'actions', headerName: '', width: canDelete ? 104 : 68, sortable: false, align: 'center', headerAlign: 'center',
      renderCell: (p) => (
        <Stack direction="row" spacing={0.25} sx={{ alignSelf: 'center' }}>
          <Tooltip title="Edit SKU">
            <IconButton size="small" onClick={() => handleEdit(p.row)}
              sx={{ color: BRAND, '&:hover': { bgcolor: alpha(BRAND, 0.1) } }}>
              <Edit3 size={15} />
            </IconButton>
          </Tooltip>
          {canDelete && (
            <Tooltip title="Delete SKU">
              <IconButton size="small" onClick={() => setDeleteTarget(p.row)}
                sx={{ color: DANGER, '&:hover': { bgcolor: alpha(DANGER, 0.1) } }}>
                <Trash2 size={15} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      )
    },
  ];

  return (
    <Box sx={pageSx}>
      {/* Header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 1.75 }}>
        <PageHeading title="SKU Master" subtitle="All items — finished goods, raw material, consumables & packing" />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: { xs: '100%', md: 'auto' } }}>
          <TextField size="small" placeholder="Search SKU item or code" value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPaginationModel((p) => ({ ...p, page: 0 })); }}
            sx={{ ...fieldSx, width: { xs: '100%', sm: 250 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} color={O2D.faint} /></InputAdornment> }}
          />
          <Button variant="outlined" startIcon={isImporting ? <CircularProgress size={15} /> : <Upload size={15} />}
            disabled={isImporting} onClick={handleImportSheetItems}
            sx={{ ...btnSx, bgcolor: O2D.surface, color: BRAND_DK, borderColor: O2D.line, '&:hover': { borderColor: BRAND, bgcolor: alpha(BRAND, 0.04) } }}>
            Load Sheet SKUs
          </Button>
          <Button variant="contained" startIcon={<Plus size={15} />} onClick={handleAdd}
            sx={{ ...btnSx, bgcolor: BRAND, '&:hover': { bgcolor: BRAND_DK } }}>
            Register SKU
          </Button>
        </Stack>
      </Box>

      {/* Kind tabs — segmented filter. No lift-on-hover: rows of chips that move
          under the cursor make the toolbar feel unstable when scanning counts. */}
      <Stack direction="row" spacing={0.85} flexWrap="wrap" useFlexGap>
        {SKU_KINDS.map((kind) => {
          const Icon = kind.icon;
          const selected = itemType === kind.key;
          const count = kind.key === '' ? allCount : (counts[kind.key] || 0);
          return (
            <Box
              key={kind.key || 'all'}
              onClick={() => handleKind(kind.key)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0,
                height: 34, px: 1.35, borderRadius: '8px', cursor: 'pointer',
                border: `1px solid ${selected ? BRAND : O2D.line}`,
                bgcolor: selected ? BRAND : O2D.surface,
                transition: 'background .15s, border-color .15s',
                '&:hover': selected ? { bgcolor: BRAND_DK } : { borderColor: alpha(BRAND, 0.45), bgcolor: alpha(BRAND, 0.04) },
              }}
            >
              <Icon size={14} color={selected ? '#ffffff' : O2D.sub} />
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, whiteSpace: 'nowrap', color: selected ? '#fff' : NAVY }}>
                {kind.label}
              </Typography>
              <Box sx={{
                minWidth: 20, height: 17, px: 0.55, borderRadius: '5px',
                display: 'grid', placeItems: 'center',
                bgcolor: selected ? alpha('#ffffff', 0.22) : alpha(NAVY, 0.06),
                color: selected ? '#fff' : O2D.sub,
                fontSize: '0.65rem', fontWeight: 800,
              }}>
                {count}
              </Box>
            </Box>
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
          disableRowSelectionOnClick
          disableColumnMenu
          rowHeight={46}
          columnHeaderHeight={42}
          slots={{
            noRowsOverlay: () => (
              <NoRows icon={PackagePlus} title="No SKUs here"
                hint="Try another type, clear the search, or register a new SKU." />
            ),
          }}
          sx={gridSx}
        />
      </Paper>

      <SkuDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sku={selectedSku}
        defaultType={itemType || 'FINISHED_GOOD'}
      />

      {/* Delete confirmation */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => !isDeleting && setDeleteTarget(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ pt: 3, px: 3, pb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(DANGER, 0.1), color: DANGER }}>
            <AlertTriangle size={20} />
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem' }}>Delete this SKU?</Typography>
            <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
              The SKU will be soft-deleted and hidden from all lists.
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
                {TYPE_META[deleteTarget.itemType]?.label || deleteTarget.itemType || 'Finished Good'}
                {deleteTarget.category ? ` · ${deleteTarget.category}` : ''}
              </Typography>
            </Box>
          )}
          <Typography sx={{ mt: 2, fontSize: '0.82rem', color: 'text.secondary' }}>
            Historical orders, challans and price revisions that reference this SKU keep working — only the master row is hidden.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setDeleteTarget(null)} disabled={isDeleting} sx={{ color: 'text.secondary', fontWeight: 700 }}>
            Cancel
          </Button>
          <Button variant="contained" color="error" disabled={isDeleting} onClick={handleDeleteConfirm}
            startIcon={isDeleting ? <CircularProgress size={14} color="inherit" /> : <Trash2 size={14} />}
            sx={{ fontWeight: 700, px: 3 }}>
            {isDeleting ? 'Deleting…' : 'Delete SKU'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SkusList;
