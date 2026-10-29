import React, { useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Button, TextField, MenuItem, Switch, Chip, Tooltip, CircularProgress, Alert, alpha, Checkbox,
} from '@mui/material';
import { Save, RotateCcw, Lock, RefreshCw } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetO2dDoerPlanQuery, useGetO2dDoerPlanUsersQuery, useSaveO2dDoerPlanMutation, useApplyO2dDoerPlanToOpenMutation,
} from '../../store/api/o2dFmsApi';
import { PFMS, pfmsCardSx, pfmsTableHeadSx } from '../procurement/pfmsTheme';
import PeoplePicker from './PeoplePicker';

/**
 * FMS → Doer Assignment → O2D. One row per O2D step with only what matters:
 *   lead time (drives the plan date) · main doers · buddies · mandatory.
 * A step can have several main doers and several buddies: every one of them
 * gets the step, ANY one can complete it, and once one does it is done for all
 * (one shared step record — the actual "done by" is recorded).
 * Saved into the default O2D task template, which every NEW order is built
 * from — orders already running keep the setup they started with.
 * Plan date of a step = order received + the lead times of every step up to
 * and including it. An optional step can be skipped by its doer with a reason.
 */

const ids = (list) => (list || []).map((p) => p.id);

const fromServer = (s) => ({
  leadValue: s.leadTime?.value != null ? String(s.leadTime.value) : '',
  leadUnit: s.leadTime?.unit === 'DAYS' ? 'DAYS' : 'HOURS',
  doerIds: ids(s.doers),
  buddyIds: ids(s.buddies),
  mandatory: s.mandatory !== false,
});

const sameIds = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const sameRow = (a, b) => a.leadValue === b.leadValue && a.leadUnit === b.leadUnit
  && sameIds(a.doerIds, b.doerIds) && sameIds(a.buddyIds, b.buddyIds) && a.mandatory === b.mandatory;

const errorsOf = (base, value) => {
  const e = {};
  const leadChanged = value.leadValue !== base.leadValue || value.leadUnit !== base.leadUnit;
  const n = Number(value.leadValue);
  if (leadChanged && !(value.leadValue !== '' && Number.isFinite(n) && n > 0)) e.lead = 'Enter more than 0';
  if (value.doerIds.some((id) => value.buddyIds.includes(id))) e.buddy = 'Someone is both a main doer and a buddy';
  return e;
};

