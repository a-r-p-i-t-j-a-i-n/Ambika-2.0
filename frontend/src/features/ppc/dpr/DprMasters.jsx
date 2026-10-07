import React, { useMemo, useState } from 'react';
import {
  Box, Grid, Stack, Typography, Paper, Tabs, Tab, TextField, MenuItem, Button, IconButton, Chip,
  Table, TableHead, TableBody, TableRow, TableCell, TablePagination, Skeleton, InputAdornment,
  Dialog, DialogTitle, DialogContent, DialogActions, Snackbar, Alert, Checkbox, FormControlLabel, LinearProgress, Tooltip,
} from '@mui/material';
import { Database, Search, Plus, Pencil, Trash2, Cpu, Users, Route, Wrench } from 'lucide-react';
import {
  DprHero, StatTile, PPC_ACCENT, MACHINE_TYPES, num,
} from './dprMeta';
import {
  useGetMasterStatsQuery, useGetMasterListQuery,
  useCreateMasterMutation, useUpdateMasterMutation, useDeleteMasterMutation,
} from '../../../store/api/dprApi';

// Config-driven: each master kind declares its columns + which are editable.
// type: text | number | bool | select | csv (comma-separated array).
const KINDS = [
  // Machines and Operators used to live here as two more tabs. They are Master
  // Data now — Master Data → Machines / Machine Operators — which is the only
  // place they are edited, so a machine cannot drift between two screens and the
  // machine↔operator link is written to the assignment collection rather than
  // typed into a comma-separated box. The /dpr/masters/:kind API still serves
  // both kinds for backward compatibility.
  {
    kind: 'processRoute', label: 'Process Routes', icon: Route,
    columns: [
      { field: 'skuCode', label: 'SKU', required: true },
      { field: 'skuName', label: 'SKU Name' },
      { field: 'operationNo', label: 'Op No', type: 'number', required: true },
      { field: 'operationName', label: 'Operation', required: true },
      { field: 'machineType', label: 'Machine', type: 'select', options: MACHINE_TYPES },
      { field: 'spm', label: 'SPM', type: 'number' },
      { field: 'cavity', label: 'Cavity', type: 'number' },
      { field: 'toolLifeShots', label: 'Tool Life', type: 'number', hideInTable: true },
      { field: 'isLastOperation', label: 'Last Op', type: 'bool' },
    ],
  },
  {
    kind: 'die', label: 'Dies', icon: Wrench,
    columns: [
      { field: 'completeDieNo', label: 'Complete Die No', required: true },
      { field: 'skuCode', label: 'SKU' },
      { field: 'rackNo', label: 'Rack' },
      { field: 'opCode', label: 'Op Code' },
      { field: 'operationDesc', label: 'Operation' },
      { field: 'toolLifeShots', label: 'Tool Life', type: 'number' },
    ],
  },
];

