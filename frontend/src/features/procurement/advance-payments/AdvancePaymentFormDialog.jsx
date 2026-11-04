import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Grid, MenuItem, Box, Typography,
  CircularProgress, Alert, Autocomplete, useMediaQuery, useTheme, Table, TableHead, TableBody, TableRow, TableCell,
  IconButton, Tooltip,
} from '@mui/material';
import { Wallet, Save, Upload, FileCheck2, X, Paperclip, ExternalLink } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useCreateAdvancePaymentMutation, useGetAdvanceCandidatesQuery } from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { PAYMENT_STATUSES, PAYMENT_MODES, ADVANCE_STATE, modeLabel, fmtINR, fmtDate } from './apMeta';
import { fileHref } from '../indents/indentMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import StatusChip from '../components/StatusChip';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { PFMS } from '../pfmsTheme';

/**
 * Step 1.7 — record an Advance Payment against a PI.
 *
 * The advance IS the approved PI's value (no separate advance field), so the
 * business rule is: an approved, live PO + its Proforma Invoice ready for
 * advance payment + the MD's approval of that PI. The server decides all of it
 * (backend advancePayment.eligibility / service); this form only shows the
 * answer. Rules mirrored for fast feedback:
 *   FULL_PAYMENT  → amount must equal the remaining advance.
 *   SHORT_PAYMENT_COMPLETED → remarks required, must leave a balance.
 *   CANCELLED     → nothing is posted.
 *
 * Two ways in, ONE form and ONE endpoint (POST /advance-payments):
 *   - `pi` given  (Awaiting Advance row, PI detail, doer runner) → pays that PI.
 *   - no `pi`     ("+ Record Advance Payment") → pick any approved PO; POs that
 *     cannot be paid yet are listed too, with the reason and the next step.
 */
const todayStr = () => new Date().toISOString().slice(0, 10);

const STATUS_LABELS = {
  PART_PAYMENT: 'Part Payment',
  FULL_PAYMENT: 'Full Payment',
  SHORT_PAYMENT_COMPLETED: 'Short Payment Completed',
  CANCELLED: 'Cancelled',
};

const ReadOnly = ({ label, value, strong, color, node }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: 'uppercase' }}>{label}</Typography>
    {node ? <Box>{node}</Box> : (
      <Typography variant="body2" fontWeight={strong ? 800 : 700} sx={{ color, wordBreak: 'break-word' }}>{value || '—'}</Typography>
    )}
  </Box>
);

const SectionTitle = ({ children }) => (
  <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: PFMS.faint, mb: 1 }}>{children}</Typography>
);

const SummaryRow = ({ label, value, color, strong, testId }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.6, borderTop: strong ? `1px solid ${PFMS.line}` : 0 }}>
    <Typography variant="body2" color={strong ? 'text.primary' : 'text.secondary'} fontWeight={strong ? 800 : 600}>{label}</Typography>
    <Typography variant="body2" fontWeight={800} sx={{ color, fontVariantNumeric: 'tabular-nums' }} data-testid={testId}>{value}</Typography>
  </Box>
);

const panelSx = { p: 1.5, borderRadius: '8px', bgcolor: PFMS.surfaceAlt, border: `1px solid ${PFMS.line}` };

