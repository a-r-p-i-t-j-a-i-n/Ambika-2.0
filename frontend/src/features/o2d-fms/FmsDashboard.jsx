import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Grid, Skeleton, alpha, Table, TableBody, TableCell,
  TableHead, TableRow, Chip, Button, Divider, IconButton, TextField, MenuItem,
  ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import {
  Layers, Activity, CheckCircle2, AlertTriangle, ArrowRight, TrendingUp, ChevronLeft,
  ChevronRight, Clock, Users, ListChecks, Percent, Timer, Gauge, BarChart3, PieChart as PieIcon,
  LineChart as LineIcon, Activity as RadarIcon, AlignStartVertical,
  ShoppingCart, Truck, PackageCheck, FileText, Wallet, IndianRupee, Boxes, Route, ClipboardList,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, CartesianGrid, Cell,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useGetFmsDashboardQuery } from '../../store/api/o2dFmsApi';

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const hrs = (mins) => (mins >= 60 ? `${(mins / 60).toFixed(1)} h` : `${Math.round(mins || 0)} m`);
const PALETTE = ['#1d4ed8', '#0f766e', '#b45309', '#be123c', '#7c3aed', '#0369a1', '#ca8a04', '#db2777'];

// ─── Stat card ───────────────────────────────────────────────────────────────
const StatCard = ({ label, value, icon: Icon, color, sub }) => (
  <Paper
    elevation={0}
    sx={{
      p: 1.5, borderRadius: 2.5, height: '100%', minHeight: 96,
      border: '1px solid', borderColor: 'divider',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 0.5,
      transition: 'box-shadow .18s, transform .18s',
      '&:hover': { boxShadow: `0 4px 14px ${alpha(color, 0.18)}`, transform: 'translateY(-2px)' },
    }}
  >
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box sx={{ p: 0.6, borderRadius: 1.5, bgcolor: alpha(color, 0.12), color, display: 'flex' }}><Icon size={15} /></Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, fontSize: '0.62rem', lineHeight: 1.1 }}>{label}</Typography>
    </Stack>
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1, color }}>{value}</Typography>
      {sub && <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>{sub}</Typography>}
    </Box>
  </Paper>
);

// ─── Chart-type catalogue ─────────────────────────────────────────────────────
const TYPE_META = {
  barH:    { label: 'Bars', icon: <BarChart3 size={15} style={{ transform: 'rotate(90deg)' }} /> },
  barV:    { label: 'Columns', icon: <BarChart3 size={15} /> },
  stacked: { label: 'Stacked', icon: <AlignStartVertical size={15} /> },
  line:    { label: 'Line', icon: <LineIcon size={15} /> },
  area:    { label: 'Area', icon: <LineIcon size={15} /> },
  pie:     { label: 'Pie', icon: <PieIcon size={15} /> },
  donut:   { label: 'Donut', icon: <PieIcon size={15} /> },
  radar:   { label: 'Radar', icon: <RadarIcon size={15} /> },
};

