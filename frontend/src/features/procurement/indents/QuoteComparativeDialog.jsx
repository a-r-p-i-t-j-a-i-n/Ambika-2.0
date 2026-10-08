import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, MenuItem, Typography, CircularProgress, Divider, Alert,
} from '@mui/material';
import { Save } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useQuoteComparativeMutation } from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import ItemQuotationTable from './ItemQuotationTable';
import { itemRef, matchItemRow, legacyFallbackDocs, isItemEligibleForQuote, fileHref } from './indentMeta';

/**
 * Step 1.2 — Receive Quote & Make Comparative 1.02.
 *
 * Item-wise: every indent line item gets its own quotation upload (PDF / image /
 * Excel, multiple files allowed), actual date and remarks. Submits the
 * `itemQuotations[]` payload; the backend aggregates files into the legacy
 * `quotationDocuments[]` / `quotationUploaded` fields for older screens.
 */
const ACCEPT = '.pdf,image/*,.xls,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
const todayStr = () => new Date().toISOString().slice(0, 10);

const STATUS_OPTIONS = [
  { value: 'YES', label: 'Yes' },
  { value: 'QUOTE_NOT_REQUIRED', label: 'Quote Not Required' },
];

// Indent line items (multi-item, with legacy single-product fallback). Items
// rejected during indent approval (Step 1.1) never reach Step 1.2.
const itemsOf = (indent) => {
  if (indent?.items?.length) return indent.items.filter((it) => isItemEligibleForQuote(indent, it));
  if (indent?.productNameRevised) {
    return [{
      _id: 'legacy', itemName: indent.productNameRevised, skuCode: indent.skuCode,
      skuId: indent.skuId, quantity: indent.quantity, unit: indent.unit,
    }];
  }
  return [];
};

