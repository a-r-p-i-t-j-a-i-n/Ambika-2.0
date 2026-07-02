import React, { useState } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, LinearProgress, TextField, Skeleton, Button, InputAdornment,
} from '@mui/material';
import { Search, ArrowRight, Workflow, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetProcessesQuery } from '../../store/api/o2dFmsApi';

// Status pill styles — tinted background + matching text/icon colour per state.
const STATUS_STYLES = {
  completed: { label: 'Completed',   color: '#15803d', bg: '#ecfdf5', border: '#bbf7d0', Icon: CheckCircle2 },
  progress:  { label: 'In progress', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', Icon: Clock },
  overdue:   { label: 'Overdue',     color: '#dc2626', bg: '#fef2f2', border: '#fecaca', Icon: AlertTriangle },
};

const StatusPill = ({ variant, label }) => {
  const s = STATUS_STYLES[variant];
  const Icon = s.Icon;
  return (
    <Chip
      size="small"
      icon={<Icon size={14} />}
      label={label || s.label}
      sx={{
        height: 26,
        fontWeight: 700,
        color: s.color,
        bgcolor: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: '999px',
        '& .MuiChip-icon': { color: s.color, ml: 0.75, mr: -0.25 },
        '& .MuiChip-label': { px: 1 },
      }}
    />
  );
};

const ProcessList = () => {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useGetProcessesQuery({ search: search || undefined, limit: 100, sort: '-createdAt' });
  const navigate = useNavigate();
  const rows = data?.data || [];

  const progress = (steps = []) => {
    const done = steps.filter((s) => ['DONE', 'DELAYED'].includes(s.status)).length;
    return steps.length ? Math.round((done / steps.length) * 100) : 0;
  };
  const overdueCount = (steps = []) => steps.filter((s) => s.isOverdue).length;

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Workflow size={20} />
            <Typography variant="h5" sx={{ fontWeight: 800 }}>O2D Processes</Typography>
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Every order's flow, end to end.</Typography>
        </Box>
        <TextField
          size="small" placeholder="Search SO / PO / party…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }}
        />
      </Stack>

      <Paper sx={{ borderRadius: 3, overflowX: 'auto' }}>
        {isLoading ? <Skeleton variant="rounded" height={300} /> : (
          <Table size="small" sx={{ minWidth: 760 }}>
            <TableHead>
              <TableRow>
                <TableCell>Order</TableCell><TableCell>Current step</TableCell>
                <TableCell sx={{ width: 200 }}>Progress</TableCell><TableCell>Status</TableCell><TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>No processes found.</TableCell></TableRow>
              ) : rows.map((p) => {
                const pct = progress(p.steps);
                const od = overdueCount(p.steps);
                const cur = p.steps?.find((s) => s.stepCode === p.currentStepCode);
                return (
                  <TableRow key={p._id} hover>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }}>{p.soNumber}</Typography>
                      <Typography variant="caption" color="text.secondary">{p.partyName}</Typography>
                    </TableCell>
                    <TableCell>{cur?.name || (p.isCompleted ? '—' : p.currentStepCode || '—')}</TableCell>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <LinearProgress variant="determinate" value={pct} sx={{ flex: 1, height: 6, borderRadius: 3 }} />
                        <Typography variant="caption">{pct}%</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {p.isCompleted ? <StatusPill variant="completed" />
                        : od > 0 ? <StatusPill variant="overdue" label={`${od} overdue`} />
                        : <StatusPill variant="progress" />}
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" endIcon={<ArrowRight size={14} />} onClick={() => navigate(`/o2d-fms/process/${p._id}`)}>Open</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Box>
  );
};

export default ProcessList;
