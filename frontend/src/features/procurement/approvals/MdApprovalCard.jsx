import React, { useState } from 'react';
import { Paper, Box, Typography, Button, CircularProgress } from '@mui/material';
import { ShieldCheck, Eye, PenTool } from 'lucide-react';
import { useGetApprovalQuery } from '../../../store/api/procurementApi';
import { ApprovalStatusChip, fmtDate, fmtTime } from './approvalMeta';
import SignDocumentDialog from './SignDocumentDialog';

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary', mb: 0.25 }}>{label}</Typography>
    <Typography component="div" sx={{ fontWeight: 600, color: 'text.primary' }}>{value ?? '—'}</Typography>
  </Box>
);

/**
 * Generic MD Digital Approval & Signature card — reused, unmodified, by GRN
 * Detail and Voucher Detail (and any future document type the approval
 * engine is attached to). Renders purely from (documentType, documentId).
 *
 * PDF viewing is delegated to the parent page's own existing PDF preview
 * dialog via `onPreviewPdf` — once signed, the approval engine repoints the
 * document's own pdf URL field at the signed PDF, so that existing dialog
 * (GrnPdfPreview / VoucherPdfPreview) shows the right version automatically
 * with no changes of its own. This is the "reuse the shared PDF Preview
 * component" requirement — no new PDF viewer is built here.
 *
 * `isMd` gates the Sign button as a UX courtesy only — the actual
 * enforcement is the backend's `requireApprovalRole('MD')` middleware.
 */
const MdApprovalCard = ({ documentType, documentId, documentTitle, isMd, onPreviewPdf, skip }) => {
  const [signOpen, setSignOpen] = useState(false);
  const { data, isFetching } = useGetApprovalQuery({ documentType, documentId }, { skip: skip || !documentId });
  const approval = data?.data;

  if (isFetching && !approval) {
    return (
      <Paper sx={{ p: 3, borderRadius: '18px', display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={22} />
      </Paper>
    );
  }
  if (!approval) return null; // not ready for MD approval yet — nothing to show

  const isApproved = approval.status === 'APPROVED';

  return (
    <Paper sx={{ p: 3, borderRadius: '18px' }}>
      <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}>
        <ShieldCheck size={18} /> MD Approval
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'flex-start', mb: 2 }}>
        <Field label="Status" value={<ApprovalStatusChip status={isApproved ? 'MD_APPROVED' : 'READY_FOR_MD_APPROVAL'} />} />
        <Field label="Signed By" value={isApproved ? (
          <>
            <Box>{approval.signedByName || '—'}</Box>
            <Box sx={{ fontSize: '0.78rem', fontWeight: 500, color: 'text.secondary' }}>{approval.designation}</Box>
          </>
        ) : '—'} />
        <Field label="Signed At" value={isApproved ? (
          <>
            <Box>{fmtDate(approval.signedAt)}</Box>
            <Box sx={{ fontSize: '0.78rem', fontWeight: 500, color: 'text.secondary' }}>{fmtTime(approval.signedAt)}</Box>
          </>
        ) : '—'} />
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" startIcon={<Eye size={14} />} onClick={onPreviewPdf} disabled={!onPreviewPdf}>
          {isApproved ? 'View Signed PDF' : 'Preview PDF'}
        </Button>
        {!isApproved && isMd && (
          <Button size="small" variant="contained" startIcon={<PenTool size={14} />} onClick={() => setSignOpen(true)}>
            Sign Document
          </Button>
        )}
      </Box>

      <SignDocumentDialog open={signOpen} documentType={documentType} documentId={documentId}
        documentTitle={documentTitle} onClose={() => setSignOpen(false)} />
    </Paper>
  );
};

export default MdApprovalCard;
