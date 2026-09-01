import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Box, Grid, LinearProgress, Paper, Skeleton, Typography, alpha,
  Button, Chip, Stack, IconButton, Avatar, Tooltip,
} from '@mui/material';
import {
  AlertTriangle, CalendarClock, ClipboardList, PackageCheck, ShoppingCart,
  XCircle, ChevronRight, ChevronLeft, TrendingUp, Activity, Boxes, Clock, Radar,
  ShoppingBag, Truck, FileText, Wallet, IndianRupee, ClipboardCheck, Factory,
  ReceiptText, BadgeCheck, Pause, Play, Layers,
} from 'lucide-react';
import {
  Bar, BarChart, ComposedChart, Line, CartesianGrid, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis, Cell, LabelList,
} from 'recharts';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useNavigate } from 'react-router-dom';
import { useGetDispatchDashboardQuery, useGetChallansQuery } from '../../store/api/dispatchControlApi';
import { useGetOrderStatsQuery, useGetOrdersQuery } from '../../store/api/orderApi';
import {
  useGetIndentStatsQuery, useGetPurchaseOrderStatsQuery, useGetFollowUpStatsQuery,
  useGetProformaInvoiceStatsQuery, useGetAdvancePaymentStatsQuery, useGetGrnStatsQuery,
  useGetIncomingQcStatsQuery, useGetVendorInvoiceStatsQuery, useGetVoucherStatsQuery,
  useGetFinalPaymentStatsQuery, useGetPurchaseOrdersQuery, useGetGrnsQuery,
} from '../../store/api/procurementApi';

dayjs.extend(relativeTime);

// ─── Premium blue palette ──────────────────────────────────────────────────
// Neutrals follow the client's WARM palette (o2dTheme); the status hues stay
// saturated so they still pop against it.
const C = {
  ink: '#1c1e21', body: '#3f4650', primary: '#1d4ed8', primaryDk: '#1e3a8a',
  primaryLt: '#3b82f6', success: '#0f766e', successLt: '#5eead4',
  warning: '#b45309', warningLt: '#fcd34d', error: '#be123c', errorLt: '#fda4af',
  info: '#0369a1', indigo: '#5b6cff', slate: '#6b7280', faint: '#9ca3af',
  line: '#e4e1d9', lineSoft: '#eeebe4', surface: '#ffffff', surfaceAlt: '#f7f6f2',
  canvas: '#e9e7e1',
};

const fmt = (v) => Number(v || 0).toLocaleString('en-IN');

// Indian-style compact money: ₹1.24 Cr / ₹3.40 L / ₹12.0 K / ₹500
const inr = (v) => {
  const n = Number(v || 0);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`;
  return `₹${fmt(n)}`;
};

// Order lifecycle stages, in flow order — drives the pipeline chart.
const STATUS_META = {
  RECEIVED:     { label: 'Received',     color: C.warning },
  PLANNING:     { label: 'Planning',     color: C.indigo },
  IN_PROGRESS:  { label: 'In Progress',  color: C.primary },
  COMPLETED:    { label: 'Completed',    color: C.success },
  SHORT_CLOSED: { label: 'Short Closed', color: C.slate },
  CANCELLED:    { label: 'Cancelled',    color: C.error },
};

// ─── Compact KPI card — 6 fit in a single row on desktop ────────────────────
const KpiCard = ({ title, value, sub, icon: Icon, color, loading, onClick }) => (
  <Paper
    onClick={onClick}
    sx={{
      p: 1.4, borderRadius: '8px', height: '100%',
      border: `1px solid ${C.line}`,
      bgcolor: C.surface,
      cursor: onClick ? 'pointer' : 'default',
      transition: 'transform .16s ease, box-shadow .16s ease, border-color .16s ease',
      position: 'relative', overflow: 'hidden',
      '&::before': {
        content: '""', position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(circle at top right, ${alpha(color, 0.07)} 0%, transparent 62%)`,
      },
      '&:hover': onClick ? {
        transform: 'translateY(-3px)', borderColor: alpha(color, 0.45),
        boxShadow: `0 12px 26px ${alpha(color, 0.16)}`,
      } : {},
    }}
  >
    <Stack direction="row" alignItems="center" spacing={1} sx={{ position: 'relative', mb: 0.9 }}>
      <Box sx={{
        width: 32, height: 32, borderRadius: 2, flexShrink: 0,
        display: 'grid', placeItems: 'center',
        bgcolor: alpha(color, 0.1), color, border: `1px solid ${alpha(color, 0.18)}`,
      }}>
        <Icon size={16} strokeWidth={2.3} />
      </Box>
      <Typography sx={{
        fontSize: '0.62rem', fontWeight: 800, color: C.slate,
        textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1.15,
      }}>
        {title}
      </Typography>
    </Stack>
    {loading ? (
      <Skeleton width="70%" height={30} />
    ) : (
      <Typography sx={{ position: 'relative', fontSize: '1.5rem', fontWeight: 800, color: C.ink, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
        {value}
      </Typography>
    )}
    {sub && !loading && (
      <Typography sx={{ position: 'relative', fontSize: '0.66rem', fontWeight: 600, color: C.faint, mt: 0.2 }}>
        {sub}
      </Typography>
    )}
  </Paper>
);

const Section = ({ children, sx, ...rest }) => (
  <Paper {...rest} sx={{
    p: 1.75, borderRadius: '8px', border: `1px solid ${C.line}`,
    bgcolor: C.surface, boxShadow: '0 1px 2px rgba(30,58,138,0.04)', ...sx,
  }}>
    {children}
  </Paper>
);

const SectionHeader = ({ title, subtitle, right }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.75 }}>
    <Box>
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: C.ink, letterSpacing: '-0.01em' }}>{title}</Typography>
      {subtitle && <Typography sx={{ fontSize: '0.74rem', color: C.slate, fontWeight: 500, mt: 0.2 }}>{subtitle}</Typography>}
    </Box>
    {right}
  </Box>
);