// One configurable chart card: a "what to show" picker + a "how to show it" toggle.
const ChartPanel = ({ title, views, defaultViewKey }) => {
  const [viewKey, setViewKey] = useState(defaultViewKey);
  const view = views.find((v) => v.key === viewKey) || views[0];
  const [type, setType] = useState(view.defaultType);

  // Keep the chart type valid when switching views.
  const handleView = (k) => {
    const v = views.find((x) => x.key === k);
    setViewKey(k);
    if (v && !v.allowed.includes(type)) setType(v.defaultType);
  };

  const data = view.data || [];
  const series = view.series || [];

  const renderChart = () => {
    if (!data.length) {
      return <Typography variant="body2" sx={{ color: 'text.secondary', mt: 6, textAlign: 'center' }}>No data for this view yet.</Typography>;
    }

    // Pie / Donut — single value per category.
    if (type === 'pie' || type === 'donut') {
      const key = series[0]?.dataKey || 'value';
      const pieData = data.map((d, i) => ({ name: d.name, value: d[key] ?? 0, color: d.color || PALETTE[i % PALETTE.length] }));
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
              innerRadius={type === 'donut' ? '55%' : 0} outerRadius="80%" paddingAngle={2}
              label={(e) => e.value || ''}>
              {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
            </Pie>
            <ReTooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} height={28} verticalAlign="bottom" />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    // Radar — categories around the ring, one ring per series.
    if (type === 'radar') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid />
            <PolarAngleAxis dataKey="name" tick={{ fontSize: 10 }} />
            <PolarRadiusAxis tick={{ fontSize: 9 }} />
            {series.map((s, i) => (
              <Radar key={s.dataKey} name={s.label} dataKey={s.dataKey}
                stroke={s.color || PALETTE[i % PALETTE.length]} fill={s.color || PALETTE[i % PALETTE.length]} fillOpacity={0.35} />
            ))}
            <ReTooltip />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} height={28} verticalAlign="bottom" />}
          </RadarChart>
        </ResponsiveContainer>
      );
    }

    // Line / Area.
    if (type === 'line' || type === 'area') {
      const ChartC = type === 'line' ? LineChart : AreaChart;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ChartC data={data} margin={{ top: 5, right: 12, left: -10, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={56} />
            <YAxis tick={{ fontSize: 11 }} unit={view.unit || ''} />
            <ReTooltip />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} height={28} verticalAlign="bottom" />}
            {series.map((s, i) => (type === 'line'
              ? <Line key={s.dataKey} type="monotone" dataKey={s.dataKey} name={s.label} stroke={s.color || PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 3 }} />
              : <Area key={s.dataKey} type="monotone" dataKey={s.dataKey} name={s.label} stroke={s.color || PALETTE[i % PALETTE.length]} fill={alpha(s.color || PALETTE[i % PALETTE.length], 0.25)} strokeWidth={2} />
            ))}
          </ChartC>
        </ResponsiveContainer>
      );
    }

    // Bars — horizontal (barH), vertical (barV), or stacked (horizontal, one stack).
    const horizontal = type === 'barH' || type === 'stacked';
    const stack = type === 'stacked' ? 'a' : undefined;
    const singleColored = series.length === 1; // colour bars individually when only one series
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'}
          margin={horizontal ? { top: 4, right: 16, left: 8, bottom: 4 } : { top: 4, right: 12, left: -10, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={!horizontal} vertical={horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={{ fontSize: 11 }} unit={view.unit || ''} />
              <YAxis type="category" dataKey="name" width={132} tick={{ fontSize: 10 }} />
            </>
          ) : (
            <>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={56} />
              <YAxis tick={{ fontSize: 11 }} unit={view.unit || ''} />
            </>
          )}
          <ReTooltip />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} height={28} verticalAlign="bottom" />}
          {series.map((s, i) => (
            <Bar key={s.dataKey} dataKey={s.dataKey} name={s.label} stackId={stack}
              fill={s.color || PALETTE[i % PALETTE.length]} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}>
              {singleColored && view.colorByRow && data.map((row, ri) => (
                <Cell key={ri} fill={row.color || s.color || PALETTE[ri % PALETTE.length]} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <Paper sx={{ p: 2, borderRadius: 3 }}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" mb={1} flexWrap="wrap" gap={1}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          {view.icon}
          <Typography sx={{ fontWeight: 700 }} noWrap>{title}</Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField select size="small" value={view.key} onChange={(e) => handleView(e.target.value)} sx={{ minWidth: 180 }}>
            {views.map((v) => <MenuItem key={v.key} value={v.key}>{v.label}</MenuItem>)}
          </TextField>
        </Stack>
      </Stack>

      <ToggleButtonGroup size="small" exclusive value={type} onChange={(_, v) => v && setType(v)} sx={{ mb: 1, flexWrap: 'wrap' }}>
        {view.allowed.map((t) => (
          <ToggleButton key={t} value={t} sx={{ px: 1, py: 0.4, textTransform: 'none', gap: 0.5 }}>
            {TYPE_META[t]?.icon}{TYPE_META[t]?.label || t}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {/* Fixed pixel height — a percentage/flex height lets recharts' Legend
          re-measure on every update and loop ("Maximum update depth exceeded"). */}
      <Box sx={{ height: 264 }}>{renderChart()}</Box>
    </Paper>
  );
};

const STATS_PER_PAGE = 6;

const FmsDashboard = () => {
  const { data, isLoading } = useGetFmsDashboardQuery(undefined, { pollingInterval: 60_000, skipPollingIfUnfocused: true });
  const navigate = useNavigate();
  const d = data?.data || {};
  const totals = d.totals || { total: 0, completed: 0, inProgress: 0 };

  const [statPage, setStatPage] = useState(0);

  // ── Derived datasets (only from real API data) ──────────────────────────────
  const byStep = d.byStep || [];
  const byPerson = d.byPerson || [];
  const overdueList = d.overdue || [];

  const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
  const totalPending = sum(byStep, 'pending');
  const totalDelayMins = sum(byStep, 'delayMins');
  const totalCompletedSteps = sum(byStep, 'completed');
  const totalOverdueSteps = d.overdueCount || sum(byStep, 'overdue');
  const peopleLagging = byPerson.filter((p) => p.overdue > 0).length;
  const completionRate = totals.total ? Math.round((totals.completed / totals.total) * 100) : 0;
  const avgOverdueMins = overdueList.length ? Math.round(sum(overdueList, 'overdueMins') / overdueList.length) : 0;

  // ── Order business intelligence (qty + stage based, from the O2D step flow) ──
  const o = d.orderStats || {};
  const num = (v) => Number(v || 0).toLocaleString('en-IN');
  const stageFunnel = d.stageFunnel || [];
  const ORDER_STATUS_META = {
    RECEIVED:     { label: 'Received',     color: '#b45309' },
    PLANNING:     { label: 'Planning',     color: '#7c3aed' },
    IN_PROGRESS:  { label: 'In Progress',  color: '#1d4ed8' },
    COMPLETED:    { label: 'Completed',    color: '#0f766e' },
    SHORT_CLOSED: { label: 'Short Closed', color: '#475569' },
    CANCELLED:    { label: 'Cancelled',    color: '#be123c' },
  };

  // ── Stat strip (paged) ──────────────────────────────────────────────────────
  // Page 1-2: order operations (what the business cares about).
  // Page 3+: FMS process health (where it's stuck, who's lagging).
  const STATS = [
    // ── Orders ──
    { label: 'Total orders', value: num(o.totalOrders ?? totals.total), icon: ShoppingCart, color: '#1d4ed8', sub: 'in the O2D flow' },
    { label: 'Order volume', value: num(o.totalOrderQty), icon: Boxes, color: '#7c3aed', sub: 'pcs ordered' },
    { label: 'Dispatched', value: num(o.totalDispatchedQty), icon: Truck, color: '#0f766e', sub: `${o.fulfillmentPct || 0}% fulfilled` },
    { label: 'Pending qty', value: num(o.totalBalanceQty), icon: Clock, color: '#b45309', sub: 'pcs to dispatch' },
    { label: 'Fulfilment', value: `${o.fulfillmentPct || 0}%`, icon: Percent, color: '#0f766e', sub: 'volume delivered' },
    { label: 'Planning pending', value: num(o.planningPending), icon: ClipboardList, color: '#7c3aed', sub: 'orders to plan' },
    // ── Stage flow ──
    { label: 'Dispatched orders', value: num(o.dispatched), icon: PackageCheck, color: '#0f766e', sub: 'actual dispatch done' },
    { label: 'Awaiting dispatch', value: num(o.awaitingDispatch), icon: Truck, color: '#b45309', sub: 'planned, not sent' },
    { label: 'Invoiced', value: num(o.invoiced), icon: FileText, color: '#0369a1', sub: 'invoice raised' },
    { label: 'Delivered (POD)', value: num(o.delivered), icon: CheckCircle2, color: '#0f766e', sub: 'proof of delivery' },
    { label: 'Payment received', value: num(o.paid), icon: Wallet, color: '#0f766e', sub: 'fully paid' },
    { label: 'Awaiting payment', value: num(o.awaitingPayment), icon: IndianRupee, color: '#be123c', sub: 'delivered, unpaid' },
    // ── FMS process health ──
    { label: 'Total processes', value: totals.total, icon: Layers, color: '#1d4ed8' },
    { label: 'In progress', value: totals.inProgress, icon: Activity, color: '#0369a1' },
    { label: 'Completed', value: totals.completed, icon: CheckCircle2, color: '#0f766e', sub: 'fully closed' },
    { label: 'Overdue steps', value: totalOverdueSteps, icon: AlertTriangle, color: '#be123c', sub: 'past SLA, still pending' },
    { label: 'Completion rate', value: `${completionRate}%`, icon: Percent, color: '#0f766e', sub: 'orders fully done' },
    { label: 'Pending steps', value: totalPending, icon: Clock, color: '#475569', sub: 'awaiting action' },
    { label: 'Steps completed', value: totalCompletedSteps, icon: ListChecks, color: '#0f766e', sub: 'across all orders' },
    { label: 'Total delay', value: hrs(totalDelayMins), icon: Timer, color: '#b45309', sub: 'accumulated lateness' },
    { label: 'People lagging', value: peopleLagging, icon: Users, color: '#be123c', sub: 'have overdue steps' },
    { label: 'Avg overdue', value: hrs(avgOverdueMins), icon: Gauge, color: '#b45309', sub: 'per overdue step' },
  ];
  const maxStatPage = Math.ceil(STATS.length / STATS_PER_PAGE) - 1;
  const statWindow = STATS.slice(statPage * STATS_PER_PAGE, statPage * STATS_PER_PAGE + STATS_PER_PAGE);

  // ── Chart views ─────────────────────────────────────────────────────────────
  const stepData = byStep.map((s) => ({
    name: s.name || s._id,
    delayHrs: +((s.delayMins || 0) / 60).toFixed(1),
    overdue: s.overdue || 0,
    pending: s.pending || 0,
    completed: s.completed || 0,
  }));
  const personData = byPerson.map((p) => ({
    name: p.name || 'Unassigned',
    delayHrs: +((p.delayMins || 0) / 60).toFixed(1),
    pending: p.pending || 0,
    overdue: p.overdue || 0,
    color: p.overdue > 0 ? '#be123c' : '#1d4ed8',
  }));
  const processStatusData = [
    { name: 'Completed', value: totals.completed, color: '#0f766e' },
    { name: 'In progress', value: totals.inProgress, color: '#1d4ed8' },
  ];
  const stepStatusData = [
    { name: 'Pending', value: totalPending, color: '#475569' },
    { name: 'Overdue', value: totalOverdueSteps, color: '#be123c' },
    { name: 'Completed', value: totalCompletedSteps, color: '#0f766e' },
  ];

  // ── Order-journey datasets (the O2D stage funnel) ──
  const funnelData = stageFunnel.map((s) => ({
    name: s.label, done: s.done, pending: s.pending, total: s.total,
    color: '#1d4ed8',
  }));
  const orderStatusData = (o.byStatus || []).map((r) => ({
    name: ORDER_STATUS_META[r._id]?.label || r._id || 'Unknown',
    value: r.count || 0,
    color: ORDER_STATUS_META[r._id]?.color || '#475569',
  })).filter((r) => r.value > 0);

  // Views for the ORDER-JOURNEY panel.
  const journeyViews = [
    { key: 'stage-mix', label: 'Stage progress (done vs pending)', icon: <Route size={18} color="#1d4ed8" />,
      data: funnelData, series: [
        { dataKey: 'done', label: 'Completed', color: '#0f766e' },
        { dataKey: 'pending', label: 'Pending', color: '#b45309' },
      ], defaultType: 'stacked', allowed: ['stacked', 'barH', 'barV', 'line', 'area'] },
    { key: 'stage-done', label: 'Orders cleared per stage', icon: <PackageCheck size={18} color="#0f766e" />,
      data: funnelData, series: [{ dataKey: 'done', label: 'Completed', color: '#0f766e' }],
      defaultType: 'barH', allowed: ['barH', 'barV', 'line', 'area', 'radar'] },
    { key: 'stage-pending', label: 'Orders waiting per stage', icon: <Clock size={18} color="#b45309" />,
      data: funnelData, series: [{ dataKey: 'pending', label: 'Pending', color: '#b45309' }],
      defaultType: 'barH', allowed: ['barH', 'barV', 'pie', 'donut', 'radar'] },
    { key: 'order-status', label: 'Orders by status', icon: <PieIcon size={18} color="#1d4ed8" />,
      data: orderStatusData, series: [{ dataKey: 'value', label: 'Orders' }],
      colorByRow: true, defaultType: 'donut', allowed: ['donut', 'pie', 'barV', 'barH'] },
  ];

  // Views for the LEFT panel (step-centric) and RIGHT panel (people + status).
  const leftViews = [
    { key: 'step-delay', label: 'Delay by step', icon: <TrendingUp size={18} color="#b45309" />, unit: 'h',
      data: stepData.filter((s) => s.delayHrs > 0), series: [{ dataKey: 'delayHrs', label: 'Delay (h)', color: '#b45309' }],
      colorByRow: false, defaultType: 'barH', allowed: ['barH', 'barV', 'line', 'area', 'radar', 'pie'] },
    { key: 'step-overdue', label: 'Overdue by step', icon: <AlertTriangle size={18} color="#be123c" />,
      data: stepData.filter((s) => s.overdue > 0), series: [{ dataKey: 'overdue', label: 'Overdue', color: '#be123c' }],
      defaultType: 'barH', allowed: ['barH', 'barV', 'pie', 'donut', 'radar'] },
    { key: 'step-pending', label: 'Pending load by step', icon: <Clock size={18} color="#475569" />,
      data: stepData.filter((s) => s.pending > 0), series: [{ dataKey: 'pending', label: 'Pending', color: '#475569' }],
      defaultType: 'barH', allowed: ['barH', 'barV', 'pie', 'donut', 'radar'] },
    { key: 'step-mix', label: 'Status mix by step', icon: <BarChart3 size={18} color="#1d4ed8" />,
      data: stepData, series: [
        { dataKey: 'pending', label: 'Pending', color: '#94a3b8' },
        { dataKey: 'overdue', label: 'Overdue', color: '#be123c' },
        { dataKey: 'completed', label: 'Completed', color: '#0f766e' },
      ], defaultType: 'stacked', allowed: ['stacked', 'barH', 'barV', 'radar'] },
    { key: 'step-status', label: 'Step status share', icon: <PieIcon size={18} color="#1d4ed8" />,
      data: stepStatusData, series: [{ dataKey: 'value', label: 'Steps' }],
      colorByRow: true, defaultType: 'donut', allowed: ['donut', 'pie', 'barV'] },
  ];
  const rightViews = [
    { key: 'person-delay', label: 'Delay by person', icon: <AlertTriangle size={18} color="#be123c" />, unit: 'h',
      data: personData.filter((p) => p.delayHrs > 0), series: [{ dataKey: 'delayHrs', label: 'Delay (h)' }],
      colorByRow: true, defaultType: 'barH', allowed: ['barH', 'barV', 'line', 'area', 'radar'] },
    { key: 'person-load', label: 'Load & overdue by person', icon: <Users size={18} color="#1d4ed8" />,
      data: personData.filter((p) => p.pending > 0 || p.overdue > 0), series: [
        { dataKey: 'pending', label: 'Pending', color: '#1d4ed8' },
        { dataKey: 'overdue', label: 'Overdue', color: '#be123c' },
      ], defaultType: 'stacked', allowed: ['stacked', 'barH', 'barV', 'radar'] },
    { key: 'person-pending', label: 'Pending by person', icon: <Clock size={18} color="#475569" />,
      data: personData.filter((p) => p.pending > 0), series: [{ dataKey: 'pending', label: 'Pending', color: '#475569' }],
      defaultType: 'barH', allowed: ['barH', 'barV', 'pie', 'donut', 'radar'] },
    { key: 'process-status', label: 'Process status', icon: <PieIcon size={18} color="#0f766e" />,
      data: processStatusData, series: [{ dataKey: 'value', label: 'Orders' }],
      colorByRow: true, defaultType: 'donut', allowed: ['donut', 'pie', 'barV'] },
  ];

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={520} /></Box>;

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h5" sx={{ fontWeight: 800 }}>O2D FMS — Management View</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Live order operations, stage-by-stage progress, and where things are stuck. Updates every minute.
      </Typography>

      {/* ── Paged stat cards ── */}
      <Stack direction="row" alignItems="stretch" spacing={1.25} sx={{ mb: 2 }}>
        <IconButton onClick={() => setStatPage((p) => Math.max(0, p - 1))} disabled={statPage === 0}
          sx={{ alignSelf: 'center', border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <ChevronLeft size={18} />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Grid container spacing={1.25}>
            {statWindow.map((s) => (
              <Grid item xs={6} sm={4} md={2} key={s.label}>
                <StatCard {...s} />
              </Grid>
            ))}
          </Grid>
        </Box>
        <IconButton onClick={() => setStatPage((p) => Math.min(maxStatPage, p + 1))} disabled={statPage >= maxStatPage}
          sx={{ alignSelf: 'center', border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <ChevronRight size={18} />
        </IconButton>
      </Stack>
      <Stack direction="row" justifyContent="center" spacing={0.75} sx={{ mb: 2 }}>
        {Array.from({ length: maxStatPage + 1 }).map((_, i) => (
          <Box key={i} onClick={() => setStatPage(i)}
            sx={{ width: i === statPage ? 18 : 7, height: 7, borderRadius: 4, cursor: 'pointer', transition: 'all .2s',
              bgcolor: i === statPage ? 'primary.main' : alpha('#1d4ed8', 0.2) }} />
        ))}
      </Stack>

      {/* ── Order journey funnel (business view) ── */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12}>
          <ChartPanel title="Order Journey — where every order stands" views={journeyViews} defaultViewKey="stage-mix" />
        </Grid>
      </Grid>

      {/* ── Configurable charts (FMS process health) ── */}
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <ChartPanel title="Bottleneck — by step" views={leftViews} defaultViewKey="step-delay" />
        </Grid>
        <Grid item xs={12} md={6}>
          <ChartPanel title="Accountability — by person" views={rightViews} defaultViewKey="person-delay" />
        </Grid>
      </Grid>

      {/* ── Overdue action table ── */}
      <Paper sx={{ p: 2, borderRadius: 3, mt: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" mb={1}>
          <AlertTriangle size={18} color="#be123c" />
          <Typography sx={{ fontWeight: 700 }}>Overdue steps</Typography>
          <Chip size="small" label={overdueList.length} color="error" />
        </Stack>
        <Divider sx={{ mb: 1 }} />
        {overdueList.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 2, textAlign: 'center' }}>Nothing overdue. 🎉</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Order</TableCell><TableCell>Step</TableCell><TableCell>Doer</TableCell>
                <TableCell>Planned by</TableCell><TableCell align="right">Overdue</TableCell><TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {overdueList.map((o) => (
                <TableRow key={`${o.processId}-${o.stepCode}`} hover>
                  <TableCell>{o.soNumber}<br /><Typography variant="caption" color="text.secondary">{o.partyName}</Typography></TableCell>
                  <TableCell>{o.name} <Chip size="small" variant="outlined" label={o.stepCode} /></TableCell>
                  <TableCell>{o.ownerName || <em>Unassigned</em>}</TableCell>
                  <TableCell>{fmt(o.planned)}</TableCell>
                  <TableCell align="right"><Chip size="small" color="error" label={hrs(o.overdueMins)} /></TableCell>
                  <TableCell align="right">
                    <Button size="small" endIcon={<ArrowRight size={14} />} onClick={() => navigate(`/o2d-fms/process/${o.processId}`)}>Open</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Box>
  );
};

export default FmsDashboard;
