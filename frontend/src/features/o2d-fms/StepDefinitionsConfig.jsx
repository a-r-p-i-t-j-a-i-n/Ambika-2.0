import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Switch, FormControlLabel, Skeleton, Tooltip, alpha,
} from '@mui/material';
import { Plus, Pencil, Trash2, Settings2, ChevronUp, ChevronDown, Zap, GripVertical, Layers } from 'lucide-react';
import {
  useGetStepDefinitionsQuery, useCreateStepDefinitionMutation,
  useUpdateStepDefinitionMutation, useDeleteStepDefinitionMutation,
  useReorderStepDefinitionsMutation,
} from '../../store/api/o2dFmsApi';
import { FMS_CATALOGS, DEFAULT_FMS_KEY } from './fmsCatalogs';

const ROLES = ['PLANNER', 'SALES_EXEC', 'DISPATCH_SUPERVISOR', 'FINANCE', 'VIEWER', 'MD'];
const PHASES = ['PRE_PRODUCTION', 'PLANNING', 'EXECUTION', 'POST_DISPATCH'];
// Auto-advance triggers — link a step to a real action so it completes itself.
const TRIGGERS = ['MANUAL', 'ORDER_ENTRY', 'DISPATCH_PLAN', 'ACTUAL_DISPATCH', 'INVOICE', 'POD', 'PAYMENT'];
const TRIGGER_LABEL = {
  MANUAL: 'Manual', ORDER_ENTRY: 'Order entry', DISPATCH_PLAN: 'Dispatch plan',
  ACTUAL_DISPATCH: 'Actual dispatch', INVOICE: 'Invoice', POD: 'POD', PAYMENT: 'Payment',
};

const blank = {
  stepCode: '', name: '', description: '', defaultOwnerRole: '', ownerName: '', ownerEmail: '',
  whenText: '', tool: '',
  slaMinutes: 60, slaFrom: 'PREV_ACTUAL', sequence: 1, phase: 'PRE_PRODUCTION',
  triggerKey: 'MANUAL', requiresLink: false, requiresAttachment: false, isActive: true,
};

