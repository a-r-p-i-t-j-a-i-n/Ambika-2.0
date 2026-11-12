import React, { useEffect, useState } from 'react';
import { useSnackbar } from 'notistack';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, InputAdornment,
  Checkbox, Box, Typography, CircularProgress, IconButton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Search, X, Trash2, Undo2, CheckCircle2 } from 'lucide-react';
import { useGetSkuLookupQuery } from '../../store/api/skuApi';
import { useAddPartyOrderedSkusMutation, useRemovePartyOrderedSkuMutation } from '../../store/api/partyApi';
import PartyPill from './PartyPill';
import { TONE, money, unitTone, searchTerms, escapeRegex } from './partyUi';
import { BRAND, BRAND_DK, NAVY, O2D, primaryBtnSx } from '../../components/pageKit';

/**
 * Party → Ordered SKUs → Add SKUs: every SKU this party can order (its own SKUs
 * and the general ones — the same list the Sales Order form offers), A–Z.
 *   • tick any number to add them;
 *   • a SKU already on the list has Remove (and Undo);
 *   • Save applies the adds and removes together.
 * Search takes several terms at once (commas). The list shows 100 rows and
 * reveals more as you scroll, so a long SKU master stays smooth.
 */

const STEP = 100;
const MAX = 2000; // the lookup's own limit

