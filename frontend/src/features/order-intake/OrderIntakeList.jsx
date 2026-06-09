import React, { useState, useRef } from 'react';
import {
  Box, Paper, Stack, Typography, Button, IconButton, Chip, TextField, MenuItem, Autocomplete,
  Table, TableBody, TableCell, TableHead, TableRow, Dialog, DialogTitle, DialogContent, DialogActions,
  Skeleton, Tooltip, alpha, Divider,
} from '@mui/material';
import {
  Plus, Phone, Mail, MessageCircle, Users, FileText, Trash2, ArrowRightCircle, X, PhoneCall,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useGetOrderIntakesQuery, useCreateOrderIntakeMutation, useConvertOrderIntakeMutation, useCancelOrderIntakeMutation,
} from '../../store/api/orderIntakeApi';
import { useGetPartiesQuery } from '../../store/api/partyApi';
import { useUploadFileMutation } from '../../store/api/o2dFmsApi';
import AttachmentList from '../../components/AttachmentList';
import VoiceRecorder from '../../components/VoiceRecorder';

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
  const { data, isLoading } = useGetOrderIntakesQuery({ limit: 100, sort: '-createdAt' });
  const { data: partiesRes } = useGetPartiesQuery({ limit: 300 });
  const [createIntake, { isLoading: creating }] = useCreateOrderIntakeMutation();
  const [convertIntake, { isLoading: converting }] = useConvertOrderIntakeMutation();
  const [cancelIntake] = useCancelOrderIntakeMutation();
  const [uploadFile] = useUploadFileMutation();

  const intakes = data?.data || [];
  const parties = partiesRes?.data || [];

  const [form, setForm] = useState(null);     // null = closed; object = logging
  const [convert, setConvert] = useState(null); // intake being converted
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

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
      await createIntake({
        partyId: form.partyId._id,
        partyName: form.partyId.name,
        channel: form.channel,
        contactName: form.contactName || undefined,
        items: form.items.filter((it) => it.skuName).map((it) => ({ skuName: it.skuName, qty: Number(it.qty) || 0 })),
        notes: form.notes || undefined,
        attachments: form.attachments,
      }).unwrap();
      setForm(null);
    } catch (e) { setError(e?.data?.message || 'Could not log the order.'); }
  };

  // ── Convert ──
  const openConvert = (intake) => setConvert({
    ...intake,
    items: (intake.items?.length ? intake.items : [{ skuName: '', qty: 1 }]).map((it) => ({ skuName: it.skuName, skuCode: it.skuCode, qty: it.qty || 1 })),
    poNumber: '',
  });
  const setConvItem = (i, k, v) => setConvert((c) => ({ ...c, items: c.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }));

  const doConvert = async () => {
    setError('');
    const items = convert.items.filter((it) => it.skuName && Number(it.qty) > 0);
    if (!items.length) { setError('Add at least one item with quantity.'); return; }
    try {
      const res = await convertIntake({ id: convert._id, poNumber: convert.poNumber || undefined, items }).unwrap();
      const orderId = res.data?.order?._id;
      setConvert(null);
      if (orderId) navigate(`/orders/${orderId}`);
    } catch (e) { setError(e?.data?.message || 'Could not convert.'); }
  };

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

      <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
        {isLoading ? <Skeleton variant="rounded" height={300} /> : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha('#1d4ed8', 0.06) }}>
                <TableCell>Intake</TableCell><TableCell>Client</TableCell><TableCell>Channel</TableCell>
                <TableCell>Items</TableCell><TableCell>Logged</TableCell><TableCell>Status</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {intakes.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>No order intakes yet. Click “Log order”.</TableCell></TableRow>
              ) : intakes.map((it) => {
                const cm = channelMeta(it.channel); const CIcon = cm.icon;
                return (
                  <TableRow key={it._id} hover>
                    <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{it.intakeNo}</Typography></TableCell>
                    <TableCell>{it.partyName || it.partyId?.name}</TableCell>
                    <TableCell><Chip size="small" icon={<CIcon size={13} />} label={cm.label} variant="outlined" /></TableCell>
                    <TableCell>{it.items?.length || 0}</TableCell>
                    <TableCell><Typography variant="caption">{fmt(it.createdAt)}</Typography></TableCell>
                    <TableCell><Chip size="small" label={it.intakeStatus} sx={{ bgcolor: alpha(STATUS_TONE[it.intakeStatus] || '#64748b', 0.12), color: STATUS_TONE[it.intakeStatus] || '#64748b', fontWeight: 700 }} /></TableCell>
                    <TableCell align="right">
                      {it.intakeStatus === 'NEW' ? (
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <Button size="small" variant="contained" startIcon={<ArrowRightCircle size={14} />} onClick={() => openConvert(it)}>Convert to SO</Button>
                          <Tooltip title="Cancel"><IconButton size="small" onClick={() => cancelIntake(it._id)}><Trash2 size={15} /></IconButton></Tooltip>
                        </Stack>
                      ) : it.intakeStatus === 'CONVERTED' && it.linkedSalesOrderId ? (
                        <Button size="small" onClick={() => navigate(`/orders/${it.linkedSalesOrderId._id || it.linkedSalesOrderId}`)}>View SO</Button>
                      ) : <Typography variant="caption" color="text.disabled">—</Typography>}
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

      {/* ── Convert dialog ── */}
      <Dialog open={!!convert} onClose={() => setConvert(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Convert to Sales Order — {convert?.intakeNo}</DialogTitle>
        <DialogContent dividers>
          {convert && (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">{convert.partyName || convert.partyId?.name}</Typography>
              <TextField size="small" label="PO Number (optional)" value={convert.poNumber} onChange={(e) => setConvert((c) => ({ ...c, poNumber: e.target.value }))} fullWidth />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Items</Typography>
              {convert.items.map((it, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center">
                  <TextField size="small" placeholder="SKU / item" value={it.skuName} onChange={(e) => setConvItem(i, 'skuName', e.target.value)} sx={{ flex: 1 }} />
                  <TextField size="small" type="number" placeholder="Qty" value={it.qty} onChange={(e) => setConvItem(i, 'qty', e.target.value)} sx={{ width: 90 }} />
                </Stack>
              ))}
              <Button size="small" startIcon={<Plus size={14} />} onClick={() => setConvert((c) => ({ ...c, items: [...c.items, { skuName: '', qty: 1 }] }))}>Add item</Button>
              {error && <Typography color="error" variant="body2">{error}</Typography>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConvert(null)}>Cancel</Button>
          <Button variant="contained" onClick={doConvert} disabled={converting}>Create Sales Order</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default OrderIntakeList;
