import React, { useState, useRef, useEffect } from 'react';
import {
  Box, Paper, Stack, Typography, Button, IconButton, Chip, TextField, MenuItem, Autocomplete,
  Table, TableBody, TableCell, TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions,
  Skeleton, Tooltip, alpha, Divider, ToggleButtonGroup, ToggleButton, CircularProgress,
} from '@mui/material';
import {
  Plus, Phone, Mail, MessageCircle, Users, FileText, Trash2, ArrowRightCircle, X, PhoneCall, Ban,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  useGetOrderIntakesQuery, useCreateOrderIntakeMutation, useCancelOrderIntakeMutation,
  useDeleteOrderIntakeMutation,
} from '../../store/api/orderIntakeApi';
import { usePermissions } from '../../hooks/usePermission';
import { useGetPartiesQuery } from '../../store/api/partyApi';
import { useUploadFileMutation } from '../../store/api/o2dFmsApi';
import AttachmentList from '../../components/AttachmentList';
import VoiceRecorder from '../../components/VoiceRecorder';
import OrderEntryDrawer from '../orders/OrderEntryDrawer';
import { useOpenFmsTask } from '../o2d-fms/useOpenFmsTask';

const CHANNELS = [
  { value: 'PHONE', label: 'Phone call', icon: Phone },
  { value: 'EMAIL', label: 'Email', icon: Mail },
  { value: 'WHATSAPP', label: 'WhatsApp', icon: MessageCircle },
  { value: 'MEETING', label: 'Meeting', icon: Users },
  { value: 'OTHER', label: 'Other', icon: FileText },
];
const channelMeta = (v) => CHANNELS.find((c) => c.value === v) || CHANNELS[4];
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const STATUS_TONE = { NEW: '#1d4ed8', CONVERTED: '#0f766e', CANCELLED: '#94a3b8' };

const blankForm = { partyId: null, channel: 'PHONE', contactName: '', items: [], notes: '', attachments: [] };

