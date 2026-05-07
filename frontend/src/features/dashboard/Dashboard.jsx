import React from 'react';
import { Box, Typography, Grid, Paper, Card, CardContent, LinearProgress, Skeleton } from '@mui/material';
import { ShoppingCart, CheckCircle, Clock, TrendingUp, AlertCircle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { alpha } from '@mui/material/styles';
import { useGetOrdersQuery } from '../../store/api/orderApi';
import { useGetInvoicesQuery } from '../../store/api/fmsApi';

const BRAND = { primary: '#2563eb', success: '#059669', warning: '#d97706', error: '#dc2626', wip: '#7c3aed' };

const StatCard = ({ title, value, icon: Icon, color, trend, loading }) => (
  <Card sx={{
    height: '100%', border: '1px solid #e2e8f0', borderRadius: '16px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)', transition: 'all 0.2s ease',
    '&:hover': { boxShadow: `0 4px 20px ${alpha(color, 0.15)}`, borderColor: alpha(color, 0.3) }
  }}>
    <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
        <Box sx={{ p: 1, borderRadius: '10px', bgcolor: alpha(color, 0.08), color, display: 'flex' }}>
          <Icon size={20} strokeWidth={2.5} />
        </Box>
        {trend && !loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, px: 1, py: 0.3, borderRadius: '6px', bgcolor: alpha('#059669', 0.06) }}>
            <TrendingUp size={12} color="#059669" />
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#059669' }}>{trend}</Typography>
          </Box>
        )}
      </Box>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5 }}>
        {title}
      </Typography>
      {loading ? (
        <Skeleton variant="text" width="70%" height={36} />
      ) : (
        <Typography sx={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
          {value}
        </Typography>
      )}
    </CardContent>
  </Card>
);

const Dashboard = () => {
  const { data: ordersData, isLoading: ordersLoading } = useGetOrdersQuery({ limit: 100 });
  const { data: invoicesData, isLoading: invoicesLoading } = useGetInvoicesQuery({ limit: 100 });

  const dispatchTrendData = [
    { name: 'Mon', value: 400 }, { name: 'Tue', value: 300 }, { name: 'Wed', value: 600 },
    { name: 'Thu', value: 800 }, { name: 'Fri', value: 500 }, { name: 'Sat', value: 900 }, { name: 'Sun', value: 700 },
  ];

  const bottleneckData = [
    { name: 'PO Entry', value: 95, color: BRAND.success },
    { name: 'Inventory', value: 85, color: BRAND.success },
    { name: 'Scheduling', value: 60, color: BRAND.warning },
    { name: 'Loading', value: 45, color: BRAND.error },
    { name: 'Invoicing', value: 30, color: BRAND.error },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={800} color="text.primary" sx={{ fontSize: { xs: '1.5rem', sm: '2.125rem' } }}>
          Control Tower
        </Typography>
        <Typography variant="body2" color="text.secondary">Operational overview for Ambika Dispatch Systems</Typography>
      </Box>

      {/* Stat Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="Total Sales Orders" value={ordersData?.meta?.total || '0'} icon={ShoppingCart} color={BRAND.primary} trend="+12% from last week" loading={ordersLoading} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="WIP Orders" value="24" icon={Clock} color={BRAND.wip} loading={ordersLoading} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="Dispatched" value="158" icon={CheckCircle} color={BRAND.success} trend="+5.2%" loading={invoicesLoading} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard title="Pending Payments" value="₹12.4L" icon={AlertCircle} color={BRAND.error} loading={invoicesLoading} />
        </Grid>
      </Grid>

      {/* Charts */}
      <Grid container spacing={2}>
        <Grid item xs={12} lg={8}>
          <Paper sx={{ p: 3, borderRadius: '16px' }}>
            <Typography variant="h6" fontWeight={700} color="text.primary" gutterBottom>Weekly Dispatch Trend</Typography>
            <Box sx={{ height: 300, mt: 1 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dispatchTrendData}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={BRAND.primary} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={BRAND.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontWeight: 600 }} />
                  <Area type="monotone" dataKey="value" stroke={BRAND.primary} strokeWidth={2.5} fillOpacity={1} fill="url(#colorValue)" />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Paper sx={{ p: 3, height: '100%', borderRadius: '16px' }}>
            <Typography variant="h6" fontWeight={700} color="text.primary" gutterBottom>Step Efficiency</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>Completion rates by workflow stage</Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              {bottleneckData.map((item) => (
                <Box key={item.name}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" fontWeight={600} color="text.primary">{item.name}</Typography>
                    <Typography variant="body2" fontWeight={700} color={item.color}>{item.value}%</Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={item.value}
                    sx={{
                      height: 6, borderRadius: 3, bgcolor: '#f1f5f9',
                      '& .MuiLinearProgress-bar': { bgcolor: item.color, borderRadius: 3 }
                    }}
                  />
                </Box>
              ))}
            </Box>

            <Box sx={{ mt: 3, p: 2, bgcolor: alpha(BRAND.error, 0.06), borderRadius: '12px', display: 'flex', gap: 1.5, alignItems: 'center' }}>
              <AlertCircle size={20} color={BRAND.error} />
              <Box>
                <Typography variant="body2" sx={{ color: BRAND.error, fontWeight: 700, fontSize: '0.8rem' }}>High Delay Alert</Typography>
                <Typography variant="caption" sx={{ color: BRAND.error, fontWeight: 500 }}>Loading phase is 22% slower than average today.</Typography>
              </Box>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;