const O2dDoerPlan = () => {
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading, isError, refetch } = useGetO2dDoerPlanQuery();
  const { data: usersRes, error: usersError, refetch: refetchUsers } = useGetO2dDoerPlanUsersQuery();
  const [savePlan, { isLoading: saving }] = useSaveO2dDoerPlanMutation();
  const [applyToOpen, { isLoading: applying }] = useApplyO2dDoerPlanToOpenMutation();
  // Unsaved changes, per step code.
  const [edits, setEdits] = useState({});
  // Save also gives the orders already running (steps not done yet) the new doers.
  const [alsoRunning, setAlsoRunning] = useState(true);

  const steps = useMemo(() => data?.data?.steps || [], [data]);
  // People to pick from: the Delegation employees (Delegation → Employees is
  // the one employee list). Anyone already set on a step who is not one of
  // them — an ERP-only account, or someone inactive — is kept, in red and not
  // pickable, so the row still says who it is and can be fixed.
  const people = useMemo(() => {
    const list = (usersRes?.data || []).map((u) => ({ ...u, offLabel: u.inactive ? 'switched off in the ERP' : '' }));
    const seen = new Set(list.map((u) => u.id));
    steps.forEach((s) => [...(s.doers || []), ...(s.buddies || [])].forEach((p) => {
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        list.push({
          id: p.id, name: p.name, role: p.role, email: p.email,
          offLabel: p.isActive === false ? 'inactive' : 'not in Delegation',
        });
      }
    }));
    // Flag names used by more than one account.
    const count = new Map();
    list.forEach((p) => { const n = String(p.name || '').trim().toLowerCase(); count.set(n, (count.get(n) || 0) + 1); });
    return list.map((p) => ({ ...p, sameName: count.get(String(p.name || '').trim().toLowerCase()) > 1 }));
  }, [usersRes, steps]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const rows = steps.map((s) => {
    const base = fromServer(s);
    const value = { ...base, ...(edits[s.stepCode] || {}) };
    return { step: s, base, value, changed: !sameRow(base, value), errors: errorsOf(base, value) };
  });
  const changedRows = rows.filter((r) => r.changed);
  const hasErrors = changedRows.some((r) => Object.keys(r.errors).length > 0);

  const setField = (code, patch) => setEdits((prev) => ({ ...prev, [code]: { ...(prev[code] || {}), ...patch } }));

  const onSave = async () => {
    if (hasErrors) {
      enqueueSnackbar('Fix the highlighted rows first', { variant: 'warning' });
      return;
    }
    try {
      const res = await savePlan({
        steps: changedRows.map(({ step, base, value }) => ({
          stepCode: step.stepCode,
          // Only a changed lead time is sent; an untouched one stays as it is.
          ...((value.leadValue !== base.leadValue || value.leadUnit !== base.leadUnit)
            ? { leadTime: { value: Number(value.leadValue), unit: value.leadUnit } } : {}),
          doerIds: value.doerIds,
          buddyIds: value.buddyIds,
          mandatory: step.canBeOptional ? value.mandatory : true,
        })),
        applyToOpenOrders: alsoRunning,
      }).unwrap();
      setEdits({});
      const n = res?.data?.openOrdersUpdated || 0;
      enqueueSnackbar(
        alsoRunning
          ? `Saved — new orders follow this setup${n ? `, and ${n} running order${n === 1 ? '' : 's'} got the new doers` : ''}`
          : 'Saved — new O2D orders will follow this setup',
        { variant: 'success' },
      );
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not save the doer assignment', { variant: 'error' });
    }
  };

  // The whole saved plan onto every order already running — e.g. after the
  // plan was changed while orders were in progress.
  const onApplyToRunning = async () => {
    if (!window.confirm('Give every order already running the doers and buddies shown here?\n\nOnly steps not done yet change. Done steps, lead times and plan dates stay as they are.')) return;
    try {
      const res = await applyToOpen().unwrap();
      const n = res?.data?.openOrdersUpdated || 0;
      enqueueSnackbar(n ? `${n} running order${n === 1 ? '' : 's'} updated` : 'Running orders already match this setup', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not update the running orders', { variant: 'error' });
    }
  };

  if (isLoading) {
    return <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} /></Box>;
  }
  if (isError) {
    return (
      <Alert severity="error" action={<Button size="small" onClick={refetch}>Try again</Button>}>
        Could not load the O2D steps.
      </Alert>
    );
  }

  return (
    <Paper sx={{ ...pfmsCardSx, overflow: 'hidden' }}>
      {/* What this setup does, and Save */}
      <Box sx={{ px: 2, py: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, borderBottom: `1px solid ${PFMS.line}` }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ color: PFMS.ink, fontWeight: 700 }}>
            {steps.length} O2D steps
          </Typography>
          <Typography variant="caption" sx={{ color: PFMS.sub, display: 'block' }}>
            Plan date of each step = order received + lead times up to that step (lead times apply to new orders). With several doers, any one can complete the step — then it is done for all.
            People come from Delegation → Employees.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Tooltip title="Only steps not done yet change. Done steps, lead times and plan dates stay as they are." arrow>
            <Box component="label" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', mr: 0.5 }}>
              <Checkbox size="small" checked={alsoRunning} onChange={(e) => setAlsoRunning(e.target.checked)} sx={{ p: 0.25 }} />
              <Typography variant="caption" sx={{ color: PFMS.ink, fontWeight: 600 }}>Also update orders already running</Typography>
            </Box>
          </Tooltip>
          <Button size="small" variant="outlined" disabled={applying || saving || changedRows.length > 0} onClick={onApplyToRunning}
            startIcon={applying ? <CircularProgress size={14} color="inherit" /> : <RefreshCw size={15} />}>
            Update running orders
          </Button>
          {changedRows.length > 0 && (
            <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 700 }}>
              {changedRows.length} step{changedRows.length === 1 ? '' : 's'} changed
            </Typography>
          )}
          <Button size="small" startIcon={<RotateCcw size={15} />} disabled={!changedRows.length || saving} onClick={() => setEdits({})}>
            Undo
          </Button>
          <Button size="small" variant="contained" disableElevation startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
            disabled={!changedRows.length || saving} onClick={onSave}>
            Save
          </Button>
        </Box>
      </Box>

      {usersError && (
        <Alert severity="warning" sx={{ borderRadius: 0 }} action={<Button size="small" onClick={refetchUsers}>Try again</Button>}>
          {usersError?.data?.message || 'Could not load the employee list from Delegation.'}
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
              <TableCell sx={pfmsTableHeadSx} align="center">Mandatory</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!rows.length && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5, color: PFMS.sub }}>No O2D steps are set up yet.</TableCell></TableRow>
            )}
            {rows.map(({ step, value, changed, errors }, i) => {
              const offList = [...value.doerIds, ...value.buddyIds].map((id) => personById.get(id)).filter((p) => p?.offLabel);
              return (
                <TableRow key={step.stepCode} sx={{ bgcolor: changed ? alpha('#f59e0b', 0.07) : undefined, verticalAlign: 'top' }}>
                  <TableCell sx={{ color: PFMS.sub, fontWeight: 700, pt: 1.75 }}>{i + 1}</TableCell>
                  <TableCell sx={{ pt: 1.5 }}>
                    <Typography variant="body2" fontWeight={700} sx={{ color: PFMS.ink }}>{step.stepCode} · {step.name}</Typography>
                  </TableCell>

                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Box sx={{ display: 'flex', gap: 0.75 }}>
                      <TextField
                        size="small" type="number" value={value.leadValue}
                        onChange={(e) => setField(step.stepCode, { leadValue: e.target.value })}
                        error={!!errors.lead} inputProps={{ min: 0, step: 'any', 'aria-label': `Lead time for ${step.stepCode}` }}
                        sx={{ width: 84 }}
                      />
                      <TextField
                        select size="small" value={value.leadUnit}
                        onChange={(e) => setField(step.stepCode, { leadUnit: e.target.value })}
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
                      onChange={(list) => setField(step.stepCode, { doerIds: list })} />
                    {!value.doerIds.length && (
                      <Typography variant="caption" sx={{ color: '#b45309', display: 'block', mt: 0.25 }}>No main doer set</Typography>
                    )}
                  </TableCell>

                  <TableCell>
                    <PeoplePicker people={people} personById={personById} selected={value.buddyIds} placeholder="No buddy (optional)"
                      error={errors.buddy} onChange={(list) => setField(step.stepCode, { buddyIds: list })} />
                    {errors.buddy && <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mt: 0.25 }}>{errors.buddy}</Typography>}
                    {offList.length > 0 && (
                      <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mt: 0.25 }}>
                        Red = {offList.some((p) => p.offLabel === 'not in Delegation') ? 'not in Delegation Employees' : 'inactive'} — replace them
                      </Typography>
                    )}
                  </TableCell>

                  <TableCell align="center" sx={{ pt: 1.25 }}>
                    {step.canBeOptional ? (
                      <Tooltip title={value.mandatory ? 'Must be done — cannot be skipped' : 'Optional — its doer can skip it with a reason'}>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
                          <Switch size="small" checked={value.mandatory}
                            onChange={(e) => setField(step.stepCode, { mandatory: e.target.checked })}
                            inputProps={{ 'aria-label': `${step.stepCode} mandatory` }} />
                          <Typography variant="caption" fontWeight={700} sx={{ color: value.mandatory ? PFMS.ink : PFMS.sub, width: 22 }}>
                            {value.mandatory ? 'Yes' : 'No'}
                          </Typography>
                        </Box>
                      </Tooltip>
                    ) : (
                      <Tooltip title="The order starts at this step, so it is always mandatory">
                        <Chip size="small" icon={<Lock size={12} />} label="Always" variant="outlined" sx={{ fontWeight: 700, color: PFMS.sub }} />
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default O2dDoerPlan;
