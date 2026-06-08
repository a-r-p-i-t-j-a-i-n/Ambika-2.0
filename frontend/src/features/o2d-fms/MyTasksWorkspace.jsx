import React, { useState, useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Chip, Button, Skeleton, alpha, Divider,
  TextField, InputAdornment, ToggleButtonGroup, ToggleButton, MenuItem,
} from '@mui/material';
import { ClipboardList, Clock, AlertTriangle, ArrowRight, Inbox, Search, ArrowUpDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetMyTasksQuery } from '../../store/api/o2dFmsApi';
import { usePermissions } from '../../hooks/usePermission';
import StepDetailCard from './components/StepDetailCard';

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const isDueSoon = (d) => d && !Number.isNaN(new Date(d)) && (new Date(d) - Date.now()) > 0 && (new Date(d) - Date.now()) < 24 * 3600 * 1000;

const MyTasksWorkspace = () => {
  const { data, isLoading, refetch } = useGetMyTasksQuery();
  const { can, isRoot } = usePermissions();
  const navigate = useNavigate();
  const [active, setActive] = useState(null);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');   // all | overdue | dueSoon | buddy
  const [sortBy, setSortBy] = useState('due');    // due | order | step

  const tasks = data?.data || [];
  const overdue = tasks.filter((t) => t.isOverdue);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = tasks.filter((t) => {
      if (filter === 'overdue' && !t.isOverdue) return false;
      if (filter === 'dueSoon' && !isDueSoon(t.planned)) return false;
      if (filter === 'buddy' && !t.asBuddy) return false;
      if (q) {
        const hay = `${t.soNumber} ${t.partyName} ${t.name} ${t.stepCode} ${t.tool || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sortBy === 'order') return (a.soNumber || '').localeCompare(b.soNumber || '');
      if (sortBy === 'step') return (a.name || '').localeCompare(b.name || '');
      return new Date(a.planned || 0) - new Date(b.planned || 0); // due
    });
    return list;
  }, [tasks, search, filter, sortBy]);

  const counts = {
    all: tasks.length,
    overdue: overdue.length,
    dueSoon: tasks.filter((t) => isDueSoon(t.planned)).length,
    buddy: tasks.filter((t) => t.asBuddy).length,
  };

  const taskToStep = (t) => ({
    stepCode: t.stepCode, name: t.name, description: t.description, tool: t.tool,
    planned: t.planned, status: 'PENDING', isOverdue: t.isOverdue,
    requiresLink: t.requiresLink, requiresAttachment: t.requiresAttachment, slaMinutes: null,
  });

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>My Tasks</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Steps assigned to you across all orders — most overdue first.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Chip label={`${tasks.length} pending`} color="primary" variant="outlined" />
          {overdue.length > 0 && <Chip icon={<AlertTriangle size={14} />} label={`${overdue.length} overdue`} color="warning" />}
        </Stack>
      </Stack>

      {/* Filter & search bar */}
      {!isLoading && tasks.length > 0 && (
        <Paper sx={{ p: 1.25, borderRadius: 3, mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
          <ToggleButtonGroup size="small" value={filter} exclusive onChange={(_, v) => v && setFilter(v)}>
            <ToggleButton value="all">All ({counts.all})</ToggleButton>
            <ToggleButton value="overdue" sx={{ color: counts.overdue ? '#be123c' : undefined }}>Overdue ({counts.overdue})</ToggleButton>
            <ToggleButton value="dueSoon">Due ≤24h ({counts.dueSoon})</ToggleButton>
            <ToggleButton value="buddy">As buddy ({counts.buddy})</ToggleButton>
          </ToggleButtonGroup>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TextField
              select size="small" value={sortBy} onChange={(e) => setSortBy(e.target.value)}
              sx={{ width: 150 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><ArrowUpDown size={14} /></InputAdornment> }}
            >
              <MenuItem value="due">Sort: Due date</MenuItem>
              <MenuItem value="order">Sort: Order #</MenuItem>
              <MenuItem value="step">Sort: Step</MenuItem>
            </TextField>
            <TextField
              size="small" placeholder="Search order, party, step…" value={search}
              onChange={(e) => setSearch(e.target.value)} sx={{ width: { xs: '100%', sm: 260 } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }}
            />
          </Stack>
        </Paper>
      )}

      {isLoading ? (
        <Stack spacing={1.5}>{[1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={84} />)}</Stack>
      ) : tasks.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 3 }}>
          <Inbox size={40} style={{ opacity: 0.4 }} />
          <Typography variant="h6" sx={{ mt: 1 }}>You're all caught up</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>No steps are waiting on you right now.</Typography>
        </Paper>
      ) : filtered.length === 0 ? (
        <Paper sx={{ p: 5, textAlign: 'center', borderRadius: 3, color: 'text.secondary' }}>
          <Search size={32} style={{ opacity: 0.4 }} />
          <Typography sx={{ mt: 1 }}>No tasks match your filters.</Typography>
          <Button size="small" sx={{ mt: 1 }} onClick={() => { setSearch(''); setFilter('all'); }}>Clear filters</Button>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {filtered.map((t) => (
            <Paper
              key={`${t.processId}-${t.stepCode}`}
              sx={{
                p: 2, borderRadius: 3, borderLeft: '4px solid',
                borderLeftColor: t.isOverdue ? '#be123c' : '#1d4ed8',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                bgcolor: t.isOverdue ? alpha('#be123c', 0.04) : 'background.paper',
              }}
            >
              <Box>
                <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
                  <ClipboardList size={16} />
                  <Typography sx={{ fontWeight: 700 }}>{t.name}</Typography>
                  <Chip size="small" variant="outlined" label={t.stepCode} />
                  {t.tool && <Chip size="small" label={t.tool} sx={{ bgcolor: alpha('#1d4ed8', 0.08) }} />}
                  {t.asBuddy && <Chip size="small" color="secondary" label="As buddy" />}
                  {t.checklistTotal > 0 && (
                    <Chip size="small" variant="outlined"
                      color={t.checklistDone === t.checklistTotal ? 'success' : 'default'}
                      label={`✓ ${t.checklistDone}/${t.checklistTotal}`} />
                  )}
                </Stack>
                <Stack direction="row" spacing={2} alignItems="center" sx={{ color: 'text.secondary' }}>
                  <Typography variant="body2">{t.soNumber} · {t.partyName}</Typography>
                  <Divider orientation="vertical" flexItem />
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Clock size={14} color={t.isOverdue ? '#be123c' : undefined} />
                    <Typography variant="body2" sx={{ color: t.isOverdue ? '#be123c' : 'text.secondary', fontWeight: t.isOverdue ? 700 : 400 }}>
                      Due {fmt(t.planned)}
                    </Typography>
                  </Stack>
                </Stack>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => navigate(`/o2d-fms/process/${t.processId}`)} endIcon={<ArrowRight size={14} />}>
                  Open order
                </Button>
                <Button size="small" variant="contained" onClick={() => setActive(t)}>Do it</Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      <StepDetailCard
        open={!!active}
        onClose={(changed) => { setActive(null); if (changed) refetch(); }}
        processId={active?.processId}
        step={active ? taskToStep(active) : null}
        orderLabel={active ? `${active.soNumber} · ${active.partyName}` : ''}
        canAct={can('o2dfms.act') || isRoot}
        canManage={can('o2dfms.manage') || isRoot}
      />
    </Box>
  );
};

export default MyTasksWorkspace;
