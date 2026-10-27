import React, { useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Button, TextField, MenuItem, Tooltip, IconButton, CircularProgress, Alert, alpha, Checkbox,
} from '@mui/material';
import { Save, RotateCcw, RefreshCw, History } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetFmsDoerPlanQuery, useGetFmsDoerPlanUsersQuery, useSaveFmsDoerPlanMutation, useApplyFmsDoerPlanToOpenMutation,
} from '../../store/api/fmsDoerApi';
import { PFMS, pfmsCardSx, pfmsTableHeadSx } from '../procurement/pfmsTheme';
import PeoplePicker from './PeoplePicker';
import AssignmentHistoryDialog from './AssignmentHistoryDialog';

/**
 * FMS → Doer Assignment → Purchase. The same grid as O2D: one row per step
 * with lead time · main doers · buddies, edited in place and saved together.
 *   - Any main doer can do the step; buddies are the backup and see the task
 *     "as buddy" in My FMS Tasks.
 *   - Lead time gives each task its due date (when the item reached the step
 *     + lead time), which drives Overdue / Due soon on the task lists. Blank =
 *     no due date.
 *   - New items take this setup when they reach a step; items already
 *     waiting change only with "Also update items already pending" or
 *     "Update pending items".
 * Purchase-specific: people are active ERP users, and a person lacking the
 * step's permission is flagged (being a doer grants nothing); saving such a
 * pick asks for confirmation. There is no Mandatory switch — Purchase steps
 * are document statuses, and the optional ones (PI) are already modelled.
 */

const FMS_KEY = 'PURCHASE';
const ids = (list) => (list || []).map((p) => p.id);

const fromServer = (s) => ({
  leadValue: s.leadTime?.value != null ? String(s.leadTime.value) : '',
  leadUnit: s.leadTime?.unit === 'DAYS' ? 'DAYS' : 'HOURS',
  doerIds: ids(s.doers),
  buddyIds: ids(s.buddies),
});

const sameIds = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const leadChanged = (a, b) => a.leadValue !== b.leadValue || (a.leadValue !== '' && a.leadUnit !== b.leadUnit);
const sameRow = (a, b) => !leadChanged(a, b) && sameIds(a.doerIds, b.doerIds) && sameIds(a.buddyIds, b.buddyIds);

const errorsOf = (base, value) => {
  const e = {};
  const n = Number(value.leadValue);
  if (leadChanged(base, value) && value.leadValue !== '' && !(Number.isFinite(n) && n > 0)) e.lead = 'Enter more than 0, or leave blank';
  if (value.doerIds.some((id) => value.buddyIds.includes(id))) e.buddy = 'Someone is both a main doer and a buddy';
  return e;
};

