import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Stack, Chip, Button, TextField, InputAdornment,
  ToggleButtonGroup, ToggleButton, Paper, alpha, useTheme, IconButton, Tooltip,
  Popover, MenuItem, Divider, CircularProgress, Badge,
} from '@mui/material';
import {
  IndianRupee, Search, Plus, RefreshCw, Sparkles, TriangleAlert,
  CircleDot, BadgeCheck, Hourglass, ArrowDownUp, SlidersHorizontal,
  Download, FileSpreadsheet, X, CalendarRange, UserCircle2,
  LayoutGrid, PackageCheck, Layers, Wrench, Boxes, ShoppingCart,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { enqueueSnackbar } from 'notistack';
import {
  useGetPriceMasterQuery,
  useGetPricingReviewersQuery,
  useLazyGetPricingExportQuery,
} from '../../store/api/pricingApi';
import PriceMasterTable from './components/PriceMasterTable';
import RevisePriceDialog from './components/RevisePriceDialog';
import PriceHistoryDrawer from './components/PriceHistoryDrawer';
import { usePermissions } from '../../hooks/usePermission';
import { exportPricingWorkbook } from '../../utils/exportPricingExcel';

// ── Item-kind navigation ──────────────────────────────────────────────
// The Price Tracker's primary axis. RAW_MATERIAL / CONSUMABLE / PACKING are
// the "buy side" (purchase prices); FINISHED_GOOD is the "sell side"
// (selling prices). CIRCLE is intentionally omitted — not price-tracked.
const BUY_SIDE_KINDS = ['RAW_MATERIAL', 'CONSUMABLE', 'PACKING'];

const ITEM_KINDS = [
  { key: '',              label: 'All Items',      icon: LayoutGrid,   side: null },
  { key: 'FINISHED_GOOD', label: 'Finished Goods', icon: PackageCheck, side: 'sell' },
  { key: 'RAW_MATERIAL',  label: 'Raw Material',   icon: Layers,       side: 'buy' },
  { key: 'CONSUMABLE',    label: 'Consumables',    icon: Wrench,       side: 'buy' },
  { key: 'PACKING',       label: 'Packing',        icon: Boxes,        side: 'buy' },
];

const KpiCard = ({ label, value, hint, color, icon: Icon, theme }) => (
  <Paper sx={{
    flex: '1 1 150px',
    minWidth: 142,
    p: 1.3,
    borderRadius: 2,
    background: 'linear-gradient(180deg, #ffffff 0%, #f7f9ff 100%)',
    border: `1px solid ${theme.palette.divider}`,
    position: 'relative', overflow: 'hidden',
  }}>
    <Stack direction="row" spacing={1} alignItems="center">
      <Box sx={{
        width: 26, height: 26, borderRadius: 1.25,
        display: 'grid', placeItems: 'center', flexShrink: 0,
        bgcolor: alpha(color, 0.10), color,
      }}>
        <Icon size={14} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1.2 }}>
          {label}
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="baseline">
          <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', color }}>
            {value}
          </Typography>
          {hint && (
            <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled' }}>{hint}</Typography>
          )}
        </Stack>
      </Box>
    </Stack>
  </Paper>
);

const STATUS_CHIPS = (theme) => ([
  { key: '',         label: 'All',       color: theme.palette.text.secondary, icon: ArrowDownUp, dot: null },
  { key: 'changed',  label: 'Changed',   color: theme.palette.success.dark,   icon: Sparkles,     dot: theme.palette.success.main },
  { key: 'stable',   label: 'Stable',    color: theme.palette.text.secondary, icon: BadgeCheck,   dot: theme.palette.text.disabled },
  { key: 'stale',    label: 'Stale',     color: theme.palette.warning.dark,   icon: Hourglass,    dot: theme.palette.warning.main },
  { key: 'unpriced', label: 'Unpriced',  color: theme.palette.error.dark,     icon: CircleDot,    dot: theme.palette.error.main },
  { key: 'pending',  label: 'Pending',   color: theme.palette.warning.dark,   icon: TriangleAlert, dot: '#f97316' },
]);

