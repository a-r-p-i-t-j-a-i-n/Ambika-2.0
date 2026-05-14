import React, { useState, useMemo } from 'react';
import {
  Box, Grid, LinearProgress, Paper, Skeleton, Typography, alpha,
  Button, IconButton, Chip, Stack,
} from '@mui/material';
import {
  AlertTriangle, CalendarClock, ClipboardList, PackageCheck,
  ShoppingCart, XCircle, Filter, ChevronRight, TrendingUp, Activity,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, PieChart, Pie, Cell,
} from 'recharts';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useGetDispatchDashboardQuery } from '../../store/api/dispatchControlApi';

// ─── Premium Blue Palette (no black) ────────────────────────────────────────
const C = {
  ink:        '#0b2545',   // deepest navy — replaces black
  body:       '#1e3a8a',
  text:       '#1d4ed8',
  primary:    '#1d4ed8',
  primaryDk:  '#1e3a8a',
  primaryLt:  '#3b82f6',
  accent:     '#2563eb',
  success:    '#0f766e',
  successLt:  '#5eead4',
  warning:    '#b45309',
  warningLt:  '#fcd34d',
  error:      '#be123c',
  errorLt:    '#fda4af',
  info:       '#0369a1',
  infoLt:     '#7dd3fc',
  slate:      '#475a8a',
  faint:      '#7d8fb3',
  line:       '#dbe4f3',
  lineSoft:   '#eaf0fb',
  surface:    '#ffffff',
  surfaceAlt: '#f5f8ff',
  canvas:     '#eef3fc',
};

const fmt = (value) => Number(value || 0).toLocaleString('en-IN');

