import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, IconButton, Stack, TextField, Tooltip, Typography, alpha,
} from '@mui/material';
import { Plus, Save, Trash2, CalendarPlus, X, ListPlus, RotateCw } from 'lucide-react';
import dayjs from 'dayjs';
import { useSnackbar } from 'notistack';
import { useGetPartiesQuery, useGetPartyByIdQuery } from '../../store/api/partyApi';
import { useGetSkuLookupQuery } from '../../store/api/skuApi';
import { O2D } from '../o2d-fms/o2dTheme';
import {
  useCreateProductionPlanMutation,
  useUpdateProductionPlanMutation,
} from '../../store/api/productionPlanApi';

// Reads from the O2D design system so the dialog matches the calendar behind it.
const BRAND = { primary: '#1d4ed8', error: '#be123c', ink: O2D.ink, muted: O2D.sub, line: O2D.line };

const emptyLine = () => ({ _tempId: `${Date.now()}-${Math.random()}`, skuId: '', plannedQty: '', note: '' });

/**
 * Create / edit a party-wise production plan.
 *
 * Deliberately does NOT ask for a sales order: the whole reason this screen
 * exists is that planning happens before (or without) a PO. The SO/PO boxes are
 * optional free text so a plan can be tied back to paperwork if it turns up.
 */