const PurchaseDoerPlan = () => {
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, isError, refetch } = useGetFmsDoerPlanQuery(FMS_KEY);
  const { data: usersRes, error: usersError, refetch: refetchUsers } = useGetFmsDoerPlanUsersQuery(FMS_KEY);
  const [savePlan, { isLoading: saving }] = useSaveFmsDoerPlanMutation();
  const [applyToOpen, { isLoading: applying }] = useApplyFmsDoerPlanToOpenMutation();
  // Unsaved changes, per step key.
  const [edits, setEdits] = useState({});
  // Save also gives the items already waiting at a changed step the new doers.
  const [alsoPending, setAlsoPending] = useState(true);
  const [historyStep, setHistoryStep] = useState(null);

  const steps = useMemo(() => data?.data?.steps || [], [data]);
  // Active ERP users; anyone set on a step who is no longer active is kept,
  // in red and not pickable, so the row still says who it is.
  const people = useMemo(() => {
    const list = (usersRes?.data || []).map((u) => ({ ...u, offLabel: '' }));
    const seen = new Set(list.map((u) => u.id));
    steps.forEach((s) => [...(s.doers || []), ...(s.buddies || [])].forEach((p) => {
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        list.push({ id: p.id, name: p.name, role: p.role, email: p.email, offLabel: 'inactive', missingByStep: {} });
      }
    }));
    const count = new Map();
    list.forEach((p) => { const n = String(p.name || '').trim().toLowerCase(); count.set(n, (count.get(n) || 0) + 1); });
    return list.map((p) => ({ ...p, sameName: count.get(String(p.name || '').trim().toLowerCase()) > 1 }));
  }, [usersRes, steps]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const rows = steps.map((s) => {
    const base = fromServer(s);
    const value = { ...base, ...(edits[s.stepKey] || {}) };
    return { step: s, base, value, changed: !sameRow(base, value), errors: errorsOf(base, value) };
  });
  const changedRows = rows.filter((r) => r.changed);
  const hasErrors = changedRows.some((r) => Object.keys(r.errors).length > 0);

  const setField = (key, patch) => setEdits((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));

  const send = (acknowledgeMissingPermission) => savePlan({
    fmsKey: FMS_KEY,
    steps: changedRows.map(({ step, base, value }) => ({
      stepKey: step.stepKey,
      // Only a changed lead time is sent; blank clears it (no due date).
      ...(leadChanged(base, value)
        ? { leadTime: value.leadValue === '' ? null : { value: Number(value.leadValue), unit: value.leadUnit } } : {}),
      doerIds: value.doerIds,
      buddyIds: value.buddyIds,
    })),
    applyToOpenTasks: alsoPending,
    acknowledgeMissingPermission,
  }).unwrap();

  const onSave = async () => {
    if (hasErrors) {
      enqueueSnackbar('Fix the highlighted rows first', { variant: 'warning' });
      return;
    }
    try {
      let res;
      try {
        res = await send(false);
      } catch (err) {
        // 409 = someone picked lacks the step's (advisory) permission — confirm.
        if (err?.status !== 409) throw err;
        if (!window.confirm(`${err?.data?.message || 'Some people lack the step permission.'}\n\nBeing the doer does not grant access. Assign anyway?`)) return;
        res = await send(true);
      }
      setEdits({});
      const n = res?.data?.openTasksUpdated || 0;
      enqueueSnackbar(
        alsoPending
          ? `Saved — new items follow this setup${n ? `, and ${n} pending item${n === 1 ? '' : 's'} got the new doers` : ''}`
          : 'Saved — items reaching these steps from now on follow this setup',
        { variant: 'success' },
      );
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not save the doer assignment', { variant: 'error' });
    }
  };

  const onApplyToPending = async () => {
    if (!window.confirm('Give every item already waiting the doers and buddies shown here?\n\nDue dates and finished steps stay as they are. Each move is recorded in that item\'s task history.')) return;
    try {
      const res = await applyToOpen({ fmsKey: FMS_KEY }).unwrap();
      const n = res?.data?.openTasksUpdated || 0;
      enqueueSnackbar(n ? `${n} pending item${n === 1 ? '' : 's'} updated` : 'Pending items already match this setup', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not update the pending items', { variant: 'error' });
    }
  };

  if (isLoading) {
    return <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} /></Box>;
  }
  if (isError) {
    return (
      <Alert severity="error" action={<Button size="small" onClick={refetch}>Try again</Button>}>
        Could not load the Purchase steps.
      </Alert>
    );
  }

  return (
    <Paper sx={{ ...pfmsCardSx, overflow: 'hidden' }} data-testid="purchase-doer-plan">
      {/* What this setup does, and Save */}
      <Box sx={{ px: 2, py: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, borderBottom: `1px solid ${PFMS.line}` }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ color: PFMS.ink, fontWeight: 700 }}>
            {steps.length} Purchase steps
          </Typography>
          <Typography variant="caption" sx={{ color: PFMS.sub, display: 'block' }}>
            Due date of a task = when the item reached the step + its lead time (blank = no due date). With several doers, any one can do the step — then it is done for all.
            People are active ERP users; being a doer does not grant permissions.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Tooltip title="Items already waiting at a changed step get its new doers and buddies. Due dates stay as they are." arrow>
            <Box component="label" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', mr: 0.5 }}>
              <Checkbox size="small" checked={alsoPending} onChange={(e) => setAlsoPending(e.target.checked)} sx={{ p: 0.25 }}
                inputProps={{ 'data-testid': 'plan-also-pending' }} />
              <Typography variant="caption" sx={{ color: PFMS.ink, fontWeight: 600 }}>Also update items already pending</Typography>
            </Box>
          </Tooltip>
          <Button size="small" variant="outlined" disabled={applying || saving || changedRows.length > 0} onClick={onApplyToPending}
            data-testid="plan-apply-pending"
            startIcon={applying ? <CircularProgress size={14} color="inherit" /> : <RefreshCw size={15} />}>
            Update pending items
          </Button>
          {changedRows.length > 0 && (
            <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 700 }} data-testid="plan-changed-count">
              {changedRows.length} step{changedRows.length === 1 ? '' : 's'} changed
            </Typography>
          )}
          <Button size="small" startIcon={<RotateCcw size={15} />} disabled={!changedRows.length || saving} onClick={() => setEdits({})}>
            Undo
          </Button>
          <Button size="small" variant="contained" disableElevation data-testid="plan-save"
            startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
            disabled={!changedRows.length || saving} onClick={onSave}>
            Save
          </Button>
        </Box>
      </Box>

      {usersError && (
        <Alert severity="warning" sx={{ borderRadius: 0 }} action={<Button size="small" onClick={refetchUsers}>Try again</Button>}>
          {usersError?.data?.message || 'Could not load the user list.'}
        </Alert>
      )}

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...pfmsTableHeadSx, width: 44 }}>#</TableCell>
              <TableCell sx={pfmsTableHeadSx}>Step</TableCell>
              <TableCell sx={pfmsTableHeadSx}>Lead time</TableCell>
              <TableCell sx={pfmsTableHeadSx}>Main doers</TableCell>
              <TableCell sx={pfmsTableHeadSx}>Buddies</TableCell>
              <TableCell sx={pfmsTableHeadSx} align="right">Pending</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!rows.length && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5, color: PFMS.sub }}>No Purchase steps found.</TableCell></TableRow>
            )}
            {rows.map(({ step, value, changed, errors }) => {
              const offList = [...value.doerIds, ...value.buddyIds].map((id) => personById.get(id)).filter((p) => p?.offLabel);
              const noteOf = (p) => {
                const missing = p?.missingByStep?.[step.stepKey];
                return missing?.length ? `lacks ${missing.join(', ')}` : '';
              };
              const lacking = [...value.doerIds, ...value.buddyIds].map((id) => personById.get(id)).filter((p) => noteOf(p));
              const notOnPlan = step.openTasks?.notOnPlan || 0;
              return (
                <TableRow key={step.stepKey} data-testid="plan-row" data-step={step.stepKey}
                  sx={{ bgcolor: changed ? alpha('#f59e0b', 0.07) : undefined, verticalAlign: 'top' }}>
                  <TableCell sx={{ color: PFMS.sub, fontWeight: 700, pt: 1.75 }}>{step.sequence}</TableCell>
                  <TableCell sx={{ pt: 1.5, minWidth: 200 }}>
                    <Typography variant="body2" fontWeight={700} sx={{ color: PFMS.ink }}>{step.code} · {step.label}</Typography>
                    <Typography variant="caption" sx={{ color: PFMS.sub, display: 'block' }}>{step.description}</Typography>
                    {step.permissions?.length > 0 && (
                      <Typography variant="caption" sx={{ color: PFMS.sub, display: 'block' }}>
                        Permission: {step.permissions.map((p) => p.slug).join(', ')}
                      </Typography>
                    )}
                  </TableCell>

                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Box sx={{ display: 'flex', gap: 0.75 }}>
                      <TextField
                        size="small" type="number" value={value.leadValue} placeholder="None"
                        onChange={(e) => setField(step.stepKey, { leadValue: e.target.value })}
                        error={!!errors.lead} inputProps={{ min: 0, step: 'any', 'aria-label': `Lead time for ${step.code}`, 'data-testid': 'plan-lead-value' }}
                        sx={{ width: 84 }}
                      />
                      <TextField
                        select size="small" value={value.leadUnit}
                        onChange={(e) => setField(step.stepKey, { leadUnit: e.target.value })}
                        SelectProps={{ SelectDisplayProps: { 'data-testid': 'plan-lead-unit' } }}
                        sx={{ width: 100 }}
                      >
                        <MenuItem value="HOURS">Hours</MenuItem>
                        <MenuItem value="DAYS">Days</MenuItem>
                      </TextField>
                    </Box>
                    {errors.lead && <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mt: 0.25 }}>{errors.lead}</Typography>}
                  </TableCell>

                  <TableCell>
                    <PeoplePicker people={people} personById={personById} selected={value.doerIds} placeholder="Pick main doers"
                      noteOf={noteOf} inputProps={{ 'data-testid': 'plan-doers-input', 'aria-label': `Main doers for ${step.code}` }}
                      onChange={(list) => setField(step.stepKey, { doerIds: list })} />
                    {!value.doerIds.length && (
                      <Typography variant="caption" sx={{ color: '#b45309', display: 'block', mt: 0.25 }}>No main doer set</Typography>
                    )}
                  </TableCell>

                  <TableCell>
                    <PeoplePicker people={people} personById={personById} selected={value.buddyIds} placeholder="No buddy (optional)"
                      error={errors.buddy} noteOf={noteOf} inputProps={{ 'data-testid': 'plan-buddies-input', 'aria-label': `Buddies for ${step.code}` }}
                      onChange={(list) => setField(step.stepKey, { buddyIds: list })} />
                    {errors.buddy && <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mt: 0.25 }}>{errors.buddy}</Typography>}
                    {offList.length > 0 && (
                      <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mt: 0.25 }}>Red = inactive — replace them</Typography>
                    )}
                    {lacking.length > 0 && (
                      <Typography variant="caption" sx={{ color: '#b45309', display: 'block', mt: 0.25 }}>
                        Amber = lacks this step's permission
                      </Typography>
                    )}
                  </TableCell>

                  <TableCell align="right" sx={{ whiteSpace: 'nowrap', pt: 1.25 }}>
                    <Typography variant="body2" fontWeight={700} data-testid="plan-pending">{step.openTasks?.total || 0}</Typography>
                    {notOnPlan > 0 && (
                      <Typography variant="caption" sx={{ color: '#b45309', display: 'block' }}>{notOnPlan} not on this setup</Typography>
                    )}
                    <Tooltip title="Doer history">
                      <IconButton size="small" onClick={() => setHistoryStep({ stepKey: step.stepKey, code: step.code, label: step.label })}
                        aria-label={`Doer history for ${step.code}`}>
                        <History size={16} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <AssignmentHistoryDialog open={Boolean(historyStep)} onClose={() => setHistoryStep(null)} fmsKey={FMS_KEY} step={historyStep} />
    </Paper>
  );
};

export default PurchaseDoerPlan;
