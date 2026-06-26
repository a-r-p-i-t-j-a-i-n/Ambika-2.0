import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Paper, Typography, Stack, Autocomplete, TextField, Button,
  alpha, useTheme, CircularProgress, Skeleton, Chip,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { Plus, CalendarPlus, Search, LayoutList, CalendarRange, ListChecks, CalendarDays } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import { useGetOrdersQuery } from '../../store/api/orderApi';
import {
  useGetScheduleQuery,
  useGetOrderComparisonQuery,
  useCreatePhaseMutation,
  useUpdatePhaseMutation,
  useDeletePhaseMutation,
} from '../../store/api/dispatchControlApi';

import OrderSnapshot from './components/OrderSnapshot';
import PhaseTimeline from './components/PhaseTimeline';
import PhaseCard from './components/PhaseCard';
import RiskRail from './components/RiskRail';
import AddPhaseDialog from './components/AddPhaseDialog';
import { useReturnToTask } from '../o2d-fms/useReturnToTask';

// Group an item's phases by phaseNo so the UI shows one card per phase.
const buildPhaseGroups = (schedule) => {
  if (!schedule?.items?.length) return [];
  const map = new Map();
  schedule.items.forEach((item) => {
    item.phases.forEach((phase) => {
      const key = phase.phaseNo;
      const g = map.get(key) || { phaseNo: phase.phaseNo, plannedDate: phase.plannedDate, status: phase.status, rows: [] };
      g.rows.push({ item, phase });
      // Prefer earliest date as the phase's anchor date.
      if (phase.plannedDate && (!g.plannedDate || new Date(phase.plannedDate) < new Date(g.plannedDate))) {
        g.plannedDate = phase.plannedDate;
      }
      // Bias to worst status visible on any SKU row in this phase.
      const priority = { DELAYED: 4, IN_PROGRESS: 3, PLANNED: 2, DISPATCHED: 1, CANCELLED: 0 };
      if ((priority[phase.status] || 0) > (priority[g.status] || 0)) g.status = phase.status;
      map.set(key, g);
    });
  });
  // For each group, compute per-SKU balance *before* this phase (so the card
  // can show how much room each SKU still has).
  return [...map.values()]
    .sort((a, b) => new Date(a.plannedDate || 0) - new Date(b.plannedDate || 0))
    .map((g) => {
      const items = g.rows.map(({ item, phase }) => {
        const plannedBefore = item.phases
          .filter((p) => p.phaseId !== phase.phaseId && new Date(p.plannedDate || 0) < new Date(phase.plannedDate || 0))
          .reduce((s, p) => s + Number(p.plannedQty || 0), 0);
        return {
          scheduleItemId: item.scheduleItemId,
          orderItemId: item.scheduleItemId, // server normalises via SKU code
          skuCode: item.skuCode,
          skuName: item.skuName,
          orderQty: item.orderQty,
          balanceBeforeThisPhase: Math.max(0, Number(item.orderQty || 0) - plannedBefore),
          phaseRow: phase,
        };
      });
      // Pick a representative phaseId — used as a stable handle for update/delete.
      const phaseId = g.rows[0]?.phase?.phaseId;
      return { ...g, items, phaseId };
    });
};

const EmptyState = () => {
  const theme = useTheme();
  return (
    <Paper sx={{ p: 4, borderRadius: '14px', textAlign: 'center' }}>
      <Box sx={{
        width: 56, height: 56, borderRadius: '16px', mx: 'auto', mb: 1.5,
        display: 'grid', placeItems: 'center',
        bgcolor: alpha(theme.palette.primary.main, 0.08),
        color: 'primary.main',
      }}>
        <CalendarPlus size={26} />
      </Box>
      <Typography variant="h6" fontWeight={800} color="text.primary">No order selected</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        Pick a sales order from the search bar above to plan its dispatches.
      </Typography>
    </Paper>
  );
};

