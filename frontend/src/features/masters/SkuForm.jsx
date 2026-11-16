import React, { useEffect, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, CircularProgress, FormControlLabel, MenuItem, Paper, Radio, RadioGroup,
  Stack, TextField, Typography, alpha,
} from '@mui/material';
import {
  ArrowRightLeft, FileText, Package, Repeat, Save, StickyNote, Tag,
} from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useCreateSkuMutation, useUpdateSkuMutation } from '../../store/api/skuApi';

import {
  TYPE_META, typeDestinationHint,
  OTHER_KEY, OTHER_ITEM_TYPES, PRIMARY_TYPE_OPTIONS, isOtherItemType,
} from './itemTypeMeta';
import { UNITS } from '../procurement/indents/indentMeta';
import {
  conversionRule, directionProblem, sameUnit, skuConversion,
} from '../../utils/unitConversion';

/**
 * The SKU register / edit form — fields, client-side checks and save logic.
 * Rendered inside SkuDialogShell by the Register SKU and Edit SKU dialogs
 * (SkuRegisterDialog / SkuEditDialog), so both save exactly the same payload.
 */

// The purchase forms' unit list, in SKU Master's upper-case spelling. Free text
// is still accepted — the master has always kept units as entered.
const UNIT_OPTIONS = UNITS.map((u) => u.toUpperCase());

/**
 * Client-side mirror of the server's conversion rules (sku.service →
 * normalizeConversionConfig), so the form says what is wrong before saving.
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

const emptyForm = {
  name: '', code: '', itemType: 'FINISHED_GOOD', category: '', unit: 'PCS',
  purchaseUnit: '', purchaseConversionFactor: '',
  pcsPerBox: 1, weightPerPc: 0, weightPerBox: 0, leadDays: 7,
  aliasesText: '', packingDetails: '', convertedItemNameForResale: '',
};

const OTHER_TYPE_REQUIRED = 'Select the Other Type — it decides where this item\'s purchased stock is posted.';

/**
 * Item Type selector: the five primary types plus "Other". Picking "Other"
 * opens a second, required "Other Type" list of the existing item types, so
 * the SKU is always saved with a real itemType (never the word OTHER).
 * `value` is the stored itemType, or OTHER_KEY while no Other Type is chosen.
 */
const ItemTypeFields = ({ value, onChange, label, testId }) => {
  const other = isOtherItemType(value);
  const primary = other ? OTHER_KEY : value;
  // Keep a stored value the list does not offer (e.g. Scrap) selectable, so
  // editing such a SKU shows — and keeps — its current type.
  const otherOptions = other && value !== OTHER_KEY && !OTHER_ITEM_TYPES.includes(value)
    ? [...OTHER_ITEM_TYPES, value]
    : OTHER_ITEM_TYPES;
  const hint = value === OTHER_KEY ? OTHER_TYPE_REQUIRED : typeDestinationHint(value);

  return (
    <>
      <TextField
        select
        label={label}
        value={primary}
        // Re-picking "Other" keeps the Other Type already chosen.
        onChange={(e) => onChange(e.target.value === OTHER_KEY && other ? value : e.target.value)}
        fullWidth
        helperText={other ? 'Item types outside the five main groups.' : hint}
        inputProps={testId ? { 'data-testid': testId } : undefined}
      >
        {PRIMARY_TYPE_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
        ))}
      </TextField>
      {other && (
        <TextField
          select
          required
          label="Other Type"
          value={value === OTHER_KEY ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          fullWidth
          error={value === OTHER_KEY}
          helperText={hint}
          inputProps={{ 'data-testid': 'sku-other-type' }}
        >
          {otherOptions.map((t) => (
            <MenuItem key={t} value={t}>{TYPE_META[t]?.label || t}</MenuItem>
          ))}
        </TextField>
      )}
    </>
  );
};

/**
 * A section card in the dialog body — styled like the New Sales Order dialog
 * (orders/OrderEntryDrawer.jsx): a rounded paper with a small uppercase label
 * and icon tile.
 */
