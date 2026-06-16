import React, { useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, IconButton, Chip, TextField, MenuItem, Menu,
  Switch, FormControlLabel, Divider, Accordion, AccordionSummary, AccordionDetails,
  Skeleton, Tooltip, alpha, Dialog, DialogTitle, DialogContent, DialogActions, Autocomplete, CircularProgress,
} from '@mui/material';
import {
  Plus, Trash2, Star, Pencil, ChevronDown, ListChecks, X, Save, ClipboardList,
  LayoutTemplate, Target, HelpCircle, FormInput, Paperclip, ShieldCheck, Link2,
} from 'lucide-react';
import { ACTION_LINKS, actionLinkMeta, TRIGGER_TO_ACTION } from './actionLinks';
import { FMS_CATALOGS, DEFAULT_FMS_KEY } from './fmsCatalogs';
import {
  useGetTaskTemplatesQuery, useCreateTaskTemplateMutation, useUpdateTaskTemplateMutation,
  useSetDefaultTemplateMutation, useDeleteTaskTemplateMutation, useGetStepDefinitionsQuery,
  usePlanOrderMutation, useGetProcessByOrderQuery,
} from '../../store/api/o2dFmsApi';
import { useGetOrdersQuery } from '../../store/api/orderApi';
import { useListAccessUsersQuery } from '../../store/api/accessControlApi';

const UNITS = ['MINUTES', 'HOURS', 'DAYS', 'WEEKS', 'MONTHS'];

// Build editor rows from the step catalog, merged with any saved template steps.
const mergeSteps = (defs, tplSteps = []) => {
  const byCode = new Map(tplSteps.map((s) => [s.stepCode, s]));
  return defs.map((d) => {
    const t = byCode.get(d.stepCode) || {};
    return {
      stepCode: d.stepCode,
      stepName: d.name,
      triggerKey: d.triggerKey || 'MANUAL',
      taskTitle: t.taskTitle || '',
      instructions: t.instructions || '',
      checklist: (t.checklist || []).map((c) => c.text),
      verifications: (t.verifications || []).map((v) => v.question),
      formFields: (t.formFields || []).map((f) => ({ label: f.label, fieldType: f.fieldType || 'TEXT', required: f.required !== false })),
      proof: { required: !!t.proof?.required, minCount: t.proof?.minCount || 1 },
      approval: {
        required: !!t.approval?.required,
        approverIds: (t.approval?.approverIds || []).map((x) => String(x._id || x)),
      },
      actionLink: t.actionLink || '',
      leadTime: { value: t.leadTime?.value ?? '', unit: t.leadTime?.unit || 'HOURS' },
      assigneeUserIds: (t.assigneeUserIds?.length ? t.assigneeUserIds : (t.assigneeUserId ? [t.assigneeUserId] : [])).map((x) => String(x._id || x)),
      buddyUserIds: (t.buddyUserIds?.length ? t.buddyUserIds : (t.buddyUserId ? [t.buddyUserId] : [])).map((x) => String(x._id || x)),
    };
  });
};

// Build editor rows from a specific order's live process steps (for custom mode).
const mergeStepsFromProcess = (defs, procSteps = []) => {
  const byCode = new Map(procSteps.map((s) => [s.stepCode, s]));
  return defs.map((d) => {
    const s = byCode.get(d.stepCode) || {};
    return {
      stepCode: d.stepCode,
      stepName: d.name,
      taskTitle: s.taskTitle || '',
      instructions: s.instructions || '',
      checklist: (s.checklist || []).map((c) => c.text),
      leadTime: { value: '', unit: 'HOURS' },
      assigneeUserIds: (s.assignees?.length ? s.assignees : (s.assignedTo ? [s.assignedTo] : [])).map((x) => String(x._id || x)),
      buddyUserIds: (s.buddies?.length ? s.buddies : (s.buddyUserId ? [s.buddyUserId] : [])).map((x) => String(x._id || x)),
    };
  });
};