export default function ProductionPlanDialog({ open, onClose, plan = null, defaultDate = null }) {
  const { enqueueSnackbar } = useSnackbar();
  const isEdit = Boolean(plan?._id);

  const [partyId, setPartyId] = useState('');
  const [plannedDate, setPlannedDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [soNumber, setSoNumber] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  // Which party the current rows were auto-filled from, so switching party
  // refreshes the catalog but a re-render never re-clobbers typed quantities.
  const [filledPartyId, setFilledPartyId] = useState(null);

  const { data: partiesRes, isLoading: partiesLoading } = useGetPartiesQuery({ limit: 500 }, { skip: !open });

  // Same party-scoped picker the Sales Order punch-in uses: this client's linked
  // SKUs plus the universal unlinked ones, finished goods only — so another
  // party's items can never leak into this plan.
  const { data: skusRes, isLoading: skusLoading } = useGetSkuLookupQuery(
    { limit: 2000, itemType: 'FINISHED_GOOD', ...(partyId ? { clientId: partyId } : {}) },
    { skip: !open },
  );

  // The party's saved catalog (`orderedSkus` — what they regularly buy, learned
  // from every Sales Order). Fetched fresh on selection because the parties LIST
  // query is trimmed and does not carry the full array.
  const { data: partyDetailRes, isFetching: catalogLoading } = useGetPartyByIdQuery(
    partyId, { skip: !open || !partyId },
  );
  const partyDetail = partyDetailRes?.data || null;
  const partyCatalog = useMemo(
    () => (String(partyDetail?._id || '') === String(partyId || '') ? (partyDetail?.orderedSkus || []) : []),
    [partyDetail, partyId],
  );

  const parties = useMemo(() => partiesRes?.data || [], [partiesRes]);

  // Options = the scoped lookup PLUS any catalog SKU it doesn't return (one that
  // has since been deactivated or reclassified). Without this a filled row would
  // render blank while still holding a valid skuId — silently misleading.
  const skus = useMemo(() => {
    const base = skusRes?.data || [];
    const have = new Set(base.map((s) => String(s._id)));
    // Same guard for the lines of a plan being edited.
    const extra = [...partyCatalog, ...(plan?.items || [])]
      .filter((c) => c.skuId && !have.has(String(c.skuId)))
      .map((c) => ({ _id: String(c.skuId), name: c.skuName || 'SKU', code: c.skuCode || '' }));
    if (!extra.length) return base;
    const seen = new Set();
    return [...base, ...extra.filter((s) => !seen.has(s._id) && seen.add(s._id))];
  }, [skusRes, partyCatalog, plan]);

  // Catalog → editable rows with BLANK quantities: the planner's only job is to
  // type how many, which is the whole point of pulling the list in.
  const catalogToLines = useCallback((catalog) => catalog.map((c, i) => ({
    _tempId: `cat-${partyId}-${i}-${c.skuCode || c.skuName || 'row'}`,
    skuId: String(c.skuId || ''),
    skuName: c.skuName || '',
    skuCode: c.skuCode || '',
    plannedQty: '',
    note: '',
  })).filter((l) => l.skuId), [partyId]);

  const loadCatalog = () => {
    if (!partyCatalog.length) return;
    setLines(catalogToLines(partyCatalog));
    setFilledPartyId(partyId);
  };

  const [createPlan, { isLoading: creating }] = useCreateProductionPlanMutation();
  const [updatePlan, { isLoading: updating }] = useUpdateProductionPlanMutation();
  const saving = creating || updating;

  // Reset every time the dialog opens so a previous entry can't bleed through.
  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setPartyId(String(plan.partyId || ''));
      setPlannedDate(dayjs(plan.plannedDate).format('YYYY-MM-DD'));
      setSoNumber(plan.soNumber || '');
      setPoNumber(plan.poNumber || '');
      setRemarks(plan.remarks || '');
      setLines((plan.items || []).map((it) => ({
        _tempId: `${it.skuId}-${Math.random()}`,
        skuId: String(it.skuId || ''),
        plannedQty: String(it.plannedQty ?? ''),
        note: it.note || '',
      })));
      // An existing plan's own lines ARE the fill — never overwrite them with the catalog.
      setFilledPartyId(String(plan.partyId || ''));
    } else {
      setPartyId('');
      setPlannedDate(defaultDate ? dayjs(defaultDate).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'));
      setSoNumber('');
      setPoNumber('');
      setRemarks('');
      setLines([emptyLine()]);
      setFilledPartyId(null);
    }
  }, [open, isEdit, plan, defaultDate]);

  // Pick a party → its usual SKUs drop straight into the rows, quantities blank.
  // Guarded twice: once per party (`filledPartyId`) and once on pristineness, so
  // it fills on selection but never wipes numbers someone has already typed.
  useEffect(() => {
    if (!open || !partyId) return;
    if (filledPartyId === partyId) return;
    if (!partyCatalog.length) return;
    const pristine = lines.every((l) => !(Number(l.plannedQty) > 0));
    if (!pristine) return;
    setLines(catalogToLines(partyCatalog));
    setFilledPartyId(partyId);
  }, [open, partyId, partyCatalog, lines, filledPartyId, catalogToLines]);

  const total = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.plannedQty) || 0), 0),
    [lines],
  );

  const updateLine = (i, patch) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i) => setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const handleSave = async () => {
    if (!partyId) return enqueueSnackbar('Select a party', { variant: 'warning' });
    if (!plannedDate) return enqueueSnackbar('Select a plan date', { variant: 'warning' });

    const items = lines
      .filter((l) => l.skuId && Number(l.plannedQty) > 0)
      .map((l) => ({ skuId: l.skuId, plannedQty: Number(l.plannedQty), note: l.note.trim() }));

    if (!items.length) return enqueueSnackbar('Add at least one SKU with a quantity', { variant: 'warning' });

    const body = { partyId, plannedDate, soNumber, poNumber, remarks, items };

    try {
      if (isEdit) {
        await updatePlan({ id: plan._id, ...body }).unwrap();
        enqueueSnackbar('Plan updated', { variant: 'success' });
      } else {
        const res = await createPlan(body).unwrap();
        enqueueSnackbar(res?.message || 'Plan created', { variant: 'success' });
      }
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to save the plan', { variant: 'error' });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => onClose?.(false)}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: '10px', border: `1px solid ${BRAND.line}` } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25, pb: 1.5 }}>
        <Box sx={{
          width: 34, height: 34, borderRadius: 1.5, display: 'grid', placeItems: 'center',
          bgcolor: alpha(BRAND.primary, 0.1), color: BRAND.primary, border: `1px solid ${alpha(BRAND.primary, 0.2)}`,
        }}>
          <CalendarPlus size={18} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: BRAND.ink, lineHeight: 1.2 }}>
            {isEdit ? `Edit Plan ${plan.planNo || ''}` : 'New Production Plan'}
          </Typography>
          <Typography sx={{ fontSize: '0.78rem', color: BRAND.muted, fontWeight: 500 }}>
            Party and date only — a purchase order is not required
          </Typography>
        </Box>
        <IconButton size="small" onClick={() => onClose?.(false)}><X size={18} /></IconButton>
      </DialogTitle>
      <Divider />

      <DialogContent sx={{ pt: 2.5 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 1.5, mb: 2 }}>
          <Autocomplete
            options={parties}
            loading={partiesLoading}
            getOptionLabel={(p) => p?.name || ''}
            value={parties.find((p) => String(p._id) === partyId) || null}
            onChange={(_, p) => setPartyId(p ? String(p._id) : '')}
            isOptionEqualToValue={(opt, val) => String(opt._id) === String(val?._id)}
            renderInput={(params) => <TextField {...params} label="Party *" size="small" />}
          />
          <TextField
            label="Plan Date *"
            type="date"
            size="small"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 2fr' }, gap: 1.5, mb: 2 }}>
          <TextField label="SO Number (optional)" size="small" value={soNumber} onChange={(e) => setSoNumber(e.target.value)} />
          <TextField label="PO Number (optional)" size="small" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
          <TextField label="Remarks" size="small" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Box>

        <Divider sx={{ mb: 1.5 }} />

        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: BRAND.ink }}>SKUs to produce</Typography>
          {catalogLoading && <CircularProgress size={13} />}
          {!catalogLoading && partyId && (
            partyCatalog.length ? (
              <Button
                size="small"
                variant={filledPartyId === partyId ? 'text' : 'outlined'}
                startIcon={filledPartyId === partyId ? <RotateCw size={13} /> : <ListPlus size={14} />}
                onClick={loadCatalog}
                sx={{ fontWeight: 700, fontSize: '0.72rem' }}
              >
                {filledPartyId === partyId ? 'Reload catalog' : `Load catalog (${partyCatalog.length})`}
              </Button>
            ) : (
              <Chip
                size="small"
                label="No saved SKUs for this party yet — add them manually"
                sx={{ fontSize: '0.68rem', fontWeight: 600, color: BRAND.muted }}
              />
            )
          )}
        </Stack>

        <Stack spacing={1.25}>
          {lines.map((line, i) => (
            <Box
              key={line._tempId}
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2.2fr 1fr 1.6fr auto' }, gap: 1, alignItems: 'center' }}
            >
              <Autocomplete
                options={skus}
                loading={skusLoading}
                getOptionLabel={(s) => (s ? `${s.name}${s.code ? ` (${s.code})` : ''}` : '')}
                value={skus.find((s) => String(s._id) === line.skuId) || null}
                onChange={(_, s) => updateLine(i, { skuId: s ? String(s._id) : '' })}
                isOptionEqualToValue={(opt, val) => String(opt._id) === String(val?._id)}
                renderInput={(params) => <TextField {...params} label="SKU" size="small" />}
              />
              <TextField
                label="Qty"
                type="number"
                size="small"
                value={line.plannedQty}
                onChange={(e) => updateLine(i, { plannedQty: e.target.value })}
                inputProps={{ min: 0 }}
              />
              <TextField
                label="Note"
                size="small"
                value={line.note}
                onChange={(e) => updateLine(i, { note: e.target.value })}
              />
              <Stack direction="row" spacing={0.25}>
                <Tooltip title="Add line">
                  <IconButton onClick={addLine} sx={{ color: BRAND.primary }}><Plus size={18} /></IconButton>
                </Tooltip>
                <Tooltip title="Remove line">
                  <span>
                    <IconButton onClick={() => removeLine(i)} disabled={lines.length === 1} sx={{ color: BRAND.error }}>
                      <Trash2 size={18} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Box>
          ))}
        </Stack>

        <Box sx={{ mt: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha(BRAND.primary, 0.06), display: 'flex', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: BRAND.muted }}>Total planned quantity</Typography>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: BRAND.primary }}>
            {total.toLocaleString('en-IN')} pcs
          </Typography>
        </Box>
      </DialogContent>

      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={() => onClose?.(false)} sx={{ color: BRAND.muted, fontWeight: 700 }}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
        >
          {isEdit ? 'Save Changes' : 'Create Plan'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
