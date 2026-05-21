import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Typography, Stack, Chip, Button, TextField, Paper, alpha, useTheme,
  IconButton, Tooltip, ToggleButtonGroup, ToggleButton, Autocomplete,
  Divider, MenuItem,
} from '@mui/material';
import {
  Calculator, Plus, Trash2, Calendar, Clipboard, FileSignature, Download,
  RefreshCw, Pencil, Sparkles, Search, ShoppingCart,
} from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useGetSkuLookupQuery } from '../../store/api/skuApi';
import { useGetPartiesQuery } from '../../store/api/partyApi';
import { usePreviewCalculatorMutation, useGetCompanySettingsQuery } from '../../store/api/pricingApi';
import { useCreateQuoteMutation } from '../../store/api/quoteApi';
import { printCalculatorQuote } from '../../utils/printCalculatorQuote';
import { fmtINR, fmtInt } from '../../utils/formatters';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermission';

// priceTouched flag distinguishes auto-filled (from master) vs user override.
// When false, the API call omits manualPrice so the server resolves from the
// current LIVE revision — keeping the "MASTER" source label honest.
const blankLine = () => ({
  key: Math.random().toString(36).slice(2),
  skuId: '', qty: 0, manualPrice: '', priceTouched: false,
});

const BUY_SIDE_KINDS = ['RAW_MATERIAL', 'CONSUMABLE', 'PACKING'];
const CALC_KIND_OPTIONS = [
  { value: '',              label: 'All Items' },
  { value: 'FINISHED_GOOD', label: 'Finished Goods' },
  { value: 'RAW_MATERIAL',  label: 'Raw Material' },
  { value: 'CONSUMABLE',    label: 'Consumables' },
  { value: 'PACKING',       label: 'Packing' },
];

