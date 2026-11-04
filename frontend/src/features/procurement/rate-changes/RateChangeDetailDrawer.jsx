import React, { useState } from 'react';
import {
  Drawer, Box, Typography, IconButton, Button, Divider, Alert, CircularProgress, Grid, Checkbox,
  FormControlLabel, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Table, TableHead,
  TableBody, TableRow, TableCell,
} from '@mui/material';
import { X, CheckCircle2, XCircle, History, ExternalLink, AlertTriangle } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useNavigate } from 'react-router-dom';
import {
  useGetRateChangeQuery, useApproveRateChangeMutation, useRejectRateChangeMutation,
} from '../../../store/api/procurementApi';
import { PFMS, pfmsTableHeadSx } from '../pfmsTheme';
import { fmtDate, fmtTime } from '../approvals/approvalMeta';
import RateChangeStatusChip from './RateChangeStatusChip';
import { RATE_EVENT, fmtRate, fmtDiff, diffColor } from './rateChangeMeta';

const Field = ({ label, value, testId }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', color: PFMS.sub, mb: 0.25 }}>{label}</Typography>
    <Typography component="div" data-testid={testId} sx={{ fontSize: '0.85rem', fontWeight: 600, color: PFMS.ink, wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);

const Section = ({ title, children }) => (
  <Box sx={{ mt: 2.5 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: PFMS.sub, mb: 1 }}>{title}</Typography>
    {children}
  </Box>
);

const when = (d) => (d ? `${fmtDate(d)} ${fmtTime(d)}` : '—');

/**
 * One rate change request with everything an approver needs: the vendor's rate
 * then and now, the requested rate, the PO line it applies to, the same item at
 * the other vendors, and the request's own history. Approve / Reject are shown
 * to rate approvers (the server checks again, including self-approval).
 */
const RateChangeDetailDrawer = ({ id, onClose, onViewHistory }) => {
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const { data, isFetching, refetch } = useGetRateChangeQuery(id, { skip: !id, refetchOnMountOrArgChange: true });
  const r = data?.data;
  const [approve, { isLoading: approving }] = useApproveRateChangeMutation();
  const [reject, { isLoading: rejecting }] = useRejectRateChangeMutation();
  const [ack, setAck] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  // (Remounted per request via `key`, so these start clean for each one.)

  const pending = r?.status === 'PENDING';
  const stale = pending && r?.stale;
  const canAct = pending && r?.canApprove;
  const approveBlocked = canAct && (r?.approveBlock || r?.poIneligible);

  const doApprove = async () => {
    try {
      const res = await approve({
        id: r._id,
        remarks: remarks.trim(),
        expectedVendorRate: r.currentVendorRate,
        acknowledgeRateChange: stale ? ack : false,
      }).unwrap();
      enqueueSnackbar(res?.message || `${r.requestNumber} approved`, { variant: 'success' });
      refetch();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Approval failed — nothing was changed', { variant: 'error' });
      setAck(false);
      refetch();
    }
  };

  const doReject = async () => {
    try {
      const res = await reject({ id: r._id, reason: reason.trim() }).unwrap();
      enqueueSnackbar(res?.message || `${r.requestNumber} rejected`, { variant: 'success' });
      setRejectOpen(false);
      refetch();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Rejection failed', { variant: 'error' });
    }
  };

  return (
    <Drawer anchor="right" open={Boolean(id)} onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 620 }, bgcolor: PFMS.surface } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }} data-testid="rate-change-drawer">
        <Box sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'flex-start', gap: 1.5, borderBottom: `1px solid ${PFMS.line}` }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: PFMS.sub }}>Rate Change Request</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.25 }}>
              <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: PFMS.ink }} data-testid="rc-number">{r?.requestNumber || '…'}</Typography>
              {r && <RateChangeStatusChip status={r.status} />}
            </Box>
          </Box>
          <IconButton onClick={onClose} aria-label="Close"><X size={18} /></IconButton>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, pb: 2.5 }}>
          {!r ? <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={22} /></Box> : (
            <>
              <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {r.status === 'APPROVED' && (
                  <Alert severity="success">Approved by {r.decidedByName} on {when(r.decidedAt)}{r.selfApproved ? ' (MD, own request)' : ''} — {fmtRate(r.requestedRate)} is the vendor rate and applies on {r.poRef}.</Alert>
                )}
                {r.status === 'REJECTED' && (
                  <Alert severity="error" data-testid="rc-rejected-note">Rejected by {r.decidedByName} on {when(r.decidedAt)}: {r.rejectionReason}. The vendor rate was not changed.</Alert>
                )}
                {r.status === 'WITHDRAWN' && (
                  <Alert severity="info">Withdrawn {when(r.decidedAt)}: {r.withdrawnReason}</Alert>
                )}
                {pending && (
                  <Alert severity="warning">The PO stays a draft and {r.vendorName}'s rate stays {fmtRate(r.currentVendorRate)} until this is decided.</Alert>
                )}
                {stale && (
                  <Alert severity="error" icon={<AlertTriangle size={18} />} data-testid="rc-stale">
                    {r.vendorName}'s rate changed from {fmtRate(r.existingVendorRate)} to <b>{fmtRate(r.currentVendorRate)}</b> after this request was raised.
                    Approving replaces {fmtRate(r.currentVendorRate)} with {fmtRate(r.requestedRate)}.
                  </Alert>
                )}
                {pending && r.poIneligible && (
                  <Alert severity="error">{r.poIneligible} — approving would close this request without changing anything. Reject it instead.</Alert>
                )}
                {pending && r.lastConflict?.at && (
                  <Alert severity="info">Last approval attempt refused {when(r.lastConflict.at)}: {r.lastConflict.message}</Alert>
                )}
              </Box>

              <Section title="Rates">
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={3}><Field label="Vendor rate (when raised)" value={fmtRate(r.existingVendorRate)} testId="rc-existing" /></Grid>
                  <Grid item xs={6} sm={3}><Field label="Original PO rate" value={fmtRate(r.originalPoRate)} /></Grid>
                  <Grid item xs={6} sm={3}><Field label="Requested rate" value={<span style={{ color: PFMS.ink, fontWeight: 800 }}>{fmtRate(r.requestedRate)}</span>} testId="rc-requested" /></Grid>
                  <Grid item xs={6} sm={3}><Field label="Difference" value={<span style={{ color: diffColor(r.diffAmount) }}>{fmtDiff(r.diffAmount, r.diffPercent)}</span>} testId="rc-diff" /></Grid>
                  <Grid item xs={6} sm={3}><Field label="Vendor rate now" value={fmtRate(r.currentVendorRate)} testId="rc-current" /></Grid>
                  <Grid item xs={6} sm={3}><Field label="Unit / currency" value={`${r.unit || '—'} · ${r.currency || 'INR'}`} /></Grid>
                  <Grid item xs={6} sm={3}><Field label="GST" value={`${r.gstRate ?? 0}%`} /></Grid>
                  <Grid item xs={6} sm={3}><Field label="Line impact" value={r.lineImpact == null ? '—' : `${fmtDiff(r.lineImpact, null)} on ${r.quantity} ${r.unit}`} /></Grid>
                </Grid>
              </Section>

              <Section title="Request">
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}><Field label="Vendor" value={r.vendorName} /></Grid>
                  <Grid item xs={12} sm={6}><Field label="Item / SKU" value={`${r.itemName || '—'} · ${r.skuCode || '—'}`} /></Grid>
                  <Grid item xs={6}><Field label="PO" value={r.po ? `${r.po.poRef} (${String(r.po.approvalStatus || '').toLowerCase()}${r.po.isDeleted ? ', deleted' : ''})` : r.poRef} /></Grid>
                  <Grid item xs={6}><Field label="Indent / item" value={[r.indentNumber, r.indentItemDisplayNumber].filter(Boolean).join(' · ') || '—'} /></Grid>
                  <Grid item xs={6}><Field label="Quotation" value={r.quotationPath === 'REQUIRED' ? 'Approved quotation (Step 1.3)' : r.quotationPath === 'NOT_REQUIRED' ? 'Quote not required' : '—'} /></Grid>
                  <Grid item xs={6}><Field label="Requested by" value={`${r.requestedByName || '—'} · ${when(r.requestedAt)}`} /></Grid>
                  <Grid item xs={12}><Field label="Reason" value={r.reason} testId="rc-reason" /></Grid>
                  {r.decidedAt && (
                    <Grid item xs={12}><Field label={r.status === 'WITHDRAWN' ? 'Closed' : 'Decided by'} value={`${r.decidedByName || 'System'} · ${when(r.decidedAt)}${r.decisionRemarks ? ` — ${r.decisionRemarks}` : ''}`} /></Grid>
                  )}
                </Grid>
              </Section>

              {r.po?.line && (
                <Section title="PO line">
                  <Box sx={{ overflowX: 'auto', border: `1px solid ${PFMS.line}`, borderRadius: '8px' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          {['Qty', 'Rate', 'Taxable', 'GST', 'Total', 'PO total'].map((h) => <TableCell key={h} sx={pfmsTableHeadSx} align="right">{h}</TableCell>)}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        <TableRow>
                          <TableCell align="right" sx={{ fontSize: '0.78rem', color: PFMS.ink }}>{r.po.line.quantity} {r.po.line.unit}</TableCell>
                          <TableCell align="right" sx={{ fontSize: '0.78rem', fontWeight: 700, color: PFMS.ink }}>{fmtRate(r.po.line.rate)}</TableCell>
                          <TableCell align="right" sx={{ fontSize: '0.78rem', color: PFMS.ink }}>{fmtRate(r.po.line.taxableAmount)}</TableCell>
                          <TableCell align="right" sx={{ fontSize: '0.78rem', color: PFMS.ink }}>{fmtRate(r.po.line.taxAmount)}</TableCell>
                          <TableCell align="right" sx={{ fontSize: '0.78rem', color: PFMS.ink }}>{fmtRate(r.po.line.totalAmount)}</TableCell>
                          <TableCell align="right" sx={{ fontSize: '0.78rem', fontWeight: 700, color: PFMS.ink }}>{fmtRate(r.po.grandTotal)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </Box>
                </Section>
              )}

              {r.otherVendors?.length > 0 && (
                <Section title="Same item at other vendors">
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {r.otherVendors.map((o, i) => (
                      <Box key={i} sx={{ px: 1.25, py: 0.75, border: `1px solid ${PFMS.line}`, borderRadius: '8px', fontSize: '0.78rem' }}>
                        <b>{o.vendorName}</b> · {fmtRate(o.rate)}/{o.unit}
                      </Box>
                    ))}
                  </Box>
                </Section>
              )}

              {r.laterPos?.length > 0 && (
                <Section title="POs raised at this rate since approval">
                  <Typography sx={{ fontSize: '0.8rem' }}>{r.laterPos.map((p) => p.poRef).join(', ')}</Typography>
                </Section>
              )}

              <Section title="History">
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="rc-events">
                  {(r.events || []).map((e) => (
                    <Box key={e._id} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
                      <Box sx={{ mt: 0.25, color: RATE_EVENT[e.event]?.color || PFMS.sub }}><History size={14} /></Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: RATE_EVENT[e.event]?.color }}>
                          {RATE_EVENT[e.event]?.label || e.event} — {e.actorName || 'System'}
                        </Typography>
                        <Typography sx={{ fontSize: '0.72rem', color: PFMS.sub }}>
                          {when(e.at)} · {fmtRate(e.previousRate)} → {fmtRate(e.newRate)}
                          {e.rejectionReason ? ` · ${e.rejectionReason}` : ''}{e.message ? ` · ${e.message}` : ''}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Section>

              {canAct && (
                <Section title="Decision">
                  {stale && (
                    <FormControlLabel
                      control={<Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} inputProps={{ 'data-testid': 'rc-ack' }} />}
                      label={<Typography sx={{ fontSize: '0.82rem', color: PFMS.ink }}>I have reviewed the current vendor rate {fmtRate(r.currentVendorRate)} and still approve {fmtRate(r.requestedRate)}</Typography>}
                    />
                  )}
                  <TextField size="small" fullWidth label="Approval remarks (optional)" value={remarks}
                    onChange={(e) => setRemarks(e.target.value)} inputProps={{ maxLength: 500, 'data-testid': 'rc-remarks' }} sx={{ mt: 1 }} />
                  {approveBlocked && (
                    <Typography sx={{ mt: 1, fontSize: '0.78rem', color: 'error.main' }} data-testid="rc-approve-block">{r.approveBlock || r.poIneligible}</Typography>
                  )}
                </Section>
              )}
            </>
          )}
        </Box>

        <Divider />
        <Box sx={{ px: 2.5, py: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {r?.po && !r.po.isDeleted && (
            <Button size="small" variant="text" startIcon={<ExternalLink size={15} />} onClick={() => navigate(`/procurement/purchase-orders/${r.po._id}`)}>
              Open PO
            </Button>
          )}
          {r && (
            <Button size="small" variant="outlined" startIcon={<History size={15} />} data-testid="rc-view-history"
              onClick={() => onViewHistory?.({ vendorId: String(r.vendorId), skuCode: r.skuCode, label: `${r.vendorName} · ${r.skuCode || r.itemName}` })}>
              View history
            </Button>
          )}
          {canAct && (
            <>
              <Button size="small" variant="outlined" color="error" startIcon={<XCircle size={15} />} data-testid="rc-reject"
                disabled={rejecting || isFetching} onClick={() => setRejectOpen(true)}>
                Reject
              </Button>
              <Button size="small" variant="contained" color="success" startIcon={<CheckCircle2 size={15} />} data-testid="rc-approve"
                disabled={approving || isFetching || Boolean(approveBlocked && r.approveBlock) || (stale && !ack)} onClick={doApprove}>
                {approving ? 'Approving…' : 'Approve'}
              </Button>
            </>
          )}
        </Box>
      </Box>

      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Reject {r?.requestNumber}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.82rem', color: PFMS.sub, mb: 1.5 }}>
            {r?.vendorName}'s rate stays {fmtRate(r?.currentVendorRate)}. If the PO is still a draft at {fmtRate(r?.requestedRate)}, its line goes back to the vendor rate.
          </Typography>
          <TextField autoFocus fullWidth multiline minRows={3} required label="Reason for rejection" value={reason}
            onChange={(e) => setReason(e.target.value)} inputProps={{ maxLength: 500, 'data-testid': 'rc-reject-reason' }}
            helperText={reason.trim().length < 3 ? 'Required (at least 3 characters)' : ' '} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" data-testid="rc-reject-confirm" disabled={reason.trim().length < 3 || rejecting} onClick={doReject}>
            {rejecting ? 'Rejecting…' : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  );
};

export default RateChangeDetailDrawer;
