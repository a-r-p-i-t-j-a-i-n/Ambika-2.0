import React, { useState, useMemo } from 'react';
import {
  Box, Grid, LinearProgress, Paper, Skeleton, Typography, alpha,
  Button, Chip, Stack,
} from '@mui/material';
import {
  AlertTriangle, CalendarClock, ClipboardList, PackageCheck, ShoppingCart,
  XCircle, ChevronRight, TrendingUp, Activity, Boxes, Clock, Radar,
} from 'lucide-react';
import {
  Bar, BarChart, ComposedChart, Line, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Cell, LabelList,
} from 'recharts';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useGetDispatchDashboardQuery } from '../../store/api/dispatchControlApi';
import { useGetOrderStatsQuery } from '../../store/api/orderApi';

// ─── Premium blue palette ──────────────────────────────────────────────────
const C = {
  ink: '#0b2545', body: '#1e3a8a', primary: '#1d4ed8', primaryDk: '#1e3a8a',
  primaryLt: '#3b82f6', success: '#0f766e', successLt: '#5eead4',
  warning: '#b45309', warningLt: '#fcd34d', error: '#be123c', errorLt: '#fda4af',
  info: '#0369a1', indigo: '#5b6cff', slate: '#475a8a', faint: '#7d8fb3',
  line: '#dbe4f3', lineSoft: '#eaf0fb', surface: '#ffffff', surfaceAlt: '#f5f8ff',
};

const fmt = (v) => Number(v || 0).toLocaleString('en-IN');

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
      p: 1.6, borderRadius: 2.5, height: '100%',
      border: `1px solid ${C.line}`,
      background: 'linear-gradient(180deg,#ffffff 0%,#fbfcff 100%)',
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
    p: 2.25, borderRadius: 3, border: `1px solid ${C.line}`,
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
  const { data, isLoading } = useGetDispatchDashboardQuery();
  const { data: statsRes } = useGetOrderStatsQuery();

  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);

  const dashboard = data?.data || {};
  const summary = dashboard.summary || {};
  const planHealth = dashboard.planHealth || {};
  const monthlyTrend = dashboard.monthlyTrend || [];
  const clientRisk = dashboard.clientBalanceRisk || [];
  const upcomingDispatches = dashboard.upcomingDispatches || [];
  const byStatus = statsRes?.data?.byStatus || [];

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

  const fulfilPct = summary.fulfillmentPct || 0;
  const clearFilters = () => { setSelectedMonth(null); setSelectedClient(null); };
  const handleMonthClick = (cd) => {
    if (cd?.activeLabel) setSelectedMonth((p) => (p === cd.activeLabel ? null : cd.activeLabel));
  };

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2.5 }, minHeight: '100vh' }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <Box sx={{
        mb: 2, p: { xs: 2, sm: 2.5 }, borderRadius: 3, color: '#fff',
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 50%, #1d4ed8 100%)',
        boxShadow: '0 8px 22px rgba(30,58,138,0.18)',
      }}>
        <Box aria-hidden sx={{
          position: 'absolute', top: -70, right: -70, width: 240, height: 240, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(96,165,250,0.3) 0%, transparent 60%)',
        }} />
        <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5 }}>
          <Box>
            <Chip
              icon={<Activity size={12} style={{ color: 'rgba(255,255,255,0.9)' }} />}
              label="LIVE OPERATIONS"
              sx={{
                mb: 1, height: 22, color: '#fff', backgroundColor: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.22)', fontWeight: 700, fontSize: '0.62rem',
                letterSpacing: '0.12em', '& .MuiChip-icon': { color: '#fff', ml: 0.75 },
              }}
            />
            <Typography sx={{ fontSize: { xs: '1.3rem', sm: '1.55rem' }, fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 1.15 }}>
              Dispatch Intelligence Hub
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.82rem', fontWeight: 500, mt: 0.25 }}>
              Real-time monitoring of orders, planning &amp; dispatch health.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            {(selectedMonth || selectedClient) && (
              <Button size="small" startIcon={<XCircle size={14} />} onClick={clearFilters}
                sx={{ background: 'rgba(255,255,255,0.16)', color: '#fff', border: '1px solid rgba(255,255,255,0.22)', fontWeight: 700 }}>
                Clear
              </Button>
            )}
            <Button size="small" startIcon={<Radar size={14} />} onClick={() => navigate('/dispatch-control-tower')}
              sx={{ background: 'rgba(255,255,255,0.16)', color: '#fff', border: '1px solid rgba(255,255,255,0.22)', fontWeight: 700 }}>
              Control Tower
            </Button>
          </Stack>
        </Box>
      </Box>

      {/* ── Overdue alert strip ────────────────────────────────── */}
      {!isLoading && planHealth.overduePlanQty > 0 && (
        <Box sx={{
          mb: 2, px: 2, py: 1.1, borderRadius: 2.5, display: 'flex', alignItems: 'center', gap: 1.25,
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

      {/* ── KPI row — 6 cards in a single line ─────────────────── */}
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {[
          { title: 'Total Orders', value: fmt(summary.totalOrders), sub: `${fmt(summary.completedOrders)} completed`, icon: ShoppingCart, color: C.primary, to: '/orders' },
          { title: 'Open Orders', value: fmt(summary.openOrders), sub: 'in progress', icon: ClipboardList, color: C.info, to: '/dispatch-control-tower' },
          { title: 'Order Volume', value: fmt(summary.totalOrderQty), sub: 'pcs ordered', icon: Boxes, color: C.indigo },
          { title: 'Dispatched', value: fmt(summary.totalDispatchedQty), sub: `${fulfilPct}% of volume`, icon: PackageCheck, color: C.success, to: '/challans' },
          { title: 'Pending', value: fmt(summary.totalBalanceQty), sub: `${clientRisk.length} clients`, icon: Clock, color: C.warning },
          { title: 'Fulfilment', value: `${fulfilPct}%`, sub: 'order completion', icon: TrendingUp, color: C.success },
        ].map((k) => (
          <Grid item xs={6} sm={4} md={2} key={k.title}>
            <KpiCard {...k} loading={isLoading} onClick={k.to ? () => navigate(k.to) : undefined} />
          </Grid>
        ))}
      </Grid>

      {/* ── Graphs row ─────────────────────────────────────────── */}
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
                    <Tooltip
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
                      <Tooltip
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

      {/* ── Lists row ──────────────────────────────────────────── */}
      <Grid container spacing={2}>
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
    </Box>
  );
}
