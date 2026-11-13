import React, { useEffect, useState } from 'react';
import { Box, Typography, TextField, Alert } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ClipboardCheck, FileText, MessageSquareText } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { fileHref } from '../indents/indentMeta';
import { lineBalanced, legacyLineDetail, round2 } from './qcForm';
import { frozenRule, frozenStockText } from '../../../utils/unitConversion';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import {
  FormSection, LabeledField, FormTableHead, CellCaption, AttachmentDrop, RemarksField,
} from '../components/PfmsFormDialog';
import { useElementWidth } from '../components/useElementWidth';
import { PFMS, pfmsNoSpinSx } from '../pfmsTheme';

const ACCEPT = '.pdf,image/*';
const COLS = 'minmax(0,1.8fr) minmax(0,1fr) minmax(64px,0.6fr) minmax(96px,0.8fr) minmax(96px,0.8fr) minmax(0,1.8fr)';
const HEAD = ['Item', 'SKU', 'Received', 'Accepted', 'Rejected', 'Remark'];
const ALIGN = ['left', 'left', 'center', 'center', 'center', 'left'];
// Below this width (the card's own, not the viewport's) each line stacks.
const TABLE_MIN = 720;
// The server's limit for the QC's overall remarks (incomingQc.validation.js).
const REMARKS_MAX = 1000;


/**
 * The Incoming QC inspection form body (Step 1.9): QC header, the inspection
 * table — Item · SKU · Received (from the saved GRN, read-only) · Accepted ·
 * Rejected · Remark (optional) — the optional QC report / photo, the caller's
 * summary (expected result) and the QC remarks.
 * Every received unit is Accepted or Rejected (Accepted + Rejected = Received).
 *
 * Rework / defect / severity are no longer entered, but anything the earlier
 * form stored stays on the line (it is sent back unchanged and shown as a note);
 * the full record page lists it. Controlled — the parent owns the state and the
 * save / complete actions. Used by the GRN page / GRN form and the QC dialog.
 *
 *   sourceField    node in the header's first slot (GRN picker / GRN number)
 *   sourceSummary  node under the header (vendor / PO / PI chips)
 *   summary        node between the attachment and the remarks (expected result)
 *   readOnly       render values only (completed QC)
 *   onUploadingChange  told when an attachment upload starts / ends (to hold the parent's actions)
 */
