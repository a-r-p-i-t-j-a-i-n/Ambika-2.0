import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, IconButton, LinearProgress, Stack, TextField, Tooltip,
  Typography, alpha,
} from '@mui/material';
import {
  Mail, ArrowLeft, ChevronLeft, ChevronRight, Send, X, AlertTriangle,
  CheckCircle2, XCircle, Paperclip, Trash2, FileText,
} from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useBulkEmailPreviewMutation,
  useBulkEmailScheduleMutation,
} from '../../store/api/dispatchControlApi';
import {
  useBulkInvoiceEmailPreviewMutation,
  useBulkInvoiceEmailMutation,
} from '../../store/api/salesInvoiceApi';
import { O2D, O2D_TIP } from './o2dTheme';

const BRAND = '#1d4ed8';
const NAVY = '#0b2545';
const OK = '#0f766e';
const BAD = '#be123c';
const WARN = '#b45309';

// A draft's verdict drives its card colour in the grid, so a reviewer can see the
// state of all six at a glance instead of opening each one.
const STATE = {
  pending: { color: BRAND, label: 'Ready' },
  blocked: { color: WARN, label: 'Needs attention' },
  sending: { color: BRAND, label: 'Sending…' },
  SENT:    { color: OK,   label: 'Sent' },
  FAILED:  { color: BAD,  label: 'Failed' },
};

const stateOf = (d) => {
  if (d.status === 'SENT' || d.status === 'FAILED') return d.status;
  if (d.sending) return 'sending';
  if (!String(d.to || '').trim()) return 'blocked';
  return 'pending';
};

/**
 * Bulk email for the two O2D email steps. `kind` picks which API pair to use:
 *   'schedule' → 2.05, one mail per ORDER, dispatch-plan PDF attached
 *   'invoice'  → 2.08, one mail per CHALLAN, invoice docs + challan PDF attached
 * Everything else — grid, per-mail editor, send-one, send-all — is identical, so
 * the two steps cannot drift apart.
 */
