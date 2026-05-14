import React, { useState } from 'react';
import {
  Box, Typography, Paper, Grid, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, IconButton,
  Button, TextField, InputAdornment, Tooltip, Chip, Collapse,
  LinearProgress, Badge, Divider
} from '@mui/material';
import {
  Search, Filter, ChevronDown, ChevronUp, ExternalLink,
  AlertCircle, CheckCircle2, Clock, TrendingUp, TrendingDown,
  FileText, LayoutDashboard, MoreVertical, Package
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { useGetOrdersQuery, useGetOrderScheduleQuery } from '../../store/api/orderApi';
import { useGetDispatchDashboardQuery } from '../../store/api/dispatchControlApi';
import dayjs from 'dayjs';

const BRAND = {
  primary: '#2563eb',
  success: '#059669',
  warning: '#d97706',
  error: '#dc2626',
  slate: '#64748b',
  bg: '#f8fafc'
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
  const status = variance < 0 ? 'LACKING' : variance > 0 ? 'AHEAD' : totalActual > 0 ? 'GOOD' : 'PENDING';

  return (
    <React.Fragment>
      <TableRow sx={{ 
        '& > *': { borderBottom: 'unset' }, 
        bgcolor: open ? '#f8faff' : '#fff',
        transition: 'background-color 0.2s',
        '&:hover': { bgcolor: open ? '#f8faff' : '#fcfdfe' }
      }}>
        <TableCell width={40}>
          <IconButton size="small" onClick={() => setOpen(!open)} sx={{ color: BRAND.primary }}>
            {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </IconButton>
        </TableCell>
        <TableCell>
          <Typography variant="body2" fontWeight={800} color={BRAND.primary} sx={{ letterSpacing: '0.5px' }}>{order.soNumber}</Typography>
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
              m: 2, mt: 0, borderRadius: '20px', 
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
                    sx={{ borderRadius: '10px', fontWeight: 800, bgcolor: BRAND.primary, boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)' }}
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
                      p: 2.5, borderRadius: '16px', border: '1px solid #f1f5f9', 
                      bgcolor: '#fcfdfe', '&:hover': { bgcolor: '#fff', borderColor: BRAND.primary }
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
                              <Box sx={{ 
                                p: 1.5, borderRadius: '12px', border: '1px solid #f1f5f9', 
                                bgcolor: '#fff', position: 'relative',
                                transition: 'transform 0.2s', '&:hover': { transform: 'translateY(-4px)' },
                                boxShadow: isLate ? `0 0 10px ${alpha(BRAND.error, 0.15)}` : 'none',
                                borderColor: isLate ? BRAND.error : '#f1f5f9'
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
                                
                                <Box sx={{ bgcolor: '#f8fafc', p: 1, borderRadius: '8px' }}>
                                  {phase.actualDispatches?.map((ad, adIdx) => (
                                    <Box key={adIdx} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: adIdx < phase.actualDispatches.length - 1 ? 0.5 : 0 }}>
                                      <Typography variant="caption" fontWeight={800} color={BRAND.success} sx={{ fontSize: '0.6rem' }}>{ad.qty}</Typography>
                                      <Typography variant="caption" sx={{ fontSize: '0.55rem', color: BRAND.slate }}>{dayjs(ad.date).format('DD/MM')}</Typography>
                                    </Box>
                                  ))}
                                  {(!phase.actualDispatches || phase.actualDispatches.length === 0) && (
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
                    <Box sx={{ p: 6, textAlign: 'center', bgcolor: alpha(BRAND.primary, 0.02), borderRadius: '16px', border: '1px dashed #e2e8f0' }}>
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
  const [searchTerm, setSearchTerm] = useState('');
  const { data: ordersRes, isLoading } = useGetOrdersQuery({ limit: 100, sort: '-orderDate' });
  const orders = ordersRes?.data || [];

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: BRAND.bg, minHeight: '100vh' }}>
      
      {/* ── Header ─────────────────────────────────────────── */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
            <Box sx={{ p: 1, borderRadius: '10px', bgcolor: BRAND.primary, color: '#fff' }}>
              <LayoutDashboard size={24} />
            </Box>
            <Typography variant="h4" fontWeight={900} color="#0b2545">Dispatch Control Tower</Typography>
          </Box>
          <Typography variant="body1" color="text.secondary">Centralized Planned vs Actual Monitoring Hub</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            size="small"
            placeholder="Quick search orders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }}
            sx={{ width: 280, '& .MuiOutlinedInput-root': { bgcolor: '#fff', borderRadius: '10px' } }}
          />
          <Button variant="contained" startIcon={<Filter size={16} />} sx={{ borderRadius: '10px', px: 3, boxShadow: 'none' }}>Filters</Button>
        </Box>
      </Box>

      {/* ── Top Level KPIs ─────────────────────────────────── */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: 2.5, borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase' }}>Overall Adherence</Typography>
            <Typography variant="h4" fontWeight={900} color={BRAND.primary} sx={{ my: 0.5 }}>84%</Typography>
            <LinearProgress variant="determinate" value={84} sx={{ height: 4, borderRadius: 2 }} />
          </Paper>
        </Grid>
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: 2.5, borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center', bgcolor: alpha(BRAND.error, 0.02) }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase' }}>Lacking Orders</Typography>
            <Typography variant="h4" fontWeight={900} color={BRAND.error} sx={{ my: 0.5 }}>12</Typography>
            <Typography variant="caption" fontWeight={700} color={BRAND.error}>Critical attention required</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: 2.5, borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center', bgcolor: alpha(BRAND.success, 0.02) }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase' }}>Perfect Dispatches</Typography>
            <Typography variant="h4" fontWeight={900} color={BRAND.success} sx={{ my: 0.5 }}>45</Typography>
            <Typography variant="caption" fontWeight={700} color={BRAND.success}>On track with plan</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: 2.5, borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase' }}>Pending Balance</Typography>
            <Typography variant="h4" fontWeight={900} color={BRAND.slate} sx={{ my: 0.5 }}>1.2M</Typography>
            <Typography variant="caption" fontWeight={700} color={BRAND.slate}>Units to be shipped</Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* ── Main Comparison Table ──────────────────────────── */}
      <TableContainer component={Paper} sx={{ borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: 'none', overflow: 'hidden' }}>
        <Table stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ bgcolor: '#f8fafc', fontWeight: 900, color: BRAND.slate, fontSize: '0.75rem' }}>BIRD'S EYE VIEW</TableCell>
              <TableCell sx={{ bgcolor: '#f8fafc', fontWeight: 900, color: BRAND.slate, fontSize: '0.75rem' }}>ORDER & CLIENT</TableCell>
              <TableCell align="right" sx={{ bgcolor: '#f8fafc', fontWeight: 900, color: BRAND.slate, fontSize: '0.75rem' }}>TOTAL ORDER</TableCell>
              <TableCell align="right" sx={{ bgcolor: '#f8fafc', fontWeight: 900, color: BRAND.slate, fontSize: '0.75rem' }}>PLANNED</TableCell>
              <TableCell align="right" sx={{ bgcolor: '#f8fafc', fontWeight: 900, color: BRAND.slate, fontSize: '0.75rem' }}>ACTUAL DISPATCH</TableCell>
              <TableCell align="right" sx={{ bgcolor: '#f8fafc', fontWeight: 900, color: BRAND.slate, fontSize: '0.75rem' }}>VARIANCE</TableCell>
              <TableCell align="center" sx={{ bgcolor: '#f8fafc', fontWeight: 900, color: BRAND.slate, fontSize: '0.75rem' }}>ADHERENCE</TableCell>
              <TableCell align="center" sx={{ bgcolor: '#f8fafc', fontWeight: 900, color: BRAND.slate, fontSize: '0.75rem' }}>STATUS</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orders.map((order) => (
              <Row key={order._id} order={order} />
            ))}
            {orders.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 8 }}>
                  <Typography variant="body1" color="text.secondary">No dispatch data found in the centralized hub.</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default DispatchControlTower;