const QcInspectionForm = ({
  header, onHeaderChange, items, onItemChange, doc, onDocChange,
  readOnly = false, sourceField = null, sourceSummary = null, summary = null, onUploadingChange,
  emptyText = 'Select a GRN to load its received items.',
}) => {
  const { enqueueSnackbar } = useSnackbar();
  const [tableEl, setTableEl] = useState(null);
  const wide = useElementWidth(tableEl) >= TABLE_MIN;
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  useEffect(() => { onUploadingChange?.(uploading); }, [uploading, onUploadingChange]);

  const unbalanced = readOnly ? [] : items.filter((it) => !lineBalanced(it));

  const handleUpload = async (f) => {
    try {
      const d = (await uploadDoc(f).unwrap())?.data || {};
      onDocChange({ fileName: d.fileName || f.name, fileUrl: d.url, fileType: d.mimeType || f.type });
      enqueueSnackbar('Attachment uploaded', { variant: 'success' });
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Upload failed', { variant: 'error' }); }
  };

  // Entering Accepted / Rejected on a line that still carries rework from the
  // earlier form re-splits it two-way: the rework is cleared only by that edit.
  const setQty = (idx, it, key, value) => onItemChange(idx, {
    [key]: value,
    ...(round2(it.reworkQty) > 0 ? { reworkQty: 0 } : {}),
  });

  const qtyField = (idx, it, key, label) => (
    <Box sx={{ minWidth: 0 }}>
      {!wide && <CellCaption>{label}</CellCaption>}
      {readOnly ? (
        <Typography sx={{ textAlign: wide ? 'center' : 'left', fontWeight: 700, fontSize: '0.92rem', color: PFMS.ink }}>{it[key]}</Typography>
      ) : (
        <TextField size="small" type="number" fullWidth value={it[key]} error={!lineBalanced(it)}
          onChange={(e) => setQty(idx, it, key, e.target.value)}
          // No up/down spinner arrows, and the mouse wheel can't nudge the value.
          onWheel={(e) => e.target.blur()}
          sx={pfmsNoSpinSx}
          inputProps={{ min: 0, step: 0.01, style: { textAlign: 'center', fontWeight: 700 }, 'aria-label': `${label} — ${it.itemName}` }} />
      )}
    </Box>
  );

  const fieldsCols = sourceField
    ? { xs: 'repeat(2, minmax(0,1fr))', md: 'minmax(0,1.6fr) repeat(3, minmax(0,1fr))' }
    : { xs: 'repeat(2, minmax(0,1fr))', sm: 'repeat(3, minmax(0,1fr))' };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      {/* Header */}
      <FormSection icon={<FileText size={20} />} title="QC Header">
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: fieldsCols }}>
          {sourceField ? <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, minWidth: 0 }}>{sourceField}</Box> : null}
          {/* The date takes a full row on a phone so dd/mm/yyyy is never cut. */}
          <LabeledField label="QC Date" htmlFor="qc-f-date" sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
            <DateInputDDMMYYYY id="qc-f-date" fullWidth value={header.qcDate} disabled={readOnly}
              onChange={(val) => onHeaderChange({ qcDate: val })} />
          </LabeledField>
          <LabeledField label="Checked By" htmlFor="qc-f-checked">
            <TextField id="qc-f-checked" fullWidth value={header.checkedByName} disabled={readOnly} placeholder="Enter checked by"
              onChange={(e) => onHeaderChange({ checkedByName: e.target.value })} />
          </LabeledField>
          <LabeledField label="Prepared By" htmlFor="qc-f-prepared">
            <TextField id="qc-f-prepared" fullWidth value={header.preparedBy} disabled={readOnly} placeholder="Enter prepared by"
              onChange={(e) => onHeaderChange({ preparedBy: e.target.value })} />
          </LabeledField>
        </Box>
        {sourceSummary}
      </FormSection>

      {/* Inspection */}
      <FormSection icon={<ClipboardCheck size={20} />} title="Inspection" tone="amber" ref={setTableEl}>
        {items.length === 0 ? (
          <Typography sx={{ py: 2, fontSize: '0.86rem', color: PFMS.faint }}>{emptyText}</Typography>
        ) : (
          <>
            {wide && <FormTableHead columns={HEAD} template={COLS} align={ALIGN} gap={1.5} />}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {items.map((it, idx) => {
                const bad = !readOnly && !lineBalanced(it);
                const legacy = legacyLineDetail(it);
                return (
                  <Box key={it.grnItemId || idx} data-testid="qc-line" sx={{
                    display: 'grid', gridTemplateColumns: wide ? COLS : 'repeat(3, minmax(0,1fr))',
                    gap: wide ? 1.5 : 1.25, alignItems: wide ? 'center' : 'start',
                    px: 1.5, py: wide ? 1 : 1.5,
                    borderRadius: '8px', border: '1px solid', borderColor: bad ? 'error.main' : (wide ? 'transparent' : PFMS.line),
                    borderBottomColor: bad ? 'error.main' : PFMS.lineSoft,
                    '&:hover': { bgcolor: alpha('#2563eb', 0.03) },
                  }}>
                    <Box sx={{ minWidth: 0, gridColumn: wide ? 'auto' : '1 / -1' }}>
                      <Typography title={it.itemName} sx={{ fontWeight: 700, fontSize: '0.92rem', color: PFMS.brand, overflowWrap: 'anywhere', lineHeight: 1.35 }}>
                        {it.itemName}
                      </Typography>
                      {!wide && it.skuCode ? <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: PFMS.sub, overflowWrap: 'anywhere' }}>{it.skuCode}</Typography> : null}
                      {it.batchNo ? <Typography variant="caption" sx={{ display: 'block', color: PFMS.sub }}>Batch {it.batchNo}</Typography> : null}
                      {/* Received in the purchase unit: the GRN's frozen rule and what the
                          accepted qty will post to stock as. */}
                      {frozenRule(it) ? (
                        <Typography variant="caption" data-testid="qc-line-conversion" sx={{ display: 'block', fontWeight: 700, color: '#0f766e' }}>
                          {frozenRule(it)} · accepted {round2(it.acceptedQty)} {it.unit} {frozenStockText(it, it.acceptedQty)}
                        </Typography>
                      ) : null}
                      {legacy ? (
                        <Typography variant="caption" data-testid="qc-line-legacy" sx={{ display: 'block', color: round2(it.reworkQty) > 0 && !readOnly ? 'warning.dark' : PFMS.sub }}>
                          {round2(it.reworkQty) > 0 && !readOnly
                            ? `Earlier form recorded rework ${round2(it.reworkQty)} — enter it as Accepted or Rejected`
                            : `Also recorded: ${legacy}`}
                        </Typography>
                      ) : null}
                    </Box>
                    {wide && (
                      <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: PFMS.brand, overflowWrap: 'anywhere', minWidth: 0 }}>{it.skuCode || '—'}</Typography>
                    )}
                    <Box sx={{ minWidth: 0 }}>
                      {!wide && <CellCaption>Received</CellCaption>}
                      <Typography sx={{ textAlign: wide ? 'center' : 'left', fontWeight: 800, fontSize: '0.95rem', color: PFMS.brand, lineHeight: wide ? 1.4 : '40px' }}>
                        {it.receivedQty}
                      </Typography>
                    </Box>
                    {qtyField(idx, it, 'acceptedQty', 'Accepted')}
                    {qtyField(idx, it, 'rejectedQty', 'Rejected')}
                    <Box sx={{ gridColumn: wide ? 'auto' : '1 / -1', minWidth: 0 }}>
                      {!wide && <CellCaption>Remark</CellCaption>}
                      {readOnly ? (
                        <Typography sx={{ fontSize: '0.86rem', color: PFMS.sub, overflowWrap: 'anywhere' }}>{it.qcRemarks || '—'}</Typography>
                      ) : (
                        <TextField size="small" fullWidth placeholder="Remark (optional)"
                          value={it.qcRemarks || ''} onChange={(e) => onItemChange(idx, { qcRemarks: e.target.value })}
                          inputProps={{ maxLength: 500, 'aria-label': `Remark — ${it.itemName}` }} />
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
            {unbalanced.length > 0 && (
              <Alert severity="error" sx={{ mt: 1.5 }} data-testid="qc-balance">
                Accepted + Rejected must equal Received for:{' '}
                {unbalanced.map((it) => `${it.itemName} (${round2(it.acceptedQty)} + ${round2(it.rejectedQty)} ≠ ${round2(it.receivedQty)})`).join(', ')}
              </Alert>
            )}
          </>
        )}
      </FormSection>

      {/* Attachment (QC report / photo) — the existing QC attachment */}
      <AttachmentDrop label="Attachment (QC report / photo — optional)" accept={ACCEPT}
        doc={doc} readOnly={readOnly} uploading={uploading} hrefOf={fileHref}
        onFile={handleUpload} onRemove={() => onDocChange(null)}
        onReject={() => enqueueSnackbar('Attach a PDF or an image', { variant: 'warning' })}
        inputProps={{ 'data-testid': 'qc-attachment-input' }} fileTestId="qc-attachment" />

      {summary}

      {/* The QC's overall remark, kept on the record. */}
      {readOnly ? (
        header.remarks ? (
          <FormSection icon={<MessageSquareText size={20} />} title="QC Remarks">
            <Typography sx={{ fontSize: '0.88rem', color: PFMS.ink, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{header.remarks}</Typography>
          </FormSection>
        ) : null
      ) : (
        <FormSection icon={<MessageSquareText size={20} />} title="QC Remarks">
          <RemarksField id="qc-f-remarks" value={header.remarks || ''} max={REMARKS_MAX}
            onChange={(v) => onHeaderChange({ remarks: v })} placeholder="Enter QC remarks (optional)"
            inputProps={{ 'aria-label': 'QC Remarks' }} />
        </FormSection>
      )}
    </Box>
  );
};

export default QcInspectionForm;
