import React, { useEffect, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Drawer, FormControlLabel, IconButton, InputAdornment, MenuItem, Paper, Radio, RadioGroup, Stack,
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
import { useMasterRights } from '../../utils/embed';
import {
  O2D, BRAND, BRAND_DK, NAVY, DANGER,
  Pill, Empty, CellText, PageHeading, NoRows,
  gridSx, pageSx, panelSx, fieldSx, btnSx, withSno, SNO_COLUMN,
} from './components/masterUi';

// Item-type metadata — labels and colours now live in their own module so the
// IMS stock list can share them without importing this screen.
import { TYPE_META, typeDestinationHint } from './itemTypeMeta';
import { UNITS } from '../procurement/indents/indentMeta';
import {
  conversionRule, directionProblem, sameUnit, skuConversion,
} from '../../utils/unitConversion';

// The purchase forms' unit list, in SKU Master's upper-case spelling. Free text
// is still accepted — the master has always kept units as entered.
const UNIT_OPTIONS = UNITS.map((u) => u.toUpperCase());

/**
 * Client-side mirror of the server's conversion rules (sku.service →
 * normalizeConversionConfig), so the drawer says what is wrong before saving.
 * Used only when "convert" is Yes. Returns one message per field ('' = fine).
 */
const conversionErrors = ({ unit, purchaseUnit, purchaseConversionFactor }) => {
  const pu = String(purchaseUnit || '').trim();
  const stock = String(unit || '').trim();
  const raw = String(purchaseConversionFactor ?? '').trim();
  const e = { purchaseUnit: '', unit: '', factor: '' };
  if (!pu) e.purchaseUnit = 'Select the unit the vendor ships in (e.g. BOX).';
  if (!stock) e.unit = 'Select the unit IMS counts and issues in (e.g. PCS).';
  if (pu && stock && sameUnit(pu, stock)) {
    e.unit = `${stock} is the Purchase Unit too — choose "No" above when the item is bought and stocked in the same unit.`;
  }
  const f = Number(raw);
  const of = `how many ${stock || 'stock units'} are in 1 ${pu || 'purchase unit'}`;
  if (!raw) e.factor = `Enter ${of}.`;
  else if (!Number.isFinite(f) || f <= 0) e.factor = `Must be a number greater than zero — ${of}.`;
  else if (f > 1000000) e.factor = 'Cannot exceed 1000000.';
  else if ((raw.split('.')[1] || '').length > 4) e.factor = 'At most 4 decimal places.';
  const dir = directionProblem({ unit: stock, purchaseUnit: pu, purchaseConversionFactor: raw });
  if (dir && !e.unit && !e.purchaseUnit) {
    if (/wrong way round/i.test(dir)) e.purchaseUnit = dir; else e.factor = e.factor || dir;
  }
  return e;
};
const firstError = (e) => e.purchaseUnit || e.factor || e.unit || '';

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
  purchaseUnit: '', purchaseConversionFactor: '',
  pcsPerBox: 1, weightPerPc: 0, weightPerBox: 0, leadDays: 7,
  aliasesText: '', packingDetails: '', convertedItemNameForResale: '',
};

