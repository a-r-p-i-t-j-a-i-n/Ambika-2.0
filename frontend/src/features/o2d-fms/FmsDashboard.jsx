import React from 'react';
import {
  Box, Paper, Stack, Typography, Grid, Skeleton, alpha, Table, TableBody, TableCell,
  TableHead, TableRow, Chip, Button, Divider,
} from '@mui/material';
import {
  Layers, Activity, CheckCircle2, AlertTriangle, ArrowRight, TrendingUp,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useGetFmsDashboardQuery } from '../../store/api/o2dFmsApi';

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const hrs = (mins) => (mins >= 60 ? `${(mins / 60).toFixed(1)} h` : `${Math.round(mins || 0)} m`);

const StatCard = ({ label, value, icon: Icon, color, sub }) => (
  <Paper sx={{ p: 2, borderRadius: 3, height: '100%' }}>
    <Stack direction="row" spacing={1} alignItems="center" sx={{ color }}>
      <Box sx={{ p: 0.75, borderRadius: 2, bgcolor: alpha(color, 0.12), display: 'flex' }}><Icon size={18} /></Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</Typography>
    </Stack>
    <Typography variant="h4" sx={{ fontWeight: 800, mt: 1 }}>{value}</Typography>
    {sub && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{sub}</Typography>}
  </Paper>
);

const FmsDashboard = () => {
  const { data, isLoading } = useGetFmsDashboardQuery(undefined, { pollingInterval: 60_000 });
  const navigate = useNavigate();
  const d = data?.data || {};
  const totals = d.totals || { total: 0, completed: 0, inProgress: 0 };

  const stepChart = (d.byStep || []).filter((s) => s.delayMins > 0 || s.overdue > 0)
    .map((s) => ({ name: s.name || s._id, delayHrs: +(s.delayMins / 60).toFixed(1), overdue: s.overdue }));
  const personChart = (d.byPerson || []).map((p) => ({
    name: p.name || 'Unassigned', delayHrs: +(p.delayMins / 60).toFixed(1), pending: p.pending, overdue: p.overdue,
  }));

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={500} /></Box>;

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h5" sx={{ fontWeight: 800 }}>O2D FMS — Management View</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Where orders are stuck, and who is lagging. Updates every minute.
      </Typography>

      <Grid container spacing={2} sx={{ mb: 1 }}>
        <Grid item xs={6} md={3}><StatCard label="Total processes" value={totals.total} icon={Layers} color="#1d4ed8" /></Grid>
        <Grid item xs={6} md={3}><StatCard label="In progress" value={totals.inProgress} icon={Activity} color="#0369a1" /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Completed" value={totals.completed} icon={CheckCircle2} color="#0f766e" /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Overdue steps" value={d.overdueCount || 0} icon={AlertTriangle} color="#be123c" sub="past SLA, still pending" /></Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        {/* Bottleneck: delay by step */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, borderRadius: 3, height: 340 }}>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
              <TrendingUp size={18} color="#b45309" />
              <Typography sx={{ fontWeight: 700 }}>Bottleneck — delay by step</Typography>
            </Stack>
            {stepChart.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 4, textAlign: 'center' }}>No delays recorded yet.</Typography>
            ) : (
              <ResponsiveContainer width="100%" height="88%">
                <BarChart data={stepChart} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="h" />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                  <ReTooltip formatter={(v) => [`${v} h`, 'Total delay']} />
                  <Bar dataKey="delayHrs" radius={[0, 4, 4, 0]} fill="#b45309" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>

        {/* Accountability: delay by person */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, borderRadius: 3, height: 340 }}>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
              <AlertTriangle size={18} color="#be123c" />
              <Typography sx={{ fontWeight: 700 }}>Accountability — load & delay by person</Typography>
            </Stack>
            {personChart.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 4, textAlign: 'center' }}>No assigned steps yet.</Typography>
            ) : (
              <ResponsiveContainer width="100%" height="88%">
                <BarChart data={personChart} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="h" />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                  <ReTooltip formatter={(v, n) => (n === 'delayHrs' ? [`${v} h`, 'Total delay'] : [v, n])} />
                  <Bar dataKey="delayHrs" radius={[0, 4, 4, 0]}>
                    {personChart.map((p, i) => <Cell key={i} fill={p.overdue > 0 ? '#be123c' : '#1d4ed8'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* Overdue action table */}
      <Paper sx={{ p: 2, borderRadius: 3, mt: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" mb={1}>
          <AlertTriangle size={18} color="#be123c" />
          <Typography sx={{ fontWeight: 700 }}>Overdue steps</Typography>
          <Chip size="small" label={(d.overdue || []).length} color="error" />
        </Stack>
        <Divider sx={{ mb: 1 }} />
        {(d.overdue || []).length === 0 ? (
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
              {(d.overdue || []).map((o) => (
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
