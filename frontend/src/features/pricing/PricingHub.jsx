import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Stack, Chip, Button, TextField, InputAdornment,
  Paper, alpha, useTheme, IconButton, Tooltip,
  Popover, MenuItem, Divider, CircularProgress, Badge, Autocomplete,
  Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import {
  IndianRupee, Search, Plus, RefreshCw, Sparkles, TriangleAlert,
  CircleDot, BadgeCheck, Hourglass, ArrowDownUp, SlidersHorizontal,
  Download, FileSpreadsheet, X, CalendarRange, UserCircle2,
  LayoutGrid, PackageCheck, Layers, Wrench, Boxes, ShoppingCart, Tag,
  Building2, ChevronDown, Users,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { enqueueSnackbar } from 'notistack';
import {
  useGetPriceMasterQuery,
  useGetPricingReviewersQuery,
  useLazyGetPricingExportQuery,
} from '../../store/api/pricingApi';
import { useGetPartiesQuery } from '../../store/api/partyApi';
import PriceMasterTable from './components/PriceMasterTable';
import RevisePriceDialog from './components/RevisePriceDialog';
import PriceHistoryDrawer from './components/PriceHistoryDrawer';
import { usePermissions } from '../../hooks/usePermission';
import { exportPricingWorkbook } from '../../utils/exportPricingExcel';
import { O2D } from '../o2d-fms/o2dTheme';

// Same brand constants the O2D screens use, so Pricing reads as one product with
// Dispatch / FMS / Masters rather than its own island.
const BRAND = O2D.brand;      // #1d4ed8
const BRAND_DK = '#1e3a8a';
const NAVY = '#0b2545';

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

/**
 * One cell of the KPI strip.
 *
 * These were seven separate gradient cards that wrapped onto two rows on a
 * laptop. They are now cells inside a single divided strip: same information,
 * about half the vertical cost, and the numbers line up on one baseline so the
 * row can be read across instead of card by card. `zero` greys a 0 out — a
 * count of nothing shouldn't shout in red.
 */
const KpiCell = ({ label, value, color, icon: Icon, onClick, active }) => {
  const zero = value === 0 || value === '0';
  const tone = zero ? O2D.faint : color;
  return (
    <Box
      onClick={onClick}
      sx={{
        flex: '1 1 0', minWidth: 132, px: 1.5, py: 1.1,
        display: 'flex', alignItems: 'center', gap: 1,
        cursor: onClick ? 'pointer' : 'default',
        borderLeft: `1px solid ${O2D.line}`,
        '&:first-of-type': { borderLeft: 0 },
        bgcolor: active ? alpha(BRAND, 0.06) : 'transparent',
        transition: 'background .12s',
        '&:hover': onClick ? { bgcolor: alpha(BRAND, 0.05) } : null,
      }}
    >
      <Box sx={{
        width: 26, height: 26, borderRadius: '6px', flexShrink: 0,
        display: 'grid', placeItems: 'center',
        bgcolor: alpha(tone, 0.1), color: tone,
      }}>
        <Icon size={14} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: O2D.sub, lineHeight: 1.3 }}>
          {label}
        </Typography>
        <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', color: zero ? O2D.sub : tone }}>
          {value}
        </Typography>
      </Box>
    </Box>
  );
};

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
  // Party (client) scope — multi-select; default empty = all SKUs. Ids in the URL
  // as a comma list so the view is shareable.
  const [partyIds,      setPartyIds]      = useState(() => (searchParams.get('party') || '').split(',').filter(Boolean));
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

  // A selling price only exists for finished goods. Whenever the Selling Price
  // stream is active, scope the entire view (rows, KPIs, export, sub-groups)
  // to FINISHED_GOOD so raw materials / consumables / packing never appear and
  // the SKU count reflects only sellable finished goods.
  const sellingScope = effectivePriceType === 'SELLING';
  const queryItemType = sellingScope ? 'FINISHED_GOOD' : itemType;

  const handleKindChange = (key) => {
    setItemType(key);
    setCategory(''); // a sub-group only makes sense within one kind
  };

  const masterQuery = useMemo(() => ({
    priceType: effectivePriceType, search, status,
    ...(queryItemType ? { itemType: queryItemType } : {}),
    ...(category ? { category } : {}),
    ...(effectiveFrom ? { effectiveFrom } : {}),
    ...(effectiveTo   ? { effectiveTo }   : {}),
    ...(revisedBy     ? { revisedBy }     : {}),
    ...(partyIds.length ? { partyIds: partyIds.join(',') } : {}),
  }), [effectivePriceType, search, status, queryItemType, category, effectiveFrom, effectiveTo, revisedBy, partyIds]);

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
    if (partyIds.length) next.set('party', partyIds.join(','));
    if (drawerSkuId)   next.set('sku',    drawerSkuId);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceType, itemType, category, status, search, effectiveFrom, effectiveTo, revisedBy, partyIds, drawerSkuId]);

  // Keep the price stream in sync with the URL. The sidebar's "Selling Price"
  // / "RM Cost" entries navigate here with ?stream=…, and this screen never
  // unmounts between those clicks, so the active stream has to follow the URL.
  useEffect(() => {
    const next = searchParams.get('stream') === 'RM_COST' ? 'RM_COST' : 'SELLING';
    setPriceType((prev) => (prev === next ? prev : next));
  }, [searchParams]);

  const { data: reviewersRes } = useGetPricingReviewersQuery();
  const reviewers = reviewersRes?.data || [];

  // Party list for the "filter by client" multi-select (id + name only needed —
  // the backend resolves each party's ordered SKUs).
  const { data: partiesRes } = useGetPartiesQuery({ limit: 1000, sort: 'name' });
  const parties = useMemo(() => partiesRes?.data || [], [partiesRes]);
  const selectedParties = useMemo(
    () => parties.filter((p) => partyIds.includes(String(p._id))),
    [parties, partyIds],
  );

  // ── Group SKUs by client (party) — Selling Price / finished goods only ──
  // Each party's `orderedSkus` says which finished goods it buys, so we bucket the
  // price rows under each party (a SKU sold to two clients shows under both).
  const [groupByParty, setGroupByParty] = useState(false);
  const sellingView = effectivePriceType === 'SELLING';
  const partyGroups = useMemo(() => {
    if (!groupByParty || !sellingView) return null;
    const used = new Set();
    const groups = [...parties]
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .map((p) => {
        const pid = String(p._id);
        // A SKU belongs to this client if it's linked to it via "Manage SKUs"
        // (row.clientId — the authoritative link, so newly-added items show up),
        // OR it's in the party's ordered-SKU list (legacy sheet/order links).
        const codes = new Set(
          (p.orderedSkus || []).map((s) => String(s.skuCode || '').toUpperCase()).filter(Boolean),
        );
        const grpRows = rows.filter((r) => (
          (r.clientId && String(r.clientId) === pid)
          || (r.code && codes.has(String(r.code).toUpperCase()))
        ));
        grpRows.forEach((r) => used.add(String(r.skuId)));
        return { id: pid, name: p.name, rows: grpRows };
      })
      .filter((g) => g.rows.length > 0);
    const orphan = rows.filter((r) => !used.has(String(r.skuId)));
    if (orphan.length) groups.push({ id: '__none__', name: 'Not linked to a client', rows: orphan });
    return groups;
  }, [groupByParty, sellingView, parties, rows]);

  const [triggerExport] = useLazyGetPricingExportQuery();

  // How many advanced filters are active (badge on the Filters button)
  const activeFilterCount =
    (effectiveFrom ? 1 : 0) + (effectiveTo ? 1 : 0) + (revisedBy ? 1 : 0) + (partyIds.length ? 1 : 0);

  const clearAdvancedFilters = () => {
    setEffectiveFrom(''); setEffectiveTo(''); setRevisedBy(''); setPartyIds([]);
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
        ...(queryItemType ? { itemType: queryItemType } : {}),
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
    <Box sx={{ minHeight: '100vh', bgcolor: O2D.canvas, p: { xs: 1.5, md: 2.25 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* ── Header ───────────────────────────────────────────────
          Was a full-bleed gradient hero with two radial blobs, ~150px tall and
          unlike every other O2D screen. Now a flat header on the canvas: the
          page keeps its identity through the icon and title, and the ~90px it
          gives back goes to the table. */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{
            width: 38, height: 38, borderRadius: '8px', flexShrink: 0,
            display: 'grid', placeItems: 'center',
            bgcolor: alpha(BRAND, 0.1), color: BRAND,
            border: `1px solid ${alpha(BRAND, 0.2)}`,
          }}>
            <IndianRupee size={19} strokeWidth={2.2} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: NAVY, fontSize: { xs: '1.15rem', md: '1.3rem' }, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              Pricing Hub
            </Typography>
            <Typography sx={{ color: O2D.sub, fontSize: '0.78rem', mt: 0.2 }}>
              Current, previous &amp; full price history for every item — proof-attached and fully audited.
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={refetch}
              sx={{ width: 36, height: 36, borderRadius: '8px', color: O2D.sub, bgcolor: O2D.surface, border: `1px solid ${O2D.line}`, '&:hover': { color: BRAND, borderColor: alpha(BRAND, 0.4) } }}>
              <RefreshCw size={15} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Download as Excel (3 sheets)">
            <Button
              variant="outlined"
              onClick={(e) => setExportAnchor(e.currentTarget)}
              startIcon={isExporting ? <CircularProgress size={14} /> : <Download size={15} />}
              disabled={isExporting}
              sx={{ height: 36, borderRadius: '8px', fontWeight: 800, fontSize: '0.82rem', textTransform: 'none', bgcolor: O2D.surface, color: BRAND_DK, borderColor: O2D.line, '&:hover': { borderColor: BRAND, bgcolor: alpha(BRAND, 0.04) } }}
            >
              Export
            </Button>
          </Tooltip>
          {canRevise && (
            <Button
              variant="contained"
              startIcon={<Plus size={15} />}
              onClick={() => { setRevisePresetSku(null); setReviseOpen(true); }}
              sx={{ height: 36, borderRadius: '8px', fontWeight: 800, fontSize: '0.82rem', textTransform: 'none', boxShadow: 'none', bgcolor: BRAND, '&:hover': { bgcolor: BRAND_DK, boxShadow: 'none' } }}
            >
              Revise Price
            </Button>
          )}
        </Stack>
      </Stack>

      {/* ── KPI strip — one divided row, and each cell is a filter ── */}
      <Paper sx={{ borderRadius: '10px', border: `1px solid ${O2D.line}`, boxShadow: 'none', overflow: 'hidden', bgcolor: O2D.surface }}>
        <Stack direction="row" flexWrap="wrap" useFlexGap>
          <KpiCell label="Total SKUs"        value={kpis.total ?? '—'}           icon={IndianRupee}   color={BRAND}
            onClick={() => setStatus('')}         active={status === ''} />
          <KpiCell label="Changed this week" value={kpis.changedThisWeek ?? '—'} icon={Sparkles}      color="#15803d"
            onClick={() => setStatus('changed')}  active={status === 'changed'} />
          <KpiCell label="Stable"            value={kpis.stable ?? '—'}          icon={BadgeCheck}    color={O2D.sub}
            onClick={() => setStatus('stable')}   active={status === 'stable'} />
          <KpiCell label="Stale > 60 days"   value={kpis.stale ?? '—'}           icon={Hourglass}     color="#b45309"
            onClick={() => setStatus('stale')}    active={status === 'stale'} />
          <KpiCell label="Unpriced"          value={kpis.unpriced ?? '—'}        icon={CircleDot}     color="#be123c"
            onClick={() => setStatus('unpriced')} active={status === 'unpriced'} />
          <KpiCell label="Pending approval"  value={kpis.pending ?? '—'}         icon={Hourglass}     color="#b45309"
            onClick={() => setStatus('pending')}  active={status === 'pending'} />
          <KpiCell label="Margin breach"     value={kpis.marginBreach ?? '—'}    icon={TriangleAlert} color="#be123c" />
        </Stack>
      </Paper>

      {/* ── Panel ────────────────────────────────────────────── */}
      <Paper sx={{
        flexGrow: 1, borderRadius: '10px', overflow: 'hidden',
        border: `1px solid ${O2D.line}`, boxShadow: 'none', bgcolor: O2D.surface,
      }}>
        {/* Toolbar */}
        <Box sx={{ borderBottom: `1px solid ${theme.palette.divider}` }}>
          {/* Row 0: Item-kind tabs — STEP 1, the primary navigation axis.
              In selling scope this collapses to a single "Finished Goods" chip,
              so the whole row was a labelled band with nothing to choose. The
              stream indicator in Row 1 already says what you are looking at, so
              the row is only rendered when there is an actual choice to make. */}
          {ITEM_KINDS.filter((kind) => !sellingScope || kind.key === 'FINISHED_GOOD').length > 1 && (
          <Box sx={{ px: 2, pt: 1.5, pb: 1.25, borderBottom: `1px solid ${O2D.line}` }}>
            <Stack direction="row" spacing={0.85} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography sx={{
                fontSize: '0.62rem', fontWeight: 800, color: O2D.faint,
                letterSpacing: '0.08em', textTransform: 'uppercase', mr: 0.25,
              }}>
                Kind
              </Typography>
              {ITEM_KINDS.filter((kind) => !sellingScope || kind.key === 'FINISHED_GOOD').map((kind) => {
                const Icon = kind.icon;
                // In selling scope the view is locked to finished goods, so show
                // that tab as the active one regardless of the raw itemType state.
                const selected = sellingScope ? kind.key === 'FINISHED_GOOD' : itemType === kind.key;
                const count = kind.key === '' ? allItemsCount : (itemTypeCounts[kind.key] || 0);
                return (
                  <Box
                    key={kind.key || 'all'}
                    onClick={() => handleKindChange(kind.key)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 0.75,
                      flexShrink: 0, whiteSpace: 'nowrap',
                      height: 32, px: 1.3, borderRadius: '8px', cursor: 'pointer',
                      border: `1px solid ${selected ? BRAND : O2D.line}`,
                      bgcolor: selected ? BRAND : O2D.surface,
                      // No translateY: a row of chips that jumps under the cursor
                      // makes the counts hard to compare while scanning.
                      transition: 'background .15s, border-color .15s',
                      '&:hover': selected
                        ? { bgcolor: BRAND_DK }
                        : { borderColor: alpha(BRAND, 0.45), bgcolor: alpha(BRAND, 0.04) },
                    }}
                  >
                    <Icon size={14} color={selected ? '#ffffff' : O2D.sub} />
                    <Typography sx={{
                      fontSize: '0.78rem', fontWeight: 800, whiteSpace: 'nowrap',
                      color: selected ? '#ffffff' : NAVY,
                    }}>
                      {kind.label}
                    </Typography>
                    <Box sx={{
                      minWidth: 20, height: 17, px: 0.55, borderRadius: '5px',
                      display: 'grid', placeItems: 'center',
                      bgcolor: selected ? alpha('#ffffff', 0.22) : alpha(NAVY, 0.06),
                      color: selected ? '#fff' : O2D.sub,
                      fontSize: '0.65rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                    }}>
                      {count}
                    </Box>
                  </Box>
                );
              })}
            </Stack>
          </Box>
          )}

          {/* Row 1: Price stream + Search + Result count */}
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            alignItems={{ md: 'center' }}
            sx={{ px: 2, pt: 2, pb: 1.5 }}
          >
            {/* Active price stream — a read-only indicator. The stream is now
                chosen from the sidebar (Pricing Hub → Selling Price / RM Cost);
                buy-side kinds only ever have a purchase price. */}
            {(() => {
              const streamMeta = isBuySide
                ? { label: 'Purchase Price', color: theme.palette.warning.dark, Icon: ShoppingCart }
                : effectivePriceType === 'RM_COST'
                  ? { label: 'RM Cost',       color: theme.palette.info.dark,    Icon: Layers }
                  : { label: 'Selling Price', color: theme.palette.primary.dark, Icon: Tag };
              const { label, color, Icon } = streamMeta;
              return (
                <Stack direction="row" spacing={0.85} alignItems="center" sx={{
                  px: 1.5, py: 0.7, borderRadius: 1.5, flexShrink: 0,
                  bgcolor: alpha(color, 0.10),
                  border: `1px solid ${alpha(color, 0.25)}`,
                }}>
                  <Icon size={14} color={color} />
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color }}>
                    {label}
                  </Typography>
                </Stack>
              );
            })()}

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

            {/* Group finished-goods SKUs by the client that buys them. */}
            {sellingView && (
              <Chip
                size="small"
                icon={<Users size={13} style={{ marginLeft: 8 }} />}
                label="Group by client"
                onClick={() => setGroupByParty((v) => !v)}
                sx={{
                  height: 28, px: 0.75, fontWeight: 700, fontSize: '0.74rem',
                  color: groupByParty ? '#fff' : theme.palette.primary.dark,
                  bgcolor: groupByParty ? theme.palette.primary.main : alpha(theme.palette.primary.main, 0.08),
                  border: `1px solid ${groupByParty ? theme.palette.primary.main : alpha(theme.palette.primary.main, 0.2)}`,
                  '& .MuiChip-icon': { color: 'inherit' },
                  cursor: 'pointer',
                  '&:hover': { bgcolor: groupByParty ? theme.palette.primary.dark : alpha(theme.palette.primary.main, 0.16) },
                }}
              />
            )}
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
                    height: 28, px: 0.75, borderRadius: '8px',
                    fontWeight: 800, fontSize: '0.74rem',
                    color: selected ? '#fff' : c.color,
                    bgcolor: selected ? c.color : alpha(c.color, 0.08),
                    border: `1px solid ${selected ? c.color : alpha(c.color, 0.2)}`,
                    '& .MuiChip-icon': { color: 'inherit' },
                    cursor: 'pointer',
                    transition: 'background .15s, border-color .15s',
                    '&:hover': { bgcolor: selected ? c.color : alpha(c.color, 0.16) },
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
            {selectedParties.map((p) => (
              <Chip
                key={p._id}
                size="small"
                icon={<UserCircle2 size={11} style={{ marginLeft: 6 }} />}
                label={p.name}
                onDelete={() => setPartyIds((ids) => ids.filter((x) => x !== String(p._id)))}
                deleteIcon={<X size={12} />}
                sx={{
                  height: 24, fontWeight: 700, fontSize: '0.7rem',
                  color: theme.palette.primary.dark,
                  bgcolor: alpha(theme.palette.primary.main, 0.10),
                  '& .MuiChip-icon': { color: 'inherit' },
                }}
              />
            ))}
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

        {groupByParty && partyGroups ? (
          <Box sx={{ p: { xs: 1, sm: 1.5 } }}>
            {partyGroups.length === 0 ? (
              <Typography sx={{ p: 4, textAlign: 'center', color: 'text.disabled', fontWeight: 700 }}>
                No client-linked SKUs match the current filters.
              </Typography>
            ) : partyGroups.map((g) => (
              <Accordion
                key={g.id}
                defaultExpanded
                disableGutters
                elevation={0}
                sx={{
                  mb: 1, border: `1px solid ${theme.palette.divider}`, borderRadius: '10px !important',
                  overflow: 'hidden', '&:before': { display: 'none' },
                }}
              >
                <AccordionSummary
                  expandIcon={<ChevronDown size={18} />}
                  sx={{ bgcolor: alpha(theme.palette.primary.main, 0.04), minHeight: 46, '& .MuiAccordionSummary-content': { alignItems: 'center', gap: 1, my: 0.75 } }}
                >
                  <Box sx={{ width: 26, height: 26, borderRadius: '7px', display: 'grid', placeItems: 'center', bgcolor: alpha(theme.palette.primary.main, 0.12), color: theme.palette.primary.dark, flexShrink: 0 }}>
                    <Building2 size={14} />
                  </Box>
                  <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: g.id === '__none__' ? 'text.secondary' : 'text.primary' }}>
                    {g.name}
                  </Typography>
                  <Chip size="small" label={`${g.rows.length} SKU${g.rows.length === 1 ? '' : 's'}`}
                    sx={{ height: 20, fontSize: '0.66rem', fontWeight: 700, bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.dark }} />
                </AccordionSummary>
                <AccordionDetails sx={{ p: 0 }}>
                  <PriceMasterTable
                    rows={g.rows}
                    isLoading={false}
                    priceType={effectivePriceType}
                    itemType={itemType}
                    onRowClick={(row) => setDrawerSkuId(String(row.skuId))}
                    onRevise={(row) => { setRevisePresetSku(row); setReviseOpen(true); }}
                    canRevise={canRevise}
                  />
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        ) : (
          <PriceMasterTable
            rows={rows}
            isLoading={isFetching}
            priceType={effectivePriceType}
            itemType={itemType}
            onRowClick={(row) => setDrawerSkuId(String(row.skuId))}
            onRevise={(row) => { setRevisePresetSku(row); setReviseOpen(true); }}
            canRevise={canRevise}
          />
        )}
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

        {/* Party (client) scope — show only the SKUs the chosen client(s) order.
            Multi-select; empty = all SKUs. Resolved server-side from Party.orderedSkus. */}
        <Typography sx={{
          fontSize: '0.66rem', fontWeight: 800, color: 'text.disabled',
          letterSpacing: '0.08em', textTransform: 'uppercase', mb: 0.75,
        }}>
          Filter by client (party)
        </Typography>
        <Autocomplete
          multiple
          size="small"
          options={parties}
          value={selectedParties}
          onChange={(_, vals) => setPartyIds(vals.map((v) => String(v._id)))}
          getOptionLabel={(o) => (o ? `${o.name}${o.code ? ` (${o.code})` : ''}` : '')}
          isOptionEqualToValue={(a, b) => String(a._id) === String(b._id)}
          limitTags={3}
          renderInput={(p) => (
            <TextField {...p} placeholder={selectedParties.length ? '' : 'All clients — pick to narrow'} />
          )}
          sx={{ mb: 2 }}
        />

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