export default function Dashboard() {
  const navigate = useNavigate();

  // ── Orders & Dispatch ──────────────────────────────────────
  const { data, isLoading } = useGetDispatchDashboardQuery();
  const { data: statsRes } = useGetOrderStatsQuery();

  // ── Recent activity feeds (small, sorted desc) ─────────────
  const { data: recentOrders } = useGetOrdersQuery({ limit: 6, sort: '-createdAt' });
  const { data: recentChallans } = useGetChallansQuery({ limit: 6, sort: '-createdAt' });
  const { data: recentPos } = useGetPurchaseOrdersQuery({ limit: 6, sort: '-createdAt' });
  const { data: recentGrns } = useGetGrnsQuery({ limit: 6, sort: '-createdAt' });

  // ── Purchase FMS stats ─────────────────────────────────────
  const { data: indentS, isLoading: lIndent } = useGetIndentStatsQuery();
  const { data: poS, isLoading: lPo } = useGetPurchaseOrderStatsQuery();
  const { data: followS } = useGetFollowUpStatsQuery();
  const { data: piS } = useGetProformaInvoiceStatsQuery();
  const { data: advS } = useGetAdvancePaymentStatsQuery();
  const { data: grnS } = useGetGrnStatsQuery();
  const { data: qcS } = useGetIncomingQcStatsQuery();
  const { data: viS, isLoading: lVi } = useGetVendorInvoiceStatsQuery();
  const { data: vouS } = useGetVoucherStatsQuery();
  const { data: fpS } = useGetFinalPaymentStatsQuery();

  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);

  // Rotating KPI set state.
  const [setIndex, setSetIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const dashboard = data?.data || {};
  const summary = dashboard.summary || {};
  const planHealth = dashboard.planHealth || {};
  const monthlyTrend = dashboard.monthlyTrend || [];
  const clientRisk = dashboard.clientBalanceRisk || [];
  const upcomingDispatches = dashboard.upcomingDispatches || [];
  const byStatus = statsRes?.data?.byStatus || [];

  // Purchase stat objects (unwrap ApiResponse).
  const indent = indentS?.data || {};
  const po = poS?.data || {};
  const follow = followS?.data || {};
  const pi = piS?.data || {};
  const adv = advS?.data || {};
  const grn = grnS?.data || {};
  const qc = qcS?.data || {};
  const vi = viS?.data || {};
  const vou = vouS?.data || {};
  const fp = fpS?.data || {};

  const fulfilPct = summary.fulfillmentPct || 0;

  // Plan-achievement % across all months (weighted by planned qty).
  const planTotals = useMemo(() => monthlyTrend.reduce((a, m) => {
    a.planned += Number(m.plannedQty || 0);
    a.actual += Number(m.actualQty || 0);
    return a;
  }, { planned: 0, actual: 0 }), [monthlyTrend]);
  const planAchievementPct = planTotals.planned > 0
    ? Math.round((planTotals.actual / planTotals.planned) * 100) : 0;

  const challanCount = recentChallans?.meta?.total ?? (recentChallans?.data?.length || 0);

  const filteredUpcoming = useMemo(() => {
    let f = upcomingDispatches;
    if (selectedMonth) f = f.filter((d) => dayjs(d.plannedDate).format('YYYY-MM') === selectedMonth);
    if (selectedClient) f = f.filter((d) => d.partyName === selectedClient);
    return f;
  }, [upcomingDispatches, selectedMonth, selectedClient]);

  // Orders grouped by lifecycle stage — for the pipeline chart.
  const statusData = useMemo(() => (
    Object.keys(STATUS_META)
      .map((k) => {
        const r = byStatus.find((x) => x._id === k);
        return {
          key: k, label: STATUS_META[k].label, color: STATUS_META[k].color,
          count: r?.count || 0, qty: r?.totalOrderQty || 0,
        };
      })
      .filter((d) => d.count > 0)
  ), [byStatus]);

  // Procurement funnel: how many docs sit at each stage of Purchase FMS.
  const funnelData = useMemo(() => ([
    { stage: 'Indents',         value: indent.total || 0, color: C.warning },
    { stage: 'Purchase Orders', value: po.total || 0, color: C.indigo },
    { stage: 'GRNs',            value: grn.total || 0, color: C.primary },
    { stage: 'QC Done',         value: qc.total || 0, color: C.info },
    { stage: 'Vendor Invoices', value: vi.total || 0, color: C.body },
    { stage: 'Payments',        value: fp.total || 0, color: C.success },
  ]), [indent.total, po.total, grn.total, qc.total, vi.total, fp.total]);

  // Money snapshot (₹) across purchase.
  const moneyData = useMemo(() => ([
    { name: 'PO Value',     value: po.totalValue || 0, color: C.indigo },
    { name: 'PI Value',     value: pi.totalValue || 0, color: C.primary },
    { name: 'Advance Paid', value: adv.paidAmount || 0, color: C.info },
    { name: 'Net Payable',  value: vi.netPayable || 0, color: C.warning },
    { name: 'Outstanding',  value: vou.outstanding || 0, color: C.error },
    { name: 'Final Paid',   value: fp.paidAmount || 0, color: C.success },
  ]), [po.totalValue, pi.totalValue, adv.paidAmount, vi.netPayable, vou.outstanding, fp.paidAmount]);

  // ── Rotating KPI sets — each is a "page" of 6 live cards ────
  const statSets = useMemo(() => ([
    {
      id: 'sales', title: 'Sales Orders', accent: C.primary, loading: isLoading,
      cards: [
        { title: 'Total Orders', value: fmt(summary.totalOrders), sub: `${fmt(summary.completedOrders)} completed`, icon: ShoppingCart, color: C.primary, to: '/orders' },
        { title: 'Open Orders', value: fmt(summary.openOrders), sub: 'in progress', icon: ClipboardList, color: C.info, to: '/dispatch-control-tower' },
        { title: 'Order Volume', value: fmt(summary.totalOrderQty), sub: 'pcs ordered', icon: Boxes, color: C.indigo },
        { title: 'Dispatched', value: fmt(summary.totalDispatchedQty), sub: `${fulfilPct}% fulfilled`, icon: PackageCheck, color: C.success, to: '/challans' },
        { title: 'Pending Qty', value: fmt(summary.totalBalanceQty), sub: `${clientRisk.length} clients`, icon: Clock, color: C.warning },
        { title: 'Fulfilment', value: `${fulfilPct}%`, sub: 'order completion', icon: TrendingUp, color: C.success },
      ],
    },
    {
      id: 'dispatch', title: 'Dispatch & Planning', accent: C.indigo, loading: isLoading,
      cards: [
        { title: 'Overdue Phases', value: fmt(planHealth.overduePlanCount), sub: 'past planned date', icon: AlertTriangle, color: C.error, to: '/dispatch-control-tower' },
        { title: 'Overdue Qty', value: fmt(planHealth.overduePlanQty), sub: 'pcs behind plan', icon: Clock, color: C.error },
        { title: 'Upcoming (7d)', value: fmt(upcomingDispatches.length), sub: 'phases due soon', icon: CalendarClock, color: C.warning },
        { title: 'Plan Achievement', value: `${planAchievementPct}%`, sub: 'dispatched vs planned', icon: TrendingUp, color: C.success },
        { title: 'Challans Issued', value: fmt(challanCount), sub: 'delivery challans', icon: Truck, color: C.primary, to: '/challans' },
        { title: 'At-Risk Clients', value: fmt(clientRisk.length), sub: 'pending balance', icon: Activity, color: C.indigo },
      ],
    },
    {
      id: 'purchase', title: 'Purchase Pipeline', accent: C.warning, loading: lIndent || lPo,
      cards: [
        { title: 'Indents', value: fmt(indent.total), sub: `${fmt(indent.pendingApproval)} pending`, icon: ClipboardList, color: C.warning },
        { title: 'Purchase Orders', value: fmt(po.total), sub: `${fmt(po.released)} released`, icon: ShoppingBag, color: C.indigo },
        { title: 'PO Value', value: inr(po.totalValue), sub: 'ordered value', icon: IndianRupee, color: C.primary },
        { title: 'Follow-ups', value: fmt(follow.pending), sub: `${fmt(follow.delayed)} delayed`, icon: Radar, color: C.error },
        { title: 'GRNs', value: fmt(grn.total), sub: `${fmt(grn.fullyReceived)} complete`, icon: Factory, color: C.success },
        { title: 'QC Passed', value: fmt(qc.passed), sub: `${fmt(qc.failed)} failed`, icon: ClipboardCheck, color: C.info },
      ],
    },
    {
      id: 'payables', title: 'Payables & Finance', accent: C.success, loading: lVi,
      cards: [
        { title: 'Proforma Invoices', value: fmt(pi.total), sub: `${inr(pi.totalValue)} value`, icon: FileText, color: C.primary },
        { title: 'Advance Paid', value: inr(adv.paidAmount), sub: `${fmt(adv.totalPayments)} payments`, icon: Wallet, color: C.indigo },
        { title: 'Vendor Invoices', value: fmt(vi.total), sub: `${fmt(vi.paymentPending)} to pay`, icon: ReceiptText, color: C.warning },
        { title: 'Net Payable', value: inr(vi.netPayable), sub: 'invoiced value', icon: IndianRupee, color: C.error },
        { title: 'Outstanding', value: inr(vou.outstanding), sub: 'unpaid vouchers', icon: AlertTriangle, color: C.error },
        { title: 'Final Paid', value: inr(fp.paidAmount), sub: `${fmt(fp.full)} settled`, icon: BadgeCheck, color: C.success },
      ],
    },
  ]), [
    summary, fulfilPct, clientRisk.length, planHealth, upcomingDispatches.length, planAchievementPct,
    challanCount, indent, po, follow, grn, qc, pi, adv, vi, vou, fp, isLoading, lIndent, lPo, lVi,
  ]);

  const setCount = statSets.length;
  const activeSet = statSets[setIndex] || statSets[0];

  // Auto-rotate every 5s, unless paused (hover / manual).
  useEffect(() => {
    if (paused) return undefined;
    const id = setInterval(() => setSetIndex((i) => (i + 1) % setCount), 5000);
    return () => clearInterval(id);
  }, [paused, setCount]);

  const goNext = useCallback(() => setSetIndex((i) => (i + 1) % setCount), [setCount]);
  const goPrev = useCallback(() => setSetIndex((i) => (i - 1 + setCount) % setCount), [setCount]);

  // ── Unified recent-activity timeline ───────────────────────
  const activity = useMemo(() => {
    const items = [];
    (recentOrders?.data || []).forEach((o) => items.push({
      kind: 'Order', icon: ShoppingCart, color: C.primary,
      title: `${o.soNumber || 'Order'} · ${o.partyName || ''}`,
      sub: `${(o.status || 'RECEIVED').replace(/_/g, ' ').toLowerCase()} · ${fmt(o.totalOrderQty)} pcs`,
      at: o.createdAt || o.orderDate, to: '/orders',
    }));
    (recentChallans?.data || []).forEach((c) => items.push({
      kind: 'Dispatch', icon: Truck, color: C.success,
      title: `${c.dcNumber || 'Challan'} · ${c.partyName || ''}`,
      sub: `dispatched · ${fmt(c.totalQuantityPcs)} pcs`,
      at: c.createdAt || c.dcDate, to: '/challans',
    }));
    (recentPos?.data || []).forEach((p) => items.push({
      kind: 'Purchase', icon: ShoppingBag, color: C.indigo,
      title: `${p.poNumber || 'PO'} · ${p.vendorName || ''}`,
      sub: `purchase order · ${inr(p.grandTotal)}`,
      at: p.createdAt, to: '/purchase-fms/purchase-orders',
    }));
    (recentGrns?.data || []).forEach((g) => items.push({
      kind: 'GRN', icon: PackageCheck, color: C.info,
      title: `${g.grnNumber || 'GRN'} · ${g.vendorName || ''}`,
      sub: 'goods received',
      at: g.createdAt, to: '/purchase-fms/grn',
    }));
    return items
      .filter((i) => i.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 12);
  }, [recentOrders, recentChallans, recentPos, recentGrns]);

  const clearFilters = () => { setSelectedMonth(null); setSelectedClient(null); };
  const handleMonthClick = (cd) => {
    if (cd?.activeLabel) setSelectedMonth((p) => (p === cd.activeLabel ? null : cd.activeLabel));
  };

  return (
    <Box sx={{ p: { xs: 1.25, sm: 1.75 }, minHeight: '100vh', bgcolor: C.canvas }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <Box sx={{
        mb: 1.5, px: { xs: 1.5, sm: 2 }, py: 1.25, borderRadius: '8px',
        bgcolor: C.surface, border: `1px solid ${C.line}`,
        display: 'flex', justifyContent: 'space-between',
        alignItems: { xs: 'flex-start', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1.25,
      }}>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.25 }}>
            <Typography sx={{ fontSize: { xs: '1.05rem', sm: '1.15rem' }, fontWeight: 800, color: C.ink, lineHeight: 1.2 }}>
              Master Dashboard
            </Typography>
            <Chip
              icon={<Activity size={11} />}
              label="LIVE"
              sx={{ height: 19, fontWeight: 800, fontSize: '0.58rem', letterSpacing: '0.1em', borderRadius: '4px',
                bgcolor: alpha(C.success, 0.12), color: C.success, '& .MuiChip-icon': { color: C.success, ml: 0.5 } }}
            />
          </Stack>
          <Typography noWrap sx={{ color: C.slate, fontSize: '0.74rem' }}>
            Live command center for orders, dispatch &amp; purchase across the business.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          {(selectedMonth || selectedClient) && (
            <Button size="small" startIcon={<XCircle size={14} />} onClick={clearFilters}
              sx={{ fontWeight: 700, textTransform: 'none', borderRadius: '6px', color: C.slate }}>
              Clear
            </Button>
          )}
          <Button size="small" variant="contained" disableElevation startIcon={<Radar size={14} />}
            onClick={() => navigate('/dispatch-control-tower')}
            sx={{ fontWeight: 700, textTransform: 'none', borderRadius: '6px', bgcolor: C.primary, whiteSpace: 'nowrap' }}>
            Control Tower
          </Button>
        </Stack>
      </Box>

      {/* ── Overdue alert strip ────────────────────────────────── */}
      {!isLoading && planHealth.overduePlanQty > 0 && (
        <Box sx={{
          mb: 1.5, px: 1.75, py: 1, borderRadius: '8px', display: 'flex', alignItems: 'center', gap: 1.25,
          bgcolor: alpha(C.error, 0.06), border: `1px solid ${alpha(C.error, 0.25)}`,
        }}>
          <AlertTriangle size={16} color={C.error} />
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: C.error, flex: 1 }}>
            {fmt(planHealth.overduePlanQty)} pcs are overdue across {planHealth.overduePlanCount} planned phase(s).
          </Typography>
          <Button size="small" onClick={() => navigate('/dispatch-control-tower')}
            sx={{ fontWeight: 700, color: C.error }}>
            Review →
          </Button>
        </Box>
      )}

      {/* ── Rotating live-stats deck ───────────────────────────── */}
      <Section
        sx={{ mb: 2, p: { xs: 1.5, sm: 2 } }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.25, flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1.25}>
            <Box sx={{
              width: 30, height: 30, borderRadius: 2, display: 'grid', placeItems: 'center',
              bgcolor: alpha(activeSet.accent, 0.1), color: activeSet.accent, border: `1px solid ${alpha(activeSet.accent, 0.2)}`,
            }}>
              <Layers size={16} strokeWidth={2.4} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, color: C.ink, lineHeight: 1.1 }}>
                {activeSet.title}
              </Typography>
              <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: C.faint }}>
                Live metrics · set {setIndex + 1} of {setCount}
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            {/* Set dots */}
            <Stack direction="row" spacing={0.6} sx={{ mr: 0.5 }}>
              {statSets.map((s, i) => (
                <Box key={s.id} onClick={() => setSetIndex(i)} sx={{
                  width: i === setIndex ? 18 : 7, height: 7, borderRadius: 999, cursor: 'pointer',
                  bgcolor: i === setIndex ? activeSet.accent : C.line,
                  transition: 'all .25s ease',
                }} />
              ))}
            </Stack>
            <Tooltip title={paused ? 'Resume auto-rotate' : 'Pause auto-rotate'}>
              <IconButton size="small" onClick={() => setPaused((p) => !p)}
                sx={{ border: `1px solid ${C.line}`, color: C.slate }}>
                {paused ? <Play size={14} /> : <Pause size={14} />}
              </IconButton>
            </Tooltip>
            <IconButton size="small" onClick={goPrev} sx={{ border: `1px solid ${C.line}`, color: C.slate }}>
              <ChevronLeft size={16} />
            </IconButton>
            <IconButton size="small" onClick={goNext} sx={{ border: `1px solid ${C.line}`, color: C.slate }}>
              <ChevronRight size={16} />
            </IconButton>
          </Stack>
        </Box>

        {/* 5-second progress indicator (restarts each set) */}
        <Box sx={{ height: 3, borderRadius: 999, bgcolor: C.lineSoft, mb: 1.5, overflow: 'hidden' }}>
          <Box key={`${setIndex}-${paused}`} sx={{
            height: '100%', borderRadius: 999, bgcolor: activeSet.accent,
            animation: paused ? 'none' : 'kpiBar 5s linear forwards',
            width: paused ? '100%' : undefined,
            '@keyframes kpiBar': { from: { width: '0%' }, to: { width: '100%' } },
          }} />
        </Box>

        {/* Cards for the active set — fade/slide in on change */}
        <Grid container spacing={1.5} key={activeSet.id} sx={{
          animation: 'kpiIn .4s ease',
          '@keyframes kpiIn': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        }}>
          {activeSet.cards.map((k) => (
            <Grid item xs={6} sm={4} md={2} key={`${activeSet.id}-${k.title}`}>
              <KpiCard {...k} loading={activeSet.loading} onClick={k.to ? () => navigate(k.to) : undefined} />
            </Grid>
          ))}
        </Grid>
      </Section>

      {/* ── Graphs row 1 — Dispatch performance & order pipeline ── */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        {/* Graph 1 — Dispatch Performance */}
        <Grid item xs={12} lg={8}>
          <Section>
            <SectionHeader
              title="Dispatch Performance"
              subtitle="Planned vs dispatched volume each month, with the achievement %. Click a bar to filter."
              right={
                <Chip size="small" icon={<TrendingUp size={13} />} label={`${fulfilPct}% overall`}
                  sx={{ fontWeight: 800, bgcolor: alpha(C.primary, 0.08), color: C.primaryDk,
                    border: `1px solid ${alpha(C.primary, 0.18)}`, '& .MuiChip-icon': { color: C.primary } }} />
              }
            />
            <Box sx={{ height: 282 }}>
              {isLoading ? <Skeleton variant="rounded" height="100%" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlyTrend} onClick={handleMonthClick} margin={{ top: 8, right: 6, left: 0, bottom: 0 }} style={{ cursor: 'pointer' }}>
                    <defs>
                      <linearGradient id="planGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.primaryLt} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={C.primaryLt} stopOpacity={0.14} />
                      </linearGradient>
                      <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.primary} stopOpacity={1} />
                        <stop offset="100%" stopColor={C.primaryDk} stopOpacity={0.9} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.lineSoft} />
                    <XAxis dataKey="month" tickFormatter={(v) => dayjs(`${v}-01`).format('MMM YY')}
                      axisLine={false} tickLine={false} tick={{ fill: C.slate, fontWeight: 600, fontSize: 11 }} />
                    <YAxis yAxisId="qty" axisLine={false} tickLine={false} tickFormatter={(v) => fmt(v)}
                      tick={{ fill: C.slate, fontWeight: 600, fontSize: 11 }} width={56} />
                    <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} axisLine={false} tickLine={false}
                      tickFormatter={(v) => `${v}%`} tick={{ fill: C.success, fontWeight: 600, fontSize: 11 }} width={42} />
                    <RTooltip
                      cursor={{ fill: alpha(C.primary, 0.04) }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0]?.payload || {};
                        return (
                          <Paper sx={{ p: 1.5, border: `1px solid ${C.line}`, borderRadius: 2, boxShadow: '0 10px 28px rgba(30,58,138,0.12)', minWidth: 190 }}>
                            <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: C.ink, mb: 0.75 }}>
                              {dayjs(`${label}-01`).format('MMMM YYYY')}
                            </Typography>
                            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.4 }}>
                              <Typography sx={{ fontSize: '0.72rem', color: C.slate, fontWeight: 600 }}>Planned</Typography>
                              <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: C.primaryDk }}>{fmt(row.plannedQty)}</Typography>
                            </Stack>
                            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.4 }}>
                              <Typography sx={{ fontSize: '0.72rem', color: C.slate, fontWeight: 600 }}>Dispatched</Typography>
                              <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: C.primary }}>{fmt(row.actualQty)}</Typography>
                            </Stack>
                            <Stack direction="row" justifyContent="space-between">
                              <Typography sx={{ fontSize: '0.72rem', color: C.slate, fontWeight: 600 }}>Achievement</Typography>
                              <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: C.success }}>{row.achievementPct || 0}%</Typography>
                            </Stack>
                          </Paper>
                        );
                      }}
                    />
                    <Bar yAxisId="qty" dataKey="plannedQty" name="Planned" fill="url(#planGrad)" radius={[6, 6, 0, 0]} barSize={24} />
                    <Bar yAxisId="qty" dataKey="actualQty" name="Dispatched" fill="url(#actualGrad)" radius={[6, 6, 0, 0]} barSize={24}>
                      {monthlyTrend.map((e, i) => (
                        <Cell key={i} fill={e.month === selectedMonth ? C.success : 'url(#actualGrad)'} />
                      ))}
                    </Bar>
                    <Line yAxisId="pct" type="monotone" dataKey="achievementPct" name="Achievement %"
                      stroke={C.success} strokeWidth={2.5} dot={{ r: 3, fill: C.success }} activeDot={{ r: 5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </Box>
            <Stack direction="row" spacing={2.5} justifyContent="center" sx={{ mt: 1 }}>
              {[
                { label: 'Planned', color: C.primaryLt, line: false },
                { label: 'Dispatched', color: C.primary, line: false },
                { label: 'Achievement %', color: C.success, line: true },
              ].map((l) => (
                <Stack key={l.label} direction="row" spacing={0.75} alignItems="center">
                  <Box sx={{ width: l.line ? 14 : 10, height: l.line ? 3 : 10,
                    borderRadius: l.line ? 2 : '3px', bgcolor: l.color }} />
                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: C.slate }}>{l.label}</Typography>
                </Stack>
              ))}
            </Stack>
          </Section>
        </Grid>

        {/* Graph 2 — Order Pipeline */}
        <Grid item xs={12} lg={4}>
          <Section sx={{ height: '100%' }}>
            <SectionHeader title="Order Pipeline" subtitle="How many orders sit at each stage right now." />
            <Box sx={{ height: 282 }}>
              {isLoading ? <Skeleton variant="rounded" height="100%" /> : (
                statusData.length === 0 ? (
                  <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', color: C.faint }}>
                    <Typography sx={{ fontSize: '0.82rem' }}>No orders yet.</Typography>
                  </Stack>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusData} layout="vertical" margin={{ top: 4, right: 34, left: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke={C.lineSoft} />
                      <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false}
                        tick={{ fill: C.slate, fontWeight: 600, fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" width={82} axisLine={false} tickLine={false}
                        tick={{ fill: C.ink, fontWeight: 700, fontSize: 11 }} />
                      <RTooltip
                        cursor={{ fill: alpha(C.primary, 0.04) }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <Paper sx={{ p: 1.25, border: `1px solid ${C.line}`, borderRadius: 2, boxShadow: '0 10px 28px rgba(30,58,138,0.12)' }}>
                              <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: d.color }}>{d.label}</Typography>
                              <Typography sx={{ fontSize: '0.72rem', color: C.slate }}>
                                {d.count} order(s) · {fmt(d.qty)} pcs
                              </Typography>
                            </Paper>
                          );
                        }}
                      />
                      <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={20}>
                        {statusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                        <LabelList dataKey="count" position="right"
                          style={{ fontWeight: 800, fontSize: 12, fill: C.ink }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )
              )}
            </Box>
            <Stack direction="row" spacing={1.75} justifyContent="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              {statusData.map((d) => (
                <Stack key={d.key} direction="row" spacing={0.6} alignItems="center">
                  <Box sx={{ width: 9, height: 9, borderRadius: '3px', bgcolor: d.color }} />
                  <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: C.slate }}>
                    {d.label} · {d.count}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Section>
        </Grid>
      </Grid>

      {/* ── Graphs row 2 — Procurement funnel & purchase value ──── */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        {/* Graph 3 — Procurement Funnel */}
        <Grid item xs={12} lg={7}>
          <Section sx={{ height: '100%' }}>
            <SectionHeader
              title="Procurement Funnel"
              subtitle="Documents flowing through the Purchase FMS: indent → PO → GRN → QC → invoice → payment."
              right={
                <Chip size="small" icon={<ShoppingBag size={13} />} label={`${fmt(po.total)} POs`}
                  sx={{ fontWeight: 800, bgcolor: alpha(C.indigo, 0.08), color: C.indigo,
                    border: `1px solid ${alpha(C.indigo, 0.18)}`, '& .MuiChip-icon': { color: C.indigo } }} />
              }
            />
            <Box sx={{ height: 270 }}>
              {(lIndent || lPo) ? <Skeleton variant="rounded" height="100%" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelData} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                    <CartesianGrid horizontal={false} stroke={C.lineSoft} />
                    <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false}
                      tick={{ fill: C.slate, fontWeight: 600, fontSize: 11 }} />
                    <YAxis type="category" dataKey="stage" width={108} axisLine={false} tickLine={false}
                      tick={{ fill: C.ink, fontWeight: 700, fontSize: 11 }} />
                    <RTooltip
                      cursor={{ fill: alpha(C.indigo, 0.04) }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <Paper sx={{ p: 1.25, border: `1px solid ${C.line}`, borderRadius: 2, boxShadow: '0 10px 28px rgba(30,58,138,0.12)' }}>
                            <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: d.color }}>{d.stage}</Typography>
                            <Typography sx={{ fontSize: '0.72rem', color: C.slate }}>{fmt(d.value)} document(s)</Typography>
                          </Paper>
                        );
                      }}
                    />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={22}>
                      {funnelData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      <LabelList dataKey="value" position="right" formatter={(v) => fmt(v)}
                        style={{ fontWeight: 800, fontSize: 12, fill: C.ink }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Box>
          </Section>
        </Grid>

        {/* Graph 4 — Purchase Value Snapshot (₹) */}
        <Grid item xs={12} lg={5}>
          <Section sx={{ height: '100%' }}>
            <SectionHeader
              title="Purchase Value Snapshot"
              subtitle="Money flowing through procurement — ordered, invoiced and paid."
              right={
                <Chip size="small" icon={<IndianRupee size={13} />} label={inr(po.totalValue)}
                  sx={{ fontWeight: 800, bgcolor: alpha(C.success, 0.08), color: C.success,
                    border: `1px solid ${alpha(C.success, 0.18)}`, '& .MuiChip-icon': { color: C.success } }} />
              }
            />
            <Box sx={{ height: 270 }}>
              {lVi ? <Skeleton variant="rounded" height="100%" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={moneyData} margin={{ top: 12, right: 6, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.lineSoft} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} interval={0}
                      tick={{ fill: C.slate, fontWeight: 600, fontSize: 9.5 }} angle={-12} textAnchor="end" height={48} />
                    <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => inr(v)} width={62}
                      tick={{ fill: C.slate, fontWeight: 600, fontSize: 10 }} />
                    <RTooltip
                      cursor={{ fill: alpha(C.success, 0.04) }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <Paper sx={{ p: 1.25, border: `1px solid ${C.line}`, borderRadius: 2, boxShadow: '0 10px 28px rgba(30,58,138,0.12)' }}>
                            <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: d.color }}>{d.name}</Typography>
                            <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: C.ink }}>₹{fmt(d.value)}</Typography>
                          </Paper>
                        );
                      }}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={26}>
                      {moneyData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Box>
          </Section>
        </Grid>
      </Grid>

      {/* ── Lists row ──────────────────────────────────────────── */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        {/* Client Balance Risk */}
        <Grid item xs={12} lg={5}>
          <Section>
            <SectionHeader title="Client Balance Risk" subtitle="Clients with the highest pending quantity." />
            <Stack spacing={1}>
              {(isLoading ? Array.from({ length: 6 }) : clientRisk.slice(0, 7)).map((row, i) => {
                const pct = row?.orderQty ? (row.balanceQty / row.orderQty) * 100 : 0;
                const active = selectedClient === row?.partyName;
                return (
                  <Box key={row?.partyId || i}
                    onClick={() => row && setSelectedClient((p) => (p === row.partyName ? null : row.partyName))}
                    sx={{
                      cursor: 'pointer', p: 1.25, borderRadius: 2,
                      border: `1px solid ${active ? alpha(C.info, 0.35) : 'transparent'}`,
                      bgcolor: active ? alpha(C.info, 0.05) : 'transparent',
                      '&:hover': { bgcolor: alpha(C.info, 0.04) },
                    }}>
                    {isLoading ? <Skeleton height={36} /> : (
                      <>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.6 }}>
                          <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: C.ink }}>{row.partyName}</Typography>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: C.error }}>{fmt(row.balanceQty)}</Typography>
                            <ChevronRight size={13} color={C.faint} />
                          </Stack>
                        </Box>
                        <LinearProgress variant="determinate" value={Math.min(pct, 100)}
                          sx={{ height: 5, borderRadius: 999, bgcolor: C.lineSoft,
                            '& .MuiLinearProgress-bar': { borderRadius: 999, background: `linear-gradient(90deg,${C.errorLt},${C.error})` } }} />
                      </>
                    )}
                  </Box>
                );
              })}
              {!isLoading && clientRisk.length === 0 && (
                <Typography sx={{ py: 3, textAlign: 'center', fontSize: '0.8rem', color: C.faint }}>
                  No pending balances — every order is fully dispatched.
                </Typography>
              )}
            </Stack>
          </Section>
        </Grid>

        {/* Upcoming Dispatches */}
        <Grid item xs={12} lg={7}>
          <Section sx={{ height: '100%' }}>
            <SectionHeader
              title={selectedMonth || selectedClient ? 'Filtered Dispatches' : 'Upcoming Dispatches'}
              subtitle="Phases planned for the next 7 days."
              right={
                <Chip label={`${filteredUpcoming.length} items`} size="small"
                  sx={{ fontWeight: 700, bgcolor: alpha(C.primary, 0.1), color: C.primaryDk, border: `1px solid ${alpha(C.primary, 0.2)}` }} />
              }
            />
            <Stack spacing={1}>
              {!isLoading && filteredUpcoming.length === 0 && (
                <Box sx={{ py: 5, textAlign: 'center', bgcolor: C.surfaceAlt, borderRadius: 2.5, border: `1px dashed ${C.line}` }}>
                  <CalendarClock size={34} color={C.faint} style={{ opacity: 0.5, marginBottom: 8 }} />
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: C.slate }}>No dispatches scheduled.</Typography>
                </Box>
              )}
              {filteredUpcoming.slice(0, 8).map((row, i) => (
                <Box key={i} sx={{
                  display: 'grid', gridTemplateColumns: { xs: '1fr', md: '92px 1fr 96px' }, gap: 1.5,
                  p: 1.4, border: `1px solid ${C.lineSoft}`, borderRadius: 2, alignItems: 'center',
                  transition: 'all .16s ease',
                  '&:hover': { borderColor: alpha(C.primary, 0.4), transform: 'translateX(2px)' },
                }}>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <Box sx={{ width: 28, height: 28, borderRadius: 1.5, display: 'grid', placeItems: 'center',
                      bgcolor: alpha(C.warning, 0.1), border: `1px solid ${alpha(C.warning, 0.2)}`, color: C.warning }}>
                      <CalendarClock size={14} strokeWidth={2.4} />
                    </Box>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: C.warning }}>
                      {dayjs(row.plannedDate).format('DD MMM')}
                    </Typography>
                  </Stack>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.83rem', fontWeight: 700, color: C.ink }} noWrap>{row.partyName}</Typography>
                    <Typography sx={{ fontSize: '0.7rem', color: C.slate }} noWrap>
                      {row.skuName} · {row.phaseNo}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, color: C.primaryDk }}>{fmt(row.remainingQty)}</Typography>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.slate, letterSpacing: '0.06em' }}>PCS</Typography>
                  </Box>
                </Box>
              ))}
            </Stack>
          </Section>
        </Grid>
      </Grid>

      {/* ── Recent Activity ─────────────────────────────────────── */}
      <Section>
        <SectionHeader
          title="Recent Activity"
          subtitle="The latest orders, dispatches and purchase events across the business."
          right={
            <Chip size="small" icon={<Activity size={13} />} label="Live feed"
              sx={{ fontWeight: 800, bgcolor: alpha(C.primary, 0.08), color: C.primaryDk,
                border: `1px solid ${alpha(C.primary, 0.18)}`, '& .MuiChip-icon': { color: C.primary } }} />
          }
        />
        {activity.length === 0 ? (
          <Box sx={{ py: 5, textAlign: 'center', bgcolor: C.surfaceAlt, borderRadius: 2.5, border: `1px dashed ${C.line}` }}>
            <Activity size={34} color={C.faint} style={{ opacity: 0.5, marginBottom: 8 }} />
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: C.slate }}>No recent activity yet.</Typography>
          </Box>
        ) : (
          <Grid container spacing={1.25}>
            {activity.map((a, i) => (
              <Grid item xs={12} md={6} key={i}>
                <Box onClick={() => navigate(a.to)} sx={{
                  display: 'flex', alignItems: 'center', gap: 1.25, p: 1.25, borderRadius: 2,
                  border: `1px solid ${C.lineSoft}`, cursor: 'pointer', transition: 'all .16s ease',
                  '&:hover': { borderColor: alpha(a.color, 0.4), bgcolor: alpha(a.color, 0.03), transform: 'translateX(2px)' },
                }}>
                  <Avatar sx={{ width: 34, height: 34, bgcolor: alpha(a.color, 0.12), color: a.color, border: `1px solid ${alpha(a.color, 0.2)}` }}>
                    <a.icon size={16} strokeWidth={2.3} />
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: C.ink }} noWrap>{a.title}</Typography>
                    <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: C.slate, textTransform: 'capitalize' }} noWrap>{a.sub}</Typography>
                  </Box>
                  <Stack alignItems="flex-end" sx={{ flexShrink: 0 }}>
                    <Chip label={a.kind} size="small" sx={{
                      height: 18, fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.04em',
                      bgcolor: alpha(a.color, 0.1), color: a.color, border: `1px solid ${alpha(a.color, 0.2)}`,
                    }} />
                    <Typography sx={{ fontSize: '0.62rem', fontWeight: 600, color: C.faint, mt: 0.3 }}>
                      {dayjs(a.at).fromNow()}
                    </Typography>
                  </Stack>
                </Box>
              </Grid>
            ))}
          </Grid>
        )}
      </Section>
    </Box>
  );
}
