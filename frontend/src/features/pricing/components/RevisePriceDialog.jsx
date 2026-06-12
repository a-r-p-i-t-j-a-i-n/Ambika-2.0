import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, Typography, Box, CircularProgress, alpha, useTheme, Autocomplete,
  MenuItem, Chip, Switch, FormControlLabel, IconButton, Tooltip,
} from '@mui/material';
import {
  IndianRupee, Upload, X, Paperclip, ShieldAlert, Calendar, Sparkles, Eye,
} from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useGetSkuLookupQuery } from '../../../store/api/skuApi';
import { useSubmitRevisionMutation } from '../../../store/api/pricingApi';
import { fmtINR } from '../../../utils/formatters';

const REASON_PRESETS = [
  'Steel / raw material increase',
  'Freight cost change',
  'Labour cost revision',
  'Customer negotiation',
  'Annual price revision',
  'Initial price set',
  'Other',
];

// Price-change proofs go into the dedicated "pricing" S3 folder (whitelisted on
// the backend) so they don't mix with order documents in the bucket.
const UPLOAD_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1') + '/uploads?folder=pricing';

// Buy-side items (raw material, consumables, packing) have ONE price stream —
// their purchase cost (RM_COST). Finished goods can have both a selling price
// and a cost. This keeps a consumable's price from being filed as "Selling".
const BUY_SIDE_KINDS = ['RAW_MATERIAL', 'CONSUMABLE', 'PACKING'];
const streamFor = (sku, fallback = 'SELLING') => (
  BUY_SIDE_KINDS.includes(sku?.itemType) ? 'RM_COST' : fallback
);

