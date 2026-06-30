import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Stack, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, LinearProgress, Skeleton, alpha, Avatar, Grid, Tooltip,
} from '@mui/material';
import {
  Gauge, Clock, CheckCircle2, AlertTriangle, Users, ListChecks, TrendingDown, ChevronRight, Target,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList,
} from 'recharts';
import { useGetMisScoresQuery } from '../../store/api/o2dFmsApi';

const C = {
  ink: '#0b2545', brand: '#1d4ed8', brandDk: '#1e3a8a', success: '#0f766e',
  warning: '#b45309', error: '#be123c', slate: '#475a8a', line: '#e2e8f0',
};
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const hrs = (m) => (m >= 60 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m || 0)} m`);
const GRADE_COLOR = { 'A+': '#0f766e', A: '#15803d', B: '#b45309', C: '#ea580c', D: '#be123c' };
const misColor = (s) => (s >= 0 ? C.success : s >= -10 ? C.warning : s >= -25 ? '#ea580c' : C.error);
const tone = (p) => (p >= 85 ? C.success : p >= 60 ? C.warning : C.error);

const Stat = ({ label, value, sub, icon: Icon, color }) => (
  <Paper sx={{ p: 1.6, borderRadius: 2.5, border: `1px solid ${C.line}`, height: '100%' }}>
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
      <Box sx={{ width: 30, height: 30, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.1), color }}><Icon size={15} /></Box>
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</Typography>
    </Stack>
    <Typography sx={{ fontSize: '1.45rem', fontWeight: 800, color: C.ink, lineHeight: 1 }}>{value}</Typography>
    {sub && <Typography sx={{ fontSize: '0.66rem', fontWeight: 600, color: C.slate, mt: 0.25 }}>{sub}</Typography>}
  </Paper>
);

const Panel = ({ title, subtitle, children, height = 300 }) => (
  <Paper sx={{ p: 2, borderRadius: 3, border: `1px solid ${C.line}`, height: '100%' }}>
    <Typography sx={{ fontWeight: 800, color: C.ink, fontSize: '0.95rem' }}>{title}</Typography>
    {subtitle && <Typography sx={{ fontSize: '0.72rem', color: C.slate, mb: 1 }}>{subtitle}</Typography>}
    <Box sx={{ height }}>{children}</Box>
  </Paper>
);

const MisScoring = () => {
  const navigate = useNavigate();
  const { data, isLoading } = useGetMisScoresQuery(undefined, { pollingInterval: 60_000 });
  const doers = useMemo(() => data?.data?.doers || [], [data]);
  const totals = data?.data?.totals || {};

  // chart datasets (first names keep axis readable)
  const short = (n) => (n || '?').split(' ')[0];
  const misData = useMemo(() => [...doers].sort((a, b) => a.misScore - b.misScore).map((d) => ({ name: short(d.name), misScore: d.misScore, userId: d.userId })), [doers]);
  const loadData = useMemo(() => doers.map((d) => ({
    name: short(d.name),
    completed: d.completed,
    pending: Math.max(0, d.pending - d.overdue),
    overdue: d.overdue,
  })), [doers]);
  const punctData = useMemo(() => doers.map((d) => ({ name: short(d.name), punctuality: d.punctuality, accuracy: d.accuracy })), [doers]);
  const delayData = useMemo(() => doers.map((d) => ({ name: short(d.name), avgDelay: Math.round((d.avgDelayMins || 0) / 6) / 10 })), [doers]); // hours, 1dp

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={520} /></Box>;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2.5 }, minHeight: '100vh' }}>
      {/* Header */}
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 0.5 }}>
        <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(C.brand, 0.1), color: C.brand, border: `1px solid ${alpha(C.brand, 0.2)}` }}>
          <Target size={21} />
        </Box>
        <Box>
          <Typography sx={{ fontSize: { xs: '1.2rem', sm: '1.4rem' }, fontWeight: 800, color: C.brandDk, lineHeight: 1.1 }}>MIS Scoring</Typography>
          <Typography sx={{ color: C.slate, fontSize: '0.8rem' }}>
            KRA / KPI accountability for every doer — the MIS score is a penalty total (0 = perfect, the more negative the worse).
          </Typography>
        </Box>
      </Stack>

      {doers.length === 0 ? (
        <Paper sx={{ p: 6, mt: 2, textAlign: 'center', borderRadius: 3, color: C.slate, border: `1px solid ${C.line}` }}>
          No assigned steps yet — MIS scores appear once doers are assigned and start working.
        </Paper>
      ) : (
        <>
          {/* KPI strip */}
          <Grid container spacing={1.5} sx={{ my: 0.5 }}>
            {[
              { label: 'Doers', value: num(totals.doers), icon: Users, color: C.brand },
              { label: 'Tasks Assigned', value: num(totals.assigned), icon: ListChecks, color: C.brandDk },
              { label: 'Completed', value: num(totals.completed), sub: `${totals.assigned ? Math.round((totals.completed / totals.assigned) * 100) : 0}% done`, icon: CheckCircle2, color: C.success },
              { label: 'Overdue', value: num(totals.overdue), sub: 'past SLA, pending', icon: AlertTriangle, color: C.error },
              { label: 'Avg Punctuality', value: `${totals.avgPunctuality || 0}%`, icon: Gauge, color: C.success },
              { label: 'Total MIS', value: num(totals.misScore), sub: 'penalty points', icon: TrendingDown, color: misColor(totals.misScore || 0) },
            ].map((s) => (
              <Grid item xs={6} sm={4} md={2} key={s.label}><Stat {...s} /></Grid>
            ))}
          </Grid>

          {/* Graphs */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} lg={6}>
              <Panel title="MIS Score by doer" subtitle="Penalty total — worst (most negative) at the bottom. Click a bar to open the profile.">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={misData} margin={{ left: 8, right: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={84} tick={{ fontSize: 11, fontWeight: 700 }} />
                    <ReTooltip formatter={(v) => [v, 'MIS score']} />
                    <Bar dataKey="misScore" radius={[0, 4, 4, 0]} cursor="pointer"
                      onClick={(e) => e?.payload?.userId && navigate(`/o2d-fms/scores/${e.payload.userId}`)}>
                      {misData.map((d, i) => <Cell key={i} fill={misColor(d.misScore)} />)}
                      <LabelList dataKey="misScore" position="right" style={{ fontWeight: 800, fontSize: 11, fill: C.ink }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </Grid>
            <Grid item xs={12} lg={6}>
              <Panel title="Workload — assigned, completed, pending & overdue" subtitle="How much each doer carries and how much is stuck.">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={loadData} margin={{ left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <ReTooltip />
                    <Bar dataKey="completed" stackId="a" name="Completed" fill={C.success} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="pending" stackId="a" name="Pending" fill={C.brand} />
                    <Bar dataKey="overdue" stackId="a" name="Overdue" fill={C.error} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </Grid>
            <Grid item xs={12} lg={6}>
              <Panel title="Punctuality vs Accuracy (%)" subtitle="On-time completion vs checklist accuracy.">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={punctData} margin={{ left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                    <ReTooltip />
                    <Bar dataKey="punctuality" name="Punctuality" radius={[4, 4, 0, 0]} fill={C.brand} />
                    <Bar dataKey="accuracy" name="Accuracy" radius={[4, 4, 0, 0]} fill={C.success} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </Grid>
            <Grid item xs={12} lg={6}>
              <Panel title="Average delay per doer (hours)" subtitle="Mean lateness across completed tasks.">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={delayData} margin={{ left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} unit="h" />
                    <ReTooltip formatter={(v) => [`${v} h`, 'Avg delay']} />
                    <Bar dataKey="avgDelay" radius={[4, 4, 0, 0]}>
                      {delayData.map((d, i) => <Cell key={i} fill={d.avgDelay > 0 ? C.warning : C.success} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </Grid>
          </Grid>

          {/* Leaderboard */}
          <Paper sx={{ borderRadius: 3, overflow: 'hidden', border: `1px solid ${C.line}` }}>
            <Box sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${C.line}` }}>
              <Typography sx={{ fontWeight: 800, color: C.ink }}>Doer Leaderboard</Typography>
              <Typography sx={{ fontSize: '0.72rem', color: C.slate }}>Click a row to open the full performance profile.</Typography>
            </Box>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 860 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha(C.brand, 0.05) }}>
                    {['Doer', 'Grade', 'MIS Score', 'Assigned', 'Completed', 'On-time', 'Overdue', 'Avg Delay', 'Accuracy'].map((h, i) => (
                      <TableCell key={h} align={i >= 2 ? 'center' : 'left'} sx={{ fontWeight: 800, color: C.slate, fontSize: '0.72rem' }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {doers.map((r) => (
                    <TableRow key={r.userId} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/o2d-fms/scores/${r.userId}`)}>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Avatar sx={{ width: 30, height: 30, fontSize: 12, bgcolor: alpha(C.brand, 0.15), color: C.brandDk }}>
                            {(r.name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('')}
                          </Avatar>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{r.name}</Typography>
                            <Typography variant="caption" color="text.secondary">{r.email}</Typography>
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell align="center"><Chip size="small" label={r.grade} sx={{ fontWeight: 800, bgcolor: alpha(GRADE_COLOR[r.grade] || C.slate, 0.12), color: GRADE_COLOR[r.grade] || C.slate }} /></TableCell>
                      <TableCell align="center"><Typography sx={{ fontWeight: 800, color: misColor(r.misScore) }}>{num(r.misScore)}</Typography></TableCell>
                      <TableCell align="center">{num(r.assigned)}</TableCell>
                      <TableCell align="center">{num(r.completed)}</TableCell>
                      <TableCell align="center">
                        <Tooltip title={`${r.onTime} on-time of ${r.completed} done`}>
                          <Typography sx={{ fontWeight: 700, color: tone(r.punctuality) }}>{r.punctuality}%</Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="center">{r.overdue > 0 ? <Chip size="small" label={r.overdue} sx={{ fontWeight: 800, bgcolor: alpha(C.error, 0.1), color: C.error }} /> : '—'}</TableCell>
                      <TableCell align="center"><Chip size="small" icon={<Clock size={11} />} label={hrs(r.avgDelayMins)} variant={r.avgDelayMins > 0 ? 'filled' : 'outlined'} color={r.avgDelayMins > 0 ? 'warning' : 'default'} /></TableCell>
                      <TableCell align="center"><Typography sx={{ fontWeight: 700, color: tone(r.accuracy) }}>{r.accuracy}%</Typography></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        </>
      )}
    </Box>
  );
};

export default MisScoring;
