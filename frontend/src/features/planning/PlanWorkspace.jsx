import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Paper, Typography, Stack, Autocomplete, TextField, Button,
  alpha, useTheme, CircularProgress, Skeleton, Chip,
} from '@mui/material';
import { Plus, CalendarPlus, Search, LayoutList } from 'lucide-react';
import { useSnackbar } from 'notistack';
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
  const { enqueueSnackbar } = useSnackbar();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [carryForwardPrefill, setCarryForwardPrefill] = useState(null);

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
    if (val?.soNumber) setSearchParams({ so: val.soNumber }, { replace: true });
    else setSearchParams({}, { replace: true });
  };

  const soNumber = selectedOrder?.soNumber;
  const { data: scheduleRes, isFetching: scheduleLoading } = useGetScheduleQuery(soNumber, { skip: !soNumber });
  const { data: comparisonRes, isFetching: comparisonLoading } = useGetOrderComparisonQuery(soNumber, { skip: !soNumber });
  const schedule   = scheduleRes?.data;
  const comparison = comparisonRes?.data;

  const [createPhase, { isLoading: isCreating }] = useCreatePhaseMutation();
  const [updatePhase, { isLoading: isUpdating }] = useUpdatePhaseMutation();
  const [deletePhase, { isLoading: isDeleting }] = useDeletePhaseMutation();

  const phaseGroups = useMemo(() => buildPhaseGroups(schedule), [schedule]);

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

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Page header */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'flex-end' }}>
        <Box>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: 'text.primary', letterSpacing: '-0.015em', lineHeight: 1.2 }}>
            Dispatch Planning
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Break a sales order into phased dispatches. Each phase carries its own date and per-SKU plan.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.25} sx={{ width: { xs: '100%', md: 'auto' } }}>
          <Autocomplete
            options={orders}
            loading={ordersLoading}
            value={selectedOrder}
            onChange={(_, val) => onSelectOrder(val)}
            getOptionLabel={(o) => o ? `${o.soNumber} — ${o.partyName || ''}` : ''}
            isOptionEqualToValue={(a, b) => a._id === b?._id}
            sx={{ width: { xs: '100%', md: 380 } }}
            size="small"
            renderInput={(p) => (
              <TextField
                {...p}
                placeholder="Search sales order..."
                InputProps={{ ...p.InputProps, startAdornment: <Search size={14} style={{ marginLeft: 4, marginRight: 6 }} /> }}
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
          <Button
            variant="contained"
            startIcon={<Plus size={14} />}
            onClick={() => setAddDialogOpen(true)}
            disabled={!soNumber || scheduleLoading}
          >
            Add Phase
          </Button>
        </Stack>
      </Stack>

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
            <PhaseTimeline phaseChips={schedule.phaseChips || []} />

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
                {phaseGroups.map((g) => (
                  <PhaseCard
                    key={g.phaseNo}
                    phaseNo={g.phaseNo}
                    plannedDate={g.plannedDate}
                    status={g.status}
                    items={g.items}
                    isSaving={isUpdating}
                    onSave={(data) => handleUpdatePhase(g.phaseId, data)}
                    onDelete={() => handleDeletePhase(g.phaseId)}
                  />
                ))}
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
