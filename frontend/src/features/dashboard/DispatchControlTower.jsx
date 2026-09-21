import React, { useState, useMemo } from 'react';
import {
  Box, Typography, Paper, Grid, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, IconButton,
  Button, TextField, InputAdornment, Tooltip, Chip, Collapse,
  LinearProgress, Badge, Stack, Popover, MenuItem, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import {
  Search, Filter, ChevronDown, ChevronUp, ExternalLink,
  AlertCircle, CheckCircle2, Clock, TrendingUp, TrendingDown,
  FileText, MoreVertical, Package
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { useGetOrdersQuery, useGetOrderScheduleQuery } from '../../store/api/orderApi';
import { useGetDispatchDashboardQuery, useGetPhaseMatrixQuery } from '../../store/api/dispatchControlApi';
import dayjs from 'dayjs';

// Phase lifecycle → colour for the All-Phases matrix.
const PHASE_STATUS = {
  PLANNED:     { color: '#2563eb', label: 'Planned' },
  IN_PROGRESS: { color: '#d97706', label: 'In Progress' },
  DISPATCHED:  { color: '#059669', label: 'Dispatched' },
  DELAYED:     { color: '#dc2626', label: 'Delayed' },
  CANCELLED:   { color: '#64748b', label: 'Cancelled' },
};

// Neutrals follow the client's WARM palette (o2dTheme); status hues stay saturated.
const BRAND = {
  primary: '#2563eb',
  success: '#059669',
  warning: '#d97706',
  error: '#dc2626',
  slate: '#6b7280',
  ink: '#1c1e21',
  line: '#e4e1d9',
  lineSoft: '#eeebe4',
  surfaceAlt: '#f7f6f2',
  bg: '#e9e7e1',
};

const ORDER_STATUSES = ['RECEIVED', 'PLANNING', 'IN_PROGRESS', 'COMPLETED', 'SHORT_CLOSED', 'CANCELLED'];
const HEALTH_OPTIONS = [
  { key: 'GOOD', label: 'On Track' },
  { key: 'LACKING', label: 'Lacking' },
  { key: 'AHEAD', label: 'Ahead' },
  { key: 'PENDING', label: 'Pending' },
];

// Derived dispatch health of an order — same logic the row badge shows.
const healthOf = (o) => {
  const variance = (o.totalDispatchedQty || 0) - (o.totalOrderQty || 0);
  if (variance < 0) return 'LACKING';
  if (variance > 0) return 'AHEAD';
  return (o.totalDispatchedQty || 0) > 0 ? 'GOOD' : 'PENDING';
};

const StatusChip = ({ status }) => {
  const map = {
    GOOD: { color: BRAND.success, label: 'ON TRACK' },
    LACKING: { color: BRAND.error, label: 'LACKING' },
    AHEAD: { color: BRAND.primary, label: 'AHEAD' },
    PENDING: { color: BRAND.warning, label: 'PENDING' },
  };
  const cfg = map[status] || map.PENDING;
  return (
    <Chip
      label={cfg.label}
      size="small"
      sx={{
        bgcolor: alpha(cfg.color, 0.08),
        color: cfg.color,
        fontWeight: 800,
        fontSize: '0.65rem',
        borderRadius: '6px',
        border: `1px solid ${alpha(cfg.color, 0.2)}`
      }}
    />
  );
};

// ── Compact real-data KPI card ──────────────────────────────────────
const StatCard = ({ label, value, sub, icon: Icon, color, bar, loading }) => (
  <Paper sx={{
    p: 1.5, borderRadius: '8px', border: `1px solid ${BRAND.line}`, height: '100%',
    bgcolor: '#fff', transition: 'transform .16s ease, box-shadow .16s ease',
    '&:hover': { transform: 'translateY(-2px)', boxShadow: `0 10px 24px ${alpha(color, 0.14)}` },
  }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.85 }}>
      <Box sx={{
        width: 30, height: 30, borderRadius: '6px', flexShrink: 0,
        display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.1), color,
        border: `1px solid ${alpha(color, 0.18)}`,
      }}>
        <Icon size={16} strokeWidth={2.3} />
      </Box>
      <Typography sx={{
        fontSize: '0.6rem', fontWeight: 800, color: BRAND.slate,
        textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1.2,
      }}>
        {label}
      </Typography>
    </Box>
    {loading ? (
      <LinearProgress sx={{ my: 1.25, borderRadius: 2 }} />
    ) : (
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 900, color: '#0b2545', lineHeight: 1.1 }}>
        {value}
      </Typography>
    )}
    {bar != null && !loading && (
      <LinearProgress variant="determinate" value={Math.min(bar, 100)}
        sx={{ mt: 0.75, height: 5, borderRadius: 3, bgcolor: alpha(color, 0.12),
          '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 3 } }} />
    )}
    {sub && !loading && (
      <Typography sx={{ fontSize: '0.64rem', fontWeight: 600, color: BRAND.slate, mt: 0.4 }}>
        {sub}
      </Typography>
    )}
  </Paper>
);

const Row = ({ order }) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  
  // LIVE DATA FETCHING: Only fetch deep details when expanded
  const { data: scheduleRes } = useGetOrderScheduleQuery(order.soNumber, { skip: !open });
  const schedule = scheduleRes?.data?.[0];

  // Intelligence Logic
  const totalPlanned = order.totalOrderQty || 0;
  const totalActual = order.totalDispatchedQty || 0;
  const variance = totalActual - totalPlanned;
  const adherence = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;
  const status = healthOf(order);

  return (
    <React.Fragment>
      <TableRow sx={{ 
        '& > *': { borderBottom: 'unset' }, 
        bgcolor: open ? BRAND.surfaceAlt : '#fff',
        transition: 'background-color 0.2s',
        '&:hover': { bgcolor: BRAND.surfaceAlt }
      }}>
        <TableCell width={40}>
          <IconButton size="small" onClick={() => setOpen(!open)} sx={{ color: BRAND.primary }}>
            {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </IconButton>
        </TableCell>
        <TableCell
          onClick={() => navigate(`/orders/${order._id}`)}
          sx={{ cursor: 'pointer' }}
        >
          <Typography
            variant="body2"
            fontWeight={800}
            color={BRAND.primary}
            sx={{ letterSpacing: '0.5px', '&:hover': { textDecoration: 'underline' } }}
          >
            {order.soNumber}
          </Typography>
          <Typography variant="caption" color="text.secondary" fontWeight={700}>{order.partyName}</Typography>
        </TableCell>
        <TableCell align="right">
          <Typography variant="body2" fontWeight={800}>{order.totalOrderQty?.toLocaleString()}</Typography>
        </TableCell>
        <TableCell align="right">
          <Typography variant="body2" fontWeight={700} color={BRAND.slate}>{order.totalOrderQty?.toLocaleString()}</Typography>
        </TableCell>
        <TableCell align="right">
          <Typography variant="body2" fontWeight={800} color={BRAND.success}>{order.totalDispatchedQty?.toLocaleString()}</Typography>
        </TableCell>
        <TableCell align="right">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
            {variance < 0 ? <TrendingDown size={14} color={BRAND.error} /> : <TrendingUp size={14} color={BRAND.success} />}
            <Typography variant="body2" fontWeight={800} color={variance < 0 ? BRAND.error : BRAND.success}>
              {variance === 0 ? '0' : (variance > 0 ? `+${variance}` : variance)}
            </Typography>
          </Box>
        </TableCell>
        <TableCell align="center">
          <Box sx={{ width: '100%', maxWidth: 100 }}>
            <LinearProgress 
              variant="determinate" 
              value={Math.min(adherence, 100)} 
              sx={{ 
                height: 8, borderRadius: 4, 
                bgcolor: alpha(BRAND.slate, 0.1),
                '& .MuiLinearProgress-bar': { 
                  bgcolor: adherence >= 100 ? BRAND.success : adherence > 50 ? BRAND.primary : BRAND.error,
                  borderRadius: 4
                }
              }} 
            />
            <Typography variant="caption" fontWeight={800} sx={{ mt: 0.5, display: 'block', fontSize: '0.55rem', color: BRAND.slate }}>{adherence}% ADHERENCE</Typography>
          </Box>
        </TableCell>
        <TableCell align="center">
          <StatusChip status={status} />
        </TableCell>
      </TableRow>
      
      {/* ── Premium Expansion View ────────────────────────── */}
      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={8}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ 
              p: 4, bgcolor: '#fff', 
              m: 1.5, mt: 0, borderRadius: '8px', 
              border: '1px solid #eef2f6',
              boxShadow: '0 10px 30px rgba(0,0,0,0.03)'
            }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Package size={20} color={BRAND.primary} />
                    <Typography variant="h6" fontWeight={900} color="#0b2545">Live Dispatch Matrix</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" fontWeight={600}>Real-time analysis of sub-items and phased delivery audit</Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  <Button size="small" variant="text" startIcon={<FileText size={16} />} sx={{ fontWeight: 800, color: BRAND.slate }}>Audit Log</Button>
                  <Button 
                    size="small" 
                    variant="contained" 
                    onClick={() => navigate(`/orders/${order._id}`)} 
                    sx={{ borderRadius: '6px', fontWeight: 800, textTransform: 'none', bgcolor: BRAND.primary, boxShadow: 'none' }}
                  >
                    Manage Order
                  </Button>
                </Box>
              </Box>

              {/* Nested SKU Cards */}
              <Grid container spacing={2.5}>
                {schedule?.items?.map((item, idx) => (
                  <Grid item xs={12} key={idx}>
                    <Paper sx={{ 
                      p: 2, borderRadius: '8px', border: `1px solid ${BRAND.line}`, 
                      bgcolor: BRAND.surfaceAlt, '&:hover': { bgcolor: '#fff', borderColor: BRAND.primary }
                    }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2.5, alignItems: 'flex-start' }}>
                        <Box>
                          <Typography variant="subtitle2" fontWeight={900} color={BRAND.primary}>{item.skuName}</Typography>
                          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: '1px' }}>SKU CODE: {item.skuCode}</Typography>
                        </Box>
                        <Box sx={{ textAlign: 'right' }}>
                          <Typography variant="caption" fontWeight={700} color="text.secondary" display="block">TOTAL BAL.</Typography>
                          <Typography variant="body2" fontWeight={900} color={BRAND.error}>{item.balanceQty?.toLocaleString()}</Typography>
                        </Box>
                      </Box>

                      <Grid container spacing={2}>
                        {item.phases?.map((phase, pIdx) => {
                          const isLate = dayjs(phase.plannedDate).isBefore(dayjs()) && phase.status !== 'COMPLETE';
                          const remain = phase.plannedQty - (phase.totalActualQty || 0);
                          const delayDays = isLate ? dayjs().diff(dayjs(phase.plannedDate), 'day') : 0;

                          return (
                            <Grid item xs={12} md={3} lg={2.4} key={pIdx}>
                              <Box
                                onClick={() => navigate(`/orders/${order._id}/phase/${phase.phaseNo}`)}
                                sx={{
                                  p: 1.5, borderRadius: '6px', border: `1px solid ${BRAND.line}`,
                                  bgcolor: '#fff', position: 'relative', cursor: 'pointer',
                                  transition: 'transform 0.2s, box-shadow 0.2s',
                                  '&:hover': { transform: 'translateY(-4px)', boxShadow: `0 10px 22px ${alpha(BRAND.primary, 0.16)}`, borderColor: BRAND.primary },
                                  boxShadow: isLate ? `0 0 10px ${alpha(BRAND.error, 0.15)}` : 'none',
                                  borderColor: isLate ? BRAND.error : BRAND.line,
                                }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, alignItems: 'center' }}>
                                  <Typography variant="caption" fontWeight={900} color="text.secondary">{phase.phaseNo}</Typography>
                                  {isLate && (
                                    <Tooltip title={`Delayed by ${delayDays} days`}>
                                      <Chip 
                                        label={`${delayDays}d LATE`} 
                                        size="small" 
                                        sx={{ height: 16, fontSize: '0.5rem', fontWeight: 900, bgcolor: BRAND.error, color: '#fff' }} 
                                      />
                                    </Tooltip>
                                  )}
                                  {!isLate && (
                                    <Chip 
                                      label={phase.status} 
                                      size="small" 
                                      sx={{ 
                                        height: 16, fontSize: '0.5rem', fontWeight: 900,
                                        bgcolor: alpha(phase.status === 'COMPLETE' ? BRAND.success : BRAND.warning, 0.1),
                                        color: phase.status === 'COMPLETE' ? BRAND.success : BRAND.warning 
                                      }} 
                                    />
                                  )}
                                </Box>
                                
                                <Typography variant="caption" fontWeight={700} color={isLate ? BRAND.error : BRAND.slate} display="block">
                                  {dayjs(phase.plannedDate).format('DD MMM YYYY')}
                                </Typography>
                                
                                <Box sx={{ mt: 1, mb: 1.5 }}>
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Typography variant="caption" fontWeight={600} color="text.secondary">PLAN:</Typography>
                                    <Typography variant="body2" fontWeight={900}>{phase.plannedQty?.toLocaleString()}</Typography>
                                  </Box>
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Typography variant="caption" fontWeight={600} color={BRAND.success}>ACTUAL:</Typography>
                                    <Typography variant="body2" fontWeight={900} color={BRAND.success}>{(phase.totalActualQty || 0).toLocaleString()}</Typography>
                                  </Box>
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5, pt: 0.5, borderTop: '1px dashed #f1f5f9' }}>
                                    <Typography variant="caption" fontWeight={700} color={remain > 0 ? BRAND.error : BRAND.slate}>REMAIN:</Typography>
                                    <Typography variant="body2" fontWeight={900} color={remain > 0 ? BRAND.error : BRAND.slate}>{remain.toLocaleString()}</Typography>
                                  </Box>
                                </Box>
                                
                                <Box sx={{ bgcolor: BRAND.surfaceAlt, p: 1, borderRadius: '6px' }}>
                                  {(phase.actualDispatches || []).filter((ad) => !ad.cancelled).map((ad, adIdx) => (
                                    <Box key={adIdx} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: adIdx < (phase.actualDispatches || []).filter((x) => !x.cancelled).length - 1 ? 0.5 : 0 }}>
                                      <Typography variant="caption" fontWeight={800} color={BRAND.success} sx={{ fontSize: '0.6rem' }}>{ad.qty}</Typography>
                                      <Typography variant="caption" sx={{ fontSize: '0.55rem', color: BRAND.slate }}>{dayjs(ad.date).format('DD/MM')}</Typography>
                                    </Box>
                                  ))}
                                  {(phase.actualDispatches || []).filter((ad) => !ad.cancelled).length === 0 && (
                                    <Typography variant="caption" color="text.disabled" fontWeight={700} sx={{ fontSize: '0.6rem' }}>Waiting...</Typography>
                                  )}
                                </Box>
                              </Box>
                            </Grid>
                          );
                        })}
                      </Grid>
                    </Paper>
                  </Grid>
                ))}
                {!schedule && (
                  <Grid item xs={12}>
                    <Box sx={{ p: 6, textAlign: 'center', bgcolor: BRAND.surfaceAlt, borderRadius: '8px', border: `1px dashed ${BRAND.line}` }}>
                      <Clock size={40} color={BRAND.slate} style={{ opacity: 0.5, marginBottom: 12 }} />
                      <Typography variant="body1" fontWeight={700} color="text.secondary">No Active Dispatch Schedule Found</Typography>
                      <Typography variant="caption" color="text.secondary">Please create a dispatch plan for this order to see deep analytics.</Typography>
                    </Box>
                  </Grid>
                )}
              </Grid>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>

    </React.Fragment>
  );
};