const TurnoverCalculator = () => {
  const theme = useTheme();
  // Use the dedicated SKU lookup (active + non-deleted) — sorted by name,
  // returns up to 2000 in one shot. Anything you don't want shown can be
  // soft-deleted from the SKU Master page (red trash icon).
  const { data: skusRes } = useGetSkuLookupQuery({ limit: 2000 });
  const { data: partiesRes } = useGetPartiesQuery?.({}) || { data: null };
  const { data: settingsRes } = useGetCompanySettingsQuery();
  const companySettings = settingsRes?.data || {};
  const [preview, { data: previewRes, isLoading: previewing }] = usePreviewCalculatorMutation();
  const [createQuote, { isLoading: savingQuote }] = useCreateQuoteMutation();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canSaveQuote = can('quotes.create');

  const allSkus = useMemo(() => skusRes?.data || [], [skusRes]);
  const skuByCode = useMemo(() => new Map(allSkus.map((s) => [s.code?.toUpperCase(), s])), [allSkus]);

  const [party, setParty] = useState(null);
  const [poRef, setPoRef] = useState('');
  const [asOfDate, setAsOfDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [priceType, setPriceType] = useState('SELLING');
  const [itemType, setItemType] = useState('');   // filters the SKU picker
  const [viewMode, setViewMode] = useState('with_gst'); // basic | with_gst | inclusive
  const [lines, setLines] = useState([blankLine(), blankLine(), blankLine()]);
  // Single, user-editable GST rate applied to the whole calculation.
  // Defaults to 18% (most common Indian slab); user can change to any number.
  const [globalGstRate, setGlobalGstRate] = useState(18);

  const debouncedRequest = useRef(null);

  const runPreview = () => {
    const cleaned = lines
      .filter((l) => l.skuId && Number(l.qty) > 0)
      .map((l) => ({
        skuId: l.skuId,
        qty: Number(l.qty),
        // Only send manualPrice if the user actually overrode the auto-filled
        // master price. Otherwise let the server resolve from master.
        manualPrice: (l.priceTouched && l.manualPrice !== '') ? Number(l.manualPrice) : undefined,
      }));
    preview({ asOfDate, priceType, lines: cleaned }).unwrap().catch((err) => {
      enqueueSnackbar(err?.data?.message || 'Preview failed', { variant: 'error' });
    });
  };

  useEffect(() => {
    if (debouncedRequest.current) clearTimeout(debouncedRequest.current);
    debouncedRequest.current = setTimeout(runPreview, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, asOfDate, priceType]);

  const updateLine = (key, patch) => {
    setLines((arr) => arr.map((l) => l.key === key ? { ...l, ...patch } : l));
  };
  const removeLine = (key) => setLines((arr) => arr.filter((l) => l.key !== key));
  const addLine = () => setLines((arr) => [...arr, blankLine()]);
  const resetAll = () => setLines([blankLine(), blankLine(), blankLine()]);

  const handlePaste = (e) => {
    const text = e.clipboardData?.getData('text');
    if (!text || !text.includes('\t')) return;
    e.preventDefault();
    const rows = text.split(/\r?\n/).filter(Boolean);
    const parsed = rows.map((row) => {
      const [codeRaw, qtyRaw, priceRaw] = row.split('\t');
      const sku = skuByCode.get((codeRaw || '').trim().toUpperCase());
      return {
        key: Math.random().toString(36).slice(2),
        skuId: sku?._id || '',
        qty: Number((qtyRaw || '0').replace(/[^\d.-]/g, '')) || 0,
        manualPrice: priceRaw ? Number((priceRaw || '').replace(/[^\d.-]/g, '')) || '' : '',
      };
    }).filter((r) => r.skuId);
    if (parsed.length === 0) {
      enqueueSnackbar('No matching SKU codes found in clipboard', { variant: 'warning' });
      return;
    }
    setLines((arr) => [...arr.filter((l) => l.skuId), ...parsed]);
    enqueueSnackbar(`Pasted ${parsed.length} line${parsed.length === 1 ? '' : 's'}`, { variant: 'success' });
  };

  const previewData = previewRes?.data;
  const previewLines = previewData?.lines || [];
  // Totals come from the server (subtotal). We then apply the user's global
  // GST rate on top, instead of the server's per-SKU breakdown — keeps the
  // GST math transparent and user-controllable.
  const subtotal = Number(previewData?.totals?.subtotal || 0);
  const gstAmount = Number(((subtotal * (Number(globalGstRate) || 0)) / 100).toFixed(2));
  const grandTotal = Number((subtotal + gstAmount).toFixed(2));
  const totals = { subtotal, gstTotal: gstAmount, grandTotal };
  const previewByKey = useMemo(() => {
    const map = new Map();
    let i = 0;
    for (const l of lines) {
      if (l.skuId && Number(l.qty) > 0) {
        map.set(l.key, previewLines[i]); i += 1;
      }
    }
    return map;
  }, [lines, previewLines]);

  const totalQty = lines.reduce((sum, l) => sum + Number(l.qty || 0), 0);
  const linesCount = lines.filter((l) => l.skuId && Number(l.qty) > 0).length;

  // Item-kind filter for the SKU picker. Buy-side kinds switch the price
  // stream to the purchase cost automatically.
  const isBuySide = BUY_SIDE_KINDS.includes(itemType);
  const handleKindChange = (v) => {
    setItemType(v);
    if (BUY_SIDE_KINDS.includes(v)) setPriceType('RM_COST');
    else if (v === 'FINISHED_GOOD') setPriceType('SELLING');
  };

  const handleSaveQuote = async (send = false) => {
    const cleaned = lines
      .filter((l) => l.skuId && Number(l.qty) > 0)
      .map((l) => ({
        skuId: l.skuId,
        qty: Number(l.qty),
        manualPrice: (l.priceTouched && l.manualPrice !== '') ? Number(l.manualPrice) : undefined,
      }));
    if (cleaned.length === 0) {
      enqueueSnackbar('Add at least one line to save a quote.', { variant: 'warning' });
      return;
    }
    try {
      const res = await createQuote({
        asOfDate, priceType,
        partyId: party?._id || null,
        partyName: party?.name || '',
        poReference: poRef,
        lines: cleaned,
        send,
      }).unwrap();
      enqueueSnackbar(`Quote ${res.data.quoteNumber} ${send ? 'saved & marked sent' : 'saved as draft'}.`, { variant: 'success' });
      navigate(`/quotes/${res.data._id}`);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save quote', { variant: 'error' });
    }
  };

  const openPreviewPdf = () => {
    const filledLines = lines
      .filter((l) => l.skuId && Number(l.qty) > 0)
      .map((l) => {
        const pv = previewByKey.get(l.key);
        const sku = allSkus.find((s) => s._id === l.skuId);
        return {
          code: sku?.code || pv?.code || '?',
          name: sku?.name || pv?.name || '',
          qty: Number(l.qty),
          unitPrice: pv?.unitPrice ?? (l.priceTouched ? Number(l.manualPrice) : sku?.sellingPrice ?? 0),
          lineSubtotal: pv?.lineSubtotal ?? (Number(l.qty) * Number(l.manualPrice || sku?.sellingPrice || 0)),
        };
      });

    if (filledLines.length === 0) {
      enqueueSnackbar('Add at least one line with SKU and quantity before exporting.', { variant: 'warning' });
      return;
    }

    const ok = printCalculatorQuote({
      company: companySettings,
      party, poRef, asOfDate, priceType,
      lines: filledLines,
      gstRate: Number(globalGstRate) || 0,
      subtotal: totals.subtotal,
      gstAmount: totals.gstTotal,
      grandTotal: totals.grandTotal,
      viewMode,
    });
    if (ok) {
      enqueueSnackbar('Quote opened in a new tab — print or Save as PDF from there.', { variant: 'success' });
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }} onPaste={handlePaste}>
      {/* Hero */}
      <Box sx={{
        position: 'relative', overflow: 'hidden', color: '#fff',
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
        px: { xs: 3, md: 5 }, pt: { xs: 4, md: 5 }, pb: { xs: 5, md: 7 },
      }}>
        <Box aria-hidden sx={{ position: 'absolute', width: 420, height: 420, borderRadius: '50%', top: -160, right: -120, background: 'radial-gradient(circle, rgba(96,165,250,0.32) 0%, rgba(96,165,250,0) 60%)' }} />
        <Stack direction="row" spacing={2.5} alignItems="center" sx={{ position: 'relative' }}>
          <Box sx={{
            width: 52, height: 52, borderRadius: 2.5,
            display: 'grid', placeItems: 'center',
            background: 'rgba(255,255,255,0.14)',
            border: '1px solid rgba(255,255,255,0.22)',
          }}>
            <Calculator size={26} color="#fff" />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ color: '#fff', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 800, letterSpacing: '-0.02em' }}>
              Turnover Calculator
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.95rem', mt: 0.5, maxWidth: 720 }}>
              Pick SKUs, enter quantities — prices auto-fill from the master as of the selected date.
              Manual overrides are flagged. Server-side math, ready to save as a quote.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.5, md: 2.5 }, mt: { xs: -3, md: -4 }, position: 'relative' }}>
        {/* Top filters */}
        <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <Autocomplete
              options={partiesRes?.data || []}
              value={party}
              onChange={(_, v) => setParty(v)}
              getOptionLabel={(o) => o?.name || ''}
              isOptionEqualToValue={(a, b) => a._id === b._id}
              renderInput={(params) => <TextField {...params} label="Customer (optional)" size="small" />}
              sx={{ minWidth: 280 }}
            />
            <TextField
              label="PO # / Reference"
              size="small"
              value={poRef}
              onChange={(e) => setPoRef(e.target.value)}
              sx={{ minWidth: 180 }}
            />
            <TextField
              label="As of date"
              type="date"
              size="small"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              InputProps={{ startAdornment: <Calendar size={14} style={{ marginRight: 6, color: theme.palette.text.secondary }} /> }}
            />
            <TextField
              select size="small" label="Item kind"
              value={itemType}
              onChange={(e) => handleKindChange(e.target.value)}
              sx={{ minWidth: 160 }}
              SelectProps={{ displayEmpty: true }}
              InputLabelProps={{ shrink: true }}
            >
              {CALC_KIND_OPTIONS.map((o) => (
                <MenuItem key={o.value || 'all'} value={o.value}>{o.label}</MenuItem>
              ))}
            </TextField>

            {isBuySide ? (
              <Chip
                icon={<ShoppingCart size={13} />}
                label="Purchase Price"
                sx={{
                  height: 36, fontWeight: 800, fontSize: '0.74rem', borderRadius: 1,
                  color: theme.palette.warning.dark,
                  bgcolor: alpha(theme.palette.warning.main, 0.10),
                  border: `1px solid ${alpha(theme.palette.warning.main, 0.25)}`,
                  '& .MuiChip-icon': { color: 'inherit' },
                }}
              />
            ) : (
              <ToggleButtonGroup
                exclusive size="small"
                value={priceType}
                onChange={(_, v) => v && setPriceType(v)}
                sx={{
                  '& .MuiToggleButton-root': {
                    px: 1.5, py: 0.5, fontSize: '0.74rem', fontWeight: 700,
                    border: `1px solid ${theme.palette.divider}`,
                    '&.Mui-selected': {
                      bgcolor: alpha(theme.palette.primary.main, 0.10),
                      color: theme.palette.primary.dark,
                    },
                  },
                }}
              >
                <ToggleButton value="SELLING">Selling</ToggleButton>
                <ToggleButton value="RM_COST">RM Cost</ToggleButton>
              </ToggleButtonGroup>
            )}

            <Box sx={{ flex: 1 }} />

            <Tooltip title="Reset all lines">
              <IconButton onClick={resetAll} sx={{ border: `1px solid ${theme.palette.divider}` }}>
                <RefreshCw size={14} />
              </IconButton>
            </Tooltip>
            <Button startIcon={<Plus size={14} />} onClick={addLine} variant="outlined" size="small" sx={{ fontWeight: 700 }}>
              Add line
            </Button>
          </Stack>
        </Paper>

        {/* Lines table */}
        <Paper sx={{ borderRadius: 3, overflow: 'hidden', mb: 2 }}>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: '40px minmax(280px, 2.4fr) 110px 130px 100px minmax(140px, 1fr) 40px',
            bgcolor: alpha(theme.palette.primary.main, 0.04),
            borderBottom: `1px solid ${theme.palette.divider}`,
            px: 2, py: 1.25, gap: 1.5,
          }}>
            {['#', 'SKU', 'Qty', 'Unit ₹', 'Source', 'Amount', ''].map((h, i) => (
              <Typography key={i} sx={{
                fontSize: '0.7rem', fontWeight: 800, color: 'text.secondary',
                letterSpacing: '0.08em', textTransform: 'uppercase',
                textAlign: ['Qty', 'Unit ₹', 'Amount'].includes(h) ? 'right' : 'left',
              }}>
                {h}
              </Typography>
            ))}
          </Box>

          <Box>
            {lines.map((l, idx) => {
              const pv = previewByKey.get(l.key);
              // "Manual" only when the user has actually edited the field,
              // not when it was auto-filled from the master.
              const isManual = l.priceTouched && l.manualPrice !== '' && Number(l.manualPrice) > 0;
              return (
                <Box key={l.key} sx={{
                  display: 'grid',
                  gridTemplateColumns: '40px minmax(280px, 2.4fr) 110px 130px 100px minmax(140px, 1fr) 40px',
                  alignItems: 'center', px: 2, py: 1.25, gap: 1.5,
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.02) },
                }}>
                  <Typography sx={{ color: 'text.disabled', fontSize: '0.78rem', fontVariantNumeric: 'tabular-nums' }}>
                    {idx + 1}
                  </Typography>

                  <Autocomplete
                    size="small"
                    options={itemType
                      ? allSkus.filter((s) => s.itemType === itemType || s._id === l.skuId)
                      : allSkus}
                    value={allSkus.find((s) => s._id === l.skuId) || null}
                    onChange={(_, v) => {
                      // Auto-fill from the SKU master using the stream that
                      // matches the item: buy-side items (raw material,
                      // consumables, packing) always use their purchase price.
                      const buySide = BUY_SIDE_KINDS.includes(v?.itemType);
                      const masterPrice = (buySide || priceType === 'RM_COST')
                        ? (v?.rmCost ?? '')
                        : (v?.sellingPrice ?? '');
                      updateLine(l.key, {
                        skuId: v?._id || '',
                        manualPrice: masterPrice ? String(masterPrice) : '',
                        priceTouched: false,
                      });
                    }}
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
                    ListboxProps={{
                      sx: { maxHeight: 380, py: 0.5 },
                    }}
                    slotProps={{
                      popper: { sx: { '& .MuiPaper-root': { boxShadow: '0 14px 36px rgba(30, 58, 138, 0.16)' } } },
                    }}
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
                            <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'text.primary' }} noWrap>
                              {option.name}
                            </Typography>
                          </Stack>
                          {option.category && (
                            <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.25 }}>
                              {option.category}
                            </Typography>
                          )}
                        </Box>
                        <Stack alignItems="flex-end" spacing={0.25}>
                          {option.sellingPrice > 0 && (
                            <Typography sx={{
                              fontSize: '0.74rem', fontWeight: 700, color: 'text.secondary',
                              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                            }}>
                              {fmtINR(option.sellingPrice)}
                            </Typography>
                          )}
                          {option.gstRate != null && (
                            <Typography sx={{
                              fontSize: '0.62rem', fontWeight: 800,
                              color: theme.palette.info.dark,
                              fontVariantNumeric: 'tabular-nums',
                            }}>
                              GST {option.gstRate}%
                            </Typography>
                          )}
                        </Stack>
                      </Box>
                    )}
                    noOptionsText={
                      <Box sx={{ py: 1.5, textAlign: 'center', color: 'text.disabled' }}>
                        <Typography sx={{ fontWeight: 600, fontSize: '0.82rem' }}>No matching SKU</Typography>
                        <Typography sx={{ fontSize: '0.72rem' }}>Try a different code or name</Typography>
                      </Box>
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        placeholder={`Search ${allSkus.length} SKUs by code, name, alias…`}
                        variant="outlined"
                        InputProps={{
                          ...params.InputProps,
                          startAdornment: (
                            <Box sx={{ pl: 0.5, pr: 0.5, display: 'flex', alignItems: 'center' }}>
                              <Search size={14} color={theme.palette.text.disabled} />
                            </Box>
                          ),
                        }}
                      />
                    )}
                  />

                  <TextField
                    size="small"
                    type="number"
                    inputProps={{ min: 0, style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }}
                    value={l.qty}
                    onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                    placeholder="0"
                  />

                  <TextField
                    size="small"
                    type="number"
                    inputProps={{ step: '0.01', min: 0, style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }}
                    value={l.manualPrice}
                    onChange={(e) => updateLine(l.key, { manualPrice: e.target.value, priceTouched: true })}
                    placeholder={l.skuId ? '0.00' : '—'}
                    InputProps={{
                      startAdornment: <Pencil size={11} style={{ marginRight: 4, color: theme.palette.text.disabled, opacity: isManual ? 1 : 0.3 }} />,
                    }}
                  />

                  <Chip
                    size="small"
                    label={isManual ? 'MANUAL' : (pv?.source || (l.skuId ? '—' : ''))}
                    sx={{
                      height: 20, fontSize: '0.62rem', fontWeight: 800,
                      color: isManual ? theme.palette.warning.dark : (pv?.source === 'MASTER' ? theme.palette.primary.dark : 'text.disabled'),
                      bgcolor: isManual ? alpha(theme.palette.warning.main, 0.10) : (pv?.source === 'MASTER' ? alpha(theme.palette.primary.main, 0.08) : 'transparent'),
                      border: `1px solid ${isManual ? alpha(theme.palette.warning.main, 0.20) : (pv?.source === 'MASTER' ? alpha(theme.palette.primary.main, 0.18) : 'transparent')}`,
                    }}
                  />

                  {/* Amount cell — line subtotal (excl. GST). The global GST is
                      added once in the Totals card below, not per line. */}
                  <Typography sx={{
                    fontWeight: 700, fontSize: '0.86rem',
                    fontVariantNumeric: 'tabular-nums', textAlign: 'right',
                    color: pv ? 'text.primary' : 'text.disabled',
                  }}>
                    {pv ? fmtINR(pv.lineSubtotal) : '—'}
                  </Typography>

                  <IconButton size="small" onClick={() => removeLine(l.key)} sx={{ color: 'text.disabled' }}>
                    <Trash2 size={14} />
                  </IconButton>
                </Box>
              );
            })}
          </Box>

          <Box sx={{
            p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            bgcolor: alpha(theme.palette.primary.main, 0.02),
            borderTop: `1px solid ${theme.palette.divider}`,
          }}>
            <Stack direction="row" spacing={1}>
              <Button startIcon={<Plus size={14} />} onClick={addLine} size="small" sx={{ fontWeight: 700 }}>
                Add line
              </Button>
              <Button startIcon={<Clipboard size={14} />} size="small" sx={{ fontWeight: 700, color: 'text.secondary' }} onClick={() => enqueueSnackbar('Paste tab-separated rows: CODE<TAB>QTY<TAB>PRICE', { variant: 'info' })}>
                Paste from Excel
              </Button>
            </Stack>
            <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
              {linesCount} line{linesCount === 1 ? '' : 's'} · {fmtInt(totalQty)} units
            </Typography>
          </Box>
        </Paper>

        {/* Totals */}
        <Paper sx={{
          borderRadius: 3, p: 2.5, mb: 4,
          background: 'linear-gradient(180deg, #ffffff 0%, #f7f9ff 100%)',
        }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
            <ToggleButtonGroup
              exclusive size="small"
              value={viewMode}
              onChange={(_, v) => v && setViewMode(v)}
              sx={{
                '& .MuiToggleButton-root': {
                  px: 1.5, py: 0.5, fontSize: '0.74rem', fontWeight: 700,
                  border: `1px solid ${theme.palette.divider}`,
                  '&.Mui-selected': {
                    bgcolor: alpha(theme.palette.primary.main, 0.10),
                    color: theme.palette.primary.dark,
                  },
                },
              }}
            >
              <ToggleButton value="basic">Basic</ToggleButton>
              <ToggleButton value="with_gst">With GST</ToggleButton>
              <ToggleButton value="inclusive">Inclusive</ToggleButton>
            </ToggleButtonGroup>

            <Box sx={{ flex: 1 }} />

            <Stack spacing={0.75} sx={{ minWidth: 320 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary' }}>Subtotal</Typography>
                <Typography sx={{ fontSize: '0.94rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtINR(totals.subtotal)}
                </Typography>
              </Stack>
              {(viewMode === 'with_gst' || viewMode === 'inclusive') && (
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary' }}>GST</Typography>
                    {/* Inline editable rate. Default 18; user can type any value. */}
                    <TextField
                      size="small"
                      type="number"
                      value={globalGstRate}
                      onChange={(e) => {
                        const v = e.target.value;
                        // Allow empty string while typing; clamp 0–100 on commit.
                        if (v === '') { setGlobalGstRate(''); return; }
                        const n = Math.max(0, Math.min(100, Number(v)));
                        setGlobalGstRate(Number.isFinite(n) ? n : 0);
                      }}
                      onBlur={() => { if (globalGstRate === '' || globalGstRate == null) setGlobalGstRate(18); }}
                      inputProps={{
                        min: 0, max: 100, step: '0.5',
                        style: { textAlign: 'right', width: 44, padding: '4px 6px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
                      }}
                      InputProps={{
                        endAdornment: <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', ml: 0.25 }}>%</Typography>,
                        sx: { borderRadius: 1, bgcolor: alpha(theme.palette.warning.main, 0.08) },
                      }}
                      sx={{ '& fieldset': { borderColor: alpha(theme.palette.warning.main, 0.35) } }}
                    />
                    <Stack direction="row" spacing={0.25}>
                      {[5, 12, 18, 28].map((r) => (
                        <Tooltip key={r} title={`Set GST to ${r}%`} arrow>
                          <Box
                            onClick={() => setGlobalGstRate(r)}
                            sx={{
                              px: 0.6, py: 0.1, borderRadius: 0.5, cursor: 'pointer',
                              fontSize: '0.62rem', fontWeight: 800,
                              color: globalGstRate === r ? '#fff' : theme.palette.text.secondary,
                              bgcolor: globalGstRate === r ? theme.palette.warning.dark : alpha(theme.palette.text.primary, 0.05),
                              '&:hover': { bgcolor: globalGstRate === r ? theme.palette.warning.dark : alpha(theme.palette.warning.main, 0.18) },
                              userSelect: 'none',
                            }}
                          >
                            {r}
                          </Box>
                        </Tooltip>
                      ))}
                    </Stack>
                  </Stack>
                  <Typography sx={{ fontSize: '0.94rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: theme.palette.warning.dark }}>
                    + {fmtINR(totals.gstTotal)}
                  </Typography>
                </Stack>
              )}
              <Divider sx={{ my: 0.25 }} />
              <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                <Typography sx={{ fontSize: '0.84rem', fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Grand Total
                </Typography>
                <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: theme.palette.primary.dark, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtINR(viewMode === 'basic' ? totals.subtotal : totals.grandTotal)}
                </Typography>
              </Stack>
            </Stack>
          </Stack>

          <Stack direction="row" spacing={1.5} sx={{ mt: 2.5 }} justifyContent="flex-end">
            <Button startIcon={<Sparkles size={14} />} onClick={runPreview} size="small" sx={{ fontWeight: 700, color: 'text.secondary' }}>
              Recalculate
            </Button>
            <Button startIcon={<Download size={14} />} variant="outlined" sx={{ fontWeight: 700 }} onClick={openPreviewPdf}>
              Export PDF
            </Button>
            {canSaveQuote && (
              <Button
                startIcon={<FileSignature size={14} />}
                variant="outlined"
                sx={{ fontWeight: 700 }}
                disabled={linesCount === 0 || savingQuote}
                onClick={() => handleSaveQuote(false)}
              >
                Save Draft
              </Button>
            )}
            {canSaveQuote && (
              <Button
                startIcon={<FileSignature size={14} />}
                variant="contained"
                sx={{ fontWeight: 700, px: 3 }}
                disabled={linesCount === 0 || savingQuote}
                onClick={() => handleSaveQuote(true)}
              >
                Save & Send Quote
              </Button>
            )}
          </Stack>
        </Paper>
      </Box>

    </Box>
  );
};

export default TurnoverCalculator;
