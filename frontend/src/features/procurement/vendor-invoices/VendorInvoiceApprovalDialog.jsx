import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, IconButton, Tooltip,
  Box, Stack, Typography, CircularProgress, Chip, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  CheckCircle2, XCircle, X, Building2, ReceiptText, FileText, ExternalLink, Download, AlertTriangle, FileX2,
} from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useApproveVendorInvoiceMutation,
  useRejectVendorInvoiceMutation,
  useGetVendorInvoiceByIdQuery,
} from '../../../store/api/procurementApi';
import { resolveFileUrl } from '../../../utils/fileUrl';
import { fmtINR, fmtDate, InvoiceStatusChip } from './invoiceMeta';

/**
 * Review and approve / reject a vendor invoice (Step 1.10).
 * Everything the approver needs on one screen: the vendor, what the invoice is
 * linked to, its items and amounts on the left, the vendor's own invoice (the
 * uploaded PDF / photo) on the right, the decision at the bottom. Approval
 * needs that document — the server refuses it otherwise.
 */

const LINE = '#e2e8f0';
const INK = '#0f172a';
const SUB = '#64748b';
const BLUE = '#1d4ed8';

const qty = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const listOf = (many, one) => (many?.length ? many : [one]).filter(Boolean);
const hasFile = (doc) => Boolean(doc?.fileUrl);
const isImage = (doc) => /^image\//i.test(doc?.fileType || '')
  || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(String(doc?.fileName || doc?.fileUrl || '').split('?')[0]);

const Fact = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: SUB, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</Typography>
    <Typography component="div" sx={{ fontSize: '0.84rem', fontWeight: 700, color: INK, wordBreak: 'break-word' }}>{value || '—'}</Typography>
  </Box>
);

const Section = ({ title, children }) => (
  <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: '#fff', border: `1px solid ${LINE}` }}>
    <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: INK, mb: 1.25 }}>{title}</Typography>
    {children}
  </Box>
);

const Amount = ({ label, value, strong, minus }) => (
  <Stack direction="row" justifyContent="space-between" alignItems="baseline">
    <Typography sx={{ fontSize: strong ? '0.86rem' : '0.78rem', fontWeight: strong ? 800 : 500, color: strong ? INK : SUB }}>{label}</Typography>
    <Typography sx={{ fontSize: strong ? '0.86rem' : '0.78rem', fontWeight: 700, color: INK }}>{minus ? '− ' : ''}{fmtINR(value)}</Typography>
  </Stack>
);

const ItemRow = ({ it, first, showGrn }) => {
  // Billing more than QC ever accepted is the one thing worth stopping on.
  const excess = Number(it.invoiceQty || 0) > Number(it.acceptedQty || 0);
  return (
    <Box sx={{ py: 1.1, borderTop: first ? 'none' : `1px solid ${LINE}` }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: INK, lineHeight: 1.35 }}>{it.itemName || '—'}</Typography>
          <Typography sx={{ fontSize: '0.72rem', color: SUB }}>
            {[it.skuCode && `SKU ${it.skuCode}`, it.batchNo && `Batch ${it.batchNo}`, showGrn && it.grnNumber && `GRN ${it.grnNumber}`].filter(Boolean).join(' · ')}
          </Typography>
          <Typography sx={{ fontSize: '0.76rem', color: '#334155', mt: 0.25 }}>
            {qty(it.invoiceQty)} {it.unit} × {fmtINR(it.rate)} · GST {it.gstRate || 0}%
            <Typography component="span" sx={{ fontSize: '0.72rem', color: SUB }}> · QC accepted {qty(it.acceptedQty)}</Typography>
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.86rem', fontWeight: 800, color: INK, whiteSpace: 'nowrap' }}>{fmtINR(it.totalAmount)}</Typography>
      </Stack>
      {excess && (
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.75, px: 1, py: 0.5, borderRadius: 1.5, bgcolor: '#fff7e6', color: '#b45309' }}>
          <AlertTriangle size={13} style={{ flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: 'inherit' }}>
            Billed {qty(it.invoiceQty)}, but QC accepted only {qty(it.acceptedQty)} — {qty(Number(it.invoiceQty) - Number(it.acceptedQty))} more
          </Typography>
        </Stack>
      )}
      {it.remarks && <Typography sx={{ mt: 0.5, fontSize: '0.72rem', color: '#334155', fontStyle: 'italic' }}>Note: {it.remarks}</Typography>}
    </Box>
  );
};