const PartyAddSkusDialog = ({ open, party, onClose }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(() => new Map()); // to add: skuId → sku
  const [dropped, setDropped] = useState(() => new Map()); // to remove: skuId → list row
  const [shownCount, setShownCount] = useState(STEP);
  const [saving, setSaving] = useState(false);
  const [addSkus] = useAddPartyOrderedSkusMutation();
  const [removeSku] = useRemovePartyOrderedSkuMutation();

  // Ask the server a moment after typing stops; start again from the top.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchTerms(text).map(escapeRegex).join('|'));
      setShownCount(STEP);
    }, 300);
    return () => clearTimeout(t);
  }, [text]);

  const { data, isFetching } = useGetSkuLookupQuery(
    { clientId: party._id, search: search || undefined, limit: MAX },
    { skip: !open },
  );
  const skus = data?.data || [];
  const visible = skus.slice(0, shownCount);

  // On the list already = a row tied to this SKU (by SKU id).
  const rowFor = (sku) => (party.orderedSkus || []).find((e) => e.skuId && String(e.skuId) === String(sku._id));
  const sameCode = (sku) => (party.orderedSkus || []).some((e) => !e.skuId && e.skuCode && sku.code && e.skuCode.toUpperCase() === sku.code.toUpperCase());

  const toggle = (setMap, key, value) => setMap((prev) => {
    const next = new Map(prev);
    if (next.has(key)) next.delete(key); else next.set(key, value);
    return next;
  });

  const reset = () => {
    setText(''); setSearch(''); setPicked(new Map()); setDropped(new Map()); setShownCount(STEP);
  };

  const onScroll = (e) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 240 && shownCount < skus.length) setShownCount((n) => n + STEP);
  };

  const adds = picked.size;
  const removes = dropped.size;
  const saveLabel = saving ? 'Saving…'
    : adds && removes ? `Save · add ${adds} · remove ${removes}`
      : removes ? `Remove ${removes} SKU${removes === 1 ? '' : 's'}`
        : `Add ${adds || ''} SKU${adds === 1 ? '' : 's'}`.replace('  ', ' ');

  const save = async () => {
    setSaving(true);
    try {
      for (const row of dropped.values()) {
        await removeSku({ id: party._id, itemId: row._id }).unwrap();
      }
      if (adds) await addSkus({ id: party._id, skuIds: [...picked.keys()] }).unwrap();
      const parts = [adds && `${adds} added`, removes && `${removes} removed`].filter(Boolean);
      enqueueSnackbar(parts.join(' · '), { variant: 'success' });
      onClose();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || "Couldn't save the changes. Please try again.", { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const chip = (key, label, color, onUndo, sign) => (
    <Box key={key} sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5, pl: 1, pr: 0.25, py: 0.25, borderRadius: '7px',
      bgcolor: alpha(color, 0.08), border: `1px solid ${alpha(color, 0.22)}`, fontSize: '0.76rem', fontWeight: 800, color,
    }}>
      {sign} {label}
      <IconButton size="small" onClick={onUndo} aria-label={`Undo ${label}`} sx={{ p: 0.25, color }}><X size={12} /></IconButton>
    </Box>
  );

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm"
      TransitionProps={{ onExited: reset }}
      PaperProps={{ sx: { borderRadius: '12px', height: 'min(86vh, 760px)' } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: NAVY }}>Add or remove SKUs — {party.name}</Typography>
        <Typography sx={{ fontSize: '0.78rem', color: O2D.sub, mt: 0.25 }}>
          SKUs on the list fill in on this party&apos;s new Sales Orders. Tick to add · Remove to take one off · Save.
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: '4px !important', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search name or code — commas for several (jar, katori)"
          InputProps={{
            startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment>,
            endAdornment: text ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setText('')} aria-label="Clear search"><X size={14} /></IconButton>
              </InputAdornment>
            ) : null,
          }}
          inputProps={{ 'aria-label': 'Search SKUs' }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: '0.86rem' } }}
        />

        {(adds > 0 || removes > 0) && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.25 }} data-picked>
            {[...picked.values()].map((sku) => chip(`a-${sku._id}`, sku.name, BRAND, () => toggle(setPicked, sku._id, sku), '+'))}
            {[...dropped.entries()].map(([key, row]) => chip(`r-${key}`, row.skuName || row.skuCode, TONE.rose, () => toggle(setDropped, key, row), '−'))}
          </Box>
        )}

        <Typography sx={{ mt: 1.25, mb: 0.5, fontSize: '0.72rem', fontWeight: 700, color: O2D.sub }} data-count>
          {isFetching && !skus.length ? 'Loading SKUs…'
            : text ? `${skus.length.toLocaleString('en-IN')} match${skus.length === 1 ? '' : 'es'}`
              : `${skus.length.toLocaleString('en-IN')} SKUs`}
        </Typography>

        <Box onScroll={onScroll} data-sku-list
          sx={{ flex: 1, minHeight: 160, overflowY: 'auto', border: `1px solid ${O2D.line}`, borderRadius: '10px' }}>
          {isFetching && !skus.length ? (
            <Box sx={{ py: 4, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} /></Box>
          ) : !skus.length ? (
            <Typography sx={{ py: 4, textAlign: 'center', fontSize: '0.84rem', color: O2D.sub }}>
              {text ? `No SKU matches “${text}”.` : 'No SKUs in the SKU master yet.'}
            </Typography>
          ) : visible.map((sku) => {
            const row = rowFor(sku);
            const removing = row && dropped.has(sku._id);
            const checked = picked.has(sku._id);
            return (
              <Box key={sku._id} data-sku={sku.code}
                onClick={row ? undefined : () => toggle(setPicked, sku._id, sku)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.6, cursor: row ? 'default' : 'pointer',
                  borderBottom: `1px solid ${O2D.lineSoft}`, '&:last-of-type': { borderBottom: 0 },
                  bgcolor: removing ? alpha(TONE.rose, 0.05) : checked ? alpha(BRAND, 0.05) : 'transparent',
                  '&:hover': row ? {} : { bgcolor: alpha(BRAND, 0.04) },
                }}>
                {row ? (
                  <Box sx={{ width: 34, display: 'grid', placeItems: 'center', color: removing ? O2D.faint : TONE.green }}>
                    <CheckCircle2 size={17} />
                  </Box>
                ) : (
                  <Checkbox size="small" checked={checked} sx={{ p: 0.5 }} inputProps={{ 'aria-label': `Add ${sku.name}` }}
                    onClick={(e) => e.stopPropagation()} onChange={() => toggle(setPicked, sku._id, sku)} />
                )}
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{
                    fontSize: '0.86rem', fontWeight: 800, color: removing ? O2D.faint : BRAND_DK, lineHeight: 1.25,
                    textDecoration: removing ? 'line-through' : 'none',
                  }}>
                    {sku.name}
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, fontWeight: 600 }}>
                    {sku.code}{sku.sellingPrice ? ` · ₹${money(sku.sellingPrice)}` : ''}
                    {sameCode(sku) ? ' · links the row already on the list' : ''}
                  </Typography>
                </Box>
                {row ? (
                  <>
                    <PartyPill color={removing ? TONE.rose : TONE.green}>{removing ? 'Will be removed' : 'On the list'}</PartyPill>
                    <Button size="small" onClick={() => toggle(setDropped, sku._id, row)}
                      startIcon={removing ? <Undo2 size={14} /> : <Trash2 size={14} />}
                      aria-label={`${removing ? 'Undo remove' : 'Remove'} ${sku.name}`}
                      sx={{
                        minWidth: 0, px: 1, textTransform: 'none', fontWeight: 800, borderRadius: '7px',
                        color: removing ? O2D.sub : TONE.rose, '&:hover': { bgcolor: alpha(removing ? O2D.sub : TONE.rose, 0.08) },
                      }}>
                      {removing ? 'Undo' : 'Remove'}
                    </Button>
                  </>
                ) : (
                  <PartyPill color={unitTone(sku.unit)}>{sku.unit || '—'}</PartyPill>
                )}
              </Box>
            );
          })}
          {visible.length < skus.length && (
            <Typography sx={{ py: 1.25, textAlign: 'center', fontSize: '0.72rem', color: O2D.sub }}>Scroll for more…</Typography>
          )}
        </Box>
        {skus.length >= MAX && (
          <Typography sx={{ mt: 0.75, fontSize: '0.72rem', color: O2D.sub }}>
            Showing the first {MAX.toLocaleString('en-IN')} — search to narrow it down.
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: 'none', fontWeight: 800, color: O2D.sub }}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={(!adds && !removes) || saving} data-add-confirm
          sx={removes && !adds ? { ...primaryBtnSx, bgcolor: TONE.rose, '&:hover': { bgcolor: '#be123c', boxShadow: 'none' } } : primaryBtnSx}>
          {saveLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PartyAddSkusDialog;
