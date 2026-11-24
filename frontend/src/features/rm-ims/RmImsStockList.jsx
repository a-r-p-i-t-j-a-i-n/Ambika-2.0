import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, InputAdornment, Table, TableHead, TableBody, TableRow, TableCell,
  IconButton, Tooltip, Skeleton, Button, MenuItem, Collapse, TablePagination, Chip, Alert, alpha,
} from '@mui/material';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Layers, Search, Pencil, Eye, X, Download, Calculator, Disc3, CircleDashed, AlertTriangle, IndianRupee } from 'lucide-react';
import dayjs from 'dayjs';
import {
  RmShell, Panel, TableScroll, RmKpiCard, RmKpiGrid, StatusChip, StatusLegend, EmptyNote, Th,
  KindChip, AvailMeter, availBand, uomOf,
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, stockToken, num, inr,
} from './rmImsMeta';
import { FLUENT, rmTableSx, statusRowSx, headerBtnSx } from './rmFluent';
import QtyRangeFilter from '../ims/QtyRangeFilter';
import { NO_QTY_RANGE, matchesQtyRange } from '../ims/qtyRange';
import { useGetRmOverviewQuery } from '../../store/api/rmImsApi';
import RmPolicyDialog from './RmPolicyDialog';
import { FIELD } from '../ims/imsFieldHelp';
import AwaitingQcNote from '../ims/AwaitingQcNote';

const H = FIELD.rm;

const num0 = (v) => (v == null ? '—' : num(v));

// A planning figure this item has no policy for. Shown instead of the fallback
// the service plans with, so a default is never read as the client's own number.
const NotConfigured = () => (
  <Tooltip arrow slotProps={O2D_TIP}
    title="No planning policy set for this item. IMS falls back to a system default to keep the levels working — set a policy to make this a real figure.">
    <Box component="span" sx={{ color: O2D.faint, cursor: 'help' }}>—</Box>
  </Tooltip>
);

/**
 * Material In Transit, and where the figure came from.
 *
 * A PO-backed number names the purchase orders behind it, because that is what
 * makes it checkable — a buyer can go and look. A typed number says so plainly,
 * so nobody mistakes somebody's estimate for a confirmed order.
 */
const InTransitCell = ({ row: r }) => (
  <Box sx={{ display: 'inline-block', textAlign: 'center' }}>
    <InTransitFigure row={r} />
    <AwaitingQcNote qty={r.awaitingQc} grnNumbers={r.awaitingQcGrnNumbers} fmt={num} />
  </Box>
);

const InTransitFigure = ({ row: r }) => {
  if (!r.inTransit) return <Box component="span" sx={{ color: O2D.faint }}>—</Box>;

  if (r.inTransitSource === 'PO') {
    const overdue = r.openPoOverdueCount > 0;
    const title = [
      `${num(r.inTransit)} pending on ${r.openPoCount} open purchase order${r.openPoCount > 1 ? 's' : ''}.`,
      r.openPoNumbers.length ? r.openPoNumbers.join(', ') : '',
      r.openPoReceivedQty > 0
        ? `${num(r.openPoReceivedQty)} of ${num(r.openPoOrderedQty)} ordered has already been received — counted in the stock on hand, or as Awaiting QC until its QC completes, not here.`
        : '',
      r.openPoEarliestExpectedAt ? `Earliest expected ${dayjs(r.openPoEarliestExpectedAt).format('DD MMM YYYY')}.` : '',
      overdue ? `${num(r.openPoOverdueQty)} of it is past its expected date.` : '',
    ].filter(Boolean).join(' ');
    return (
      <Tooltip arrow slotProps={O2D_TIP} title={title}>
        <Box sx={{ display: 'inline-block', cursor: 'help', textAlign: 'center' }}>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.body, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
            {num(r.inTransit)}
          </Typography>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: overdue ? STOCK_TOKENS.REORDER.color : O2D.faint }}>
            {overdue ? 'PO · overdue' : `PO × ${r.openPoCount}`}
          </Typography>
        </Box>
      </Tooltip>
    );
  }

  return (
    <Tooltip arrow slotProps={O2D_TIP}
      title="Typed into the planning policy by hand — no open purchase order backs it. Raise the PO in Purchase FMS and this becomes a live figure.">
      <Box sx={{ display: 'inline-block', cursor: 'help', textAlign: 'center' }}>
        <Typography sx={{ fontSize: '0.8rem', color: O2D.body, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
          {num(r.inTransit)}
        </Typography>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: O2D.faint }}>typed</Typography>
      </Box>
    </Tooltip>
  );
};