const ApprovalForm = ({ invoice: given, onClose }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [remarks, setRemarks] = useState('');
  const [showing, setShowing] = useState('INVOICE');
  // The full invoice (a list row may carry less).
  const { data, isLoading } = useGetVendorInvoiceByIdQuery(given._id);
  const inv = data?.data || given;
  const [approveInv, { isLoading: approving }] = useApproveVendorInvoiceMutation();
  const [rejectInv, { isLoading: rejecting }] = useRejectVendorInvoiceMutation();
  const busy = approving || rejecting;

  const items = inv.items || [];
  const grns = listOf(inv.grnNumbers, inv.grnNumber);
  const qcs = listOf(inv.qcNumbers, inv.qcNumber);
  const hasInvoiceDoc = hasFile(inv.invoiceDocument);
  const hasDebitDoc = inv.debitNoteRequired && hasFile(inv.debitNoteDocument);
  const doc = showing === 'DEBIT_NOTE' && hasDebitDoc ? inv.debitNoteDocument : inv.invoiceDocument;
  const docUrl = hasFile(doc) ? resolveFileUrl(doc) : '';
  const docLabel = showing === 'DEBIT_NOTE' && hasDebitDoc ? 'Debit note' : "Vendor's invoice";

  const decide = async (kind) => {
    const fn = kind === 'approve' ? approveInv : rejectInv;
    try {
      await fn({ id: inv._id, remarks: remarks.trim() }).unwrap();
      enqueueSnackbar(kind === 'approve' ? 'Invoice approved — payment pending' : 'Invoice rejected', { variant: kind === 'approve' ? 'success' : 'info' });
      onClose(true);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed', { variant: 'error' }); }
  };

  return (
    <>
      <DialogTitle component="div" sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.25, borderBottom: `1px solid ${LINE}` }}>
        <Box sx={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: alpha(BLUE, 0.1), color: BLUE, flexShrink: 0 }}>
          <ReceiptText size={18} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: INK }}>Review &amp; Approve Vendor Invoice</Typography>
            {inv.invoiceNumber && <Chip size="small" label={inv.invoiceNumber} sx={{ height: 22, fontWeight: 700, bgcolor: alpha(BLUE, 0.08), color: BLUE }} />}
            {inv.invoiceStatus && <InvoiceStatusChip status={inv.invoiceStatus} />}
          </Stack>
          <Typography sx={{ fontSize: '0.74rem', color: SUB }}>Step 1.10 · Check the details and the vendor&apos;s invoice, then approve or reject</Typography>
        </Box>
        <IconButton size="small" onClick={() => onClose(false)} disabled={busy}><X size={18} /></IconButton>
      </DialogTitle>

      <DialogContent sx={{
        p: 0, display: 'grid', overflow: { xs: 'auto', md: 'hidden' },
        gridTemplateColumns: { xs: '1fr', md: '400px minmax(0, 1fr)', lg: '440px minmax(0, 1fr)' },
        gridTemplateRows: { md: 'minmax(0, 1fr)' },
      }}>
        {/* Details */}
        <Stack spacing={1.5} sx={{ p: 2, bgcolor: '#f8fafc', overflowY: { md: 'auto' }, borderRight: { md: `1px solid ${LINE}` } }}>
          <Section title="Vendor">
            <Stack direction="row" spacing={1.25} alignItems="flex-start">
              <Building2 size={18} color={BLUE} style={{ flexShrink: 0, marginTop: 2 }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', color: INK }}>{inv.vendorName || '—'}</Typography>
                <Typography sx={{ fontSize: '0.74rem', color: SUB }}>{inv.vendorGST ? `GST ${inv.vendorGST}` : 'GST not on file'}</Typography>
                {inv.vendorAddress && <Typography sx={{ fontSize: '0.74rem', color: SUB }}>{inv.vendorAddress}</Typography>}
              </Box>
            </Stack>
          </Section>

          <Section title="Invoice details">
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <Fact label="Vendor Invoice No" value={inv.invoiceNumber} />
              <Fact label="Invoice Date" value={inv.invoiceDate ? fmtDate(inv.invoiceDate) : ''} />
              <Fact label="Received On" value={inv.invoiceReceivedDate ? fmtDate(inv.invoiceReceivedDate) : ''} />
              <Fact label="PO" value={inv.poNumber} />
              <Fact label={grns.length > 1 ? `GRNs (${grns.length})` : 'GRN'} value={grns.join(', ')} />
              <Fact label={qcs.length > 1 ? `QCs (${qcs.length})` : 'QC'} value={qcs.join(', ')} />
              {inv.piNumber && <Fact label="PI" value={inv.piNumber} />}
              {Number(inv.tdsAmount) > 0 && <Fact label="TDS" value={fmtINR(inv.tdsAmount)} />}
              {Number(inv.otherCharges) !== 0 && <Fact label="Other Charges" value={fmtINR(inv.otherCharges)} />}
            </Box>
          </Section>

          <Section title={`Items (${items.length})`}>
            {isLoading && !items.length
              ? <CircularProgress size={18} />
              : items.map((it, i) => <ItemRow key={it._id || i} it={it} first={i === 0} showGrn={grns.length > 1} />)}
            <Box sx={{ mt: 1, pt: 1, borderTop: `1px dashed ${LINE}` }}>
              <Amount label="Taxable value" value={inv.taxableAmount} />
              <Amount label="GST" value={inv.gstAmount} />
              <Amount label="Invoice amount" value={inv.invoiceAmount} strong />
              {inv.debitNoteRequired && Number(inv.debitNoteAmount) > 0 && <Amount label="Debit note" value={inv.debitNoteAmount} minus />}
              {Number(inv.advancePaid) > 0 && <Amount label="Advance already paid" value={inv.advancePaid} minus />}
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.75, pt: 0.75, borderTop: `1px solid ${LINE}` }}>
                <Typography sx={{ fontSize: '0.86rem', fontWeight: 800, color: INK }}>Net payable</Typography>
                <Typography data-testid="vi-approve-net" sx={{ fontSize: '1.05rem', fontWeight: 800, color: BLUE }}>{fmtINR(inv.netPayableAmount)}</Typography>
              </Stack>
            </Box>
          </Section>

          {inv.debitNoteRequired && (
            <Section title="Debit note">
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <Fact label="Debit Note No" value={inv.debitNoteNumber} />
                <Fact label="Amount" value={fmtINR(inv.debitNoteAmount)} />
                <Box sx={{ gridColumn: '1 / -1' }}><Fact label="Reason" value={inv.debitNoteReason} /></Box>
              </Box>
            </Section>
          )}

          {inv.remarks && (
            <Section title="Remarks on the invoice">
              <Typography sx={{ fontSize: '0.8rem', color: '#334155', whiteSpace: 'pre-wrap' }}>{inv.remarks}</Typography>
            </Section>
          )}
        </Stack>

        {/* The uploaded document */}
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: { xs: '70vh', md: 0 }, bgcolor: '#eef2f7' }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1, bgcolor: '#fff', borderBottom: `1px solid ${LINE}` }}>
            <FileText size={16} color="#dc2626" style={{ flexShrink: 0 }} />
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.82rem', fontWeight: 800, color: INK }} noWrap>
              {docLabel}
              {hasFile(doc) && <Typography component="span" sx={{ fontSize: '0.74rem', color: SUB, fontWeight: 600 }}> · {doc.fileName || 'uploaded file'}</Typography>}
            </Typography>
            {hasDebitDoc && (
              <ToggleButtonGroup size="small" exclusive value={showing} onChange={(_e, v) => v && setShowing(v)}
                sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1, fontSize: '0.72rem', fontWeight: 700, textTransform: 'none' } }}>
                <ToggleButton value="INVOICE">Invoice</ToggleButton>
                <ToggleButton value="DEBIT_NOTE">Debit note</ToggleButton>
              </ToggleButtonGroup>
            )}
            <Tooltip title="Open in a new tab">
              <span><IconButton size="small" href={docUrl || undefined} target="_blank" rel="noopener" disabled={!docUrl}><ExternalLink size={16} /></IconButton></span>
            </Tooltip>
            <Tooltip title="Download">
              <span><IconButton size="small" href={docUrl || undefined} download={doc?.fileName || true} disabled={!docUrl}><Download size={16} /></IconButton></span>
            </Tooltip>
          </Stack>
          <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {!docUrl ? (
              <Box sx={{ flexGrow: 1, display: 'grid', placeItems: 'center', p: 3, textAlign: 'center' }}>
                <Box>
                  <FileX2 size={34} color="#94a3b8" />
                  <Typography sx={{ mt: 1, fontSize: '0.9rem', fontWeight: 800, color: INK }}>No invoice document uploaded</Typography>
                  <Typography sx={{ fontSize: '0.8rem', color: SUB, maxWidth: 380 }}>
                    Approval needs the vendor&apos;s invoice. Close this, use <b>Edit Invoice</b> to upload the PDF or photo, then approve.
                  </Typography>
                </Box>
              </Box>
            ) : isImage(doc) ? (
              // The whole photo, scaled to fit the pane; click it for full size.
              <Box component="a" href={docUrl} target="_blank" rel="noopener" title="Open full size in a new tab"
                sx={{ flexGrow: 1, position: 'relative', minHeight: 0, cursor: 'zoom-in' }}>
                <Box component="img" src={docUrl} alt={docLabel}
                  sx={{ position: 'absolute', top: 16, left: 16, width: 'calc(100% - 32px)', height: 'calc(100% - 32px)', objectFit: 'contain' }} />
              </Box>
            ) : (
              <iframe title={docLabel} src={docUrl} style={{ border: 0, width: '100%', flexGrow: 1, background: '#fff' }} />
            )}
          </Box>
          {docUrl && (
            <Typography sx={{ px: 2, py: 0.75, fontSize: '0.72rem', color: SUB, bgcolor: '#fff', borderTop: `1px solid ${LINE}` }}>
              Not showing here? <Box component="a" href={docUrl} target="_blank" rel="noopener" sx={{ color: BLUE, fontWeight: 700 }}>Open it in a new tab</Box>
            </Typography>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.5, gap: 1, borderTop: `1px solid ${LINE}`, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
        <TextField size="small" value={remarks} onChange={(e) => setRemarks(e.target.value)}
          placeholder="Note with your decision (optional) — e.g. why it is rejected"
          sx={{ flex: 1, minWidth: { xs: '100%', sm: 240 }, mr: 1 }} inputProps={{ maxLength: 1000 }} />
        <Button onClick={() => onClose(false)} disabled={busy} sx={{ fontWeight: 700 }}>Cancel</Button>
        <Button color="error" variant="outlined" startIcon={rejecting ? <CircularProgress size={16} color="inherit" /> : <XCircle size={16} />}
          onClick={() => decide('reject')} disabled={busy} sx={{ fontWeight: 700 }}>
          Reject
        </Button>
        <Tooltip title={hasInvoiceDoc ? '' : "Upload the vendor's invoice first (Edit Invoice)"}>
          <span>
            <Button color="success" variant="contained" disableElevation
              startIcon={approving ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />}
              onClick={() => decide('approve')} disabled={busy || !hasInvoiceDoc} sx={{ fontWeight: 800, px: 2.5 }}>
              Approve
            </Button>
          </span>
        </Tooltip>
      </DialogActions>
    </>
  );
};

// The form lives inside the Dialog, so it starts fresh each time the dialog opens.
const VendorInvoiceApprovalDialog = ({ open, onClose, invoice }) => (
  <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="xl" fullWidth
    PaperProps={{ sx: { height: { xs: '100%', md: '92vh' }, maxHeight: { xs: '100%', md: '92vh' }, m: { xs: 0, md: 4 }, borderRadius: { xs: 0, md: 3 }, maxWidth: 1280 } }}>
    {invoice ? <ApprovalForm invoice={invoice} onClose={(done) => onClose?.(done)} /> : null}
  </Dialog>
);

export default VendorInvoiceApprovalDialog;
