import React, { useState } from 'react';
import {
  Drawer, Box, Typography, IconButton, Button, Divider, Alert, CircularProgress, Grid,
  Table, TableHead, TableBody, TableRow, TableCell,
} from '@mui/material';
import { X, ExternalLink, Eye, CheckCircle2, ShieldCheck, Wallet, History } from 'lucide-react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  useGetApprovalQuery, useGetGrnByIdQuery, useGetVoucherByIdQuery, useGetProformaInvoiceByIdQuery,
} from '../../../store/api/procurementApi';
import SignDocumentDialog from './SignDocumentDialog';
import PdfViewerModal from '../common/PdfViewerModal';
import { fmtDate, fmtTime } from './approvalMeta';
import { isMdUser, fmtINR } from './mdApprovalMeta';
import MdViewStatusChip from './MdViewStatusChip';
import { expenseTypeOf, expenseTypeMeta } from '../vouchers/voucherMeta';
import { PFMS, pfmsTableHeadSx } from '../pfmsTheme';

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', color: PFMS.sub, mb: 0.25 }}>{label}</Typography>
    <Typography component="div" sx={{ fontSize: '0.85rem', fontWeight: 600, color: PFMS.ink, wordBreak: 'break-word' }}>{value || '—'}</Typography>
  </Box>
);

const Section = ({ title, children }) => (
  <Box sx={{ mt: 2.5 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: PFMS.sub, mb: 1 }}>{title}</Typography>
    {children}
  </Box>
);

const HISTORY_LABEL = { SIGNED: 'Approved & signed', SIGNATURE_REPLACED: 'Signature replaced', SIGNATURE_REMOVED: 'Signature removed' };