const SkuDrawer = ({ open, onClose, sku, defaultType }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [form, setForm] = useState(emptyForm);
  // "Do you want to convert the purchase unit into the IMS stock unit?" —
  // No by default; an existing SKU opens on Yes when it already converts.
  const [convert, setConvert] = useState(false);
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
      // Blank on SKUs saved before the purchase unit existed = bought in the stock unit.
      purchaseUnit: sku.purchaseUnit || '',
      purchaseConversionFactor: sku.purchaseConversionFactor ?? '',
      pcsPerBox: sku.pcsPerBox || 1,
      weightPerPc: sku.weightPerPc || 0,
      weightPerBox: sku.weightPerBox || 0,
      leadDays: sku.leadDays || 7,
      aliasesText: (sku.aliases || []).join(', '),
      packingDetails: sku.packingDetails || '',
      // Missing on SKUs created before this field existed — reads as ''.
      convertedItemNameForResale: sku.convertedItemNameForResale || '',
    } : { ...emptyForm, itemType: defaultType || 'FINISHED_GOOD' });
    // A saved purchase unit (even one stored the wrong way round, so it can be
    // seen and corrected) opens the conversion section.
    setConvert(!!String(sku?.purchaseUnit || '').trim());
  }, [open, sku, defaultType]);

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const convErrors = convert ? conversionErrors(form) : { purchaseUnit: '', unit: '', factor: '' };
  const convError = firstError(convErrors);
  const rule = convert && !convError ? conversionRule(form) : '';
  const stockUnitLabel = String(form.unit || '').trim();
  const purchaseUnitLabel = String(form.purchaseUnit || '').trim();
  const factorNum = Number(form.purchaseConversionFactor);
  // Turning conversion off on a SKU that converts today.
  const wasConverting = !!sku && skuConversion(sku).converts;

  const handleSave = async () => {
    if (!form.name.trim()) return enqueueSnackbar('SKU item name is required', { variant: 'warning' });
    if (!form.code.trim()) return enqueueSnackbar('SKU code is required', { variant: 'warning' });
    if (convError) return enqueueSnackbar(convError, { variant: 'warning' });

    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      itemType: form.itemType,
      category: form.category.trim(),
      unit: form.unit.trim() || 'PCS',
      // "No" = bought and stocked in one unit, exactly like every existing SKU.
      purchaseUnit: convert ? purchaseUnitLabel : '',
      purchaseConversionFactor: convert ? Number(form.purchaseConversionFactor) : null,
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
        {/* The first question: does this item need a purchase → IMS unit conversion? */}
        <Box data-testid="sku-convert-question"
          sx={{ border: `1px solid ${O2D.line}`, borderRadius: '10px', px: 1.5, py: 1, bgcolor: O2D.surfaceAlt }}>
          <Typography variant="body2" fontWeight={800}>Do you want to convert the purchase unit into the IMS stock unit?</Typography>
          <RadioGroup row value={convert ? 'yes' : 'no'} onChange={(e) => setConvert(e.target.value === 'yes')}>
            <FormControlLabel value="no" control={<Radio size="small" inputProps={{ 'data-testid': 'sku-convert-no' }} />} label="No" />
            <FormControlLabel value="yes" control={<Radio size="small" inputProps={{ 'data-testid': 'sku-convert-yes' }} />} label="Yes" />
          </RadioGroup>
          <Typography variant="caption" color="text.secondary">
            {convert
              ? 'Bought in one unit (e.g. BOX), stored and issued in IMS in another (e.g. PCS).'
              : 'Bought and stored in the same unit.'}
          </Typography>
          {!convert && wasConverting && (
            <Alert severity="warning" sx={{ mt: 1, py: 0.25 }}>
              Saving with “No” stops converting future receipts ({conversionRule(sku)} today). Stock already received is not changed.
            </Alert>
          )}
        </Box>

        {convert ? (
          // Conversion: the fields in the order the question is answered —
          // what the item is, how it is bought, how IMS keeps it, and where.
          <>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <TextField label="SKU Code" value={form.code} onChange={(e) => updateField('code', e.target.value.toUpperCase())} />
              <TextField label="Category / Sub-group" value={form.category} onChange={(e) => updateField('category', e.target.value)} />
            </Box>
            <Box data-testid="sku-purchase-conversion"
              sx={{ border: `1px solid ${O2D.line}`, borderRadius: '10px', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.75 }}>
              <TextField label="1. Item Name" value={form.name} onChange={(e) => updateField('name', e.target.value)} fullWidth
                inputProps={{ 'data-testid': 'sku-item-name' }} />
              <TextField
                label="2. Converted Item Name (optional)"
                value={form.convertedItemNameForResale}
                onChange={(e) => updateField('convertedItemNameForResale', e.target.value)}
                helperText="Only if the item goes by a different name after conversion — otherwise leave blank."
                fullWidth
              />
              <Autocomplete
                freeSolo
                options={UNIT_OPTIONS}
                inputValue={form.purchaseUnit}
                onInputChange={(_e, v) => updateField('purchaseUnit', v || '')}
                renderInput={(params) => (
                  <TextField {...params} label="3. Purchase Unit *" placeholder="e.g. BOX"
                    error={!!convErrors.purchaseUnit}
                    helperText={convErrors.purchaseUnit || 'The unit the vendor ships — used on Indent, PO and GRN.'}
                    inputProps={{ ...params.inputProps, 'data-testid': 'sku-purchase-unit' }} />
                )}
              />
              <TextField
                label="4. Conversion Factor *"
                type="number"
                value={form.purchaseConversionFactor}
                onChange={(e) => updateField('purchaseConversionFactor', e.target.value)}
                error={!!convErrors.factor}
                helperText={convErrors.factor || `How many ${stockUnitLabel || 'IMS units'} are in 1 ${purchaseUnitLabel || 'purchase unit'}.`}
                inputProps={{ min: 0, step: 'any', 'data-testid': 'sku-conversion-factor' }}
              />
              <Autocomplete
                freeSolo
                options={UNIT_OPTIONS}
                inputValue={form.unit}
                onInputChange={(_e, v) => updateField('unit', v || '')}
                renderInput={(params) => (
                  <TextField {...params} label="5. IMS Stock Unit *" placeholder="e.g. PCS"
                    error={!!convErrors.unit}
                    helperText={convErrors.unit || 'The unit IMS stores and issues in.'}
                    inputProps={{ ...params.inputProps, 'data-testid': 'sku-stock-unit' }} />
                )}
              />
              <TextField
                select
                label="6. Save in IMS Model"
                value={form.itemType}
                onChange={(e) => updateField('itemType', e.target.value)}
                fullWidth
                helperText={typeDestinationHint(form.itemType)}
                inputProps={{ 'data-testid': 'sku-ims-model' }}
              >
                {TYPE_OPTIONS.map((t) => (
                  <MenuItem key={t} value={t}>{TYPE_META[t]?.label || t}</MenuItem>
                ))}
              </TextField>
              {rule ? (
                <Alert severity="info" sx={{ py: 0.25 }} data-testid="sku-conversion-rule">
                  <strong>{rule}</strong>
                  {' '}— {Number.isFinite(factorNum) ? `5 ${purchaseUnitLabel} received = ${Math.round(5 * factorNum * 100) / 100} ${stockUnitLabel} in IMS. ` : ''}
                  Indent, PO and GRN use {purchaseUnitLabel}; IMS stock and issues use {stockUnitLabel}.
                  {sku?._id ? ' A new factor applies to future receipts only; stock already received is not changed.' : ''}
                </Alert>
              ) : (
                <Typography variant="caption" color="error" data-testid="sku-conversion-rule">{convError}</Typography>
              )}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <TextField label="Lead Days" type="number" value={form.leadDays} onChange={(e) => updateField('leadDays', e.target.value)} />
              <TextField label="Pcs Per Box" type="number" value={form.pcsPerBox} onChange={(e) => updateField('pcsPerBox', e.target.value)} />
              <TextField label="Weight Per Pc" type="number" value={form.weightPerPc} onChange={(e) => updateField('weightPerPc', e.target.value)} />
              <TextField label="Weight Per Box" type="number" value={form.weightPerBox} onChange={(e) => updateField('weightPerBox', e.target.value)} />
            </Box>
          </>
        ) : (
          // No conversion: the form exactly as it has always been.
          <>
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
            <TextField label="SKU Item Name" value={form.name} onChange={(e) => updateField('name', e.target.value)} fullWidth
              inputProps={{ 'data-testid': 'sku-item-name' }} />
            <TextField
              label="Converted Item Name (For Resale)"
              value={form.convertedItemNameForResale}
              onChange={(e) => updateField('convertedItemNameForResale', e.target.value)}
              placeholder={'e.g. 1.75" Brush'}
              helperText="Optional — the name this item is sold on as, when it differs from the item name."
              fullWidth
            />

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <TextField label="Unit" value={form.unit} onChange={(e) => updateField('unit', e.target.value)}
                inputProps={{ 'data-testid': 'sku-stock-unit' }} />
              <TextField label="Lead Days" type="number" value={form.leadDays} onChange={(e) => updateField('leadDays', e.target.value)} />
              <TextField label="Pcs Per Box" type="number" value={form.pcsPerBox} onChange={(e) => updateField('pcsPerBox', e.target.value)} />
              <TextField label="Weight Per Pc" type="number" value={form.weightPerPc} onChange={(e) => updateField('weightPerPc', e.target.value)} />
              <TextField label="Weight Per Box" type="number" value={form.weightPerBox} onChange={(e) => updateField('weightPerBox', e.target.value)} />
            </Box>
          </>
        )}
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
  // Inside the Delegation Suite, its lock icon can switch Edit off and Delete
  // on for this person (SKU Master); delete still needs masters.deleteSku.
  const rights = useMasterRights('skuMaster');
  const canEdit = rights.canEdit;
  const canDelete = usePermission('masters.deleteSku') && rights.canDelete;

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