const QuoteComparativeDialog = ({ open, onClose, indent }) => {
  const { enqueueSnackbar } = useSnackbar();

  const [actualAt, setActualAt] = useState(todayStr());
  const [remarks, setRemarks] = useState('');
  const [rows, setRows] = useState([]); // [{ itemId, skuId, skuCode, itemName, qty, unit, statusDone, files, actualAt, remarks }]
  const [uploadingIdx, setUploadingIdx] = useState(-1);
  // Uploads can run on several rows at once — Submit/Cancel wait for all of them.
  const [uploadsInFlight, setUploadsInFlight] = useState(0);

  const [uploadDoc] = useUploadOrderDocumentMutation();
  const [quoteComparative, { isLoading: saving }] = useQuoteComparativeMutation();

  useEffect(() => {
    if (!open) return;
    const existing = indent?.quoteComparativeStep;
    setActualAt(existing?.actualAt ? existing.actualAt.slice(0, 10) : todayStr());
    setRemarks(existing?.remarks || '');

    // Hydrate per-item files from saved itemQuotations[] — strictly keyed by
    // itemId first (matchItemRow never lets a skuCode/itemName match on the
    // wrong row win over a correct itemId match elsewhere in the array). The
    // legacy flat fallback only applies to a true single-item/pre-item-wise
    // indent — it is never spread across multiple items or dumped onto item 0.
    const saved = existing?.itemQuotations || [];
    const indentItems = itemsOf(indent);
    const legacyDocs = legacyFallbackDocs(saved, indentItems, existing?.quotationDocuments, existing?.quotationUploaded);

    setRows(indentItems.map((it, i) => {
      const s = matchItemRow(saved, it);
      const files = (s?.quotationDocuments?.length ? s.quotationDocuments : legacyDocs)
        .filter((d) => d?.fileUrl)
        .map((d) => ({ fileName: d.fileName, fileUrl: d.fileUrl, fileType: d.fileType, uploadedAt: d.uploadedAt }));
      return {
        itemId: it._id && it._id !== 'legacy' ? it._id : undefined,
        skuId: it.skuId || undefined,
        skuCode: it.skuCode || '',
        itemName: it.itemName || '',
        itemDisplayNumber: itemRef(indent?.indentNumber, it, i),
        qty: it.quantity,
        unit: it.unit || 'Pcs',
        statusDone: s?.statusDone || existing?.statusDone || 'YES',
        files,
        actualAt: s?.actualAt ? s.actualAt.slice(0, 10) : '',
        remarks: s?.remarks || '',
      };
    }));
  }, [open, indent]);

  // Old flat-format files that can't be tied to one item (multi-item legacy
  // records) — shown read-only; the server keeps them at quotation level.
  const unlinkedLegacyDocs = (() => {
    const step = indent?.quoteComparativeStep;
    if (step?.legacyQuotationDocuments?.length) return step.legacyQuotationDocuments;
    const hasItemFiles = (step?.itemQuotations || []).some((iq) => iq.quotationDocuments?.length);
    if (hasItemFiles || itemsOf(indent).length <= 1) return [];
    return (step?.quotationDocuments || []).filter((d) => d?.fileUrl);
  })();

  const patchRow = (idx, patch) => setRows((cur) => cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const handleUploadRow = async (idx, picked) => {
    setUploadingIdx(idx);
    setUploadsInFlight((n) => n + 1);
    for (const f of picked) {
      if (f.size > 10 * 1024 * 1024) {
        enqueueSnackbar(`${f.name} exceeds 10 MB`, { variant: 'warning' });
        continue;
      }
      try {
        const res = await uploadDoc(f).unwrap();
        const d = res?.data || {};
        setRows((cur) => cur.map((r, i) => (i === idx
          ? { ...r, files: [...r.files, { fileName: d.fileName || f.name, fileUrl: d.url, fileType: d.mimeType || f.type }] }
          : r)));
      } catch (err) {
        enqueueSnackbar(err?.data?.message || `Failed to upload ${f.name}`, { variant: 'error' });
      }
    }
    setUploadsInFlight((n) => n - 1);
    setUploadingIdx((cur) => (cur === idx ? -1 : cur));
  };

  const removeFile = (idx, fileIdx) => setRows((cur) => cur.map((r, i) => (i === idx
    ? { ...r, files: r.files.filter((_, fi) => fi !== fileIdx) }
    : r)));

  const handleSubmit = async () => {
    // Each item marked "Yes" needs at least one file; "Quote Not Required" is optional.
    const missing = rows.find((r) => r.statusDone === 'YES' && r.files.length === 0);
    if (missing) {
      enqueueSnackbar(`Upload at least one quotation file for "${missing.itemName}"`, { variant: 'warning' });
      return;
    }
    // Aggregate step status: only QUOTE_NOT_REQUIRED if every item is not required.
    const statusDone = rows.length && rows.every((r) => r.statusDone === 'QUOTE_NOT_REQUIRED')
      ? 'QUOTE_NOT_REQUIRED'
      : 'YES';
    try {
      await quoteComparative({
        id: indent._id,
        statusDone,
        itemQuotations: rows.map((r) => ({
          itemId: r.itemId,
          skuId: r.skuId,
          skuCode: r.skuCode,
          itemName: r.itemName,
          statusDone: r.statusDone,
          // Keep each file's original upload date (new uploads get stamped server-side).
          quotationDocuments: r.files.map((f) => ({
            fileName: f.fileName, fileUrl: f.fileUrl, fileType: f.fileType,
            ...(f.uploadedAt ? { uploadedAt: f.uploadedAt } : {}),
          })),
          actualAt: r.actualAt || actualAt,
          remarks: r.remarks?.trim() || '',
        })),
        actualAt,
        remarks: remarks.trim(),
      }).unwrap();
      enqueueSnackbar('Quote & comparative recorded', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Receive Quote &amp; Make Comparative</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2} sx={{ mb: 1 }}>
          <Grid item xs={12} sm={6}>
            <TextField label="Indent No" fullWidth value={indent?.indentNumber || ''} InputProps={{ readOnly: true }} disabled />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Step No" select fullWidth value="Step 1.2" disabled>
              <MenuItem value="Step 1.2">Step 1.2</MenuItem>
            </TextField>
          </Grid>
        </Grid>

        <Divider sx={{ my: 1.5 }} />
        <Typography sx={{ fontWeight: 700, mb: 1 }}>
          Item-wise Quotation Upload
        </Typography>
        <ItemQuotationTable
          rows={rows}
          qtyLabel="Qty"
          uploadLabel="Quotation Uploaded"
          accept={ACCEPT}
          statusOptions={STATUS_OPTIONS}
          yesValue="YES"
          uploadingIdx={uploadingIdx}
          onUploadRow={handleUploadRow}
          onRemoveFile={removeFile}
          onPatchRow={patchRow}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Multiple files allowed per item · PDF, PNG, JPG, XLSX · max 10 MB each
        </Typography>
        {unlinkedLegacyDocs.length > 0 && (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            {unlinkedLegacyDocs.length} earlier quotation file(s) are not linked to a specific item and are kept
            at quotation level:{' '}
            {unlinkedLegacyDocs.map((d, i) => (
              <React.Fragment key={d.fileUrl}>
                {i > 0 && ', '}
                <a href={fileHref(d.fileUrl)} target="_blank" rel="noopener noreferrer">{d.fileName || `File ${i + 1}`}</a>
              </React.Fragment>
            ))}
          </Alert>
        )}

        <Divider sx={{ my: 1.5 }} />
        <Grid container spacing={2}>
          <Grid item xs={12} sm={5}>
            <DateInputDDMMYYYY label="Actual Date" fullWidth value={actualAt} onChange={setActualAt} />
          </Grid>
          <Grid item xs={12} sm={7}>
            <TextField label="Remarks" fullWidth value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={saving || uploadsInFlight > 0}>Cancel</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          onClick={handleSubmit} disabled={saving || uploadsInFlight > 0}>
          Submit
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default QuoteComparativeDialog;
