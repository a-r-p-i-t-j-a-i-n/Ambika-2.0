import React, { useMemo, useState } from 'react';
import {
  Drawer, Box, Stack, Typography, IconButton, Button, TextField, MenuItem,
  Table, TableHead, TableBody, TableRow, TableCell, Chip, alpha, CircularProgress, Tooltip,
} from '@mui/material';
import { X, Plus, Save, Trash2, Package, RotateCcw } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetSkusQuery, useCreateSkuMutation, useUpdateSkuMutation, useDeleteSkuMutation,
} from '../../store/api/skuApi';

const UNITS = ['PCS', 'KGS', 'MTR', 'LTR', 'SET', 'BOX'];
const ACCENT = '#2563eb';

const emptyRow = {
  name: '', code: '', category: '', unit: 'PCS',
  pcsPerBox: 1, weightPerPc: 0, sellingPrice: 0, gstRate: 18,
};

// Box weight is derived from the per-piece weight × pieces per box, so the two
// packing figures can never drift apart (the delivery challan reads both).
const boxWeightOf = (r) => Number(((Number(r.weightPerPc) || 0) * (Number(r.pcsPerBox) || 0)).toFixed(3));

const num = (n) => Number(n || 0).toLocaleString('en-IN');

// One compact editable cell.
const Cell = ({ value, onChange, type = 'text', width = 90, adornment, ...rest }) => (
  <TextField
    size="small" value={value} type={type}
    onChange={(e) => onChange(type === 'number' ? e.target.value : e.target.value)}
    inputProps={{ style: { fontSize: '0.78rem', padding: '6px 8px' }, min: 0 }}
    InputProps={adornment ? { startAdornment: <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', mr: 0.25 }}>{adornment}</Typography> } : undefined}
    sx={{ width }}
    {...rest}
  />
);

/**
 * Manage the SKUs linked to ONE party (client) — add new items, edit their code,
 * packing and SELLING PRICE, or remove them. Everything saved here is stamped with
 * this party's `clientId`, which is exactly what the Sales Order screen reads, so
 * whatever is linked here shows up when an order is punched for this party.
 */
const PartySkusDrawer = ({ open, onClose, party }) => {
  const { enqueueSnackbar } = useSnackbar();
  const partyId = party?._id;
  const { data, isFetching } = useGetSkusQuery(
    { clientId: partyId, limit: 500 },
    { skip: !open || !partyId },
  );
  const skus = useMemo(() => data?.data || [], [data]);

  const [createSku, { isLoading: creating }] = useCreateSkuMutation();
  const [updateSku] = useUpdateSkuMutation();
  const [deleteSku] = useDeleteSkuMutation();

  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState(emptyRow);
  const [drafts, setDrafts] = useState({});   // { [skuId]: { field: value } }
  const [savingId, setSavingId] = useState(null);

  const setNew = (patch) => setNewRow((r) => ({ ...r, ...patch }));
  const setDraft = (id, patch) => setDrafts((d) => ({ ...d, [id]: { ...(d[id] || {}), ...patch } }));
  const rowOf = (sku) => ({ ...sku, ...(drafts[sku._id] || {}) });
  const isDirty = (id) => !!drafts[id] && Object.keys(drafts[id]).length > 0;

  const handleAdd = async () => {
    if (!newRow.name.trim() || !newRow.code.trim()) {
      return enqueueSnackbar('Name and Code are required.', { variant: 'warning' });
    }
    try {
      await createSku({
        ...newRow,
        name: newRow.name.trim(),
        code: newRow.code.trim().toUpperCase(),
        clientId: partyId,           // ← links the SKU to THIS party
        itemType: 'FINISHED_GOOD',   // party-linked SKUs are what we sell
        pcsPerBox: Number(newRow.pcsPerBox) || 1,
        weightPerPc: Number(newRow.weightPerPc) || 0,
        weightPerBox: boxWeightOf(newRow),
        sellingPrice: Number(newRow.sellingPrice) || 0,
        gstRate: Number(newRow.gstRate) || 0,
      }).unwrap();
      enqueueSnackbar(`${newRow.name} linked to ${party?.name || 'this party'}.`, { variant: 'success' });
      setNewRow(emptyRow);
      setAdding(false);
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not add the SKU.', { variant: 'error' });
    }
  };

  const handleSave = async (sku) => {
    const r = rowOf(sku);
    setSavingId(sku._id);
    try {
      await updateSku({
        id: sku._id,
        name: String(r.name || '').trim(),
        code: String(r.code || '').trim().toUpperCase(),
        category: r.category || '',
        unit: r.unit || 'PCS',
        pcsPerBox: Number(r.pcsPerBox) || 1,
        weightPerPc: Number(r.weightPerPc) || 0,
        weightPerBox: boxWeightOf(r),
        sellingPrice: Number(r.sellingPrice) || 0,
        gstRate: Number(r.gstRate) || 0,
      }).unwrap();
      setDrafts((d) => { const n = { ...d }; delete n[sku._id]; return n; });
      enqueueSnackbar('SKU updated.', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not save the SKU.', { variant: 'error' });
    } finally { setSavingId(null); }
  };

  const handleDelete = async (sku) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove "${sku.name}" (${sku.code}) from ${party?.name || 'this party'}?`)) return;
    try {
      await deleteSku(sku._id).unwrap();
      enqueueSnackbar('SKU removed.', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not remove the SKU.', { variant: 'error' });
    }
  };

  const th = { fontWeight: 800, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'text.secondary', whiteSpace: 'nowrap', py: 0.75 };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', md: 980 }, maxWidth: '100%' } }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1.25}
        sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: alpha(ACCENT, 0.04) }}>
        <Box sx={{ p: 0.75, borderRadius: 2, bgcolor: alpha(ACCENT, 0.12), color: ACCENT, display: 'flex' }}><Package size={18} /></Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.2 }}>Manage SKUs</Typography>
          <Typography variant="caption" color="text.secondary">
            {party?.name || '—'} · these items show when a sales order is punched for this party
          </Typography>
        </Box>
        <Chip size="small" label={`${skus.length} linked`} sx={{ fontWeight: 700, bgcolor: alpha(ACCENT, 0.1), color: ACCENT }} />
        {!adding && (
          <Button size="small" variant="contained" startIcon={<Plus size={14} />} disableElevation
            onClick={() => setAdding(true)} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
            Add SKU
          </Button>
        )}
        <IconButton size="small" onClick={onClose}><X size={18} /></IconButton>
      </Stack>

      {/* Add form */}
      {adding && (
        <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: alpha(ACCENT, 0.02) }}>
          <Typography variant="caption" sx={{ fontWeight: 800, color: ACCENT, display: 'block', mb: 1 }}>NEW SKU FOR {String(party?.name || '').toUpperCase()}</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <Cell value={newRow.name} onChange={(v) => setNew({ name: v })} label="Name" width={190} InputLabelProps={{ shrink: true }} />
            <Cell value={newRow.code} onChange={(v) => setNew({ code: v })} label="Code" width={130} InputLabelProps={{ shrink: true }} />
            <Cell value={newRow.category} onChange={(v) => setNew({ category: v })} label="Category" width={120} InputLabelProps={{ shrink: true }} />
            <TextField select size="small" label="Unit" value={newRow.unit} onChange={(e) => setNew({ unit: e.target.value })}
              InputLabelProps={{ shrink: true }} inputProps={{ style: { fontSize: '0.78rem', padding: '6px 8px' } }} sx={{ width: 90 }}>
              {UNITS.map((u) => <MenuItem key={u} value={u} sx={{ fontSize: '0.8rem' }}>{u}</MenuItem>)}
            </TextField>
            <Cell value={newRow.pcsPerBox} onChange={(v) => setNew({ pcsPerBox: v })} type="number" label="Pcs / Box" width={90} InputLabelProps={{ shrink: true }} />
            <Cell value={newRow.weightPerPc} onChange={(v) => setNew({ weightPerPc: v })} type="number" label="Wt / Pc (kg)" width={100} InputLabelProps={{ shrink: true }} />
            <Cell value={newRow.sellingPrice} onChange={(v) => setNew({ sellingPrice: v })} type="number" label="Price" adornment="₹" width={110} InputLabelProps={{ shrink: true }} />
            <Cell value={newRow.gstRate} onChange={(v) => setNew({ gstRate: v })} type="number" label="GST %" width={80} InputLabelProps={{ shrink: true }} />
            <Chip size="small" variant="outlined" label={`Box wt: ${boxWeightOf(newRow)} kg`} sx={{ fontSize: '0.65rem', fontWeight: 700 }} />
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={() => { setAdding(false); setNewRow(emptyRow); }}>Cancel</Button>
            <Button size="small" variant="contained" disableElevation disabled={creating}
              startIcon={creating ? <CircularProgress size={13} color="inherit" /> : <Plus size={14} />}
              onClick={handleAdd} sx={{ fontWeight: 700 }}>
              {creating ? 'Adding…' : 'Add'}
            </Button>
          </Stack>
        </Box>
      )}

      {/* Linked SKU table — every field editable, including the selling price */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {isFetching && !skus.length ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress size={22} /></Box>
        ) : !skus.length ? (
          <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
            <Package size={34} style={{ opacity: 0.4 }} />
            <Typography sx={{ fontWeight: 700, mt: 1 }}>No SKUs linked to this party yet</Typography>
            <Typography variant="caption">Click <b>Add SKU</b> above — it will then appear when you punch a sales order for {party?.name || 'this party'}.</Typography>
          </Box>
        ) : (
          <Table size="small" sx={{ '& td': { py: 0.6, px: 1 } }}>
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(ACCENT, 0.05) }}>
                {/* 'S.No.' leads the array so the generated header matches the
                    serial cell the body now renders first. */}
                {['S.No.', 'Name', 'Code', 'Category', 'Unit', 'Pcs / Box', 'Wt / Pc (kg)', 'Box wt', 'Selling Price', 'GST %', ''].map((h, i) => (
                  <TableCell key={h || i} sx={th}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {skus.map((sku, i) => {
                const r = rowOf(sku);
                const dirty = isDirty(sku._id);
                return (
                  <TableRow key={sku._id} hover sx={{ bgcolor: dirty ? alpha('#d97706', 0.06) : 'inherit' }}>
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>{i + 1}</TableCell>
                    <TableCell><Cell value={r.name || ''} onChange={(v) => setDraft(sku._id, { name: v })} width={190} /></TableCell>
                    <TableCell><Cell value={r.code || ''} onChange={(v) => setDraft(sku._id, { code: v })} width={130} /></TableCell>
                    <TableCell><Cell value={r.category || ''} onChange={(v) => setDraft(sku._id, { category: v })} width={120} /></TableCell>
                    <TableCell>
                      <TextField select size="small" value={r.unit || 'PCS'} onChange={(e) => setDraft(sku._id, { unit: e.target.value })}
                        inputProps={{ style: { fontSize: '0.78rem', padding: '6px 8px' } }} sx={{ width: 88 }}>
                        {UNITS.map((u) => <MenuItem key={u} value={u} sx={{ fontSize: '0.8rem' }}>{u}</MenuItem>)}
                      </TextField>
                    </TableCell>
                    <TableCell><Cell value={r.pcsPerBox ?? 1} onChange={(v) => setDraft(sku._id, { pcsPerBox: v })} type="number" width={82} /></TableCell>
                    <TableCell><Cell value={r.weightPerPc ?? 0} onChange={(v) => setDraft(sku._id, { weightPerPc: v })} type="number" width={95} /></TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap', color: 'text.secondary' }}>{boxWeightOf(r)} kg</TableCell>
                    <TableCell><Cell value={r.sellingPrice ?? 0} onChange={(v) => setDraft(sku._id, { sellingPrice: v })} type="number" adornment="₹" width={110} /></TableCell>
                    <TableCell><Cell value={r.gstRate ?? 18} onChange={(v) => setDraft(sku._id, { gstRate: v })} type="number" width={72} /></TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                        {dirty && (
                          <>
                            <Tooltip title="Discard changes">
                              <IconButton size="small" onClick={() => setDrafts((d) => { const n = { ...d }; delete n[sku._id]; return n; })}>
                                <RotateCcw size={14} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Save changes">
                              <span>
                                <IconButton size="small" color="primary" disabled={savingId === sku._id} onClick={() => handleSave(sku)}>
                                  {savingId === sku._id ? <CircularProgress size={13} /> : <Save size={14} />}
                                </IconButton>
                              </span>
                            </Tooltip>
                          </>
                        )}
                        <Tooltip title="Remove from this party">
                          <IconButton size="small" color="error" onClick={() => handleDelete(sku)}><Trash2 size={14} /></IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Box>

      {/* Footer */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">
          {skus.length ? `${num(skus.length)} SKU(s) linked · edit any field then hit save on that row` : 'Nothing linked yet'}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" onClick={onClose}>Close</Button>
      </Stack>
    </Drawer>
  );
};

export default PartySkusDrawer;