const DprMasters = () => {
  const [tab, setTab] = useState(0);
  const cfg = KINDS[tab];
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [editRow, setEditRow] = useState(null); // {} = new
  const [toDelete, setToDelete] = useState(null);
  const [snack, setSnack] = useState(null);

  const { data: statsRes } = useGetMasterStatsQuery();
  const stats = statsRes?.data || {};

  const params = useMemo(() => ({ kind: cfg.kind, page: page + 1, limit: rowsPerPage, ...(search ? { search } : {}) }), [cfg.kind, page, rowsPerPage, search]);
  const { data, isFetching } = useGetMasterListQuery(params);
  const docs = data?.data || [];
  const pagination = data?.meta?.pagination || { total: 0 };

  const [createMaster, { isLoading: creating }] = useCreateMasterMutation();
  const [updateMaster, { isLoading: updating }] = useUpdateMasterMutation();
  const [deleteMaster] = useDeleteMasterMutation();

  const switchTab = (_e, v) => { setTab(v); setPage(0); setSearch(''); };

  const renderCell = (row, col) => {
    const v = row[col.field];
    if (col.type === 'bool') return v ? <Chip size="small" label="Yes" color="success" sx={{ height: 20 }} /> : <Typography sx={{ color: 'text.disabled' }}>—</Typography>;
    if (col.type === 'csv') return (v || []).length ? (v || []).slice(0, 6).join(', ') + ((v || []).length > 6 ? '…' : '') : '—';
    if (col.type === 'number') return v ? num(v) : '—';
    return v || '—';
  };

  const save = async (form) => {
    try {
      const body = { kind: cfg.kind, ...form };
      if (editRow?._id) await updateMaster({ ...body, id: editRow._id }).unwrap();
      else await createMaster(body).unwrap();
      setSnack({ sev: 'success', msg: editRow?._id ? 'Updated.' : 'Created.' });
      setEditRow(null);
    } catch (e) {
      setSnack({ sev: 'error', msg: e?.data?.message || 'Save failed.' });
    }
  };
  const doDelete = async () => {
    try {
      await deleteMaster({ kind: cfg.kind, id: toDelete._id }).unwrap();
      setSnack({ sev: 'success', msg: 'Deleted.' });
    } catch (e) { setSnack({ sev: 'error', msg: e?.data?.message || 'Delete failed.' }); }
    finally { setToDelete(null); }
  };

  const tableCols = cfg.columns.filter((c) => !c.hideInTable);

  return (
    <Box sx={{ pb: 6 }}>
      <DprHero icon={Database} title="PPC Masters" subtitle="Machines · Operators · Process Routes · Dies — the DPR backbone" />

      <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          <Grid item xs={6} md={3}><StatTile label="Machines" value={num(stats.machines)} color={PPC_ACCENT} icon={Cpu} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Operators" value={num(stats.operators)} color="#0ea5e9" icon={Users} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Process Routes" value={num(stats.processRoutes)} color="#16a34a" icon={Route} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Dies" value={num(stats.dies)} color="#d97706" icon={Wrench} /></Grid>
        </Grid>

        <Paper elevation={0} sx={{ borderRadius: '14px', border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ px: 1.5, pt: 1, gap: 1 }}>
            <Tabs value={tab} onChange={switchTab} variant="scrollable" scrollButtons="auto" sx={{ minHeight: 44 }}>
              {KINDS.map((k) => <Tab key={k.kind} icon={<k.icon size={16} />} iconPosition="start" label={k.label} sx={{ minHeight: 44, fontWeight: 700, textTransform: 'none' }} />)}
            </Tabs>
            <Stack direction="row" spacing={1} sx={{ pb: { xs: 1, sm: 0 } }}>
              <TextField size="small" placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} sx={{ width: { xs: '100%', sm: 220 } }} />
              <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditRow({})} sx={{ bgcolor: PPC_ACCENT, fontWeight: 700, whiteSpace: 'nowrap', '&:hover': { bgcolor: '#5b21b6' } }}>Add</Button>
            </Stack>
          </Stack>

          {isFetching && <LinearProgress />}
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {tableCols.map((c) => <TableCell key={c.field} sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase', color: 'text.secondary', whiteSpace: 'nowrap' }}>{c.label}</TableCell>)}
                  <TableCell align="right" sx={{ fontWeight: 800, fontSize: '0.7rem', color: 'text.secondary' }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {isFetching && !docs.length
                  ? Array.from({ length: 8 }).map((_, i) => <TableRow key={i}><TableCell colSpan={tableCols.length + 1}><Skeleton height={24} /></TableCell></TableRow>)
                  : docs.map((row) => (
                    <TableRow key={row._id} hover>
                      {tableCols.map((c, i) => (
                        <TableCell key={c.field} sx={{ fontSize: '0.8rem', fontWeight: i === 0 ? 700 : 400, whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{renderCell(row, c)}</TableCell>
                      ))}
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditRow(row)}><Pencil size={14} /></IconButton></Tooltip>
                        <Tooltip title="Delete"><IconButton size="small" onClick={() => setToDelete(row)}><Trash2 size={14} /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                {!isFetching && !docs.length && <TableRow><TableCell colSpan={tableCols.length + 1}><Typography sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No records.</Typography></TableCell></TableRow>}
              </TableBody>
            </Table>
          </Box>
          <TablePagination component="div" count={pagination.total || 0} page={page} onPageChange={(_e, p) => setPage(p)}
            rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[25, 50, 100, 250]} />
        </Paper>
      </Box>

      {editRow && (
        <MasterEditDialog cfg={cfg} row={editRow} onClose={() => setEditRow(null)} onSave={save} saving={creating || updating} />
      )}

      <Dialog open={!!toDelete} onClose={() => setToDelete(null)}>
        <DialogTitle>Delete record?</DialogTitle>
        <DialogContent><Typography sx={{ fontSize: '0.9rem' }}>{toDelete && (toDelete[cfg.columns[0].field] || 'This record')}</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setToDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={doDelete}>Delete</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.sev} variant="filled" onClose={() => setSnack(null)}>{snack.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
};

const MasterEditDialog = ({ cfg, row, onClose, onSave, saving }) => {
  const init = {};
  cfg.columns.forEach((c) => {
    if (c.type === 'csv') init[c.field] = Array.isArray(row[c.field]) ? row[c.field].join(', ') : (row[c.field] || '');
    else if (c.type === 'bool') init[c.field] = !!row[c.field];
    else init[c.field] = row[c.field] ?? '';
  });
  const [form, setForm] = useState(init);
  const setV = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const submit = () => {
    const out = {};
    cfg.columns.forEach((c) => {
      const v = form[c.field];
      if (c.type === 'csv') out[c.field] = String(v || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      else if (c.type === 'number') out[c.field] = v === '' ? 0 : Number(v);
      else if (c.type === 'bool') out[c.field] = !!v;
      else out[c.field] = v;
    });
    onSave(out);
  };
  const missing = cfg.columns.some((c) => c.required && (form[c.field] === '' || form[c.field] == null));

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{row._id ? `Edit ${cfg.label.slice(0, -1)}` : `New ${cfg.label.slice(0, -1)}`}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={1.5} sx={{ mt: 0 }}>
          {cfg.columns.map((c) => (
            <Grid item xs={12} sm={6} key={c.field}>
              {c.type === 'bool' ? (
                <FormControlLabel control={<Checkbox checked={!!form[c.field]} onChange={(e) => setV(c.field, e.target.checked)} />} label={c.label} />
              ) : c.type === 'select' ? (
                <TextField size="small" fullWidth select label={c.label} value={form[c.field] || ''} onChange={(e) => setV(c.field, e.target.value)}>
                  {(c.options || []).map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                </TextField>
              ) : (
                <TextField size="small" fullWidth label={c.label + (c.required ? ' *' : '')} type={c.type === 'number' ? 'number' : 'text'}
                  value={form[c.field]} onChange={(e) => setV(c.field, e.target.value)}
                  helperText={c.type === 'csv' ? 'comma-separated' : undefined} />
              )}
            </Grid>
          ))}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving || missing} sx={{ bgcolor: PPC_ACCENT, '&:hover': { bgcolor: '#5b21b6' } }}>Save</Button>
      </DialogActions>
    </Dialog>
  );
};

export default DprMasters;