const RevisePriceDialog = ({ open, onClose, presetSku, defaultPriceType = 'SELLING' }) => {
  const theme = useTheme();
  // Lookup endpoint = active + non-deleted, sorted by name. Soft-delete unwanted
  // SKUs from the SKU Master page if anything stale appears here.
  const { data: skusRes } = useGetSkuLookupQuery({ limit: 2000 }, { skip: !open });
  const [submit, { isLoading }] = useSubmitRevisionMutation();

  const allSkus = useMemo(() => skusRes?.data || [], [skusRes]);

  const [form, setForm] = useState({
    sku: null,
    priceType: defaultPriceType,
    newPrice: '',
    effectiveFrom: dayjs().format('YYYY-MM-DD'),
    reason: '',
    customReason: '',
    remarks: '',
    attachmentUrl: '',
    attachmentName: '',
    acceptMarginBreach: false,
  });
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const preset = presetSku
      ? allSkus.find((s) => s._id === presetSku.skuId)
        || {
          _id: presetSku.skuId, code: presetSku.code, name: presetSku.name,
          sellingPrice: presetSku.currentPrice, itemType: presetSku.itemType,
        }
      : null;
    setForm({
      sku: preset,
      priceType: streamFor(preset, defaultPriceType),
      newPrice: '',
      effectiveFrom: dayjs().format('YYYY-MM-DD'),
      reason: '',
      customReason: '',
      remarks: '',
      attachmentUrl: '',
      attachmentName: '',
      acceptMarginBreach: false,
    });
  }, [open, presetSku, defaultPriceType, allSkus]);

  const isBuySideSku = BUY_SIDE_KINDS.includes(form.sku?.itemType);
  const streamLabel = form.priceType === 'SELLING'
    ? 'Selling Price'
    : (isBuySideSku ? 'Purchase Price' : 'RM Cost');
  const currentPrice = form.priceType === 'SELLING' ? form.sku?.sellingPrice : form.sku?.rmCost;
  const newPriceNum = Number(form.newPrice);
  const changePct = useMemo(() => {
    if (!currentPrice || !newPriceNum) return null;
    return ((newPriceNum - currentPrice) / currentPrice) * 100;
  }, [currentPrice, newPriceNum]);

  const handleFileUpload = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setUploading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Upload failed');
      setForm((f) => ({
        ...f,
        attachmentUrl: json.data.url,
        attachmentName: json.data.fileName,
      }));
      enqueueSnackbar('File attached', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err.message || 'Upload failed', { variant: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.sku || !form.newPrice) {
      enqueueSnackbar('Pick an SKU and enter a new price.', { variant: 'warning' });
      return;
    }
    const reasonFinal = form.reason === 'Other' ? form.customReason : form.reason;
    try {
      const res = await submit({
        skuId: form.sku._id,
        priceType: form.priceType,
        newPrice: Number(form.newPrice),
        effectiveFrom: form.effectiveFrom,
        reason: reasonFinal,
        remarks: form.remarks,
        attachmentUrl: form.attachmentUrl,
        attachmentName: form.attachmentName,
        acceptMarginBreach: form.acceptMarginBreach,
      }).unwrap();
      enqueueSnackbar(
        res.data?.status === 'LIVE' ? 'Price updated' : 'Submitted for MD approval',
        { variant: 'success' },
      );
      onClose();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to submit', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pt: 3, px: 3, pb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          width: 40, height: 40, borderRadius: 2,
          display: 'grid', placeItems: 'center',
          bgcolor: alpha(theme.palette.primary.main, 0.10), color: theme.palette.primary.dark,
        }}>
          <IndianRupee size={20} />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1.05rem' }}>Revise price</Typography>
          <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
            Changes within the threshold go live immediately; larger changes are routed to MD.
          </Typography>
        </Box>
      </DialogTitle>

      <form onSubmit={handleSubmit}>
        <DialogContent sx={{ px: 3, py: 2 }}>
          <Stack spacing={2}>
            {/* SKU & Type */}
            <Stack direction="row" spacing={1.5}>
              <Autocomplete
                fullWidth
                options={allSkus}
                value={form.sku}
                onChange={(_, v) => setForm((f) => ({ ...f, sku: v, priceType: streamFor(v, f.priceType) }))}
                getOptionLabel={(o) => o ? `${o.code} · ${o.name}` : ''}
                isOptionEqualToValue={(a, b) => a._id === b._id}
                openOnFocus
                autoHighlight
                blurOnSelect
                filterOptions={(opts, state) => {
                  const q = state.inputValue.trim().toLowerCase();
                  if (!q) return opts.slice(0, 200);
                  return opts.filter((o) => {
                    const code = (o.code || '').toLowerCase();
                    const name = (o.name || '').toLowerCase();
                    const cat  = (o.category || '').toLowerCase();
                    const aliases = (o.aliases || []).join(' ').toLowerCase();
                    return code.includes(q) || name.includes(q) || cat.includes(q) || aliases.includes(q);
                  }).slice(0, 200);
                }}
                ListboxProps={{ sx: { maxHeight: 380, py: 0.5 } }}
                renderOption={(props, option) => (
                  <Box component="li" {...props} key={option._id} sx={{
                    display: 'flex !important', alignItems: 'center', gap: 1.25, py: 0.75,
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.06) },
                  }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography sx={{
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontWeight: 800, fontSize: '0.78rem',
                          color: theme.palette.primary.dark, minWidth: 110,
                        }} noWrap>
                          {option.code}
                        </Typography>
                        <Typography sx={{ fontSize: '0.82rem', fontWeight: 600 }} noWrap>
                          {option.name}
                        </Typography>
                      </Stack>
                      {option.category && (
                        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.25 }}>
                          {option.category}
                        </Typography>
                      )}
                    </Box>
                    {option.sellingPrice > 0 && (
                      <Typography sx={{
                        fontSize: '0.74rem', fontWeight: 700, color: 'text.secondary',
                        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                      }}>
                        ₹ {Number(option.sellingPrice).toFixed(2)}
                      </Typography>
                    )}
                  </Box>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="SKU"
                    required
                    placeholder={`Search ${allSkus.length} SKUs…`}
                  />
                )}
              />
              {isBuySideSku ? (
                <Tooltip title="Raw material, consumables & packing are bought from suppliers — tracked as a purchase price.">
                  <Box sx={{
                    minWidth: 150, px: 1.5, py: 0.5, borderRadius: 1,
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    border: `1px solid ${alpha(theme.palette.warning.main, 0.4)}`,
                    bgcolor: alpha(theme.palette.warning.main, 0.08),
                  }}>
                    <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Price type
                    </Typography>
                    <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: theme.palette.warning.dark }}>
                      Purchase Price
                    </Typography>
                  </Box>
                </Tooltip>
              ) : (
                <TextField
                  select
                  label="Type"
                  value={form.priceType}
                  onChange={(e) => setForm((f) => ({ ...f, priceType: e.target.value }))}
                  sx={{ minWidth: 140 }}
                >
                  <MenuItem value="SELLING">Selling</MenuItem>
                  <MenuItem value="RM_COST">RM Cost</MenuItem>
                </TextField>
              )}
            </Stack>

            {form.sku && (
              <Box sx={{
                px: 1.5, py: 1, borderRadius: 2,
                bgcolor: alpha(theme.palette.primary.main, 0.04),
                border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
              }}>
                <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Current {streamLabel}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="baseline">
                  <Typography sx={{ fontWeight: 800, fontSize: '1.2rem', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtINR(currentPrice)}
                  </Typography>
                  {form.sku.sellingPriceFrom && form.priceType === 'SELLING' && (
                    <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>
                      effective from {dayjs(form.sku.sellingPriceFrom).format('DD MMM YYYY')}
                    </Typography>
                  )}
                </Stack>
              </Box>
            )}

            {/* New price + effective */}
            <Stack direction="row" spacing={1.5}>
              <TextField
                label="New price (₹)"
                type="number"
                inputProps={{ step: '0.01', min: 0 }}
                value={form.newPrice}
                onChange={(e) => setForm((f) => ({ ...f, newPrice: e.target.value }))}
                required
                fullWidth
                InputProps={{
                  startAdornment: <Typography sx={{ mr: 1, color: 'text.secondary' }}>₹</Typography>,
                }}
              />
              <TextField
                label="Effective from"
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
                required
                fullWidth
                InputLabelProps={{ shrink: true }}
                InputProps={{
                  startAdornment: <Calendar size={14} style={{ marginRight: 8, color: theme.palette.text.secondary }} />,
                }}
              />
            </Stack>

            {changePct != null && (
              <Box sx={{
                px: 1.5, py: 1, borderRadius: 2,
                bgcolor: alpha(changePct >= 0 ? theme.palette.success.main : theme.palette.error.main, 0.06),
                border: `1px solid ${alpha(changePct >= 0 ? theme.palette.success.main : theme.palette.error.main, 0.20)}`,
                display: 'flex', alignItems: 'center', gap: 1,
              }}>
                <Sparkles size={14} color={changePct >= 0 ? theme.palette.success.dark : theme.palette.error.dark} />
                <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: changePct >= 0 ? theme.palette.success.dark : theme.palette.error.dark }}>
                  Change: {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                </Typography>
                {Math.abs(changePct) > 5 && (
                  <Chip size="small" label="May need approval" sx={{
                    height: 20, fontSize: '0.65rem', fontWeight: 700,
                    color: theme.palette.warning.dark,
                    bgcolor: alpha(theme.palette.warning.main, 0.10),
                  }}/>
                )}
              </Box>
            )}

            {/* Reason */}
            <TextField
              select
              label="Reason for revision"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              fullWidth
            >
              {REASON_PRESETS.map((r) => (<MenuItem key={r} value={r}>{r}</MenuItem>))}
            </TextField>
            {form.reason === 'Other' && (
              <TextField
                label="Specify reason"
                value={form.customReason}
                onChange={(e) => setForm((f) => ({ ...f, customReason: e.target.value }))}
                fullWidth
              />
            )}
            <TextField
              label="Notes (optional)"
              value={form.remarks}
              onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              multiline rows={2}
              fullWidth
            />

            {/* Attachment */}
            <Box>
              <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: 'text.secondary', mb: 0.75, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Proof attachment
              </Typography>
              {form.attachmentUrl ? (
                <Stack direction="row" spacing={1} alignItems="center" sx={{
                  p: 1, borderRadius: 2,
                  bgcolor: alpha(theme.palette.success.main, 0.08),
                  border: `1px solid ${alpha(theme.palette.success.main, 0.20)}`,
                }}>
                  <Paperclip size={14} color={theme.palette.success.dark} />
                  <Typography sx={{ flex: 1, fontSize: '0.8rem', fontWeight: 600 }} noWrap>
                    {form.attachmentName}
                  </Typography>
                  <Tooltip title="Preview attachment">
                    <IconButton size="small" onClick={() => window.open(form.attachmentUrl, '_blank', 'noopener')}>
                      <Eye size={14} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Remove">
                    <IconButton size="small" onClick={() => setForm((f) => ({ ...f, attachmentUrl: '', attachmentName: '' }))}>
                      <X size={14} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ) : (
                <Button
                  component="label"
                  variant="outlined"
                  startIcon={uploading ? <CircularProgress size={14} /> : <Upload size={14} />}
                  disabled={uploading}
                  fullWidth
                  sx={{ borderStyle: 'dashed', py: 1.5 }}
                >
                  {uploading ? 'Uploading…' : 'Attach quotation / supplier mail (PDF, JPG, PNG, XLSX ≤ 10 MB)'}
                  <input
                    type="file"
                    hidden
                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                    onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  />
                </Button>
              )}
            </Box>

            {/* Negative-margin override (only when permission slug is held) */}
            {form.priceType === 'SELLING' && currentPrice && form.sku?.rmCost && newPriceNum > 0 && newPriceNum < form.sku.rmCost && (
              <Box sx={{
                p: 1.5, borderRadius: 2,
                bgcolor: alpha(theme.palette.error.main, 0.06),
                border: `1px solid ${alpha(theme.palette.error.main, 0.22)}`,
              }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <ShieldAlert size={16} color={theme.palette.error.dark} />
                  <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: theme.palette.error.dark }}>
                    Negative margin
                  </Typography>
                </Stack>
                <Typography sx={{ fontSize: '0.78rem', color: theme.palette.error.dark }}>
                  This selling price is below the current RM cost ({fmtINR(form.sku.rmCost)}).
                </Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.acceptMarginBreach}
                      onChange={(_, v) => setForm((f) => ({ ...f, acceptMarginBreach: v }))}
                      size="small"
                    />
                  }
                  label={
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: theme.palette.error.dark }}>
                      I accept the margin loss
                    </Typography>
                  }
                  sx={{ mt: 0.5, ml: 0 }}
                />
              </Box>
            )}
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={onClose} sx={{ color: 'text.secondary', fontWeight: 700 }}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isLoading || !form.sku || !form.newPrice}
            sx={{ fontWeight: 700, px: 3 }}
          >
            {isLoading ? <CircularProgress size={20} color="inherit" /> : 'Submit revision'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default RevisePriceDialog;
