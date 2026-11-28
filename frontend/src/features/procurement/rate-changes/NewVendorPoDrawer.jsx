import React, { useState } from 'react';
import {
  Drawer, Box, Typography, IconButton, Button, Divider, Alert, CircularProgress, Grid, TextField,
  Table, TableHead, TableBody, TableRow, TableCell,
} from '@mui/material';
import { X, CheckCircle2, XCircle, History, ExternalLink } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useNavigate } from 'react-router-dom';
import { useGetPoApprovalQuery, useApprovePurchaseOrderMutation } from '../../../store/api/procurementApi';
import { PFMS, pfmsTableHeadSx } from '../pfmsTheme';
import { fmtDate, fmtTime } from '../approvals/approvalMeta';
import RateChangeStatusChip from './RateChangeStatusChip';
import { fmtRate } from './rateChangeMeta';

const Field = ({ label, value, testId }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', color: PFMS.sub, mb: 0.25 }}>{label}</Typography>
    <Typography component="div" data-testid={testId} sx={{ fontSize: '0.85rem', fontWeight: 600, color: PFMS.ink, wordBreak: 'break-word' }}>{value || '—'}</Typography>
  </Box>
);

const Section = ({ title, children }) => (
  <Box sx={{ mt: 2.5 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: PFMS.sub, mb: 1 }}>{title}</Typography>
    {children}
  </Box>
);

const when = (d) => (d ? `${fmtDate(d)} ${fmtTime(d)}` : '—');
const EVENT_LABEL = { CREATE: 'Created', UPDATE: 'Edited', SUBMIT: 'Submitted for approval', APPROVE: 'Approved', REJECT: 'Rejected' };

/**
 * One new-vendor PO as the approver reviews it: the Vendor Master record it was
 * judged on, the PO lines, who did what — and the decision. Approve / Reject are
 * the PO's own approval (the same call as PO Approval, so the same atomic claim,
 * maker-checker and audit): the first decision wins, the other approver then
 * finds the PO decided and the buttons gone.
 */
