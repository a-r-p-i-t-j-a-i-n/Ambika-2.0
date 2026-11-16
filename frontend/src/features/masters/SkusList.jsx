import React, { Suspense, useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, InputAdornment, Paper, Stack,
  TextField, Tooltip, Typography, alpha,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  AlertTriangle, Edit3, PackagePlus, Plus, Search, Trash2, Upload,
  PackageCheck, Layers, Wrench, Boxes, LayoutGrid, Disc, Shapes,
} from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useBulkUpsertSkusMutation,
  useDeleteSkuMutation,
  useGetSkusQuery,
} from '../../store/api/skuApi';
import { usePermission } from '../../hooks/usePermission';
import { useMasterRights } from '../../utils/embed';
import {
  O2D, BRAND, BRAND_DK, NAVY, DANGER,
  Pill, Empty, CellText, PageHeading, NoRows,
  gridSx, pageSx, panelSx, fieldSx, btnSx, withSno, SNO_COLUMN,
} from './components/masterUi';

// Item-type metadata — labels and colours now live in their own module so the
// IMS stock list can share them without importing this screen.
import {
  TYPE_META, OTHER_KEY, OTHER_FILTER_ITEM_TYPES,
} from './itemTypeMeta';
import { conversionRule, directionProblem } from '../../utils/unitConversion';

const SKU_KINDS = [
  { key: '',              label: 'All Items',      icon: LayoutGrid },
  { key: 'FINISHED_GOOD', label: 'Finished Goods', icon: PackageCheck },
  { key: 'RAW_MATERIAL',  label: 'Raw Material',   icon: Layers },
  { key: 'CONSUMABLE',    label: 'Consumables',    icon: Wrench },
  { key: 'PACKING',       label: 'Packing',        icon: Boxes },
  { key: 'CIRCLE',        label: 'Circles',        icon: Disc },
  // Every other existing item type (Packaging, Chemical, Ink, Spare Part, …).
  { key: OTHER_KEY,       label: 'Other',          icon: Shapes },
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

// The list's tab, search and page survive leaving the SKU Master and coming
// back (the Register / Edit dialogs open over the list, which stays mounted).
// Per browser tab (sessionStorage), and optional: when storage is unavailable
// the list simply opens on its defaults.
const VIEW_KEY = 'skuMaster.view';
const readView = () => {
  try { return JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null') || {}; } catch { return {}; }
};

const SkusList = () => {
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const [savedView] = useState(readView);
  const [paginationModel, setPaginationModel] = useState(savedView.paginationModel || { page: 0, pageSize: 25 });
  const [searchTerm, setSearchTerm] = useState(savedView.searchTerm || '');
  const [itemType, setItemType] = useState(savedView.itemType || '');
  useEffect(() => {
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ paginationModel, searchTerm, itemType })); } catch { /* storage unavailable */ }
  }, [paginationModel, searchTerm, itemType]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bulkUpsertSkus, { isLoading: isImporting }] = useBulkUpsertSkusMutation();
  const [deleteSku, { isLoading: isDeleting }] = useDeleteSkuMutation();
  // Inside the Delegation Suite, its lock icon can switch Edit off and Delete
  // on for this person (SKU Master); delete still needs masters.deleteSku.
  const rights = useMasterRights('skuMaster');
  const canEdit = rights.canEdit;
  const canDelete = usePermission('masters.deleteSku') && rights.canDelete;

  const { data, isLoading } = useGetSkusQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: searchTerm || undefined,
    // "Other" lists every non-primary type, sent as one comma-separated filter.
    ...(itemType ? { itemType: itemType === OTHER_KEY ? OTHER_FILTER_ITEM_TYPES.join(',') : itemType } : {}),
    sort: 'name',
  });

  const counts = data?.meta?.itemTypeCounts || {};
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
  // Counted over exactly the types the Other tab lists, so tab count = rows shown.
  const otherCount = OTHER_FILTER_ITEM_TYPES.reduce((a, t) => a + (counts[t] || 0), 0);

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

  // Registering opens the Register SKU dialog over the list, pre-set to the tab being viewed.
  const handleAdd = () => navigate(`/skus/new${itemType ? `?type=${itemType}` : ''}`);
  // Editing opens the Edit SKU dialog over the list (same form as Register SKU).
  const handleEdit = (sku) => navigate(`/skus/${sku._id}/edit`);

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
    // The purchase → stock rule, when the item is bought in another unit.
    { field: 'purchaseUnit', headerName: 'Purchase unit', width: 140, sortable: false,
      renderCell: (p) => {
        const r = conversionRule(p.row);
        if (!r) return <Empty />;
        // Saved the wrong way round before the form was fixed — shown as such,
        // and refused by Indent / PO / GRN until it is corrected.
        if (directionProblem(p.row)) {
          return <Tooltip title="Wrong way round — open the SKU and set Purchase Unit = the pack, IMS Stock Unit = the piece">
            <Box sx={{ minWidth: 0, alignSelf: 'center' }}><CellText weight={700} color={DANGER}>{r} — fix</CellText></Box>
          </Tooltip>;
        }
        return <CellText weight={700} color={NAVY}>{r}</CellText>;
      }
    },
    ...(canEdit || canDelete ? [{ field: 'actions', headerName: '', width: canEdit && canDelete ? 104 : 68, sortable: false, align: 'center', headerAlign: 'center',
      renderCell: (p) => (
        <Stack direction="row" spacing={0.25} sx={{ alignSelf: 'center' }}>
          {canEdit && (
            <Tooltip title="Edit SKU">
              <IconButton size="small" onClick={() => handleEdit(p.row)}
                sx={{ color: BRAND, '&:hover': { bgcolor: alpha(BRAND, 0.1) } }}>
                <Edit3 size={15} />
              </IconButton>
            </Tooltip>
          )}
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
    }] : []),
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
          {/* Rewrites existing SKUs from the sheet — an edit. */}
          {canEdit && (
            <Button variant="outlined" startIcon={isImporting ? <CircularProgress size={15} /> : <Upload size={15} />}
              disabled={isImporting} onClick={handleImportSheetItems}
              sx={{ ...btnSx, bgcolor: O2D.surface, color: BRAND_DK, borderColor: O2D.line, '&:hover': { borderColor: BRAND, bgcolor: alpha(BRAND, 0.04) } }}>
              Load Sheet SKUs
            </Button>
          )}
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
          const count = kind.key === '' ? allCount
            : kind.key === OTHER_KEY ? otherCount
              : (counts[kind.key] || 0);
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

      {/* Register SKU (/skus/new) and Edit SKU (/skus/:id/edit) dialogs. Own
          Suspense, so loading the dialog never swaps the list for the app loader. */}
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>

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
              The SKU will be hidden from all lists. It moves to the Recycle Bin, where it can be restored.
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