// What "+ Add requirement" can add (checklist always shows; these are the extras).
const REQ_TYPES = [
  { key: 'verifications', label: 'Yes/No verification questions', icon: HelpCircle, hint: '"Stock physically verified?" — No demands a remark' },
  { key: 'formFields', label: 'Data capture (form fields)', icon: FormInput, hint: 'Record values: Vehicle No., Qty loaded…' },
  { key: 'proof', label: 'Proof attachments required', icon: Paperclip, hint: 'Step needs photo / file / voice note(s)' },
  { key: 'approval', label: 'Approval gate', icon: ShieldCheck, hint: 'A named person must approve before completion' },
];

const StepEditor = ({ row, onChange, users, advanced = true }) => {
  const set = (k, v) => onChange({ ...row, [k]: v });
  const [reqMenu, setReqMenu] = useState(null); // anchor for "+ Add requirement"

  const addRequirement = (key) => {
    setReqMenu(null);
    if (key === 'verifications') set('verifications', [...(row.verifications || []), '']);
    if (key === 'formFields') set('formFields', [...(row.formFields || []), { label: '', fieldType: 'TEXT', required: true }]);
    if (key === 'proof') set('proof', { required: true, minCount: row.proof?.minCount || 1 });
    if (key === 'approval') set('approval', { required: true, approverIds: row.approval?.approverIds || [] });
  };

  const suggestedLink = !row.actionLink && TRIGGER_TO_ACTION[row.triggerKey];
  const reqCount = (row.verifications?.length || 0) + (row.formFields?.length || 0)
    + (row.proof?.required ? 1 : 0) + (row.approval?.required ? 1 : 0);

  return (
    <Accordion disableGutters TransitionProps={{ unmountOnExit: true }} sx={{ '&:before': { display: 'none' }, border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 1 }}>
      <AccordionSummary expandIcon={<ChevronDown size={16} />}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip size="small" variant="outlined" label={row.stepCode} />
          {/* Step NAME stays fixed (it comes from the Step Builder); the task title
              is shown separately so configuring a template never "renames" the step. */}
          <Typography sx={{ fontWeight: 700 }}>{row.stepName}</Typography>
          {row.taskTitle && <Typography variant="caption" color="text.secondary">· task: {row.taskTitle}</Typography>}
          {row.checklist.length > 0 && <Chip size="small" icon={<ListChecks size={12} />} label={row.checklist.length} />}
          {reqCount > 0 && <Chip size="small" color="secondary" variant="outlined" label={`+${reqCount} req`} />}
          {row.actionLink && <Chip size="small" icon={<Link2 size={12} />} label="linked" sx={{ bgcolor: alpha('#1d4ed8', 0.1), color: '#1d4ed8' }} />}
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          <TextField size="small" label="Task title" value={row.taskTitle} onChange={(e) => set('taskTitle', e.target.value)} fullWidth placeholder={row.stepName} />
          <TextField size="small" label="Instructions" value={row.instructions} onChange={(e) => set('instructions', e.target.value)} fullWidth multiline minRows={2} />
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="Lead time" type="number" value={row.leadTime.value} onChange={(e) => set('leadTime', { ...row.leadTime, value: e.target.value })} sx={{ width: 120 }} />
            <TextField select size="small" label="Unit" value={row.leadTime.unit} onChange={(e) => set('leadTime', { ...row.leadTime, unit: e.target.value })} sx={{ width: 130 }}>
              {UNITS.map((u) => <MenuItem key={u} value={u}>{u.toLowerCase()}</MenuItem>)}
            </TextField>
          </Stack>

          {/* ── Connect to the real system action (Do-it-now deep link) ── */}
          {advanced && (
            <Box>
              <TextField select size="small" fullWidth label="Connect to system action — shows a 'Do it now' link on the task"
                value={row.actionLink || ''} onChange={(e) => set('actionLink', e.target.value)}>
                <MenuItem value=""><em>None</em></MenuItem>
                {ACTION_LINKS.map((a) => <MenuItem key={a.key} value={a.key}>{a.label}</MenuItem>)}
              </TextField>
              {suggestedLink && (
                <Chip size="small" icon={<Link2 size={12} />} clickable onClick={() => set('actionLink', suggestedLink)}
                  label={`Suggestion: connect to "${actionLinkMeta(suggestedLink)?.label}" (matches this step's trigger)`}
                  sx={{ mt: 0.75, bgcolor: alpha('#1d4ed8', 0.08), color: '#1d4ed8' }} />
              )}
            </Box>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            {/* Autocomplete (not Select) — doesn't lock page scroll, shows picks as
                removable chips, and supports type-to-search. */}
            <Autocomplete
              multiple size="small" sx={{ flex: 1 }}
              options={users}
              getOptionLabel={(u) => u.name || u.email || ''}
              isOptionEqualToValue={(o, v) => o._id === v._id}
              value={users.filter((u) => row.assigneeUserIds.includes(u._id))}
              onChange={(_, v) => set('assigneeUserIds', v.map((u) => u._id))}
              disableCloseOnSelect
              ChipProps={{ size: 'small' }}
              renderInput={(p) => <TextField {...p} label="Assigned to (one or more)" placeholder="Type to search…" />}
            />
            <Autocomplete
              multiple size="small" sx={{ flex: 1 }}
              options={users}
              getOptionLabel={(u) => u.name || u.email || ''}
              isOptionEqualToValue={(o, v) => o._id === v._id}
              value={users.filter((u) => row.buddyUserIds.includes(u._id))}
              onChange={(_, v) => set('buddyUserIds', v.map((u) => u._id))}
              disableCloseOnSelect
              ChipProps={{ size: 'small' }}
              renderInput={(p) => <TextField {...p} label="Buddy / backup (one or more)" placeholder="Type to search…" />}
            />
          </Stack>
          {/* Checklist editor */}
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Checklist (tick / untick)</Typography>
            {row.checklist.map((text, i) => (
              <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                <TextField size="small" value={text} fullWidth
                  onChange={(e) => { const c = [...row.checklist]; c[i] = e.target.value; set('checklist', c); }} />
                <IconButton size="small" onClick={() => set('checklist', row.checklist.filter((_, j) => j !== i))}><X size={14} /></IconButton>
              </Stack>
            ))}
            <Button size="small" startIcon={<Plus size={14} />} onClick={() => set('checklist', [...row.checklist, ''])} sx={{ mt: 0.5 }}>Add item</Button>
          </Box>

          {advanced && (
            <>
              {/* ── Yes/No verification questions ── */}
              {(row.verifications || []).length > 0 && (
                <Box>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <HelpCircle size={14} color="#7c3aed" />
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>Yes/No verification — "No" demands a remark</Typography>
                  </Stack>
                  {row.verifications.map((q, i) => (
                    <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                      <TextField size="small" value={q} fullWidth placeholder="e.g. Stock physically verified?"
                        onChange={(e) => { const v = [...row.verifications]; v[i] = e.target.value; set('verifications', v); }} />
                      <IconButton size="small" onClick={() => set('verifications', row.verifications.filter((_, j) => j !== i))}><X size={14} /></IconButton>
                    </Stack>
                  ))}
                  <Button size="small" startIcon={<Plus size={14} />} onClick={() => set('verifications', [...row.verifications, ''])} sx={{ mt: 0.5 }}>Add question</Button>
                </Box>
              )}

              {/* ── Data-capture fields ── */}
              {(row.formFields || []).length > 0 && (
                <Box>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <FormInput size={14} color="#0369a1" />
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>Data to capture</Typography>
                  </Stack>
                  {row.formFields.map((f, i) => (
                    <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                      <TextField size="small" value={f.label} fullWidth placeholder="e.g. Vehicle No."
                        onChange={(e) => { const v = [...row.formFields]; v[i] = { ...f, label: e.target.value }; set('formFields', v); }} />
                      <TextField select size="small" value={f.fieldType} sx={{ width: 110 }}
                        onChange={(e) => { const v = [...row.formFields]; v[i] = { ...f, fieldType: e.target.value }; set('formFields', v); }}>
                        <MenuItem value="TEXT">Text</MenuItem><MenuItem value="NUMBER">Number</MenuItem><MenuItem value="DATE">Date</MenuItem>
                      </TextField>
                      <Tooltip title={f.required ? 'Required — blocks completion' : 'Optional'}>
                        <Switch size="small" checked={f.required}
                          onChange={(e) => { const v = [...row.formFields]; v[i] = { ...f, required: e.target.checked }; set('formFields', v); }} />
                      </Tooltip>
                      <IconButton size="small" onClick={() => set('formFields', row.formFields.filter((_, j) => j !== i))}><X size={14} /></IconButton>
                    </Stack>
                  ))}
                  <Button size="small" startIcon={<Plus size={14} />}
                    onClick={() => set('formFields', [...row.formFields, { label: '', fieldType: 'TEXT', required: true }])} sx={{ mt: 0.5 }}>Add field</Button>
                </Box>
              )}

              {/* ── Proof attachments gate ── */}
              {row.proof?.required && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Paperclip size={14} color="#b45309" />
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>Proof required — at least</Typography>
                  <TextField size="small" type="number" value={row.proof.minCount} sx={{ width: 80 }}
                    inputProps={{ min: 1 }}
                    onChange={(e) => set('proof', { ...row.proof, minCount: Math.max(1, Number(e.target.value) || 1) })} />
                  <Typography variant="caption">file(s) / photo(s) / voice note(s)</Typography>
                  <IconButton size="small" onClick={() => set('proof', { required: false, minCount: 1 })}><X size={14} /></IconButton>
                </Stack>
              )}

              {/* ── Approval gate ── */}
              {row.approval?.required && (
                <Box>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
                    <ShieldCheck size={14} color="#0f766e" />
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>Approval gate — step completes only after approval by:</Typography>
                    <IconButton size="small" onClick={() => set('approval', { required: false, approverIds: [] })}><X size={14} /></IconButton>
                  </Stack>
                  <Autocomplete
                    multiple size="small"
                    options={users}
                    getOptionLabel={(u) => u.name || u.email || ''}
                    isOptionEqualToValue={(o, v) => o._id === v._id}
                    value={users.filter((u) => (row.approval.approverIds || []).includes(u._id))}
                    onChange={(_, v) => set('approval', { ...row.approval, approverIds: v.map((u) => u._id) })}
                    disableCloseOnSelect
                    ChipProps={{ size: 'small' }}
                    renderInput={(p) => <TextField {...p} label="Approver(s)" placeholder="Type to search…" />}
                  />
                </Box>
              )}

              {/* ── Add requirement ── */}
              <Box>
                <Button size="small" variant="outlined" startIcon={<Plus size={14} />} onClick={(e) => setReqMenu(e.currentTarget)}>
                  Add requirement
                </Button>
                <Menu anchorEl={reqMenu} open={!!reqMenu} onClose={() => setReqMenu(null)}>
                  {REQ_TYPES.map((r) => {
                    const Icon = r.icon;
                    return (
                      <MenuItem key={r.key} onClick={() => addRequirement(r.key)} sx={{ alignItems: 'flex-start', py: 1 }}>
                        <Icon size={16} style={{ marginRight: 10, marginTop: 2, flexShrink: 0 }} />
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.label}</Typography>
                          <Typography variant="caption" color="text.secondary">{r.hint}</Typography>
                        </Box>
                      </MenuItem>
                    );
                  })}
                </Menu>
              </Box>
            </>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
};

// Pick an order, load its live process, and hand back editor rows for custom design.
const CustomOrderPicker = ({ open, onClose, defs, onReady }) => {
  const [order, setOrder] = useState(null);
  const { data: ordersRes } = useGetOrdersQuery({ limit: 300, sort: '-orderDate' }, { skip: !open });
  const orders = ordersRes?.data || [];
  const { data: procRes, isFetching } = useGetProcessByOrderQuery(order?._id, { skip: !order?._id });
  const proc = procRes?.data;

  const cont = () => {
    onReady({
      processId: proc._id,
      orderLabel: `${order.soNumber} · ${order.partyName}`,
      steps: mergeStepsFromProcess(defs, proc.steps || []),
    });
    setOrder(null);
  };

  return (
    <Dialog open={open} onClose={() => { setOrder(null); onClose(); }} maxWidth="sm" fullWidth>
      <DialogTitle>Custom plan — choose the order</DialogTitle>
      <DialogContent dividers>
        <Autocomplete
          options={orders}
          getOptionLabel={(o) => `${o.soNumber} — ${o.partyName} (PO ${o.poNumber || '—'})`}
          value={order}
          onChange={(_, v) => setOrder(v)}
          isOptionEqualToValue={(o, v) => o._id === v._id}
          renderInput={(p) => <TextField {...p} label="Search SO / PO / party…" autoFocus />}
        />
        {order && !proc && isFetching && <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>Loading this order's plan…</Typography>}
        {order && !proc && !isFetching && <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>No FMS process found for this order.</Typography>}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => { setOrder(null); onClose(); }}>Cancel</Button>
        <Button variant="contained" disabled={!proc} onClick={cont}>Design this order →</Button>
      </DialogActions>
    </Dialog>
  );
};

const TaskTemplates = () => {
  // Which FMS catalog the templates & step list belong to.
  const [fmsKey, setFmsKey] = useState(DEFAULT_FMS_KEY);
  const { data: tplRes, isLoading } = useGetTaskTemplatesQuery(fmsKey);
  const { data: defRes } = useGetStepDefinitionsQuery(fmsKey);
  const { data: usersRes } = useListAccessUsersQuery();
  const [createTpl] = useCreateTaskTemplateMutation();
  const [updateTpl] = useUpdateTaskTemplateMutation();
  const [setDefault] = useSetDefaultTemplateMutation();
  const [deleteTpl, { isLoading: deleting }] = useDeleteTaskTemplateMutation();
  const [planOrder] = usePlanOrderMutation();
  const [settingId, setSettingId] = useState(null); // template id being set default
  const [deleteTarget, setDeleteTarget] = useState(null); // template pending delete confirmation
  const [deleteError, setDeleteError] = useState('');

  const handleSetDefault = async (id) => {
    setSettingId(id);
    try { await setDefault(id).unwrap(); } finally { setSettingId(null); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError('');
    try {
      await deleteTpl(deleteTarget._id).unwrap();
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(e?.data?.message || 'Could not delete this template. Please try again.');
    }
  };

  const templates = tplRes?.data || [];
  const defaultTpl = templates.find((t) => t.isDefault);
  const defs = (defRes?.data || []).filter((d) => d.isActive);
  const users = usersRes?.data || [];

  const [editing, setEditing] = useState(null); // { mode, _id?, processId?, orderLabel?, name, ... }
  const [newMenu, setNewMenu] = useState(false); // the two-choice dialog
  const [orderPick, setOrderPick] = useState(false); // custom order selector
  const [error, setError] = useState('');

  const startTemplate = () => { setNewMenu(false); setEditing({ mode: 'template', name: '', description: '', isDefault: templates.length === 0, steps: mergeSteps(defs) }); };
  const startEdit = (tpl) => setEditing({ mode: 'template', _id: tpl._id, name: tpl.name, description: tpl.description || '', isDefault: tpl.isDefault, steps: mergeSteps(defs, tpl.steps) });
  const startCustom = () => { setNewMenu(false); setOrderPick(true); };

  const save = async () => {
    setError('');
    // Custom mode — write the plan onto this specific order's process.
    if (editing.mode === 'custom') {
      try {
        await planOrder({ id: editing.processId, steps: editing.steps.map((s) => ({
          stepCode: s.stepCode,
          taskTitle: s.taskTitle || undefined,
          instructions: s.instructions || undefined,
          assignees: s.assigneeUserIds || [],
          buddies: s.buddyUserIds || [],
          leadTime: s.leadTime.value ? { value: Number(s.leadTime.value), unit: s.leadTime.unit } : undefined,
          checklist: s.checklist.filter(Boolean).map((text) => ({ text })),
        })) }).unwrap();
        setEditing(null);
      } catch (e) { setError(e?.data?.message || 'Could not save the order plan.'); }
      return;
    }
    const payload = {
      name: editing.name, description: editing.description, isDefault: editing.isDefault,
      fmsKey, // template belongs to the FMS currently selected
      steps: editing.steps
        .filter((s) => s.taskTitle || s.checklist.length || s.assigneeUserIds?.length || s.leadTime.value
          || s.verifications?.some(Boolean) || s.formFields?.some((f) => f.label)
          || s.proof?.required || s.approval?.required || s.actionLink)
        .map((s) => ({
          stepCode: s.stepCode,
          taskTitle: s.taskTitle || undefined,
          instructions: s.instructions || undefined,
          checklist: s.checklist.filter(Boolean).map((text) => ({ text })),
          verifications: (s.verifications || []).filter(Boolean).map((question) => ({ question })),
          formFields: (s.formFields || []).filter((f) => f.label?.trim())
            .map((f) => ({ label: f.label.trim(), fieldType: f.fieldType, required: !!f.required })),
          proof: s.proof?.required ? { required: true, minCount: s.proof.minCount || 1 } : null,
          approval: s.approval?.required && s.approval.approverIds?.length
            ? { required: true, approverIds: s.approval.approverIds } : null,
          actionLink: s.actionLink || null,
          leadTime: s.leadTime.value ? { value: Number(s.leadTime.value), unit: s.leadTime.unit } : undefined,
          assigneeUserIds: s.assigneeUserIds || [],
          buddyUserIds: s.buddyUserIds || [],
        })),
    };
    try {
      if (editing._id) await updateTpl({ id: editing._id, ...payload }).unwrap();
      else await createTpl(payload).unwrap();
      setEditing(null);
    } catch (e) { setError(e?.data?.message || 'Could not save template.'); }
  };

  if (editing) {
    const custom = editing.mode === 'custom';
    return (
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            {custom ? 'Custom plan for an order' : (editing._id ? 'Edit template' : 'New template')}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="contained" startIcon={<Save size={16} />} onClick={save} disabled={!custom && !editing.name}>
              {custom ? 'Save order plan' : 'Save template'}
            </Button>
          </Stack>
        </Stack>
        {custom ? (
          <Paper sx={{ p: 2, borderRadius: 3, mb: 2, borderLeft: '4px solid #0f766e', bgcolor: alpha('#0f766e', 0.04) }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Target size={18} color="#0f766e" />
              <Typography sx={{ fontWeight: 700 }}>{editing.orderLabel}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              This plan applies only to this order — doers, buddies, lead times & checklists below override the template for it.
            </Typography>
          </Paper>
        ) : (
          <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={2}>
                <TextField label="Template name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} size="small" fullWidth />
                <FormControlLabel control={<Switch checked={editing.isDefault} onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })} />} label="Default (auto-applied)" />
              </Stack>
              <TextField label="Description" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} size="small" fullWidth />
            </Stack>
          </Paper>
        )}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Per-step tasks ({editing.steps.length} steps)</Typography>
        {editing.steps.map((row, i) => (
          <StepEditor key={row.stepCode} row={row} users={users} advanced={!custom}
            onChange={(updated) => setEditing({ ...editing, steps: editing.steps.map((s, j) => (j === i ? updated : s)) })} />
        ))}
        {error && <Typography color="error" sx={{ mt: 1 }}>{error}</Typography>}
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <ClipboardList size={20} />
            <Typography variant="h5" sx={{ fontWeight: 800 }}>Task & Checklist Templates</Typography>
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Define the tasks, checklists, lead times, doers & buddies for each step. The default template auto-applies to every new order.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setNewMenu(true)}>New</Button>
      </Stack>

      {/* FMS catalog picker — choose which flow these templates build on. */}
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
                <LayoutTemplate size={18} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 800, color: active ? '#1d4ed8' : 'text.primary' }}>{fms.label}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap>{fms.desc}</Typography>
              </Box>
            </Paper>
          );
        })}
      </Stack>

      {/* Active-default banner — at a glance, which template runs every new order. */}
      {!isLoading && (
        <Paper sx={{ p: 1.75, borderRadius: 3, mb: 2, display: 'flex', alignItems: 'center', gap: 1.5,
          border: '1px solid', borderColor: defaultTpl ? alpha('#0f766e', 0.4) : alpha('#b45309', 0.4),
          bgcolor: alpha(defaultTpl ? '#0f766e' : '#b45309', 0.05) }}>
          <Star size={18} color={defaultTpl ? '#0f766e' : '#b45309'} />
          {defaultTpl ? (
            <Typography variant="body2">
              Currently applied to every new order: <b>{defaultTpl.name}</b>
            </Typography>
          ) : (
            <Typography variant="body2">
              No default template set — new orders use the basic step catalog. Click <b>“Use as default”</b> on a template below.
            </Typography>
          )}
        </Paper>
      )}

      {isLoading ? <Skeleton variant="rounded" height={200} /> : (
        <Stack spacing={1.5}>
          {templates.length === 0 && (
            <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 3, color: 'text.secondary' }}>
              No templates yet. Create one to push tasks & checklists to your team automatically.
            </Paper>
          )}
          {templates.map((tpl) => (
            <Paper key={tpl._id} sx={{ p: 2, borderRadius: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2,
              borderLeft: '4px solid', borderLeftColor: tpl.isDefault ? '#0f766e' : 'divider',
              bgcolor: tpl.isDefault ? alpha('#0f766e', 0.03) : 'background.paper' }}>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography sx={{ fontWeight: 700 }}>{tpl.name}</Typography>
                  {tpl.isDefault && <Chip size="small" icon={<Star size={12} />} label="Default · in use" sx={{ bgcolor: alpha('#0f766e', 0.12), color: '#0f766e', fontWeight: 700 }} />}
                  <Chip size="small" variant="outlined" label={`${tpl.steps?.length || 0} steps`} />
                </Stack>
                {tpl.description && <Typography variant="body2" color="text.secondary" noWrap>{tpl.description}</Typography>}
              </Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                {tpl.isDefault ? (
                  <Chip size="small" variant="outlined" color="success" label="Active" />
                ) : (
                  <Button size="small" variant="outlined" disabled={settingId === tpl._id}
                    startIcon={settingId === tpl._id ? <CircularProgress size={14} /> : <Star size={14} />}
                    onClick={() => handleSetDefault(tpl._id)}>
                    {settingId === tpl._id ? 'Setting…' : 'Use as default'}
                  </Button>
                )}
                <Tooltip title="Edit"><IconButton size="small" onClick={() => startEdit(tpl)}><Pencil size={16} /></IconButton></Tooltip>
                <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => { setDeleteError(''); setDeleteTarget(tpl); }}><Trash2 size={16} /></IconButton></Tooltip>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {/* Two-path chooser when clicking "New" */}
      <Dialog open={newMenu} onClose={() => setNewMenu(false)} maxWidth="sm" fullWidth>
        <DialogTitle>What do you want to create?</DialogTitle>
        <DialogContent dividers>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Paper onClick={startTemplate}
              sx={{ flex: 1, p: 2.5, borderRadius: 3, cursor: 'pointer', border: '1px solid', borderColor: 'divider',
                '&:hover': { borderColor: '#1d4ed8', boxShadow: 3 } }}>
              <LayoutTemplate size={26} color="#1d4ed8" />
              <Typography sx={{ fontWeight: 700, mt: 1 }}>Reusable template</Typography>
              <Typography variant="body2" color="text.secondary">
                Design tasks & checklists once. Set it default and it auto-applies to every new order.
              </Typography>
            </Paper>
            <Paper onClick={startCustom}
              sx={{ flex: 1, p: 2.5, borderRadius: 3, cursor: 'pointer', border: '1px solid', borderColor: 'divider',
                '&:hover': { borderColor: '#0f766e', boxShadow: 3 } }}>
              <Target size={26} color="#0f766e" />
              <Typography sx={{ fontWeight: 700, mt: 1 }}>Custom plan for one order</Typography>
              <Typography variant="body2" color="text.secondary">
                Pick a specific order (SO/PO) and tailor who does each step, with its own checklists & deadlines.
              </Typography>
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setNewMenu(false)}>Cancel</Button></DialogActions>
      </Dialog>

      <CustomOrderPicker
        open={orderPick}
        onClose={() => setOrderPick(false)}
        defs={defs}
        onReady={({ processId, orderLabel, steps }) => { setOrderPick(false); setEditing({ mode: 'custom', processId, orderLabel, steps }); }}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this template?</DialogTitle>
        <DialogContent dividers>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Box sx={{ p: 1, borderRadius: 2, bgcolor: alpha('#be123c', 0.1), color: '#be123c', display: 'flex' }}><Trash2 size={20} /></Box>
            <Box>
              <Typography variant="body2">
                You're about to delete <b>{deleteTarget?.name}</b>. This can't be undone.
              </Typography>
              {deleteTarget?.isDefault && (
                <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
                  This is the default template — new orders will fall back to the basic step catalog until you set another default.
                </Typography>
              )}
              {deleteError && <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>{deleteError}</Typography>}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmDelete} disabled={deleting}
            startIcon={deleting ? <CircularProgress size={14} color="inherit" /> : <Trash2 size={16} />}>
            {deleting ? 'Deleting…' : 'Yes, delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TaskTemplates;