/** The daily rate, saying whether it was measured or is still just the plan. */
const AdcCell = ({ row: r }) => {
  if (!r.adc) {
    return (
      <Tooltip arrow slotProps={O2D_TIP}
        title="No consumption recorded yet and no planned rate set. The item is still active and still holds its stock — it simply cannot be planned until one of the two exists.">
        <Box component="span" sx={{ color: O2D.faint, cursor: 'help' }}>—</Box>
      </Tooltip>
    );
  }
  const measured = r.adcSource === 'MEASURED';
  return (
    <Tooltip arrow slotProps={O2D_TIP}
      title={measured
        ? `Measured: ${num(r.consumption90dQty)} issued over the last ${r.consumption90dDays} days ÷ ${r.consumption90dDays}.`
        : `The planned ${String(r.consumptionMode || '').toLowerCase()} rate. Nothing has been issued in the last ${r.consumption90dDays} days, so there is no measured rate to use yet.`}>
      <Box sx={{ display: 'inline-block', cursor: 'help', textAlign: 'center' }}>
        <Typography sx={{ fontSize: '0.8rem', color: O2D.body, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{num(r.adc)}</Typography>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: measured ? STOCK_TOKENS.OK.color : O2D.faint }}>
          {measured ? 'measured' : 'planned'}
        </Typography>
      </Box>
    </Tooltip>
  );
};

// Every planning word on this screen, in plain English. Raw material carries a
// couple of terms consumables do not — booked quantity and the three
// consumption modes — so they get spelled out too.
const GLOSSARY = [
  ['Total Available Quantity', 'How much of this coil or circle is physically in the store right now. Coil is weighed in kilos; circles are counted in pieces.'],
  ['Material In Transit', 'Ordered from the vendor and not yet received — read live from the open purchase orders in Purchase FMS. What a PO has already delivered is in the stock on hand instead, never counted twice. "typed" means somebody entered the figure by hand and no PO backs it.'],
  ['Booked Qty', 'Already promised to a confirmed order — not really free to use.'],
  ['Daily Avg Consumption', 'The average issued per day over the last 90 days, measured from the ledger. An item with no issues yet shows its planned Low/Normal/Peak rate instead, marked "planned".'],
  ['Daily Consumption', 'What was actually issued today — a running total, not an average. Blank means nothing has gone out today.'],
  ['Choose Current Consumption', 'Whether we are planning against a Low, Normal or Peak production rate. It picks which daily-use figure drives the reorder point.'],
  ['Safety Factor', 'A cushion multiplier for demand spikes and late deliveries, set per item. 1.5 means we hold 50% extra.'],
  ['Lead Time (From Indent to Receipt)', 'Days the vendor takes to deliver after you place the order.'],
  ['Reorder at', 'The trigger level. When stock drops to this, place the order — Daily Avg Consumption × Lead Time. The Safety Factor does not enter here, so changing it never moves this number.'],
  ['Max Level', 'The ceiling. When we buy, we buy enough to reach this level — Daily Avg Consumption × Lead Time × Safety Factor. An "M" beside the figure means it was overridden by hand and ignores the formula.'],
  ['Available %', 'Total Available Quantity measured against the Max Level. Under 33% is critical.'],
  ['Cover', 'How many days the current stock lasts at the chosen daily consumption rate.'],
];

const KIND_FILTERS = [
  { value: 'ALL', label: 'All raw material', icon: Layers },
  { value: 'COIL', label: 'Coils only', icon: Disc3 },
  { value: 'CIRCLE', label: 'Circles only', icon: CircleDashed },
];

