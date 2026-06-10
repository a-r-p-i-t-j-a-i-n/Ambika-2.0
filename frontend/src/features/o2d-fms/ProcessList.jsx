import React, { useState } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, LinearProgress, TextField, Skeleton, Button, InputAdornment,
} from '@mui/material';
import { Search, ArrowRight, Workflow } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetProcessesQuery } from '../../store/api/o2dFmsApi';

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
                      {p.isCompleted ? <Chip size="small" color="success" label="Completed" />
                        : od > 0 ? <Chip size="small" color="error" label={`${od} overdue`} />
                        : <Chip size="small" color="primary" variant="outlined" label="In progress" />}
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