const FormSection = ({ icon, title, hint, children }) => {
  const Icon = icon;
  return (
    <Paper sx={{ p: 2.5, borderRadius: '14px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: hint ? 0.5 : 1.5 }}>
        <Box sx={(t) => ({
          width: 24, height: 24, borderRadius: '8px', display: 'grid', placeItems: 'center',
          bgcolor: alpha(t.palette.primary.main, 0.10), color: 'primary.main',
        })}>
          <Icon size={13} strokeWidth={2.5} />
        </Box>
        <Typography sx={{
          fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>{title}</Typography>
      </Box>
      {hint && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>{hint}</Typography>}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</Box>
    </Paper>
  );
};

/** One figure in the bottom bar's summary (as in the New Sales Order footer). */
const SummaryItem = ({ label, value, color = 'text.primary' }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
    <Typography variant="body2" fontWeight={800} color={color} noWrap>{value}</Typography>
  </Box>
);

/**
 * Props:
 *   active      — (re)initialise the form when this turns true
 *   sku         — the SKU being edited, or null to register a new one
 *   defaultType — initial Item Type for a new SKU (may be OTHER_KEY)
 *   onDone      — called after a successful save
 *   onCancel    — called by the Cancel button
 */
const SkuForm = ({ active = true, sku, defaultType, onDone, onCancel }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [form, setForm] = useState(emptyForm);
  // "Do you want to convert the purchase unit into the IMS stock unit?" —
  // No by default; an existing SKU opens on Yes when it already converts.
  const [convert, setConvert] = useState(false);
  const [createSku, { isLoading: isCreating }] = useCreateSkuMutation();
  const [updateSku, { isLoading: isUpdating }] = useUpdateSkuMutation();
  const isSaving = isCreating || isUpdating;

  useEffect(() => {
    if (!active) return;
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
  }, [active, sku, defaultType]);

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
    // "Other" alone is not a stored type — the Other Type decides the itemType.
    if (form.itemType === OTHER_KEY) return enqueueSnackbar(OTHER_TYPE_REQUIRED, { variant: 'warning' });
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
      onDone?.();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to save SKU', { variant: 'error' });
    }
  };

  // Two-column field rows that stack on phones.
  const pairCols = { xs: '1fr', sm: '1fr 1fr' };
  const packCols = { xs: '1fr', sm: '1fr 1fr', xl: 'repeat(3, minmax(0, 1fr))' };

  // ── Field groups ──────────────────────────────────────────────────────────
  // The first question: does this item need a purchase → IMS unit conversion?
  const convertQuestion = (
    <Box data-testid="sku-convert-question">
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
  );

  const codeCategory = (
    <Box sx={{ display: 'grid', gridTemplateColumns: pairCols, gap: 1.5 }}>
      <TextField label="SKU Code" value={form.code} onChange={(e) => updateField('code', e.target.value.toUpperCase())} />
      <TextField label="Category / Sub-group" value={form.category} onChange={(e) => updateField('category', e.target.value)} />
    </Box>
  );

  // Conversion: the fields in the order the question is answered —
  // what the item is, how it is bought, how IMS keeps it, and where.
  const conversionBox = (
    <Box data-testid="sku-purchase-conversion" sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
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
      <ItemTypeFields
        label="6. Save in IMS Model"
        testId="sku-ims-model"
        value={form.itemType}
        onChange={(v) => updateField('itemType', v)}
      />
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
  );

  const convertPackingGrid = (
    <Box sx={{ display: 'grid', gridTemplateColumns: packCols, gap: 1.5 }}>
      <TextField label="Lead Days" type="number" value={form.leadDays} onChange={(e) => updateField('leadDays', e.target.value)} />
      <TextField label="Pcs Per Box" type="number" value={form.pcsPerBox} onChange={(e) => updateField('pcsPerBox', e.target.value)} />
      <TextField label="Weight Per Pc" type="number" value={form.weightPerPc} onChange={(e) => updateField('weightPerPc', e.target.value)} />
      <TextField label="Weight Per Box" type="number" value={form.weightPerBox} onChange={(e) => updateField('weightPerBox', e.target.value)} />
    </Box>
  );

  // Item type — the first decision when registering (no-conversion form).
  const itemTypePlain = (
    <ItemTypeFields
      label="Item Type"
      value={form.itemType}
      onChange={(v) => updateField('itemType', v)}
    />
  );

  const nameFields = (
    <>
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
    </>
  );

  const unitsGrid = (
    <Box sx={{ display: 'grid', gridTemplateColumns: packCols, gap: 1.5 }}>
      <TextField label="Unit" value={form.unit} onChange={(e) => updateField('unit', e.target.value)}
        inputProps={{ 'data-testid': 'sku-stock-unit' }} />
      <TextField label="Lead Days" type="number" value={form.leadDays} onChange={(e) => updateField('leadDays', e.target.value)} />
      <TextField label="Pcs Per Box" type="number" value={form.pcsPerBox} onChange={(e) => updateField('pcsPerBox', e.target.value)} />
      <TextField label="Weight Per Pc" type="number" value={form.weightPerPc} onChange={(e) => updateField('weightPerPc', e.target.value)} />
      <TextField label="Weight Per Box" type="number" value={form.weightPerBox} onChange={(e) => updateField('weightPerBox', e.target.value)} />
    </Box>
  );

  const extras = (
    <>
      <TextField label="Aliases" value={form.aliasesText} onChange={(e) => updateField('aliasesText', e.target.value)} helperText="Comma separated old names or alternate codes" fullWidth />
      <TextField label="Packing Details" value={form.packingDetails} onChange={(e) => updateField('packingDetails', e.target.value)} minRows={3} multiline fullWidth />
    </>
  );

  const saveLabel = sku?._id ? 'Save Changes' : 'Register SKU';
  const saveIcon = isSaving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />;

  // Bottom-bar summary — read-only echo of what will be saved.
  const typeSummary = form.itemType === OTHER_KEY
    ? 'Other — pick a type'
    : isOtherItemType(form.itemType)
      ? `Other · ${TYPE_META[form.itemType]?.label || form.itemType}`
      : (PRIMARY_TYPE_OPTIONS.find((o) => o.value === form.itemType)?.label || form.itemType);

  // ── Dialog body (scrolls on its own) + fixed bottom action bar ──────────────
  // Rendered inside SkuDialogShell, whose header stays fixed above.
  return (
    <>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 2, sm: 3 }, py: 2.5 }} data-testid="sku-form-body">
        <Stack spacing={2}>
          <FormSection icon={Repeat} title="Unit Conversion" hint="Decide first whether this item is bought and stocked in different units.">
            {convertQuestion}
          </FormSection>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
            {convert ? (
              <>
                <Stack spacing={2} sx={{ minWidth: 0 }}>
                  <FormSection icon={Tag} title="Identification" hint="Code and sub-group used across Indent, PO, GRN and IMS.">
                    {codeCategory}
                  </FormSection>
                  <FormSection icon={ArrowRightLeft} title="Purchase → IMS Conversion" hint="How the item is bought, and how IMS stores and issues it.">
                    {conversionBox}
                  </FormSection>
                </Stack>
                <Stack spacing={2} sx={{ minWidth: 0 }}>
                  <FormSection icon={Package} title="Packing & Lead Time">
                    {convertPackingGrid}
                  </FormSection>
                  <FormSection icon={StickyNote} title="Additional Information">
                    {extras}
                  </FormSection>
                </Stack>
              </>
            ) : (
              <>
                <Stack spacing={2} sx={{ minWidth: 0 }}>
                  <FormSection icon={Tag} title="Classification" hint="The Item Type decides where purchased stock is posted.">
                    {itemTypePlain}
                    {codeCategory}
                  </FormSection>
                  <FormSection icon={FileText} title="Item Details">
                    {nameFields}
                  </FormSection>
                </Stack>
                <Stack spacing={2} sx={{ minWidth: 0 }}>
                  <FormSection icon={Package} title="Units & Packing">
                    {unitsGrid}
                  </FormSection>
                  <FormSection icon={StickyNote} title="Additional Information">
                    {extras}
                  </FormSection>
                </Stack>
              </>
            )}
          </Box>
        </Stack>
      </Box>

      {/* ── Fixed bottom action bar ─────────────────────────────────────── */}
      <Box sx={{
        flexShrink: 0, zIndex: 10,
        borderTop: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper',
        px: { xs: 2, sm: 3 }, py: 1.75,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap',
      }}>
        <Stack direction="row" spacing={2.5} sx={{ minWidth: 0, display: { xs: 'none', sm: 'flex' } }}>
          <SummaryItem label="Item Type" value={typeSummary} color={form.itemType === OTHER_KEY ? 'error.main' : 'text.primary'} />
          <SummaryItem label="IMS Unit" value={stockUnitLabel || '—'} />
          <SummaryItem label="Conversion" value={rule || 'None'} color={rule ? 'primary.main' : 'text.secondary'} />
        </Stack>
        <Stack direction="row" spacing={1.25} sx={{ ml: 'auto' }}>
          <Button variant="outlined" onClick={onCancel} sx={{ minWidth: 110 }}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={isSaving} startIcon={saveIcon} sx={{ minWidth: 150 }}>
            {saveLabel}
          </Button>
        </Stack>
      </Box>
    </>
  );
};

export default SkuForm;
