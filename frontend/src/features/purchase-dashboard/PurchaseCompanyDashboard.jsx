/**
 * Purchase Dashboard — company view (MD, or anyone who manages Purchase doers).
 *
 * The O2D Dashboard's company view (o2d-dashboard/CompanyDashboard.jsx), on
 * live Purchase data: KPI tiles, Delay analytics, Stage analysis, Quick
 * Overview, the Item Delivery Calendar and the indents table. Every panel
 * narrows the same view — a tile, a donut slice, a bar or a calendar day
 * filters the whole page, and "Show all indents" clears it. The O2D building
 * blocks are reused as they are; only the data and the wording are Purchase.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, ButtonBase, CircularProgress, Typography } from '@mui/material';
import {
  AlarmClock, BadgeIndianRupee, ChevronLeft, ChevronRight, CircleCheck, ClipboardList, Hourglass, Layers, PackageCheck, Scale,
  TimerOff, Truck, Wallet,
} from 'lucide-react';
import { useGetPurchaseDashboardDataQuery } from '../../store/api/purchaseDashboardApi';
import { clock, STAGE_TIMES } from '../o2d-dashboard/dashboardModel';
import { GROUP_COLOR, GROUP_LABEL, SKU_COLORS, STAT_BG, T, WIDE } from '../o2d-dashboard/dashTheme';
import { fmtDate, fmtDateShort, fmtMoney, fmtNum } from '../o2d-dashboard/format';
import {
  Bars, DashCard, DashHeader, DashPage, Donut, FilterBar, Insights, KpiTile, MiniDate, MiniSelect,
  OverviewItem, Person, ProgressCell, SplitRow, StatBox, ToneChip,
} from '../o2d-dashboard/components/DashUi';
import DashTable from '../o2d-dashboard/components/DashTable';
import { upcomingOrders } from '../o2d-dashboard/dashboardModel';
import {
  buildDeliveryEvents, buildPurchaseBoard, EMPTY_INDENT_FILTER, filterIndents, indentSplit, pctOf, PURCHASE_STAGE_MODES,
  purchaseInsights, purchaseKpis, purchaseStageBars, purchaseStageEmptyText, vendorOptions,
} from './purchaseDashboardModel';
import { IndentDrawer } from './PurchaseDrawers';
import ItemDeliveryCalendar from './ItemDeliveryCalendar';

const GROUP_VIA = { OVERDUE: 'Delayed', OPEN: 'In progress', PENDING: 'Pending indents', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
const KPI_VIA = {
  pendingApproval: 'Pending Approval',
  quotePending: 'Quote Pending',
  poReleased: 'PO Released',
  grnPending: 'GRN Pending',
  advanceDue: 'Advance to pay',
  rateChange: 'Pending Rate Change',
  overdueTasks: 'Overdue Doer Tasks',
  posPastDue: 'Released POs Past Due',
  payables: 'Payables Outstanding',
};
const DONUT_HIGHLIGHT = { OVERDUE: ['OVERDUE'], OPEN: ['OPEN'], PENDING: ['OPEN', 'OVERDUE'], COMPLETED: ['COMPLETED'] };
const STATUS_CHIP = { OVERDUE: ['danger', 'Delayed'], OPEN: ['info', 'In progress'], COMPLETED: ['ok', 'Completed'], CANCELLED: ['neutral', 'Cancelled'] };
const STATUS_OPTIONS = [
  { value: '', label: 'All status' },
  { value: 'OVERDUE', label: 'Delayed' },
  { value: 'OPEN', label: 'In progress' },
  { value: 'PENDING', label: 'Pending (all open)' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
const SOURCE_LABEL = {
  followUps: 'follow-ups', pis: 'PIs', grns: 'GRNs', qcs: 'incoming QC', invoices: 'vendor invoices', vouchers: 'vouchers',
  tallies: 'Tally entries', finals: 'final payments', services: 'service completions', rateChanges: 'rate-change requests',
};
// A tile whose figure comes from a list that could not be read shows "—".
const TILE_SOURCE = { advanceDue: 'pis', rateChange: 'rateChanges', payables: 'vouchers' };

// KPI strip: tiles in one row (no wrap, scrollbar hidden), ‹ › scroll it by
// one tile; each arrow is disabled at its end. Same strip on mobile.
const TILE_W = 210;
const TILE_GAP = 10;
const arrowSx = {
  flexShrink: 0, width: 30, height: 80, borderRadius: '10px', border: `1px solid ${T.border}`, bgcolor: '#fff', color: T.text,
  '&:hover': { bgcolor: T.surface2 }, '&.Mui-disabled': { opacity: 0.35 },
};
const TileStrip = ({ children }) => {
  const ref = useRef(null);
  const [ends, setEnds] = useState({ start: true, end: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEnds({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);
  const move = (dir) => ref.current?.scrollBy({ left: dir * (TILE_W + TILE_GAP), behavior: 'smooth' });
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <ButtonBase aria-label="Scroll tiles left" data-testid="kpi-strip-prev" disabled={ends.start} onClick={() => move(-1)} sx={arrowSx}>
        <ChevronLeft size={16} />
      </ButtonBase>
      <Box
        ref={ref}
        onScroll={measure}
        data-testid="kpi-strip"
        sx={{
          flex: 1, minWidth: 0, display: 'flex', flexWrap: 'nowrap', gap: `${TILE_GAP}px`, overflowX: 'auto', scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
          '& > *': { flex: `0 0 ${TILE_W}px`, scrollSnapAlign: 'start' },
        }}
      >
        {children}
      </Box>
      <ButtonBase aria-label="Scroll tiles right" data-testid="kpi-strip-next" disabled={ends.end} onClick={() => move(1)} sx={arrowSx}>
        <ChevronRight size={16} />
      </ButtonBase>
    </Box>
  );
};

const Code = ({ children }) => (
  <Box component="code" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12.5, color: T.text, mr: 0.75 }}>{children}</Box>
);

const PurchaseCompanyDashboard = ({ switcher, onDenied }) => {
  const { data, isLoading, isError, error, refetch } = useGetPurchaseDashboardDataQuery(undefined, {
    pollingInterval: 60000, skipPollingIfUnfocused: true, refetchOnMountOrArgChange: 30,
  });
  // "Now" moves with each refresh (every minute), so overdue stays right.
  const now = useMemo(() => (data ? clock() : 0), [data]);
  const board = useMemo(() => (data ? buildPurchaseBoard(data, now) : null), [data, now]);
  const rows = useMemo(() => board?.rows || [], [board]);

  const [f, setF] = useState(EMPTY_INDENT_FILTER);
  const [via, setVia] = useState('All indents');
  const [stg, setStg] = useState({ mode: 'pending', time: 'monthly', from: '', to: '', indent: '', vendor: '' });
  const [openRow, setOpenRow] = useState(null);
  const tableRef = useRef(null);

  const kpis = useMemo(() => purchaseKpis(rows, data, now), [rows, data, now]);
  const view = useMemo(() => filterIndents(rows, f), [rows, f]);
  const viewAnySku = useMemo(() => filterIndents(rows, f, { skipSku: true }), [rows, f]);
  const split = useMemo(() => indentSplit(view), [view]);
  const insights = useMemo(() => purchaseInsights(rows, view, kpis), [rows, view, kpis]);
  const bars = useMemo(() => purchaseStageBars(viewAnySku, stg, now), [viewAnySku, stg, now]);
  const upcoming = useMemo(() => upcomingOrders(view), [view]);
  const vendors = useMemo(() => vendorOptions(rows), [rows]);
  const deliveryEvents = useMemo(() => (data ? buildDeliveryEvents(data) : []), [data]);
  const indentsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const sno = useMemo(() => new Map(rows.map((r, i) => [r.id, i + 1])), [rows]);
  const stepOptions = useMemo(() => [
    { value: '', label: 'All stages' },
    ...(board?.steps || []).map((s) => ({ value: s.code, label: `${s.code} ${s.name}` })),
  ], [board]);

  // The company view was switched off while the page was open — fall back to "My tasks".
  const denied = isError && error?.status === 403;
  useEffect(() => { if (denied) onDenied?.(); }, [denied, onDenied]);
  if (denied) return null;

  // ── Filters (each scrolls down to the indents it picked) ──
  const scrollToList = () => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const apply = (next, label) => { setF(next); setVia(label); scrollToList(); };
  const reset = () => { setF(EMPTY_INDENT_FILTER); setVia('All indents'); };
  const toggleGroup = (g) => {
    const on = f.group === g && !f.kpi;
    apply({ ...f, group: on ? '' : g, kpi: '' }, on ? 'All indents' : GROUP_VIA[g]);
  };
  const selectKpi = (k) => {
    const on = f.kpi === k;
    apply({ ...f, kpi: on ? '' : k, group: '' }, on ? 'All indents' : KPI_VIA[k]);
  };
  const toggleSku = (sku) => {
    const on = f.sku === sku;
    const bar = bars.find((b) => b.key === sku);
    apply({ ...f, sku: on ? '' : sku, group: '' }, on ? 'All indents' : `Item ${bar?.name || sku}`);
  };
  // A calendar day narrows the page to the indents behind that day's shown
  // events (the calendar opens the day's list itself).
  const pickDay = (ts, dayEvents) => {
    const on = f.day === ts;
    setF({ ...f, day: on ? null : ts, dayIndents: on ? null : [...new Set(dayEvents.flatMap((e) => e.indentIds))] });
    setVia(on ? 'All indents' : `Items ${fmtDateShort(ts)}`);
  };

  const header = (
    <DashHeader title="Purchase" subtitle="Purchase FMS · whole company">
      {switcher}
    </DashHeader>
  );

  if (isLoading || (!data && !isError)) {
    return <DashPage>{header}<Box sx={{ display: 'grid', placeItems: 'center', py: 12 }}><CircularProgress /></Box></DashPage>;
  }
  if (isError) {
    return (
      <DashPage>
        {header}
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={refetch}>Try again</Button>}>
          The Purchase dashboard could not be loaded right now.
        </Alert>
      </DashPage>
    );
  }

  const missing = data.missing || [];
  const tile = (key, value) => (missing.includes(TILE_SOURCE[key]) ? '—' : value);

  const columns = [
    { key: 'sno', label: 'S.No.', width: 64, sortValue: (r) => sno.get(r.id), render: (r) => <Typography sx={{ fontSize: 13, color: T.muted }}>{sno.get(r.id)}</Typography>, csv: (r) => sno.get(r.id) },
    {
      key: 'indent', label: 'Indent', sortValue: (r) => r.indentNumber,
      render: (r) => (
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: T.text, whiteSpace: 'nowrap' }}>{r.indentNumber}</Typography>
          <Typography sx={{ fontSize: 12, color: T.text2 }}>{r.vendorName !== '—' ? r.vendorName : (r.department || '—')}</Typography>
        </Box>
      ),
      csv: (r) => r.indentNumber,
    },
    { key: 'vendor', label: 'Vendor', hidden: true, csv: (r) => r.vendorName },
    { key: 'pos', label: 'PO', hidden: true, csv: (r) => r.poNumbers.join(', ') },
    { key: 'received', label: 'Raised', sortValue: (r) => (r.receivedAt ? new Date(r.receivedAt).getTime() : null), render: (r) => fmtDateShort(r.receivedAt), csv: (r) => fmtDate(r.receivedAt) },
    {
      key: 'cur', label: 'Current step', sortValue: (r) => r.current?.code || null,
      render: (r) => (r.current
        ? <Box sx={{ whiteSpace: 'nowrap' }}><Code>{r.current.code}</Code>{r.current.name}</Box>
        : <Typography sx={{ fontSize: 13, color: T.muted }}>{r.group === 'COMPLETED' || r.group === 'CANCELLED' ? 'Closed' : '—'}</Typography>),
      csv: (r) => (r.current ? `${r.current.code} ${r.current.name}` : ''),
    },
    { key: 'owner', label: 'Owner', sortValue: (r) => r.current?.ownerName || null, render: (r) => <Person name={r.current?.ownerName} />, csv: (r) => r.current?.ownerName || '' },
    { key: 'prog', label: 'Progress', sortValue: (r) => r.progress, render: (r) => <ProgressCell pct={r.progress} />, csv: (r) => `${r.progress}%` },
    { key: 'value', label: 'Value', align: 'right', sortValue: (r) => r.value, render: (r) => fmtMoney(r.value), csv: (r) => Math.round(r.value) },
    {
      key: 'status', label: 'Status', sortValue: (r) => GROUP_LABEL[r.group],
      render: (r) => { const [tone, text] = STATUS_CHIP[r.group]; return <ToneChip tone={tone}>{text}</ToneChip>; },
      csv: (r) => GROUP_LABEL[r.group],
    },
  ];

  const delayRows = [
    { g: 'OVERDUE', title: `${split.overdue} delayed indents`, sub: 'past planned or delivery date', n: split.overdue },
    { g: 'OPEN', title: `${split.open} pending`, sub: 'open, within planned time', n: split.open },
    { g: 'COMPLETED', title: `${split.completed} completed`, sub: 'closed or finally paid', n: split.completed },
  ];

  return (
    <DashPage>
      {header}

      {missing.length > 0 && (
        <Alert severity="warning" sx={{ py: 0.25 }}>
          Some Purchase lists could not be read ({missing.map((k) => SOURCE_LABEL[k] || k).join(', ')}), so figures that need them show “—”.
        </Alert>
      )}

      {/* ── KPI tiles: one sideways strip, ‹ › move it one tile ── */}
      <TileStrip>
        <KpiTile tone="blue" icon={Layers} value={fmtNum(kpis.totalIndents)} label="Total Indents"
          active={via === 'Total Indents'} onClick={() => { setF(EMPTY_INDENT_FILTER); setVia('Total Indents'); scrollToList(); }} />
        <KpiTile tone="amber" icon={Hourglass} value={fmtNum(kpis.pendingApproval)} label="Pending Approval"
          active={f.kpi === 'pendingApproval'} onClick={() => selectKpi('pendingApproval')} />
        <KpiTile tone="green" icon={ClipboardList} value={fmtNum(kpis.quotePending)} label="Quote Pending"
          active={f.kpi === 'quotePending'} onClick={() => selectKpi('quotePending')} />
        <KpiTile tone="teal" icon={Truck} value={fmtNum(kpis.poReleased)} label="PO Released"
          active={f.kpi === 'poReleased'} onClick={() => selectKpi('poReleased')} />
        <KpiTile tone="orange" icon={PackageCheck} value={fmtNum(kpis.grnPending)} label="GRN Pending"
          active={f.kpi === 'grnPending'} onClick={() => selectKpi('grnPending')} />
        <KpiTile tone="red" icon={AlarmClock} value={fmtNum(kpis.delayed)} label="Delayed"
          active={f.group === 'OVERDUE'} onClick={() => toggleGroup('OVERDUE')} />
        <KpiTile tone="fuchsia" icon={CircleCheck} value={fmtNum(kpis.completed)} label="Completed"
          active={f.group === 'COMPLETED'} onClick={() => toggleGroup('COMPLETED')} />
        <KpiTile tone="violet" icon={Wallet} value={tile('advanceDue', fmtMoney(kpis.advanceDue))} label="Advance to Pay"
          active={f.kpi === 'advanceDue'} onClick={() => selectKpi('advanceDue')} />
        <KpiTile tone="blue" icon={Scale} value={tile('rateChange', fmtNum(kpis.pendingRateChanges))} label="Pending Rate Change"
          active={f.kpi === 'rateChange'} onClick={() => selectKpi('rateChange')} />
        <KpiTile tone="red" icon={TimerOff} value={fmtNum(kpis.overdueTasks)} label="Overdue Doer Tasks"
          active={f.kpi === 'overdueTasks'} onClick={() => selectKpi('overdueTasks')} />
        <KpiTile tone="orange" icon={Truck} value={fmtNum(kpis.posPastDue)} label="Released POs Past Due"
          active={f.kpi === 'posPastDue'} onClick={() => selectKpi('posPastDue')} />
        <KpiTile tone="amber" icon={BadgeIndianRupee} value={tile('payables', fmtMoney(kpis.payables))} label="Payables Outstanding"
          active={f.kpi === 'payables'} onClick={() => selectKpi('payables')} />
      </TileStrip>

      {/* ── Delay analytics | Stage analysis ── */}
      <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: '1fr', [WIDE]: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr)' } }}>
        <DashCard title="Delay analytics">
          {(big) => (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, justifyContent: 'space-between' }}>
              <Box sx={{ display: 'grid', gap: 1, alignItems: 'center', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0,1.05fr) minmax(0,1fr)' } }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {delayRows.map((d) => (
                    <SplitRow
                      key={d.g}
                      big={big}
                      color={GROUP_COLOR[d.g]}
                      title={d.title}
                      sub={d.sub}
                      share={`${pctOf(d.n, split.live)}% of live indents`}
                      active={f.group === d.g}
                      onClick={() => toggleGroup(d.g)}
                    />
                  ))}
                </Box>
                <Donut
                  size={big ? 300 : 190}
                  centerLabel="Delayed"
                  centerValue={`${pctOf(split.overdue, split.live)}%`}
                  highlight={DONUT_HIGHLIGHT[f.group]}
                  onSegment={toggleGroup}
                  segments={['OPEN', 'OVERDUE', 'COMPLETED'].map((g) => ({
                    key: g, label: GROUP_LABEL[g], color: GROUP_COLOR[g],
                    value: g === 'OPEN' ? split.open : g === 'OVERDUE' ? split.overdue : split.completed,
                  }))}
                />
              </Box>
              <Insights
                big={big}
                lines={split.live ? insights : [rows.length
                  ? 'No live indents in this view, so there is nothing to split. Clear the filter or pick another tile.'
                  : 'No purchase indents have been raised yet.']}
              />
            </Box>
          )}
        </DashCard>

        <DashCard
          title="Stage analysis"
          actions={(
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', justifyContent: 'flex-end', ml: 'auto' }}>
              <MiniSelect label="Measure" value={stg.mode} onChange={(v) => setStg((s) => ({ ...s, mode: v }))} options={PURCHASE_STAGE_MODES} />
              <MiniSelect label="Time" value={stg.time} onChange={(v) => setStg((s) => ({ ...s, time: v }))} options={STAGE_TIMES} />
              {stg.time === 'custom' && (
                <>
                  <MiniDate label="From" value={stg.from} onChange={(v) => setStg((s) => ({ ...s, from: v }))} />
                  <MiniDate label="To" value={stg.to} onChange={(v) => setStg((s) => ({ ...s, to: v }))} />
                </>
              )}
              <MiniSelect
                label="Indent"
                value={stg.indent}
                // One indent's history rarely fits in a month: picking it shows all of it.
                onChange={(v) => setStg((s) => ({ ...s, indent: v, time: v ? 'all' : s.time }))}
                options={[{ value: '', label: 'All indents' }, ...rows.map((r) => ({ value: r.id, label: r.indentNumber }))]}
                sx={{ maxWidth: 150 }}
              />
              <MiniSelect
                label="Vendor"
                value={stg.vendor}
                onChange={(v) => setStg((s) => ({ ...s, vendor: v }))}
                options={[{ value: '', label: 'All vendors' }, ...vendors]}
                sx={{ maxWidth: 150 }}
              />
            </Box>
          )}
        >
          {(big) => (
            <Bars
              bars={bars}
              colors={SKU_COLORS}
              height={big ? '46vh' : 330}
              selected={f.sku}
              onSelect={toggleSku}
              emptyText={purchaseStageEmptyText(stg, view.length > 0)}
            />
          )}
        </DashCard>
      </Box>

      {/* ── Quick Overview | Item Delivery Calendar ── */}
      {/* The calendar sets the row's height; Quick Overview matches it and scrolls. */}
      <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: '1fr', [WIDE]: { gridTemplateColumns: '1fr 1fr' } }}>
        <DashCard title="Quick Overview" sx={{ [WIDE]: { contain: 'size' } }}>
          {(big) => (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0, flex: 1 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, minmax(0,1fr))' }, gap: 0.75 }}>
                <StatBox big={big} label="Total" value={kpis.totalIndents} bg={STAT_BG.blue} active={!f.group && !f.kpi && via === 'All indents'} onClick={reset} />
                <StatBox big={big} label="Completed" value={kpis.completed} bg={STAT_BG.green} active={f.group === 'COMPLETED'} onClick={() => toggleGroup('COMPLETED')} />
                <StatBox big={big} label="Delayed" value={kpis.delayed} bg={STAT_BG.pink} active={f.group === 'OVERDUE'} onClick={() => toggleGroup('OVERDUE')} />
                <StatBox big={big} label="Cancelled" value={kpis.cancelled} bg={STAT_BG.grey} active={f.group === 'CANCELLED'} onClick={() => toggleGroup('CANCELLED')} />
              </Box>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.25, ...(big ? {} : { maxHeight: 320, [WIDE]: { maxHeight: 'none' } }) }}>
                {upcoming.length ? upcoming.map((r) => (
                  <OverviewItem
                    key={r.id}
                    big={big}
                    date={fmtDateShort(r.current.plannedAt || r.receivedAt)}
                    person={r.current.ownerName}
                    title={r.vendorName !== '—' ? r.vendorName : (r.department || r.indentNumber)}
                    sub={`${r.current.code} ${r.current.name} · ${r.indentNumber}`}
                    overdue={r.group === 'OVERDUE'}
                    onClick={() => setOpenRow(r)}
                  />
                )) : <Typography sx={{ fontSize: 12.5, color: T.muted, p: 1 }}>No open indents in this view.</Typography>}
              </Box>
            </Box>
          )}
        </DashCard>

        <ItemDeliveryCalendar events={deliveryEvents} selectedDay={f.day} onPickDay={pickDay} onOpenIndent={setOpenRow} indentsById={indentsById} />
      </Box>

      {/* ── All indents ── */}
      <Box ref={tableRef} sx={{ scrollMarginTop: 12 }}>
        <DashCard
          title="All indents"
          expandable={false}
          actions={(
            <FilterBar chip={`${via} · ${view.length} indents`} onClear={reset}>
              <MiniSelect
                label="Status"
                value={STATUS_OPTIONS.some((o) => o.value === f.group) ? f.group : ''}
                onChange={(v) => { setF({ ...f, group: v, kpi: '' }); setVia(v ? GROUP_VIA[v] : 'All indents'); }}
                options={STATUS_OPTIONS}
              />
              <MiniSelect
                label="Stage"
                value={f.step}
                onChange={(v) => { setF({ ...f, step: v, group: '' }); setVia(v ? `Stage ${v}` : 'All indents'); }}
                options={stepOptions}
              />
            </FilterBar>
          )}
        >
          <DashTable
            columns={columns.filter((c) => !c.hidden)}
            csvColumns={columns}
            rows={view}
            rowKey={(r) => r.id}
            onRowClick={setOpenRow}
            searchText={(r) => `${r.indentNumber} ${r.vendorName} ${r.poNumbers.join(' ')} ${r.department}`}
            searchPlaceholder="Search indent, vendor or PO…"
            exportName="purchase-indents"
            defaultSort={{ key: 'received', dir: 'desc' }}
            resetKey={JSON.stringify(f)}
            emptyText="No indents in this view."
          />
        </DashCard>
      </Box>

      <IndentDrawer row={openRow} now={now} onClose={() => setOpenRow(null)} />
    </DashPage>
  );
};

export default PurchaseCompanyDashboard;