export default function BulkEmailDialog({ open, targets = [], kind = 'schedule', onClose, onSent }) {
  const { enqueueSnackbar } = useSnackbar();
  const isInvoice = kind === 'invoice';

  const [previewSchedule, { isLoading: loadingSchedule }] = useBulkEmailPreviewMutation();
  const [sendSchedule] = useBulkEmailScheduleMutation();
  const [previewInvoice, { isLoading: loadingInvoice }] = useBulkInvoiceEmailPreviewMutation();
  const [sendInvoice] = useBulkInvoiceEmailMutation();

  const loadingPreview = isInvoice ? loadingInvoice : loadingSchedule;
  const LABEL = isInvoice
    ? { noun: 'invoice email', title: 'invoice emails', attachNote: 'The challan PDF is generated and attached by the server when this is sent.' }
    : { noun: 'dispatch schedule', title: 'dispatch schedules', attachNote: 'The dispatch plan PDF is generated and attached by the server when this is sent.' };

  const [drafts, setDrafts] = useState([]);
  const [mode, setMode] = useState('grid');   // 'grid' | 'detail'
  const [active, setActive] = useState(0);
  const [sendingAll, setSendingAll] = useState(false);
  const [loadError, setLoadError] = useState('');

  // Build the drafts fresh every time the dialog opens — the plan may have
  // changed since the board was last loaded.
  useEffect(() => {
    if (!open || !targets.length) return;
    let cancelled = false;
    setMode('grid');
    setActive(0);
    setLoadError('');
    (async () => {
      try {
        const res = isInvoice
          ? await previewInvoice({ targets }).unwrap()
          : await previewSchedule({ soNumbers: targets.map((t) => t.soNumber) }).unwrap();
        if (cancelled) return;
        const list = (res?.data || res || []).map((d, i) => ({
          ...d,
          key: d.key || d.soNumber || String(i),
          // A draft the server could not build (no invoice yet) keeps its error
          // and is simply never sendable.
          status: null,
          sending: false,
          error: d.error || null,
        }));
        setDrafts(list);
      } catch (err) {
        if (!cancelled) setLoadError(err?.data?.message || 'Could not build the email previews.');
      }
    })();
    return () => { cancelled = true; };
  }, [open, targets, isInvoice, previewInvoice, previewSchedule]);

  const patch = (i, next) => setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...next } : d)));

  const sendable = useMemo(
    () => drafts.filter((d) => d.status !== 'SENT' && String(d.to || '').trim() && !d.error),
    [drafts],
  );
  const sentCount = drafts.filter((d) => d.status === 'SENT').length;
  const blockedCount = drafts.filter((d) => stateOf(d) === 'blocked').length;

  const applyResults = (results = []) => {
    setDrafts((prev) => prev.map((d) => {
      const r = results.find((x) => (x.key || x.soNumber) === (d.key || d.soNumber));
      if (!r) return { ...d, sending: false };
      return { ...d, sending: false, status: r.status, error: r.error || null };
    }));
  };

  const sendMany = async (list) => {
    if (!list.length) return null;
    const payload = list.map((d) => ({
      key: d.key,
      id: d.id,
      soNumber: d.soNumber,
      to: String(d.to || '').trim(),
      cc: String(d.cc || '').trim(),
      subject: d.subject,
      message: d.message,
    }));
    const res = isInvoice
      ? await sendInvoice({ emails: payload }).unwrap()
      : await sendSchedule({ emails: payload }).unwrap();
    const data = res?.data || res;
    applyResults(data?.results || []);
    return data;
  };

  const handleSendAll = async () => {
    if (!sendable.length) return;
    setSendingAll(true);
    setDrafts((prev) => prev.map((d) => (sendable.some((x) => x.key === d.key) ? { ...d, sending: true } : d)));
    try {
      const data = await sendMany(sendable);
      const sent = data?.sent ?? 0;
      const failed = data?.failed ?? 0;
      enqueueSnackbar(
        failed ? `${sent} sent, ${failed} failed — see the cards for details.` : `${sent} email${sent === 1 ? '' : 's'} sent.`,
        { variant: failed ? 'warning' : 'success' },
      );
      onSent?.();
      if (!failed) setMode('grid');
    } catch (err) {
      setDrafts((prev) => prev.map((d) => ({ ...d, sending: false })));
      enqueueSnackbar(err?.data?.message || 'Bulk send failed.', { variant: 'error' });
    } finally {
      setSendingAll(false);
    }
  };

  const handleSendOne = async (i) => {
    const d = drafts[i];
    if (!String(d.to || '').trim()) return enqueueSnackbar('Add a recipient first.', { variant: 'warning' });
    patch(i, { sending: true });
    try {
      await sendMany([d]);
      onSent?.();
    } catch (err) {
      patch(i, { sending: false });
      enqueueSnackbar(err?.data?.message || 'Send failed.', { variant: 'error' });
    }
  };

  const removeAt = (i) => setDrafts((prev) => prev.filter((_, idx) => idx !== i));

  const d = drafts[active];

  return (
    <Dialog
      open={open}
      onClose={sendingAll ? undefined : onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{ sx: { borderRadius: '12px', border: `1px solid ${O2D.line}`, height: '88vh' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25, pb: 1.25 }}>
        {mode === 'detail' ? (
          <Tooltip arrow slotProps={O2D_TIP} title="Back to all emails">
            <IconButton size="small" onClick={() => setMode('grid')} sx={{ border: `1px solid ${O2D.line}`, borderRadius: '8px' }}>
              <ArrowLeft size={16} />
            </IconButton>
          </Tooltip>
        ) : (
          <Box sx={{ width: 34, height: 34, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: alpha(BRAND, 0.1), color: BRAND, border: `1px solid ${alpha(BRAND, 0.2)}` }}>
            <Mail size={18} />
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: '1rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.2 }}>
            {mode === 'detail'
              ? `${isInvoice ? (d?.invoiceNo || d?.dcNumber || d?.soNumber) : d?.soNumber} — ${d?.partyName || ''}`
              : `Send ${drafts.length} ${drafts.length === 1 ? LABEL.noun : LABEL.title}`}
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, fontWeight: 600 }}>
            {mode === 'detail'
              ? `Email ${active + 1} of ${drafts.length} — edit anything below, then go back or send this one.`
              : 'Click any card to review and edit that email before sending.'}
          </Typography>
        </Box>
        {sentCount > 0 && (
          <Chip size="small" icon={<CheckCircle2 size={13} />} label={`${sentCount} sent`}
            sx={{ height: 24, fontWeight: 800, fontSize: '0.68rem', bgcolor: alpha(OK, 0.12), color: OK }} />
        )}
        <IconButton size="small" onClick={onClose} disabled={sendingAll}><X size={16} /></IconButton>
      </DialogTitle>
      {sendingAll && <LinearProgress />}
      <Divider />

      <DialogContent sx={{ p: 0, bgcolor: O2D.surfaceAlt }}>
        {loadingPreview && (
          <Stack alignItems="center" sx={{ py: 8 }}>
            <CircularProgress size={26} />
            <Typography sx={{ mt: 1.5, fontSize: '0.82rem', color: O2D.sub }}>Building previews…</Typography>
          </Stack>
        )}

        {!loadingPreview && loadError && (
          <Stack alignItems="center" sx={{ py: 8, px: 3 }}>
            <XCircle size={28} color={BAD} />
            <Typography sx={{ mt: 1.5, fontSize: '0.85rem', color: BAD, textAlign: 'center' }}>{loadError}</Typography>
          </Stack>
        )}

        {/* ── Grid of previews ───────────────────────────────────── */}
        {!loadingPreview && !loadError && mode === 'grid' && (
          <Box sx={{ p: 2, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}>
            {drafts.map((item, i) => {
              const st = STATE[stateOf(item)];
              return (
                <Box
                  key={item.key}
                  onClick={() => { setActive(i); setMode('detail'); }}
                  sx={{
                    p: 1.25, borderRadius: '10px', cursor: 'pointer', bgcolor: O2D.surface,
                    border: `1px solid ${alpha(st.color, 0.3)}`, borderLeft: `4px solid ${st.color}`,
                    transition: 'box-shadow .15s, transform .15s',
                    '&:hover': { boxShadow: `0 4px 14px ${alpha(st.color, 0.2)}`, transform: 'translateY(-1px)' },
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.5 }}>
                    <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 800, color: BRAND, flex: 1, minWidth: 0 }}>
                      {isInvoice ? (item.invoiceNo || item.dcNumber || item.soNumber) : item.soNumber}
                    </Typography>
                    {item.sending
                      ? <CircularProgress size={13} />
                      : (
                        <Chip size="small" label={st.label}
                          sx={{ height: 18, borderRadius: '4px', fontSize: '0.6rem', fontWeight: 800, bgcolor: alpha(st.color, 0.12), color: st.color, '& .MuiChip-label': { px: 0.6 } }} />
                      )}
                    {item.status !== 'SENT' && !item.sending && (
                      <Tooltip arrow slotProps={O2D_TIP} title="Remove from this batch">
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); removeAt(i); }} sx={{ p: 0.25, color: O2D.faint }}>
                          <Trash2 size={12} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>

                  <Typography noWrap sx={{ fontSize: '0.82rem', fontWeight: 800, color: NAVY }}>{item.partyName || '—'}</Typography>
                  <Typography noWrap sx={{ fontSize: '0.68rem', color: item.to ? O2D.sub : BAD, fontWeight: item.to ? 600 : 800, mb: 0.6 }}>
                    {item.to || 'No recipient on party master'}
                  </Typography>

                  <Typography noWrap sx={{ fontSize: '0.7rem', fontWeight: 700, color: O2D.body }}>{item.subject}</Typography>
                  <Typography sx={{
                    mt: 0.4, fontSize: '0.64rem', color: O2D.sub, whiteSpace: 'pre-line',
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {item.message}
                  </Typography>

                  {/* The exact files that will ride along, named — not a promise
                      in prose. Auto ones are generated by the server at send. */}
                  <Stack direction="row" alignItems="center" spacing={0.4} sx={{ mt: 0.75, flexWrap: 'wrap', rowGap: 0.4 }}>
                    <Paperclip size={11} color={O2D.faint} />
                    {(item.attachments || []).length === 0 ? (
                      <Typography sx={{ fontSize: '0.6rem', color: WARN, fontWeight: 700 }}>No attachments</Typography>
                    ) : (item.attachments || []).map((a, ai) => (
                      <Chip
                        key={ai}
                        size="small"
                        icon={<FileText size={9} />}
                        label={a.label || a.fileName}
                        sx={{
                          height: 17, borderRadius: '4px', fontSize: '0.56rem', fontWeight: 700,
                          bgcolor: alpha(a.auto ? OK : BRAND, 0.1), color: a.auto ? OK : BRAND,
                          '& .MuiChip-label': { px: 0.5 }, '& .MuiChip-icon': { ml: 0.4, mr: -0.2 },
                        }}
                      />
                    ))}
                  </Stack>

                  {(item.warning || item.error) && (
                    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.6, px: 0.6, py: 0.4, borderRadius: '5px', bgcolor: alpha(item.error ? BAD : WARN, 0.1) }}>
                      <AlertTriangle size={11} color={item.error ? BAD : WARN} />
                      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: item.error ? BAD : WARN }}>
                        {item.error || item.warning}
                      </Typography>
                    </Stack>
                  )}
                </Box>
              );
            })}
          </Box>
        )}

        {/* ── Single email editor ────────────────────────────────── */}
        {!loadingPreview && !loadError && mode === 'detail' && d && (
          <Box sx={{ p: 2 }}>
            <Stack spacing={1.5} sx={{ bgcolor: O2D.surface, p: 2, borderRadius: '10px', border: `1px solid ${O2D.line}` }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip size="small" label={d.soNumber} sx={{ height: 22, fontWeight: 800, fontSize: '0.68rem', bgcolor: alpha(BRAND, 0.1), color: BRAND }} />
                {d.dcNumber && <Chip size="small" label={d.dcNumber} sx={{ height: 22, fontWeight: 700, fontSize: '0.66rem' }} />}
                {d.invoiceNo && <Chip size="small" label={`INV ${d.invoiceNo}`} sx={{ height: 22, fontWeight: 700, fontSize: '0.66rem' }} />}
                {d.poNumber && <Chip size="small" label={`PO ${d.poNumber}`} sx={{ height: 22, fontWeight: 700, fontSize: '0.66rem' }} />}
                <Box sx={{ flex: 1 }} />
                <Tooltip arrow slotProps={O2D_TIP} title="Previous email">
                  <span>
                    <IconButton size="small" disabled={active === 0} onClick={() => setActive((i) => Math.max(0, i - 1))}>
                      <ChevronLeft size={16} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: O2D.sub }}>{active + 1} / {drafts.length}</Typography>
                <Tooltip arrow slotProps={O2D_TIP} title="Next email">
                  <span>
                    <IconButton size="small" disabled={active >= drafts.length - 1} onClick={() => setActive((i) => Math.min(drafts.length - 1, i + 1))}>
                      <ChevronRight size={16} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>

              <TextField
                label="To" size="small" fullWidth value={d.to}
                onChange={(e) => patch(active, { to: e.target.value })}
                error={!String(d.to || '').trim()}
                helperText={String(d.to || '').trim() ? 'From the party master — edit if needed.' : 'Required — no email found on the party master.'}
              />
              <TextField label="Cc" size="small" fullWidth value={d.cc} onChange={(e) => patch(active, { cc: e.target.value })} />
              <TextField label="Subject" size="small" fullWidth value={d.subject} onChange={(e) => patch(active, { subject: e.target.value })} />
              <TextField
                label="Message" size="small" fullWidth multiline minRows={12}
                value={d.message} onChange={(e) => patch(active, { message: e.target.value })}
              />

              <Box>
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.6 }}>
                  <Paperclip size={13} color={O2D.sub} />
                  <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, fontWeight: 700 }}>
                    Attachments ({(d.attachments || []).length})
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.6} sx={{ flexWrap: 'wrap', rowGap: 0.6 }}>
                  {(d.attachments || []).map((a, ai) => (
                    <Chip
                      key={ai}
                      size="small"
                      icon={<FileText size={11} />}
                      label={a.fileName}
                      sx={{
                        height: 22, borderRadius: '5px', fontSize: '0.64rem', fontWeight: 700,
                        bgcolor: alpha(a.auto ? OK : BRAND, 0.1), color: a.auto ? OK : BRAND,
                      }}
                    />
                  ))}
                </Stack>
                <Typography sx={{ mt: 0.6, fontSize: '0.66rem', color: O2D.faint }}>
                  {LABEL.attachNote}
                </Typography>
              </Box>

              {d.status === 'SENT' && (
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 1, py: 0.75, borderRadius: '6px', bgcolor: alpha(OK, 0.1) }}>
                  <CheckCircle2 size={14} color={OK} />
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: OK }}>Already sent in this batch.</Typography>
                </Stack>
              )}
              {d.error && (
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 1, py: 0.75, borderRadius: '6px', bgcolor: alpha(BAD, 0.1) }}>
                  <XCircle size={14} color={BAD} />
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: BAD }}>{d.error}</Typography>
                </Stack>
              )}
            </Stack>
          </Box>
        )}
      </DialogContent>

      <Divider />
      <DialogActions sx={{ px: 2, py: 1.25, gap: 1 }}>
        {blockedCount > 0 && (
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mr: 'auto' }}>
            <AlertTriangle size={13} color={WARN} />
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: WARN }}>
              {blockedCount} without a recipient — open {blockedCount === 1 ? 'it' : 'them'} to add one.
            </Typography>
          </Stack>
        )}
        {blockedCount === 0 && <Box sx={{ mr: 'auto' }} />}

        <Button onClick={onClose} disabled={sendingAll} sx={{ fontWeight: 700, textTransform: 'none' }}>
          Close
        </Button>

        {mode === 'detail' && (
          <>
            <Button variant="outlined" onClick={() => setMode('grid')} startIcon={<ArrowLeft size={14} />}
              sx={{ fontWeight: 800, textTransform: 'none', borderRadius: '8px' }}>
              Back to all
            </Button>
            <Button
              variant="outlined"
              onClick={() => handleSendOne(active)}
              disabled={d?.sending || d?.status === 'SENT' || !String(d?.to || '').trim()}
              startIcon={d?.sending ? <CircularProgress size={13} /> : <Send size={14} />}
              sx={{ fontWeight: 800, textTransform: 'none', borderRadius: '8px' }}
            >
              Send this one
            </Button>
          </>
        )}

        <Button
          variant="contained"
          onClick={handleSendAll}
          disabled={sendingAll || !sendable.length}
          startIcon={sendingAll ? <CircularProgress size={14} color="inherit" /> : <Send size={15} />}
          sx={{ fontWeight: 800, textTransform: 'none', borderRadius: '8px', boxShadow: 'none' }}
        >
          {sendingAll ? 'Sending…' : `Send all ${sendable.length}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
