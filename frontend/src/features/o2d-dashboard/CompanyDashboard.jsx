/**
 * O2D Dashboard — company view (MD, or anyone the MD switches it on for).
 *
 * The client's design (ui html/O2D-V2-Dashboard), on live orders: KPI tiles,
 * Delay analytics, Stage analysis, Quick Overview, Dispatch calendar and the
 * orders table. Every panel narrows the same view — a tile, a donut slice, a
 * bar or a calendar day filters the whole page, and "Show all orders" clears it.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { AlarmClock, CircleCheck, ClipboardList, Hourglass, Layers, Truck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGetO2dDashboardOrdersQuery } from '../../store/api/o2dFmsApi';
import DispatchCalendar from '../planning/DispatchCalendar';
import {
  clock, companyInsights, companyKpis, delaySplit, EMPTY_ORDER_FILTER, filterOrders, fromDayKey, orderLabel, toDayKey,
  partyOptions, pctOf, STAGE_MODES, STAGE_TIMES, stageBars, stageEmptyText, todayChallans, upcomingOrders,
} from './dashboardModel';
import { GROUP_COLOR, GROUP_LABEL, SKU_COLORS, STAT_BG, T, WIDE } from './dashTheme';
import { fmtDate, fmtDateShort, fmtMoney, fmtNum } from './format';
import {
  Bars, DashCard, DashHeader, DashPage, Donut, FilterBar, GhostButton, Insights, KpiTile, MiniDate, MiniSelect,
  OverviewItem, Person, ProgressCell, SplitRow, StatBox, ToneChip,
} from './components/DashUi';
import { CalendarNav } from './components/MonthCalendar';
import DashTable from './components/DashTable';
import { OrderDrawer } from './components/Drawers';

const GROUP_VIA = { OVERDUE: 'Delayed', OPEN: 'In progress', PENDING: 'Pending Sales Order', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
const KPI_VIA = { challan: 'Today Delivery Challan', dispatchToday: 'Dispatch Today (qty)', dispatched: 'Dispatched (qty)' };
// Opened from a tile on the Delegation Suite's Dashboard (?show=…): start on that tile's view.
const SHOW = {
  sales: [{}, 'Sales Order'],
  pending: [{ group: 'PENDING' }, GROUP_VIA.PENDING],
  challan: [{ kpi: 'challan' }, KPI_VIA.challan],
  dispatchToday: [{ kpi: 'dispatchToday' }, KPI_VIA.dispatchToday],
  dispatched: [{ kpi: 'dispatched' }, KPI_VIA.dispatched],
  delayed: [{ group: 'OVERDUE' }, GROUP_VIA.OVERDUE],
  completed: [{ group: 'COMPLETED' }, GROUP_VIA.COMPLETED],
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

const Code = ({ children }) => (
  <Box component="code" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12.5, color: T.text, mr: 0.75 }}>{children}</Box>
);

const CompanyDashboard = ({ switcher, onDenied }) => {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useGetO2dDashboardOrdersQuery(undefined, {
    pollingInterval: 60000, skipPollingIfUnfocused: true, refetchOnMountOrArgChange: 30,
  });
  const board = data?.data;
  const orders = useMemo(() => board?.orders || [], [board]);
  // "Now" moves with each refresh (every minute), so overdue and today stay right.
  const now = useMemo(() => (board ? clock() : 0), [board]);

  const [searchParams] = useSearchParams();
  const [f, setF] = useState(() => ({ ...EMPTY_ORDER_FILTER, ...(SHOW[searchParams.get('show')]?.[0] || {}) }));
  const [via, setVia] = useState(() => SHOW[searchParams.get('show')]?.[1] || 'All orders');
  const [stg, setStg] = useState({ mode: 'pending', time: 'monthly', from: '', to: '', so: '', party: '' });
  const [month, setMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const [openRow, setOpenRow] = useState(null);
  const tableRef = useRef(null);

  const today = useMemo(() => todayChallans(board?.challans, orders, now), [board, orders, now]);
  const kpis = useMemo(() => companyKpis(orders, today), [orders, today]);
  const view = useMemo(() => filterOrders(orders, f, today), [orders, f, today]);
  const viewAnySku = useMemo(() => filterOrders(orders, f, today, { skipSku: true }), [orders, f, today]);
  const split = useMemo(() => delaySplit(view), [view]);
  const insights = useMemo(() => companyInsights(orders, view), [orders, view]);
  const bars = useMemo(() => stageBars(viewAnySku, stg, now), [viewAnySku, stg, now]);
  const upcoming = useMemo(() => upcomingOrders(view), [view]);
  const parties = useMemo(() => partyOptions(orders), [orders]);
  const sno = useMemo(() => new Map(orders.map((r, i) => [r.id, i + 1])), [orders]);
  const stepOptions = useMemo(() => [
    { value: '', label: 'All stages' },
    ...(board?.steps || []).map((s) => ({ value: s.code, label: `${s.code} ${s.name}` })),
  ], [board]);

  // The full view was switched off while the page was open — fall back to "My tasks".
  const denied = isError && error?.status === 403;
  useEffect(() => { if (denied) onDenied?.(); }, [denied, onDenied]);
  if (denied) return null;

  // ── Filters (each scrolls down to the orders it picked) ──
  const scrollToList = () => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const apply = (next, label) => { setF(next); setVia(label); scrollToList(); };
  const reset = () => { setF(EMPTY_ORDER_FILTER); setVia('All orders'); };
  const toggleGroup = (g) => {
    const on = f.group === g && !f.kpi;
    apply({ ...f, group: on ? '' : g, kpi: '' }, on ? 'All orders' : GROUP_VIA[g]);
  };
  const selectKpi = (k) => {
    const on = f.kpi === k;
    apply({ ...f, kpi: on ? '' : k, group: '' }, on ? 'All orders' : KPI_VIA[k]);
  };
  const toggleSku = (sku) => {
    const on = f.sku === sku;
    const bar = bars.find((b) => b.key === sku);
    apply({ ...f, sku: on ? '' : sku, group: '' }, on ? 'All orders' : `SKU ${bar?.name || sku}`);
  };
  // A day opened in the calendar (its own dialog shows the plan) also narrows
  // the page to the orders with a dispatch planned that day.
  const pickDay = (dateKey) => {
    const ts = fromDayKey(dateKey);
    setF({ ...f, day: ts });
    setVia(fmtDateShort(ts));
  };
  const openFullCalendar = () => navigate(`/dispatch-planning/calendar?month=${toDayKey(new Date(month.year, month.month, 1)).slice(0, 7)}`);

  if (isLoading || (!board && !isError)) {
    return (
      <DashPage>
        <DashHeader title="O2D" subtitle="Order to Dispatch · whole company">{switcher}</DashHeader>
        <Box sx={{ display: 'grid', placeItems: 'center', py: 12 }}><CircularProgress /></Box>
      </DashPage>
    );
  }
  if (isError) {
    return (
      <DashPage>
        <DashHeader title="O2D" subtitle="Order to Dispatch · whole company">{switcher}</DashHeader>
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={refetch}>Try again</Button>}>
          The O2D dashboard could not be loaded right now.
        </Alert>
      </DashPage>
    );
  }

  const columns = [
    { key: 'sno', label: 'S.No.', width: 64, sortValue: (r) => sno.get(r.id), render: (r) => <Typography sx={{ fontSize: 13, color: T.muted }}>{sno.get(r.id)}</Typography>, csv: (r) => sno.get(r.id) },
    {
      key: 'order', label: 'Order', sortValue: (r) => r.soNumber || '',
      render: (r) => (
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: T.text, whiteSpace: 'nowrap' }}>{orderLabel(r)}</Typography>
          <Typography sx={{ fontSize: 12, color: T.text2 }}>{r.partyName}</Typography>
        </Box>
      ),
      csv: (r) => orderLabel(r),
    },
    { key: 'party', label: 'Party', hidden: true, csv: (r) => r.partyName },
    { key: 'received', label: 'Received', sortValue: (r) => (r.receivedAt ? new Date(r.receivedAt).getTime() : null), render: (r) => fmtDateShort(r.receivedAt), csv: (r) => fmtDate(r.receivedAt) },
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
  const shownColumns = columns.filter((c) => !c.hidden);
  const csvColumns = columns; // the CSV also gets the party in its own column

  const delayRows = [
    { g: 'OVERDUE', title: `${split.overdue} delayed orders`, sub: 'past planned time', n: split.overdue },
    { g: 'OPEN', title: `${split.open} pending`, sub: 'open, within planned time', n: split.open },
    { g: 'COMPLETED', title: `${split.completed} completed`, sub: 'all steps closed', n: split.completed },
  ];

  return (
    <DashPage>
      <DashHeader title="O2D" subtitle="Order to Dispatch · whole company">
        {switcher}
        <GhostButton onClick={reset}>Show all orders</GhostButton>
      </DashHeader>

      {/* ── KPI tiles ── */}
      <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', sm: 'repeat(3, minmax(0,1fr))' }, [WIDE]: { gridTemplateColumns: 'repeat(7, minmax(0,1fr))' } }}>
        <KpiTile tone="blue" icon={Layers} value={fmtNum(kpis.salesOrders)} label="Sales Order"
          active={via === 'Sales Order'} onClick={() => { setF(EMPTY_ORDER_FILTER); setVia('Sales Order'); scrollToList(); }} />
        <KpiTile tone="amber" icon={Hourglass} value={fmtNum(kpis.pending)} label="Pending Sales Order"
          active={f.group === 'PENDING'} onClick={() => toggleGroup('PENDING')} />
        <KpiTile tone="green" icon={ClipboardList} value={fmtNum(kpis.challansToday)} label="Today Delivery Challan"
          active={f.kpi === 'challan'} onClick={() => selectKpi('challan')} />
        <KpiTile tone="teal" icon={Truck} value={fmtNum(kpis.dispatchToday)} label="Dispatch Today (qty)"
          active={f.kpi === 'dispatchToday'} onClick={() => selectKpi('dispatchToday')} />
        <KpiTile tone="orange" icon={Truck} value={fmtNum(kpis.dispatched)} label="Dispatched (qty)"
          active={f.kpi === 'dispatched'} onClick={() => selectKpi('dispatched')} />
        <KpiTile tone="red" icon={AlarmClock} value={fmtNum(kpis.delayed)} label="Delayed"
          active={f.group === 'OVERDUE'} onClick={() => toggleGroup('OVERDUE')} />
        <KpiTile tone="fuchsia" icon={CircleCheck} value={fmtNum(kpis.completed)} label="Completed"
          active={f.group === 'COMPLETED'} onClick={() => toggleGroup('COMPLETED')} />
      </Box>

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
                      share={`${pctOf(d.n, split.live)}% of live orders`}
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
              <Insights lines={insights} big={big} />
            </Box>
          )}
        </DashCard>

        <DashCard
          title="Stage analysis"
          actions={(
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', justifyContent: 'flex-end', ml: 'auto' }}>
              <MiniSelect label="Measure" value={stg.mode} onChange={(v) => setStg((s) => ({ ...s, mode: v }))} options={STAGE_MODES} />
              <MiniSelect label="Time" value={stg.time} onChange={(v) => setStg((s) => ({ ...s, time: v }))} options={STAGE_TIMES} />
              {stg.time === 'custom' && (
                <>
                  <MiniDate label="From" value={stg.from} onChange={(v) => setStg((s) => ({ ...s, from: v }))} />
                  <MiniDate label="To" value={stg.to} onChange={(v) => setStg((s) => ({ ...s, to: v }))} />
                </>
              )}
              <MiniSelect
                label="Sales order"
                value={stg.so}
                // One order's history rarely fits in a month: picking it shows all of it.
                onChange={(v) => setStg((s) => ({ ...s, so: v, time: v ? 'all' : s.time }))}
                options={[{ value: '', label: 'All sales orders' }, ...orders.filter((r) => r.soNumber).map((r) => ({ value: r.id, label: r.soNumber }))]}
                sx={{ maxWidth: 150 }}
              />
              <MiniSelect
                label="Party"
                value={stg.party}
                onChange={(v) => setStg((s) => ({ ...s, party: v }))}
                options={[{ value: '', label: 'All parties' }, ...parties]}
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
              emptyText={stageEmptyText(stg, view.length > 0)}
            />
          )}
        </DashCard>
      </Box>

      {/* ── Quick Overview | Dispatch calendar ── */}
      {/* The calendar sets the row's height; Quick Overview matches it and scrolls. */}
      <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: '1fr', [WIDE]: { gridTemplateColumns: '1fr 1fr' } }}>
        <DashCard title="Quick Overview" sx={{ [WIDE]: { contain: 'size' } }}>
          {(big) => (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0, flex: 1 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, minmax(0,1fr))' }, gap: 0.75 }}>
                <StatBox big={big} label="Total" value={kpis.salesOrders} bg={STAT_BG.blue} active={!f.group && !f.kpi && via === 'All orders'} onClick={reset} />
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
                    title={r.partyName}
                    sub={`${r.current.code} ${r.current.name}${r.soNumber ? ` · ${r.soNumber}` : ''}`}
                    overdue={r.group === 'OVERDUE'}
                    onClick={() => setOpenRow(r)}
                  />
                )) : <Typography sx={{ fontSize: 12.5, color: T.muted, p: 1 }}>No open orders in this view.</Typography>}
              </Box>
            </Box>
          )}
        </DashCard>

        {/* The Planning → Dispatch Calendar itself; ⤢ opens that page on this month. */}
        <DashCard
          title="Dispatch calendar"
          sx={{ [WIDE]: { minHeight: 486 } }}
          actions={<CalendarNav value={month} onChange={setMonth} />}
          onExpand={openFullCalendar}
          expandLabel="Open Dispatch Calendar"
        >
          {() => (
            <Box>
              <DispatchCalendar
                compact
                month={month}
                selectedDate={f.day != null ? toDayKey(f.day) : null}
                onDayClick={pickDay}
              />
            </Box>
          )}
        </DashCard>
      </Box>

      {/* ── All orders ── */}
      <Box ref={tableRef} sx={{ scrollMarginTop: 12 }}>
        <DashCard
          title="All orders"
          expandable={false}
          actions={(
            <FilterBar chip={`${via} · ${view.length} orders`} onClear={reset}>
              <MiniSelect
                label="Status"
                value={STATUS_OPTIONS.some((o) => o.value === f.group) ? f.group : ''}
                onChange={(v) => { setF({ ...f, group: v, kpi: '' }); setVia(v ? GROUP_VIA[v] : 'All orders'); }}
                options={STATUS_OPTIONS}
              />
              <MiniSelect
                label="Stage"
                value={f.step}
                onChange={(v) => { setF({ ...f, step: v, group: '' }); setVia(v ? `Stage ${v}` : 'All orders'); }}
                options={stepOptions}
              />
            </FilterBar>
          )}
        >
          <DashTable
            columns={shownColumns}
            csvColumns={csvColumns}
            rows={view}
            rowKey={(r) => r.id}
            onRowClick={setOpenRow}
            searchText={(r) => `${r.soNumber || ''} ${r.partyName || ''} ${r.poNumber || ''}`}
            searchPlaceholder="Search order, party or PO…"
            exportName="o2d-orders"
            defaultSort={{ key: 'received', dir: 'desc' }}
            resetKey={JSON.stringify(f)}
            emptyText="No orders in this view."
          />
        </DashCard>
      </Box>

      <OrderDrawer row={openRow} onClose={() => setOpenRow(null)} />
    </DashPage>
  );
};

export default CompanyDashboard;