const NewVendorPoDrawer = ({ id, onClose }) => {
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const { data, isFetching, refetch } = useGetPoApprovalQuery(id, { skip: !id, refetchOnMountOrArgChange: true });
  const po = data?.data;
  const [approvePo, { isLoading: deciding }] = useApprovePurchaseOrderMutation();
  const [remarks, setRemarks] = useState('');
  // (Remounted per PO via `key`, so this starts clean for each one.)

  const pending = po?.status === 'PENDING';
  const decide = async (decision) => {
    try {
      const res = await approvePo({ id: po._id, decision, remarks: remarks.trim() }).unwrap();
      enqueueSnackbar(decision === 'REJECTED' ? `${po.poRef} rejected` : `${po.poRef} approved — ${res?.data?.poNumber || ''}`.trim(), { variant: decision === 'REJECTED' ? 'info' : 'success' });
      refetch();
    } catch (err) {
      // E.g. the other approver decided first: say so, then show the PO as it is now.
      enqueueSnackbar(err?.data?.message || 'The decision was not saved — nothing was changed', { variant: 'error' });
      refetch();
    }
  };

  return (
    <Drawer anchor="right" open={Boolean(id)} onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 620 }, bgcolor: PFMS.surface } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }} data-testid="nv-drawer">
        <Box sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'flex-start', gap: 1.5, borderBottom: `1px solid ${PFMS.line}` }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: PFMS.sub }}>New-Vendor PO Approval</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.25 }}>
              <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: PFMS.ink }} data-testid="nv-number">{po?.poRef || '…'}</Typography>
              {po && <RateChangeStatusChip status={po.status} />}
            </Box>
          </Box>
          <IconButton onClick={onClose} aria-label="Close"><X size={18} /></IconButton>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, pb: 2.5 }}>
          {!po ? <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={22} /></Box> : (
            <>
              <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {po.status === 'APPROVED' && (
                  <Alert severity="success" data-testid="nv-approved-note">Approved by {po.decidedBy || '—'} on {when(po.decidedAt)}{po.remarks ? ` — ${po.remarks}` : ''}. The other approver has nothing left to do.</Alert>
                )}
                {po.status === 'REJECTED' && (
                  <Alert severity="error" data-testid="nv-rejected-note">Rejected by {po.decidedBy || '—'} on {when(po.decidedAt)}{po.remarks ? `: ${po.remarks}` : ''}.</Alert>
                )}
                {pending && (
                  <Alert severity="warning">
                    {po.vendorName} was added to the Vendor Master on {when(po.vendor?.createdAt || po.vendorCreatedAt)} and none of its POs has been approved yet.
                    The MD or the purchase approver decides this PO — either one is enough, and the first decision stands.
                  </Alert>
                )}
              </Box>

              <Section title="New vendor (Vendor Master record)">
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}><Field label="Vendor" value={po.vendor?.name || po.vendorName} testId="nv-vendor" /></Grid>
                  <Grid item xs={6} sm={3}><Field label="Code" value={po.vendor?.code} /></Grid>
                  <Grid item xs={6} sm={3}><Field label="GST No" value={po.vendor?.gstNo} /></Grid>
                  <Grid item xs={12} sm={6}><Field label="Added to Vendor Master" value={`${when(po.vendor?.createdAt || po.vendorCreatedAt)}${po.vendor?.createdByName ? ` · by ${po.vendor.createdByName}` : ''}`} testId="nv-vendor-created" /></Grid>
                  <Grid item xs={6} sm={3}><Field label="Phone" value={po.vendor?.phone} /></Grid>
                  <Grid item xs={6} sm={3}><Field label="E-mail" value={po.vendor?.email} /></Grid>
                </Grid>
              </Section>

              <Section title="Purchase order">
                <Grid container spacing={2} sx={{ mb: 1.5 }}>
                  <Grid item xs={6} sm={4}><Field label="PO" value={po.poRef} /></Grid>
                  <Grid item xs={6} sm={4}><Field label="Indent" value={(po.indentNumbers || []).join(', ')} /></Grid>
                  <Grid item xs={6} sm={4}><Field label="PO value" value={fmtRate(po.totals?.grandTotal ?? po.grandTotal)} testId="nv-total" /></Grid>
                  <Grid item xs={12}><Field label="Submitted by" value={`${po.submittedBy || '—'} · ${when(po.submittedAt)}`} /></Grid>
                </Grid>
                <Box sx={{ overflowX: 'auto', border: `1px solid ${PFMS.line}`, borderRadius: '8px' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={pfmsTableHeadSx}>Item</TableCell>
                        {['Qty', 'Rate', 'GST', 'Total'].map((h) => <TableCell key={h} sx={pfmsTableHeadSx} align="right">{h}</TableCell>)}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(po.items || []).map((l) => (
                        <TableRow key={l._id} data-testid="nv-line">
                          <TableCell sx={{ fontSize: '0.78rem', color: PFMS.ink }}>{l.itemName}<Box component="span" sx={{ display: 'block', fontSize: '0.68rem', color: PFMS.sub }}>{l.skuCode}</Box></TableCell>
                          <TableCell align="right" sx={{ fontSize: '0.78rem', color: PFMS.ink }}>{l.quantity} {l.unit}</TableCell>
                          <TableCell align="right" sx={{ fontSize: '0.78rem', fontWeight: 700, color: PFMS.ink }}>{fmtRate(l.rate)}</TableCell>
                          <TableCell align="right" sx={{ fontSize: '0.78rem', color: PFMS.ink }}>{l.gstRate}%</TableCell>
                          <TableCell align="right" sx={{ fontSize: '0.78rem', color: PFMS.ink }}>{fmtRate(l.totalAmount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </Section>

              <Section title="History">
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="nv-events">
                  {(po.events || []).map((e) => (
                    <Box key={e._id || `${e.action}-${e.at}`} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
                      <Box sx={{ mt: 0.25, color: e.action === 'APPROVE' ? '#15803d' : e.action === 'REJECT' ? '#b91c1c' : PFMS.sub }}><History size={14} /></Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: e.action === 'APPROVE' ? '#15803d' : e.action === 'REJECT' ? '#b91c1c' : PFMS.ink }}>
                          {EVENT_LABEL[e.action] || e.action} — {e.actorName || 'System'}
                        </Typography>
                        <Typography sx={{ fontSize: '0.72rem', color: PFMS.sub }}>{when(e.at)}{e.description ? ` · ${e.description}` : ''}</Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Section>

              {pending && (
                <Section title="Decision">
                  {po.canDecide ? (
                    <TextField size="small" fullWidth label="Remarks (optional)" value={remarks}
                      onChange={(e) => setRemarks(e.target.value)} inputProps={{ maxLength: 500, 'data-testid': 'nv-remarks' }} />
                  ) : (
                    <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }} data-testid="nv-cannot-decide">
                      {po.block || 'Only the MD or the purchase approver can approve or reject this PO.'}
                    </Typography>
                  )}
                </Section>
              )}
            </>
          )}
        </Box>

        <Divider />
        <Box sx={{ px: 2.5, py: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {po && (
            <Button size="small" variant="text" startIcon={<ExternalLink size={15} />} onClick={() => navigate(`/procurement/purchase-orders/${po._id}`)}>
              Open PO
            </Button>
          )}
          {pending && po.canDecide && (
            <>
              <Button size="small" variant="outlined" color="error" startIcon={<XCircle size={15} />} data-testid="nv-reject"
                disabled={deciding || isFetching} onClick={() => decide('REJECTED')}>
                Reject
              </Button>
              <Button size="small" variant="contained" color="success" startIcon={<CheckCircle2 size={15} />} data-testid="nv-approve"
                disabled={deciding || isFetching} onClick={() => decide('APPROVED')}>
                {deciding ? 'Saving…' : 'Approve'}
              </Button>
            </>
          )}
        </Box>
      </Box>
    </Drawer>
  );
};

export default NewVendorPoDrawer;