const OrderIntakeList = () => {
  const navigate = useNavigate();
  const { isRoot } = usePermissions();
  const { data, isLoading } = useGetOrderIntakesQuery({ limit: 100, sort: '-createdAt' });
  const { data: partiesRes } = useGetPartiesQuery({ limit: 300 });
  const [createIntake, { isLoading: creating }] = useCreateOrderIntakeMutation();
  const openFmsTask = useOpenFmsTask();
  const [cancelIntake] = useCancelOrderIntakeMutation();
  const [deleteIntake, { isLoading: deleting }] = useDeleteOrderIntakeMutation();
  const [uploadFile] = useUploadFileMutation();

  const allIntakes = data?.data || [];
  const parties = partiesRes?.data || [];

  const [form, setForm] = useState(null);     // null = closed; object = logging
  const [convert, setConvert] = useState(null); // intake being converted
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [deleteTarget, setDeleteTarget] = useState(null); // intake pending MD delete
  const [deleteError, setDeleteError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const counts = {
    ALL: allIntakes.length,
    NEW: allIntakes.filter((i) => i.intakeStatus === 'NEW').length,
    CONVERTED: allIntakes.filter((i) => i.intakeStatus === 'CONVERTED').length,
    CANCELLED: allIntakes.filter((i) => i.intakeStatus === 'CANCELLED').length,
  };
  const intakes = statusFilter === 'ALL' ? allIntakes : allIntakes.filter((i) => i.intakeStatus === statusFilter);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError('');
    try {
      await deleteIntake(deleteTarget._id).unwrap();
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(e?.data?.message || 'Could not delete this intake.');
    }
  };

  // ── Log form helpers ──
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { skuName: '', qty: 1 }] }));
  const setItem = (i, k, v) => setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }));
  const delItem = (i) => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }));

  const uploadAndAttach = async (files) => {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    setUploading(true);
    try {
      const out = [];
      for (const fl of arr) {
        const res = await uploadFile({ file: fl, folder: 'order-intake' }).unwrap();
        const d = res.data || res;
        out.push({ fileName: d.fileName || fl.name, fileUrl: d.url, fileKey: d.key, fileType: d.mimeType || fl.type, sizeBytes: d.sizeBytes || fl.size });
      }
      setForm((f) => ({ ...f, attachments: [...f.attachments, ...out] }));
    } catch (e) { setError(e?.data?.message || 'Upload failed.'); }
    finally { setUploading(false); }
  };

  const saveIntake = async () => {
    setError('');
    if (!form.partyId) { setError('Please choose the client.'); return; }
    try {
      const res = await createIntake({
        partyId: form.partyId._id,
        partyName: form.partyId.name,
        channel: form.channel,
        contactName: form.contactName || undefined,
        items: form.items.filter((it) => it.skuName).map((it) => ({ skuName: it.skuName, qty: Number(it.qty) || 0 })),
        notes: form.notes || undefined,
        attachments: form.attachments,
      }).unwrap();
      setForm(null);
      // Open the FMS "Order Received" task for this intake (checklist auto-marked).
      if (res?.data?._id) await openFmsTask({ intakeId: res.data._id });
    } catch (e) { setError(e?.data?.message || 'Could not log the order.'); }
  };

  // ── Convert → open the real Sales Order punch-in form, pre-filled from the intake ──
  const openConvert = (intake) => setConvert(intake);

  // Deep-link from an FMS task ("Do it now" on Sales Order Entry): ?convert=<intakeId>
  // auto-opens that intake's conversion form so the doer fills the SO directly.
  useEffect(() => {
    const id = searchParams.get('convert');
    if (!id || convert || !allIntakes.length) return;
    const it = allIntakes.find((x) => String(x._id) === String(id));
    if (it) {
      setConvert(it);
      const next = new URLSearchParams(searchParams);
      next.delete('convert');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, allIntakes]);

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <PhoneCall size={20} />
            <Typography variant="h5" sx={{ fontWeight: 800 }}>Order Intake</Typography>
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Log an order the moment a client calls / emails / messages — it starts the FMS instantly.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => { setForm({ ...blankForm }); setError(''); }}>Log order</Button>
      </Stack>

      {/* ── Status filter ── */}
      {!isLoading && allIntakes.length > 0 && (
        <Paper sx={{ p: 1.25, borderRadius: 3, mb: 2 }}>
          <ToggleButtonGroup size="small" value={statusFilter} exclusive onChange={(_, v) => v && setStatusFilter(v)} sx={{ flexWrap: 'wrap' }}>
            <ToggleButton value="ALL">All ({counts.ALL})</ToggleButton>
            <ToggleButton value="NEW" sx={{ color: '#1d4ed8' }}>New ({counts.NEW})</ToggleButton>
            <ToggleButton value="CONVERTED" sx={{ color: '#0f766e' }}>Converted ({counts.CONVERTED})</ToggleButton>
            <ToggleButton value="CANCELLED" sx={{ color: '#94a3b8' }}>Cancelled ({counts.CANCELLED})</ToggleButton>
          </ToggleButtonGroup>
        </Paper>
      )}

      {/* overflowX lets the table scroll sideways on small screens instead of clipping the action buttons */}
      <Paper sx={{ borderRadius: 3, overflowX: 'auto' }}>
        {isLoading ? <Skeleton variant="rounded" height={300} /> : (
          <Table size="small" sx={{ minWidth: 880 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: alpha('#1d4ed8', 0.06) }}>
                <TableCell sx={{ width: 100 }}>Intake</TableCell><TableCell>Client</TableCell><TableCell sx={{ width: 130 }}>Channel</TableCell>
                <TableCell sx={{ width: 64 }}>Items</TableCell><TableCell sx={{ width: 150 }}>Logged</TableCell><TableCell sx={{ width: 110 }}>Status</TableCell>
                <TableCell align="right" sx={{ width: 200 }}>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {intakes.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {statusFilter === 'ALL' ? 'No order intakes yet. Click “Log order”.' : 'No intakes match this filter.'}
                </TableCell></TableRow>
              ) : intakes.map((it) => {
                const cm = channelMeta(it.channel); const CIcon = cm.icon;
                return (
                  <TableRow key={it._id} hover>
                    <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{it.intakeNo}</Typography></TableCell>
                    <TableCell sx={{ maxWidth: 240 }}><Typography variant="body2" noWrap title={it.partyName || it.partyId?.name}>{it.partyName || it.partyId?.name}</Typography></TableCell>
                    <TableCell><Chip size="small" icon={<CIcon size={13} />} label={cm.label} variant="outlined" /></TableCell>
                    <TableCell>{it.items?.length || 0}</TableCell>
                    <TableCell><Typography variant="caption" noWrap>{fmt(it.createdAt)}</Typography></TableCell>
                    <TableCell><Chip size="small" label={it.intakeStatus} sx={{ bgcolor: alpha(STATUS_TONE[it.intakeStatus] || '#64748b', 0.12), color: STATUS_TONE[it.intakeStatus] || '#64748b', fontWeight: 700 }} /></TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                        {it.intakeStatus === 'NEW' && (
                          <>
                            <Button size="small" variant="contained" startIcon={<ArrowRightCircle size={14} />}
                              onClick={() => openConvert(it)}
                              sx={{ whiteSpace: 'nowrap', minWidth: 0, px: 1.25, py: 0.4, fontSize: '0.72rem', borderRadius: 1.5, boxShadow: 'none' }}>
                              Convert to SO
                            </Button>
                            <Tooltip title="Cancel this intake"><IconButton size="small" onClick={() => cancelIntake(it._id)}><Ban size={15} /></IconButton></Tooltip>
                          </>
                        )}
                        {it.intakeStatus === 'CONVERTED' && it.linkedSalesOrderId && (
                          <Button size="small" variant="outlined"
                            onClick={() => navigate(`/orders/${it.linkedSalesOrderId._id || it.linkedSalesOrderId}`)}
                            sx={{ whiteSpace: 'nowrap', minWidth: 0, px: 1.25, py: 0.4, fontSize: '0.72rem', borderRadius: 1.5 }}>
                            View SO
                          </Button>
                        )}
                        {it.intakeStatus === 'CANCELLED' && !isRoot && (
                          <Typography variant="caption" color="text.disabled">—</Typography>
                        )}
                        {isRoot && (
                          <Tooltip title="Delete (MD only)">
                            <IconButton size="small" color="error" onClick={() => { setDeleteError(''); setDeleteTarget(it); }}>
                              <Trash2 size={15} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Paper>

      {/* ── Log order dialog ── */}
      <Dialog open={!!form} onClose={() => setForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pr: 6 }}>
          Log an order
          <Typography variant="caption" color="text.secondary" display="block">Just the essentials — it starts the FMS right away. You can convert to a full Sales Order later.</Typography>
          <IconButton onClick={() => setForm(null)} sx={{ position: 'absolute', right: 8, top: 8 }}><X size={18} /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {form && (
            <Stack spacing={2}>
              <Autocomplete
                options={parties}
                getOptionLabel={(o) => o.name || ''}
                value={form.partyId}
                onChange={(_, v) => setForm((f) => ({ ...f, partyId: v }))}
                isOptionEqualToValue={(o, v) => o._id === v._id}
                renderInput={(p) => <TextField {...p} label="Client *" size="small" />}
              />
              <Stack direction="row" spacing={2}>
                <TextField select size="small" label="How did it arrive? *" value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))} fullWidth>
                  {CHANNELS.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
                </TextField>
                <TextField size="small" label="Contact / caller name" value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} fullWidth />
              </Stack>

              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Items (optional)</Typography>
                  <Button size="small" startIcon={<Plus size={14} />} onClick={addItem}>Add item</Button>
                </Stack>
                {form.items.map((it, i) => (
                  <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                    <TextField size="small" placeholder="Item / SKU" value={it.skuName} onChange={(e) => setItem(i, 'skuName', e.target.value)} sx={{ flex: 1 }} />
                    <TextField size="small" type="number" placeholder="Qty" value={it.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} sx={{ width: 90 }} />
                    <IconButton size="small" onClick={() => delItem(i)}><X size={14} /></IconButton>
                  </Stack>
                ))}
              </Box>

              <TextField size="small" label="Notes — what the client said" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} fullWidth multiline minRows={2} />

              <Divider />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Attachments & voice note (optional)</Typography>
              <AttachmentList attachments={form.attachments} onRemove={(att) => setForm((f) => ({ ...f, attachments: f.attachments.filter((a) => a !== att) }))} dense />
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <input ref={fileRef} id="intake-attach-input" name="intakeAttachments" type="file" multiple hidden onChange={(e) => { uploadAndAttach(e.target.files); e.target.value = ''; }} />
                <Button size="small" variant="outlined" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? 'Uploading…' : 'Attach files'}</Button>
                <VoiceRecorder onRecorded={(file) => uploadAndAttach([file])} disabled={uploading} />
              </Stack>

              {error && <Typography color="error" variant="body2">{error}</Typography>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForm(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveIntake} disabled={creating || uploading}>Log order & start FMS</Button>
        </DialogActions>
      </Dialog>

      {/* ── Convert → full Sales Order punch-in form, pre-filled from the intake ── */}
      <OrderEntryDrawer open={!!convert} intake={convert} onClose={() => setConvert(null)} />

      {/* ── MD-only delete confirmation ── */}
      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this intake?</DialogTitle>
        <DialogContent dividers>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Box sx={{ p: 1, borderRadius: 2, bgcolor: alpha('#be123c', 0.1), color: '#be123c', display: 'flex' }}><Trash2 size={20} /></Box>
            <Box>
              <Typography variant="body2">
                You're about to delete <b>{deleteTarget?.intakeNo}</b> ({deleteTarget?.partyName || deleteTarget?.partyId?.name}). This can't be undone.
              </Typography>
              {deleteTarget?.intakeStatus === 'CONVERTED' ? (
                <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
                  This intake is already converted — the linked Sales Order and its FMS process will NOT be touched; only the intake record is removed.
                </Typography>
              ) : (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Its FMS process (and any tasks from it) will be removed too.
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

export default OrderIntakeList;