const DispatchControlTower = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAnchor, setFilterAnchor] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState('');
  const [view, setView] = useState('orders'); // 'orders' | 'phases'
  const { data: ordersRes, isLoading } = useGetOrdersQuery({ limit: 100, sort: '-orderDate' });
  const { data: dashRes } = useGetDispatchDashboardQuery();
  const { data: matrixRes, isLoading: matrixLoading } = useGetPhaseMatrixQuery(undefined, { skip: view !== 'phases' });
  const orders = ordersRes?.data || [];
  const summary = dashRes?.data?.summary || {};
  const planHealth = dashRes?.data?.planHealth || {};

  // Flat phase matrix — search + order-status filters reused from above.
  const matrixRows = useMemo(() => {
    const all = matrixRes?.data || [];
    const q = searchTerm.trim().toLowerCase();
    return all.filter((r) => {
      if (q && !(`${r.soNumber} ${r.partyName} ${r.skuName} ${r.skuCode} ${r.phaseNo}`.toLowerCase().includes(q))) return false;
      if (statusFilter && r.orderStatus !== statusFilter) return false;
      return true;
    });
  }, [matrixRes, searchTerm, statusFilter]);

  // Search + status + dispatch-health filters all drive the visible table.
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return orders.filter((o) => {
      if (q && !((o.soNumber || '').toLowerCase().includes(q)
        || (o.partyName || '').toLowerCase().includes(q))) return false;
      if (statusFilter && o.status !== statusFilter) return false;
      if (healthFilter && healthOf(o) !== healthFilter) return false;
      return true;
    });
  }, [orders, searchTerm, statusFilter, healthFilter]);

  const activeFilters = (statusFilter ? 1 : 0) + (healthFilter ? 1 : 0);
  const clearFilters = () => { setStatusFilter(''); setHealthFilter(''); };

  // ── Six real-data KPIs ───────────────────────────────────────────
  const fmt = (v) => Number(v || 0).toLocaleString('en-IN');
  const totalOrders = summary.totalOrders ?? orders.length;
  const orderVol    = summary.totalOrderQty ?? orders.reduce((s, o) => s + (o.totalOrderQty || 0), 0);
  const dispatched  = summary.totalDispatchedQty ?? orders.reduce((s, o) => s + (o.totalDispatchedQty || 0), 0);
  const pending     = summary.totalBalanceQty ?? orders.reduce((s, o) => s + (o.totalBalanceQty || 0), 0);
  const adherence   = summary.fulfillmentPct ?? (orderVol > 0 ? Math.round((dispatched / orderVol) * 100) : 0);
  const onTrack     = orders.filter((o) => (o.totalOrderQty || 0) > 0 && (o.totalBalanceQty || 0) <= 0).length;
  const lacking     = orders.filter((o) => (o.totalDispatchedQty || 0) < (o.totalOrderQty || 0)).length;
  const overdueQty  = planHealth.overduePlanQty || 0;
  const overdueCnt  = planHealth.overduePlanCount || 0;
  const adhColor    = adherence >= 90 ? BRAND.success : adherence >= 50 ? BRAND.primary : BRAND.error;

  const stats = [
    { label: 'Total Orders',      value: fmt(totalOrders), sub: `${fmt(orderVol)} units ordered`,   icon: Package,      color: BRAND.primary },
    { label: 'Overall Adherence', value: `${adherence}%`,  sub: 'dispatched vs ordered',             icon: TrendingUp,   color: adhColor, bar: adherence },
    { label: 'On-Track Orders',   value: fmt(onTrack),     sub: 'fully dispatched',                  icon: CheckCircle2, color: BRAND.success },
    { label: 'Lacking Orders',    value: fmt(lacking),     sub: 'still behind plan',                 icon: TrendingDown, color: BRAND.error },
    { label: 'Dispatched',        value: fmt(dispatched),  sub: 'units shipped',                     icon: ExternalLink, color: BRAND.success },
    { label: 'Pending Balance',   value: fmt(pending),     sub: `${overdueCnt} phase(s) overdue · ${fmt(overdueQty)}`, icon: Clock, color: BRAND.warning },
  ];

  return (
    <Box sx={{ p: { xs: 1.5, md: 2 }, bgcolor: BRAND.bg, minHeight: '100vh' }}>
      
      {/* ── Header ─────────────────────────────────────────── */}
      <Box sx={{ mb: 1.5, px: { xs: 1.5, md: 2 }, py: 1.25, borderRadius: '8px', bgcolor: '#fff', border: `1px solid ${BRAND.line}` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.25 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: BRAND.ink, lineHeight: 1.2 }}>Dispatch Control Tower</Typography>
            <Typography noWrap sx={{ fontSize: '0.74rem', color: BRAND.slate }}>Centralized Planned vs Actual Monitoring Hub</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}
              sx={{ bgcolor: '#fff', borderRadius: '6px', '& .MuiToggleButton-root': { px: 1.25, py: 0.4, fontSize: '0.75rem', textTransform: 'none', fontWeight: 800, borderRadius: '6px', border: `1px solid ${BRAND.line}` } }}>
              <ToggleButton value="orders">By Order</ToggleButton>
              <ToggleButton value="phases">All Phases</ToggleButton>
            </ToggleButtonGroup>
            <TextField
              size="small"
              placeholder="Quick search orders..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }}
              sx={{ width: 240, '& .MuiOutlinedInput-root': { bgcolor: '#fff', borderRadius: '6px' } }}
            />
            <Badge color="error" badgeContent={activeFilters} invisible={activeFilters === 0} overlap="circular">
              <Button
                variant={activeFilters ? 'contained' : 'outlined'}
                startIcon={<Filter size={16} />}
                onClick={(e) => setFilterAnchor(e.currentTarget)}
                sx={{ borderRadius: '6px', px: 2, textTransform: 'none', fontWeight: 700, boxShadow: 'none', bgcolor: activeFilters ? BRAND.primary : '#fff', borderColor: BRAND.line }}
              >
                Filters
              </Button>
            </Badge>
          </Box>
        </Box>
      </Box>

      {/* ── Active filter chips ────────────────────────────── */}
      {(activeFilters > 0 || searchTerm) && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap alignItems="center">
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: BRAND.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Showing {filtered.length} of {orders.length}
          </Typography>
          {searchTerm && (
            <Chip size="small" label={`Search: ${searchTerm}`} onDelete={() => setSearchTerm('')}
              sx={{ fontWeight: 700, bgcolor: alpha(BRAND.primary, 0.08), color: BRAND.primary }} />
          )}
          {statusFilter && (
            <Chip size="small" label={`Status: ${statusFilter.replace('_', ' ')}`} onDelete={() => setStatusFilter('')}
              sx={{ fontWeight: 700, bgcolor: alpha(BRAND.primary, 0.08), color: BRAND.primary }} />
          )}
          {healthFilter && (
            <Chip size="small"
              label={`Health: ${HEALTH_OPTIONS.find((h) => h.key === healthFilter)?.label || healthFilter}`}
              onDelete={() => setHealthFilter('')}
              sx={{ fontWeight: 700, bgcolor: alpha(BRAND.primary, 0.08), color: BRAND.primary }} />
          )}
        </Stack>
      )}

      {/* ── Top Level KPIs — 6 real-data cards ─────────────── */}
      <Grid container spacing={1.75} sx={{ mb: 3 }}>
        {stats.map((s) => (
          <Grid item xs={6} sm={4} md={2} key={s.label}>
            <StatCard {...s} loading={isLoading} />
          </Grid>
        ))}
      </Grid>

      {/* ── Main Comparison Table (By Order) ───────────────── */}
      {view === 'orders' && (
      <TableContainer component={Paper} sx={{ borderRadius: '8px', border: `1px solid ${BRAND.line}`, boxShadow: 'none', overflow: 'hidden', '& td': { borderColor: BRAND.lineSoft } }}>
        <Table stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ bgcolor: BRAND.surfaceAlt, fontWeight: 800, color: BRAND.slate, fontSize: '0.66rem', letterSpacing: '0.04em', borderColor: BRAND.line, whiteSpace: 'nowrap' }}>BIRD'S EYE VIEW</TableCell>
              <TableCell sx={{ bgcolor: BRAND.surfaceAlt, fontWeight: 800, color: BRAND.slate, fontSize: '0.66rem', letterSpacing: '0.04em', borderColor: BRAND.line, whiteSpace: 'nowrap' }}>ORDER & CLIENT</TableCell>
              <TableCell align="right" sx={{ bgcolor: BRAND.surfaceAlt, fontWeight: 800, color: BRAND.slate, fontSize: '0.66rem', letterSpacing: '0.04em', borderColor: BRAND.line, whiteSpace: 'nowrap' }}>TOTAL ORDER</TableCell>
              <TableCell align="right" sx={{ bgcolor: BRAND.surfaceAlt, fontWeight: 800, color: BRAND.slate, fontSize: '0.66rem', letterSpacing: '0.04em', borderColor: BRAND.line, whiteSpace: 'nowrap' }}>PLANNED</TableCell>
              <TableCell align="right" sx={{ bgcolor: BRAND.surfaceAlt, fontWeight: 800, color: BRAND.slate, fontSize: '0.66rem', letterSpacing: '0.04em', borderColor: BRAND.line, whiteSpace: 'nowrap' }}>ACTUAL DISPATCH</TableCell>
              <TableCell align="right" sx={{ bgcolor: BRAND.surfaceAlt, fontWeight: 800, color: BRAND.slate, fontSize: '0.66rem', letterSpacing: '0.04em', borderColor: BRAND.line, whiteSpace: 'nowrap' }}>VARIANCE</TableCell>
              <TableCell align="center" sx={{ bgcolor: BRAND.surfaceAlt, fontWeight: 800, color: BRAND.slate, fontSize: '0.66rem', letterSpacing: '0.04em', borderColor: BRAND.line, whiteSpace: 'nowrap' }}>ADHERENCE</TableCell>
              <TableCell align="center" sx={{ bgcolor: BRAND.surfaceAlt, fontWeight: 800, color: BRAND.slate, fontSize: '0.66rem', letterSpacing: '0.04em', borderColor: BRAND.line, whiteSpace: 'nowrap' }}>STATUS</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((order) => (
              <Row key={order._id} order={order} />
            ))}
            {filtered.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 8 }}>
                  <Typography variant="body1" color="text.secondary">
                    {searchTerm ? `No orders match "${searchTerm}".` : 'No dispatch data found in the centralized hub.'}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      )}

      {/* ── Plan vs Actual — All Phases matrix ─────────────── */}
      {view === 'phases' && (
        <TableContainer component={Paper} sx={{ borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: 'none', overflow: 'hidden' }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                {['ORDER', 'CLIENT', 'SKU', 'PHASE', 'PLAN DATE', 'PLANNED', 'EFFECTIVE', 'ACTUAL', 'PENDING', 'DELAY', 'STATUS'].map((h, i) => (
                  <TableCell key={h} align={i >= 5 && i <= 9 ? 'right' : 'left'}
                    sx={{ bgcolor: '#f8fafc', fontWeight: 900, color: BRAND.slate, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {matrixRows.map((r) => {
                const ps = PHASE_STATUS[r.status] || PHASE_STATUS.PLANNED;
                return (
                  <TableRow key={r.id} hover sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/orders?so=${encodeURIComponent(r.soNumber)}`)}>
                    <TableCell sx={{ fontWeight: 800, color: BRAND.primary, fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{r.soNumber}</TableCell>
                    <TableCell sx={{ fontSize: '0.78rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.partyName}</TableCell>
                    <TableCell sx={{ fontSize: '0.78rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.skuName}<br /><span style={{ color: BRAND.slate, fontSize: '0.68rem' }}>{r.skuCode}</span>
                    </TableCell>
                    <TableCell><Chip size="small" label={r.phaseNo} sx={{ height: 20, fontWeight: 800, bgcolor: alpha(BRAND.primary, 0.08), color: BRAND.primary }} /></TableCell>
                    <TableCell sx={{ fontSize: '0.76rem', whiteSpace: 'nowrap' }}>{r.plannedDate ? dayjs(r.plannedDate).format('DD MMM YY') : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.plannedQty)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: r.carryInQty ? BRAND.warning : 'inherit' }}>{fmt(r.effectivePlannedQty)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: BRAND.success }}>{fmt(r.actualQty)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: r.pendingQty > 0 ? BRAND.warning : BRAND.slate }}>{fmt(r.pendingQty)}</TableCell>
                    <TableCell align="right">
                      {r.delayDays > 0
                        ? <Chip size="small" icon={<Clock size={11} />} label={`${r.delayDays}d`} sx={{ height: 20, fontWeight: 800, fontSize: '0.66rem', bgcolor: alpha(BRAND.error, 0.10), color: BRAND.error, '& .MuiChip-icon': { color: BRAND.error } }} />
                        : <Typography sx={{ fontSize: '0.76rem', color: BRAND.slate }}>—</Typography>}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={ps.label} sx={{ height: 20, fontWeight: 800, fontSize: '0.64rem', bgcolor: alpha(ps.color, 0.10), color: ps.color }} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {matrixRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} align="center" sx={{ py: 8 }}>
                    <Typography variant="body1" color="text.secondary">
                      {matrixLoading ? 'Loading phases…' : 'No planned phases found.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* ── Filter popover ─────────────────────────────────── */}
      <Popover
        open={Boolean(filterAnchor)}
        anchorEl={filterAnchor}
        onClose={() => setFilterAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { p: 2.5, width: 310, borderRadius: '14px', mt: 1 } }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <Filter size={16} color={BRAND.primary} />
          <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }}>Filter Orders</Typography>
        </Stack>

        <TextField
          select fullWidth size="small" label="Order Status" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)} sx={{ mb: 2 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {ORDER_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>{s.replace('_', ' ')}</MenuItem>
          ))}
        </TextField>

        <TextField
          select fullWidth size="small" label="Dispatch Health" value={healthFilter}
          onChange={(e) => setHealthFilter(e.target.value)} sx={{ mb: 2.5 }}
        >
          <MenuItem value="">Any health</MenuItem>
          {HEALTH_OPTIONS.map((h) => (
            <MenuItem key={h.key} value={h.key}>{h.label}</MenuItem>
          ))}
        </TextField>

        <Stack direction="row" spacing={1}>
          <Button fullWidth onClick={() => { clearFilters(); }} sx={{ fontWeight: 700 }}>
            Clear all
          </Button>
          <Button fullWidth variant="contained" onClick={() => setFilterAnchor(null)}
            sx={{ fontWeight: 700, boxShadow: 'none' }}>
            Apply
          </Button>
        </Stack>
      </Popover>
    </Box>
  );
};

export default DispatchControlTower;
