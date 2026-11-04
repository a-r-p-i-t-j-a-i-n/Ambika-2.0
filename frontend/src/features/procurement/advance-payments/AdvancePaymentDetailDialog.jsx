import React from 'react';
import { Box, Typography, Button, Alert, CircularProgress } from '@mui/material';
import { FileText, Download, Paperclip } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetAdvancePaymentDetailQuery } from '../../../store/api/procurementApi';
import RowQuickViewDialog from '../common/RowQuickViewDialog';
import StatusChip from '../components/StatusChip';
import { stepTimingText } from '../components/stepTimingColumns';
import { fileHref } from '../indents/indentMeta';
import { PFMS } from '../pfmsTheme';
import { PaymentStatusChip, modeLabel, fmtINR, fmtDate } from './apMeta';
import { PaymentHistoryTable } from './AdvancePaymentFormDialog';

/**
 * Eye view of one advance payment: PO / PI / vendor, the advance figures, every
 * payment on the same PI (this one highlighted), approval details, attachment
 * and remarks, with Preview / Download PDF. Data: GET /advance-payments/:id/detail.
 */
const Heading = ({ children }) => (
  <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: PFMS.faint, mt: 2, mb: 1 }}>{children}</Typography>
);

const AdvancePaymentDetailDialog = ({ row, onClose, pdf }) => {
  const navigate = useNavigate();
  const { data, isFetching, isError, error, refetch } = useGetAdvancePaymentDetailQuery(row?._id, { skip: !row?._id });
  const d = data?.data;
  const p = d?.payment || row || {};
  const pi = d?.pi || {};
  const po = d?.po || {};
  const sum = d?.summary;
  const md = d?.mdApproval;
  const timing = stepTimingText(row || {});

  const fields = row ? [
    { label: 'PO Number', value: p.poNumber },
    { label: 'PO Approval', value: po.approvalStatus ? <StatusChip status={po.approvalStatus} /> : '—' },
    { label: 'PI Number', value: p.piNumber },
    { label: 'PI Approval', value: pi.approvalStatus ? <StatusChip status={pi.approvalStatus} /> : '—' },
    { label: 'Indent Number', value: p.indentNumber },
    { label: 'Vendor', value: p.vendorName },
    { label: 'Vendor GSTIN', value: pi.vendorGST },
    { label: 'Vendor Address', value: pi.vendorAddress, span: 2 },
    { label: 'Payment Date', value: fmtDate(p.paymentDate) },
    { label: 'Payment Amount', value: fmtINR(p.paidAmount) },
    { label: 'Payment Mode', value: modeLabel(p.paymentMode) },
    { label: 'Transaction / UTR', value: p.paymentReferenceNumber },
    { label: 'Bank / Account Ref', value: p.bankReference },
    { label: 'Recorded By', value: p.performedByName },
    { label: 'MD Approval', value: md?.status === 'APPROVED'
      ? `Approved by ${md.signedByName || '—'}${md.signedAt ? ` on ${fmtDate(md.signedAt)}` : ''}`
      : (pi.mdApprovalStatus === 'READY_FOR_MD_APPROVAL' ? 'Waiting for the MD' : (pi.mdApprovalStatus === 'MD_APPROVED' ? 'MD approved' : 'Not raised')) },
    { label: 'PI Approved', value: pi.approvedAt ? `${pi.approvedBy || '—'} · ${fmtDate(pi.approvedAt)}` : '' },
    { label: 'Planned Date', value: timing.planned },
    { label: 'Actual Date & Time', value: timing.actual },
    { label: 'Assigned Doer', value: timing.doer },
    { label: 'Remarks', value: p.remarks, span: 2 },
  ] : [];

  return (
    <RowQuickViewDialog open={Boolean(row)} onClose={onClose}
      title="Advance Payment" number={p.paymentNumber}
      status={row ? <PaymentStatusChip status={p.paymentStatus} /> : null}
      subtitle={p.vendorName}
      fields={fields}
      openFullLabel="Open PI" onOpenFull={p.piId ? () => navigate(`/procurement/proforma-invoices/${p.piId}`) : undefined}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2 }}>
        <Button variant="outlined" size="small" startIcon={<FileText size={15} />} onClick={() => pdf.preview(p)} data-testid="ap-detail-preview">Preview PDF</Button>
        <Button variant="outlined" size="small" startIcon={<Download size={15} />} onClick={() => pdf.download(p)} data-testid="ap-detail-download">Download PDF</Button>
        {p.proofDocument?.fileUrl && (
          <Button variant="outlined" size="small" startIcon={<Paperclip size={15} />} component="a" href={fileHref(p.proofDocument.fileUrl)} target="_blank" rel="noopener">
            Payment proof
          </Button>
        )}
      </Box>

      <Heading>Advance position (whole PI)</Heading>
      {isError ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={refetch}>Retry</Button>}>
          {error?.data?.message || 'Could not load the payment details'}
        </Alert>
      ) : !d ? (
        <Box sx={{ py: 2, display: 'grid', placeItems: 'center' }}><CircularProgress size={22} /></Box>
      ) : (<>
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, p: 1.5, borderRadius: '8px', bgcolor: PFMS.surfaceAlt, border: `1px solid ${PFMS.line}` }} data-testid="ap-detail-summary">
          {[
            ['Advance Required', fmtINR(sum?.advanceRequired), undefined],
            ['Total Paid', fmtINR(sum?.totalPaid), '#0f766e'],
            ['Remaining Balance', fmtINR(sum?.remaining), (sum?.remaining || 0) > 0 ? '#b45309' : '#0f766e'],
          ].map(([l, v, c]) => (
            <Box key={l}>
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: 'uppercase' }}>{l}</Typography>
              <Typography variant="body2" fontWeight={800} sx={{ color: c, fontVariantNumeric: 'tabular-nums' }}>{v}</Typography>
            </Box>
          ))}
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: 'uppercase' }}>Payment Status</Typography>
            <Box><StatusChip status={sum?.state} /></Box>
          </Box>
        </Box>
        <Heading>All payments on this PI ({d.history.length})</Heading>
        <PaymentHistoryTable rows={d.history} highlightId={p._id} />
      </>)}
      {isFetching && d && <Typography variant="caption" color="text.secondary">Refreshing…</Typography>}
    </RowQuickViewDialog>
  );
};

export default AdvancePaymentDetailDialog;