// ─── StatCard ───────────────────────────────────────────────────────────────
const StatCard = ({ title, value, icon: Icon, color, loading, helper, helperTone, active, onClick }) => (
  <Paper
    onClick={onClick}
    sx={{
      position: 'relative',
      p: 2.5,
      borderRadius: 3,
      border: '1px solid',
      borderColor: active ? alpha(color, 0.5) : C.line,
      boxShadow: active
        ? `0 10px 28px ${alpha(color, 0.15)}`
        : '0 1px 2px rgba(30, 58, 138, 0.04)',
      height: '100%',
      cursor: onClick ? 'pointer' : 'default',
      transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
      overflow: 'hidden',
      background: 'linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)',
      '&::before': {
        content: '""',
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at top right, ${alpha(color, 0.06)} 0%, transparent 60%)`,
        pointerEvents: 'none',
      },
      '&:hover': onClick
        ? {
            transform: 'translateY(-2px)',
            borderColor: alpha(color, 0.5),
            boxShadow: `0 14px 32px ${alpha(color, 0.14)}`,
          }
        : {},
    }}
  >
    <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.75 }}>
      <Box
        sx={{
          width: 42,
          height: 42,
          borderRadius: 2.5,
          background: `linear-gradient(135deg, ${alpha(color, 0.12)} 0%, ${alpha(color, 0.04)} 100%)`,
          border: `1px solid ${alpha(color, 0.18)}`,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={20} strokeWidth={2.2} />
      </Box>
      {helper && (
        <Chip
          label={helper}
          size="small"
          sx={{
            height: 22,
            fontSize: '0.66rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: helperTone === 'success' ? C.success : helperTone === 'error' ? C.error : color,
            backgroundColor: alpha(helperTone === 'success' ? C.success : helperTone === 'error' ? C.error : color, 0.10),
            border: `1px solid ${alpha(helperTone === 'success' ? C.success : helperTone === 'error' ? C.error : color, 0.20)}`,
          }}
        />
      )}
    </Box>
    <Typography sx={{ position: 'relative', fontSize: '0.68rem', fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.5 }}>
      {title}
    </Typography>
    {loading ? (
      <Skeleton width="65%" height={38} />
    ) : (
      <Typography sx={{ position: 'relative', fontSize: '1.65rem', fontWeight: 800, color: C.ink, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
        {value}
      </Typography>
    )}
  </Paper>
);

// ─── Section Card wrapper ───────────────────────────────────────────────────
const Section = ({ children, sx, ...rest }) => (
  <Paper
    {...rest}
    sx={{
      p: 3,
      borderRadius: 3,
      border: '1px solid',
      borderColor: C.line,
      backgroundColor: C.surface,
      boxShadow: '0 1px 2px rgba(30, 58, 138, 0.04)',
      ...sx,
    }}
  >
    {children}
  </Paper>
);

const SectionHeader = ({ title, subtitle, right }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2.5 }}>
    <Box>
      <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: C.ink, letterSpacing: '-0.01em' }}>{title}</Typography>
      {subtitle && (
        <Typography sx={{ fontSize: '0.78rem', color: C.slate, fontWeight: 500, mt: 0.25 }}>{subtitle}</Typography>
      )}
    </Box>
    {right}
  </Box>
);

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useGetDispatchDashboardQuery();

  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);

  const dashboard = data?.data || {};
  const summary = dashboard.summary || {};
  const planHealth = dashboard.planHealth || {};
  const monthlyTrend = dashboard.monthlyTrend || [];
  const clientRisk = dashboard.clientBalanceRisk || [];
  const upcomingDispatches = dashboard.upcomingDispatches || [];

  const filteredUpcoming = useMemo(() => {
    let filtered = upcomingDispatches;
    if (selectedMonth) filtered = filtered.filter((d) => dayjs(d.plannedDate).format('YYYY-MM') === selectedMonth);
    if (selectedClient) filtered = filtered.filter((d) => d.partyName === selectedClient);
    return filtered;
  }, [upcomingDispatches, selectedMonth, selectedClient]);

  const fulfillmentData = useMemo(
    () => [
      { name: 'Dispatched', value: summary.totalDispatchedQty || 0 },
      { name: 'Pending', value: summary.totalBalanceQty || 0 },
    ],
    [summary],
  );

  const clearFilters = () => {
    setSelectedMonth(null);
    setSelectedClient(null);
  };

  const handleMonthClick = (chartData) => {
    if (chartData && chartData.activeLabel) {
      setSelectedMonth((prev) => (prev === chartData.activeLabel ? null : chartData.activeLabel));
    }
  };

  const handleClientClick = (row) => {
    if (row && row.partyName) {
      setSelectedClient((prev) => (prev === row.partyName ? null : row.partyName));
    }
  };

  return (
    <Box sx={{ p: { xs: 2.5, sm: 4 }, minHeight: '100vh', bgcolor: 'transparent' }}>
      {/* ─── Page Header ──────────────────────────────────────────────── */}
      <Box
        sx={{
          mb: 3.5,
          p: { xs: 2.5, sm: 3 },
          borderRadius: 3,
          color: '#ffffff',
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 50%, #1d4ed8 100%)',
          boxShadow: '0 10px 28px rgba(30, 58, 138, 0.18)',
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: -80, right: -80,
            width: 280, height: 280, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(96,165,250,0.30) 0%, transparent 60%)',
          }}
        />
        <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
          <Box>
            <Chip
              icon={<Activity size={13} style={{ color: 'rgba(255,255,255,0.9)' }} />}
              label="LIVE OPERATIONS"
              sx={{
                mb: 1.5,
                height: 24,
                color: '#ffffff',
                backgroundColor: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.22)',
                fontWeight: 700,
                fontSize: '0.66rem',
                letterSpacing: '0.14em',
                '& .MuiChip-icon': { color: '#ffffff', ml: 0.75 },
              }}
            />
            <Typography sx={{ fontSize: { xs: '1.45rem', sm: '1.75rem' }, fontWeight: 800, color: '#ffffff', letterSpacing: '-0.025em', lineHeight: 1.15 }}>
              Dispatch Intelligence Hub
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.9rem', fontWeight: 500, mt: 0.5 }}>
              Real-time monitoring of orders, planning, and dispatch health.
            </Typography>
          </Box>
          {(selectedMonth || selectedClient) && (
            <Button
              variant="contained"
              size="medium"
              startIcon={<XCircle size={16} />}
              onClick={clearFilters}
              sx={{
                background: 'rgba(255,255,255,0.16)',
                color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.22)',
                fontWeight: 700,
                '&:hover': { background: 'rgba(255,255,255,0.24)' },
              }}
            >
              Clear Filters
            </Button>
          )}
        </Box>
      </Box>

      {/* ─── Filter status chips ──────────────────────────────────────── */}
      {(selectedMonth || selectedClient) && (
        <Stack direction="row" spacing={1.25} sx={{ mb: 3 }}>
          {selectedMonth && (
            <Chip
              label={`Month: ${dayjs(`${selectedMonth}-01`).format('MMMM YYYY')}`}
              onDelete={() => setSelectedMonth(null)}
              sx={{ bgcolor: alpha(C.primary, 0.10), color: C.primaryDk, fontWeight: 700, border: `1px solid ${alpha(C.primary, 0.20)}` }}
            />
          )}
          {selectedClient && (
            <Chip
              label={`Client: ${selectedClient}`}
              onDelete={() => setSelectedClient(null)}
              sx={{ bgcolor: alpha(C.info, 0.10), color: C.info, fontWeight: 700, border: `1px solid ${alpha(C.info, 0.20)}` }}
            />
          )}
        </Stack>
      )}

      {/* ─── KPI Row ──────────────────────────────────────────────────── */}
      <Grid container spacing={2.5} sx={{ mb: 3.5 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="Open Orders"  value={fmt(summary.openOrders)}        icon={ShoppingCart}  color={C.primary} loading={isLoading} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="Order Volume" value={fmt(summary.totalOrderQty)}     icon={ClipboardList} color={C.info}    loading={isLoading} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="Success Rate" value={`${summary.fulfillmentPct || 0}%`} icon={PackageCheck} color={C.success} loading={isLoading} helper="FULFILLED" helperTone="success" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="Overdue Qty"  value={fmt(planHealth.overduePlanQty)} icon={AlertTriangle} color={C.error}   loading={isLoading} helper="CRITICAL"  helperTone="error" />
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        {/* ─── Fulfillment Trend ───────────────────────────────────────── */}
        <Grid item xs={12} lg={8}>
          <Section>
            <SectionHeader
              title="Fulfillment Trend"
              subtitle="Click a bar to filter upcoming dispatches by month."
              right={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.5, borderRadius: 2, bgcolor: alpha(C.primary, 0.08), border: `1px solid ${alpha(C.primary, 0.18)}` }}>
                  <TrendingUp size={15} color={C.primary} />
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: C.primaryDk, letterSpacing: '0.04em' }}>
                    AVG 82%
                  </Typography>
                </Box>
              }
            />

            <Box sx={{ height: 340 }}>
              {isLoading ? (
                <Skeleton variant="rounded" height="100%" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyTrend} onClick={handleMonthClick} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} style={{ cursor: 'pointer' }}>
                    <defs>
                      <linearGradient id="planGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={C.primaryLt} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={C.primaryLt} stopOpacity={0.12} />
                      </linearGradient>
                      <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={C.primary}   stopOpacity={1} />
                        <stop offset="100%" stopColor={C.primaryDk} stopOpacity={0.92} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.lineSoft} />
                    <XAxis
                      dataKey="month"
                      tickFormatter={(v) => dayjs(`${v}-01`).format('MMM YY')}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: C.slate, fontWeight: 600, fontSize: 11 }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => fmt(v)}
                      tick={{ fill: C.slate, fontWeight: 600, fontSize: 11 }}
                      width={80}
                    />
                    <Tooltip
                      cursor={{ fill: alpha(C.primary, 0.04) }}
                      content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          return (
                            <Paper sx={{ p: 1.5, border: `1px solid ${C.line}`, borderRadius: 2.5, boxShadow: '0 10px 28px rgba(30,58,138,0.12)', minWidth: 180 }}>
                              <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: C.ink, mb: 1, letterSpacing: '0.04em' }}>
                                {dayjs(`${label}-01`).format('MMMM YYYY').toUpperCase()}
                              </Typography>
                              <Box sx={{ display: 'flex', gap: 2.5 }}>
                                <Box>
                                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.slate, letterSpacing: '0.08em' }}>PLANNED</Typography>
                                  <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: C.primaryDk }}>{fmt(payload[0].value)}</Typography>
                                </Box>
                                <Box>
                                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.success, letterSpacing: '0.08em' }}>ACTUAL</Typography>
                                  <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: C.success }}>{fmt(payload[1].value)}</Typography>
                                </Box>
                              </Box>
                              <Typography sx={{ mt: 1, fontSize: '0.75rem', fontWeight: 700, color: C.primary }}>
                                {payload[1].payload.achievementPct}% Achievement
                              </Typography>
                            </Paper>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="plannedQty" name="Planned" fill="url(#planGrad)" radius={[8, 8, 0, 0]} barSize={36} />
                    <Bar dataKey="actualQty"  name="Actual"  fill="url(#actualGrad)" radius={[8, 8, 0, 0]} barSize={36}>
                      {monthlyTrend.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.month === selectedMonth ? C.success : 'url(#actualGrad)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Box>
          </Section>
        </Grid>

        {/* ─── Achievement Mix ─────────────────────────────────────────── */}
        <Grid item xs={12} lg={4}>
          <Section sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <SectionHeader title="Achievement Mix" subtitle="Overall order fulfillment status." />
            <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              <Box sx={{ position: 'absolute', textAlign: 'center' }}>
                <Typography sx={{ fontSize: '2.4rem', fontWeight: 800, color: C.success, letterSpacing: '-0.02em', lineHeight: 1 }}>
                  {summary.fulfillmentPct || 0}%
                </Typography>
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: C.slate, letterSpacing: '0.12em', mt: 0.5 }}>
                  FULFILLED
                </Typography>
              </Box>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <defs>
                    <linearGradient id="dispatchedGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%"   stopColor={C.successLt} />
                      <stop offset="100%" stopColor={C.success} />
                    </linearGradient>
                  </defs>
                  <Pie
                    data={fulfillmentData}
                    innerRadius={78}
                    outerRadius={104}
                    paddingAngle={6}
                    dataKey="value"
                    stroke="none"
                  >
                    <Cell fill="url(#dispatchedGrad)" />
                    <Cell fill={C.lineSoft} />
                  </Pie>
                  <Tooltip formatter={(v) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
            </Box>
            <Box sx={{ mt: 1.5, display: 'flex', gap: 3, justifyContent: 'center' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '3px', background: `linear-gradient(135deg, ${C.successLt}, ${C.success})` }} />
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: C.slate, letterSpacing: '0.06em' }}>DISPATCHED</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: C.lineSoft, border: `1px solid ${C.line}` }} />
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: C.slate, letterSpacing: '0.06em' }}>PENDING</Typography>
              </Box>
            </Box>
          </Section>
        </Grid>

        {/* ─── Client Balance Risk ─────────────────────────────────────── */}
        <Grid item xs={12} lg={5}>
          <Section>
            <SectionHeader
              title="Client Balance Risk"
              subtitle="Top clients with highest pending quantities."
              right={
                <IconButton size="small" sx={{ color: C.slate }}>
                  <Filter size={17} />
                </IconButton>
              }
            />
            <Stack spacing={1.5}>
              {(isLoading ? Array.from({ length: 6 }) : clientRisk.slice(0, 7)).map((row, index) => {
                const pct = row?.orderQty ? (row.balanceQty / row.orderQty) * 100 : 0;
                const isActive = selectedClient === row?.partyName;
                return (
                  <Box
                    key={row?.partyId || index}
                    onClick={() => handleClientClick(row)}
                    sx={{
                      cursor: 'pointer',
                      p: 1.5,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: isActive ? alpha(C.info, 0.35) : 'transparent',
                      bgcolor: isActive ? alpha(C.info, 0.05) : 'transparent',
                      transition: 'all 180ms ease',
                      '&:hover': { bgcolor: alpha(C.info, 0.04), borderColor: alpha(C.info, 0.20) },
                    }}
                  >
                    {isLoading ? (
                      <Skeleton height={40} />
                    ) : (
                      <>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                          <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: C.ink }}>{row.partyName}</Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: C.error }}>{fmt(row.balanceQty)}</Typography>
                            <ChevronRight size={14} color={C.faint} />
                          </Box>
                        </Box>
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(pct, 100)}
                          sx={{
                            height: 6, borderRadius: 999, bgcolor: C.lineSoft,
                            '& .MuiLinearProgress-bar': {
                              borderRadius: 999,
                              background: `linear-gradient(90deg, ${C.errorLt} 0%, ${C.error} 100%)`,
                            },
                          }}
                        />
                      </>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Section>
        </Grid>

        {/* ─── Upcoming Dispatches ─────────────────────────────────────── */}
        <Grid item xs={12} lg={7}>
          <Section sx={{ height: '100%' }}>
            <SectionHeader
              title={selectedMonth || selectedClient ? 'Filtered Dispatches' : 'Upcoming Dispatches'}
              subtitle={`Next 7 days schedule ${selectedMonth ? `for ${dayjs(`${selectedMonth}-01`).format('MMM YY')}` : ''}`.trim()}
              right={
                <Chip
                  label={`${filteredUpcoming.length} Items`}
                  size="small"
                  sx={{
                    fontWeight: 700,
                    bgcolor: alpha(C.primary, 0.10),
                    color: C.primaryDk,
                    border: `1px solid ${alpha(C.primary, 0.20)}`,
                  }}
                />
              }
            />

            <Stack spacing={1.25}>
              {filteredUpcoming.length === 0 && !isLoading && (
                <Box
                  sx={{
                    py: 7,
                    textAlign: 'center',
                    bgcolor: C.surfaceAlt,
                    borderRadius: 3,
                    border: `1px dashed ${C.line}`,
                  }}
                >
                  <CalendarClock size={40} color={C.faint} style={{ opacity: 0.5, marginBottom: 12 }} />
                  <Typography sx={{ fontSize: '0.88rem', fontWeight: 600, color: C.slate }}>
                    No dispatches found for this filter
                  </Typography>
                </Box>
              )}
              {filteredUpcoming.slice(0, 10).map((row, index) => (
                <Box
                  key={index}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: '110px 1fr 110px' },
                    gap: 2,
                    p: 1.75,
                    border: '1px solid',
                    borderColor: C.lineSoft,
                    borderRadius: 2.5,
                    alignItems: 'center',
                    bgcolor: C.surface,
                    transition: 'all 180ms ease',
                    '&:hover': {
                      borderColor: alpha(C.primary, 0.4),
                      transform: 'translateX(2px)',
                      boxShadow: '0 6px 18px rgba(30,58,138,0.08)',
                    },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: C.warning }}>
                    <Box
                      sx={{
                        width: 32, height: 32, borderRadius: 2,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: alpha(C.warning, 0.10),
                        border: `1px solid ${alpha(C.warning, 0.20)}`,
                      }}
                    >
                      <CalendarClock size={15} strokeWidth={2.4} />
                    </Box>
                    <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: C.warning }}>
                      {dayjs(row.plannedDate).format('DD MMM')}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, color: C.ink, lineHeight: 1.3 }}>
                      {row.partyName}
                    </Typography>
                    <Typography sx={{ fontSize: '0.74rem', fontWeight: 500, color: C.slate, mt: 0.25 }}>
                      {row.skuName} ({row.skuCode})
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: C.primaryDk, letterSpacing: '-0.01em' }}>
                      {fmt(row.remainingQty)}
                    </Typography>
                    <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: C.slate, letterSpacing: '0.08em' }}>
                      PCS
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Stack>

            {filteredUpcoming.length > 10 && (
              <Button
                fullWidth
                sx={{
                  mt: 2,
                  fontWeight: 700,
                  color: C.primary,
                  borderRadius: 2,
                  '&:hover': { bgcolor: alpha(C.primary, 0.06) },
                }}
              >
                View All Dispatches
              </Button>
            )}
          </Section>
        </Grid>
      </Grid>
    </Box>
  );
}
