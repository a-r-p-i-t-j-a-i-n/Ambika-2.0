import React, { useState } from 'react';
import { Paper, Box, Typography, Button, CircularProgress } from '@mui/material';
import { ShieldCheck, Eye, PenTool } from 'lucide-react';
import { useGetApprovalQuery } from '../../../store/api/procurementApi';
import { ApprovalStatusChip, fmtDate, fmtTime } from './approvalMeta';
import SignDocumentDialog from './SignDocumentDialog';
import { PFMS, pfmsCardSx } from '../pfmsTheme';

// `dense` = the Indent/PO/GRN detail-page scale (0.68rem label / 0.86rem value).
const Field = ({ label, value, dense }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={dense
      ? { fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: PFMS.sub, mb: 0.4 }
      : { fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary', mb: 0.25 }}>{label}</Typography>
    <Typography component="div" sx={dense ? { fontSize: '0.86rem', fontWeight: 600, color: PFMS.ink } : { fontWeight: 600, color: 'text.primary' }}>{value ?? '—'}</Typography>
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
 *
 * `dense` (opt-in, Voucher panel only) uses the newer detail-page scale: p:2,
 * 0.92rem title, and the PDF/Sign buttons on the title row instead of a row
 * of their own, so the card is no taller than its content. Same data, same
 * buttons, same conditions either way.
 */
const MdApprovalCard = ({ documentType, documentId, documentTitle, isMd, onPreviewPdf, skip, dense = false }) => {
  const [signOpen, setSignOpen] = useState(false);
  const { data, isFetching } = useGetApprovalQuery({ documentType, documentId }, { skip: skip || !documentId });
  const approval = data?.data;
  const pad = dense ? 2 : 3;

  if (isFetching && !approval) {
    return (
      <Paper sx={{ ...pfmsCardSx, p: pad, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={22} />
      </Paper>
    );
  }
  if (!approval) return null; // not ready for MD approval yet — nothing to show

  const isApproved = approval.status === 'APPROVED';

  const title = (
    <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: dense ? 0 : 2, fontWeight: 700, color: 'primary.main', ...(dense && { fontSize: '0.92rem' }) }}>
      <ShieldCheck size={18} /> MD Approval
    </Typography>
  );
  const actions = (
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
  );

  return (
    <Paper sx={{ ...pfmsCardSx, p: pad }}>
      {dense ? (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
          {title}
          {actions}
        </Box>
      ) : title}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: dense ? 3 : 4, alignItems: 'flex-start', mb: dense ? 0 : 2 }}>
        <Field dense={dense} label="Status" value={<ApprovalStatusChip status={isApproved ? 'MD_APPROVED' : 'READY_FOR_MD_APPROVAL'} />} />
        <Field dense={dense} label="Signed By" value={isApproved ? (
          <>
            <Box>{approval.signedByName || '—'}</Box>
            <Box sx={{ fontSize: '0.78rem', fontWeight: 500, color: 'text.secondary' }}>{approval.designation}</Box>
          </>
        ) : '—'} />
        <Field dense={dense} label="Signed At" value={isApproved ? (
          <>
            <Box>{fmtDate(approval.signedAt)}</Box>
            <Box sx={{ fontSize: '0.78rem', fontWeight: 500, color: 'text.secondary' }}>{fmtTime(approval.signedAt)}</Box>
          </>
        ) : '—'} />
      </Box>
      {!dense && actions}

      <SignDocumentDialog open={signOpen} documentType={documentType} documentId={documentId}
        documentTitle={documentTitle} onClose={() => setSignOpen(false)} />
    </Paper>
  );
};

export default MdApprovalCard;