// Validators for URL-supplied values — keeps a hand-edited link from sending
// a junk filter to the API.
const VALID_KINDS = ['FINISHED_GOOD', 'RAW_MATERIAL', 'CONSUMABLE', 'PACKING', 'CIRCLE'];
const VALID_STATUSES = ['changed', 'stable', 'stale', 'unpriced', 'pending'];

const PricingHub = () => {
  const theme = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filter state is initialised FROM the URL, so every view (kind, group,
  // search, the open SKU history) is a shareable deep link.
  const [priceType, setPriceType] = useState(() => (searchParams.get('stream') === 'RM_COST' ? 'RM_COST' : 'SELLING'));
  const [itemType, setItemType]   = useState(() => (VALID_KINDS.includes(searchParams.get('kind')) ? searchParams.get('kind') : ''));
  const [category, setCategory]   = useState(() => searchParams.get('group') || '');
  const [status, setStatus]       = useState(() => (VALID_STATUSES.includes(searchParams.get('status')) ? searchParams.get('status') : ''));
  const [search, setSearch]       = useState(() => searchParams.get('q') || '');
  const [drawerSkuId, setDrawerSkuId] = useState(() => searchParams.get('sku') || '');
  const [reviseOpen, setReviseOpen] = useState(false);
  const [revisePresetSku, setRevisePresetSku] = useState(null);

  // Phase-1 advanced filters
  const [effectiveFrom, setEffectiveFrom] = useState(() => searchParams.get('from') || '');
  const [effectiveTo,   setEffectiveTo]   = useState(() => searchParams.get('to') || '');
  const [revisedBy,     setRevisedBy]     = useState(() => searchParams.get('by') || '');
  const [filterAnchor,  setFilterAnchor]  = useState(null);
  const [exportAnchor,  setExportAnchor]  = useState(null);
  const [isExporting,   setIsExporting]   = useState(false);

  const { can } = usePermissions();
  const canRevise = can('pricing.revise');

  // Buy-side kinds have only one price stream — the purchase price (RM_COST).
  // `effectivePriceType` is what the whole screen actually queries with, so
  // there is never a stale-stream flicker when switching kinds.
  const isBuySide = BUY_SIDE_KINDS.includes(itemType);
  const effectivePriceType = isBuySide ? 'RM_COST' : priceType;
  const streamLabel = isBuySide
    ? 'Purchase Price'
    : (effectivePriceType === 'SELLING' ? 'Selling Price' : 'RM Cost');

  const handleKindChange = (key) => {
    setItemType(key);
    setCategory(''); // a sub-group only makes sense within one kind
  };

  const masterQuery = useMemo(() => ({
    priceType: effectivePriceType, search, status,
    ...(itemType ? { itemType } : {}),
    ...(category ? { category } : {}),
    ...(effectiveFrom ? { effectiveFrom } : {}),
    ...(effectiveTo   ? { effectiveTo }   : {}),
    ...(revisedBy     ? { revisedBy }     : {}),
  }), [effectivePriceType, search, status, itemType, category, effectiveFrom, effectiveTo, revisedBy]);

  const { data, isFetching, refetch } = useGetPriceMasterQuery(masterQuery);
  const rows = data?.data?.rows || [];
  const kpis = data?.data?.kpis || {};
  const itemTypeCounts = data?.data?.itemTypeCounts || {};
  const categories = data?.data?.categories || [];
  const allItemsCount = Object.values(itemTypeCounts).reduce((a, b) => a + b, 0);

  // Resolve the open SKU (from a row click or a shared URL) to a full object.
  const drawerSku = useMemo(() => {
    if (!drawerSkuId) return null;
    const row = rows.find((r) => String(r.skuId) === String(drawerSkuId));
    return row
      ? { id: row.skuId, code: row.code, name: row.name }
      : { id: drawerSkuId, code: '', name: '' };
  }, [drawerSkuId, rows]);

  // Mirror the active view into the URL query string, so the address bar is
  // always a shareable deep link — kind, group, search, and the open SKU.
  // The string compare makes the write a no-op when nothing changed, so this
  // can never loop regardless of how setSearchParams is memoised.
  useEffect(() => {
    const next = new URLSearchParams();
    if (priceType === 'RM_COST' && !BUY_SIDE_KINDS.includes(itemType)) next.set('stream', 'RM_COST');
    if (itemType)      next.set('kind',   itemType);
    if (category)      next.set('group',  category);
    if (status)        next.set('status', status);
    if (search)        next.set('q',      search);
    if (effectiveFrom) next.set('from',   effectiveFrom);
    if (effectiveTo)   next.set('to',     effectiveTo);
    if (revisedBy)     next.set('by',     revisedBy);
    if (drawerSkuId)   next.set('sku',    drawerSkuId);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceType, itemType, category, status, search, effectiveFrom, effectiveTo, revisedBy, drawerSkuId]);

  const { data: reviewersRes } = useGetPricingReviewersQuery();
  const reviewers = reviewersRes?.data || [];

  const [triggerExport] = useLazyGetPricingExportQuery();

  // How many advanced filters are active (badge on the Filters button)
  const activeFilterCount =
    (effectiveFrom ? 1 : 0) + (effectiveTo ? 1 : 0) + (revisedBy ? 1 : 0);

  const clearAdvancedFilters = () => {
    setEffectiveFrom(''); setEffectiveTo(''); setRevisedBy('');
  };

  // Quick-pick month presets
  const applyMonthPreset = (preset) => {
    const today = dayjs();
    let from, to;
    if (preset === 'thisMonth')      { from = today.startOf('month');             to = today.endOf('month'); }
    else if (preset === 'lastMonth') { from = today.subtract(1, 'month').startOf('month'); to = today.subtract(1, 'month').endOf('month'); }
    else if (preset === 'last30')    { from = today.subtract(30, 'day');          to = today; }
    else if (preset === 'last90')    { from = today.subtract(90, 'day');          to = today; }
    else if (preset === 'thisFY')    {
      // Indian FY: 1 Apr → 31 Mar
      const fyStartYear = today.month() >= 3 ? today.year() : today.year() - 1;
      from = dayjs().year(fyStartYear).month(3).date(1).startOf('day');
      to   = dayjs().year(fyStartYear + 1).month(2).date(31).endOf('day');
    }
    setEffectiveFrom(from.format('YYYY-MM-DD'));
    setEffectiveTo(to.format('YYYY-MM-DD'));
  };

  const handleExport = async () => {
    setExportAnchor(null);
    setIsExporting(true);
    try {
      const res = await triggerExport({
        priceType: effectivePriceType,
        ...(itemType ? { itemType } : {}),
      }).unwrap();
      const payload = res?.data || {};
      const filename = exportPricingWorkbook({
        current:   payload.current   || [],
        history:   payload.history   || [],
        documents: payload.documents || [],
        priceType: effectivePriceType,
      });
      enqueueSnackbar(`Downloaded: ${filename}`, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to build export', { variant: 'error' });
    } finally {
      setIsExporting(false);
    }
  };

  const statusChips = useMemo(() => STATUS_CHIPS(theme), [theme]);

  const groupChipSx = (selected) => ({
    height: 26, fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer',
    color: selected ? '#fff' : theme.palette.primary.dark,
    bgcolor: selected ? theme.palette.primary.main : alpha(theme.palette.primary.main, 0.07),
    border: `1px solid ${selected ? theme.palette.primary.main : alpha(theme.palette.primary.main, 0.18)}`,
    transition: 'all 0.12s ease',
    '&:hover': { bgcolor: selected ? theme.palette.primary.main : alpha(theme.palette.primary.main, 0.14) },
  });

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <Box sx={{
        position: 'relative', overflow: 'hidden', color: '#ffffff',
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
        px: { xs: 2.5, md: 3 }, pt: { xs: 2.5, md: 2.75 }, pb: { xs: 4, md: 4.5 },
      }}>
        <Box aria-hidden sx={{
          position: 'absolute', width: 420, height: 420, borderRadius: '50%',
          top: -160, right: -120,
          background: 'radial-gradient(circle, rgba(96,165,250,0.32) 0%, rgba(96,165,250,0) 60%)',
        }} />
        <Box aria-hidden sx={{
          position: 'absolute', width: 360, height: 360, borderRadius: '50%',
          bottom: -160, left: -100,
          background: 'radial-gradient(circle, rgba(91,108,255,0.30) 0%, rgba(91,108,255,0) 60%)',
        }} />

        <Stack direction="row" spacing={1.75} alignItems="center" sx={{ position: 'relative' }}>
          <Box sx={{
            width: 40, height: 40, borderRadius: 2,
            display: 'grid', placeItems: 'center',
            background: 'rgba(255,255,255,0.14)',
            border: '1px solid rgba(255,255,255,0.22)',
            backdropFilter: 'blur(8px)',
            flexShrink: 0,
          }}>
            <IndianRupee size={20} strokeWidth={2.2} color="#ffffff" />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ color: '#ffffff', fontSize: { xs: '1.15rem', md: '1.4rem' }, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              Pricing Hub
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.78)', fontSize: '0.78rem', mt: 0.25, maxWidth: 640 }}>
              Current, previous &amp; full price history for every item — proof-attached and fully audited.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Tooltip title="Refresh">
              <IconButton onClick={refetch} sx={{ color: '#fff', bgcolor: 'rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)', color: '#fff' } }}>
                <RefreshCw size={16} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Download as Excel (3 sheets)">
              <Button
                variant="contained"
                onClick={(e) => setExportAnchor(e.currentTarget)}
                startIcon={isExporting ? <CircularProgress size={14} color="inherit" /> : <Download size={16} />}
                disabled={isExporting}
                sx={{
                  fontWeight: 700,
                  background: 'rgba(255,255,255,0.16)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  color: '#fff',
                  '&:hover': { background: 'rgba(255,255,255,0.24)' },
                  boxShadow: 'none',
                }}
              >
                Export
              </Button>
            </Tooltip>
            {canRevise && (
              <Button
                variant="contained"
                startIcon={<Plus size={16} />}
                onClick={() => { setRevisePresetSku(null); setReviseOpen(true); }}
                sx={{
                  fontWeight: 700,
                  background: 'rgba(255,255,255,0.16)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  color: '#fff',
                  '&:hover': { background: 'rgba(255,255,255,0.24)' },
                  boxShadow: 'none',
                }}
              >
                Revise Price
              </Button>
            )}
          </Stack>
        </Stack>
      </Box>

      {/* ── KPI strip (overlapping the hero) ─────────────────── */}
      <Box sx={{ mx: { xs: 1.5, md: 2.5 }, mt: { xs: -2.75, md: -3 }, position: 'relative' }}>
        <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
          <KpiCard theme={theme} label="Total SKUs"        value={kpis.total ?? '—'}        icon={IndianRupee} color={theme.palette.primary.main} />
          <KpiCard theme={theme} label="Changed this week" value={kpis.changedThisWeek ?? '—'} icon={Sparkles}   color={theme.palette.success.dark} />
          <KpiCard theme={theme} label="Stable"            value={kpis.stable ?? '—'}        icon={BadgeCheck}  color={theme.palette.text.secondary} />
          <KpiCard theme={theme} label="Stale > 60 days"   value={kpis.stale ?? '—'}         icon={Hourglass}   color={theme.palette.warning.dark} />
          <KpiCard theme={theme} label="Unpriced"          value={kpis.unpriced ?? '—'}      icon={CircleDot}   color={theme.palette.error.dark} />
          <KpiCard theme={theme} label="Pending approval"  value={kpis.pending ?? '—'}       icon={Hourglass}   color={theme.palette.warning.dark} />
          <KpiCard theme={theme} label="Margin breach"     value={kpis.marginBreach ?? '—'}  icon={TriangleAlert} color={theme.palette.error.dark} />
        </Stack>
      </Box>

      {/* ── Panel ────────────────────────────────────────────── */}
      <Paper sx={{
        mx: { xs: 1.5, md: 2.5 }, mt: 2,
        borderRadius: 3, overflow: 'hidden',
        boxShadow: '0 10px 28px rgba(30, 58, 138, 0.07)',
      }}>
        {/* Toolbar */}
        <Box sx={{ borderBottom: `1px solid ${theme.palette.divider}` }}>
          {/* Row 0: Item-kind tabs — STEP 1, the primary navigation axis */}
          <Box sx={{ px: 2, pt: 1.75, pb: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography sx={{
                fontSize: '0.68rem', fontWeight: 800, color: 'text.disabled',
                letterSpacing: '0.08em', textTransform: 'uppercase', mr: 0.25,
              }}>
                Kind
              </Typography>
              {ITEM_KINDS.map((kind) => {
                const Icon = kind.icon;
                const selected = itemType === kind.key;
                const count = kind.key === '' ? allItemsCount : (itemTypeCounts[kind.key] || 0);
                return (
                  <Box
                    key={kind.key || 'all'}
                    onClick={() => handleKindChange(kind.key)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 0.85,
                      flexShrink: 0, whiteSpace: 'nowrap',
                      px: 1.4, py: 0.8, borderRadius: 2, cursor: 'pointer',
                      border: `1.5px solid ${selected ? theme.palette.primary.main : theme.palette.divider}`,
                      bgcolor: selected ? theme.palette.primary.main : '#fff',
                      color: selected ? '#fff' : theme.palette.text.primary,
                      transition: 'all 0.15s ease',
                      '&:hover': {
                        borderColor: theme.palette.primary.main,
                        transform: 'translateY(-1px)',
                      },
                    }}
                  >
                    <Icon size={15} color={selected ? '#ffffff' : theme.palette.text.secondary} />
                    <Typography sx={{
                      fontSize: '0.8rem', fontWeight: 800, whiteSpace: 'nowrap',
                      color: selected ? '#ffffff' : theme.palette.text.primary,
                    }}>
                      {kind.label}
                    </Typography>
                    <Box sx={{
                      minWidth: 20, height: 18, px: 0.55, borderRadius: 0.75,
                      display: 'grid', placeItems: 'center',
                      bgcolor: selected ? '#ffffff' : alpha(theme.palette.text.primary, 0.07),
                      color: selected ? theme.palette.primary.dark : theme.palette.text.secondary,
                      fontSize: '0.67rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                    }}>
                      {count}
                    </Box>
                  </Box>
                );
              })}
            </Stack>
          </Box>

          {/* Row 1: Price stream + Search + Result count */}
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            alignItems={{ md: 'center' }}
            sx={{ px: 2, pt: 2, pb: 1.5 }}
          >
            {/* Price stream — a toggle for sell-side kinds, a fixed label for
                buy-side kinds (which only have a purchase price). */}
            {isBuySide ? (
              <Stack direction="row" spacing={0.85} alignItems="center" sx={{
                px: 1.5, py: 0.7, borderRadius: 1.5,
                bgcolor: alpha(theme.palette.warning.main, 0.10),
                border: `1px solid ${alpha(theme.palette.warning.main, 0.25)}`,
              }}>
                <ShoppingCart size={14} color={theme.palette.warning.dark} />
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: theme.palette.warning.dark }}>
                  Purchase Price
                </Typography>
              </Stack>
            ) : (
              <ToggleButtonGroup
                exclusive
                value={priceType}
                onChange={(_, v) => v && setPriceType(v)}
                size="small"
                sx={{
                  bgcolor: alpha(theme.palette.primary.main, 0.04),
                  p: 0.4,
                  borderRadius: 1.5,
                  '& .MuiToggleButton-root': {
                    px: 2, py: 0.5, fontSize: '0.78rem', fontWeight: 700,
                    border: 'none',
                    borderRadius: '8px !important',
                    color: 'text.secondary',
                    textTransform: 'none',
                    '&.Mui-selected': {
                      bgcolor: '#fff',
                      color: theme.palette.primary.dark,
                      boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
                      '&:hover': { bgcolor: '#fff' },
                    },
                  },
                }}
              >
                <ToggleButton value="SELLING">Selling Price</ToggleButton>
                <ToggleButton value="RM_COST">RM Cost</ToggleButton>
              </ToggleButtonGroup>
            )}

            <TextField
              size="small"
              placeholder="Search SKU code or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{
                width: { xs: '100%', md: 340 },
                '& .MuiOutlinedInput-root': { borderRadius: 1.5, bgcolor: '#fff' },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={16} color={theme.palette.text.secondary} />
                  </InputAdornment>
                ),
              }}
            />

            <Box sx={{ flex: 1 }} />

            <Tooltip title="Date range, revised-by, monthly view">
              <Badge color="primary" badgeContent={activeFilterCount} invisible={activeFilterCount === 0} overlap="circular">
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<SlidersHorizontal size={14} />}
                  onClick={(e) => setFilterAnchor(e.currentTarget)}
                  sx={{
                    fontWeight: 700, borderRadius: 1.25, px: 1.5,
                    textTransform: 'none', fontSize: '0.78rem',
                    borderColor: activeFilterCount > 0 ? theme.palette.primary.main : theme.palette.divider,
                    color: activeFilterCount > 0 ? theme.palette.primary.dark : 'text.secondary',
                    bgcolor: activeFilterCount > 0 ? alpha(theme.palette.primary.main, 0.06) : 'transparent',
                  }}
                >
                  More filters
                </Button>
              </Badge>
            </Tooltip>

            <Typography sx={{
              fontSize: '0.74rem', color: 'text.secondary', fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              px: 1.25, py: 0.5, borderRadius: 1,
              bgcolor: alpha(theme.palette.text.primary, 0.04),
            }}>
              {isFetching ? 'Loading…' : `${rows.length} SKU${rows.length === 1 ? '' : 's'}`}
              {status && !isFetching && (
                <Typography component="span" sx={{ fontSize: '0.74rem', color: theme.palette.primary.dark, fontWeight: 700, ml: 0.5 }}>
                  · filtered by {status}
                </Typography>
              )}
            </Typography>
          </Stack>

          {/* Row 2: Status filter chips — left-aligned, labelled */}
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
            sx={{ px: 2, pb: 1.5 }}
          >
            <Typography sx={{
              fontSize: '0.68rem', fontWeight: 800, color: 'text.disabled',
              letterSpacing: '0.08em', textTransform: 'uppercase', mr: 0.5,
            }}>
              Filter
            </Typography>
            {statusChips.map((c) => {
              const Icon = c.icon;
              const selected = status === c.key;
              return (
                <Chip
                  key={c.key || 'all'}
                  size="small"
                  onClick={() => setStatus(c.key)}
                  icon={
                    c.dot ? (
                      <Box sx={{
                        width: 7, height: 7, borderRadius: '50%',
                        bgcolor: selected ? '#fff' : c.dot, ml: '8px !important',
                      }} />
                    ) : <Icon size={11} style={{ marginLeft: 8 }} />
                  }
                  label={c.label}
                  sx={{
                    height: 28, px: 0.75, fontWeight: 700, fontSize: '0.74rem',
                    color: selected ? '#fff' : c.color,
                    bgcolor: selected ? c.color : alpha(c.color, 0.08),
                    border: `1px solid ${selected ? c.color : alpha(c.color, 0.18)}`,
                    '& .MuiChip-icon': { color: 'inherit' },
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    '&:hover': {
                      bgcolor: selected ? c.color : alpha(c.color, 0.16),
                      transform: 'translateY(-1px)',
                    },
                  }}
                />
              );
            })}
          </Stack>

          {/* Row 3: Sub-group chips for the active kind */}
          {itemType && categories.length > 0 && (
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
              sx={{
                px: 2, pb: 1.5,
                borderTop: `1px dashed ${theme.palette.divider}`,
                pt: 1.5,
              }}
            >
              <Typography sx={{
                fontSize: '0.68rem', fontWeight: 800, color: 'text.disabled',
                letterSpacing: '0.08em', textTransform: 'uppercase', mr: 0.5,
              }}>
                Group
              </Typography>
              <Chip
                size="small"
                label="All groups"
                onClick={() => setCategory('')}
                sx={groupChipSx(category === '')}
              />
              {categories.map((c) => (
                <Chip
                  key={c.name}
                  size="small"
                  label={`${c.name} · ${c.count}`}
                  onClick={() => setCategory(c.name)}
                  sx={groupChipSx(category === c.name)}
                />
              ))}
            </Stack>
          )}
        </Box>

        {/* Active filter chips strip (shows when advanced filters applied) */}
        {activeFilterCount > 0 && (
          <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
            sx={{
              px: 2, py: 1.25,
              bgcolor: alpha(theme.palette.primary.main, 0.04),
              borderBottom: `1px solid ${theme.palette.divider}`,
            }}
          >
            <Typography sx={{
              fontSize: '0.68rem', fontWeight: 800, color: theme.palette.primary.dark,
              letterSpacing: '0.08em', textTransform: 'uppercase', mr: 0.5,
            }}>
              Active filters:
            </Typography>
            {effectiveFrom && (
              <Chip
                size="small"
                icon={<CalendarRange size={11} style={{ marginLeft: 6 }} />}
                label={`From: ${dayjs(effectiveFrom).format('DD MMM YYYY')}`}
                onDelete={() => setEffectiveFrom('')}
                deleteIcon={<X size={12} />}
                sx={{
                  height: 24, fontWeight: 700, fontSize: '0.7rem',
                  color: theme.palette.primary.dark,
                  bgcolor: alpha(theme.palette.primary.main, 0.10),
                  '& .MuiChip-icon': { color: 'inherit' },
                }}
              />
            )}
            {effectiveTo && (
              <Chip
                size="small"
                icon={<CalendarRange size={11} style={{ marginLeft: 6 }} />}
                label={`To: ${dayjs(effectiveTo).format('DD MMM YYYY')}`}
                onDelete={() => setEffectiveTo('')}
                deleteIcon={<X size={12} />}
                sx={{
                  height: 24, fontWeight: 700, fontSize: '0.7rem',
                  color: theme.palette.primary.dark,
                  bgcolor: alpha(theme.palette.primary.main, 0.10),
                  '& .MuiChip-icon': { color: 'inherit' },
                }}
              />
            )}
            {revisedBy && (
              <Chip
                size="small"
                icon={<UserCircle2 size={11} style={{ marginLeft: 6 }} />}
                label={`Revised by: ${revisedBy}`}
                onDelete={() => setRevisedBy('')}
                deleteIcon={<X size={12} />}
                sx={{
                  height: 24, fontWeight: 700, fontSize: '0.7rem',
                  color: theme.palette.primary.dark,
                  bgcolor: alpha(theme.palette.primary.main, 0.10),
                  '& .MuiChip-icon': { color: 'inherit' },
                }}
              />
            )}
            <Button
              size="small"
              onClick={clearAdvancedFilters}
              sx={{
                fontSize: '0.7rem', fontWeight: 700,
                color: theme.palette.error.dark,
                textTransform: 'none', minWidth: 'auto', px: 1,
              }}
            >
              Clear all
            </Button>
          </Stack>
        )}

        <PriceMasterTable
          rows={rows}
          isLoading={isFetching}
          priceType={effectivePriceType}
          itemType={itemType}
          onRowClick={(row) => setDrawerSkuId(String(row.skuId))}
          onRevise={(row) => { setRevisePresetSku(row); setReviseOpen(true); }}
          canRevise={canRevise}
        />
      </Paper>

      {/* ── More-filters popover ──────────────────────────────────── */}
      <Popover
        open={Boolean(filterAnchor)}
        anchorEl={filterAnchor}
        onClose={() => setFilterAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: { p: 2.5, width: 380, borderRadius: 2.5, boxShadow: '0 16px 40px rgba(15, 23, 42, 0.18)' },
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <SlidersHorizontal size={16} color={theme.palette.primary.dark} />
          <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }}>Advanced Filters</Typography>
        </Stack>

        {/* Quick month presets */}
        <Typography sx={{
          fontSize: '0.66rem', fontWeight: 800, color: 'text.disabled',
          letterSpacing: '0.08em', textTransform: 'uppercase', mb: 0.75,
        }}>
          Quick range
        </Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          {[
            { key: 'thisMonth', label: 'This month' },
            { key: 'lastMonth', label: 'Last month' },
            { key: 'last30',    label: 'Last 30 days' },
            { key: 'last90',    label: 'Last 90 days' },
            { key: 'thisFY',    label: 'This FY' },
          ].map((p) => (
            <Chip
              key={p.key}
              size="small"
              label={p.label}
              onClick={() => applyMonthPreset(p.key)}
              sx={{
                height: 24, fontWeight: 600, fontSize: '0.7rem',
                color: theme.palette.primary.dark,
                bgcolor: alpha(theme.palette.primary.main, 0.06),
                border: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
                cursor: 'pointer',
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.14) },
              }}
            />
          ))}
        </Stack>

        <Divider sx={{ mb: 1.5 }} />

        {/* Effective-date range */}
        <Typography sx={{
          fontSize: '0.66rem', fontWeight: 800, color: 'text.disabled',
          letterSpacing: '0.08em', textTransform: 'uppercase', mb: 0.75,
        }}>
          Effective date range
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <TextField
            label="From"
            type="date"
            size="small"
            fullWidth
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="To"
            type="date"
            size="small"
            fullWidth
            value={effectiveTo}
            onChange={(e) => setEffectiveTo(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Stack>

        {/* Revised by */}
        <Typography sx={{
          fontSize: '0.66rem', fontWeight: 800, color: 'text.disabled',
          letterSpacing: '0.08em', textTransform: 'uppercase', mb: 0.75,
        }}>
          Revised by
        </Typography>
        <TextField
          select
          size="small"
          fullWidth
          value={revisedBy}
          onChange={(e) => setRevisedBy(e.target.value)}
          SelectProps={{ displayEmpty: true }}
          sx={{ mb: 2 }}
        >
          <MenuItem value=""><em>Anyone</em></MenuItem>
          {reviewers.map((name) => (
            <MenuItem key={name} value={name}>{name}</MenuItem>
          ))}
        </TextField>

        <Divider sx={{ mb: 1.5 }} />

        <Stack direction="row" spacing={1} justifyContent="space-between">
          <Button
            size="small"
            onClick={clearAdvancedFilters}
            sx={{ fontWeight: 700, color: theme.palette.error.dark, textTransform: 'none' }}
          >
            Clear all
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={() => setFilterAnchor(null)}
            sx={{ fontWeight: 700, borderRadius: 1.25 }}
          >
            Apply &amp; close
          </Button>
        </Stack>
      </Popover>

      {/* ── Export popover ────────────────────────────────────────── */}
      <Popover
        open={Boolean(exportAnchor)}
        anchorEl={exportAnchor}
        onClose={() => setExportAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: { p: 2, width: 320, borderRadius: 2.5, boxShadow: '0 16px 40px rgba(15, 23, 42, 0.18)' },
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <FileSpreadsheet size={16} color={theme.palette.success.dark} />
          <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }}>Export to Excel</Typography>
        </Stack>
        <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 1.5 }}>
          One workbook with three sheets, ready to share with the MD or send to a customer:
        </Typography>
        <Stack spacing={0.5} sx={{ mb: 2, pl: 1.5 }}>
          <Typography sx={{ fontSize: '0.78rem', color: 'text.primary' }}>
            <strong>1.</strong> Current SKU Prices — the live master
          </Typography>
          <Typography sx={{ fontSize: '0.78rem', color: 'text.primary' }}>
            <strong>2.</strong> Price Revision History — every change ever filed
          </Typography>
          <Typography sx={{ fontSize: '0.78rem', color: 'text.primary' }}>
            <strong>3.</strong> Supporting Documents — proof links
          </Typography>
        </Stack>
        <Button
          fullWidth
          variant="contained"
          startIcon={isExporting ? <CircularProgress size={14} color="inherit" /> : <Download size={14} />}
          onClick={handleExport}
          disabled={isExporting}
          sx={{ fontWeight: 700, borderRadius: 1.25 }}
        >
          {isExporting
            ? 'Building workbook…'
            : `Download ${effectivePriceType === 'SELLING' ? 'Selling Prices' : (isBuySide ? 'Purchase Prices' : 'RM Costs')} (.xlsx)`}
        </Button>
      </Popover>

      <Box sx={{ height: 32 }} />

      <RevisePriceDialog
        open={reviseOpen}
        onClose={() => setReviseOpen(false)}
        presetSku={revisePresetSku}
        defaultPriceType={effectivePriceType}
      />
      <PriceHistoryDrawer
        skuId={drawerSku?.id}
        skuCode={drawerSku?.code}
        skuName={drawerSku?.name}
        priceType={effectivePriceType}
        priceLabel={streamLabel}
        open={!!drawerSkuId}
        onClose={() => setDrawerSkuId('')}
        onRevise={(row) => { setRevisePresetSku(row); setReviseOpen(true); }}
        canRevise={canRevise}
      />
    </Box>
  );
};

export default PricingHub;