/** GRN content: references + received lines. */
const GrnContent = ({ id }) => {
  const { data, isLoading } = useGetGrnByIdQuery(id, { skip: !id });
  const g = data?.data;
  if (isLoading) return <CircularProgress size={18} />;
  if (!g) return null;
  const items = (g.items || []).filter((it) => Number(it.receivedQty) > 0);
  return (
    <>
      <Grid container spacing={2}>
        <Grid item xs={6}><Field label="PO" value={(g.poNumbers?.length ? g.poNumbers : [g.poNumber]).filter(Boolean).join(', ')} /></Grid>
        <Grid item xs={6}><Field label="Vendor Invoice / Challan" value={g.invoiceNumber} /></Grid>
        <Grid item xs={6}><Field label="GRN Status" value={String(g.grnStatus || '').replace(/_/g, ' ')} /></Grid>
        <Grid item xs={6}><Field label="QC Status" value={g.qcStatus} /></Grid>
      </Grid>
      {items.length > 0 && (
        <Box sx={{ mt: 1.5, overflowX: 'auto', border: `1px solid ${PFMS.line}`, borderRadius: '8px' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={pfmsTableHeadSx}>Item</TableCell>
                <TableCell sx={pfmsTableHeadSx} align="right">Received</TableCell>
                <TableCell sx={pfmsTableHeadSx} align="right">Rate</TableCell>
                <TableCell sx={pfmsTableHeadSx} align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((it, i) => (
                <TableRow key={it._id || i}>
                  <TableCell sx={{ fontSize: '0.78rem' }}>{it.itemName}</TableCell>
                  <TableCell sx={{ fontSize: '0.78rem' }} align="right">{it.receivedQty} {it.unit}</TableCell>
                  <TableCell sx={{ fontSize: '0.78rem' }} align="right">{fmtINR(it.rate)}</TableCell>
                  <TableCell sx={{ fontSize: '0.78rem', fontWeight: 700 }} align="right">{fmtINR(it.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </>
  );
};

/** Voucher content: references + the payable breakdown and payment progress. */
const VoucherContent = ({ id }) => {
  const { data, isLoading } = useGetVoucherByIdQuery(id, { skip: !id });
  const v = data?.data;
  if (isLoading) return <CircularProgress size={18} />;
  if (!v) return null;
  const expense = v.voucherType === 'EXPENSE';
  return (
    <Grid container spacing={2}>
      {expense ? (
        <>
          <Grid item xs={6}><Field label="Expense Type" value={expenseTypeMeta(expenseTypeOf(v)).label} /></Grid>
          <Grid item xs={6}><Field label="Against" value={[v.poNumber, ...(v.grnNumbers || [])].filter(Boolean).join(' · ') || 'Without PO / GRN'} /></Grid>
          <Grid item xs={6}><Field label="Expense Category" value={v.expenseCategory} /></Grid>
          <Grid item xs={6}><Field label="Bill No." value={v.expenseInvoiceNo} /></Grid>
        </>
      ) : (
        <>
          <Grid item xs={6}><Field label="Vendor Invoice" value={v.invoiceNumber} /></Grid>
          <Grid item xs={6}><Field label="PO / GRN" value={[v.poNumber, ...(v.grnNumbers || [])].filter(Boolean).join(' · ')} /></Grid>
          <Grid item xs={4}><Field label="Invoice Amount" value={fmtINR(v.invoiceAmount)} /></Grid>
          <Grid item xs={4}><Field label="Advance" value={fmtINR(v.advancePaid)} /></Grid>
          <Grid item xs={4}><Field label="Debit Note" value={fmtINR(v.debitNoteAmount)} /></Grid>
        </>
      )}
      <Grid item xs={4}><Field label="Net Payable" value={fmtINR(v.netPayableAmount)} /></Grid>
      <Grid item xs={4}><Field label="Paid" value={fmtINR(v.paidAmount)} /></Grid>
      <Grid item xs={4}><Field label="Balance" value={fmtINR(v.balanceAmount)} /></Grid>
      <Grid item xs={6}><Field label="Tally Entry" value={v.tallyEntryStatus} /></Grid>
      <Grid item xs={6}><Field label="Payment Terms / Due" value={[v.paymentTerms, v.dueDate ? fmtDate(v.dueDate) : ''].filter(Boolean).join(' · ')} /></Grid>
    </Grid>
  );
};

/** Proforma Invoice content (advance payment): references, lines, advance progress, the vendor's PI. */
const PiContent = ({ id, onOpenPdf }) => {
  const { data, isLoading } = useGetProformaInvoiceByIdQuery(id, { skip: !id });
  const pi = data?.data;
  if (isLoading) return <CircularProgress size={18} />;
  if (!pi) return null;
  return (
    <>
      <Grid container spacing={2}>
        <Grid item xs={6}><Field label="PO / Indent" value={[pi.poNumber, pi.indentNumber].filter(Boolean).join(' · ')} /></Grid>
        <Grid item xs={6}><Field label="PI Approved By" value={pi.approvedBy ? `${pi.approvedBy} · ${fmtDate(pi.approvedAt)}` : ''} /></Grid>
        <Grid item xs={4}><Field label="PI Total" value={fmtINR(pi.totalValue)} /></Grid>
        <Grid item xs={4}><Field label="Advance Paid" value={fmtINR(pi.paidAmount)} /></Grid>
        <Grid item xs={4}><Field label="Balance" value={fmtINR(pi.balanceAmount)} /></Grid>
      </Grid>
      {(pi.items || []).length > 0 && (
        <Box sx={{ mt: 1.5, overflowX: 'auto', border: `1px solid ${PFMS.line}`, borderRadius: '8px' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={pfmsTableHeadSx}>Item</TableCell>
                <TableCell sx={pfmsTableHeadSx} align="right">Qty</TableCell>
                <TableCell sx={pfmsTableHeadSx} align="right">Rate</TableCell>
                <TableCell sx={pfmsTableHeadSx} align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pi.items.map((it, i) => (
                <TableRow key={it._id || i}>
                  <TableCell sx={{ fontSize: '0.78rem' }}>{it.itemName}</TableCell>
                  <TableCell sx={{ fontSize: '0.78rem' }} align="right">{it.quantity} {it.unit}</TableCell>
                  <TableCell sx={{ fontSize: '0.78rem' }} align="right">{fmtINR(it.rate)}</TableCell>
                  <TableCell sx={{ fontSize: '0.78rem', fontWeight: 700 }} align="right">{fmtINR(it.lineAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      {pi.piDocument?.fileUrl && (
        <Button size="small" variant="text" startIcon={<Eye size={14} />} sx={{ mt: 1 }}
          onClick={() => onOpenPdf({ url: pi.piDocument.fileUrl, title: `${pi.piNumber} — vendor PI document` })}>
          Vendor PI document
        </Button>
      )}
    </>
  );
};

/**
 * One MD approval in full — the document's details, its workflow position,
 * the approval audit trail, the PDF, and (for the MD, while pending) Approve.
 * Approve reuses the existing SignDocumentDialog → POST /approvals/:type/:id/sign,
 * which the server restricts to MD users.
 */
const MdApprovalDetailDrawer = ({ row, onClose }) => {
  const navigate = useNavigate();
  const isMd = useSelector((s) => isMdUser(s.auth.user));
  const [signOpen, setSignOpen] = useState(false);
  const [pdf, setPdf] = useState(null);
  const open = Boolean(row);

  const { data: apRes, isFetching: apLoading } = useGetApprovalQuery(
    { documentType: row?.documentType, documentId: row?.documentId },
    { skip: !open },
  );
  const approval = apRes?.data;
  const signed = approval ? approval.status === 'APPROVED' : row?.engineStatus === 'APPROVED';
  const pending = !signed;
  const pdfUrl = signed ? (approval?.signedPdfUrl || row?.signedPdfUrl) : (approval?.unsignedPdfUrl || row?.unsignedPdfUrl);

  return (
    <Drawer anchor="right" open={open} onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 580 }, bgcolor: PFMS.surface } }}>
      {row && (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }} data-testid="md-approval-drawer">
          {/* Header */}
          <Box sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'flex-start', gap: 1.5, borderBottom: `1px solid ${PFMS.line}` }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: PFMS.sub }}>{row.documentLabel} · {row.module}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.25 }}>
                <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: PFMS.ink }}>{row.documentNumber}</Typography>
                <MdViewStatusChip status={pending ? 'PENDING' : row.approvalStatus === 'PENDING' ? 'APPROVED' : row.approvalStatus} />
              </Box>
            </Box>
            <IconButton onClick={onClose} aria-label="Close"><X size={18} /></IconButton>
          </Box>

          {/* Body */}
          <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, pb: 2.5 }}>
            <Box sx={{ mt: 2 }}>
              {row.gatesPayment ? (
                pending ? (
                  <Alert severity="warning" icon={<Wallet size={18} />}>
                    {row.documentType === 'PROFORMA_INVOICE'
                      ? 'The advance payment against this PI is on hold until you approve it. Every other step continues meanwhile.'
                      : 'Payment for this voucher is on hold until you approve it. Every other step (Tally Entry etc.) continues meanwhile.'}
                  </Alert>
                ) : (
                  <Alert severity="success" icon={<Wallet size={18} />}>MD approved — payment can be processed.</Alert>
                )
              ) : (
                <Alert severity="info" icon={<ShieldCheck size={18} />}>
                  This approval is recorded for audit only — the {row.module} workflow is not held back while it is pending.
                </Alert>
              )}
            </Box>

            <Section title="Summary">
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}><Field label="Vendor" value={row.vendorName} /></Grid>
                <Grid item xs={6} sm={3}><Field label="Amount" value={fmtINR(row.amount)} /></Grid>
                <Grid item xs={6} sm={3}><Field label="Document Date" value={fmtDate(row.documentDate)} /></Grid>
                <Grid item xs={6} sm={6}><Field label="Requested By" value={row.requestedByName} /></Grid>
                <Grid item xs={6} sm={6}><Field label="Requested On" value={`${fmtDate(row.requestedAt)} ${fmtTime(row.requestedAt)}`} /></Grid>
                <Grid item xs={6} sm={6}><Field label="Workflow Status" value={row.workflowLabel} /></Grid>
                <Grid item xs={6} sm={6}>
                  <Field label="Approved By" value={signed ? `${approval?.signedByName || row.signedByName || '—'} · ${fmtDate(approval?.signedAt || row.signedAt)}` : 'Awaiting MD'} />
                </Grid>
              </Grid>
            </Section>

            <Section title="Document Details">
              {row.documentType === 'GRN' && <GrnContent id={row.documentId} />}
              {row.documentType === 'VOUCHER' && <VoucherContent id={row.documentId} />}
              {row.documentType === 'PROFORMA_INVOICE' && <PiContent id={row.documentId} onOpenPdf={setPdf} />}
            </Section>

            <Section title="Approval History">
              {apLoading && !approval ? <CircularProgress size={18} /> : (approval?.history?.length ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {[...approval.history].reverse().map((h, i) => (
                    <Box key={i} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
                      <Box sx={{ mt: 0.25, color: PFMS.sub }}><History size={14} /></Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>{HISTORY_LABEL[h.action] || h.action} — {h.actorName || '—'}</Typography>
                        <Typography sx={{ fontSize: '0.72rem', color: PFMS.sub }}>
                          {fmtDate(h.timestamp)} {fmtTime(h.timestamp)}{h.reason ? ` · ${h.reason}` : ''}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Typography sx={{ fontSize: '0.8rem', color: PFMS.sub }}>
                  Raised for MD approval on {fmtDate(row.requestedAt)} by {row.requestedByName || '—'}. No MD action yet.
                </Typography>
              ))}
            </Section>
          </Box>

          {/* Actions */}
          <Divider />
          <Box sx={{ px: 2.5, py: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button size="small" variant="text" startIcon={<ExternalLink size={15} />} onClick={() => navigate(row.detailPath)}>
              Open full document
            </Button>
            <Button size="small" variant="outlined" startIcon={<Eye size={15} />} disabled={!pdfUrl}
              onClick={() => setPdf({ url: pdfUrl, title: `${row.documentNumber}${signed ? ' — signed' : ''}` })}>
              {signed ? 'View Signed PDF' : 'View PDF'}
            </Button>
            {pending && isMd && (
              <Button size="small" variant="contained" color="success" startIcon={<CheckCircle2 size={15} />}
                data-testid="md-approve" onClick={() => setSignOpen(true)}>
                Approve
              </Button>
            )}
          </Box>

          <SignDocumentDialog open={signOpen} documentType={row.documentType} documentId={row.documentId}
            documentTitle={row.documentNumber} onClose={() => setSignOpen(false)} />
          <PdfViewerModal open={Boolean(pdf)} url={pdf?.url} title={pdf?.title} onClose={() => setPdf(null)} />
        </Box>
      )}
    </Drawer>
  );
};

export default MdApprovalDetailDrawer;