const StepDefinitionsConfig = () => {
  // Which FMS catalog we're viewing/editing (FMS 1.0 vs Current Sheet FMS).
  const [fmsKey, setFmsKey] = useState(DEFAULT_FMS_KEY);
  const { data, isLoading } = useGetStepDefinitionsQuery(fmsKey);
  const [createDef] = useCreateStepDefinitionMutation();
  const [updateDef] = useUpdateStepDefinitionMutation();
  const [deleteDef] = useDeleteStepDefinitionMutation();
  const [reorderDefs] = useReorderStepDefinitionsMutation();

  const [form, setForm] = useState(null); // null = closed; object = editing/creating
  const [error, setError] = useState('');
  const defs = data?.data || [];

  // Local ordered copy so drag/arrow reordering feels instant; re-synced whenever
  // the server list changes.
  const [rows, setRows] = useState([]);
  useEffect(() => { setRows(data?.data || []); }, [data]);

  const dragFrom = useRef(null);
  const [dragFromIdx, setDragFromIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  // Persist a re-sequenced list (matches the backend reorder contract).
  const persist = async (next) => {
    setRows(next);
    try { await reorderDefs(next.map((d, i) => ({ id: d._id, sequence: i + 1 }))).unwrap(); }
    catch (e) { setError(e?.data?.message || 'Could not save the new order.'); }
  };

  // Arrow up/down (accessible fallback).
  const move = (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  };

  // Native HTML5 drag-and-drop reorder.
  const onDragStart = (i) => { dragFrom.current = i; setDragFromIdx(i); };
  const onDragOver = (e, i) => { e.preventDefault(); if (i !== overIdx) setOverIdx(i); };
  const onDrop = (toIndex) => {
    const from = dragFrom.current;
    dragFrom.current = null; setDragFromIdx(null); setOverIdx(null);
    if (from === null || from === toIndex) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(toIndex, 0, moved);
    persist(next);
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    setError('');
    try {
      const payload = { ...form, slaMinutes: Number(form.slaMinutes), sequence: Number(form.sequence) };
      if (form._id) await updateDef({ id: form._id, ...payload }).unwrap();
      else await createDef({ ...payload, fmsKey }).unwrap(); // new steps land in the active FMS
      setForm(null);
    } catch (e) {
      setError(e?.data?.message || 'Could not save the step.');
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Settings2 size={20} />
            <Typography variant="h5" sx={{ fontWeight: 800 }}>O2D Step Catalog</Typography>
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Define the Who / What / How / When for every step. New orders use this catalog automatically.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => { setForm({ ...blank, sequence: defs.length + 1 }); }}>
          Add step
        </Button>
      </Stack>

      {/* FMS catalog picker — click a card to view & edit that flow's steps. */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        {FMS_CATALOGS.map((fms) => {
          const active = fms.key === fmsKey;
          return (
            <Paper
              key={fms.key}
              onClick={() => setFmsKey(fms.key)}
              sx={{
                flex: 1, p: 1.75, borderRadius: 3, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 1.5,
                border: '2px solid', borderColor: active ? '#1d4ed8' : 'divider',
                bgcolor: active ? alpha('#1d4ed8', 0.05) : 'background.paper',
                transition: 'all .15s', '&:hover': { borderColor: '#1d4ed8' },
              }}
            >
              <Box sx={{ width: 38, height: 38, borderRadius: 2, display: 'grid', placeItems: 'center',
                bgcolor: active ? '#1d4ed8' : alpha('#1d4ed8', 0.1), color: active ? '#fff' : '#1d4ed8', flexShrink: 0 }}>
                <Layers size={18} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 800, color: active ? '#1d4ed8' : 'text.primary' }}>{fms.label}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap>{fms.desc}</Typography>
              </Box>
            </Paper>
          );
        })}
      </Stack>

      <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
        {isLoading ? <Skeleton variant="rounded" height={300} /> : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha('#1d4ed8', 0.06) }}>
                <TableCell sx={{ width: 90 }}>Order</TableCell><TableCell>Step</TableCell><TableCell>Who</TableCell>
                <TableCell>Auto-advance</TableCell><TableCell>SLA</TableCell><TableCell>Phase</TableCell>
                <TableCell>Active</TableCell><TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((dStep, index) => (
                <TableRow
                  key={dStep._id}
                  hover
                  draggable
                  onDragStart={() => onDragStart(index)}
                  onDragOver={(e) => onDragOver(e, index)}
                  onDrop={() => onDrop(index)}
                  onDragEnd={() => { dragFrom.current = null; setDragFromIdx(null); setOverIdx(null); }}
                  sx={{
                    opacity: dragFromIdx === index ? 0.4 : 1,
                    bgcolor: overIdx === index && dragFromIdx !== null && dragFromIdx !== index ? alpha('#1d4ed8', 0.08) : undefined,
                    boxShadow: overIdx === index && dragFromIdx !== null && dragFromIdx !== index ? 'inset 0 2px 0 #1d4ed8' : undefined,
                  }}
                >
                  <TableCell>
                    <Stack direction="row" alignItems="center" spacing={0.25}>
                      <Tooltip title="Drag to reorder"><Box sx={{ color: 'text.disabled', display: 'flex', cursor: 'grab' }}><GripVertical size={16} /></Box></Tooltip>
                      <Stack>
                        <IconButton size="small" disabled={index === 0} onClick={() => move(index, -1)} sx={{ p: 0.2 }}><ChevronUp size={13} /></IconButton>
                        <IconButton size="small" disabled={index === rows.length - 1} onClick={() => move(index, 1)} sx={{ p: 0.2 }}><ChevronDown size={13} /></IconButton>
                      </Stack>
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>{index + 1}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontWeight: 600 }}>{dStep.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{dStep.stepCode}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{dStep.defaultOwnerUserId?.name || dStep.ownerName || dStep.defaultOwnerRole || '—'}</Typography>
                    {dStep.ownerEmail && <Typography variant="caption" color="text.secondary">{dStep.ownerEmail}</Typography>}
                  </TableCell>
                  <TableCell>
                    {dStep.triggerKey && dStep.triggerKey !== 'MANUAL'
                      ? <Chip size="small" icon={<Zap size={12} />} label={TRIGGER_LABEL[dStep.triggerKey]} sx={{ bgcolor: alpha('#0f766e', 0.12), color: '#0f766e' }} />
                      : <Typography variant="caption" color="text.secondary">Manual</Typography>}
                  </TableCell>
                  <TableCell>{dStep.slaMinutes} min<br /><Typography variant="caption" color="text.secondary">{dStep.slaFrom === 'ORDER_RECEIVED' ? 'from order' : 'from prev'}</Typography></TableCell>
                  <TableCell><Chip size="small" label={dStep.phase?.replace('_', ' ')} variant="outlined" /></TableCell>
                  <TableCell><Chip size="small" label={dStep.isActive ? 'Active' : 'Off'} color={dStep.isActive ? 'success' : 'default'} /></TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit"><IconButton size="small" onClick={() => setForm(dStep)}><Pencil size={15} /></IconButton></Tooltip>
                    <Tooltip title="Deactivate"><IconButton size="small" onClick={() => deleteDef(dStep._id)}><Trash2 size={15} /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Dialog open={!!form} onClose={() => setForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{form?._id ? 'Edit step' : 'Add step'}</DialogTitle>
        <DialogContent dividers>
          {form && (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <Stack direction="row" spacing={2}>
                <TextField label="Step code" value={form.stepCode} onChange={set('stepCode')} size="small" sx={{ width: 140 }} />
                <TextField label="Name" value={form.name} onChange={set('name')} size="small" fullWidth />
              </Stack>
              <TextField label="Description (What)" value={form.description} onChange={set('description')} size="small" fullWidth multiline minRows={2} />
              <Stack direction="row" spacing={2}>
                <TextField select label="Doer role (Who)" value={form.defaultOwnerRole || ''} onChange={set('defaultOwnerRole')} size="small" fullWidth>
                  <MenuItem value=""><em>None</em></MenuItem>
                  {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                </TextField>
                <TextField label="Tool (How)" value={form.tool || ''} onChange={set('tool')} size="small" fullWidth />
              </Stack>
              {/* Free-text owner (the sheet's "Who" — used when the person isn't a system user). */}
              <Stack direction="row" spacing={2}>
                <TextField label="Owner name" value={form.ownerName || ''} onChange={set('ownerName')} size="small" fullWidth placeholder="e.g. Upasana" />
                <TextField label="Owner email" value={form.ownerEmail || ''} onChange={set('ownerEmail')} size="small" fullWidth placeholder="pc@msambikaglobal.in" />
              </Stack>
              <TextField label="When (note)" value={form.whenText || ''} onChange={set('whenText')} size="small" fullWidth placeholder="e.g. Whenever Received / 10 days" />
              <Stack direction="row" spacing={2}>
                <TextField label="SLA (minutes)" type="number" value={form.slaMinutes} onChange={set('slaMinutes')} size="small" fullWidth />
                <TextField select label="SLA from (When)" value={form.slaFrom} onChange={set('slaFrom')} size="small" fullWidth>
                  <MenuItem value="PREV_ACTUAL">Previous step done</MenuItem>
                  <MenuItem value="ORDER_RECEIVED">Order received</MenuItem>
                </TextField>
              </Stack>
              <Stack direction="row" spacing={2}>
                <TextField label="Sequence" type="number" value={form.sequence} onChange={set('sequence')} size="small" sx={{ width: 140 }} />
                <TextField select label="Phase" value={form.phase} onChange={set('phase')} size="small" fullWidth>
                  {PHASES.map((p) => <MenuItem key={p} value={p}>{p.replace('_', ' ')}</MenuItem>)}
                </TextField>
              </Stack>
              <TextField
                select label="Auto-advance trigger" value={form.triggerKey || 'MANUAL'} onChange={set('triggerKey')}
                size="small" fullWidth
                helperText="When this real action happens in the app, the step completes itself. 'Manual' = only a person ticks it done."
              >
                {TRIGGERS.map((t) => <MenuItem key={t} value={t}>{TRIGGER_LABEL[t]}</MenuItem>)}
              </TextField>
              <Stack direction="row" spacing={2}>
                <FormControlLabel control={<Switch checked={!!form.requiresLink} onChange={set('requiresLink')} />} label="Requires link" />
                <FormControlLabel control={<Switch checked={!!form.requiresAttachment} onChange={set('requiresAttachment')} />} label="Requires attachment" />
                <FormControlLabel control={<Switch checked={!!form.isActive} onChange={set('isActive')} />} label="Active" />
              </Stack>
              {error && <Typography color="error" variant="body2">{error}</Typography>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForm(null)}>Cancel</Button>
          <Button variant="contained" onClick={save}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default StepDefinitionsConfig;
