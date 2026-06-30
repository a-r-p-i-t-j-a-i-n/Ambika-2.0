import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Paper, Stack, Typography, Autocomplete, TextField, Button, Chip, alpha, useTheme,
  CircularProgress, Divider, Box, Table, TableBody, TableCell, TableHead, TableRow, Skeleton,
} from '@mui/material';
import { Mail, Send, Paperclip, FileText, CheckCircle2, Download, CalendarRange, ArrowLeft } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import O2dStepShell from './components/O2dStepShell';
import AttachmentList from '../../components/AttachmentList';
import { useGetOrdersQuery } from '../../store/api/orderApi';
import { useGetScheduleQuery, useEmailDispatchScheduleMutation } from '../../store/api/dispatchControlApi';
import { useGetPartiesQuery } from '../../store/api/partyApi';
import { useUploadFileMutation, useAddStepAttachmentsMutation, useAddStepCommentMutation } from '../../store/api/o2dFmsApi';
import { useReturnToTask } from './useReturnToTask';
import { useFmsGate } from './FmsGate';
import { printDispatchPlan } from '../../utils/printDispatchPlan';

const num = (n) => (Number(n || 0)).toLocaleString('en-IN');
const fmtDate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

const STATUS_COLOR = {
  PLANNED: 'default', IN_PROGRESS: 'info', DISPATCHED: 'success', DELAYED: 'warning', CANCELLED: 'error',
};

// Pull the best recipient email for a party (single email or the first "to" address).
const partyEmailOf = (p) => p?.email || (p?.toEmails || [])[0] || '';

/**
 * Email Dispatch Schedule (step 2.5)
 * ----------------------------------
 * Pick the order → its dispatch plan loads → the recipient auto-fills from the
 * party master, the body is pre-written (editable) and the plan PDF is attached
 * for review. "Send now" is a demo send (no SMTP yet) that records who/when and
 * returns to the FMS task so the step is marked & shows in the tracker.
 * Route: /o2d/dispatch-schedule-email
 */