const PlanWorkspace = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [carryForwardPrefill, setCarryForwardPrefill] = useState(null);
  const [viewMode, setViewMode] = useState('phases'); // 'phases' | 'monthly'

  const { data: ordersRes, isLoading: ordersLoading } = useGetOrdersQuery({ limit: 250, sort: '-orderDate' });
  const orders = ordersRes?.data || [];

  // Deep-link support: ?so=AGL/SO-002/25-26 → auto-select that order once loaded.
  useEffect(() => {
    const so = searchParams.get('so');
    if (!so || selectedOrder || !orders.length) return;
    const match = orders.find((o) => o.soNumber === so);
    if (match) setSelectedOrder(match);
  }, [orders, searchParams, selectedOrder]);

  const onSelectOrder = (val) => {
    setSelectedOrder(val);
    // Preserve any fromTask/fromStep context (don't wipe the whole query).
    const next = new URLSearchParams(searchParams);
    if (val?.soNumber) next.set('so', val.soNumber); else next.delete('so');
    setSearchParams(next, { replace: true });
  };

  const soNumber = selectedOrder?.soNumber;
  const { data: scheduleRes, isFetching: scheduleLoading } = useGetScheduleQuery(soNumber, { skip: !soNumber });
  const { data: comparisonRes, isFetching: comparisonLoading } = useGetOrderComparisonQuery(soNumber, { skip: !soNumber });
  const schedule   = scheduleRes?.data;
  const comparison = comparisonRes?.data;

  const { finishToTask } = useReturnToTask();
  const [createPhase, { isLoading: isCreating }] = useCreatePhaseMutation();
  const [updatePhase, { isLoading: isUpdating }] = useUpdatePhaseMutation();
  const [deletePhase, { isLoading: isDeleting }] = useDeletePhaseMutation();

  const phaseGroups = useMemo(() => buildPhaseGroups(schedule), [schedule]);

  // Monthly view: bucket the phase groups by the month of their planned date,
  // with a per-month planned/dispatched roll-up shown in the section header.
  const monthlyGroups = useMemo(() => {
    const map = new Map();
    phaseGroups.forEach((g) => {
      const key   = g.plannedDate ? dayjs(g.plannedDate).format('YYYY-MM') : 'unscheduled';
      const label = g.plannedDate ? dayjs(g.plannedDate).format('MMMM YYYY') : 'Unscheduled';
      const m = map.get(key) || { key, label, groups: [], plannedQty: 0, actualQty: 0 };
      m.groups.push(g);
      g.items.forEach(({ phaseRow }) => {
        m.plannedQty += Number(phaseRow?.plannedQty || 0);
        m.actualQty  += Number(phaseRow?.actualQty || 0);
      });
      map.set(key, m);
    });
    return [...map.values()].sort((a, b) => {
      if (a.key === 'unscheduled') return 1;
      if (b.key === 'unscheduled') return -1;
      return a.key < b.key ? -1 : 1;
    });
  }, [phaseGroups]);

  // Deep-linked phase (?phase=P1) — opens that phase card automatically.
  const focusPhase = searchParams.get('phase');
  const focusPhaseInUrl = (phaseNo) => {
    const np = new URLSearchParams(searchParams);
    np.set('phase', phaseNo);
    setSearchParams(np, { replace: true });
  };

  const handleAddPhase = async (data) => {
    try {
      await createPhase({ soNumber, ...data }).unwrap();
      enqueueSnackbar('Phase added', { variant: 'success' });
      setAddDialogOpen(false);
      setCarryForwardPrefill(null);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not add phase', { variant: 'error' });
    }
  };

  const handleUpdatePhase = async (phaseId, data) => {
    try {
      await updatePhase({ soNumber, phaseId, ...data, allowOverPlan: true }).unwrap();
      enqueueSnackbar('Phase updated', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not update phase', { variant: 'error' });
    }
  };

  const handleDeletePhase = async (phaseId) => {
    if (!window.confirm('Cancel/delete this phase across all SKUs?')) return;
    try {
      const res = await deletePhase({ soNumber, phaseId }).unwrap();
      const out = res?.data?.outcome;
      enqueueSnackbar(out?.softCancelledAny ? 'Phase cancelled (kept for history)' : 'Phase removed', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not remove phase', { variant: 'error' });
    }
  };

  const onCarryForward = (row) => {
    setCarryForwardPrefill({ skuCode: row.skuCode, qty: row.carryForwardSuggestionQty });
    setAddDialogOpen(true);
  };

  const renderPhaseCard = (g) => (
    <PhaseCard
      key={g.phaseNo}
      phaseNo={g.phaseNo}
      plannedDate={g.plannedDate}
      status={g.status}
      items={g.items}
      defaultOpen={g.phaseNo === focusPhase}
      isSaving={isUpdating}
      onSave={(data) => handleUpdatePhase(g.phaseId, data)}
      onDelete={() => handleDeletePhase(g.phaseId)}
    />
  );

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Page header — branded toolbar card */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, md: 2.5 },
          borderRadius: '16px',
          border: '1px solid',
          borderColor: alpha(theme.palette.primary.main, 0.18),
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.06)} 0%, ${alpha(theme.palette.primary.light, 0.04)} 100%)`,
        }}
      >
        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          spacing={2}
          useFlexGap
          flexWrap="wrap"
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', lg: 'center' }}
        >
          {/* Title with icon badge — grows to fill free space so the subtitle wraps
              as a normal line instead of collapsing into a word-per-line column. */}
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: { xs: 0, lg: 300 }, flex: { lg: '1 1 300px' } }}>
            <Box sx={{
              width: 46, height: 46, borderRadius: '14px', flexShrink: 0,
              display: 'grid', placeItems: 'center', color: '#fff',
              background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
              boxShadow: `0 6px 16px ${alpha(theme.palette.primary.main, 0.35)}`,
            }}>
              <CalendarPlus size={22} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: '1.3rem', fontWeight: 800, color: 'text.primary', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                Dispatch Planning
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, maxWidth: 560 }}>
                Break a sales order into phased dispatches — each phase carries its own date &amp; per-SKU plan.
              </Typography>
            </Box>
          </Stack>

          {/* Controls: search + actions */}
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.25}
            useFlexGap
            flexWrap="wrap"
            alignItems={{ xs: 'stretch', sm: 'center' }}
            justifyContent={{ lg: 'flex-end' }}
            sx={{ width: { xs: '100%', lg: 'auto' }, flexShrink: 0 }}
          >
            <Autocomplete
              options={orders}
              loading={ordersLoading}
              value={selectedOrder}
              onChange={(_, val) => onSelectOrder(val)}
              getOptionLabel={(o) => o ? `${o.soNumber} — ${o.partyName || ''}` : ''}
              isOptionEqualToValue={(a, b) => a._id === b?._id}
              sx={{ width: { xs: '100%', sm: 300, lg: 320 } }}
              size="small"
              renderInput={(p) => (
                <TextField
                  {...p}
                  placeholder="Search sales order…"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px', bgcolor: 'background.paper' } }}
                  InputProps={{ ...p.InputProps, startAdornment: <Search size={15} style={{ marginLeft: 4, marginRight: 6, opacity: 0.6 }} /> }}
                />
              )}
              renderOption={(props, opt) => (
                <li {...props} key={opt._id}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700}>{opt.soNumber}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {opt.partyName} · {dayjs(opt.orderDate).format('DD MMM YYYY')} · Bal {Number(opt.totalBalanceQty || 0).toLocaleString('en-IN')}
                    </Typography>
                  </Box>
                </li>
              )}
            />
            <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
              <Button
                variant="outlined"
                disableElevation
                startIcon={<CalendarDays size={16} />}
                onClick={() => navigate('/dispatch-planning/calendar')}
                sx={{ borderRadius: '12px', whiteSpace: 'nowrap', px: 2 }}
              >
                Calendar
              </Button>
              <Button
                variant="contained"
                disableElevation
                startIcon={<Plus size={16} />}
                onClick={() => setAddDialogOpen(true)}
                disabled={!soNumber || scheduleLoading}
                sx={{ borderRadius: '12px', whiteSpace: 'nowrap', px: 2 }}
              >
                Add Phase
              </Button>
              {/* Once planning is done, jump to this order's FMS task (checklist auto-marked). */}
              <Button
                variant="outlined"
                color="success"
                disableElevation
                startIcon={<ListChecks size={16} />}
                onClick={() => finishToTask({ soNumber })}
                disabled={!soNumber}
                sx={{ borderRadius: '12px', whiteSpace: 'nowrap', px: 2 }}
              >
                Done → FMS Task
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Paper>

      {!soNumber && <EmptyState />}

      {soNumber && scheduleLoading && (
        <Stack spacing={2}>
          <Skeleton variant="rounded" height={120} />
          <Skeleton variant="rounded" height={100} />
          <Skeleton variant="rounded" height={180} />
        </Stack>
      )}

      {soNumber && schedule && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 300px' }, gap: 2 }}>
          <Stack spacing={2}>
            <OrderSnapshot schedule={schedule} comparison={comparison} />
            <PhaseTimeline
              phaseChips={schedule.phaseChips || []}
              onPhaseClick={(p) => focusPhaseInUrl(p.phaseNo)}
            />

            {phaseGroups.length === 0 ? (
              <Paper sx={{ p: 4, borderRadius: '14px', textAlign: 'center' }}>
                <Box sx={{
                  width: 48, height: 48, borderRadius: '14px', mx: 'auto', mb: 1.5,
                  display: 'grid', placeItems: 'center',
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  color: 'primary.main',
                }}>
                  <LayoutList size={22} />
                </Box>
                <Typography variant="h6" fontWeight={800} color="text.primary">No phases yet</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
                  Click <strong>Add Phase</strong> to start planning dispatches for this order.
                </Typography>
                <Button variant="contained" startIcon={<Plus size={14} />} onClick={() => setAddDialogOpen(true)}>
                  Add Phase
                </Button>
              </Paper>
            ) : (
              <Stack spacing={1.5}>
                {/* View toolbar — switch between a flat phase list and a month-grouped view. */}
                <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" rowGap={1}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {phaseGroups.length} phase{phaseGroups.length > 1 ? 's' : ''}
                    {viewMode === 'monthly' && ` · ${monthlyGroups.length} month${monthlyGroups.length > 1 ? 's' : ''}`}
                  </Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={viewMode}
                    onChange={(_, v) => v && setViewMode(v)}
                    sx={{ '& .MuiToggleButton-root': { px: 1.5, py: 0.5, textTransform: 'none', fontWeight: 700, fontSize: '0.75rem', gap: 0.5 } }}
                  >
                    <ToggleButton value="phases"><LayoutList size={14} /> Phases</ToggleButton>
                    <ToggleButton value="monthly"><CalendarRange size={14} /> Monthly</ToggleButton>
                  </ToggleButtonGroup>
                </Stack>

                {viewMode === 'phases' ? (
                  phaseGroups.map(renderPhaseCard)
                ) : (
                  <Stack spacing={2}>
                    {monthlyGroups.map((m) => (
                      <Box key={m.key}>
                        <Stack
                          direction="row" alignItems="center" justifyContent="space-between"
                          flexWrap="wrap" rowGap={0.5}
                          sx={{
                            mb: 1, px: 1.5, py: 1, borderRadius: '10px',
                            bgcolor: alpha(theme.palette.primary.main, 0.06),
                            border: '1px solid', borderColor: alpha(theme.palette.primary.main, 0.16),
                          }}
                        >
                          <Stack direction="row" spacing={1} alignItems="center">
                            <CalendarRange size={15} color={theme.palette.primary.main} />
                            <Typography sx={{ fontWeight: 800, color: 'text.primary' }}>{m.label}</Typography>
                            <Chip size="small" label={`${m.groups.length} phase${m.groups.length > 1 ? 's' : ''}`} sx={{ fontWeight: 700 }} />
                          </Stack>
                          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                            Planned {Number(m.plannedQty).toLocaleString('en-IN')} · Dispatched {Number(m.actualQty).toLocaleString('en-IN')}
                          </Typography>
                        </Stack>
                        <Stack spacing={1.5}>
                          {m.groups.map(renderPhaseCard)}
                        </Stack>
                      </Box>
                    ))}
                  </Stack>
                )}
              </Stack>
            )}
          </Stack>

          <Box>
            <RiskRail comparison={comparison} onCarryForward={onCarryForward} />
          </Box>
        </Box>
      )}

      <AddPhaseDialog
        open={addDialogOpen}
        onClose={() => { setAddDialogOpen(false); setCarryForwardPrefill(null); }}
        scheduleItems={schedule?.items || []}
        onSubmit={handleAddPhase}
        isSaving={isCreating}
        prefillFor={carryForwardPrefill}
      />
    </Box>
  );
};

export default PlanWorkspace;
