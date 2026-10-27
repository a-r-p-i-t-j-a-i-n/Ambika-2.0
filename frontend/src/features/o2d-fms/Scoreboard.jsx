import React from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, LinearProgress, Skeleton, alpha, Avatar,
} from '@mui/material';
import { Trophy, Clock, CheckCircle2, Gauge } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { useGetFmsScoresQuery } from '../../store/api/o2dFmsApi';

const tone = (pct) => (pct >= 85 ? '#0f766e' : pct >= 60 ? '#b45309' : '#be123c');
const hrs = (m) => (m >= 60 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m || 0)} m`);

const Scoreboard = () => {
  const { data, isLoading } = useGetFmsScoresQuery(undefined, { pollingInterval: 60_000, skipPollingIfUnfocused: true });
  const rows = data?.data || [];
  const chart = rows.map((r) => ({ name: r.name || 'Unknown', punctuality: r.punctuality, accuracy: r.accuracy }));

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={420} /></Box>;

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Trophy size={20} color="#b45309" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Doer Scoreboard</Typography>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Punctuality, throughput and checklist accuracy across completed steps.
      </Typography>

      {rows.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 3, color: 'text.secondary' }}>
          No completed steps yet — scores appear once doers start finishing tasks.
        </Paper>
      ) : (
        <>
          <Paper sx={{ p: 2, borderRadius: 3, height: 320, mb: 2 }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Punctuality vs accuracy (%)</Typography>
            <ResponsiveContainer width="100%" height="88%">
              <BarChart data={chart} margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <ReTooltip />
                <Bar dataKey="punctuality" name="Punctuality" radius={[4, 4, 0, 0]} fill="#1d4ed8" />
                <Bar dataKey="accuracy" name="Accuracy" radius={[4, 4, 0, 0]} fill="#0f766e" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>

          <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: alpha('#1d4ed8', 0.06) }}>
                  <TableCell>Doer</TableCell>
                  <TableCell>Punctuality</TableCell>
                  <TableCell align="center">Throughput</TableCell>
                  <TableCell align="center">Avg delay</TableCell>
                  <TableCell>Checklist accuracy</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r._id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: alpha('#1d4ed8', 0.15), color: '#1e3a8a' }}>
                          {(r.name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('')}
                        </Avatar>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.name || 'Unknown'}</Typography>
                          <Typography variant="caption" color="text.secondary">{r.email}</Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ width: 200 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <LinearProgress variant="determinate" value={r.punctuality}
                          sx={{ flex: 1, height: 7, borderRadius: 4, '& .MuiLinearProgress-bar': { backgroundColor: tone(r.punctuality) } }} />
                        <Typography variant="caption" sx={{ fontWeight: 700, color: tone(r.punctuality) }}>{r.punctuality}%</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell align="center"><Chip size="small" icon={<CheckCircle2 size={12} />} label={r.throughput} /></TableCell>
                    <TableCell align="center">
                      <Chip size="small" icon={<Clock size={12} />} label={hrs(r.avgDelayMins)}
                        color={r.avgDelayMins > 0 ? 'warning' : 'default'} variant={r.avgDelayMins > 0 ? 'filled' : 'outlined'} />
                    </TableCell>
                    <TableCell sx={{ width: 160 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Gauge size={14} color={tone(r.accuracy)} />
                        <Typography variant="body2" sx={{ fontWeight: 600, color: tone(r.accuracy) }}>{r.accuracy}%</Typography>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </>
      )}
    </Box>
  );
};

export default Scoreboard;