/** Payments already recorded against the PI — also used by the detail dialog. */
export const PaymentHistoryTable = ({ rows = [], highlightId }) => (
  <Box sx={{ overflowX: 'auto' }} data-testid="ap-history">
    <Table size="small" sx={{ minWidth: 560, '& td, & th': { px: 1, py: 0.6, fontSize: '0.78rem', whiteSpace: 'nowrap' } }}>
      <TableHead>
        <TableRow>
          {['Payment No', 'Date', 'Amount', 'Mode', 'UTR / Ref', 'Recorded By', 'Status', ''].map((h) => (
            <TableCell key={h || 'proof'} align={h === 'Amount' ? 'right' : 'left'} sx={{ fontWeight: 800, color: PFMS.sub }}>{h}</TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((h) => (
          <TableRow key={h._id} data-testid="ap-history-row" selected={String(h._id) === String(highlightId)}>
            <TableCell sx={{ fontWeight: 700 }}>{h.paymentNumber}</TableCell>
            <TableCell>{fmtDate(h.paymentDate)}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, color: h.paymentStatus === 'CANCELLED' ? PFMS.sub : '#0f766e', fontVariantNumeric: 'tabular-nums' }}>{fmtINR(h.paidAmount)}</TableCell>
            <TableCell>{modeLabel(h.paymentMode)}</TableCell>
            <TableCell>{h.paymentReferenceNumber || '—'}</TableCell>
            <TableCell>{h.performedByName || '—'}</TableCell>
            <TableCell><StatusChip status={h.paymentStatus} /></TableCell>
            <TableCell>
              {h.proofDocument?.fileUrl && (
                <Tooltip title="View payment proof">
                  <IconButton size="small" component="a" href={fileHref(h.proofDocument.fileUrl)} target="_blank" rel="noopener" aria-label="View payment proof">
                    <Paperclip size={14} />
                  </IconButton>
                </Tooltip>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </Box>
);

const AdvancePaymentFormDialog = ({ open, onClose, pi: piProp }) => {
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('md'));
  const choosingPo = !piProp;
  const submitting = useRef(false); // a second click / Enter while one submit is in flight is ignored
  const [pickedId, setPickedId] = useState(null);
  const [pickedSnap, setPickedSnap] = useState(null); // last picked row, kept if a new search drops it from the list
  const [, setSearchInput, search] = useDebouncedSearch('');

  // Picker: every approved, live PO matching the search, payable ones first.
  const cands = useGetAdvanceCandidatesQuery({ search: search || undefined, limit: 100 }, { skip: !open || !choosingPo, refetchOnMountOrArgChange: true });
  // With a PI given (queue / PI detail) the same endpoint gives the PO, vendor and history for it.
  const forPi = useGetAdvanceCandidatesQuery({ piId: piProp?._id }, { skip: !open || choosingPo || !piProp?._id, refetchOnMountOrArgChange: true });
  const options = cands.data?.data || [];
  const selected = choosingPo
    ? (options.find((o) => String(o.poId) === String(pickedId)) || pickedSnap)
    : (forPi.data?.data || [])[0] || null;
  const pi = selected?.pi || piProp;
  const history = selected?.payments || [];
  const state = selected?.state;

  const [paymentStatus, setPaymentStatus] = useState('PART_PAYMENT');
  const [paymentDate, setPaymentDate] = useState(todayStr());
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('E_FUND_TRANSFER');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [proof, setProof] = useState(null);
  const [createPayment, { isLoading }] = useCreateAdvancePaymentMutation();
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();

  const total = Number(pi?.totalValue) || 0;
  const alreadyPaid = Number(pi?.paidAmount) || 0;
  const balance = Number(pi?.balanceAmount) || 0;
  const isCancelled = paymentStatus === 'CANCELLED';
  const isShort = paymentStatus === 'SHORT_PAYMENT_COMPLETED';
  const isFull = paymentStatus === 'FULL_PAYMENT';
  const mdStatus = pi?.mdApprovalStatus || 'NOT_REQUIRED';
  // Awaiting the MD: a real payment cannot be submitted. A PI approved before
  // this rule (NOT_REQUIRED) may be submitted — the server sends it to the MD.
  const mdBlocked = !isCancelled && mdStatus === 'READY_FOR_MD_APPROVAL';
  // Not payable at all (no PI yet, PI not approved, fully paid …): the form is shown but locked.
  const notPayable = Boolean(selected) && state && !state.payable;
  const amount = Number(paidAmount) || 0;
  const overBalance = !isCancelled && amount > balance + 0.005;

  useEffect(() => {
    if (!open) return;
    setPaymentStatus('PART_PAYMENT');
    setPaymentDate(todayStr());
    setPaidAmount('');
    setPaymentMode('E_FUND_TRANSFER');
    setReferenceNumber('');
    setBankReference('');
    setRemarks('');
    setProof(null);
    submitting.current = false;
  }, [open, pi?._id]);

  useEffect(() => { if (open && choosingPo) { setPickedId(null); setPickedSnap(null); } }, [open, choosingPo]);

  // Full payment auto-fills the exact remaining advance.
  useEffect(() => {
    if (isFull) setPaidAmount(String(balance));
  }, [isFull, balance]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { enqueueSnackbar('File too large — max 10 MB', { variant: 'warning' }); return; }
    try {
      const res = await uploadDoc(file).unwrap();
      const d = res?.data || {};
      setProof({ fileUrl: d.url || d.fileUrl, fileName: d.fileName || file.name, fileType: d.mimeType || file.type });
      enqueueSnackbar('Payment proof uploaded', { variant: 'success' });
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Upload failed', { variant: 'error' }); }
  };

  const handleSubmit = async () => {
    if (submitting.current || !pi?._id) return;
    if (!isCancelled && amount <= 0) {
      enqueueSnackbar('Paid amount must be greater than zero', { variant: 'warning' });
      return;
    }
    if (overBalance) {
      enqueueSnackbar(`Paid amount cannot exceed the remaining advance (${fmtINR(balance)})`, { variant: 'warning' });
      return;
    }
    if (isShort && !remarks.trim()) {
      enqueueSnackbar('Remarks are required for short payment completion', { variant: 'warning' });
      return;
    }
    submitting.current = true;
    try {
      const res = await createPayment({
        piId: pi._id,
        paymentStatus,
        paymentDate,
        paidAmount: isCancelled ? 0 : amount,
        paymentMode,
        paymentReferenceNumber: referenceNumber.trim(),
        bankReference: bankReference.trim(),
        proofDocument: proof?.fileUrl ? proof : undefined,
        remarks: remarks.trim(),
      }).unwrap();
      enqueueSnackbar(`Payment ${res?.data?.paymentNumber || ''} recorded`, { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to record payment', { variant: 'error' });
      // The PO may just have been paid up / cancelled by someone else — show the current list.
      if (choosingPo) cands.refetch(); else forPi.refetch();
    } finally {
      submitting.current = false;
    }
  };

  const after = isCancelled ? balance : Math.max(0, balance - amount);
  const stateMeta = state ? ADVANCE_STATE[state.code] : null;
  const picked = choosingPo ? selected : null;

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth fullScreen={fullScreen} data-testid="ap-form-dialog">
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Wallet size={20} /> Record Advance Payment
        {pi?.piNumber && <Typography component="span" sx={{ ml: 0.5, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{pi.piNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        {choosingPo && (
          <Box sx={{ mb: 2 }} data-testid="ap-po-picker">
            <SectionTitle>Purchase Order</SectionTitle>
            <Alert severity="info" sx={{ mb: 1.5 }} data-testid="ap-rule-note">
              An advance is paid against the PO&apos;s approved Proforma Invoice (the advance is the PI value), and only after the MD approves that PI.
              POs that are not ready yet are listed too — pick one to see what is still needed.
            </Alert>
            {cands.isError ? (
              <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => cands.refetch()}>Retry</Button>}>
                {cands.error?.data?.message || 'Could not load the purchase orders'}
              </Alert>
            ) : (
              <Autocomplete
                options={options}
                loading={cands.isFetching}
                value={picked}
                onInputChange={(_e, v, reason) => { if (reason === 'input') setSearchInput(v); else if (reason === 'clear') setSearchInput(''); }}
                onChange={(_e, v) => { setPickedId(v?.poId || null); setPickedSnap(v || null); }}
                filterOptions={(x) => x /* the server already searched PO / vendor / indent / PI */}
                groupBy={(o) => (o.state.payable ? 'Ready for advance payment' : 'Not payable yet')}
                getOptionLabel={(o) => (o ? `${o.poNumber} — ${o.vendorName}` : '')}
                isOptionEqualToValue={(o, v) => String(o.poId) === String(v.poId)}
                noOptionsText={cands.isFetching ? 'Loading…' : 'No matching approved purchase order'}
                renderOption={(props, o) => {
                  const m = ADVANCE_STATE[o.state.code] || { label: o.state.code, tone: 'neutral' };
                  return (
                    <li {...props} key={o.poId} data-testid="ap-po-option">
                      <Box sx={{ width: '100%', minWidth: 0 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
                          <Typography variant="body2" fontWeight={800}>{o.poNumber}</Typography>
                          <StatusChip status={o.state.code} label={m.label} tone={m.tone} />
                        </Box>
                        <Typography variant="caption" color="text.secondary" component="div" noWrap>
                          {o.vendorName} · Indent {o.indentNumber || '—'} · {o.pi ? `PI ${o.pi.piNumber} ${fmtINR(o.pi.totalValue)}` : 'No PI'} · PO {fmtINR(o.poTotal)}
                        </Typography>
                      </Box>
                    </li>
                  );
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Select Purchase Order *" placeholder="Search PO number / vendor / indent / PI number"
                    InputProps={{ ...params.InputProps, endAdornment: (<>{cands.isFetching ? <CircularProgress size={16} /> : null}{params.InputProps.endAdornment}</>) }} />
                )}
              />
            )}
            {!cands.isFetching && !cands.isError && !options.length && (
              <Alert severity="info" sx={{ mt: 1.5 }} data-testid="ap-po-empty">
                {search ? 'No approved purchase order matches this search.' : 'There is no approved purchase order yet.'}
              </Alert>
            )}
          </Box>
        )}

        {!choosingPo && forPi.isError && (
          <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => forPi.refetch()}>Retry</Button>}>
            {forPi.error?.data?.message || 'Could not load the purchase order details'}
          </Alert>
        )}

        {selected && notPayable && (
          <Alert severity={state.code === 'FULLY_PAID' || state.code === 'SHORT_CLOSED' ? 'success' : 'warning'} sx={{ mb: 2 }} data-testid="ap-not-payable"
            action={(
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                <Button color="inherit" size="small" startIcon={<ExternalLink size={14} />} onClick={() => { onClose?.(false); navigate(`/procurement/purchase-orders/${selected.poId}`); }}>Open PO</Button>
                {pi?._id && <Button color="inherit" size="small" startIcon={<ExternalLink size={14} />} onClick={() => { onClose?.(false); navigate(`/procurement/proforma-invoices/${pi._id}`); }}>Open PI</Button>}
              </Box>
            )}>
            <b>{stateMeta?.label || state.code}.</b> {state.reason}.{state.nextStep ? ` Next: ${state.nextStep}.` : ''}
          </Alert>
        )}

        {(pi || selected) && (
          <Grid container spacing={2}>
            <Grid item xs={12} md={7}>
              <Box sx={{ mb: 2 }} data-testid="ap-details">
                <SectionTitle>Purchase and vendor details</SectionTitle>
                <Box sx={{ ...panelSx, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' } }}>
                  <ReadOnly label="PO Number" value={pi?.poNumber || selected?.poNumber} strong />
                  {selected && <ReadOnly label="PO Approval" node={<StatusChip status={selected.poApprovalStatus} />} />}
                  {selected && <ReadOnly label="Indent Number" value={selected.indentNumber} />}
                  {selected && <ReadOnly label="PO Date" value={fmtDate(selected.poDate)} />}
                  {selected && <ReadOnly label="PO Total" value={fmtINR(selected.poTotal)} />}
                  <ReadOnly label="Vendor" value={selected?.vendor?.name || pi?.vendorName} strong />
                  {selected?.vendor?.gst && <ReadOnly label="Vendor GSTIN" value={selected.vendor.gst} />}
                  {selected?.vendor?.phone && <ReadOnly label="Vendor Phone" value={selected.vendor.phone} />}
                  {selected?.vendor?.address && <Box sx={{ gridColumn: '1 / -1' }}><ReadOnly label="Vendor Address" value={selected.vendor.address} /></Box>}
                  <ReadOnly label="PI Number" value={pi?.piNumber || 'No PI yet'} />
                  {pi && <ReadOnly label="PI Approval" node={<StatusChip status={pi.approvalStatus || 'PENDING'} />} />}
                  {pi && <ReadOnly label="MD Approval (PI)" node={<StatusChip status={mdStatus === 'NOT_REQUIRED' ? 'PENDING' : mdStatus} label={mdStatus === 'NOT_REQUIRED' ? 'Not raised yet' : undefined} />} />}
                </Box>
              </Box>

              {pi && (<>
                <SectionTitle>Payment details</SectionTitle>
                <Grid container spacing={2} component="fieldset" disabled={notPayable} sx={{ border: 0, m: 0, p: 0, width: '100%', minInlineSize: 0, '& > .MuiGrid-item': { pt: 2 } }}>
                  <Grid item xs={12} sm={6}>
                    <TextField label="Payment Status *" select fullWidth disabled={notPayable} value={paymentStatus}
                      onChange={(e) => setPaymentStatus(e.target.value)}>
                      {PAYMENT_STATUSES.map((s) => <MenuItem key={s} value={s}>{STATUS_LABELS[s]}</MenuItem>)}
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <DateInputDDMMYYYY label="Payment Date *" fullWidth value={paymentDate} disabled={notPayable} onChange={setPaymentDate} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField label={isCancelled ? 'Payment Amount (not posted)' : 'Payment Amount *'} type="number" fullWidth
                      value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)}
                      disabled={notPayable || isCancelled || isFull}
                      inputProps={{ min: 0, step: 0.01, 'data-testid': 'ap-amount' }}
                      error={overBalance || (!isCancelled && paidAmount !== '' && amount <= 0)}
                      helperText={overBalance ? `Exceeds the remaining advance ${fmtINR(balance)}`
                        : (!isCancelled && paidAmount !== '' && amount <= 0) ? 'Must be greater than zero'
                          : isFull ? 'Full payment clears the exact balance' : isCancelled ? 'No posting for cancelled entries' : `Max ${fmtINR(balance)}`} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField label="Payment Mode" select fullWidth disabled={notPayable} value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value)}>
                      {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{modeLabel(m)}</MenuItem>)}
                    </TextField>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField label="Transaction / UTR Reference" fullWidth value={referenceNumber} disabled={notPayable}
                      onChange={(e) => setReferenceNumber(e.target.value)} inputProps={{ 'data-testid': 'ap-utr' }}
                      placeholder="UTR123456789 / CHQ000123"
                      helperText="The same reference cannot be recorded twice for this PI" />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField label="Bank / Account Reference" fullWidth value={bankReference} disabled={notPayable}
                      onChange={(e) => setBankReference(e.target.value)} placeholder="e.g. HDFC current a/c ending 0123" />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField label={isShort ? 'Remarks * (required for short closure)' : 'Remarks'} fullWidth multiline minRows={2}
                      value={remarks} disabled={notPayable} onChange={(e) => setRemarks(e.target.value)}
                      placeholder={isShort ? 'e.g. Vendor agreed to close order with short receipt.' : ''}
                      error={isShort && !remarks.trim()} />
                  </Grid>
                  <Grid item xs={12}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Button component="label" variant="outlined" size="small" disabled={notPayable || uploading}
                        startIcon={uploading ? <CircularProgress size={14} /> : <Upload size={15} />}>
                        Payment Proof (optional)
                        <input hidden type="file" onChange={handleUpload} data-testid="ap-proof-input" />
                      </Button>
                      {proof?.fileUrl && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'success.main' }} data-testid="ap-proof-chip">
                          <FileCheck2 size={16} /><Typography variant="caption" fontWeight={600} noWrap sx={{ maxWidth: 200 }}>{proof.fileName || 'Uploaded'}</Typography>
                          <Tooltip title="Remove"><IconButton size="small" onClick={() => setProof(null)} aria-label="Remove proof"><X size={13} /></IconButton></Tooltip>
                        </Box>
                      )}
                    </Box>
                  </Grid>
                  {!notPayable && !isCancelled && mdStatus !== 'MD_APPROVED' && (
                    <Grid item xs={12}>
                      <Alert severity="warning" data-testid="ap-md-gate">
                        {mdStatus === 'READY_FOR_MD_APPROVAL'
                          ? 'Payment cannot be processed until the MD approves this Proforma Invoice.'
                          : 'This PI has no MD approval yet. Submitting sends it to the MD — no payment is recorded until the MD approves it.'}
                      </Alert>
                    </Grid>
                  )}
                </Grid>
              </>)}
            </Grid>

            <Grid item xs={12} md={5}>
              {pi && (
                <Box sx={{ position: { md: 'sticky' }, top: { md: 0 } }}>
                  <SectionTitle>Payment summary</SectionTitle>
                  <Box sx={panelSx} data-testid="ap-summary">
                    <SummaryRow label="Total Advance Required (PI value)" value={fmtINR(total)} testId="ap-sum-required" />
                    <SummaryRow label="Previously Paid" value={fmtINR(alreadyPaid)} color="#0f766e" testId="ap-sum-paid" />
                    <SummaryRow label="This Payment" value={fmtINR(isCancelled ? 0 : amount)} color="#1d4ed8" testId="ap-sum-current" />
                    <SummaryRow label="Remaining Balance" value={fmtINR(after)} color={after > 0 ? '#b45309' : '#0f766e'} strong testId="ap-sum-remaining" />
                    {!isCancelled && !notPayable && amount > 0 && (
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                        {after === 0 ? 'The PI will be marked PAYMENT COMPLETED.' : isShort ? 'The PI will be closed short.' : 'The advance stays open for further payments.'}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ mt: 2 }}>
                    <SectionTitle>Payment history ({history.length})</SectionTitle>
                    {history.length ? (
                      <Box sx={{ ...panelSx, p: 0.5 }}>
                        <PaymentHistoryTable rows={history} />
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', px: 1, py: 0.75, borderTop: `1px solid ${PFMS.line}` }}>
                          <Typography variant="body2" fontWeight={800}>Total paid</Typography>
                          <Typography variant="body2" fontWeight={800} sx={{ color: '#0f766e' }}>{fmtINR(alreadyPaid)}</Typography>
                        </Box>
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary" data-testid="ap-history-empty">No payment has been recorded against this advance yet.</Typography>
                    )}
                  </Box>
                </Box>
              )}
            </Grid>
          </Grid>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button variant="contained" startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          onClick={handleSubmit} disabled={isLoading || uploading || mdBlocked || !pi || notPayable} data-testid="ap-submit">
          Record Payment
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AdvancePaymentFormDialog;