const DispatchScheduleEmail = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { finishToTask } = useReturnToTask();
  const me = useSelector((s) => s.auth.user);
  const [addStepComment] = useAddStepCommentMutation();

  // FMS task context (set when arriving via "Do it now").
  const fromTask = params.get('fromTask');
  const fromStep = params.get('fromStep');
  const soFromTask = params.get('so') || '';
  const cameFromTask = !!(fromTask && fromStep);
  // Return to the task WITHOUT marking it done (just go review it).
  const backToTask = () => cameFromTask && navigate(`/o2d-fms/task/${fromTask}/${encodeURIComponent(fromStep)}`);

  const { data: ordersRes, isFetching: loadingOrders } = useGetOrdersQuery({ limit: 500, sort: '-orderDate' });
  const orders = useMemo(() => ordersRes?.data || [], [ordersRes]);
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500 });
  const parties = useMemo(() => partiesRes?.data || [], [partiesRes]);
  const [uploadFile] = useUploadFileMutation();
  const [addAttachments] = useAddStepAttachmentsMutation();
  const [emailSchedule] = useEmailDispatchScheduleMutation();

  const [order, setOrder] = useState(null);
  const gate = useFmsGate({ soNumber: order?.soNumber || soFromTask, action: 'EMAIL_DISPATCH_SCHEDULE' });
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState([]); // user-added files (proof)
  const [uploading, setUploading] = useState(false);
  const [sentInfo, setSentInfo] = useState(null);
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);

  // Came from a task → auto-select the order it was raised for, once orders load.
  useEffect(() => {
    if (order || !soFromTask || !orders.length) return;
    const match = orders.find((o) => o.soNumber === soFromTask);
    if (match) setOrder(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soFromTask, orders]);

  const soNumber = order?.soNumber || null;
  const { data: schedRes, isFetching: loadingSched, isError } = useGetScheduleQuery(soNumber, { skip: !soNumber });
  const schedule = schedRes?.data || null;
  const hasPlan = schedule && (schedule.items || []).length > 0;

  // Resolve the party for this order (by id, then by name) → its email.
  const party = useMemo(() => {
    if (!order) return null;
    const pid = String(order.partyId?._id || order.partyId || '');
    return parties.find((p) => String(p._id) === pid)
      || parties.find((p) => p.name && p.name === order.partyName)
      || null;
  }, [order, parties]);

  const phaseRows = useMemo(() => {
    const rows = [];
    (schedule?.items || []).forEach((it) => {
      const phases = (it.phases || []).slice().sort((a, b) => (a.phaseNo > b.phaseNo ? 1 : -1));
      if (!phases.length) rows.push({ it, phase: null });
      else phases.forEach((ph, i) => rows.push({ it, phase: ph, first: i === 0 }));
    });
    return rows;
  }, [schedule]);

  // Pre-fill recipient + subject + body when the order/plan changes.
  useEffect(() => {
    if (!order) return;
    setSentInfo(null);
    setTo(partyEmailOf(party));
    setSubject(`Dispatch Schedule — ${order.soNumber}${order.poNumber ? ` (PO ${order.poNumber})` : ''}`);
    const lines = (schedule?.items || []).flatMap((it) =>
      (it.phases || []).map((ph) => `  • ${it.skuName || it.skuCode}: ${num(ph.plannedQty)} on ${fmtDate(ph.plannedDate)}`));
    setMessage(
      `Dear ${order.partyName || 'Customer'},\n\n`
      + `Please find the dispatch schedule for your order ${order.soNumber}`
      + (order.poNumber ? ` (PO ${order.poNumber})` : '') + '.\n\n'
      + (lines.length ? `Planned dispatches:\n${lines.join('\n')}\n\n` : '')
      + `The detailed dispatch plan PDF is attached for your reference.\n\n`
      + `Regards,\nAmbika Global`,
    );
  }, [order, party, schedule]);

  const openPlanPdf = () => {
    if (!hasPlan) { enqueueSnackbar('No dispatch plan to preview for this order yet.', { variant: 'warning' }); return; }
    const ctx = {
      ...schedule,
      partyName: schedule.partyName || order?.partyName || '',
      soNumber: schedule.soNumber || order?.soNumber || '',
      poNumber: schedule.poNumber || order?.poNumber || '',
      poDate: schedule.poDate || order?.poDate || null,
    };
    const ok = printDispatchPlan(ctx);
    if (ok) enqueueSnackbar('Dispatch plan opened — print or Save as PDF, then attach it below if needed.', { variant: 'success' });
  };

  const uploadAndAttach = async (files) => {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    setUploading(true);
    try {
      const out = [];
      for (const f of arr) {
        const res = await uploadFile({ file: f, folder: 'o2d-fms' }).unwrap();
        const d = res.data || res;
        out.push({ fileName: d.fileName || f.name, fileUrl: d.url, fileKey: d.key, fileType: d.mimeType || f.type, sizeBytes: d.sizeBytes || f.size });
      }
      setAttachments((a) => [...a, ...out]);
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Upload failed.', { variant: 'error' }); }
    finally { setUploading(false); }
  };

  const handleSend = async () => {
    if (!order) return enqueueSnackbar('Select an order first.', { variant: 'warning' });
    if (!to.trim()) return enqueueSnackbar('Recipient email is required.', { variant: 'warning' });
    setSending(true);
    try {
      // Send for real via the SMTP relay, with any files the doer attached.
      const res = await emailSchedule({
        soNumber: order.soNumber,
        to: to.trim(),
        subject,
        message,
        attachments,
      }).unwrap();
      const st = res?.data?.emailStatus || res?.emailStatus;
      if (st && st !== 'SENT') {
        enqueueSnackbar(`Email could not be sent (${st}). Check SMTP settings.`, { variant: 'warning' });
      } else {
        const at = new Date();
        const by = me?.name || me?.email || 'You';
        setSentInfo({ to: to.trim(), at, by });
        enqueueSnackbar(`Dispatch schedule emailed to ${to.trim()}.`, { variant: 'success' });
        // Record who/when/to in the FMS step so it shows in the Tracker's activity.
        if (fromTask && fromStep) {
          try {
            await addStepComment({
              id: fromTask,
              stepCode: fromStep,
              text: `📧 Dispatch schedule emailed to ${to.trim()} by ${by} on ${dayjs(at).format('DD MMM YYYY · hh:mm A')}`
                + (attachments.length ? ` · ${attachments.length} attachment(s)` : ''),
            }).unwrap();
          } catch { /* non-fatal */ }
        }
      }
      // If we came from an FMS task, attach the prepared files to the step so the
      // proof shows in the tracker; the checklist auto-ticks on return.
      if (fromTask && fromStep && attachments.length) {
        try { await addAttachments({ id: fromTask, stepCode: fromStep, attachments }).unwrap(); } catch { /* non-fatal */ }
      }
      setTimeout(() => finishToTask({ soNumber: order.soNumber }), 800);
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not send the email.', { variant: 'error' });
    } finally { setSending(false); }
  };

  return (
    <O2dStepShell icon={Mail} step="Step 2.5" title="Email Dispatch Schedule"
      subtitle="Pick the order — the plan loads, the recipient auto-fills from the party master. Review, attach the plan PDF and send." gate={gate}>
      {/* Came from an FMS task — quick way back to the step. */}
      {cameFromTask && (
        <Paper elevation={0} sx={{
          p: { xs: 1.25, md: 1.5 }, borderRadius: 2.5, mb: 2, display: 'flex', alignItems: 'center',
          gap: 1.25, flexWrap: 'wrap',
          bgcolor: 'background.paper',
          border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
          boxShadow: '0 6px 20px rgba(30,58,138,0.08)',
        }}>
          <Box sx={{ p: 0.85, borderRadius: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main', display: 'flex', flexShrink: 0 }}>
            <Mail size={16} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography sx={{ fontWeight: 800, color: 'primary.dark', fontSize: '0.86rem', lineHeight: 1.2 }}>
              Email Dispatch Schedule{soFromTask ? ` — ${soFromTask}` : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.72rem' }}>
              Send the email below — it returns to the task automatically. Or go back any time.
            </Typography>
          </Box>
          <Button size="small" variant="outlined" startIcon={<ArrowLeft size={14} />} onClick={backToTask} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
            Back to task
          </Button>
        </Paper>
      )}

      {/* Order picker */}
      <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Autocomplete
          options={orders}
          loading={loadingOrders}
          value={order}
          onChange={(_, v) => setOrder(v)}
          getOptionLabel={(o) => (o ? `${o.soNumber} — ${o.partyName} (PO ${o.poNumber || '—'})` : '')}
          isOptionEqualToValue={(a, b) => a._id === b._id}
          renderInput={(p) => <TextField {...p} label="Select Sales Order / PO" placeholder="Search SO / PO / party…" size="small" />}
        />
      </Paper>

      {order && loadingSched && <Skeleton variant="rounded" height={240} sx={{ borderRadius: 3, mb: 2 }} />}

      {order && !loadingSched && !hasPlan && (
        <Paper sx={{ p: 5, textAlign: 'center', borderRadius: 3, color: 'text.secondary', mb: 2 }}>
          <CalendarRange size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
          <Typography sx={{ fontWeight: 700 }}>No dispatch plan found for {order.soNumber}</Typography>
          <Typography sx={{ fontSize: '0.85rem' }}>
            {isError ? 'Could not load the schedule.' : 'Create the schedule in Dispatch Planning first, then come back to email it.'}
          </Typography>
        </Paper>
      )}

      {/* Plan preview */}
      {hasPlan && (
        <Paper sx={{ borderRadius: 3, overflow: 'hidden', mb: 2 }}>
          <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}`, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Box>
              <Typography sx={{ fontWeight: 800 }}>{schedule.partyName || order?.partyName || '—'}</Typography>
              <Typography variant="caption" color="text.secondary">
                {schedule.soNumber || order?.soNumber}{(schedule.poNumber || order?.poNumber) ? ` · PO ${schedule.poNumber || order?.poNumber}` : ''} · {(schedule.items || []).length} SKU(s)
              </Typography>
            </Box>
            <Button variant="outlined" startIcon={<Download size={16} />} onClick={openPlanPdf} sx={{ whiteSpace: 'nowrap' }}>
              Preview / Save plan PDF
            </Button>
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  {['SKU', 'Balance', 'Phase', 'Planned Date', 'Planned Qty', 'Status'].map((h, i) => (
                    <TableCell key={h} align={[1, 4].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {phaseRows.map((r, i) => (
                  <TableRow key={i} hover>
                    {(r.first || !r.phase) ? (
                      <>
                        <TableCell rowSpan={r.phase ? (r.it.phases || []).length : 1}>
                          <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: '0.78rem', color: theme.palette.primary.dark }}>{r.it.skuCode}</Typography>
                          <Typography variant="caption" color="text.secondary">{r.it.skuName}</Typography>
                        </TableCell>
                        <TableCell align="right" rowSpan={r.phase ? (r.it.phases || []).length : 1} sx={{ fontWeight: 700 }}>{num(r.it.balanceQty)}</TableCell>
                      </>
                    ) : null}
                    <TableCell>{r.phase ? <Chip size="small" label={r.phase.phaseNo} sx={{ fontWeight: 800, height: 20 }} /> : <Typography variant="caption" color="text.disabled">—</Typography>}</TableCell>
                    <TableCell>{r.phase ? fmtDate(r.phase.plannedDate) : <Typography variant="caption" color="text.disabled">no plan</Typography>}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800 }}>{r.phase ? num(r.phase.plannedQty) : '—'}</TableCell>
                    <TableCell>{r.phase ? <Chip size="small" color={STATUS_COLOR[r.phase.status] || 'default'} variant="outlined" label={r.phase.status} sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700 }} /> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}

      {/* Email composer */}
      {order && (
        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Stack sx={{ p: 2, bgcolor: alpha(theme.palette.primary.main, 0.05), borderBottom: `1px solid ${theme.palette.divider}` }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.85rem', color: 'text.secondary' }}>EMAIL PREVIEW — sends the dispatch schedule to the client</Typography>
          </Stack>
          {sentInfo && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2.5, py: 1, bgcolor: alpha(theme.palette.success.main, 0.08), borderBottom: `1px solid ${theme.palette.divider}`, flexWrap: 'wrap' }}>
              <CheckCircle2 size={15} color={theme.palette.success.dark} />
              <Typography variant="caption" sx={{ fontWeight: 700, color: theme.palette.success.dark }}>
                Emailed to {sentInfo.to}{sentInfo.by ? ` by ${sentInfo.by}` : ''} on {dayjs(sentInfo.at).format('DD MMM YYYY · hh:mm A')}
              </Typography>
            </Stack>
          )}
          <Stack spacing={2} sx={{ p: 2.5 }}>
            <TextField label="To" value={to} onChange={(e) => setTo(e.target.value)} size="small" fullWidth placeholder="client@email.com"
              helperText={party ? `Auto-filled from party master: ${party.name}` : 'No matching party email found — enter manually.'} />
            <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} size="small" fullWidth />
            <TextField label="Message" value={message} onChange={(e) => setMessage(e.target.value)} size="small" fullWidth multiline minRows={7} />

            {/* Attachments — the plan PDF + any extra files */}
            <Box>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
                <Paperclip size={14} color={theme.palette.primary.main} />
                <Typography variant="caption" sx={{ fontWeight: 800 }}>Attachments</Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                <Chip icon={<FileText size={13} />} variant="outlined" clickable onClick={openPlanPdf} disabled={!hasPlan}
                  label="Dispatch Plan PDF (preview)" sx={{ borderColor: alpha(theme.palette.primary.main, 0.4) }} />
                <input ref={fileRef} type="file" multiple hidden onChange={(e) => { uploadAndAttach(e.target.files); e.target.value = ''; }} />
                <Button size="small" variant="outlined" startIcon={<Paperclip size={14} />} onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : 'Attach files'}
                </Button>
              </Stack>
              <AttachmentList attachments={attachments} dense
                onRemove={(att) => setAttachments((a) => a.filter((x) => x !== att))} />
            </Box>

            <Divider />
            <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={1.5}>
              <Chip size="small" variant="outlined" label="Sends via the configured SMTP relay" sx={{ fontSize: '0.62rem' }} />
              <Button variant="contained" startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <Send size={16} />}
                disabled={sending || uploading || gate.blocked} onClick={handleSend} sx={{ fontWeight: 700, px: 3 }}>
                {sending ? 'Sending…' : 'Send now'}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}
    </O2dStepShell>
  );
};

export default DispatchScheduleEmail;