// Colour key for the footer. It reads STOCK_TOKENS / STOCK_ORDER directly — the
// very same map the row tints and the Status chips already use — so the legend
// cannot drift from the table. No colour is defined here.
const ColorCodingLegend = () => (
  <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap
    sx={{ py: { xs: 1, md: 0 } }}>
    <Typography sx={{
      fontSize: '0.68rem', fontWeight: 800, color: O2D.sub,
      letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      Color Coding
    </Typography>
    {STOCK_ORDER.map((k) => {
      const t = STOCK_TOKENS[k];
      return (
        <Tooltip key={k} arrow slotProps={O2D_TIP} title={t.meaning}>
          <Stack direction="row" alignItems="center" spacing={0.55} sx={{ cursor: 'help' }}>
            <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: t.color, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.7rem', color: O2D.body, whiteSpace: 'nowrap' }}>{t.label}</Typography>
          </Stack>
        </Tooltip>
      );
    })}
  </Stack>
);

const RmImsStockList = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [kind, setKind] = useState(params.get('kind') || 'ALL');
  const [status, setStatus] = useState(params.get('status') || 'ALL');
  // KPI-card views, kept in the URL so the Dashboard can deep-link to them:
  //   IN_STOCK  only items holding stock, highest quantity first
  //   VALUE     only items holding value, highest stock value first
  const [view, setView] = useState({ 'in-stock': 'IN_STOCK', value: 'VALUE' }[params.get('view')] || 'ALL');
  const [search, setSearch] = useState('');
  // Available qty — below / above / between (QtyRangeFilter).
  const [qtyRange, setQtyRange] = useState(NO_QTY_RANGE);
  const [edit, setEdit] = useState(null);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Load the whole set and filter kind/status client-side, so the legend can
  // show live counts for every band rather than only the one being viewed.
  const queryArgs = useMemo(() => (search ? { search } : {}), [search]);
  const { data, isFetching } = useGetRmOverviewQuery(queryArgs);
  const rows = useMemo(() => data?.data || [], [data]);
  const unmatchedPo = useMemo(() => data?.meta?.inTransit?.unmatched || [], [data]);

  const setParam = (key, value, setter) => {
    setter(value);
    if (value === 'ALL') params.delete(key); else params.set(key, value);
    setParams(params, { replace: true });
  };

  const kindRows = useMemo(() => (kind === 'ALL' ? rows : rows.filter((r) => r.kind === kind)), [rows, kind]);
  const counts = useMemo(() => {
    const c = { ALL: kindRows.length };
    STOCK_ORDER.forEach((k) => { c[k] = kindRows.filter((r) => r.status === k).length; });
    return c;
  }, [kindRows]);

  const filtered = useMemo(() => {
    const list = (status === 'ALL' ? kindRows : kindRows.filter((r) => r.status === status))
      .filter((r) => matchesQtyRange(qtyRange, r.onHand))
      .filter((r) => (view === 'IN_STOCK' ? Number(r.onHand || 0) > 0
        : view === 'VALUE' ? Number(r.stockValue || 0) > 0 : true));
    if (view === 'IN_STOCK') return [...list].sort((a, b) => Number(b.onHand || 0) - Number(a.onHand || 0));
    if (view === 'VALUE') return [...list].sort((a, b) => Number(b.stockValue || 0) - Number(a.stockValue || 0));
    // Worst first, then thinnest availability — the order a planner works in.
    return [...list].sort((a, b) => STOCK_ORDER.indexOf(a.status) - STOCK_ORDER.indexOf(b.status)
      || (a.availablePct ?? 1e9) - (b.availablePct ?? 1e9));
  }, [kindRows, status, qtyRange, view]);

  useEffect(() => { setPage(0); }, [search, kind, status, view, rowsPerPage, qtyRange]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  const summary = useMemo(() => ({
    coils: rows.filter((r) => r.kind === 'COIL').length,
    circles: rows.filter((r) => r.kind === 'CIRCLE').length,
    onHand: rows.reduce((t, r) => t + Number(r.onHand || 0), 0),
    value: rows.reduce((t, r) => t + Number(r.stockValue || 0), 0),
    inStock: rows.filter((r) => Number(r.onHand || 0) > 0).length,
    valued: rows.filter((r) => Number(r.stockValue || 0) > 0).length,
    toOrder: rows.filter((r) => ['REORDER', 'OUT_OF_STOCK'].includes(r.status)).length,
  }), [rows]);

  const exportCsv = () => {
    // Same words, same order as the table on screen, so a printed sheet and the
    // app read alike. "Days cover" stays the CSV spelling of the "Cover" column,
    // matching the Consumables export.
    const header = [
      'SKU Code', 'Item Name', 'Material', 'UOM', 'Total Available Quantity', 'Recorded weight (kg)', 'Material In Transit', 'In Transit source', 'Booked Qty',
      'Daily Avg Consumption', 'ADC source', 'Daily Consumption', 'Safety Factor', 'Lead Time (From Indent to Receipt)', 'Reorder at', 'Max Level',
      'Max Level set', 'Available %', 'Days cover', 'Vendor Name', 'Status',
      // Appended LAST so every earlier column keeps its position for anyone
      // reading the file by column number. Received, waiting for Incoming QC:
      // never part of on hand or in transit.
      'Awaiting QC',
    ];
    const lines = filtered.map((r) => [
      r.skuCode, r.skuName, r.kind === 'CIRCLE' ? 'Circle' : 'Coil', uomOf(r),
      r.onHand, r.kind === 'CIRCLE' ? r.onHandKg : '', r.inTransit, r.inTransitSource, r.booked,
      r.adc, r.adcSource, r.dailyConsumption ?? '', r.safetyFactor, r.leadDays, r.reorderPoint, r.maxLevel,
      r.maxLevelMode === 'MANUAL' ? 'Manual' : 'Auto',
      r.availablePct ?? '', r.daysCover ?? '', r.vendorName, stockToken(r.status).label,
      r.awaitingQc || 0,
    ]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `raw-material-stock_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const activeFilters = (kind !== 'ALL' ? 1 : 0) + (status !== 'ALL' ? 1 : 0) + (view !== 'ALL' ? 1 : 0) + (search ? 1 : 0) + (qtyRange.mode ? 1 : 0);
  const VIEW_PARAM = { IN_STOCK: 'in-stock', VALUE: 'value' };
  // A KPI view toggles: clicking the active card again turns it off.
  const toggleView = (v) => {
    const next = view === v ? 'ALL' : v;
    setView(next);
    if (next === 'ALL') params.delete('view'); else params.set('view', VIEW_PARAM[next]);
    setParams(params, { replace: true });
  };
  const clearAll = () => {
    setSearch(''); setQtyRange(NO_QTY_RANGE); setKind('ALL'); setStatus('ALL'); setView('ALL');
    ['kind', 'status', 'view'].forEach((k) => params.delete(k));
    setParams(params, { replace: true });
  };

  return (
    <RmShell
      icon={Layers}
      title="Stock & Master Data"
      subtitle="Every coil and circle — what's on hand, what's committed, and when to buy more."
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!filtered.length}
          sx={headerBtnSx}>
          Export
        </Button>
      )}
    >
      <RmKpiGrid>
        <RmKpiCard label="Coils" value={num(summary.coils)} sub="Uncut raw metal" tone={FLUENT.teal} icon={Disc3}
          actionLabel="Filter" active={kind === 'COIL'} onClick={() => setParam('kind', kind === 'COIL' ? 'ALL' : 'COIL', setKind)}
          hint="Show coils only." />
        <RmKpiCard label="Circles" value={num(summary.circles)} sub="Cut and ready" tone={FLUENT.lavender} icon={CircleDashed}
          actionLabel="Filter" active={kind === 'CIRCLE'} onClick={() => setParam('kind', kind === 'CIRCLE' ? 'ALL' : 'CIRCLE', setKind)}
          hint="Show circles only." />
        <RmKpiCard label="Total Available Quantity" value={num(summary.onHand)}
          sub={`${num(summary.inStock)} item${summary.inStock === 1 ? '' : 's'} hold stock`} tone={FLUENT.blue} icon={Layers}
          actionLabel="In stock" active={view === 'IN_STOCK'} onClick={() => toggleView('IN_STOCK')}
          hint="Show only items with stock on hand, highest first." />
        <RmKpiCard label="Value in store" value={inr(summary.value)} sub="At the recorded rate" tone={FLUENT.grey} icon={IndianRupee}
          actionLabel="By value" active={view === 'VALUE'} onClick={() => toggleView('VALUE')}
          hint="Rank the items holding value, highest stock value first." />
        {/* Counts Out of stock + Order now together, so it opens the Buying List
            (as on Consumables) rather than a single-status filter. */}
        <RmKpiCard label="To order now" value={num(summary.toOrder)} sub="Out of stock + at reorder point"
          tone={FLUENT.orange} icon={AlertTriangle} actionLabel="Buying List"
          onClick={() => navigate('/rm-ims/reorder')} hint="Open the Buying List with how much to order for each." />
      </RmKpiGrid>

      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code, item or category…" sx={{ minWidth: { xs: '100%', sm: 260 }, flex: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
          <TextField select size="small" label="Material" value={kind} onChange={(e) => setParam('kind', e.target.value, setKind)} sx={{ minWidth: 175 }}>
            {KIND_FILTERS.map((k) => <MenuItem key={k.value} value={k.value}>{k.label}</MenuItem>)}
          </TextField>
          <QtyRangeFilter value={qtyRange} onChange={setQtyRange} />
          <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, whiteSpace: 'nowrap', ml: 'auto' }}>
            <b>{filtered.length}</b> of {rows.length}
          </Typography>
          {activeFilters > 0 && (
            <Button size="small" startIcon={<X size={12} />}
              onClick={clearAll}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.body }}>
              Clear ({activeFilters})
            </Button>
          )}
        </Stack>

        <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <StatusLegend counts={counts} value={status} onPick={(s) => setParam('status', s, setStatus)} />
        </Box>

      </Paper>

      {/* Open PO lines procurement holds that could not be attributed to a raw
          material item — usually a JSL line described by grade/width/finish with
          no SKU on it. Surfaced rather than swallowed: each one is material on
          its way that no item's In Transit figure is counting. */}
      {unmatchedPo.length > 0 && (
        <Alert severity="warning" icon={false}
          sx={{ borderRadius: '8px', py: 0.5, '& .MuiAlert-message': { width: '100%' } }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700 }}>
              {unmatchedPo.length} open purchase-order line{unmatchedPo.length > 1 ? 's' : ''} could not be matched to a raw-material item
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', opacity: 0.9 }}>
              — that material is on its way but is not counted in any In Transit figure below.
            </Typography>
            <Button size="small" onClick={() => setShowUnmatched((v) => !v)}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', ml: 'auto' }}>
              {showUnmatched ? 'Hide' : 'Show these lines'}
            </Button>
          </Stack>
          <Collapse in={showUnmatched}>
            <Box sx={{ mt: 1 }}>
              {unmatchedPo.map((u, i) => (
                <Typography key={`${u.poNumber}-${i}`} sx={{ fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace' }}>
                  {u.poNumber || '(no PO number)'} · {u.vendorName || 'no vendor'} · {u.skuCode || u.itemName
                    || [u.grade, u.width, u.finish].filter(Boolean).join(' ') || 'unnamed item'} · pending {num(u.pendingQty)} {u.unit} — {u.reason}
                </Typography>
              ))}
            </Box>
          </Collapse>
        </Alert>
      )}

      <Panel dense>
        <TableScroll>
          <Table size="small" sx={rmTableSx(1860, { zebra: false })}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="SKU Code" hint={H.skuCode} /></TableCell>
                <TableCell><Th label="Item Name" hint={H.skuName} /></TableCell>
                <TableCell align="center">Material</TableCell>
                <TableCell align="center"><Th label="UOM" hint={H.unit} /></TableCell>
                <TableCell align="center"><Th label="Total Available Quantity" hint={H.onHand} /></TableCell>
                <TableCell align="center"><Th label="Material In Transit" hint={H.inTransit} /></TableCell>
                <TableCell align="center"><Th label="Booked Qty" hint={H.booked} /></TableCell>
                <TableCell align="center"><Th label="Daily Avg Consumption" hint={H.adc} /></TableCell>
                <TableCell align="center"><Th label="Daily Consumption" hint={H.dailyConsumption} /></TableCell>
                {/* Safety Factor sits beside the levels it drives, and carries the
                    same label and the same ×-suffix as the Consumables stock list,
                    so a planner reads it the same way in either module. */}
                <TableCell align="center"><Th label="Safety Factor" hint={H.safetyFactor} /></TableCell>
                <TableCell align="center"><Th label="Lead Time (From Indent to Receipt)" hint={H.leadDays} /></TableCell>
                <TableCell align="center"><Th label="Reorder at" hint={H.reorderPoint} /></TableCell>
                <TableCell align="center"><Th label="Max Level" hint={H.maxLevel} /></TableCell>
                <TableCell align="center"><Th label="Available %" hint={H.availablePct} /></TableCell>
                <TableCell align="center"><Th label="Cover" hint={H.daysCover} /></TableCell>
                <TableCell><Th label="Vendor Name" hint={H.vendorName} /></TableCell>
                <TableCell align="center"><Th label="Status" hint={H.status} /></TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={19} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={280} /></TableCell></TableRow>
              )}
              {!isFetching && filtered.length === 0 && (
                <TableRow><TableCell colSpan={19} sx={{ border: 0 }}>
                  <EmptyNote icon={Layers} title="No raw material matches these filters"
                    hint="Try clearing the status filter, switching between coils and circles, or searching a different code." />
                </TableCell></TableRow>
              )}
              {paged.map((r, i) => {
                const band = availBand(r.availablePct);
                return (
                  // Problem rows carry a soft pastel wash and a muted left edge.
                  <TableRow key={r.skuId} hover data-status={r.status} sx={{ ...statusRowSx(r.status) }}>
                    {/* Derived from the page offset, not the array index, so page 2
                        continues at 26 rather than restarting at 1. Purely
                        presentational — it feeds no filter, sort or calculation. */}
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>
                      {page * rowsPerPage + i + 1}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography sx={{ fontSize: '0.73rem', color: O2D.body, fontFamily: 'ui-monospace, monospace' }}>{r.skuCode}</Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 240 }}>
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink }} title={r.skuName}>{r.skuName}</Typography>
                    </TableCell>
                    <TableCell align="center"><KindChip kind={r.kind} /></TableCell>
                    <TableCell align="center">
                      <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: O2D.sub }}>{uomOf(r)}</Typography>
                    </TableCell>
                    <TableCell align="center" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: O2D.ink }}>
                      {num(r.onHand)}
                      {/* Circles are counted in pieces AND weighed. The weight is
                          shown under the count, never added to it. */}
                      {r.kind === 'CIRCLE' && r.onHandKg > 0 && (
                        <Tooltip arrow slotProps={O2D_TIP}
                          title="The weight recorded alongside these pieces. A record only — planning, Max Level and Available % all work in pieces.">
                          <Typography sx={{ fontSize: '0.62rem', fontWeight: 600, color: O2D.faint, cursor: 'help' }}>
                            {num(r.onHandKg)} kg
                          </Typography>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell align="center" sx={{ fontVariantNumeric: 'tabular-nums' }}><InTransitCell row={r} /></TableCell>
                    <TableCell align="center" sx={{ fontVariantNumeric: 'tabular-nums', color: r.booked ? O2D.body : O2D.faint }}>{num0(r.booked)}</TableCell>
                    <TableCell align="center" sx={{ fontVariantNumeric: 'tabular-nums' }}><AdcCell row={r} /></TableCell>
                    <TableCell align="center" sx={{ fontVariantNumeric: 'tabular-nums', color: r.dailyConsumption ? O2D.body : O2D.faint }}>
                      {r.dailyConsumption == null ? '—' : num(r.dailyConsumption)}
                    </TableCell>
                    <TableCell align="center" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.body }}>
                      {r.hasPolicy ? `${num(r.safetyFactor)}×` : <NotConfigured />}
                    </TableCell>
                    <TableCell align="center" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.body }}>
                      {r.hasPolicy ? `${num(r.leadDays)}d` : <NotConfigured />}
                    </TableCell>
                    <TableCell align="center" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num0(r.reorderPoint)}</TableCell>
                    <TableCell align="center" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      <Stack direction="row" spacing={0.5} justifyContent="center" alignItems="center">
                        <span>{num0(r.maxLevel)}</span>
                        {/* "M" = this Max Level was typed in and ignores the formula,
                            so the Safety Factor beside it does not explain it. */}
                        {r.maxLevelMode === 'MANUAL' && (
                          <Tooltip arrow slotProps={O2D_TIP}
                            title={`Manually overridden. The formula would give ${num(r.formulaMaxLevel)} — changing the Safety Factor will not affect this value.`}>
                            <Box component="span" sx={{
                              fontSize: '0.6rem', fontWeight: 800, color: O2D.sub, cursor: 'help',
                              border: `1px solid ${O2D.line}`, borderRadius: '4px', px: 0.4, lineHeight: 1.5,
                            }}>M</Box>
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="center"><AvailMeter pct={r.availablePct} /></TableCell>
                    <TableCell align="center" sx={{
                      fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                      color: band?.critical ? STOCK_TOKENS.REORDER.color : O2D.body,
                    }}>
                      {r.daysCover == null ? '—' : `${num(r.daysCover)}d`}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 150 }}>
                      <Typography noWrap sx={{ fontSize: '0.73rem', color: r.vendorName ? O2D.body : O2D.faint }} title={r.vendorName}>
                        {r.vendorName || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="center"><StatusChip status={r.status} /></TableCell>
                    <TableCell align="right" sx={{ width: 84, whiteSpace: 'nowrap' }}>
                      <Tooltip arrow slotProps={O2D_TIP} title="Open this item — stock, planning, purchase orders and its day-by-day history">
                        <IconButton size="small" aria-label={`Open ${r.skuCode}`} onClick={() => navigate(`/rm-ims/item/${r.skuId}`)}
                          sx={{ color: O2D.sub, '&:hover': { color: O2D.brand, bgcolor: alpha(O2D.brand, 0.08) } }}><Eye size={15} /></IconButton>
                      </Tooltip>
                      <Tooltip arrow slotProps={O2D_TIP} title="Edit the planning policy (Daily Avg Consumption, Lead Time, Safety Factor, MOQ)">
                        <IconButton size="small" aria-label={`Edit planning policy for ${r.skuCode}`} onClick={() => setEdit(r)}
                          sx={{ color: O2D.sub, '&:hover': { color: O2D.brand, bgcolor: alpha(O2D.brand, 0.08) } }}><Pencil size={15} /></IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
        {/* Footer row: colour key on the left, pagination on the far right.
            flexWrap lets the two drop onto separate lines on tablet/mobile
            instead of forcing the panel to scroll sideways. */}
        <Box sx={{
          borderTop: `1px solid ${O2D.lineSoft}`,
          display: 'flex', flexWrap: 'wrap', alignItems: 'center',
          justifyContent: 'space-between', columnGap: 2, rowGap: 0.5, pl: { xs: 1, sm: 1.5 },
        }}>
          <ColorCodingLegend />
          <TablePagination
            component="div" count={filtered.length} page={page} onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Items per page:"
            sx={{ borderTop: 0, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
          />
        </Box>
      </Panel>

      {/* Availability bands, spelled out once so the meter never needs decoding. */}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center" sx={{ px: 0.5 }}>
        <Typography sx={{ fontSize: '0.68rem', color: O2D.faint, fontWeight: 700 }}>Availability bands:</Typography>
        {[[0, 'Under 33% — critically low'], [50, '33–66% — thin'], [90, '67–100% — comfortable'], [110, 'Over 100% — above plan']]
          .map(([p, label]) => {
            const b = availBand(p);
            return (
              <Chip key={label} size="small" label={label}
                sx={{
                  height: 21, fontSize: '0.66rem', fontWeight: 700, borderRadius: '999px',
                  bgcolor: O2D.surface, color: b.color, border: `1px solid ${b.color}44`,
                }} />
            );
          })}
      </Stack>

      {edit && <RmPolicyDialog row={edit} onClose={() => setEdit(null)} />}
    </RmShell>
  );
};

export default RmImsStockList;
