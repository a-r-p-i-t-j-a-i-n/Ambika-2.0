import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, MenuItem, Typography, CircularProgress, Divider,
} from '@mui/material';
import { Save } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useApproveQuotationMutation } from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import ItemQuotationTable from './ItemQuotationTable';
import { itemRef } from './indentMeta';

/**
 * Step 1.3 — Approved Quotation 1.03.
 *
 * Item-wise: every indent line item gets its own approved-quotation upload
 * (PDF / image / Excel, multiple files allowed), actual date and remarks.
 * Submits the `itemApprovedQuotations[]` payload; the backend aggregates files
 * into the legacy `approvedQuotationDocuments[]` / `approvedQuotation` fields
 * (used by the PO flow). Requires Step 1.2 done.
 */
const ACCEPT = '.pdf,image/*,.xls,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
const todayStr = () => new Date().toISOString().slice(0, 10);

const STATUS_OPTIONS = [
  { value: 'YES', label: 'Yes' },
  { value: 'QUOTATION_NOT_APPROVED', label: 'Quotation Not Approved' },
];

// Indent line items (multi-item, with legacy single-product fallback).
const itemsOf = (indent) => {
  if (indent?.items?.length) return indent.items;
  if (indent?.productNameRevised) {
    return [{
      _id: 'legacy', itemName: indent.productNameRevised, skuCode: indent.skuCode,
      skuId: indent.skuId, quantity: indent.quantity, approvedQuantity: indent.approvedQuantity, unit: indent.unit,
    }];
  }
  return [];
};

const QuotationApprovalDialog = ({ open, onClose, indent }) => {
  const { enqueueSnackbar } = useSnackbar();

  const [actualAt, setActualAt] = useState(todayStr());
  const [remarks, setRemarks] = useState('');
  const [rows, setRows] = useState([]); // [{ itemId, skuId, skuCode, itemName, qty, unit, statusDone, files, actualAt, remarks }]
  const [uploadingIdx, setUploadingIdx] = useState(-1);

  const [uploadDoc] = useUploadOrderDocumentMutation();
  const [approveQuotation, { isLoading: saving }] = useApproveQuotationMutation();

  useEffect(() => {
    if (!open) return;
    const existing = indent?.quotationApprovalStep;
    setActualAt(existing?.actualAt ? existing.actualAt.slice(0, 10) : todayStr());
    setRemarks(existing?.remarks || '');

    // Hydrate per-item files from saved itemApprovedQuotations[] (match by
    // itemId, then skuCode, then itemName). Falls back to the legacy flat
    // documents on the first item so older records remain editable.
    const saved = existing?.itemApprovedQuotations || [];
    const findSaved = (it) => saved.find((s) =>
      (it._id && String(s.itemId) === String(it._id))
      || (it.skuCode && s.skuCode && s.skuCode === it.skuCode)
      || (s.itemName && s.itemName === it.itemName));
    const legacyDocs = !saved.length
      ? (existing?.approvedQuotationDocuments?.length
        ? existing.approvedQuotationDocuments
        : (existing?.approvedQuotation?.fileUrl ? [existing.approvedQuotation] : []))
      : [];

    setRows(itemsOf(indent).map((it, i) => {
      const s = findSaved(it);
      const files = (s?.approvedQuotationDocuments?.length ? s.approvedQuotationDocuments : (i === 0 ? legacyDocs : []))
        .filter((d) => d?.fileUrl)
        .map((d) => ({ fileName: d.fileName, fileUrl: d.fileUrl, fileType: d.fileType }));
      return {
        itemId: it._id && it._id !== 'legacy' ? it._id : undefined,
        skuId: it.skuId || undefined,
        skuCode: it.skuCode || '',
        itemName: it.itemName || '',
        itemDisplayNumber: itemRef(indent?.indentNumber, it, i),
        qty: it.approvedQuantity || it.quantity,
        unit: it.unit || 'Pcs',
        statusDone: s?.statusDone || existing?.statusDone || 'YES',
        files,
        actualAt: s?.actualAt ? s.actualAt.slice(0, 10) : '',
        remarks: s?.remarks || '',
      };
    }));
  }, [open, indent]);

  const patchRow = (idx, patch) => setRows((cur) => cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const handleUploadRow = async (idx, picked) => {
    setUploadingIdx(idx);
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
    setUploadingIdx(-1);
  };

  const removeFile = (idx, fileIdx) => setRows((cur) => cur.map((r, i) => (i === idx
    ? { ...r, files: r.files.filter((_, fi) => fi !== fileIdx) }
    : r)));

  const handleSubmit = async () => {
    // Each item marked "Yes" needs ≥1 file; "Quotation Not Approved" is optional.
    const missing = rows.find((r) => r.statusDone === 'YES' && r.files.length === 0);
    if (missing) {
      enqueueSnackbar(`Upload at least one approved quotation file for "${missing.itemName}"`, { variant: 'warning' });
      return;
    }
    // Aggregate step status: YES if any item is approved, else QUOTATION_NOT_APPROVED.
    const statusDone = rows.length && rows.every((r) => r.statusDone === 'QUOTATION_NOT_APPROVED')
      ? 'QUOTATION_NOT_APPROVED'
      : 'YES';
    try {
      await approveQuotation({
        id: indent._id,
        statusDone,
        itemApprovedQuotations: rows.map((r) => ({
          itemId: r.itemId,
          skuId: r.skuId,
          skuCode: r.skuCode,
          itemName: r.itemName,
          statusDone: r.statusDone,
          approvedQuotationDocuments: r.files.map((f) => ({ fileName: f.fileName, fileUrl: f.fileUrl, fileType: f.fileType })),
          actualAt: r.actualAt || actualAt,
          remarks: r.remarks?.trim() || '',
        })),
        actualAt,
        remarks: remarks.trim(),
      }).unwrap();
      enqueueSnackbar('Quotation approval recorded', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Approved Quotation 1.03</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2} sx={{ mb: 1 }}>
          <Grid item xs={12} sm={6}>
            <TextField label="Indent No" fullWidth value={indent?.indentNumber || ''} InputProps={{ readOnly: true }} disabled />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Step No" select fullWidth value="Step 1.3" disabled>
              <MenuItem value="Step 1.3">Step 1.3</MenuItem>
            </TextField>
          </Grid>
        </Grid>

        <Divider sx={{ my: 1.5 }} />
        <Typography sx={{ fontWeight: 700, mb: 1 }}>
          Item-wise Approved Quotation Upload
        </Typography>
        <ItemQuotationTable
          rows={rows}
          qtyLabel="Approved Qty"
          uploadLabel="Approved Quotation Uploaded"
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
        <Button onClick={() => onClose?.(false)} disabled={saving || uploadingIdx !== -1}>Cancel</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          onClick={handleSubmit} disabled={saving || uploadingIdx !== -1}>
          Submit
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default QuotationApprovalDialog;
