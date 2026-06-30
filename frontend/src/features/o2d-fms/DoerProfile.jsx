import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Paper, Stack, Typography, alpha, Avatar, Grid, Skeleton, Chip, Button,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import {
  ArrowLeft, Clock, CheckCircle2, AlertTriangle, ListChecks, Gauge, TrendingDown, Target,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie, Legend, ComposedChart, Line,
} from 'recharts';
import dayjs from 'dayjs';
import { useGetDoerProfileQuery } from '../../store/api/o2dFmsApi';

const C = {
  ink: '#0b2545', brand: '#1d4ed8', brandDk: '#1e3a8a', success: '#0f766e',
  warning: '#b45309', error: '#be123c', slate: '#475a8a', line: '#e2e8f0',
};
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const hrs = (m) => (m >= 60 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m || 0)} m`);
const dt = (d) => (d ? dayjs(d).format('DD MMM YY, hh:mm A') : '—');
const GRADE_COLOR = { 'A+': '#0f766e', A: '#15803d', B: '#b45309', C: '#ea580c', D: '#be123c' };
const misColor = (s) => (s >= 0 ? C.success : s >= -10 ? C.warning : s >= -25 ? '#ea580c' : C.error);
const tone = (p) => (p >= 85 ? C.success : p >= 60 ? C.warning : C.error);
const STATUS_C = { DONE: C.success, DELAYED: C.warning, PENDING: C.brand, SKIPPED: C.slate };

const KCard = ({ label, value, sub, icon: Icon, color }) => (
  <Paper sx={{ p: 1.6, borderRadius: 2.5, border: `1px solid ${C.line}`, height: '100%' }}>
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
      <Box sx={{ width: 28, height: 28, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.1), color }}><Icon size={14} /></Box>
      <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</Typography>
    </Stack>
    <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, color: C.ink, lineHeight: 1 }}>{value}</Typography>
    {sub && <Typography sx={{ fontSize: '0.64rem', fontWeight: 600, color: C.slate, mt: 0.25 }}>{sub}</Typography>}
  </Paper>
);

const Panel = ({ title, children, height = 280 }) => (
  <Paper sx={{ p: 2, borderRadius: 3, border: `1px solid ${C.line}`, height: '100%' }}>
    <Typography sx={{ fontWeight: 800, color: C.ink, fontSize: '0.92rem', mb: 1 }}>{title}</Typography>
    <Box sx={{ height }}>{children}</Box>
  </Paper>
);

const DoerProfile = () => {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useGetDoerProfileQuery(userId, { pollingInterval: 60_000 });
  const p = data?.data;

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={520} /></Box>;
  if (!p) return <Box sx={{ p: 3 }}><Typography>Doer not found.</Typography></Box>;

  const s = p.summary || {};
  const doneOnTime = s.onTime || 0;
  const doneLate = s.late || 0;
  const pendingClean = Math.max(0, (s.pending || 0) - (s.overdue || 0));
  const pie = [
    { name: 'On-time', value: doneOnTime, color: C.success },
    { name: 'Late', value: doneLate, color: C.warning },
    { name: 'Pending', value: pendingClean, color: C.brand },
    { name: 'Overdue', value: s.overdue || 0, color: C.error },
  ].filter((x) => x.value > 0);
  const byStep = (p.byStep || []).map((x) => ({ ...x, label: x.name?.length > 14 ? `${x.name.slice(0, 13)}…` : x.name }));
  const monthly = (p.monthly || []).map((m) => ({ ...m, label: dayjs(`${m.month}-01`).format('MMM YY'), delayHrs: +((m.avgDelayMins || 0) / 60).toFixed(1) }));

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2.5 }, minHeight: '100vh' }}>
      <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/o2d-fms/scores')} sx={{ mb: 1.5, fontWeight: 700 }}>
        Back to MIS Scoring
      </Button>

      {/* Header */}
      <Paper sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3, border: `1px solid ${C.line}`, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={2}>
          <Stack direction="row" spacing={1.75} alignItems="center">
            <Avatar sx={{ width: 56, height: 56, fontSize: 20, fontWeight: 800, bgcolor: alpha(C.brand, 0.15), color: C.brandDk }}>
              {(p.doer.name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('')}
            </Avatar>
            <Box>
              <Typography sx={{ fontSize: '1.3rem', fontWeight: 800, color: C.ink, lineHeight: 1.1 }}>{p.doer.name}</Typography>
              <Typography sx={{ fontSize: '0.82rem', color: C.slate }}>{p.doer.email}{p.doer.role ? ` · ${p.doer.role}` : ''}</Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: C.slate, textTransform: 'uppercase' }}>MIS Score</Typography>
              <Typography sx={{ fontSize: '1.8rem', fontWeight: 900, color: misColor(s.misScore), lineHeight: 1 }}>{num(s.misScore)}</Typography>
            </Box>
            <Chip icon={<Target size={14} />} label={`Grade ${s.grade}`} sx={{ fontWeight: 800, height: 36, px: 0.5, bgcolor: alpha(GRADE_COLOR[s.grade] || C.slate, 0.12), color: GRADE_COLOR[s.grade] || C.slate, '& .MuiChip-icon': { color: GRADE_COLOR[s.grade] || C.slate } }} />
          </Stack>
        </Stack>
      </Paper>

      {/* KPI cards */}
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {[
          { label: 'Assigned', value: num(s.assigned), icon: ListChecks, color: C.brandDk },
          { label: 'Completed', value: num(s.completed), sub: `${s.completionRate || 0}% of assigned`, icon: CheckCircle2, color: C.success },
          { label: 'On-time', value: `${s.punctuality || 0}%`, sub: `${doneOnTime}/${s.completed || 0}`, icon: Gauge, color: tone(s.punctuality) },
          { label: 'Overdue', value: num(s.overdue), sub: 'pending past SLA', icon: AlertTriangle, color: C.error },
          { label: 'Avg Delay', value: hrs(s.avgDelayMins), sub: `total ${hrs(s.totalDelayMins)}`, icon: Clock, color: C.warning },
          { label: 'Accuracy', value: `${s.accuracy || 0}%`, sub: 'checklist', icon: TrendingDown, color: tone(s.accuracy) },
        ].map((k) => <Grid item xs={6} sm={4} md={2} key={k.label}><KCard {...k} /></Grid>)}
      </Grid>

      {/* Graphs */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={4}>
          <Panel title="Task outcome mix">
            {pie.length === 0 ? <Typography sx={{ color: C.slate, textAlign: 'center', mt: 8 }}>No tasks yet.</Typography> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="52%" outerRadius="82%" paddingAngle={2} label={(e) => e.value}>
                    {pie.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <ReTooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="bottom" height={28} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </Grid>
        <Grid item xs={12} md={8}>
          <Panel title="Performance by step — assigned vs late vs overdue">
            {byStep.length === 0 ? <Typography sx={{ color: C.slate, textAlign: 'center', mt: 8 }}>No steps yet.</Typography> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byStep} margin={{ left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={48} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ReTooltip />
                  <Bar dataKey="assigned" name="Assigned" fill={C.brand} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="late" name="Late" fill={C.warning} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="overdue" name="Overdue" fill={C.error} radius={[3, 3, 0, 0]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </Grid>
        <Grid item xs={12}>
          <Panel title="Monthly throughput & average delay" height={260}>
            {monthly.length === 0 ? <Typography sx={{ color: C.slate, textAlign: 'center', mt: 8 }}>No completed steps yet.</Typography> : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthly} margin={{ left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} unit="h" />
                  <ReTooltip />
                  <Bar yAxisId="l" dataKey="completed" name="Completed" fill={C.success} radius={[4, 4, 0, 0]} barSize={28} />
                  <Bar yAxisId="l" dataKey="late" name="Late" fill={C.warning} radius={[4, 4, 0, 0]} barSize={28} />
                  <Line yAxisId="r" type="monotone" dataKey="delayHrs" name="Avg delay (h)" stroke={C.error} strokeWidth={2.5} dot={{ r: 3 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </Grid>
      </Grid>

      {/* Recent activity */}
      <Paper sx={{ borderRadius: 3, overflow: 'hidden', border: `1px solid ${C.line}` }}>
        <Box sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${C.line}` }}>
          <Typography sx={{ fontWeight: 800, color: C.ink }}>Recent steps</Typography>
        </Box>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 760 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(C.brand, 0.05) }}>
                {['Order', 'Step', 'Status', 'Planned', 'Actual', 'Delay'].map((h, i) => (
                  <TableCell key={h} align={i >= 5 ? 'right' : 'left'} sx={{ fontWeight: 800, color: C.slate, fontSize: '0.72rem' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {(p.recent || []).map((r, i) => (
                <TableRow key={i} hover sx={{ cursor: 'pointer' }} onClick={() => r.soNumber && navigate(`/orders?so=${encodeURIComponent(r.soNumber)}`)}>
                  <TableCell><Typography variant="body2" sx={{ fontWeight: 700, color: C.brand }}>{r.soNumber || '—'}</Typography><Typography variant="caption" color="text.secondary">{r.partyName}</Typography></TableCell>
                  <TableCell><Typography variant="body2">{r.name}</Typography><Typography variant="caption" color="text.secondary">{r.stepCode}</Typography></TableCell>
                  <TableCell><Chip size="small" label={r.status} sx={{ fontWeight: 800, fontSize: '0.62rem', bgcolor: alpha(STATUS_C[r.status] || C.slate, 0.1), color: STATUS_C[r.status] || C.slate }} /></TableCell>
                  <TableCell><Typography variant="caption">{dt(r.planned)}</Typography></TableCell>
                  <TableCell><Typography variant="caption">{dt(r.actual)}</Typography></TableCell>
                  <TableCell align="right">{r.delayMins > 0 ? <Chip size="small" icon={<Clock size={10} />} label={hrs(r.delayMins)} sx={{ fontWeight: 800, fontSize: '0.62rem', bgcolor: alpha(C.error, 0.1), color: C.error, '& .MuiChip-icon': { color: C.error } }} /> : <Typography variant="caption" color="text.disabled">on-time</Typography>}</TableCell>
                </TableRow>
              ))}
              {(p.recent || []).length === 0 && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 3, color: C.slate }}>No activity yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Box>
      </Paper>
    </Box>
  );
};

export default DoerProfile;
